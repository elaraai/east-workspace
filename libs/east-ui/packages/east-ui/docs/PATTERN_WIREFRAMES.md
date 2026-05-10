# East UI Pattern Wireframes

Prescriptive ASCII wireframes for every pattern in the catalogue.
Taxonomy follows `PATTERNS.review.md`. This is the **specification** —
hand to a designer, hand to an engineer, hand to a reviewer.

Conventions used in every wireframe:
- `[label]` — a button or chip
- `▎` — a structural inner rule (brand-500, inside-card only)
- `•`  — a small brand-500 dot bullet
- `●` / `○` — solid / hollow status mark
- `─ ─` — dashed hairline (vs `───` solid)
- `▮` — filled bar segment (chart / progress)
- `▾` — disclosure / dropdown chevron
- Em-dash `—` separates inline label from value
- Minus sign is U+2212 (`−`), never hyphen
- Numerals always tabular (JetBrains Mono with `tabular-nums`)

Status carried by **dot + word**, never by background tint.
Coloured chrome is for charts only. Borders are structural.

---

## Frame

The user is a **frontline business decision-maker** — demand planner,
store ops lead, buyer, scheduler, category manager, pricing analyst,
brand manager, account lead.

- 5–15 minutes per decision · queue of dozens-to-hundreds per week
- Carries private information the model can't have
- Accountable for outcomes
- Has a boss, peers, downstream consumers
- Years of domain judgement

Their job: commit a defensible decision quickly that combines what
the model knows with what they know.

### Decision archetypes

| # | Archetype  | Cadence       | Stakes    | Needs most |
|---|------------|---------------|-----------|---|
| 1 | Routine    | Many/day      | Low       | Spot exceptions; bulk-accept routine |
| 2 | Exception  | Few/week      | Mid       | Why is this different? Safe override path |
| 3 | Commitment | Many/week     | Mid–High  | Confidence band; backup plans; relationship context |
| 4 | Strategic  | Few/quarter   | High      | Briefing format; alternatives; sensitivity; sign-off |
| 5 | Reactive   | Rare, urgent  | High      | Situation summary; narrowed choices; fast commit |
| 6 | People     | Mid           | Mid–High  | Fairness check; traceability; bias guardrails |

### Evidence kinds (what every Decide-mode screen serves)

1. The recommendation as an argument
2. What the model doesn't know (epistemic gaps)
3. Stakes in human terms
4. Reference class
5. Risks named in plain language
6. A clean way to commit / modify / override with reason captured
7. The user's own track record

---

## Taxonomy

7 modes · 10 families · ~38 top-level patterns. Anchors in **bold**.

| Mode                   | Anchor                            | Other families used |
|------------------------|-----------------------------------|---|
| §2.1 **Observe**       | **Decision.Queue**                | AnomalyList · Stat.\* · InputBand.\* |
| §2.A **Predict**       | **Predict.BaselineVsAction**      | Predict.OutcomeRange · Predict.ScenarioReadiness · UncertaintyBadge |
| §2.2 **Diagnose**      | **Recommendation.WhyThisRec**     | DriverList · IndicatorCluster · LineageTrail |
| §2.3 **Decide**        | **Recommendation.Briefing**       | Judgement.\* · Reference.\* · Stakes.\* · AlternativesList · WhatIfList · Commit.\* |
| §2.4 **Compare**       | **Recommendation.WhatChanged**    | DiffView · RecVsRunnerUp · DeltaPill · VersusHeader · ContextSelector |
| §2.F **Calibrate**     | **Track.Scorecard**               | Track.\* · OutcomeScorecard · ActualVsPredictedChart |
| §2.5 **Configure**     | **InputBand.AssumptionsBar**      | InputBand.\* · CalendarHeatmap · ValueMatrixEditor · AssignmentBoard · SupplyDemandView · DraftPublishBar · SensitivityView |
| §2.6 **Frame & trust** | **DecisionJournal**               | Header · Trust.\* · Banner.\* · AuditTrail · Communicate.\* · KeyboardShortcutsOverlay · PermissionGate · ComputeError · CommitApproval |

### Family contracts

| Family               | Members                                              | Shared shape |
|----------------------|------------------------------------------------------|---|
| `Recommendation.*`   | Briefing · WhyThisRec · WhatChanged · BaselineVsAction | Slotted argument · capture-to-audit |
| `Reference.*`        | Similar · Peers · Base · Novelty · Lesson            | Inset card · visual proof · sample size · click-to-drill |
| `Judgement.*`        | Prompt · KnowledgePanel · Gap · Inject               | Region · response control · live consequence · capture |
| `Stakes.*`           | Tag · Radius                                         | Two densities of "decision consequence in human terms" |
| `Track.*`            | Scorecard · Lesson · ModelLimits · Annotate · Retrain | Visual-led · time-anchored |
| `Communicate.*`      | Message · Handoff · Journal                          | Composer · task-list · journal |
| `Trust.*`            | Chip · Stamp · Footer · Trail                        | Same content at four densities |
| `Banner.*`           | Stale · Partial · ChangeSinceLastVisit · Guardrail   | One primitive · named recipes |
| `Commit.*`           | Bar · BatchBar · DraftBar · Confirm · Approval       | Apply patch with friction X |
| `InputBand.*`        | AssumptionsBar · FilterBar · ParameterFormSection    | Editable inputs · emit a patch |

---

## §2.1 Observe — anchor `Decision.Queue`

### `Decision.Queue` *(anchor)*

The queue of decisions waiting on the user. Sorted by urgency, routine
items collapse with a single bulk-accept affordance.

