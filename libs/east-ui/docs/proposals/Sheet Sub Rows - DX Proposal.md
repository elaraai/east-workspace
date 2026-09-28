# Sheet sub rows: DX proposal

Proposed 23 September 2026; the authoring half (§2–§3) landed in #844, the renderer half (§4) is #845. The visual contract is the designer's **Sub Rows Spec** (claude.ai/design project *Nested sub rows table layout*); a prototype already implements its renderer half against a hand-built wire value, so the rendering described in §4 has been seen working.

References: the Sheet authoring layer (`packages/east-ui/src/collections/sheet/` — `root.ts`, `group.ts`, `columns.ts`, `types.ts`, `bridge.ts`), the JSX tag (`src/runtime/collections/sheet.ts`), [EAST_UI_PROP_PATTERNS](../../../../docs/conventions/EAST_UI_PROP_PATTERNS.md), [EXAMPLES_AUTHORING](../../../../docs/conventions/EXAMPLES_AUTHORING.md) and the [group-rows review](<Sheet Group Rows - DX Review.md>).

## Recommendation

**Add a declarative `subRows` prop: per array field of the row the columns are built over, one mapper from an element to a sub row of five fields. Sheet owns the rest** — the tree, the `{line}.{n}` index, expanding and folding, search, and the layout.

```tsx
subRows={Sheet.subRows(JobType, {
    operations: (op) => Sheet.subRow({ code: op.code, name: op.name, chips: op.materials, id: op.id }),
    bookings:   (b)  => b.match({ … }),
})}
```

A sub row is **not a row of the sheet's columns**. The spec is explicit: an operation and a booking carry different fields, so each sub row is one content cell from the gutter edge to the right edge, laid out as a **lead** (a code and a name), a **detail** (chips, then labelled facets), and an **id** pinned right. The API therefore describes that shape, not cells.

Today nothing models rows under a line. A group row holds `lines: Array<Line>`, a line is `{ key, cells }`, and the draft model is two levels deep (`types.ts:152-155`, `drafts.ts:21-44`). What an author can do now is keep the array as a column-less field and summarise it with a `value:` column. That loses the entries themselves, which is the point of the spec.

## 1. The shape: five fields

| Field | Spec | Type |
| --- | --- | --- |
| `code` | the lead's code, mono 11/600 — an op code (`ASM`), or a word for what the row is (`LABOUR`) | `String` (`""` for none) |
| `name` | the lead's words, 12.5 | `String` |
| `chips` | the detail's parameter chips, first | `Array<String>` |
| `facets` | the detail's labelled facts, after the chips; the detail wraps and is never truncated | `Array<{ label, value }>` |
| `id` | the record it traces to, pinned right so ids align down the table | `String` (`""` for none) |

The index `{parent}.{n}` is the renderer's.

**One kind of lead.** The spec draws two leads: a code and a name for operations, and a boxed tag with its text for everything else. The code-and-name lead covers both. A booking's code is the word that says what it is (`LABOUR`), and its name is the text: `LABOUR  Assembly · 2 people · 12 person-hours`. The boxed tag is one style less, not a second type.

Everything else is left out of v1 and can be added later without breaking authors: a lighter "not work" style, a hover sentence (the renderer composes one from the five fields), and which lines start open.

## 2. The author's API

A sketch — proposed names, not code that compiles today. The example is a production plan whose jobs carry their own operation records and bookings, neither of which has a column:

```tsx
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, FloatType, IntegerType, OptionType, StringType, StructType, VariantType } from "@elaraai/east";
import { Sheet } from "@elaraai/east-ui";

const OperationType = StructType({
    id: StringType,                     // "WO-1042-1"
    code: StringType,                   // "ASM"
    name: StringType,                   // "Assemble frame"
    materials: ArrayType(StringType),   // ["M6 bolts × 12", "Frame kit"]
    station: OptionType(StringType),
    by: OptionType(StringType),
    note: OptionType(StringType),
});
const BookingType = VariantType({
    space:     StructType({ area: StringType, units: IntegerType }),
    labour:    StructType({ team: StringType, people: IntegerType, hours: FloatType }),
    equipment: StructType({ resource: StringType }),
});
const JobType = StructType({
    task: StringType, qty: FloatType, notes: StringType,
    operations: ArrayType(OperationType),   // no column — shown as sub rows
    bookings: ArrayType(BookingType),       // no column — shown as sub rows
});
const PlanType = StructType({ id: StringType, name: StringType, jobs: ArrayType(JobType) });

<Sheet
    data={plans}
    id="id"
    group={Sheet.group(PlanType, "jobs", { title: "name" })}
    columns={{
        task:  Sheet.column.text(JobType, { header: "Task" }),
        qty:   Sheet.column.quantity(JobType, { header: "Qty" }),
        notes: Sheet.column.text(JobType, { header: "Notes" }),
    }}
    subRows={Sheet.subRows(JobType, {
        operations: (op) => Sheet.subRow({
            code:   op.code,
            name:   op.name,
            chips:  op.materials,
            facets: { station: op.station, by: op.by, note: op.note },   // a none drops out
            id:     op.id,
        }),
        bookings: (b) => b.match({
            space:     ($, s) => Sheet.subRow({ code: "CLAIM",     name: East.str`${s.area} · ${s.units} units` }),
            labour:    ($, l) => Sheet.subRow({ code: "LABOUR",    name: East.str`${l.team} · ${l.people} people · ${l.hours} person-hours` }),
            equipment: ($, e) => Sheet.subRow({ code: "EQUIPMENT", name: e.resource }),
        }),
    })}
    onUpdate={plans.write}
/>
```

