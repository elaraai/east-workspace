# Patterns review — evidence for judgement

> Review of [`PATTERNS.md`](./PATTERNS.md). Anchored to the *frontline business decision-maker* — not data scientist, not OR engineer, not value-chain analyst.
>
> This pass tightens v2 in three places: (1) collapses sprawling individual patterns into a small set of **families** with shared contracts; (2) audits **visual vs text balance** explicitly and names which patterns are visual-led; (3) shows **concrete shapes** for every new pattern so "is this literally printed text?" gets an answer.
>
> Tag legend: `[ADD] [DROP] [DEMOTE] [RECAST] [MERGE] [SPLIT] [PROMOTE] [MOVE]`.

---

## The frame

The user is a **frontline business decision-maker** — demand planner, store ops lead, buyer, scheduler, category manager, pricing analyst, brand manager, account lead.

- **5–15 minutes per decision**, queue of dozens-to-hundreds per week
- **Private information the model can't have** — relationships, conversations, regulatory whispers, weather they saw out the window
- **Accountability for outcomes** — they get evaluated, they know it
- **A boss, peers, downstream consumers** who'll see what they decided
- **Years of domain judgement** the model approximates but doesn't replace

Their job: **commit a defensible decision quickly that combines what the model knows with what they know**, maximising overall and local objectives. The platform's job, in their language: *give me the evidence I need to trust, modify, or override this rec — fast — and let me show my working when someone asks*.

## Decision archetypes

Six archetypes; the catalogue today serves only #4 (Strategic) well.

| # | Archetype | Cadence | Stakes | What they need most |
|---|---|---|---|---|
| 1 | **Routine** — daily reorders, rosters, replenishment | Many/day | Low | Spot exceptions; bulk-accept routine. Model's job is *not waste their attention*. |
| 2 | **Exception** — model flagged something unusual | Few/week | Mid | Why is this different from normal? Safe override path. |
| 3 | **Commitment** — promise to customer/partner | Many/week | Mid–High | Confidence band; backup plans; relationship context. |
| 4 | **Strategic** — quarterly plan, supplier switch, pricing reset | Few/quarter | High | Briefing format; alternatives considered; sensitivity; sign-off chain. |
| 5 | **Reactive** — supplier failure, demand shock, outage | Rare, urgent | High | Situation summary; narrowed choice set; fast commit; downstream notify. |
| 6 | **People** — hiring, performance, scheduling exceptions | Mid | Mid–High | Fairness check; process traceability; bias guardrails. |

## What "evidence for judgement" actually means

For a frontline manager, evidence is:

1. **The recommendation as an argument** — claim, because, upside, risks, unknowns, ask
2. **What the model doesn't know** — *epistemic* gaps, not just aleatoric uncertainty
3. **Stakes in human terms** — *"$80k · 3 people · reversible 24h"*, not button colour
4. **Reference class** — *"last 12 like this you accepted 9, were right 7"*; *"3 of 5 peers chose X"*
5. **Risks named in plain language**, not buried in CIs
6. **A clean way to commit / modify / override with reason captured** — defensible later
7. **Their own track record** — where their judgement adds vs subtracts value

---

## Visual / text balance — audit

The existing catalogue is roughly half visual-led, half text-led, with a healthy mix of densities. My v2 additions skewed text-heavy because I described them as prose without thinking about the visual primitive that would actually carry them.

