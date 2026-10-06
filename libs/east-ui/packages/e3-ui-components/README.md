# E3 UI Components

> React Query hooks and preview components for the e3 API

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

**E3 UI Components** provides React Query hooks for all [e3-api-client](https://www.npmjs.com/package/@elaraai/e3-api-client) functions and reusable preview components for tasks, inputs, and logs.

## Features

- **React Query Hooks** - `useQuery` and `useMutation` wrappers for all e3 API client functions
- **Task Preview** - Component for viewing task execution output and logs
- **Input Preview** - Component for viewing dataset input values
- **Virtualized Log Viewer** - Performant log display with search and auto-scroll
- **Type-Safe** - Full TypeScript support with proper return type inference

## Installation

```bash
npm install @elaraai/e3-ui-components @elaraai/e3-api-client @tanstack/react-query
```

## Hooks

React Query hooks are provided for every e3 API domain:

| Domain | Hooks |
|--------|-------|
| **Repos** | `useRepoList`, `useRepoStatus`, `useRepoGc`, `useRepoGcStart`, `useRepoGcStatus`, `useRepoCreate`, `useRepoRemove` |
| **Packages** | `usePackageList`, `usePackageGet`, `usePackageImport`, `usePackageExport`, `usePackageRemove` |
| **Workspaces** | `useWorkspaceList`, `useWorkspaceCreate`, `useWorkspaceGet`, `useWorkspaceStatus`, `useWorkspaceRemove`, `useWorkspaceDeploy`, `useWorkspaceExport` |
| **Datasets** | `useDatasetList`, `useDatasetListAt`, `useDatasetListRecursive`, `useDatasetGet`, `useDatasetSet` |
| **Tasks** | `useTaskList`, `useTaskGet`, `useTaskExecutionList` |
| **Executions** | `useDataflowExecute`, `useDataflowStart`, `useDataflowGraph`, `useDataflowExecution`, `useDataflowCancel`, `useTaskLogs` |

### Quick Start

```tsx
import { useWorkspaceList, useTaskList } from '@elaraai/e3-ui-components';

function WorkspaceView({ apiUrl, repo }: { apiUrl: string; repo: string }) {
    const { data: workspaces, isLoading } = useWorkspaceList(apiUrl, repo);

    if (isLoading) return <div>Loading...</div>;

    return (
        <ul>
            {workspaces?.map(ws => <li key={ws.name}>{ws.name}</li>)}
        </ul>
    );
}
```

### Query Overrides

All query hooks accept an optional `QueryOverrides` parameter for controlling query behavior:

```tsx
const { data } = useTaskList(apiUrl, repo, workspace, requestOptions, {
    refetchInterval: 5000,
    staleTime: 10000,
    enabled: isReady,
});
```

### Recovering a failed read

A view on a screen no one touches, such as a kiosk's, has no one to reload it.
`useQueryRecovery` tries a failed query again by itself while the view is
mounted, as every stage of `UITaskPreview` does. It waits a random point in the
second half of a backoff from 1 s to 30 s (`recoveryDelay`), and shows the
latest failure through each try, never loading again.

```tsx
import { StatusDisplay, useQueryRecovery, useTaskGet } from '@elaraai/e3-ui-components';

const details = useTaskGet(apiUrl, repo, workspace, task);
const failure = useQueryRecovery(details); // null once it reads
if (failure !== null) return <StatusDisplay variant="error" title="Error" message={failure.message} />;
```

### Rendering a UI outside `UITaskPreview`

A host that renders UI functions itself decodes each with the platforms
`UITaskPreview` lists. Every one is exported by name: east-ui-components' own,
`Decision.bind`'s (`DecisionBindPlatform`), and the bindings scoped to the UI's
manifest. Preload the manifest's `paths` with `usePreloadReactiveDatasets`
before the UI's first read.

```tsx
import { decodeBeast2For } from '@elaraai/east';
import { UIComponentType } from '@elaraai/east-ui';
import {
    StateImpl, NavImpl, SliceImpl, SliceApplyImpl, OverlayImpl, ClipboardImpl, DownloadImpl, ShareImpl,
} from '@elaraai/east-ui-components';
import {
    DecisionBindPlatform, createScopedBindPlatform, createScopedPagedPlatform,
    createScopedFuncPlatform, createScopedRecordPlatform,
} from '@elaraai/e3-ui-components';

const platforms = [
    ...StateImpl, ...NavImpl, ...SliceImpl, ...SliceApplyImpl, ...OverlayImpl,
    ...ClipboardImpl, ...DownloadImpl, ...ShareImpl, ...DecisionBindPlatform,
    ...createScopedBindPlatform(manifest),
    ...createScopedPagedPlatform(manifest.pages),
    ...createScopedFuncPlatform(manifest.functions),
    ...createScopedRecordPlatform(manifest.records),
];
const ui = decodeBeast2For(UIComponentType, { platform: platforms })(bytes);
```

## Components

### TaskPreview

Previews a task by its role: a `ui()` task renders its UI; a data task shows its
output (Output) and its logs (Logs) under a band holding the Output/Logs switch.
Above the output are its key search, size and Download, and above its tree
Collapse all and Expand all; above the log, its stdout/stderr tabs, its search
and Copy.

```tsx
import { TaskPreview } from '@elaraai/e3-ui-components';

<TaskPreview apiUrl={url} repo="default" workspace={ws} task={taskName} />
```

| Prop | Meaning |
|------|---------|
| `apiUrl`, `repo`, `workspace`, `task` | **required** — the task to preview |
| `requestOptions` | the token, and the `fetch` every request goes through |
| `bare` | no task-name header, and a `ui()` task's output edge to edge — for a kiosk |
| `toolbar` | `false` draws no band anywhere in a data task's preview — no switch, nothing above the output or its tree, nothing above the log, which fills the view edge to edge; the host draws the controls. Default `true` |
| `view`, `onViewChange` | a data task's tab, `'output'` or `'logs'`, controlled |
| `search`, `onSearchChange` | the output's key search, controlled: a given `search` is found and scrolled to (`''` clears), and the preview draws no search box of its own; otherwise `onSearchChange` hears the preview's own box |
| `logStream`, `onLogStreamChange` | the log's stream, `'stdout'` or `'stderr'`, controlled |
| `logSearch`, `onLogSearchChange` | the log's search, controlled: a given `logSearch` marks its matches, in any case, and scrolls to the first (`''` clears), and the log draws no search box, count or chevrons of its own; otherwise `onLogSearchChange` hears the log's own box |
| `onLogMatchesChange` | told `{ current, count }` — the log's match shown, from 0, and how many there are — whenever either changes |
| `controls` | the handle the host's own buttons act through, made with `usePreviewControls()` |

A host whose frame holds its controls in its header draws them itself and hides
the bands:

```tsx
import {
    TaskPreview, downloadDataset, formatSize, usePreviewControls, useDatasetStatus, useTaskDetails, type LogMatches,
} from '@elaraai/e3-ui-components';

const [view, setView] = useState<'output' | 'logs'>('output');
const [search, setSearch] = useState('');
const [stream, setStream] = useState<'stdout' | 'stderr'>('stdout');
const [logSearch, setLogSearch] = useState('');
const [matches, setMatches] = useState<LogMatches>({ current: 0, count: 0 });
const controls = usePreviewControls();
const details = useTaskDetails(url, 'default', ws, taskName);
const output = details.data?.output.path.map((step) => step.value).join('.') ?? null;
const status = useDatasetStatus(url, 'default', ws, output);

// In the header, at the header's size: the tab; on Output, the search, the size,
// Download, and Collapse all and Expand all; on Logs, the stream, the search,
// `${matches.current + 1}/${matches.count}`, the chevrons and Copy.
// In the body:
<TaskPreview apiUrl={url} repo="default" workspace={ws} task={taskName} bare
    toolbar={false} view={view} onViewChange={setView} search={search}
    logStream={stream} onLogStreamChange={setStream} logSearch={logSearch}
    onLogMatchesChange={setMatches} controls={controls} />
// Download: downloadDataset(url, 'default', ws, output); the size: formatSize(status.data.sizeBytes)
// Collapse all: controls.collapseAll(); Expand all: controls.expandAll()
// The chevrons: controls.previousMatch(), controls.nextMatch(); Copy: controls.copyLog()
```

`search` is read as the preview's own search box reads its text: a key's
prefix, a struct key's leading fields (`press, 2`), a `from..to` range, or a
whole key in `.east` syntax.

`usePreviewControls()` makes the handle. `collapseAll()` and `expandAll()` act
on the output's tree; `nextMatch()` and `previousMatch()` step through the
log's matches, from the last round to the first and back; and `copyLog()`
copies the log shown, resolving `true` once it is on the clipboard and `false`
when the clipboard refuses it. Each does nothing while its view is not shown —
the Output tab shows no log, and a value too large to show has no tree. A
handle serves one preview at a time, and holds no query, so a header outside
`<E3Provider>` can make it.

### DatasetPreview

Shows a dataset's value: a tree, inline while it is small, a page at a time
for a read-only collection, and a Download for a value too large to show.
`editable` writes a mutable input's edits back. `toolbar`, `search`,
`onSearchChange` and `controls` are `TaskPreview`'s, for the value alone.

```tsx
import { DatasetPreview } from '@elaraai/e3-ui-components';

<DatasetPreview apiUrl={url} repo="default" workspace={ws} path="inputs.threshold" editable />
```

### InputPreview

Shows an input's value, editable, under a band naming the input.

```tsx
import { InputPreview } from '@elaraai/e3-ui-components';

<InputPreview apiUrl={url} repo="default" workspace={ws} path=".inputs.threshold" />
```

`bare` draws no band naming the input, for a host whose frame names it, and
`toolbar`, `search`, `onSearchChange` and `controls` reach the value's
`DatasetPreview`.

### VirtualizedLogViewer

A log, its lines virtualized, under a band holding the stdout/stderr tabs, a
search that marks its matches and steps through them, and Copy. It follows the
log's end while it is there, and says when new lines arrive while it is not.

```tsx
import { useTabs } from '@chakra-ui/react';
import { VirtualizedLogViewer } from '@elaraai/e3-ui-components';

const tabs = useTabs({ defaultValue: 'stdout' });

<VirtualizedLogViewer content={tabs.value === 'stderr' ? stderr : stdout} tabs={tabs} />
```

| Prop | Meaning |
|------|---------|
| `content`, `tabs` | **required** — the log's text, and the tabs `useTabs` makes |
| `toolbar` | `false` draws no band, and the log fills the view edge to edge, with no inset, corners or border. Default `true` |
| `search`, `onSearchChange` | the search, controlled, as `TaskPreview`'s `logSearch` |
| `onMatchesChange` | told `{ current, count }` whenever either changes |
| `controlsRef` | given a `LogViewerControls` — `nextMatch()`, `previousMatch()` and `copy()` — while the view is mounted |

### StatusDisplay

Status feedback component with error, warning, info, and loading variants.

```tsx
import { StatusDisplay } from '@elaraai/e3-ui-components';

<StatusDisplay variant="error" title="Failed" message={error.message} />
```

## Development

```bash
npm run build     # Build library
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
  - [@elaraai/e3-ui-cli](https://www.npmjs.com/package/@elaraai/e3-ui-cli): Browse an e3 repository in the terminal (`e3-ui [repo]`), and render east-ui / e3-ui components to PNG (`e3-ui shot`)
  - [east-ui-preview](https://marketplace.visualstudio.com/items?itemName=ElaraAI.east-ui-preview): VS Code extension for live East UI component preview

- **[e3 — East Execution Engine](https://github.com/elaraai/east-workspace/tree/main/libs/e3)**: Durable execution engine for running East pipelines at scale. Git-like content-addressable storage, automatic memoization, reactive dataflow, real-time monitoring.
  - [@elaraai/e3](https://www.npmjs.com/package/@elaraai/e3): SDK for authoring e3 packages with typed tasks and pipelines
  - [@elaraai/e3-core](https://www.npmjs.com/package/@elaraai/e3-core): Object store, dataflow orchestrator, execution state
  - [@elaraai/e3-types](https://www.npmjs.com/package/@elaraai/e3-types): Shared type definitions for e3 packages
  - [@elaraai/e3-cli](https://www.npmjs.com/package/@elaraai/e3-cli): `e3 repo`, `e3 package`, `e3 workspace`, `e3 dataflow run`, `e3 watch`, `e3 task logs` commands
  - [@elaraai/e3-api-client](https://www.npmjs.com/package/@elaraai/e3-api-client): HTTP client for remote e3 repositories
  - [@elaraai/e3-api-server](https://www.npmjs.com/package/@elaraai/e3-api-server): REST API server for e3 repositories
  - [@elaraai/e3-api-tests](https://www.npmjs.com/package/@elaraai/e3-api-tests): Shared API compliance test suites

## Links

- **Website**: [https://elaraai.com/](https://elaraai.com/)
- **e3 API Client**: [https://www.npmjs.com/package/@elaraai/e3-api-client](https://www.npmjs.com/package/@elaraai/e3-api-client)
- **East UI**: [https://www.npmjs.com/package/@elaraai/east-ui](https://www.npmjs.com/package/@elaraai/east-ui)
- **Issues**: [https://github.com/elaraai/east-workspace/issues](https://github.com/elaraai/east-workspace/issues)
- **Email**: support@elara.ai


<!-- About Elara — keep in sync with docs/snippets/ABOUT_ELARA.md -->

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/).*

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/) - Powering the computational layer of AI-driven business optimization.*
