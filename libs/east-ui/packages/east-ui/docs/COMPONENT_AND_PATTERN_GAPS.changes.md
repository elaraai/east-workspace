# Proposed changes — triage sheet

Every row below is a concrete proposed change to `COMPONENT_AND_PATTERN_GAPS.md`. Derived from the three-lens critical review (decision-science, UX, UI-developer).

**Instructions:**
- Delete rows you disagree with.
- Edit wording if you want the change reshaped.
- Leave remaining rows as-is and I'll apply them.

**Effort legend:** S = small edit / one paragraph · M = new rows in existing tables · L = new section or restructuring.

---

## A. Decision-science additions

| ID | Proposal | Rationale | Effort |
|---|---|---|---|
| DS-1 | Add **Predict mode** (or explicitly extend Observe) with `ForecastView` pattern — observed history + forecast band + confidence envelope. | Canonical analytic modes are descriptive / diagnostic / predictive / prescriptive. "Predictive" is absent from the six modes. | M |
| DS-2 | Add `ProjectionToTarget` pattern — current trajectory vs committed target with gap marker. | Every LOB app with a target needs this view; today composed ad-hoc. | S |
| DS-3 | Add **Measure mode** (or Measure patterns under Trust) for ex-post evaluation of commits: did the prescribed action deliver the predicted impact? | Prescriptive loops close with measurement. Without it, users can't calibrate trust in the recommender and the system can't learn. | M |
| DS-4 | Add `OutcomeScorecard` / `ActualVsPredictedChart` pattern for model-performance tracking over time. | Supports DS-3. | S |
| DS-5 | Change `DeltaPill.magnitude` from `positive-is-good \| positive-is-bad` to `higher-is-better \| lower-is-better \| target-is-best(target, tolerance)`. | Covers non-monotonic KPIs (utilisation, staffing, concentration, inventory cover). Current binary shape is wrong. | S |
| DS-6 | Extend `Provenance.Footer.sources` item to `{ name, connected, updatedAt?, latency? }` with per-source freshness visuals. | Sources have different latencies; flat "connected/disconnected" hides staleness. | S |
| DS-7 | Add `SegmentedView` pattern — break one number down by region / SKU / shift / cohort. | "On-track 91%" — of what? Every LOB KPI has an implicit denominator; cohort view is a distinct task from master-detail. | M |
| DS-8 | Extend `DeltaPill` (or sibling `StatisticalDelta`) with `{ value, ci: [low, high], significant: boolean }`. | Users need to know if a −11% delta is signal or noise. | S |
| DS-9 | Pull `LineageTrail` forward as a **minimal list-style** pattern (simple `source → transform → model → output` list with per-node status chips). Defer the DAG-graph visual until `NodeGraph` lands. | Data lineage is a regulatory-compliance blocker (finance, healthcare, pharma). Can't wait for advanced charts. | M |
| DS-10 | Add `SensitivityView` pattern that unifies `AssumptionsBar` + `WhatIfList` + `PresetPicker` into a single sensitivity workbench. | The user task ("what drives this outcome, and how sensitive is it?") is one job spread across three patterns today. | M |
| DS-11 | Rename `CoverageAlignmentView` → `SupplyDemandView`; broaden signature to cover inventory-vs-forecast, budget-vs-burn, capacity-vs-orders. | Current name implies a specific axis pair; the pattern is more general. | S |
| DS-12 | Add `CommitApproval` / `MultiPartyCommit` pattern for decision-rights / approver-chain workflows (two-person approval, over-threshold approval). | `PermissionGate` covers view-rights but not commit-rights; every regulated LOB app needs this. | M |

## B. UX additions