| | Visual-led | Text-led | Hybrid |
|---|---|---|---|
| **§2.1 Observe (today)** | StatCard, StatGrid, MetricRail, ListDetailLayout, AttentionList, ThresholdBand | FilterBar, SearchResultsSummary, PartialResultsNotice, FirstRunState | LegendRail, SegmentedView |
| **§2.A Predict (today + new)** | ForecastView, ProjectionToTarget, BaselineVsAction, OutcomeRange, ScenarioReadiness | UncertaintyBadge | — |
| **§2.2 Diagnose (today + new)** | DriverList (bars), IndicatorCluster (dots), LineageTrail, ActualVsPredictedChart | WhyThisRec, ChangedSinceLastTime, DeltaBreakdown | — |
| **§2.3 Decide (today + new)** | AssignmentBoard, AlternativesList, JudgementScorecard | RecommendationBriefing, JudgementPrompt, OverrideWithReason | DecisionQueue, ActionCard |
| **§2.4 Compare (today + new)** | DiffView, DeltaPill, ParetoFrontier *(dropped)*, BeforeAfterTimeline | WhatChanged, ContextSelector, VersusHeader | — |
| **§2.F Calibrate (new)** | JudgementScorecard, ModelLimitTimeline, ActualVsPredictedChart | LessonLearned, OutcomeAnnotator | — |
| **§2.5 Configure** | CalendarHeatmap, ValueMatrixEditor, AssignmentBoard, SupplyDemandView | ParameterFormSection, GuardrailNotice | AssumptionsBar, PresetPicker, SensitivityView |

**The key insight from this audit:** evidence patterns are most powerful when they have a visual scaffold. Reference-class data is a population — that's a chart. Stakes are a magnitude — that's a bar. Peers are people — those are avatars. Track records are time series — those are sparklines.

`[FIX]` Every new pattern below is given a visual scaffold, not just a text slot. Where text is the right primitive (e.g. the briefing paragraph), it's a *named slot*, not "render some text".

---

## What these new patterns actually look like

Concrete shapes for the anchor patterns and the new evidence patterns. Each is described as a slotted region with named visual elements, not "a card with text".

### `Recommendation.Briefing` — replaces `ActionCard` (Decide anchor)

```
┌──────────────────────────────────────────────────────┐
│ ▎ Recommended action                  [stakes-tag]   │
│ ▎                                                    │
│ ▎ Move 3 SE shifts from Patel → Cho                  │
│ ▎                                                    │
│ ▎ Because:                                           │
│ ▎  • SE-1 forecast +14% vs base (driver: holiday)    │
│ ▎  • Cho is under cap; Patel at 38h                  │
│ ▎  • Past 5 similar moves all reduced OT             │
│ ▎                                                    │
│ ▎ Upside: −$8.4k OT this week                        │
│ ▎ Risks:  Patel weekend prefs (last raised Mar)      │
│ ▎ We don't know: Cho's school-pickup arrangement     │
│ ▎                                                    │
│ ▎ [Apply]  [Modify]  [Override + why]                │
└──────────────────────────────────────────────────────┘
```

Slots: `claim` (1 line) · `because[]` (3 reasons max) · `upside` · `risks` · `unknowns` · `ask` (action buttons). Visual treatment: brand-tinted left rail; stakes chip in top-right; commit affordances at bottom. **Text-led** but with strong visual scaffold and named structure.

### `Decision.Queue` — Observe anchor

```
┌──────────────────────────────────────────────────────┐
│ 7 decisions waiting · 3 past SLA           [filter]  │
├──────────────────────────────────────────────────────┤
│ ⚠ overdue 2h │ Reorder · SKU-001 · 2k units  $42k    │
│              │ accept ── modify ── override          │
├──────────────────────────────────────────────────────┤
│ ⏱ due 4pm   │ Promo · Easter clearance       $128k   │
│              │ accept ── modify ── override          │
├──────────────────────────────────────────────────────┤
│ ⚪ routine  │ Reorder · SKU-014  ··· ·· ··    $1.2k  │
│ ⚪ routine  │ Reorder · SKU-018  ··· ·· ··    $0.8k  │
│ ⚪ routine  │ Reorder · SKU-022  ··· ·· ··    $0.4k  │
│              │   ▲ 3 routine — [accept all]          │
└──────────────────────────────────────────────────────┘
```

Slots: count + SLA · per-row {urgency-glyph, label, stakes, inline commit} · routine-collapse with bulk-accept. **Visual-led** — sorted urgency, grouped routines, one-click bulk action.

### `Predict.BaselineVsAction` — Predict anchor (replaces `ProjectionToTarget` headline)

