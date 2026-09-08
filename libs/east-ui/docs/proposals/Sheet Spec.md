# Sheet — code design & implementation plan

> **Status: Proposed** · east-ui component design · companions:
>
> - [`Sheet Spec.html`](./Sheet%20Spec.html) — the **interactive prototype**. Open it in a
>   browser and use it (type an activity on the empty row). It is the ground truth for
>   appearance *and* behaviour: where this document and the prototype disagree on how
>   the sheet looks or reacts, the prototype wins. [`Sheet Spec.png`](./Sheet%20Spec.png)
>   is its resting state.
> - [`Sheet Behaviour.html`](./Sheet%20Behaviour.html) — the prototype's rule-by-rule
>   contract (§1–§13), cited below as **B§n**.
> - [`Sheet Link Cell Options.html`](./Sheet%20Link%20Cell%20Options.html) — the three
>   link-cell alternatives that were explored; the prototype implements **1a (split cell)**.
>
> The prototype and its documents were genericised from a client design to a
> batch-process plant with synthetic registers and rows. Keep every example in this
> repository on that footing — no customer, site, product or upstream-system names,
> and no operational numbers copied from a real plan.

One sheet; typed columns; a copilot. `Sheet` is the planning spreadsheet: a sheet
whose rows are the host's records, whose columns are **typed** (a date, a quantity
with a unit, a register lookup, a directed *link* between register members, a
stamped read-only code), whose blank tail invites the next row, and whose copilot
fills cells and proposes whole rows from rules **the author writes as East
functions** — synchronous ones over the sheet, or asynchronous ones that ask a
model. It is not a `Table`: a Table displays and sorts; a Sheet is typed, edited in
place, padded with blank rows, searched as a *lens* that keeps row numbers, and
completed by a copilot. It borrows the Table's cell primitive, the row-source
contract (both arms), the slice chrome, sizing and density, and otherwise stands on
its own.

Vocabulary (masthead): **sheet · row · column · kind · register · member · driver ·
link (from → to) · fill · proposal · lens · view · strip**.

Decisions taken with the author on 2026-09-08 and folded in below: the name is
`Sheet`; search runs **through the slice** (the lens draws whatever the slice
narrows); the **paged arm** is designed now; providers are **sync or async**
East functions; there are **no built-in providers** — every fill and proposal is
author code.

---

## 0 · The name

The component is `Sheet` (`<Sheet>`, `Sheet.Root`, `Sheet.Types`). The CSS layout
`Grid` is untouched. `Grid` was considered and rejected: the layout primitive
already owns that export, and renaming it would have broken every layout author
and the wire format for a name.

---

## 1 · Decisions locked

| Concern | Decision |
|---|---|
| **What the component owns** | The sheet card (two-line header, gutter, cells, editors, selection, keyboard, clipboard), the docked strip, the footer (counts, key hint, live message, the paged transport line), the lens (hits, ±n context bands, reveals) over the slice's narrowing, the view tabs, the copilot runner, register-driven cell kinds and the link grammar. |
| **What the host owns** | The app bar (title, breadcrumb, sync status — `<App>`), persistence and its mode (autosave = `Data.bind` direct; held-locally = `Data.bind` staged + commit), the autosave toggle, the upload/stamping action, the `owned` predicate (data), registers (data), footer counts (expressions over the host's rows), **every copilot rule** (East functions), the slice binding. |
| **Cells are the Table's primitive** | A cell is a bare `LiteralValueType` (`Null` is blank). `set` / `link` columns store the **typed string** (B§4.2: `a > b` both halves · `b` destination only · `a >` source only); `date` = `DateTime` (UTC midnight); `quantity` = `Float`; `integer` = `Integer`; everything else a `String`. No per-cell UI in the IR (#206). |
| **Rows are the host's structs, from either row-source arm** | `data` is the whole collection (`Array<R>`, `Dict<String, R>`, a `Data.bind` / `State.bind` handle) or a **paged source** of one (`Data.bindPaged`, `Paged.of`). The factory projects `R` into sheet rows (`id` / `owned` + one cell per column) through the shared row-source contract (#567/#576); the sheet order is the source order. Blank padding rows are renderer state, never data. |
| **Search is the slice's; the lens is the Sheet's** | The Sheet takes `slice` chrome like Table / Deck. The rail mounts `search` (and `filter` / `cohort` if listed); the Sheet never narrows — it reads the slice state and draws every non-matching row as a collapsed context band, hits keep their row numbers (B§8). `brush` / `legend` / `breakdown` are refused (no axis, no series). Without `slice` there is no search and no lens. |
| **Views are slice-state snapshots** | A view saves the slice **narrowing** it was made with (`SliceStateType`) plus the lens's context width and reveals — a lens definition evaluated live (B§8), never a copy of rows. Views persist as data (`views` / `onViewsChange`); switching a tab writes the snapshot into the slice. |
| **Copilot providers are East functions, sync or async** | A column's `fill` is a list of functions from `Sheet.Types.Context` (the row as it would be, the resident sheet, the resolved driver member) to an optional fill; `suggest.propose` is a list of functions to proposed rows. Each may be an `East.function` (runs inline within the kind's latency) or an `East.asyncFunction` (the strip shows a pending chip; the result lands reactively; latest wins). Nothing is built in — "derive", "history", "capacity" and "learned followers" are examples in the corpus, written as author functions (§3.5–§3.6). |
| **Write-back** | `onUpdate` (the whole collection with the edit applied — the `ValueTree` idiom) on the inline arm; `onEdit` (raw commit / insert / remove events with provenance) on either arm. `onUpdate` with a paged source is a build-time refusal. |
| **No popovers, nothing floats** | B§9: the strip is the only surface for candidates and provenance. The IR embeds no UI (`node`) — `SheetRootType` is a closed struct referenced directly from `component.ts`, like `Calendar` / `Blend`. |
| **Reuse** | `LiteralValueType` cells, `RowSourceType` + the Plan's paging stack (`paged-window-store`, window ledger / residency / reader, `use-seek`, `key-search`), `SliceChromeType` + the rail cluster + the pure `slice-impl` engine, `shared/reify.ts`, `DensityType`, the `#320` sizing strings, `VirtualRows`, `DensityProvider`, `TickFormatType` for quantity display, the FA icon set, the recipe vocabulary. Not reused: `Table`'s renderer (a sheet is not a `<table>`), `Combobox` / `TagsInput` (the strip replaces every dropdown). |

---

## 2 · Architecture

The established IR → renderer split with the repo's load-bearing rules
(`east-ui/CLAUDE.md`, `docs/conventions/EAST_UI_PROP_PATTERNS.md`):

- **IR** (`east-ui/src/collections/sheet/`): `types.ts` UIComp-free; the root type
  referenced directly by the `Sheet` arm in `component.ts`; factories reify every
  accessor (`shared/reify.ts`), behaviour props are pass-through `FunctionType` /
  `AsyncFunctionType`, never invoked at build time.
- **Renderer** (`east-ui-components/src/collections/sheet/`): many small files (hard
  cap ≤ ~600–800 lines per React file), one **pure state machine**, the prototype's
  parsers, grammar and lens ported as **pure TS modules with unit tests**, the
  Plan's paging stack for the paged arm, a provider runner for sync and async
  functions, Chakra slot recipe `sheet`.
- **JSX tag** (`east-ui/src/runtime/collections/sheet.ts`): `<Sheet …/>` desugaring
  to `Sheet.Root(data, columns, options)` exactly as `<Table>` does, with the column
  map typed as `SheetColumnSpec<T>` so a key that is not a data field is a type error,
  and a second overload for the paged arm (the `<Table>` precedent).

**Behaviour as data.** What crosses the IR is *declaration* (kinds, registers,
provider lists, views, the slice binding); what the renderer owns is *interaction
state* (selection, the edit buffer, pending suggestions, reveals, the active tab).
Nothing in the IR is a snapshot of a transient state, so a `Reactive` re-render
never resets the planner's cursor.

---

## 3 · Authoring surface — the DX, by example

`@jsxImportSource @elaraai/east-ui`. Every example below is complete enough to
compile once the factories exist; the flagship (§3.11) is the first example in the
corpus (`sheetPlan`). Fixtures are elided with `…` only where they repeat.

### 3.1 The smallest sheet

Three typed columns over the host's structs. `id` names the row identity;
`onUpdate` receives the whole collection with the edit applied (the `ValueTree`
idiom), so a `State.bind` — or an e3-ui `Data.bind` — is the entire persistence
story.

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, DateTimeType, FloatType, OptionType, StringType, StructType, none } from "@elaraai/east";
import { Reactive, Sheet, State, UIComponentType } from "@elaraai/east-ui";

const JobType = StructType({
    id:    StringType,
    start: OptionType(DateTimeType),   // none = blank cell
    task:  StringType,                 // "" = blank cell
    qty:   OptionType(FloatType),
});

