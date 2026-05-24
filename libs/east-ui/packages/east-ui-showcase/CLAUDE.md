# east-ui-showcase

Showcase + development app for East UI components. Hosts both the
runtime demo and the **snapshot pipeline** that turns every east-ui
example into standalone HTML / PNG.

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
- `scripts/snapshot-design.ts` — renders every `.pattern` / `.bsys` in
  `libs/east-ui/design/*.html` to `dist-design/`.
- `scripts/snapshot-chrome.ts` — headless Chrome driver shared by both
  pipelines.
- `scripts/probe-overlays.ts`, `probe-page.ts` — debugging helpers.
- `scripts/vite-plugin-example-sources.ts` — exposes example source
  files to the dev server via a virtual module.

## Make targets

(Run from `libs/east-ui/`.)

| Target | What it does |
|---|---|
| `make east-ui-examples-html-all` | Snapshots every example to standalone HTML. |
| `make east-ui-examples-html-<pathKey>` | Snapshots one example (e.g. `disclosure/tabs`). |
| `make design-html-all` | Snapshots every `.pattern` / `.bsys` from `design/*.html`. |
| `make design` | Serves `design/` on :5174 for visual review. |

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — lib-level overview.
- [`../east-ui/test/CLAUDE.md`](../east-ui/test/CLAUDE.md) — example
  authoring rules; every example here is reachable from a `.examples.ts`
  file in east-ui's test suite.
