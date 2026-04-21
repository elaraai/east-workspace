# East Node CLI Design Document

## Overview

`@elaraai/east-node-cli` is a command-line interface for running compiled East IR programs on Node.js. It provides a simple way to execute `.beast2`, `.beast`, `.east`, or `.json` IR files using dynamically loaded platform implementations.

This package is the Node.js equivalent of the Python `east-py-cli` package.

## Goals

1. **Simple execution**: Run compiled East IR files directly from the command line
2. **Dynamic platform loading**: Load platform functions from any npm package that follows the platform export convention
3. **Type-safe I/O**: Support typed input/output files with automatic format detection
4. **Cross-platform consistency**: Mirror the CLI interface of `east-py-cli` for a consistent developer experience
5. **Extensibility**: Support third-party platform packages without requiring CLI changes

## Package Structure

```
packages/east-node-cli/
├── src/
│   ├── index.ts          # Main entry point, exports version and main function
│   ├── cli.ts            # Commander-based CLI argument parsing
│   ├── loader.ts         # IR, value, and platform loading utilities
│   └── runner.ts         # IR compilation and execution
├── package.json
├── tsconfig.json
├── eslint.config.js
├── README.md
├── LICENSE.md
├── CONTRIBUTING.md
├── CLA.md
└── CLAUDE.md
```

## Platform Package Convention

Any npm package can provide platform functions by following this convention:

### What is a PlatformFunction?

A `PlatformFunction` is a JavaScript object that binds an East platform function definition to its implementation:

```typescript
type PlatformFunction = {
    name: string;              // Platform function name (e.g., "console_log")
    inputs: EastTypeValue[];   // East type metadata for input parameters
    output: EastTypeValue;     // East type metadata for return value
    type: 'sync' | 'async';    // Whether the implementation is async
    fn: (...args: any) => any; // The actual JavaScript implementation
};
```

These are created using `East.platform(...).implement(...)` or `East.asyncPlatform(...).implement(...)`.

### Export Convention

Platform packages must export a `./platform` subpath that default-exports a `PlatformFunction[]`:

**package.json:**
```json
{
  "name": "@elaraai/east-node-std",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./platform": {
      "types": "./dist/platform.d.ts",
      "default": "./dist/platform.js"
    }
  }
}
```

**src/platform.ts:**
```typescript
/**
 * Platform export for east-node-cli.
 * Default exports the complete array of PlatformFunction implementations.
 */
import { NodePlatform } from "./index.js";

export default NodePlatform;
```

### Example: east-node-io

For packages with multiple implementation sets, combine them:

```typescript
// src/platform.ts
import { SqliteImpl, PostgresImpl, MySqlImpl } from "./sql/index.js";
import { S3Impl } from "./storage/index.js";
import { FtpImpl, SftpImpl } from "./transfer/index.js";
import { RedisImpl, MongoDBImpl } from "./nosql/index.js";
import { XlsxImpl, XmlImpl } from "./format/index.js";
import { GzipImpl, ZipImpl, TarImpl } from "./compression/index.js";

export default [
    ...SqliteImpl,
    ...PostgresImpl,
    ...MySqlImpl,
    ...S3Impl,
    ...FtpImpl,
    ...SftpImpl,
    ...RedisImpl,
    ...MongoDBImpl,
    ...XlsxImpl,
    ...XmlImpl,
    ...GzipImpl,
    ...ZipImpl,
    ...TarImpl,
];
```

### Loading and Validation

The CLI loads platform functions using dynamic import and validates the structure.

**Important**: Platform packages must be installed before use. The CLI does **not** automatically install packages. If a package is not found, the CLI errors with install instructions.

```typescript
import type { PlatformFunction } from "@elaraai/east/internal";

async function loadPlatform(packageName: string): Promise<PlatformFunction[]> {
    let mod;
    try {
        // Dynamic import of the /platform subpath
        mod = await import(`${packageName}/platform`);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
            throw new Error(
                `Platform package '${packageName}' not found.\n` +
                `Install it with: npm install ${packageName}`
            );
        }
        throw err;
    }

    const platformFns = mod.default;

    // Validate structure
    if (!Array.isArray(platformFns)) {
        throw new Error(
            `${packageName}/platform must default-export an array of PlatformFunction`
        );
    }

    // Validate each platform function has required shape
    for (const fn of platformFns) {
        if (
            typeof fn.name !== 'string' ||
            !Array.isArray(fn.inputs) ||
            fn.output === undefined ||
            !['sync', 'async'].includes(fn.type) ||
            typeof fn.fn !== 'function'
        ) {
            throw new Error(
                `Invalid PlatformFunction in ${packageName}: missing or invalid properties`
            );
        }
    }

    return platformFns;
}
```

### Version Discovery

The CLI reads version information directly from the platform package's `package.json`:

