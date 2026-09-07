/**
 * 6-Stage Fantasy Football Projection Engine
 * Computes model projections, floor/ceiling ranges, and side-by-side comparisons
 * with ESPN projections based on configurable weekly formula parameters.
 */

const { getKalshiPlayerSignal } = require('./kalshiService');
const { getPlayerMomentum } = require('./learningEngine');

// Positional benchmarks for Bayesian shrinkage and typical efficiency
const POSITION_BASELINES = {
  QB: { ypa: 7.15, compPct: 0.645, passTdPct: 0.045, intPct: 0.021, ypc: 5.2 },
  RB: { catchRate: 0.76, ypr: 7.8, ypc: 4.25, rzTouchConversion: 0.21 },
  WR: { catchRate: 0.635, ypr: 12.8, ypc: 5.5, rzTouchConversion: 0.22 },
  TE: { catchRate: 0.69, ypr: 10.4, ypc: 3.5, rzTouchConversion: 0.24 },
  K: { fgPct: 0.84, patPct: 0.96 },
  'D/ST': { baselinePts: 6.5 },
};

// Defensive strength multiplier estimates by team (DVOA / EPA proxies)
// > 1.0 means opponent allows more production (softer defense)
// < 1.0 means opponent is stingy (tougher defense)
const TEAM_DEFENSE_PROFILES = {
  ARI: { pass: 1.08, rush: 1.10 },
  ATL: { pass: 0.98, rush: 1.02 },
  BAL: { pass: 0.92, rush: 0.88 },
  BUF: { pass: 0.94, rush: 0.95 },
  CAR: { pass: 1.12, rush: 1.15 },
  CHI: { pass: 0.96, rush: 0.92 },
  CIN: { pass: 1.04, rush: 1.06 },
  CLE: { pass: 0.90, rush: 0.91 },
  DAL: { pass: 0.95, rush: 1.02 },
  DEN: { pass: 0.91, rush: 0.96 },
  DET: { pass: 1.02, rush: 0.86 },
  GB:  { pass: 0.97, rush: 0.98 },
  HOU: { pass: 0.93, rush: 0.94 },
  IND: { pass: 1.05, rush: 1.04 },
  JAX: { pass: 1.09, rush: 1.01 },
  KC:  { pass: 0.89, rush: 0.93 },
  LAC: { pass: 0.95, rush: 0.94 },
  LAR: { pass: 1.02, rush: 1.03 },
  LV:  { pass: 1.04, rush: 1.05 },
  MIA: { pass: 1.01, rush: 1.02 },
  MIN: { pass: 0.95, rush: 0.92 },
  NE:  { pass: 0.98, rush: 0.96 },
  NO:  { pass: 0.97, rush: 0.99 },
  NYG: { pass: 1.06, rush: 1.08 },
  NYJ: { pass: 0.88, rush: 0.92 },
  PHI: { pass: 0.94, rush: 0.95 },
  PIT: { pass: 0.93, rush: 0.89 },
  SEA: { pass: 1.02, rush: 1.04 },
  SF:  { pass: 0.91, rush: 0.89 },
  TB:  { pass: 1.05, rush: 0.94 },
  TEN: { pass: 1.03, rush: 0.96 },
  WAS: { pass: 1.10, rush: 1.08 },
};

/**
 * Score a raw stat dictionary against specific league scoring rules.
 */
