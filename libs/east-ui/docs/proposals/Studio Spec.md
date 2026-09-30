# Studio — the design of record

> **Status: As built** · e3-ui · companion to [`Studio Spec.html`](./Studio%20Spec.html),
> the mock of record ([resting render](./Studio%20Spec.png)): three screens — 01
> Builder, 02 Page library, 03 Publish preview; append `?theme=dark` for dark.
> The mock is the ground truth for appearance; where it and this document
> disagree on a visual detail, the mock wins. On behaviour and API, this
> document is what shipped.

Developers write **components** in code. A solution declares **one record** for
its pages, of a type the Studio exports, with one write: a patch. Operators
compose pages from the components on a 12-column snap grid, publish them and
save them as templates, without writing code. Every edit is a draft of the
shared editing session — the Sheet's and the Plan's — and an Apply is one
audited, typed patch commit on the record.

| Layer | Lives in | Written by | Holds |
|---|---|---|---|
| **Components** | package code: `Studio.component(key, meta, fn)` | developers | A `Studio.Types.Component` struct: what the palette shows, and an East UI function written like a `ui()` body that binds its own data |
| **Pages** | one `e3.record` of `Studio.Types.Pages`, written through `e3.mutation.patch` | operators | Pages keyed `{ project, page }`, each a draft and an optional live version, and templates. A cell is a component's key and where it sits |
| **Surfaces** | `ui()` tasks | developers | `<Studio.Builder>` and `<Studio.Library>`, bound to the record; `<Studio.Page>`, reading it. Each lists the components it offers with `$.let` |

---

## 1 · What a solution writes

The flagship example, `packages/e3-ui/test/studio/studio.examples.tsx`, is this
solution with the mock's data and resting state: seven components over sales,
traffic and staffing data, and the Ops console's pages and templates.

### Components

```tsx
export const revenueTrend = Studio.component("revenue_trend", {
    name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n,
    description: "Revenue by day, as an area.",
}, East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const days = $.let(Data.bind(revenueDaily).read());
        return <Chart height="fill" grid layers={Chart.Area(days, { x: r => r.day, y: r => r.revenue })} />;
    }}</Reactive>
)));
```

`meta` is what the palette shows: `name`, `category`, `icon`, and optionally
`span`, `description`, `frame` (`"card"` or `"none"`), `tags`, `collections` and
`deprecated`. A component's `reads` (what its code binds) and its
`fingerprint` (a hash of its IR in canonical form) are derived from `fn`.

### The pages record

```ts
export const pages      = e3.record("pages", Studio.Types.Pages, new Map());
export const pagesPatch = e3.mutation.patch(pages);
```

`Studio.Types.Pages` is `Dict<Key, Entry>`: a `Key` is `{ project, page }`; an
`Entry` is a `page` — `{ draft, live }`, `live` being `none` until the first
publish, else `{ version, page }` — or a `template`. A `Page` is
`{ title, cells }`; a `Cell` is `{ key, row, span, height, align, title,
component, fingerprint }`. The type never depends on the components, so a
deploy that adds, changes or removes one runs no migration.

### The surfaces

```tsx
// The builder, for operators: it reads the pages and writes their patch.
export const builder = ui("builder", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const components = $.let([kpiRail, breakdownBars, revenueTrend, ordersByWeek, visitsSparkline, assignmentBoard, shiftRoster]);
        const record     = $.let(Record.bind(pages, [pagesPatch]));
        return <Studio.Builder pages={record} components={components} project="Ops console"
            env="Staging" audience="Field ops · 24 users" rollout="Immediate" />;
    }}</Reactive>
)));

// The page library: the project's pages and templates, and where new pages start.
export const library = ui("library", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const components = $.let([kpiRail, breakdownBars, revenueTrend, ordersByWeek, visitsSparkline, assignmentBoard, shiftRoster]);
        const record     = $.let(Record.bind(pages, [pagesPatch]));
        return <Studio.Library pages={record} components={components} project="Ops console" />;
    }}</Reactive>
)));

// A published page, for everyone else: it only reads the pages.
export const opsConsole = ui("ops_console", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const components = $.let([kpiRail, breakdownBars, revenueTrend, ordersByWeek, visitsSparkline, assignmentBoard, shiftRoster]);
        const all        = $.let(Data.bind(pages));
        return <Studio.Page pages={all.read()} components={components}
            page={{ project: "Ops console", page: "Overview" }} />;
    }}</Reactive>
)));
```

