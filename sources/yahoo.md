# Yahoo Fantasy Sports API

Official and free, but gated behind a developer application — not usable immediately like Sleeper/ESPN. Read-only (no write access, e.g. can't set lineups via the API).

## Data available (per Yahoo docs)

- League settings, teams, standings
- Rosters and player pool for Yahoo-hosted leagues
- Matchups and scores
- Transactions (adds/drops/trades)

## Caveats

- Requires applying at sports.yahoo.com/developer/access/ and describing your use case/user base before you get credentials.
- OAuth 2.0 required for every request (more setup than ESPN's cookie-based approach or Sleeper's no-auth model).
- **Not relevant to this user's setup** — league is on ESPN, not Yahoo. Included here for completeness only.

## Example (from Yahoo docs — not independently tested, since this user's league isn't on Yahoo)

Request:
```
GET https://fantasysports.yahooapis.com/fantasy/v2/team/{team_key}/roster
Authorization: Bearer {oauth_token}
```
Response shape (XML by default, JSON available via `?format=json`):
```json
{
  "fantasy_content": {
    "team": [
      { "name": "My Team" },
      { "roster": { "players": [ { "player": [{"name": {"full": "Christian McCaffrey"}}] } ] } }
    ]
  }
}
```
