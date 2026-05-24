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
make design-html-all                           # Snapshot every .pattern / .bsys from design/*.html
make design                                    # Serve design/ on :5174 for visual review
```

Run from this package directory:

```bash
npm run dev          # Vite dev server
npm run build        # Production build
```

## See also

- [Parent lib README](../../README.md)
- [Parent lib CLAUDE.md](../../CLAUDE.md)
- [`packages/east-ui-components/README.md`](../east-ui-components/README.md) — the renderers this app showcases
