# Decision queue — design

The e3-ui `<DecisionQueue>`, rebuilt to the Claude Design spec "Decision queue
component redesign": one compact queue of the cases the app's models leave to
a person. Each card shows where its change lands — a crop of the builder it
lands in, drawn as that builder draws it — and opening a card shows everything
needed to decide: the options, the change, what it is worth, the question only
a person can answer, the reason, and the four answers, Defer · Override ·
Modify · Apply. The card you act on never moves under you.

The queue is a builder of the e3-ui family and a standalone component: a
`BuilderFrame` with neither pane, and nothing else — one toolbar holding its
count, its rail and its history item, the banners, the list in main, and the
footer with the Save notice and the shared loading line. It draws no border, no shadow and no
close of its own. A host places it as it places any builder — a page's region,
a card, a drawer, a popover — and sizes it.

It reads one of the app's records through roles mapped to the app's fields, as
the Roster and the Schematic do (`Builder Interfaces Spec.md`): the cases,
which the app's models propose, each row holding its verdict — waiting until a
person decides it. The queue writes only the verdict's fields of a case's row,
through the record's patch door. It reads the cases as the Plan and the Sheet
read their rows: whole, or through one `Slice.bindRecords` rail a page at a
time as the list scrolls, in the order the pages come back. A verdict is an
edit of the shared session, as every editing builder's gestures are: a draft
until Save, one step of one history that Undo reverses.

One record holds every kind of decision. What kind a decision is, is the tag
of a variant field of the app's — the option's change — and each tag's value
is a patch of the record that kind of decision changes: the duties a Roster
writes, the jobs a Plan writes, the bins an Allocation writes. The change role
reads the variant and maps each tag to where it draws, `change: { from: o =>
o.change, of: { tag: DecisionQueue.change.roster(…) } }`, as the Roster's
`resource` role maps each case of a variant field to a resource kind. A preview reuses the builder it
shows: a tag that draws in the Roster is declared with the Roster's own kinds,
read through them, drawn with the Roster's own parts, and marked as an
Optimise run's result is marked where it lands. Modify edits the changed rows
in the form the builder's inspector shows for one row. The preview data in the
mock was drawn from those builders' examples; the queue's examples bind those
same example records.

This document is the design. `Decision Queue Spec.html` beside it is the
visual design. Where the two differ, this document wins (§11).

## 0. The files

| File | What it is |
|---|---|
| `Decision Queue Spec.html` | The hi-fi mock: the Claude Design export, its five design components inlined in one page with the design runtime and the East Design System's tokens; self-contained but for React 18 (unpkg, loaded by the runtime), Font Awesome (cdnjs) and the fonts (Google Fonts). §1 the previews — "Where it lands" — each kind of preview and every mark and state on the Plan's; the preview rules; §2 the queue, placed in a 360px popover and on a 390px phone — two placements the export draws, neither of them the component's (§3.4, §11); §3 the behaviour tables, the CSS and the script of the anchoring. `?theme=dark` draws it dark. Its sample data is synthetic, in the domains of the repo's own example records — a warehouse's people and shifts, a print shop's jobs and presses, a kiln yard's loads and kilns, a shop's work orders — and generic operations: a price list, a reorder, a cure-time trial. |
| `Decision Queue Spec.md` | This design. |

**Opening the mock.** Open the file in a browser. In its popover placement,
click a card's head to open it and click it again to close it; `j` and `k`
step between cards; choose an option, answer the question, open Why, add a
note, Modify (the Plan's, the kiln's, the roster's and the price list's cards
have fields), Override…, then Apply — the receipt holds for 5 s, Undo puts the
card back. The Routine band's Apply all shows the batch banner. The phone
placement shows the same queue with no card open. The mock sections its cases,
lets a receipt leave after 5 s and batches its routine cases; the product does
none of these (§11). The mock keeps its verdicts in its own state; the
product's are fields of the case rows, drafts of the session until Save
(§9.4). An agent measures the mock in a headless browser, through its DOM;
nobody reads a screenshot.

## 1. Summary

- **What.** A queue of the cases a model leaves to a person, in the order the
  app's source gives them, each a card with a preview of where its change
  lands. One card is open at a time; deciding it turns it into a receipt in
  place. Every verdict is a draft of the shared session until Save. A queue of
  any size reads only the cases in view, a page at a time, as the Plan and the
  Sheet read their rows.
- **Where.** `<DecisionQueue>`, its kinds and its targets in e3-ui; the
  renderer in e3-ui-components, in a `BuilderFrame`, on the shared parts of
  east-ui-components; the previews drawn with each builder's own renderer
  parts and arithmetic, and Modify with each builder's inspector form.
- **What the app declares.** Its cases — one record, whatever kinds of
  decision it holds, each row carrying its verdict
  (`DecisionQueue.decisions`); in the change role, a target for each tag of
  the change's variant — where that kind of decision draws, built from the
  same consts the app's own builders take (`DecisionQueue.change.*`); and, for
  a rail, its own indexes — one on whether a case has been judged, for
  instance (D18).
- **Built in.** The paged list and its count; the cards, their options,
  figures, question, warning, reason, note and actions; Modify and Override;
  receipts; the session's history, Save, its banners and its Save notice; the
  anchoring that keeps the card you act on still; the previews, their kinds
  and their marks; the keys; the loading line; the narrowing by the rail.
- **Removed.** `Decision.bind` and its handle, the stored decision envelope
  (`Decision.Types.Decision` and its parts), the facets (Evidence, Options,
  Judgement, Modify slots), the lever builder, the queue's old props and its
  recipe, and `<DecisionJournal>` (Q3, §13).

## 2. Decisions

Q1, Q2 and Q3 were ruled by the user on 28 Oct 2026, and D4, D5 and D18 on
30 Oct 2026, when the first design's queue over 20,000 cases opened empty
behind its 1,000-case cap; the rest are this design's.

| # | Decision |
|---|---|
| Q1 | **What Apply writes** (ruled 28 Oct 2026: "Change + verdict"). The change and the verdict: the chosen option's patch, as Modify left it, drafted into its builder's record through its target's kind's own write, and the verdict into the case's own row, one step across both, as accepting a proposal on the Roster drafts the duty and the week's dismissal, and as an Optimise run's result lands as one step; Save commits both. Nothing waits for the app's next run. |
| Q2 | **The session** (ruled 28 Oct 2026: "you could use the edits sessions like we do for the other builder frames"). Verdicts are edits of the shared session, as every editing builder's gestures are: drafts until Save, one history over a session per record the queue writes, the history item at the toolbar's end (D3). |
| Q3 | **The journal** (ruled 28 Oct 2026: "Remove it"). `<DecisionJournal>` is removed with the handle — its tag, its payload and its renderer: the cases and their verdicts are the app's record, shown as the app shows any record of its own — a Sheet over it. |
| D1 | **One record, two writers** (30 Oct 2026, with D18). The cases are the app's record: its models fill it through the app's own mutation (e3's tasks read records and never write them), each new case waiting, and the queue writes only the verdict's fields of a case's row through the record's patch door — `verdict`, and `option`, `answer`, `reason` and `note` where the roles map them (§5.2) — as a builder writes only the fields its roles name. A decided case stays in the record under its key with its verdict. The app's next run reads the verdicts there, as a task reads any record, and the app's own mutation says what a run does with a decided case: drop it, keep it, or set it waiting again. Every case the queue reads is in its list — a waiting one as a card, a decided one as its receipt — so which cases show is the narrowing's (D18). |
| D2 | **Standalone: a `BuilderFrame` and nothing else.** The toolbar (`Decisions` and the count, the rail, the history item), the banners, main (the list) and the footer (the Save notice and the shared loading line, `liveFooter`). No start or end pane. The frame draws no border, shadow or close, and no prop is a placement's: a host places the queue and sizes it (§3.4). The cards inside it draw theirs. |
| D3 | **The session is every editing builder's.** One history over a session per record the queue writes — the cases' record, for their verdicts, and each record a change lands in (Q1) — each verdict one step across them; Undo · Redo · Discard · Save in the history item; ⌘Z, ⇧⌘Z and ⌘Y; Save sends each record's changes through its patch door as a request of its own; a conflict, a refusal or an unknown outcome is the session's banner, with Retry where it applies. The drafts are kept by key under the queue's `id`, whatever the narrowing, a remount or a reload, as the Roster's are. |
| D4 | **Reading, as the Plan and the Sheet read** (ruled 30 Oct 2026: "slice and paging should all be automated … what do things like Plan, Sheet etc do?"). The cases are read whole through `Record.bind`, or through the slice's `decisions` source a page at a time as the list scrolls, in the order the pages come back, the cases not read yet pending cards. There is no cap: the queue never reads every case of a narrowing to sort, section or count it. Its count is e3's count of the narrowing, or the record's size read whole. A case drafted is read by key through `entries`, the record's `Data.bindPaged`, as the Schematic's kinds are read beside their sources. |
| D5 | **No sections: the source's order** (ruled 30 Oct 2026: "it doesn't need to sort by date, they should appear in whatever [order] the paged items appear in"). The cases stand in the order their source gives them — the index serving the rail's choices, or the record's key order read whole — never sorted or grouped by the queue. Each card's due words keep their tone: overdue `--neg-text`, due today `--warn-text`, later `--ink-3`. `routine` marks its card (`Routine`, §8), which is applied on that card as any case is. |
| D6 | **One record, every kind of decision; the tag picks where it draws.** An option's change is a variant field of the app's: its tag is the kind of decision, and each tag's value a `PatchType(DictType(K, R))` of the record that kind changes — the same value that record's `patch: mutation.patch()` takes, what `East.diff` of its rows gives. The change role maps every tag to a target (`of`), as the Roster's `resource: { field, of }` maps each case of a variant field to a kind, and the target's record type must be the tag's (`isTypeEqual`): a tag with no target, or of another type, is refused at build, naming the tag, the record and both types. The records a change lands in are the app's own, the ones its builders edit; the cases are one record, never one a kind. Two tags may share a target, and two targets one record. `of` is typed from the variant `from` returns, which TypeScript infers from `from` alone: its keys are the variant's tags, every one required, and each target's record the one its tag's patch is of — checked when the code compiles and again at build. The target needs no mapping of its own: its kinds are the mapping — `Schedule.events(jobs, { start: "start", resource: { field: "press", of: "presses" } })` already says where a job's start and press are — so the queue reads a patched row as its builder reads it. A Plan's or a Calendar's target holding more than one event kind names the one its tags patch (`event: "job"`). |
| D7 | **The preview's kind comes from the change and its target.** A change landing on at most two of a builder's rows is a crop; on more, a map — the Roster's by people, or by cost where its target says `map: "cost"`; the Sheet crops its first three rows. A record with no builder shows its changed fields, or — given `measure` or `group` — its mix or its groups (§5.3, P3). Decisions that read by cost are a tag of their own, beside those that read by people. |
| D8 | **A preview reuses its builder.** A builder's target takes the props of the builder's own tag, typed as that tag types them — `Pick<RosterProps<R>, …>`, `Pick<PlanProps<K>, …>`, `Pick<CalendarProps, …>`, `Pick<AllocationProps<R>, …>`, the Sheet's `SheetColumnSpec<R>` (§5.3) — the same consts handed to both; reads its rows through those kinds' closed builds; draws them with the builder's own slot recipes at the builder's own sizes, the proposal marked as an Optimise run's result is where it lands (the `elara` glow, the ghosts); and works out each row's measure and its breaches with the builder's own functions (the Roster's hours, rules, check and pay, the Allocation's loads and check, the Calendar's and the Plan's overlaps). |
| D9 | **Modify is the builder's inspector.** Each changed row is edited in the form the builder's inspector shows for one row: its kind's form over its roles and its `fields` (east-ui's `Fields` hints), held by its `ready`, or the kind's own `inspector` where it gives one — the shared `FieldForm`, each input chosen by its East type. The queue declares no fields of its own. Each changed row takes Keep as it is. The edits rewrite the option's patch, so the preview follows them. |
| D10 | **The eyebrow is where the change lands.** The target's `name` and `icon`, then the case's `scope` (`Roster · Inbound · W10`): the mock's areas are the surfaces its changes land in. |
| D11 | **The props are the family's.** `id`, the rail as `slice`, `onSelect` hearing the open case, `readOnly`; the queue's words are its message table's, as every builder's are. |
| D12 | **A card's choices are the viewer's until a verdict.** The option chosen, the answer, the note, Modify's edits and the override form are kept under the queue's `id`, so a card closed or the queue remounted loses none; the verdict makes them one step of the session. |
| D13 | **Every mark is a Font Awesome solid icon** — the options' check and refusal, the empty state, the groups' up and down — never the mock's text glyphs. |
| D14 | **One interface.** The envelope, the handle, the facets, the old props and the journal (Q3) are removed, with no reader of the old forms and no converter (§13), as the builder interfaces were. |
| D15 | **A case may be its own one proposal.** Without `options`, the option's roles sit beside the case's and read the case row: a record whose every row is one proposal — a model's plan, its details a variant — is mapped as it is. The card shows no Options and reads `only option` (R14, R15), so the options' `label` and `note` are not among those roles: a case's `note` is the verdict's (§5.2). The verdict's `option` is none. |
| D16 | **The model says what it guessed.** The option's `guesses` names the changed rows it is unsure of, with its confidence in each; their changed cells take the mock's low-confidence dot (P26). Nothing else marks a cell. |
| D17 | **A role the queue reads is an East function; one it writes is a field.** As `Schedule.resources`' and `Roster.shifts`' roles are functions (`label: p => p.name`) and an event kind's `start` and a period's `status` are fields: every decision role is `(row, key) => …` — an option's `(o, key, c) => …` — never a field's name, so TypeScript types each from the row and a part of the card can be one field, two combined, a field inside a struct or a figure worked out, the change's variant anywhere in the row (§5.1). The verdict's roles, which the queue writes into the case's row, are fields (§5.2). |
| D18 | **Judgement is the app's index** (ruled 30 Oct 2026: "we have indexes which apply to the slice automatically, the developer could create a has-judgement index for example and filter by that"). Which cases show is the narrowing's, through the app's own indexes, as for any record a builder pages. An index of the app's on the verdict's tag — `judgement: r.verdict.getTag()` in an `index.key`, beside the fields the rail narrows by — is a field of the rail like any other, and the source's `initial` can start it on `waiting`. Under it, Save takes a decided case out of the list, and the shared Save notice says how many left (R26). The queue knows no index of its own. |

