# E3 Ui Showcase

e3 project (BSL-1.1).

## Setup

```bash
make install
```

## Usage

```bash
make update     # Update @elaraai packages and e3 CLI
make build      # Build TypeScript
make test       # Run full test suite (exports IR, runs Python tests)
make test-ts    # Run TypeScript tests only
make test-py    # Run Python tests only (requires IR exported first)
make repo       # Create e3 repository and workspace
make start      # Build, package, import, deploy and run
make watch      # Watch mode (auto-deploy on changes)
```
