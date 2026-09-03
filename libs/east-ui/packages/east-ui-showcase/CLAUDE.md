# east-ui-showcase

Showcase + development app for East UI components. Hosts both the
runtime demo and the **snapshot pipeline** that turns every east-ui
example into standalone HTML / PNG.

The app also showcases the **e3-ui** examples ("e3 Components" nav
section): `main.tsx` seeds an in-memory reactive-dataset cache from each
example's `e3.input` defaults (mirroring the e3-ui-components snapshot
harness), and `vite.config.ts` aliases `@elaraai/e3` to the harness's
browser-safe shim. In dev, `@elaraai/e3-ui` (bare *and* `/internal`) and
`@elaraai/east-ui-components` (bare, `/fonts`, `/platform`) must all
resolve to source together — a split resolves East's reference-based
identities into two instances and `Data.bind` stops matching its
registered platform implementation.

Per `[Always visually verify]` memory: after every east-ui example or
component change, rebuild + re-snapshot + Read the PNG. The
`dist-examples/` and `dist-design/` directories (gitignored) are
where the snapshots land — they exist specifically so an agent can
"see" the rendered output.

## Key scripts

- `scripts/discover-example-files.ts` — finds every `*.examples.ts`
  across east-ui packages.
- `scripts/snapshot-examples.ts` — renders each example to a
  standalone HTML in `dist-examples/`, then converts to PNG.
- `scripts/snapshot-chrome.ts` — headless Chrome driver shared by the
  pipelines.
- `scripts/probe-overlays.ts`, `probe-page.ts` — debugging helpers.
- `scripts/vite-plugin-example-sources.ts` — exposes example source
  files to the dev server via a virtual module.
- `scripts/example-renderings.ts` — joins every Code Reference example
  with the Claude plugin's example index (`libs/east-claude-plugin/index.json`)
  by id, for its python rendering (#655): the index stores each program
  example as IR with the TypeScript and python printed from it. A Code
  Reference example missing from the index fails the build naming it —
  regenerate with `cd libs/east-claude-plugin && make index`. The
  TypeScript / Python selector on each Code Reference entry writes ONE
  tier-wide choice (`code-language.ts`, session-persisted, `?lang=python`
  seeds it); Components are JSX and never get the selector.

## Make targets

(Run from `libs/east-ui/`.)

| Target | What it does |
|---|---|
| `make east-ui-examples-html-all` | Snapshots every example to standalone HTML. |
| `make east-ui-examples-html-<pathKey>` | Snapshots one example (e.g. `disclosure/tabs`). |
| `make design` | Serves `app_design_system/` (incl. `components/rendered/`) on :5174 for visual review. |

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — lib-level overview.
- [`../east-ui/test/CLAUDE.md`](../east-ui/test/CLAUDE.md) — example
  authoring rules; every example here is reachable from a `.examples.ts`
  file in east-ui's test suite.