export const sheetBasic = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const jobs = $.let(State.bind([ArrayType(JobType)], "jobs", [
            { id: "j1", start: none, task: "Transfer", qty: none },
        ]));
        return (
            <Sheet
                data={jobs.read()}
                id={r => r.id}
                columns={{
                    start: Sheet.date({ label: "Start", sub: "d/m · fri · +3d" }),
                    task:  Sheet.text({ label: "Task" }),
                    qty:   Sheet.quantity({ label: "Qty" }),
                }}
                onUpdate={jobs.write}
            />
        );
    }}</Reactive>
));
```

What the planner gets for free: the two-line header, eighteen blank rows below the
last real one (B§7), arrow / Tab / Enter / F2 / type-to-edit (B§6), date and
quantity parsing with the strip preview (B§3), range selection, copy/paste with
Excel (B§10), the footer key hints and live message. No copilot, no search: both
are things the author adds (§3.5, §3.8).

### 3.2 Typed columns — the ten kinds

Each kind is a builder returning a column config; the builder fixes which row
field types the column may sit on (§3.12). Common options on every kind: `label`,
`sub` (the grey second header line), `width` (CSS px), `fill` (§3.5), `editable`.

```tsx
columns={{
    start:     Sheet.date({ label: "Start", sub: "d/m · fri · +3d" }),
    end:       Sheet.date({ label: "End", sub: "4d = start+4", base: "start",       // `4d` means start + 4 (B§3)
                            fill: [endFromStart] }),                                // the fill is an author function (§3.5)
    activity:  Sheet.lookup("activities", { label: "Activity", sub: "activity register" }), // the driver (§3.3)
    vol:       Sheet.quantity({ label: "Vol / Qty", sub: "uom per activity",
                                uom: "uom",                                         // unit label from the driver's `uom` attr
                                format: Format.Number({ maximumFractionDigits: 0n }) }),
    notes:     Sheet.text({ label: "Notes", sub: "free text" }),
    tanks:     Sheet.link("vessels", { /* §3.4 */ }),
    toClean:   Sheet.integer({ label: "Clean", sub: "n" }),
    fromSite:  Sheet.reference("sites", { label: "From site", sub: "site register" }),
    toSite:    Sheet.reference("sites", { label: "To site", sub: "site register" }),
    orderCode: Sheet.stamped({ label: "Order code", sub: "stamped on upload", owner: "MES" }),
    status:    Sheet.enum("statuses", { label: "Status", sub: "mes" }),        // valence dot from the member's `tone` attr
}}
```

| Kind | Row field | Cell | Parse / display (B§3) | Latency |
|---|---|---|---|---|
| `text` | `String` / `Option<String>` | `String` | free text | idle |
| `date` | `DateTime` / `Option<DateTime>` | `DateTime` | `+3d` · `4d` from `base` · weekday · ISO · `d/m[/yy]` · `17 nov` ; display `17 Nov 26` | instant |
| `quantity` | `Float` / `Option<Float>` | `Float` | digits + `l·k·kl·ml` suffix, locale-grouped display, unit from the driver | idle |
| `integer` | `Integer` / `Option<Integer>` | `Integer` | as quantity, no unit | instant |
| `lookup` | `String` / `Option<String>` | `String` | scored register candidates (B§3.1); commit = exact → top → typed | instant |
| `reference` | `String` / `Option<String>` | `String` | as lookup over a flat member list | instant |
| `enum` | `String` / `Option<String>` | `String` | upper-cased; non-match clears | instant |
| `set` | `String` / `Option<String>` | `String` (as typed) | comma members, the link grammar without an arrow | idle |
| `link` | `String` / `Option<String>` | `String` (as typed) | `from > to` — §3.4 | idle |
| `stamped` | `String` / `Option<String>` | `String` | never editable; skipped by paste and clear; `—` on a non-blank row | — |
| `custom` | declared by `parse` | any primitive | author's `parse` / `print` — §3.9 | idle |

Latency (B§3) is how long after the last keystroke the copilot is asked again —
150 ms for deterministic kinds, 1 100 ms for the rest; it is a property of the
kind, not of the provider.

### 3.3 Registers and the driver

A register is a list of **members**: a code the grammar resolves, a label the chip
prints, a `kind`, optional aliases, meta and parent, and **attrs** — the values
other declarations and the author's providers read by name. `Sheet.members`
projects the host's rows through accessors (reified once, the Table `value` rule);
`Sheet.register` concatenates member sets of different kinds into one register.

```tsx
const ActivityType = StructType({ name: StringType, uom: StringType, rate: FloatType, fte: IntegerType, days: IntegerType, sides: StringType });
const TankType     = StructType({ code: StringType, litres: FloatType, farm: StringType });
const FarmType     = StructType({ code: StringType, name: StringType, tanks: IntegerType, aliases: ArrayType(StringType) });
const StatusType   = StructType({ word: StringType, tone: StringType });

// inside the <Reactive> body
const activities = $.const(ACTIVITIES, ArrayType(ActivityType));
const tanks      = $.const(TANKS, ArrayType(TankType));
const farms      = $.const(FARMS, ArrayType(FarmType));

registers={{
    activities: Sheet.register.of(activities, {
        kind: "activity", key: a => a.name, label: a => a.name,
        attrs: { uom: a => a.uom, rate: a => a.rate, fte: a => a.fte, days: a => a.days, sides: a => a.sides },
    }),
    vessels: Sheet.register([
        Sheet.members(tanks, { kind: "tank", key: t => t.code, label: t => t.code,
            meta: t => East.str`${t.litres.divide(1000.0).toInteger()} kL`, parent: t => some(t.farm),
            attrs: { litres: t => t.litres } }),
        Sheet.members(farms, { kind: "farm", key: f => f.name, label: f => f.name,
            aliases: f => f.aliases, meta: f => East.str`farm · ${f.tanks}` }),
        // A countable-by-attribute kind: every distinct size is a member ("140 kL"); duplicates fold by key.
        Sheet.members(tanks, { kind: "capacity", key: t => East.str`${t.litres.divide(1000.0).toInteger()} kL`,
            label: t => East.str`${t.litres.divide(1000.0).toInteger()} kL`, meta: t => "size",
            attrs: { litres: t => t.litres } }),
    ]),
    sites:    Sheet.register.of(sites, { kind: "site", key: s => s, label: s => s }),
    statuses: Sheet.register.of(statuses, { kind: "status", key: s => s.word, label: s => s.word,
                  attrs: { tone: s => s.tone } }),                 // "neutral" | "info" | "warning" | "success" | "danger"
}}
driver="activity"
```

`driver` names the `lookup` column whose member parameterises the row (B§1):
`quantity.uom` and `link.sides.attr` name an **attr of the driver member**, and
providers read the same attrs through `ctx.driver` (§3.5). The factory checks that
every named attr exists on the driver register's attrs and throws at build time
otherwise (the Table "column has value type X" precedent). An `enum` column reads
the member's `tone` attr for its valence dot.

### 3.4 The link column — members, multiple, sides, arity, checks

A link is a directed hyperedge: two sets of members with a direction the driver
declares (B§4). The whole grammar is declared; the renderer implements it.

```tsx
tanks: Sheet.link("vessels", {
    label: "Tanks / vessels", sub: "from → to · 4 x 140kL · tank · farm", width: "352px",
    members: [
        { kind: "tank", identified: true },                    // a register code; bare digits try the code prefix
        { kind: "range", identified: true },                   // T2140-45 expands to every member in the span
        { kind: "farm", countable: true, resolvesTo: "tank" }, // "4 × 2000s" — a count of a kind, resolved later
        { kind: "group", countable: true, resolvesTo: "tank" },
        { kind: "capacity", countable: true, resolvesTo: "tank" },
    ],
    multiple: { forms: ["N x kind", "kind x N"], ops: ["x", "X", "*", "×"], appliesTo: "countable" },
    sides: { attr: "sides",                                     // the driver attr holding both | from | to | in
             locks: { from: { to: "external", in: "in place" }, to: { from: "external" } } },
    arity: Sheet.arity("to", impliedTanks),                    // how many the To half should hold — an East function, below
    check: [Sheet.check.exists(), siteMatches],                // `exists` is the grammar's own; the rest are author functions
    store: "asTyped",                                           // keep the planner's string; "canonical" rewrites to labels
    fill: [lastTanks, countedByVolume],                         // §3.5
}),
```

The arity rule is domain logic, so it is a function: given the row as it would be,
how many members are implied and **which countable member** to propose when none
are named (the `n × 140 kL` form of B§4.5). The prototype's per-unit switch reads
naturally:

```tsx
const impliedTanks = $.const(East.function([Sheet.Types.Context], OptionType(Sheet.Types.Counted), ($, ctx) => {
    const vol = $.let(ctx.row.get("vol").match({ Float: (_$, v) => v }, _$ => 0.0));
    const uom = $.let(ctx.driver.match({ some: (_$, d) => d.attrs.get("uom").unwrap("String") }, _$ => ""));
    const litresPerTank = $.const(140000.0);
    return uom.equal("Tk").ifElse(
        _$ => some({ n: vol.toInteger(), member: "140 kL" }),                // the quantity IS the count
        _$ => uom.equal("Drm").ifElse(
            _$ => East.value(none, OptionType(Sheet.Types.Counted)),          // drum jobs name no vessels
            _$ => vol.greater(0.0).ifElse(
                _$ => some({ n: vol.divide(litresPerTank).toInteger().add(1n), member: "140 kL" }),
                _$ => East.value(none, OptionType(Sheet.Types.Counted)))));
}));
```

The strip reads the result while the To half is edited (*4 × 140 kL implied · 3
named so far*, B§4.6). A `check` returns `some(message)` to flag a member (B§2
`check`); `exists` is the grammar's, the rest are the author's:

```tsx
const siteMatches = $.const(East.function([Sheet.Types.CheckContext], OptionType(StringType), ($, c) => {
    // c.member is the resolved member, c.half "from" | "to", c.row the provisional row
    const site = $.let(c.row.get(c.half.equal("from").ifElse(_$ => "fromSite", _$ => "toSite")));
    return site.hasTag("Null").ifElse(
        _$ => East.value(none, OptionType(StringType)),
        _$ => c.member.attrs.get("site").unwrap("String").equal(site.unwrap("String")).ifElse(
            _$ => East.value(none, OptionType(StringType)),
            _$ => some(East.str`${c.member.label} is not at ${site.unwrap("String")}`)));
}));
```

Typed entry is never blocked (B§4.1 "anything else — text, dashed"); flags are
shown, not enforced.

### 3.5 In-row autocomplete — fill providers are East functions

Every column may carry a list of **fill providers**; the first that yields wins and
its provenance (`meta`) prints in the strip (B§5.1). A provider is an East
function from the row-as-it-would-be to an optional fill. It receives the sheet
and the resolved driver member, so every rule the prototype hard-codes — derive,
history, sequence, default, phrase, capacity — is a few lines of East. Nothing is
built in; these are the corpus examples (`sheetCopilot`):

```tsx
// End = Start + the driver's `days` (the prototype's `derive`).
const endFromStart = $.const(East.function([Sheet.Types.Context], OptionType(Sheet.Types.Fill), ($, ctx) => {
    const start = $.let(ctx.row.get("start"));
    return start.hasTag("DateTime").and(ctx.driver.hasTag("some")).ifElse(
        $ => {
            const driver = $.let(ctx.driver.unwrap("some"));
            const days   = $.let(driver.attrs.get("days").unwrap("Integer"));
            return some({ value: variant("DateTime", start.unwrap("DateTime").addDays(days)),
                          meta: East.str`+${days}d · ${driver.label}` });
        },
        _$ => East.value(none, OptionType(Sheet.Types.Fill)));
}));

