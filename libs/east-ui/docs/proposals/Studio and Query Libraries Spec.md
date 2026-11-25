# Studio and Query libraries: a table, the family's Library pane, and tags

**Status:** approved 25 Nov 2026. Built under one epic, in the order of §8.
**Visual source:** `Studio and Query Libraries Spec.html` (self-contained): each library as a schematic, and the rail's editor for a set field as it is today beside what is proposed, on the rail and in the combined popover. The filter's mocks are drawn with the East Design System's own tokens and parts (`libs/east-ui/app_design_system/`); a schematic is not to scale.
**Components:** `<Studio.Library>` and `<Query.Library>` (e3-ui), and the record Slice's rail (east-ui, east-ui-components).
**Read against:** main at v1.0.117.

## 1 · What changes

`<Studio.Library>` and `<Query.Library>` are builder-frame components, as Roster, Calendar, Plan, Sheet and `<Record>` are:

- laid out by `BuilderFrame`: one toolbar, the Library pane, a main area, Details;
- the main area the `<Record>` table over the record's rows, read a window at a time;
- the left pane the family's Library pane, its tabs listed by `library`;
- the filters a `Slice.bindRecords` rail in the one toolbar, and nothing of the library's own;
- pages and saved queries take tags;
- the page library says nothing of Live or Draft.

The rail's editor for a set field takes several values, matched by any or all, from a list a viewer can browse (§6). Tags use it, and so does every set field a rail offers.

Why a table: a gallery of large wireframe cards shows a handful at a time, has no place for what a person filters by, and is not a list people know from the rest of the product. A table shows a row a page or a query, with its fields in columns, at any number of rows.

## 2 · What a solution writes

```tsx
// The page library
const pages = $.let(Record.bind(d.pages));
const rows  = $.let(Data.bindPaged(d.pages, { indexes: ["pages_by_kind", "pages_by_kind_project", "pages_by_kind_tag", "pages_by_kind_title"] }));
const slice = $.let(Slice.bindRecords("ops.library", {
    rows:      { source: rows, label: "Pages", scope: { kind: ["page"] }, search: ["title", "project", "tags"],
                 fields: { title: { label: "Name" }, project: { label: "Project" }, tags: { label: "Tag" } } },
    templates: { source: rows, label: "Templates", scope: { kind: ["template"] }, search: ["title"], fields: { title: { label: "Name" } } },
}));
return <Studio.Library id="ops" pages={pages} components={components} project="Ops console" slice={{ slice }}
    library={[Studio.library.templates()]} inspector
    page={open.read()} onOpen={go} />;

// The query library
const saved = $.let(Record.bind(d.queries));
const rows  = $.let(Data.bindPaged(d.queries, { indexes: ["queries_by_source", "queries_by_tag", "queries_by_name", "queries_by_saved_at"] }));
const slice = $.let(Slice.bindRecords("analysis.library", {
    rows: { source: rows, label: "Queries", range: "saved_at", search: ["name", "sources", "tags"],
            fields: { name: { label: "Name" }, sources: { label: "Data source" }, tags: { label: "Tag" }, saved_at: { label: "Saved" } } },
}));
return <Query.Library id="analysis" queries={saved} datasets={{ orders, customers, forecast }} slice={{ slice }}
    library={[Query.library.datasets(), Query.library.recent()]} inspector
    query={open.read()} onOpen={go} />;
```

`slice`, `library`, `inspector` and `id` are the family's props and mean what they mean there. A source's `fields` names every field its rail offers, ranges over or searches, each with its label, as every record Slice does. `Studio.library.tab(rows, …)` and `Query.library.tab(rows, …)` add a tab of the app's own, as `Roster.library.tab` does.

## 3 · What each library draws

| Region | `Studio.Library` | `Query.Library` |
| --- | --- | --- |
| Toolbar | The rail (Project, Tag, search by the start of a title, presets, `N of M pages`), then New page | The rail (Data source, Tag, the Saved range, search by the start of a name, presets, `N of M queries`), then New query |
| Library pane (`library`) | Templates: a card starts a new page from it | Data sources: a card starts a new query on it. Recent: this viewer's runs |
| Main | The Record table: Name, Project, Tags, Open in builder | The Record table: Name and description, Data sources, Steps, Tags, Saved, Open in builder |
| Details (`inspector`) | The selected page's wireframe, title and tags, and Open in builder | The selected query's wireframe, description and tags, and Open in builder |

## 4 · The rules

