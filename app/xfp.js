// Expected Fantasy Points (xFP) engine: opportunity x league-average efficiency,
// built from free nflverse play-by-play data. See ../projection_formula.md for the theory.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PBP_CACHE_DIR = path.join(__dirname, 'data');
const RUSH_BUCKETS = [
  { label: '1-5', min: 1, max: 5 },
  { label: '6-10', min: 6, max: 10 },
  { label: '11-20', min: 11, max: 20 },
  { label: '21-99', min: 21, max: 99 },
];
const PASS_BUCKETS = [
  { label: '<0 (screen)', min: -99, max: -0.01 },
  { label: '0-4', min: 0, max: 4 },
  { label: '5-9', min: 5, max: 9 },
  { label: '10-19', min: 10, max: 19 },
  { label: '20+', min: 20, max: 99 },
];

function bucketIndex(buckets, value) {
  return buckets.findIndex((b) => value >= b.min && value <= b.max);
}

function parseCSVLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) { result.push(cur); cur = ''; }
    else cur += c;
  }
  result.push(cur);
  return result;
}

async function downloadPbp(season) {
  if (!fs.existsSync(PBP_CACHE_DIR)) fs.mkdirSync(PBP_CACHE_DIR, { recursive: true });
  const cachePath = path.join(PBP_CACHE_DIR, `pbp_${season}.csv`);
  if (fs.existsSync(cachePath)) return cachePath;
  const url = `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download pbp for ${season}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const csv = zlib.gunzipSync(buf);
  fs.writeFileSync(cachePath, csv);
  return cachePath;
}

// Compact record extraction: only the fields the engine needs, not all 372 columns.
async function loadPlays(season) {
  const filePath = await downloadPbp(season);
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const headers = parseCSVLine(lines[0]);
  const idx = (name) => headers.indexOf(name);
  const col = {
    play_type: idx('play_type'), season_type: idx('season_type'),
    yardline_100: idx('yardline_100'), air_yards: idx('air_yards'),
    complete_pass: idx('complete_pass'), rush_touchdown: idx('rush_touchdown'),
    pass_touchdown: idx('pass_touchdown'), first_down_rush: idx('first_down_rush'),
    first_down_pass: idx('first_down_pass'), fumble_lost: idx('fumble_lost'),
    two_point_attempt: idx('two_point_attempt'), two_point_conv_result: idx('two_point_conv_result'),
    qb_kneel: idx('qb_kneel'), qb_spike: idx('qb_spike'),
    rusher_player_name: idx('rusher_player_name'), rusher_player_id: idx('rusher_player_id'),
    receiver_player_name: idx('receiver_player_name'), receiver_player_id: idx('receiver_player_id'),
    posteam: idx('posteam'),
  };

  const plays = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = parseCSVLine(lines[i]);
    if (c[col.season_type] !== 'REG') continue;
    const playType = c[col.play_type];

    if (playType === 'run' && c[col.qb_kneel] !== '1') {
      const yardline100 = Number(c[col.yardline_100]);
      if (!Number.isFinite(yardline100)) continue;
      plays.push({
        type: 'rush', yardline100,
        touchdown: c[col.rush_touchdown] === '1',
        firstDown: c[col.first_down_rush] === '1',
        fumbleLost: c[col.fumble_lost] === '1',
        playerName: c[col.rusher_player_name], playerId: c[col.rusher_player_id],
        team: c[col.posteam],
      });
    } else if (playType === 'pass' && c[col.qb_spike] !== '1' && c[col.receiver_player_id]) {
      const airYards = Number(c[col.air_yards]);
      if (!Number.isFinite(airYards)) continue;
      plays.push({
        type: 'pass', airYards,
        complete: c[col.complete_pass] === '1',
        touchdown: c[col.pass_touchdown] === '1',
        firstDown: c[col.first_down_pass] === '1',
        fumbleLost: c[col.fumble_lost] === '1',
        playerName: c[col.receiver_player_name], playerId: c[col.receiver_player_id],
        team: c[col.posteam],
      });
    }
  }
  return plays;
}

function buildLeagueRates(plays) {
  const rushBuckets = RUSH_BUCKETS.map(() => ({ attempts: 0, td: 0, fd: 0 }));
  const passBuckets = PASS_BUCKETS.map(() => ({ targets: 0, complete: 0, td: 0, fd: 0 }));
  let touches = 0, fumblesLost = 0, totalTDs = 0, twoPtAttempts = 0, twoPtSuccess = 0;

  for (const p of plays) {
    if (p.type === 'rush') {
      const bi = bucketIndex(RUSH_BUCKETS, p.yardline100);
      if (bi === -1) continue;
      rushBuckets[bi].attempts++;
      if (p.touchdown) { rushBuckets[bi].td++; totalTDs++; }
      if (p.firstDown) rushBuckets[bi].fd++;
      touches++;
      if (p.fumbleLost) fumblesLost++;
    } else {
      const bi = bucketIndex(PASS_BUCKETS, p.airYards);
      if (bi === -1) continue;
      passBuckets[bi].targets++;
      if (p.complete) {
        passBuckets[bi].complete++;
        touches++;
        if (p.fumbleLost) fumblesLost++;
      }
      if (p.touchdown) { passBuckets[bi].td++; totalTDs++; }
      if (p.firstDown) passBuckets[bi].fd++;
    }
  }

  return {
    rush: RUSH_BUCKETS.map((b, i) => ({
      label: b.label,
      tdRate: rushBuckets[i].attempts ? rushBuckets[i].td / rushBuckets[i].attempts : 0,
      fdRate: rushBuckets[i].attempts ? rushBuckets[i].fd / rushBuckets[i].attempts : 0,
      sampleSize: rushBuckets[i].attempts,
    })),
    pass: PASS_BUCKETS.map((b, i) => ({
      label: b.label,
      catchRate: passBuckets[i].targets ? passBuckets[i].complete / passBuckets[i].targets : 0,
      tdRate: passBuckets[i].targets ? passBuckets[i].td / passBuckets[i].targets : 0,
      fdRate: passBuckets[i].targets ? passBuckets[i].fd / passBuckets[i].targets : 0,
      sampleSize: passBuckets[i].targets,
    })),
    fumbleLostRate: touches ? fumblesLost / touches : 0,
    twoPoint: { attemptRate: 0.006, successRate: 0.47 }, // league-wide 2pt rate is tiny and noisy; fixed low-confidence estimate
  };
}

function getPlayerBucketShares(plays, playerName, team) {
  const rushCounts = RUSH_BUCKETS.map(() => 0);
  const passCounts = PASS_BUCKETS.map(() => 0);
  let rushTotal = 0, passTotal = 0;

  for (const p of plays) {
    if (p.playerName !== playerName || p.team !== team) continue;
    if (p.type === 'rush') {
      const bi = bucketIndex(RUSH_BUCKETS, p.yardline100);
      if (bi === -1) continue;
      rushCounts[bi]++; rushTotal++;
    } else {
      const bi = bucketIndex(PASS_BUCKETS, p.airYards);
      if (bi === -1) continue;
      passCounts[bi]++; passTotal++;
    }
  }
  return {
    rushShares: rushCounts.map((c) => (rushTotal ? c / rushTotal : 0)),
    passShares: passCounts.map((c) => (passTotal ? c / passTotal : 0)),
    rushSample: rushTotal, passSample: passTotal,
  };
}

// scoringWeights: { rushTD, rushFD, receptions, recTD, recFD, fumbleLost, twoPt } — points per unit, from the league's mSettings.
function computeXFP({ projRushAtt, projRecTgt, leagueRates, playerShares, scoringWeights }) {
  let expRushTD = 0, expRushFD = 0, expReceptions = 0, expRecTD = 0, expRecFD = 0;

  playerShares.rushShares.forEach((share, i) => {
    const attempts = projRushAtt * share;
    expRushTD += attempts * leagueRates.rush[i].tdRate;
    expRushFD += attempts * leagueRates.rush[i].fdRate;
  });
  playerShares.passShares.forEach((share, i) => {
    const targets = projRecTgt * share;
    expReceptions += targets * leagueRates.pass[i].catchRate;
    expRecTD += targets * leagueRates.pass[i].tdRate;
    expRecFD += targets * leagueRates.pass[i].fdRate;
  });

  const expFumblesLost = (projRushAtt + expReceptions) * leagueRates.fumbleLostRate;
  const expTwoPt = (expRushTD + expRecTD) * leagueRates.twoPoint.attemptRate * leagueRates.twoPoint.successRate;

  const stats = {
    rushTD: expRushTD, rushFD: expRushFD, receptions: expReceptions,
    recTD: expRecTD, recFD: expRecFD, fumblesLost: expFumblesLost, twoPt: expTwoPt,
  };
  const xfpTotal =
    stats.rushTD * scoringWeights.rushTD +
    stats.rushFD * scoringWeights.rushFD +
    stats.receptions * scoringWeights.receptions +
    stats.recTD * scoringWeights.recTD +
    stats.recFD * scoringWeights.recFD +
    stats.fumblesLost * scoringWeights.fumbleLost +
    stats.twoPt * scoringWeights.twoPt;

  return { stats, xfpTotal };
}

module.exports = { loadPlays, buildLeagueRates, getPlayerBucketShares, computeXFP, RUSH_BUCKETS, PASS_BUCKETS };