The public `Studio` namespace is exactly this: `Studio.component`,
`<Studio.Builder>`, `<Studio.Library>`, `<Studio.Page>` and `Studio.Types`.

---

## 2 · Decisions

1. **Separate components, no turnkey app.** The builder, the page library and
   one page are components a solution places where it wants. The builder's
   parts — the palette (its component library), the canvas, the inspector and
   the publish preview — are its insides, not API. There is no published-site
   component: a solution shows `<Studio.Page>` in its own layout, and builds its
   own navigation from the record if it wants one.
2. **Public is what a solution mounts.** The East functions that compute the
   builder's and the page library's writes and reads are internal
   (`@elaraai/e3-ui/internal`).
3. **Components are code; pages are data.** A component binds its own data;
   different data is a different component, and a component's next version is a
   deploy. A placement stores its component's key, its layout, and its
   component's fingerprint — stamped when placed and at every publish — so code
   changed since a page went live shows.
4. **Records first.** Every operator action is one patch commit, computed in
   East as the diff of the one entry it writes. A patch carries what it changes
   as it was, so a write drafted on a stale page is a `conflict`, and nothing is
   overwritten.
5. **One history.** The canvas's drafts are the shared editing session's: one
   history item undoes, redoes, discards and applies.
6. **Every Studio component is an interface and a renderer.** Its e3-ui
   factory builds only its payload — data, the bound record's functions and the
   listed components — carried by `EastUI.component`; its React renderer builds
   it in the browser from the design system's React components. No factory
   composes East UI components (`docs/conventions/EAST_UI_PROP_PATTERNS.md`).
7. **Headerless, one toolbar, no outer border.** Each component's controls sit
   in its one toolbar; none draws a border around itself, so a host frames it
   or places it bare.
8. **Chrome exact, tiles real.** The chrome matches the mock; the tiles are the
   real east-ui components the mock draws.

---

## 3 · Architecture

### The carriers (`@elaraai/e3-ui`)

| Component | Carrier | Payload |
|---|---|---|
| `<Studio.Builder>` | `StudioBuilder` | `pages` — the bound record's `read`, `history` and `commit.patch`; `components`; `project`; `env`, `audience`, `rollout`, `id` as options |
| `<Studio.Library>` | `StudioLibrary` | `pages` as above; `components`; `project`; `id`; `onOpen` |
| `<Studio.Page>` | `StudioPage` | `pages` — the record's value; `components`; `page`; `version` |

A surface's `ui()` manifest follows from the payload: the builder's and the
page library's hold the record and its patch, a page's the record alone, and
each holds exactly what its listed components read.

### The renderers (`@elaraai/e3-ui-components`)

Each decodes its payload and builds the component in the browser. What each
part shows is computed by e3-ui's East functions, compiled once on first use —
the palette's cards and pages (`paletteCards`, `palettePages`), the canvas's
tiles (`canvasTiles`), the selected placement (`inspectorSelection`), the
preview's summary and refusals (`publishSummary`, `publishRefusal`), the page
library's rows (`libraryProjects`, `libraryPages`, `libraryTemplates`), the
change list (`pageChanges`) and the writes' patches.

