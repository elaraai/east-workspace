# East Web

> Browser platform integration for the East language

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE.md)

**East Web** provides the platform functions [East](https://github.com/elaraai/east-workspace/tree/main/libs/east) programs call when they run in a browser. Every East runtime has its own standard platform package — East Node's `east-node-std`, East C's `east-c-std`, East Python's `east-py-std` — and this is the browser's: the same functions under the same names and East types, so a program runs in any of them unchanged.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [@elaraai/east-web-std](./packages/east-web-std) | Standard platform functions (console, fetch, crypto, time, path, random) | [![npm](https://img.shields.io/npm/v/@elaraai/east-web-std)](https://www.npmjs.com/package/@elaraai/east-web-std) |

## Features

**east-web-std:**
- **Console** - stdout/stderr output, to a sink the host gives
- **Fetch** - HTTP requests with the browser's Fetch API
- **Crypto** - Random bytes, SHA-256, UUID generation
- **Random** - Statistical distributions (uniform, normal, Poisson, …); a seed gives East Node's stream, bit for bit
- **Time** - Timestamps, sleep and timezone offsets
- **Path** - POSIX path manipulation
- **Test** - The functions East test suites call

FileSystem, Env and the large-JSON reader have no browser meaning and are not provided: a program that calls one fails to compile, naming the function.

## Quick Start

```bash
npm install @elaraai/east-web-std @elaraai/east
```

```typescript
import { East, NullType } from "@elaraai/east";
import { Console, Path, WebPlatform } from "@elaraai/east-web-std";

const MyProgram = East.asyncFunction([], NullType, ($) => {
    // Write to the console
    $(Console.log(Path.join(["reports", "2026", "summary.csv"])));
});

// Execute the program
await MyProgram.toIR().compile(WebPlatform)();
```

## Development

```bash
make build    # Build all packages
make test     # Run the specs, then East Node's compliance suite over east-web-std
make lint     # Lint all packages
```

## Claude Code plugin

The East ecosystem also ships a [Claude Code](https://claude.com/claude-code) plugin — East language skills, example search, and preemptive diagnostics for East code — installed separately from the `elaraai` marketplace:

```text
# Inside Claude Code
/plugin marketplace add elaraai/east-workspace
/plugin install east@elaraai
```

```bash
# From a terminal
claude plugin marketplace add elaraai/east-workspace
claude plugin install east@elaraai
```

## License

Dual-licensed:
- **Open Source**: [AGPL-3.0](LICENSE.md) - Free for open source use
- **Commercial**: Available for proprietary use - contact support@elara.ai

## Links

- **Website**: [https://elaraai.com/](https://elaraai.com/)
- **East Repository**: [https://github.com/elaraai/east-workspace/tree/main/libs/east](https://github.com/elaraai/east-workspace/tree/main/libs/east)
- **Issues**: [https://github.com/elaraai/east-workspace/issues](https://github.com/elaraai/east-workspace/issues)
- **Email**: support@elara.ai

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/).*
