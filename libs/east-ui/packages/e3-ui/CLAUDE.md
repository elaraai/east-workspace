# e3-ui

Bridge between e3 and east-ui. Defines the **first-class UI surface for
e3** per `[e3-ui design]` memory:

- `e3.ui()` task — declares a UI rooted at an east-ui `UIComponentType`.
- `Data.*` platform functions — read e3 dataset values into the UI.
- `State.*` platform functions — local component state that's
  workspace-scoped.
- Task-kind metadata that lets the renderer distinguish dataset
  previews, task previews, and full UIs.

The renderer side (`e3-ui-components`) consumes this package's types
and adds React Query hooks for the e3 API.

## Plugin skill

`SKILL.md` exists in e3-ui-components but the surface defined here is
the IR layer. East-side compliance tests against this package live in
its `test/`.

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — east-ui lib-level overview.
- [`../e3-ui-components/CLAUDE.md`](../e3-ui-components/CLAUDE.md) —
  the React renderer + React Query hooks.
- [`../../../e3/CLAUDE.md`](../../../e3/CLAUDE.md) — e3 lib (concepts:
  package, workspace, dataset, task).
- [`../../../e3/design/e3-ui.md`](../../../e3/design/e3-ui.md) —
  first-class UI design spec.
- [`../east-ui/CLAUDE.md`](../east-ui/CLAUDE.md) — base UI library this
  builds on.