```
┌──────────────────────────────────────────────────────┐
│ If you do nothing      → $1.94M                      │
│ If you follow the rec  → $2.02M  ← target $2.00M     │
│                                                      │
│ ──────────── do nothing ────                         │
│            ╲                                         │
│             ╲────                                    │
│ ───── follow rec ──── ↗                              │
│                                                      │
│ Value of acting: +$80k · 88% confidence              │
└──────────────────────────────────────────────────────┘
```

Slots: two trajectories overlaid; the *gap* is the value of the recommendation. **Visual-led** — chart with two lines, gap labelled.

### `Reference.*` — reference-class evidence family

One contract: a small inset card with a visual proof. Five members, all visual-led:

#### `Reference.Similar` — your past
```
Last 14 like this you've seen
●●●●●●●●●●●●○○                Accept 12 · Override 2
↑                              Right 11 · Wrong 3
most recent                    [see all →]
```
Strip of dots; each clickable. Green = right, red = wrong, hollow = unknown.

#### `Reference.Peers` — what others did
```
Your peers in similar cases (last 30d)
[👤A][👤K][👤M] [👤J][👤R]
 — Accepted —    — Modified —
3 of 5 · majority: accept
```
Avatar pills grouped by decision.

#### `Reference.Base` — population stats
```
Recs of this kind work
████████████░░░░░  73%   (n = 84, last 90d)
```
Filled horizontal bar with sample size.

#### `Reference.Novelty` — *no* reference class
```
⚠ UNUSUAL  No comparable cases in 12 months
            top 3% novelty for your sector
```
Warning pill + plain-language explanation.

#### `Reference.Lesson` — past failure pattern
```
⚠ Last time you saw this kind of rec (Mar 18)
   it was wrong — the model missed regulator timing.
   [see what happened →]
```
Inline callout when the same shape has burned the user before.

### `Judgement.*` — capturing the human contribution

Family contract: a region where the user's input changes the recommendation, and the input is captured for audit. Four members:

#### `Judgement.Prompt` — name the human-shaped variable

```
┌──────────────────────────────────────────────────┐
│ ❓ Your judgement matters here                    │
│                                                  │
│ This rec assumes the new supplier hits 92%       │
│ on-time delivery. Based on 3 months of data;     │
│ you've spoken to them more recently.             │
│                                                  │
│ Your confidence in 92%:                          │
│  ─────────────●──────                            │
│  low                  high                       │
│                                                  │
│ ▼ If you say <60%: rec drops to runner-up        │
│   (sourcing from existing supplier instead)      │
│                                                  │
│              [Save my read]                      │
└──────────────────────────────────────────────────┘
```

So no, **not "literally printed text"**. It's a card with: question slot · response control (slider / Likert / agree-disagree) · **live consequence preview** (what happens if user disagrees) · save button. The user's response is captured to the audit alongside the decision. The control type is configurable — slider, scale, picker — but the live consequence is what makes this a pattern, not just a textbox.

#### `Judgement.KnowledgePanel` — invite private info

```
Your turn — anything we should account for?
 ☐ Customer relationship status     [+ note]
 ☐ Recent quality concerns          [+ note]
 ☐ Regulatory changes you've heard  [+ note]
 ☐ Other                            [+ note]

         [Apply to rec]   ← re-runs with your input
```

Structured prompts × free-text affordance. "Apply" re-runs the rec with the user's input as additional context; the resulting change shows as a `Reference.Similar`-style before/after.

#### `Judgement.Gap` — what the model doesn't know (no input asked)

```
What we don't know
 ✗ Customer's recent satisfaction (data >30d old)
 ✗ Competitor's price (last update 6w ago)
 ✗ Local weather (model degrades >7d)
```

Pure read — names epistemic gaps so the user knows where to bring private info. Pairs with `KnowledgePanel` — the panel is where they put it back in.

#### `Judgement.Inject` — the user's-info-changes-the-rec flow

```
Before:  rec = Move 3 shifts to SE
You add: "Cho mentioned school pickup constraint Tue"
After:   rec = Move 2 shifts to SE, hold one open
         Δ: −$2k saved less, but feasibility +12pp
```

A flow, not a single card — it's the wrapper around what `KnowledgePanel.Apply` actually does.