- **The builder** reads the record where it renders, and again when it moves.
  Its canvas is the SnapGrid's editing canvas over the open page's draft cells,
  built in TypeScript: the cells' types, their snapshot, how a drafted row
  becomes a tile, how a dropped card becomes a cell, and an Apply that commits
  the batch as one patch through the record's patch write (`saveCells`, East's
  `Record.onApply` over the draft's cells). The palette and the inspector are
  the canvas's panes; the toolbar's status, Save as template, Preview and
  Publish are its items. The selection, the drafts the canvas draws and the
  preview's state are the builder's own. The publish preview takes the
  canvas's place, the canvas kept mounted: it asks the canvas for an Apply
  under an id, and the canvas answers under that id once its drafts land or
  cannot, so the canvas stays the only writer of its drafts.
- **The page library** keeps the project shown, the search, the order, the
  Pages row's layout and the New page popover as its own state; its rows are
  two Library galleries whose media are wireframes of each layout.
- **A page** lays its layout's placements out on the snap grid; each placement
  runs its component's function, re-run when what it read changes.
- **The open page** is the UI store's, under the builder's key
  (`builderKeys(id).page`), where `State.bind` keeps State: the page library
  writes it when it opens a page, and the builder reads it. It begins as the
  project's first page.

---

## 4 · The rules, and where they are tested

The e3-ui specs (`packages/e3-ui/test/studio/`) test the East, the carriers and
the manifests; the DOM tests (`packages/e3-ui-components/src/studio/`) render
each component through its carrier over a pages record in memory; the
responsive specs (`packages/east-ui-showcase/tests/responsive/studio-*.spec.ts`)
measure the built showcase in a real browser.

| Rules | What | Tested in |
|---|---|---|
| K1–K5, K7 | A component is exactly what `ui()` takes; a surface's manifest is the union of its components' reads; two placements share a component's State; the fingerprint follows the code and nothing else; an unlisted key is a placeholder, a shared key an error | `component.spec.ts`, `page.test.tsx` |
| K8 | `Studio.component` inside an East function passes every East rule | `studio-lint.spec.ts` |
| R1–R3, R5, R7, R8 | Each write is one patch of one entry, with its actor, time and delta; a stale write is a conflict; publish and revert are exact; the change list is exact; a redeploy runs no migration; a template and a page from it are one commit each | `pages.spec.ts`, `pages.e3.spec.ts` |
| R4 | Each surface's manifest | `builder.spec.ts`, `library.spec.ts`, `page.spec.ts` |
| F3–F5 | Two placements share State; under 390 px the tiles stack in row order; a frameless component is bare | `page.test.tsx`, `studio-page.spec.ts` |
| B1–B7 | The palette: its tabs and rail, search, grouping and Filter, cards by category with what they read, the placed component and its count, a card's click, the Pages tab | `palette.spec.ts`, `builder.test.tsx`, `studio-builder.spec.ts` |
| B8–B14 | The canvas: one toolbar and the page's status, the selection bar, the grid panel, a dropped card, Apply and its conflict, the panes, Preview and Publish, Desktop and Tablet | `canvas.spec.ts`, `builder.test.tsx`, `studio-builder.spec.ts` |
| B15–B21 | The inspector: its pane and rail, the selection, its reads and description, its layout edits as gestures, nothing selected | `inspector.spec.ts`, `builder.test.tsx`, `studio-builder.spec.ts` |
| D1–D7 | The page library: one toolbar, the pane, Templates, Pages, a new page, search, Sort and Grid · List; Save as template in the builder | `library.spec.ts`, `library.test.tsx`, `builder.test.tsx`, `studio-page-library.spec.ts` |
| E1–E6 | The publish preview: its bar, the page at each device's width, the aside, the banner, Audience and Rollout, the footer's writes | `publish.spec.ts`, `builder.test.tsx`, `studio-builder.spec.ts` |

Dropped with the catalog and the published site: "used in N" (R6), the site's
rail (F1), a component's `owner` and `thumbnail`.

---

## 5 · Visual verification

The flagship example is rendered in the showcase beside the mock at 1440 px, in
light and dark. The builder opens the project's first page; its screenshots
open the Overview from the palette's Pages tab, the mock's resting page. Layout
is checked by DOM measurement in the responsive specs, never by reading
screenshots.