// "Same value as the last row with this driver value" (the prototype's `history`) — ONE East function
// taking the column key, and one thin wrapper per column, because a column's fill takes only the context.
const lastSimilar = $.const(East.function([Sheet.Types.Context, StringType], OptionType(Sheet.Types.Fill), ($, ctx, key) => {
    const activity = $.let(ctx.row.get("activity"));
    const similar  = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) =>
        r.cells.get("activity").equal(activity).and(r.cells.get(key).hasTag("Null").not())));
    return similar.length().equal(0n).ifElse(
        _$ => East.value(none, OptionType(Sheet.Types.Fill)),
        $ => {
            const r = $.let(similar.get(similar.length().subtract(1n)));
            return some({ value: r.cells.get(key), meta: East.str`like ${r.id}` });
        });
}));
const lastVolume = $.const(East.function([Sheet.Types.Context], OptionType(Sheet.Types.Fill), (_$, ctx) => lastSimilar(ctx, "vol")));
const lastTanks  = $.const(East.function([Sheet.Types.Context], OptionType(Sheet.Types.Fill), (_$, ctx) => lastSimilar(ctx, "tanks")));

// Start: a week after the nearest dated row above; else next Monday (the prototype's `sequence`).
const nextSlot = $.const(East.function([Sheet.Types.Context], OptionType(Sheet.Types.Fill), ($, ctx) => {
    const dated = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) => r.cells.get("start").hasTag("DateTime")));
    return dated.length().greater(0n).ifElse(
        $ => {
            const last = $.let(dated.get(dated.length().subtract(1n)));
            const at   = $.let(last.cells.get("start").unwrap("DateTime").addDays(7n));
            return some({ value: variant("DateTime", at), meta: East.str`week after ${last.id}` });
        },
        $ => {
            const daysToMonday = $.let(East.value(8n).subtract(ctx.today.getDayOfWeek()).remainder(7n));
            const monday = $.let(ctx.today.addDays(daysToMonday.equal(0n).ifElse(_$ => 7n, _$ => daysToMonday)));
            return some({ value: variant("DateTime", monday), meta: "next Monday" });
        });
}));

// Vol: eight hours at the driver's rate when nothing similar exists (the prototype's `default`).
const shiftVolume = $.const(East.function([Sheet.Types.Context], OptionType(Sheet.Types.Fill), ($, ctx) =>
    ctx.driver.match({
        some: (_$, d) => some({ value: variant("Float", d.attrs.get("rate").unwrap("Float").multiply(8.0)),
                                meta: East.str`${d.attrs.get("rate").unwrap("Float")}/h × 8 h` }),
        none: (_$)   => East.value(none, OptionType(Sheet.Types.Fill)),
    })));

// Notes: a phrase per driver family (the prototype's `phrase`).
const phrase = $.const(East.function([Sheet.Types.Context], OptionType(Sheet.Types.Fill), ($, ctx) => {
    const activity = $.let(ctx.row.get("activity").match({ String: (_$, s) => s }, _$ => ""));
    const kl = $.let(ctx.row.get("vol").match({ Float: (_$, v) => v.divide(1000.0).toInteger() }, _$ => 0n));
    return activity.startsWith("Transfer").ifElse(
        _$ => some({ value: variant("String", East.str`Transfer ${kl}kL of BX2`), meta: "phrasing from past transfers" }),
        _$ => activity.startsWith("Xflow").ifElse(
            _$ => some({ value: variant("String", East.str`xflow ${kl}kL of BX2`), meta: "phrasing from past xflows" }),
            _$ => East.value(none, OptionType(Sheet.Types.Fill))));
}));

// Tanks: the counted form from the arity rule (the prototype's `capacity`).
const countedByVolume = $.const(East.function([Sheet.Types.Context], OptionType(Sheet.Types.Fill), (_$, ctx) =>
    impliedTanks(ctx).match({
        some: (_$, c) => some({ value: variant("String", East.str`${c.n} x ${c.member}`), meta: "capacity · from the volume" }),
        none: (_$)   => East.value(none, OptionType(Sheet.Types.Fill)),
    })));

columns={{
    start: Sheet.date({ label: "Start", fill: [nextSlot] }),
    end:   Sheet.date({ label: "End", base: "start", fill: [endFromStart] }),
    vol:   Sheet.quantity({ label: "Vol / Qty", uom: "uom", fill: [lastVolume, shiftVolume] }),   // first that yields wins
    notes: Sheet.text({ label: "Notes", fill: [phrase] }),
    tanks: Sheet.link("vessels", { /* … */ fill: [lastTanks, countedByVolume] }),
}}
```

An **async** fill is the same signature as an `East.asyncFunction`; the renderer
shows a pending chip in the strip for that column and lands the result when it
arrives (§6.2). Contract (B§5): providers run against the row *as it would be if
the open editor committed*, after the kind's latency; owned rows are never
touched; nothing is proposed into an occupied cell; exactly one cell is the next
Tab target; a rejected fill is remembered per row and key. On a paged sheet
`ctx.rows` is the **resident** prefix and `ctx.partial` is true — a provider that
reasons over history should say so in its `meta`.

### 3.6 Multi-row autocomplete — proposers are East functions

Row proposals are the same idea one level up: a **proposer** maps the row as it
would be to zero or more proposed rows (partial cell dicts) with a provenance
line. The first proposer that returns rows wins. Three shapes cover the
prototype and beyond: a domain pattern, a learned follower, and a model call.

```tsx
// 1 · A domain pattern: a bulk-blender transfer is followed by a media add on the same days
//     and a packdown at end +3…+7 d.
const bulkBlenderFollowUps = $.const(East.function([Sheet.Types.Context], ArrayType(Sheet.Types.Proposal), ($, ctx) => {
    const activity = $.let(ctx.row.get("activity").match({ String: (_$, s) => s }, _$ => ""));
    const start = $.let(ctx.row.get("start"));
    const end   = $.let(ctx.row.get("end"));
    const vol   = $.let(ctx.row.get("vol"));
    const n     = $.let(impliedTanks(ctx).match({ some: (_$, c) => c.n, none: (_$) => 1n }));   // reuse the arity rule
    const empty = $.const([], ArrayType(Sheet.Types.Proposal));
    return activity.equal("Transfer - Bulk Blenders").and(end.hasTag("DateTime")).ifElse(
        $ => {
            const endAt = $.let(end.unwrap("DateTime"));
            return $.const([
                { cells: new Map([
                    ["activity", variant("String", "Media - Add to Tank")],
                    ["start", start], ["end", end],
                    ["vol", variant("Float", n.toFloat())],
                    ["notes", variant("String", East.str`Add media to ${n} tanks`)],
                  ]), meta: "media add · same days" },
                { cells: new Map([
                    ["activity", variant("String", "Transfer")],
                    ["start", variant("DateTime", endAt.addDays(3n))],
                    ["end", variant("DateTime", endAt.addDays(7n))],
                    ["vol", vol],
                    ["notes", variant("String", "Packdown of the blend")],
                  ]), meta: "packdown · end +3…+7 d" },
            ], ArrayType(Sheet.Types.Proposal));
        },
        _$ => empty);
}));

// 2 · Learned from the sheet: what followed this activity last time, after how long (B§5.2).
const lastFollower = $.const(East.function([Sheet.Types.Context], ArrayType(Sheet.Types.Proposal), ($, ctx) => {
    const empty    = $.const([], ArrayType(Sheet.Types.Proposal));
    const activity = $.let(ctx.row.get("activity").match({ String: (_$, s) => s }, _$ => ""));
    const start    = $.let(ctx.row.get("start"));
    const dated    = $.let(ctx.rows.filter((_$, r) =>
        r.cells.get("start").hasTag("DateTime").and(r.cells.get("activity").hasTag("String"))));
    const n        = $.let(dated.length());
    const upper    = $.let(n.greater(1n).ifElse(_$ => n.subtract(1n), _$ => 0n));
    // consecutive pairs (this activity → a different one), in sheet order
    const pairs = $.let(East.Array.range(0n, upper).filter((_$, i) => {
        const a = dated.get(i).cells.get("activity").unwrap("String");
        const b = dated.get(i.add(1n)).cells.get("activity").unwrap("String");
        return a.equal(activity).and(b.equal(activity).not());
    }));
    return pairs.length().equal(0n).or(activity.equal("")).or(start.hasTag("DateTime").not()).ifElse(
        _$ => empty,
        $ => {
            const i     = $.let(pairs.get(pairs.length().subtract(1n)));
            const from  = $.let(dated.get(i).cells);
            const next  = $.let(dated.get(i.add(1n)).cells);
            const gapMs = $.let(next.get("start").unwrap("DateTime").toEpochMilliseconds()
                                .subtract(from.get("start").unwrap("DateTime").toEpochMilliseconds()));
            const at    = $.let(start.unwrap("DateTime").addMilliseconds(gapMs));
            return $.const([{
                cells: new Map([
                    ["activity", next.get("activity")], ["start", variant("DateTime", at)],
                    ["vol", next.get("vol")], ["notes", next.get("notes")],
                ]),
                meta: East.str`${next.get("activity").unwrap("String")} followed ${activity} last time · +${gapMs.divide(86400000n)}d`,
            }], ArrayType(Sheet.Types.Proposal));
        });
}));

// 3 · A model: an ASYNC proposer that awaits a platform function the host implements
//     (an e3 function behind it, a service, a notebook — the Sheet only needs the type).
const recommend = East.asyncPlatform("plan_recommend", [Sheet.Types.Context], ArrayType(Sheet.Types.Proposal));   // module scope
const modelProposals = $.const(East.asyncFunction([Sheet.Types.Context], ArrayType(Sheet.Types.Proposal),
    (_$, ctx) => recommend(ctx)));