function scoreRawStats(rawStats, scoringConfig) {
  const w = scoringConfig || {};
  const isFractional = w.fractionalYardage !== false;

  const recPts = (rawStats.receptions || 0) * (w.receptions ?? 1.0);
  const recYards = rawStats.recYards || 0;
  const recYdPts = isFractional
    ? (recYards / (w.recYardsPerPt || 10.0))
    : Math.floor(recYards / (w.recYardsPerPt || 10.0));

  const rushYards = rawStats.rushYards || 0;
  const rushYdPts = isFractional
    ? (rushYards / (w.rushYardsPerPt || 10.0))
    : Math.floor(rushYards / (w.rushYardsPerPt || 10.0));

  const passYards = rawStats.passYards || 0;
  const passYdPts = isFractional
    ? (passYards / (w.passYardsPerPt || 25.0))
    : Math.floor(passYards / (w.passYardsPerPt || 25.0));

  const passTdPts = (rawStats.passTD || 0) * (w.passTD ?? 4.0);
  const rushTdPts = (rawStats.rushTD || 0) * (w.rushTD ?? 6.0);
  const recTdPts = (rawStats.recTD || 0) * (w.recTD ?? 6.0);
  const intPts = (rawStats.interceptions || 0) * (w.interception ?? -2.0);
  const fumblePts = (rawStats.fumblesLost || 0) * (w.fumbleLost ?? -2.0);
  const twoPtPts = (rawStats.twoPt || 0) * (w.twoPt ?? 2.0);

  // Kicker and Defense raw contributions if present
  const kickPts = (rawStats.kickingPoints || 0);
  const dstPts = (rawStats.defensePoints || 0);

  return (
    recPts +
    recYdPts +
    rushYdPts +
    passYdPts +
    passTdPts +
    rushTdPts +
    recTdPts +
    intPts +
    fumblePts +
    twoPtPts +
    kickPts +
    dstPts
  );
}

/**
 * Projects a single player considering all 6 stages and formula tuners.
 */
