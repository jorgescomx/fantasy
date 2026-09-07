# MySportsFeeds

Free for personal/non-commercial/student use, but requires registering for an API key (HTTP Basic Auth) — not a zero-setup source.

## Data available (per MySportsFeeds docs)

- NFL schedules, standings, box scores
- Player stats (season/weekly)
- Injury reports
- Available in JSON, XML, or CSV

## Caveats

- Free tier is explicitly non-commercial — fine for a personal tool, not for anything you'd distribute or monetize.
- Smaller operation than SportsDataIO/Sportradar — occasional lag or gaps reported versus the paid enterprise feeds.
- Requires signup + Basic Auth credentials before any request succeeds — not tested live here since it needs an account.

## Example (from MySportsFeeds docs — not independently tested)

Request:
```
GET https://api.mysportsfeeds.com/v2.1/pull/nfl/2026-regular/week/1/games.json
Authorization: Basic {base64(apiKey:MYSPORTSFEEDS)}
```
Response shape:
```json
{
  "games": [
    {
      "schedule": {
        "id": 12345,
        "startTime": "2026-09-13T17:00:00.000Z",
        "awayTeam": {"abbreviation": "TB"},
        "homeTeam": {"abbreviation": "CIN"}
      },
      "score": {"awayScoreTotal": null, "homeScoreTotal": null}
    }
  ]
}
```

**Next step to actually use this one**: register at mysportsfeeds.com/data-feeds/ for a free personal-use key.