suggest={{
    ahead: 2n,                                                   // at most two proposed rows below the anchor (B§5.2)
    triggers: ["activity", "start", "end", "vol", "notes", "tanks"],
    propose: [bulkBlenderFollowUps, modelProposals, lastFollower],   // first that returns rows wins
}}
```

What the renderer does with a proposal (B§5.2): renders it as a dashed-topped,
hatched row under the anchor with a real row number; ✓ / ⏎ adds it (into the first
blank slot rather than pushing the sheet), × / ⌫ rejects it and remembers the
driver pairing so it is not offered again; taking a row re-anchors and asks the
proposers again, so the next one is already waiting. While an async proposer is
in flight the strip shows *suggested · ⋯* with the provider's position; a newer
context cancels the wait (latest wins). Cells a proposal leaves out are blank;
the copilot then fills them like any other row.

### 3.7 Write-back — `onUpdate` or `onEdit`; staged or direct

Two channels, both optional, both East functions:

- **`onUpdate: (rows: Array<R>) => Null`** — inline arm only. The whole collection
  with the edit applied; the factory compiles it into an edit handler that rebuilds
  the host's structs (a commit rewrites one field of one row, an insert appends a
  fresh row from the row type's default value with the id and cells applied, a
  remove filters ids). Requirements, checked at build time: `id` is a `String`
  field and every editable column is a field whose type matches the kind (§3.2).
- **`onEdit: (edit: Sheet.Types.Edit) => Null`** — either arm. The raw event:
  `commit { rowId, key, value, source }` · `insert { afterRowId, row, source }` ·
  `remove { rowIds }`, with `source ∈ typed · pasted · fill · row · pattern` so a host
  can measure copilot uptake (B§1). A paste arrives as its commits and inserts in
  order. On a paged sheet this is the only channel — the host routes edits to the
  dataset it pages from (§3.13).

With both set, `onEdit` observes and `onUpdate` writes. `newRowId: () => String`
overrides the renderer's id minting for inserted rows.

Persistence mode is the host's, through the e3-ui bind (`east:e3-ui`):

```tsx
/** @jsxImportSource @elaraai/e3-ui */
// autosave ON  = every mutation lands:      Data.bind(planInput)                 (direct)
// autosave OFF = changes held locally:       Data.bind(planInput, { mode: "staged" }) + commit / discard
<Reactive>{$ => {
    const plan   = $.let(Data.bind(planInput, { mode: "staged" }));
    const commit  = $.const(East.function([], NullType, $ => { $(plan.commit()); }));
    const discard = $.const(East.function([], NullType, $ => { $(plan.discard()); }));
    return (
        <VStack gap="3" align="stretch" height="fill">
            <Sheet data={plan.read()} id={r => r.id} columns={…} registers={…} driver="activity"
                   onUpdate={plan.write} style={{ height: "fill" }} />
            <HStack gap="2" justify="flex-end">
                <Button variant="outline" onClick={discard}>Discard</Button>
                <Button variant="solid" onClick={commit}>Apply</Button>
            </HStack>
            <Diff bindings={[plan.binding]} />
        </VStack>
    );
}}</Reactive>
```

The prototype's autosave toggle is host chrome: a `<Switch>` in the app bar that
selects which bound handle's `write` the sheet calls (`autosaveOn.ifElse(_$ =>
direct.write, _$ => staged.write)`), with the "saved N m ago" stamp derived from
the handle's `status()`.

### 3.8 Search through the slice — the lens and the views

The search box is the slice's `search` affordance; the Sheet never narrows. It
reads the slice state and draws the **lens** (B§8): rows the narrowing matches
are hits (brand row numbers), the rest collapse into ±0 / ±1 / ±3 context bands
that reveal on click; the count reads *n matches · m context*. Because the lens
is drawn from the whole narrowing, `filter` and `cohort` affordances work the
same way — a filtered-out row is a band, not a missing row.

```tsx
const cfg = Slice.config(PlanRowType, {
    fields: { activity: { label: "Activity" }, notes: { label: "Notes" }, tanks: { label: "Tanks" }, status: { label: "Status" } },
    searchFieldIds: ["activity", "notes", "tanks"],
});
const slice = $.let(Slice.bind([PlanRowType], "plan.slice", cfg, Slice.state(), rows, none));

<Sheet … slice={slice} affordances={["search", "filter"]} />
```

A **view** is a slice-state snapshot plus the lens's context and reveals — a tab
that is evaluated live, so a new matching row joins it and an edit anywhere
writes to the sheet (B§8). Views are data on the sheet's bind; switching a tab
writes its narrowing into the slice, `+ TAB` snapshots the current one, ⏎ updates
a dirty tab, esc reverts it.

```tsx
const views = $.let(State.bind([ArrayType(Sheet.Types.View)], "plan.views", [
    { id: "xflow", name: "XFLOW", narrowing: Slice.state({ search: some("xflow") }), context: 1n, reveals: [] },
]));
<Sheet … slice={slice} affordances={["search"]} views={views.read()} onViewsChange={views.write} activeView={some("xflow")} />
```

Without `slice` there is no search box, no lens and no tabs — the sheet is whole.

### 3.9 Custom column kinds

A kind the registry lacks is an East pair: `parse` (typed text → cell, `none` =
unrecognised, which keeps the editor open with the neg ring) and `print` (cell →
display text). `accepts` is the strip's "what this field accepts" line.

```tsx
// A shift code: "A", "B", "N" (night); stored upper-cased as a String cell.
const parseShift = $.const(East.function([StringType, Sheet.Types.Context], OptionType(Sheet.Types.Cell), ($, text, _ctx) => {
    const t = $.let(text.trim().upperCase());
    return t.equal("A").or(t.equal("B")).or(t.equal("N")).ifElse(
        _$ => some(variant("String", t)),
        _$ => East.value(none, OptionType(Sheet.Types.Cell)));
}));
const printShift = $.const(East.function([Sheet.Types.Cell], StringType, (_$, cell) =>
    cell.match({ String: (_$, s) => East.str`shift ${s}` }, _$ => "")));

shift: Sheet.custom({ label: "Shift", accepts: "A · B · N", parse: parseShift, print: printShift,
                      fill: [lastShift] }),
```

### 3.10 Host chrome — footer counts, sync status, stamping

Footer counts are the host's expressions over the host's rows (B§7); the sync line
and the upload action live in the app bar; a stamping upload is an ordinary bound
function whose result is written back, after which the sheet shows the stamped
codes read-only and the rows as owned:

```tsx
const rows = $.let(plan.read());
const planned   = $.let(rows.filter((_$, r) => r.activity.length().greater(0n)).length());
const ready     = $.let(rows.filter((_$, r) => r.activity.length().greater(0n).and(r.start.hasTag("some"))
                                       .and(r.vol.hasTag("some")).and(r.orderCode.length().equal(0n))).length());
const cancelled = $.let(rows.filter((_$, r) => r.status.equal("CANCELLED")).length());

<Sheet …
    owned={r => r.orderCode.length().greater(0n).or(r.status.equal("CANCELLED"))}
    footer={[{ text: East.str`${planned} planned · ${ready} ready to upload · ${cancelled} cancelled` }]}
/>
```

### 3.11 The flagship — everything together (`sheetPlan`)

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, DateTimeType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, some, none, variant } from "@elaraai/east";
import { Format, Reactive, Sheet, Slice, State, UIComponentType } from "@elaraai/east-ui";

const PlanRowType = StructType({
    id: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType), activity: StringType,
    vol: OptionType(FloatType), notes: StringType, tanks: StringType, toClean: OptionType(IntegerType),
    fromSite: StringType, toSite: StringType, orderCode: StringType, status: StringType,
});
// ActivityType / TankType / FarmType / StatusType as in §3.3; PLAN_ROWS / ACTIVITIES / TANKS / FARMS /
// SITES / STATUSES are the synthetic fixtures the prototype ships with.
const recommend = East.asyncPlatform("plan_recommend", [Sheet.Types.Context], ArrayType(Sheet.Types.Proposal));

export const sheetPlan = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const plan  = $.let(State.bind([ArrayType(PlanRowType)], "plan.rows", PLAN_ROWS));
        const views = $.let(State.bind([ArrayType(Sheet.Types.View)], "plan.views", []));
        const rows  = $.let(plan.read());
        const activities = $.const(ACTIVITIES, ArrayType(ActivityType));
        const tanks = $.const(TANKS, ArrayType(TankType));
        const farms = $.const(FARMS, ArrayType(FarmType));
        const sites = $.const(SITES, ArrayType(StringType));
        const statuses = $.const(STATUSES, ArrayType(StatusType));
        const cfg = Slice.config(PlanRowType, {
            fields: { activity: { label: "Activity" }, notes: { label: "Notes" }, tanks: { label: "Tanks" }, status: { label: "Status" } },
            searchFieldIds: ["activity", "notes", "tanks"],
        });
        const slice = $.let(Slice.bind([PlanRowType], "plan.slice", cfg, Slice.state(), rows, none));
        // impliedTanks, siteMatches (§3.4) · endFromStart, lastSimilar + wrappers, nextSlot, shiftVolume, phrase,
        // countedByVolume (§3.5) · bulkBlenderFollowUps, lastFollower, modelProposals (§3.6)
        const planned = $.let(rows.filter((_$, r) => r.activity.length().greater(0n)).length());

        return (
            <Sheet
                data={rows}
                id={r => r.id}
                owned={r => r.orderCode.length().greater(0n).or(r.status.equal("CANCELLED"))}
                columns={{
                    start:     Sheet.date({ label: "Start", sub: "d/m · fri · +3d", width: "96px", fill: [nextSlot] }),
                    end:       Sheet.date({ label: "End", sub: "4d = start+4", width: "96px", base: "start", fill: [endFromStart] }),
                    activity:  Sheet.lookup("activities", { label: "Activity", sub: "activity register", width: "214px" }),
                    vol:       Sheet.quantity({ label: "Vol / Qty", sub: "uom per activity", width: "112px", uom: "uom",
                                                format: Format.Number({ maximumFractionDigits: 0n }),
                                                fill: [lastVolume, shiftVolume] }),
                    notes:     Sheet.text({ label: "Notes", sub: "free text", width: "250px", fill: [phrase] }),
                    tanks:     Sheet.link("vessels", {
                        label: "Tanks / vessels", sub: "from → to · 4 x 140kL · tank · farm", width: "352px",
                        members: [{ kind: "tank", identified: true }, { kind: "range", identified: true },
                                  { kind: "farm", countable: true, resolvesTo: "tank" },
                                  { kind: "group", countable: true, resolvesTo: "tank" },
                                  { kind: "capacity", countable: true, resolvesTo: "tank" }],
                        multiple: { forms: ["N x kind", "kind x N"], ops: ["x", "X", "*", "×"], appliesTo: "countable" },
                        sides: { attr: "sides", locks: { from: { to: "external", in: "in place" }, to: { from: "external" } } },
                        arity: Sheet.arity("to", impliedTanks),
                        check: [Sheet.check.exists(), siteMatches],
                        fill: [lastTanks, countedByVolume],
                    }),
                    toClean:   Sheet.integer({ label: "Clean", sub: "n", width: "64px" }),
                    fromSite:  Sheet.reference("sites", { label: "From site", sub: "site register", width: "112px" }),
                    toSite:    Sheet.reference("sites", { label: "To site", sub: "site register", width: "112px" }),
                    orderCode: Sheet.stamped({ label: "Order code", sub: "stamped on upload", owner: "MES", width: "104px" }),
                    status:    Sheet.enum("statuses", { label: "Status", sub: "mes", width: "124px" }),
                }}
                registers={{ /* §3.3 */ }}
                driver="activity"
                suggest={{ ahead: 2n, triggers: ["activity", "start", "end", "vol", "notes", "tanks"],
                           propose: [bulkBlenderFollowUps, modelProposals, lastFollower] }}
                slice={slice} affordances={["search", "filter"]}
                views={views.read()} onViewsChange={views.write}
                onUpdate={plan.write}
                footer={[{ text: East.str`${planned} planned` }]}
                style={{ height: "fill" }}
            />
        );
    }}</Reactive>
));
```