### `Stakes.*` — communicating consequence

#### `Stakes.Tag` — inline chip
```
[ Stakes ]  $80k  ·  3 people  ·  reversible 24h
```
A structured chip with key facts.

#### `Stakes.Radius` — visualised scope
```
        ┌─ direct ─────────────────────────┐
        │  3 workers (Cho, Patel, Nguyen)   │
        │  1 customer (Acme)                │
        ├─ touches ────────────────────────┤
        │  SE region team                   │
        │  Finance KPI dashboard            │
        ├─ knock-on ───────────────────────┤
        │  Weekly board report              │
        └───────────────────────────────────┘
```
Concentric rings showing decision scope. Each ring's content is named, not just counted.

### `Track.*` — the user's track record

#### `Track.Scorecard` — Calibrate anchor
```
Your last 90 days · n = 84 decisions
             %    Right
 Accepted    87%  ████████████░░  88%
 Modified     9%  ██░             71%
 Overrode     5%  ▌               75%

 Where you outperform: pricing recs (+12pp vs always-accept)
 Where you underperform: shift swaps (−8pp)
 Net: +$8.2k/wk added vs always-accept policy
```
Visual-led card with action breakdown × hit rate × value-added.

#### `Track.Lesson` — surfaced inline
```
⚠ This kind of rec was wrong for you on Mar 18.
   Reason: model missed regulator timing.
   [details →]
```
Same shape as `Reference.Lesson`; difference is *who* is the actor (the user, not the population).

#### `Track.ModelLimits` — the model's pattern of error
```
Where the model has been worst (last 12 months)
●         Q4 holiday weeks ─── 3 misses
       ●  end-of-quarter promos ── 2 misses
●         supplier-onboarding period ─── 4 misses
[click to filter your queue to these →]
```
Timeline + cluster of past errors.

#### `Track.Annotate` — post-hoc tag what happened
```
Past decision: Move 3 shifts → SE (May 4)
How did it go?
 ○ As expected      ● Slightly off       ○ Off by a lot
 Note (optional): _______________________________________
                  [Save]
```
Single small dialog, surfaced from `AuditTrail`.

#### `Track.Retrain` — feedback into model
```
⚠ Calibration drifting on shift-swap recs
   model 73% right · last 30d: 61%
                      [flag for retraining →]
```
Auto-surfaces when calibration drops below threshold; flags-not-actions (humans approve).

### `Communicate.*` — post-decision workflow

#### `Communicate.Message` — compose decision message
```
[ Compose to:  ▾ My boss · jchen@elara.ai     ]
Subject: Approving SE shift moves
Body (auto-filled):
  Approving model rec: move 3 SE shifts to Cho.
  Reasoning: SE forecast +14%, Cho under cap.
  Risks: Patel prefs (raised Mar, see audit).
  Audit: [link]
[Send]   [Send + flag for sign-off]
```
Composer pre-filled from the briefing; recipient picker; "send + flag" pushes to `CommitApproval`.

#### `Communicate.Handoff` — downstream task
```
Once committed, this triggers:
 → Patel: notification of shift change      [auto]
 → Payroll: hours adjustment                [auto]
 → Roster lead: review next week's plan     [task created]
```
Read-only summary of what fires when the user commits; "task created" rows append to the recipient's queue.

#### `Communicate.Journal` — your record in your voice
```
Week of May 4 · 14 decisions
 May 6 · Approved Cho shift swap.
         "Going with model — Patel hours legitimate concern."
 May 7 · Overrode SKU-001 reorder.
         "Vendor told me Wed lead time slip; model didn't see."
 May 8 · Modified promo end date.
         "Customer relationship — keep it tidy."
```
Free-text per-decision entries, threaded through the user's audit. Distinct from `AuditTrail` (system record) — this is the user's own narrative for next year's review meeting.

---

## Family abstractions — what to ship as one contract, not many

Today the catalogue treats each pattern as standalone. Several are clearly families with one shape and a discriminator:

