# NFL Fantasy Data Sources

Reference for building a fantasy football tool (waiver wire, trades, lineup decisions, next year's draft prep). Split into free and paid, with what each actually gives you and how much to trust it.

Pricing changes often — verify current tiers before committing to a paid one.

## Free

| Source | Access | Data Available | Accuracy / Reliability | Notes |
|---|---|---|---|---|
| [Sleeper API](https://docs.sleeper.com/) | No key needed for reads (`api.sleeper.app/v1/...`) | Full NFL player pool (IDs, team, position, status), trending adds/drops, and — if you connect a Sleeper league — rosters, drafts, matchups, transactions | High for roster/status data (Sleeper's own ops feed); no projections or rankings at all | Best free source if your league is on Sleeper. No opinion/projection layer — pair it with FantasyPros or nflverse |
| [ESPN Fantasy API v3](https://github.com/cwendt94/espn-api) (unofficial) | No official key; undocumented endpoint (`lm-api-reads.fantasy.espn.com`); private leagues need `SWID`/`espn_s2` cookies | League settings, rosters, live scoring, matchups, free agent pool, ESPN's own player ownership % and projections | Reflects the same data ESPN's site uses, so solid for what it is; ESPN's own projections skew optimistic vs. staff consensus | Unofficial — ESPN changed the base URL in 2024 with no notice and can do it again. Only useful for ESPN-hosted leagues |
| [Yahoo Fantasy Sports API](https://sports.yahoo.com/developer/) | Official, but requires a developer application/approval; read-only | League, team, roster, matchup, and player data for Yahoo-hosted leagues | Authoritative for Yahoo league data; no general rankings beyond Yahoo's own | Only useful if your league is on Yahoo. Approval process adds friction |
| [nflverse / nflreadpy](https://github.com/nflverse/nflreadpy) (Python/R; successor to the now-deprecated `nfl_data_py`) | Open source, no key | Play-by-play, weekly/seasonal stats, rosters, schedules, snap counts, combine results, draft picks, some Next Gen Stats | Very high — sourced from official play-by-play (nflfastR), used across the analytics community | Historical/statistical, not projections or live ADP. Great for building your own model, not for in-season "who do I start" decisions |
| [FantasyPros Public API (v2)](https://api.fantasypros.com/public/v2/docs) | Free to build/test; production use needs a FantasyPros HOF subscription tier | Expert Consensus Rankings (ECR) from 130+ experts, ADP composite across major hosts, projections, player news, injury reports, tiers | High — ECR/ADP aggregate many experts/sites, which is why it's the industry-standard consensus benchmark | Rate-limited on the free tier; this is the single best free source for actual rankings/ADP, not just raw stats |
| [Pro Football Reference](https://www.pro-football-reference.com/) | No API — HTML scraping only, and their ToS restricts automated/bulk scraping | Historical stats, advanced stats, game logs going back decades | Extremely accurate (treated as the official historical record) | Not real-time, not really licensable for an app that hits it repeatedly — use for one-off historical lookups, not a live tool |
| [MySportsFeeds](https://www.mysportsfeeds.com/data-feeds/) | Free for non-commercial/personal/student use | NFL (and other leagues) real-time-ish stats, schedules, standings, box scores in JSON/XML/CSV | Moderate-to-good; smaller team than the paid enterprise options, so occasional lag/gaps | Fine for a personal project; free tier is non-commercial only |

## Paid

| Source | Approx. Price | Data Available | Accuracy / Reliability | Notes |
|---|---|---|---|---|
| [SportsDataIO](https://sportsdata.io/fantasy-sports-api) (formerly FantasyData) | From ~$25/mo hobbyist tier up to custom enterprise | Real-time and historical stats, projections, injuries, depth charts, DFS salaries, betting odds, unlimited calls on paid plans | High — commercial-grade, 99.9% SLA, low latency | Best value paid option for a personal/small-scale app; scales up if you ever go commercial |
| [FantasyPros Commercial API](https://www.fantasypros.com/api-data/) | Custom (commercial tier above the free/HOF tier) | Same ECR, ADP, projections, news as the free tier, but higher rate limits + SLA | Same high accuracy as the free tier — you're paying for volume/reliability, not better data | Worth it only if you outgrow the free tier's rate limits |
| [PFF+ / PFF Premium Stats](https://www.pff.com/subscribe) | ~$10/mo, ~$120/yr (PFF+); ~$200/yr (PFF Pro) | Proprietary player grades, advanced metrics (pressure rate, target quality, coverage grades), Mock Draft Simulator, Live Draft Assistant, fantasy projections | Grades are proprietary/subjective methodology — well-regarded but debated, not a raw stat | Good supplemental signal layered on top of raw stats, not a replacement for them |
| [Sportradar](https://sportradar.com/) | Custom enterprise, roughly $500–$5,000+/mo | Official-partner-level feeds: live play-by-play, odds, injury data, some Next Gen Stats-adjacent tracking | Highest tier available — industry standard for broadcasters/sportsbooks | Overkill and overpriced for a personal fantasy tool; only relevant if you're building something commercial-grade |

## Your setup: ESPN private league

Confirmed: league is on ESPN. For a private league, ESPN's v3 API needs three values:

| Value | What it is | Where to find it |
|---|---|---|
| League ID | Numeric ID for your league | In the URL when viewing your league on ESPN: `fantasy.espn.com/football/league?leagueId=XXXXXXX` |
| `swid` | Your ESPN account identifier (a GUID, e.g. `{ABC123...}`) | Browser DevTools → Application/Storage → Cookies on fantasy.espn.com → `SWID` |
| `espn_s2` | Your session auth token | Same place → Cookies on fantasy.espn.com → `espn_s2` |

Both cookies come from being logged into ESPN in your browser — they're tied to your account, so treat them like a password (don't commit them to a public repo; keep them in a local `.env` file, gitignored).

With these three, the API (directly, or via the [`espn-api`](https://github.com/cwendt94/espn-api) Python wrapper) gives read access to: your full roster, all teams' rosters, matchups/scores, free agent pool, transactions, and draft results — even though the league is private.

## Practical takeaway

For a personal in-season tool, the free stack that actually covers everything: **Sleeper or ESPN API** (whichever your league is hosted on, for live rosters/scoring) + **FantasyPros free API** (for consensus rankings/ADP/projections/injury news) + **nflreadpy** (for historical stats to build your own model). That combination gets you real opinions (FantasyPros) plus real data (nflverse) plus live league state (Sleeper/ESPN) without spending anything — which is likely what the old app was missing if it "couldn't do anything."
