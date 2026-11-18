# Optimise — design

The Elara eye in the e3-ui collection builders — Roster, Calendar, Sheet,
Plan and Allocation. A click asks the app's optimiser of the period in view,
one `e3.function` call that carries no row: the page's unsaved edits go with it
as drafts, the function reads what it needs from the workspace with those
drafts laid over it, and answers a patch of each record the builder edits. The
answer lands in the builder's edit session as **one edit**, exactly as a drag
or a paste does, so one Undo reverts the whole run and Apply saves it with
everything else. While the call is out
the eye pulses, the footer line counts the seconds and the edit bar is locked;
when it lands every added or changed entry flares, a banner under the toolbar
says what changed, and after 8 s the changes are ordinary unapplied edits.

The `BuilderFrame` itself does not change: the eye is one more toolbar item,
the banner takes the banners slot, the footer line reuses #1398's loading-line
slot, the edit bar is the history item as it is, and the landing is annotation
on each builder's own entries.

This document is the design epic #1409 built. `Optimise Spec.html` beside it
is the visual design. Where the two differ, this document wins. The contract —
what a run asks, what it answers and how the answer lands (§3–§5, §9.1, §9.2)
— is east-workspace#1622's, which replaced #1409's rows in, rows out; the
eye, the landing, the highlight and the words are #1409's, unchanged.

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
  `e3.function` from the builder's `OptimiseRequest` — the period in view, the
  run's number and the rail's narrowing — to its `OptimiseResult` over the
  records the builder edits, a patch of each. The function lists those records
  in its `drafts` and reads them itself. Without the prop there is no eye.
