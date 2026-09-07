# nflverse / nflreadpy

Open source, no key, no auth. Data is published as flat files (CSV/Parquet) on GitHub Releases, loaded either via direct HTTP download or the `nflreadpy` (Python) / `nflreadr` (R) packages, which handle caching for you. (`nfl_data_py` is the deprecated predecessor — use `nflreadpy` instead.)

## Data available

- Play-by-play data (every NFL play since 1999)
- Weekly and seasonal player stats
- Full rosters by team/season, including physical measurables and draft info
- Schedules, snap counts, combine results, draft picks and pick values
- Some Next Gen Stats

## Caveats

- Historical/statistical only — no projections, no live scores, no rankings/opinions.
- Data updates on a delay (not real-time during games) — this is a "day after" analytics source, not a live in-game feed.
- Best used to build your own model, not to answer "who do I start this week" directly.

## Example — tested live, 2026-09-05

Request:
```
GET https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_2025.csv
```
Result: CSV with 3,138 rows, 36 columns.

Columns (first 15 of 36):
```
season, team, position, depth_chart_position, jersey_number, status, full_name,
first_name, last_name, birth_date, height, weight, college, gsis_id, espn_id
```

Sample row:
```
2025, GB, DL, DT, 69, DEV, Dante Barnett, Dante, Barnett, , , 275, ,
```

Equivalent via the Python package (not run in this test, but this is the standard usage):
```python
import nflreadpy as nfl
rosters = nfl.load_rosters([2025])
```
