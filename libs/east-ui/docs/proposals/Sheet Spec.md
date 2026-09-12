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
> **Viewing them.** The three `.html` companions are static files — nothing to build
> or run; open them in a browser. They fetch fonts (and the prototype its React and
> Font Awesome) from CDNs, so they need network. On a dev box without a browser,
> serve the folder and open it from a laptop (the `make design` idea):
>
> ```bash
> cd libs/east-ui/docs/proposals
> for ip in $(hostname -I); do echo "  http://$ip:8765/Sheet%20Behaviour.html"; done   # the LAN URLs to open
> python3 -m http.server 8765                                                          # listens on every interface
> ```
>
> A headless PNG — how `Sheet Spec.png` was captured — needs any Chromium: the one
> `make setup-browser` installs under `~/.cache/ms-playwright` (`~/Library/Caches/`
> on macOS), a system Chrome, or `E3_UI_CHROMIUM_PATH`. The virtual-time budget lets
> the CDN loads finish before the shot; `--window-size` is the capture size, so the
> long Behaviour page (~10 000 px) needs a tall one:
>
> ```bash
> cd libs/east-ui/docs/proposals
> CHROME="${E3_UI_CHROMIUM_PATH:-$(ls ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell | tail -1)}"
> "$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars --virtual-time-budget=20000 \
>     --window-size=1720,1000  --screenshot="Sheet Spec.png"      "file://$PWD/Sheet Spec.html"        # the prototype, resting
> "$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars --virtual-time-budget=20000 \
>     --window-size=1000,10100 --screenshot="Sheet Behaviour.png" "file://$PWD/Sheet Behaviour.html"   # the whole contract
> ```
>
> The prototype and its documents were genericised from a client design to a
> discrete manufacturing plant — work orders moving parts between machines on
> lines — with synthetic registers and rows. Keep every example in this repository
> on that footing — no customer, site, product or upstream-system names, no
> process jargon that would place the plant in an industry, and no operational
> numbers copied from a real plan.

One sheet; typed columns; a copilot. `Sheet` is the planning spreadsheet: a sheet
whose rows are the host's records, whose columns are **typed** (a date, a quantity
with a unit, a register lookup, a directed *link* between register members, a
stamped read-only code), whose blank tail invites the next row, and whose copilot
fills cells and proposes whole rows from rules **the author writes as East
functions** — synchronous ones over the sheet, or asynchronous ones that ask a
model. It is not a `Table`: a Table displays and sorts; a Sheet is typed, edited in
place, padded with blank rows, searched as a *lens* that keeps row numbers, and
completed by a copilot. It borrows the Table's cell primitive and keyed-column config, the row-source
contract (both arms), the slice chrome, sizing and density, and otherwise stands on
its own.

Vocabulary (masthead): **sheet · row · column · kind · register · member · driver ·
link (from → to) · fill · proposal · lens · view · strip**.

Decisions taken with the author on 2026-09-08 and folded in below: the name is
`Sheet`; search runs **through the slice** (the lens draws whatever the slice
narrows); the **paged arm** is designed now; providers are **sync or async**
East functions; there are **no built-in providers** — every fill and proposal is
author code.