| ID | Proposal | Rationale | Effort |
|---|---|---|---|
| UX-1 | Add a front-matter **user-journey index** to the top of the doc: scan → flag → inspect → explain → decide → commit → track, each mapped to the patterns that serve it. | Makes the doc navigable by task, not just by component name. Doubles author discoverability. | M |
| UX-2 | Prefix each pattern entry with a **Mode tag + "question it answers"** line (e.g. "Mode: Observe. Question: What's happening right now?"). | Mode-to-pattern mapping is invisible in names; this surfaces it. | M |
| UX-3 | Add `CommitStrength: "trivial" \| "standard" \| "guarded" \| "irreversible"` to `ActionCard.primary` / `DecisionBar.primary`. Renderer picks one-click / confirm / typed-confirm+audit-note automatically. | Differentiated commit friction avoids confirmation-fatigue click-through on critical actions. | S |
| UX-4 | Add `DnD.KeyboardMove` fallback as a required pairing with `DnD.Draggable` — Space pickup, arrow-keys move, Space drop, Esc cancel. Spec'd in §0.2 as a hard a11y contract, not optional. | WCAG 2.2 requires it; §0.2 currently asserts keyboard path but doesn't describe the DnD alternative. | S |
| UX-5 | Allow **per-component density override**: `StatCard.density?: DensityType` etc. — overrides the inherited cascade. | KPI rail stays comfortable while the 200-row table goes condensed. Global-only density is wrong. | S |
| UX-6 | Add `TimeScaleControl` primitive — quarter / month / week / day / hour selector. Used by `Gantt`, `Planner`, `ForecastView`, any time-axis chart. | Every time-axis UI builds its own today. | S |
| UX-7 | Add `AttentionList` / `TopSignals` pattern — auto-prioritised 3–5 things deserving attention right now, computed from thresholds × freshness × severity. | LOB dashboards are used by tired humans under time pressure; you need a "look here first" surface. | M |
| UX-8 | Add a **model-trust meter** — either a new `ModelTrustMeter` pattern or extend `UncertaintyBadge` with `historicalAccuracy?: Float` ("model was right 87% of the time on comparable cases in the last 90 days"). | Trust calibration needs historical context, not just per-prediction confidence. | S |
| UX-9 | Add **verbosity** dimension alongside density: `verbosity: "minimal" \| "standard" \| "detailed"` flowing through Box. Controls per-pattern narrative-vs-data ratio. | Senior planners want numeric-heavy; new planners want narrative explanations. Same app, different users. | M |
| UX-10 | Add `PartialResultsNotice` pattern — "Showing X of Y; here's what's missing and why." | Partial failure (3 of 5 regions computed) is the common case, not total failure. `ComputeError` only covers the latter. | S |
| UX-11 | Promote `InfoAffordance` from cookbook recipe to a real primitive: `InfoAffordance.Root({ content, richness: "label" \| "brief" \| "structured" \| "interactive" })`. IR picks Tooltip / ToggleTip / HoverCard / Popover based on `richness`. | Cookbook-only guidance will drift. Authors will pick the four primitives inconsistently. | S |
| UX-12 | Add onboarding / first-run patterns: `Tour` (guided overlay), `CoachMark` (inline first-time hints), `FirstRunState` (empty-dashboard with seed actions). | New users open LOB apps and see an empty Table with zero rows and no pointer to anything. | L |

## C. UI-developer structural changes

