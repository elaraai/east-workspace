# East Node Examples

Working code examples for common use cases.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Console I/O](#console-io)
- [File System](#file-system)
- [HTTP Client (Fetch)](#http-client-fetch)
- [Cryptography](#cryptography)
- [Time Operations](#time-operations)
- [Path Manipulation](#path-manipulation)
- [Random Number Generation](#random-number-generation)
- [Testing](#testing)

---

## Quick Start

```typescript
import { East, StringType, NullType } from "@elaraai/east";
import { NodePlatform, Console, FileSystem } from "@elaraai/east-node-std";

// Define East function using platform functions
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

// Or compile with specific modules only
const compiled2 = East.compile(processFile.toIR(), [...Console.Implementation, ...FileSystem.Implementation]);
```

---

## Console I/O

```typescript
const greet = East.function([StringType], NullType, ($, name) => {
    $(Console.log(East.str`Hello, ${name}!`));
});
```

---

## File System

```typescript
const copyFile = East.function([StringType, StringType], NullType, ($, src, dest) => {
    const content = $.let(FileSystem.readFile(src));
    $(FileSystem.writeFile(dest, content));
    $(Console.log(East.str`Copied ${src} to ${dest}`));
});
```

---

## HTTP Client (Fetch)

```typescript
const fetchData = East.asyncFunction([], StringType, $ => {
    const data = $.let(Fetch.get("https://api.example.com/users"));
    $(Console.log(East.str`Received: ${data}`));
    return data;
});
```

---

## Cryptography

```typescript
const generateToken = East.function([], StringType, $ => {
    const id = $.let(Crypto.uuid());
    const random = $.let(Crypto.randomBytes(16n));
    const hash = $.let(Crypto.hashSha256(id));
    return hash;
});
```

---

## Time Operations

```typescript
const measureTime = East.asyncFunction([], IntegerType, $ => {
    const start = $.let(Time.now());
    $(Time.sleep(1000n));
    const end = $.let(Time.now());
    return end.subtract(start);
});
```

---

## Path Manipulation

```typescript
const processPath = East.function([StringType], StringType, ($, filepath) => {
    const dir = $.let(Path.dirname(filepath));
    const name = $.let(Path.basename(filepath));
    const ext = $.let(Path.extname(filepath));
    return East.str`Dir: ${dir}, Name: ${name}, Ext: ${ext}`;
});
```

---

## Random Number Generation

```typescript
import { East, IntegerType, FloatType } from "@elaraai/east";
import { Random } from "@elaraai/east-node-std";

// Roll a six-sided die
const rollDice = East.function([], IntegerType, $ => {
    return Random.range(1n, 6n);
});

// Generate normally distributed values
const generateNormal = East.function([], FloatType, $ => {
    const z = $.let(Random.normal());
    // Scale to mean=100, stddev=15
    return z.multiply(15.0).add(100.0);
});

// Compile with Random.Implementation
const compiled1 = East.compile(rollDice.toIR(), Random.Implementation);
const compiled2 = East.compile(generateNormal.toIR(), Random.Implementation);

const diceRoll = compiled1();  // e.g., 4n
const iqScore = compiled2();   // e.g., 103.7
```

---

## Testing

```typescript
import { describeEast, Assert } from "@elaraai/east-node-std";

await describeEast("File Operations", (test) => {
    test("read and write file", $ => {
        const testData = "Hello, World!";
        $(FileSystem.writeFile("test.txt", testData));
        const result = $.let(FileSystem.readFile("test.txt"));
        $(Assert.equal(result, testData));
        $(FileSystem.deleteFile("test.txt"));
    });
});
```

### With Hooks

```typescript
await describeEast("Database Tests", (test) => {
    test("query returns data", $ => {
        // test implementation
    });
}, {
    beforeAll: $ => {
        // Setup: open connection
    },
    afterAll: $ => {
        // Cleanup: close connection
    },
    beforeEach: $ => {
        // Reset state before each test
    },
    afterEach: $ => {
        // Cleanup after each test
    }
});
```

### Assertion Examples

```typescript
await describeEast("Assertion Examples", (test) => {
    test("equality", $ => {
        $(Assert.equal(East.value(1n).add(1n), 2n));
        $(Assert.notEqual(East.value(1n), 2n));
    });

    test("comparisons", $ => {
        $(Assert.less(East.value(1n), 2n));
        $(Assert.lessEqual(East.value(2n), 2n));
        $(Assert.greater(East.value(3n), 2n));
        $(Assert.greaterEqual(East.value(2n), 2n));
        $(Assert.between(East.value(5n), 1n, 10n));
    });

    test("error handling", $ => {
        $(Assert.throws(someExprThatThrows));
        $(Assert.throws(someExprThatThrows, /expected pattern/));
    });
});
```