```
┌────────────────────────────────────────────────────────────────┐
│ DECISIONS WAITING                                              │
│                                                                │
│ 7 decisions · 3 past SLA                          [filter ▾]   │
├────────────────────────────────────────────────────────────────┤
│ ● overdue 2h    Reorder · SKU-001 · 2k units          $42k     │
│                 [accept]  [modify]  [override]                 │
├────────────────────────────────────────────────────────────────┤
│ ● due 4pm       Promo · Easter clearance early-end    $128k    │
│                 [accept]  [modify]  [override]                 │
├────────────────────────────────────────────────────────────────┤
│ ○ routine       Reorder · SKU-014                     $1.2k    │
│ ○ routine       Reorder · SKU-018                     $0.8k    │
│ ○ routine       Reorder · SKU-022                     $0.4k    │
│                 ┌────────────────────────────────────────┐     │
│                 │ 3 routine · $2.4k total · [accept all] │     │
│                 └────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
```

Slots: count + SLA · per-row {urgency-glyph, label, stakes, inline
commit} · routine-collapse with bulk accept.

### `AnomalyList`

Sorted by severity, with chips and per-row actions. Hybrid of
`Decision.Queue` for "things you should look at" that aren't yet
queued decisions.

```
┌────────────────────────────────────────────────────────┐
│ ANOMALIES                                              │
│ 4 unusual · last 24h                                   │
├────────────────────────────────────────────────────────┤
│ ● high   SKU-001 demand spike  +312%   [investigate →] │
│ ● mid    Region NW underperform −14pp  [investigate →] │
│ ● mid    Lead-time supplier-A   +6 days [investigate →]│
│ ○ low    Promo conversion dip  −3pp    [dismiss]       │
└────────────────────────────────────────────────────────┘
```

### `Stat.Card`

```
┌──────────────────────┐
│ PROJECTED UPLIFT     │
│                      │
│ $2.4M                │
│ +12.4% vs baseline   │
│        ╱╲ ╱╲         │
│      ╱    ╲╱  ╲      │
└──────────────────────┘
```

Eyebrow · hero number (DM Sans 32–60 px tabular) · delta · sparkline.

### `Stat.Grid`

N×M grid of `Stat.Card` with shared border-only frame, no internal
shadows.

```
┌────────────┬────────────┬────────────┬────────────┐
│ uplift     │ runs       │ fidelity   │ stockout   │
│ $2.4M      │ 7          │ 99.4%      │ —          │
│ +12% bsl   │ 3 queued   │ +0.2 pp    │ no data    │
├────────────┼────────────┼────────────┼────────────┤
│ acceptance │ override   │ avg time   │ SLA breach │
│ 87%        │ 5%         │ 4.2 min    │ 2          │
└────────────┴────────────┴────────────┴────────────┘
```

### `Stat.Rail`

Horizontal pill rail of compact metrics — for headers / filter chips.

```
[ uplift  $2.4M ↑12% ] [ runs 7 ] [ fidelity 99.4% ↑0.2 ] [ SLA 2 ]
```

### `ListDetailLayout`

Master–detail split: scrollable list left, selected panel right.
Splitter for resize.

```
┌──────────────┬─────────────────────────────────────┐
│ Runs         │ procure-2024-09-14                  │
│ ────────────│ ─────────────────────────────────── │
│ ● 09-14 ↑12%│ STARTED       2 hours ago           │
│ ● 09-13 ↑9% │ ITERATIONS    1,284                 │
│ ● 09-12 −2% │ REWARD        0.847                 │
│ ● 09-11 ↑6% │                                     │
│              │ Δ vs baseline +12.4%                │
│              │ ────────                            │
│              │ ╱╲    ╱╲  ╱╲                        │
│              │/    ╲╱   ╲╱  ╲                      │
└──────────────┴─────────────────────────────────────┘
```

### `LegendRail`

Inline rail of swatch + label + value range + visibility toggle for
a chart.

```
[● procurement v3   12k–18k  ◉] [○ procurement v2   8k–14k  ◯]
```

### `InputBand.FilterBar`

Faceted filters that compose into a `Patch` over a query state.
Active chips brand-tinted, placeholder dashed.

```
[scenario = procurement v3 ×]  [region in EU,NA ×]  [date = last 30d]
[+ add filter]                                  Showing 1,284 events
```

### `SearchResultsSummary`

```
1,284 results · 3 filters · [clear all]
```

### `ThresholdBand`

Coloured bands behind a chart axis (good / acceptable / bad). Visual
overlay only — colour conveys *band*, not status; legend names them.

```
       acceptable
┌───────────────────────────────────────────┐
│ good    ░░░░░░░░░░░░░░░░░░░░░░░░░  current│
│         ────── target ──────              │
│ accept  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒        │
│ bad     ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓        │
└───────────────────────────────────────────┘
```

### `Provenance.Stamp`

Inline "model v3.4 · updated 2m ago" chip with hover-card detail.
See also `Trust.Chip` for the standalone region-banner version.

```
[ model v3.4 · updated 2m ago ▾ ]
```

### `ForecastView`

Observed history + forecast band + p10/p90 envelope on shared time
axis.

```
   ┌───────────────────────────────────────────────────┐
   │                                  ┌───────────┐    │
   │                                ╱ │  forecast │    │
   │                              ╱   │  ░░░░░░   │    │
   │  ────── observed ──────╲   ╱     │  ░░░░░░   │    │
   │                          ╲╱      │           │    │
   │                                  └───────────┘    │
   └───────────────────────────────────────────────────┘
   Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct
```

### `ProjectionToTarget`