- **`Sheet.subRows(R, sources)`.** `R` is the type the columns are built over: the line type on a grouped sheet, the row type on a flat one. `sources` is keyed by **field name**, exactly as `columns` is. Each key must name an `Array<T>` field of `R`, and its value maps one element (and, when it needs it, the row) to a sub row. Key order is display order, so a line shows its operations, then its bookings.
- **`Sheet.subRow({ code?, name, chips?, facets?, id? })`.** This builds the wire value, the way `Sheet.patch` builds a patch (`index.ts:243-266`).
  - Every field takes a plain value or an East expression (`SubtypeExprOrValue`).
  - `code` and `id` also take an `Option<String>`.
  - `facets` is a record: its keys are the labels (the renderer sets them in capitals) and its values are `String` or `Option<String>`. A `none` drops the facet, and key order is display order.

### The types

**East types (`types.ts`, closed).** Neither `R` nor `T` appears in them, like every wire type in that file. The value a mapper returns **is** the wire element.

```ts
export const SheetFacetType  = StructType({ label: StringType, value: StringType });
export const SheetSubRowType = StructType({
    code:   StringType,               // "" for none
    name:   StringType,
    chips:  ArrayType(StringType),
    facets: ArrayType(SheetFacetType),
    id:     StringType,               // "" for none
});
// SheetLineType gains  subRows: ArrayType(SheetSubRowType)
// SheetRowType  gains  the same (a flat sheet's rows)
```

`""` for none follows the band's own `sub` (`types.ts:166-169`): these are display strings, and an `Option` would only move the blank check into the renderer.

**Which fields may be sources, and what they hold (`sub-rows.ts`).** These are the `SheetLinesField` / `SheetLineOf` pair, with one difference: an element may be anything — a struct, a variant, a string — where lines must be structs.

```ts
/** The keys of R whose field is an Array. */
export type SheetArrayField<R extends StructType> = {
    [K in SheetFieldKey<R>]: R["fields"][K] extends ArrayType<EastType> ? K : never
}[SheetFieldKey<R>];

/** The element type one of those fields holds. */
export type SheetElementOf<R extends StructType, K extends SheetArrayField<R>> =
    R["fields"][K] extends ArrayType<infer T extends EastType> ? T : never;
```

**The builders.** `Sheet.subRows` has the `SheetColumnSpec` shape; `Sheet.subRow` has the `Sheet.patch` shape — a literal record in, one typed East value out.

```ts
/** Keyed by R's array fields; each value maps an element (and its row) to a sub row. */
export type SheetSubRowSources<R extends StructType> = {
    [K in SheetArrayField<R>]?: (item: ExprType<SheetElementOf<R, K>>, row: ExprType<R>) => SubtypeExprOrValue<SheetSubRowType>
};

/** What `Sheet.subRows` returns and the prop takes — it captures only, like `SheetGroupValue`. */
export interface SheetSubRowsValue<R extends StructType> {
    readonly rowType: R;
    readonly sources: SheetSubRowSources<R>;
}
export function createSubRows<R extends StructType>(rowType: R, sources: SheetSubRowSources<R>): SheetSubRowsValue<R>;

/** The literal-record input of `Sheet.subRow({ … })`. */
export interface SheetSubRowInput {
    code?:   SubtypeExprOrValue<StringType | OptionType<StringType>>;
    name:    SubtypeExprOrValue<StringType>;
    chips?:  SubtypeExprOrValue<ArrayType<StringType>>;
    facets?: Record<string, SubtypeExprOrValue<StringType | OptionType<StringType>>>;
    id?:     SubtypeExprOrValue<StringType | OptionType<StringType>>;
}
export function createSubRow(input: SheetSubRowInput): ExprType<SheetSubRowType>;
```

