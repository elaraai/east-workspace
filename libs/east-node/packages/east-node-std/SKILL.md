---
name: east-node-std
description: "Node.js platform functions for the East language. Use when writing East programs that need Console I/O, Environment variables, FileSystem operations, HTTP Fetch requests, Cryptography, Time operations, Path manipulation, Random number generation, or Testing. Triggers for: (1) Writing East programs with @elaraai/east-node-std, (2) Using platform functions like Console.log, Env.get, FileSystem.readFile, Fetch.get, Crypto.uuid, Time.now, Path.join, Random.normal, (3) Testing East code with describeEast and Assert, (4) Passing credentials/secrets to East tasks without putting them in source, (5) Opening a beast2 collection file too big for memory lazily with FileSystem.openBeast (paged reads inside an East function, on every runtime)."
---

# East Node Standard Library

Node.js platform functions for the East language. Enables East programs to interact with the filesystem, network, console, and other I/O operations.

## Before writing code — search the example index

Every East API has a tested example in the plugin's index — the index IS the
API reference, printed from each example's IR in TypeScript or python. Before
writing or changing East code:

1. Call `mcp__plugin_east_east__search_east_examples` for each capability you
   are about to use — `language: "python"` for east-py, `"typescript"`
   otherwise. Summaries come back first: id, signature, the inputs and the
   expected result, a few hundred bytes each.
2. Fetch the one or two that match with `mcp__plugin_east_east__get_east_example`
   and pattern your code on them.
3. Do not read `node_modules/@elaraai/**` or `*.examples.ts` files wholesale,
   and do not reason from `.d.ts` signatures: the index holds the same
   programs, exact and far cheaper, and the signatures omit the runtime rules
   that make East code correct.

Nothing is injected for you; the search is the step.

## Quick Start

```typescript
import { East, StringType, NullType } from "@elaraai/east";
import { NodePlatform, Console, FileSystem } from "@elaraai/east-node-std";

const processFile = East.function(
    [StringType],
    NullType,
    ($, path) => {
        const content = $.let(FileSystem.readFile(path));
        $(Console.log(content));
    }
);

// Compile with NodePlatform (includes all platform functions)
const compiled = East.compile(processFile.toIR(), NodePlatform);
await compiled("input.txt");
```

## Decision Tree: Which Module to Use

```
Task → What do you need?
    │
    ├─ Console (stdout/stderr output)
    │   └─ .log(), .error(), .write()
    │
    ├─ Env (environment variables — credentials/config supplied at runtime)
    │   └─ .get() → Option<String> (some when set, none when not; never
    │       write a credential literal — IR is content-addressed and replicated)
    │
    ├─ FileSystem (read/write files and directories)
    │   ├─ Text → .readFile(), .writeFile(), .appendFile()
    │   ├─ Binary → .readFileBytes(), .writeFileBytes()
    │   ├─ Huge beast2 collection file → .openBeast(T, path) — T is an ArrayType/SetType/DictType, passed FIRST; a frozen,
    │   │   lazily paged value: size / get / has / $.for decode one segment (mapped on east-c and east-py, positioned reads on Node)
    │   ├─ Query → .exists(), .isFile(), .isDirectory()
    │   ├─ Directory → .createDirectory(), .readDirectory()
    │   └─ Delete → .deleteFile()
    │
    ├─ Fetch (HTTP requests)
    │   └─ .get(), .getBytes(), .post(), .request()
    │
    ├─ Crypto (hashing, UUIDs, random bytes)
    │   └─ .uuid(), .randomBytes(), .hashSha256(), .hashSha256Bytes()
    │
    ├─ Time (timestamps and delays)
    │   └─ .now(), .sleep()
    │
    ├─ Path (path manipulation)
    │   └─ .join(), .resolve(), .dirname(), .basename(), .extname()
    │
    ├─ Random (statistical distributions)
    │   ├─ Basic → .uniform(), .normal(), .range()
    │   ├─ Continuous → .exponential(), .weibull(), .pareto(), .logNormal()
    │   ├─ Discrete → .bernoulli(), .binomial(), .geometric(), .poisson()
    │   ├─ Composite → .irwinHall(), .bates()
    │   └─ Control → .seed()
    │
    └─ Assert (testing with describeEast)
        └─ .is(), .equal(), .notEqual(), .less(), .lessEqual(), .greater(), .greaterEqual(), .between(), .throws(), .fail()
```

## Compiling East Programs

