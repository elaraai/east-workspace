# east-ui-extension

VS Code extension that browses e3 repositories and previews task
outputs as East UI components in a webview.

## Webview specifics

- The webview's CSP is `font-src ${cspSource}` — Google Fonts CDN
  (`fonts.googleapis.com`) is **blocked**.
- Fonts must be self-hosted via `@fontsource-variable/*` packages (see
  east-ui-components for the canonical setup). The webview pulls them
  through the host extension's asset pipeline.
- React, Chakra, and TanStack libraries are bundled into the webview;
  no runtime CDN.

## Build

`make extension` from `libs/east-ui/`. `make extension-install` /
`extension-uninstall` manages the local VS Code install for testing.

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — lib-level overview with build
  targets.
- [`../east-ui-components/CLAUDE.md`](../east-ui-components/CLAUDE.md)
  — the renderer this extension embeds (CSP / font-hosting rules
  originate from there).
