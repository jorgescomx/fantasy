# FantasyPros Public API (v2)

Documented as "public," but in practice requires a free API key issued through developer signup — it is **not** callable with zero setup like Sleeper or ESPN.

## Data available (per FantasyPros docs)

- Expert Consensus Rankings (ECR) aggregated from 130+ ranked experts, by position/scoring/week
- ADP composite across major host sites (ESPN, Yahoo, Sleeper, etc.)
- Rest-of-season and weekly projections
- Player news and injury reports
- Ranking tiers (groups of players considered roughly equal value)

## Caveats

- Free tier requires signup and an `x-api-key` header; production/commercial use needs a FantasyPros HOF subscription tier.
- Rate-limited on the free tier (exact limits require reading the signed-in docs).
- This is the only free source in this list with actual *rankings/opinions* rather than raw stats — worth the signup friction.

## Example — tested live, 2026-09-05: unauthenticated call is rejected

Request:
```
GET https://api.fantasypros.com/public/v2/json/nfl/2026/consensus-rankings?type=ST&position=ALL&scoring=STD
```
Response:
```
HTTP 403
{"message":"Forbidden"}
```

## Documented example shape (from FantasyPros docs, not independently verified — requires a key to confirm)

```json
{
  "players": [
    {
      "player_id": 12345,
      "player_name": "Ja'Marr Chase",
      "player_position_id": "WR",
      "player_team_id": "CIN",
      "rank_ecr": 1,
      "rank_min": "1",
      "rank_max": "3",
      "rank_ave": "1.4",
      "rank_std": "0.8",
      "tier": 1
    }
  ]
}
```

**Next step to actually use this one**: sign up at fantasypros.com/api-data/ for a free key.