Trajectory vs committed target with surplus/shortfall shading and a
"likely outcome" label.

```
   target ─────────────────────────────────┄
                                  ╱ likely $2.02M (+0.02M)
                                ╱
                              ╱
                            ╱
   ╲                      ╱
     ╲────────────────╱  current: on track · band p10–p90
```

### `SegmentedView`

Equal-weight category tiles. One selected at a time.

```
[ all 1,284 ] [ EU 412 ] [● NA 624 ] [ APAC 248 ]
```

### `AttentionList`

"Things you should look at" — sorted by severity with chips +
actions. Visual-led.

```
┌────────────────────────────────────────────────┐
│ ATTENTION · 6 items                            │
├────────────────────────────────────────────────┤
│ ● high   SKU-001 stockout in 3 days  [view →] │
│ ● mid    Promo X over budget        [view →] │
│ ○ low    Lead-time drift supplier-B [view →] │
└────────────────────────────────────────────────┘
```

### `PartialResultsNotice`

```
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
We could only get 4 of 6 sources. [retry] · [details]
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```

### `FirstRunState`

```
┌─────────────────────────────────────────┐
│           ▢▢                            │
│        ▢▢    ▢▢   No runs yet           │
│           ▢▢                            │
│                                         │
│  Connect a data source to start.        │
│  ☐ Connect Snowflake or BigQuery        │
│  ☐ Upload your first CSV                │
│  ☐ Pick a starter scenario              │
│                                         │
│             [ Add source ]              │
└─────────────────────────────────────────┘
```

---

## §2.A Predict — anchor `Predict.BaselineVsAction`

### `Predict.BaselineVsAction` *(anchor)*

Two trajectories overlaid; the gap between them IS the value of the
recommendation. Visual-led.

```
┌─────────────────────────────────────────────────┐
│ IF YOU                                          │
│   do nothing  →  $1.94M                         │
│   follow rec  →  $2.02M    target $2.00M ┄┄┄┄  │
│                                                 │
│   ─────── do nothing ────╲                     │
│                            ╲────                │
│   ────── follow rec ─────────────↗             │
│                                                 │
│ Value of acting · +$80k · 88% confidence        │
└─────────────────────────────────────────────────┘
```

### `Predict.OutcomeRange`

Likely / plausible / extreme in plain language, anchored on a
horizontal scale.

```
$1.6M ──────────────●───────────────── $2.4M
       extreme   plausible    likely    plausible   extreme
                              ────────
                              $1.96M–$2.08M (p10–p90)
                                        ●  current rec
```

### `Predict.ScenarioReadiness`

Is the recommendation robust across a small set of plausible
futures? Visual-led check grid.

```
                    base    low-demand  high-demand  supplier-fail
follow rec          ●       ●           ●            ○
do nothing          ○       ●           ○            ○
runner-up           ●       ○           ●            ●
                    │       │           │            └ flips
                    └───────┴───────────┴── majority-robust
```

### `UncertaintyBadge`

`82% conf.` / `± 6h` / `p < 0.05`. Optional `historicalAccuracy`
reveals calibration.

```
[ 82% conf · right 87% on 241 cases ]
```

---

## §2.2 Diagnose — anchor `Recommendation.WhyThisRec`

### `Recommendation.WhyThisRec` *(anchor)*

Same shape as `Recommendation.Briefing` but read-only — explains the
existing rec rather than offering one.

```
┌──────────────────────────────────────────────────────────┐
│ WHY THIS REC                              [stakes]       │
│ ────────────────────────────────────────────────────────│
│ Move 3 SE shifts from Patel → Cho                        │
│                                                          │
│ Top drivers                                              │
│ • SE forecast +14% (driver: holiday demand)              │
│ • Cho 12h under cap; Patel at 38h                        │
│ • Past 5 similar moves all reduced OT                    │
│                                                          │
│ Upside —  −$8.4k OT this week                            │
│ Risks   —  Patel weekend prefs (raised Mar 18)           │
│ Don't know — Cho's school-pickup arrangement             │
│                                                          │
│ ──────────────────────────────────────────────           │
│  Open in Decide  →                                       │
└──────────────────────────────────────────────────────────┘
```

### `DriverList`

Top-N contributing factors with horizontal bars, direction-coloured
(green up / red down), %.

```
DRIVERS OF VARIANCE
holiday-demand    ████████████░░░░  +14%   $52k
inventory-buffer  ██████░░░░░░░░░░  +6%    $22k
weekend-coverage  █▓░░░░░░░░░░░░░░  −2%   −$8k
new-supplier-LT   █░░░░░░░░░░░░░░░  −1%   −$4k
                  contribution        Δ
```

### `IndicatorCluster`

Pass / warn / fail / unknown checks. `orientation: row | column`.

```
DATA HEALTH
● pass  pricing feed       (last 4m)
● pass  demand signal      (last 8m)
○ warn  competitor index   (12h old)
✗ fail  POS-snapshot       (sync error)
? unk   regulator alerts   (probe pending)
```

### `DeltaBreakdown` *(table recipe)*

```
                  current    baseline    Δ        Δ%      narrative
revenue           $2.02M     $1.94M      +$80k    +4.1%   uplift
overtime          $42k       $50k        −$8k     −16.0%  saved
SLA breaches      2          5           −3       −60.0%  recovered
─────────────────────────────────────────────────────────────────
TOTAL                                    +$92k    │       net good
```

### `LineageTrail`

`[source] → [transform] → [model] → [output]` with per-node issue
tint.

```
[POS-snapshot ●]──→[normalize ●]──→[procure-v3 ○]──→[recs ●]
   stale 12h          ok              warm            ok
                                      [retrain →]
```

