# east-ui

UI components for the East language. The lib hosts an **IR → renderer →
showcase** trio (twice: once for general east-ui, once for e3-specific
UI).

## Packages

### General-purpose UI

| Package | Role |
|---|---|
| `packages/east-ui` | **IR layer.** Typed component definitions returning East data structures (`UIComponentType` variant). Backs the `east:east-ui` plugin skill. |
| `packages/east-ui-components` | **Renderer layer.** React + Chakra UI v3 components that consume east-ui values. |
| `packages/east-ui-showcase` | **Showcase + responsive suite.** Demos every component; its Playwright suite (`make test-responsive`) measures them. `make east-ui-examples-html-*` snapshots examples to standalone HTML. |

### e3-specific UI (per `[e3-ui design]` memory)

| Package | Role |
|---|---|
| `packages/e3-ui` | First-class UI in e3 — `e3.ui()`, Data / State platform functions, task-kind metadata. |
| `packages/e3-ui-components` | React renderers for e3-specific previews (DataTaskPreview, TaskPreview, EastValueViewer, etc.). |
| `packages/e3-ui-showcase` | Showcase for e3-specific components. |
| `packages/e3-ui-cli` | Published CLI: `e3-ui [repo]` is the terminal UI over an e3 repository (dashboard, dataflow runs, paged value trees, logs, editable inputs — `src/tui/`, design in `docs/tui/`); `e3-ui shot` renders east-ui / e3-ui components (incl. `ui()` tasks) to PNG/HTML via managed headless Chromium. Backs the `east:e3-ui-cli` plugin skill. |

## Commands

`make build`, `make test`, `make lint` from this directory. Plus the
design / snapshot workflow:

| Target | What it does |
|---|---|
| `make design` | Serves the design system's download (`app_design_system/`, read-only) on :5174. |
| `make east-ui-examples-html-all` | Snapshots every east-ui example to standalone HTML. |
| `make east-ui-examples-html-<key>` | Snapshots a single example (e.g. `east-ui-examples-html-disclosure/tabs`). |
| `make build-js` | The JavaScript the tests run, and no more: east-ui and e3-ui compiled by tsc (`build-js-ir`), and side by side the renderers bundled with no type-check and no declarations (`build-js-renderers`). CI's test jobs run on it, each half restored from a cache keyed by its sources where they stand. |
| `make build-checked` | Every package a test or lint reads, as `make build` builds it, type-checked and its declarations written: all but the showcase. CI runs it beside the tests. |
| `make check-apps` | Over what `build-checked` built: the showcase type-checked. With `build-js` and `build-checked` it checks what `make build` does. |
| `make build-showcase-js` | The showcase's bundle alone, over what `build-js` built: what CI's browser jobs serve. |
| `make test-group GROUP=components\|ir\|node\|showcase\|e3-components\|rest\|queries` | The CI groups: the shared renderers, the IR, the e3 renderers' Node specs, the showcase's specs, the e3 renderers (`SHARD=n/count`, split by the times CI recorded; `REPORT=file` writes its JSON report), the remaining packages, and the CLI's query-equivalence spec (`PART=k/n`: every n-th query from the k-th). Together they run every package's tests once, as `make test` does, over what is built: no group builds first. |
| `make test-responsive` | The showcase's Playwright suite (DOM specs at desktop + mobile) over the built showcase, exactly as CI runs it; `SHARD=n/total` runs one CI job's share, the tests split by the times CI recorded. |

See [`../../docs/conventions/MAKEFILE_TARGETS.md`](../../docs/conventions/MAKEFILE_TARGETS.md).

## Canonical design source

The design system lives in claude.ai/design, in the project **"East
Design System"**: its tokens (`tokens/colors.css`, `tokens/typography.css`,
`tokens/layout.css`), base element styles (`_ds_bundle.css`), guidelines
(`guidelines/guidelines/`) and spec cards (`guidelines/cards/`). Every change
to it happens there.

