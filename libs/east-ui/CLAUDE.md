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
| `packages/east-ui-showcase` | **Showcase + snapshot pipeline.** Demos every component and produces PNG snapshots via `make east-ui-examples-html-*` for visual verification. |
| `packages/east-ui-extension` | VS Code extension that previews east-ui values in a webview. |

### e3-specific UI (per `[e3-ui design]` memory)

| Package | Role |
|---|---|
| `packages/e3-ui` | First-class UI in e3 — `e3.ui()`, Data / State platform functions, task-kind metadata. |
| `packages/e3-ui-components` | React renderers for e3-specific previews (DataTaskPreview, TaskPreview, EastValueViewer, etc.). |
| `packages/e3-ui-showcase` | Showcase for e3-specific components. |
| `packages/e3-ui-cli` | Published CLI (`e3-ui shot`): renders east-ui / e3-ui components (incl. `ui()` tasks) to PNG/HTML via managed headless Chromium. Backs the `east:e3-ui-cli` plugin skill. |

## Commands

`make build`, `make test`, `make lint` from this directory. Plus the
design / snapshot workflow:

| Target | What it does |
|---|---|
| `make design` | Serves `design/` (canonical visual spec, HTML) on :5174. |
| `make design-html-all` | Snapshots every `.pattern` / `.bsys` in `design/*.html` to `packages/east-ui-showcase/dist-design/`. |
| `make east-ui-examples-html-all` | Snapshots every east-ui example to standalone HTML. |
| `make east-ui-examples-html-<key>` | Snapshots a single example (e.g. `east-ui-examples-html-disclosure/tabs`). |
| `make extension` | Builds the VS Code extension. |
| `make extension-install` / `make extension-uninstall` | Manage local VS Code install. |

See [`../../docs/conventions/MAKEFILE_TARGETS.md`](../../docs/conventions/MAKEFILE_TARGETS.md).

## Canonical design source

`design/` (this lib) holds the canonical visual design as HTML + CSS
(`colors_and_type.css`, `spec.css`). The renderer packages **do not**
maintain their own copy of design tokens — they use Chakra semantic
tokens (`bg.primary`, `text.muted`, …) which the host app's theme maps
back to these values.

Per `[Always visually verify]` memory: after every component or example
change, rebuild + re-snapshot + Read the PNG. That's the whole point of
`dist-examples`.

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
