const express = require('express');
const fs = require('fs');
const path = require('path');
const { projectPlayer } = require('./projectionEngine');
const { fetchKalshiNFLMarkets } = require('./kalshiService');
const { analyzeWeekPerformance } = require('./learningEngine');
const { testGeminiKey, explainPlayerProjection, askScoutChat, listAvailableModels, DEFAULT_MODEL } = require('./aiService');

const app = express();
const PORT = 4477;

let config = {
  season: process.env.ESPN_SEASON ? parseInt(process.env.ESPN_SEASON, 10) : 2026,
  leagueId: process.env.ESPN_LEAGUE_ID || '',
  swid: process.env.ESPN_SWID || '',
  espn_s2: process.env.ESPN_S2 || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  aiModel: process.env.GEMINI_MODEL || DEFAULT_MODEL,
};
const configPath = path.join(__dirname, 'config.json');
const fallbackConfigPath = path.join(__dirname, 'data', 'config.json');

function loadSavedConfig() {
  try {
    if (fs.existsSync(configPath) && fs.statSync(configPath).isFile()) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    if (fs.existsSync(fallbackConfigPath) && fs.statSync(fallbackConfigPath).isFile()) {
      return JSON.parse(fs.readFileSync(fallbackConfigPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading saved config:', e.message);
  }
  return {};
}

function persistConfig(newCfg) {
  try {
    if (fs.existsSync(configPath) && !fs.statSync(configPath).isDirectory()) {
      fs.writeFileSync(configPath, JSON.stringify(newCfg, null, 2), 'utf8');
    } else {
      const dataDir = path.join(__dirname, 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(fallbackConfigPath, JSON.stringify(newCfg, null, 2), 'utf8');
    }
  } catch (e) {
    console.error('Error persisting config:', e.message);
  }
}

config = { ...config, ...loadSavedConfig() };

const formulaPath = path.join(__dirname, 'formula_config.json');
function getFormulaConfig() {
  if (fs.existsSync(formulaPath)) {
    try {
      return JSON.parse(fs.readFileSync(formulaPath, 'utf8'));
    } catch (e) {
      console.error('Error reading formula_config.json:', e.message);
    }
  }
  return {
    scoring: {
      receptions: 1.0,
      recYardsPerPt: 10.0,
      rushYardsPerPt: 10.0,
      passYardsPerPt: 25.0,
      passTD: 4.0,
      rushTD: 6.0,
      recTD: 6.0,
      twoPt: 2.0,
      fumbleLost: -2.0,
      interception: -2.0,
      fractionalYardage: true,
    },
    tuning: {
      enableMatchupAdjustments: true,
      enableInjuryRiskDiscount: true,
      enablePaceModifier: true,
      enableExpectedTDScaling: true,
      enableGameScript: true,
      enableBayesianShrinkage: true,
      enablePlayerMomentum: true,
      useKalshiMarketData: false,
      useKalshiPassingYards: true,
      useKalshiReceivingYards: true,
      useKalshiRushingYards: true,
      kalshiWeight: 0.4,
      matchupIntensity: 1.0,
      tdConversionScale: 1.0,
      gameScriptWeight: 1.0,
      shrinkageK: 40,
      paceModifier: 1.0,
    },
  };
}

app.use(express.json());

// Health check endpoint for Docker / reverse proxy monitoring
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// --- HTTP Basic Authentication Middleware ---
const AUTH_ENABLED = process.env.AUTH_ENABLED !== 'false';
const AUTH_USER = process.env.AUTH_USER || config.auth?.user || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || config.auth?.password || 'fantasy';

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (!AUTH_ENABLED) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Fantasy Football Projection Lab"');
    return res.status(401).send('Authentication required');
  }

  const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString('utf8');
  const colonIdx = credentials.indexOf(':');
  if (colonIdx === -1) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Fantasy Football Projection Lab"');
    return res.status(401).send('Invalid credentials format');
  }

  const user = credentials.substring(0, colonIdx);
  const pass = credentials.substring(colonIdx + 1);

  if (user === AUTH_USER && pass === AUTH_PASSWORD) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Fantasy Football Projection Lab"');
  return res.status(401).send('Access denied: Invalid username or password');
});

app.use(express.static(path.join(__dirname, 'public')));

// --- Sleeper: cache the ~14MB player dictionary in memory, refresh daily ---
let sleeperPlayers = null;
let sleeperPlayersFetchedAt = 0;

async function getSleeperPlayers() {
  const oneDay = 24 * 60 * 60 * 1000;
  if (!sleeperPlayers || Date.now() - sleeperPlayersFetchedAt > oneDay) {
    const res = await fetch('https://api.sleeper.app/v1/players/nfl');
    sleeperPlayers = await res.json();
    sleeperPlayersFetchedAt = Date.now();
  }
  return sleeperPlayers;
}