### `OutcomeScorecard`

```
RECENT MODEL PERFORMANCE · last 30d
hit-rate     87%   ↑2pp
MAE          $4.2k  ↓6%
MAPE         3.1%   stable
n            241 cases    [breakdown →]
```

### `ActualVsPredictedChart`

Scatter or time-series, residual band. Click-through to
`AuditTrail`.

```
predicted ($M)
2.4 ┤                             ●
2.2 ┤                       ●  ●●
2.0 ┤                  ●  ●●     [ residual band ░ ]
1.8 ┤             ●  ●●
1.6 ┤        ● ●●
1.4 ┤   ● ●●
1.2 ┤●●
    └─────────────────────────────────── observed ($M)
       1.2  1.4  1.6  1.8  2.0  2.2  2.4
```

---

## §2.3 Decide — anchor `Recommendation.Briefing`

### `Recommendation.Briefing` *(anchor)*

Slotted argument: `claim · because[] · upside · risks · unknowns ·
stakes · actions · aside`. Five-zone layout (header / title / body /
callouts / actions). One element dominates per zone.

```
┌────────────────────────────────────────────────────────┐
│ RECOMMENDED ACTION              −$8.4k impact │ 3 wkrs │
├────────────────────────────────────────────────────────┤
│ Move 3 SE shifts from Patel → Cho for week of May 11   │
│                                                        │
│ • SE-1 forecast +14% vs base, driven by holiday demand │
│ • Cho 12h under weekly cap; Patel at 38h               │
│ • Past 5 similar moves all reduced OT (5/5 right)      │
│                                                        │
│ ──────────────────────────────────────────             │
│ Upside     — −$8.4k OT this week · coverage 99.4%      │
│ Risks      — Patel weekend prefs (raised Mar 18)       │
│ Don't know — Cho's school-pickup arrangement           │
├────────────────────────────────────────────────────────┤
│ [ Apply ]  [ Modify ]  [ Override ]      Why this? →   │
└────────────────────────────────────────────────────────┘
```

### `Recommendation.WhatChanged` *(also Compare anchor)*

What changed since last visit — diff against a `State.bind`
checkpoint via `East.diff`.

```
┌────────────────────────────────────────────────────────┐
│ SINCE LAST VISIT · 3 changes                           │
├────────────────────────────────────────────────────────┤
│ • Forecast SE-1 raised from +11% → +14%                │
│ • Cho's weekly cap increased: 38h → 40h                │
│ • Risk added — second early-end this quarter           │
│                                                        │
│ Net effect on rec — same shape, +$0.4k upside          │
└────────────────────────────────────────────────────────┘
```

### `AlternativesList`

Drawer body of alternatives — each is a patch through the same
commit pipeline.

```
ALTERNATIVES considered (4 of 12 shown)
┌──────────────────────────────────────────────────────┐
│ ● selected   Move 3 shifts → Cho        −$8.4k OT    │
├──────────────────────────────────────────────────────┤
│ ○ runner-up  Move 2 to Cho, 1 to Lee    −$6.1k OT    │
├──────────────────────────────────────────────────────┤
│ ○ alt-3      Hold all, request swap     $0           │
├──────────────────────────────────────────────────────┤
│ ○ alt-4      Move 3 to Lee              −$5.8k OT    │
│                                          [see all →] │
└──────────────────────────────────────────────────────┘
```

### `WhatIfList`

Pre-computed deltas with runtime / staleness. Selecting one composes
its patch into the parent's draft.

```
WHAT IF
☐ +5% holiday lift                    → −$11.2k OT  (instant)
☐ supplier-A LT slips 2 days          → −$5.4k OT   (1.2s)
☐ Cho takes a sick day                → +$3.1k OT   (instant)
☐ regulator weekend rule applies      → +$8.0k OT   (4s · stale 1h)
                                                  [recompute all]
```

### `RecVsRunnerUp`

Side-by-side why-this and why-not.

```
┌─────────────────── this rec ──────────┬─── runner-up ───────┐
│ Move 3 to Cho                          │ Move 2 to Cho, 1 to │
│                                        │ Lee                 │
│ • forecast +14%                        │ • lower fairness    │
│ • Cho 12h under cap                    │   variance          │
│ • 5/5 right historically               │ • slightly less OT  │
│                                        │   savings (−$2.3k)  │
│ Δ vs runner-up: +$2.3k OT, +0.2 conf   │                     │
└────────────────────────────────────────┴─────────────────────┘
```

### `Judgement.Prompt`

A region where the user's input changes the rec, captured for audit.

```
┌─────────────────────────────────────────────────┐
│ ❓ YOUR JUDGEMENT MATTERS HERE                   │
│                                                 │
│ This rec assumes new supplier hits 92% on-time. │
│ Based on 3 months data; you've spoken to them.  │
│                                                 │
│ Your confidence in 92%                          │
│  low  ──────────────────●─────────  high        │
│                                                 │
│ ▾ If you say <60%: rec drops to runner-up       │
│   (sourcing from existing supplier instead)     │
│                                                 │
│                       [ Save my read ]          │
└─────────────────────────────────────────────────┘
```

Slots: question · response control · live consequence preview · save.

### `Judgement.KnowledgePanel`

Structured prompts × free-text affordance. "Apply" re-runs the rec
with the user's input.

```
YOUR TURN — anything we should account for?
 ☐ Customer relationship status      [+ note]
 ☐ Recent quality concerns           [+ note]
 ☐ Regulatory changes you've heard   [+ note]
 ☐ Other                             [+ note]

                            [ Apply to rec ]
```

