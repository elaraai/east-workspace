# east-ui-extension webview

Internal — not published. Build-time split of the
[`east-ui-extension`](..) VS Code extension.

React app bundled into the VS Code webview panel. Vite-built; consumed by the
extension's webview-creation code in `../src/`.

## Build

The webview builds as part of the extension's `make extension` target. To
build standalone for debugging:

```bash
npm run build      # produces dist/ for the parent extension to load
```

## See also

- [Extension README](../README.md) — user-facing docs
- [Extension CLAUDE.md](../CLAUDE.md) — agent orientation (CSP, font hosting, build pipeline)
