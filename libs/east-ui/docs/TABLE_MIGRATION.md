# Table and Matrix migration — nested rows replace `groupBy` (#954, #955)

The Table's change is first; the Matrix's (#955) follows it in
[The Matrix (#955)](#the-matrix-955) below — the same `tree` option and the same
pre-order walk, with no aggregates.

A Table's rows nest the way the Plan's do since #822: a row carries its
children, to any depth, and a parent IS the group row. It draws its own
cells, and in each column that declares an `aggregate`, the subtotal of what
its children show. `groupBy` is removed, and with it `aggregateRender`. Rows
are addressed by their position in the data's pre-order walk, so a flat table
reads exactly as before — and every row reference now follows its row through
sorting and pagination.

## The wire break — read this first

The `Table` arm of `UIComponentType` changed shape: its rows are a new struct,
its `groupBy` field is gone, a column lost `aggregateRender`, and every event
and the render context gained `path`. beast2 structs and variants are
POSITIONAL, and `decodeBeast2For` ignores the embedded root type, so a
`UIComponentType` value holding a Table serialized before #954 does not decode
against the new type. Re-emit stored values by rebuilding the producing
package; there is no mixed-version compatibility for stored UI values across
this release.

### The wire

| Type | Before | After |
|---|---|---|
| `TableRowsCollectionType` | `Array<Dict<String, Cell>>` | `Array<TableRowType>` — the rows in PRE-ORDER: each parent, then its subtree |
| `TableRowType` (`Table.Types.Row`) | — | `{ cells: Dict<String, Cell>, depth: Integer, collapsed: Boolean }` — a parent is followed by the rows after it with a greater `depth`; a flat table's rows are all at `depth` 0 |
| `TableRootType.groupBy` | `Option<Array<TableGroupLevelType>>` | removed, with `TableGroupLevelType` and `TableGroupByInput` |
| `TableColumnType.aggregateRender` | `Option<Fn(Cell) → UIComponent>` | removed — a parent's subtotal draws through the column's `render` or `format` |
| `TableCellRenderContextType`, `TableCellClickEventType`, `TableRowClickEventType`, `TableRowSelectionEventType` | `rowIndex` (+ …) | `rowIndex` — the pre-order index — and `path: Array<Integer>`: `[i]` for the i-th top-level row, `[i, j]` for its j-th child |
| a paged source's windows | windows of `Dict<String, Cell>` rows | whole TOP-LEVEL rows, each with its subtree, flattened to `TableRowType`s by the factory as each window lands |

The row type is declared through an interface, as `TickFormatType` is
(#874): the Table arm of `UIComponentType` spells it, and a structural type
there would serialize into every declaration that names the component.

## Removals and their replacements

| Removed | Replacement | Example |
|---|---|---|
| `groupBy={[r => r.section, { value: r => r.category, collapsed: true }]}` over flat rows | nest the DATA and declare `tree={{ children, collapsed? }}`. A `RecursiveType` row nests by its own field — `RecursiveType((self) => StructType({ …, lines: ArrayType(self) }))` with `tree={{ children: (r) => r.lines }}` — and flat rows nest by a lookup, the data holding only the top-level rows: `tree={{ children: (r) => all.filter((_$, c) => c.parent.equal(r.id)) }}`. `children` returns more rows of the data's own element type; another type is refused at build, naming the expected one. A group becomes a parent row that carries its label in its own cells. | `tablePnl`, `tableNumberFormats`, `tableTree` |
| `groupBy` level `collapsed: true` | `tree={{ collapsed: true }}` (every parent), or `tree={{ collapsed: (r) => … }}` per row | `tablePnl`, `tableTree` |
| `aggregateRender: fn(Cell) → UIComponent` | the column's `render`: a parent's cell in an `aggregate` column carries its subtotal as `ctx.cellValue`, so one render draws every row's cell. A `count` prints itself (a whole number, in no column's format), and no render sees it | `tablePnl` |
| `groupBy` refused on a paged source | a paged source nests like inline data: it pages its top-level entries, each carrying its subtree | `tableTreePaged` |

Until `toTree` (#948) lands, grouping flat rows is a data step before the
table — a lookup as above, or rows reshaped into a recursive type.

## Behaviour that changed

| | Before | After |
|---|---|---|
| Hierarchy | `groupBy` levels over printed keys; synthetic header rows | the data's own nesting; a parent is a row |
| A parent's cells | a group header: label + aggregates | its own cells; in an `aggregate` column its children's subtotal, composed bottom-up — `sum` of sums, `mean` of means (always a Float), `min` / `max` of theirs, `count` the leaves beneath (a leaf counts 1, a parent its own count). A subtotal cell carries `data-subtotal` and reads semibold |
| Fold | a caret on the group header | a caret before the first data cell of every parent, indented one step per depth (the Plan's step: a 14 px caret and its 6 px gap, so a leaf child's label starts where its parent's does). Collapsing hides exactly the row's descendants; the caret is a button with `aria-expanded`; the viewer's folds persist under the `storageKey` by path |
| Sorting | members within their group; groups in first-appearance order | siblings within their parent (ties keep data order); a parent carries its subtree, and sorts by what it draws — its subtotal in an `aggregate` column |
| `rowIndex` in events, `rowStatus`, `expandedContent`, review, `selection` | the DISPLAY position (the tint, the expanded detail, the checkbox) or the index within the page (clicks, `expandedContent`) — each moved to another row under a sort or a page | always the pre-order index over the whole data, so each follows its row through sorting and pagination |
| `pagination` | `pageSize` rows | `pageSize` top-level rows, each with its subtree; the pager counts top-level rows |
| Selection | per row | per row: a parent's checkbox selects the parent only; select-all selects every row in the data; a shift-click range spans the rows between, as displayed |
| Virtualization | over group headers + leaf rows | over the open rows in display order |

A shift-click in `range` mode used to fire the checkbox's click AND its
change, and the plain toggle overwrote the range; the range now stands.

## Renderer (`@elaraai/east-ui-components`)

- The `table` slot recipe loses `groupHead`, `groupHeadCell` and
  `groupHeadAggregate`, and gains `treeIndent` (the lead of a row's first cell,
  its depth the `--table-depth` variable) and `treeToggle` (a parent's caret);
  `cell` styles `[data-subtotal]`.
- A nested table's body rows carry `data-depth` and, on a parent,
  `data-parent`; the caret is `data-slot="treeToggle"`, and the indent
  `data-slot="treeIndent"`. A flat table draws neither.
- The persisted state's `groupCollapse` is `folds` (a parent's path, `0.2`, to
  whether the viewer folded it).

## Example map

| Before | After |
|---|---|
| `tablePnl` (flat lines under `groupBy`) | `tablePnl` — the P&L as nested data, subtotals through one currency `render` |
| — | `tableTree` — a four-deep bill of materials: a Currency-formatted `sum`, a leaf `count`, a collapsed assembly |
| — | `tableTreePaged` — the same tree over a paged source, one top-level assembly per window |
| `tableNumberFormats` (a `groupBy` over regions) | `tableNumberFormats` — the regions as parent rows: a Currency `sum`, a Percent `mean`, a bare `sum`, a year's `max` and a line `count`, each printed by #874's rules |

## The Matrix (#955)

A Matrix's `groupBy` banded consecutive rows under a printed label, one level
deep, and a band had no cells — so a team inside a department could not be
said, and a team's own utilisation had nowhere to sit. Now a Matrix's rows nest
the way the Table's do: `tree={{ children, collapsed? }}`, a row carrying its
children to any depth, walked in pre-order by the same function
(`libs/east-ui/packages/east-ui/src/shared/tree.ts`). A parent is a full row:
its header, indented with a fold caret, and its own cells from the same `cell`
builder. The Matrix has no aggregates — a segment bar has nothing to fold — so
a parent's bars are whatever its row builds.

### The wire

| Type | Before | After |
|---|---|---|
| `MatrixRowType` (`Matrix.Types.Row`) | `{ key, value, sublabel, group: Option<String>, cells }` | `{ key, value, sublabel, depth: Integer, collapsed: Boolean, cells }` — the rows in pre-order, a parent followed by its subtree |
| `MatrixRootType` | `height` / `maxHeight` before the callbacks | the `component.ts` arm's order — the callbacks, then `height` / `maxHeight` (the mirror had drifted from the wire; `matrix.spec.ts` now holds the two to one type) |
| `MatrixConfig.groupBy` | `(row) => String` | removed — nest the data (`tree`) |

Stored `UIComponentType` values holding a Matrix re-emit.

### Removals and their replacements

| Removed | Replacement | Example |
|---|---|---|
| `groupBy={r => r.team}` over flat rows | nest the data: a `RecursiveType` row with `tree={{ children: (r) => r.members }}`, or a lookup among flat rows of one struct — the data holding the top-level rows, `tree={{ children: (r) => people.filter((_$, p) => p.team.equal(r.name)) }}`. A band becomes a parent row with its own header and cells | `matrixHeatGrid` (recursive), `matrixVariants` (lookup) |

### Behaviour

- **A parent is a row.** It draws its header and its own cells; its caret — the
  Table's, before its name, one step (20px) per depth — folds exactly its
  subtree, and a leaf child's name starts where its parent's does. A flat
  matrix draws neither.
- **Folds persist by path**, never by key, so two parents sharing a key fold
  apart. A parent absent from the persisted folds starts as its row declares.
- **Events keep the row's key** (`onCellClick { row, column }` and the segment
  events), at any depth — a nested matrix keys its rows uniquely across the tree.

### Renderer (`@elaraai/east-ui-components`)

- The `matrix` recipe loses `groupHead` / `groupHeadCell`; the row header is a
  row of the Table recipe's `treeIndent` / `treeToggle` and a new
  `rowHeaderText` column (a flat matrix lays out as before).
- A nested matrix's rows carry `data-row-key`, `data-depth` and, on a parent,
  `data-parent`; the persisted state gains `folds`.