- **Built in.** The eye and its states; the call with the sessions' drafts,
  Stop and the seconds; the lock while the call is out; the patch landed key
  by key as one history step; the
  landing (the flare, the cascade, the ghosts, the totals' flash), the 8 s
  highlight and its end; the banner; the footer line; provenance on hover;
  reduced motion.
- **Unchanged.** `BuilderFrame`, the toolbar's other items, the history item
  (Undo, Redo, Discard, Save), the inspector, the footer's legend, every
  builder's own gestures.

## 2. Decisions

Ruled by the user on 25 Oct 2026 (O1–O8); the rest are this design's. O1, O3,
O5, D1, D3 and D7 are as east-workspace#1622 leaves them.

| # | Decision |
|---|---|
| O1 | **The contract: `Func.bind`, the period in → a patch out** (east-workspace#1622). One `e3.function` per builder, bound as `fit` is, from the builder's `OptimiseRequest` — the period in view and what kind it is, the run number and the rail's narrowing, and no row of a record — to its `OptimiseResult`, East's patch of each record the builder edits. The call carries the page's unsaved edits as drafts; e3 lays them over the records, the function reads what it needs through the records' indexes, and nothing is saved. The renderer lands the patch key by key as one step. A plain East function is not accepted (no second path), and no builder takes #1409's rows in, rows out. |
| O2 | **One result message**: the `BuilderFrame` banner, for all five (§8, §11). The Roster's last-action band of the People mock is a follow-up of #1406, not built here. |
| O3 | **The scope is the period in view; the narrowing is sent, never applied.** The request names the period and carries the rail's narrowing (`slice`), the page's scope among it: what the function reads is its own choice, and the drafts it reads over are every unsaved edit, the ones a narrowing hides among them. A hidden row the run changes is highlighted when it comes into view. An answer that changes a row outside the period is refused (R10a). A Sheet has no time view: its request is the narrowing alone, and over one entry's rows the entry's key. |
| O4 | **A period change stops a run**, as Stop does; a layout, view or filter change does not, and the result lands in the period it was asked of. Leaving the builder aborts the call. |
| O5 | **Drafts are input.** The call carries, for each record the function lists in `drafts`, the pending Save of the builder's session over it: every unsaved edit that is complete, whether or not a check is holding Save. The function reads the records with them laid over, and may change them; one Undo returns them. An entry whose edit is not finished has no row to send; an answer that changes it is refused (R10a). A function that reads a record the builder edits and does not list it in `drafts` is refused as the page is evaluated, naming the record. |
| O6 | **The design-system conflicts are accepted as drawn** (the designer's §19), as #1398's were: the theme gains the `elara` semantic tokens, aliases of the brand scale's cyan end per colour mode; the eye's halo and the landing glow are the feature's shadows and the echo and the pulse its loops, bounded to the eye and the highlight; the Elara mark is the eye. The design system's own cards follow in a separate pass. |
| O7 | **The visual defaults**: the eye alone pulses while running (Pulse); the landing glows in reading order within 760 ms (Cascade); the highlight lasts 8 s, or until Undo, Apply, Cancel or a new run. |
| O8 | **The spec's five builders.** The Schematic is left out. |
| D1 | **The eye is listed only where the period can be optimised** (ruled 25 Oct 2026, over the mock's disabled eye): a `readOnly` builder and a period in view that takes no edit — a published week or day, a month any week of which is published — list no eye, never a disabled one. The Roster's Month lists it: a run is asked of the period the Roster shows. The eye never waits on the page's reads (east-workspace#1622, rule 6): the request carries no row, so a Plan's kind read a cell at a time, and one past the events cap, run as any other. It waits in its place, disabled, with the tooltip `Read-only`, only while a Publish is under way and, for a Roster's optimiser that takes the edges, while the weeks either side are read, which `fixed` is told from. Unapplied edits never disable it: they are input. A period that stops being optimisable while its run is out stops the run, as a period change does (O4). |
| D2 | **No client-side timeout** beyond the e3 call's own deadline; a timed-out call is a failure (§9.4). |
| D3 | **A base that changes on the server during a run** is taken in before the answer lands: the answer is against the record as the function read it, so the page reads each record the function lists in `drafts` again, the sessions take the newer saves in as they take any save by another page, and then the answer lands. A call e3 ends `conflict` — a draft that no longer fits its row — lands nothing and takes a refused Save's path (R12a). |
| D4 | **The eye keeps its place** before the history item in every toolbar fold: the rail and the segments fold first, the eye and the history item last; on a phone it sits beside the history item. |
| D5 | **Runs are numbered per builder per browser**, from 1, kept under the builder's `id` with its other viewer state, so `run #7` stays `run #7` across reloads. |
| D6 | **The step's origin is `optimise`**, a new case of the editing origin, its label `Elara run #n`; a host that folds or announces steps by origin sees it. |
| D7 | **New rows' keys are the optimiser's.** The function can see which keys the record holds; a key another page's save takes before this one is saved is a conflict to choose at Save, as for any key an app's function makes. |

## 3. The authoring surface

### 3.1 The optimiser, on e3

```ts
// The print works' maintenance optimiser: every job on a press that is down goes back to the backlog. It reads each
// such press's jobs over the window through the jobs' series index, the Plan's unsaved edits laid over them.
const WindowJobs = DictType(StringType, PrintJob);

export const clearDownPresses = e3.function("plan_clear_down_presses", {
    inputs: [e3.index(planWindowJobs.indexes.plan_window_jobs_by_press_week), planPressesDown],
    drafts: [planWindowJobs],                         // the Plan's unsaved edits of the jobs are laid over their index
    args: [Plan.Types.OptimiseRequest],               // { from, to, period, run, slice } — no row
    output: Plan.Types.OptimiseResult({ job: WindowJobs }),
}, ($, jobsByPress, down, request) => {
    const before = $.let(new Map(), WindowJobs);
    const after = $.let(new Map(), WindowJobs);
    $.for(down, ($2, press) => {
        jobsByPress.events({ key: some(press), from: request.from, to: request.to }).each($2, ($3, job, id) => {
            $3(before.insert(id, job));
            $3(after.insert(id, { …job's fields, start: none, end: none }));
        });
    });
    return { events: { job: East.diff(before, after) } };   // a patch of the jobs' record: what changed, and no more
});
```

The request carries nothing the page read. What an optimiser needs — the rows
the builder edits, the resources, the Roster's targets and staff, the
Allocation's arrivals and resources — it reads from the app's own records, a
row by its key or a set of rows through an index, in the app's own row types.

### 3.2 The builder

```tsx
// Inside the Roster's Reactive body, beside `warehouseRoster`'s declarations (`Roster Spec.md` §3.3):
const optimise = $.let(Func.bind(rotaOptimise));
return <Roster … fit={fit} optimise={optimise} />;    // the eye appears in the toolbar; without the prop there is no eye
```

The same on the others: `<Calendar … optimise={Func.bind(scheduleBacklog)} />`,
`<Sheet record={orders} … optimise={Func.bind(setLinesAndDates)} />`,
`<Plan … optimise={Func.bind(placeJobs)} />`,
`<Allocation … optimise={Func.bind(allocateArrivals)} />`.

A builder is handed the records it edits, each bound with `Record.bind`, and
makes its Save from the handle: that is where a run's drafts come from. So a
Sheet takes an optimiser where it is handed its record — `record`, with
`entry` or `window`, or beside a rail's `rows` source (`<Sheet slice={{ slice
}} record={orders} columns={…} />`) — and a Sheet over `data`, whose Save is
the host's own function, is refused one as the page is built, naming both.
`onApply` beside a rail's `rows` source is refused on the Sheet and on the
Record, naming `record`.

## 4. The props

| Prop | Takes | What it does |
|---|---|---|
| `optimise` | `Func.bind(fn)`, `fn` an `e3.function` from the builder's `OptimiseRequest` to its `OptimiseResult` over the records the builder edits | The app's optimiser. The eye shows, the run calls it once with the sessions' drafts, the answer lands as one edit. Omitted, no eye. A handle that is no `Func.bind`, or whose function asks or answers another type, is refused at build, naming what it asks or answers and what the builder takes. A function that reads a record the builder edits — itself, or by an index of it — and does not list it in `drafts` is refused as the page is evaluated, naming the function, the record and the remedy. |

## 5. The East types

### 5.1 Per builder

Each `OptimiseRequest` carries the period in view, the run number and the
rail's narrowing, and no row. Each `OptimiseResult` is a patch of each record
the builder edits.

```ts
Calendar.Types.OptimiseRequest     = StructType({ from: DateTimeType, to: DateTimeType, period: OptimisePeriodType,
                                                  run: IntegerType, slice: OptimiseSliceType });
Calendar.Types.OptimiseResult(E)   = StructType({ events: StructType({ [slot]: PatchType(E[slot]) }) });
    // E each event kind's record type by slot: Calendar.Types.OptimiseResult({ job: JobsType })

Plan.Types.OptimiseRequest         = the Calendar's, over the plan window;   Plan.Types.OptimiseResult(E) = { events }

Roster.Types.OptimiseRequest()                = the Calendar's type
Roster.Types.OptimiseRequest({ edges: true }) = that, and fixed: SetType(StringType)
Roster.Types.OptimiseResult(D)                = StructType({ duties: PatchType(D) });      // D the duties' record type

Allocation.Types.OptimiseRequest   = StructType({ day: DateTimeType, run: IntegerType, slice: OptimiseSliceType });
Allocation.Types.OptimiseResult(D) = StructType({ bins: PatchType(D) });                   // D the bins' record type

Sheet.Types.OptimiseRequest()             = StructType({ run: IntegerType, slice: OptimiseSliceType });
Sheet.Types.OptimiseRequest({ entry: K }) = that, and entry: K        // over one entry's rows; K the record's key type
Sheet.Types.OptimiseResult(D)             = StructType({ rows: PatchType(D) });
    // D the rows the Save reaches, by key: the record's own type, or over one entry's rows DictType(StringType, Row)

OptimisePeriodType = VariantType({ day: NullType, week: NullType, month: NullType, quarter: NullType, year: NullType });
OptimiseSliceType  = DictType(StringType, RecordSliceWhereType);       // each rail source's narrowing, by the source's name
```

- **`from`, `to`, `day`** are the period in view. The Calendar's and the
  Roster's are the period they show: the Roster's the day in day view, the
  week in week view and the month in month view; a month view asks the whole
  weeks it draws, and the Calendar's Timeline the month itself. The Plan's
  are its window.
- **`period`** says what kind of period that is, a case with no value. The
  Calendar and the Roster name the period they show; the Plan names the unit
  its axis is zoomed to, its window spanning several of them (zoomed to hours,
  `day`). A function that wants only the dates never reads it.
- **`slice`** is each rail source's narrowing as a read of that source carries
  it — a field's chosen values as East prints them, a range, or a prefix — the
  page's scope among it (#1621). A builder with no rail sends none.
- **`fixed`**, given `{ edges: true }`, is the keys of the duties at the edges
  of the period in view that the answer must leave as they are: their week, or
  day, takes no edit, or they fall in no week the Roster holds. It is the one
  thing a builder still works out for the function.
- **`entry`** is the key of the entry whose rows a Sheet edits; the patch
  answered is of those rows by their id.
- **A patch** is what `East.diff` gives of the rows before and after, and what
  a Save sends: for each key, a row inserted, deleted, or updated by a patch
  of the row. A record the run leaves as it is answers an unchanged patch.

A request type takes no row type; one with an option is called with that
alone. A result type takes each edited record's type, and the same types give
the same East type (`isTypeEqual`), which the tag holds the bound function
to. The Calendar's and the Plan's slots sort by name, so the same kinds give
the same type however they are listed. No tag can see its records' types in
TypeScript, so `optimise` takes any `Func.bind` handle and the check is the
build's.

### 5.2 The payload

Each builder's payload holds `optimise`, the bound function's binding
(`FuncBindingType`: its name, the records it lists in `drafts` and the records
it reads), beside `fit` where there is one: `Option<FuncBinding>` on the
Calendar's, the Plan's and the Allocation's, with whether it takes the edges
on the Roster's, and on the Sheet's `Option<SheetOptimiseBinding>` — the binding, the record
the sheet saves to by name, the type of the rows its Save reaches and, over
one entry's rows, the record's key type and the entry's key. The renderer
builds the call handle from the name and the builder's request and result
types (`useFuncCall`), as the fit does (§13).

## 6. The shared parts

| Part | Where | What |
|---|---|---|
| The run | e3-ui-components `shared/func/use-optimise.ts` | Over `useFuncCall`: one call with the builder's request and, after it, the sessions' drafts; `stop()` (cancel; a late response is ignored), the seconds since the call left, the answer once it lands, the failure; the records read again before the answer lands (R9a), the rows not held (R8a) and the `conflict` path (R12a); one run per builder instance; unmount aborts. |
| The sessions | e3-ui-components `shared/func/optimise-sessions.ts` | Each of a builder's editing sessions over a record it edits, by the record's name in the deployed package — a Schedule kind's, a record's beside the kinds, a Sheet's: the pending Save as a draft, whether the session has taken the newer saves in, and a conflict in the refused Save's words. One reading for every builder. |
| The narrowing | e3-ui-components `shared/func/optimise-slice.ts` | A request's `slice`: each rail source's narrowing by the source's name, the viewer's choices under the page's scope, read as the run starts. |
| The patch, key by key | e3-ui `utils/optimise.ts` `optimiseChangesFor`; e3-ui-components `shared/func/optimise-diff.ts` | An East function from a record's patch to its changes by key — an insert, an update by a patch of the row, a delete; a patch of the whole Dict key by key too, never the record replaced — and each key landed on the row the page holds, naming the rows it does not hold and refusing over a row whose own edit is not finished. |
| The rows not held | e3-ui-components `shared/func/optimise-rows.ts` | The rows an answer touches that the page does not hold, read by their keys — each record's in one read — and kept as they land. The run reads them: a builder's landing names the rows it is missing (`{ missing }`), and the run asks it again with them in hand as they land. |
| The one step | each builder's `optimise.ts` and commands, over `ScheduleEditing.record` (Roster, Calendar, Plan, Allocation) or the Sheet's `session.record` | The landed changes — `{ kind, id, row, created }` for an add, `{ kind, id, row }` for a change, `{ kind, id, remove }` for a remove — recorded as one step, origin `optimise`, label `Elara run #n`; the redo stack clears as for any edit. |
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

- **R1.** A click on the eye at rest sends one call: the request of §5 — the
  period in view and what kind it is, the run number and the rail's narrowing
  (O3), and no row — and, with it, the pending Save of each of the builder's
  sessions over a record the function lists in `drafts`, as a draft (O5):
  every unsaved edit that is complete, the ones a narrowing hides and the ones
  off screen among them. e3 lays the drafts over the records and runs the
  function; nothing is saved. One run per builder instance; while it is out
  the eye is the Stop control.
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
  aborts the call. A Sheet has no period: its scope is the rows it was asked
  of (§9.5) — its tab, its rows' narrowing and, over one entry's rows, the
  entry — and a change of any of them is its period change, an entry the
  viewer picks while the call is out among them.
- **R5.** No timeout of the client's (D2): a call the server times out is a
  failure (R10).
- **R6.** The eye is listed only where the period can be optimised (D1):
  never read only, never over a period that takes no edit. It never waits on,
  or refuses over, rows the page has not read: a kind read a cell at a time,
  and a kind past the events cap, run as any other. It is disabled in its
  place only while a Publish is under way and while a Roster's edges are read
  (D1). It is never disabled by unapplied edits.

### 9.2 The result is an edit (owner: the one step; test: DOM, the history's steps)

- **R7.** The answer's patch lands key by key: an insert adds the row, under
  the key the optimiser gave; an update changes the row the page holds by its
  patch; a delete removes it. A patch that replaces the whole Dict lands key
  by key too — its old rows removed, its new rows added, a row in both
  updated — and never as the record replaced. A move is a change of placement
  (another day, time, lane, hour or resource) and is drawn as one. Untouched
  entries are not in the edit.
- **R8a.** A row the answer updates or deletes that the page does not hold is
  read by its key before the answer lands, so the session keeps the whole
  entry as it does for every edit; each record's rows are read in one read.
- **R9a.** The answer is against the record as the function read it, with the
  drafts laid over it. Before it lands, the page reads each record the
  function lists in `drafts` once more — whether or not the run had an edit of
  it to hand over — and the sessions take in whatever newer saves that brings,
  as they take any save by another page (D3).
- **R8.** The landing is recorded as exactly one step of the history — one
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
  clears, the `done` banner for the highlight; no changes (the answer
  changes nothing) — nothing recorded, the eye
  blinks once, the `none` banner for 8 s; failure (a rejected call, a
  transport error, a timed-out call, an invalid response, a refused answer) —
  nothing recorded, the eye at rest, the `fail` banner until the next run;
  stopped — nothing recorded (R3).
- **R10a.** An answer is refused whole, naming the row, and changes nothing,
  where it changes a row the builder would not let the viewer change — a
  locked event, a published week, a fixed duty; a row whose own edit is not
  finished, which the function read as saved; or, for the Calendar, the Plan,
  the Roster and the Allocation, a row outside the period it was asked of: one
  whose place in time, as the page holds it or as the answer leaves it, falls
  outside `from` to `to` (the Allocation's `day`). A row with no place in
  time, a backlog row, counts as inside: a run may schedule the backlog into
  the period, or send a row back to it. A Roster's optimiser that takes the
  edges is held to the weeks either side in place of the period; one that
  does not refuses a duty the Roster places beyond the weeks it holds — a
  night across the week's edge — as outside the period. A period that takes no
  edit is judged as it stands as the answer lands: an answer over a period
  whose status the page has not read yet waits for its read, and one over a
  published day of the Allocation's, or a published week, is refused. The
  first offending key in the patch's order is the one named.
- **R11.** Cancel (Discard) drops every unapplied edit, the user's and the
  runs'; Apply (Save) commits every unapplied edit through the builder's
  normal path; a key the optimiser gave that another page's save took first
  is a conflict to choose there (D7).
- **R12a.** A call e3 ends `conflict` — a draft no longer fits its row,
  because another write got there first — lands nothing and takes the path a
  Save the record refused takes: the page reads the records again and the
  sessions carry their edits over the newer saves. With nothing to choose, the
  call goes again by itself with the new drafts, as many times in a row as a
  session sends a refused Save again, the run out meanwhile. With a conflict
  to choose, the run ends saying so in the refused Save's words, and the
  person chooses before running again. Another page's save of a different row
  is no conflict: the answer lands over it (R9a).
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
| Roster | the period it shows: the day in day view, the week (`W11`) in week view, the month in month view; People and Shifts alike | duty · its key · the app's row | Off → shift (add); shift → another (change; own times drop); shift → Off (remove, a struck ghost) | each person's hours and meter; the issues item; the pending count |
| Calendar | the period in view (`Oct 5 – 9`): a day, a week, or a month — the whole weeks its grid draws, the month itself on the Timeline | event · its key · the app's row | backlog → scheduled (add); moved (change, a ghost at the old slot); scheduled → backlog (remove) | the day heads' counts; the Backlog tab's count |
| Sheet | the rows its Save reaches (`8 work orders`); no time view | row · its key · the app's row; drawn per cell | blank → value (add); value changed (change); cleared (remove, the cell blank) | the toolbar's count (`{n} of {m} scheduled`) |
| Plan | the plan window in view (`Oct 1 – 14`), `period` the unit its axis is zoomed to | event · its key · the app's row | backlog → placed (add); moved or re-assigned (change, a ghost); placed → backlog (remove) | jobs per resource; the footer's `{n} in backlog` |
| Allocation | the day in view (`Wed 12 May`) | bin · its key · the app's row | arrival → allocated (add); moved lane hour (change, a ghost); linked or relinked (change, no ghost); unallocated (remove, back to Arrivals) | the lane heads (`{n} bins · {q} m³`); the Arrivals count; the issues item; the loads of the kilns the run's links land on |

- **R23.** The Roster marks its People tiles (the mock's case) and its Shifts chips alike; an
  entry with its own fill keeps it and takes the ring and glow (§8). Its run
  is asked of the period it shows, whatever the layout. Its optimiser reads
  the duties through the duty record's indexes, and the targets, the staff
  and the configuration from the app's own records; it lists the duties'
  record in `drafts`, and the targets' record and the periods' — the weeks or
  days the Roster publishes — too where it reads them, since the Roster edits
  all three, their drafts in one call. Given `{ edges: true }` its request
  names the duties it must leave (`fixed`), and its one patch may change a
  duty at an edge.
- **R24.** The Calendar's and the Plan's function reads the events it needs
  through its record's indexes — the window's and the backlog's — and the
  data behind the resources; a backlog row the answer gives a time is an add
  on the canvas and leaves the Backlog, whose count flashes. The eye is on
  whatever the canvas has read: a Plan whose jobs are read a cell at a time
  runs as any other (R6).
- **R25.** The Sheet's function reads the rows from the record the sheet
  saves to, and over one entry's rows that entry's, by the `entry` the
  request carries; a cell the answer changes takes the inset ring and its
  value fades in; a new row lands at its key's place.
- **R26.** The Allocation's function reads the day's bins through the bins'
  record's indexes, and the arrivals, the lanes and the resources from the
  app's own records (`Allocation.context` builds the board's context from
  them for a function that wants it); it lists the bins' record in `drafts`,
  and the periods' — the days or weeks the board publishes — too where it
  reads them, since the board edits both. A bin the answer adds for an arrival
  leaves the Arrivals tab; an unallocated one returns. The optimisation is joint: a result decides where a bin is
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
| Banner, refused (R10a) | **Couldn't optimise {period}** · `{reason} Nothing changed.` — `{reason}` the builder's own words where the row takes no edit, or: |
| Reason, outside the period | `Elara's answer changes {row}, outside {period}.` |
| Reason, an unfinished edit | `Elara's answer changes {row}, whose edit is not finished.` |
| Reason, a conflict to choose (R12a) | the editing session's own words for it, as a sentence: `1 of your changes conflicts with newer changes.` |
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
- An answer that changes nothing pushes nothing (R10).
- A breakpoint change mid-run keeps the run; the narrow layout shows the same
  footer line and lands the same edit (R27).
- A very large result: the cascade's cap holds the landing to 760 ms; the
  highlight is not extended.
- An answer that changes a row outside the period, a row the viewer may not
  change, or a row whose edit is not finished is refused whole, naming the
  row (R10a); nothing recorded.
- An answer that updates or deletes a row the page does not hold lands once
  the row is read by its key (R8a); over a paged record of any size, each
  record's rows in one read.
- A record another page saved while the call was out is read again before
  the answer lands (R9a); a draft that no longer fits is the `conflict` path
  (R12a).
- The optimiser bound to another request or answer than the builder's is
  refused at build, naming both; one that reads an edited record and does not
  list it in `drafts`, as the page is evaluated (§4).
- An optimiser that reads another record of the same row type as the one the
  builder edits passes the page's checks, and its answers never fit: the
  check holds the function to the record's type and its name in `drafts`,
  not to where its answer's rows came from.

## 13. Wires

- **UI.** Each of the five payloads holds `optimise` (§5.2) — package-borne.
  east-ui's editing origin holds the case `optimise` (D6); it travels in the
  patch event (`EditingPatchEventTypeWith`) the app's patch observer reads at
  the same package version — package-borne. `WIRE_MIGRATION.md` holds #1409's
  entry and east-workspace#1622's, which changed the request and result
  types whole, gave the binding the records its function reads, and took the
  resource kinds' `keyType`, `rowType` and `records` away.
- **The call.** A run's call passes drafts (#1619, #1620): a function route's
  request, kept as any call is, and committing nothing.
- **Stored state.** None: a run writes nothing; Apply writes through each
  record's patch door as every draft does.
- **Viewer state.** The run counter, under the builder's `id` (D5).

## 14. Tests

- **e3-ui specs**: each builder's `optimise` refusals (no `Func.bind`; another
  request or result type, each named; a function that reads an edited record
  and lists no draft of it; a Sheet over `data`; `onApply` beside a rail's
  `rows` source); the request and result types on the wire; the payload's
  `optimise`; each example optimiser over its record's index entries, built
  as e3 builds them.
- **east-ui-components**: the `OptimiseButton`'s states and names; the
  `LoadingLine`'s busy kind and its fit; the `BannerView`'s `elara` tone; the
  landing recipes' attributes; the cascade's timing with fake timers (n = 1,
  19, 40, 400); the highlight's end; reduced motion; the `elara` tokens in
  both modes and the token guard.
- **e3-ui-components, shared**: `useOptimise` — one call, the seconds, Stop
  and the ignored late response, unmount, the period change; the drafts
  handed over; the records read again; the `conflict` both ways, over real
  stale drafts on e3-web; the patch landed key by key into changes; one
  history step per run, its origin and label, Undo in one, Redo's replay, two
  runs stacked.
- **Per builder, DOM on e3-web**: the empty period and the period with
  entries, each operation, the lock while running, the totals' flash, the
  provenance titles, Save through e3 and a remount, the banner's words, the
  narrow layout; and one set of landing cases every builder runs
  (`optimise-cases.test-utils.ts`) — an insert, an update and a delete as one
  edit; an answer that replaces the whole Dict; a row moved outside the
  period, and one standing outside it, refused; another page's save before
  the function runs and after it; a key the optimiser gave that another page
  took. Each builder's request: the period in each of its views and its kind,
  the narrowing, and no row. A row the page does not hold; an unfinished
  edit; the Roster's two records' drafts in one call; the Sheet in each form
  that saves to a record.
- **The done test**, on e3-web and in the showcase: a Plan whose jobs are
  read a cell at a time; a job dragged and not saved; the eye. The function
  reads that press's jobs through the series index and sees the drag; its
  answer lands in one step; Undo reverts it; Save commits the drag and the
  answer together; the record is never written before Save.
- **Showcase responsive specs**: the eye in every toolbar fold at
  1440/1024/768/390/360 in both themes; the landing's computed shadows and
  fills; a run against each example's optimiser on e3-web.
- **Examples**: each builder's example holds its optimiser on e3, reading
  through an index of its record and staying inside the period it is asked
  of — the warehouse's period filled from the patterns to contract hours a
  week; the print shop's backlog scheduled into free press time; the work
  orders' lines and due dates set; the jobs placed on the presses, and the
  jobs of a press that is down sent back to the backlog, over jobs read a
  cell at a time; the arrivals booked into lane hours and onto the kilns the
  fit ranks best, a kiln over its maximum relieved and a bin not linked or
  partly allocated linked (the Allocation's is a joint optimiser) — and the
  index is regenerated.

## 15. How it landed

Epic #1409: one PR off `elaraai/feat/e3-ui-schematic`, this spec and the mock
its first commit (the docs PR into that branch), one commit per child. In order: the contract in
e3-ui; the shared parts — the eye, the run, the one step, the footer line, the
banner; the landing and the highlight; then the Calendar, the Sheet, the Plan
and the Allocation, which can start at once; the Roster once #1407 is merged
into #1397 and the People week view is built; then the docs, the skills and the
index. Each child closes with `make build`, `make test` and `make lint` green
in `libs/east-ui`, its DOM tests on e3-web, its responsive specs and the index
regenerated where examples change.

The contract of §3–§5 and the rules R8a, R9a, R10a and R12a landed after it,
with east-workspace#1622, on the functions epic's stack: drafts on a function
(#1619) and the binds that carry them (#1620), an index as an input (#1617,
#1618) over the range read (#1616), and a rail source's scope (#1621).
