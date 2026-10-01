# Query Builder — the design of record

> **Status: Proposed** · e3-ui · companion to [`Query Editor Spec.html`](./Query%20Editor%20Spec.html),
> the mock of record ([resting render](./Query%20Editor%20Spec.png)): 01 the query editor and 02 the query
> library; append `?theme=dark` for dark. The mock shows the design; **Studio's patterns decide how it is
> built** ([`Studio Spec.md`](./Studio%20Spec.md)). Where the product departs from the mock, §9 says what it
> does instead and what is lost. On behaviour and API, this document is the design, and each part names the
> child of #875 that builds it.

Operators build **typed jq queries** over the datasets a page binds — as visual steps in plain words, or as
jq — see them checked as they edit, and run them to read the result. A solution declares **one record** of
saved queries, written through one patch mutation. Every edit is a draft of the shared editing session, and
a save is one audited, typed patch commit on the record, as Studio's pages are.

| Layer | Lives in | Written by | Holds |
|---|---|---|---|
| **Data sources** | the page: `Data.bind`, `Data.bindPaged`, `Record.bind` | developers | What a query may read — the root, `.orders`, `.customers` — by the names the page gives them |
| **Saved queries** | one `e3.record` of `Query.Types.Saved`, written through `e3.mutation.patch` | operators | Queries by name: each checked (`QueryType`), the data sources it reads, an optional description and when it was saved |
| **Surfaces** | `ui()` tasks | developers | `<Query.Builder>` and `<Query.Library>`, bound to the record and handed the data sources |