## 3. The authoring surface

**Where the data comes from.** No record is added for each kind of decision.
The cases are one record of the app's, whatever kinds of decision it holds,
each row carrying its verdict; the other records an example binds are the
app's own, the ones its builders already edit, which a case's change lands in
and the queue reads only to draw the change against the rows it changes.

```
the app's records     duties · print jobs · machine jobs and maintenance · bins · work orders · list prices
                      — what the app's builders edit: <Roster>, <Plan>, <Calendar>, <Allocation>, <Sheet>
        │ read by
the app's models      its tasks: an optimiser, a forecast, a rule
        │ propose, through the app's own mutation
one record of cases   every kind of decision; each option's change a variant field — its tag
                      the kind of decision, its value a patch of the record that kind changes;
                      each case's verdict a variant field, waiting as the model writes it
        │ read by, a page at a time through the rail
<DecisionQueue>       the change role's `of`: each tag → where it draws
                      rota → the Roster's kinds · print → the Plan's · pricing → a record's fields
        │ writes, at Save
the cases' record     the verdict's fields of each case decided — the models' next run reads them
the changed records   on Apply, the option's patch, through each record's patch door (Q1) —
                      the builders over those records show it as they show any edit
```

What kind of decision an option is, is the tag of its change, and the change
role says where each tag draws:

```tsx
options: { from: c => c.options, …,
    change: { from: o => o.change, of: {  // the option's variant, and a target for each of its tags
        rota: rotaChange,                 // DecisionQueue.change.roster(…): the Roster's kinds
        print: printChange,               // DecisionQueue.change.plan(…): the Plan's
        pricing: pricingChange,           // DecisionQueue.change.record(priceList, …): a record no builder draws
    } } },
```

— as the Roster's `resource: { field: "who", of: { staff: "people", agency:
"agencies" } }` says which kind each case of its variant field is. A target is
built from the same consts the app hands that builder — the duty kind, the
people, the shifts — so the queue draws a change to the duties as the Roster
draws them, Modify edits a duty in the Roster's inspector form, and Apply
writes it through the duties' own patch door, where the `<Roster>` over them
shows it. A host that places the builders beside the queue follows the open
case with `onSelect`. A case need not hold alternatives: a record whose every
row is one proposal maps the option's roles beside the case's (D15, §3.2).

### 3.1 The app's records

The example app is a warehouse, a print shop, a kiln yard and a workshop under
one roof — the repo's own example records — and the records no builder draws:
its price list, its stock levels, its lines' cure settings and its presses'
readiness. Its models propose changes to each, and to the rota's cover
targets, which the Roster edits in a form of its own. Its cases are one
record, each holding its verdict:

```ts
import { BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, PatchType, SetType, StringType, StructType, VariantType } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { WarehouseCover, WarehouseDuty } from "../roster/warehouse.js";    // the warehouse rota's duties and its cover targets
import { PrintJob } from "../plan/plan-events.examples.js";                // the print shop's jobs
import { CalendarService } from "../calendar/calendar.examples.js";        // the workshop's machine maintenance
import { KilnBin } from "../allocation/kiln-yard.js";                      // the kiln yard's bins
import { OptimiseWorkOrder } from "../sheet/optimise.examples.js";         // the shop's work orders