### `Judgement.Gap` (read-only)

```
WHAT WE DON'T KNOW
✗ Customer's recent satisfaction (data >30d old)
✗ Competitor's price                (last update 6w ago)
✗ Local weather                     (model degrades >7d)
```

### `Judgement.Inject` (flow)

```
Before:  rec = Move 3 shifts to SE
You add: "Cho mentioned school pickup constraint Tue"
After:   rec = Move 2 shifts to SE, hold one open
         Δ: −$2.0k saved, feasibility +12pp
```

### `Reference.Similar`

Last 14 like this you've seen. Strip of dots; clickable.

```
LAST 14 LIKE THIS YOU'VE SEEN
●●●●●●●●●●●●○○                Accept 12 · Override 2
↑                              Right 11 · Wrong 3
most recent                              [ see all → ]
```

### `Reference.Peers`

Avatar pills grouped by decision.

```
YOUR PEERS in similar cases · last 30d
[A][K][M]   [J][R]
 — accepted — — modified —
3 of 5 · majority: accept
```

### `Reference.Base`

Filled horizontal bar with sample size.

```
RECS OF THIS KIND WORK
████████████░░░░░  73%  (n = 84, last 90d)
```

### `Reference.Novelty`

```
⚠ UNUSUAL · No comparable cases in 12 months
            top 3% novelty for your sector
```

### `Reference.Lesson`

```
⚠ Last time you saw this kind of rec (Mar 18)
   it was wrong — model missed regulator timing.
                                  [ see what happened → ]
```

### `Stakes.Tag`

```
[ STAKES   −$8.4k impact   ·   3 workers   ·   reversible 24h ]
```

Single line; bold tone-coloured numerals; muted dividers. Already
pinned to the top-zone of `Recommendation.Briefing`.

### `Stakes.Radius`

Concentric rings showing decision scope. Each ring's content is
named, not just counted.

```
        ┌─ direct ────────────────────────┐
        │  3 workers  (Cho, Patel, Nguyen) │
        │  1 customer (Acme)               │
        ├─ touches ───────────────────────┤
        │  SE region team                  │
        │  Finance KPI dashboard           │
        ├─ knock-on ──────────────────────┤
        │  Weekly board report             │
        └──────────────────────────────────┘
```

### `Commit.Bar` (sticky footer)

```
  ─────────────────────────────────────────────────────────────
  Draft · 3 changes pending                Apply  Discard  …
  ─────────────────────────────────────────────────────────────
```

### `Commit.BatchBar`

```
  ─────────────────────────────────────────────────────────────
  4 selected · $52k impact         [ Apply all ]  [ Override + why ]
  ─────────────────────────────────────────────────────────────
```

### `Commit.DraftBar`

```
  ─────────────────────────────────────────────────────────────
  Draft · 7 changes              [Review diff]  [Publish]  […]
  ─────────────────────────────────────────────────────────────
```

### `Commit.Confirm`

Dialog that always shows the diff (`DiffView`) — never a summary.

```
┌────────────────────────────────────────────────────┐
│ CONFIRM                                            │
│                                                    │
│ ─ patel.shifts ───────────────────────────────────│
│   38   →  35                                       │
│ ─ cho.shifts   ───────────────────────────────────│
│   24   →  27                                       │
│                                                    │
│ Audit note · required                              │
│ ┌──────────────────────────────────────────────┐  │
│ │ _______________________________________      │  │
│ └──────────────────────────────────────────────┘  │
│                                                    │
│                  [ Cancel ]  [ Commit ]            │
└────────────────────────────────────────────────────┘
```

### `Commit.Approval` / `MultiPartyCommit`

Threshold-gated commit-rights flow.

```
APPROVAL CHAIN · 1 of 2 needed
[A] author      ✓ committed
[J] reviewer    ⏳ pending
[K] reviewer    ─

       [ Open diff ]   ── [ Approve & sign ] / [ Decline + why ]
```

---

## §2.4 Compare — anchor `Recommendation.WhatChanged`

`WhatChanged` shown in §2.3 above (cross-mode pattern).

### `DiffView`

Full structural diff. Recursive depth-based indentation.

```
   ──────  shift_changes  ──────
   ▾ patel  (Worker)
       hours_week     38   →  35     ✕
       weekend_pref   true → true
   ▾ cho    (Worker)
       hours_week     24   →  27     ✕
       weekend_pref   true → true
   ▾ ───── totals ─────
       OT_cost        $50k → $42k    auto

                                  [ Apply ]   [ Discard all ]
```

### `DeltaPill`

```
[ ↑ +12.4% ]   [ ↓ −2.1% ]   [ — = stable ]   [ ↑ +84k ✓ sig ]
```

`magnitude: higher-is-better | lower-is-better | target-is-best`
flips the colour mapping. Optional `ci` and `significant` decorators.

### `ContextSelector`

Labelled chip → rich picker (scenario / period / region).

```
[ scenario · procurement v3 ▾ ]   [ period · last 30d ▾ ]
```

### `VersusHeader`

```
[ procurement v3 ▾ ]   vs   [ procurement v2 ▾ ]    [ ↑ +12.4% ]
```

### `BeforeAfterTimeline`

Visual snapshot of state at two points, with the bridging events
labelled.

```
   May 4               May 11
   ●─────────────────●
   42 OT             34 OT
   3 SLA breaches    1 SLA breach
   ───────────────────
       Δ −8 OT, −2 SLA
       events:  Cho added · regulator alert · Patel pref raised
```

---

## §2.F Calibrate — anchor `Track.Scorecard`

