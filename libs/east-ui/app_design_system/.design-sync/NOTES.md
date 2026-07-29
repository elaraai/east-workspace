# design-sync notes — East Application Design System

Re-sync command (from `app_design_system/`, after re-staging scripts per the
skill's step-7 `cp -r` line and the symlink setup below):

```sh
node .ds-sync/resync.mjs --config .design-sync/config.json \
  --node-modules .ds-sync/node_modules --entry ./index.jsx \
  --out ./ds-bundle --remote .design-sync/.cache/remote-sync.json \
  && node .design-sync/extra-cards.mjs
```

The `extra-cards.mjs` step is MANDATORY after every build: it copies (a) the
hand-authored specimen cards (`guidelines/cards/*.html` — groups Colors /
Type / Foundations / Conventions / App layout, own `@dsCard` markers,
`../../styles.css` links valid at that depth) and (b) the ~120 component-level
pattern specs (`guidelines/patterns/<category>/*.html` + shared
`guidelines/patterns/spec.css` — `@dsCard` groups "Patterns · <Category>",
`../../../styles.css` + `../spec.css` links valid at that depth) into
ds-bundle so they upload with `guidelines/**` and register in the picker.
Skipping it makes the next close-out reconciliation DELETE them remotely.
The patterns set is reconciled against packages/east-ui + packages/e3-ui
(2026-07-29): only implemented subjects are filed — see
`guidelines/patterns/README.md`. `components/core/core.card.html` is
deliberately not shipped (unpkg-CDN React + babel — superseded by the 8
per-component cards).

## Which project a sync targets

`config.json` pins the CANONICAL team project (`projectId` 1ee95b77… —
owned by eforster, org-shared for team write access). That id is an
address, not a credential: reading/writing it requires a claude.ai login
with access. Two models for other devs:

- **Team project (default):** get edit access via claude.ai project
  sharing; the committed `projectId` then works as-is with your own login.
- **Personal sandbox:** `create_project` under your account, put YOUR id
  in `.design-sync/config.local.json` (gitignored) as
  `{"projectId": "<uuid>"}`. Any sync flow must prefer
  `config.local.json`'s projectId over `config.json`'s when present.
  Never commit your personal id over the canonical one.

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
- `guidelines/cards/` and `guidelines/patterns/` ship via `extra-cards.mjs`,
  not the converter's `guidelinesGlob`. The old full-page reference pages
  (`guidelines/reference/`) were removed from the repo 2026-07-29 (git
  history only); the key spec rules live in `.design-sync/conventions.md`
  and the per-pattern specs.
- `[FONT_REMOTE]` for DM Sans / Inter Tight / JetBrains Mono is expected —
  fonts load from Google via the `@import` in `tokens/typography.css`.
- `cardMode: column` on all atoms except Button + viewport overrides:
  GRID_OVERFLOW remediation (DeltaPill's overflow was caught by eyeball,
  not the validator — check the contact sheet, not just warns).

## Known render warns

- (none outstanding — 8/8 clean, 0 bad/thin/variantsIdentical)

## Distilled guidelines (added after first sync)

- `guidelines/{app-layout,base-components,charts}.md` are DISTILLATIONS with
  verbatim values from: the retired reference pages' `index.html` (§1.4–1.7
  recipes + stdlib) and `charts.js` (ECharts theme) — both git-history-only
  since 2026-07-29 — and `packages/e3-ui/dist/App bar density variants.html`
  (app-bar densities comfortable/compact/condensed + breadcrumb
  nesting/overflow rules — that render is the shell's source of truth).
  The live per-pattern truth is `guidelines/patterns/`; if the e3-ui render
  changes, re-distill — the .md files do not auto-track it.
- Each recipe names its production tag; tag names were validated against
  `packages/east-ui/SKILL.md` — revalidate after east-ui API changes.
- `.design-sync/conventions.md` frames the handoff: designs map 1:1 onto
  `@elaraai/east-ui` / `@elaraai/e3-ui` components. Don't reintroduce a
  bare `window.East` destructure snippet — the generated README body
  already documents loading; the header stays mechanism-neutral.

## Re-sync risks

- The patterns fold (2026-07-29) was pushed INCREMENTALLY via the DesignSync
  tool (not the converter): 120 pattern HTML + `guidelines/patterns/spec.css`
  written, remote `guidelines/guidelines/proposals/*.md` deleted (dropped
  from `guidelinesGlob` the same day — the proposals were implementation
  ADRs, all shipped; since removed from the repo too, git history only),
  and `README.md` + `guidelines/index.md` hand-spliced remotely.
  GOTCHA: the Design System pane renders ONLY `_ds_manifest.json` — an
  incremental push does not recompile it, and `register_assets` (legacy
  store) did NOT surface the cards either. The working fix was rewriting
  `_ds_manifest.json` itself: cards[] = 24 original + 120 patterns
  (viewport as a "900x640" STRING, matching existing entries), everything
  else regenerated from local truth (tokens parsed from `tokens/*.css` —
  145 entries incl. the 32 dark-scoped duplicates; spot-asserted against
  the previous manifest before upload). When adding patterns incrementally,
  update the manifest too — or run the full converter resync, which
  recompiles it from the `@dsCard` markers. `guidelines/patterns/index.md`
  (full linked index, also linked from the remote README and
  `guidelines/index.md`) ships via extra-cards.mjs. The `@dsCard`
  name/subtitle/viewport values were generated mechanically from filenames
  and origin titles — refine by hand where they read poorly.
- NEXT full converter resync: the regenerated README body and
  `guidelines/index.md` will NOT carry the hand-spliced patterns mentions
  (the converter only knows `guidelinesGlob`) — re-add the patterns
  sentence to the README body / index after the build, or fold that splice
  into `extra-cards.mjs`. The header side is safe (it comes from
  `conventions.md`, which already names `guidelines/patterns/`).
  extra-cards.mjs re-uploads identical pattern files (no-op diff) — and
  remains MANDATORY, else close-out deletes cards AND patterns remotely.

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