// The records no builder draws, each changed in a form of its own (§5.3).
/** A list price, and the demand a week the model expects at it. */
export const ListPrice = StructType({ region: StringType, price: FloatType, demand: FloatType, from: DateTimeType });
/** An item's stock: the units on order, and the model's stock-out risk in the week ahead, in percent. */
export const StockLevel = StructType({ item: StringType, onOrder: FloatType, risk: FloatType });
/** A line's cure: its cure time in minutes, the bond strength it gives in MPa, and the batches on trial at the slow cure. */
export const CureSetting = StructType({ line: StringType, cure: FloatType, bond: FloatType, trialBatches: IntegerType });
/** A press's readiness: the days until it is ready, as the forecast has them, and whether a person confirmed them. */
export const PressReadiness = StructType({ press: StringType, days: FloatType, confirmed: BooleanType });
export const listPrices = e3.record("list_prices", DictType(StringType, ListPrice), {
    initial: listPriceRows,
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
// … and `stock_levels`, `cure_settings` and `press_readiness` alike, each with its patch door.

/** What an option changes: its tag is the kind of decision, its value a patch of the record that kind changes. */
export const OpsChange = VariantType({
    rota: PatchType(DictType(StringType, WarehouseDuty)),        // cover: the warehouse rota's duties, as the Roster draws them
    rotaCost: PatchType(DictType(StringType, WarehouseDuty)),    // pay: the same duties, a change read by what it costs
    print: PatchType(DictType(StringType, PrintJob)),            // the print shop's jobs, as the Plan draws them
    workshop: PatchType(DictType(StringType, CalendarService)),  // the workshop's machine maintenance, as the Calendar draws it
    yard: PatchType(DictType(StringType, KilnBin)),              // the kiln yard's bins, as the Allocation draws them
    orders: PatchType(DictType(StringType, OptimiseWorkOrder)),  // the shop's work orders, as the Sheet draws them
    pricing: PatchType(DictType(StringType, ListPrice)),         // the price list
    stock: PatchType(DictType(StringType, StockLevel)),          // the stock levels
    trial: PatchType(DictType(StringType, CureSetting)),         // the lines' cure settings
    cover: PatchType(DictType(StringType, WarehouseCover)),      // the rota's cover targets, which the Roster edits in a form of its own
    ready: PatchType(DictType(StringType, PressReadiness)),      // the presses' readiness
});

/** One way to decide a case: the app's own words for it, what it is worth, and its change. */
export const OpsOption = StructType({
    label: StringType,                 // "B. Pumice"
    title: StringType,                 // "Move J. Tansy's Friday late to B. Pumice"
    summary: StringType,               // "B. Pumice · Fri 14–22"
    detail: StringType,                // "B. Pumice takes Friday 14–22; J. Tansy drops to 34h."
    note: OptionType(StringType),      // "B. Pumice lands at 32h of 38"
    value: FloatType,                  // 80000
    confidence: OptionType(FloatType), // 0.82
    question: OptionType(StringType),  // "Has B. Pumice been told this is on the table?"
    warn: OptionType(StringType),      // "A. Osier lands 2h over contract, paid at 1.5×."
    refused: OptionType(StringType),   // "takes no board stock" — a refused option says why
    knockOn: SetType(StringType),      // rows of the target moved because of the change, not by it
    guesses: DictType(StringType, FloatType), // the changed rows the model is unsure of, by key: "WO-1007" → 0.69
    change: OpsChange,
});

/** When a verdict was given: each case of the verdict but `waiting` holds it. */
const Given = StructType({ at: DateTimeType });

/** A case a model leaves to a person, and the person's verdict on it. */
export const OpsCase = StructType({
    area: StringType,                  // "rota" — the app's own field, which the rail narrows by (an index reads a field of the row); the queue maps none
    scope: StringType,                 // "Picking · W10"
    due: OptionType(DateTimeType),
    routine: BooleanType,
    unit: StringType,                  // "uplift"
    figure: VariantType({ money: NullType, count: NullType }),  // what its figures are — money, or a count (the orders' due dates, the trial's MPa) — which `format` reads
    model: StringType,                 // "staffing-v3.2.1 · run #42"
    why: StringType,
    ifWrong: OptionType(FloatType),    // −8000
    recommended: StringType,           // the key of the option the card opens on
    options: DictType(StringType, OpsOption),  // keyed by the model's rank, which orders them: `1-pumice`, `2-osier`, …
    // The verdict, which the queue writes: waiting, as the model writes every new case, until a person decides it.
    verdict: VariantType({ waiting: NullType, applied: Given, overridden: Given, deferred: Given, handedOff: Given }),
    option: OptionType(StringType),    // the option taken
    answer: OptionType(VariantType({ yes: NullType, no: NullType, unsure: NullType })),
    reason: OptionType(VariantType({ context: NullType, data: NullType, priorities: NullType, other: NullType })),
    note: OptionType(StringType),
});

// The models' cases: the app's record, filled by its own mutation — e3's tasks read records and never write them —
// and the verdicts the queue writes into them through their patch door.
export const opsCases = e3.record("ops_cases", DictType(StringType, OpsCase), {
    initial: opsCaseRows,
    indexes: (index) => ({
        // The app's own: whether anyone has judged a case — its verdict's tag — then a field the rail narrows by.
        ops_cases_by_judgement_area: index.key(East.function([StringType, OpsCase], StructType({ judgement: StringType, area: StringType }),
            (_$, _key, c) => ({ judgement: c.verdict.getTag(), area: c.area }))),
        ops_cases_by_judgement_scope: index.key(East.function([StringType, OpsCase], StructType({ judgement: StringType, scope: StringType }),
            (_$, _key, c) => ({ judgement: c.verdict.getTag(), scope: c.scope }))),
    }),
    mutations: (mutation) => ({
        ops_propose: mutation.reduce(proposeCases),  // the app's: a run's cases in, each waiting
        patch: mutation.patch(),                     // the queue's: the verdicts
    }),
});
```

A model builds a change with East's own diff of the rows it changes —
`East.diff(before, after)` over the touched duties, keyed as the record is —
so a case's patch carries each row as the model read it. A patch that no
longer applies to the record — another session moved the row since — is the
Stale mark (P21).

### 3.2 The smallest queue — one record, a target per tag

A record of the model's proposals, each one decision with no alternatives, its
`details` a variant: a proposal of one kind changes the shop's work orders,
which the Sheet draws; of the other, the price list, which no builder draws.
The cases are read whole; there is no rail. The record keeps the app's own
names — `headline`, `deadline`, `saving` — and each role says which of them
fills which part of the card (§5.1).

```ts
/** What a proposal changes: its tag is the kind of decision, its value a patch of the record that kind changes. */
export const ProposalDetails = VariantType({
    orders: PatchType(DictType(StringType, OptimiseWorkOrder)),  // the shop's work orders (test/sheet/optimise.examples.tsx)
    pricing: PatchType(DictType(StringType, ListPrice)),         // the price list
});
/** A proposal of the app's model, in the app's own words: one decision, no alternatives — and the verdict on it. */
export const Proposal = StructType({
    site: StringType, deadline: OptionType(DateTimeType), metric: StringType, run: StringType, rationale: StringType,
    headline: StringType, brief: StringType, description: StringType, saving: FloatType, details: ProposalDetails,
    verdict: VariantType({ waiting: NullType, applied: NullType, overridden: NullType, deferred: NullType, handedOff: NullType }),
});
export const proposals = e3.record("proposals", DictType(StringType, Proposal), {
    initial: proposalRows,
    mutations: (mutation) => ({ patch: mutation.patch() }),  // the queue writes each verdict through it
});
```

```tsx
<Reactive>{$ => {
    // The proposals, read whole, with the patch door their verdicts are written through.
    const cases = $.let(Record.bind(proposals));
    // The records the proposals change, each bound with the patch door it declares.
    const workOrders = $.let(Record.bind(optimiseWorkOrders));
    const priceList = $.let(Record.bind(listPrices));
    return <DecisionQueue
        id="proposals"
        decisions={DecisionQueue.decisions(cases, {
            // Each role: the part of the card on the left, an East function reading it from the proposal on the right.
            scope: p => p.site, due: p => p.deadline, unit: p => p.metric, model: p => p.run, why: p => p.rationale,
            // No `options`: each proposal is its own one option, the option's roles read from the proposal (D15).
            title: p => p.headline, summary: p => p.brief, detail: p => p.description, value: p => p.saving,
            change: { from: p => p.details, of: {
                orders: DecisionQueue.change.sheet(workOrders, { name: "Sheet", icon: "table-cells", columns: {
                    reference: Sheet.column.text(OptimiseWorkOrder, { header: "Reference" }),
                    status: Sheet.column.text(OptimiseWorkOrder, { header: "Status" }),
                    due: Sheet.column.date(OptimiseWorkOrder, { header: "Due" }),
                } }),
                pricing: DecisionQueue.change.record(priceList, { name: "Pricing", icon: "tag", label: r => r.region }),
            } },
            // The verdict: a field of the proposal's, which the queue writes, and which of its cases means what.
            verdict: { field: "verdict", waiting: "waiting", applied: "applied", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" },
        })}
    />;
}}</Reactive>
```

Every optional role left out turns off what it drives: no `routine`, no
Routine mark; no `ifWrong` or `confidence`, those figures read `no data`; no
`question`, no gate; no `answer`, `reason` or `note` among the verdict's roles,
the card offers no answer, no override reason and no note (§5.2). With no rail
every proposal shows — a waiting one as its card, a decided one as its receipt
— until the app's own mutation drops it.

### 3.3 The full queue — every builder it lands in

The same app, its cases narrowed by a rail, its eleven kinds of decision
landing in the Roster's duties — by people, and by cost — the Plan's jobs, the
Calendar's machine maintenance, the Allocation's bins, the Sheet's work orders,
and the records no builder draws, each in a form of its own: the price list,
the stock levels, the lines' cure settings, the rota's cover targets and the
presses' readiness. Each builder's kinds and lists are the consts its own tag
takes in its example — declared once and handed to both, with their own
`fields`, `ready` and `inspector`, which Modify uses (D9). The bindings are
named for the records they bind (`duties`, `workOrders`, `priceList`); the
tags for the kinds of decision (`rota`, `orders`, `pricing`). The previews the
mock draws only in its gallery — a projection, a mix, groups and zones — are
the gallery example's, over the supply side's records (§15).

```tsx
<Reactive>{$ => {
    // The models' cases with the patch door their verdicts are written through, read by key beside the rail's source.
    const cases = $.let(Record.bind(opsCases));
    const caseEntries = $.let(Data.bindPaged(opsCases));
    // The rail: the cases through the app's indexes on their judgement, starting on those waiting.
    const indexed = $.let(Data.bindPaged(opsCases, { indexes: ["ops_cases_by_judgement_area", "ops_cases_by_judgement_scope"] }));
    const slice = $.let(Slice.bindRecords("ops.decisions", {
        decisions: { source: indexed, icon: { prefix: "fas", name: "inbox" }, search: ["scope"],
            fields: { judgement: { label: "Judgement", hints: ["waiting", "applied", "overridden", "deferred", "handedOff"] },
                area: { label: "Area", hints: ["rota", "print", "yard", "stock", "workshop", "pricing", "trial", "orders", "cover", "ready"] },
                scope: { label: "Scope" } },
            initial: { judgement: ["waiting"] } },
    }));
    // The host's: the case open in the queue, which it follows.
    const open = $.let(State.bind([OptionType(StringType)], "ops.open", none));
    const follow = $.const(East.function([OptionType(StringType)], NullType, ($2, key) => { $2(open.write(key)); }));

    // The records the cases change, and the kinds and lists their builders take: the same consts the app's own
    // <Roster>, <Plan>, <Calendar>, <Allocation> and <Sheet> are handed.

    // The Roster's, as `rosterOptimise` gives them (test/roster/optimise.examples.tsx), and the warehouse's pay.
    const duties = $.let(Record.bind(rosterDuties));
    const dutyEntries = $.let(Data.bindPaged(rosterDuties));
    const dutyWeek = $.let(Data.bindPaged(rosterDuties, { indexes: ["roster_duties_by_time"] }));
    const staff = $.let(Data.bind(rosterStaff));
    const firms = $.let(Data.bind(rosterAgencies));
    const times = $.let(Data.bind(rosterShiftTimes));
    const teams = $.let(Data.bind(rosterTeams));
    const rateRows = $.let(Data.bind(rosterPayRates));
    const rates = $.const(rateRows.read());
    const duty = Schedule.events(duties, {
        name: "Duty", icon: "user-clock", entries: dutyEntries,
        start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
        shift: "shift", group: "team", position: "role", activity: "task",
        hours: d => d.start.durationMinutes(d.end).subtract(d.unpaidBreak).divide(60.0),
    });
    const people = Schedule.resources(staff.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team, contract: p => p.contract });
    const agencies = Schedule.resources(firms.read(), { name: "Agencies", icon: "building", label: a => a.name });
    const shifts = Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours,
        order: s => s.order, color: s => s.colour });
    const groups = Roster.groups(teams.read(), { label: t => t.label, order: t => t.order });
    // The warehouse's pay in its own codes, as `rosterWarehouse` builds it (test/roster/roster.examples.tsx) for its
    // <Roster pay={pay}>: ordinary time to the contract, OT1 past it, an agency's hours at its rate.
    const pay = $.const(East.function([Roster.Types.PayRequest(WarehouseDuty)], Roster.Types.Pay, ($2, req) => {
        /* rosterWarehouse's body, over `rates` — written out in full in the example */
    }));

    // The Plan's, as `planOptimise` gives them (test/plan/optimise.examples.tsx).
    const jobs = $.let(Record.bind(planEventJobs));
    const presses = $.let(Data.bind(planPrintPresses));
    const job = Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" }, state: "state" });
    const pressRows = Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name, group: p => p.hall });

    // The Calendar's, as `calendarOptimise` gives them; the Allocation's, as `allocationOptimise` does.
    const machineJobs = $.let(Record.bind(calendarJobs));
    const machines = $.let(Data.bind(calendarMachines));
    const machineJob = Calendar.events(machineJobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end",
        resource: { field: "machine", of: "machines" } });
    const services = $.let(Record.bind(calendarServices));
    // The maintenance's own Details, which the Calendar's inspector and Modify show in place of the form over the
    // fields its roles leave: who does it and what to do, each written back over the row as it stands.
    const serviceDetails = $.const(East.function([CalendarService, FunctionType([CalendarService], NullType)], UIComponentType, ($2, row, update) => {
        const assign = $2.const(East.function([StringType], NullType, ($3, technician) => {
            $3(update({ title: row.title, start: row.start, end: row.end, machine: row.machine, technician, notes: row.notes }));
        }));
        const note = $2.const(East.function([StringType], NullType, ($3, notes) => {
            $3(update({ title: row.title, start: row.start, end: row.end, machine: row.machine, technician: row.technician, notes }));
        }));
        return <VStack gap="3" align="stretch">
            <Field.StringInput label="Technician" value={row.technician} onChange={assign} />
            <Field.StringInput label="Notes" value={row.notes} placeholder="What to do" onChange={note} />
        </VStack>;
    }));
    const service = Calendar.events(services, { name: "Maintenance", icon: "screwdriver-wrench", title: "title", start: "start", end: "end",
        resource: { field: "machine", of: "machines" }, inspector: serviceDetails });
    const machineRows = Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: m => m.name });
    const bins = $.let(Record.bind(kilnBins));
    const binEntries = $.let(Data.bindPaged(kilnBins));
    const yardDayBins = $.let(Data.bindPaged(kilnBins, { indexes: ["kiln_bins_by_time"] }));
    const bays = $.let(Data.bind(yardBays));
    const kilnList = $.let(Data.bind(kilns));
    const loads = $.let(Data.bind(arrivals));
    const bin = Schedule.events(bins, { name: "Bin", icon: "box", entries: binEntries, at: "at", resource: { field: "bay", of: "bays" },
        arrival: "load", quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec" });
    const bayRows = Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset });
    const kilnRows = Schedule.resources(kilnList.read(), { name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group,
        min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges });
    // The loads on their way, as `allocationKilnYard` gives them: a bin a change books takes its load off the Waiting row.
    const loadRows = Allocation.arrivals(loads.read(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays),
        kind: l => some(l.spec), due: l => some(l.due), window: l => some({ from: l.from, to: l.to }) });

    // The Sheet's work orders, as `sheetOptimise` binds them.
    const workOrders = $.let(Record.bind(optimiseWorkOrders));

    // The records no builder draws, each changed in a form of its own: the price list, the stock levels, the lines'
    // cure settings and the presses' readiness; and the rota's cover targets, which the Roster edits in its own.
    const priceList = $.let(Record.bind(listPrices));
    const stock = $.let(Record.bind(stockLevels));
    const cures = $.let(Record.bind(cureSettings));
    const cover = $.let(Record.bind(rosterCover));
    const readiness = $.let(Record.bind(pressReadiness));

    // Where each kind of decision draws: a target for each tag of the options' change.
    const rotaChange = DecisionQueue.change.roster({ name: "Roster", icon: "users",
        events: { duty }, resources: { people, agencies }, shifts, groups, week: { start: "sunday" }, source: dutyWeek });
    const rotaCostChange = DecisionQueue.change.roster({ name: "Roster", icon: "users", map: "cost", pay, currency: "USD",
        events: { duty }, resources: { people, agencies }, shifts, groups, week: { start: "sunday" }, source: dutyWeek });
    const printChange = DecisionQueue.change.plan({ name: "Plan", icon: "bars-progress", events: { job }, resources: { presses: pressRows } });
    // The maintenance the tags patch, named by `event`, beside the jobs its days' overlaps count.
    const workshopChange = DecisionQueue.change.calendar({ name: "Calendar", icon: "calendar-days",
        events: { job: machineJob, service }, event: "service", resources: { machines: machineRows } });
    const yardChange = DecisionQueue.change.allocation({ name: "Allocation", icon: "fire-flame-curved",
        events: { bin }, resources: { bays: bayRows, kilns: kilnRows }, arrivals: loadRows, source: yardDayBins });
    const orderChange = DecisionQueue.change.sheet(workOrders, { name: "Sheet", icon: "table-cells", columns: {
        reference: Sheet.column.text(OptimiseWorkOrder, { header: "Reference", width: "96px" }),
        status: Sheet.column.text(OptimiseWorkOrder, { header: "Status" }),
        due: Sheet.column.date(OptimiseWorkOrder, { header: "Due", width: "96px" }),
    } });
    // The price list's form, and the app's check on a price Modify leaves, which holds Apply: a list price moves in 5¢ steps.
    const pricingChange = DecisionQueue.change.record(priceList, { name: "Pricing", icon: "tag", label: r => r.region,
        fields: {
            price: Fields.number({ label: "List price", unit: "$ / unit", min: 10.0, max: 12.5, step: 0.05, help: "In 5¢ steps" }),
            demand: Fields.number({ label: "Demand / wk", unit: "units" }),
        },
        ready: r => r.price.subtract(East.Float.roundNearest(r.price, 0.05)).abs().greater(0.000001).ifElse(
            () => variant("invalid", [{ field: "price", message: "A list price moves in 5¢ steps" }]), () => variant("ready", null)) });
    // The stock levels' form: the units on order and the risk of running out.
    const stockChange = DecisionQueue.change.record(stock, { name: "Inventory", icon: "boxes-stacked", label: s => s.item,
        fields: {
            onOrder: Fields.number({ label: "On order", unit: "units", min: 0.0 }),
            risk: Fields.number({ label: "Stock-out risk · wk 11", unit: "%", min: 0.0, max: 100.0 }),
        } });
    // The lines' cure settings: a cure time, the bond it gives, and the batches on trial.
    const trialChange = DecisionQueue.change.record(cures, { name: "Experiment", icon: "flask", label: c => c.line,
        fields: {
            cure: Fields.number({ label: "Cure time", unit: "min" }),
            bond: Fields.number({ label: "Bond strength", unit: "MPa" }),
            trialBatches: Fields.number({ label: "Batches on trial", min: 0n }),
        } });
    // The rota's cover targets: the heads a team's shift needs on a day.
    const coverChange = DecisionQueue.change.record(cover, { name: "Capacity", icon: "gauge-high", label: c => East.str`${c.team} · ${c.shift}`,
        fields: { heads: Fields.number({ label: "Heads", min: 0n }) } });
    // The presses' readiness: the days the forecast gives, and whether a person confirmed them.
    const readyChange = DecisionQueue.change.record(readiness, { name: "Forecast", icon: "chart-line", label: r => r.press,
        fields: { days: Fields.number({ label: "Days to ready", unit: "days", min: 0.0 }) } });

    return <DecisionQueue
        id="opsQueue"
        slice={{ slice }}
        decisions={DecisionQueue.decisions(cases, {
            entries: caseEntries,
            scope: c => c.scope, due: c => c.due, routine: c => c.routine, unit: c => c.unit, model: c => c.model,
            why: c => c.why, ifWrong: c => c.ifWrong, recommended: c => c.recommended,
            // Money in dollars, a count as it is.
            format: c => c.figure.match({
                money: () => some(Format.Currency({ currency: "USD", compact: "short" })),
                count: () => none,
            }),
            options: { from: c => c.options, label: o => o.label, title: o => o.title, summary: o => o.summary,
                detail: o => o.detail, note: o => o.note, value: o => o.value, confidence: o => o.confidence,
                question: o => o.question, warn: o => o.warn, refused: o => o.refused, knockOn: o => o.knockOn,
                guesses: o => o.guesses,
                change: { from: o => o.change, of: {
                    rota: rotaChange, rotaCost: rotaCostChange, print: printChange, workshop: workshopChange,
                    yard: yardChange, orders: orderChange, pricing: pricingChange,
                    stock: stockChange, trial: trialChange, cover: coverChange, ready: readyChange,
                } } },
            // The verdict's roles: fields of the case's row, which the queue writes.
            verdict: { field: "verdict", waiting: "waiting", applied: "applied", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" },
            option: "option",
            answer: { field: "answer", yes: "yes", no: "no", unsure: "unsure" },
            reason: { field: "reason", context: "context", data: "data", priorities: "priorities", other: "other" },
            note: "note",
        })}
        onSelect={follow}
    />;
}}</Reactive>
```

The examples are these two queues as written here (`decisionQueueMinimal`,
`decisionQueueOps`, §15), each placed in a `Box` of a fixed height, as the
showcase places a builder, with `now` pinned to the mock's, 13:00 on Tuesday
10 March 2026, so their due words read as the mock's do whatever the day.
Their cases are the mock's, like for like — its scopes, titles, options,
figures, questions and warnings — over the rows of the example records each
case changes: the roster case moves a duty the warehouse rota holds, J.
Tansy's Friday late. They stand in the order the index serving the rail's
choices gives them (D5). The records keep their own examples' dates — the
rota's week in March 2028, the print works' day in October 2026 — so `now`
drives the due words alone. Where a figure is the app's own arithmetic it is
the app's, not the mock's: the routine trim's `+$168` and Saturday's cover's
`+$408` are the warehouse's pay for the hours they take off, and the overtime
case's `+$156` the change its pay codes give over the week (P7). Each case's
`figure` says whether its figures print as dollars (`+$80K`) or as a count
(`+3`).

A record with no builder declares its form in its target, with the names an
event kind gives them: `fields` (east-ui's `Fields` hints: `Fields.number`,
`Fields.select`, `Fields.reference`, `Fields.tags`), `ready` and `inspector`.
Every other target's form is its builder's: the duty's is the Roster's
inspector for one duty, the job's the Plan's for one event, a work order's the
Sheet's Details for one row. `rota` and `rotaCost` land in the same record
through two targets: the cover decisions' map reads by people, the pay
decisions' by cost (D7, P7). The rota's cover targets, which the `<Roster>`
edits in its targets' form, take a record target here: the Roster's target
draws a change to the duties.

### 3.4 Placement

The queue is its frame and what is in it, nothing more: it fills the box its
host gives it, and takes no prop of a placement's. A host places it as it
places any builder — a page's region beside the builders it lands in, a card,
a drawer, a popover — and sizes it; a trigger, a badge counting the cases and
a close button are the host's own chrome, never the queue's. Its narrow layout
follows its own width (R30), whatever holds it. The mock draws two placements,
a popover and a phone; both are this one component.

### 3.5 A queue of any size — paged through the rail

The cases are read as the Plan and the Sheet read their rows (D4): through the
rail's source a page at a time as the list scrolls, in its index's order. Here
a replenishment model's 20,000 reorders across a chain of stores, each its own
one proposal (D15): the record carries the verdict the queue writes, and an
index of the app's own on whether anyone has judged a reorder (D18).

```ts
export const Reorder = StructType({
    store: StringType, range: StringType, due: OptionType(DateTimeType), /* …the model's fields… */
    verdict: VariantType({ waiting: NullType, applied: NullType, overridden: NullType, deferred: NullType, handedOff: NullType }),
    note: OptionType(StringType),
});