### 3.12 Type-level guarantees

| Mistake | Where it fails |
|---|---|
| A column key that is not a field of the row struct | compile time — `SheetColumnSpec<T>` is a mapped type over the row's fields, excess-property checked at the tag (the `<Table columns>` precedent) |
| `Sheet.date()` on a `String` field, `Sheet.quantity()` on an `Integer` field | compile time — each builder's config carries the field types it may sit on; the mapped type rejects the rest |
| A `fill` / `propose` entry that is not a function over `Sheet.Types.Context` with the right output | compile time (`SubtypeExprOrValue<FunctionType<…>>` / `AsyncFunctionType<…>`) |
| An `onUpdate` whose editable columns are not plain fields (or whose `id` is not a `String` field) | build time — the factory names every offending column |
| `onUpdate` on a paged source | build time — "the whole-value rebuild needs the whole collection; use `onEdit`" |
| A `uom` / `sides.attr` that is not an attr of the driver register; an unknown register name | build time |
| A `custom` column whose `parse` output type does not match the field | build time (the function's East output type is inspected, the Table `value` rule) |
| `brush` / `legend` / `breakdown` affordances | build time — refused with the reason |

### 3.13 A paged sheet

The paged arm is the same tag over a windowed source; the row type rides in the
source's `page` signature, so `columns` is checked exactly as for an array. The
Sheet pages with the Plan's stack: windows land as the planner scrolls, the
footer carries the transport line (*N loaded of M · Loading…*), the blank tail
appears once the source is exhausted, the rail's search becomes a **key search**
over the source's `seek` when the source is keyed, and the lens over the resident
rows is scope-badged *loaded rows only*. Edits go through `onEdit`.

```tsx
const source = $.const(Paged.of("plan", rows, { key: r => r.id }));   // Data.bindPaged(planInput) in e3-ui
const applyEdit = $.const(East.function([Sheet.Types.Edit], NullType, ($, e) => {
    $(edits.write(edits.read().concat([e])));                                // the host's edit journal, replayed server-side
}));
<Sheet data={source} id={r => r.id} columns={…} registers={…} driver="activity"
       slice={slice} affordances={["search"]} onEdit={applyEdit} style={{ height: "fill" }} />
```

---

## 4 · IR design

Everything below lives in `east-ui/src/collections/sheet/` (`types.ts` UIComp-free;
`index.ts` the factories + namespace). The root struct is referenced *directly* by
the `Sheet` arm of `UIComponentType` — no `node`, no hand-synced inline copy.

### 4.1 Rows and cells

```ts
export const SheetCellType = LiteralValueType;                // Null = blank (the Table cell, #206)
export const SheetRowType = StructType({
    id:    StringType,
    owned: BooleanType,                                        // stamped by the `owned` accessor; no copilot, stamped columns read-only
    cells: DictType(StringType, SheetCellType),                // one entry per declared column, always present
});
export const SheetRowsCollectionType = ArrayType(SheetRowType);
export const SheetRowsType = RowSourceType(SheetRowsCollectionType);   // inline OR paged (#576) — both arms accepted
```

A keyed source (`Dict<String, R>`, or a paged source of one) is accepted as well:
its key is the row id (the `id` accessor may be omitted) and its canonical key
order is the sheet order, which is what makes `seek` address real rows. The
factory's `make` projects a window exactly as it projects the whole collection
(`buildRowSource`), so the renderer sees one row space.

### 4.2 Registers

```ts
export const SheetMemberType = StructType({
    key:     StringType,                     // what the grammar resolves ("T2140", "2000s", "G1042", "140 kL")
    label:   StringType,                     // what a chip prints
    kind:    StringType,                     // "tank" | "farm" | "group" | "capacity" | "activity" | "site" | …
    aliases: ArrayType(StringType),          // "the 2000s", "anx"
    meta:    OptionType(StringType),         // chip meta ("140 kL", "farm · 96"); shown when a half holds one chip
    parent:  OptionType(StringType),         // a tank's farm — countable → identified resolution and "enumerate"
    attrs:   DictType(StringType, SheetCellType),  // named values declarations and providers read: uom / rate / days / sides / tone / litres
});
export const SheetRegisterType = StructType({ members: ArrayType(SheetMemberType) });
```

### 4.3 Column kinds

```ts
export const SheetHalfType       = VariantType({ from: NullType, to: NullType });
export const SheetSidesValueType = VariantType({ both: NullType, from: NullType, to: NullType, in: NullType });
export const SheetStoreType      = VariantType({ asTyped: NullType, canonical: NullType });
export const SheetMemberKindType = StructType({ kind: StringType, identified: BooleanType, countable: BooleanType, resolvesTo: OptionType(StringType) });
export const SheetMultipleType   = StructType({ forms: ArrayType(StringType), ops: ArrayType(StringType), appliesTo: StringType });
export const SheetSideLockType   = StructType({ half: SheetHalfType, when: SheetSidesValueType, label: StringType });
export const SheetSidesType      = StructType({ attr: StringType, locks: ArrayType(SheetSideLockType) });   // the nested TS shape flattens here
export const SheetCountedType    = StructType({ n: IntegerType, member: StringType });                      // "4 × 140 kL"
export const SheetArityType      = StructType({ half: SheetHalfType, implied: FunctionType([SheetContextType], OptionType(SheetCountedType)) });
export const SheetCheckContextType = StructType({ rowIndex: IntegerType, row: DictType(StringType, SheetCellType), half: SheetHalfType, member: SheetMemberType });
export const SheetCheckType      = VariantType({ exists: NullType, custom: FunctionType([SheetCheckContextType], OptionType(StringType)) });

export const SheetColumnKindType = VariantType({
    text:      NullType,
    date:      StructType({ base: OptionType(StringType), format: OptionType(StringType) }),    // `base`: the column relative entry counts from
    quantity:  StructType({ uom: OptionType(StringType), format: OptionType(TickFormatType) }),
    integer:   NullType,
    lookup:    StructType({ register: StringType }),
    reference: StructType({ register: StringType }),
    enum:      StructType({ register: StringType }),
    set:       StructType({ register: StringType, members: ArrayType(SheetMemberKindType), multiple: OptionType(SheetMultipleType), store: SheetStoreType }),
    link:      StructType({ register: StringType, members: ArrayType(SheetMemberKindType), multiple: OptionType(SheetMultipleType),
                            sides: OptionType(SheetSidesType), arity: OptionType(SheetArityType), check: ArrayType(SheetCheckType), store: SheetStoreType }),
    stamped:   StructType({ owner: OptionType(StringType) }),
    custom:    StructType({ accepts: StringType,
                            parse: FunctionType([StringType, SheetContextType], OptionType(SheetCellType)),
                            print: FunctionType([SheetCellType], StringType) }),
});

export const SheetColumnType = StructType({
    key: StringType, label: StringType, sub: OptionType(StringType), width: OptionType(StringType),
    kind: SheetColumnKindType,
    dataType: EastTypeType,                                  // the row field's static type (Table precedent)
    editable: BooleanType,                                   // false for stamped, or by option
    fill: ArrayType(SheetProviderType),                      // first provider that yields wins; sync or async
});
```

### 4.4 The copilot

```ts
export const SheetContextType = StructType({
    rowIndex: IntegerType,                                   // sheet position among REAL (resident) rows
    row:      DictType(StringType, SheetCellType),           // the row as it would be if the open editor committed
    rows:     ArrayType(SheetRowType),                       // the resident sheet, real rows in sheet order
    partial:  BooleanType,                                   // true on a paged sheet whose source is not exhausted
    driver:   OptionType(SheetMemberType),                   // the resolved driver member for `row`
    today:    DateTimeType,                                  // UTC midnight — so providers stay pure
});
export const SheetFillType     = StructType({ value: SheetCellType, meta: StringType });
export const SheetProposalType = StructType({ cells: DictType(StringType, SheetCellType), meta: StringType });

// A provider is an East function — synchronous, or asynchronous (a model call). The factory
// picks the arm from the function value's East type; the author just passes the function.
export const SheetProviderType = VariantType({
    sync:  FunctionType([SheetContextType], OptionType(SheetFillType)),
    async: AsyncFunctionType([SheetContextType], OptionType(SheetFillType)),
});
export const SheetProposerType = VariantType({
    sync:  FunctionType([SheetContextType], ArrayType(SheetProposalType)),
    async: AsyncFunctionType([SheetContextType], ArrayType(SheetProposalType)),
});
export const SheetSuggestType = StructType({
    ahead: IntegerType, triggers: ArrayType(StringType), ghost: BooleanType,
    propose: ArrayType(SheetProposerType),
});
```

There are no built-in providers: the vocabulary the prototype hard-codes
(`derive`, `history`, `sequence`, `default`, `phrase`, `capacity`, learned
followers) lives in the examples corpus as author functions (§3.5–§3.6). What the
component owns is the *runner*: latency, the provisional row, the first-yields
rule, memoisation, pending state and cancellation for async providers, rejection
memory, the strip.

### 4.5 Views, edits, selection, slice

```ts
export const SheetViewType = StructType({
    id: StringType, name: StringType,
    narrowing: SliceStateType,                               // the slice state the view was made with — evaluated live
    context: IntegerType, reveals: ArrayType(IntegerType),   // the lens's band width and revealed row indices
});
export const SheetSourceType = VariantType({ typed: NullType, pasted: NullType, fill: NullType, row: NullType, pattern: NullType });
export const SheetEditType   = VariantType({
    commit: StructType({ rowId: StringType, key: StringType, value: SheetCellType, source: SheetSourceType }),
    insert: StructType({ afterRowId: OptionType(StringType), row: SheetRowType, source: SheetSourceType }),
    remove: StructType({ rowIds: ArrayType(StringType) }),
});
export const SheetSelectionType  = StructType({ rowId: OptionType(StringType), key: OptionType(StringType) });
export const SheetFooterItemType = StructType({ text: StringType, tone: OptionType(StatusValueType) });
export const SheetStyleType      = StructType({ height: OptionType(StringType), maxHeight: OptionType(StringType), gutterWidth: OptionType(StringType) });
```

### 4.6 Root

```ts
export const SheetRootType = StructType({
    rows:          SheetRowsType,                            // inline | paged
    columns:       ArrayType(SheetColumnType),
    registers:     DictType(StringType, SheetRegisterType),
    driver:        OptionType(StringType),                   // the lookup column key
    suggest:       OptionType(SheetSuggestType),
    slice:         OptionType(SliceChromeType),              // the rail (search / filter / cohort); the lens reads the bound state
    views:         ArrayType(SheetViewType),
    activeView:    OptionType(StringType),
    onViewsChange: OptionType(FunctionType([ArrayType(SheetViewType)], NullType)),
    onEdit:        OptionType(FunctionType([SheetEditType], NullType)),   // `onUpdate` compiles to this (§3.7)
    onSelect:      OptionType(FunctionType([SheetSelectionType], NullType)),
    newRowId:      OptionType(FunctionType([], StringType)),
    readOnly:      OptionType(BooleanType),
    blanks:        OptionType(IntegerType),                  // padding rows below the last real one (default 18)
    density:       OptionType(DensityType),
    footer:        ArrayType(SheetFooterItemType),
    style:         OptionType(SheetStyleType),
});
// component.ts:   Sheet: SheetRootType,
```

### 4.7 The `onUpdate` rebuild (factory internals, inline arm)

The factory knows `R` and every column's field, so it writes the edit handler
itself — the `ValueTree` rebuild macro, one level simpler because a Sheet edit
touches one field of one struct:

- `commit` → `rows.map(r => idOf(r).equal(ev.rowId).ifElse(_ => with(r, key, cell), _ => r))` where
  `with` is an authoring-time struct literal spelling every field of `R` and
  substituting the edited one (unwrapped from the cell by the column's static
  tag; `Null` → `none` on an `Option` field, the field's default otherwise);
- `insert` → the row type's default value with `id` set, then every cell of
  `ev.row.cells` applied through the same setters; appended after `afterRowId`
  (or at the end);
- `remove` → `rows.filter(r => ids.has(idOf(r)).not())`.

The handler captures only data and the author's `onUpdate` function (the capture
rule) and lands in the IR as a closed `Fn([SheetEdit], Null)`. On the paged arm
there is no collection to rebuild; the factory refuses `onUpdate` and the host
routes `onEdit` events to the dataset it pages from.

---

## 5 · Behaviour requirements — the interactive contract

The prototype is the executable specification of these; this table is the
checklist the renderer is built and reviewed against. Each row names where the
behaviour lives and how it is tested.

| # | Requirement (B§) | Lives in | Test |
|---|---|---|---|
| 1 | Date parsing: `+3`/`+3d`, `4d` from `base`, weekday prefix (next occurrence, never today), ISO, `d/m[/yy]`, `d.m`, `17 nov [26]`, year roll-forward; display `17 Nov 26`; edit form `17/11/26`; strip preview `Mon 17 Nov 26` + day span (B§3) | `parse/date.ts` | unit table |
| 2 | Quantity parsing: digits, decimal, `l·k·kl·ml` suffix, commas/spaces ignored, rounded integer; strip preview with the implied run when the driver has a rate (B§3) | `parse/quantity.ts` | unit table |
| 3 | Candidate scoring: prefix (0) → word prefix (1) → initials (2) → substring (3), ties by sheet frequency; only a prefix match ghosts inline; a non-prefix match previews `→ replacement`; empty buffer arms nothing (menu of what the field accepts, driver column ranked by what follows the row above); ⌥]/⌥[/⌥↓/⌥↑ cycle (B§3.1) | `candidates.ts` | unit + DOM |
| 4 | Link grammar: identified codes (case-insensitive, bare digits try the prefix), ranges (`T2140-45`, short upper bound completed; hyphen = range only between unspaced bare numbers), countable by name/alias (leading "the" dropped), countable by attribute (`140kL`, litres ≥ 1 000 read as kL), counted members (`N x kind` / `kind x N`, declared ops, countable kinds only; trailing qualifier → text token; multiplying an identified member → text with reason), `TBC` placeholder, free text (never blocked), separators (B§4.1) | `link/grammar.ts` | unit table |
| 5 | Sides & locks: storage `a > b` / `b` / `a >`; single set = destination; driver `sides` selects live halves (both/from/to/in; `in` draws a minus); locked half never predicted into, Tab skips it, typing allowed but flagged warn (B§4.2) | `link/sides.ts` + `cells/LinkCell.tsx` | unit + DOM |
| 6 | Link display: `minmax(0,1fr) 16px minmax(0,1fr)`; chips mono 10.5 paper-3 r4; meta only for a single chip; dashed = text/placeholder/proposal; FROM/TO faint labels; lock tags warn-tinted when holding content; proposals as dashed chips over the hatch with a ✓ take on hover (B§4.3) | `cells/LinkCell.tsx` + recipe | DOM + shot |
| 7 | Link editor keys: `,` resolves; `>` hops From → To (flag if locked); ⇥ ladder (ghost/armed → one predicted chip → hop → commit right); ⏎ resolves/commits; ⌫ pops last chip / crosses back; ←/→ cross the divider, → takes a ghost word, ⌘→ the whole ghost or every predicted chip; ⇧←/⇧→ select whole chips (brand fill, ⌫ removes); esc cancels, click a half moves the caret, click outside commits (B§4.4) | `Editor.tsx` + `sheet-state.ts` | DOM |
| 8 | Link autocomplete & prediction: candidate order (exact → code prefixes → countables with an enumerate alternative → other prefixes → other countables → placeholder), members never offered twice, a range shows its expansion; prediction only with an empty buffer, per half, never into a locked half, from the column's fill providers (the prototype's history-then-counted order is the author's `[lastTanks, countedByVolume]`); withdrawn once a half has named members; from-only drivers propose into From (B§4.5) | `link/predict.ts` | unit + DOM |
| 9 | Arity: strip meta *n × unit implied · k named so far / named / more than the volume needs* while the arity half is edited; named = identified once, counted by count; text/placeholders do not count (B§4.6) | `link/arity.ts` + `Strip.tsx` | unit + DOM |
| 10 | Copilot runner: rebuilt against the row as it would be, after the kind's latency (150 / 1 100 ms); owned rows untouched; nothing into an occupied slot; first yielding provider wins; provenance in the strip; fills as grey ghosts over the hatch; exactly one next Tab target (dotted underline); ✓ take on hover; gutter → fills the row (⌘⏎); memoised per (row, provisional row, column) (B§5, B§5.1) | `suggest.ts` + `sheet-state.ts` | unit + DOM |
| 11 | Async providers: a pending chip in the strip per in-flight provider; results land reactively; a newer context cancels the wait (latest wins); a rejected or thrown provider is skipped with a console diagnostic naming the column; sync providers never wait on async ones ahead of them in the list beyond the latency window | `suggest-async.ts` | unit (fake timers) + DOM |
| 12 | Proposals: at most `ahead` rows, dashed-topped hatched rows with real numbers; ✓/⏎ adds into the first blank slot, ×/⌫ rejects and remembers the pairing; click selects (3px brand bar); esc deselects then dismisses all; taking re-anchors and looks forward; rejected fills remembered per row and key (B§5.2) | `suggest.ts` + `Rows.tsx` | DOM |
| 13 | Sheet keys: arrows/⇧arrows (↓ on the last row appends, not while a lens is active or a paged source is unexhausted); ⇥/⇧⇥ walk fills → take rows → move; ⏎ takes next suggestion else edits with the value selected; F2; printable char seeds a fresh edit; ⌘⏎ row fill (one undo step); ⌘⇧⏎ everything; esc ladder; ⌫ clears (never stamped) / deletes whole selected rows; ⌘⌫ deletes; click/⇧click/drag/dblclick; ⌘/ and ⌘F focus the rail's search (B§6) | `sheet-state.ts` | transition table + DOM |
| 14 | Commit semantics: Tab, Enter, ↓ (down) / ↑ (stay), blur commit; esc cancels; unparseable keeps the editor open with the neg ring (blur discards); committing a `triggers` column rebuilds the copilot for that row (B§6) | `sheet-state.ts` | DOM |
| 15 | Sheet model: `blanks` padding rows always below the last real row (paged: once the source is exhausted), never removed from under the cursor, not reported/counted/searchable; real row numbers under a lens and for proposals (B§7) | `model.ts` | unit |
| 16 | The lens over the slice: hit = the slice narrowing matches the row (the pure engine over `searchFieldIds` / filters / cohorts); hits keep brand row numbers; count `n matches · m context`; ±0/±1/±3 context; collapsed bands (22px, dashed rule, *n hidden* pill) with hover controls `⌃ +1 · n hidden · +1 ⌄ · all` stepping 1, 3, 10, all from top/bottom/both; reveals are a set of indices so bands merge; a narrowing change resets reveals; no narrowing ⇒ no bands (B§8) | `lens.ts` + `Bands.tsx` | unit + DOM |
| 17 | Views: lenses evaluated live; pinned whole-sheet tab (an empty narrowing) with the planned count; `+ TAB` snapshots the slice state, names from the query (16 chars) or *view n*; active = 2px ink underline; live match counts per view; dirty dot when the slice state differs from the view's, ⏎ updates / esc reverts (writes the snapshot back) / esc on a clean tab returns to the sheet; × (hover neg) or middle-click closes; double-click renames; drag reorders; closing the active tab falls back; leaving persists context + reveals (B§8) | `Tabs.tsx` + `sheet-state.ts` | DOM |
| 18 | Strip states (six) with their label · chips · meta · keys, plus the pending chip; nothing ever floats over the sheet (B§9) | `Strip.tsx` | DOM |
| 19 | Footer: counts · state-sensitive key hint · right-aligned `aria-live` message for every action · the paged transport line (B§9) | `Footer.tsx` | DOM |
| 20 | Clipboard: copy tab-separated, dates `d/m/yyyy`, numbers bare, a link cell as TWO columns; paste lands at the selection appending rows, each cell parsed by its kind (unparseable kept as typed), stamped skipped, a link consumes two cells and joins them; block left selected; suggestions cleared (B§10) | `clipboard.ts` | unit + DOM |
| 21 | Paged arm: windows land on scroll through the Plan's ledger (residency, in-flight `none`, exhaustion on an empty window); the transport line counts source elements; the lens is scope-badged *loaded rows only*; the rail's search is a key search over `seek` when the source is keyed (jump rebases residency); appending needs exhaustion; `onEdit` only | `paging.ts` (adapter over the Plan stack) | DOM (Paged.of fixtures) |
| 22 | Visual rules (B§11) | recipe `sheet.ts` | shot loop |

---

## 6 · Renderer design

`east-ui-components/src/collections/sheet/`. **Hard rule: every React file ≤ ~600–800
lines; split by concern, not by growth.** The prototype's logic class (2 000 lines,
`Sheet Spec.html`) is the port source; its methods map onto pure modules first and
React second. Target layout (line budgets are ceilings):

