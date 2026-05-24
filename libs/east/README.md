# East

**East** is a statically typed, expression-based programming language embedded in TypeScript. Designed for the [Elara](https://elaraai.com/) platform, East enables you to write portable logic once and execute it across multiple environments (JavaScript, Julia, Python, and more), leveraging each language's native performance characteristics and ecosystem.

## Motivation

Delivering a complete business solution requires a wide range of technologies and activities: data integrations, mathematical optimization, machine learning, simulation, user interfaces, authentication & authorization, hosting, managing data consistency, auditing, etc.
Multiple programming environments are required to solve any given business problem - for example you may use JavaScript for web front ends and python for training and evaluating machine learning models.

East is designed to make it easy to fuse different technologies together by focussing on a simple yet powerful structural type system which makes all the boilerplate and plumbing work disappear, letting you spend more time solving real-world problems.
East is intentionally a simple language that is fast to learn and straightforward to implement in new runtimes.

## Features

- **Static Typing**: All types, functions and values declared explicitly for speed and correctness
- **Structural Typing**: Expressive type system with recursive types, first-class functions and polymorphic variants
- **Portable IR**: Compile to JavaScript, Python and Julia
- **Controlled Side Effects**: Secure execution with cross-language platform-defined effects
- **LLM Friendly**: Designed for AI with clear, composable yet stochastic friendly aliases
- **Serializable**: All data can be serialized; functions and closures can be transmitted as IR
- **Minimal Dependencies**: Single runtime dependency (sorted-btree for efficient collections)
- **Total Ordering**: All types have defined comparisons that are consistent across all language targets


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

`@elaraai/east` is published together with every other `@elaraai/*` npm package in the east-workspace monorepo under a single unified version. Releases are triggered manually via the `NPM Publish` GitHub Actions workflow at the repo root (`.github/workflows/npm-publish.yml`). There is no per-package release command — see the root [README.md](../../README.md#release-process) for details.

## Claude Code plugin

The East ecosystem also ships a [Claude Code](https://claude.com/claude-code) plugin — East language skills, example search, and preemptive diagnostics for East code — installed separately from the `elaraai` marketplace:

```text
# Inside Claude Code
/plugin marketplace add elaraai/east-workspace
/plugin install east@elaraai
```

```bash
# From a terminal
claude plugin marketplace add elaraai/east-workspace
claude plugin install east@elaraai
```

## License

This project is dual-licensed:

- **Open Source**: [AGPL-3.0](LICENSE.md) - Free for open source use with source disclosure requirements
- **Commercial**: Available for proprietary use - contact support@elara.ai

See [LICENSE.md](LICENSE.md) for full details.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

**Note**: Contributors must sign our [CLA](CLA.md) before we can accept pull requests. This allows us to offer commercial licenses while keeping the project open source.

### Ecosystem

- **[East](https://github.com/elaraai/east-workspace/tree/main/libs/east)**: Statically typed, expression-based language with serializable IR. Run portable logic across TypeScript, Python, C, and other runtimes.
  - [@elaraai/east](https://www.npmjs.com/package/@elaraai/east): Core language SDK with type system, expressions, and reference JS compiler

- **[East Node](https://github.com/elaraai/east-workspace/tree/main/libs/east-node)**: Node.js platform functions for I/O, databases, and system operations.
  - [@elaraai/east-node-std](https://www.npmjs.com/package/@elaraai/east-node-std): Console, FileSystem, Fetch, Crypto, Time, Path, Random
  - [@elaraai/east-node-io](https://www.npmjs.com/package/@elaraai/east-node-io): SQLite, PostgreSQL, MySQL, MongoDB, Redis, S3, FTP, SFTP, XLSX, XML, compression
  - [@elaraai/east-node-cli](https://www.npmjs.com/package/@elaraai/east-node-cli): CLI for running East IR programs in Node.js

- **[East C](https://github.com/elaraai/east-workspace/tree/main/libs/east-c)**: C11 native runtime for executing East IR. Tarballed for `linux-x64` and `linux-arm64`, attached to each GitHub Release.
  - `east-c`: Core runtime — type system, IR interpreter, 200+ builtins, serialization (Beast2, JSON, CSV, East text)
  - `east-c-std`: Console, FileSystem, Fetch, Crypto, Time, Path, Random
  - `east-c-cli`: CLI for running East IR programs natively

- **[East Python](https://github.com/elaraai/east-workspace/tree/main/libs/east-py)**: Python runtime, standard platform, I/O, and data-science platform functions. Published to PyPI.
  - [east-py](https://pypi.org/project/east-py/): Core Python runtime — type system, IR compiler, 212+ builtins, Cython-accelerated hot paths
  - [east-py-std](https://pypi.org/project/east-py-std/): Console, FileSystem, Fetch, Crypto, Time, Path, Random
  - [east-py-io](https://pypi.org/project/east-py-io/): SQLite, PostgreSQL, MySQL, MongoDB, Redis, S3, FTP, SFTP, XLSX, XML, compression
  - [east-py-cli](https://pypi.org/project/east-py-cli/): CLI for running East IR programs in Python
  - [east-py-datascience](https://pypi.org/project/east-py-datascience/) (PyPI) + [@elaraai/east-py-datascience](https://www.npmjs.com/package/@elaraai/east-py-datascience) (npm): Optimization (MADS, Optuna, ALNS, GoogleOR), ML (XGBoost, LightGBM, NGBoost, PyTorch, Lightning, GP), Bayesian inference (PyMC), explainability (SHAP), conformal prediction (MAPIE)

- **[East UI](https://github.com/elaraai/east-workspace/tree/main/libs/east-ui)**: Typed UI component definitions and React renderer, plus VS Code preview.
  - [@elaraai/east-ui](https://www.npmjs.com/package/@elaraai/east-ui): 50+ typed UI components for layouts, forms, charts, tables, dialogs
  - [@elaraai/east-ui-components](https://www.npmjs.com/package/@elaraai/east-ui-components): React renderer with Chakra UI v3 styling
  - [@elaraai/e3-ui](https://www.npmjs.com/package/@elaraai/e3-ui): e3 + UI bridge — Data bindings, `e3.ui()` task, manifest
  - [@elaraai/e3-ui-components](https://www.npmjs.com/package/@elaraai/e3-ui-components): React Query hooks and preview components for the e3 API
  - [east-ui-preview](https://marketplace.visualstudio.com/items?itemName=ElaraAI.east-ui-preview): VS Code extension for live East UI component preview

- **[e3 — East Execution Engine](https://github.com/elaraai/east-workspace/tree/main/libs/e3)**: Durable execution engine for running East pipelines at scale. Git-like content-addressable storage, automatic memoization, reactive dataflow, real-time monitoring.
  - [@elaraai/e3](https://www.npmjs.com/package/@elaraai/e3): SDK for authoring e3 packages with typed tasks and pipelines
  - [@elaraai/e3-core](https://www.npmjs.com/package/@elaraai/e3-core): Object store, dataflow orchestrator, execution state
  - [@elaraai/e3-types](https://www.npmjs.com/package/@elaraai/e3-types): Shared type definitions for e3 packages
  - [@elaraai/e3-cli](https://www.npmjs.com/package/@elaraai/e3-cli): `e3 repo`, `e3 package`, `e3 workspace`, `e3 start`, `e3 watch`, `e3 logs` commands
  - [@elaraai/e3-api-client](https://www.npmjs.com/package/@elaraai/e3-api-client): HTTP client for remote e3 repositories
  - [@elaraai/e3-api-server](https://www.npmjs.com/package/@elaraai/e3-api-server): REST API server for e3 repositories
  - [@elaraai/e3-api-tests](https://www.npmjs.com/package/@elaraai/e3-api-tests): Shared API compliance test suites

## Links

- **Website**: [https://elaraai.com/](https://elaraai.com/)
- **Repository**: [https://github.com/elaraai/east-workspace/tree/main/libs/east](https://github.com/elaraai/east-workspace/tree/main/libs/east)
- **Issues**: [https://github.com/elaraai/east-workspace/issues](https://github.com/elaraai/east-workspace/issues)
- **Email**: support@elara.ai

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/).*

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/)*