`Sheet.subRow` fills in what is left out: `code` and `id` become `""`, and `chips` and `facets` become `[]`. An `Option` for `code` or `id` becomes its value, or `""`. Each facet's value type is inspected once, when the sheet is built: a `String` becomes one facet, and an `Option<String>` becomes zero or one.

**Tying it to the sheet.** `SheetOptions<R>` gains `subRows?: SheetSubRowsValue<R>`. `SheetGroupedOptions<P, F>` gains `subRows?: SheetSubRowsValue<SheetLineOf<P, F>>`, so a declaration built over the group type rather than the line type is a compile error. `root.ts` repeats both checks at build time for untyped callers, the way it checks that columns are built over the line type.

**What the compiler catches:**
- A key that is not a field (`operation`), or a field that is not an array (`task`). Both are excess properties on `SheetSubRowSources`.
- A mapper that returns anything but a sub row, such as `(op) => op.name`.
- A sub row with no name.
- A facet of the wrong type, such as a `Float`: print it with `East.str`.

**How it runs.** Each mapper has a fixed output type, so `root.ts` compiles it once with `East.function([R, T], SheetSubRowType, (_$, row, item) => map(item, row))`, as `reify.ts` directs for fixed-output mappers. The row projection then calls it inside eager maps: `row.operations.map((_$, x) => fOps(row, x)).concat(row.bookings.map((_$, x) => fBookings(row, x)))`. Nothing is spliced.

### Why this shape follows the prop rules

- **It is a data prop.** Each mapper is compiled once per factory call and **called** inside the eager projection, never spliced. This is how `value:` columns work today (`bridge.ts:201-218`) and what PROP §3 requires. The mapper captures data only, never a UI component.
- **It is a prop, not child tags.** JSX children are UI components, and the Sheet's sub-structures are config props, never `<Sheet.SubRow>` tags (JSX_AUTHORING; SKILL "Key patterns").
- **The names are free.** `sub` is already the column's second header line (`columns.ts:139-140`) and the band's small line (`group.ts:193-194`). So the prop is `subRows`, never shortened, and the value builder is `subRow`. `detail` stays free for a cell's extra text.
- **It is keyed like `columns`.** An author who knows `columns={{ field: … }}` reads `Sheet.subRows(R, { field: … })` at once, and the build-time check has the same shape: the key must name a field of `R`.

## 3. Wire, projection and editing

```text
Sheet.Types.SubRow = { code: String, name: String,
                       chips: Array<String>,
                       facets: Array<{ label: String, value: String }>,
                       id: String }
Sheet.Types.Line   = { key, cells, subRows: Array<SubRow> }          // grouped
Sheet.Types.Row    = { id, owned, cells, lines, band, subRows }      // flat sheets
Sheet.Types.Group  / Column: unchanged
```

**Projection.** A line is already projected by the same function as a flat row (`bridge.ts:634-638`). That function gains `subRows`: for each declared source in key order, it maps the row's array through the compiled mapper and concatenates the results. Sources with no entries project nothing. A sheet declared without `subRows` projects `[]`, so the wire change is additive and older values decode unchanged.

