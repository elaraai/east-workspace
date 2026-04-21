# East

**East** is a statically typed, expression-based programming language embedded in TypeScript. Designed for the [Elara](https://elaraai.com/) platform, East enables you to write portable logic once and execute it across multiple environments (JavaScript, Julia, Python, and more), leveraging each language's native performance characteristics and ecosystem.

## Motivation

Delivering a complete business solution requires a wide range of technologies and activities: data integrations, mathematical optimization, machine learning, simulation, user interfaces, authentication & authorization, hosting, managing data consistency, auditing, etc.
Multiple programming environments are required to solve any given business problem - for example you may use JavaScript for web front ends and python for training and evaluating machine learning models.

East is designed to make it easy to fuse different technologies together by focussing on a simple yet powerful structural type system which makes all the boilerplate and plumbing work disappear, letting you spend more time solving real-world problems.
East is intentionally a simple language that is fast to learn and straightforward to implement in new runtimes.

## Features

- **🔒 Static Typing**: All types, functions and values declared explicitly for speed and correctness
- **🎯 Structural Typing**: Expressive type system with recursive types, first-class functions and polymorphic variants
- **🚀 Portable IR**: Compile to JavaScript, Python and Julia
- **🔐 Controlled Side Effects**: Secure execution with cross-language platform-defined effects
- **🤖 LLM Friendly**: Designed for AI with clear, composable yet stochastic friendly aliases
- **🔄 Serializable**: All data can be serialized; functions and closures can be transmitted as IR
- **📦 Minimal Dependencies**: Single runtime dependency (sorted-btree for efficient collections)
- **🛡️ Total Ordering**: All types have defined comparisons that are consistent across all language targets


## Quick Start

### Installation

```bash
npm install @elaraai/east
```

### Basic Example


```typescript
import { East, IntegerType, ArrayType, StructType, StringType, DictType, NullType } from "@elaraai/east";

// Platform function for logging
const log = East.platform("log", [StringType], NullType);

const platform = [
    log.implement(console.log),
];

// Define sale data type
const SaleType = StructType({
    product: StringType,
    quantity: IntegerType,
    price: IntegerType
});

// Calculate revenue per product from sales data
const calculateRevenue = East.function(
    [ArrayType(SaleType)],
    DictType(StringType, IntegerType),
    ($, sales) => {
        // Group sales by product and sum revenue (quantity × price)
        const revenueByProduct = sales.groupSum(
            // Group by product name
            ($, sale) => sale.product,
            // Sum quantity × price
            ($, sale) => sale.quantity.multiply(sale.price)
        );

        // Log revenue for each product
        $(log(East.str`Total Revenue: ${East.Integer.printCurrency(revenueByProduct.sum())}`));

        $.return(revenueByProduct);
    }
);

// Compile and execute
const compiled = East.compile(calculateRevenue, platform);

const sales = [
    { product: "Widget", quantity: 10n, price: 50n },
    { product: "Gadget", quantity: 5n, price: 100n },
    { product: "Widget", quantity: 3n, price: 50n }
];

compiled(sales);
// Total Revenue: $1,150
```

## Type System

East supports a rich type system optimized for business logic and data processing:

| Type | ValueTypeOf<Type> | Mutability | Description |
|------|-----------------|------------|-------------|
| **Primitive Types** | | | |
| `NullType` | `null` | Immutable | Unit type (single value) |
| `BooleanType` | `boolean` | Immutable | True or false |
| `IntegerType` | `bigint` | Immutable | 64-bit signed integers |
| `FloatType` | `number` | Immutable | IEEE 754 double-precision |
| `StringType` | `string` | Immutable | UTF-8 text |
| `DateTimeType` | `Date` | Immutable | UTC timestamp with millisecond precision |
| `BlobType` | `Uint8Array` | Immutable | Binary data |
| **Mutable Collections** | | | |
| `ArrayType<T>` | `ValueTypeOf<T>[]` | **Mutable** | Ordered collection |
| `SetType<K>` | `Set<ValueTypeOf<K>>` | **Mutable** | Sorted set |
| `DictType<K, V>` | `Map<ValueTypeOf<K>, ValueTypeOf<V>>` | **Mutable** | Sorted dictionary |
| `RefType<T>` | `ref<ValueTypeOf<T>>` | **Mutable** | Refcell, mutable box |
| **Numeric Arrays** | | | |
| `VectorType<FloatType>` | `Float64Array` | **Mutable** | Dense float vector |
| `VectorType<IntegerType>` | `BigInt64Array` | **Mutable** | Dense integer vector |
| `VectorType<BooleanType>` | `Uint8ClampedArray` | **Mutable** | Dense boolean vector |
| `MatrixType<T>` | `matrix<TypedArray>` | **Mutable** | Dense 2D matrix (row-major) |
| **Compound types** | | | |
| `StructType<Fields>` | `{...}` | Immutable | Product type (records) |
| `VariantType<Cases>` | `variant` | Immutable | Sum type (tagged unions) |
| `RecursiveType<T>` | `ValueTypeOf<T>` | Immutable | Recursive references for trees, DAGs, and circular structures |
| **Function Type** | | | |
| `FunctionType<I, O>` | Function | Immutable | First-class functions/closures |
| `AsyncFunctionType<I, O>` | Function returning `Promise` | Immutable | Asynchronous functions/closures |

## Documentation

- **[SKILL.md](SKILL.md)** - Comprehensive guide with API and example reference
- **[LICENSE.md](LICENSE.md)** - Dual licensing information (AGPL-3.0 / Commercial)
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - How to contribute to East
- **[CLA.md](CLA.md)** - Contributor License Agreement

## Key Concepts

### Platform Functions

East code runs in a controlled environment. You define **platform functions** that your East code can call:

```typescript
// Define platform functions
const log = East.platform("log", [StringType], NullType);
const readFile = East.platform("readFile", [StringType], StringType);

// Provide implementations
const platform = [
    log.implement((msg: string) => console.log(msg)),
    readFile.implement((path: string) => fs.readFileSync(path, 'utf-8')),
];

// Compile with platform
const compiled = East.compile(myFunction, platform);
```

East also supports `asyncPlatform` functions (which may be called by `AsyncFunctionType` user-defined functions), inserting `await` automatically as required.
In the above, `readFile` could have been implemented using `fs.promises.readFile` to take advantage of concurrency.

### Fluent Interface

Build expressions using chainable methods:

```typescript
const myFunction = East.function([IntegerType], IntegerType, ($, x) => {
    // Arithmetic
    const result = $.const(x.add(10n).multiply(2n));

    // Collections
    const arr = $.const([1n, 2n, 3n]);
    const doubled = $.const(arr.map(($, x, i) => x.multiply(2n)));
    const sum = $.const(doubled.sum());

    // Closures can capture variables from the enclosing scope
    const addResult = $.const(East.function([IntegerType], IntegerType, ($, y) => {
        $.return(y.add(result));
    }));

    $.return(addResult(sum));
});

// Compile and execute
const compiled = East.compile(myFunction, []);
compiled(5n);
// 42n — result = (5+10)*2 = 30, sum of [2,4,6] = 12, addResult(12) = 12+30 = 42
```

### Serialization

All East data can be written and read in any of the following formats:

 * East text format (a JSON-like format designed for the East type system)
 * A binary East format called "beast" (compact, self-describing, streaming)
 * JSON (with a canonical encoding for each East type)

Note that mutable aliasing _is_ preserved through serialization/deserialization.

Function and closure definitions can be serialized as IR in the Beast2 binary format and transmitted across environments to compile and run on the other side:

```typescript
import { East, IntegerType, Expr, encodeBeast2For, decodeBeast2For } from "@elaraai/east";

const myFunction = East.function([IntegerType], IntegerType, ($, x) => {
    $.return(x.add(1n));
});

// the type of the function (IntegerType -> IntegerType)
const funcType = Expr.type(myFunction);

// Compile the function (this attaches the IR)
const compiled = East.compile(myFunction, []);

// Serialize the compiled function to Beast2 (binary format)
const encode = encodeBeast2For(funcType);
const bytes = encode(compiled);

// Deserialize and recompile
const decode = decodeBeast2For(funcType);
const restored = decode(bytes);

restored(41n); // 42n
```

## Examples

See the [SKILL.md](./SKILL.md) for more.

## Development

### Building

```bash
npm run build       # Compile TypeScript to JavaScript
npm run test        # Run test suite (requires build first)
npm run lint        # Check code quality with ESLint
npm run example     # Run the basic example
```

### Testing

East has a comprehensive test suite with tests covering:

- Type system operations
- Serialization formats (BEAST v1/v2, JSON, EAST text format)
- Collections and functional operations
- Error handling and edge cases

Notably, these tests are hosted in East and allow one to validate the correctness of a new runtime with ease (effectively acting as a compliance suite).

### Release Process

The entire monorepo ships under one unified version (root `/package.json`) via the `Release` GitHub Actions workflow (`.github/workflows/release.yml`). One `workflow_dispatch` produces:

- **18 npm packages** (`@elaraai/*`) — published with provenance, `workspace:*` deps rewritten to the exact version
- **5 PyPI packages** (`east-py`, `east-py-std`, `east-py-io`, `east-py-cli`, `east-py-datascience`) — version translated to PEP 440 (`1.0.0-beta.5` → `1.0.0b5`); pure-Python packages get a wheel + sdist via `uv build`, the Cython core uses `cibuildwheel` (linux + macos + windows × cp311/312/313); uploaded via PyPI trusted publishing (OIDC, no token)
- **1 VSCode extension** (`east-ui-preview`) — `vsce publish` to VS Marketplace; on stable releases the VSIX version equals the npm version, on beta releases it's patch-bumped on its own track and published with `--pre-release` (marketplace doesn't accept semver pre-release labels)
- **2 native C binaries** — `east-c` CLI + libs + headers tarballed for `linux-x64` and `linux-arm64`, attached to the GitHub Release
- **1 git tag + 1 GitHub Release** (`vX.Y.Z`) — VSIX and C tarballs attached as release assets

