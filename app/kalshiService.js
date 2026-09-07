/**
 * Kalshi Prediction Market Data Service
 * Connects to Kalshi's public read-only API to fetch active NFL player prop markets
 * across Passing Yards (KXNFLPASSYDS), Receiving Yards (KXNFLRECYDS), and Rushing+Receiving (KXNFLRRYDS).
 * Calculates market-implied expected value, median, floor, and ceiling.
 */

const KALSHI_PUBLIC_API = 'https://api.elections.kalshi.com/trade-api/v2';

// In-memory cache for market ladders (TTL: 10 minutes)
let kalshiCache = {};
let lastFetchedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

const SERIES_CONFIG = {
  KXNFLPASSYDS: { key: 'passYards', label: 'Passing Yards' },
  KXNFLRECYDS: { key: 'recYards', label: 'Receiving Yards' },
  KXNFLRRYDS: { key: 'rushRecYards', label: 'Rushing + Receiving Yards' },
};

/**
 * Normalizes player names for fuzzy matching between ESPN and Kalshi
 */
function normalizeName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Calculates market-implied distribution (expected, median, floor, ceiling) from strike ladders
 */
function calculateImpliedFromStrikes(strikes) {
  strikes.sort((a, b) => a.strike - b.strike);
  if (strikes.length < 2) {
    if (strikes.length === 1) {
      return {
        expectedYards: strikes[0].strike,
        medianYards: strikes[0].strike,
        floorYards: Math.round(strikes[0].strike * 0.85),
        ceilingYards: Math.round(strikes[0].strike * 1.15),
        totalStrikes: 1,
      };
    }
    return null;
  }

  // 1. Riemann sum over strike ladder for expected yards
  let expectedYards = strikes[0].strike;
  for (let i = 0; i < strikes.length - 1; i++) {
    const dStrike = strikes[i + 1].strike - strikes[i].strike;
    const avgP = (strikes[i].prob + strikes[i + 1].prob) / 2.0;
    expectedYards += dStrike * avgP;
  }

  // 2. Linear percentile interpolation:
  // Floor: 85% probability of exceeding
  // Median: 50% probability
  // Ceiling: 15% probability of exceeding
  const findStrikeAtProb = (targetProb) => {
    if (targetProb >= strikes[0].prob) return Math.round(strikes[0].strike * 0.85);
    const last = strikes[strikes.length - 1];
    if (targetProb <= last.prob) return Math.round(last.strike * 1.15);

    for (let i = 0; i < strikes.length - 1; i++) {
      const s1 = strikes[i], s2 = strikes[i + 1];
      if (s1.prob >= targetProb && s2.prob <= targetProb) {
        const fraction = (s1.prob - targetProb) / (s1.prob - s2.prob || 0.001);
        return Math.round(s1.strike + fraction * (s2.strike - s1.strike));
      }
    }
    return strikes[0].strike;
  };

  return {
    expectedYards: Math.round(expectedYards * 10) / 10,
    medianYards: findStrikeAtProb(0.50),
    floorYards: findStrikeAtProb(0.85),
    ceilingYards: findStrikeAtProb(0.15),
    totalStrikes: strikes.length,
  };
}

/**
 * Fetches all active NFL passing, receiving, and rushing markets from Kalshi
 */
async function fetchKalshiNFLMarkets(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && Object.keys(kalshiCache).length > 0 && (now - lastFetchedAt) < CACHE_TTL_MS) {
    return kalshiCache;
  }

  try {
    const seriesTickers = Object.keys(SERIES_CONFIG);
    const allEvents = [];

    // 1. Fetch event directories for all series
    await Promise.all(
      seriesTickers.map(async (st) => {
        try {
          const res = await fetch(`${KALSHI_PUBLIC_API}/events?series_ticker=${st}&limit=35`);
          if (!res.ok) return;
          const data = await res.json();
          for (const ev of (data.events || [])) {
            // Focus on upcoming game weeks (September 2026 or active open events)
            if (ev.event_ticker.includes('26SEP') || ev.status === 'open') {
              allEvents.push({ ...ev, seriesTicker: st });
            }
          }
        } catch (err) {
          // ignore single series failure
        }
      })
    );

    const newCache = {};

    // 2. Fetch nested market books in concurrent batches of 10
    const batchSize = 10;
    for (let i = 0; i < allEvents.length; i += batchSize) {
      const batch = allEvents.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (ev) => {
          try {
            const mRes = await fetch(`${KALSHI_PUBLIC_API}/events/${ev.event_ticker}?with_nested_markets=true`);
            if (!mRes.ok) return null;
            const mData = await mRes.json();
            return {
              seriesTicker: ev.seriesTicker,
              markets: mData.event?.markets || [],
            };
          } catch (e) {
            return null;
          }
        })
      );

      for (const item of results) {
        if (!item || !item.markets) continue;
        const conf = SERIES_CONFIG[item.seriesTicker];
        if (!conf) continue;
        const marketCategory = conf.key;

        for (const m of item.markets) {
          const parts = (m.title || '').split(':');
          if (parts.length < 2) continue;
          const playerName = parts[0].trim();
          const normKey = normalizeName(playerName);

          const strikeMatch = parts[1].match(/(\d+)\+/);
          const strike = strikeMatch
            ? parseInt(strikeMatch[1], 10)
            : (m.floor_strike ? Math.round(m.floor_strike) : null);
          if (!strike) continue;

          // Estimate probability from last_price or mid bid/ask
          let prob = null;
          const last = parseFloat(m.last_price_dollars || 0);
          const bid = parseFloat(m.yes_bid_dollars || 0);
          const ask = parseFloat(m.yes_ask_dollars || 0);

          if (bid > 0 && ask > 0) {
            prob = (bid + ask) / 2.0;
          } else if (last > 0) {
            prob = last;
          } else if (ask > 0) {
            prob = ask * 0.9;
          }

          if (prob == null || prob <= 0) continue;

          if (!newCache[normKey]) {
            newCache[normKey] = {
              playerName,
              rawStrikes: {},
              markets: {},
            };
          }

          if (!newCache[normKey].rawStrikes[marketCategory]) {
            newCache[normKey].rawStrikes[marketCategory] = [];
          }
          newCache[normKey].rawStrikes[marketCategory].push({ strike, prob });
        }
      }
    }

    // 3. Compute distributions for each player and category
    for (const [normKey, pData] of Object.entries(newCache)) {
      for (const [category, strikes] of Object.entries(pData.rawStrikes)) {
        const implied = calculateImpliedFromStrikes(strikes);
        if (implied) {
          const conf = Object.values(SERIES_CONFIG).find((c) => c.key === category);
          pData.markets[category] = {
            ...implied,
            category,
            categoryLabel: conf ? conf.label : category,
          };
        }
      }

      // Default implied alias for backward compatibility (prefer passYards -> recYards -> rushRecYards)
      pData.implied =
        pData.markets.passYards ||
        pData.markets.recYards ||
        pData.markets.rushRecYards ||
        null;
    }

    kalshiCache = newCache;
    lastFetchedAt = now;
    return kalshiCache;
  } catch (err) {
    console.error('Error fetching Kalshi markets:', err.message);
    return kalshiCache;
  }
}

/**
 * Returns Kalshi market expectation for a given player if active
 */
function getKalshiPlayerSignal(playerName) {
  const normKey = normalizeName(playerName);
  return kalshiCache[normKey] || null;
}

module.exports = {
  fetchKalshiNFLMarkets,
  getKalshiPlayerSignal,
  normalizeName,
};
