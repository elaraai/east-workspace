# East Node CLI

Command-line tool for running East IR programs with Node.js. Loads
platform functions dynamically from any npm package following the
`./platform` export convention.

Supports `.beast2`, `.beast`, `.east`, and `.json` IR files.

## Platform package convention

Third-party platform packages must export:

```json
{
  "exports": {
    ".": { ... },
    "./platform": { "default": "./dist/platform.js" },
    "./package.json": "./package.json"
  }
}
```

Where `./platform`'s default export is a `PlatformFunction[]`:

```typescript
// src/platform.ts
import { NodePlatform } from "./index.js";
export default NodePlatform;
```

## See also

- [`README.md`](README.md) — public-facing usage.
- [`../CLAUDE.md`](../../CLAUDE.md) — lib-level overview.
