# Sleeper API

No key, no auth, no signup. Free forever for read access.

## Data available

- Full NFL player pool: name, team, position, status, injury status, age, experience, college
- Trending adds/drops (last 24hr, by add/drop count)
- **Weekly projections** and **actual stats**, per player, undocumented but public and free (see below) — full stat line (`rush_yd`, `rec_tgt`, `pts_ppr`, `pts_std`, `pts_half_ppr`, etc.), not just a single number
- If you connect a Sleeper league: rosters, drafts, matchups, transactions, standings
- Current NFL week/season state

## Caveats

- The full player dictionary (`players/nfl`) is ~14.6MB — fetch it once, cache it locally, and refresh daily at most. Don't call it per-request.
- The projections/stats endpoints are undocumented (found by inspecting Sleeper's own app traffic) — like the ESPN v3 API, they could change without notice.
- Only pulls *your league's* roster/matchup/transaction data if your league is hosted on Sleeper (this user's league is on ESPN, so only the general player-pool/projection endpoints apply).

**Correction (originally documented here, wrong):** an earlier version of this file said Sleeper has "no projections, no rankings." That was false — see the projections endpoint below, tested live.

## Example — tested live, 2026-09-05

Request:
```
GET https://api.sleeper.app/v1/state/nfl
```
Response:
```json
{"week":1,"season":"2026","season_type":"regular","season_start_date":"2026-09-09","display_week":1}
```

Request:
```
GET https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=5
```
Response (bare IDs — must be joined against the cached player dictionary):
```json
[
  {"count":210984,"player_id":"10235"},
  {"count":69776,"player_id":"11834"},
  {"count":44976,"player_id":"9502"},
  {"count":39984,"player_id":"LV"},
  {"count":34173,"player_id":"11581"}
]
```
Resolved against `players/nfl`:
| player_id | Name | Pos | Team | Status |
|---|---|---|---|---|
| 10235 | Roschon Johnson | RB | CHI | healthy |
| 11834 | Devaughn Vele | WR | NO | healthy |
| 9502 | Tank Dell | WR | HOU | **IR** |
| 11581 | MarShawn Lloyd | RB | GB | healthy |

## Example — projections, tested live, 2026-09-05

Request:
```
GET https://api.sleeper.app/v1/projections/nfl/regular/2026/1
```
Response: object keyed by `player_id`, one entry per player with projections for that week (9,419 players returned). Example for Jahmyr Gibbs (`player_id: 9221`):
```json
{
  "pts_ppr": 23.68,
  "pts_half_ppr": 21.38,
  "pts_std": 19.08,
  "rush_att": 17.29,
  "rush_yd": 90.73,
  "rush_td": 0.94,
  "rec": 4.6,
  "rec_tgt": 5.43,
  "rec_yd": 30.67,
  "rec_td": 0.22,
  "adp_dd_ppr": 1
}
```
The same URL pattern with `/stats/` instead of `/projections/` (e.g. `api.sleeper.app/v1/stats/nfl/regular/2026/1`) returns actual final stats once games are played, in the same shape.
