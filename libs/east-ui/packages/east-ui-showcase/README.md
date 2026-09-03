# east-ui-showcase

Internal — not published.

Development and snapshot app for `@elaraai/east-ui` types and
`@elaraai/east-ui-components` React renderers. Hosts the runtime demo and runs
the snapshot pipeline that turns every east-ui example into standalone HTML and
PNG for visual verification.

The `dist-examples/` and `dist-design/` directories (gitignored) are where the
snapshots land — they exist specifically so an agent can "see" the rendered
output.

## Setup

```bash
make install   # from workspace root
```

## Commands

Run from `libs/east-ui/`:

```bash
make east-ui-examples-html-all                 # Snapshot every east-ui example to standalone HTML
make east-ui-examples-html-<pathKey>           # Snapshot one example (e.g. disclosure/tabs)
make design                                    # Serve app_design_system/ on :5174 for visual review
```

Run from this package directory:

```bash
npm run dev          # Vite dev server
npm run build        # Production build
```

The Code Reference section shows every example in TypeScript (the authored
source) or Python (printed from the example's IR), from a selector on each
entry — one choice for the whole section, `?lang=python` to open in Python.
The python comes from the Claude plugin's example index
(`libs/east-claude-plugin/index.json`); after adding or changing a core
example, regenerate it (`cd libs/east-claude-plugin && make index`) or the
showcase build fails naming the missing example.

## See also

- [Parent lib README](../../README.md)
- [Parent lib CLAUDE.md](../../CLAUDE.md)
- [`packages/east-ui-components/README.md`](../east-ui-components/README.md) — the renderers this app showcases