```
sheet/
  index.tsx              ~300   EastChakraSheet: decode, providers, effect runner, layout (toolbar · header · rows · strip · footer)
  sheet-state.ts         ~500   THE state machine — pure: selection, edit buffer, suggestions, lens, tabs
  sheet-state.test.ts           transition table (esc ladder, Tab ladder, commit directions, tab dirty/revert)
  model.ts               ~200   decoded value → sheet model: real rows + blank padding (exhaustion-aware), column index, driver lookup
  paging.ts              ~150   the paged arm over the Plan stack: paged-window-store · window ledger / residency / reader · use-seek
  parse/date.ts          ~150   B§3 date grammar (UTC, East date tokens for display)
  parse/quantity.ts      ~60
  parse/index.ts         ~80    parse / print dispatch by kind (custom kinds call the compiled East pair)
  candidates.ts          ~120   scored lookup/reference/enum candidates, frequency ties, driver "what follows" ranking
  link/grammar.ts        ~250   classify · ranges · counted members · parseSides · serializeSides · joinSides
  link/predict.ts        ~120   candidate order + empty-buffer prediction per half (from the column's providers)
  link/arity.ts          ~60    implied vs named, the strip meta
  suggest.ts             ~250   the runner: provisional row, latency scheduler, first-yields, memo, rejection memory, proposals
  suggest-async.ts       ~120   in-flight registry, latest-wins cancellation, pending state
  lens.ts                ~150   hits from the slice narrowing (pure slice engine), context bands, reveals, step escalation
  clipboard.ts           ~120   export / paste matrix
  Toolbar.tsx            ~150   tabs · context switch · match count · the slice rail cluster (search / filter / cohort) · scope badge
  Header.tsx             ~100   two-line sticky header
  Rows.tsx               ~250   virtualised rows, gutter (numbers, ✓ × → buttons), bands, proposal rows
  cells/Cell.tsx         ~200   scalar cell by kind: text / mono / num + unit / enum dot / stamped / ghost / proposal hatch / next-target
  cells/LinkCell.tsx     ~250   the split cell: halves, chips, locks, arrow/minus
  Editor.tsx             ~350   the overlay editor: scalar input + ghost, the two-half link editor, error ring
  Strip.tsx              ~200   the docked strip (six states + pending)
  Tabs.tsx               ~200   the view tabs
  Footer.tsx             ~100   counts · key hint · live message · transport line
  sheet.dom.test.tsx            per-behaviour DOM tests (§5)
theme/slot-recipes/sheet.ts ~300 the B§11 vocabulary as recipe slots, light + dark via semantic tokens
```

