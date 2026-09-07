# How ESPN's "projected points" number is actually computed

Verified against your real league data on 2026-09-05. Short version: **projected fantasy points = a dot product of raw projected stats and your league's scoring weights.** ESPN computes it the same way you'd compute it yourself if you had both pieces — there's no hidden magic in the scoring step. The only proprietary part is *generating the raw stat projections themselves* (that's Mike Clay's analyst-driven model, a black box). The conversion from raw stats to your points total is fully transparent and reproducible.

## The formula

```
ProjectedPoints(player, week) = Σ  rawStat[i] × leagueScoringWeight[i]
                                i ∈ scoring categories
```

Where:
- `rawStat[i]` — the projected value for stat category `i` (e.g. projected rushing TDs, projected receptions) for that player in that week. Same for every league — ESPN doesn't customize the raw projection to your scoring format.
- `leagueScoringWeight[i]` — the point value your specific league assigns to category `i` (e.g. 6 pts/rushing TD, 1 pt/reception for PPR). Pulled from your league's own settings (`mSettings` view → `settings.scoringSettings.scoringItems`, an array of `{statId, points}`).

This is exactly why the same player has a different "projected points" number in a PPR league vs. a standard league — the `rawStat` values are identical, only the weights change.

## Verified against your league, live

Fetched Jahmyr Gibbs' Week 1 2026 projection and your league's actual scoring settings, then recomputed the total by hand from the raw components — no shortcuts:

| Stat category (ESPN internal ID) | Projected raw value | Your league's points/unit | Contribution |
|---|---|---|---|
| Rushing TD (25) | 0.83 | 6 | 5.006 |
| Rushing first-downs¹ (28) | 8.0 | 1 | 8.000 |
| Receiving TD (43) | 0.20 | 6 | 1.203 |
| Receiving first-downs¹ (48) | 3.0 | 1 | 3.000 |
| Receptions (53) | 3.90 | 1 (PPR) | 3.897 |
| 2-pt conversion (62) | 0.02 | 2 | 0.040 |
| Fumble recovered for TD (63) | 0.00 | 6 | 0.004 |
| Fumbles lost (72) | 0.08 | -2 | -0.155 |
| **Total (computed)** | | | **20.996** |
| **ESPN's displayed projection** | | | **20.996** |