`release_type` is one of `prerelease | prepatch | preminor | premajor | patch | minor | major`. `pre*` types go to the npm `beta` dist-tag, others to `latest`.

`dry_run` defaults to `true` — runs the full build, dry-run npm publish, packaged-but-not-published VSIX, built-but-not-uploaded PyPI wheels, built-but-not-attached C tarballs. No commit, no tag, no upload.

#### Preflight checks

Before any publish runs, `prepare` verifies:
- `VSCE_PAT` is present and validates against the ElaraAI publisher (via `vsce verify-pat`)
- npm and PyPI registries are reachable
- `force_version` (if provided) is valid semver
- `skip_*` inputs are only set when `force_version` is also set

This catches the "expired PAT 10 minutes into a release" failure mode before anything ships.

#### Retry-after-failure pattern

If a release trigger partially succeeds (e.g. npm published, VSIX failed), use the retry inputs:

1. Identify which channels succeeded from the Actions logs.
2. Re-trigger with `force_version=<same version as the failed run>` and `skip_<channel>=true` for every channel that already succeeded.
3. Validation enforces this: any `skip_*` input requires `force_version` to be set.

Idempotency by channel:
- **npm** — `scripts/publish-npm.mjs` queries each package's registry version and skips already-published packages. Partial-failure retry works even without `skip_npm`.
- **PyPI** — `pypa/gh-action-pypi-publish@release/v1` is configured with `skip-existing: true`.
- **VSIX** — marketplace rejects duplicate versions; user must set `skip_vsix=true` if it already succeeded.
- **C native** — always rebuilds and attaches (no external registry state).
- **`finalize`** — commits manifests, creates tag, creates release only once. On retry, the commit is a no-op if files match; the tag creation will fail if it already exists (re-run means it didn't).

#### Per-PR validation vs. release

- **`test-*.yml`** (one per library area) — path-filtered PR validation gates. Run on every PR that touches a given lib's source. Cheap, parallelizable, no publish involvement.
- **`version-drift.yml`** — runs on every PR that touches any `package.json` or `pyproject.toml`. Asserts all manifests match root `/package.json` (with PEP 440 translation for Python; VSIX is allowed to drift on betas).
- **`release.yml`** — manual `workflow_dispatch` only. Produces all release artifacts in one go.

#### One-time setup before the first real release

- `VSCE_PAT` GitHub secret (Azure DevOps PAT with Marketplace > Manage scope; carried over from the legacy `elaraai/east-ui` repo if still valid)
- PyPI trusted publishing configured for all 5 packages (`east-py`, `east-py-std`, `east-py-io`, `east-py-cli`, `east-py-datascience`) on pypi.org → repo `elaraai/east-workspace`, workflow `release.yml`. First publish must be done manually to claim each package name.
- Confirm `ubuntu-24.04-arm` runner is available on the org plan (used for `linux-arm64` C binaries).

## License

This project is dual-licensed:

- **Open Source**: [AGPL-3.0](LICENSE.md) - Free for open source use with source disclosure requirements
- **Commercial**: Available for proprietary use - contact support@elara.ai

See [LICENSE.md](LICENSE.md) for full details.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

**Note**: Contributors must sign our [CLA](CLA.md) before we can accept pull requests. This allows us to offer commercial licenses while keeping the project open source.

### Ecosystem

- **[East Node](https://github.com/elaraai/east-node)**: Node.js platform functions for I/O, databases, and system operations. Connect East programs to filesystems, SQL/NoSQL databases, cloud storage, and network services.
  - [@elaraai/east-node-std](https://www.npmjs.com/package/@elaraai/east-node-std): Filesystem, console, HTTP fetch, crypto, random distributions, timestamps
  - [@elaraai/east-node-io](https://www.npmjs.com/package/@elaraai/east-node-io): SQLite, PostgreSQL, MySQL, MongoDB, S3, FTP, SFTP
  - [@elaraai/east-node-cli](https://www.npmjs.com/package/@elaraai/east-node-cli): CLI for running East IR programs in Node.js

- **[East Python](https://github.com/elaraai/east-py)**: Python runtime and platform functions for data science and machine learning. Execute East programs with access to optimization solvers, gradient boosting, neural networks, and model explainability.
  - [@elaraai/east-py-datascience](https://www.npmjs.com/package/@elaraai/east-py-datascience): TypeScript types for optimization, gradient boosting, neural networks, explainability

- **[East UI](https://github.com/elaraai/east-ui)**: East types and expressions for building dashboards and interactive layouts. Define UIs as data structures that render consistently across React, web, and other environments.
  - [@elaraai/east-ui](https://www.npmjs.com/package/@elaraai/east-ui): 50+ typed UI components for layouts, forms, charts, tables, dialogs
  - [@elaraai/east-ui-components](https://www.npmjs.com/package/@elaraai/east-ui-components): React renderer with Chakra UI styling

- **[e3 - East Execution Engine](https://github.com/elaraai/e3)**: Durable execution engine for running East pipelines at scale. Features Git-like content-addressable storage, automatic memoization, task queuing, and real-time monitoring.
  - [@elaraai/e3](https://www.npmjs.com/package/@elaraai/e3): SDK for authoring e3 packages with typed tasks and pipelines
  - [@elaraai/e3-core](https://www.npmjs.com/package/@elaraai/e3-core): Git-like object store, task queue, result caching
  - [@elaraai/e3-types](https://www.npmjs.com/package/@elaraai/e3-types): Shared type definitions for e3 packages
  - [@elaraai/e3-cli](https://www.npmjs.com/package/@elaraai/e3-cli): `e3 init`, `e3 run`, `e3 logs` commands for managing and monitoring tasks
  - [@elaraai/e3-api-client](https://www.npmjs.com/package/@elaraai/e3-api-client): HTTP client for remote e3 servers
  - [@elaraai/e3-api-server](https://www.npmjs.com/package/@elaraai/e3-api-server): REST API server for e3 repositories

## Links

- **Website**: [https://elaraai.com/](https://elaraai.com/)
- **Repository**: [https://github.com/elaraai/east](https://github.com/elaraai/east)
- **Issues**: [https://github.com/elaraai/east/issues](https://github.com/elaraai/east/issues)
- **Email**: support@elara.ai

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/)*