| ID | Proposal | Rationale | Effort |
|---|---|---|---|
| UI-1 | Consolidate per-component escape-hatch colour props into a single `style` / `cx` struct per component instead of individual top-level props. | ~400–800 string-typed props across the surface with current approach. Chakra v3's `css={…}` shorthand is the pattern. Tradeoff: loses named-prop autocomplete. | M |
| UI-2 | Remove `labelColor` / `valueColor` from `MetricDef` data struct; add parent-level `styleBy: (item, index) => { labelColor?, valueColor? }` on `MetricRail` / `StatGrid`. | Decouples data from presentation; makes server-sourced metric lists clean. | S |
| UI-3 | Change `Table.rowBackground: FunctionType([Integer], String)` to declarative `rowStatus: FunctionType([Integer], StatusTokenType)`. Colour resolved in renderer against theme. | Lambda-per-row × 60fps × 10k rows = 600k calls/sec. Current signature will stall. | S |
| UI-4 | Change `DnD.Draggable.data: T` → `data: Key` (opaque string); renderer resolves to the real object via a side-channel registry. | Arbitrary payload bloats IR snapshot and complicates state-diffing. | S |
| UI-5 | Spec `AssignmentBoard.grid` as a typed cell-addressable child interface (`CellAddressableComponent`), not plain `UIComp`. | Board must reason about drop cells; opaque UIComp hides the contract. | M |
| UI-7 | Specify, per §0 promise (paired icon, focus-trap, reduced-motion), **where enforcement lives** — IR factory vs renderer. Today this is hand-waved. | Without a location, different renderers will enforce inconsistently. | S |
| UI-8 | Move shared "pattern primitives" (`MetricChip`, `ChipRail`, `EditableChip`, `OptionList`) from `@elaraai/east-ui-patterns` into `@elaraai/east-ui` proper (§1.7 / §1.2 / §1.9). | They're primitives by every definition — stable API, no domain knowledge, no composition of higher patterns. | S |
| UI-9 | Add explicit bundle-size / dependency plan: dnd-kit, kbar/cmdk, Radix ScrollArea, TanStack Virtual. Peer-dep vs bundled, code-split per chart/overlay, tree-shaking commitment. | Bundle budget for embedded LOB apps is real; today it's unaddressed. | M |
| UI-10 | Spec the `Reactive.Root` + `State.bind` interaction rule for new patterns — always require caller to wrap | Author-trap today: forget to wrap and the pattern won't update, but thats the devleopers problem, it probably should just use callbacks like existing components, the developer can then call state etc like they would for the inputs ?? | S |
| UI-11 | Add a **versioning / migration plan**: codemods for renames, a `v3-compat` re-export shim for breaking changes, a deprecation window. | Break it all. No need for backwards compat. | L |
| UI-12 | Add **doc-rot mitigation**: either (a) generate the "current" column from source `types.ts` at build time, or (b) CI-enforce gap tests — a script that reads the doc and asserts every `✓` has a source file, every `⚠` has an open tracker issue. | 535 lines hand-maintained will drift in weeks. | M |
| UI-13 | Populate the `States` and `A11y` columns of every pattern row in §2 — don't elide for readability. Unpopulated = un-enforced. | §0.1/§0.2 promise is hollow otherwise. | L |
| UI-14 | Restrict `Header.level` to `"section" \| "subsection"` (drop `"page"`). East-ui doesn't own the page — the host shell does. | Coherent with "no AppShell" scope decision. | S |
| UI-15 | Clean up recipe-vs-pattern classification: `DeltaBreakdown` (recipe ✓), `ConflictAnnotator` (→ recipe, shape is grid-dependent), `LineageTrail` (→ recipe-on-Timeline until NodeGraph lands). | Current classification is inconsistent — see §2.8. | S |

## D. Doc-structure improvements

| ID | Proposal | Rationale | Effort |
|---|---|---|---|
| DOC-1 | Add an explicit **"Recipes vs Patterns" definition** section at the top of §2, with the test: *same props/behaviour/states across apps → pattern; apps tweak columns/composition → recipe*. | Current doc uses the distinction loosely. Author needs it codified to classify future additions. | S |
| DOC-2 | Add a **Recipes** appendix (§3 or cookbook file) listing every recipe the doc references (`DeltaBreakdown`, `ConflictAnnotator`, `InfoAffordance`, `ComparisonMatrix`, the demoted ones) with concrete composition sketches. | Recipes are currently mentioned in passing; no single place lists them. | M |
| DOC-3 | Replace the single `Priority` section with **three tracks**: *primitives track*, *patterns track*, *safety & trust track* — each with its own band-1/2/3. Authors can pick one track to work on. | Current single-list priority hides parallelisable work. | S |
| DOC-4 | Add a **component → pattern consumer** reverse index ("Table is used by: DeltaBreakdown, ValueMatrixEditor, AssignmentBoard, AuditTrail, KeyboardShortcutsOverlay"). | Makes refactor impact visible — change Table, see what breaks. | M |
| DOC-5 | Extract §0 (Conventions) into a separate `CONVENTIONS.md` and cross-link. | §0 applies to every pattern forever; it deserves its own file. The gaps file is a snapshot; conventions are evergreen. | S |

---

## E. Additional decision-science additions (second-pass review)

