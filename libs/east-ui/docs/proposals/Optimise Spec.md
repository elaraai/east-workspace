# Optimise — design

The Elara eye in the e3-ui collection builders — Roster, Calendar, Sheet,
Plan and Allocation. A click sends the period in view and its rows to the
app's optimiser, one `e3.function` call; the result lands in the builder's edit
session as **one edit**, exactly as a drag or a paste does, so one Undo reverts
the whole run and Apply saves it with everything else. While the call is out
the eye pulses, the footer line counts the seconds and the edit bar is locked;
when it lands every added or changed entry flares, a banner under the toolbar
says what changed, and after 8 s the changes are ordinary unapplied edits.

The `BuilderFrame` itself does not change: the eye is one more toolbar item,
the banner takes the banners slot, the footer line reuses #1398's loading-line
slot, the edit bar is the history item as it is, and the landing is annotation
on each builder's own entries.

This document is the design epic #1409 builds. `Optimise Spec.html` beside it
is the visual design. Where the two differ, this document wins. It is written
against PR #1397's branch (`elaraai/feat/e3-ui-schematic`), where the builders
already load by #1398's rules; the Roster's part assumes the People week view
of #1406 (`Roster People Spec.md`).

## 0. The files

| File | What it is |
|---|---|
| `Optimise Spec.html` | The hi-fi mock: Claude Design's "Optimise" export, one page, self-contained but for Font Awesome (cdnjs) and the fonts (Google Fonts). The eye's states, the landing on each kind of entry, the highlight, the footer line, the banner and the edit bar; then each of the five builders with an empty period and a period with entries, in light and dark. Its sample data is the repo's own synthetic corpora — the warehouse's people, the print shop's jobs and presses, the kiln yard's loads; nothing names a client, its trade or its people. |
| `Optimise Spec.md` | This design. |

**Opening the mock.** Open the file in a browser. The controls at the top
compare the ideas the designer left open; the rulings (§2) fixed them, and the
other settings stay for comparison: *While running* Pulse · Scan · Breathe,
*Landing* Cascade · Together, *Highlight for* 4 s · 8 s · until apply, *The
call takes* 3 · 6 · 10 s, *Result* Lands · No changes · Fails; *Run all* and
*Reset all*. On each card, *Run* plays a run and *Reset* returns it; the eye
in the card's toolbar runs and stops it; Undo, Redo, Cancel and Apply are the
card's edit bar. An agent measures the mock in a headless browser, through its
DOM; nobody reads a screenshot.

## 1. Summary

- **What.** The eye asks the optimiser to fill or improve the period in view.
  The result is an edit like any other: dirty until Apply, undone in one step,
  saved through the builder's normal path. Nothing is saved by the run.
- **Where.** The contract in e3-ui, on each builder's tag; the run, the one
  step, the eye, the footer line, the banner and the landing in
  e3-ui-components and east-ui-components, as shared parts every builder uses.
- **What the app declares.** `optimise={Func.bind(fn)}`: its optimiser, an
  `e3.function` from `<Builder>.Types.OptimiseRequest(R)` to
  `<Builder>.Types.OptimiseResult(R)` — rows in, rows out. Without it there is
  no eye.
