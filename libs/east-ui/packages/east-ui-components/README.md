# East UI Components

> React rendering components for East UI

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

**East UI Components** provides React components that render [East UI](https://www.npmjs.com/package/@elaraai/east-ui) data structures. It bridges the gap between East UI's declarative component definitions and interactive React applications using [Chakra UI v3](https://chakra-ui.com/).

## Features

- **Chakra UI v3** - Modern, accessible component rendering
- **All East UI Components** - Full support for layout, forms, charts, overlays, and more
- **State Management** - React hooks for East state operations
- **Recharts Integration** - Charts rendered using Recharts library
- **Type-Safe** - Full TypeScript support

## Installation

```bash
npm install @elaraai/east-ui-components @elaraai/east-ui @elaraai/east
```

## Quick Start

```tsx
import React from "react";
import { Provider } from "@chakra-ui/react";
import { East } from "@elaraai/east";
import { Stack, Text, Button, UIComponentType } from "@elaraai/east-ui";
import { EastUIComponent, system } from "@elaraai/east-ui-components";

// Define your East UI component
const MyUI = East.function([], UIComponentType, $ => {
    return Stack.Root([
        Text.Root("Hello from East UI!", { fontSize: "xl" }),
        Button.Root("Click Me", { variant: "solid", colorPalette: "blue" }),
    ], { gap: "4" });
});

// Compile and get the UI IR
const compiled = East.compile(MyUI.toIR());
const uiData = compiled();

// Render in React
function App() {
    return (
        <Provider value={system}>
            <EastUIComponent ir={uiData} />
        </Provider>
    );
}
```

## State Management

East UI Components provides hooks for managing state in East applications:

```tsx
import { useEastStore, useEastState } from "@elaraai/east-ui-components";
import { State } from "@elaraai/east-ui";

// In your East function
const MyComponent = East.function([], UIComponentType, $ => {
    const count = $.let(State.read("counter", IntegerType, 0n));
    return Button.Root(
        East.str`Count: ${count}`,
        { onClick: State.write("counter", count.add(1n)) }
    );
});

// In your React app
function App() {
    const store = useEastStore();
    const [count] = useEastState(store, "counter", 0n);

    return (
        <Provider value={system}>
            <EastUIComponent ir={uiData} store={store} />
            <p>Current count: {count}</p>
        </Provider>
    );
}
```

## Supported Components

All East UI components are supported:

| Category | Components |
|----------|------------|
| **Layout** | Box, Stack, HStack, VStack, Grid, Splitter, Separator |
| **Typography** | Text, Code, Heading, Link, Highlight, Mark, List, CodeBlock |
| **Buttons** | Button, IconButton |
| **Forms** | Input (String, Integer, Float, DateTime), Select, Checkbox, Switch, Slider, Textarea, TagsInput, FileUpload, Field, Fieldset |
| **Collections** | Table, DataList, TreeView |
| **Charts** | Area, Bar, Line, Pie, Radar, Scatter, Sparkline, BarList, BarSegment |
| **Display** | Badge, Tag, Avatar, Stat, Icon |
| **Feedback** | Alert, Progress |
| **Disclosure** | Accordion, Tabs, Carousel |
| **Overlays** | Dialog, Drawer, Popover, Tooltip, Menu, HoverCard, ToggleTip, ActionBar |
| **Container** | Card |

## Development

```bash
npm run build     # Build library
npm run dev       # Start development server
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
- **East UI**: [https://www.npmjs.com/package/@elaraai/east-ui](https://www.npmjs.com/package/@elaraai/east-ui)
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