Second review-pass. The earlier DS-1..12 covered predictive / measure / delta-pill shape / segmentation / sensitivity. These are the rest of the decision-science surface that a scenario-analysis / optimisation-driven LOB tool *actually* needs. Grouped by theme.

### E.1 Optimisation-output interpretation

| ID | Proposal | Rationale | Effort |
|---|---|---|---|
| DS-13 | Add `ParetoExplorer` / `TradeoffCurve` pattern — multi-objective trade-off visual (cost vs service level; risk vs return; throughput vs quality). User picks a point on the curve → commits to a scenario. | Every real optimiser has ≥2 objectives. Today nothing shows "you can't improve X without sacrificing Y." Ad-hoc scatter/line per app. | M |
| DS-14 | Add `InfeasibilityReport` pattern — when the solver says "no solution", show which constraints are binding and suggest relaxations ("raise labour cap by 3 FTE → solvable at +$12k"). | `ComputeError` shows failure but not *why*. OR apps are unusable without infeasibility diagnostics. | M |
| DS-15 | Add `ShadowPriceList` / `BindingConstraints` pattern — dual values, slack, "capacity is binding at Line 3 — adding 2 FTE there yields +$18k/mo". | Shadow prices are high-signal decision-support output; today invisible. Generalises beyond LP to any solver with marginal values. | M |
| DS-16 | Add `ObjectiveTree` pattern — root objective → weighted sub-objectives → current scores and directions. | Users rarely see the objective they're optimising against; making it visible is the difference between trust and confusion. | M |

### E.2 Explainability & trust

| ID | Proposal | Rationale | Effort |
|---|---|---|---|
| DS-17 | Add `CounterfactualExplainer` pattern — "why A, not B?" — minimal-change-to-inputs that would flip the recommendation. Distinct from `DriverList` (why A). | Counterfactuals are the modern XAI standard. Users who distrust the rec ask "why not B?" first. | M |
| DS-18 | Tighten `ActionCard.impact` from `UIComp` to a structured **`ImpactDistribution`** = `{ point: Float, unit, p10?: Float, p90?: Float, confidence?: Float }`. | Free-form `impact: UIComp` loses the distributional information solvers produce. Every solver gives CIs; current shape drops them. | S |
| DS-19 | Add `FlipPoint` / `ElasticityRange` surface on `AssumptionsBar` chips — "at service level < 78%, the plan changes." Distinct from `WhatIfList` (discrete jumps). | Users want breakeven, not discrete alternatives. Key for trust calibration. | M |
| DS-20 | Add `ModelDriftIndicator` pattern — data drift / concept drift / prediction drift indicators. Distinct from data freshness. | Freshness = is the data current. Drift = is the *model* still valid for this distribution. Different regulatory concept. | M |
| DS-21 | Add `RobustnessBadge` / cross-segment-robustness lens — "does this rec improve cost without making service level in Region 3 worse?" | Regulated / multi-stakeholder settings need disparate-impact / per-cohort robustness before a commit. Absent today. | M |
| DS-22 | Add `RiskMatrix` primitive-or-pattern (likelihood × impact grid with cells as risk items). | Every risk-aware LOB tool has this view (compliance dashboards, safety, project risk). Classic and missing. | M |
| DS-23 | Add `WhyChain` pattern composing `ActionCard` rationale → `DriverList` → `LineageTrail` → per-source freshness, as a consistent "drill deeper" trail. | Today these live as separate patterns; a WhyChain gives users one canonical path from recommendation to raw data. | S |

### E.3 Decision lifecycle (not just the moment of commit)

