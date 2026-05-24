<!--
Published-package README template. Use as the skeleton when creating or
rewriting a README for any package that ships to npm / PyPI / VS Marketplace.

Placeholders:
  {{DISPLAY_NAME}}    Title-cased package display name (e.g. "East Node IO")
  {{TAGLINE}}         One-line summary
  {{NPM_PKG}}         npm package name (e.g. "@elaraai/east-node-io")
  {{LIB}}             Lib directory under libs/ (e.g. "east-node")
  {{LICENSE_BADGE}}   Badge URL fragment matching the package's license model

Rules (per project conventions):
- NO emoji bullets in feature lists. Use `- **Bold**: description` only.
- Pull code examples from .examples.ts file bodies where they exist; do not
  invent snippets that aren't tested.
- Ecosystem and About Elara blocks come verbatim from docs/snippets/.
- Repository URLs always point at github.com/elaraai/east-workspace.
-->

# {{DISPLAY_NAME}}

> {{TAGLINE}}

[![License]({{LICENSE_BADGE}})](LICENSE.md)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

**{{DISPLAY_NAME}}** provides <one-paragraph description with link to [East](https://github.com/elaraai/east-workspace/tree/main/libs/east)>.

## Features

- **Feature 1**: …
- **Feature 2**: …
- **Feature 3**: …

## Installation

```bash
npm install {{NPM_PKG}} @elaraai/east
```

## Quick Start

```ts
// Code from libs/{{LIB}}/packages/{{NPM_PKG}}/test/*.examples.ts (fn: body only)
import { East } from "@elaraai/east";
// ...
```

## <Reference section>

<Tables / lists enumerating the public API surface.>

## Development

`make build`, `make test`, `make lint` from this directory. See [`MAKEFILE_TARGETS.md`](../../../../docs/conventions/MAKEFILE_TARGETS.md) for the full target list.

## Documentation

- [USAGE.md](USAGE.md) — end-user guide (if present)
- [STANDARDS.md](STANDARDS.md) — mandatory dev standards (if present)
- [CONTRIBUTING.md](CONTRIBUTING.md) — contributing + CLA
- [LICENSE.md](LICENSE.md) — license

## License

<License declaration matching the package's model — see docs/license-templates/.>

<!-- Ecosystem block — keep in sync with docs/snippets/ECOSYSTEM.md -->

### Ecosystem

<Copy verbatim from docs/snippets/ECOSYSTEM.md>

## Links

- **Website**: https://elaraai.com/
- **Repository**: https://github.com/elaraai/east-workspace
- **Issues**: https://github.com/elaraai/east-workspace/issues
- **Email**: support@elara.ai

<!-- About Elara — keep in sync with docs/snippets/ABOUT_ELARA.md -->

## About Elara

<Copy verbatim from docs/snippets/ABOUT_ELARA.md>

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/).*
