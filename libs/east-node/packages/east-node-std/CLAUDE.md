# East Node

East Node provides Node.js platform integration for the East language.

## Purpose

East Node enables East programs to run in Node.js environments by providing:

- **Platform Functions**: Node.js implementations of East platform functions
- **Runtime Support**: Utilities for executing compiled East IR in Node.js
- **Testing Infrastructure**: Test runners and assertion libraries for East programs
- **I/O Operations**: File system, network, and process interaction capabilities

## Structure

East Node is a TypeScript package that depends on the East language package.

- `/src` - source code for Node.js platform integration
- `/test` - test suite
- `/examples` - example usage

## Development

When making changes to the East Node codebase always run:

- `npm run build` - compile TypeScript to JavaScript
- `npm run test` - run the test suite (runs the compiled .js - requires build first)
- `npm run lint` - check code quality with ESLint (must pass before committing)

ESLint is configured to be compiler-friendly: `any` types are allowed due to type erasure needs and TypeScript's recursive type limitations.
Avoid `any` as much as possible.

## Standards

**All development MUST follow the mandatory standards defined in [STANDARDS.md](./STANDARDS.md).**

STANDARDS.md contains comprehensive requirements for:
- TypeDoc documentation (platform functions, grouped exports, types)
- Testing with East code (using `describeEast` and `Test`)
- Code quality and compliance

**Quick reference:**
- Platform function examples: See [src/fetch.ts](./src/fetch.ts)
- Test examples: See [src/path.spec.ts](./src/path.spec.ts) or [src/time.spec.ts](./src/time.spec.ts)
- Test infrastructure: See [src/test.ts](./src/test.ts)