```typescript
async function loadPlatformWithVersion(packageName: string): Promise<{
    fns: PlatformFunction[],
    version: string,
    name: string
}> {
    // Load platform functions
    const mod = await import(`${packageName}/platform`);

    // Load package.json for version (requires export in package.json)
    const pkgJson = await import(`${packageName}/package.json`, { with: { type: 'json' } });

    return {
        fns: mod.default,
        version: pkgJson.default.version,
        name: pkgJson.default.name
    };
}
```

Platform packages should export their `package.json`:

```json
{
  "exports": {
    ".": { ... },
    "./platform": { ... },
    "./package.json": "./package.json"
  }
}
```

## Dependencies

### Runtime Dependencies
- `commander` (^14.0.0) - CLI argument parsing
- `@elaraai/east` (^0.0.1-beta.5) - Core East language and compiler

### Dev Dependencies (consistent with east-node-std)
- `@types/node` (^22.18.1)
- `@typescript-eslint/eslint-plugin` (^8.42.0)
- `@typescript-eslint/parser` (^8.42.0)
- `eslint` (^9.34.0)
- `eslint-plugin-headers` (^1.3.3)
- `typescript` (~5.9.2)

**Note**: Platform packages (`@elaraai/east-node-std`, `@elaraai/east-node-io`, etc.) are NOT direct dependencies of the CLI. Users install them separately and specify them via `--package`.

## CLI Interface

### Command: `east-node run`

Execute an East IR program.

```bash
east-node run <ir_file> [options]

Arguments:
  ir_file                    Path to IR file (.beast2, .beast, .east, or .json)

Options:
  -p, --package <package>   Platform package providing functions (can be repeated)
  -i, --input <file>         Input data file (can be repeated, order matches function parameters)
  -o, --output <file>        Output file path for result
  -v, --verbose              Enable verbose output
  -h, --help                 Display help
```

**Examples:**
```bash
# Run with standard platform
east-node run ./program.beast2 -p @elaraai/east-node-std

# Run with multiple platforms
east-node run ./db-query.beast2 \
    -p @elaraai/east-node-std \
    -p @elaraai/east-node-io

# Run with input files
east-node run ./transform.beast2 \
    -p @elaraai/east-node-std \
    -i data.json -i config.east

# Run with custom/third-party platform
east-node run ./custom.beast2 \
    -p @elaraai/east-node-std \
    -p @myorg/my-east-platform

# Run with output file
east-node run ./process.beast2 \
    -p @elaraai/east-node-std \
    -i input.beast2 -o result.json

# Verbose mode
east-node run ./program.beast2 -p @elaraai/east-node-std -v
```

### Command: `east-node version`

Show version information for the CLI and optionally check installed platforms.

```bash
east-node version [options]

Options:
  -p, --package <package>   Check platform package (can be repeated)
```

**Example output:**
```
east-node-cli 0.0.1-beta.4
east 0.0.1-beta.5

Platforms:
  @elaraai/east-node-std 0.0.1-beta.4 (42 platform functions)
  @elaraai/east-node-io 0.0.1-beta.4 (28 platform functions)
```

## Key Design Decisions

### 1. Dynamic Platform Loading

Platform functions are loaded dynamically at runtime from npm packages. This design:

- **Supports extensibility**: Any package following the convention can provide platform functions
- **Avoids hard-coded dependencies**: The CLI doesn't need to know about specific platform packages
- **Enables third-party platforms**: Organizations can create custom platform packages
- **Matches east-py-cli**: Consistent approach across Python and Node.js CLIs

### 2. Platform Package Requirements

For a package to work with `east-node-cli`, it must:

1. **Export `./platform` subpath**: The package.json must have an export for `./platform`
2. **Default export array**: The platform module must default-export a `PlatformFunction[]`
3. **Export `./package.json`**: For version discovery
4. **Be installed**: The package must be installed in the project or globally

Example platform package structure:
```
my-platform/
├── src/
│   ├── index.ts        # Main exports (types, namespaces, etc.)
│   └── platform.ts     # Platform function implementations (default export)
├── package.json        # Must export ./platform and ./package.json
└── ...
```

### 3. Format Detection

File formats are detected by extension:
- `.beast2`, `.beast` → Binary East format (beast2)
- `.east` → Text East format
- `.json` → JSON format

### 3. Async Execution

The CLI uses `compileAsync` by default to support async platform functions (Time, Fetch, all I/O operations). This is necessary because:
- Many I/O platform functions are inherently async
- Using `compile` would fail for IR that references async platform functions

### 4. Type-Directed I/O

Input and output files use type-directed parsing/serialization based on the function signature extracted from the IR:
- Input files are parsed according to the function's parameter types
- Output files are serialized according to the function's return type

## Implementation Details

### loader.ts

```typescript
// Detect format from file extension
function detectFormat(filePath: string): 'beast2' | 'east' | 'json';

// Load IR from a file
function loadIR(filePath: string): FunctionIR | AsyncFunctionIR;

// Load a value with type-directed parsing
function loadValue(filePath: string, valueType: EastType): unknown;

// Save a value with type-directed serialization
function saveValue(filePath: string, value: unknown, valueType: EastType): void;
```