app.get('/api/sleeper/trending', async (req, res) => {
  try {
    const hours = req.query.hours || 24;
    const limit = req.query.limit || 10;
    const type = req.query.type === 'drop' ? 'drop' : 'add';
    const trendRes = await fetch(
      `https://api.sleeper.app/v1/players/nfl/trending/${type}?lookback_hours=${hours}&limit=${limit}`
    );
    const trending = await trendRes.json();
    const players = await getSleeperPlayers();
    const resolved = trending.map((t) => {
      const p = players[t.player_id] || {};
      return {
        name: p.full_name || t.player_id,
        position: p.position || '',
        team: p.team || '',
        status: p.injury_status || 'healthy',
        injuryNotes: p.injury_notes || '',
        age: p.age || '',
        depthChartOrder: p.depth_chart_order || '',
        count: t.count,
      };
    });
    res.json(resolved);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sleeper/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase();
    if (!q) return res.json([]);
    const players = await getSleeperPlayers();
    const results = Object.values(players)
      .filter((p) => p.full_name && p.full_name.toLowerCase().includes(q))
      .slice(0, 20)
      .map((p) => ({
        name: p.full_name,
        position: p.position || '',
        team: p.team || '',
        status: p.injury_status || 'healthy',
        age: p.age || '',
        years_exp: p.years_exp ?? '',
        college: p.college || '',
      }));
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- ESPN: public scoreboard (no auth) ---
app.get('/api/espn/scoreboard', async (req, res) => {
  try {
    const week = req.query.week;
    let url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
    if (week) url += `?week=${week}`;
    const r = await fetch(url);
    const data = await r.json();
    const games = data.events.map((e) => {
      const comp = e.competitions[0];
      const teams = comp.competitors.map((c) => `${c.team.abbreviation}:${c.score}`);
      return { matchup: teams.join(' vs '), kickoff: comp.status.type.detail };
    });
    res.json({ week: data.week ? data.week.number : null, games });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- ESPN: your private league (needs config.json) ---
const POSITION_MAP = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST' };
const PRO_TEAM_MAP = {
  0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
  8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA',
  16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT',
  24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

app.get('/api/espn/league', async (req, res) => {
  try {
    if (!config.leagueId || !config.swid || !config.espn_s2) {
      return res.status(400).json({
        error: 'Missing ESPN credentials. Copy config.example.json to config.json and fill in leagueId, swid, espn_s2.',
      });
    }
    const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${config.season}/segments/0/leagues/${config.leagueId}?view=mRoster&view=mTeam&view=mStatus`;
    const r = await fetch(url, {
      headers: { Cookie: `SWID=${config.swid}; espn_s2=${config.espn_s2}` },
    });
    if (!r.ok) {
      return res.status(r.status).json({ error: `ESPN returned HTTP ${r.status}` });
    }
    const data = await r.json();
    const currentWeek = data.scoringPeriodId;

    const findPoints = (stats, scoringPeriodId, statSourceId, seasonId) => {
      const entry = (stats || []).find(
        (s) =>
          s.scoringPeriodId === scoringPeriodId &&
          s.statSourceId === statSourceId &&
          (seasonId === undefined || s.seasonId === seasonId)
      );
      return entry ? Math.round(entry.appliedTotal * 10) / 10 : null;
    };

    const teams = (data.teams || []).map((t) => {
      const rec = t.record ? t.record.overall : {};
      const roster = (t.roster ? t.roster.entries : []).map((e) => {
        const p = e.playerPoolEntry.player;
        return {
          name: p.fullName,
          pos: POSITION_MAP[p.defaultPositionId] || p.defaultPositionId,
          nflTeam: PRO_TEAM_MAP[p.proTeamId] || p.proTeamId,
          injuryStatus: p.injuryStatus,
          percentOwned: p.ownership ? Math.round(p.ownership.percentOwned * 10) / 10 : null,
          adp: p.ownership ? Math.round(p.ownership.averageDraftPosition * 10) / 10 : null,
          projPtsThisWeek: findPoints(p.stats, currentWeek, 1, config.season),
          ...(currentWeek > 1
            ? { lastWeekActual: findPoints(p.stats, currentWeek - 1, 0, config.season) }
            : { lastSeasonTotal: findPoints(p.stats, 0, 0, config.season - 1) }),
        };
      });
      return {
        team: t.name || `Team ${t.id}`,
        record: rec ? `${rec.wins}-${rec.losses}-${rec.ties}` : '',
        pointsFor: rec ? rec.pointsFor : null,
        roster,
      };
    });
    res.json({ currentWeek, teams });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const LINEUP_SLOT_MAP = { 0: 'QB', 2: 'RB', 3: 'FLEX', 4: 'WR', 6: 'TE', 16: 'D/ST', 17: 'K', 20: 'BE', 21: 'IR', 23: 'FLEX' };

function isMyTeam(team, cfg) {
  return (team.owners || []).some((o) => o.toLowerCase() === cfg.swid.toLowerCase());
}

// --- ESPN: free agents / waiver wire ---
app.get('/api/espn/freeagents', async (req, res) => {
  try {
    if (!config.leagueId || !config.swid || !config.espn_s2) {
      return res.status(400).json({ error: 'Missing ESPN credentials in config.json.' });
    }
    const position = (req.query.position || '').toUpperCase();
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${config.season}/segments/0/leagues/${config.leagueId}?view=kona_player_info&view=mStatus`;
    const r = await fetch(url, {
      headers: {
        Cookie: `SWID=${config.swid}; espn_s2=${config.espn_s2}`,
        'X-Fantasy-Filter': JSON.stringify({
          players: {
            filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
            limit: 200,
            sortPercOwned: { sortAsc: false, sortPriority: 1 },
          },
        }),
      },
    });
    if (!r.ok) return res.status(r.status).json({ error: `ESPN returned HTTP ${r.status}` });
    const data = await r.json();
    const currentWeek = data.scoringPeriodId;
    const findPoints = (stats, scoringPeriodId, statSourceId, seasonId) => {
      const entry = (stats || []).find(
        (s) => s.scoringPeriodId === scoringPeriodId && s.statSourceId === statSourceId && s.seasonId === seasonId
      );
      return entry ? Math.round(entry.appliedTotal * 10) / 10 : null;
    };
    let players = (data.players || []).map((entry) => {
      const p = entry.player;
      return {
        name: p.fullName,
        pos: POSITION_MAP[p.defaultPositionId] || p.defaultPositionId,
        nflTeam: PRO_TEAM_MAP[p.proTeamId] || p.proTeamId,
        injuryStatus: p.injuryStatus,
        percentOwned: p.ownership ? Math.round(p.ownership.percentOwned * 10) / 10 : null,
        adp: p.ownership ? Math.round(p.ownership.averageDraftPosition * 10) / 10 : null,
        projPtsThisWeek: findPoints(p.stats, currentWeek, 1, config.season),
      };
    });
    if (position) players = players.filter((p) => p.pos === position);
    res.json(players.slice(0, limit));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Formula Configuration: get and update weekly formula tuners ---
app.get('/api/formula/config', (req, res) => {
  res.json(getFormulaConfig());
});

app.post('/api/formula/config', (req, res) => {
  try {
    const updated = req.body;
    if (!updated || typeof updated !== 'object') {
      return res.status(400).json({ error: 'Invalid configuration payload.' });
    }
    const current = getFormulaConfig();
    const merged = {
      scoring: { ...current.scoring, ...(updated.scoring || {}) },
      tuning: { ...current.tuning, ...(updated.tuning || {}) },
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(formulaPath, JSON.stringify(merged, null, 2), 'utf8');
    res.json({ ok: true, config: merged });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- ESPN League Credentials Configuration & Status ---
app.get('/api/config/status', (req, res) => {
  const isConfigured = !!(config.leagueId && config.swid && config.espn_s2);
  res.json({
    configured: isConfigured,
    season: config.season || 2026,
    leagueId: config.leagueId || '',
    swidMasked: config.swid ? (config.swid.length > 8 ? `${config.swid.slice(0, 4)}...${config.swid.slice(-4)}` : '****') : '',
    espnS2Masked: config.espn_s2 ? (config.espn_s2.length > 12 ? `${config.espn_s2.slice(0, 6)}...${config.espn_s2.slice(-6)}` : '****') : '',
  });
});

app.post('/api/config', async (req, res) => {
  try {
    const { season, leagueId, swid, espn_s2 } = req.body;
    if (!leagueId || !swid || !espn_s2) {
      return res.status(400).json({ error: 'League ID, SWID, and espn_s2 are all required.' });
    }

    const cleanSwid = String(swid).trim();
    const cleanS2 = String(espn_s2).trim();
    const cleanLeagueId = String(leagueId).trim();
    const cleanSeason = season ? parseInt(season, 10) : (config.season || 2026);

    // Validate credentials directly with ESPN API before saving
    const testUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${cleanSeason}/segments/0/leagues/${cleanLeagueId}?view=mSettings&view=mStatus`;
    const testRes = await fetch(testUrl, {
      headers: { Cookie: `SWID=${cleanSwid}; espn_s2=${cleanS2}` },
    });

    if (!testRes.ok) {
      if (testRes.status === 401 || testRes.status === 403) {
        return res.status(401).json({
          error: 'Authentication failed with ESPN. Please verify that your SWID and espn_s2 cookies are valid and active.',
        });
      }
      if (testRes.status === 404) {
        return res.status(404).json({
          error: `League ${cleanLeagueId} not found for season ${cleanSeason}. Please check your League ID.`,
        });
      }
      return res.status(testRes.status).json({
        error: `ESPN API returned HTTP ${testRes.status}.`,
      });
    }

    const testData = await testRes.json();
    const leagueName = testData.settings?.name || `League ${cleanLeagueId}`;

    config = {
      ...config,
      season: cleanSeason,
      leagueId: cleanLeagueId,
      swid: cleanSwid,
      espn_s2: cleanS2,
    };

    persistConfig(config);

    res.json({
      ok: true,
      leagueName,
      season: cleanSeason,
      leagueId: cleanLeagueId,
      message: `Successfully connected to ${leagueName}!`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Google Gemini AI Scout Endpoints ---
app.get('/api/ai/models', async (req, res) => {
  try {
    const key = req.query.key || config.geminiApiKey || process.env.GEMINI_API_KEY || '';
    const models = await listAvailableModels(key);
    if (!models || models.length === 0) {
      return res.json([
        { id: 'gemini-3.5-flash', displayName: 'gemini-3.5-flash (Fast, Recommended Free Tier)' },
        { id: 'gemini-3.8-flash', displayName: 'gemini-3.8-flash (Latest Flash Generation)' },
        { id: 'gemini-2.5-flash', displayName: 'gemini-2.5-flash (Standard Fast Tier)' },
        { id: 'gemini-3.5-pro', displayName: 'gemini-3.5-pro (In-depth Reasoning)' },
      ]);
    }
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ai/status', (req, res) => {
  const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY || '';
  const isConfigured = !!(apiKey && apiKey.trim());
  const maskedKey = isConfigured
    ? (apiKey.length > 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : '****')
    : '';
  res.json({
    configured: isConfigured,
    maskedKey,
    model: config.aiModel || DEFAULT_MODEL,
  });
});

app.post('/api/ai/config', async (req, res) => {
  try {
    const { geminiApiKey, model } = req.body || {};
    if (!geminiApiKey || !geminiApiKey.trim()) {
      return res.status(400).json({ error: 'Gemini API key is required.' });
    }
    const cleanKey = geminiApiKey.trim();
    const cleanModel = model ? model.trim() : (config.aiModel || DEFAULT_MODEL);

    // Test key connectivity first
    const testResult = await testGeminiKey(cleanKey, cleanModel);
    if (!testResult.ok) {
      return res.status(400).json({ error: testResult.error || 'Failed to validate API key with Google Gemini.' });
    }

    config = {
      ...config,
      geminiApiKey: cleanKey,
      aiModel: cleanModel,
    };
    persistConfig(config);

    res.json({
      ok: true,
      message: 'Google Gemini API key validated and saved successfully!',
      model: cleanModel,
      maskedKey: `${cleanKey.slice(0, 4)}...${cleanKey.slice(-4)}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/explain-player', async (req, res) => {
  try {
    const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        error: 'Google Gemini API key is not configured. Click "✨ AI Scout" in the top bar to set it up for free.',
      });
    }

    const { player } = req.body || {};
    if (!player || !player.name) {
      return res.status(400).json({ error: 'Player data is required.' });
    }

    const formulaConfig = getFormulaConfig();
    const explanation = await explainPlayerProjection({
      player,
      formulaConfig,
      apiKey,
      model: config.aiModel || DEFAULT_MODEL,
    });

    res.json({ ok: true, explanation });
  } catch (err) {
    console.error('Explain player error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        error: 'Google Gemini API key is not configured. Click "✨ AI Scout" in the top bar to set it up for free.',
      });
    }

    const { message, chatHistory, contextData } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const reply = await askScoutChat({
      message: message.trim(),
      chatHistory: chatHistory || [],
      contextData: contextData || {},
      apiKey,
      model: config.aiModel || DEFAULT_MODEL,
    });

    res.json({ ok: true, reply });
  } catch (err) {
    console.error('AI chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- ESPN: this week's matchups (summary) ---
app.get('/api/espn/matchup', async (req, res) => {
  try {
    if (!config.leagueId || !config.swid || !config.espn_s2) {
      return res.status(400).json({ error: 'Missing ESPN credentials in config.json.' });
    }
    const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${config.season}/segments/0/leagues/${config.leagueId}?view=mMatchupScore&view=mTeam&view=mStatus`;
    const r = await fetch(url, { headers: { Cookie: `SWID=${config.swid}; espn_s2=${config.espn_s2}` } });
    if (!r.ok) return res.status(r.status).json({ error: `ESPN returned HTTP ${r.status}` });
    const data = await r.json();
    const currentWeek = data.scoringPeriodId;
    const teamMap = Object.fromEntries((data.teams || []).map((t) => [t.id, t]));
    const matchups = (data.schedule || [])
      .filter((s) => s.matchupPeriodId === currentWeek)
      .map((s) => {
        const side = (half) => {
          const team = teamMap[half.teamId] || {};
          return {
            team: team.name || `Team ${half.teamId}`,
            mine: isMyTeam(team, config),
            projected: Math.round((half.totalProjectedPointsLive || 0) * 10) / 10,
            actual: Math.round((half.totalPoints || 0) * 10) / 10,
            winProbability: half.winProbability != null ? Math.round(half.winProbability * 1000) / 10 : null,
          };
        };
        return { away: side(s.away), home: side(s.home) };
      });
    res.json({ currentWeek, matchups });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- ESPN: detailed weekly matchups with side-by-side model projections ---
app.get('/api/espn/matchups-detailed', async (req, res) => {
  try {
    if (!config.leagueId || !config.swid || !config.espn_s2) {
      return res.status(400).json({ error: 'Missing ESPN credentials in config.json.' });
    }

    const formulaConfig = getFormulaConfig();
    const selectedWeek = req.query.week ? parseInt(req.query.week, 10) : 1;

    // 1. Fetch ESPN fantasy data with rosters & matchups for selected week
    const espnUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${config.season}/segments/0/leagues/${config.leagueId}?scoringPeriodId=${selectedWeek}&view=mMatchup&view=mMatchupScore&view=mRoster&view=mTeam&view=mSettings&view=mStatus`;
    const espnRes = await fetch(espnUrl, {
      headers: { Cookie: `SWID=${config.swid}; espn_s2=${config.espn_s2}` },
    });
    if (!espnRes.ok) {
      return res.status(espnRes.status).json({ error: `ESPN returned HTTP ${espnRes.status}` });
    }
    const data = await espnRes.json();
    const currentWeek = data.scoringPeriodId || 1;

    // 2. Fetch real NFL opponents for selected week from public scoreboard
    const nflOpponents = {};
    try {
      const sbRes = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${selectedWeek}`
      );
      if (sbRes.ok) {
        const sbData = await sbRes.json();
        for (const ev of (sbData.events || [])) {
          const competitors = ev.competitions?.[0]?.competitors || [];
          if (competitors.length === 2) {
            const t1 = competitors[0].team?.abbreviation;
            const t2 = competitors[1].team?.abbreviation;
            if (t1 && t2) {
              nflOpponents[t1] = t2;
              nflOpponents[t2] = t1;
            }
          }
        }
      }
    } catch (err) {
      console.warn('NFL scoreboard fetch warning:', err.message);
    }

    const forceRefresh = req.query.refresh === 'true';
    if (formulaConfig.tuning?.useKalshiMarketData) {
      try {
        await fetchKalshiNFLMarkets(forceRefresh);
      } catch (kErr) {
        console.warn('Kalshi market fetch error:', kErr.message);
      }
    }

    const teamMap = Object.fromEntries((data.teams || []).map((t) => [t.id, t]));

    const formatRosterSide = (half) => {
      if (!half || !half.teamId) return null;
      const team = teamMap[half.teamId] || {};
      const entries = half.rosterForCurrentScoringPeriod?.entries || team.roster?.entries || [];

      const starters = [];
      const bench = [];

      for (const e of entries) {
        const p = e.playerPoolEntry?.player;
        if (!p) continue;
        const slot = LINEUP_SLOT_MAP[e.lineupSlotId] || 'BE';
        const pos = POSITION_MAP[p.defaultPositionId] || 'FLEX';
        const nflTeam = PRO_TEAM_MAP[p.proTeamId] || 'FA';
        const opponentTeam = nflOpponents[nflTeam] || 'BYE';

        const projStat = (p.stats || []).find(
          (s) => s.scoringPeriodId === selectedWeek && s.statSourceId === 1
        );
        const actualStat = (p.stats || []).find(
          (s) => s.scoringPeriodId === selectedWeek && s.statSourceId === 0
        );

        const projection = projectPlayer({
          name: p.fullName,
          position: pos,
          nflTeam,
          opponentTeam,
          injuryStatus: p.injuryStatus,
          espnAppliedTotal: projStat ? projStat.appliedTotal : null,
          espnRawStats: projStat ? projStat.stats : {},
          formulaConfig,
        });

        const playerCard = {
          id: p.id,
          name: p.fullName,
          slot,
          pos,
          nflTeam,
          oppTeam: opponentTeam,
          injuryStatus: p.injuryStatus || 'HEALTHY',
          espnProj: projection.espnProj,
          ourProj: projection.ourProj,
          delta: projection.delta,
          hasKalshiSignal: projection.hasKalshiSignal,
          kalshiMarket: projection.kalshiMarket,
          momentum: projection.momentum,
          actual: actualStat ? Math.round(actualStat.appliedTotal * 10) / 10 : null,
          range: projection.range,
          breakdown: projection.breakdown,
        };

        if (slot === 'BE' || slot === 'IR') {
          bench.push(playerCard);
        } else {
          starters.push(playerCard);
        }
      }

      // Sort starters in standard fantasy order: QB, RB, WR, TE, FLEX, D/ST, K
      const slotOrder = { QB: 1, RB: 2, WR: 3, TE: 4, FLEX: 5, 'D/ST': 6, K: 7 };
      starters.sort((a, b) => (slotOrder[a.slot] || 99) - (slotOrder[b.slot] || 99));

      const espnStarterTotal = Math.round(starters.reduce((acc, p) => acc + (p.espnProj || 0), 0) * 10) / 10;
      const modelStarterTotal = Math.round(starters.reduce((acc, p) => acc + (p.ourProj || 0), 0) * 10) / 10;
      const actualStarterTotal = Math.round(starters.reduce((acc, p) => acc + (p.actual || 0), 0) * 10) / 10;

      return {
        teamId: half.teamId,
        teamName: team.name || `Team ${half.teamId}`,
        logo: team.logo || null,
        record: team.record?.overall ? `${team.record.overall.wins}-${team.record.overall.losses}` : '',
        mine: isMyTeam(team, config),
        espnStarterTotal,
        modelStarterTotal,
        actualStarterTotal,
        modelDelta: Math.round((modelStarterTotal - espnStarterTotal) * 10) / 10,
        starters,
        bench,
      };
    };

    const matchups = (data.schedule || [])
      .filter((s) => s.matchupPeriodId === selectedWeek)
      .map((s) => {
        const away = formatRosterSide(s.away);
        const home = formatRosterSide(s.home);

        // Win probability for Model (logistic difference over modelStarterTotal)
        let awayModelWinProb = 50.0;
        let homeModelWinProb = 50.0;
        if (away && home && (away.modelStarterTotal || home.modelStarterTotal)) {
          const diff = home.modelStarterTotal - away.modelStarterTotal;
          const probHome = 1.0 / (1.0 + Math.pow(10, -diff / 28.0));
          homeModelWinProb = Math.round(probHome * 1000) / 10;
          awayModelWinProb = Math.round((100 - homeModelWinProb) * 10) / 10;
        }

        return {
          id: s.id,
          away: away ? { ...away, modelWinProb: awayModelWinProb } : null,
          home: home ? { ...home, modelWinProb: homeModelWinProb } : null,
        };
      });

    res.json({
      currentWeek,
      selectedWeek,
      totalWeeks: 18,
      leagueName: data.settings?.name || 'My Fantasy League',
      matchups,
      formulaConfig,
    });
  } catch (e) {
    console.error('Matchups-detailed error:', e);
    res.status(500).json({ error: e.message });
  }
});

// --- ESPN: Free Agents & Waiver Wire Advisor ---
app.get('/api/espn/waiver-advisor', async (req, res) => {
  try {
    if (!config.leagueId || !config.swid || !config.espn_s2) {
      return res.status(400).json({ error: 'Missing ESPN credentials in config.json.' });
    }

    const formulaConfig = getFormulaConfig();
    const selectedWeek = req.query.week ? parseInt(req.query.week, 10) : 1;

    if (formulaConfig.tuning?.useKalshiMarketData) {
      try {
        await fetchKalshiNFLMarkets();
      } catch (kErr) {
        console.warn('Kalshi market fetch error:', kErr.message);
      }
    }

    // 1. Fetch NFL opponents
    const nflOpponents = {};
    try {
      const sbRes = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${selectedWeek}`
      );
      if (sbRes.ok) {
        const sbData = await sbRes.json();
        for (const ev of (sbData.events || [])) {
          const competitors = ev.competitions?.[0]?.competitors || [];
          if (competitors.length === 2) {
            const t1 = competitors[0].team?.abbreviation;
            const t2 = competitors[1].team?.abbreviation;
            if (t1 && t2) {
              nflOpponents[t1] = t2;
              nflOpponents[t2] = t1;
            }
          }
        }
      }
    } catch (e) {}

    // 2. Fetch User's team roster
    const teamUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${config.season}/segments/0/leagues/${config.leagueId}?scoringPeriodId=${selectedWeek}&view=mRoster&view=mTeam`;
    const teamRes = await fetch(teamUrl, {
      headers: { Cookie: `SWID=${config.swid}; espn_s2=${config.espn_s2}` },
    });
    const teamData = await teamRes.json();
    const myTeam = (teamData.teams || []).find((t) => isMyTeam(t, config));

    const myStartersByPos = {};
    const myBenchByPos = {};

    for (const e of (myTeam?.roster?.entries || [])) {
      const p = e.playerPoolEntry?.player;
      if (!p) continue;
      const pos = POSITION_MAP[p.defaultPositionId] || 'FLEX';
      const nflTeam = PRO_TEAM_MAP[p.proTeamId] || 'FA';
      const slot = LINEUP_SLOT_MAP[e.lineupSlotId] || 'BE';
      const projStat = (p.stats || []).find(
        (s) => s.scoringPeriodId === selectedWeek && s.statSourceId === 1
      );
      const proj = projectPlayer({
        name: p.fullName,
        position: pos,
        nflTeam,
        opponentTeam: nflOpponents[nflTeam] || 'OPP',
        injuryStatus: p.injuryStatus,
        espnAppliedTotal: projStat?.appliedTotal,
        espnRawStats: projStat?.stats || {},
        formulaConfig,
      });
      const card = {
        name: p.fullName,
        pos,
        slot,
        nflTeam,
        espnProj: proj.espnProj,
        ourProj: proj.ourProj,
      };

      if (slot === 'BE' || slot === 'IR') {
        if (!myBenchByPos[pos]) myBenchByPos[pos] = [];
        myBenchByPos[pos].push(card);
      } else {
        if (!myStartersByPos[pos]) myStartersByPos[pos] = [];
        myStartersByPos[pos].push(card);
      }
    }

    // 3. Fetch Sleeper trending adds for velocity & momentum
    let sleeperTrending = [];
    try {
      const tRes = await fetch(
        'https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=40'
      );
      if (tRes.ok) sleeperTrending = await tRes.json();
    } catch (e) {}
    const sleeperDict = await getSleeperPlayers();
    const trendingMap = {};
    for (const t of sleeperTrending) {
      const sp = sleeperDict[t.player_id];
      if (sp?.full_name) {
        trendingMap[sp.full_name.toLowerCase()] = t.count;
      }
    }

    // 4. Fetch ESPN free agents / waiver players
    const faUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${config.season}/segments/0/leagues/${config.leagueId}?scoringPeriodId=${selectedWeek}&view=kona_player_info`;
    const faRes = await fetch(faUrl, {
      headers: {
        Cookie: `SWID=${config.swid}; espn_s2=${config.espn_s2}`,
        'X-Fantasy-Filter': JSON.stringify({
          players: {
            filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
            limit: 150,
            sortPercOwned: { sortAsc: false, sortPriority: 1 },
          },
        }),
      },
    });
    const faData = await faRes.json();

    const freeAgents = [];
    const starterUpgrades = [];
    const benchUpgrades = [];

    for (const entry of (faData.players || [])) {
      const p = entry.player;
      const pos = POSITION_MAP[p.defaultPositionId] || 'FLEX';
      const nflTeam = PRO_TEAM_MAP[p.proTeamId] || 'FA';
      const oppTeam = nflOpponents[nflTeam] || 'BYE';
      const projStat = (p.stats || []).find(
        (s) => s.scoringPeriodId === selectedWeek && s.statSourceId === 1
      );

      const proj = projectPlayer({
        name: p.fullName,
        position: pos,
        nflTeam,
        opponentTeam: oppTeam,
        injuryStatus: p.injuryStatus,
        espnAppliedTotal: projStat ? projStat.appliedTotal : null,
        espnRawStats: projStat ? projStat.stats : {},
        formulaConfig,
      });

      const trendCount = trendingMap[p.fullName.toLowerCase()] || 0;
      const ownPct = Math.round((p.ownership?.percentOwned || 0) * 10) / 10;

      const faCard = {
        id: p.id,
        name: p.fullName,
        pos,
        nflTeam,
        oppTeam,
        injuryStatus: p.injuryStatus || 'HEALTHY',
        status: entry.status, // 'FREEAGENT' vs 'WAIVERS'
        ownership: ownPct,
        espnProj: proj.espnProj,
        ourProj: proj.ourProj,
        delta: proj.delta,
        hasKalshiSignal: proj.hasKalshiSignal,
        kalshiMarket: proj.kalshiMarket,
        range: proj.range,
        breakdown: proj.breakdown,
        trendingAdds: trendCount,
      };
      freeAgents.push(faCard);

      // Check Starter Upgrades
      const starters = myStartersByPos[pos] || [];
      for (const st of starters) {
        if (proj.ourProj > st.ourProj + 0.8) {
          starterUpgrades.push({
            pos,
            fa: faCard,
            current: st,
            edge: Math.round((proj.ourProj - st.ourProj) * 10) / 10,
            reason: `Model projects ${faCard.name} for ${proj.ourProj} pts vs ${st.name} (${st.ourProj} pts).`,
          });
        }
      }

      // Check Bench Upgrades
      const bench = myBenchByPos[pos] || [];
      for (const bn of bench) {
        if (proj.ourProj > bn.ourProj + 1.0) {
          benchUpgrades.push({
            pos,
            fa: faCard,
            current: bn,
            edge: Math.round((proj.ourProj - bn.ourProj) * 10) / 10,
            reason: `Model projects ${faCard.name} for ${proj.ourProj} pts vs bench ${bn.name} (${bn.ourProj} pts).`,
          });
        }
      }
    }

    // Sort upgrades by highest edge
    starterUpgrades.sort((a, b) => b.edge - a.edge);
    benchUpgrades.sort((a, b) => b.edge - a.edge);

    // 5. End-of-week waiver wire priority radar
    // Calculate a composite priority score based on:
    // Model projection + Trending pickup surge + Ownership upside
    const waiverRadar = freeAgents
      .filter((fa) => fa.pos !== 'QB' || fa.ourProj >= 15.0) // filter out low-tier streaming QBs
      .map((fa) => {
        const trendScore = Math.min(40, (fa.trendingAdds / 1000) * 2.5);
        const projScore = fa.ourProj * 3.5;
        const ownScore = fa.ownership > 70 ? 20 : (fa.ownership > 30 ? 15 : 10);
        const totalScore = Math.round(trendScore + projScore + ownScore);

        let priorityTier = 'Tier 3: Speculative Upside Stash';
        if (totalScore >= 65 || fa.trendingAdds > 8000 || fa.ourProj >= 10.5) {
          priorityTier = 'Tier 1: High-Priority Must-Add';
        } else if (totalScore >= 48 || fa.trendingAdds > 3000 || fa.ourProj >= 9.0) {
          priorityTier = 'Tier 2: High-Floor Spot Start';
        }

        return {
          ...fa,
          priorityTier,
          priorityScore: totalScore,
        };
      })
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 15);

    res.json({
      myTeamName: myTeam?.name || 'My Team',
      selectedWeek,
      starterUpgrades: starterUpgrades.slice(0, 8),
      benchUpgrades: benchUpgrades.slice(0, 8),
      waiverRadar,
      freeAgents: freeAgents.sort((a, b) => b.ourProj - a.ourProj),
    });
  } catch (e) {
    console.error('Waiver advisor error:', e);
    res.status(500).json({ error: e.message });
  }
});

// --- ESPN: start/sit — your own roster with lineup slots ---
app.get('/api/espn/startsit', async (req, res) => {
  try {
    if (!config.leagueId || !config.swid || !config.espn_s2) {
      return res.status(400).json({ error: 'Missing ESPN credentials in config.json.' });
    }
    const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${config.season}/segments/0/leagues/${config.leagueId}?view=mRoster&view=mTeam&view=mStatus`;
    const r = await fetch(url, { headers: { Cookie: `SWID=${config.swid}; espn_s2=${config.espn_s2}` } });
    if (!r.ok) return res.status(r.status).json({ error: `ESPN returned HTTP ${r.status}` });
    const data = await r.json();
    const currentWeek = data.scoringPeriodId;
    const myTeam = (data.teams || []).find((t) => isMyTeam(t, config));
    if (!myTeam) return res.status(404).json({ error: 'Could not find your team in this league — check swid.' });
    const findPoints = (stats, scoringPeriodId, statSourceId, seasonId) => {
      const entry = (stats || []).find(
        (s) => s.scoringPeriodId === scoringPeriodId && s.statSourceId === statSourceId && s.seasonId === seasonId
      );
      return entry ? Math.round(entry.appliedTotal * 10) / 10 : null;
    };
    const roster = (myTeam.roster.entries || [])
      .map((e) => {
        const p = e.playerPoolEntry.player;
        return {
          slot: LINEUP_SLOT_MAP[e.lineupSlotId] || e.lineupSlotId,
          name: p.fullName,
          pos: POSITION_MAP[p.defaultPositionId] || p.defaultPositionId,
          nflTeam: PRO_TEAM_MAP[p.proTeamId] || p.proTeamId,
          injuryStatus: p.injuryStatus,
          projPtsThisWeek: findPoints(p.stats, currentWeek, 1, config.season),
        };
      })
      .sort((a, b) => (a.slot === 'BE' ? 1 : 0) - (b.slot === 'BE' ? 1 : 0));
    res.json({ currentWeek, team: myTeam.name, roster });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- nflverse: historical roster CSV ---
function parseCSVLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

app.get('/api/nflverse/roster', async (req, res) => {
  try {
    const season = req.query.season || 2025;
    const team = (req.query.team || '').toUpperCase();
    const r = await fetch(
      `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`
    );
    if (!r.ok) {
      return res.status(r.status).json({ error: `nflverse returned HTTP ${r.status}` });
    }
    const text = await r.text();
    const lines = text.split('\n').filter(Boolean);
    const headers = parseCSVLine(lines[0]);
    const cols = ['team', 'position', 'full_name', 'jersey_number', 'status', 'college'];
    const idx = Object.fromEntries(cols.map((c) => [c, headers.indexOf(c)]));
    const teamIdx = idx.team;
    const rows = lines
      .slice(1)
      .map(parseCSVLine)
      .filter((r) => !team || r[teamIdx] === team)
      .slice(0, 60)
      .map((r) => Object.fromEntries(cols.map((c) => [c, r[idx[c]] || ''])));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Post-Week Model Learnings & Factor Attribution ---
app.get('/api/learnings/analysis', async (req, res) => {
  try {
    if (!config.leagueId || !config.swid || !config.espn_s2) {
      return res.status(400).json({ error: 'Missing ESPN credentials.' });
    }
    const week = req.query.week ? parseInt(req.query.week, 10) : 1;
    const simulated = req.query.simulated === 'true';
    const formulaConfig = getFormulaConfig();

    const espnUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${config.season}/segments/0/leagues/${config.leagueId}?scoringPeriodId=${week}&view=mMatchup&view=mMatchupScore&view=mRoster&view=mTeam&view=mSettings&view=mStatus`;
    const espnRes = await fetch(espnUrl, {
      headers: { Cookie: `SWID=${config.swid}; espn_s2=${config.espn_s2}` },
    });
    if (!espnRes.ok) return res.status(espnRes.status).json({ error: `ESPN HTTP ${espnRes.status}` });
    const data = await espnRes.json();

    const forceRefresh = req.query.refresh === 'true';
    if (formulaConfig.tuning?.useKalshiMarketData) {
      try { await fetchKalshiNFLMarkets(forceRefresh); } catch (e) {}
    }

    const allPlayers = [];
    const teamMap = Object.fromEntries((data.teams || []).map((t) => [t.id, t]));

    for (const s of (data.schedule || []).filter((m) => m.matchupPeriodId === week)) {
      for (const half of [s.away, s.home]) {
        if (!half?.teamId) continue;
        const team = teamMap[half.teamId] || {};
        const entries = half.rosterForCurrentScoringPeriod?.entries || team.roster?.entries || [];
        for (const e of entries) {
          const p = e.playerPoolEntry?.player;
          if (!p) continue;
          const pos = POSITION_MAP[p.defaultPositionId] || 'FLEX';
          const nflTeam = PRO_TEAM_MAP[p.proTeamId] || 'FA';
          const projStat = (p.stats || []).find((st) => st.scoringPeriodId === week && st.statSourceId === 1);
          const actualStat = (p.stats || []).find((st) => st.scoringPeriodId === week && st.statSourceId === 0);

          const proj = projectPlayer({
            name: p.fullName,
            position: pos,
            nflTeam,
            opponentTeam: 'OPP',
            injuryStatus: p.injuryStatus,
            espnAppliedTotal: projStat?.appliedTotal,
            espnRawStats: projStat?.stats || {},
            formulaConfig,
          });

          allPlayers.push({
            id: p.id,
            name: p.fullName,
            pos,
            nflTeam,
            oppTeam: 'OPP',
            injuryStatus: p.injuryStatus || 'HEALTHY',
            espnProj: proj.espnProj,
            ourProj: proj.ourProj,
            delta: proj.delta,
            hasKalshiSignal: proj.hasKalshiSignal,
            kalshiMarket: proj.kalshiMarket,
            actual: actualStat ? Math.round(actualStat.appliedTotal * 10) / 10 : null,
            breakdown: proj.breakdown,
            activeFactors: proj.activeFactors,
          });
        }
      }
    }

    const analysis = analyzeWeekPerformance({
      week,
      matchupPlayers: allPlayers,
      formulaConfig,
      simulated,
    });

    res.json(analysis);
  } catch (err) {
    console.error('Learnings analysis error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/learnings/apply-recommendations', (req, res) => {
  try {
    const { suggestedTuning } = req.body || {};
    if (!suggestedTuning) return res.status(400).json({ error: 'Missing suggestedTuning.' });
    const current = getFormulaConfig();
    const merged = {
      ...current,
      tuning: {
        ...current.tuning,
        ...suggestedTuning,
      },
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(formulaPath, JSON.stringify(merged, null, 2), 'utf8');
    res.json({ ok: true, config: merged });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Fantasy data explorer running at http://localhost:${PORT}`);
});