export const reorders = e3.record("reorders", DictType(StringType, Reorder), {
    initial: () => East.compile(generateReorders, [])(20000n),
    indexes: (index) => ({
        // The app's own: whether anyone has judged a reorder, then its store and its range.
        reorders_by_judgement: index.key(East.function([StringType, Reorder],
            StructType({ judgement: StringType, store: StringType, range: StringType }),
            (_$, _key, r) => ({ judgement: r.verdict.getTag(), store: r.store, range: r.range }))),
    }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});
```

```tsx
<Reactive>{$ => {
    const rows = $.let(Record.bind(reorders));
    const entries = $.let(Data.bindPaged(reorders));
    const slice = $.let(Slice.bindRecords("ex.decisionQueueRecordIndexes", {
        decisions: { source: Data.bindPaged(reorders, { indexes: ["reorders_by_judgement"] }), icon: { prefix: "fas", name: "inbox" },
            fields: { judgement: { label: "Judgement" }, store: { label: "Store" }, range: { label: "Range" } },
            initial: { judgement: ["waiting"] } },
    }));
    const stock = $.let(Record.bind(chainStock));
    const stockEntries = $.let(Data.bindPaged(chainStock));
    return <DecisionQueue
        id="reorders"
        slice={{ slice }}
        decisions={DecisionQueue.decisions(rows, {
            entries,
            scope: r => East.str`${r.store} · ${r.range}`, due: r => r.due, title: r => r.title, /* …the card's roles… */
            change: { from: r => r.change, of: { stock: DecisionQueue.change.record(stock, { /* … */ entries: stockEntries }) } },
            verdict: { field: "verdict", waiting: "waiting", applied: "applied", overridden: "overridden", deferred: "deferred", handedOff: "handedOff" },
            note: "note",
        })}
    />;
}}</Reactive>
```

The queue opens on the waiting reorders, e3's count of them in its toolbar, and
reads the page in view. A reorder applied and saved leaves the list, and the
Save notice says so (R26); Judgement's other choices show the decided ones,
each its receipt. Without a rail the record is read whole (§3.2).

## 4. The props

| Prop | Takes | What it does |
|---|---|---|
| `id` | `string` | Names the queue's state: the open card, each card's choices (D12) and the session's drafts (D3). Required. |
| `decisions` | `DecisionQueue.decisions(binding, roles)` | The cases — one record, every kind of decision, each row its verdict: the app's record and its roles, the change role a target for each of its tags, and the verdict's roles the fields the queue writes (§5.1, §5.2, §5.3). Required. |
| `slice` | `{ slice: Slice.bindRecords(key, { decisions: { source, … } }) }` | The rail: one source, `decisions`, over the cases' record, read a page at a time as the list scrolls (D4); the app's indexes are its fields (D18). A `Slice.bind` or a single `Slice.bindRecord` is refused, as every builder refuses them. Optional; without it the cases are read whole. |
| `onSelect` | `FunctionType([OptionType(StringType)], NullType)` | Hears the open case's key, `none` when none is open — the host's to follow, as a builder's `onSelect` hears its selection. Optional. |
| `readOnly` | `SubtypeExprOrValue<Boolean>` | Every card opens and shows everything, and takes no answer and no action; no history item. Default `false`. |
| `now` | `SubtypeExprOrValue<DateTime>` | The time the due words count from; the clock by default. Examples and tests pin it. |

## 5. The kinds and the East types

### 5.1 `DecisionQueue.decisions(binding, roles)`

`binding` is the cases' record with its patch door, `Record.bind(record)`, the
record a `Dict<String, C>` declaring `patch: mutation.patch()`, through which
the queue writes the verdict's fields of a case (§5.2) and nothing else of it.
It is read whole; beside the slice's `decisions` source it is read through the
source a page at a time (D4), and `entries`, a paged read of the same record
(`Data.bindPaged(record)`), reads a case by key — a case drafted, and Save's
confirmation — as the Schematic's kinds are read beside their sources.
`entries` is required beside the source, and refused where there is none. A
`Data.bind` or a `Data.bindPaged` is refused, naming `Record.bind(record)`:
the queue writes each verdict into its case's row, so cases a task outputs,
which nothing writes, are filled into a record by the app's own mutation first.

Every role here but the verdict's is an East function over the row and its
key — an option's over the option, its key and its case, `(o, key, c) => …` —
because the queue only reads them, as `Schedule.resources`' and
`Roster.shifts`' roles are functions (`label: p => p.name`); the roles a
builder writes are fields — an event kind's `start`, a period's `status`, the
verdict's (§5.2). A role pairs
a part of the card with what fills it from the app's row — `title: p =>
p.headline`: the card's title is the row's `headline` — so the app's record
keeps its own names and its own shape, and a part can be one field, two
combined, a field inside a struct or a figure worked out:

```tsx
DecisionQueue.decisions(proposals, {
    scope: p => p.site,                                     // one field
    title: p => East.str`${p.action} at ${p.site}`,         // two fields combined
    due: p => p.timing.deadline,                            // a field inside a struct
    value: p => p.saving.subtract(p.cost),                  // a figure worked out
    change: { from: p => p.plan.details, of: { … } },       // the variant, wherever it sits
    …
})
```

The binding fixes the row's type, so TypeScript types every function's
parameter from it — `p.` completes the row's fields, and a field renamed or
removed fails to compile where a role reads it — and checks what each returns
against its role: `due` must return an `Option<DateTime>`. The change role's
variant is inferred from `from` alone (`of` is typed `NoInfer`, as e3-ui's
Schedule resources and Sheet are), and `of` is checked against it: a key for
every tag, no other key, each target's record the one its tag's patch is of.
At build each function is reified once per row type into a real East function,
as Schedule's accessors are (`schedule/accessor.ts`), and one returning another
type is refused naming the role and what it returns
(`` DecisionQueue.decisions: `due` returns .String — it takes an Option<DateTime> ``).

| Role | Returns | Drives | |
|---|---|---|---|
| `scope` | `String` | the eyebrow after where it lands (`Roster · Inbound · W10`) | required |
| `due` | `Option<DateTime>` | the due words and their tone (`2h late`, `by 14:00`, `by Fri 13`) | required |
| `routine` | `Boolean` | the Routine mark (§8) | optional |
| `unit` | `String` | the value's word (`uplift`, `saved / wk`) | required |
| `format` | `Option<Format>` | how values print (east-ui's `Format`) | optional: plain numbers |
| `ifWrong` | `Option<Float>` | the If wrong figure | optional |
| `model` | `String` | Why's line (`rota-opt · run #204`) | required |
| `why` | `String` | Why's paragraph | required |
| `recommended` | `String`, a key of `options` | the option the card opens on, its title the card's | required with `options`; a key naming no option is the case's warning (§12) |
| `options` | `{ from, …the option's roles }`: `from` returns a `Dict<String, O>` | the case's alternatives, by key; the option's roles below read each `O` | optional: without it the case is its own one proposal, the option's roles beside the case's, reading the case row (D15) |
| `entries` | a binding, not a function: `Data.bindPaged(record)` over the cases' own record | a case read by key beside the slice's source (D4) | required with the slice's `decisions` source; refused without one |

The option's roles — in `options`, or beside the case's for a case that is its
own proposal, `label` and `note` in `options` alone (D15):

| Role | Returns | Drives | |
|---|---|---|---|
| `label` | `String` | the option's row in Options | optional: the option's key |
| `title` | `String` | the card's title (the recommended option's), a receipt's words | required |
| `summary` | `String` | the line beside Proposed / Modified | required |
| `detail` | `String` | the sentence under Change | required |
| `note` | `Option<String>` | the option's line in Options (`lands at 38 h of 38`) | optional |
| `value` | `Float` | the value line, the option's figure | required |
| `confidence` | `Option<Float>` | the Confidence figure, the model's confidence in the option | optional |
| `question` | `Option<String>` | Your call: a question only a person can answer, gating Apply | optional |
| `warn` | `Option<String>` | the warning box | optional |
| `refused` | `Option<String>` | a refused option: off in Options, its reason on its line | optional |
| `knockOn` | `Set<String>` | rows of the target moved because of the change, not by it (P16) | optional |
| `guesses` | `Dict<String, Float>` | the changed rows the model is unsure of, by key, and its confidence in each (P26) | optional |
| `change` | `{ from, of }`: `from` returns a variant, its tag the kind of decision, each tag's value a `PatchType(DictType(K, R))`; `of` a target for every tag, `DecisionQueue.change.*` (§5.3) | where it lands: the preview, Modify, what Apply writes | required |

### 5.2 The verdict's roles

The verdict is fields of the case's own row, which the queue writes through
the record's patch door, as a builder writes only the fields its roles name
(D1, D17): each role is a field of `C`, by name, never an accessor. The queue
writes only the fields its roles map, and every other field of the row stays
as it was. The roles sit among `DecisionQueue.decisions`' own, beside the
card's.

| Role | Field type | Written |
|---|---|---|
| `verdict` | `{ field, waiting, applied, overridden, deferred, handedOff }`: a variant field, not an Option, and which case means which; `waiting` holds Null — the model writes it on every new case — and each other case Null, or `{ at: DateTime }`, the time it was given, as a period's published case does | always; required |
| `option` | `Option<String>` | the option taken; for Override, the option the person started from; none for a case that is its own proposal |
| `answer` | `{ field, yes, no, unsure }`: an `Option` of a variant of unit cases | the answer to the option's question; without it the card asks none |
| `reason` | `{ field, context, data, priorities, other }`: an `Option` of a variant of unit cases | an override's reason; without it Override asks none |
| `note` | `Option<String>` | the case's note; without it no note |

A role naming a field the row lacks, or one of another type, a case of the
variant named twice, or a `waiting` case holding anything but Null, is refused
at build, naming the field and its type.

### 5.3 `DecisionQueue.change` — where each kind of decision draws

A target names its surface (`name`, `icon`: the eyebrow, D10), reads the rows
its change touches and draws them as their builder does. A builder's target
takes the props of the builder's own tag — the same values, typed as that tag
types them — and its kinds carry their own form (`fields`, `ready`,
`inspector`), which Modify uses (D9). Apply writes through the kind's own
write (Q1), so a kind bound read only is refused at build, naming
`Record.bind(record)`, its record declaring `patch: mutation.patch()`. Each
target serves every tag `of` maps to it.

