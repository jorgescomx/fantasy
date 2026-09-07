# ESPN Fantasy API (v3, unofficial)

No API key. Two tiers of access:

1. **Public NFL data** (scores, schedule) — no auth needed at all.
2. **Your private league data** (rosters, matchups, free agents) — needs three values tied to your ESPN login: League ID, `swid`, `espn_s2` (see main doc for how to find them). Treat those two cookie values like a password.

## Data available

- Public: full NFL schedule, live scores, game status
- Private league: your roster, every team's roster, matchup scores, free agent pool, transactions, draft results, ESPN's own player ownership % and projections

## Caveats

- Undocumented/unofficial — ESPN changed the base URL in April 2024 with no notice (`lm-api-reads.fantasy.espn.com` is current). Can break again without warning.
- `espn_s2`/`swid` expire when you log out or ESPN rotates your session — expect to refresh them occasionally.

## Example — tested live, 2026-09-05 (public endpoint, no auth)

Request:
```
GET https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard
```
Response (trimmed):
```json
{
  "season": {"year": 2026, "type": {"name": "Preseason"}},
  "week": {"number": 1},
  "events": [
    {
      "name": "New England Patriots at Seattle Seahawks",
      "competitions": [{
        "competitors": [{"team":{"abbreviation":"SEA"},"score":"0"},{"team":{"abbreviation":"NE"},"score":"0"}],
        "status": {"type": {"detail": "Wed, September 9th at 8:20 PM EDT"}}
      }]
    }
  ]
}
```
Parsed:
```
Week 1, 2026 season, 16 games
- Patriots at Seahawks — Wed Sep 9, 8:20 PM EDT
- 49ers at Rams — Thu Sep 10, 8:35 PM EDT
- Buccaneers at Bengals — Sun Sep 13, 1:00 PM EDT
```

## Private league endpoint (not yet tested — needs your League ID/swid/espn_s2)

```
GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/{leagueId}?view=mRoster
Cookie: SWID={swid}; espn_s2={espn_s2}
```
Returns your league's teams, each with a `roster.entries[]` array of players currently owned, including `playerPoolEntry.player.stats` (ESPN's own weekly/season stats and projections).