### `Track.Scorecard` *(anchor)*

User's own track record. Visual-led: action breakdown × hit rate ×
value-added.

```
┌──────────────────────────────────────────────────────────┐
│ YOUR LAST 90 DAYS · n = 84 decisions                     │
│                                                          │
│              %    Right                                  │
│ Accepted    87%   ████████████░░  88%                    │
│ Modified     9%   ██░             71%                    │
│ Overrode     5%   ▌               75%                    │
│                                                          │
│ Where you outperform  pricing recs    +12pp vs always-A  │
│ Where you underperform shift swaps    −8pp vs always-A   │
│                                                          │
│ Net: +$8.2k/wk added vs always-accept policy             │
└──────────────────────────────────────────────────────────┘
```

### `Track.Lesson`

Same shape as `Reference.Lesson` but actor = the user.

```
⚠ This kind of rec was wrong for you on Mar 18.
   Reason — model missed regulator timing.
                                          [ details → ]
```

### `Track.ModelLimits`

Timeline + cluster of past errors.

```
WHERE THE MODEL HAS BEEN WORST · last 12 months
●         Q4 holiday weeks        — 3 misses
       ●  end-of-quarter promos   — 2 misses
●         supplier-onboarding     — 4 misses
                            [ filter your queue to these → ]
```

### `Track.Annotate`

Single small dialog, surfaced from `AuditTrail`.

```
PAST DECISION · Move 3 shifts → SE (May 4)
How did it go?
○ As expected     ● Slightly off    ○ Off by a lot
Note (optional) ─ ___________________________________
                                            [ Save ]
```

### `Track.Retrain`

Auto-surfaces when calibration drops below threshold.

```
⚠ Calibration drifting on shift-swap recs
   model 73% right · last 30d 61%
                            [ flag for retraining → ]
```

---

## §2.5 Configure — anchor `InputBand.AssumptionsBar`

### `InputBand.AssumptionsBar` *(anchor)*

Horizontal chip row; each chip opens an edit popover; emits
`Patch<TAssumptions>`.

```
[ holiday lift +14% ▾ ]  [ OT cap 40h ▾ ]  [ SE window 4w ▾ ]
[ + add assumption ]
```

### `InputBand.FilterBar`

Same shape; different domain (query state, not assumptions).

```
[ scenario = procurement v3 ×]  [ region in EU,NA × ]  [ + filter ]
```

### `InputBand.ParameterFormSection`

Card-wrapped labelled inputs + guardrails.

```
┌────────────────────────────────────────────────────────┐
│ TARGETS                                                │
│                                                        │
│ Service-level target  ─ [ 99.4 % ─────●───── ]        │
│                          floor 95.0  ceil 100.0        │
│                                                        │
│ Buffer policy         ─ [ ◉ p90  ○ p95  ○ p99 ]      │
│                                                        │
│ ⚠ Buffer p99 raises OT $14k/week. [reduce window?]    │
└────────────────────────────────────────────────────────┘
```

### `Banner.Guardrail`

Structured warning. `severity: info | warning | danger`. Optional
`blockCommit` disables submit.

```
⚠ This change has consequences
   Raising buffer p95→p99 increases OT $14k/week and trips
   SLA-breach guardrail in 3 of 8 simulated weeks.
                            [ recompute ]   [ accept anyway ]
```

### `SumCheckBadge`

```
[ allocations  100.0% / 100.0%  ✓ ]    [ allocations  98.3% / 100% ⚠ ]
```

### `CalendarHeatmap` (+ `.Weekly` preset)

```
WEEKLY DEMAND
        Mon   Tue   Wed   Thu   Fri   Sat   Sun
    1   ░░    ░░    ░░    ▒▒    ▒▒    ▓▓    ▓▓
    2   ░░    ░░    ░░    ▒▒    ▒▒    ▓▓    ▓▓
    3   ▒▒    ▒▒    ▒▒    ▓▓    ▓▓    ██    ██
    4   ▒▒    ▒▒    ▓▓    ▓▓    ██    ██    ██
                                  legend ░░ low  ▒▒ mid  ▓▓ high  ██ peak
```

### `PresetPicker`

Conservative / Balanced / Aggressive radio cards. A preset is a
*named patch*. Optional dashed "Custom" tile.

```
┌────────────────┬────────────────┬────────────────┬─ ─ ─ ─ ─ ─ ─┐
│ ○ Conservative │ ● Balanced     │ ○ Aggressive   │ ○ Custom    │
│ buffer p99    │ buffer p95     │ buffer p90     │ ─ ─ ─ ─ ─ ─ │
│ tight SLA     │ default SLA    │ loose SLA      │             │
└────────────────┴────────────────┴────────────────┴─ ─ ─ ─ ─ ─ ─┘
```

### `ValueMatrixEditor`

Editable grid with row/column totals. Per-cell patch emit; row chips
via `SumCheckBadge`.

```
                Mon    Tue    Wed    Thu    Fri    row Σ
   Cho           4      4      4      4      4      20  ✓
   Patel         8      8      8      8      6      38  ⚠
   Nguyen        6      6      6      6      6      30  ✓
   Lee           0      0      0      0      0       0  ✓
   ─────────    ──     ──     ──     ──     ──     ───
   col Σ         18     18     18     18     16      88
                                       target / day  18
```

### `SensitivityView`

Workbench: AssumptionsBar + WhatIfList + PresetPicker side-by-side.