| Target | Takes — reused | Reads | Draws |
|---|---|---|---|
| `DecisionQueue.change.roster({ name, icon, events, resources, shifts, groups, positions?, activities?, rules?, check?, pay?, currency?, week?, map?, source?, locked? })` | `Pick<RosterProps<R>, "events" \| "resources" \| "shifts" \| "groups" \| "positions" \| "activities" \| "rules" \| "check" \| "pay" \| "currency" \| "week">` — the duty kind, the people and agencies, the shifts, groups, positions and activities, the rules, the app's check and pay, as `<Roster>` takes them; `currency` with `pay`, as there | the touched people's duties over the change's week, through the duty kind's closed build (`Schedule.Types.RosterKind`'s `rows(from, to)`, `read`), over `source` — an interval-indexed source of the duties — or the record whole | crop: the people's rows, 36 tall, the week's tiles 24 tall, each row head the name and hours before → after (the duty kind's `hours`, the people's `contract`); map: rows 16, tiles 12, at most 4 then `+ N more people`; `map: "cost"`, which takes `pay`: the map by cost, a row per pay code (P7) — the Roster's own pay over the week before and after |
| `DecisionQueue.change.plan({ name, icon, events, resources?, event?, source?, locked? })` | `Pick<PlanProps<K>, "events" \| "resources">`, `events` required; `event` a key of `events`, the kind the tags patch — needed with more than one, the others drawn as context | the touched resources' events over the change's span, padded to whole hours | crop: lanes 40–48 tall, bars 18, the time ruler and the now line, each lane head the resource and its booked share before → after; map: the resources as 22px tiles grouped by their kind's `group`, a count on each, and the when strip |
| `DecisionQueue.change.calendar({ name, icon, events, resources?, week?, event?, source? })` | `Pick<CalendarProps, "events" \| "resources" \| "week">`; `event` as the Plan's | the touched days' events on the change's resources | crop: a lane a day, bars 18, each lane head the day and its overlaps before → after (Schedule's overlaps); map: as the Plan's |
| `DecisionQueue.change.allocation({ name, icon, events, resources, arrivals?, rules?, check?, labels?, source? })` | `Pick<AllocationProps<R>, "events" \| "resources">`, and its `arrivals`, `rules`, `check` and `labels`, optional here | the touched resources' bins over the change's days | crop: a lane a resource — with `arrivals`, a Waiting lane — bins 24 tall on the days' ruler, each head the resource and its load before → after (`Allocation.loads`), a breach by `check`; map: resources as tiles by group |
| `DecisionQueue.change.sheet(binding, { name, icon, columns, entries? })` | `columns` a `SheetColumnSpec<R>`, built with `Sheet.column.*` as `<Sheet>` takes it | the touched rows: by key through `entries`, else from the record read whole | crop: the first three changed rows at 28, the columns the change touches after the first column; a guessed row's changed cells with the dot (P26) |
| `DecisionQueue.change.record(binding, { name, icon, label?, fields?, ready?, inspector?, measure?, group?, source?, locked?, entries? })` | east-ui's `Fields` hints, a `ready` and an `inspector` (`RowInspectorType`), as an event kind takes them | the touched rows: by key through `entries`, else from the record read whole; with `group`, each group's rows counted through `source` — an indexed read of the record listing a plain index on that field alone — every group shown asked in one pass, and `entries` given beside it | up to two changed fields across its rows (rows 54), each value as the row's form prints it read-only; with `measure` and at most five rows, the mix: a row per key on a shared axis; with `group`, the groups: a row per group, the most rows changing first, at most five |
| `DecisionQueue.change.zones(binding, { name, icon, zone, x, y, depot?, zones })` | its own accessors — no builder draws zones; `zones` the app's list of (label, colour token) | every area of the binding | tiles 16, twelve a row, by `x` and `y`, filled by zone; changed areas in the new zone's fill with the glow; depots as dots; the key, each zone's count before → after |
| `DecisionQueue.change.projection(binding, { name, icon, option, points, x, y, limit?, format? })` | `option` the options' row type, `points` an accessor over it giving its series, `x` and `y` accessors over a point, as `Chart.Line(rows, { x, y })` takes them; `limit` `{ y, label }`, as `Chart.refLine` takes them | nothing of the record: the option's own series | the plot, 84 tall; a line per option, the chosen one glowing, the option that changes nothing a dashed ghost, the others thin; the limit a dashed warn rule over its wash |

`source` is an indexed source of the builder's record with an interval index
(`Data.bindPaged(rosterDuties, { indexes: ["roster_duties_by_time"] })`), the read
a builder's slice names for the kind; without it the target reads its kind's
record whole. A record target's `source` is such a read for its groups: an
indexed read of the target's own record listing a plain index on the `group`
field alone (`Data.bindPaged(catalogue, { indexes: ["catalogue_by_range"] })`),
whose key search counts a group's rows — never the record read whole; `group`
without it, or it without `group`, is refused, naming the index to declare.
`entries` is a paged read of a record with no builder,
`Data.bindPaged(record)`, beside its `Record.bind`, as an event kind's
`entries` is: the touched rows are read by key, never the record whole — the
rows the cases in view change, in one request a record (R1). `locked` is an accessor over the record's row (`(row, key) => Boolean`) for
the Locked mark. A target's own roles are East functions over the row too —
the record's `label` and `measure`, the zones' `zone`, `x` and `y`, the
projection's `points`, `x` and `y` — but `group`, which names the field
`source`'s index is on, as a rail's fields do. `map` is the Roster's alone: `"people"` by default, `"cost"`
given `pay` — refused without it, naming `pay`.

Every preview the mock draws is one of these: the Roster's crop, its week map
and its cost; the Plan's crop and its day map; the Calendar's; the
Allocation's; the Sheet's, with its low-confidence cell; a record's changed
fields, its mix and its groups; the zones; the projection — and every mark
of §9.5 on each.

### 5.4 The payload

`DecisionQueue.Types.Payload` carries the cases' closed build — their reads,
whole or the slice's source a page at a time, each row read through the roles
into a case, its verdict among its parts; the session over the cases' record
with its read by key; and how a verdict is written into a row — as East
functions over the row's bytes, so the payload is one type whatever the app's
rows are, as Schedule's kinds are (`Builder Interfaces Spec.md` §4.1); the
slice's chrome and its bound source (`recordSources(…).bind($)`, #1356); and one
`DecisionQueue.Types.Target` per target, with the tags it serves: its name and
icon, its kind (`roster`, `plan`, `calendar`, `allocation`, `sheet`, `record`,
`zones`, `projection`), the builder's closed kinds and lists as that builder's
payload carries them (`Schedule.Types.RosterKind`, `Schedule.Types.AllocationKind`,
the Plan's and the Calendar's kinds, the Sheet's columns) with each kind's
write, form (`Fields.Types.Spec`), `ready` and `inspector`, the reads, and its
tags' patch type. Nothing of the queue's is stored in the app's records.

## 6. The shared parts

| Concern | Part | Where |
|---|---|---|
| The frame | `BuilderFrame`: `toolbar`, `banners`, main, `footer` with `liveFooter`, `loading` for the cold load only, `busy` after | east-ui-components `layout/builder-frame/` |
| The toolbar's row | `Toolbar` items, 28px controls on a 44px row; the rail through `useRecordSlicesToolbarItems`, its summary at `SUMMARY_RANK`, its floor rung; the history item (`historyToolbarItem`) at the end, folding last | east-ui-components `toolbar/`, `editing/`; e3-ui-components' builders |
| The rail's source | `recordSources(slice, { builder: "DecisionQueue", names: ["decisions"], … })`, bound once in the payload | e3-ui `utils/record-sources.ts` |
| Reading the cases | the paged Library's reading (`PagedLibrary`) made one hook the Library and the queue share: windows of `PAGED_LIBRARY_PAGE` around the view, the rows that last landed standing in, retained, while a new narrowing's, revision's or count's land, and card-sized pending rows for those not read; `LoadingReveal`, `LoadingLine`, `pagedLoadingLine` | east-ui-components `collections/library/`, `./internal`; e3-ui-components `shared/loading.ts` |
| The list | `VirtualRows` with measured heights and the queue's anchor (§9.2), extended with the top spacer and the glide where it lacks them | east-ui-components `./internal` |
| The session | one `EditHistory` over a session per record the queue writes — the cases' record, for their verdicts, and each record a change lands in, through its kind's own write — the history item, its keys (`shortcuts.ts`), `SessionBanners`, Retry; as the Roster's records are | east-ui-components `editing/`, e3-ui-components `shared/schedule/` |
| The Save notice | `prepareRecordSliceSave` through the session's `prepare`, and `RecordSliceSaveNotice` in the footer: the cases a Save took out of the narrowing | east-ui-components `slice/record/save.tsx` |
| Your call, Why override | the shared radio group renderer | east-ui-components `forms/` |
| The note, the override's note | the shared Textarea and StringInput renderers | east-ui-components `forms/` |
| Modify | the builder's inspector form for one row: its kind's form over its roles and `fields` (`FieldForm` over `Fields.specs`, `baseline` the proposed row), held by `ready`, or the kind's own `inspector` (`RowInspectorType`) — as the Plan's, the Calendar's, the Roster's and the Schematic's inspectors draw one row | east-ui-components `forms/field-form/`, e3-ui `utils/row-inspector.ts`, e3-ui-components' inspectors |
| Buttons, status dots, chips | the `button` recipe (`xs`, 24px), the `status` recipe, the `chip` recipe | east-ui-components theme |
| The empty state | the shared `EmptyState`, Font Awesome icons | east-ui-components |
| The marks | the `elara` tokens, and the glow and the ghosts an Optimise run's result is drawn with where it lands (#1409) | east-ui-components `theme/`, `src/optimise/` |
| The previews' looks | each builder's own slot recipes at the crop's sizes: the Roster's tiles, the Plan's bars and ruler, the Calendar's events, the Allocation's bins, the Sheet's cells | east-ui-components theme |
| The previews' arithmetic | the Roster's hours, rules and pay; `Allocation.loads` and `check`; Schedule's overlaps; each compiled once per row type | e3-ui |
| Formatting | `useFormatters` — values through the case's `format`, times and days in the app's locale | east-ui-components |
| Keys | `takeKey` for `j`, `k`, Escape, Enter and Space; the session's ⌘Z, ⇧⌘Z and ⌘Y | east-ui-components |
| Narrow hosts | `useContainerBelow` on main | east-ui-components |

The queue's own looks — the card and its head, the receipt, the count chip —
are one slot recipe,
`decisionQueue`, rewritten (§13); a part a builder already draws is that
builder's recipe, never copied.

## 7. Layout in BuilderFrame

```
┌──────────────────────────────────────────────────────────────────┐
│ DECISIONS [8]  ⏚ Judgement: Waiting × 8 of 11   ↶ ↷ Discard Save │  toolbar: the count · the rail · the history item
├──────────────────────────────────────────────────────────────────┤
│ ● the session's banners · a read that failed                     │  banners
├──────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────┐        │  main, on --paper-2: the cards in the source's
│ │ ⛭ ROSTER · INBOUND · W10                     2h late │        │  order, the receipts in place, the cases not
│ │ Move 3 night shifts from H. Aspen to C. Clover        │        │  read yet pending, or the empty state
│ │ ┌ the preview ─────────────────────────────────────┐ │        │
│ │ [PROPOSED] C. Clover · Mon, Wed, Thu nights           │        │
│ │ +$8k uplift                         ● NEEDS ANSWER    │        │
│ └──────────────────────────────────────────────────────┘        │
│ ● APPLIED  Raise the Coast list price to $11.00          Undo    │
├──────────────────────────────────────────────────────────────────┤
│ 1 decision left this view                   ● Loading decisions… │  footer: the Save notice · the shared loading line
└──────────────────────────────────────────────────────────────────┘
```

| Region | Holds |
|---|---|
| Toolbar | `Decisions` and its count chip first; then the rail (its chips, folding first, to its filter icon at the floor) and its summary; the history item last — its status, its issues, Undo, Redo, Discard and Save — folding to its buttons. Where the whole ladder still leaves the row too wide, the row's floor, the fewest of its rungs that fit: the rail's icon drops its caret, then `Decisions` leaves its count chip — its name said and on hover; the history and Save stay in the row (R30). One row at every width. |
| Banners | The session's banners (R29); a read of the cases that failed, with Retry. |
| Main | The list: the cards in the source's order, the receipts in place, the cases not read yet as pending cards, or the empty state. It scrolls itself; nothing else does. |
| Footer | The Save notice (`3 decisions left this view`, R26) and the shared loading line (`Loading decisions…`, `Filtering decisions…`, `Couldn't read decisions` with Retry), `liveFooter`; nothing while nothing is in flight. |

## 8. Anatomy, from the mock

All sizes from the mock; every value a token of the design system.

**Toolbar.** 44px, the frame's row. `Decisions` in mono, `--fs-label-md`,
600, tracking 0.14em, upper case, `--ink`; the count chip 16px, `--paper-3`,
mono `--fs-label-sm` 600, `--ink-2`, its background settling from
`--brand-tint` to `--paper-3` over `--dur-slow` when the count changes; the
history item every editing builder's.

**Main.** `--paper-2`, the list padded 12, its cards and receipts 8 apart. A
case not read yet is a pending card, a closed card's height: the shared
skeleton's static `--paper-3` shapes after the reveal clock, as the paged
Library's pending cards are.

**A card.** `--paper`, 1px `--rule-strong`, `--r-md`, `overflow: clip`. Its
head: padding 12, rows 8 apart — the eyebrow (the target's icon 14 wide at
11px, `--ink-3`; `Name · scope` mono `--fs-label-xs` 600, tracking 0.12em,
upper case, `--ink-4`, cut with an ellipsis; the due words mono
`--fs-label-md` 600 in their tone: `--neg-text` overdue, `--warn-text` due
today, `--ink-3` later), the title (`--fs-body` 600, line height 1.4, `--ink`, its figures
in mono), the preview, the chip line (`Proposed` or `Modified`, a dashed
`--brand-d` chip 18 tall, mono `--fs-label-xs` 600, tracking 0.1em; the
summary mono `--fs-label-md` `--ink-3`, one line), the value line (the value
mono `--fs-body` 600 — `--brand-dd` once modified — its unit mono
`--fs-label-md` `--ink-4`, the status at its end: an 8px dot and mono
`--fs-label-sm` 600 upper case in its tone; a routine case with no other
status reads `Routine`, its dot and words `--ink-4`). Hover `--paper-2`; a
modified card's head `--brand-tint`.

**The open card.** Its border `--ink`; its head `--paper-3` with a 1px `--rule`
under it, sticky at the list's top. Its body: padding 12, sections 16 apart.

| Part | Look |
|---|---|
| Options · N | Its label mono `--fs-label-xs` 600, tracking 0.18em; a listbox, 1px `--rule-strong`, `--r-md`; rows at least 40 tall, a 14px mark column (Font Awesome `check` in `--pos-text` on the chosen, `ban` in `--warn-text` on a refused), the label mono `--fs-label-lg` 600 with its line under it (mono `--fs-label-xs`, `--ink-4`; `--warn-text` when refused or warned), the value at the end; the chosen row `--paper-3`. |
| Change | `Change` (the label style); the option's sentence, `--fs-body-sm` `--ink-2`, its figures in mono. |
| Figures | Three columns 12 apart: the unit, If wrong, Confidence — each label mono `--fs-label-xs` upper case `--ink-4`, its figure mono `--fs-body` 600, a sub line mono `--fs-label-xs` `--ink-3`; `no data` italic `--ink-4`. |
| Your call | A box, 1px in its tone over a 6% wash of it, `--r-md`, padding 8 12: the icon 14 (`triangle-exclamation`, `circle-exclamation`, `check`), the word mono `--fs-label-sm` upper case in the tone's text step, the question `--fs-body` 600, the radios 32 tall (Yes · No · Don't know), the help `--fs-body-sm` `--ink-3`. |
| The warning | The same box in `--warn`. |
| Why | A 24px toggle: the chevron (`angle-right`, turning 90° over `--dur-fast`), `WHY`, the model mono `--fs-label-xs` `--ink-4`; open, the paragraph `--fs-body-sm` `--ink-2`, inset 24. |
| The note | `Add a note`, a link; then the shared textarea, two rows, `--brand-tint` while it holds text. |
| Actions | A foot on `--paper` with a 1px `--rule` above it, padding 12: Defer (or Hand off) · Override… · Modify · Apply (or Apply with edits), each the `xs` button, 24 tall; Override… and Modify pressed while their panel is open; Apply off — `--rule` edge, `--ink-5` — with its reason as its tooltip. |
| Edit | A panel, 1px `--rule-strong`, `--r-md`, padding 12: `EDIT` (or `YOUR DECISION`), its meta, Reset all; each changed row's form — the builder's inspector form (D9) — a changed field tinted `--brand-tint`, each with its reset (Font Awesome `rotate-left`), each row with Keep as it is. |
| Override | `WHY OVERRIDE`, two columns of radios (Missing context · Data is wrong · Priorities changed · Other), a note field, Cancel · Override case. |