| # | Rule |
| --- | --- |
| L1 | Each library is laid out by `BuilderFrame`: one toolbar, the Library pane, the table as main, Details as the end pane. It draws no border. |
| L2 | `library` lists the Library pane's tabs, in order. Left out or empty, there is no pane. `inspector` shows Details. |
| L3 | Each pane collapses to its rail, floats over the table in a narrow frame, and is a strip tab on a phone. The frame keeps the viewer's choice under `id`. |
| L4 | `slice` is `Slice.bindRecords`; `Slice.bind` and `Slice.bindRecord` are refused where the page is built, as every builder-frame component refuses them. Its `rows` source is the table's rows; a source a tab names narrows that tab's cards. |
| L5 | Rows are read a window at a time, in the order e3 returns them. Counts come from e3. There is no Sort. |
| L6 | Clicking a row selects it. Open in builder on the row or in Details, and Enter, call `onOpen` in a turn of its own and do nothing else. |
| L7 | A card of a tab starts something: a template a new page, a data source a new query, a recent run that run. Each tells the host through `onOpen`, once there is something to open. |
| L8 | Tags are edited in Details, and in the query builder's Save popover, and saved through the record's patch. |
| L9 | Nothing in the page library says Live or Draft. The pages record keeps its draft and its live version, and the builder keeps Publish. |
| L10 | A new page, once it commits, is told to the host, so its builder opens it. |
| L11 | New query follows the rail. With one data source chosen it reads "New query on orders" and starts on it. With none or several chosen it reads "New query" and opens a menu of the bound data sources. |
| L12 | New page follows the rail the same way: it names the one project chosen, and otherwise its popover asks for the project beside the name and the template. |

## 5 · What the records hold

A column and a rail field are fields of the record's rows, and a field the rail filters by is one an index is led by.

**A saved query** (`Query.Types.SavedQuery`) gains:

- `sources: Set<String>`: the names of the data sources it reads. They are the names of its `root` and never anything else: every write gives them through one function (`querySources`). The Data source filter is "reads this data source".
- `tags: Set<String>`: what a person tagged it. A tag is kept without the spaces around it, and an empty one is not kept (`queryTags`).

```ts
indexes: (index) => ({
    queries_by_source:   index.on(["sources"]),
    queries_by_tag:      index.on(["tags"]),
    queries_by_name:     index.on(["name"]),
    queries_by_saved_at: index.on(["saved_at"]),
}),
migrations: (migration) => [migration.rows("sources_and_tags", Query.migrations.sourcesAndTags)],
```

**A pages record's entry** (`Studio.Types.Entry`) becomes a struct: `kind` (page or template), `project`, `title`, `tags: Set<String>`, `draft` (a page's draft, a template's layout) and `live` (a page's published version). It holds no time it was last saved (ruled 25 November 2026): the builder's Save sends a page's placements and its starting filters as two patches at once, and a time both wrote would make the second a conflict. Templates stay in the pages record, told apart by `kind`: a migration step changes one record, so a deploy could not move them into another. Its indexes are each led by `kind`, so the pages and the templates are read apart, and the one on `kind` alone is how a rail scoped to one kind finds a row by its key:

```ts
indexes: (index) => ({
    pages_by_kind:         index.on(["kind"]),
    pages_by_kind_project: index.on(["kind", "project"]),
    pages_by_kind_tag:     index.on(["kind", "tags"]),
    pages_by_kind_title:   index.on(["kind", "title"]),
}),
migrations: (migration) => [migration.rows("entry_fields", Studio.migrations.entryFields)],
```

A record lists the steps it has not applied, and no others: `entry_fields` alone where it was first declared once a placement held content, and after `cell_content` where it lists that step or still holds the form before it, a placement a component's key. e3 runs the steps a record has not applied, so listing `cell_content` on a record first declared at the content form has the deploy refused, and so does listing `entry_fields` alone on one still at the form before it.

An index on a Set field files a row once under each of its values, as the Roster files a person under each skill.

## 6 · The rail's set filter

Today the rail's editor for a set field takes one value: a search box that lists at most eight matches as a person types, under the hint `Includes one value`; a set field whose values are listed as chips takes one chip. Proposed, with no new kind of control:

