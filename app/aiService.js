/**
 * AI Service for Fantasy Football Projection Lab
 * Communicates with Google Generative Language API (Gemini).
 */

const DEFAULT_MODEL = 'gemini-3.5-flash';

/**
 * Make a request to the Gemini generateContent REST endpoint.
 */
async function callGemini({ apiKey, model = DEFAULT_MODEL, contents, systemInstruction, temperature = 0.4, maxTokens = 1000 }) {
  if (!apiKey) {
    throw new Error('Google Gemini API key is missing. Configure it in the AI Scout setup.');
  }

  const activeModel = model || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(activeModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errorDetail = '';
    try {
      const errJson = await res.json();
      errorDetail = errJson.error?.message || JSON.stringify(errJson);
    } catch (_) {
      errorDetail = `HTTP ${res.status} ${res.statusText}`;
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Gemini Authentication Failed: ${errorDetail}. Please check your API key from Google AI Studio.`);
    } else if (res.status === 429) {
      throw new Error(`Gemini Free Tier Rate Limit reached. Please wait a minute and retry.`);
    } else if (res.status === 404) {
      throw new Error(`Gemini model "${activeModel}" not found. Error: ${errorDetail}`);
    } else {
      throw new Error(`Gemini API error (${res.status}): ${errorDetail}`);
    }
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate || !candidate.content?.parts?.length) {
    throw new Error('Gemini returned an empty response. Please try again.');
  }

  return candidate.content.parts.map((p) => p.text).join('\n');
}

/**
 * Query Google Generative Language API for models accessible with this API key.
 */
async function listAvailableModels(apiKey) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) return [];
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({
        id: m.name.replace(/^models\//, ''),
        displayName: m.displayName || m.name.replace(/^models\//, ''),
        description: m.description || '',
      }))
      .filter((m) => !m.id.includes('deprecated') && !m.id.includes('legacy') && !m.id.includes('1.5'));
  } catch (_) {
    return [];
  }
}

/**
 * Validate an API key by making a lightweight test ping.
 */
async function testGeminiKey(apiKey, model = DEFAULT_MODEL) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return { ok: false, error: 'API key is required.' };
  }

  const cleanKey = apiKey.trim();
  let activeModel = model || DEFAULT_MODEL;

  try {
    const text = await callGemini({
      apiKey: cleanKey,
      model: activeModel,
      contents: [{ role: 'user', parts: [{ text: 'Respond with the single word: "READY"' }] }],
      maxTokens: 10,
      temperature: 0.1,
    });
    return { ok: true, model: activeModel, preview: text.trim() };
  } catch (err) {
    // If deprecated or not found, try to query listAvailableModels for suggestions
    const models = await listAvailableModels(cleanKey);
    const flashModels = models.filter((m) => m.id.toLowerCase().includes('flash'));
    const suggestions = (flashModels.length ? flashModels : models).slice(0, 5).map((m) => m.id).join(', ');

    if (suggestions) {
      return {
        ok: false,
        error: `${err.message}. Recommended modern models: ${suggestions}`,
        availableModels: models,
      };
    }
    return { ok: false, error: err.message };
  }
}

/**
 * Generate a concise, high-impact scout report explaining a player's projection.
 */
async function explainPlayerProjection({ player, formulaConfig, apiKey, model = DEFAULT_MODEL }) {
  const systemInstruction = `You are an elite, analytical NFL Fantasy Football scout and quantitative analyst for the "Fantasy Football Projection Lab".
Your task is to provide a concise, sharp, high-conviction scout report explaining why our 6-Stage Analytical Model differs from the ESPN baseline projection.

Guidelines:
- Keep the response between 2 to 4 punchy paragraphs (or bulleted takeaways).
- Highlight the Delta (+/- vs ESPN) and clearly explain the key drivers (e.g., Matchup EPA/DVOA, Kalshi prediction market implied yards, Pace modifier, Expected TD regression, Momentum surge/fade, Injury discount).
- If Kalshi prediction market signals are present, highlight how the market's wisdom influenced the projection.
- Give a crisp bottom-line "Start / Sit / Flex Verdict" with realistic floor vs. ceiling expectations.
- Tone: Professional, analytical, confident, engaging (like a top-tier fantasy analyst on Twitter/The Ringer/PFF). Do NOT sound robotic.`;

  const contextPrompt = `Analyze this player projection:

Player: ${player.name} (${player.position} - ${player.nflTeam || 'NFL'} vs ${player.opponentTeam || 'OPP'})
Injury Status: ${player.injuryStatus || 'HEALTHY'}
ESPN Projected Points: ${player.espnProj}
Our Model Projected Points: ${player.ourProj}
Delta: ${player.delta > 0 ? '+' : ''}${player.delta} pts
Range: Floor ${player.range?.floor} | Median ${player.range?.median} | Ceiling ${player.range?.ceiling}

Key Model Inputs & Adjustments:
${(player.breakdown?.rationale || []).map((r) => `- ${r}`).join('\n')}

Stat Breakdown:
- Pass: ${player.breakdown?.passYards || 0} yds, ${player.breakdown?.passTD || 0} TD, ${player.breakdown?.interceptions || 0} INT
- Rush: ${player.breakdown?.carries || 0} carries, ${player.breakdown?.rushYards || 0} yds, ${player.breakdown?.rushTD || 0} TD
- Rec: ${player.breakdown?.targets || 0} targets, ${player.breakdown?.receptions || 0} rec, ${player.breakdown?.recYards || 0} yds, ${player.breakdown?.recTD || 0} TD
- Matchup Multiplier: ${player.breakdown?.matchupMultiplier || 1.0}x

Kalshi Market Signal:
${player.hasKalshiSignal && player.kalshiMarket ? JSON.stringify(player.kalshiMarket) : 'None active for this position'}

Player Momentum:
${player.momentum ? `${player.momentum.status} (${player.momentum.multiplier}x): ${player.momentum.reason}` : 'Neutral'}

Please generate a high-conviction AI Scout Breakdown. Format with bold headings or markdown bullet points for readability.`;

  return await callGemini({
    apiKey,
    model,
    systemInstruction,
    contents: [{ role: 'user', parts: [{ text: contextPrompt }] }],
    temperature: 0.35,
    maxTokens: 650,
  });
}

/**
 * Handle interactive multi-turn fantasy scout chatbot conversations.
 */
async function askScoutChat({ message, chatHistory = [], contextData = {}, apiKey, model = DEFAULT_MODEL }) {
  const systemInstruction = `You are the "AI Bench Coach & Fantasy GM", an expert analytical advisor embedded in the Fantasy Football Projection Lab.
You have direct access to the user's ESPN private league data, active roster, opponent matchup, free agent wire, Kalshi prediction markets, and the 6-stage mathematical projection model.

Your capabilities:
- Give decisive Start / Sit advice (weighing floor vs. ceiling based on whether the team is an underdog or favored).
- Explain projection differences and model rationale.
- Identify waiver wire priority targets based on team needs.
- Offer actionable matchup game theory and roster optimization tips.

Guidelines:
- Keep answers focused, clear, and actionable. Use bullet points and bold text for easy reading.
- When recommending starters, always mention the player's model projection, floor/ceiling range, and opponent.
- Always use the league context provided below as ground truth.
- Do NOT make up fictitious players or stats. If context isn't available for a specific question, state what you see clearly.`;

  const formattedHistory = (chatHistory || []).slice(-8).map((h) => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text }],
  }));

  let contextSnippet = '';
  if (contextData && Object.keys(contextData).length > 0) {
    contextSnippet = `\n--- CURRENT LEAGUE & MATCHUP CONTEXT ---\n${JSON.stringify(contextData, null, 2)}\n--- END CONTEXT ---\n\n`;
  }

  const userParts = [{ text: `${contextSnippet}User Question: ${message}` }];

  const contents = [...formattedHistory, { role: 'user', parts: userParts }];

  return await callGemini({
    apiKey,
    model,
    systemInstruction,
    contents,
    temperature: 0.45,
    maxTokens: 850,
  });
}

module.exports = {
  testGeminiKey,
  explainPlayerProjection,
  askScoutChat,
  listAvailableModels,
  DEFAULT_MODEL,
};