Reused, not rebuilt: `collections/virtual-rows.tsx` (mixed-height rows — link
cells wrap), the Plan's `paged-window-store.ts` / `window-ledger` / `window-residency`
/ `window-reader` / `use-seek` and the `key-search` component, `slice/use-slice-reactivity`
+ `SliceRailCluster` for the rail and the pure `slice-impl` engine for the lens,
`contracts/density`, `parseCssSize`, the FA solid set, `formatTick` for quantity
display, `formatDatePattern` (East date tokens, UTC) for dates.

### 6.1 The state machine (`sheet-state.ts`)

One pure reducer, no scattered `useState` (the Plan precedent):

```ts
interface SheetUiState {
    sel: Cell; selEnd: Cell | null;                 // 2px ring · range
    edit: EditBuffer | null;                        // { r, c, val, err, hi, side?, groups?, chipSel? }
    sugg: Suggestions | null; armed: Cell | null; gsel: number | null;   // pending fills/rows · next target · selected proposal
    pending: ReadonlySet<ProviderKey>;              // async providers in flight (strip chip)
    hover: Cell | null; hoverGap: string | null;
    lens: { ctx: 0 | 1 | 3; reveal: ReadonlySet<number>; steps: Record<string, number> };   // the query is SLICE state
    tabs: { active: string | null; dirty: boolean; renaming: string | null; renameVal: string };
    msg: string;                                    // the footer's aria-live line
}
type SheetEvent = /* key, cell.down, cell.dbl, editor.change, editor.key, editor.blur, strip.pick, gutter.*, band.*,
                     tab.*, clipboard.copy/paste, suggest.ready, suggest.landed (async), slice.changed, window.landed */;
type SheetEffect =
    | { t: "emit.edit"; edit: SheetEditValue }        // → onEdit (queueMicrotask — the interactive-state pattern)
    | { t: "emit.views"; views: SheetViewValue[] }
    | { t: "emit.select"; sel: SheetSelectionValue }
    | { t: "slice.write"; state: SliceStateValue }    // tab switch / revert — the slice is the source of truth for the query
    | { t: "focus.sheet" } | { t: "focus.search" } | { t: "focus.editor"; side?: 0 | 1; selectAll: boolean }
    | { t: "schedule.suggest"; latencyMs: number } | { t: "cancel.async"; keys: ProviderKey[] }
    | { t: "clipboard.write"; text: string } | { t: "seek"; query: SeekQueryValue };
```

Non-negotiable transition rules (unit-tested as a table):

- **Esc ladder**, one rung per press: editor → chip selection → proposal selection →
  row fill (rows stay) → every suggestion → range → dirty tab revert → clean tab
  returns to the sheet.
- **Tab ladder** (B§4.4 / B§6): inline ghost or armed candidate → one predicted
  chip → hop From → To → commit right; with fills pending and no editor: arm the
  next target, then write it and arm the following.
- **Commit directions** — Tab right, ⇧Tab left, ⏎ / ↓ down (↓ on the last real row
  appends unless a lens is active or the paged source is unexhausted), ↑ / blur
  stay; an unparseable value never commits.
- **Suggestions are ephemeral**: any data change from outside (a new `rows` value,
  a landed window) drops `sugg`, `armed` and cancels in-flight async providers;
  selection survives when its row still exists.
- **The slice owns the query**: the reducer never stores it; `slice.changed`
  recomputes the lens and resets reveals; a tab switch is a `slice.write` effect.
- **Tabs never own rows**: switching a tab persists its lens (context + reveals),
  discards an unsaved narrowing, and clears the range and proposal selection.

### 6.2 The provider runner

