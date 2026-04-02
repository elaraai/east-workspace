# East Node API Reference

Complete function signatures, types, and arguments for all platform modules.

---

## Table of Contents

- [Console I/O](#console-io)
- [File System](#file-system)
- [HTTP Client (Fetch)](#http-client-fetch)
- [Cryptography](#cryptography)
- [Time Operations](#time-operations)
- [Path Manipulation](#path-manipulation)
- [Random Number Generation](#random-number-generation)
- [Testing](#testing)

---

## Console I/O

**Import:**
```typescript
import { Console } from "@elaraai/east-node-std";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `log(message: StringExpr \| string): NullExpr` | Write to stdout with newline | `Console.log("Hello")` |
| `error(message: StringExpr \| string): NullExpr` | Write to stderr with newline | `Console.error("Error!")` |
| `write(message: StringExpr \| string): NullExpr` | Write to stdout without newline | `Console.write("Loading...")` |

---

## File System

**Import:**
```typescript
import { FileSystem } from "@elaraai/east-node-std";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `readFile(path: StringExpr \| string): StringExpr` | Read file as UTF-8 string | `FileSystem.readFile("data.txt")` |
| `writeFile(path: StringExpr \| string, content: StringExpr \| string): NullExpr` | Write string to file (overwrites) | `FileSystem.writeFile("out.txt", data)` |
| `appendFile(path: StringExpr \| string, content: StringExpr \| string): NullExpr` | Append string to file | `FileSystem.appendFile("log.txt", entry)` |
| `deleteFile(path: StringExpr \| string): NullExpr` | Delete a file | `FileSystem.deleteFile("temp.txt")` |
| `exists(path: StringExpr \| string): BooleanExpr` | Check if path exists | `FileSystem.exists("config.json")` |
| `isFile(path: StringExpr \| string): BooleanExpr` | Check if path is a file | `FileSystem.isFile("data.txt")` |
| `isDirectory(path: StringExpr \| string): BooleanExpr` | Check if path is a directory | `FileSystem.isDirectory("src")` |
| `createDirectory(path: StringExpr \| string): NullExpr` | Create directory (recursive) | `FileSystem.createDirectory("out/reports")` |
| `readDirectory(path: StringExpr \| string): ArrayExpr<StringType>` | List directory contents | `FileSystem.readDirectory("src")` |
| `readFileBytes(path: StringExpr \| string): BlobExpr` | Read file as binary data | `FileSystem.readFileBytes("image.png")` |
| `writeFileBytes(path: StringExpr \| string, content: BlobExpr \| Uint8Array): NullExpr` | Write binary data to file | `FileSystem.writeFileBytes("out.bin", data)` |

---

## HTTP Client (Fetch)

**Import:**
```typescript
import { Fetch, FetchRequestConfig, FetchMethod } from "@elaraai/east-node-std";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `get(url: StringExpr \| string): StringExpr` | HTTP GET request, returns body as text | `Fetch.get("https://api.example.com/data")` |
| `getBytes(url: StringExpr \| string): BlobExpr` | HTTP GET request, returns body as binary | `Fetch.getBytes("https://example.com/file.bin")` |
| `post(url: StringExpr \| string, body: StringExpr \| string): StringExpr` | HTTP POST request, returns body | `Fetch.post(url, jsonData)` |
| `request(config: Expr<FetchRequestConfig>): Expr<FetchResponse>` | Custom HTTP request | `Fetch.request(config)` |

**Types:**

Access types via `Fetch.Types`:
```typescript
Fetch.Types.Method           // VariantType({ GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS })
Fetch.Types.RequestConfig    // StructType({ url, method, headers, body })
Fetch.Types.Response         // StructType({ status, statusText, headers, body, ok })
```

Legacy exports (also available):
```typescript
FetchMethod, FetchRequestConfig, FetchResponse
```

---

## Cryptography

**Import:**
```typescript
import { Crypto } from "@elaraai/east-node-std";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `randomBytes(length: IntegerExpr \| bigint): BlobExpr` | Generate secure random bytes | `Crypto.randomBytes(32n)` |
| `hashSha256(data: StringExpr \| string): StringExpr` | SHA-256 hash (hex string) | `Crypto.hashSha256(password)` |
| `hashSha256Bytes(data: BlobExpr \| Uint8Array): BlobExpr` | SHA-256 hash (binary) | `Crypto.hashSha256Bytes(data)` |
| `uuid(): StringExpr` | Generate UUID v4 | `Crypto.uuid()` |

---

## Time Operations

**Import:**
```typescript
import { Time } from "@elaraai/east-node-std";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `now(): IntegerExpr` | Get current timestamp (ms since epoch) | `Time.now()` |
| `sleep(ms: IntegerExpr \| bigint): NullExpr` | Sleep for milliseconds (async) | `Time.sleep(1000n)` |

---

## Path Manipulation

**Import:**
```typescript
import { Path } from "@elaraai/east-node-std";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `join(segments: ArrayExpr<StringType> \| string[]): StringExpr` | Join path segments | `Path.join(["dir", "file.txt"])` |
| `resolve(path: StringExpr \| string): StringExpr` | Resolve to absolute path | `Path.resolve("../data")` |
| `dirname(path: StringExpr \| string): StringExpr` | Get directory name | `Path.dirname("/home/user/file.txt")` |
| `basename(path: StringExpr \| string): StringExpr` | Get file name | `Path.basename("/home/user/file.txt")` |
| `extname(path: StringExpr \| string): StringExpr` | Get file extension | `Path.extname("file.txt")` |

---

## Random Number Generation

**Import:**
```typescript
import { Random } from "@elaraai/east-node-std";
```

**Functions:**
| Signature | Description | Example |
|-----------|-------------|---------|
| `uniform(): FloatExpr` | Uniform random float in [0.0, 1.0) | `Random.uniform()` |
| `normal(): FloatExpr` | Standard normal distribution N(0,1) | `Random.normal()` |
| `range(min: IntegerExpr \| bigint, max: IntegerExpr \| bigint): IntegerExpr` | Random integer in [min, max] (inclusive) | `Random.range(1n, 6n)` |
| `exponential(lambda: FloatExpr \| number): FloatExpr` | Exponential distribution with rate λ | `Random.exponential(0.5)` |
| `weibull(shape: FloatExpr \| number): FloatExpr` | Weibull distribution with shape parameter | `Random.weibull(2.0)` |
| `bernoulli(p: FloatExpr \| number): IntegerExpr` | Binary outcome: 0 or 1 with probability p | `Random.bernoulli(0.5)` |
| `binomial(n: IntegerExpr \| bigint, p: FloatExpr \| number): IntegerExpr` | Number of successes in n trials | `Random.binomial(10n, 0.5)` |
| `geometric(p: FloatExpr \| number): IntegerExpr` | Trials until first success | `Random.geometric(0.2)` |
| `poisson(lambda: FloatExpr \| number): IntegerExpr` | Events in fixed interval (rate λ) | `Random.poisson(3.0)` |
| `pareto(alpha: FloatExpr \| number): FloatExpr` | Pareto distribution (power law) | `Random.pareto(1.16)` |
| `logNormal(mu: FloatExpr \| number, sigma: FloatExpr \| number): FloatExpr` | Log-normal distribution | `Random.logNormal(0.0, 1.0)` |
| `irwinHall(n: IntegerExpr \| bigint): FloatExpr` | Sum of n uniform variables | `Random.irwinHall(12n)` |
| `bates(n: IntegerExpr \| bigint): FloatExpr` | Average of n uniform variables | `Random.bates(12n)` |
| `seed(value: IntegerExpr \| bigint): NullExpr` | Seed RNG for reproducibility | `Random.seed(12345n)` |

---

## Testing

**Import:**
```typescript
import { describeEast, Assert } from "@elaraai/east-node-std";
```

**Test Framework:**
```typescript
await describeEast("Test Suite Name", (test) => {
    test("test case description", $ => {
        const result = $.let(someExpression);
        $(Assert.equal(result, expectedValue));
    });
});
```

**describeEast Options:**
```typescript
await describeEast("Suite Name", (test) => {
    // tests here
}, {
    platformFns?: PlatformFunction[];  // Platform functions to include
    beforeAll?: ($: BlockBuilder<NullType>) => void;   // Run once before all tests
    afterAll?: ($: BlockBuilder<NullType>) => void;    // Run once after all tests
    beforeEach?: ($: BlockBuilder<NullType>) => void;  // Run before each test
    afterEach?: ($: BlockBuilder<NullType>) => void;   // Run after each test
    exportOnly?: boolean;  // If true, only export IR without running tests
});
```

**Assertions:**
| Signature | Description |
|-----------|-------------|
| `is<E extends Expr>(actual: E, expected: SubtypeExprOrValue<E>)` | Assert same reference (identity) |
| `equal<E extends Expr>(actual: E, expected: SubtypeExprOrValue<E>)` | Assert equality |
| `notEqual<E extends Expr>(actual: E, expected: SubtypeExprOrValue<E>)` | Assert inequality |
| `less<E extends Expr>(actual: E, expected: SubtypeExprOrValue<E>)` | Assert actual < expected |
| `lessEqual<E extends Expr>(actual: E, expected: SubtypeExprOrValue<E>)` | Assert actual <= expected |
| `greater<E extends Expr>(actual: E, expected: SubtypeExprOrValue<E>)` | Assert actual > expected |
| `greaterEqual<E extends Expr>(actual: E, expected: SubtypeExprOrValue<E>)` | Assert actual >= expected |
| `between<E extends Expr>(actual: E, min: SubtypeExprOrValue<E>, max: SubtypeExprOrValue<E>)` | Assert min <= actual <= max |
| `throws(fn: Expr<any>, pattern?: RegExp)` | Assert expression throws error (optionally matching pattern) |
| `fail(message: SubtypeExprOrValue<StringType>)` | Unconditionally fail test with message |

---

## Accessing Types

All module types are accessible via a nested `Types` property:

```typescript
import { Fetch } from "@elaraai/east-node-std";

// Access Fetch types
const method = Fetch.Types.Method;
const config = Fetch.Types.RequestConfig;
const response = Fetch.Types.Response;
```

**Pattern:**
- `Module.Types.TypeName` - Access types through the module namespace
- Legacy flat exports (e.g., `FetchMethod`) are still available for backwards compatibility

---

## Error Handling

All platform functions throw `EastError` on failure:

```typescript
import { EastError } from "@elaraai/east/internal";

try {
    const compiled = myFunction.toIR().compile(NodePlatform);
    await compiled();
} catch (err) {
    if (err instanceof EastError) {
        console.error(`East error at ${err.location.filename}:${err.location.line}`);
        console.error(err.message);
    }
}
```

**Common error patterns:**
- File operations: `ENOENT`, `EACCES`, `EISDIR`
- HTTP requests: Network errors, non-2xx status codes
- Invalid input: Type mismatches, malformed data