**Option 1: Use NodePlatform (all modules)**
```typescript
const compiled = East.compile(myFunction.toIR(), NodePlatform);
```

**Option 2: Use specific module implementations**
```typescript
const compiled = East.compile(myFunction.toIR(), [...Console.Implementation, ...FileSystem.Implementation]);
```

## Available Modules

| Module | Import | Purpose |
|--------|--------|---------|
| Console | `import { Console } from "@elaraai/east-node-std"` | stdout/stderr output |
| Env | `import { Env } from "@elaraai/east-node-std"` | Environment variables (runtime credentials/config; name in IR, value from the environment) |
| FileSystem | `import { FileSystem } from "@elaraai/east-node-std"` | Read/write files and directories |
| Fetch | `import { Fetch } from "@elaraai/east-node-std"` | HTTP requests |
| Crypto | `import { Crypto } from "@elaraai/east-node-std"` | Hashing, UUIDs, random bytes |
| Time | `import { Time } from "@elaraai/east-node-std"` | Timestamps and sleep |
| Path | `import { Path } from "@elaraai/east-node-std"` | Path manipulation |
| Random | `import { Random } from "@elaraai/east-node-std"` | Statistical distributions |
| Assert | `import { Assert, describeEast } from "@elaraai/east-node-std"` | Testing utilities |

## Accessing Types

```typescript
import { Fetch } from "@elaraai/east-node-std";

// Access types via Module.Types.TypeName
const method = Fetch.Types.Method;
const config = Fetch.Types.RequestConfig;
const response = Fetch.Types.Response;
```

## Key Patterns

### Open a huge beast2 collection file lazily

`FileSystem.openBeast(T, path)` is the file-backed twin of `blob.openBeast(T)`
(the **east** skill): the type comes first, the value is frozen, and only the
segments a program touches are ever decoded. It is a generic platform call
(`fs_open_beast<T>`) provided by the std family on every runtime, so an East
function using it runs unchanged on the east-node, east-c and east-py
runners — a python-authored function that calls it links into an east-c task.

```typescript
import { East, DictType, IntegerType, StringType, StructType } from "@elaraai/east";
import { FileSystem } from "@elaraai/east-node-std";

const TableType = DictType(IntegerType, StructType({ id: IntegerType, name: StringType }));

const total = East.function([StringType], IntegerType, ($, path) => {
    const table = $.let(FileSystem.openBeast(TableType, path));   // reads the index, not the file
    const sum = $.let(table.get(7n).id);                          // one segment decoded
    $.for(table, ($, row) => {                                    // one segment at a time
        $.assign(sum, sum.add(row.id));
    });
    return sum;
});
```

- The file's header must carry exactly `T` — a mismatch is
  `Failed to open beast file <path>: beast2: cannot open a blob of type <wire> as <T>`,
  the same text on every runtime; a missing file is `Failed to open beast file <path>: ...`.
- The value is frozen: `insert` / `update` raise `cannot mutate a frozen value`;
  `.copy()` gives a mutable copy (decoding the whole file).
- A file without a paging index — what `East.Blob.encodeBeast` writes — or an
  element shape holding `Ref` or function values decodes whole, frozen, with
  the same value. Paged files come from `encodeBeast2PagedFor`, `Beast2Writer`
  and every runner's collection output.
- The value keeps its file open for as long as it lives (a descriptor on
  Node, a read-only mapping on east-c and east-py): don't hold thousands of
  opened files at once, and don't truncate or rewrite a file while a value
  over it is alive — read it into a fresh value first.
- For bytes already in hand (a `BlobType` dataset, a `Fetch.getBytes` result)
  use `blob.openBeast(T)` instead; for an e3 task input, do nothing — large
  inputs already open lazily.

## Related skills

- **east** — the language these platform functions plug into; compile with `NodePlatform`.
- **east-node-io** — the heavier I/O layer (SQL / NoSQL, S3, FTP / SFTP, XLSX / XML, compression) when `FileSystem` / `Fetch` aren't enough.
- **e3** — run these effects as durable, cached tasks instead of one-off scripts.
- **east-project** — to author your OWN custom platform function (not just use these stock ones): `East.platform(...).implement(...)` default-exported from your package's `./platform`, called from an e3 task via `{ runtime: 'east-node', platforms: [{ custom: '@elaraai/<project>' }] }`.
- **e3-create** — scaffold that custom platform: `--platform` for one project-owned module, or `--node-packages=<name>` for a dedicated npm workspace member with its own auto-derived e3 environment.
