# Contributing to @elaraai/e3-cloud-types

This package is part of the e3-aws repository and follows the same contribution guidelines.

## Development

```bash
# Install dependencies (from repo root)
npm install

# Build the package
npm run build -w @elaraai/e3-cloud-types

# Run linting
npm run lint -w @elaraai/e3-cloud-types
```

## Guidelines

1. All source files must include the BSL 1.1 license header
2. Types should be plain TypeScript (no East types)
3. No runtime dependencies - this is a pure types package
4. Export all public types from `src/index.ts`

## License

By contributing to this project, you agree that your contributions will be licensed under the Business Source License 1.1.