```
┌─ assumptions ─┬──────────── outcomes ─────────────────────┐
│ holiday +14%  │ uplift  $2.02M ──────●────── target $2.0M │
│ OT cap 40h    │ OT      −$8.4k                            │
│ SE win 4w     │ SLA     99.4%                             │
├──── flips ────┴─────────────────────────────────── flip-points ─┤
│ holiday < 9%   → rec drops to runner-up                          │
│ OT cap > 44h   → rec same, +$0.6k savings                        │
└──────────────────────────────────────────────────────────────────┘
```

### `AssignmentBoard`

Generic drag-to-assign grid (worker→shift, order→truck, lead→owner).

```
                    Mon       Tue       Wed       Thu       Fri
   morning          [Cho]     [Cho]     [Cho]     [Cho]     [—]
   afternoon        [Patel]   [Patel]   [Lee]     [Patel]   [Patel]
   night            [Nguyen]  [Nguyen]  [Nguyen]  [Nguyen]  [Nguyen]
   ─────────────────────────────────────────────────────────
   conflicts        ✓         ✓         ⚠ Lee     ✓         ⚠ —
                                          weekend            unassigned
```

### `UnassignedTray`

```
┌──────────────────────┐
│ UNASSIGNED · 3       │
│ ──────────────────── │
│ ⠿ shift Fri morning  │
│ ⠿ shift Fri afternoon│
│ ⠿ shift Sun night    │
└──────────────────────┘
```

### `SourceLibrary`

Catalogue of draggable templates grouped by category. Multi-template
apply.

```
TEMPLATES
▾ Promos      ⠿ Easter clearance   ⠿ Spring sale   ⠿ Black Friday
▾ Reorders    ⠿ Auto reorder       ⠿ Manual order
▾ Shifts      ⠿ Standard week      ⠿ Holiday week
                                          [ apply selected ]
```

### `ConflictAnnotator` *(recipe)*

```
                    Mon       Tue       Wed
   morning          [Cho]     [Cho]     [Cho]
   afternoon        [Patel ⚠] [Patel]   [Patel]
                       └─ over weekly cap (40 → 38)
```

### `SwapRequest`

```
┌──────────────────────────────────────────────────┐
│ SWAP REQUEST · Patel ↔ Cho                       │
│                                                  │
│ Patel  Mon-AM       →   Cho  Mon-AM              │
│ Cho    Wed-PM       →   Patel Wed-PM             │
│                                                  │
│ Note ─ ___________________________________       │
│                                                  │
│            [ Decline ]   [ Counter ]   [ Accept ]│
└──────────────────────────────────────────────────┘
```

### `SupplyDemandView`

Generic supply-vs-demand alignment.

```
   demand    supply
    Mon  18    18  ✓
    Tue  18    18  ✓
    Wed  18    16  ⚠ −2
    Thu  18    18  ✓
    Fri  16    14  ⚠ −2
    ────────────────
    week 88    84  ⚠ short 4
```

### `Commit.DraftBar` (publish-mode of Commit.Bar)

```
  ─────────────────────────────────────────────────────────────
  Draft · 7 changes              [Review diff]  [Publish]  […]
  ─────────────────────────────────────────────────────────────
```

### `RosterGrid`

Workforce preset of `AssignmentBoard` with day/aft/night palette.

```
                     Mon     Tue     Wed     Thu     Fri     Sat     Sun
     day             A,B,C   A,B,C   A,B,D   A,B,D   A,B     A       —
     afternoon       D,E     D,E     C,E     C,E     C,D     B       B
     night           F       F       F       F       F       F       F
     ─────────────  ─────   ─────   ─────   ─────   ─────   ─────   ─────
     coverage        ✓       ✓       ⚠       ✓       ⚠       ✓       ⚠
```

---

## §2.6 Frame & trust — anchor `DecisionJournal` (`Communicate.Journal`)

### `Header` (section / subsection)

```
breadcrumb        Dashboards / Procurement Q3
title             Procurement run — v3
meta              model v3.4 · last commit 2h ago · author A.Patel
                                              [ Run again ]  [ … ]
```

### `Trust.Chip`

Single-line, inline. `state: ok | running | dirty | error`. Pulse
when running.

```
[ ● live ]    [ ● ok 2m ago ]    [ ⚠ dirty ]    [ ✗ error ]
```

### `Trust.Stamp`

```
model v3.4 · trained 2025-03-04 · sources 6/6 fresh · audit →
```

### `Trust.Footer`

Long-form. Below page or card content.

```
─────────────────────────────────────────────────────────────────
provenance
  model     procure-v3.4         trained Mar 4, 2025
  inputs    POS-snapshot          fresh 8m   ●
            demand-signal         fresh 14m  ●
            competitor-index      stale 12h  ○
            regulator-alerts      probe pending  ?
  audit     [open audit trail →]    methodology  [open →]
─────────────────────────────────────────────────────────────────
```

### `Trust.Trail` ≡ `AuditTrail`

Timeline of committed patches.

```
AUDIT TRAIL · last 7 days
●  May 11 · 14:03  A.Patel  apply rec — Move 3 SE shifts to Cho
                            [ diff ]   [ revert ]
○  May 10 · 17:22  A.Patel  override — Reorder SKU-001
                            note: "vendor Wed lead time slip"
                            [ diff ]   [ revert ]
○  May 9  · 09:45  J.Chen   approve — promo end-date change
                            [ diff ]   [ revert ]
```

### `Banner.Stale`

```
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
⚠ Data older than 12h. Recommendations may be stale.
   auto-refresh in 02:38                       [refresh now]
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```

### `Banner.Partial`

```
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
We could only get 4 of 6 sources. [retry] [details]
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```

### `Banner.ChangeSinceLastVisit`

