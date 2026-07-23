# component_design

Individually-managed component-design HTML files, organized into
subdirectories that mirror the `src/` taxonomy of `packages/east-ui/src`
and `packages/e3-ui/src` (`buttons/`, `collections/`, `display/`, `forms/`,
`slice/`, `decision/`, `experiment/`, …). Two non-`src` folders:

- **`foundations/`** — brand/token specimens (palette, neutrals, semantic,
  type, spacing, surfaces, motion, …) that have no `src` component home.
- **`unsure/`** — patterns without a clear `src` category (scenario, trust /
  provenance / communicate, use-case screens, meta docs). Re-file as the
  taxonomy settles.

Each file is a single `.pattern` / `.bsys` element from the design system's
reference pages, produced as a standalone page that **links** the shared
design-system CSS instead of embedding it:

- `../../app_design_system/styles.css` — tokens, fonts, base (the canonical
  design system; edit tokens there and every file here updates)
- `../spec.css` — shared structural rules (`.pattern`, `.frame`, `.btn`, …),
  seeded from the reference `spec.css` with its `:root` token block stripped
- plus each file's own page-local `<style>` rules, inline

(Files at a given depth link the CSS relative to that depth — the two links
above are for the one-level-deep category folders. A freshly-seeded file in
the `component_design/` root links `../app_design_system/…` + `./spec.css`.)

## Workflow

- **Seed / re-seed** from the reference pages: `make design-html-all` (from
  `libs/east-ui/`). The seeder writes **flat** into the `component_design/`
  root as `<page>__<pattern|bsys>__<id>.html` — it is a **bootstrap** for
  new/changed patterns, not the filing system. After a seed, file each new
  one: (1) move it into its category subdir, (2) rename it to a clean `<id>`
  (drop the `<page>__<type>__` provenance prefix; the origin page still
  lives in the file's `<title>`), and (3) add one `../` to its two CSS links
  (root `../app_design_system` → `../../`, `./spec.css` → `../spec.css`).
  The seeder does **not** touch already-filed subdir files, so hand edits
  are safe.
- **Add PNGs** for a visual pass: `DESIGN_PNG=1 make design-html-all`
  (`.png` files are gitignored, never committed).
- **Browse**: `make design-html-serve` → http://localhost:5175/component_design/
  (served from the lib root so the `../../app_design_system/…` links resolve).
  `file://` also works.

Once a file is filed and hand-edited, manage it directly; the seeder is for
bootstrapping new designs and refreshing untouched ones.