- **Built in.** The eye and its states; the call, Stop and the seconds; the
  lock while the call is out; the diff by key and the one history step; the
  landing (the flare, the cascade, the ghosts, the totals' flash), the 8 s
  highlight and its end; the banner; the footer line; provenance on hover;
  reduced motion.
- **Unchanged.** `BuilderFrame`, the toolbar's other items, the history item
  (Undo, Redo, Discard, Save), the inspector, the footer's legend, every
  builder's own gestures.

## 2. Decisions

Ruled by the user on 25 Oct 2026 (O1–O8); the rest are this design's.

| # | Decision |
|---|---|
| O1 | **The contract: `Func.bind`, rows in → rows out.** One `e3.function` per builder, bound as `fit` is, from `<Builder>.Types.OptimiseRequest(R)` — the period in view, the run number, the rows by key of each record the builder writes in that scope (base plus the unapplied drafts) and the builder's context — to `<Builder>.Types.OptimiseResult(R)`, the complete rows by key. The renderer diffs result against request by key and records the diff as one step. A plain East function is not accepted (no second path); a change-list response is not the contract (the client's diff is the edit, spec §3.7). |
| O2 | **One result message**: the `BuilderFrame` banner, for all five (§8, §11). The Roster's last-action band of the People mock is a follow-up of #1406, not built here. |
| O3 | **The scope is the period in view, every row.** The rail's narrowing never narrows a run: the request carries every row of the period, as coverage and the checks read every row (#1342); a hidden row the run changes is highlighted when it comes into view. The Sheet's scope is the current tab's rows. |
| O4 | **A period change stops a run**, as Stop does; a layout, view or filter change does not, and the result lands in the period it was asked of. Leaving the builder aborts the call. |
| O5 | **Drafts are input.** The run receives base plus the user's unapplied edits and may change them; one Undo returns them. A pinned or protected row is a follow-up. |
| O6 | **The design-system conflicts are accepted as drawn** (the designer's §19), as #1398's were: the theme gains the `elara` semantic tokens, aliases of the brand scale's cyan end per colour mode; the eye's halo and the landing glow are the feature's shadows and the echo and the pulse its loops, bounded to the eye and the highlight; the Elara mark is the eye. The design system's own cards follow in a separate pass. |
| O7 | **The visual defaults**: the eye alone pulses while running (Pulse); the landing glows in reading order within 760 ms (Cascade); the highlight lasts 8 s, or until Undo, Apply, Cancel or a new run. |
| O8 | **The spec's five builders.** The Schematic is left out. |
| D1 | **The eye is listed only where the period can be optimised** (ruled 25 Oct 2026, over the mock's disabled eye): a `readOnly` builder, a published week or day, and the Roster's Month — a run is one week's — list no eye, never a disabled one; while the period's reads are in flight it waits in its place, disabled, with the tooltip `Read-only`, as the edit bar's actions do. Unapplied edits never disable it: they are input. A period that stops being optimisable while its run is out — a month opened over the week — stops the run, as a period change does (O4). |
| D2 | **No client-side timeout** beyond the e3 call's own deadline; a timed-out call is a failure (§9.4). |
| D3 | **A base that changes on the server during a run** leaves the result an unapplied edit; Save's normal conflict handling applies, as it does to every draft. |
| D4 | **The eye keeps its place** before the history item in every toolbar fold: the rail and the segments fold first, the eye and the history item last; on a phone it sits beside the history item. |
| D5 | **Runs are numbered per builder per browser**, from 1, kept under the builder's `id` with its other viewer state, so `run #7` stays `run #7` across reloads. |
| D6 | **The step's origin is `optimise`**, a new case of the editing origin, its label `Elara run #n`; a host that folds or announces steps by origin sees it. |
| D7 | **New rows' keys are the optimiser's.** A key that collides with a row outside the scope is Save's conflict to report, as any draft's is. |

## 3. The authoring surface

### 3.1 The optimiser, on e3

```ts
// The warehouse's optimiser: the week's rows in, the week's rows out. Its rules are its own; the Roster sends none.
export const rotaOptimise = e3.function("rota_optimise",
    East.function([Roster.Types.OptimiseRequest(WarehouseDuty)], Roster.Types.OptimiseResult(WarehouseDuty), ($, req) => {
        // req.from, req.to — the week, half open; req.run — the run number;
        // req.duties — Dict<String, WarehouseDuty>: the week's duties as drafted, by key;
        // req.requirements — the week's targets by slot; req.context — Roster.Types.Context: every person, shift, group, position, agency, the rules.
        const planned = $.let(req.duties);
        …                                       // fill the open positions from the people off that day, clear the quick returns
        return { duties: planned };             // the complete set for the week, by key; a new duty under a key of the optimiser's own
    }));
```

### 3.2 The builder

```tsx
// Inside the Roster's Reactive body, beside `warehouseRoster`'s declarations (`Roster Spec.md` §3.3):
const optimise = $.let(Func.bind(rotaOptimise));
return <Roster … fit={fit} optimise={optimise} />;    // the eye appears in the toolbar; without the prop there is no eye
```

The same on the others: `<Calendar … optimise={Func.bind(scheduleBacklog)} />`,
`<Sheet … optimise={Func.bind(setLinesAndDates)} />`,
`<Plan … optimise={Func.bind(placeJobs)} />`,
`<Allocation … optimise={Func.bind(allocateArrivals)} />`.

## 4. The props

| Prop | Takes | What it does |
|---|---|---|
| `optimise` | `Func.bind(fn)`, `fn` an `e3.function` from `<Builder>.Types.OptimiseRequest(R)` to `<Builder>.Types.OptimiseResult(R)` | The app's optimiser. The eye shows, the run calls it once, the result lands as one edit. Omitted, no eye. A handle that is no `Func.bind`, or whose function asks or answers another type, is refused at build, naming the type it asks for over the builder's row type, as `fit` is refused. |

## 5. The East types

### 5.1 Per builder

Each `OptimiseRequest` carries the scope, the run number, the rows of each
record the builder writes in scope — as the record holds them at the session's
base with every unapplied draft in place — and what the builder knows that an
optimiser needs. Each `OptimiseResult` carries the same rows, complete.

```ts
Roster.Types.OptimiseRequest(R)    = StructType({ from: DateTimeType, to: DateTimeType, run: IntegerType,
                                                  duties: DictType(StringType, R), requirements: RosterRequirementsType, context: RosterContextType });
Roster.Types.OptimiseResult(R)     = StructType({ duties: DictType(StringType, R) });

Calendar.Types.OptimiseRequest(E, S) = StructType({ from, to, run, events: StructType({ [slot]: DictType(K, R) }), resources: StructType({ [slot]: DictType(K, R) }) });
Calendar.Types.OptimiseResult(E)     = StructType({ events: StructType({ [slot]: DictType(K, R) }) });
    // E the event kinds' row types by slot, S the resource kinds'; `events` holds the window's events and the kinds' backlog rows

Plan.Types.OptimiseRequest(E, S)   = as the Calendar's, over the plan window;   Plan.Types.OptimiseResult(E) = { events }

Allocation.Types.OptimiseRequest(R) = StructType({ day: DateTimeType, run: IntegerType, bins: DictType(StringType, R),
                                                   arrivals: ArrayType(AllocationArrivalType), context: AllocationContextType });
Allocation.Types.OptimiseResult(R)  = StructType({ bins: DictType(StringType, R) });

Sheet.Types.OptimiseRequest(R, K?) = StructType({ run: IntegerType, rows: DictType(K, R) });     // the current tab's rows
Sheet.Types.OptimiseResult(R, K?)  = StructType({ rows: DictType(K, R) });
    // R the sheet's row type — its rows' struct, a grouped sheet's group, or its entries — and K the source's key type,
    // the row first as `Sheet.Types.ChangeSet(E, K)` takes them; K left out, String: an Array source's rows are keyed by
    // their id field, a record's by its own key
```

Each `(R)` is a constructor: the same row types give the same East type
(`isTypeEqual`), which the tag holds the bound function to. The Calendar's and
Plan's take the kinds' row types by slot (`Calendar.Types.OptimiseRequest({ job: Job, maintenance: Maintenance }, { press: Press })`):
a kind whose record is keyed otherwise than by String gives its record type,
`DictType(K, R)`, in its slot; the slots sort by name, so the same kinds give
the same type however they are listed; and `S` may be left out for a Calendar
with no resource kinds. The Calendar's, the Plan's and the Sheet's tags cannot
see their kinds' or their source's types in TypeScript, so their `optimise`
takes any `Func.bind` handle and the check is the build's; the Roster's and
the Allocation's, generic in `R`, type the handle too.

### 5.2 The payload

Each builder's payload gains `optimise: OptionType(FuncBindingType)`, the
bound function's name, beside `fit` where there is one; the renderer builds the
call handle from the name and the request type over the kinds' row types
(`useFuncCall`), as the fit does. Nothing else changes on the wire but the
editing origin's new case (§13).

## 6. The shared parts

| Part | Where | What |
|---|---|---|
| The run | e3-ui-components `shared/func/use-optimise.ts` | Over `useFuncCall`: `run(request)`, `stop()` (cancel; a late response is ignored), the seconds since the call left, the result once it lands, the failure; one run per builder instance; unmount aborts. |
| The one step | each builder's commands, over `ScheduleEditing.record` (Roster, Calendar, Plan, Allocation) or the Sheet's `session.record` | The diff by key into the builder's changes — `{ kind, id, row, created }` for an add, `{ kind, id, row }` for a change, `{ kind, id, remove }` for a remove — recorded as one step, origin `optimise`, label `Elara run #n`; the redo stack clears as for any edit. |
| The lock | each builder, from the run's state | The history item's actions disabled (`aria-disabled`), drags and drops not registered, cell edits refused, while the call is out; scrolling, selection, the inspector, hover, tooltips and the library live. |
| The eye | east-ui-components `OptimiseButton` + `optimiseToolbarItem` | The mark from the lockup's geometry (100 ring dots, 52 iris dots, two paths), the states of §8, the tooltip, Stop on hover while running, the blink. |
| The footer line | east-ui-components `LoadingLine`, a new `busy` kind | The Elara dot with the live pulse and `Optimising {period} · {n} s`, in the loading pass's slot; `Stopped · nothing changed` for 2.5 s. |
| The banner | east-ui-components `BannerView`, a new `elara` tone | The eye mark, a title and one line, no actions; `role="status"`, `role="alert"` on failure; collapses over `--dur-base`. |
| The landing and the highlight | east-ui-components `theme/slot-recipes/optimise.ts` + `useLanding` | The `elara` tokens; the flare, the steady glow, the ghosts and the totals' flash by `data-op`, `data-fill` and `data-opn`; the cascade's timing; the 8 s end; `prefers-reduced-motion`. |
| The provenance | each builder's entries | `title="Added by Elara · run #n"`, `"Was {previous} · Elara run #n"`, on the ghosts `"Removed by Elara · run #n"`, `"Moved by Elara · run #n"`, until Apply. |
| The legend item | each builder's footer | `Elara change`, appended during the highlight. |

## 7. Layout in BuilderFrame

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ rail chips · segments · ‹ W11 · Mar 12 – 18 › · Draft              8 issues · ◉ · ↶ ↷ ✕ ✓ · Publish │  the eye ◉ before the history item
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ ◉ Elara optimised W11 · 11 changes: 4 added, 5 changed, 2 removed. Undo or apply them like any edit. │  the banner, for the highlight
├────────────┬──────────────────────────────────────────────────────────────────┬──────────────┤
│ LIBRARY    │ main: the builder's own grid, every added or changed entry glowing, │ INSPECTOR    │
│            │ a dashed ghost where one was removed or moved from                 │              │
├────────────┴──────────────────────────────────────────────────────────────────┴──────────────┤
│ legend … · Elara change                                   ● Optimising W11 · 7 s   (while running) │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Changes |
|---|---|
| Toolbar | One item, the eye, in the trailing cluster immediately before the history item; on the Roster between the issues item and the history item. Its fold is D4's. |
| Banners | One banner during the highlight, or until the next run on failure. |
| Main | No layout change: the builder's entries carry the landing's attributes. |
| Footer | The existing loading line says `Optimising {period} · {n} s`; the legend gains `Elara change` during the highlight. |

## 8. Anatomy, from the mock

**The eye.** An icon-only Default button, 32 × 32 with a 16 px mark (sm 24 ×
24, a 14 px mark). In a builder's toolbar it is `toolbar`, 32 × 28 with a
14 px mark: as tall as every other control of the row, which stands 28 px
(ruled 25 Oct 2026; the mock's rows are 24 px).
The mark is two paths: the ring (100 dots) and the iris (52 dots), each its
own colour, from the lockup's geometry (`ELARA_EYE` in the mock).

| State | Look | Click |
|---|---|---|
| Rest | ring and iris `--ink-2`, the Default button frame | starts a run |
| Hover | `--paper-2` fill, iris `--elara-ink` | starts a run |
| Focus | `--shadow-focus` | Enter or Space starts a run |
| Running | edge and ring `--elara-ink`, iris `--elara`; an iris echo (scale 1 → 2.4, opacity 0.8 → 0 in the first 25%) and a 12 px halo (`--elara-glow`, peaking at 25%) on the live-pulse cycle | stops the run |
| Running · hover | the eye hides, an 11 px `fa-stop` shows, `--paper` fill | stops the run |
| No changes | one blink: ring and iris scale Y to 0.12 and back, 560 ms, `--ease-in-out` | starts a run |
| Disabled (D1), while the period's reads are in flight | `--rule` edge, `--ink-5` mark, tooltip `Read-only` | nothing |

Tooltip and `aria-label`: `Optimise {period}` at rest, `Stop optimising` while
running.

**The footer line.** In the loading pass's slot at the rail's trailing end:
the Elara dot with the live pulse, then `Optimising {period} · {n} s`, `{n}`
from 1, ticking every second, padded with a figure space so the line never
shifts; the short form `Optimising…` where the rail is short, by the footer's
fit rules (#1398, CL3). After Stop: a neutral dot and `Stopped · nothing
changed` for 2.5 s.

**The banner.** In the banners slot, the frame's banner as every other tone
draws it — flush with the banners above and below it, the same radius,
padding and type — in the Elara tone: a 1 px `--elara-ink` edge over a 6%
`--elara` wash, the eye mark 16 px (`--elara-ink`, iris `--elara`), a title
and one line; no actions. Failure: the error tone, with the
`fa-circle-exclamation` mark. It fades in over `--dur-base` and collapses over
`--dur-base` (opacity and height). The mock's inset card (0 12 12 px,
`--r-md`, a brand-face title) is the mock's: a frame has one banner style
(ruled 26 Oct 2026, §11).

**The landing**, per entry: 1400 ms, `--ease-out`. It starts at an
`--elara-wash` fill with a 1 px `--elara` ring and a 16–18 px `--elara-glow`,
and settles to the dirty fill (`--brand-tint`) with the steady highlight — a
1 px `--elara-edge` ring and an 8 px `--elara-soft` glow. An added entry fades
in from 0 over the first 10%. By kind: chips, events and bins take the wash;
entries with their own fill — the Roster's shift tiles, the Plan's bars — keep
it and take the ring and glow alone; a Sheet cell takes an inset ring and glow
and its new value fades in over 160 ms. A removed entry leaves a ghost in
place for the highlight — dashed `--elara-edge`, `--brand-tint`, `--ink-4`,
struck through — whose glow fades out; a moved entry leaves such a ghost at
its old place and flares at its new one. Totals flash last: every count the
result changed flashes `--elara-wash` once, 120 ms after the cascade ends.

**The cascade.** Entries with an operation glow in reading order — by column
in 12 px buckets, then top to bottom — a step of min(40 ms, 760 ms ÷ n), so the
whole landing fits in 760 ms however large the result.

**The highlight.** 8 s from the landing: the steady glow on every added and
changed entry, the ghosts, the banner, the legend's `Elara change`. It ends
early on Undo, a new run, Apply or Cancel. On its end the glow fades
over 600 ms, the ghosts go, the banner collapses, the legend item goes; the
changes keep the dirty fill until Apply or Cancel.

**Timing**

| What | Value |
|---|---|
| Live-pulse cycle (the eye's echo and halo, the footer dot) | `calc(var(--dur-slow) * 4)` = 1440 ms: 360 ms in, 1080 ms rest, `--ease-out`, infinite |
| Footer seconds | every 1 s, from 1 |
| Cascade step · total | min(40 ms, 760 ms ÷ n) · ≤ 760 ms |
| Flare per entry | 1400 ms `--ease-out` |
| Totals flash | 120 ms after the cascade ends |
| Highlight | 8 s from the landing |
| Glow fade at the highlight's end | 600 ms |
| Banner collapse | `--dur-base` (200 ms) |
| Stopped note | 2.5 s |
| No-changes blink | 560 ms, once, `--ease-in-out` |

**Tokens** (O6), semantic, declared per colour mode in the theme as `heat.*`
are:

| Token | Light | Dark | Used for |
|---|---|---|---|
| `elara` | `brand.400` | `brand.300` | the pulse, the iris, the landing's ring |
| `elara.ink` | `brand.solid` (`--brand-d`) | `brand.300` | the mark and every edge that must read at 3:1 or better |
| `elara.glow` | `brand.400` at 75% | `brand.300` at 60% | the flare's and the halo's glow |
| `elara.wash` | `brand.400` 32% over `--paper` | `brand.300` 24% over `--paper` | the flare's fill, the totals' flash |
| `elara.edge` | `brand.400` 60% over `--brand-d` | `brand.300` | the steady ring, the ghosts' dash |
| `elara.soft` | `brand.400` at 55% | `brand.300` at 40% | the steady glow |

`elara` on light paper reads at about 1.5:1, so in light it is never the only
sign: edges, rings and the dot's ring take `elara.ink`.

## 9. Behaviour

Every rule, numbered, with the owner and the test. The spec's section numbers
in brackets refer to the designer's behaviour spec the mock was built from,
folded into this document.

### 9.1 The run (owner: the shared run; test: DOM with a stubbed function)

- **R1.** A click on the eye at rest sends one call: the request of §5 over
  the period in view — base plus every unapplied draft in scope, every row,
  whatever the rail shows (O3) — with the run number. One run per builder
  instance; while it is out the eye is the Stop control.
- **R2.** While the call is out: the eye runs (§8); the footer line counts
  the seconds; the history item's Undo, Redo, Discard and Save are disabled;
  no drag source or drop target is registered and no cell or field edit is
  taken — the period's own controls (a day off's `+ Assign`, a card's
  actions) stay in place, disabled and saying why, never swapped for a
  read-only reading; scrolling, selection, the inspector, hover, tooltips and
  the library stay live.
- **R3.** Stop — a click on the running eye, or Enter or Space on it — cancels
  the call's handle; a response that arrives after it is ignored; the footer
  reads `Stopped · nothing changed` for 2.5 s; the session is unchanged.
- **R4.** A period change (‹ ›, `[` and `]`, the picker) stops the run as Stop
  does (O4); a layout, view or filter change does not. Leaving the builder
  aborts the call.
- **R5.** No timeout of the client's (D2): a call the server times out is a
  failure (R10).
- **R6.** The eye is listed only where the period can be optimised (D1):
  never read only, never over a published period, never in the Roster's
  Month; while the period's reads are in flight it is disabled in its place.
  It is never disabled by unapplied edits.

### 9.2 The result is an edit (owner: the one step; test: DOM, the history's steps)

- **R7.** The result is diffed against the request by entry key: absent → present
  is an add, a different row a change, present → absent a remove; a move is a
  change of placement (another day, time, lane, hour or resource) and is drawn
  as one. Untouched entries are not in the edit. Entries outside the scope are
  never touched.
- **R8.** The diff is recorded as exactly one step of the history — one
  `record` call across every record the builder writes, origin `optimise`,
  label `Elara run #n` — so the session is dirty, the pending count counts the
  run's operations, the redo stack is cleared, and nothing is saved.
- **R9.** One Undo reverts the whole run, whatever its size, and ends its
  highlight and banner at once; Redo re-inserts it, replays the landing and
  restarts the highlight without the banner. Runs stack: a second run is a
  second step; two Undos revert both, newest first. A later manual edit of an
  entry the run changed stacks on top; undoing it returns the entry to the
  run's value.
- **R10.** Outcomes: changes — the step (R8), the eye at rest, the footer line
  clears, the `done` banner for the highlight; no changes (the result equals
  the request) — nothing recorded, the eye blinks once, the `none` banner for
  8 s; failure (a rejected call, a transport error, a timed-out call, an
  invalid response) — nothing recorded, the eye at rest, the `fail` banner
  until the next run; stopped — nothing recorded (R3).
- **R11.** Cancel (Discard) drops every unapplied edit, the user's and the
  runs'; Apply (Save) commits every unapplied edit through the builder's
  normal path; a base that moved during the run is Save's conflict (D3).
- **R12.** A run during a highlight ends the highlight first; a run after a
  failure clears the failure banner as it starts; a run while dirty is
  allowed, the drafts its input (O5).

### 9.3 The landing and the highlight (owner: the shared recipes and `useLanding`; test: DOM with fake timers, responsive in both themes)

- **R13.** Every operation lands in one render: entries at their final places,
  nothing sliding or reflowing in steps; the view keeps its scroll position and
  selection.
- **R14.** The cascade orders the glows by column in 12 px buckets then top to
  bottom, a step of min(40 ms, 760 ms ÷ n) (O7); each flare is 1400 ms (§8);
  totals flash 120 ms after the last step.
- **R15.** Removed and moved entries show their ghosts for the highlight only;
  the ghosts are `aria-hidden`.
- **R16.** The highlight lasts 8 s (O7) and ends early on Undo, a new
  run, Apply or Cancel; on its end the glow fades over 600 ms, the ghosts go,
  the banner collapses, the legend item goes, and the changes keep the dirty
  fill until Apply or Cancel.
- **R17.** Provenance: until Apply, hovering a changed entry says `Was
  {previous} · Elara run #n`, an added one `Added by Elara · run #n`; a ghost
  `Removed by Elara · run #n` or `Moved by Elara · run #n`; assistive
  technology reads the same.
- **R18.** Under `prefers-reduced-motion`: no echo, halo or cascade; the
  landing shows the steady highlight at once and keeps it for the full
  highlight.

### 9.4 Words and accessibility (owner: the shared parts; test: DOM)

- **R19.** The eye is a button named `Optimise {period}` at rest and `Stop
  optimising` while running, its tooltip the same; focus stays on it through
  the run and the landing. `{period}` is the builder's own label for the
  scope: `W11`, `Oct 5 – 9`, `8 work orders`, `Wed 12 May`, `Oct 1 – 14`.
- **R20.** The footer line is `role="status"`: `Optimising {period}` is
  announced once at the start; the seconds are `aria-hidden`.
- **R21.** The banner is `role="status"` for done and none, `role="alert"` for
  failure. Its words: done — **Elara optimised {period}** · `{n} changes: {a}
  added, {c} changed, {r} removed. Undo or apply them like any edit.` (zero
  parts omitted; `{n}` counts this run's operations alone); none — **No
  changes** · `Elara found nothing to improve in {period}.`; fail — **Couldn't
  optimise {period}** · `Nothing changed. Run it again from the eye.`
- **R22.** Light and dark both meet the contrast rules of §8's tokens.

### 9.5 Per builder (owner: each builder's child; test: DOM on e3-web, responsive)

| Builder | Scope and `{period}` | Entry · key · row | Operations the mock shows | Totals that flash |
|---|---|---|---|---|
| Roster | the week in view (`W11`); People and Shifts alike | duty · its key · the app's row | Off → shift (add); shift → another (change; own times drop); shift → Off (remove, a struck ghost) | each person's hours and meter; the issues item; the pending count |
| Calendar | the window in view (`Oct 5 – 9`) | event · its key · the app's row | backlog → scheduled (add); moved (change, a ghost at the old slot); scheduled → backlog (remove) | the day heads' counts; the Backlog tab's count |
| Sheet | the current tab's rows (`8 work orders`) | row · its key · the app's row; drawn per cell | blank → value (add); value changed (change); cleared (remove, the cell blank) | the toolbar's count (`{n} of {m} scheduled`) |
| Plan | the plan window in view (`Oct 1 – 14`) | event · its key · the app's row | backlog → placed (add); moved or re-assigned (change, a ghost); placed → backlog (remove) | jobs per resource; the footer's `{n} in backlog` |
| Allocation | the day in view (`Wed 12 May`) | bin · its key · the app's row | arrival → allocated (add); moved lane hour (change, a ghost); linked or relinked (change, no ghost); unallocated (remove, back to Arrivals) | the lane heads (`{n} bins · {q} m³`); the Arrivals count; the issues item; the loads of the kilns the run's links land on |

- **R23.** The Roster marks its People tiles (the mock's case) and its Shifts chips alike; an
  entry with its own fill keeps it and takes the ring and glow (§8). Its run
  reads the week whatever the layout. Its part waits for the People week view
  (#1406, #1407).
- **R24.** The Calendar's and Plan's request carries every event kind's rows
  in the window and the kinds' backlog rows, and the resource kinds' rows as
  context; a backlog row the result gives a time is an add on the canvas and
  leaves the Backlog, whose count flashes.
- **R25.** The Sheet's request is the current tab's rows, read whole for the
  call; a cell the result changes takes the inset ring and its value fades in;
  a new row lands at its key's place.
- **R26.** The Allocation's request carries the day's bins, every arrival as
  the board reads them and the board's context (lanes, resources, rules); a
  bin the result adds for an arrival leaves the Arrivals tab; an unallocated
  one returns. The optimisation is joint: a result decides where a bin is
  booked and which resources it links to, so a run may book, link, relink, or
  any mix, and a bin a run books on no resource is an add that is not linked.
  For the highlight the Timeline draws the links the runs added or changed
  with nothing selected — outlined in the Elara tone (the casing in
  `elara.edge`, the band and the heads in `elara.wash`, a soft `elara.soft`
  glow, the caption in `elara.ink`), never a filled band, so a result's many
  links stay readable (ruled 26 Oct 2026) — over the focus's family, and
  behind the cards: the links pass under the cards they cross, surfacing in
  the gaps between the lanes and in the channel, never over their words (a
  drag brings the layer back over them). The loads of the resources they
  land on take the landing and the steady glow with the cards, their own
  fill kept; a bin that only moved shows no link.
- **R27.** Narrow main (below 480 px): the eye sits beside the history item
  (D4), the footer line shows its short form, and the landing marks the
  phone's cards as it marks the grid's entries.

## 10. Copy

| Where | Copy |
|---|---|
| Eye, rest | `Optimise {period}` |
| Eye, running | `Stop optimising` |
| Eye, disabled (its reads in flight) | `Read-only` |
| Footer, running | `Optimising {period} · {n} s` (short: `Optimising…`) |
| Footer, stopped | `Stopped · nothing changed` |
| Banner, done | **Elara optimised {period}** · `{n} changes: {a} added, {c} changed, {r} removed. Undo or apply them like any edit.` |
| Banner, none | **No changes** · `Elara found nothing to improve in {period}.` |
| Banner, fail | **Couldn't optimise {period}** · `Nothing changed. Run it again from the eye.` |
| History step | `Elara run #{r}` |
| Entry, added | `Added by Elara · run #{r}` |
| Entry, changed | `Was {previous} · Elara run #{r}` |
| Ghost, removed | `Removed by Elara · run #{r}` |
| Ghost, moved | `Moved by Elara · run #{r}` |
| Legend, during the highlight | `Elara change` |

## 11. Where the product differs from the mock

| The mock | The product | Why, and what is lost |
|---|---|---|
| The Roster reports in a last-action band under the toolbar (`ELARA · Optimised W11 · …`, Undo →, ×) | The `BuilderFrame` banner, as the other four (O2) | One treatment. The band's issue delta (`3 resolved`) is lost here; the issues item's count still changes, and flashes. |
| Apply · Cancel, an edit bar of its own | The history item: Undo, Redo, Discard, Save | One editing session. The words are the history's. |
| Three treatments while running, two landings, three highlight lengths | Pulse, Cascade, 8 s (O7) | The alternatives stay in the mock for comparison. |
| Runs numbered per tenant | Per builder per browser, from 1 (D5) | No server counter. |
| The eye never disabled | Hidden where the period cannot be optimised; disabled while its reads are in flight (D1) | Ruled 25 Oct 2026. |
| The Roster's eye 32 × 24 in a 24 px toolbar | 32 × 28: the builders' toolbar rows' controls stand 28 px | Ruled 25 Oct 2026. |
| One level of undo | The history's full stack | — |
| The Roster's People view as the mock's own | #1406's People week view | Its tiles are what the landing marks (R23). |
| Shift tiles tinted with the chart accent hues | The shifts' typed colour tokens (#1406, D6) | The Roster's own ruling. |
| The alert an inset card, `--r-md`, a brand-face title | The frame's banner as its other tones draw it, in the Elara tone | One banner style in a frame, stacked flush with the session's and the period's banners (ruled 26 Oct 2026). |

## 12. Edge cases

- A late response after Stop is ignored (R3); a response for a period the
  view left lands in that period (O4), its banner naming it.
- A result equal to the request pushes nothing (R10).
- A breakpoint change mid-run keeps the run; the narrow layout shows the same
  footer line and lands the same edit (R27).
- A very large result: the cascade's cap holds the landing to 760 ms; the
  highlight is not extended.
- A result naming a key outside the scope, or a row of another type, is an
  invalid response: a failure (R10), nothing recorded.
- The optimiser bound to another row type than the builder's is refused at
  build, naming both (§4).

## 13. Wires

- **UI.** Each of the five payloads gains `optimise: Option<FuncBinding>` —
  package-borne; a `WIRE_MIGRATION.md` line each. east-ui's editing origin gains the case `optimise` (D6); it travels in the
  patch event (`EditingPatchEventTypeWith`) the app's patch observer reads at
  the same package version — package-borne; a `WIRE_MIGRATION.md` line.
- **Stored state.** None: a run writes nothing; Apply writes through each
  record's patch door as every draft does.
- **Viewer state.** The run counter, under the builder's `id` (D5).

## 14. Tests

- **e3-ui specs**: each builder's `optimise` refusals (no `Func.bind`; another
  request or result type, the row type named); the request and result types
  on the wire; the payload's `optimise`.
- **east-ui-components**: the `OptimiseButton`'s states and names; the
  `LoadingLine`'s busy kind and its fit; the `BannerView`'s `elara` tone; the
  landing recipes' attributes; the cascade's timing with fake timers (n = 1,
  19, 40, 400); the highlight's end; reduced motion; the `elara` tokens in
  both modes and the token guard.
- **e3-ui-components, shared**: `useOptimise` over a stubbed function — one
  call, the seconds, Stop and the ignored late response, unmount, the period
  change; the diff by key into changes; one history step per run, its origin
  and label, Undo in one, Redo's replay, two runs stacked.
- **Per builder, DOM on e3-web**: the empty period and the period with
  entries, each operation, the lock while running, the totals' flash, the
  provenance titles, Save through e3 and a remount, the banner's words, the
  narrow layout.
- **Showcase responsive specs**: the eye in every toolbar fold at
  1440/1024/768/390/360 in both themes; the landing's computed shadows and
  fills; a run against each example's optimiser on e3-web.
- **Examples**: each builder's example gains its optimiser on e3 — the
  warehouse's week filled from the patterns to contract hours; the print
  shop's backlog scheduled into free press time; the work orders' lines and
  due dates set; the jobs placed on the presses; the arrivals booked into
  lane hours and onto the kilns the fit ranks best, a kiln over its maximum
  relieved and a bin not linked or partly allocated linked (the Allocation's
  is a joint optimiser) — and the index is regenerated.

## 15. How it lands

Epic #1409: one PR off `elaraai/feat/e3-ui-schematic`, this spec and the mock
its first commit (the docs PR into that branch), one commit per child. In order: the contract in
e3-ui; the shared parts — the eye, the run, the one step, the footer line, the
banner; the landing and the highlight; then the Calendar, the Sheet, the Plan
and the Allocation, which can start at once; the Roster once #1407 is merged
into #1397 and the People week view is built; then the docs, the skills and the
index. Each child closes with `make build`, `make test` and `make lint` green
in `libs/east-ui`, its DOM tests on e3-web, its responsive specs and the index
regenerated where examples change.