**The receipt.** 40 tall, `--paper-2`, 1px `--rule`, `--r-md`, padding 0 8 0
12: an 8px dot and the verdict mono `--fs-label-sm` 600 upper case in its
tone (Applied `--pos`, Overridden `--warn`, Deferred `--ink-4`, Handed off
`--info`), the option's title `--fs-body-sm` `--ink-3` cut with an ellipsis,
Undo `--fs-body-sm` 600 `--brand-d` while it is the history's (R27). A case
read decided — saved, or decided in another session — is the same receipt
with no Undo.

**The empty state.** The shared `EmptyState`: `Nothing waiting`, and two lines
with Font Awesome icons — `Undo brings the last verdict back`, `New cases arrive
with the next run`. It shows only once the read has landed: a read in flight
is the cold load's cover, or the narrowing's cases standing in (R5).

**A preview.** One `role="img"` box, 1px `--rule` (dashed `--rule-strong` when
stale), `--r-sm`, `--paper`, 96–120 tall by kind, the card's width less its
padding (312 when the queue is 360 wide). Sizes by kind: P2–P12.

**Timing.**

| What | Value |
|---|---|
| A card opening | `grid-template-rows` 0fr → 1fr, `--dur-base`, `--ease-out` |
| A card closing | removed in one frame |
| The anchor's tween, the reveal | 200 ms, ease-out cubic |
| The reveal's wait | `--dur-base` after the open |
| The receipt's arrival | the card's height → 40, `--dur-base`, `--ease-out` |
| The count chip's settle | `--dur-slow`, `--ease-out` |
| Under `prefers-reduced-motion` | every duration 0; the anchoring applies |

## 9. Behaviour

Every rule numbered, with the module that owns it and its test. R are the
queue's, P the previews'.

### 9.1 Reading (owner: e3-ui-components `decision/data.ts`; test: DOM on e3-web)

- **R1.** The queue reads its cases as the Plan and the Sheet read rows (D4):
  whole, or the slice's `decisions` source a window at a time — the windows
  around the view, read as the list scrolls and comes to rest — in the order
  the source's index gives them; never every case of a narrowing, and with no
  cap. The rows the cases in view change are read by key, one request a
  record, through each target's `entries`. Nothing is narrowed in the browser.
- **R2.** It keeps the source's order: the cases are neither sorted nor
  grouped (D5). Each stands where its source places it — a waiting case its
  card, a decided one its receipt (R24) — and a case not read yet is a
  pending card.
- **R3.** The toolbar's count is e3's count of the narrowing, or the record's
  size read whole; `…` while it is read. A case shows waiting while neither
  its row nor its draft holds a verdict.
- **R4.** The count chip settles from `--brand-tint` to `--paper-3` each time
  the count changes.
- **R5.** A new narrowing — or a new revision, or a new count at the same
  revision — keeps the cases shown standing in, retained, until its own land,
  then swaps them at once, a new narrowing's view starting at its start, as the
  paged Library's rows do (#1424). The open case stays open wherever it shows.
- **R6.** Another session's change lands as the source moves: its windows are
  read again at the new revision, the cases shown standing in. A case decided
  elsewhere reads back with its verdict — its receipt, with no Undo, where the
  narrowing still holds it — and an open card whose case leaves the list goes
  with it.

### 9.2 Expand and collapse (owner: `decision/list.tsx`; test: DOM and the showcase's responsive spec, measured)

- **R7. One open.** Opening a card closes the one that was open. `onSelect`
  hears the open case's key, and `none` when the last one closes.
- **R8. Anchor.** The head you click stays exactly where it was on screen.
  When a card above it closes, the list scrolls by the same amount before the
  next paint, so nothing appears to move. If the list can't scroll back that
  far, a top spacer of the shortfall holds the head, then one 200 ms tween
  closes the spacer and, if needed, scrolls on to reveal the body, so the card
  slides up in one visible move (`scrollTop += top after − top before`,
  `overflow-anchor: none`). Measured: the head's top before and after within
  1px.
- **R9. Open.** The body grows down from under the head, and the cards below
  slide down with it. **Close.** The body is removed in one frame; the head
  doesn't move.
- **R10. Sticky head.** The open card's head sticks to the list's top while
  its body scrolls under it.
- **R11. Reveal.** If less than 64px of the opened body shows, the list glides
  after `--dur-base` until the head is 8px from the top, the head in view
  throughout.
- **R12. Keys.** `j` and `k` step to the next and the previous waiting case,
  opening it and anchoring as a click does — a case not read yet is brought
  into view and opens as it lands; Escape closes the override panel, else the
  open card; Enter or Space on a head toggles it; ⌘Z, ⇧⌘Z and ⌘Y are the
  history's. Focus moves without scrolling. The queue takes these keys; a key
  typed in a field is the field's.
- **R13. Reduced motion.** Every duration is 0; the anchoring applies.

### 9.3 The open card (owner: `decision/card.tsx`; test: DOM on e3-web)

- **R14. Options.** With more than one option, `Options · N`: choosing one
  that is not refused makes it the card's choice — the preview, the summary,
  the value, the figures, the question and the warning follow it, and the chip
  reads `Modified`, the value `--brand-dd`. A refused option takes no click.
- **R15. Figures.** The unit's figure is the chosen option's value; under it
  `before your edits` once edited, `proposal {value}` when another option is
  chosen, `only option` with one, else `{difference} vs next best`. If wrong is
  the `ifWrong` figure in the case's format, Confidence the option's to two
  places; either `no data` without one.
- **R16. Your call.** With the chosen option's question: unanswered,
  `Needs your answer` and Apply waits (`Answer the question above to apply.`);
  No, `Blocked` and Apply stays off (`Blocked by your answer · override or
  defer.`); Don't know, `Handoff` — Defer becomes Hand off; Yes, `Answered`
  and Apply is on. The card's status says the same: `Needs answer`, `Blocked`,
  `Handoff`.
- **R17. The warning** shows the chosen option's `warn`.
- **R18. Why** opens and closes the reason; `Add a note` opens the note, which
  stays open while it holds text.
- **R19. Modify.** The Edit panel: `Edit` and `drafts on the proposal`, or
  `{n} changed · drafts on the proposal` — `{n}` each field of a row's top
  level the viewer changed from the proposal, and each row kept; each changed
  row in its builder's inspector form (D9, the table below), a field changed
  from the proposed row tinted and taking its reset, the kind's `ready`
  holding Apply with its words — each issue on a line under its row (`price:
  A list price moves in 5¢ steps`), Apply's tooltip naming each by its row
  (`coast · price: A list price moves in 5¢ steps`); Reset all returns every
  field; each changed row takes Keep as it is. An edit the row's kind refuses
  — its write answers none, or throws — says so under the row's form (`This
  edit can't be made`), the row as it was. The preview follows each edit.
  Apply reads `Apply with edits`. A row kept as it is, or edited back to the
  row as it stands, is no change: Apply writes nothing of it, the preview
  leaves it out — a change left with no row drawn as an option that changes
  nothing (P4).
- **R20. Override…** opens `Why override`: one reason of four and a note —
  `Say what the model got wrong` for Other, else `Add a note (optional)`;
  Override case is on once a reason is chosen, and for Other a note is
  written — and stays off while the app's check holds the rows the person's
  own change leaves (R19), its tooltip the check's words. The Edit panel above
  it reads `Your decision` and `set what happens instead · the model learns
  from it`. Cancel and Escape close it.
- **R21. Choices.** The choice, the answer, the note, Modify's edits and the
  override form are the viewer's under the queue's `id` until a verdict (D12):
  a card closed and opened again, or the queue unmounted and mounted again,
  shows them as left.
- **R22. Read only.** Under `readOnly` a card opens and shows everything but
  takes no choice, no answer and no action, and the toolbar has no history
  item.

**Modify's form, builder by builder (D9).** Each changed row is drawn in its
builder's inspector form for one row, made from the row and its kinds alone:
the queue holds none of a builder's window or rail, so what an inspector reads
off its builder's view is not drawn, and what must hold Apply is the app's
`ready`.

| Target | The form | Not drawn |
|---|---|---|
| Roster | The duty's times, its position and — a person's duty — its activity, the Roster's own fields, written through the duty kind's roles; then the duty kind's own `inspector`, else its `fields` | The checks the Roster's inspector makes as it edits — a position the person may take (`validRoles`), the rest between shifts: the preview draws a breach the edit leaves by the target's `rules` and `check` (P15) |
| Plan | The kind's form over the fields its roles leave, or its own `inspector` | The inspector's facts about the event |
| Calendar | The event's title and status; its placement, refused as the Calendar refuses one before asking its `canDrop`, every resource offered — a paged kind's sought by key, as the Calendar's Chooser seeks one; then the kind's own `inspector`, else its other fields | The kind's `canDrop` |
| Allocation | The Bin section's form: the lane as its segments, the time printed, the quantity no less than the bin's parts take — a bin wholly on one resource taking its part with it; then the bin kind's own `inspector`, else its `fields` | The time's stepper — a lane picked keeps the bin's time — the bin's facts, and its key, which its row's head names |
| Sheet | Its Details' row form over the row's own fields — the id field and a read-only column printed, a select offering every member of its register — or the author's own Details; a grouped sheet's form is a line's, none of the record's rows, so its rows take Keep as it is alone | A field a custom column or a projection reads; what the Sheet reads off its grid at the row — a quantity's unit, a date's level, a stamped code's owner, a column's options rule; its `ready`, which is over its cells, never a row |
| Record, zones, projection | The target's own `inspector`, else its `fields`, written through its `set` | — |

### 9.4 Deciding a case (owner: `decision/editing.ts`; test: DOM on e3-web)

