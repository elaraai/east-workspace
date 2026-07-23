# design-sync notes — East Application Design System

Re-sync command (from `app_design_system/`, after re-staging scripts per the
skill's step-7 `cp -r` line and the symlink setup below):

```sh
node .ds-sync/resync.mjs --config .design-sync/config.json \
  --node-modules .ds-sync/node_modules --entry ./index.jsx \
  --out ./ds-bundle --remote .design-sync/.cache/remote-sync.json \
  && node .design-sync/extra-cards.mjs
```

The `extra-cards.mjs` step is MANDATORY after every build: it copies the 10
hand-authored specimen cards (`guidelines/cards/*.html` — groups Colors /
Type / Foundations / Conventions, own `@dsCard` markers, `../../styles.css`
links valid at that depth) into ds-bundle so they upload with `guidelines/**`
and register in the picker. Skipping it makes the next close-out
reconciliation DELETE them remotely. `components/core/core.card.html` is
deliberately not shipped (unpkg-CDN React + babel — superseded by the 8
per-component cards).

## Environment gotchas

- **Any `npm i` inside `.ds-sync/` prunes the tokens self-symlink** (npm
  removes "extraneous" entries). Recreate before building:
  `mkdir -p .ds-sync/node_modules/@elaraai && ln -sfn ../../.. .ds-sync/node_modules/@elaraai/east-app-design-system`
- **Package-root `node_modules` must be a REAL directory containing only an
  `@types` symlink** (`ln -s ../.ds-sync/node_modules/@types node_modules/@types`).
  Making `node_modules` itself a symlink to `.ds-sync/node_modules` combines
  with the tokens self-symlink into a cycle the `.d.ts` glob follows → OOM.
  It exists so dts.mjs's walk-up finds `@types/react` (pnpm keeps the
  workspace tree sparse).
- **Playwright**: this box's `~/.cache/ms-playwright` has chromium-1228 →
  install `playwright@1.61.0` into `.ds-sync` (the workspace's own pin is
  1.59.x → chromium-1217, a mismatch; don't trust the repo pin).
- Deps installed in `.ds-sync`: esbuild, ts-morph, @types/react@19, react@19,
  react-dom@19, typescript, playwright@1.61.0.

## Layout / config rationale

- No dist and no build: `--entry ./index.jsx` (hand-added barrel) anchors
  PKG_DIR; `index.d.ts` (hand-added) is the types entry `exportedNames`
  walks. **Adding a 9th atom requires updating BOTH barrels.**
- `tokensPkg` is the package itself via the self-symlink; `tokensGlob`
  ships `tokens/*.css`; `cssEntry: base/semantic.css` becomes
  `_ds_bundle.css` (atom CSS is runtime-injected from the .jsx files, so
  there is no component stylesheet to ship).
- `docsMap` enumerates all 8 deliberately: source docs are named
  `<Name>.prompt.md`, which sibling discovery (`<Name>.md`) can't match.
  NOTE the repo's `components/core/<Name>.prompt.md` are SOURCE files, not
  sync output — the source layout coincidentally mirrors the upload layout.
- `guidelines/reference/` and `guidelines/cards/` intentionally NOT shipped
  (readme: "nothing in here ships to consumers"); the key spec rules are
  distilled into `.design-sync/conventions.md` instead.
- `[FONT_REMOTE]` for DM Sans / Inter Tight / JetBrains Mono is expected —
  fonts load from Google via the `@import` in `tokens/typography.css`.
- `cardMode: column` on all atoms except Button + viewport overrides:
  GRID_OVERFLOW remediation (DeltaPill's overflow was caught by eyeball,
  not the validator — check the contact sheet, not just warns).

## Known render warns

- (none outstanding — 8/8 clean, 0 bad/thin/variantsIdentical)

## Distilled guidelines (added after first sync)

- `guidelines/{app-layout,base-components,charts}.md` are DISTILLATIONS with
  verbatim values from: `guidelines/reference/index.html` (§1.4–1.7 recipes
  + stdlib), `guidelines/reference/charts.js` (ECharts theme), and
  `packages/e3-ui/dist/App bar density variants.html` (app-bar densities
  comfortable/compact/condensed + breadcrumb nesting/overflow rules — that
  render is the shell's source of truth). If any of those change,
  re-distill; the .md files do not auto-track them.
- Each recipe names its production tag; tag names were validated against
  `packages/east-ui/SKILL.md` — revalidate after east-ui API changes.
- `.design-sync/conventions.md` frames the handoff: designs map 1:1 onto
  `@elaraai/east-ui` / `@elaraai/e3-ui` components. Don't reintroduce a
  bare `window.East` destructure snippet — the generated README body
  already documents loading; the header stays mechanism-neutral.

## Re-sync risks

- `conventions.md` names were validated against the 2026-07-22 build. If
  `tokens/*.css` renames/removes tokens, re-run the header validation pass.
- The Google-Fonts remote `@import` means rendered designs need network at
  render time; if that ever breaks in the product, switch to
  `cfg.extraFonts` with vendored woff2s.
- Grades/verification carry from the uploaded `_ds_sync.json`; the local
  `.design-sync/.cache/` is disposable.
- `.design-sync/previews/*.tsx` compose against the current atom APIs; an
  atom prop change (e.g. Status level names) silently stales them — the
  driver's pendingGrade partition will surface it, grade from fresh sheets.