### runner.ts

```typescript
import type { PlatformFunction } from "@elaraai/east/internal";

// Get function signature from IR
function getFunctionSignature(ir: FunctionIR | AsyncFunctionIR): {
    paramTypes: EastType[];
    returnType: EastType;
    isAsync: boolean;
};

// Run the program with dynamically loaded platforms
async function runProgram(
    ir: FunctionIR | AsyncFunctionIR,
    platformFns: PlatformFunction[],
    inputFiles: string[],
    outputFile?: string,
    verbose?: boolean
): Promise<unknown>;
```

### cli.ts

```typescript
import { Command } from 'commander';

const program = new Command();

program
    .name('east-node')
    .description('Run East IR programs with Node.js platform functions')
    .version(version);

program
    .command('run')
    .description('Run an East IR program')
    .argument('<ir_file>', 'Path to IR file (.beast2, .beast, .east, or .json)')
    .option('-p, --package <package...>', 'Platform packages to load (can be repeated)')
    .option('-i, --input <file...>', 'Input data files (order matches function parameters)')
    .option('-o, --output <file>', 'Output file path for result')
    .option('-v, --verbose', 'Enable verbose output')
    .action(cmdRun);

program
    .command('version')
    .description('Show version information')
    .option('-p, --package <package...>', 'Platform packages to check')
    .action(cmdVersion);
```

## package.json Configuration

```json
{
  "name": "@elaraai/east-node-cli",
  "version": "0.0.1-beta.4",
  "description": "Command-line interface for running East IR programs with Node.js",
  "bin": {
    "east-node": "./dist/index.js"
  },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE.md",
    "CONTRIBUTING.md",
    "CLA.md"
  ],
  "scripts": {
    "build": "tsc",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "test": "npm run build && node --enable-source-maps --test 'dist/**/*.spec.js'"
  },
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  },
  "dependencies": {
    "@elaraai/east": "^0.0.1-beta.5",
    "commander": "^14.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.18.1",
    "@typescript-eslint/eslint-plugin": "^8.42.0",
    "@typescript-eslint/parser": "^8.42.0",
    "eslint": "^9.34.0",
    "eslint-plugin-headers": "^1.3.3",
    "typescript": "~5.9.2"
  }
}
```

**Note**: Platform packages (`@elaraai/east-node-std`, `@elaraai/east-node-io`, etc.) are **not** dependencies of the CLI. Users install them separately and specify them via `--package`.

### Hashbang for Binary

The `src/index.ts` file must include a hashbang for direct execution:

```typescript
#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { main } from './cli.js';

export const __version__ = '0.0.1-beta.4';
export { main };

main();
```

## Workflow Updates

The CLI is published alongside every other `@elaraai/*` npm package under a single unified version via the root `.github/workflows/npm-publish.yml` workflow. No per-package publish configuration is required.

## Usage Examples

### Installation

```bash
# Install CLI globally
npm install -g @elaraai/east-node-cli

# Install platform packages (required before running)
npm install @elaraai/east-node-std
npm install @elaraai/east-node-io  # if using I/O functions
```

### Basic Usage

```bash
# Run with standard platform
east-node run ./my-program.beast2 -p @elaraai/east-node-std

# Run with multiple platforms
east-node run ./db-query.beast2 \
    -p @elaraai/east-node-std \
    -p @elaraai/east-node-io

# Run with inputs and output
east-node run ./transform.beast2 \
    -p @elaraai/east-node-std \
    -i input-data.json \
    -i config.east \
    -o result.beast2
```

### Error: Platform Not Installed

If you try to use a platform that isn't installed:

```bash
$ east-node run ./program.beast2 -p @elaraai/east-node-std

Error: Platform package '@elaraai/east-node-std' not found.
Install it with: npm install @elaraai/east-node-std
```

### Programmatic Usage

The package also exports its main function for programmatic use:

```typescript
import { main } from '@elaraai/east-node-cli';

// Programmatically run the CLI
process.argv = ['node', 'east-node', 'run', './program.beast2', '-p', '@elaraai/east-node-std'];
main();
```

## Differences from east-py-cli

| Feature | east-py-cli | east-node-cli |
|---------|-------------|---------------|
| Package specification | `--package PKG` or `-p PKG` | `--package PKG` or `-p PKG` |
| CLI framework | argparse | commander |
| Default execution | Detects sync/async | Always async |
| Platform discovery | `{pkg}.platform` attribute | `{pkg}/platform` subpath export |
| Install instructions | `uv add {pkg}` | `npm install {pkg}` |

## Future Considerations

1. **REPL mode**: Add an interactive REPL for East expressions
2. **Watch mode**: Re-run on file changes
3. **Debugging**: Add debug/trace output options
