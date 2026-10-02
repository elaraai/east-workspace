# east-ui

UI components for the East language. The lib hosts an **IR → renderer →
showcase** trio (twice: once for general east-ui, once for e3-specific
UI) plus a VS Code extension.

## Packages

### General-purpose UI

| Package | Role |
|---|---|
| `packages/east-ui` | **IR layer.** Typed component definitions returning East data structures (`UIComponentType` variant). Backs the `east:east-ui` plugin skill. |
| `packages/east-ui-components` | **Renderer layer.** React + Chakra UI v3 components that consume east-ui values. |
| `packages/east-ui-showcase` | **Showcase + responsive suite.** Demos every component; its Playwright suite (`make test-responsive`) measures them. `make east-ui-examples-html-*` snapshots examples to standalone HTML. |
| `packages/east-ui-extension` | VS Code extension that previews east-ui values in a webview. |

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
| `make test-group GROUP=components\|ir\|rest` | One of the three test groups CI runs side by side: `components` (east-ui-components), `ir` (east-ui and e3-ui) and `rest` (every package the other two don't name). Together they run every package's tests once, as `make test` does. |
| `make test-responsive` | The showcase's Playwright suite (DOM specs at desktop + mobile) over the built showcase, exactly as CI runs it; `SHARD=n/8` runs one CI shard. |
| `make extension` | Builds the VS Code extension. |
| `make extension-install` / `make extension-uninstall` | Manage local VS Code install. |

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

Visual verification measures computed styles in the showcase's responsive
suite (`make test-responsive`, `packages/east-ui-showcase/tests/responsive/`):
a visual change lands with a visual invariant there. Never read a
screenshot.

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
  — renderer patterns, the MANDATORY interactive-state pattern.