| Family | Members | Shared contract |
|---|---|---|
| `Recommendation.*` | `Briefing`, `WhyThisRec`, `WhatChanged`, `BaselineVsAction` | All "the rec, framed for the decider". Shared visual scaffold (left-rail, slotted), shared capture-to-audit. |
| `Reference.*` | `Similar`, `Peers`, `Base`, `Novelty`, `Lesson` | All "context from comparable past". Small inset card · visual proof element · sample size · click-to-drill. |
| `Judgement.*` | `Prompt`, `KnowledgePanel`, `KnowledgeInject`, `Gap` | All "human input alongside the rec". Region · response control · live consequence · capture-to-audit. |
| `Stakes.*` | `Tag`, `Radius` | "Decision consequence in human terms". Two densities (chip + ring-visual). |
| `Track.*` | `Scorecard`, `Lesson`, `ModelLimits`, `Annotate`, `Retrain` | "User's relationship with their / the model's record". Each visual-led; time-anchored. |
| `Communicate.*` | `Message`, `Handoff`, `Journal` | "Decision handoff out of the platform". Composer / task-list / journal. |
| `Trust.*` | `Chip`, `Stamp`, `Footer`, `Trail` | Already proposed. Same content at four densities. |
| `Banner.*` | recipes for stale / partial / change-since / guardrail | Already proposed. One primitive, named recipes. |
| `Commit.*` | `Decision`, `Bar`, `BatchBar`, `DraftBar`, `Confirm`, `Approval` | Already proposed. All "apply patch with friction X". |
| `InputBand.*` | `AssumptionsBar`, `FilterBar`, `ParameterFormSection` | Already proposed. Editable inputs that emit a patch. |

Family-isation collapses ~30 standalone patterns into 10 contracts. Same surface area, far less drift.

---

## What's structurally wrong (re-stated under family lens)

Nine problems, ranked by leverage. Each is a structural critique, not a styling note.

### 1. Recommendations are decorative cards, not arguments
`[RECAST]` Replace `ActionCard` with `Recommendation.Briefing` — slotted, narrative-shaped (claim · because · upside · risks · unknowns · ask), with strong visual scaffold.

### 2. Human private knowledge is not a first-class input
`[ADD]` `Judgement.*` family. Four members with shared contract: input control + live consequence + capture.