| # | Rule |
| --- | --- |
| S1 | The values chosen are the rail's brand chips, each with its ×. |
| S2 | **Match**, Any or All, is the rail's small segment group, shown once two values are chosen. Any is the default; one value needs none. |
| S3 | Every value of the field is listed with its count, as checkbox rows read a window at a time as the list scrolls. The search box narrows the list by the start of a value. In a phone's Filters view the rows are the 44px checkbox rows it draws now. |
| S4 | Clear is at the foot, as every field that is not searched has now. The × in the search box clears its text. |
| S5 | A set field whose values are listed as chips takes several chips, with the same Match. |
| S6 | Its words: one value reads as now, `Tag includes weekly`; several read `Tag includes any of weekly, exec` or `Tag includes all of weekly, exec`. A phone's row says `weekly, exec`, and `all of weekly, exec`. |
| S7 | A choice applies as it is made. Each value's count is the rows it would give under the other fields' choices. |
| S8 | In the combined popover a folded rail opens, and in a phone's Filters view, the field's row holds this same editor: its list a few rows tall, scrolling inside its section. Nothing opens as a dropdown over a popover. |

Underneath: a narrowing holds several values for a set field, and the match; a read counts a row once, however many of the chosen values it holds (Any the rows under any chosen value, All the rows under every one), in the record's key order, and the count is of those rows, exact; and a field's values are read as a paged list with their counts. These are the shared record read's, which every backend runs.

## 7 · What goes

| Goes | In its place |
| --- | --- |
| The galleries of wireframe cards | The table. The wireframe is in Details and on the Templates cards. |
| The pane's Projects, Pages and Data sources lists | Project and Data source as rail fields and columns. |
| Sort (Z to A, Recent first) | The order e3 pages the rows in. For saved queries the rail's Saved range finds recent work; a page holds no time. |
| Search over any part of a title, name or description | Search by the start of a field the source lists in `search`. |
| Dragging a query's card onto the builder | Open in builder. |
| Live and Draft in the page library | Nothing. |

Out of this design: who created a page or a query; the pages record's draft and live versions and the builder's Publish; the two builders' own panes and toolbars.

## 8 · The order it lands in

1. **The saved queries record.** `sources` and `tags` on a saved query, the index declarations, the migration step. The query builder's Save writes them, and its Save popover takes tags.
2. **The pages record.** Each entry a struct with `kind`, `project`, `title` and `tags`, the index declarations, the migration step. The Studio builder's writes follow.
3. **The query library.** Swapped whole: the frame, the Library pane, the table, the rail, Details and tags.
4. **The page library.** The same, with Live and Draft gone and a new page told to the host.
5. **The set filter.** Several values with Any · All, the browsable list, and the reads under them, in the shared rail.
6. **Examples and skills.** The examples, the e3-ui skill, the showcase and the responsive specs.

Each library is swapped in one step, once its record has the fields, so no stage leaves a library without its filters. Until step 5 the Tag chip works as a set field does today: one tag at a time.

## 9 · As built

What each step built, where it differs from the above.

- **Step 1.** A recent run, kept in the browser, holds no tags: tags are a saved query's, given as it is saved. A tag typed into a form's tags field and not Entered is a tag as the keyboard leaves its box, in every form, so a Save pressed straight after typing one keeps it.
- **Step 2.** `Studio.value` writes the pages and templates a solution ships, each built as every write builds one, so a seed never spells a project or a title out. `Studio.Types.PageEntry` goes, and `Studio.Types.EntryKind` is new.
- **Step 3.** The query library is one toolbar over a grid of cards (ruled 25 Nov 2026, on seeing the table, then the panes): the rail and New query in the toolbar, and under it a saved query a card — the card the gallery drew: a wireframe of its query, its name, its description, its tags, and what it reads and gives and when it was saved. Where this differs from §1 to §4:
  - **No table.** The cards stand in a responsive grid, as many across as fit at 300px each, read a window at a time through the record's indexes as the grid scrolls.
  - **No Library pane and no Details.** `library` and `inspector` are not props of `<Query.Library>`, and `Query.library` is not built. A card says what its query is; New query's menu lists the bound data sources; a viewer's recent runs are the builder's.
  - **No edit.** A press on a card, or ⏎ or Space on it, asks the host for its query (L6), and the library writes nothing: tags are edited in the query builder's Save popover alone (L8), so it takes no `queries` handle and binds no record.
  - **L11 holds:** New query follows the rail.
  - The library and a query builder are surfaces of their own, a `ui()` each. The library pages the saved queries, a surface that pages a record never loads it whole, and the builder reads them whole.
  - The grid is the shared paged gallery (`PagedGallery`, beside the paged palette a builder's Backlog tab draws), so another library of cards pages the same way.
  - The page library (step 4) is as designed until ruled otherwise.