- **R23. A verdict is one step.** Apply drafts the chosen option's change, as
  Modify left it, into its builder's record through its target's kind's own
  write, and the verdict into the case's own row — `verdict` with the time,
  `option`, `answer` and `note` as the roles map them — one step of the
  queue's history across the records it writes (Q1). Override case drafts the
  verdict with its `reason` and `note`, and the person's own change where the
  Edit panel set one; Defer and Hand off draft the verdict alone. A change
  that no longer applies (P21) takes no Apply (`The rows moved since the
  proposal · override or defer.`); Override and Defer stay.
- **R24. Receipt.** The card becomes a 40px receipt in the same place: the
  dot, the verdict, the option's title and Undo. The card shrinks to it and
  the cards below rise. A case read decided — saved, or decided in another
  session — is the same receipt, with no Undo.
- **R25. Stays.** The receipt stays in its case's place while the case is in
  the list: no hold and no leaving (ruled 30 Oct 2026, D4). The focus moves to
  the next card's head, which neither opens nor scrolls.
- **R26. Leaves at Save.** Once Save's verdicts read back, the source's windows
  are read again at the new revision: a decided case the narrowing leaves out
  — every one, under `judgement: waiting` — leaves the list as they land, and
  the shared Save notice says how many left (`3 decisions left this view`); one
  the narrowing holds stays, its receipt without Undo (D18).
- **R27. Undo.** A receipt's Undo is the history's Undo, shown while its
  verdict is the history's last step: the case comes back open where the
  receipt was, anchored as any open, its choices as they were. Once a later
  step lands, the receipt holds without Undo, and the toolbar's Undo reaches
  its step in turn; Redo is the history's.
- **R28.** *Removed, 30 Oct 2026: the Routine band's batch went with the
  band (D5).*
- **R29. Save.** The history item's Save sends each record's changes through
  its patch door as a request of its own — the cases' record, for their
  verdicts, and each record a change lands in — and what the narrowing then
  leaves out leaves the list (R26). A conflict, a refusal or an unknown
  outcome is the session's banner, with Retry where it applies; that record's
  drafts stay and
  the others' commits stand, as the Roster's do. A drafted row its record's
  `ready` fails holds Save, as a builder's kinds hold it. Discard returns
  every case decided since the last Save.

### 9.5 The previews (owner: e3-ui-components `decision/preview/`; test: DOM on e3-web, the showcase's responsive specs in both themes)

- **P1. Placement.** One preview per card, between the title and the chip line,
  on the closed and the open card alike, drawn from the chosen option's change
  as edited.
- **P2. Size.** Fixed per kind, 96–120 tall, so cards line up — never taller
  than the Roster's crop; nothing scrolls inside one.
- **P3. Kind.** From the change (D7): a builder's crop when it lands on at most
  two of the builder's rows, its map otherwise; the Sheet's first three rows;
  a record's changed fields, mix or groups; zones; a projection.
- **P4. Crop.** The builder's own rows at its own sizes — Roster rows 36, tiles
  24; Plan bars 18; Sheet cells 28; bins 24 — cut to the rows the change lands
  on, plus, for an option that changes nothing, the rows the recommendation
  lands on. The row head names who or what, with its measure before → after.
- **P5. Map.** Every row the change touches as the builder draws it, compact:
  rows 16, tiles 12, at most four rows, then `+ {n} more`; the Plan's and the
  Calendar's resources as 22px tiles grouped as their kind groups; the count
  of what changes beside them (`20 of 36`).
- **P6. Record.** A change with no builder shows its changed fields: the
  field, the old value struck, the new value glowing; unchanged fields stay
  plain; rows 54, up to two fields across its rows, in the form's order. Each
  value prints as the row's form prints it read-only (`fieldText`) — a
  Boolean in words, a checklist its items done of all, an absent value `—` —
  so the preview and Modify print a value alike.
- **P7. Cost.** A Roster map whose target says `map: "cost"` reads by what it
  costs, by the target's `pay`: the week the change lands in, before it and
  after it, priced by the app's pay a person at a time and totalled by the
  pay codes it answers with — a row per code, the codes the change moves
  first, the change as a bar from zero, savings dashed ghosts, added cost
  glowing; rows 17, up to five codes. The axis is symmetric about zero at the
  round step past the largest change (`−$1K · 0 · +$1K`), in the target's
  `currency`; each row is titled with its code's pay a week, before → after,
  whole under 1K and compact past it (`AGENCY · $816 → $0 a week`).
- **P8. Projection.** The measure over its horizon, a line per option: the
  chosen one glowing, the as-is one (the option whose change changes nothing)
  a dashed ghost, the others thin context lines; the limit a dashed warn rule
  with the warn wash below it; plot 84 tall, lines 2 and 1px, wash 6%. Each
  line is labelled at its end, or along its run where the labels would meet;
  the x ticks are plain numbers; the y axis shows its round top, and the
  limit its label in `--warn-text`. The sentence names the chosen line first.
- **P9. Zones.** Areas filled by their zone, depots as dots; areas changing
  zone take the new zone's fill and the glow; the key gives each zone's count
  before → after; tiles 16, twelve a row, zones in chart accents.
- **P10. Mix.** A row per key on a shared axis: as is a hollow dot, proposed a
  glowing dot, joined by a 2px Elara line; rows 17, dots 8, up to five rows.
- **P11. Groups.** A rule across many rows: a row per group, its track the
  group's size, the glowing part the rows that change, then the count and the
  net change; rows 17, bars 8, up to five groups, the most rows changing
  first. A group's size is counted through the target's `source`, its index
  on the group's field — every group shown asked in one pass, never the
  record read whole.
- **P12. When strip.** Under a batch map, one glowing tick per change at its new
  time; strip 12, ticks 2 wide.
- **P13. Proposed.** The entry's own fill and the steady glow — `0 0 0 1px`
  `elara.edge`, `0 0 8px 1px` `elara.soft` — as an Optimise run's result is
  drawn where it lands.
- **P14. Moves off.** A dashed ghost where the entry was (1px dashed
  `elara.edge`); struck through where it is gone.
- **P15. Breach.** The entry still breaks a rule after the change, by its
  builder's own check: a 1px `--warn` ring outside it (offset 3), Font Awesome's
  `triangle-exclamation` on it, the row's measure in `--warn-text`.
- **P16. Knock-on.** An entry the option's `knockOn` names keeps its own fill
  and takes a dashed `elara.edge` ring, no glow.
- **P17. Locked.** An entry the declaration's `locked` says is pinned takes
  Font Awesome's `lock`.
- **P18.** *Removed, 30 Oct 2026: which other cases change an entry is known
  only by reading every case (D4).*
- **P19. As it is.** Unchanged entries in their builder's colours: the shifts'
  colour tokens, the Plan's committed bars `--brand-d`.
- **P20. Now.** The now line on a time axis, 1px `--brand-d`.
- **P21. Stale.** The patch no longer applies to the record — a row moved since
  the run: the frame turns dashed and the proposal a dashed `--paper-3` shape
  with no glow; the case's status reads `Stale`, and Apply is off (R23).
- **P22. Applied.** As the receipt arrives, the glow settles into the builder's
  own fill and the ghosts go, over `--dur-slow`.
- **P23. Loading.** The preview's rows not read yet are the shared skeleton:
  static `--paper-3` shapes in the final layout, after the reveal clock, no
  shimmer; a read that failed says so once in the preview.
- **P24. Text.** No captions inside a preview; names and measures in the row
  heads, figures in mono; a measure that gets better takes `--pos-text`, worse
  `--warn-text` or `--neg-text`, neither `--ink-3`.
- **P25. Access.** Each preview is one image with a sentence that says what
  moves where (`H. Aspen's night shifts on Monday, Wednesday and Thursday move
  to C. Clover`); tiles and chips carry a title.
- **P26. A guess.** A changed row the chosen option's `guesses` names takes,
  in each of its changed cells, a 6px round `--warn` dot 6 before the value,
  titled `conf {confidence} · a guess` (two places); the Sheet's crop and a
  record's changed fields draw it, and the preview's sentence names the
  guessed rows (`WO-1007 is a low-confidence guess`). A key naming no changed
  row marks nothing.

### 9.6 Narrow hosts (owner: `decision/index.tsx`; test: responsive at 1440/1024/768/390/360 and a 294px parent)

- **R30.** The queue is one column at every width; a card's parts wrap within
  it; nothing scrolls sideways. Below 480px of main, the rail is its filter
  icon and the history item its buttons; the count stays. Where that row is
  still too wide, it takes the row's floor (§7): `Decisions` leaves its count
  chip, saying its words to a screen reader and on hover, so Undo, Redo and
  Save stay in the row, down to a 294px parent. On a coarse pointer every
  control is a 44px target by its box or its halo — an option, whose neighbours sit edge to edge, by its own 44px height —
  the row and the cards unmoved. The width is the queue's own, whatever holds
  it: in a page, a card, a drawer or a popover it is the same component.

## 10. Copy