```
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
3 changes since you last looked.        [show diff]
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```

### `Banner.Guardrail` (cross-listed in §2.5)

```
⚠ This change has consequences …
   Raising buffer p95→p99 increases OT $14k/week.
                            [recompute]   [accept anyway]
```

### `Communicate.Message`

```
COMPOSE · to ─ [ ▾ J.Chen · jchen@elara.ai ]
SUBJECT       Approving SE shift moves
BODY (auto-filled from briefing)
   Approving model rec — move 3 SE shifts to Cho.
   Reasoning — SE forecast +14%, Cho under cap.
   Risks      — Patel prefs (raised Mar, see audit).
   Audit       [link]
                            [ Send ]   [ Send + flag for sign-off ]
```

### `Communicate.Handoff`

Read-only summary of what fires when the user commits.

```
ONCE COMMITTED · this triggers
 → Patel        notification of shift change       [ auto ]
 → Payroll      hours adjustment                   [ auto ]
 → Roster lead  review next week's plan         [ task created ]
```

### `Communicate.Journal` ≡ `DecisionJournal` *(anchor)*

Free-text per-decision entries, threaded through the user's audit.

```
WEEK OF May 4 · 14 decisions
─────────────────────────────────────────────────────────────
May 6 · approved Cho shift swap.
        "Going with the model — Patel hours legitimate concern."
May 7 · overrode SKU-001 reorder.
        "Vendor told me Wed lead-time slip — model didn't see."
May 8 · modified promo end date.
        "Customer relationship — keep it tidy."
                                                  [ + new entry ]
```

### `PermissionGate` / `AccessDeniedState`

```
     ┌─────────────────────────────────────────┐
     │              ▢▢                         │
     │           ▢▢    ▢▢                      │
     │              ▢▢                         │
     │   You don't have access to this view.   │
     │   Ask your admin or open a request.     │
     │                                         │
     │             [ request access ]          │
     └─────────────────────────────────────────┘
```

### `ComputeError` / `ErrorBoundary`

```
     ┌─────────────────────────────────────────────────┐
     │ ✗ Couldn't run the optimiser                    │
     │                                                 │
     │ infeasible — buffer p99 + tight SLA exceeds     │
     │ available worker hours by 14 (week of May 18).  │
     │                                                 │
     │ inputs — [open snapshot →]                      │
     │ logs   — [open log →]                           │
     │                                                 │
     │              [ relax SLA ]   [ retry ]          │
     └─────────────────────────────────────────────────┘
```

### `KeyboardShortcutsOverlay`

```
┌─────────────────────────────────────────┐
│ KEYBOARD                  filter ____  ✕│
├─────────────────────────────────────────┤
│ GLOBAL                                  │
│   ⌘K          open command palette     │
│   /           focus search             │
│   ?           open this overlay        │
│   Esc         dismiss                  │
│ TABLE / LIST                            │
│   j / k       next / previous row      │
│   ↵           open focused row         │
│   x           multi-select toggle      │
│ DECIDE                                  │
│   ⏎           apply                    │
│   m           modify                   │
│   o           override                 │
└─────────────────────────────────────────┘
```

---

## Cross-cutting conventions

- **Patches not callbacks.** Every Decide / Configure pattern emits
  an East `Patch<TState>` rather than an opaque handler. Preview
  (`East.applyPatch`), composition (`East.composePatch`), and undo
  (`East.invertPatch`) all share one shape.
- **Status colour is always paired with an icon.** Never rely on
  hue alone (UX/UI Guide §11). Pair red border + red helper text;
  pair the dot with a word.
- **Numerals stay in JetBrains Mono with `tabular-nums`.** Tables,
  deltas, axes, ranges — all align across rows and re-renders.
- **No `level: "page"` for `Header`.** east-ui doesn't own page
  chrome; the host shell does (UX/UI Guide §15).
- **Drag-and-drop pairs with a keyboard fallback.** `DnD.KeyboardMove`
  is required, not optional.
- **Reference patterns are inset, not modal.** They live alongside
  the briefing, not in dialogs that interrupt flow.
- **Capture-to-audit on every commit.** The audit is the source of
  truth for `Track.*`, `Communicate.*`, and `AuditTrail`.

---

## Mockups index (HTML, pixel-perfect — older taxonomy)

The HTML mockups in `./design-mockups/` predate this taxonomy
revision. They show the visual treatment but use the older pattern
names. When in doubt, this file is the source of truth.

| Mode               | Mockup file |
|--------------------|---|
| §2.1 Observe       | [`design-mockups/patterns-2.1-observe.html`](./design-mockups/patterns-2.1-observe.html) |
| §2.2 Diagnose      | [`design-mockups/patterns-2.2-explain.html`](./design-mockups/patterns-2.2-explain.html) |
| §2.3 Decide        | [`design-mockups/patterns-2.3-decide.html`](./design-mockups/patterns-2.3-decide.html) |
| §2.4 Compare       | [`design-mockups/patterns-2.4-compare.html`](./design-mockups/patterns-2.4-compare.html) |
| §2.5 Configure (form) | [`design-mockups/patterns-2.5-configure-a.html`](./design-mockups/patterns-2.5-configure-a.html) |
| §2.5 Configure (allocation) | [`design-mockups/patterns-2.5-configure-b.html`](./design-mockups/patterns-2.5-configure-b.html) |
| §2.6 Frame & trust | [`design-mockups/patterns-2.6-frame-trust.html`](./design-mockups/patterns-2.6-frame-trust.html) |

Tokens shared across mockups: [`design-mockups/colors_and_types.css`](./design-mockups/colors_and_types.css).