**Editing: read-only in v1.** The arrays have no column, so they already survive drafts and patches untouched. `docs/SHEET_TESTING.md` lines 56-66 confirm this for any field without a column. `newRow` seeds them, usually with `[]`, and `ready` / `onApply` see them in the row as today. No gesture edits a sub row. If sub-row editing is wanted later, it needs its own draft level and addressing (the group review's §3 identity question, one level down). That should be a separate proposal.

**Stable identity.** Expansion is per line, and a line's wire key is its array index printed as text (`bridge.ts:634-638`). Expansion saved per view would therefore follow the index, not the line, after an insertion. The group review's `lineId: "id"` fixes this for sub rows too. With it, key the open state by the stable id; without it, keep it as transient session state and do not persist it in views.

## 4. What the renderer owns

This all follows the Sub Rows Spec, and all of it has been exercised in the prototype:

- **Chevron.** A 10 px stroke chevron before the line's number: ink-3, down when open, right when closed, shown only on lines with sub rows. The same chevron replaces the plan band's icon.
  - Lines start closed.
  - Click, or Space with the ring on the line, toggles it.
  - ⌥-click and ⇧Space apply to every line of the group.
  - The footer hint names the count.
- **Tree.** One `border.strong` stem starts just under the chevron. It runs through the sub rows with a 10 px elbow into each, and the last one's stem stops at its middle. The index `{line}.{n}` sits clear of the elbow in mono 11 ink-4 tabular. The gutter stays on the surface, so the tree reads on white.
- **The well.** One grey content cell spans from the gutter edge to the right edge; in dark mode it sits one step above the surface. Its content is a flex row, gap 20:
  - the **lead**, 220 px: the code in mono 11/600, then the name. On a sub row with no chips or facets there is nothing beside the lead to align with, so its name runs on rather than wrap inside the 220 px: a booking reads on one line;
  - the **detail**, which wraps (gap 6/18) and grows the row. Rows are measured, so heights are free.
  - the **id**, pinned right.

  The well's content stays beside the sticky gutter while the columns scroll sideways, so wide sheets keep sub rows readable. Hover steps the well one shade darker, with no lift.
- **Row space.** Sub rows are outside the row space, like bands: the ring, range selection, copy and paste never land on them. They still carry `role="row"`. `aria-level` (tree-grid semantics) is an open question below.
- **Search.** A line's lens record carries its sub rows' printed text under a reserved `$subRows` key, as `$title` is reserved for bands. A line hit only through its sub rows shows them open, with the hit row's index and name in brand. Saved-view counts match the same way.
- **Sticky line.** While an open line's sub rows scroll under the group's sticky band, a copy of the line sticks under the band, with a `border.strong` rule below like the band's copy. As its last sub row leaves, the line is pushed up with it.
  - Both sticky rows are placed from the rows as rendered, not from estimated heights, because sub rows grow when their detail wraps.
  - Pressing the copy first scrolls the line itself back under the band. A click then selects the line in view, and closing its sub rows from there leaves the line where it stood.

## 5. Alternatives considered

- **Two kinds of lead** — a code and a name, or a boxed tag with its text, as the spec draws them. Rejected: the second kind is a style, not different data, and a code and a name carry both (`LABOUR` + its text).
- **Sub rows as a third level of lines** (`Line.lines`). Rejected: they would inherit the columns, and the spec says they must not. The draft model would also have to go three levels deep for rows that are read-only.
- **A render callback returning a UI component**, like Table's `expandedContent: FunctionType([Integer], UIComponentType)`. Rejected as the primary API: Sheet could not align ids down the table, search the content, or keep the tree, index, keyboard and theme consistent. It may return later as a custom slot once there is a concrete need.
- **One function over the whole row returning `Array<SubRow>`.** Less declarative: it trades the field-keyed map for array plumbing in every author's code, and the declaration stops reading like `columns`.
- **Facets as typed columns** (reusing `Sheet.column.*` over the element type). Rejected for v1: facets are labelled text in a wrapping flow, not aligned cells, and column builders would bring parsing and editability the rows do not have.

## 6. Open questions

1. **Facet values beyond text.** Numbers and dates are printed by the author with `East.str` / `East.print` today. Should `Sheet.subRow` accept `Integer` / `Float` / `DateTime` and print them with the column formats?
2. **Long lists.** A line with dozens of entries: show them all (the spec: "never truncate"), or add a `limit` with a "show N more" row?
3. **Rails in the gutter.** The prototype keeps the group's hairline rail running through the sub rows beside the tree's stem, which puts two vertical lines in the gutter. The spec's checkbox column is empty there. Should the group rail stop at sub rows?
4. **Accessibility.** Should the grid become a tree grid (`aria-level` on lines and sub rows, `aria-expanded` on the line), or stay a grid with sub rows described by the line?

## 7. Work breakdown

**`east-ui` (authoring):**
- `types.ts`: `Facet` and `SubRow`; `Line` and `Row` gain `subRows`.
- A new `sub-rows.ts`: `subRows` and `subRow`, and the `SheetArrayField` / `SheetElementOf` / `SheetSubRowSources` typing.
- `root.ts`: the `subRows` option and its build-time validation against the columns' row type.
- `bridge.ts`: compile each mapper once, then project and concatenate.
- The `SheetTag` overloads and the namespace export.
- The SKILL Sheet section, one `sheet.examples.tsx` slot (a grouped sheet with two sources, one of them a variant) wired into `sheet.spec.ts` per EXAMPLES_AUTHORING, and a plugin-index regeneration.

**`east-ui-components` (renderer):**
- `model.ts`: a `subRow` body item after an open line, outside the row space; the sticky band and line, found from the rendered rows.
- `Rows.tsx`: the sub row, the chevron and the stem.
- `index.tsx`: expansion state (per view when lines have stable ids), Space / ⇧Space / ⌥-click, the footer hint, and the sticky line's copy.
- `lens.ts`: search through `$subRows` and opening on a hit.
- The Sheet slot recipe, per the spec.

**Verification:** a flat and a grouped sheet with two sources; an empty source projecting nothing; a `none` facet dropped; long detail wrapping and growing the row; search opening a line through a sub row; the sticky line held under the band and pushed out by its last sub row; the arrays preserved through an edit, `newRow`, `ready` and `onApply`; and, in dark mode, a re-snapshot of the example read as a PNG (the `[Always visually verify]` rule).
