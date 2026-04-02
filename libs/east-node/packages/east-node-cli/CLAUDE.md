# East Node CLI

East Node CLI provides a command-line interface for running East IR programs with Node.js.

## Purpose

East Node CLI enables users to execute compiled East IR files from the command line by:

- **Dynamic Platform Loading**: Load platform functions from any npm package following the convention
- **Multiple Format Support**: Run `.beast2`, `.beast`, `.east`, or `.json` IR files
- **Type-Safe I/O**: Parse inputs and serialize outputs based on function signatures
- **Extensibility**: Support third-party platform packages without CLI changes

## Structure

East Node CLI is a TypeScript package that depends on the East language package and Commander.

- `/src` - source code for the CLI
  - `index.ts` - entry point with hashbang
  - `cli.ts` - Commander-based argument parsing
  - `loader.ts` - IR and platform loading utilities
  - `runner.ts` - compilation and execution

## Development

When making changes to the East Node CLI codebase always run:

- `npm run build` - compile TypeScript to JavaScript
- `npm run test` - run the test suite (runs the compiled .js - requires build first)
- `npm run lint` - check code quality with ESLint (must pass before committing)

## Platform Package Convention

Platform packages must:

1. Export `./platform` subpath with default export of `PlatformFunction[]`
2. Export `./package.json` for version discovery

Example:
```typescript
// src/platform.ts
import { NodePlatform } from "./index.js";
export default NodePlatform;
```

```json
// package.json exports
{
  "exports": {
    ".": { ... },
    "./platform": { "default": "./dist/platform.js" },
    "./package.json": "./package.json"
  }
}
```
