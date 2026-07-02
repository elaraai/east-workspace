# e3-ui-cli

Command-line renderer for east-ui / e3-ui components: `e3-ui shot` turns an
East `UIComponentType` function (or an e3 `ui()` task) into a PNG via a
pre-bundled React renderer + managed headless Chromium. Browser lifecycle is
owned by `src/browser.ts` (`install-browser` / `doctor`, launch cascade with
env override → playwright cache → system browser, snap-shim rejection).

## Plugin skill

`SKILL.md` backs the `east:e3-ui-cli` plugin skill (the plugin symlinks to
it) — **DO NOT EDIT casually**; coordinate first.

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — east-ui lib-level overview.
- [`../east-ui/STANDARDS.md`](../east-ui/STANDARDS.md) — TypeDoc + testing
  standards (shared with east-ui); they apply to this package's public
  surface.
- [`docs/DESIGN_RELEASE_AND_HEADLESS.md`](docs/DESIGN_RELEASE_AND_HEADLESS.md)
  — reviewed design for the release integration + headless browser strategy.