### 3. Stakes are coded as friction, not communicated as evidence
`[ADD]` `Stakes.*` family — humanised tag + ring-visual radius. Pairs with (doesn't replace) `commitStrength`.

### 4. Track record is absent — both the user's and "people like you"
`[ADD]` `Reference.*` family + `Track.*` family. Five reference-class members; five track-record members. Together they raise the decision-quality floor more than any other change.

### 5. Peers, bosses, and policy are invisible
`[ADD]` `Reference.Peers` (covers peer signal) + `EscalationPath` (single pattern, lightweight). Heavyweight case stays in `CommitApproval`.

### 6. The model's *limits* aren't visible — only its uncertainty
`[ADD]` `Judgement.Gap` (read-only — what we don't know) + `Reference.Novelty` (no comparables) + `Track.ModelLimits` (where it's been worst). Three patterns, three different angles, all visual.

### 7. Communication is missing as a workflow
`[ADD]` `Communicate.*` family — Message, Handoff, Journal. Three patterns, one workflow.

### 8. Calibrate is about the model, not the user
`[RECAST]` Calibrate centres on `Track.Scorecard` (user's record) with model-side patterns (`OutcomeScorecard`, `ActualVsPredictedChart`) as tiles within it.

### 9. Predict mode treats forecasts as charts, not as decision inputs
`[ADD]` `Predict.BaselineVsAction` (do-nothing vs act, gap labelled), `Predict.OutcomeRange` (likely / plausible / extreme in plain language), `Predict.ScenarioReadiness` (rec robust across futures?). All visual-led.

---

## What I previously proposed and now retract

| | Why drop |
|---|---|
| `SolverProgress`, `OptimizationSession`, `InfeasibilityExplainer` | Builder/ops, not decider. Belong elsewhere. |
| `ParetoFrontier`, `ObjectiveWeights`, `TradeOffMatrix` | Frontline managers don't think in weighted-objective frontiers. The decider's version is `Recommendation.Briefing` + `RecVsRunnerUp`. |
| `NodeFlowDiagram`, `EchelonView`, `BottleneckHeatmap`, `ServiceCostFrontier`, `DisruptionScenario` | Value-chain analyst patterns; not load-bearing for the frontline decider. |
| `CausalDiagram`, `ConstraintBindingList` | DAGs for analysts. Decider version is the narrative paragraph in `Recommendation.Briefing`. |
| `CounterEvidence`, `FramingToggle` | Too clever-academic. Subsumed into the `risks` slot of `Recommendation.Briefing`. |

---

## Final taxonomy

7 modes; pattern surface organised around 10 families:

```
ANALYTICAL MODES (the user's working modes)

  §2.1 Observe       — anchor: Decision.Queue
  §2.A Predict       — anchor: Predict.BaselineVsAction
  §2.2 Diagnose      — anchor: Recommendation.WhyThisRec
  §2.3 Decide        — anchor: Recommendation.Briefing + Judgement.* + Reference.*
  §2.4 Compare       — anchor: Recommendation.WhatChanged
  §2.F Calibrate     — anchor: Track.Scorecard

CROSS-CUTTING (chrome)

  §2.5 Configure     — anchor: AssumptionsBar (InputBand.*)
  §2.6 Frame & trust — anchor: Trust.Stamp + DecisionJournal
```

**Pattern families by mode** (anchors in **bold**):

| Mode | Families used |
|---|---|
| Observe | **Decision.Queue**, AnomalyList, Stat\*, Filter (InputBand) |
| Predict | **Predict.\*** (BaselineVsAction, OutcomeRange, ScenarioReadiness), UncertaintyBadge |
| Diagnose | **Recommendation.WhyThisRec**, DriverList, IndicatorCluster (→ Configure) |
| Decide | **Recommendation.Briefing**, **Judgement.\***, **Reference.\***, **Stakes.\***, AlternativesList, WhatIfList, Commit.\* |
| Compare | **Recommendation.WhatChanged**, DiffView, RecVsRunnerUp |
| Calibrate | **Track.\***, OutcomeScorecard, ActualVsPredictedChart |
| Configure | InputBand.\* (Assumptions/Filter/Parameter), CalendarHeatmap, ValueMatrixEditor, AssignmentBoard, etc. |
| Frame & trust | Header, Trust.\*, Banner.\*, AuditTrail, **DecisionJournal**, Communicate.\* |

---

## Counts

|   | Today | After |
|---|---|---|
| Modes | 6 | 7 |
| Pattern families | 0 (all flat) | 10 |
| Top-level patterns | ~50 | ~38 |
| of which: dropped from v1's bad direction (OR/builder/analyst) | — | −18 |
| of which: added (decision-maker-shaped, family-organised) | — | +14 |
| of which: consolidated into families | — | 9 → 2 (Banner/Trust) plus 5 new families |

Surface shrinks ~25%. Capability grows: reference-class evidence, judgement-elicitation, track record, post-decision communication, and a recommendation pattern that's actually an argument.

---

## Iteration order

**Stage 1 — name the user, write the persona doc.** Anchors every pattern. No code.

**Stage 2 — ship `Recommendation.Briefing`.** Replaces `ActionCard` as the Decide anchor. One pattern, done right, raises every product on the platform.

**Stage 3 — ship `Decision.Queue` + `Judgement.Prompt` + `Judgement.KnowledgePanel`.** The daily-use loop for a frontline manager.

**Stage 4 — ship `Reference.*` family.** Five members, one contract. The most underused decision-quality lever in the platform.

**Stage 5 — ship `Track.*` family + Calibrate rework.** The user sees their own record, not just the model's. Compounds over time.

**Stage 6 — ship `Predict.*` rework.** Forecasts as decision inputs.

**Stage 7 — ship `Communicate.*`.** Decisions don't end at commit.

**Stage 8 — ship `Stakes.*`, family consolidations, polish.**

Stages 2–4 are the highest-leverage. Stage 5 is what *compounds* over a year. Stages 6–8 round out the system.
