# East Node Development Standards

**This document is MANDATORY and MUST be followed for all East Node development.**

All contributors MUST follow these standards for documentation and testing. These standards ensure consistency, correctness, and maintainability across the East Node codebase.

---

## Table of Contents

- [TypeDoc Documentation Standards](#typedoc-documentation-standards)
  - [Platform Functions](#platform-functions)
  - [Grouped Export Objects](#grouped-export-objects)
  - [Functions](#functions)
  - [Types and Interfaces](#types-and-interfaces)
  - [General Rules](#general-rules)
- [Testing Standards](#testing-standards)

---

## TypeDoc Documentation Standards

All public APIs MUST include TypeDoc comments following these precise rules.

East Node focuses on **Platform Functions** that bridge East programs to Node.js capabilities (I/O, crypto, networking, etc.).

### Platform Functions

Platform functions are East functions that are implemented by the runtime (in this case, Node.js). They bridge East code to native capabilities like I/O, crypto, networking, etc.

All **exported** platform function definitions MUST include comprehensive TypeDoc comments:

**Requirements:**
- Start with a clear description of what the platform function does
- Explain the purpose and use case in the East ecosystem
- Document the behavior in the Node.js runtime context
- Document all parameters with `@param name - description` (omit types, TypeScript infers them)
- Use `@returns` to describe the return value (omit type, TypeScript infers it)
- Include `@throws {EastError}` for error conditions with specific error messages
- Add `@example` showing typical usage in East code (using the fluent API)
- Use `@remarks` for important implementation notes or platform-specific behavior

**Example:**

```typescript
/**
 * Reads the contents of a file as a UTF-8 encoded string.
 *
 * Reads the entire file at the specified path and returns its contents
 * as a UTF-8 decoded string. The path can be relative or absolute.
 *
 * This is a platform function for the East language, enabling file system
 * operations in East programs running on Node.js.
 *
 * @param path - The file path (relative or absolute)
 * @returns The file contents as a UTF-8 string
 *
 * @throws {EastError} When file does not exist (ENOENT), permission denied (EACCES), or path is a directory (EISDIR)
 *
 * @example
 * ```ts
 * import { East, StringType, NullType } from "@elaraai/east";
 * import { FileSystem } from "@elaraai/east-node-std";
 *
 * const processFile = East.function([StringType], NullType, ($, path) => {
 *     const content = $.let(FileSystem.readFile(path));
 *     $(Console.log(content));
 *     $.return(null);
 * });
 *
 * const compiled = East.compile(processFile.toIR(), FileSystem.Implementation);
 * compiled("data.txt");  // Reads and logs the contents of data.txt
 * ```
 *
 * @remarks
 * - Reads the entire file into memory - not suitable for very large files
 * - Assumes UTF-8 encoding - use readFileBytes() for binary data
 * - Follows symbolic links
 * - Blocks until the read operation completes
 */
export const fs_read_file = East.platform("fs_read_file", [StringType], StringType);
```

**Key principles for platform function documentation:**

1. **Purpose First**: Start with what the function does and why it exists
2. **East Context**: Explain how it fits into East programs (not just the Node.js implementation)
3. **Type Information**: The type signature is already in the code, focus on *behavior*
4. **Examples**: Show real East code using the fluent API (not implementation code)
5. **Error Cases**: Document all error conditions with specific messages users will see
6. **Platform Notes**: Call out Node.js-specific behavior or limitations

### Grouped Export Objects

Grouped exports (like `export const Crypto = { ... }`) provide organized namespaces for related platform functions. This is the **standard pattern** for East Node modules.

Each property in the exported object MUST have complete TypeDoc documentation.

**Requirements:**
- Group-level documentation with overview and examples
- Property-level documentation for each platform function
- Nested `Implementation` property for platform implementations
- Optional nested `Types` property for related type definitions
- Examples showing complete `East.function()` → `East.compile()` or `East.compileAsync()` → execution flow
- Use `East.compileAsync()` if ANY function uses `implementAsync`, otherwise use `East.compile()`

**Example:**

```typescript
/**
 * Grouped cryptographic platform functions.
 *
 * Provides cryptographic operations for East programs running on Node.js.
 *
 * @example
 * ```ts
 * import { East, StringType } from "@elaraai/east";
 * import { Crypto } from "@elaraai/east-node-std";
 *
 * const generateId = East.function([], StringType, $ => {
 *     return $.return(Crypto.uuid());
 * });
 *
 * // Use East.compile() for synchronous implementations
 * const compiled = East.compile(generateId.toIR(), Crypto.Implementation);
 * compiled();  // "550e8400-e29b-41d4-a716-446655440000"
 * ```
 *
 * @example
 * ```ts
 * // For async implementations (like Fetch), use East.compileAsync()
 * import { Fetch } from "@elaraai/east-node-std";
 *
 * const fetchData = East.function([StringType], StringType, ($, url) => {
 *     return $.return(Fetch.get(url));
 * });
 *
 * const compiled = await East.compileAsync(fetchData.toIR(), Fetch.Implementation);
 * await compiled("https://api.example.com/data");
 * ```
 */
export const Crypto = {
    /**
     * Generates a random UUID v4.
     *
     * Creates a version 4 UUID using cryptographically secure random numbers.
     * Returns a 36-character string in standard format.
     *
     * @returns A UUID v4 string in standard format (8-4-4-4-12 hex digits)
     *
     * @example
     * ```ts
     * const createRecord = East.function([], StringType, $ => {
     *     return $.return(Crypto.uuid());
     * });
     *
     * const compiled = East.compile(createRecord.toIR(), Crypto.Implementation);
     * compiled();  // "550e8400-e29b-41d4-a716-446655440000"
     * ```
     */
    uuid: crypto_uuid,

    /**
     * Computes SHA-256 hash of a string.
     *
     * Calculates the SHA-256 cryptographic hash of a UTF-8 encoded string and returns
     * the result as a lowercase hexadecimal string (64 characters).
     *
     * @param data - The string to hash (will be UTF-8 encoded)
     * @returns The SHA-256 hash as a lowercase hexadecimal string (64 characters)
     *
     * @example
     * ```ts
     * const hashPassword = East.function([StringType], StringType, ($, password) => {
     *     return $.return(Crypto.hashSha256(password));
     * });
     *
     * const compiled = East.compile(hashPassword.toIR(), Crypto.Implementation);
     * compiled("secret");  // "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b"
     * ```
     */
    hashSha256: crypto_hash_sha256,

    /**
     * Node.js implementation of cryptographic platform functions.
     *
     * Pass this to {@link East.compile} to enable crypto operations.
     */
    Implementation: CryptoImpl,
} as const;

// Also export the implementation separately for backwards compatibility
export { CryptoImpl };
```

**Rules for export object properties:**

1. **Full description** - Start with a summary sentence, then add detailed explanation
2. **Parameter documentation** - Document all parameters with `@param`, include constraints
3. **Return documentation** - Use `@returns` to describe what's returned
4. **Throws documentation** - Use `@throws {EastError}` if applicable
5. **Complete example** - Show `East.function()` → `East.compile()` or `East.compileAsync()` with platform implementation → execution
6. **Include platform impl** - Show compilation using `ModuleName.Implementation` (e.g., `Crypto.Implementation`)
7. **Nest implementation** - Include `Implementation` property in the export object for single-import convenience
8. **Async vs Sync** - Use `East.compileAsync()` if ANY function in the Implementation uses `implementAsync`, otherwise use `East.compile()`
9. **Optional Types** - Include `Types` property for related type definitions (see `Fetch.Types` in fetch.ts:332)

### Functions

**Requirements:**
- Start with a verb describing what the function does
- Document type parameters with `@typeParam Name - description` for generics
- Document all parameters with `@param name - description` (omit types, TypeScript infers them)
- Document return value with `@returns description` (omit type, TypeScript infers it)
- Use `@throws {ErrorType}` for documented error conditions
- Include `@example` for complex functions showing typical usage

**Example:**

```typescript
/**
 * Executes an East function in the Node.js runtime.
 *
 * @param fn - The compiled East function to execute
 * @param args - Arguments to pass to the function
 * @returns The result of executing the function
 *
 * @example
 * ```ts
 * const result = execute(compiledFn, [arg1, arg2]);
 * ```
 */
export function execute(fn: Function, args: any[]): any {
  return fn(...args);
}

/**
 * Maps each element of an array using a transform function.
 *
 * @typeParam T - The type of elements in the input array
 * @typeParam U - The type of elements in the output array
 * @param array - The array to map over
 * @param fn - The transform function to apply to each element
 * @returns A new array with transformed elements
 */
export function map<T, U>(array: T[], fn: (item: T) => U): U[] { ... }
```

### Types and Interfaces

**Requirements:**
- Provide a concise summary of what the type represents
- Document type parameters with `@typeParam Name - description` for generics
- Document each field/property with inline comments
- Use `@remarks` for important usage notes or constraints

**Example:**

```typescript
/**
 * HTTP response structure.
 *
 * Complete HTTP response including status code, headers, body, and success indicator.
 * The `ok` field is true for status codes in the 200-299 range.
 *
 * @remarks
 * Used by {@link Fetch.request} to return full response information.
 */
export const FetchResponse = StructType({
    /** HTTP status code (e.g., 200, 404, 500) */
    status: IntegerType,
    /** HTTP status text (e.g., "OK", "Not Found") */
    statusText: StringType,
    /** Response headers as a dictionary */
    headers: DictType(StringType, StringType),
    /** Response body as a string */
    body: StringType,
    /** True if status is 200-299, false otherwise */
    ok: BooleanType,
});

/**
 * Configuration for platform function implementations.
 *
 * @remarks
 * Platform functions must be provided for the compiled code to execute.
 */
export interface RuntimeOptions {
  /** Whether to freeze input data to prevent mutation */
  freezeInputs: boolean;
  /** Maximum recursion depth for function calls */
  maxDepth: number;
}
```

### General Rules

**MUST follow:**
- Write in present tense ("Parses CSV data" not "Will parse CSV data")
- Be concise but complete - avoid redundant information
- Use proper markdown formatting for code references: `Type`, `null`, etc.
- Use `{@link SymbolName}` to create links to other documented types, functions, or classes
- Include `@internal` for implementation details not part of public API
- Group related overloads with a single comment on the first signature

**Linking Example:**

```typescript
/**
 * Performs an HTTP GET request and returns the response body.
 *
 * @param url - The URL to fetch
 * @returns The response body as a string
 *
 * @remarks
 * This is a convenience function for basic GET requests without custom headers.
 * For more control, use {@link Fetch.request} instead.
 */
export const fetch_get = ...;

/**
 * Reads a file from the file system.
 *
 * @param path - The file path to read
 * @returns The file contents as a string
 *
 * @remarks
 * See {@link FileSystem.readFileBytes} for reading binary data.
 * See {@link Path.join} for constructing file paths.
 */
export const fs_read_file = ...;
```

---

## Testing Standards

All East Node functionality MUST be thoroughly tested using East code.

### Test File Structure

**Requirements:**
- One test file per module/feature: `src/modulename.spec.ts` (co-located with source)
- Import `describeEast` and `Test` from `./test.js`
- Test bodies MUST be written in East code using the `$` block builder
- Use `Test.equal()`, `Test.greater()`, etc. for assertions
- Pass platform function implementations via `{ platformFns: ModuleImpl }`

**Example:**

```typescript
import { East } from "@elaraai/east";
import { describeEast, Test } from "./test.js";
import { Time, TimeImpl } from "./time.js";

await describeEast("Time platform functions", (test) => {
    test("now returns a timestamp", $ => {
        const timestamp = $.let(Time.now());

        // Should be a reasonable timestamp (after 2020)
        $(Assert.greater(timestamp, 1577836800000n)); // Jan 1, 2020
    });

    test("sleep pauses execution", $ => {
        const start = $.let(Time.now());
        $(Time.sleep(100n)); // Sleep for 100ms
        const end = $.let(Time.now());

        const elapsed = $.let(end.subtract(start));

        // Should have slept at least 90ms (allowing for some timing variance)
        $(Assert.greaterEqual(elapsed, 90n));
    });
}, { platformFns: TimeImpl });
```

### Test Coverage Requirements

**MUST test:**
- **Basic operations**: Core functionality with typical inputs
- **Edge cases**: Boundary conditions, empty inputs, zero values
- **Error conditions**: Operations that should throw (use `Test.throws()`)
- **Platform-specific behavior**: Node.js-specific constraints or features

**Example coverage:**

```typescript
test("basic operation", $ => {
    const result = $.let(Path.join(["foo", "bar"]));
    $(Assert.equal(result.contains("/"), true));
});

test("edge case - empty array", $ => {
    const result = $.let(Path.join([]));
    $(Assert.equal(result, "."));
});

test("error condition", $ => {
    // Test that division by zero throws
    $(Assert.throws(East.value(1n).divide(0n)));
});
```

### Test Naming and Organization

**Test names MUST:**
- Be concise and descriptive
- Use lowercase with spaces: `"join combines path segments"`, `"dirname returns directory portion"`
- Describe what the test validates, not implementation details

**Test organization:**
- Group related functionality in a single test suite
- Start with basic operations, then move to edge cases
- Put error condition tests last

### Assertion Patterns

**Available assertions:**
```typescript
$(Assert.equal(actual, expected))              // Deep equality
$(Assert.notEqual(actual, expected))           // Deep inequality
$(Assert.is(actual, expected))                 // Reference equality
$(Assert.less(actual, expected))               // Less than
$(Assert.lessEqual(actual, expected))          // Less than or equal
$(Assert.greater(actual, expected))            // Greater than
$(Assert.greaterEqual(actual, expected))       // Greater than or equal
$(Assert.between(actual, min, max))            // Range check (inclusive)
$(Assert.throws(expression))                   // Expects error
$(Assert.throws(expression, /pattern/))        // Expects error matching pattern
```

**Best practices:**
- Use `$.let()` for values that are reused or need to be bound
- Assertions are East expressions - they must be called with `$(...)` to execute
- Always show expected behavior in comments when not obvious
- Test both successful operations and error conditions

---

## Compliance

**These standards are MANDATORY.**

- All pull requests MUST comply with these standards
- Code review MUST verify compliance
- No exceptions without explicit approval from the project maintainer

**Before committing:**
1. ✅ All public APIs have TypeDoc comments following these standards
2. ✅ All TypeDoc examples in **expression classes** (`/src/expr/` and `/src/expr/libs/`) compile successfully (validated with `mcp__east-mcp__east_compile`)
3. ✅ USAGE.md documentation follows the formatting and organization standards
4. ✅ All new functionality has comprehensive test coverage
5. ✅ All tests pass: `npm run test`
6. ✅ Linting passes: `npm run lint`

**When in doubt, refer to:**
- `/src/expr/blob.ts` for TypeDoc examples
- `/USAGE.md` sections for Array, Dict, Set for USAGE.md examples
- `/test/blob.spec.ts` and `/test/array.spec.ts` for testing examples