`app_design_system/` (this lib) is a read-only download of it, file for file
(`.download.json` lists each file's sha256). Never edit it by hand, and
nothing writes into it. It is refreshed by a full re-download: the user runs
`/design-sync`, which deletes the folder, downloads the project again and
commits it.

The theme follows the download. `packages/east-ui-components/src/theme/`
holds one token for each design-system token (the table in
`semantic-tokens.ts`, `tokens.ts`), and recipes and renderers name those
tokens (`fg.subtle`, `bg.canvas`, `border.strong`, `status.pos`, …), never a
raw value. The token guard
(`packages/east-ui-components/src/theme/design-system.test.ts`, run by
`make test`) reads `app_design_system/tokens/*.css` and fails, naming the
token, when a theme value drifts from the design system's in either colour
mode — so after a re-download it names exactly what the theme must follow.

Visual verification has two halves, and neither stands in for the other.

- **Measure it.** A visual change lands with a visual invariant in the
  showcase's responsive suite (`make test-responsive`,
  `packages/east-ui-showcase/tests/responsive/`), measuring computed styles:
  that is what holds it in CI.
- **Look at it.** Before a visual change is called finished, screenshot it and
  read the screenshots: each state it touches, at each width it has, a phone's
  included. A spec holds only what someone thought to measure: tap targets and
  geometry all pass over a label cut to `No`. What a look finds becomes an
  invariant.

Dark mode is for colour checks. A test of layout, geometry or behaviour runs
in the light theme (`tests/responsive/themes.ts`' `LAYOUT_THEMES`); a test
holding a colour of its own — one that is not a theme token, or that a theme
token's own value decides — runs in both. Measuring against a token, or that
something is not transparent, is no dark-only risk: the token guard above holds
the tokens, and lint refuses a raw colour in a recipe. A sweep that sizes a
builder's frame itself runs under one project (`@desktop`), unless it needs a
touch pointer or a phone's viewport. Phone widths are `builder-frame-phone` and
`toolbar-fit`'s.

A spec there imports `test` from `./kept-page` (#1466): the tests of a spec
file share one page, which the showcase resets between them as a fresh load
would make it, rather than each loading the whole showcase and starting its e3
again. A spec that holds the clock, routes requests, emulates media, listens
to the page's events, reaches its context, reloads, or sets options of its own
(`test.use`) imports Playwright's `test` instead: a page made for it alone.

### Where the code departs from the design system

The design system is followed everywhere but here, where the user has ruled
it wrong. These departures are deliberate: an audit, a review or a
re-download never moves the code back towards the design system's text.

- **No dialogs.** The design system routes destructive confirmations and
  its one modal through `<Dialog>`, and keeps a `<CommandPalette>`. East has
  neither: no dialogs, no command palette and no portal modals.
  Confirmations, edits and pickers are anchored popovers, built from the
  design system's popover and slice-edit cards
  (`guidelines/cards/parts-popover.html`, `parts-slice-edit.html`).
  `Dialog`, `CommandPalette` and `Dialog.open` are being removed; `Drawer`
  stays for now. Popovers render through a portal, as they always have.

## Plugin skills (DO NOT EDIT casually)

- `packages/east-ui/SKILL.md` → `east:east-ui`
- `packages/e3-ui/SKILL.md` → `east:e3-ui`
- `packages/e3-ui-cli/SKILL.md` → `east:e3-ui-cli`

## See also

- Per-package `STANDARDS.md` files — mandatory TypeDoc + testing
  standards.
- [`../../docs/conventions/EAST_TS_INTEROP.md`](../../docs/conventions/EAST_TS_INTEROP.md)
  — `isValueOf`, `compareFor`, `variant` rules.
- [`../../docs/conventions/EXAMPLES_AUTHORING.md`](../../docs/conventions/EXAMPLES_AUTHORING.md)
  + [`packages/east-ui/test/CLAUDE.md`](packages/east-ui/test/CLAUDE.md)
  — testing conventions and UI-specific Reactive.Root rules.
- [`packages/east-ui-components/CLAUDE.md`](packages/east-ui-components/CLAUDE.md)
  — renderer patterns, the MANDATORY interactive-state pattern, and the
  builder frame: a builder-style component (one toolbar over panes beside a
  main area, as Studio's builder and the query builder are) is laid out with
  `BuilderFrame` — its anatomy, props, pane modes and scrim are in that
  file's "Builder frame" section.
