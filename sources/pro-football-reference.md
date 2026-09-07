# Pro Football Reference

No official API. Data is only accessible by scraping HTML pages, and their Terms of Service restrict automated/bulk scraping (they explicitly ask bots to respect rate limits and disallow heavy automated use).

## Data available

- Full historical stats and game logs back to the 1920s
- Advanced/situational stats (splits, career totals, awards)
- Draft history, combine results, franchise records

## Caveats

- Not real-time — this is a historical record, updated after games/seasons close, not during them.
- No JSON API — every access is an HTML page scrape, which is fragile (breaks when they change page layout) and against their stated ToS if done at any real volume.
- **Not tested here on purpose** — respecting their ToS means not demonstrating bulk/automated scraping. If used at all, treat it as an occasional manual lookup, not a data source an app calls repeatedly.

## What a manual lookup looks like

A single page like `pro-football-reference.com/players/M/MahoPa00/gamelog/2025` renders an HTML table of that player's game-by-game stats for the season — viewable in a browser, not meant to be hit programmatically and repeatedly.

**Recommendation**: use nflverse instead for anything programmatic — it's built from the same underlying play-by-play data, but distributed as a free, ToS-clean, structured API/file feed (see [nflverse.md](nflverse.md)).