The query language is #875's typed jq over East values (`libs/east/devdocs/QUERY.md`). The builder draws no
assistant: the chat epic (#883) owns the editor's Elara side, and nothing here builds it.

---

## 1 · What a solution writes

The flagship example (`packages/e3-ui/test/query/query.examples.tsx`, #940) is this solution over #875's
shared fixture (§6): orders, customers, a bill of materials, a forecast and a demand model.

### The saved queries

```ts
export const queries      = e3.record("queries", Query.Types.Saved, new Map());
export const queriesPatch = e3.mutation.patch(queries);
```

`Query.Types.Saved` is `Dict<String, Query.Types.SavedQuery>`, keyed by the query's name. A `SavedQuery` is
`{ name, description, query, root, saved_at }`:

- `query` — the checked query (`QueryType`, #919): the program as written and what the checker made of it.
  A query saves only once it checks.
- `root` — the `{ name, path }` of each data source it reads, in root order
  (`Query.Types.RootEntry`, #935). A saved query opens only where each entry is bound, by name and by path.
- `description` — `Option<String>`: one sentence, at most 140 characters. With none, what shows is the
  sentence generated from its steps (§4.13).
- `saved_at` — when it was last saved.

The type never depends on the data sources, so a deploy that adds or changes one runs no migration.

### The surfaces

```tsx
// The builder, for operators: it queries the data sources it is handed, and saves through the record.
export const builder = ui("query_builder", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const orders    = $.let(Data.bindPaged(d.orders));   // large: paged, never downloaded whole
        const customers = $.let(Data.bind(d.customers));
        const bom       = $.let(Data.bind(d.bom));
        const saved     = $.let(Record.bind(d.queries, [d.queriesPatch]));
        return <Query.Builder queries={saved} datasets={{ orders, customers, bom }} />;
    }}</Reactive>
)));

// The query library: every saved query, and where new ones start.
export const library = ui("query_library", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const orders    = $.let(Data.bindPaged(d.orders));
        const customers = $.let(Data.bind(d.customers));
        const bom       = $.let(Data.bind(d.bom));
        const saved     = $.let(Record.bind(d.queries, [d.queriesPatch]));
        return <Query.Library queries={saved} datasets={{ orders, customers, bom }} />;
    }}</Reactive>
)));
```

`datasets` names the root: a query over this page reads `.orders`, `.customers` and `.bom`, and nothing else.
`id`, on both, names the builder when one surface holds two, and the library that opens queries in it.
`onOpen`, on the library, is told the name of each query it opens, so the host can show the builder.

The public `Query` namespace is exactly this: `<Query.Builder>`, `<Query.Library>` and `Query.Types`.

---

## 2 · Decisions

1. **Two components, no turnkey app** (Studio's 1). The builder and the query library are components a
   solution places where it wants. The builder's parts — its steps, its jq view, its Datasets and Library
   tabs, its results — are its insides, not API.
2. **Public is what a solution mounts** (Studio's 2). The East functions behind the builder's and the
   library's reads and writes are internal (`QueryInternal`, `@elaraai/e3-ui/internal`).
3. **A query reads only what the page binds.** The root is exactly the bound data sources, by the page's
   names. Scope is the `ui()` task's manifest, so the builder declares nothing of its own.
4. **Queries are data, typed.** A saved query is its checked `QueryType`, the data sources it reads and a
   description — never text to re-parse, never IR. It saves only once it checks.
5. **Records first** (Studio's 4). Every save is one patch commit of the one entry it writes, computed in
   East. A save drafted on a stale entry is a conflict, and nothing is overwritten.
6. **One history** (Studio's 5). The builder's edits are drafts of the shared editing session
   (`EditSession` through `useEditSession`, `east-ui/src/contracts/editing.ts`): one undoable transaction per
   gesture. The history item (`historyToolbarItem`) undoes, redoes, discards and applies, and Apply saves the
   open query.
7. **Every component is an interface and a renderer** (Studio's 6). Its e3-ui factory builds its payload
   only, carried by `EastUI.component`; its React renderer builds it in the browser from the design system's
   React components. No factory composes East UI components (`docs/conventions/EAST_UI_PROP_PATTERNS.md`).
8. **Headerless, one toolbar, no outer border** (Studio's 7). Each component's controls sit in its one
   toolbar and its read-outs in its footer; neither draws a border around itself, so a host frames it or
   places it bare.
9. **Studio's parts over the mock's chrome.** The pane is a `DockPane` with tabs, the lists are `Library`s,
   the popovers `NamePopover`s, the notices `BannerView`s, the toolbar the shared `Toolbar`, as Studio's are.
   §9 lists each place the mock differs, and what is lost.
10. **Checking is free, running costs** (the brief). Every edit is checked in the browser at once. Data is read
    only on Run (⌘⏎), when a saved query is opened, and for a value slot's summary (§4.5). The query library
    reads no data at all: its cards are wireframes of each query.
11. **One program, two views; plain words first** (the brief). Visual steps are a projection of the jq:
    canonical forms become steps, anything else stays a jq step and is still checked. The visual view shows
    no jq vocabulary; the East type and the checker's message are one step away, on hover or in the jq view.

---

## 3 · Architecture

### The carriers (`@elaraai/e3-ui`)

| Component | Carrier | Payload |
|---|---|---|
| `<Query.Builder>` | `QueryBuilder` | `queries` — the bound record's `read`, `history` and `commit.patch`; `datasets` — each bound source's name, descriptor and type; `id` |
| `<Query.Library>` | `QueryLibrary` | `queries`; `datasets`; `id`; `onOpen` |

Each follows Studio's shape (`e3-ui/src/studio/builder.ts`): a payload type, the carrier
`EastUI.component("QueryBuilder", payload, { optional: true })`, an options interface, a `create…` that
returns the carrier's `Root`, and the tag `optionsTag(create…)`. `datasets` is an object of name → binding
(`BoundValue`, `PagedValue` or `BoundRecord`): the factory reads each binding's descriptor and value type,
so only bound sources can be queried, and a builder handed none is refused when the surface is built. A
surface's `ui()` manifest follows from the payload: the record and its patch, and each bound source.

`QueryInternal` holds the East behind them: the patch a save commits (`save`, by name: an insert, an update
of the open query's entry, or a rename's delete and insert in one patch), a refused write in words
(`nameWriteRefusal`, as Studio's), the library's rows and counts, and whether a saved query's root is bound
on this surface — and if not, why not (`rootBound`: `bound`, `missing` a name, or bound `elsewhere`, which
the renderer words as "Reads {name}, which isn't here" and "Reads {path}, not this builder's {name}").

### The renderers (`@elaraai/e3-ui-components`)

Each decodes its payload and builds the component in the browser (`src/query/`, beside `src/studio/`). What
each part shows is e3-ui's East, compiled once on first use (`queryEast()`, as `studioEast()`), or #875's
functions, which run in the browser too: the checker, the translator, completions and summaries (#921,
#922), and the builder's one-shot call (#935: `prepareQuery` and `queryResultOf`), which it sends with
e3-api-client's `oneShotExecute`.

- **The builder** is Studio's builder with the query where the canvas is:
  - its one **toolbar**, the shared `Toolbar` (§4.1);
  - its **pane**, a `DockPane` before the results with the tabs **Query**, **Datasets** and **Library**
    (§4.2), as Studio's palette is a `DockPane` with Components and Pages;
  - its **results** after the pane (§4.11), and its **status line** under both (§4.12).
- **The editing session** is one per open query, as Studio's is one per open page (`useQuerySession`). Its
  entries are the open query's steps, each drafted whole (#933's step type in `EditingDraftFieldType`, as
  Studio drafts a cell), and its header as one entry more: the name, the description, the data source the
  steps start from, and the program as jq when it is not steps (one that does not start from a data source).
  Its snapshot is the saved query's header and steps, parsed once per saved entry, since a parse gives fresh
  ids; a new query's is its header alone. Apply (`onApply`) prints the steps as canonical jq, prepares the
  program over the root (`prepareQuery`), and commits the query as one patch through the record's patch
  write (`QueryInternal.save`). The entries it applied become the snapshot of the query it saved, so the
  session acknowledges its own commit, and a save under a new name opens that query once it has. Its
  readiness is the checker's: a problem is an `invalid` issue and an unfinished step an `incomplete` one, so
  Apply waits for both, and the history item's issues button goes to each.
- **The root** is each bound data source as a root field, in the order given: a `Data.bind` source's path, a
  record's `[records, name]`, and a `Data.bindPaged` source's path as the paged runtime that built its handle
  holds it — the handle's `id` joins the path's segments with dots, which cannot be read back exactly. A
  paged source read through one of a record's indexes is refused: its rows are the index's.
- **A one-shot call** — a run's or a summary's — goes through `useQueryCall`: a host's `QueryCallProvider`,
  else e3-api-client's `oneShotExecute` against the `E3Provider`'s server and workspace.
- **The open query** is the UI store's, under the builder's key (`queryKeys(id).query`), as Studio's open
  page is (`builderKeys(id).page`). The Library tab, `<Query.Library>` and a drop write it; the builder reads
  it. It begins as a new query on the first bound data source.
- **The query library** keeps its filter, search, order and layout as its own; its body is one
  `Library` gallery whose media are wireframes of each query (§5).

### Who builds what

| Part | Where | Child |
|---|---|---|
| Canonical steps: steps ↔ canonical jq, their shapes, diagnostics mapped to steps | e3-ui `src/query/` (the step types, in `Query.Types`), e3-ui-components `src/query/steps/` (the functions) | #933 |
| Plain words, step cards, slots, autocomplete, summaries | e3-ui-components `src/query/` | #934 |
| `Query.Builder`, `Query.Types`, the saved queries, the renderer shell, a query's one-shot call and the editing session; `DockPane`'s open tab driven by its host | e3-ui `src/query/`, e3-ui-components `src/query/`, east-ui-components `layout/dock/` | #935 |
| The toolbar, the Query tab, the status line and saving | e3-ui-components | #936 |
| The jq view | e3-ui-components | #937 |
| Runs and results | e3-ui-components | #938 |
| The Datasets and Library tabs, and dropping queries in | e3-ui, e3-ui-components | #939 |
| `Query.Library` | e3-ui, e3-ui-components | #1063 |
| Examples, showcase, DOM probe and SKILL; this document as built | e3-ui, showcase | #940 |

---

## 4 · The builder

### 4.1 The toolbar

One row, the shared `Toolbar`, folding on its ladder as Studio's toolbars do:

- **Start:** **Visual · jq** (`SegmentGroup`; `diagram-project` · `code`), as Studio's canvas toolbar holds
  Desktop · Tablet. Picking one opens the Query tab and expands the pane.
- **End:** **Table · Tree** and **Download ▾** for the result (§4.11; disabled without one); the **history
  item** (`historyToolbarItem`: its status line, its issues, Undo, Redo, Discard and Apply — worded **Save**
  in the builder's words); **Copy jq**; **Save…** (§4.13); and **Run**, the one primary button, with its
  shortcut in a `Kbd` (⌘⏎) and "Running" with a spinner while a run goes.

### 4.2 The pane

A `DockPane` (`side="start"`, `surface="shell"`), as Studio's palette: `min(480px, 52%)` wide, and
`min(640px, 52%)` while the Query tab shows jq. Collapsed, it is the 44 px rail, as the palette's is: the
pane's icon (`diagram-project`), its name, "Query", and the step count as its badge. The tabs:

- **Query** — the steps (§4.3–§4.7), or the jq (§4.8).
- **Datasets** — the bound data sources (§4.9).
- **Library** — the saved and recent queries (§4.10).

Unlike Studio's palette, this pane holds the thing being edited, so the builder opens its tabs: opening or
starting a query and picking Visual · jq open the Query tab, and ⌘/ opens Datasets. `DockPane`'s open tab
becomes the host's to drive — `tab` and `onTabChange`, as its `collapsed` and `onCollapsedChange` already
are (#935); a pane that passes neither keeps its own, as today.

A notice that says what just happened is a `BannerView` at the top of the Query tab — "Opened “Top shipped
orders, 2026” from the query library.", "Started a new query on customers.", "2 parts of the jq don't match a
visual step, so they stay as jq." — dismissible, with no undo of its own (§4.13).

### 4.3 The Query tab: the source, the steps and their shapes

Its parts are the `queryBuilder` slot recipe's, on semantic tokens; a size the design system has (buttons,
icon buttons, inputs, chips) is the design system's.

- **The source**: "Start with {source}" over "{workspace}.{source} · {plain kind}" ("list of orders").
- **Shape lines** follow the source and every step: the shape in plain words ("Many shipped orders"), or
  counted after a fresh run ("16 shipped orders"); where the type changed, "+ name, region" (after Look up
  and Take part of a date) or the fields after it; the East type on hover (`Tooltip`); and **Insert**, which
  opens the add-step list for that point (§4.5).
- **A step card**: its number (mono), its icon and title (§4.4), its head slot when it has one ("all of these
  are true"), and Move up, Move down and Remove (icon buttons, quiet until hovered; Move up is off on the
  first step, Move down on the last). A step not yet finished is dashed, with "Not in the query until it's
  finished."
- **Rows** of words and parts. A **slot** is the `select` trigger: filled, solid; empty, dashed, with its
  placeholder word ("field", "value"); with a problem, the danger tone and a message line under its row with
  the checker's fixes as buttons ("Keep only shipped orders first", "Use total"). Numbers, IDs and dates are
  mono. Names ("as revenue") and counts ("first 10") are inputs; a lookup's fields are chips with ×. Joiners
  (`and`, `or`) sit in a fixed column so conditions line up.
- **Groups** of conditions, each with its own all / any and "Add condition"; **feet** ("Add condition", "Add
  group", "Add a total", "Add field"); **notes** ("Left empty when a customer isn't found."); and a jq step's
  **code** (the `codeBlock` recipe).
- **No steps**: "Add a step to narrow, reshape or total the rows, or start from a saved query."
- **The foot**: "Add a step at the end" (dashed), and **Quick add** — Keep rows, Group and total, Sort by,
  Keep the first and Show only fields, plus List every part in the tree and Try the model over a range where
  they fit. A step that doesn't fit is disabled, with its reason on hover.

Every change here is one gesture of the editing session: picking a slot's value, a name or a count typed and
left, a step added, moved or removed, a fix taken, the jq edited and left. The history item undoes each.

### 4.4 The step catalogue

Every step has a title, an icon, its rows, defaults when added, the canonical jq it prints (§4.7) and the
checks it makes (§4.6). Values in quotes are copy.

| Step | Title · icon | Rows | Defaults when added |
|---|---|---|---|
| Keep rows where | "Keep rows where" · `filter` | Head (2+ conditions): all\|any "of these are true / is true". One row per condition: joiner, **field**, **compare**, **value** (or the inner condition), ×. Foot: Add condition, Add group | all, one empty condition |
| Look up | "Look up from another dataset" · `arrow-right-arrow-left` | "find" **key** "in" **dataset**; "bring in" field chips + Add field; note "Left empty when a {singular} isn't found." | the first bound lookup table; the key its key type's first matching field; one value field |
| Group and total | "Group and total" · `layer-group` | "by" **field** (or "all rows together"); per total "then" / "and" **total** **field** "as" *name*, ×; foot Add a total | by empty, count as count |
| Sort | "Sort" · `arrow-down-wide-short` | "by" **field** **order** | field empty, descending |
| Keep the first | "Keep the first" · `list-ol` | *n* then the plural noun ("10 orders") | 10 |
| Count the rows | "Count the rows" · `hashtag` | "gives one whole number" | — |
| Show only fields | "Show only these fields" · `table-columns` | per field **field** "as" *name*, ×; foot Add field | the first three non-list, non-payload fields |
| Fill in missing values | "Fill in missing values" · `fill-drip` | "where" **field** "is missing, use" *value* | the first optional field; 0 for a number |
| Open each list | "Open each {noun}'s list" · `arrow-turn-down` | "open" **list** "one row per {item}[, keeping the {noun} ID]" | the first list field |
| Take part of a date | "Take part of a date" · `calendar-day` | "take the" **part** "of" **date** "as" *name* | the first date field, month |
| List every part in the tree | "List every part in the tree" · `sitemap` | "every level, keeping {scalar fields}" | — |
| Try the model over a range | "Try the model over a range" · `chart-line` | "{input} from" *a* "to" *b* "every" *step*; a slot per other input; "call the result" *name* | the first Float input, 10 to 12 every 0.5 |
| jq step | "jq step" · `code` | the jq text as code | — |

**Inner conditions** ("has any where") continue the row over the list's element: **field in each item**,
**compare**, **value** (`lines` → `sku is BRK-100`).

**Comparisons by field kind** (the compare slot offers only these):

| Kind | Comparisons |
|---|---|
| text | is, is not, contains, starts with |
| whole number, number | is, is not, is at least, is at most, is more than, is less than |
| date | is in year, is in month, is on or after, is before |
| one of (a case) | is, is not |
| yes or no | is yes, is no |
| list | has at least, has any where |
| optional, any kind (not a case's payload field) | the above, and is missing, has a value |

Picking a field sets a default comparison — date → is in year; list → has at least (1); yes or no → is yes;
numbers → is at least; else is — and a new field of the same kind keeps the comparison and value.

**Variant fields** appear twice: the **case** ("status", compared with is / is not) and each struct case's
payload fields ("shipped date"), grouped "Inside status" and marked "shipped orders only" until the rows are
narrowed. Under all, `status is shipped` narrows the rows: later conditions and steps read "shipped date",
and the shape reads "Many shipped orders".

### 4.5 Autocomplete

A slot opens a popover of the design system's chrome, listing with the `combobox` recipe: its label, a
filter field, grouped options (an icon, a label, a sub-line, a meta at the end), and a footer naming where
the options come from and "↑↓ ⏎ esc". ↓ ↑ move and wrap, ⏎ or Tab pick, Esc closes; typing filters. Picking
fills the slot and opens the next empty one, so a condition goes field → comparison → value without a
click between. It opens with the slot's current value active.

| Slot | Offers | Source |
|---|---|---|
| Field | The fields of the shape at that step, with their plain kind and a summary ("8 values", "0.85 – 3,646.84", "3 cases", "1–4 each", "· 12 missing"); payload fields under their parent, "shipped orders only" | Checked type + summary |
| Compare | The comparisons for the field's kind | Checked type |
| Value | Cases with counts; text values with counts (the top 12); lowest, median, average and highest numbers; years and months in the data; a typed value first as "Use “x”" | Summary up to this step |
| Match | all "every condition holds", any "at least one holds" | — |
| Find by · Dataset · Bring in | The lookup table's key fields; the bound lookup tables ("{n} {plural}"); its value fields | Checked type |
| Group by · Total · Of | "all rows together", then groupable fields; add up, count, average, lowest, highest, count different; the fields each total takes | Checked type |
| Sort by · Order | Sortable fields; newest / oldest first, A to Z / Z to A, highest / lowest first | Checked type |
| Add field · Field (fill) · List · Part · Date | Fields not yet chosen; optional fields; list fields; year, month, weekday; date fields | Checked type |
| Add a step | The steps that fit the shape there (§4.4); with no steps, up to five saved queries on the same source | Checked shape + the record |

A step that doesn't fit is listed disabled with its reason: "Needs a tree of parts", "Needs a calculation",
"Nothing to use it on here", "Needs rows — the query gives {shape} here".

**Summaries.** A value slot's offers and a field's summary come from the summary of the rows at that step:
#875's summary program (#922) over the program up to the step, run as a one-shot call (#935) with small
limits when a popover that needs it opens, and cached by the program and its inputs' hashes. It is the one
read that is not a Run, and it is never shown as a result.

**What picking does.** A field keeps a matching comparison and value and opens the value (or the inner
field); a comparison keeps the value unless its kind changes; a total renames itself while its name is its
own ("count", the field, "max_cost"); a shown field is named by its last part; a date part rewrites a
trailing year / month / weekday in its name; an added step takes its defaults and opens its first empty
slot. Counts and numbers read as numbers (thousands commas dropped); names become identifiers.

### 4.6 Checking and problems

The query is checked after every edit, without reading data: the canonical steps print as canonical jq
with spans, the whole program goes through the checker once, and each diagnostic maps back by span to
the step, condition and slot it came from (#933). The step model words it — the plain message below for
the codes it can phrase for that step, else the checker's own (#934). Completeness ("Choose a field",
"Enter a value") is the steps' own check, since an unfinished step is not in the program.

The editing session's readiness is the check: problems are `invalid` issues and unfinished steps
`incomplete` ones, and the history item counts them and goes to each. Reading a payload field before the
rows are narrowed is a problem whose fix, **Keep only shipped orders first**, adds `status is shipped` to
the step (or a Keep rows where step before it).

| Where | Plain words | Checker | Fix |
|---|---|---|---|
| a step on one value | "{Shape} — there are no rows to {verb} here." | `type_mismatch` (`map`, `sort_by`) · `not_indexable` (a slice) · `not_iterable` (`.[]`) | Remove this step |
| a field slot | "Choose a {what}." | — | — |
| a field of the wrong kind | "{Label} is {kind} — pick a {what}." | `type_mismatch` | — |
| an unknown field | "There's no “{name}” here. The rows have {labels}…" | `unknown_field` | Use {label} |
| a payload field, not narrowed | "Only {case} {plural} have a {label}." | `type_mismatch` | Keep only {case} {plural} first |
| an unknown case | "{Label} can be {cases} — not “{v}”." | `unknown_case` | Use {x} |
| a whole variant compared | "Compare the {label} case, not the whole value." | `type_mismatch` | Use .{F}.type |
| no comparison · no value | "Choose how to compare." · "Enter a value." | — | — |
| a comparison for another kind | "“{cmp}” doesn't work on {kind}." | `type_mismatch` | — |
| has at least · in year · in month · on or after | "Enter a whole number of items." · "Enter a year, like 2026." · "Enter a month, like 2026-03." · "Enter a date, like 2026-03-01." | `type_mismatch` | — |
| a number that isn't | "{Label} is a {kind} — “{v}” isn't one." | `type_mismatch` | — |
| a whole number against a fraction | "{Label} is a whole number, so it can never equal {v}." | `type_mismatch` | — |
| an inner condition · an empty group · a filter with none | "Finish the inner condition." · "This group is empty." · "Add a condition, or remove this step." | — | — |
| Look up | "{dataset} can't be looked up by key." · "{Dataset} are found by {kind} ids, but {label} is a {kind}." · "{Noun} records have no “{f}”." | `not_indexable` (the steps', for a data source that is not a Dict) · `type_mismatch` · `unknown_field` | Use {label} |
| Group and total | "Choose what to group by." · "Can't add up {label} — it's {kind}. Pick a number, or count instead." · "{Label} has no lowest or highest." · (warning) "Two fields are called {x}; the last one wins." | `type_mismatch` · lint | Use {number fields} |
| Keep the first | "Keep the first needs a whole number, 1 or more." | `type_mismatch` | — |
| Fill (warning) | "{Label} is never missing, so this changes nothing." | lint | — |
| List every part · Try the model | "There is no tree to walk here." · "There is no calculation to try here." · "The range needs a start below the end and a step above 0." · (warning) "That range gives more than 1,000 rows; results will be cut off." | `type_mismatch` · `too_many_rows` (the steps') | — |
| the program | "The jq has a stray bracket." · "A text value is missing its closing quote." · "A bracket is never closed." · "The query ends with a pipe." · "The query is empty." · "There's no data source called “{x}”." · "Start the query from a data source." | `syntax` · `unknown_field` · `unsupported` | Use .{y} |
| a jq step | "Custom jq step." | (note) "Not a visual step: it stays as jq in the visual editor." | — |
| an excluded builtin | "{name} isn't available in queries." | `unsupported` | — |
| `select(.x[] \| …)` (warning) | "Rows can appear more than once." | `duplicate_outputs` | Use any(.x[]; …) |

The checker's words are #875's (QUERY.md §12); the plain words are the step model's (#934).

### 4.7 Canonical jq

The steps print as one program, one segment per line joined by "\n| "; a lookup binds its data source
first. The fixture's default query prints:

```
.customers as $customers
| .orders
| map(select(.status.type == "shipped") | select(.total >= 100 and (.status.value.date | year) == 2026))
| map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})
| map({order: .id, customer: .name, region, total, shipped: .status.value.date})
| sort_by(-.total)
| .[:10]
```

| Step | Canonical jq |
|---|---|
| (prologue) | `.{ds} as ${ds}` for each data source a finished Look up reads, then `.{source}` |
| Keep rows where | `map(<select(case) per narrowing condition> \| select(<the rest, joined by and / or>))`; a group in parentheses where jq's grammar needs them — an any group inside all, `a and (b or c)`, but not an all group inside any, `a or b and c` |
| — conditions | `p == v`, `!=`, `>=`, `<=`, `>`, `<`; `(p \| contains("v"))`; `(p \| startswith("v"))`; `p == null` / `!= null`; `p == true` / `false`; `(p \| year) == 2026`; `(p \| strftime("%Y-%m")) == "2026-03"`; `p >= "2026-03-01"` / `<`; `(p \| length) >= n`; `any(p[]; <inner>)`; a payload field `.F.value.P`, a case `.F.type` |
| Look up | `map(. + {f: $ds[<key>].f, …})` |
| Group and total | `group_by(<by>)\n\| map({<by name>: .[0]<by>, <name>: <total>, …})`; totals `length`, `map(f) \| add`, `map(f) \| add / length`, `map(f) \| min`, `map(f) \| max`, `map(f) \| unique \| length` — an object's value takes no parentheses; all rows together `{<name>: <total>, …}` |
| Sort | a number, descending: `sort_by(-f)`; otherwise `sort_by(f)`, with `\n\| reverse` for descending |
| Keep the first · Count | `.[:n]` · `length` |
| Show only fields | `map({a, b: .x.y})` |
| Fill in missing | `map(f //= v)` |
| Open each list | `[.[] \| . as ${noun} \| f[] \| . + {{noun}_id: ${noun}.id}]`, or `[.[] \| f[]]` |
| Take part of a date | `map(. + {name: f \| year})`; `strftime("%Y-%m")`, `strftime("%A")` |
| List every part | `[recurse(.<children>[]) \| {<scalar fields>}]` |
| Try the model | `[range(from; to + step/2; step) as $p \| {p: $p, name: call(.; {p: $p, k: "fixed", …})}]` |
| jq step | its text, trimmed |

A group's key reads its first row, `.[0]<by>`, which the checker types as an option: after Group and total
the key is optional (`customer_id: Option<String>`).

Unfinished steps are left out. **Parsing back** works on #875's AST, not text: every canonical form becomes
its step again, groups, inner conditions and narrowing included; anything else becomes a jq step, and
everything after a jq step stays jq. A syntax error keeps the query in jq with "Fix the syntax problem first —
the visual steps are built from the jq." Printing a parsed query gives the canonical text back; the round
trip is tested over the catalogue (#933).

### 4.8 The jq view

The Query tab in jq: a note while visual steps are left out ("1 unfinished step is left out of the jq until
it is finished."), then the editor filling the tab (the `jqEditor` slot recipe):

- **A gutter** of line numbers, each with a dot in the colour of the worst problem starting on it.
- **The code**: a transparent textarea over its highlighting, mono, no wrap. Keywords and variables in the
  brand's strong ink, builtins and formats in the brand's, fields in the ink, strings and comments muted,
  numbers in the second ink, pipes and operators in the fourth, an unreadable character in the danger tone.
  Problems underline their range: wavy danger for an error, wavy warning, dotted for a note.
- **Completions** after a word character, `.`, `"` or `$`, and on Ctrl Space: the data sources at the root,
  a path's fields with their types, a variant's `type` and `value`, a narrowed case's fields (others marked
  "only when .F.type == "c""), case names, the data's values, a lookup table's keys, bound variables, and the
  builtins with their signatures (#922's `completeJq`). ⏎ or Tab accept; Esc closes.
- **The problems panel**: "{n} problems · {m} warnings" or "Checks clean", then one row per problem — its
  code, "L{line}:{column}", the checker's message, and its fixes that are text edits. A row's click selects
  its range.
- ⌘⏎ runs; Tab inserts two spaces. Leaving the view parses the jq back into steps (§4.7) as one gesture.

### 4.9 The Datasets tab

A `Library` of the bound data sources, as Studio's Components tab is a `Library` of the listed components:

- **Groups** by kind, each with its count: Rows (arrays), Lookups (dicts), Values (trees and records) and
  Models (functions).
- **An item**, as a palette card: its kind's icon (`table-list`, `key`, `sitemap`, `cube`, `calculator`), its
  name, "{size} · #{hash}" under it — "40 orders", "8 customers by ID", "14 parts in one tree", "5 regions",
  "price, region → number" — and, trailing, **Source** or **Looked up** when the open query reads it (the item
  is `placed`).
- **A click** starts a new query on it (§4.13); the query that was open keeps its drafts.
- The `Library`'s own search, over names; ⌘/ anywhere in the builder opens the tab.

### 4.10 The Library tab

A `Library` of the saved queries, as Studio's Pages tab is a `Library` of the project's pages:

- **Groups**: this viewer's **Recent** runs, most recent first, then the saved queries by the data source
  they start from, each by name.
- **An item**: its name, and under it its description — the author's, else the generated sentence; the open
  query is `placed`.
- A click opens it (§4.13). A query whose root is not bound here, by name and by path, carries the reason,
  trailing, and its click says so in a notice instead of opening: "Reads {name}, which isn't here", "Reads
  {path}, not this builder's {name}".
- The `Library`'s own search, over names and descriptions.

### 4.11 Results

Beside the pane, the result of the last run:

- **Idle**, never run: the `emptyState` recipe — "Run the query to see results", "Checks run as you edit;
  nothing reads data yet.", "Press Run or ⌘⏎ to read the datasets the query uses."
- **Running**: "Reading orders, customers" over skeleton rows.
- **A Table** (east-ui's Table renderer over the rows: virtualised, sticky header, numbers right-aligned in
  tabular mono, missing values "—", nested values summarised: "3 lines") or **a Value tree** (east-ui's
  ValueTree, read-only). Rows open as a Table and one value as a tree; Table · Tree in the toolbar overrides it
  until the next run.
- **Stale**: when the program changes after a run, a `BannerView` (stale) — "The query changed after this
  run." with **Run again** ⌘⏎ — and the body dashed; shape lines stop counting.
- **Failed**: a `BannerView` (error) — "Not run — the checker found problems", "Stopped after {s} s" (narrow
  the query, or ask for fewer rows), "The result is too large" ({bytes} over the limit), "Not run — the query
  calls a function this server can't run" (it needs {functions}), "Couldn't reach the server".
- **The footer** holds the result's read-outs, since the toolbar holds its controls: its count in words ("10
  orders") and fields; "Showing 1–1 000 of 4 210"; the run's number, time and duration; and "reads orders
  #4f2a1c8d · customers #9b07e3a4" — each data source it read, with its hash.
- **Download ▾**, a menu: CSV (East CSV, one row per output) and BEAST2 (the result as the run returned it),
  named after the query ("top-shipped-orders-2026.csv").

**A run** (Run or ⌘⏎) checks and translates the query in the browser and runs it on e3 as a one-shot call
over its root (#935's `prepareQuery`, sent with e3-api-client's `oneShotExecute`), with the call's limits; a
new run abandons the one before. Opening a saved query runs it; starting a new one does not; editing never
does. After a fresh run each shape line counts its rows: in the visual view the run's program counts its
own stages (`length as $nK` after each stage whose shape is rows), so one run gives every line (#938).

### 4.12 The status line

Under the pane and the results, the `status` recipe's dots and words:

- **Left**: the check — "Checks clean" (success), "{n} to finish" (warning), "{n} problems" (danger), "{n}
  warnings" in jq — then "Gives {shape}", with its East type and multiplicity on hover, and its fields.
- **Right**: the save state — "Saved" (just now, then quiet), "Unsaved changes" while the session has
  drafts, "Not saved" for a query never saved — and the query's name.

### 4.13 Saving, opening and starting

- **Save…** opens the save popover, the Studio's `NamePopover` (the design system's `SliceEditPopover`), as
  Save as template does:
  - "Save query · {name}"; the name field, offering the open query's name — a name another saved query
    holds is refused, the open query's own is not, and saving under it updates it;
  - under it the **description**: at most 140 characters, "What the query answers, in one sentence". While
    untouched it holds the sentence generated from the steps, muted, with "Generated from the steps · edit to
    write your own"; once edited, "{n}/140 · shown under the name in the library" and **Use generated**;
  - Cancel and **Save**. Save records the name and description as one gesture and applies the session: one
    commit. A refusal — a stale entry, a name another write took first — shows in the popover.
- **Apply** (the history item's Save) saves the open query as it stands. A query never saved opens the save
  popover instead, to name it.
- **Copy jq** copies the canonical program — in the jq view, the text as typed — and shows its check for a
  moment.
- **The generated description** is one sentence the step model makes from the finished steps (#934), at most
  140 characters: "Top 10 orders by total where status is shipped and total is at least 100.",
  "Revenue and count per region from orders.", "Count of orders where status is pending.", "Demand over price
  from 10 to 12 in steps of 0.5, region NSW."
- **Opening** a saved query — from the Library tab, `<Query.Library>` or a drop — makes it the open query:
  its steps from its checked query, its name and description, the visual view, the Query tab; and it runs. A
  notice says what opened. The query that was open keeps its drafts in its own session, there when it is
  opened again.
- **Starting** a query — Query {name} in the Datasets tab, New query on {dataset} in the library — opens a
  new one: "Untitled {name} query", not saved, not run.
- **Dropping**: a card of a `<Query.Library>` dragged onto the builder opens its query. The builder takes
  cards from the library's id through the drag layer, as Studio's canvas takes the palette's, with the theme's
  drop stages and "Drop to open “{name}”".

### 4.14 Keyboard

| Key | Where | Does |
|---|---|---|
| ⌘/Ctrl ⏎ | anywhere in the builder, the jq view | Run |
| ⌘/Ctrl / | anywhere in the builder | Open the Datasets tab |
| Esc | a popover, a search | Close it, clear it |
| ↓ ↑ · ⏎ Tab | autocomplete, completions | Move (wrapping, disabled items skipped) · pick |
| Ctrl Space · Tab | the jq view | Completions · two spaces |
| ← → Home End | the pane's tabs | Move between tabs (`DockPane`) |
| ⏎ | the save popover | Save |
| Space, arrows, Space / Esc | a library card | Pick up, move, drop / cancel (the drag layer) |

---

## 5 · The query library

Studio's page library with queries where pages are:

- **One toolbar**, the shared `Toolbar`: the search, "Search {n} queries…", over names, descriptions and data
  sources; Sort · Recent or Name (a menu, as Studio's Sort); Grid · List (`LibraryLayoutSwitch`); a rule; and
  the primary **+ New query on {dataset}** — the dataset the pane shows, else the first bound.
- **The pane** (the `queryLibrary` recipe, as `studioLibrary`'s): "Data sources" — All queries, then each bound
  data source with its count of queries, the one shown in the brand; at its foot, Recent, with its count.
- **The gallery**: one `Library` gallery, three across, or a list:
  - **media** (`renderMedia`): a wireframe of the query — its source and a bar per step with its icon, as
    Studio's cards draw a wireframe of each layout. A query that doesn't check against this surface's data
    sources shows its problem count, dashed, instead;
  - its **name**, and its **description** under it — the author's, else the generated sentence;
  - its **byline**: "{source} · {n} steps · {shape in words} · saved {when}" ("orders · 5 steps · up to 10
    shipped orders · saved Tue");
  - **Open in builder →**, its action.
  Cards drag onto any builder on the page (§4.13).
- **Open in builder →** writes the builder's open query, shared by `id`, and tells the host (`onOpen`), as
  Studio's does. A query whose root is not bound here is marked with the reason and does not open (§4.10).
- **Empty** (the `emptyState` recipe): "No queries match “{text}”" — Check the spelling · Clear the filter to
  search every query; "No queries yet" — Save a query in the builder.
- Recent are this viewer's runs, the builder's (`usePersistedState`, under the builder's key, each run kept as
  East text).

---

## 6 · The mock's data

#875's shared fixture, from a fixed seed (Park–Miller, seed 875):

| Data source | Type | Noun | About |
|---|---|---|---|
| `orders` | `Array<Order>` | order | Orders with lines and status |
| `customers` | `Dict<String, Customer>` | customer | Customers by id |
| `forecast` | `Struct{regions: Dict<String, Struct{weekly: Array<Float>}>}` | forecast | Weekly demand by region |
| `model` | `Function([Struct{price: Float, region: String}], Float)` | model | Demand model: price and region to units |
| `bom` | `Part` (recursive) | part | Bill of materials for PUMP-A |

- **Types**: `Line {price: Float, qty: Integer, sku: String}`; `Status` (`cancelled {reason}` · `pending` ·
  `shipped {date}`); `Order {customer_id, discount: Option<Float>, id: Integer, lines, status, total: Float}`;
  `Customer {name, region, tier: gold | standard}`.
- **Orders**: 40, ids 1001–1040, customers C01–C08, one to four lines each from eight SKUs; the seed gives 23
  shipped, 14 pending and 3 cancelled; 35% discounted by 5, 10 or 15%.
- **Customers**: C01 Harbour Foods NSW gold · C02 Coastline Retail NSW · C03 Ridge Grocers VIC gold · C04
  Southbank Market VIC · C05 Sunfield Traders QLD · C06 Northgate Supply QLD gold · C07 Westend Provisions WA ·
  C08 Ironbark Stores SA.
- **The bill of materials**: PUMP-A → MOTOR-1 (ROTOR-1, STATOR-1, BRG-6203), HOUSING-2 (GASKET-9, BOLT-M8),
  IMPELLER-3, SEAL-KIT (ORING-12, ORING-18).
- **Saved queries**: Top shipped orders, 2026 · Revenue by region ("Top 3 regions by shipped revenue in
  2026, from orders of $100 or more.") · Shipped revenue by month · Large orders with no discount · Units by
  SKU · Pump parts cost ("Total cost, part count and dearest part in the PUMP-A bill of materials.") · Demand
  at $10–$12, NSW ("Modelled demand in NSW at prices from $10 to $12, in $0.50 steps."); the rest describe
  themselves. Recent: Cancelled orders · Orders shipped in 2026 · Gold customers or big orders. They are the
  showcase's fixture (#940).

---

## 7 · The rules, and where they are tested

The logic specs of e3-ui-components (`packages/e3-ui-components/test/query/`) test the steps (#933); the
e3-ui specs (`packages/e3-ui/test/query/`) the East, the carriers
and the manifests; the DOM tests (`packages/e3-ui-components/src/query/`) render each component through its
carrier over a record in memory; the responsive specs
(`packages/east-ui-showcase/tests/responsive/query-*.spec.ts`) measure the built showcase in a real browser.

| Rules | What | Child |
|---|---|---|
| S1–S5 | Every catalogue step prints to canonical jq and parses back to itself; spans place each diagnostic on its step, condition and slot; shapes in words; narrowing; a jq step stays a jq step | #933 |
| P1–P5 | Plain words for every shape, kind and problem; the slots' offers and defaults; picking and chaining; the generated description and outlines; summaries cached by program and inputs | #934 |
| M1–M4 | Each surface's manifest is the record, its patch and each bound source; only bound sources can be queried; a builder with none is refused; `Query.Types` never depends on the sources | #935 |
| E1–E7 | One gesture, one transaction; Undo, Redo and Discard; Apply is one patch of one entry; readiness from the checker; a stale save is a conflict; a new query is named on its first Apply; opening keeps another query's drafts | #935, #936 |
| C1–C3 | A query's one-shot call is platform-free, with one dataset argument per dataset read, from one check against the whole root; every outcome mapped, truncation exact; the root's name errors | #935 |
| K1 | `DockPane`'s open tab follows its host's `tab`, reports through `onTabChange`, and is unchanged without them | #935 |
| B1–B8 | The one toolbar and its fold; the pane, its tabs and its rail; the Query tab's parts; the status line; the save popover and its description | #936 |
| U1–U2 | Chaining, keys, fixes and the history; Visual · jq and saving | #936 |
| J1–J4 | Highlighting, completions, the problems panel, parsing back as one gesture | #937 |
| R1–R8 | A run is one one-shot call over the root; counting shape lines; stale; each failure's banner; the footer; downloads; the Table and the Value tree through the production renderers; the default query's counts | #938 |
| D1–D6 | The Datasets tab's groups and items; a click starts a query; the Library tab; a root bound elsewhere; dropping a library card; no drag layer, no target | #939 |
| L1–L7 | The library's toolbar, pane and gallery; wireframes; search, sort and layout; recent; Open in builder and `onOpen`; its manifest, and no dataset read | #1063 |
| V1–V3 | Examples ↔ tests and the plugin index; the builder's and the library's layout in the responsive specs; the showcase, and this document as built | #940 |

---

## 8 · Visual verification

The flagship example is rendered in the showcase beside the mock at 1240 px, in light and dark. Layout is
checked by DOM measurement in the responsive specs, never by reading screenshots (#940).

---

## 9 · Where the product differs from the mock, and what is lost

The mock is a designer's prototype; Studio's patterns are how the product is built. Each difference:

| Mock | Product | Lost |
|---|---|---|
| A 1 px border and a 10 px radius around each component | No border; the host frames it | Nothing |
| The control rail: Saved ▾, Copy jq, Save, Run | The one toolbar: Visual · jq, Table · Tree, Download ▾, the history item, Copy jq, Save…, Run | The toolbar's quick menu of recent and saved queries — the Library tab holds them |
| Visual \| jq and the dataset search in the pane's tab row | Visual · jq in the toolbar, as Studio's Desktop · Tablet; the search is the Datasets tab's own `Library` search | The ⌘/ hint inside the field (⌘/ still works); a row of height in the Datasets tab |
| The results' own control rail: count, fields, run, Table / Tree, Download | The controls in the builder's toolbar; the read-outs in the results' footer | The count beside the view switch |
| Notices with Undo, after opening, starting or applying | A notice that says what happened; undo is the editing session's; opening keeps the other query's drafts | One-click undo of an open — the Library tab reopens the other query |
| Datasets that expand in place: description, fields, reference, Query | `Library` items, as Studio's palette cards: icon, name, size and hash, Source or Looked up; a click starts a query on it | A dataset's fields in plain words before a query starts — the autocomplete shows them once one does; the full reference; the prose description — a binding carries none |
| The collapsed rail names the open tab — Steps, jq or Datasets, with its icon and count | `DockPane`'s rail, as the palette's: the pane's icon, "Query" and the step count | Which tab is open, while collapsed |
| The rail's step count turns red with problems | `DockPane`'s badge | The red count; the status line still says "{n} problems" |
| A hand-drawn save popover | `NamePopover` with the description under the name, committing through Apply | Nothing |
| A query saves with unfinished steps left out, or with problems | Apply waits until every step is finished and the query checks | Saving a half-built step |
| Library cards preview each query's first rows, run in the page | A wireframe of the query's steps; nothing is read | Seeing results at a glance |
| "10 orders" on a card | The shape in words: "up to 10 orders" | The count |
| The library's filter as a chip in its toolbar | The pane shows the filter | Clearing it from the toolbar — All queries in the pane does |
| A favourite star on every card, and Favourites in the pane | Not built: a `Library` card has no toggle of its own | Starring queries — a later `Library` feature could bring it back |
| Recent in the page's storage | The viewer's own, under the builder's key | Nothing |
| The Datasets search holds "⌘ /" and ⌘/ focuses it | ⌘/ opens the Datasets tab | Typing straight into the search — a click more |
| A drag in HTML5 with `application/x-east-query` and `text/plain` | The drag layer: library cards by the library's id | Dropping a query into a text field as jq |
| Quick add "First N" | "Keep the first" | Nothing — one name per step |
| A hand-drawn table and tree; widths guessed from characters; the first 500 rows | east-ui's Table and ValueTree; the one-shot call's outputs, "{n}+" when cut | Nothing |
| Runs, summaries and counts evaluated in the page, visual steps only | One-shot calls on e3, jq steps included | Nothing |
| A stand-in checker, parser and type flow | #875's checker and AST | Nothing |
| "Shape known after the jq step" | The checker's shape | Nothing |
| The jq step "is checked on the server" | "Not a visual step: it stays as jq in the visual editor." | Nothing |
| Download BEAST2 notes only; CSV prints nested values as JSON | BEAST2 saves the result; CSV cells are East CSV | Nothing |
| Totals rounded to cents; a customer named beside its ID; Look up by text keys only; List every part over `.children`; the model's inputs offer the fixture's regions | Exact values; not named; any Dict whose key is a field's type; the tree's recursive field; a typed value | The fixture-specific conveniences |
| Ask Elara, proposals, the Preview bar, result cards | Not built here — the chat epic (#883) | All of it, for now |
| Hover text in `title` attributes | `Tooltip` for definitions; `aria-label`s on controls | Nothing |
| 26, 24 and 22 px in-row buttons | The design system's sizes | Nothing |
