# East Node IO

East Node IO provides I/O platform functions for the East language on Node.js.

## Purpose

East Node IO enables East programs to interact with external data sources by providing:

- **Database Platform Functions**: SQL (SQLite, PostgreSQL, MySQL) and NoSQL (Redis, MongoDB) operations
- **Storage Platform Functions**: S3 and S3-compatible object storage operations
- **Transfer Platform Functions**: FTP and SFTP file transfer operations
- **Connection Management**: Handle connection pooling and lifecycle for I/O resources
- **Type-Safe I/O**: Maintain East's type safety guarantees across I/O boundaries

## Structure

East Node IO is a TypeScript package that depends on the East language package and various I/O libraries.

- `/src` - source code for I/O platform functions
  - `/src/sql` - SQL database implementations (SQLite, PostgreSQL, MySQL)
  - `/src/storage` - Cloud storage implementations (S3)
  - `/src/transfer` - File transfer implementations (FTP, SFTP)
  - `/src/nosql` - NoSQL database implementations (Redis, MongoDB)
  - `/src/connection` - Connection management utilities
- `/test` - test suite
- `/examples` - example usage

## Development

When making changes to the East Node IO codebase always run:

- `npm run build` - compile TypeScript to JavaScript
- `npm run test` - run the test suite (runs the compiled .js - requires build first)
- `npm run test:integration` - run integration tests with Docker containers
- `npm run lint` - check code quality with ESLint (must pass before committing)

ESLint is configured to be compiler-friendly: `any` types are allowed due to type erasure needs and TypeScript's recursive type limitations.
Avoid `any` as much as possible.

### Integration Testing

Integration tests require Docker for running real databases and services:

- `npm run dev:services` - start all Docker services (PostgreSQL, MySQL, MongoDB, Redis, MinIO, FTP, SFTP)
- `npm run test:integration` - run full integration test suite with Docker
- `npm run dev:services:down` - stop all Docker services

## Type Checking with East Types

**CRITICAL**: When working with East types in TypeScript, you **MUST** use `isValueOf()` to check if a value matches an East type. **NEVER** use `typeof` or `instanceof`.

### Why `isValueOf()` is Required

East types have runtime representations that differ from standard JavaScript/TypeScript types:
- East `IntegerType` values are `bigint`, not `number`
- East variant types have a specific structure that `typeof` cannot detect
- East struct and option types require structural validation
- Database drivers return raw JavaScript primitives (numbers, strings, etc.) that need to be validated before converting to East types

### Correct Usage

```typescript
import { isValueOf, IntegerType, StringType, BooleanType } from "@elaraai/east";

// ✅ CORRECT: Use isValueOf to check East types
function convertNativeToParam(value: any): ValueTypeOf<typeof SqlParameterType> {
    if (isValueOf(value, NullType)) {
        return variant('Null', null);
    } else if (isValueOf(value, IntegerType)) {
        return variant('Integer', value);  // value is bigint
    } else if (isValueOf(value, StringType)) {
        return variant('String', value);
    } else if (isValueOf(value, BooleanType)) {
        return variant('Boolean', value);
    } else {
        return variant('Null', null);
    }
}
```

### Incorrect Usage

```typescript
// ❌ WRONG: Never use typeof or instanceof for East types
function convertNativeToParam(value: any): ValueTypeOf<typeof SqlParameterType> {
    if (typeof value === 'bigint') {  // ❌ This checks JavaScript type, not East type
        return variant('Integer', value);
    } else if (typeof value === 'string') {  // ❌ Won't work for East StringType validation
        return variant('String', value);
    } else if (value instanceof Date) {  // ❌ Won't validate East DateTimeType structure
        return variant('DateTime', value);
    }
}
```

### Common Patterns

When converting database values to East types, you typically need:
1. **Column metadata** (from database driver) to know the intended type
2. **`isValueOf()` checks** to validate the JavaScript value matches the East type
3. **Type conversion** if needed (e.g., `Number` → `BigInt` for integers)

```typescript
function convertNativeToParam(value: any, columnType: string | null): ValueTypeOf<typeof SqlParameterType> {
    // Use column metadata + isValueOf checks together
    if (isValueOf(value, NullType)) {
        return variant('Null', null);
    } else if (
        (columnType === 'INTEGER') &&
        (isValueOf(value, IntegerType) || isValueOf(value, FloatType))  // Handle both bigint and number
    ) {
        return variant('Integer', BigInt(value));  // Convert if needed
    } else if (
        (columnType === 'TEXT') &&
        isValueOf(value, StringType)
    ) {
        return variant('String', value);
    }
    // ... more cases
}
```

### Key Rules

1. **Always use `isValueOf(value, Type)`** to check if a value matches an East type
2. **Never use `typeof value === 'type'`** - it checks JavaScript types, not East types
3. **Never use `value instanceof Class`** - it doesn't validate East type structure
4. **Combine column metadata with `isValueOf()`** when converting external data to East types
5. **Use type conversion when necessary** (e.g., `BigInt(value)` for integers from databases)

## Standards

**All development MUST follow the mandatory standards defined in [STANDARDS.md](./STANDARDS.md).**

STANDARDS.md contains comprehensive requirements for:
- TypeDoc documentation (platform functions, grouped exports, types)
- Testing with East code (using `describeEast` and `Test`)
- Code quality and compliance