The copilot runs *against the row as it would be*. `suggest.ts` builds the
provisional row from the edit buffer (the committed value of the open editor,
computed by the kind's parser), then evaluates the column's providers in order
until one yields, then the proposers in order until one returns rows. Every
provider is a compiled East closure invoked with a `SheetContext` value (rows pass
by reference — East values are immutable). A `sync` arm returns inline; an `async`
arm registers in the in-flight set (`suggest-async.ts`), the strip shows the
pending chip, and its settlement re-enters the machine as `suggest.landed` unless
a newer context superseded it (latest wins, cancelled results dropped). Results
are memoised per `(rowId, provisional-row hash, column)`; the scheduler bounds
calls to one per latency window per row. Owned rows skip the runner entirely.

### 6.3 Rendering pipeline

`decode → paging.ts (resident rows, exhaustion) → model.ts (real rows + blanks,
column index) → lens.ts (hits from the slice state, visible rows + bands) →
VirtualRows(estimateSize by row: 36 min, link cells measured) → Rows`. Toolbar
and header sticky; strip and footer outside the scroll box; the editor overlays its
cell (position: absolute, z 10) and grows with wrapping chips. The whole sheet is
one focusable region (`tabIndex=0`) that owns the keyboard; the editor stops
propagation. Effects run in one place (`runEffects`); `useSliceReactivity(slice.key)`
re-renders on slice writes.

---

## 7 · Visual compliance sheet

Distilled from B§11 and the prototype's inline CSS — the implementation checklist
and the review gate. All numerals `font-mono` with `"tnum" 1`; every colour a
semantic token; dark theme for free.

| Surface | Value |
|---|---|
| Sheet card | `--paper`, 1px `--rule-strong`, radius 10; content `min-width` = gutter + Σ column widths; 120px bottom padding |
| Toolbar row | 8/20 on `--paper`, 1px `--rule-strong` bottom: tabs (left, scrolls) · context switch · `n matches · m context` mono 10.5 `--ink-4` · the slice rail cluster (right; the search pill is the rail's) · scope badge *loaded rows only* (paged) |
| Header | sticky, two lines: label mono 10/600/`.16em` uppercase `--ink-4`; sub mono 9 `--ink-5` ellipsised; 1px `--rule` column dividers; `--rule-strong` bottom |
| Gutter | 80px `--paper-2`; row number mono 10 right-aligned in 26px (`--ink-5`, brand `--brand-d` 600 for hits); 18×18 r-sm action buttons (✓ brand / × rule-strong→neg / → brand); 3px brand-d bar when the row is selected; hover `--paper-3` |
| Rows / cells | min-height 36; padding 6/10; 1px `--rule` bottom and right; text 13 `--ink`; mono values 12 `--ink-2`; ghosts `--ink-4`; unit mono 9.5 `--ink-5`; enum = 6px dot (member tone) + mono 10/600/`.08em` uppercase word |
| Selection | ring `inset 0 0 0 2px var(--brand-d)` at inset −1; range wash `--brand-tint` at .55; editor overlay inset −1, `--paper`, 2px brand-d ring, z 10; parse error ring `--neg` z 11 |
| Proposal | hatch `repeating-linear-gradient(135°, transparent 0 5px, color-mix(brand-d 7%) 5px 6px)`; next-target 1.5px dotted `--brand-d` at bottom 3px; ✓ take 18×18 at right; proposal rows 1px dashed `--rule-strong` top rule |
| Link cell | `minmax(0,1fr) 16px minmax(0,1fr)`; chips mono 10.5 `--ink-2` on `--paper-3`, 1px `--rule`, r-sm, padding 1/4, gap 4; chip meta 9 `--ink-5`; dashed chips 1px dashed `--ink-5` at .85; FROM/TO 8.5/600/`.1em` `--ink-5`; lock tag `--paper-3` r-sm, warn = `--warn` text on 8% warn wash; arrow/minus 10px `--ink-4` on the first 20px line; editor halves 34px min, active-half 1.5px `--brand-d` underline; picked chips `--paper` on `--brand-d` |
| Bands | 22px; 1px dashed `--rule-strong` at 50%; pill mono 9 `--ink-5` on `--paper` 1px `--rule` r-sm; open pill `--shadow-xs`, brand controls with `--brand-tint` hover |
| Strip | `--paper-2` band, 6/20 padding, 1px `--rule` bottom; label mono 9/600/`.13em` uppercase `--brand-d`; chips mono 11 (armed: 600 `--brand-dd` on `--brand-tint` + inset 1px ring at 40%); pending chip = dashed `--rule-strong` with a mono `⋯`; meta mono 10 `--ink-3`; keys mono 9.5 `--ink-5` |
| Footer | 8/20 padding; counts mono 11 `--ink-3`; key hint mono 10 `--ink-5` `.04em`; message mono 10.5 `--ink-2`, `aria-live="polite"`, right-aligned; transport line mono 10 `--ink-4` (paged) |
| Tabs | 30px mono 10.5/600/`.12em` uppercase; active `inset 0 -2px 0 var(--ink)`; counts `--ink-4`; dirty dot 5px `--brand-d`; × 14px `--ink-5` → `--neg`; `+ TAB` 22px r-sm 1px `--rule-strong` mono 9.5/600 |
| Context switch | r-md, options mono 10, active `--brand-tint` `--brand-dd` |
| Icons | FA6 solid: plus, xmark, check, arrow-right-long, minus, angle-up, angle-down (the search glyph is the rail's; the app bar's cloud icons are host chrome) |
| Motion | none beyond hover steps; never lift or scale |

**Verification loop** (mandatory, per the mock-fidelity rule): drive the prototype
and the rendered example through the same headless browser to the same state (the
prototype is scriptable: it is a live page), screenshot both at native zoom, light
and dark, compare side by side and iterate until they match.

---

## 8 · Implementation plan (epic + sub-issues, one branch, one commit / issue)

**P1 — Sheet IR** `collections/sheet/{types,index}.ts`, the `Sheet` arm, the
`<Sheet>` tag (both overloads), the column builders, `Sheet.register` /
`Sheet.members`, `Sheet.arity` / `Sheet.check`, provider and proposer wrapping
(sync / async by the function's type), the `onUpdate` rebuild, the slice chrome
option, build-time checks (§3.12), spec tests, and the examples corpus skeleton:
**`sheetBasic`** (§3.1), **`sheetPlan`** (§3.11 — the flagship: every kind +
registers + copilot + slice lens + views + footer), **`sheetVariants`** (THE
configurator: density, blanks, read-only, height mode, copilot on/off on one live
sheet), **`sheetCopilot`** (every prototype rule as an author function — derive,
history, sequence, default, phrase, capacity, learned follower — plus an async
proposer behind a test platform function, with a `State`-backed provenance log),
**`sheetLens`** (slice search + filter drawn as bands, views), **`sheetWriteBack`**
(raw `onEdit` event log beside `onUpdate`), **`sheetPaged`** (`Paged.of` source,
transport line, key search, `onEdit`), **`sheetStress`** (2 000 rows). Fixtures are
the prototype's synthetic registers and rows, derived East-side where bulk.

**P2 — renderer core** `model.ts`, `paging.ts` over the Plan stack, `parse/*`,
`candidates.ts`, `sheet-state.ts` (+ tests), `Toolbar` (tabs placeholder + rail
cluster), `Header` / `Rows` / `Cell` / `Editor` (scalar), `Strip` (date, quantity and
candidate states), `Footer` (+ transport), clipboard, the `sheet` recipe,
virtualisation, DOM tests incl. paged windows and exhaustion, first shot loop
(basic sheet, editing, selection).

**P3 — registers, the link cell, the strip** `link/*`, `LinkCell`, the two-half
editor, locks, arity, checks, the link strip states, ranges and counted members;
shot loop against the prototype's link rows.

**P4 — the copilot runner** `suggest.ts` + `suggest-async.ts`: provisional row,
latency scheduler, first-yields, memo, pending chip and cancellation, fills
(ghosts, next target, ✓ take, row fill), proposals (rows, accept/reject,
re-anchoring), rejection memory; DOM tests for the Tab and esc ladders and for
async settlement / supersession with fake timers.

**P5 — the lens and the views** `lens.ts` over the slice state, bands and
reveals, the scope badge, key search on the paged arm, the tabs strip with every
tab gesture (snapshot / dirty / revert), `views` / `onViewsChange`; dark pass.

**P6 — docs, skill, release** `east-ui` SKILL.md entry for `<Sheet>` (plugin skill
— coordinate before editing) and the Table-vs-Sheet line in "Picking between
similar components", regenerate the plugin search index (`plugin-artifacts`), the
rendered design card, final side-by-side sign-off against the prototype, epic PR.

Gates every phase: `make build && make test && make lint` in `libs/east-ui`, the
examples↔tests East-code contract, diagnostics clean, shot loop.

---

## 9 · Testing strategy

- **IR spec tests** — column projection per kind (cell tags, blanks as `Null`,
  `owned` stamping) on both arms, register projection (member sets concatenated,
  attrs typed, duplicate keys folded), provider/proposer wrapping (sync vs async by
  function type), the `onUpdate` rebuild (commit / insert / remove over a fixture
  collection, with `Option` fields), the slice chrome envelope, every build-time
  refusal in §3.12.
- **Pure module tests** (the port's guarantee) — date and quantity grammars as
  input→output tables, candidate scoring order, the link grammar table of B§4.1,
  sides/locks/serialisation round trips, arity meta, the lens (hits from a slice
  state, bands, reveals, step escalation), clipboard round trips.
- **`sheet-state.test.ts`** — the transition table: esc and Tab ladders, commit
  directions, suggestion lifecycle incl. async landed / superseded, tab
  dirty/revert/close fallbacks, slice-changed resets.
- **DOM tests** — one per §5 row, driven through the recipe's data attributes
  (`data-selected`, `data-proposed`, `data-next-target`, `data-pending`,
  `data-half="from|to"`, `data-locked`, `data-band`), with the East providers
  compiled through the test platform (async ones behind a fake-timer platform fn),
  and the paged rows through `Paged.of` fixtures (windows, exhaustion, seek).
- **Shots** — prototype vs rendered example, same state, light + dark; goldens in
  the showcase.

---

## 10 · Open questions (proposed resolutions)

| Question | Proposal |
|---|---|
| Async provider policy | Latest wins; no timeout (the strip shows pending indefinitely, and a newer keystroke cancels); a rejected promise is skipped with a diagnostic. A per-provider timeout can be a later `suggest` field. |
| Routing edits on a paged sheet | The host's problem by design (`onEdit` events); the corpus shows an edit journal. A `Data.bindPaged` write path is an e3-ui question, not a Sheet one. |
| Views vs cohorts | A view snapshots the whole slice state (including active cohorts). If a host wants views shared across surfaces, cohorts already are; the two compose. |
| Undo | The prototype has none beyond "row fill is one undo step". v1: none; the host's staged bind is the undo (`discard`). A per-sheet undo stack is renderer-local state and can arrive without an IR change. |
| Column resize / reorder | Not in v1 (widths are config). The Table's header drag can be lifted later. |
| `store: "canonical"` | Declared in the IR, evaluated in P3 (rewrite the committed string to register labels). |
| `check` validators | Author East functions (§3.4), evaluated at commit and on paste; the flag is the lock-warn treatment plus a strip line. Never a block. |
| Narrow / mobile | Out of scope for the sheet; a phone review of a plan is a `<Plan>` or a `<Deck>`. |
| A `types` registry override (B§1 `types`) | Covered by `Sheet.custom` per column; a reusable custom kind is an ordinary TS function returning the config. |
