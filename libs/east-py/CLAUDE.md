# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

This is a Python monorepo for the East programming language, containing:

- **east-py**: Core Python runtime - type system, IR compiler, 212+ builtins, serialization
- **east-py-io**: I/O platform functions - S3, SQL/NoSQL databases, file formats, compression

## Repository Structure

```
east-py/
├── packages/
│   ├── east-py/          # Core runtime (see packages/east-py/CLAUDE.md)
│   └── east-py-io/       # I/O functions
├── pyproject.toml        # Workspace configuration
└── Makefile             # Root build commands
```

## Development Commands

```bash
make install             # Install all dependencies
make test                # Run all tests
make test-east-py        # Run east-py tests only
make test-east-py-io     # Run east-py-io tests only
make lint                # Run linter on all packages
make typecheck           # Type check all packages
make check               # Run all quality checks
```

## Workspace Configuration

This is a uv workspace. Key points:

- Single `uv.lock` at root for all packages
- east-py-io depends on east-py via `{ workspace = true }`
- Use `uv run --package <name>` to run commands in specific package context

## Package-Specific Documentation

For detailed architecture and coding guidance:
- **east-py**: See `packages/east-py/CLAUDE.md`
- **east-py-io**: See `packages/east-py-io/README.md`