function projectPlayer({
  name,
  position,
  nflTeam,
  opponentTeam,
  injuryStatus,
  espnAppliedTotal,
  espnRawStats = {},
  formulaConfig,
  gameContext = {},
}) {
  const scoring = formulaConfig.scoring || {};
  const tuning = formulaConfig.tuning || {};

  // Analytical Feature Toggles (default to true)
  const enableMatchup = tuning.enableMatchupAdjustments !== false;
  const enableInjuryDiscount = tuning.enableInjuryRiskDiscount !== false;
  const enablePace = tuning.enablePaceModifier !== false;
  const enablexTD = tuning.enableExpectedTDScaling !== false;
  const enableScript = tuning.enableGameScript !== false;
  const enableShrinkage = tuning.enableBayesianShrinkage !== false;
  const enableMomentum = tuning.enablePlayerMomentum !== false;

  // Kalshi Market Toggles
  const useKalshi = tuning.useKalshiMarketData === true;
  const useKalshiPass = useKalshi && tuning.useKalshiPassingYards !== false;
  const useKalshiRec = useKalshi && tuning.useKalshiReceivingYards !== false;
  const useKalshiRush = useKalshi && tuning.useKalshiRushingYards !== false;
  const kalshiWeight = Math.min(0.8, Math.max(0.1, tuning.kalshiWeight ?? 0.40));

  const matchupIntensity = enableMatchup ? (tuning.matchupIntensity ?? 1.0) : 0.0;
  const tdScale = enablexTD ? (tuning.tdConversionScale ?? 1.0) : 1.0;
  const scriptWeight = enableScript ? (tuning.gameScriptWeight ?? 1.0) : 1.0;
  const paceMod = enablePace ? (tuning.paceModifier ?? 1.0) : 1.0;

  // Retrieve opponent profile or default
  const oppProfile = TEAM_DEFENSE_PROFILES[opponentTeam] || { pass: 1.0, rush: 1.0 };
  const passMatchupMult = enableMatchup ? (1.0 + (oppProfile.pass - 1.0) * matchupIntensity) : 1.0;
  const rushMatchupMult = enableMatchup ? (1.0 + (oppProfile.rush - 1.0) * matchupIntensity) : 1.0;

  // Extract base numbers from ESPN's raw projections if available
  const espnPassYds = Number(espnRawStats['3'] || espnRawStats.passingYards || 0);
  const espnPassTD = Number(espnRawStats['4'] || espnRawStats.passingTouchdowns || 0);
  const espnInts = Number(espnRawStats['20'] || espnRawStats.interceptions || 0);
  const espnRushYds = Number(espnRawStats['24'] || espnRawStats.rushingYards || 0);
  const espnRushTD = Number(espnRawStats['25'] || espnRawStats.rushingTouchdowns || 0);
  const espnRecYds = Number(espnRawStats['42'] || espnRawStats.receivingYards || 0);
  const espnRecTD = Number(espnRawStats['43'] || espnRawStats.receivingTouchdowns || 0);
  const espnRec = Number(espnRawStats['53'] || espnRawStats.receptions || 0);
  const espnFumbles = Number(espnRawStats['72'] || espnRawStats.fumblesLost || 0);
  const espnTwoPt = Number(espnRawStats['62'] || espnRawStats.twoPointConversions || 0);

  let modelRawStats = {};
  let rationale = [];
  let kalshiSignal = null;
  let activeKalshiMarket = null;
  let hasKalshiSignal = false;

  if (position === 'QB') {
    // Stage 1 & 2: Adjust passing volume and efficiency by matchup & pace
    let adjPassYds = espnPassYds * passMatchupMult * paceMod;

    // Check Kalshi Prediction Market Consensus for QBs (Passing Yards)
    if (useKalshiPass) {
      kalshiSignal = getKalshiPlayerSignal(name);
      const qbMarket = kalshiSignal?.markets?.passYards || kalshiSignal?.implied;
      if (qbMarket?.expectedYards) {
        hasKalshiSignal = true;
        activeKalshiMarket = qbMarket;
        const marketYds = qbMarket.expectedYards;
        const beforeBlend = adjPassYds;
        adjPassYds = Math.round(((1 - kalshiWeight) * adjPassYds + kalshiWeight * marketYds) * 10) / 10;
        rationale.push(
          `🏛️ Kalshi Market Signal (${Math.round(kalshiWeight * 100)}% blend): Market expected ${marketYds} yds (Model was ${Math.round(beforeBlend)} yds, blended to ${adjPassYds} yds)`
        );
      }
    }

    const adjPassTD = espnPassTD * passMatchupMult * tdScale * paceMod;
    const adjInts = espnInts * (1.0 / passMatchupMult);
    const adjRushYds = espnRushYds * rushMatchupMult * paceMod;
    const adjRushTD = espnRushTD * tdScale * paceMod;

    modelRawStats = {
      passYards: adjPassYds,
      passTD: adjPassTD,
      interceptions: adjInts,
      rushYards: adjRushYds,
      rushTD: adjRushTD,
      receptions: 0,
      recYards: 0,
      recTD: 0,
      fumblesLost: espnFumbles,
      twoPt: espnTwoPt,
    };

    if (enableMatchup) {
      if (passMatchupMult > 1.02) {
        rationale.push(`Favorable pass matchup vs ${opponentTeam} (+${Math.round((passMatchupMult - 1) * 100)}% pass efficiency)`);
      } else if (passMatchupMult < 0.98) {
        rationale.push(`Tough pass defense in ${opponentTeam} (-${Math.round((1 - passMatchupMult) * 100)}% pass efficiency)`);
      }
    }
  } else if (position === 'RB') {
    // Stage 3 & 4: Rushing and receiving workload with opponent EPA
    let adjRushYds = espnRushYds * rushMatchupMult * paceMod;
    let adjRushTD = espnRushTD * rushMatchupMult * tdScale * paceMod;
    let adjRec = espnRec * passMatchupMult * paceMod;
    let adjRecYds = espnRecYds * passMatchupMult * paceMod;
    let adjRecTD = espnRecTD * tdScale * paceMod;

    // Check Kalshi Prediction Market for RBs (Rushing+Receiving or Receiving)
    if (useKalshiRush || useKalshiRec) {
      kalshiSignal = getKalshiPlayerSignal(name);
      const rushRecMarket = useKalshiRush ? kalshiSignal?.markets?.rushRecYards : null;
      const recMarket = useKalshiRec ? kalshiSignal?.markets?.recYards : null;

      if (rushRecMarket?.expectedYards) {
        hasKalshiSignal = true;
        activeKalshiMarket = rushRecMarket;
        const marketYds = rushRecMarket.expectedYards;
        const totalModelYards = adjRushYds + adjRecYds;
        const blendTotal = Math.round(((1 - kalshiWeight) * totalModelYards + kalshiWeight * marketYds) * 10) / 10;
        if (totalModelYards > 0) {
          const scaleFactor = blendTotal / totalModelYards;
          adjRushYds = Math.round(adjRushYds * scaleFactor * 10) / 10;
          adjRecYds = Math.round(adjRecYds * scaleFactor * 10) / 10;
        }
        rationale.push(
          `🏛️ Kalshi Scrimmage Market (${Math.round(kalshiWeight * 100)}% blend): Market expected ${marketYds} scrimmage yds (blended to ${blendTotal} yds)`
        );
      } else if (recMarket?.expectedYards) {
        hasKalshiSignal = true;
        activeKalshiMarket = recMarket;
        const marketYds = recMarket.expectedYards;
        const beforeBlend = adjRecYds;
        adjRecYds = Math.round(((1 - kalshiWeight) * adjRecYds + kalshiWeight * marketYds) * 10) / 10;
        rationale.push(
          `🏛️ Kalshi Receiving Market (${Math.round(kalshiWeight * 100)}% blend): Market expected ${marketYds} rec yds (Model was ${Math.round(beforeBlend)} yds, blended to ${adjRecYds} yds)`
        );
      }
    }

    modelRawStats = {
      passYards: 0,
      passTD: 0,
      interceptions: 0,
      rushYards: adjRushYds,
      rushTD: adjRushTD,
      receptions: adjRec,
      recYards: adjRecYds,
      recTD: adjRecTD,
      fumblesLost: espnFumbles,
      twoPt: espnTwoPt,
    };

    if (enableMatchup) {
      if (rushMatchupMult > 1.02) {
        rationale.push(`Strong run matchup vs ${opponentTeam} (+${Math.round((rushMatchupMult - 1) * 100)}% ground efficiency)`);
      } else if (rushMatchupMult < 0.98) {
        rationale.push(`Stout run front vs ${opponentTeam} (-${Math.round((1 - rushMatchupMult) * 100)}% ground efficiency)`);
      }
    }
  } else if (position === 'WR' || position === 'TE') {
    // Stage 3 & 4: Air yards, target share, catch rate
    let adjRec = espnRec * passMatchupMult * paceMod;
    let adjRecYds = espnRecYds * passMatchupMult * paceMod;
    let adjRecTD = espnRecTD * passMatchupMult * tdScale * paceMod;
    let adjRushYds = espnRushYds * rushMatchupMult;
    let adjRushTD = espnRushTD * tdScale;

    // Check Kalshi Prediction Market for WRs / TEs (Receiving Yards)
    if (useKalshiRec) {
      kalshiSignal = getKalshiPlayerSignal(name);
      const recMarket = kalshiSignal?.markets?.recYards || kalshiSignal?.implied;
      if (recMarket?.expectedYards) {
        hasKalshiSignal = true;
        activeKalshiMarket = recMarket;
        const marketYds = recMarket.expectedYards;
        const beforeBlend = adjRecYds;
        adjRecYds = Math.round(((1 - kalshiWeight) * adjRecYds + kalshiWeight * marketYds) * 10) / 10;
        rationale.push(
          `🏛️ Kalshi Receiving Market (${Math.round(kalshiWeight * 100)}% blend): Market expected ${marketYds} rec yds (Model was ${Math.round(beforeBlend)} yds, blended to ${adjRecYds} yds)`
        );
      }
    }

    modelRawStats = {
      passYards: 0,
      passTD: 0,
      interceptions: 0,
      rushYards: adjRushYds,
      rushTD: adjRushTD,
      receptions: adjRec,
      recYards: adjRecYds,
      recTD: adjRecTD,
      fumblesLost: espnFumbles,
      twoPt: espnTwoPt,
    };

    if (enableMatchup) {
      if (passMatchupMult > 1.02) {
        rationale.push(`Vulnerable secondary in ${opponentTeam} (+${Math.round((passMatchupMult - 1) * 100)}% rec boost)`);
      } else if (passMatchupMult < 0.98) {
        rationale.push(`Shadow/tight coverage expected vs ${opponentTeam} (-${Math.round((1 - passMatchupMult) * 100)}%)`);
      }
    }
  } else if (position === 'K') {
    // Kicker model scales with team total and efficiency
    const baseK = espnAppliedTotal != null ? espnAppliedTotal : 7.5;
    const adjK = baseK * paceMod;
    modelRawStats = { kickingPoints: adjK };
  } else if (position === 'D/ST') {
    // Defense model scales inversely with opponent offensive strength
    const baseDst = (!enableMatchup && espnAppliedTotal != null)
      ? espnAppliedTotal
      : ((espnAppliedTotal && espnAppliedTotal > 0) ? espnAppliedTotal : 6.5);
    const adjDst = baseDst * (1.0 / passMatchupMult);
    modelRawStats = { defensePoints: adjDst };
    if (enableMatchup && passMatchupMult > 1.04) {
      rationale.push(`High-powered opposing offense caps defensive upside.`);
    }
  } else {
    // Fallback for IDP or flex
    modelRawStats = {
      rushYards: espnRushYds,
      rushTD: espnRushTD,
      receptions: espnRec,
      recYards: espnRecYds,
      recTD: espnRecTD,
      fumblesLost: espnFumbles,
      twoPt: espnTwoPt,
    };
  }

  // Injury discount if designated Questionable or Doubtful
  let injuryFactor = 1.0;
  if (enableInjuryDiscount) {
    if (injuryStatus === 'QUESTIONABLE') {
      injuryFactor = 0.92;
      rationale.push('Limited upside due to Questionable tag (-8% risk factor)');
    } else if (injuryStatus === 'DOUBTFUL') {
      injuryFactor = 0.40;
      rationale.push('High scratch risk (Doubtful)');
    } else if (injuryStatus === 'OUT' || injuryStatus === 'INJURY_RESERVE') {
      injuryFactor = 0.0;
      rationale.push('Player is ruled Out');
    }
  } else {
    if (injuryStatus === 'OUT' || injuryStatus === 'INJURY_RESERVE') {
      injuryFactor = 0.0;
      rationale.push('Player is ruled Out');
    } else if (injuryStatus === 'QUESTIONABLE' || injuryStatus === 'DOUBTFUL') {
      rationale.push(`Injury discount disabled (evaluated at full healthy ceiling for ${injuryStatus} tag)`);
    }
  }

  // Stage 6: Scoring Engine conversion & Relative Adjustment Scaling
  const baselineRawStats = {
    passYards: espnPassYds,
    passTD: espnPassTD,
    interceptions: espnInts,
    rushYards: espnRushYds,
    rushTD: espnRushTD,
    receptions: espnRec,
    recYards: espnRecYds,
    recTD: espnRecTD,
    fumblesLost: espnFumbles,
    twoPt: espnTwoPt,
    kickingPoints: position === 'K' ? (espnAppliedTotal != null ? espnAppliedTotal : 7.5) : 0,
    defensePoints: position === 'D/ST' ? (espnAppliedTotal != null ? espnAppliedTotal : 0) : 0,
  };

  const baseRawScore = scoreRawStats(baselineRawStats, scoring);
  const adjRawScore = scoreRawStats(modelRawStats, scoring);

  // Model stat multiplier (from matchups, Kalshi, pace, xTD, etc.)
  let statMultiplier = 1.0;
  if (baseRawScore > 0 && adjRawScore > 0) {
    statMultiplier = adjRawScore / baseRawScore;
  }

  // Anchor to ESPN's official league applied projection if available; otherwise use model raw score
  let basePoints;
  if (espnAppliedTotal != null) {
    if (espnAppliedTotal === 0 && position === 'D/ST' && enableMatchup) {
      basePoints = adjRawScore; // Use defense baseline if ESPN has unpopulated 0 for DST
    } else {
      basePoints = espnAppliedTotal * statMultiplier;
    }
  } else {
    basePoints = adjRawScore;
  }
  
  // Rolling Player Momentum / Form Factor
  const playerMomentum = enableMomentum ? getPlayerMomentum(name) : null;
  let momentumFactor = 1.0;
  if (playerMomentum && playerMomentum.multiplier) {
    momentumFactor = playerMomentum.multiplier;
    if (playerMomentum.status === 'SURGING') {
      rationale.push(`🔥 Momentum Surge (+${Math.round((momentumFactor - 1) * 100)}%): ${playerMomentum.reason}`);
    } else if (playerMomentum.status === 'FADING') {
      rationale.push(`🧊 Role Fade (-${Math.round((1 - momentumFactor) * 100)}%): ${playerMomentum.reason}`);
    }
  }

  let ourProjectedPoints = basePoints * injuryFactor * momentumFactor;

  const espnProj = espnAppliedTotal != null ? Math.round(espnAppliedTotal * 10) / 10 : 0.0;
  const ourProj = Math.round(ourProjectedPoints * 10) / 10;
  const delta = Math.round((ourProj - espnProj) * 10) / 10;

  // Stage 7: Floor / Ceiling distributions
  const volatility = position === 'QB' ? 0.30 : (position === 'K' || position === 'D/ST' ? 0.38 : 0.45);
  const stdDev = ourProj * volatility;
  let floor = Math.max(0, Math.round((ourProj - 1.15 * stdDev) * 10) / 10);
  let ceiling = Math.round((ourProj + 1.25 * stdDev) * 10) / 10;

  // If Kalshi market strikes are active, calibrate floor and ceiling to true market strikes!
  if (hasKalshiSignal && activeKalshiMarket) {
    const ydPerPt = (position === 'QB' ? scoring.passYardsPerPt : (scoring.rushYardsPerPt || 10.0)) || 10.0;
    const deltaFloorPts = (activeKalshiMarket.floorYards - activeKalshiMarket.expectedYards) / ydPerPt;
    const deltaCeilingPts = (activeKalshiMarket.ceilingYards - activeKalshiMarket.expectedYards) / ydPerPt;
    floor = Math.max(0, Math.round((ourProj + deltaFloorPts) * 10) / 10);
    ceiling = Math.round((ourProj + deltaCeilingPts) * 10) / 10;
  }

  return {
    name,
    position,
    nflTeam,
    opponentTeam,
    injuryStatus,
    espnProj,
    ourProj,
    delta,
    hasKalshiSignal,
    kalshiMarket: hasKalshiSignal && activeKalshiMarket ? {
      ...activeKalshiMarket,
      marketType: activeKalshiMarket.categoryLabel || 'Player Prop',
    } : null,
    momentum: playerMomentum ? {
      status: playerMomentum.status,
      multiplier: playerMomentum.multiplier,
      diffPts: playerMomentum.diffPts,
      reason: playerMomentum.reason,
    } : null,
    range: { floor, median: ourProj, ceiling },
    breakdown: {
      passYards: Math.round((modelRawStats.passYards || 0) * 10) / 10,
      passTD: Math.round((modelRawStats.passTD || 0) * 100) / 100,
      interceptions: Math.round((modelRawStats.interceptions || 0) * 100) / 100,
      carries: Math.round((Number(espnRawStats['23'] || 0) * rushMatchupMult) * 10) / 10,
      rushYards: Math.round((modelRawStats.rushYards || 0) * 10) / 10,
      rushTD: Math.round((modelRawStats.rushTD || 0) * 100) / 100,
      targets: Math.round((Number(espnRawStats['58'] || 0) * passMatchupMult) * 10) / 10,
      receptions: Math.round((modelRawStats.receptions || 0) * 10) / 10,
      recYards: Math.round((modelRawStats.recYards || 0) * 10) / 10,
      recTD: Math.round((modelRawStats.recTD || 0) * 100) / 100,
      matchupMultiplier: position === 'RB' ? rushMatchupMult : passMatchupMult,
      rationale: rationale.length ? rationale : ['Standard baseline projection alignment.'],
    },
    activeFactors: {
      matchup: enableMatchup,
      injuryDiscount: enableInjuryDiscount,
      pace: enablePace,
      expectedTD: enablexTD,
      gameScript: enableScript,
      momentum: enableMomentum && !!playerMomentum,
      kalshi: hasKalshiSignal,
    },
  };
}

module.exports = {
  projectPlayer,
  scoreRawStats,
  TEAM_DEFENSE_PROFILES,
};