Exact match. Category names 25/43/53/62/63/72 come from the [espn-api open-source stat map](https://github.com/cwendt94/espn-api/blob/master/espn_api/football/constant.py) (community-reverse-engineered, widely used). Categories 28 and 48 aren't in that public map by name — ESPN's own library comments mark that ID range as "undocumented"; I've labeled them "first-downs" because their magnitude lines up almost exactly with Sleeper's independent `rush_fd`/`rec_fd` projections for the same player (9.07 and 3.07) — a reasonable inference, not a confirmed label.

¹ Inferred label, not officially documented by ESPN — see note above.

## The part that's still a black box

This formula explains the **scoring conversion** completely and exactly. It does not explain how ESPN arrives at the raw numbers going in (0.83 projected rushing TDs, 3.9 projected receptions, etc.) — that's produced by ESPN's fantasy analyst Mike Clay from team-by-team target/carry/dropback share modeling, informed by historical trends, personnel, and game script. That part is not published and can't be reverse-engineered from the API alone.

Plausible real-world inputs behind those specific raw numbers, based on Clay's disclosed process plus standard fantasy-projection practice (not verifiable from the API — this is informed inference, not documented fact):

- **Opportunity share** — projected carry/target share per player, built team-by-team. Gibbs' `seasonOutlook` text (pulled earlier) explicitly noted David Montgomery "no longer in the mix," which directly explains an increased target/carry share.
- **Team play volume** — Vegas-implied team total and expected game pace set the ceiling on total opportunities to distribute across the roster.
- **Historical per-touch efficiency, regressed toward the mean** — prior seasons' yards-per-carry/yards-per-target, pulled toward league-average since per-touch efficiency is noisy. This drives the yardage-level projections.
- **Opportunity-adjusted TDs, not raw TD rate** — Clay has a published metric for exactly this (OTD — opportunity-adjusted touchdowns), estimating expected TDs from red-zone/goal-line share rather than extrapolating last year's raw TD count. That's why 0.83 is a clean rate, not a rounded guess.
- **League-average rates for small categories** — fumbles lost and 2-point conversions are typically just projected touches/red-zone trips × a flat league-average rate, not player-specific skill assessments.
- **Recency weighting shifts over the season** — Week 1 leans heavily on preseason reps, last year's baseline, and offseason personnel/scheme changes since there's no current-season data yet; by mid-season, recent-game performance carries much more weight.

## How historical data, opponent, weather, and teammates each move the numbers

Four categories of input feed the raw-stat side of the formula. Each moves different parts of the projection:

**Historical data**
- Player's own multi-year per-touch efficiency (yards/carry, yards/target, catch rate) sets the baseline *before* regression toward league-average — the source of the ~90 rush-yard, ~30 rec-yard numbers in Gibbs' example above.
- Situational role history — red-zone share, third-down usage, two-minute-drill role — shapes the projection beyond raw volume; two players with identical carry counts can get different TD projections if one gets goal-line work and the other doesn't.
- Durability history discounts a full-season total for injury-prone players and raises week-to-week variance even when the median projection looks similar.
- Team-level history (run/pass split by game state, pace, target distribution shape) sets the total "pie" a roster's skill players are dividing — this is why a teammate's departure moves a projection directly rather than as a separate adjustment (see Team peers below).

**Opponent**
- Defensive efficiency by position (points/yards allowed to RBs vs. WRs vs. TEs) shifts both volume and efficiency assumptions for that matchup.
- "Funnel" tendencies matter more than overall strength — a defense stout against the run but leaky against the pass pushes play-calling (and stat distribution) toward the passing game regardless of the offense's normal tendencies.
- Red-zone defense is tracked separately from yardage defense — a defense can allow plenty of total yards but tighten up near the goal line, capping TD projections independent of the yardage projection.
- Missing starters on the opposing defense (an injured CB1 or run-stuffing DT) create matchup-specific boosts a purely season-long model wouldn't capture on its own.
- Opponent's pace (plays run per game) inflates or deflates counting stats for both teams, since more total snaps means more opportunities to distribute.

**Weather**
- Matters almost entirely for outdoor games — domes are excluded outright.
- Wind is the biggest lever: it suppresses deep passing volume/accuracy and, even more, kicker range/accuracy — usually the largest weather-driven adjustment in any model.
- Heavy rain/snow tends to shift a game plan toward more rushing and shorter, safer throws — raising RB volume while lowering receiving efficiency and increasing fumble risk in cold/wet conditions.
- Forecasts aren't reliable until a few days out, so an early-week projection (like the one pulled above) wouldn't yet reflect a firm weather call — that adjustment gets layered in late, close to kickoff.

**Team peers (teammates)**
- The clearest, most concrete factor in our own data: Gibbs' `seasonOutlook` explicitly cited David Montgomery being "no longer in the mix" as a reason for an expanded role — a direct vacated-touches adjustment, not a vague trend.
- Runs both directions: an injury to a teammate boosts others' shares for that week specifically, while a new signing, a returning player from suspension, or a rookie taking snaps suppresses someone else's projected share.
- Quarterback quality/style affects every pass-catcher on the roster collectively (accuracy, checkdown tendency, deep-ball willingness), and offensive-line health affects the whole backfield's efficiency, not just one player — shared inputs, not player-specific ones.
- A committee backfield lowers any one player's median projection even with unchanged team-total volume, because the "pie" gets split more ways — captured through carry-share assumptions rather than raw team volume.

All four categories are, like the rest of this section, informed inference from Clay's disclosed process and standard industry practice — not verifiable against the API the way the scoring formula itself was.

## Practical use

Because the weight side of the formula is just your league's own published scoring settings, you can apply the *same* formula to a different raw-stat source — e.g. Sleeper's free projections endpoint (`rush_yd`, `rec`, `rec_td`, etc.) — to get a second, independent projected-points number under your exact league scoring, rather than relying only on Sleeper's built-in `pts_ppr`/`pts_std` presets (which won't reflect a custom scoring league like yours). That would need a small mapping table from Sleeper's named fields to ESPN's numeric stat IDs (partially worked out above: `rush_td`→25, `rec`→53, `rec_td`→43, `fum_lost`→72, etc.) — useful if you want a cross-check against ESPN's own number, especially for free agents.
