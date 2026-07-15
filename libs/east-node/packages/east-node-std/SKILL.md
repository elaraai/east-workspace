---
name: east-node-std
description: "Node.js platform functions for the East language. Use when writing East programs that need Console I/O, Environment variables, FileSystem operations, HTTP Fetch requests, Cryptography, Time operations, Path manipulation, Random number generation, or Testing. Triggers for: (1) Writing East programs with @elaraai/east-node-std, (2) Using platform functions like Console.log, Env.get, FileSystem.readFile, Fetch.get, Crypto.uuid, Time.now, Path.join, Random.normal, (3) Testing East code with describeEast and Assert, (4) Passing credentials/secrets to East tasks without putting them in source."
---

# East Node Standard Library

Node.js platform functions for the East language. Enables East programs to interact with the filesystem, network, console, and other I/O operations.

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
| Random | `import { Random } from "@elaraai/east-node-std"` | 14 statistical distributions |
| Assert | `import { Assert, describeEast } from "@elaraai/east-node-std"` | Testing utilities |

## Accessing Types

```typescript
import { Fetch } from "@elaraai/east-node-std";

// Access types via Module.Types.TypeName
const method = Fetch.Types.Method;
const config = Fetch.Types.RequestConfig;
const response = Fetch.Types.Response;
```

## Related skills

- **east** — the language these platform functions plug into; compile with `NodePlatform`.
- **east-node-io** — the heavier I/O layer (SQL / NoSQL, S3, FTP / SFTP, XLSX / XML, compression) when `FileSystem` / `Fetch` aren't enough.
- **e3** — run these effects as durable, cached tasks instead of one-off scripts.
- **east-project** — to author your OWN custom platform function (not just use these stock ones): `East.platform(...).implement(...)` default-exported from your package's `./platform`, called from an e3 task via `{ runtime: 'east-node', platforms: [{ custom: '@elaraai/<project>' }] }`.
- **e3-create** — scaffold that custom platform: `--platform` for one project-owned module, or `--node-packages=<name>` for a dedicated npm workspace member with its own auto-derived e3 environment.
