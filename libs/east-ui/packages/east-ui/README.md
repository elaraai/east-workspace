# East UI

> UI component definitions for the East language

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

**East UI** provides typed UI component definitions for the [East language](https://github.com/elaraai/east-workspace/tree/main/libs/east). Components return data structures describing UI layouts rather than rendering directly, enabling portability across different rendering environments.

## Features

- **Layout Components** - Box, Stack, Grid, Splitter, Separator
- **Typography** - Text, Code, Heading, Link, Highlight, Mark, List, CodeBlock
- **🔘 Buttons** - Button, IconButton with variants and states
- **Forms** - Field, Input, Select, Checkbox, Switch, Slider, Textarea, TagsInput, FileUpload
- **Collections** - Table, Gantt, DataList, TreeView
- **Charts** - Area, Bar, Line, Pie, Radar, Scatter, Sparkline, BarList, BarSegment
- **Feedback** - Alert, Progress
- **Display** - Badge, Tag, Avatar, Stat, Icon
- **Disclosure** - Accordion, Tabs, Carousel
- **Overlays** - Dialog, Drawer, Popover, Tooltip, Menu, HoverCard, ToggleTip, ActionBar
- **Styling** - Type-safe style variants (FontWeight, TextAlign, ColorScheme, Size, etc.)
- **State Management** - Platform functions for state read/write

## Installation

```bash
npm install @elaraai/east-ui @elaraai/east
```

## Quick Start

```typescript
import { East, ArrayType } from "@elaraai/east";
import { Stack, Text, Button, UIComponentType } from "@elaraai/east-ui";

// Define a UI component
const MyComponent = East.function(
    [],
    UIComponentType,
    $ => {
        return Stack.Root([
            Text.Root("Hello, World!", { fontSize: "xl", fontWeight: "bold" }),
            Button.Root("Click Me", { variant: "solid", colorPalette: "blue" }),
        ], { gap: "4", direction: "column" });
    }
);

// Convert to IR for serialization or rendering
const ir = MyComponent.toIR();
```

## Component Categories

| Category | Components | Description |
|----------|------------|-------------|
| **Layout** | `Box`, `Stack`, `Grid`, `Splitter`, `Separator` | Container and layout components |
| **Typography** | `Text`, `Code`, `Heading`, `Link`, `Highlight`, `Mark`, `List`, `CodeBlock` | Text and typography components |
| **Buttons** | `Button`, `IconButton` | Interactive button components |
| **Forms** | `Input`, `Select`, `Checkbox`, `Switch`, `Slider`, `Textarea`, `TagsInput`, `FileUpload`, `Field` | Form input components |
| **Collections** | `Table`, `Gantt`, `DataList`, `TreeView` | Data display components |
| **Charts** | `Chart.Area`, `Chart.Bar`, `Chart.Line`, `Chart.Pie`, `Chart.Radar`, `Chart.Scatter`, `Chart.BarList`, `Chart.BarSegment`, `Sparkline` | Data visualization |
| **Display** | `Badge`, `Tag`, `Avatar`, `Stat`, `Icon` | Visual display components |
| **Feedback** | `Alert`, `Progress` | User feedback components |
| **Disclosure** | `Accordion`, `Tabs`, `Carousel` | Content organization |
| **Overlays** | `Dialog`, `Drawer`, `Popover`, `Tooltip`, `Menu`, `HoverCard`, `ToggleTip`, `ActionBar` | Overlay components |
| **Container** | `Card` | Content container |

## Documentation

- **[USAGE.md](USAGE.md)** - Comprehensive guide with examples for all components
- **[East Documentation](https://github.com/elaraai/east-workspace/tree/main/libs/east)** - Core East language documentation

## Design Philosophy

East UI components are **declarative data structures**, not rendered elements:

1. **Portability** - UI definitions can be serialized and rendered in any environment
2. **Type Safety** - Full compile-time checking of component structure and styling
3. **Composability** - Components are East functions that return typed values
4. **Separation of Concerns** - UI logic (East UI) is separate from rendering (@elaraai/east-ui-components)

## Development

```bash
npm run build     # Compile TypeScript
npm run test      # Run test suite (requires build)
npm run lint      # Check code quality
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


<!-- Ecosystem — keep in sync with docs/snippets/ECOSYSTEM.md -->

### Ecosystem

- **[East](https://github.com/elaraai/east-workspace/tree/main/libs/east)**: Statically typed, expression-based language with serializable IR. Run portable logic across TypeScript, Python, C, and other runtimes.
  - [@elaraai/east](https://www.npmjs.com/package/@elaraai/east): Core language SDK with type system, expressions, and reference JS compiler

- **[East Node](https://github.com/elaraai/east-workspace/tree/main/libs/east-node)**: Node.js platform functions for I/O, databases, and system operations.
  - [@elaraai/east-node-std](https://www.npmjs.com/package/@elaraai/east-node-std): Console, FileSystem, Fetch, Crypto, Time, Path, Random
  - [@elaraai/east-node-io](https://www.npmjs.com/package/@elaraai/east-node-io): SQLite, PostgreSQL, MySQL, MongoDB, Redis, S3, FTP, SFTP, XLSX, XML, compression
  - [@elaraai/east-node-cli](https://www.npmjs.com/package/@elaraai/east-node-cli): CLI for running East IR programs in Node.js

- **[East C](https://github.com/elaraai/east-workspace/tree/main/libs/east-c)**: C11 native runtime for executing East IR. Tarballed for `linux-x64` and `linux-arm64`, attached to each GitHub Release.
  - `east-c`: Core runtime — type system, IR interpreter, 200+ builtins, serialization (Beast2, JSON, CSV, East text)
  - `east-c-std`: Console, FileSystem, Fetch, Crypto, Time, Path, Random
  - `east-c-cli`: CLI for running East IR programs natively

- **[East Python](https://github.com/elaraai/east-workspace/tree/main/libs/east-py)**: Python runtime, standard platform, I/O, and data-science platform functions. Published to PyPI.
  - [east-py](https://pypi.org/project/east-py/): Core Python runtime — type system, IR compiler, 212+ builtins, Cython-accelerated hot paths
  - [east-py-std](https://pypi.org/project/east-py-std/): Console, FileSystem, Fetch, Crypto, Time, Path, Random
  - [east-py-io](https://pypi.org/project/east-py-io/): SQLite, PostgreSQL, MySQL, MongoDB, Redis, S3, FTP, SFTP, XLSX, XML, compression
  - [east-py-cli](https://pypi.org/project/east-py-cli/): CLI for running East IR programs in Python
  - [east-py-datascience](https://pypi.org/project/east-py-datascience/) (PyPI) + [@elaraai/east-py-datascience](https://www.npmjs.com/package/@elaraai/east-py-datascience) (npm): Optimization (MADS, Optuna, ALNS, GoogleOR), ML (XGBoost, LightGBM, NGBoost, PyTorch, Lightning, GP), Bayesian inference (PyMC), explainability (SHAP), conformal prediction (MAPIE)

- **[East UI](https://github.com/elaraai/east-workspace/tree/main/libs/east-ui)**: Typed UI component definitions and React renderer, plus VS Code preview.
  - [@elaraai/east-ui](https://www.npmjs.com/package/@elaraai/east-ui): 50+ typed UI components for layouts, forms, charts, tables, dialogs
  - [@elaraai/east-ui-components](https://www.npmjs.com/package/@elaraai/east-ui-components): React renderer with Chakra UI v3 styling
  - [@elaraai/e3-ui](https://www.npmjs.com/package/@elaraai/e3-ui): e3 + UI bridge — Data bindings, `e3.ui()` task, manifest
  - [@elaraai/e3-ui-components](https://www.npmjs.com/package/@elaraai/e3-ui-components): React Query hooks and preview components for the e3 API
  - [@elaraai/e3-ui-cli](https://www.npmjs.com/package/@elaraai/e3-ui-cli): Render east-ui / e3-ui components to PNG from the command line (`e3-ui shot`)
  - [east-ui-preview](https://marketplace.visualstudio.com/items?itemName=ElaraAI.east-ui-preview): VS Code extension for live East UI component preview

- **[e3 — East Execution Engine](https://github.com/elaraai/east-workspace/tree/main/libs/e3)**: Durable execution engine for running East pipelines at scale. Git-like content-addressable storage, automatic memoization, reactive dataflow, real-time monitoring.
  - [@elaraai/e3](https://www.npmjs.com/package/@elaraai/e3): SDK for authoring e3 packages with typed tasks and pipelines
  - [@elaraai/e3-core](https://www.npmjs.com/package/@elaraai/e3-core): Object store, dataflow orchestrator, execution state
  - [@elaraai/e3-types](https://www.npmjs.com/package/@elaraai/e3-types): Shared type definitions for e3 packages
  - [@elaraai/e3-cli](https://www.npmjs.com/package/@elaraai/e3-cli): `e3 repo`, `e3 package`, `e3 workspace`, `e3 start`, `e3 watch`, `e3 logs` commands
  - [@elaraai/e3-api-client](https://www.npmjs.com/package/@elaraai/e3-api-client): HTTP client for remote e3 repositories
  - [@elaraai/e3-api-server](https://www.npmjs.com/package/@elaraai/e3-api-server): REST API server for e3 repositories
  - [@elaraai/e3-api-tests](https://www.npmjs.com/package/@elaraai/e3-api-tests): Shared API compliance test suites

## Links

- **Live Showcase**: [https://elaraai.github.io/east-ui/](https://elaraai.github.io/east-ui/)
- **Website**: [https://elaraai.com/](https://elaraai.com/)
- **East Repository**: [https://github.com/elaraai/east-workspace/tree/main/libs/east](https://github.com/elaraai/east-workspace/tree/main/libs/east)
- **Issues**: [https://github.com/elaraai/east-workspace/issues](https://github.com/elaraai/east-workspace/issues)
- **Email**: support@elara.ai


<!-- About Elara — keep in sync with docs/snippets/ABOUT_ELARA.md -->

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/).*

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/) - Powering the computational layer of AI-driven business optimization.*