| ID | Proposal | Rationale | Effort |
|---|---|---|---|
| DS-24 | Add `DecisionFreshness` / `PlanValidityWindow` surface — "This plan was valid as of 08:00; inputs have drifted 4.2% since — confidence reduced." Distinct from data freshness. | Recommendations decay. `FreshnessChip` shows data freshness; needs a sibling for *decision* freshness. | S |
| DS-25 | Add **reversibility indicator** on `ActionCard` + `CommitConfirmDialog` — "This change is reversible for 60 min" / "This is irreversible." Shown *before* the commit question, not after. | `CommitStrength` (UX-3) picks friction; users need to *see* reversibility upfront to decide. | S |
| DS-26 | Add `effectiveAt: OptionType(DateTime)` to `ActionCard` / commit surfaces — "Accept now; takes effect Monday 06:00." | Decisions have implementation lag. Currently commits feel instantaneous; they aren't. | S |
| DS-27 | Add `CommitReversal` pattern / `AuditTrail` `onRevert` capability — undo a commit within a window. | AuditTrail is currently read-only; real ops needs rollback. Distinct operation from editing the plan going forward. | M |
| DS-28 | Add `RecommendationFeedback` pattern — structured Accept / Reject / Edit + **OverrideReason enum** (`disagree-with-forecast`, `local-knowledge`, `policy-exception`, `testing-alternative`, `data-quality-concern`, `other-free-text`). Output is training-signal, not just audit log. | Free-text override reasons are poor signal for retraining. Enum-driven → feedback loop to the model. Closes the prescriptive-analytics cycle. | M |

### E.4 Scenario management (beyond 2-way compare)

| ID | Proposal | Rationale | Effort |
|---|---|---|---|
| DS-29 | Add `ScenarioPortfolio` pattern — N-way scenario comparison (baseline + 3–5 strategies) as a matrix of {scenarios × KPIs}. Generalises `VersusHeader` to N. | Real scenario analysis is 3–5 scenarios, not A vs B. Today users compare pairwise and lose the context. | M |
| DS-30 | Add `ScenarioLineage` pattern — "Scenario B was cloned from A with assumption X changed (Δ +5% service level)." Git-style branching visual. | Scenario trees go deep; without lineage users lose track of what's derived from what. | M |
| DS-31 | Add `AssumptionProvenance` — each chip on `AssumptionsBar` carries `source: "policy"|"default"|"user-set"|"inferred"|"last-run"` with a popover showing the provenance detail. | Today an assumption chip says "Service level 85%" with no way to tell if that's policy-mandated or last-run default. | S |
| DS-32 | Add `LockedAssumption` flag — in multi-scenario compare, some assumptions are the shared baseline (locked), others are the dimension of comparison (varied). | Today `AssumptionsBar` is flat; no way to declare which inputs are common vs which are the independent variable. | S |

### E.5 Composite decision surfaces

| ID | Proposal | Rationale | Effort |
|---|---|---|---|
| DS-33 | Add `BudgetedSelection` pattern — pick N from M within a cap (headcount, capex, quota). Running sum + over/under badge. | "Pick 3 of these 8 interventions within your $500k capex" — classic MCDM interface. Currently ad-hoc per app. | M |
| DS-34 | Add `PlanDiffSummary` pattern — "what changed since the last approved plan" (committed-vs-committed, not scenario-vs-scenario). Distinct from `DiffView` (structural) and `ChangeSinceLastVisit` (user-visibility). | Every approved-plan rhythm needs a "what's new this week?" summary. Currently nothing surfaces it cleanly. | S |
| DS-35 | Add `ComplianceExport` recipe — one-click "every recommendation in Q3, its inputs, acceptors, and outcomes" bundle for regulator / board. | Regulated industries demand this. If east-ui doesn't make it trivial, apps will reinvent (badly). | M |
| DS-36 | Add `ApprovalDelegation` companion to `CommitApproval` (DS-12) — "I'm on leave, delegate my approvals to X until Monday" with audit entry on every delegated commit. | Multi-party approval chains stall when approvers are out. Without delegation the platform becomes a bottleneck. | S |

---

## Summary counts (updated)

- **A. Decision-science (first pass):** 12 proposals (DS-1..12)
- **B. UX:** 12 proposals (UX-1..12)
- **C. UI developer:** 14 proposals (UI-1..5, UI-7..15 — UI-6 removed)
- **D. Doc structure:** 5 proposals (DOC-1..5)
- **E. Decision-science (second pass):** 24 proposals (DS-13..36)
- **Total:** 67 items

Delete rows you disagree with. I'll apply the remainder in a single pass.