And on 2026-09-09: the Sheet follows the **Plan / Table accessor rule** — raw
host rows, an accessor for every per-row fact, `SubtypeExprOrValue` for every
static field, a **typed link value** instead of a string the host would have to
re-parse, and a copilot context typed over the host's row — nothing at the
author's side is addressed by a string name (§1, §3.2–§3.6, §4.8). And from the
review of 2026-09-09: the inline arm is **positional** (keyed sources only when
paged); a column header is **`header`** + `sub`; a Link column is searched through
the slice's **`printFor` text or a `text` projection**; `ctx.row` is rebuilt over
the **real row**; and **`selection`** may be controlled (§3.14).

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
| **What the host owns** | The app bar (title, breadcrumb, sync status — `<App>`), persistence and its mode (autosave = `Data.bind` direct; held-locally = `Data.bind` staged + commit), the autosave toggle, the release/stamping action, the `owned` predicate (data), registers (data), footer counts (expressions over the host's rows), **every copilot rule** (East functions), the slice binding. |
| **Cells are the Table's primitive; links are typed** | A scalar cell is a bare `LiteralValueType` (`Null` is blank): `date` = `DateTime` (UTC midnight); `quantity` = `Float`; `integer` = `Integer`; everything else a `String`. A `set` / `link` cell is a **`Sheet.Types.Link` value** — two arrays of resolved members with a direction — never a string the host has to re-parse; the renderer's grammar (B§4.1) is the kind's parse / print pair (§3.4). The planner's as-typed string (B§4.2) is what the *editor* shows, and a host that wants it stored verbatim sits the column on a `String` field (§3.4). No per-cell UI in the IR (#206). |
| **Rows are the host's structs — positional inline, keyed only when paged** | `data` inline is an `Array<R>`, or a `Data.bind` / `State.bind` handle of one (`data={jobs}` and `data={jobs.read()}` build the same IR), never a `Dict`: a dictionary decodes to a sorted map, so its rows would sit in key order (`j10` before `j2`) instead of the planner's. A **paged source** (`Data.bindPaged`, `Paged.of`) may be positional (`Array<R>` windows; `seek` when the source is sorted by a key) or keyed (`Dict<String, R>` windows in key order — the host designs keys that sort as the sheet should read, and the key is the row id). The factory projects `R` into sheet rows (`id` / `owned` + one cell per column) through the shared row-source contract (#567/#576). Blank padding rows are renderer state, never data. |
| **Accessors and `SubtypeExprOrValue` — the Plan / Table rule** | `data` is the host's raw rows; every per-row fact is an **accessor** returning an expression of the IR field's type (`owned`, a column's `value`, a register's `key` / `label` / `meta` / `tone`, and — over the **driver's row type** — a quantity's `uom` and a link's `sides`); every static field of a declaration (`header`, `sub`, `width`, `accepts`) is `SubtypeExprOrValue` — a literal or an expression. Columns are **builders that take the row type first** — `Sheet.column.date(R, …)`, `Sheet.column.quantity(R, D, …)`, `Sheet.column.link(R, D, register, …)` — the `Plan.series.<kind>(OpsRow, …)` shape, so every accessor inside is typed by `R`, and by `D` (the driver's row type) where the kind reads the driver's row; the `columns` map is checked per key against the row's fields (`SheetColumnSpec<R>`, the `<Table columns>` mapped type). Nothing at the author's side is addressed by a string name — not a driver attribute, not a cell. The names that ARE strings are field KEYS of `R`, typed as such: the `columns` map's keys, `id` (the String field that identifies a row — a name, because the rebuild writes it on an insert), a date column's `base`, and a link column's `to` / `from` naming its other half's field (§3.4). |
| **Search is the slice's; the lens is the Sheet's** | The Sheet takes `slice` chrome like Table / Deck. The rail mounts `search` (and `filter` / `cohort` if listed); the Sheet never narrows — it reads the slice state and draws every non-matching row as a collapsed context band, hits keep their row numbers (B§8). `brush` / `legend` / `breakdown` are refused (no axis, no series). A Link column is searchable like any other: a non-String field named in `searchFieldIds` searches through its `printFor` text, and a field spec may give a `text` accessor for the display form (`Sheet.link.print`) — the Slice change P5 delivers. Without `slice` there is no search and no lens. |
| **Views are slice-state snapshots** | A view saves the slice **narrowing** it was made with (`SliceStateType`) plus the lens's context width and reveals — a lens definition evaluated live (B§8), never a copy of rows. Views persist as data (`views` / `onViewsChange`); switching a tab writes the snapshot into the slice. |
| **Copilot providers are East functions, sync or async, typed over the row** | A column's `fill` is a list of functions from `Sheet.Types.Context(R, D)` — `row: R` as it would be if the open editor committed, `rows: Array<R>`, `driver: Option<D>` — to an optional `Sheet.Types.Fill(T)` of the column's payload; `suggest.propose` is a list of functions to `Sheet.Types.Proposal(R)` rows built with `Sheet.patch(R, …)`. Each may be an `East.function` (runs inline within the kind's latency) or an `East.asyncFunction` (the strip shows a pending chip; the result lands reactively; latest wins). Nothing is built in — "derive", "history", "capacity" and "learned followers" are examples in the corpus, written as author functions (§3.5–§3.6). |
| **Write-back** | `onUpdate` (the whole collection `Array<R>` with the edit applied — the `ValueTree` idiom) on the inline arm; `onEdit` (raw commit / insert / remove events carrying the typed row, `Sheet.Types.Edit(R)`, with provenance) on either arm. `onUpdate` with a paged source is a build-time refusal. |
| **Selection** | Observed through `onSelect`; controlled when `selection` is given (the Table model) — the ring follows the value and the row scrolls into view, so a host list or a deep link can put the planner on a row (§3.14). |
| **No popovers, nothing floats** | B§9: the strip is the only surface for candidates and provenance. The IR embeds no UI (`node`) — `SheetRootType` is a closed struct referenced directly from `component.ts`, like `Calendar` / `Blend`. |
| **Reuse** | the Table's keyed-column config (`SheetColumnSpec<R>` as its mapped type), `LiteralValueType` cells, `RowSourceType` + the Plan's paging stack (`paged-window-store`, window ledger / residency / reader, `use-seek`, `key-search`), `SliceChromeType` + the rail cluster + the slice engine (`sliceMatches` in east-ui's `platform/slice/impl.ts` — what `Slice.apply.matches` and `Slice.partition` run), `shared/reify.ts`, `DensityType`, the `#320` sizing strings, `VirtualRows`, `DensityProvider`, `TickFormatType` for quantity display, the FA icon set, the recipe vocabulary. Not reused: `Table`'s renderer (a sheet is not a `<table>`), `Combobox` / `TagsInput` (the strip replaces every dropdown). |

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
  map typed as `SheetColumnSpec<R>` so a key that is not a data field is a type error,
  and a second overload for the paged arm (the `<Table>` precedent); built as
  `Object.assign(SheetTag, { column, register, link, driver, patch, Types })` so the
  namespace shows on hover, with full TypeDoc and a JSX `@example` mirrored in the
  examples file (`STANDARDS.md`).
- **Namespace** — one object per category, the `Plan.series` / `Plan.at` /
  `Plan.Types` split, so categories never mix as they grow: `Sheet.column.<kind>`
  (the column builders — text · date · quantity · integer · lookup · reference ·
  enum · set · link · stamped · custom), `Sheet.register.members` /
  `Sheet.register.concat`, `Sheet.driver`, `Sheet.link.arity` / `Sheet.link.check` /
  `Sheet.link.parse` / `Sheet.link.print` (the link value's helpers), `Sheet.patch`
  (a row patch — the `Plan.event` kind of value builder), `Sheet.Types.*` (the IR
  types and the `(R, D)` constructors), `Sheet.Root`.

**Behaviour as data.** What crosses the IR is *declaration* (kinds, registers,
provider lists, views, the slice binding); what the renderer owns is *interaction
state* (selection, the edit buffer, pending suggestions, reveals, the active tab).
Nothing in the IR is a snapshot of a transient state, so a `Reactive` re-render
never resets the planner's cursor.

**Typed at the author's side, closed on the wire.** Every author-facing type is a
*constructor* over the host's row type — `Sheet.Types.Context(R, D)`, `Fill(T)`,
`Patch(R)`, `Proposal(R)`, `Edit(R)`, `CheckContext(R)` — the `Plan.Types.Series(R)`
pattern, where the row type lives structurally in a function signature so a
function written for one sheet cannot be handed to another. The IR
(`SheetRootType`) is a closed struct all the same: the factory reifies every
accessor once (Plan's `derive` move, Table's `valueFn`) and bridges each author
function into a closed wire function with compiled decode / encode (§4.8). `R`
and `D` never cross the IR except inside function captures.

---

## 3 · Authoring surface — the DX, by example

`@jsxImportSource @elaraai/east-ui`. Every example below is complete enough to
compile once the factories exist; the flagship (§3.11) is the first example in the
corpus (`sheetPlan`). Fixtures are elided with `…` only where they repeat. The
listings hoist types, fixtures and the typed constructors (`Ctx`, `Proposals`) to
module scope and repeat them per section for reading; in the corpus every example
function is self-contained — types, fixtures and constructors declared once inside
the body, bulk data derived East-side with `East.Array.range` / `generate`, and only
platform declarations (`East.asyncPlatform`) at module scope (the examples rule,
`EXAMPLES_AUTHORING.md` §8).

### 3.1 The smallest sheet

Three typed columns over the host's structs. `id` names the row identity;
`onUpdate` receives the whole collection with the edit applied (the `ValueTree`
idiom), so a `State.bind` — or an e3-ui `Data.bind` — is the entire persistence
story. `data={jobs}` and `data={jobs.read()}` build the same IR: the row-source
resolver reads a `{ read }` handle itself.

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
            { id: "j1", start: none, task: "Machining", qty: none },
        ]));
        return (
            <Sheet
                data={jobs.read()}
                id="id"
                columns={{
                    start: Sheet.column.date(JobType, { header: "Start", sub: "dd / mm / yyyy" }),
                    task:  Sheet.column.text(JobType, { header: "Task" }),
                    qty:   Sheet.column.quantity(JobType, { header: "Qty" }),          // no driver on this sheet — the two-argument form
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

Each kind is a **builder under `Sheet.column`** that takes the row type first —
the `Plan.series.<kind>(OpsRow, …)` shape, the `Slice.config` shape — and returns
a typed column value. The column kinds are one namespace, as Plan's row-series
builders are, so the other categories (`Sheet.register.*`, `Sheet.link.*`,
`Sheet.driver`, `Sheet.patch`, `Sheet.Types.*`) never mix with them (§2). A kind that reads the driver's row (`quantity` for `uom`,
`link` for `sides`) takes the driver's row type second (`quantity` has a
two-argument form for a sheet without a driver); a kind over a register
(`reference` · `enum` · `set` · `link`) names it next — `lookup` names none,
because a lookup column IS the driver column and its register is the driver's. The builder
reifies its accessors once against `R` (and `D`) — Plan's `derive` move — so
`r` and `d` are typed inside the config without any help from the tag. The
`columns` map is then checked per key: `SheetColumnSpec<R>` is a mapped type over
the row's fields (the `<Table columns>` idiom) and each builder's result carries
the field types it may sit on, so a key that is not a field, or a `Sheet.column.date`
under a `String` field, is a type error (§3.12). Static fields — `header`, `sub`
(the grey second header line), `width` (CSS px), `accepts` — are
`SubtypeExprOrValue<StringType>`: a literal or an expression. B§2 calls the
header line `label`; the Sheet says `header`, the `<Table columns>` vocabulary,
and keeps `sub` for the second line — `label` is what a register MEMBER prints. Per-row facts are
accessors: a column's optional `value` (a derived read, the Table's), a link's
`from` / `to` (§3.4), and anything read off the driver's row (`uom`, `sides`)
takes `d`, the typed driver row.

```tsx
columns={{
    start:     Sheet.column.date(PlanRowType, { header: "Start", sub: "dd / mm / yyyy" }),
    end:       Sheet.column.date(PlanRowType, {
                   header: "End", sub: "4d = start+4", base: "start",                // `4d` means start + 4 (B§3)
                   fill: [endFromStart] }),                                          // an author function (§3.5)
    activity:  Sheet.column.lookup(PlanRowType, { header: "Activity", sub: "activity register" }),   // the driver column — its register is `driver`'s (§3.3)
    qty:       Sheet.column.quantity(PlanRowType, ActivityType, {
                   header: "Qty", sub: "uom per activity",
                   uom: d => d.uom,                                                  // an accessor over the DRIVER's row — `d` is typed
                   format: Format.Number({ maximumFractionDigits: 0n }) }),
    notes:     Sheet.column.text(PlanRowType, { header: "Notes", sub: "free text" }),
    stations:  Sheet.column.link(PlanRowType, ActivityType, "stations", { /* §3.4 */ }),
    setups:    Sheet.column.integer(PlanRowType, { header: "Setups", sub: "n" }),
    fromSite:  Sheet.column.reference(PlanRowType, "sites", { header: "From site", sub: "site register" }),
    toSite:    Sheet.column.reference(PlanRowType, "sites", { header: "To site", sub: "site register" }),
    orderCode: Sheet.column.stamped(PlanRowType, { header: "Order code", sub: "stamped on release", owner: "ERP" }),
    status:    Sheet.column.enum(PlanRowType, "statuses", { header: "Status", sub: "erp" }),      // valence dot from the register's `tone` accessor
}}
```

| Kind | Row field | Cell | Payload `T` (fills, parse) | Parse / display (B§3) | Latency |
|---|---|---|---|---|---|
| `text` | `String` / `Option<String>` | `String` | `String` | free text | idle |
| `date` | `DateTime` / `Option<DateTime>` | `DateTime` | `DateTime` | the common date field (`dd / mm / yyyy` segments); pasted text takes `+3d` · `4d` from `base` · weekday · ISO · `d/m[/yy]` · `17 nov` ; display `17 Nov 26` | instant |
| `quantity` | `Float` / `Option<Float>` | `Float` | `Float` | digits + an optional `k` / `m` magnitude suffix (the unit is the column's, never typed), locale-grouped display, unit from the driver | idle |
| `integer` | `Integer` / `Option<Integer>` | `Integer` | `Integer` | as quantity, no unit | instant |
| `lookup` | `String` / `Option<String>` | `String` | `String` | scored register candidates (B§3.1); commit = exact → top → typed | instant |
| `reference` | `String` / `Option<String>` | `String` | `String` | as lookup over a flat member list | instant |
| `enum` | `String` / `Option<String>` | `String` | `String` | upper-cased; non-match clears | instant |
| `set` | `Sheet.Types.Link` · an `Array<Member>` field · `String` | `Link` | `Link` | comma members, the link grammar without an arrow | idle |
| `link` | `Sheet.Types.Link` · two `Array<Member>` fields via `from` / `to` · `String` | `Link` | `Link` | `from > to` — §3.4 | idle |
| `stamped` | `String` / `Option<String>` | `String` | — | never editable; skipped by paste and clear; `—` on a non-blank row | — |
| `custom` | the field's type | its primitive | the field's payload | author's `parse` / `print` — §3.9 | idle |

A field of `Option<X>` is blank when `none`; the payload `T` is always the
*unwrapped* type, so a fill or a parse never says "propose blank". Latency
(B§3) is how long after the last keystroke the copilot is asked again — 150 ms
for deterministic kinds, 1 100 ms for the rest; it is a property of the kind,
not of the provider.

A column with a `value` accessor (`Sheet.column.quantity(PlanRowType, ActivityType, {
value: r => r.qty.multiply(r.factor) })`) is a **derived read**: it displays the
projection and is read-only — the sheet writes fields, never projections. Every
other column sits on its field directly and edits it in place.

### 3.3 Registers and the driver

A register is a list of **members**: a code the grammar resolves, a label the chip
prints, a `kind`, optional aliases, meta, parent and tone — the grammar's
vocabulary and nothing else. `Sheet.register.members` projects the host's rows through
accessors, reified once (Plan's `derive` move); `Sheet.register.concat` joins
member sets of different kinds into one register. There is no attribute bag: a
value another declaration needs is read off a **typed row** by an accessor.
Accessors take `(value, key)`, Plan's rule for keyed data — over a `Dict` register
the key does not repeat inside the value, so `key: (_v, k) => k` is the normal
spelling.

The **driver** is declared once, with its data and therefore its row type `D`:
the `lookup` column it names is parameterised by that row, `uom` and `sides`
accessors take it as `d`, and providers receive it as `ctx.driver` (§3.5).

```tsx
const ActivityType = StructType({ name: StringType, uom: StringType, rate: FloatType, fte: IntegerType, days: IntegerType,
                                  sides: Sheet.Types.Sides });                                  // both | from | to | in
const MachineType  = StructType({ code: StringType, family: StringType, line: StringType, site: StringType });
const LineType     = StructType({ code: StringType, name: StringType, machines: IntegerType, aliases: ArrayType(StringType) });
const FamilyType   = StructType({ name: StringType, aliases: ArrayType(StringType) });
const StatusType   = StructType({ word: StringType, tone: StatusValueType });

// inside the <Reactive> body
const activities = $.const(ACTIVITIES, ArrayType(ActivityType));
const machines   = $.const(MACHINES, ArrayType(MachineType));
const lines      = $.const(LINES, ArrayType(LineType));
const families   = $.const(FAMILIES, ArrayType(FamilyType));
const sites      = $.const(SITES, ArrayType(StringType));
const statuses   = $.const(STATUSES, ArrayType(StatusType));

driver={Sheet.driver("activity", activities, { key: a => a.name, label: a => a.name })}     // D = ActivityType; the tag checks each builder's D against it
registers={{
    stations: Sheet.register.concat([
        Sheet.register.members(machines, { kind: "machine", key: m => m.code, label: m => m.code,
            meta: m => some(m.family), parent: m => some(m.line) }),
        Sheet.register.members(lines, { kind: "line", key: l => l.name, label: l => l.name,
            aliases: l => l.aliases, meta: l => some(East.str`line · ${l.machines}`) }),
        // A countable-by-attribute kind: every distinct family is a member ("CNC lathe"), with the spellings a planner types.
        Sheet.register.members(families, { kind: "family", key: f => f.name, label: f => f.name,
            aliases: f => f.aliases, meta: _f => some("family") }),
    ]),
    sites:    Sheet.register.members(sites, { kind: "site", key: s => s, label: s => s }),
    statuses: Sheet.register.members(statuses, { kind: "status", key: s => s.word, label: s => s.word, tone: s => some(s.tone) }),
}}
```

`driver` names the column and carries the data (B§1): the column must be a
`lookup` on a `String` field, and the factory checks it at build time (the Table
"column has value type X" precedent). An `enum` column reads its register's
`tone` accessor for the valence dot. A register accessor returns the IR field's
type — `meta`, `parent`, `aliases` and `tone` return the `Option` / array the
member stores, so presence is a per-row data fact (the Plan envelope rule).

### 3.4 The link column — members, multiple, sides, arity, checks

A link is a directed hyperedge: two sets of members with a direction the driver
declares (B§4). It is a **typed value**, `Sheet.Types.Link`, and the halves live
on the host's row in one of three ways — chosen by the field's static types (the
#631 rule), never by an option:

```ts
export const SheetMemberType = VariantType({
    identified:  StructType({ key: StringType }),                    // "M2140" — a register code
    range:       StructType({ from: StringType, to: StringType }),   // "M2140-45" — expands through the register
    counted:     StructType({ n: IntegerType, key: StringType }),    // "4 × CNC lathe" — a count of a countable member
    placeholder: NullType,                                           // "TBC" — dashed
    text:        StringType,                                         // anything else — kept as typed, never blocked
});
export const SheetLinkType = StructType({ from: ArrayType(SheetMemberType), to: ArrayType(SheetMemberType) });
// A destination-only link is `from: []`; a source-only link `to: []` — the single-set data of B§4.2 needs no migration.
```

- **(a) a `Sheet.Types.Link` field** — `stations: Sheet.Types.Link` on the row; the column sits on it and edits it in place (the flagship, §3.11).
- **(b) two member-array fields** — the column sits on one (`fromStations: Array<Sheet.Types.Member>`) and names the OTHER half's field (`to: "toStations"`, or `from: "fromStations"` when it sits on the to half); the factory composes the value on read and decomposes it on write. A field name, typed as a key of `R`, because the write needs the field.
- **(c) a `String` field** — the planner's as-typed text (B§4.2: `a > b` · `b` · `a >`); the grammar parses it on read and the commit writes the text verbatim (`store: "asTyped"`) or the canonical labels (`"canonical"`).

`Sheet.link.parse(text, members)` / `Sheet.link.print(link)` are exported East
functions — the kind's parse / print pair (§3.9), resolved against a register's
members (a token that names a key or alias is `identified`, `N x key` is
`counted`, `M2140-45` a `range`, `TBC` the placeholder, anything else `text`) —
so a task can round-trip a legacy string without the renderer.

```tsx
stations: Sheet.column.link(PlanRowType, ActivityType, "stations", {                     // row type · driver row type · register · config
    header: "Work centres", sub: "from → to · 4 x lathe · machine · line", width: "352px",
    // form (b) — the column sits on one member-array field and names the other: `to: "toStations"`; omit for (a) or (c)
    members: [
        { kind: "machine", identified: true },                    // a register code; bare digits try the code prefix
        { kind: "range", identified: true },                      // M2140-45 expands to every member in the span
        { kind: "line", countable: true, resolvesTo: "machine" }, // "2 × Line 2" — a count of a kind, resolved later
        { kind: "family", countable: true, resolvesTo: "machine" },   // "4 × CNC lathe" — countable by attribute
    ],
    multiple: { forms: ["N x kind", "kind x N"], ops: ["x", "X", "*", "×"], appliesTo: "countable" },
    sides: { value: d => d.sides,                                                 // the DRIVER's row: both | from | to | in
             locks: { from: { to: "external", in: "in place" }, to: { from: "external" } } },
    arity: Sheet.link.arity("to", impliedStations),                                    // how many the To half should hold — an East function, below
    check: [Sheet.link.check.exists(), siteMatches],                                   // `exists` is the grammar's own; the rest are author functions
    fill: [lastStations, countedByQuantity],                                      // §3.5
}),
```

The arity rule is domain logic, so it is a function over the typed context
(§3.5): given the row as it would be and the driver's row, how many members are
implied and **which countable member** to propose when none are named (the
`n × CNC lathe` form of B§4.5). The prototype's per-unit switch reads naturally:

```tsx
const Ctx = Sheet.Types.Context(PlanRowType, ActivityType);                       // the typed context — §3.5
const impliedStations = $.const(East.function([Ctx], OptionType(Sheet.Types.Counted), ($, ctx) => {
    const noCount = $.const(none, OptionType(Sheet.Types.Counted));
    const qty = $.let(ctx.row.qty.match({ some: (_$, v) => v, none: _$ => 0.0 }));
    const piecesPerMachine = $.const(300.0);
    // ⌈qty ÷ 300⌉ and round(qty) by hand — `toInteger` refuses a fraction.
    const share = $.let(qty.divide(piecesPerMachine));
    const frac = $.let(share.remainder(1.0));
    const needed = $.let(frac.equal(0.0).ifElse(_$ => share, _$ => share.subtract(frac).add(1.0)).toInteger());
    const half = $.let(qty.add(0.5));
    const whole = $.let(half.subtract(half.remainder(1.0)).toInteger());
    return ctx.driver.match({
        none: _$ => noCount,
        some: (_$, d) => d.uom.equal("lots").ifElse(
            _$ => some({ n: whole, key: "CNC lathe" }),                           // one lot per machine — the quantity IS the count
            _$ => d.uom.equal("pcs").or(() => d.uom.equal("units")).ifElse(
                _$ => qty.greater(0.0).ifElse(
                    _$ => some({ n: needed, key: "CNC lathe" }),
                    _$ => noCount),
                _$ => noCount)),                                                  // hours, cartons, pallets name no machines
    });
}));
```

The strip reads the result while the To half is edited (*4 × CNC lathe implied · 3
named so far*, B§4.6). A `check` returns `some(message)` to flag a member (B§2
`check`); it sees the typed row, the half and the resolved member. `exists` is
the grammar's, the rest are the author's — reading their own data through a
constant the function may capture (the capture rule: data and bind handles,
never a block binding):

```tsx
const CheckCtx = Sheet.Types.CheckContext(PlanRowType);
const machineSites = $.const(MACHINE_SITES, DictType(StringType, StringType));   // code → site
const siteMatches = $.const(East.function([CheckCtx], OptionType(StringType), ($, c) => {
    const noFlag = $.const(none, OptionType(StringType));
    const site = $.let(c.half.match({ from: (_$) => c.row.fromSite, to: (_$) => c.row.toSite }));
    return c.member.match({
        identified: (_$, m) => site.equal("").not()
            .and(() => machineSites.has(m.key))
            .and(() => machineSites.get(m.key).equal(site).not())
            .ifElse(_$ => some(East.str`${m.key} is not at ${site}`), _$ => noFlag),
    }, _$ => noFlag);
}));
```

Typed entry is never blocked (B§4.1 "anything else — text, dashed"); flags are
shown, not enforced. A check that throws flags nothing and logs — the fail-open
rule every author predicate follows (Schematic's `canConnect`): a broken rule can
never block entry.

### 3.5 In-row autocomplete — fill providers are East functions

Every column may carry a list of **fill providers**; the first that yields wins and
its provenance (`meta`) prints in the strip (B§5.1). A provider is an East
function over the **typed context** to an optional fill of the column's payload:

```ts
Sheet.Types.Context(R, D) = StructType({
    rowIndex: IntegerType,          // sheet position among REAL (resident) rows
    row:      R,                    // the row as it would be if the open editor committed — the host's struct
    rows:     ArrayType(R),         // the resident sheet, real rows in sheet order
    partial:  BooleanType,          // true on a paged sheet whose source is not exhausted
    driver:   OptionType(D),        // the driver's row for `row` — typed, no attribute bag
    today:    DateTimeType,         // UTC midnight — so providers stay pure
});
Sheet.Types.Fill(T) = StructType({ value: T, meta: StringType });   // T = the column kind's payload (§3.2)
```

Constructors, not generic wire types — the `Plan.Types.Series(R)` pattern: the
row type lives structurally in the function's signature, so a provider written
for one sheet is refused on another — its payload at compile time, its context
(the row type and the driver type) at build time by the function's East type
(§3.12). `Sheet.Types.Context(R)` on a sheet without a driver makes `driver` an
`Option<Null>`, always `none`. Every rule the prototype hard-codes
— derive, history, sequence, default, phrase, capacity — is a few lines of East
over `ctx.row.start`, `ctx.driver`, `ctx.rows`. Nothing is built in; these are
the corpus examples (`sheetCopilot`):

```tsx
const Ctx = Sheet.Types.Context(PlanRowType, ActivityType);
const DateFill = OptionType(Sheet.Types.Fill(DateTimeType));
const FloatFill = OptionType(Sheet.Types.Fill(FloatType));
const TextFill = OptionType(Sheet.Types.Fill(StringType));
const LinkFill = OptionType(Sheet.Types.Fill(Sheet.Types.Link));

// End = Start + the driver's `days` (the prototype's `derive`).
const endFromStart = $.const(East.function([Ctx], DateFill, ($, ctx) => {
    const noFill = $.const(none, DateFill);
    return ctx.row.start.match({
        none: _$ => noFill,
        some: (_$, start) => ctx.driver.match({
            none: _$ => noFill,
            some: (_$, d) => some({ value: start.addDays(d.days), meta: East.str`+${d.days}d · ${d.name}` }),
        }),
    });
}));

// "Same value as the last row with this driver value" (the prototype's `history`) — ONE East function finds
// the row, and each column's fill reads its own field off it (typed, no key strings).
const lastSimilar = $.const(East.function([Ctx], OptionType(PlanRowType), ($, ctx) => {
    const similar = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) => r.activity.equal(ctx.row.activity)));
    return similar.length().equal(0n).ifElse(
        _$ => East.value(none, OptionType(PlanRowType)),
        _$ => some(similar.get(similar.length().subtract(1n))));
}));
const lastQuantity = $.const(East.function([Ctx], FloatFill, ($, ctx) => {
    const noFill = $.const(none, FloatFill);
    return lastSimilar(ctx).match({
        none: _$ => noFill,
        some: (_$, r) => r.qty.match({ none: _$ => noFill, some: (_$, q) => some({ value: q, meta: East.str`like ${r.id}` }) }),
    });
}));
const lastStations = $.const(East.function([Ctx], LinkFill, ($, ctx) => {
    const noFill = $.const(none, LinkFill);
    return lastSimilar(ctx).match({
        none: _$ => noFill,
        some: (_$, r) => r.stations.from.length().add(r.stations.to.length()).equal(0n).ifElse(
            _$ => noFill, _$ => some({ value: r.stations, meta: East.str`same stations as ${r.id}` })),
    });
}));

// Start: a week after the nearest dated row above; else next Monday (the prototype's `sequence`).
const nextSlot = $.const(East.function([Ctx], DateFill, ($, ctx) => {
    const dated = $.let(ctx.rows.slice(0n, ctx.rowIndex).filter((_$, r) => r.start.hasTag("some")));
    return dated.length().greater(0n).ifElse(
        $ => {
            const last = $.let(dated.get(dated.length().subtract(1n)));
            return some({ value: last.start.unwrap("some").addDays(7n), meta: East.str`week after ${last.id}` });
        },
        $ => {
            const daysToMonday = $.let(East.value(8n).subtract(ctx.today.getDayOfWeek()).remainder(7n));
            const monday = $.let(ctx.today.addDays(daysToMonday.equal(0n).ifElse(_$ => 7n, _$ => daysToMonday)));
            return some({ value: monday, meta: "next Monday" });
        });
}));

// Qty: eight hours at the driver's rate when nothing similar exists (the prototype's `default`).
const shiftQuantity = $.const(East.function([Ctx], FloatFill, ($, ctx) => {
    const noFill = $.const(none, FloatFill);
    return ctx.driver.match({
        none: _$ => noFill,
        some: (_$, d) => some({ value: d.rate.multiply(8.0), meta: East.str`${d.rate}/h × 8 h` }),
    });
}));

// Notes: a phrase per driver family (the prototype's `phrase`).
const phrase = $.const(East.function([Ctx], TextFill, ($, ctx) => {
    const noFill = $.const(none, TextFill);
    const n = $.let(ctx.row.qty.match({
        some: ($2, v) => { const k = $2.let(v.add(0.5)); return k.subtract(k.remainder(1.0)).toInteger(); },   // round by hand — `toInteger` refuses a fraction
        none: _$ => 0n,
    }));
    return ctx.row.activity.startsWith("Machining").ifElse(
        _$ => some({ value: East.str`Machine ${n} P-40 blanks`, meta: "phrasing from past machining runs" }),
        _$ => ctx.row.activity.startsWith("Painting").ifElse(
            _$ => some({ value: East.str`Paint ${n} P-40 housings`, meta: "phrasing from past painting runs" }),
            _$ => noFill));
}));

// Work centres: the counted form from the arity rule (the prototype's `capacity`) — a typed Link value, not a string.
const countedByQuantity = $.const(East.function([Ctx], LinkFill, ($, ctx) => {
    const noFill = $.const(none, LinkFill);
    const noMembers = $.const([], ArrayType(Sheet.Types.Member));
    return impliedStations(ctx).match({
        none: _$ => noFill,
        some: (_$, c) => some({ value: { from: noMembers, to: [variant("counted", { n: c.n, key: c.key })] },
                                meta: "capacity · from the quantity" }),
    });
}));

columns={{
    start:    Sheet.column.date(PlanRowType, { header: "Start", fill: [nextSlot] }),
    end:      Sheet.column.date(PlanRowType, { header: "End", base: "start", fill: [endFromStart] }),
    qty:      Sheet.column.quantity(PlanRowType, ActivityType, { header: "Qty", uom: d => d.uom, fill: [lastQuantity, shiftQuantity] }),   // first that yields wins
    notes:    Sheet.column.text(PlanRowType, { header: "Notes", fill: [phrase] }),
    stations: Sheet.column.link(PlanRowType, ActivityType, "stations", { /* … */ fill: [lastStations, countedByQuantity] }),
}}
```

A provider's payload is checked against its column's kind at compile time: a
`DateFill` function under `qty` is a type error (§3.12). An **async** fill is the
same signature as an `East.asyncFunction`; the renderer shows a pending chip in
the strip for that column and lands the result when it arrives (§6.2). Contract
(B§5): providers run against the row *as it would be if the open editor
committed*, after the kind's latency; owned rows are never touched; nothing is
proposed into an occupied cell; exactly one cell is the next Tab target; a
rejected fill is remembered per row and key. On a paged sheet `ctx.rows` is the
**resident** prefix and `ctx.partial` is true — a provider that reasons over
history should say so in its `meta`.

`ctx.row` is the **real row**: the bridge (§4.8) finds the source row by id —
through the bound handle on the inline arm, through the source's `page` at the
row's offset on the paged arm — and overlays the declared columns' cells (the open
editor's value included), so a field of `R` that has no column (`createdBy`,
`version`) reads its true value in every provider, check, `onEdit` event and
patch. Only a row not yet in the source — a proposal being taken, a paste's new
rows — starts from the row type's default value.

### 3.6 Multi-row autocomplete — proposers are East functions

Row proposals are the same idea one level up: a **proposer** maps the typed
context to zero or more proposed rows with a provenance line. A proposed row is a
**patch** — `Sheet.patch(R, { … })` names the fields it sets and leaves the rest
blank, the way `Plan.event({ … })` builds an element: an expression builder,
typed by `R`, omitted fields `none`. The first proposer that returns rows wins.
Three shapes cover the prototype and beyond: a domain pattern, a learned
follower, and a model call.

```ts
Sheet.Types.Patch(R)    = StructType({ [each field f of R]: OptionType(R[f]) });   // none ⇒ left blank; the runner writes only the fields with editable columns
Sheet.Types.Proposal(R) = StructType({ patch: Sheet.Types.Patch(R), meta: StringType });
```

`Sheet.patch`'s input is the literal-record form of `R`'s editable fields —
`{ [f]?: SubtypeExprOrValue<R[f]> }`, Plan's `PlanRecordInput` shape — so a field
takes a literal or an expression and an omitted one is `none`.

```tsx
const Proposals = ArrayType(Sheet.Types.Proposal(PlanRowType));

// 1 · A domain pattern: a roughing run is followed by an inspection of its lots on the same days
//     and a finishing pass at end +3…+7 d.
const roughingFollowUps = $.const(East.function([Ctx], Proposals, ($, ctx) => {
    const empty = $.const([], Proposals);
    const n = $.let(impliedStations(ctx).match({ some: (_$, c) => c.n, none: _$ => 1n }));   // reuse the arity rule
    return ctx.row.activity.equal("Machining - Roughing").and(() => ctx.row.end.hasTag("some")).ifElse(
        $ => {
            const endAt = $.let(ctx.row.end.unwrap("some"));
            return $.const([
                { patch: Sheet.patch(PlanRowType, {
                      activity: "Inspection", start: ctx.row.start, end: ctx.row.end,
                      qty: some(n.toFloat()), notes: East.str`Inspect ${n} roughing lots` }),
                  meta: "inspection · same days" },
                { patch: Sheet.patch(PlanRowType, {
                      activity: "Machining", start: some(endAt.addDays(3n)), end: some(endAt.addDays(7n)),
                      qty: ctx.row.qty, notes: "Finish the roughed blanks" }),
                  meta: "finishing pass · end +3…+7 d" },
            ], Proposals);
        },
        _$ => empty);
}));

// 2 · Learned from the sheet: what followed this activity last time, after how long (B§5.2).
const lastFollower = $.const(East.function([Ctx], Proposals, ($, ctx) => {
    const empty = $.const([], Proposals);
    const dated = $.let(ctx.rows.filter((_$, r) => r.start.hasTag("some").and(() => r.activity.equal("").not())));
    const n     = $.let(dated.length());
    const upper = $.let(n.greater(1n).ifElse(_$ => n.subtract(1n), _$ => 0n));
    // consecutive pairs (this activity → a different one), in sheet order
    const pairs = $.let(East.Array.range(0n, upper).filter((_$, i) =>
        dated.get(i).activity.equal(ctx.row.activity).and(() => dated.get(i.add(1n)).activity.equal(ctx.row.activity).not())));
    return pairs.length().equal(0n).or(() => ctx.row.activity.equal("")).or(() => ctx.row.start.hasTag("some").not()).ifElse(
        _$ => empty,
        $ => {
            const i     = $.let(pairs.get(pairs.length().subtract(1n)));
            const from  = $.let(dated.get(i));
            const next  = $.let(dated.get(i.add(1n)));
            const gapMs = $.let(next.start.unwrap("some").toEpochMilliseconds()
                                .subtract(from.start.unwrap("some").toEpochMilliseconds()));
            const at    = $.let(ctx.row.start.unwrap("some").addMilliseconds(gapMs));
            return $.const([{
                patch: Sheet.patch(PlanRowType, { activity: next.activity, start: some(at), qty: next.qty, notes: next.notes }),
                meta: East.str`${next.activity} followed ${ctx.row.activity} last time · +${gapMs.divide(86400000n)}d`,
            }], Proposals);
        });
}));

// 3 · A model: an ASYNC proposer that awaits a platform function the host implements
//     (an e3 function behind it, a service, a notebook — the Sheet only needs the types).
const recommend = East.asyncPlatform("plan_recommend", [Ctx], Proposals);   // module scope
const modelProposals = $.const(East.asyncFunction([Ctx], Proposals, (_$, ctx) => recommend(ctx)));

suggest={{
    ahead: 2n,                                                   // at most two proposed rows below the anchor (B§5.2)
    triggers: ["activity", "start", "end", "qty", "notes", "stations"],
    propose: [roughingFollowUps, modelProposals, lastFollower],      // first that returns rows wins
}}
```

What the renderer does with a proposal (B§5.2): renders it as a dashed-topped,
hatched row under the anchor with a real row number; ✓ / ⏎ adds it (into the first
blank slot rather than pushing the sheet), × / ⌫ rejects it and remembers the
driver pairing so it is not offered again; taking a row re-anchors and asks the
proposers again, so the next one is already waiting. While an async proposer is
in flight the strip shows *suggested · ⋯* with the provider's position; a newer
context cancels the wait (latest wins). Fields a patch leaves `none` are blank;
the copilot then fills them like any other row.

### 3.7 Write-back — `onUpdate` or `onEdit`; staged or direct

Two channels, both optional, both East functions:

- **`onUpdate: (rows: Array<R>) => Null`** — inline arm only. The whole collection
  with the edit applied; the factory compiles it into an edit handler that rebuilds
  the host's structs (a commit rewrites one field of one row, an insert appends a
  fresh row from the row type's default value with the id and cells applied, a
  remove filters ids). Requirements, checked at build time: `id` is a `String`
  field and every editable column is a field whose type matches the kind (§3.2).
- **`onEdit: (edit: Sheet.Types.Edit(R)) => Null`** — either arm. The raw event, typed
  over the host's row: `commit { rowId, key, row: R, source }` (the row *after* the
  commit) · `insert { afterRowId, row: R, source }` · `remove { rowIds }`, with
  `source ∈ typed · pasted · fill · row · pattern` so a host can measure copilot
  uptake (B§1). A paste arrives as its commits and inserts in order. On a paged
  sheet this is the only channel — the host routes edits to the dataset it pages
  from (§3.13). The factory bridges the typed function to the wire (§4.8).

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
            <Sheet data={plan.read()} id="id" columns={…} registers={…} driver={…}
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
    fields: { activity: { label: "Activity" }, notes: { label: "Notes" }, status: { label: "Status" },
              stations: { label: "Work centres", text: r => Sheet.link.print(r.stations) } },   // a Link, searched by its display text
    searchFieldIds: ["activity", "notes", "stations"],
});
const slice = $.let(Slice.bind([PlanRowType], "plan.slice", cfg, Slice.state(), rows, none));

<Sheet … slice={slice} affordances={["search", "filter"]} />
```

Search over a non-String field goes through its `printFor` text by default — for a
link, `(from=[.identified (key="M2140")], to=[.counted (n=4, key="CNC lathe")])`, so
`M2140` and `CNC lathe` hit but the display form `4 x CNC lathe` misses and the `.east`
field names match every row — which is why a field spec may name a `text`
projection: `Sheet.link.print` renders the grammar's display form, `M2140 > 4 x CNC
lathe`. Both landed with P5 as the Slice's `text` field kind: `Slice.config` makes any
non-primitive field a search-only `text` field (its `.east` print, or the `text`
accessor), `sliceMatches` searches it through the projection, and `slice.fields()`
never lists it — a text field has no operator set, so it is searched, never filtered.

**How the lens matches (as built).** The renderer never sees `R`, so it rebuilds a
host-shaped record from each wire row — every column's cell decoded to its field's
value by the column's static type: a bare primitive as is, an `Option` wrapped, a
`Link` as the link value a `text` projection expects — and hands it to the slice
engine's `sliceMatches` with the bound slice's live config. The rule that follows: **a
field the slice narrows on must be a column of the sheet**; a field without a column
reads as blank to the lens. On the paged arm the lens covers the resident rows (the
*loaded rows only* badge) and the rail's search is the key search over `seek`.

A **view** is a slice-state snapshot plus the lens's context and reveals — a tab
that is evaluated live, so a new matching row joins it and an edit anywhere
writes to the sheet (B§8). Views are data on the sheet's bind; switching a tab
writes its narrowing into the slice, `+ TAB` snapshots the current one, ⏎ updates
a dirty tab, esc reverts it. `activeView` names the tab the sheet opens on (and is
followed when the host moves it); the tabs themselves are renderer state, and every
change to the views — a snapshot, an update, a rename, a reorder, a close, a leaving
tab's context and reveals — reaches the host through `onViewsChange` while landing
locally at once (the interactive-state pattern).

```tsx
const views = $.let(State.bind([ArrayType(Sheet.Types.View)], "plan.views", [
    { id: "painting", name: "PAINTING", narrowing: Slice.state({ search: some("painting") }), context: 1n, reveals: [] },
]));
<Sheet … slice={slice} affordances={["search"]} views={views.read()} onViewsChange={views.write} activeView={some("painting")} />
```

Without `slice` there is no search box, no lens and no tabs — the sheet is whole.

### 3.9 Custom column kinds

A kind the registry lacks is an East pair over the **field's own payload**:
`parse` (typed text → payload, `none` = unrecognised, which keeps the editor open
with the neg ring) and `print` (payload → display text). `accepts` is the strip's
"what this field accepts" line. The built-in kinds are the same pair with the
renderer's grammar behind them (`Sheet.link.parse` / `Sheet.link.print`, §3.4).

```tsx
// A shift code: "A", "B", "N" (night); the row field is `shift: OptionType(StringType)`, so the payload is String.
const parseShift = $.const(East.function([StringType, Ctx], OptionType(StringType), ($, text, _ctx) => {
    const t = $.let(text.trim().upperCase());
    return t.equal("A").or(() => t.equal("B")).or(() => t.equal("N")).ifElse(
        _$ => some(t), _$ => East.value(none, OptionType(StringType)));
}));
const printShift = $.const(East.function([StringType], StringType, (_$, s) => East.str`shift ${s}`));

shift: Sheet.column.custom(PlanRowType, { header: "Shift", accepts: "A · B · N", parse: parseShift, print: printShift, fill: [lastShift] }),
```

The payload type is read off the field (§3.12): a `parse` whose output is not
`Option<payload>` is a compile error, and the factory inspects the function's
East output type as a second gate (the Table `value` rule). A `parse` that throws
reads as unrecognised (the neg ring) and logs — fail-open, never a stuck editor.

### 3.10 Host chrome — footer counts, sync status, stamping

Footer counts are the host's expressions over the host's rows (B§7); the sync line
and the release action live in the app bar; a release (the stamping of order codes)
is an ordinary bound function whose result is written back, after which the sheet
shows the stamped codes read-only and the rows as owned:

```tsx
const rows = $.let(plan.read());
const planned   = $.let(rows.filter((_$, r) => r.activity.length().greater(0n)).length());
const ready     = $.let(rows.filter((_$, r) => r.activity.length().greater(0n).and(() => r.start.hasTag("some"))
                                       .and(() => r.qty.hasTag("some")).and(() => r.orderCode.length().equal(0n))).length());
const cancelled = $.let(rows.filter((_$, r) => r.status.equal("CANCELLED")).length());

<Sheet …
    owned={r => r.orderCode.length().greater(0n).or(() => r.status.equal("CANCELLED"))}
    footer={[{ text: East.str`${planned} planned · ${ready} ready to release · ${cancelled} cancelled` }]}
/>
```

### 3.11 The flagship — everything together (`sheetPlan`)

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, some, none, variant } from "@elaraai/east";
import { Format, Reactive, Sheet, Slice, State, StatusValueType, UIComponentType } from "@elaraai/east-ui";

const PlanRowType = StructType({
    id: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType), activity: StringType,
    qty: OptionType(FloatType), notes: StringType, stations: Sheet.Types.Link, setups: OptionType(IntegerType),
    fromSite: StringType, toSite: StringType, orderCode: StringType, status: StringType,
});
// ActivityType / MachineType / LineType / FamilyType / StatusType as in §3.3; PLAN_ROWS / ACTIVITIES / MACHINES /
// LINES / FAMILIES / SITES / STATUSES / MACHINE_SITES are the synthetic fixtures the prototype ships with.
const Ctx = Sheet.Types.Context(PlanRowType, ActivityType);
const Proposals = ArrayType(Sheet.Types.Proposal(PlanRowType));
const recommend = East.asyncPlatform("plan_recommend", [Ctx], Proposals);

export const sheetPlan = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const plan  = $.let(State.bind([ArrayType(PlanRowType)], "plan.rows", PLAN_ROWS));
        const views = $.let(State.bind([ArrayType(Sheet.Types.View)], "plan.views", []));
        const rows  = $.let(plan.read());
        const activities = $.const(ACTIVITIES, ArrayType(ActivityType));
        const machines = $.const(MACHINES, ArrayType(MachineType));
        const lines = $.const(LINES, ArrayType(LineType));
        const families = $.const(FAMILIES, ArrayType(FamilyType));
        const sites = $.const(SITES, ArrayType(StringType));
        const statuses = $.const(STATUSES, ArrayType(StatusType));
        const cfg = Slice.config(PlanRowType, {
            fields: { activity: { label: "Activity" }, notes: { label: "Notes" }, status: { label: "Status" },
                      stations: { label: "Work centres", text: r => Sheet.link.print(r.stations) } },
            searchFieldIds: ["activity", "notes", "stations"],
        });
        const slice = $.let(Slice.bind([PlanRowType], "plan.slice", cfg, Slice.state(), rows, none));
        // impliedStations, siteMatches (§3.4) · endFromStart, lastSimilar, lastQuantity, lastStations, nextSlot, shiftQuantity,
        // phrase, countedByQuantity (§3.5) · roughingFollowUps, lastFollower, modelProposals (§3.6)
        const planned = $.let(rows.filter((_$, r) => r.activity.length().greater(0n)).length());

        return (
            <Sheet
                data={rows}
                id="id"
                owned={r => r.orderCode.length().greater(0n).or(() => r.status.equal("CANCELLED"))}
                driver={Sheet.driver("activity", activities, { key: a => a.name, label: a => a.name })}
                registers={{ /* stations · sites · statuses — §3.3 */ }}
                columns={{
                    start:     Sheet.column.date(PlanRowType, { header: "Start", sub: "dd / mm / yyyy", width: "96px", fill: [nextSlot] }),
                    end:       Sheet.column.date(PlanRowType, { header: "End", sub: "4d = start+4", width: "96px", base: "start", fill: [endFromStart] }),
                    activity:  Sheet.column.lookup(PlanRowType, { header: "Activity", sub: "activity register", width: "214px" }),
                    qty:       Sheet.column.quantity(PlanRowType, ActivityType, {
                                   header: "Qty", sub: "uom per activity", width: "112px", uom: d => d.uom,
                                   format: Format.Number({ maximumFractionDigits: 0n }), fill: [lastQuantity, shiftQuantity] }),
                    notes:     Sheet.column.text(PlanRowType, { header: "Notes", sub: "free text", width: "250px", fill: [phrase] }),
                    stations:  Sheet.column.link(PlanRowType, ActivityType, "stations", {
                                   header: "Work centres", sub: "from → to · 4 x lathe · machine · line", width: "352px",
                                   members: [{ kind: "machine", identified: true }, { kind: "range", identified: true },
                                             { kind: "line", countable: true, resolvesTo: "machine" },
                                             { kind: "family", countable: true, resolvesTo: "machine" }],
                                   multiple: { forms: ["N x kind", "kind x N"], ops: ["x", "X", "*", "×"], appliesTo: "countable" },
                                   sides: { value: d => d.sides, locks: { from: { to: "external", in: "in place" }, to: { from: "external" } } },
                                   arity: Sheet.link.arity("to", impliedStations),
                                   check: [Sheet.link.check.exists(), siteMatches],
                                   fill: [lastStations, countedByQuantity] }),
                    setups:    Sheet.column.integer(PlanRowType, { header: "Setups", sub: "n", width: "64px" }),
                    fromSite:  Sheet.column.reference(PlanRowType, "sites", { header: "From site", sub: "site register", width: "112px" }),
                    toSite:    Sheet.column.reference(PlanRowType, "sites", { header: "To site", sub: "site register", width: "112px" }),
                    orderCode: Sheet.column.stamped(PlanRowType, { header: "Order code", sub: "stamped on release", owner: "ERP", width: "104px" }),
                    status:    Sheet.column.enum(PlanRowType, "statuses", { header: "Status", sub: "erp", width: "124px" }),
                }}
                suggest={{ ahead: 2n, triggers: ["activity", "start", "end", "qty", "notes", "stations"],
                           propose: [roughingFollowUps, modelProposals, lastFollower] }}
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
| A column key that is not a field of the row struct | compile time — `SheetColumnSpec<R>` is a mapped type over the row's fields, excess-property checked at the tag (the `<Table columns>` precedent) |
| `Sheet.column.date(R, …)` under a `String` field, `Sheet.column.quantity(R, D, …)` under an `Integer` field, `Sheet.column.link(R, D, …)` under a field that is not a `Link`, a `String`, or paired with `from` / `to` member arrays | compile time — each builder's result carries the field types it may sit on; the mapped type rejects the rest |
| A column built over one row type placed on a sheet over another | compile time — the builder's `R` is part of its result type, and the `columns` map checks it against `data` |
| A `uom` / `sides.value` accessor whose `d` is not the `driver`'s row type | build time — the column was built with an explicit `D`; the root refuses one that is not the driver's |
| A `fill` / `propose` / `arity` / `check` / custom `parse` function over another sheet's context — another row type or driver type | build time — the function's East input type must be this sheet's `Sheet.Types.Context(R, D)` (interned type identity); the refusal names the column and the function |
| A `lookup` column that is not the driver column | build time — "a lookup column is the driver column; declare `driver`, or use `Sheet.column.reference`" |
| A `fill` whose payload is not the column's (a `DateFill` under `qty`), a `propose` entry that is not `Fn([Context(R, D)], Array<Proposal(R)>)`, a `parse` whose output is not `Option<payload>` | compile time (`SubtypeExprOrValue<FunctionType<…>>` / `AsyncFunctionType<…>` over the constructors' types), and again at build time by the function's East output type |
| A `Sheet.patch(R, …)` naming a field that is not editable (stamped, a `value`-projected column, no column at all) | never an error — `Patch(R)` spans every field of `R`; the runner writes only the fields with editable columns and ignores the rest |
| An `onUpdate` whose editable columns are not plain fields (or whose `id` is not a `String` field) | build time — the factory names every offending column |
| `onUpdate` on a paged source | build time — "the whole-value rebuild needs the whole collection; use `onEdit`" |
| A keyed `Dict` collection on the inline arm | build time — "a dictionary's rows sit in key order, not the planner's — pass an `Array<R>`, or page a keyed source" |
| The `driver` column is not a `lookup` on a `String` field; an unknown register name | build time |
| A `custom` column whose `parse` output type does not match the field | build time (the function's East output type is inspected, the Table `value` rule) |
| `brush` / `legend` / `breakdown` affordances | build time — refused with the reason |

Every build-time refusal names the offending column and the remedy in its message
— the Table precedent ("`groupBy` cannot be combined with a paged source … group
upstream, or bind the whole value").

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
const applyEdit = $.const(East.function([Sheet.Types.Edit(PlanRowType)], NullType, ($, e) => {
    $(edits.write(edits.read().concat([e])));                                // the host's edit journal, replayed server-side
}));
<Sheet data={source} id="id" columns={…} registers={…} driver={Sheet.driver("activity", activities, { key: a => a.name, label: a => a.name })}
       slice={slice} affordances={["search"]} onEdit={applyEdit} style={{ height: "fill" }} />
```

### 3.14 Selection — observed, or controlled

`onSelect` reports every move of the ring (`{ rowId, key }`). Give `selection` as
well and the sheet is **controlled** (the Table model): the ring follows the value,
the row scrolls into view, and every move still reports through `onSelect` — so a
host list, a deep link or a "next exception" button can put the planner on a row.
On the paged arm a controlled `rowId` outside the resident windows seeks it when
the source can seek. Absent, selection is renderer state.

```tsx
const sel = $.let(State.bind([OptionType(Sheet.Types.Selection)], "plan.sel", none));
const jumpTo = $.const(East.function([StringType], NullType, ($, id) => {
    $(sel.write(some({ rowId: some(id), key: some("activity") })));
}));
<Sheet … selection={sel.read()} onSelect={(_$, s) => sel.write(some(s))} />
```

---

## 4 · IR design

Everything below lives in `east-ui/src/collections/sheet/` (`types.ts` UIComp-free;
`index.ts` the factories + namespace). The root struct is referenced *directly* by
the `Sheet` arm of `UIComponentType` — no `node`, no hand-synced inline copy.

### 4.1 Rows and cells

```ts
export const SheetLinkType = StructType({ from: ArrayType(SheetMemberType), to: ArrayType(SheetMemberType) });   // §3.4
export const SheetCellType = VariantType({                        // the Table cell (#206) plus the typed link
    Null: NullType, Boolean: BooleanType, Integer: IntegerType, Float: FloatType, String: StringType, DateTime: DateTimeType,
    Link: SheetLinkType,
});
export const SheetRowType = StructType({
    id:    StringType,
    owned: BooleanType,                                        // stamped by the `owned` accessor; no copilot, stamped columns read-only
    cells: DictType(StringType, SheetCellType),                // one entry per declared column, always present
});
export const SheetRowsCollectionType = ArrayType(SheetRowType);
export const SheetRowsType = RowSourceType(SheetRowsCollectionType);   // inline OR paged (#576) — both arms accepted
```

The wire row is **closed**: the factory projects `R` into cells through the
columns' reified accessors (a plain field, a `value` projection, a link's
`from` / `to` composition, a `String` link parsed by `Sheet.link.parse`), exactly as the
Table's `valueFn` move and Plan's `derive`. The inline arm is **positional** —
`Array<R>` only, the Table rule: a `Dict` inline is refused at build time ("a
dictionary's rows sit in key order, not the planner's — pass the array, or page a
keyed source"). The paged arm takes a positional source or a keyed one
(`Dict<String, R>` windows): there the key is the row id (the `id` accessor may be
omitted) and canonical key order is the sheet order, which is what makes `seek`
address real rows. The factory's `make` projects a window exactly as it projects
the whole collection (`buildRowSource`; no `idSuffix` — a sheet's `make` is fixed
per build, unlike a Plan narrowed by a pick), so the renderer sees one row space.
`R` itself never appears in the IR — see §4.8. A blank cell (`Null`) decodes
to `none` on an `Option` field and to the type's default value on a bare one
(`""`, `0`, `0.0`, the epoch) — a bare field has no blank.

### 4.2 Registers and the driver

```ts
export const SheetMemberType = VariantType({ identified: …, range: …, counted: …, placeholder: NullType, text: StringType });   // §3.4
export const SheetRegisterMemberType = StructType({
    key:     StringType,                     // what the grammar resolves ("M2140", "Line 2", "CNC lathe")
    label:   StringType,                     // what a chip prints
    kind:    StringType,                     // "machine" | "line" | "family" | "activity" | "site" | …
    aliases: ArrayType(StringType),          // "the 2 line", "lathe", "120t"
    meta:    OptionType(StringType),         // chip meta ("CNC lathe", "line · 96"); shown when a half holds one chip
    parent:  OptionType(StringType),         // a machine's line — countable → identified resolution and "enumerate"
    tone:    OptionType(StatusValueType),    // an enum member's valence dot
});
export const SheetRegisterType = StructType({ members: ArrayType(SheetRegisterMemberType) });
export const SheetDriverType   = StructType({ column: StringType, members: ArrayType(SheetRegisterMemberType) });
```

No attribute bag: what a declaration needed from a driver row (`uom`, `sides`)
is read by an accessor at build time and stored **per driver key** on the column
that needs it (§4.3); what a provider needs (`ctx.driver`) is the typed row,
looked up inside the bridge (§4.8).

### 4.3 Column kinds

`types.ts` declares §4.4's context types before these — `SheetArityType` and the
`custom` kind take them; the order here is for reading.

```ts
export const SheetHalfType       = VariantType({ from: NullType, to: NullType });
export const SheetSidesValueType = VariantType({ both: NullType, from: NullType, to: NullType, in: NullType });   // Sheet.Types.Sides
export const SheetStoreType      = VariantType({ asTyped: NullType, canonical: NullType });
export const SheetMemberKindType = StructType({ kind: StringType, identified: BooleanType, countable: BooleanType, resolvesTo: OptionType(StringType) });
export const SheetMultipleType   = StructType({ forms: ArrayType(StringType), ops: ArrayType(StringType), appliesTo: StringType });
export const SheetSideLockType   = StructType({ half: SheetHalfType, when: SheetSidesValueType, label: StringType });
export const SheetSidesType      = StructType({ byDriver: DictType(StringType, SheetSidesValueType),   // the `sides.value` accessor applied over the driver data
                                                locks: ArrayType(SheetSideLockType) });
export const SheetCountedType    = StructType({ n: IntegerType, key: StringType });                     // "4 × CNC lathe"
export const SheetArityType      = StructType({ half: SheetHalfType, implied: FunctionType([SheetContextType], OptionType(SheetCountedType)) });
export const SheetCheckContextType = StructType({ rowIndex: IntegerType, row: DictType(StringType, SheetCellType), half: SheetHalfType, member: SheetMemberType });
export const SheetCheckType      = VariantType({ exists: NullType, custom: FunctionType([SheetCheckContextType], OptionType(StringType)) });

export const SheetColumnKindType = VariantType({
    text:      NullType,
    date:      StructType({ base: OptionType(StringType), format: OptionType(StringType) }),    // `base`: the column relative entry counts from
    quantity:  StructType({ uom: OptionType(DictType(StringType, StringType)),                   // driver key → unit label (the `uom` accessor, applied)
                            format: OptionType(TickFormatType) }),
    integer:   NullType,
    lookup:    StructType({ register: StringType }),                                             // the driver column names the driver's register
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
    key: StringType, header: StringType, sub: OptionType(StringType), width: OptionType(StringType),
    kind: SheetColumnKindType,
    dataType: EastTypeType,                                  // the row field's static type (Table precedent)
    payloadType: EastTypeType,                               // the kind's payload (a custom kind's primitive) — the renderer parses / prints without the host types
    editable: BooleanType,                                   // false for stamped, for a `value` projection, or by option
    fill: ArrayType(SheetProviderType),                      // first provider that yields wins; sync or async
});
```

String-literal shorthands ride every variant field, the Plan / Table rule:
`SheetHalfLiteral = "from" | "to"`, `SheetSidesLiteral = "both" | "from" | "to" |
"in"`, `SheetStoreLiteral = "asTyped" | "canonical"`, `SheetSourceLiteral` for
provenance; every TS face takes `SubtypeExprOrValue<T> | Literal`, and the
factory resolves it with Plan's `resolveTag`.

Every function stored here takes the **closed** context / cell types: the
author's typed functions are bridged into these by the factory (§4.8). The
accessors that read the driver row (`uom`, `sides.value`) are not stored at all —
the builder reifies them once against `D` (`Fn([D], String)`, `Fn([D], Sides)`),
the root applies them over the driver data, and they land as dictionaries keyed
by the driver member's key: the Plan rule that accessors are reified at build
time and the wire carries data.

### 4.4 The copilot

```ts
export const SheetContextType = StructType({                 // the WIRE context — the bridge rebuilds `R` / `D` from it
    rowIndex: IntegerType,                                   // sheet position among REAL (resident) rows
    rowId:    StringType,                                    // the row's id — `rowById`'s argument (§4.8)
    offset:   IntegerType,                                   // the row's source offset — the paged arm's `page` lookup
    row:      DictType(StringType, SheetCellType),           // the row as it would be if the open editor committed
    rows:     ArrayType(SheetRowType),                       // the resident sheet, real rows in sheet order
    rowsOffset: IntegerType,                                 // the source offset of rows[0] — 0 on the inline arm
    partial:  BooleanType,                                   // true on a paged sheet whose source is not exhausted
    driver:   OptionType(StringType),                        // the resolved driver member's key
    today:    DateTimeType,                                  // UTC midnight — so providers stay pure
});
export const SheetFillType     = StructType({ value: SheetCellType, meta: StringType });
export const SheetProposalType = StructType({ cells: DictType(StringType, SheetCellType), meta: StringType });   // a patch's set fields, encoded

// A provider is an East function — synchronous, or asynchronous (a model call). The factory
// picks the arm from the author's function value's East type and bridges it (§4.8).
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
export const SheetEditType   = VariantType({                 // the WIRE edit; the author sees Sheet.Types.Edit(R) — §3.7, §4.8
    commit: StructType({ rowId: StringType, offset: IntegerType, key: StringType, row: SheetRowType, source: SheetSourceType }),   // `offset`: the paged arm's source lookup
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
    driver:        OptionType(SheetDriverType),              // the lookup column + its members
    suggest:       OptionType(SheetSuggestType),
    slice:         OptionType(SliceChromeType),              // the rail (search / filter / cohort); the lens reads the bound state
    views:         ArrayType(SheetViewType),
    activeView:    OptionType(StringType),
    onViewsChange: OptionType(FunctionType([ArrayType(SheetViewType)], NullType)),
    onEdit:        OptionType(FunctionType([SheetEditType], NullType)),   // `onUpdate` compiles to this (§4.7); a typed `onEdit` is bridged to it (§4.8)
    onSelect:      OptionType(FunctionType([SheetSelectionType], NullType)),
    selection:     OptionType(SheetSelectionType),           // controlled when some (§3.14) — the ring follows it, the row scrolls into view
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
  substituting the edited one (decoded from the cell by the column's static
  tag: `Null` → `none` on an `Option` field; a `Link` cell → the `Link` field, or
  decomposed into the `from` / `to` fields, or printed back to a `String` field
  per `store`);
- `insert` → the row type's default value with `id` set, then every cell of
  `ev.row.cells` applied through the same setters; appended after `afterRowId`
  (or at the end);
- `remove` → `rows.filter(r => ids.has(idOf(r)).not())`.

The handler captures only data and the author's `onUpdate` function (the capture
rule) and lands in the IR as a closed `Fn([SheetEdit], Null)`. On the paged arm
there is no collection to rebuild; the factory refuses `onUpdate` and the host
routes `onEdit` events to the dataset it pages from.

### 4.8 The typed bridge (factory internals, both arms)

Everything the author writes is typed over `R` and `D`; everything on the wire is
closed. The factory joins the two with compiled East functions, all of which
capture only data, bind handles and the author's functions:

| Piece | Shape | Built from |
|---|---|---|
| `rowById` | `Fn([String, Integer], Option<R>)` | the source row by id: on the inline arm the captured bind handle's `read()` (or the captured collection, when `data` is a plain value) searched by the `id` accessor; on the paged arm the source's `page` at the wire context's `offset`. Built ONCE per sheet and shared by every wrapper, so the collection is captured once |
| `decode` | `Fn([String, Dict<String, Cell>, Option<R>], R)` | the id field from the wire id; the source row as the base (the row type's default when absent — an insert, a proposal), then each column's field from its cell by the static tag (`Null` → `none` on an `Option` field); a `Link` cell to a `Link` field, or split into the `from` / `to` arrays, or printed to a `String` field. A field with no column keeps the base row's value |
| `encode` | `Fn([R], Dict<String, Cell>)` | the columns' reified accessors — the same projection §4.1 uses to make wire rows |
| `lookupDriver` | `Fn([String], Option<D>)` | the driver's data and `key` accessor, folded once into a `Dict<String, D>` |
| a fill provider | `Fn([SheetContext], Option<SheetFill>)` | `ctx => author({ rowIndex, row: decode(ctx.rowId, ctx.row, rowById(ctx.rowId, ctx.offset)), rows: ctx.rows.map((r, i) => decode(r.id, r.cells, rowById(r.id, ctx.rowsOffset + i))), partial, driver: ctx.driver.map(lookupDriver), today }).map(f => ({ value: cellOf(f.value), meta: f.meta }))` — the async arm awaits the author's `East.asyncFunction` the same way |
| a proposer | `Fn([SheetContext], Array<SheetProposal>)` | the same context bridge; each `Patch(R)`'s `some` fields encoded to cells |
| arity `implied`, a `custom` check, a `custom` kind's `parse` / `print` | closed twins | the context bridge; the member passes through; payloads to and from cells |
| `onEdit` | `Fn([SheetEdit], Null)` | `e => author(e with its rows decoded)` |

The bridge is the one place a string ever names a field — inside the factory,
against the column list it has already validated — so the author's code, the
examples, the tests and the skill never do. `R` and `D` live in the TS face and
inside these functions' captures; `SheetRootType` stays a closed struct, and the
`Sheet` arm of `UIComponentType` references it directly.

---

## 5 · Behaviour requirements — the interactive contract

The prototype is the executable specification of these; this table is the
checklist the renderer is built and reviewed against. Each row names where the
behaviour lives and how it is tested.

| # | Requirement (B§) | Lives in | Test |
|---|---|---|---|
| 1 | Dates: typed entry is the common date field — the segmented `dd / mm / yyyy` control the `Input` renderer uses; digits fill a segment, ↑ / ↓ step it, ⇥ leaves the last segment for the next cell, a printable key that opened the editor lands in the day segment. The B§3 grammar parses PASTED text — `+3`/`+3d`, `4d` from `base`, weekday prefix (next occurrence, never today), ISO, `d/m[/yy]`, `d.m`, `17 nov [26]`, year roll-forward — and every calendar form and printed form (display `17 Nov 26`; edit form `17/11/26`; strip preview `Mon 17 Nov 26` + day span; clipboard `17/11/2026`) is an East datetime pattern through East's own printer and parser | `parse/date.ts` + `Editor.tsx` | unit table + DOM |
| 2 | Quantities: typed entry is the common number field — digits, a decimal point, a leading minus; ↑ / ↓ and the stepper column step by one; the unit is the column's, never typed. The B§3 grammar parses PASTED text — an optional `k` / `m` magnitude suffix, commas/spaces ignored, rounded integer; strip preview with the implied run when the driver has a rate | `parse/quantity.ts` + `Editor.tsx` | unit table + DOM |
| 3 | Candidate scoring: prefix (0) → word prefix (1) → initials (2) → substring (3), ties by sheet frequency; only a prefix match ghosts inline; a non-prefix match previews `→ replacement`; empty buffer arms nothing (menu of what the field accepts, driver column ranked by what follows the row above); ⌥]/⌥[/⌥↓/⌥↑ cycle (B§3.1) | `candidates.ts` | unit + DOM |
| 4 | Link grammar: identified codes (case-insensitive, bare digits try the prefix), ranges (`M2140-45`, short upper bound completed; hyphen = range only between unspaced bare numbers), countable by name/alias (leading "the" dropped), countable by attribute (`120t` / `120 T` — a number + unit the register knows, resolved by key or alias with the spacing normalised), counted members (`N x kind` / `kind x N`, declared ops, countable kinds only; trailing qualifier → text token; multiplying an identified member → text with reason), `TBC` placeholder, free text (never blocked), separators (B§4.1) — text ↔ `Sheet.Types.Link` value, the kind's parse / print pair; the renderer parses and prints with a register-aware TS twin of the East pair (`linkVocabulary`), the same rules | `link/grammar.ts` | unit table (round trips) |
| 5 | Sides & locks: storage `a > b` / `b` / `a >`; single set = destination; the driver member's `sides` (the column's per-driver dictionary, §4.3) selects live halves (both/from/to/in; `in` draws a minus); locked half never predicted into, Tab skips it, typing allowed but flagged warn (B§4.2); a `set` column edits as a single To half | `link/sides.ts` + `cells/LinkCell.tsx` | unit + DOM |
| 6 | Link display: `minmax(0,1fr) 16px minmax(0,1fr)`; chips mono 10.5 paper-3 r4; meta only for a single chip; dashed = text/placeholder/proposal; FROM/TO faint labels; lock tags warn-tinted when holding content; proposals as dashed chips over the hatch with a ✓ take on hover (B§4.3) | `cells/LinkCell.tsx` + recipe | DOM + shot |
| 7 | Link editor keys: `,` resolves; `>` hops From → To (flag if locked); ⇥ ladder (ghost/armed → one predicted chip → hop → commit right); ⏎ resolves/commits; ⌫ pops last chip / crosses back; ←/→ cross the divider, → takes a ghost word, ⌘→ the whole ghost or every predicted chip; ⇧←/⇧→ select whole chips (brand fill, ⌫ removes); esc cancels, click a half moves the caret, click outside commits (B§4.4); `,` and the arrow resolve the buffer through the ARMED candidate (Tab's rule), so `m73,` lands `M7301` rather than a text chip | `Editor.tsx` + `sheet-state.ts` | DOM |
| 8 | Link autocomplete & prediction: candidate order (exact → code prefixes → countables with an enumerate alternative → other prefixes → other countables → placeholder), members never offered twice, a range shows its expansion; prediction only with an empty buffer, per half, never into a locked half, from the column's fill providers, as `Link` values (the prototype's history-then-counted order is the author's `[lastStations, countedByQuantity]`); withdrawn once a half has named members; from-only drivers propose into From (B§4.5); P3 wires the hook (`predictedMembers`), P4 supplies the fills | `link/predict.ts` | unit + DOM |
| 9 | Arity: strip meta *n × kind implied · k named so far / named / more than the quantity needs* while the arity half is edited; named = identified once, counted by count; text/placeholders do not count (B§4.6); the bridged `implied` is called with the edited row's wire context, fail-open | `link/arity.ts` + `Strip.tsx` | unit + DOM |
| 10 | Copilot runner: rebuilt against the row as it would be, after the kind's latency (150 / 1 100 ms); owned rows untouched; nothing into an occupied slot; first yielding provider wins — providers are the bridged wire functions of §4.8, the runner never sees `R`; provenance in the strip; fills as grey ghosts over the hatch; exactly one next Tab target (dotted underline); ✓ take on hover; gutter → fills the row (⌘⏎); memoised per (row, provisional row, column) (B§5, B§5.1); fills CHAIN in column order — a later column's providers and the proposers see the earlier fills as if taken (the prototype's `row.start \|\| fill.start`) | `suggest.ts` + `sheet-suggest-state.ts` | unit + DOM |
| 11 | Async providers: a pending chip in the strip per in-flight provider; results land reactively; a newer context cancels the wait (latest wins); a rejected or thrown provider is skipped with a console diagnostic naming the column; sync providers never wait on async ones ahead of them in the list beyond the latency window — a later sync provider answers meanwhile and an earlier async one that lands replaces it (first that yields wins, by position); an in-flight promise is memoised so a re-run re-attaches instead of restarting | `suggest-async.ts` | unit (fake timers) + DOM |
| 12 | Proposals (patches encoded to cells, §4.4): at most `ahead` rows, dashed-topped hatched rows with real numbers; ✓/⏎ adds into the first blank slot, ×/⌫ rejects and remembers the pairing; click selects (3px brand bar); esc deselects then dismisses all; taking re-anchors and looks forward; rejected fills remembered per row and key (B§5.2); a proposal lands in the blank slot below the anchor, else appended (blanks are padding) | `suggest.ts` + `Rows.tsx` | DOM |
| 13 | Sheet keys: arrows/⇧arrows (↓ on the last row appends, not while a lens is active or a paged source is unexhausted); ⇥/⇧⇥ walk fills → take rows → move; ⏎ takes next suggestion else edits with the value selected; F2; printable char seeds a fresh edit; ⌘⏎ row fill (one undo step); ⌘⇧⏎ everything; esc ladder; ⌫ clears (never stamped) / deletes whole selected rows; ⌘⌫ deletes; click/⇧click/drag/dblclick; ⌘/ and ⌘F focus the rail's search (B§6) | `sheet-state.ts` | transition table + DOM |
| 14 | Commit semantics: Tab, Enter, ↓ (down) / ↑ (stay), blur commit; esc cancels; unparseable keeps the editor open with the neg ring (blur discards); committing a `triggers` column rebuilds the copilot for that row (B§6). A date or number cell's ↑ / ↓ belong to its field (they step), so from those fields only ⏎, ⇥ and esc reach the machine | `sheet-state.ts` + `Editor.tsx` | DOM |
| 15 | Sheet model: `blanks` padding rows always below the last real row (paged: once the source is exhausted), never removed from under the cursor, not reported/counted/searchable; real row numbers under a lens and for proposals (B§7). Blank rows are padding, not rows: typing into any blank row inserts one row AFTER the last real one (source order is the only order) and the ring follows it; the initial ring sits on the first blank row's driver column | `model.ts` | unit |
| 16 | The lens over the slice: hit = the slice narrowing matches the row (`sliceMatches` over filters / cohorts / search — String fields directly, other fields through their `printFor` text or the field's `text` projection); hits keep brand row numbers; count `n matches · m context`; ±0/±1/±3 context; collapsed bands (22px, dashed rule, *n hidden* pill) with hover controls `⌃ +1 · n hidden · +1 ⌄ · all` stepping 1, 3, 10, all from top/bottom/both; reveals are a set of indices so bands merge; a narrowing change resets reveals; no narrowing ⇒ no bands (B§8) | `lens.ts` + `Bands.tsx` | unit + DOM |
| 17 | Views: lenses evaluated live; pinned whole-sheet tab (an empty narrowing) with the planned count; `+ TAB` snapshots the slice state, names from the query (16 chars) or *view n*; active = 2px ink underline; live match counts per view; dirty dot when the slice state differs from the view's, ⏎ updates / esc reverts (writes the snapshot back) / esc on a clean tab returns to the sheet; × (hover neg) or middle-click closes; double-click renames; drag reorders; closing the active tab falls back; leaving persists context + reveals (B§8) | `Tabs.tsx` + `sheet-state.ts` | DOM |
| 18 | Strip states (six) with their label · chips · meta · keys, plus the pending chip; nothing ever floats over the sheet (B§9) | `Strip.tsx` | DOM |
| 19 | Footer: counts · state-sensitive key hint · right-aligned `aria-live` message for every action · the paged transport line (B§9) | `Footer.tsx` | DOM |
| 20 | Clipboard: copy tab-separated, dates `d/m/yyyy`, numbers bare, a link cell (a `Link` value) as TWO columns printed through the grammar; paste lands at the selection appending rows, each cell parsed by its kind (unparseable kept as typed), stamped skipped, a link consumes two cells and joins them; block left selected; suggestions cleared (B§10) | `clipboard.ts` | unit + DOM |
| 21 | Paged arm: windows land on scroll through the Plan's ledger (residency, in-flight `none`, exhaustion from `total()` — every element resident; the resident run is the contiguous landed prefix, a positional row space carries no hole); the transport line counts source elements; the lens is scope-badged *loaded rows only*; the rail's search is a key search over `seek` when the source is keyed (jump rebases residency); appending needs exhaustion; `onEdit` only | `paging.ts` (adapter over the Plan stack) | DOM (Paged.of fixtures) |
| 22 | Visual rules (B§11) | recipe `sheet.ts` | shot loop |
| 23 | Controlled selection: with `selection` present the ring follows it and the row scrolls into view; every move reports `onSelect`; on the paged arm a non-resident `rowId` seeks when the source can (§3.14) | `sheet-state.ts` + `index.tsx` | DOM |

---

## 6 · Renderer design

`east-ui-components/src/collections/sheet/`. **Hard rule: every React file ≤ ~600–800
lines; split by concern, not by growth.** The prototype's logic class (2 000 lines,
`Sheet Spec.html`) is the port source; its methods map onto pure modules first and
React second. Target layout (line budgets are ceilings):

```
sheet/
  index.tsx              ~300   EastChakraSheet: decode, providers, effect runner, layout (toolbar · header · rows · strip · footer)
  sheet-state.ts         ~450   THE state machine's core — pure: selection, edit buffer, the commit, the sheet and editor keys; re-exports the vocabulary
  sheet-types.ts         ~280   the machine's vocabulary: the UI state, events, effects, the context a transition may ask (every state module imports from here — no cycles)
  sheet-link-state.ts    ~200   the link editor's transitions (the commit injected)
  sheet-suggest-state.ts ~250   the copilot's transitions: results landing, the ⇥ walk, take / dismiss, the esc rungs, the rejection memory
  sheet-state.test.ts           transition table (esc ladder, Tab ladder, commit directions, the copilot's table; tab dirty/revert in P5)
  use-links.ts           ~150   the link columns' wiring: vocabularies, halves and locks, checks per row value, the editor's context
  values.ts               ~40   the decoded value types, named once (`SheetRootValue`, `SheetRowValue`, `SheetCellValue`, …)
  model.ts               ~200   decoded value → sheet model: real rows + blank padding (exhaustion-aware), column index, driver lookup, cell display
  paging.ts              ~250   the paged arm over the Plan stack: window ledger / residency, a positional read-once reader, the contiguous landed run, `total()`-driven exhaustion, `jumpToElement` for the key search
  paging.dom.test.tsx           the driver harness: first paint, the tail band, exhaustion, a held window, a jump, an unreadable source
  parse/date.ts          ~150   B§3 date grammar (UTC, East date tokens for display)
  parse/quantity.ts      ~60
  parse/index.ts         ~80    parse / print dispatch by kind (custom kinds call the compiled East pair)
  candidates.ts          ~120   scored lookup/reference/enum candidates, frequency ties, driver "what follows" ranking
  link/grammar.ts        ~250   text ↔ Sheet.Types.Link: classify · ranges · counted members · parse · print · join (the kind's parse / print pair)
  link/sides.ts           ~90   the per-driver halves and lock tags (B§4.2), the start side, the warn test
  link/checks.ts          ~80   `exists` + the bridged custom checks per member, fail-open (B§2 `check`)
  link/predict.ts        ~120   candidate order + empty-buffer prediction per half (from the column's providers)
  link/arity.ts          ~60    implied vs named, the strip meta
  suggest.ts             ~250   the runner over the WIRE functions (§4.8): provisional cells, latency scheduler, first-yields, memo, rejection memory, proposals
  suggest-async.ts       ~120   in-flight registry, latest-wins cancellation, pending state
  lens.ts                ~150   hits from the slice narrowing (the slice engine's `sliceMatches`), context bands, reveals, step escalation
  clipboard.ts           ~120   export / paste matrix
  *.test.ts                     the pure modules' input → output tables (date · quantity · candidates · clipboard · model)
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
+ `SliceRailCluster` for the rail and the slice engine (`sliceMatches` in east-ui's `platform/slice/impl.ts`) for the lens,
`contracts/density`, `parseCssSize`, the FA solid set, `formatTick` for quantity
display, `formatDatePattern` (East date tokens, UTC) for dates.

### 6.1 The state machine (`sheet-state.ts`)

One pure reducer, no scattered `useState` (the Plan precedent):

```ts
interface SheetUiState {
    sel: Cell; selEnd: Cell | null;                 // 2px ring · range (mirrors the controlled `selection` prop when given)
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

**How the machine stays pure (P2).** What a transition may ask about the sheet —
row and column counts, whether a cell is editable, how a buffer parses for its
kind, the candidates, a cell's edit form — arrives WITH the event as a
`SheetMachineCtx` the component builds per render (`dispatch({ t: "event", e,
ctx })`), so the reducer holds no closure over the model and the transition
table is testable with a stub context. Data and host effects leave as data —
`write` (one cell, `null` = blank), `clear`, `delete.rows`, `paste`, `copy`,
`emit.select`, `scroll.to`, `focus.sheet` / `focus.editor`, `schedule.suggest` —
and the component drains each batch exactly once (the Plan's seq-gated layout
effect). The store reducer (`sheetStoreReducer`) adds the batch and a `patch`
action for the component's own UI writes (the range after a paste, the footer
message). A commit's write is the parsed cell; the register kinds take the armed
candidate when a ghost applies or the planner cycled to it (the prototype's
`commitVal`), and the parse resolves the case.

**The link editor (P3).** A link edit carries a second buffer beside the text:
`link: { side, groups: [from, to], chipSel, hop }` — the active half, the
resolved members of each half, a whole-chip selection, and a hop counter the
editor keys its focus on. What a transition needs to resolve text arrives inside
the machine context as a `LinkEditCtx` (`linkAt(r, c)`): the row's halves and
locks, the candidates over the column's vocabulary with the members already
named excluded (a member is never offered twice), `resolve` (the armed
candidate, else the grammar's own reading — a text chip, never a refusal),
`predicted` (the copilot's hook; P4 fills it) and `cell` (the groups as a `Link`
cell, `null` when both halves are empty). The rules, unit-tested as a table:
`,` and the arrow resolve the buffer through the ARMED candidate — Tab's rule,
so `m73,` lands `M7301` and `m2140 >` hops with `M2140` named — where the
prototype re-read the raw token; an arrow in the From half hops to the To half
(into a locked To it hops and warns), in the To half it is dropped; the ⇥
ladder is armed candidate → one predicted chip → hop From → To skipping a
locked half → commit right; ⏎ resolves a non-empty buffer and stays, else
commits down; ⌫ on an empty buffer pops the last chip back into the buffer, or
crosses back to the From half; ⇧← / ⇧→ grow a chip selection ⌫ removes; →
takes the ghost word (⌘→ the whole ghost, or every predicted chip); plain arrows
cross the divider from an empty buffer; esc drops the chip selection, then the
editor. A `set` column edits as a single To half — no divider, the From half
locked without a tag. The commit writes `cell(groups)`: a link editor never
reports unrecognised, because the grammar keeps anything as text.

**The copilot in the machine (P4).** The suggestions are state
(`sugg: { anchorId, fill, rows, pending }`, the `armed` target, the selected
proposal `gsel`, the session's `rejected` memory); the runner is the
component's, and its results arrive as events — `suggest.ready` for an anchor
still on the sheet (a blank padding row anchors by a synthetic id and is
re-keyed to the real id its first write mints), `suggest.landed` for an async
settlement merged by anchor and key (an earlier provider outranks by position;
a dismissed fill stays dismissed). The rules, unit-tested as a table: ⇥ with
fills pending arms the next target (the armed cell, else the first in column
order; ⇧⇥ the last), and on the armed target writes it as a `fill` commit and
arms the following; with rows pending and no fills ⇥ takes the next row; ⏎
takes the row fill, then the first proposal, else edits; ⌘⏎ takes the row fill
as one `row` write; ⌘⇧⏎ everything; a selected proposal's ⏎ takes the rows up
to it; ⌫ on the armed target dismisses that fill and remembers `anchor|key`;
⌫ on a selected proposal rejects it and remembers `driver>driver`; the esc
rungs run selected proposal → the row fill (rows stay) → every suggestion →
the range; a printable key keeps the suggestions and drops the armed target;
a paste drops them; a commit of a `triggers` column re-asks the runner (the
component decides — the reducer only writes). Taking proposals is one
`insert.rows` effect: the rows to insert and the rest, which re-anchor on the
last row inserted so the next one is already waiting.

### 6.2 The provider runner

The copilot runs *against the row as it would be*. `suggest.ts` builds the
provisional row from the edit buffer (the committed value of the open editor,
computed by the kind's parser), then evaluates the column's providers in order
until one yields, then the proposers in order until one returns rows. Every
provider is a compiled East closure — the factory's bridged wire function (§4.8) —
invoked with a closed `SheetContext` value (rows pass by reference — East values
are immutable); the renderer never sees `R`. A `sync` arm returns inline; an `async`
arm registers in the in-flight set (`suggest-async.ts`), the strip shows the
pending chip, and its settlement re-enters the machine as `suggest.landed` unless
a newer context superseded it (latest wins, cancelled results dropped). Results
are memoised per `(rowId, provisional-row hash, column)`; the scheduler bounds
calls to one per latency window per row. Owned rows skip the runner entirely.

One rule the Table and Plan renderers already live by: `equalFor` treats every
function value as equal, so a memo guard on the root cannot see a swapped
provider, check or `onEdit`. The renderer memoises on the data fields and takes
every function value from the latest IR on each render; the runner's memo keys
carry the column's provider POSITION, never a function identity.

**As built (P4).** `runSuggest` (`suggest.ts`) is pure over the wire
functions: per column in declaration order it skips a read-only or occupied
cell, the edited column (a link column excepted — it is predicted into, its
providers seeing that cell blank), and a dismissed fill, then walks the
providers — a sync one answers inline and stops the walk; an async one is
started and returned as work while the walk goes on, so a later sync provider
answers meanwhile and the async one replaces it when it lands (by position).
Fills chain: each fill joins the provisional row the next column's providers
and the proposers see. The memo (`SuggestMemo`) is keyed on the anchor, the
provisional row's printed cells, the column and the provider position, holds
settled results AND in-flight promises (a re-run re-attaches), and empties on
a new value. The component schedules runs (`requestRun`): after the kind's
latency while editing (150 / 1 100 ms), at once after a commit of a `triggers`
column, a take, or an inserted proposal; the in-flight registry
(`suggest-async.ts`) opens a generation per run and delivers a settlement
only while its generation is current — latest wins, and a rejected or thrown
provider lands as nothing with a diagnostic naming the column. A proposal is
taken into the blank slot below the anchor (else appended) with the `pattern`
provenance, the row fill with `row`, a single fill with `fill`.

**A compiler fix shipped with P4.** The bridge's async wrappers put an author's
async function inside a variant inside the root struct; the East analyser
validated a `Struct` / `Variant` (and every other composite node that fell
through to its generic return) but returned the ORIGINAL children, so a
function literal nested there was compiled unanalysed and lost its awaits
(`array.map is not a function` on the promise). `libs/east/src/analyze.ts` now
substitutes the analysed children for every case, with a spec pinning a
nested async function inside a struct, a variant, an array, a dict, a match
arm and a cast.

### 6.3 Rendering pipeline

`decode → paging.ts (resident rows, exhaustion) → model.ts (real rows + blanks,
column index) → lens.ts (hits from the slice state, visible rows + bands) →
VirtualRows(estimateSize by row: 36 min, link cells measured) → Rows`. Toolbar
and header sticky; strip and footer outside the scroll box; the editor overlays its
cell (position: absolute, z 10) and grows with wrapping chips. The whole sheet is
one focusable region (`tabIndex=0`) that owns the keyboard; the editor stops
propagation. Effects run in one place (`runEffects`); `useSliceReactivity(slice.key)`
re-renders on slice writes.

**The local data layer (P2).** The renderer keeps a layer of edits over the
decoded rows — rows edited in place by id, rows appended after the source's last
one, ids removed — so every edit lands at once (the interactive-state pattern:
the sheet is never inert without a bound callback) and reaches the host through
`onEdit` in a microtask. A new decoded value (the host wrote back through
`onUpdate`) or a new paged source resets the layer, so the host's own rows come
around with the edit applied and nothing is applied twice. A real row's commit
is one `commit` event per changed cell, each carrying the row after it; typing
into a blank row (or a paste past the padding) makes ONE inserted row — appended
after the last real row, its id minted by `newRowId` or the renderer, its
`insert` event naming the row it lands after — and the ring follows it, keeping
whatever move the commit made. Rows are measured (a link cell wraps), the ledger
is taught rows × the density row height, and the last column absorbs the frame's
slack (the Table's stretch rule). A pasted cell a typed kind cannot carry is
skipped and counted in the footer message; a stamped column is consumed and
never written.

**Links (P3).** Each `link` / `set` column gets a vocabulary once per value —
the register's members indexed by key and lower-cased alias, the column's
member kinds (identified vs countable; the family kind resolved by
attribute), the declared multiple ops and the code prefixes bare digits try —
the register-aware TS twin of `Sheet.link.parse` / `print` (B§4.1: `120t` /
`120 T` / `120  t` all read as the `120 t press` family — a number + unit is
tried against the keys and aliases with its spacing normalised; a counted
member's chip reads *unassigned*, a count naming no one in particular;
`M2140-45` only unspaced, a short upper bound completed; a qualifier after a counted member is its own text chip;
multiplying an identified member is text with the reason). A row's halves come
from the column's per-driver `sides` dictionary and its lock rules
(`halvesFor`): a locked half is never predicted into, Tab skips it, and content
under a lock draws the tag in warn. Checks run at render, once per row value
and column (a `WeakMap` over the immutable row): `exists` against the
vocabulary, the bridged custom checks with the wire check context (`rowIndex`,
`rowId`, `offset`, `row`, `half`, `member`), every one fail-open — a flagged
member keeps its chip and carries the message as its title. The arity meta is
the bridged `implied` called with the edited row's wire context while the
arity half is edited, fail-open. Under `store: "canonical"` the BRIDGE prints
the register's labels into a `String` field; the renderer never sees the
storage form.

**The lens and the views (P5).** `lens.ts` is pure: `narrowingActive` (the slice's
`isActive` rule — a blank search is no narrowing), `matchRecord` (the host-shaped
record above), `lensHits` through `sliceMatches`, `lensVisible` (hits ± the context,
plus the revealed POSITIONS — positions, so reveals survive paging and persist into a
view), `lensGaps` (the hidden runs, keyed by the hits that bound them so a band keeps
its identity as it opens) and `revealStep` (1 · 3 · 10 · all from the top, the bottom
or both ends). `buildBody` takes the lens: hidden rows collapse into `gap` items, hits
carry `hit`, and the blank tail is not drawn — a lens narrows the sheet, it never
invites the next row (`lensActive` also stops ↓ appending). The machine holds `lens`
(context · reveals · steps) and `tabs` (active · seq · renaming); `dirty` is DERIVED by
the component (`equalFor(Slice.Types.State)` between the active view's narrowing and
the slice's) and arrives in the context. The transitions (`sheet-lens-state.ts`): a
tab switch persists the leaving tab's context and reveals (never an unsaved query),
writes the target's narrowing as a `slice.write` effect and restores its lens; `tab.open`
does the same without persisting (the initial `activeView`); `+ TAB` snapshots the
narrowing named from the query (16 characters) or `view n`; ⏎ in the search updates a
dirty tab, esc reverts it, esc on a clean tab returns to the sheet, esc on the sheet
clears the search (the rail's combobox takes the first esc to close its suggestions,
so a revert is the second press while they are open); the sheet's own esc ladder
reaches the tabs after the range; ⌘/ and ⌘F are a `focus.search` effect. One fix
outside the sheet rode along: the rail's search now keeps free text across a blur
(`allowCustomValue`) — clicking into the narrowed surface used to reset the box and
drop the narrowing with it. The component detects a narrowing change by comparing
the slice state across renders and dispatches `lens.narrowed` (reveals reset, the ring
to the top) — except for a narrowing the sheet wrote itself, which carries its own
lens. The key search on the paged arm (`use-seek.ts`) mounts whenever the source
declares `seek`, replaces the rail's `search`, and lands the ring on the matched
position once its window is resident; the k-th match IS the row at `range.row + k`.

**The toolbar under width pressure (P6 review).** One row, always — nothing
wraps and nothing scrolls. The rail gives way first: its ladder folds
affordances into summary chips, then one chip naming its contents, then the
icon alone (a new terminal rung; every rung opens the slice editor popover).
The flex layout enforces that by construction: the rail group takes the
leftover (`flex: 1 1 0`) over a `min-content` floor, the cluster's `contain:
inline-size` keeps the rail's content out of that floor, and the tabs strip
shrinks only past it. Then the tabs fold their trailing members into a `+n`
menu (`foldTabs` — the active tab is always kept, taking the last visible
slot). At the strip's floor (the whole-sheet tab · the active tab · `+n` ·
`+ TAB`) it reports through `SheetTabsFoldContext`, and the toolbar climbs its
own ladder one rung per report, moving the strip's measure key after each so
the ladder settles before paint: `data-tight` 1 drops the count line, 2 the
context label, 3 the `+ TAB` label and the whole-sheet count, 4 caps the tab
names at 72 px, 5 drops the context switch. Growth resets both ladders once
the width has settled (the rail's rule); the count or the context switch
coming or going resets the toolbar's. The Plan's toolbar keeps its one row
too: its cluster's floor is the icon rung.

**A phone (P6 review).** The sheet is a spreadsheet on a phone, not a card
list: the grid scrolls sideways under a gutter that stays put (`position:
sticky`), the toolbar keeps its row through the ladder above, and on a coarse
pointer (`_coarse`, the adaptive contract of #346) the small controls grow —
gutter buttons and ✓ take 26 px, × close 24 px, the tabs 40 px, `+ TAB` 32 px,
the band's controls and the strip's chips padded — the gutter widens to 96 px
so two buttons fit, the editor's type goes to 16 px so the phone never zooms
into it, and the lens band's hover-revealed controls stay open where nothing
can hover (`_hoverNone`).

**Pointer and scroll (P4 follow-up).** A click never scrolls — the cell is under
the pointer already, and centring it moved the sheet under a held button so the
next row's `mouseenter` read as a drag (a click selected two cells, then three);
only keyboard moves emit `scroll.to`, and they scroll the least distance that
shows the row (`scrollAlign="auto"` on `VirtualRows`; `"center"` stays the
default for the collections that seek). A range drag needs pointer MOVEMENT
under the held button: a `mouseenter` from a layout shift under a stationary
pointer (a window landing, a row growing) never extends the range. The ring and
the editor overlay reach 1 px outside their cell; on the row directly under the
sticky header they stay inside it (`data-first`), so the header never covers
the ring's top edge.

**The fields (review, 2026-09-12).** The ring is the field chrome; what sits
inside it is the COMMON control for the column's kind, never a bespoke input:
a `date` column mounts the segmented date field the `Input` renderer uses
(react-aria segments, `dd / mm / yyyy`), a `quantity` / `integer` column the
number field with its stepper column (Zag), a `text` / `custom` column the
text input — each borderless under the ring. The machine still holds a STRING
buffer: the date field reports its date in the edit form, the number field its
text, so the commit parses exactly what the field shows and `parse/*` stays the
one parser for typing, paste and the strip. The register kinds keep the typed
buffer with the ghost mirror, a special case: their candidates live in the
docked strip (B§9) and no popover ever opens. Two mechanics matter. The common
fields start their machines and attach their listeners in PASSIVE effects, so
the editor focuses — and types a seed into the day segment — from a passive
effect after them; a layout-effect focus reaches a machine that has not
started and is dropped. And the fields own their arrows (↑ / ↓ step a segment
or the number), so only ⏎, ⇥ (at the date field's edge segments) and esc reach
the machine from them. Every printed date and every calendar entry form is an
East datetime pattern through East's own tokenizer, printer and parser
(`formatDatePattern` / `parseDatePattern`, the chart axis pair); only the
relative forms — `+3d`, `4d`, a weekday — are the grammar's, and they apply to
pasted text. Cells and link members are built with `variant()` everywhere the
renderer makes one (the brand the encoder needs), and the renderer narrows on
the decoded `Sheet.Types.*` values rather than re-declaring their shapes.

---

## 7 · Visual compliance sheet

Distilled from B§11 and the prototype's inline CSS — the implementation checklist
and the review gate. All numerals `font-mono` with `"tnum" 1`; every colour a
semantic token; dark theme for free.

| Surface | Value |
|---|---|
| Sheet card | `--paper`, **no border of its own** — a component is placed anywhere and the host frames it (the Plan rule; the prototype PAGE draws its 1px `--rule-strong` radius-10 frame around the sheet, the component does not); content `min-width` = gutter + Σ column widths; 120px bottom padding; one rule per seam — toolbar and header `--rule` / `--rule-strong` below, strip and footer `--rule` above |
| Toolbar row | 8/20 on `--paper`, 1px `--rule` bottom: tabs (left) · context switch · `n matches · m context` mono 10.5 `--ink-4` · the slice rail cluster (right; the search pill is the rail's, one height whether it shows the `/` hint or the ×) · scope badge *loaded rows only* (paged). Under width pressure nothing squeezes, wraps or scrolls — one row, always: the rail folds (chips · one chip · the icon) before the tabs fold their trailing members — the active one always kept — into a `+n` menu, and only at the strip's floor does the toolbar drop the count, the context label, the `+ TAB` label, cap the tab names and drop the context switch, in that order (§6.3) |
| Header | sticky, two lines: label mono 10/600/`.16em` uppercase `--ink-4`; sub mono 9 `--ink-5` ellipsised; 1px `--rule` column dividers; `--rule-strong` bottom |
| Gutter | 80px `--paper-2`; row number mono 10 right-aligned in 26px (`--ink-5`, brand `--brand-d` 600 for hits) with 6px before the buttons; 18×18 r-sm action buttons 3px apart (✓ brand / × rule-strong→neg / → brand); 3px brand-d bar when the row is selected; hover `--paper-3` |
| Rows / cells | min-height 36; padding 6/10; 1px `--rule` bottom and right; text 13 `--ink`; mono values 12 `--ink-2`; ghosts `--ink-4`; unit mono 9.5 `--ink-5`; enum = 6px dot (member tone) + mono 10/600/`.08em` uppercase word |
| Selection | ring `inset 0 0 0 2px var(--brand-d)` at inset −1 (top 0 on the row under the header); range wash `--brand-tint` at .55; editor overlay inset −1, `--paper`, 2px brand-d ring, z 10; parse error ring `--neg` z 11 |
| Proposal | hatch `repeating-linear-gradient(135°, transparent 0 5px, color-mix(brand-d 7%) 5px 6px)`; next-target 1.5px dotted `--brand-d` at bottom 3px; ✓ take 18×18 at right; proposal rows 1px dashed `--rule-strong` top rule |
| Link cell | `minmax(0,1fr) 16px minmax(0,1fr)`; chips mono 10.5 `--ink-2` on `--paper-3`, 1px `--rule`, r-sm, padding 1/4, gap 4; chip meta 9 `--ink-5`; dashed chips 1px dashed `--ink-5` at .85; FROM/TO 8.5/600/`.1em` `--ink-5`; lock tag `--paper-3` r-sm, warn = `--warn` text on 8% warn wash; arrow/minus 10px `--ink-4` on the first 20px line; editor halves 34px min, active-half 1.5px `--brand-d` underline; picked chips `--paper` on `--brand-d` |
| Bands | 22px; 1px dashed `--rule-strong` at 50%; pill mono 9 `--ink-5` on `--paper` 1px `--rule` r-sm; open pill `--shadow-xs`, brand controls with `--brand-tint` hover |
| Strip | `--paper-2` band, 6/20 padding, 1px `--rule` top; label mono 9/600/`.13em` uppercase `--brand-d`; chips mono 11 (armed: 600 `--brand-dd` on `--brand-tint` + inset 1px ring at 40%); pending chip = dashed `--rule-strong` with a mono `⋯`; meta mono 10 `--ink-3`; keys mono 9.5 `--ink-5` |
| Footer | 8/20 padding, 1px `--rule` top; counts mono 11 `--ink-3`; key hint mono 10 `--ink-5` `.04em`; message mono 10.5 `--ink-2`, `aria-live="polite"`, right-aligned; transport line mono 10 `--ink-4` (paged) |
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
`<Sheet>` tag (both overloads), the column builders (`Sheet.column.<kind>(R, …)` /
`(R, D, …)` / `(R, register, …)`, checked per key by `SheetColumnSpec<R>`),
`Sheet.driver`, `Sheet.register.members` / `.concat`, `Sheet.link.arity` / `.check` /
`.parse` / `.print`, `Sheet.patch`, the typed constructors (`Sheet.Types.Context` /
`Fill` / `Patch` / `Proposal` / `Edit` / `CheckContext`), the bridge (§4.8:
`rowById`, decode over the source row, encode, driver lookup, sync / async by the
function's type), the `onUpdate` rebuild, the slice chrome option, the controlled
`selection` (§3.14), build-time checks (§3.12 — every refusal naming the column
and the remedy), the `STANDARDS.md` gate (a JSX `@example` on the tag mirrored in
the examples file; full `Types.*` blocks with a `@property` per field; `typeof`
aliases and `*Literal` shorthands for every variant), spec tests, and the examples
corpus in the five slots of `EXAMPLES_AUTHORING.md` §8: **`sheetBasic`** (§3.1);
**`sheetVariants`** — THE configurator, one live sheet fed by expressions (density,
blanks, read-only, height mode, copilot on / off), one `State.bind` per axis,
`Configurator.Control` / `Slot` / `Spec` rows and an aside event log — the
`tableVariants` / `planVariants` shape; **`sheetPlan`** (§3.11 — the flagship, the
richest composition: every kind + registers + copilot + slice lens + views +
footer); the behavioural isolates **`sheetCopilot`** (every prototype rule as an
author function — derive, history, sequence, default, phrase, capacity, learned
follower — plus an async proposer behind a test platform function registered
beside `TestImpl`, with a `State`-backed provenance log), **`sheetLens`** (slice
search + filter drawn as bands, a Link column searched through `text`, views),
**`sheetWriteBack`** (raw `onEdit` event log beside `onUpdate`), **`sheetPaged`**
(`$.const(Paged.of("plan", rows, { key: r => r.id }))` as in
`paged-source.examples.tsx`; transport line, key search, `onEdit`); and
**`sheetStress`** (2 000 rows). Every example function is self-contained — types,
fixtures and constructors inside the body, bulk data derived with
`East.Array.range` / `generate`, only `East.asyncPlatform` at module scope — and
merged examples keep the union of keywords and a feature-enumerating description.
Fixtures are the prototype's synthetic registers and rows.

**P2 — renderer core** `model.ts`, `paging.ts` over the Plan stack, `parse/*`,
`candidates.ts`, `sheet-state.ts` (+ tests), the controlled `selection` with
scroll-into-view (§3.14), `Toolbar` (tabs placeholder + rail
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
tab gesture (snapshot / dirty / revert), `views` / `onViewsChange`; the Slice
change that makes a Link column searchable — a non-String field in
`searchFieldIds` searches through its `printFor` text, and a field spec's `text`
accessor overrides the projection (§3.8), with `Sheet.link.print` as its argument;
dark pass. Built as §6.3 describes (`lens.ts`, `sheet-lens-state.ts`, `Tabs.tsx`,
`use-seek.ts`, the `text` field kind in `platform/slice`).

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
  tone / meta / parent as `Option`s, duplicate keys folded), the driver's per-key
  `uom` / `sides` dictionaries, provider/proposer bridging (sync vs async by function
  type, payload checked against the kind), the `onUpdate` rebuild (commit / insert / remove over a fixture
  collection, with `Option` fields), the slice chrome envelope, every build-time
  refusal in §3.12.
- **The bridge** (§4.8) — `decode` / `encode` round trips per kind: `Option` fields
  and `Null`, a `Link` field / `from` + `to` fields / a `String` field per `store`,
  a field with no column; `Sheet.patch` omitted fields as `none`; a typed provider
  bridged and called through the wire context yields the encoded fill; `onEdit`
  events arrive decoded.
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
  and the paged rows through `Paged.of` fixtures (windows, exhaustion, seek); a
  swapped provider function value re-runs the copilot (the `equalFor` rule, §6.2);
  a controlled `selection` moves the ring and scrolls (§3.14).
- **Shots** — prototype vs rendered example, same state, light + dark; goldens in
  the showcase.

---

## 10 · Open questions (proposed resolutions)

| Question | Proposal |
|---|---|
| Async provider policy | Latest wins; no timeout (the strip shows pending indefinitely, and a newer keystroke cancels); a rejected promise is skipped with a diagnostic. A per-provider timeout can be a later `suggest` field. Built in P4 as proposed; an in-flight promise is memoised, so a re-run over the same provisional row re-attaches rather than calling the model again. |
| Routing edits on a paged sheet | The host's problem by design (`onEdit` events); the corpus shows an edit journal. A `Data.bindPaged` write path is an e3-ui question, not a Sheet one. |
| Views vs cohorts | A view snapshots the whole slice state (including active cohorts). If a host wants views shared across surfaces, cohorts already are; the two compose. |
| Undo | The prototype has none beyond "row fill is one undo step". v1: none; the host's staged bind is the undo (`discard`). A per-sheet undo stack is renderer-local state and can arrive without an IR change. |
| Column resize / reorder | Not in v1 (widths are config). The Table's header drag can be lifted later. |
| `store: "canonical"` | Resolved 2026-09-09 (P3): the bridge prints the register's labels into a `String` field (identified members by label, the rest as the grammar prints them); `asTyped` writes the keys as typed. The renderer never sees the storage form. |
| `check` validators | Author East functions (§3.4), evaluated at commit and on paste; the flag is the lock-warn treatment plus a strip line. Never a block. |
| Narrow / mobile | Out of scope for the sheet; a phone review of a plan is a `<Plan>` or a `<Deck>`. |
| Fields of `R` with no column | Resolved 2026-09-09: `ctx.row` is rebuilt over the real row (`rowById`, §4.8), so unmapped fields keep their values. Still open: when `data` is a plain array VALUE rather than a bind, the shared `rowById` captures the whole collection — fine for example-sized sheets; a large plain array should be bound (`State.bind`) so the capture is a handle. |
| Searching a Link column | Resolved 2026-09-09: the slice searches a non-String field through its `printFor` text by default, and a field spec's `text` accessor (`Sheet.link.print`) overrides it with the display form — the Slice's `text` field kind, landed in P5 (§3.8). |
| A `types` registry override (B§1 `types`) | Covered by `Sheet.column.custom` per column; a reusable custom kind is an ordinary TS function returning the config. |
