# component_design

Individually-managed component-design HTML files. Each is a single
`.pattern` / `.bsys` element from the East Application Design System's
reference pages, produced as a standalone page that **links** the shared
design-system CSS instead of embedding it:

- `../app_design_system/styles.css` — tokens, fonts, base (the canonical
  design system; edit tokens there and every file here updates)
- `./spec.css` — shared structural rules (`.pattern`, `.frame`, `.btn`, …),
  seeded from the reference `spec.css` with its `:root` token block stripped
- plus each file's own page-local `<style>` rules, inline

## Workflow

- **Seed / re-seed** from the reference pages: `make design-html-all` (from
  `libs/east-ui/`). This **overwrites** every file here — git is the history
  once you start hand-editing.
- **Add PNGs** for a visual pass: `DESIGN_PNG=1 make design-html-all`
  (`.png` files are gitignored, never committed).
- **Browse**: `make design-html-serve` → http://localhost:5175/component_design/
  (served from the lib root so the `../app_design_system/…` links resolve).
  `file://` also works.

Once a file is hand-edited, manage it directly and don't re-run the seeder
over it (or it reverts to the reference). The seeder is for bootstrapping
new designs and refreshing untouched ones.