| Where | Copy |
|---|---|
| Count | `Decisions` and its chip (at the row's floor the chip, `Decisions` said and on hover) |
| Due words | `{n}m late` · `{n}h late` · `{n}d late` · `by {time}` · `by {weekday} {day}` |
| Chip | `Proposed` · `Modified` |
| Status | `Needs answer` · `Blocked` · `Handoff` · `Stale` · `Routine` |
| Options | `Options · {n}`; a refused option's line `refused · {reason}` |
| Change | `Change` |
| Figures | `{unit}` · `If wrong` · `Confidence` · `no data`; `before your edits` · `proposal {value}` · `only option` · `{difference} vs next best` |
| Your call | `Needs your answer` · `Blocked` · `Handoff` · `Answered`; `Yes` · `No` · `Don't know` |
| Your call's help | `Apply waits for this answer. The model can't see it.` · `Your answer contradicts the proposal. Override it or defer the case.` · `Nobody here can answer yet. Hand the case on.` · `Recorded with the verdict.` |
| Why | `Why` · `{model}`; `Add a note`; placeholder `What you know that the model can't see` |
| Actions | `Defer` · `Hand off` · `Override…` · `Modify` · `Apply` · `Apply with edits` |
| Apply off | `Answer the question above to apply.` · `Blocked by your answer · override or defer.` · `Handoff · defer hands the case on.` · `The rows moved since the proposal · override or defer.`; the app's check, each issue by its row, `; ` between: `{row} · {field}: {message}` |
| Edit | `Edit` · `Your decision` · `drafts on the proposal` · `{n} changed · drafts on the proposal` · `set what happens instead · the model learns from it` · `Reset all` · `Keep as it is` · `Reset {field} to the proposal`; under a row: the check's `{field}: {message}` · `This edit can't be made` · `Its own form could not be shown: its fields are shown instead` · `This row's form could not be shown` |
| Override | `Why override` · `Missing context` · `Data is wrong` · `Priorities changed` · `Other` · `Say what the model got wrong` · `Add a note (optional)` · `Cancel` · `Override case` |
| Receipt | `Applied` · `Overridden` · `Deferred` · `Handed off` · `Undo` |
| History | the shared editing words: `Undo` · `Redo` · `Discard` · `Save`, the status line and the session's banners (`editingMessages`) |
| Save notice | the shared words, in the queue's noun: `{n} decision left this view` · `{n} decisions left this view` · `Updating view…` · `Saved; view update failed.` and `Retry` |
| Empty | `Nothing waiting` · `Undo brings the last verdict back` · `New cases arrive with the next run` |
| Loading line | `Loading decisions…` · `Filtering decisions…` · `Couldn't read decisions` · `Retry` |
| A guess | `conf {confidence} · a guess` |

## 11. Where the product differs from the mock

Each conflict as the mock has it, what exists in the repo, what this design
does, and what follows.

| The mock | What exists | The product | Consequence |
|---|---|---|---|
| The queue in a 360px popover under a page's button — the trigger, its count and overdue dot, the popover's edge and shadow, the × in the head — and on a phone with the phone's own header | Every builder is its `BuilderFrame` alone, borderless; a host places it and sizes it | The queue alone: a `BuilderFrame` and what is in it (D2, §3.4) | A host places the queue in a page, a card, a drawer or a popover. The trigger, its count and the close are the host's own chrome; no prop of the queue's is a placement's. |
| The phone opens no card at first | Today's queue: `defaultExpanded` | The first case opens wherever the queue is placed, until the viewer closes it | One behaviour at every width; the viewer's choice is kept under `id`. |
| A 44px head of the component's own, with no rail | Every builder: one toolbar holding its rail and its history item | The `BuilderFrame` toolbar: the count, the rail, the history item | The mock's head becomes the toolbar's first items. |
| `Decisions`, its chip and `2 past due` on one head at every width, beside no rail and no history | Every builder's row folds by the shared ladder, and past it by its floor's rungs, as the query builder's Run goes to its icon | No past-due count (D4); past the ladder, the row's floor: `Decisions` leaves its chip (§7, R30) | Counting the past-due cases needs every case read; each card's due words say it. On a phone the history and Save stay in the row; the words a rung drops are said to a screen reader and on hover. |
| No footer | Every builder's footer: the shared loading line (#1398) | The frame's footer, with the shared loading line | At rest the footer is empty. |
| Three sections — Overdue, Due today, This week — each case in its section, in the order the mock lists them | Every builder over a record pages it a window at a time in its index's order: the Plan, the Sheet, the Calendar, the Flowchart's Flows | No sections: the cases in the order their source gives them, each card's due words in their tone (D5, ruled 30 Oct 2026) | A queue of any size reads only the cases in view; the app orders its cases by the indexes it declares. |
| The Routine band at the end, folded, its total and Apply all, and the batch banner | — | No band: a routine case is a card like any other, marked `Routine` (D5) | Each routine case is applied on its own card. |
| The areas' table — a label and an icon per surface | — | Each target's `name` and `icon` (D10) | The mock's areas are where the changes land; nothing else names them. |
| `Applied · staged for the next run`, the verdict written at once, Undo for 5 s, then the receipt leaving | Today's queue: Apply and Reject through the handle's commit gate. Every builder: drafts of the shared session until Save | A draft of the shared session until Save; the receipt stays in its case's place while the case is in the list, its Undo the history's while its step is the last (Q1, Q2, R25, R27) | A verdict reaches the record at Save, and a narrowing on judgement then takes the case out of the list, which the Save notice counts (R26). Under Q1 the change lands in its builder's record with the verdict, so nothing waits for a run. |
| The open card's `Open in {area} →` link | Every builder's `onSelect` hears its selection | `onSelect` hears the open case; the host follows it | The link inside the card is lost; a host that wants it opens its builder from `onSelect`. |
| Modify's fields written for each case (the roster's Days and its weekly cap, the Plan's Run time) | Each builder's inspector: its kind's form over its `fields`, held by `ready`, or the kind's own `inspector` | The builder's inspector form for each changed row (D9) | A field that is no field of the record — a weekly cap the next run keeps, a run time — has no place; the note says it. |
| The checklist chips (Mon · Wed · Thu, Line 1 · 2 · 3) | The shared form renderers: an input per East type, a Set as tags | The input the shared form draws for the field's type | The mock's chips are not drawn. |
| Its own radios, inputs and textarea | The shared radio group, inputs and textarea | Those | — |
| The options' `✓` and `×`, the empty state's `☐`, the groups' `▲` `▼` | Font Awesome solid icons everywhere | Font Awesome solid icons (D13) | — |
| The cost map's axis fixed at ±5k, over pay codes and figures of its own | The Roster's `pay`, the app's, which prices a week's duties in its own codes | The app's own codes (`AGENCY`, `ORD`, `OT1`) and the figures its pay gives over the rota's week before and after; the axis symmetric about zero at the round step past the largest change (P7) | The figures are the app's, whatever its codes; a fixed axis would flatten a small change and clip a large one. |
| A list price's fields printed as money (`$10.50 → $11.00`) | The shared form prints a `Fields.number` as a plain number; the hint has no currency format | Each value as the row's form prints it read-only (`10.5 → 11`, P6) | The preview and Modify print a value alike. A currency format on `Fields.number` is a follow-up; with it, both print `$10.50`. |
| The Sheet crop's low-confidence dot, per row (`conf 0.69 · a guess`) | The Sheet has no confidence mark; a patch carries none | The option's `guesses`: the rows the model is unsure of and its confidence in each, their changed cells dotted (D16, P26) | The model says what it guessed; the dot is the preview's alone, never the Sheet's. |
| `<DecisionPreview>` as a component of its own | — | The targets, in the change role's `of` | A component is an interface and a renderer: the queue's payload carries the targets. A preview placed on its own is a follow-up. |
| `--elara-*` tokens awaiting the design system's sign-off | The `elara` tokens Optimise added (#1409) | Those tokens | — |
| Verdicts in the mock's own state | Today's queue: the handle's stored envelope and its judgement record | The verdict on the case's own row, the app's record (D1) | Nothing of the queue's is stored. |
| A total on every section and on the Routine band (`+$3.4k together`), every figure summed as money | Each case's figures print through its own `format` | No totals (D4) | A total needs every case read, and the examples' figures mix money with counts — the due dates, the trial's MPa, the press's days. |
| Money in the mock's own words (`+$86.2k`) | `useFormatters`: a value through the app's `Format` | Every figure through the case's `format` — `Format.Currency({ compact: "short" })` prints `+$86K` | The app's format decides the words; a format of more digits prints more. |

## 12. Edge cases

- A case whose `recommended` names no option of its own is shown with its
  first option as the recommendation, and the card says the case is
  malformed in its warning box; it can be deferred, not applied.
- A tag the change role's `of` gives no target cannot reach the renderer: it
  is refused at build (D6). A change landing on rows the record no longer
  holds, or holds changed, is Stale (P21).
- A target's kind bound read only is refused at build, naming
  `Record.bind(record)`, its record declaring `patch: mutation.patch()` (§5.3).
- A case without `options` and with `recommended`, or with option roles both
  in `options` and beside the case's, is refused at build, naming D15's two
  forms.
- A run that proposes again under a key the record holds: the app's own
  mutation decides — keep the verdict, or set the case waiting again (D1).
- A verdict on a case another session decided meanwhile is the session's
  conflict at Save (R29); the case reads back with the other session's verdict.
- A verdict drafted on a case the rail then hides is kept by key, and Save
  writes it; its receipt shows wherever the case shows again (D3).

## 13. What is removed

| Today | Becomes |
|---|---|
| `Decision.bind`, its handle (`Decision.Types.Handle`, `HandleFor`, `CommitState`, the `decision_*` primitives, `DecisionBindPlatform`) | `DecisionQueue.decisions` over the app's record of cases |
| `Decision.Types.Decision` and its parts — `Decision.make`, `option`, `reference`, `judgement`; `DecisionType`, `DecisionOptionType`, `EvidenceType`, `PromptType`, `LeverType`, `StakesLevelType`, `UrgencyType`, `DecisionValueAxisType`, `ReferenceType`; the judgement record (`JudgementInputType`, `judgementInputType`, `Judgements`), the constraint contract (`DecisionConstraintType`, `ConstraintFieldType`, `ConstraintVocabularyType`), `AnswerType`, `VerdictType` | The app's own row types, mapped by roles (§3.1, §5) |
| `<DecisionQueue handle modify evidence defaultExpanded defaultFacet facets onApply onReject slice affordances maxHeight density groups groupBy collapsible>` | `<DecisionQueue id decisions slice onSelect readOnly now>`; an old prop is refused at build, naming its replacement |
| The facets — Evidence, Options, Judgement, Modify — the lever builder and the constraint chips (`facets.tsx`, `lever-editor.tsx`, `constraint-format.ts`, `contract.ts`, `grouping.ts`, `handle-runtime.ts`) | The open card (§9.3) and Modify through the builders' inspector forms (D9) |
| The `decisionQueue` slot recipe's rows, Group-by toolbar, routine summary | The `decisionQueue` recipe rewritten (§8) |
| `<DecisionJournal handle>` | Removed (Q3): its tag, its payload and its renderer; the cases and their verdicts are the app's record |
| e3-ui's `<Diff>` — its tag, payload, runtime and renderer, its showcase page, examples and specs, and the Diff panels in the Ontology's examples | Removed, with this design (ruled 28 Oct 2026: "we dont need it and dont want it"). The binding descriptor the bound handles carry, which the Experiment and the Ontology read, stays, named for what it is — `DataBindingType`, beside `FuncBindingType` |
| `e3-ui/docs/decision-loop.md` | Rewritten to this design |

## 14. Wires

- **UI.** The `DecisionQueue` payload is replaced, and the `DecisionJournal`
  payload (Q3) and the `Diff` payload (§13) removed: package-borne, a
  `WIRE_MIGRATION.md` line each. e3-ui's read by key gains the paged read's
  `id` (`ScheduleEntriesType`'s `paged`), by which the queue asks many rows in
  one request, and the record target's group its `count`: package-borne, a
  line of their own. No
  stored form of e3's changes: the cases, their verdicts on them, are the
  app's own record.
- **Viewer state.** The open card, each card's choices and the session's
  drafts, under the queue's `id`.

## 15. Tests

- **e3-ui specs.** Each role's refusal (a function returning another type, a
  missing required role); the type tests of the roles' inference (a renamed
  field, a wrong return, `of` missing a tag or naming another, a target over
  another record — each a compile error); `decisions` bound with a
  `Data.bind` or a `Data.bindPaged`; `entries` missing beside the slice's
  source, or given with none; a verdict role naming a field the row lacks or
  one of another type, a case named twice, `waiting` holding anything but
  Null; the change role's `of` lacking a tag, or a tag whose type is
  not its target's record's patch (both types named); a target's kind bound
  read only; `map: "cost"` without `pay`; D15's two forms mixed; the builders'
  kinds refused as their tags refuse them; an old prop refused naming its
  replacement; the payload's types.
- **e3-ui-components, DOM on e3-web.** Reading whole, and through the rail a
  page at a time in the source's order with no cap, the pages read bounded as
  the list scrolls; e3's count; a narrowing on judgement and the Save notice
  of the cases a Save took out of it; another session's new case and verdict;
  each part of the open card (§9.3); each verdict drafted into the case's row
  as one step across the records it writes, saved, and read back after a
  remount; Undo, Redo and Discard; a receipt's Undo while its step is the
  last, and gone after a later one; a conflict, a refusal and an unknown
  outcome; choices kept across a remount; Modify through each
  builder's inspector form, its `ready` holding Apply, its edits reaching the
  preview and the record; Stale; the keys; read only; every preview kind and
  mark over the builders' example records.
- **Showcase responsive specs.** The anchoring measured (a head's top within
  1px across an open, a close, a receipt, an Undo, a `j`); the sticky head; the
  receipt's 40px; each preview kind's height and frame; the toolbar at every
  width, the 28px controls and the history item's fold; the footer's line; the
  same queue in a 294px parent and a 360px one, the row's floor in the first;
  computed styles of the card,
  the open card, the receipt and the marks in both themes; reduced motion.
- **Examples.** `decisionQueueMinimal` (§3.2: one record of proposals with no
  alternatives, two tags, a target each), `decisionQueueOps` (§3.3: the mock's
  nine cases and its three routine ones over the warehouse's, the print
  shop's, the workshop's, the kiln yard's and the shop's example records and
  the records no builder draws — the price list, the stock levels, the cure
  settings, the cover targets and the presses' readiness — eleven tags, two of
  them on the duties, narrowed through the app's indexes on judgement),
  `decisionQueueReadOnly`, `decisionQueueRecordIndexes` (§3.5: a replenishment
  model's 20,000 reorders across forty stores, each its own one proposal,
  narrowed through the app's index on judgement, the store and the range,
  opening on the waiting ones and read a page at a time as the list scrolls,
  e3's count in its toolbar, a reorder applied and saved leaving the list with
  the Save notice, the stock rows a reorder changes read by key, a verdict
  drafted on a case the rail then hides and saved), `decisionQueuePhone` (the
  full queue in a phone-width container: its cards, its answers and its Save)
  and `decisionQueuePreviews` (one case per preview kind
  and mark — the projection, the mix, the groups and the zones over the supply
  side's records among them); the plugin index regenerated. The examples seed
  the mock's own cases, like for like (ruled 28 Oct 2026) — the scopes,
  titles, options, figures, questions, warnings and previews `Decision Queue
  Spec.html` draws, over the builders' example records — so the showcase's
  queue and the mock can be compared side by side; each example's DOM test
  reads its cards back as the mock draws them.

## 16. How it ships

One epic, one PR, one commit per child, this spec and the mock its first
commit:

1. **e3-ui — the interface.** `DecisionQueue.decisions`, `.verdicts` and
   `.change.*`, the payload, every refusal; the old envelope, handle and props
   and the journal (Q3) removed (§13); the examples' records.
2. **east-ui-components — the shared parts.** The `decisionQueue` recipe; the
   list's anchor, spacer and glide over `VirtualRows`; the receipt; the marks
   on the `elara` tokens.
3. **e3-ui-components — the queue.** The frame, the toolbar and its history
   item, the reading and the layout, the cards, the session — verdicts and
   changes as steps, Save, Undo, the batch — the receipts, the keys, read only
   and the narrow host.
4. **e3-ui-components — the builders' targets.** The Roster's, the Plan's,
   the Calendar's, the Allocation's and the Sheet's crops and maps, each on its
   builder's own recipes and arithmetic, the guesses' dot, and Modify through
   each builder's inspector form.
5. **e3-ui-components — the other targets.** Record, mix, groups, zones,
   projection, the Roster's cost.
6. **The docs, the skill, the showcase and the index.** `e3-ui` SKILL.md's
   Decide section and `docs/decision-loop.md` rewritten; the showcase's
   decision area; the responsive specs; the plugin index regenerated.
7. **e3-ui — `<Diff>` removed** (§13). Its tag, payload, runtime and
   renderer, its showcase page, examples and specs, and the Diff panels in the
   Ontology's examples; the binding descriptor renamed `DataBindingType`; the
   e3-ui and east-ontology skills' mentions; the plugin index regenerated.
8. **The queue paged** (ruled 30 Oct 2026: D1, D4, D5, D18). This spec
   revised; `DecisionQueue.decisions` over the one record with the verdict's
   roles, `DecisionQueue.verdicts` gone; the paged Library's reading made one
   hook the queue shares; the queue paged in its source's order, its sections,
   totals, past-due count, Routine band, batch and cap removed, the Save
   notice added; each example's record carrying its verdict, the full and the
   windowed examples narrowed by an index on judgement, the Routine example
   removed; the DOM tests, the responsive specs, the skill, the decision-loop
   note and the plugin index.

Each child lands with its packages' build and lint and the specs that read
what it changed run locally, the index regenerated where examples change;
the PR's CI runs the rest.
