/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The store's state and action types.
 *
 * One immutable `TuiState` holds the current view (with its selection,
 * scroll and expand state), the back-stack, the command box, the toast,
 * the terminal size, the session, the connection pill, the editable-input
 * draft, and a `data` slice the pollers fill. Views are dumb renderers over
 * selectors; every key press becomes an {@link Action} the pure reducer
 * applies.
 *
 * @packageDocumentation
 */

import type { EastTypeValue, ValueTypeOf } from '@elaraai/east';
import type {
    DataflowEvent,
    DataflowExecutionState,
    DatasetStatusDetail,
    ExecutionListItem,
    ListEntry,
    RepositoryStatus,
    TaskDetails,
    TaskListItem,
    WorkspaceInfo,
    WorkspaceStatusResult,
} from '@elaraai/e3-api-client';
import type { WorkspaceState } from '@elaraai/e3-types';
import type { ValueTree, ValueTreePagedRow } from '@elaraai/east-ui/internal';
import type { ConnectionState } from './poll.js';
import type { Size } from '../render/layout.js';
import type { Tone } from '../render/theme.js';

export type { Size, ConnectionState };

/** The decoded value of a materialized ValueTree node. */
export type ValueTreeNodeValue = ValueTypeOf<typeof ValueTree.Types.Node>;
/** The decoded value of one ValueTree path step. */
export type ValueTreeStepValue = ValueTypeOf<typeof ValueTree.Types.Step>;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** A selected row and the first visible row of a list. */
export interface ListUi {
    sel: number;
    top: number;
}

/** A held key-search match: the range and the position within it. */
export interface MatchUi {
    /** First matched root row. */
    row: number;
    /** Matched rows. */
    count: number;
    /** The current position within the range (0-based). */
    index: number;
    /** The query text, for the command box status. */
    text: string;
    /** The query form. */
    form: 'exact' | 'prefix' | 'fields';
}

/** A value tree's UI state. */
export interface TreeUi extends ListUi {
    /** Per-row expansion overrides keyed by row id. */
    open: Record<string, boolean>;
    /** The collapse-all / expand-all override of the open depth. */
    baseDepth: number | undefined;
    /** The held key-search match, if any. */
    match: MatchUi | null;
}

/** A log pane's UI state. */
export interface LogsUi {
    stream: 'stdout' | 'stderr';
    /** The first visible line. */
    top: number;
    /** Whether the pane follows the tail. */
    follow: boolean;
    /** The held substring search, if any. */
    match: { text: string; index: number } | null;
}

/** The runs list's UI state. */
export interface RunsUi extends ListUi {
    /** Whether the selected run's input hashes are listed. */
    expanded: boolean;
}

/** An in-progress leaf edit in an input view. */
export interface LeafEditUi {
    /** The row being edited. */
    rowId: string;
    /** The node path the edit reports. */
    path: ValueTreeStepValue[];
    /** The leaf kind. */
    leaf: 'string' | 'integer' | 'float' | 'datetime' | 'boolean';
    /** The text being typed. */
    text: string;
    cursor: number;
    /** A validation message, if the text does not parse. */
    error: string | null;
}

/** The task view's tabs. */
export type TaskTab = 'output' | 'logs' | 'runs' | 'reads';

/** The help view's tabs — one per page, plus what works everywhere. */
export type HelpTab = 'everywhere' | 'repos' | 'workspaces' | 'dashboard' | 'task' | 'input';

/** Why the session could not open — each maps to a refusal screen. */
export type Refusal =
    | { kind: 'not-repo'; target: string }
    | { kind: 'not-logged-in'; origin: string; repo: string | null }
    | { kind: 'unreachable'; url: string; error: string; attempts: number }
    | { kind: 'error'; message: string };

/** The views. */
export type View =
    | { kind: 'launch'; target: string; step: string }
    | { kind: 'refusal'; refusal: Refusal }
    | { kind: 'repos'; list: ListUi }
    | { kind: 'workspaces'; list: ListUi }
    | { kind: 'dashboard'; ws: string; list: ListUi }
    | { kind: 'task'; ws: string; task: string; tab: TaskTab; tree: TreeUi; logs: LogsUi; runs: RunsUi; reads: ListUi }
    | { kind: 'input'; ws: string; name: string; tree: TreeUi; editing: LeafEditUi | null }
    | { kind: 'help'; tab: HelpTab }
    | { kind: 'about' };

export type ViewKind = View['kind'];

/** An empty list UI. */
export const emptyList = (): ListUi => ({ sel: 0, top: 0 });
/** An empty tree UI. */
export const emptyTree = (): TreeUi => ({ sel: 0, top: 0, open: {}, baseDepth: undefined, match: null });
/** An empty logs UI. */
export const emptyLogs = (): LogsUi => ({ stream: 'stdout', top: 0, follow: true, match: null });

/** A task view with fresh UI state. */
export function taskView(ws: string, task: string, tab: TaskTab = 'output'): View {
    return { kind: 'task', ws, task, tab, tree: emptyTree(), logs: emptyLogs(), runs: { sel: 0, top: 0, expanded: false }, reads: emptyList() };
}

/** An input view with fresh UI state. */
export function inputView(ws: string, name: string): View {
    return { kind: 'input', ws, name, tree: emptyTree(), editing: null };
}

// ---------------------------------------------------------------------------
// Command box
// ---------------------------------------------------------------------------

/** One completion row: what it inserts and its display columns. */
export interface Candidate {
    kind: 'command' | 'flag' | 'task' | 'input' | 'dataset' | 'workspace' | 'repo' | 'tag' | 'stream' | 'file';
    /** The text the box takes on Tab / Enter. */
    insert: string;
    /** The display columns (command, name, status, type, detail). */
    cells: string[];
}

/** A confirmation held in the command box — Enter re-runs `command` (already carrying `--force`), Esc cancels. */
export interface Confirm {
    /** The question shown in the box. */
    question: string;
    /** The command re-run on Enter. */
    command: string;
}

/** The command box. */
export interface CommandUi {
    /** `idle` shows the placeholder; `edit` is typing; `confirm` holds a question. */
    mode: 'idle' | 'edit' | 'confirm';
    text: string;
    cursor: number;
    completion: { items: Candidate[]; index: number } | null;
    confirm: Confirm | null;
}

/** An empty command box. */
export const emptyCommand = (): CommandUi => ({ mode: 'idle', text: '', cursor: 0, completion: null, confirm: null });

/** A one-line toast in the hint row. */
export interface Toast {
    id: number;
    text: string;
    tone: Tone;
    /** The glyph before the text (the tone's glyph when absent). */
    glyph?: string | undefined;
    /** Epoch milliseconds when it expires. */
    until: number;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** What the header and the about view know about the open session. */
export interface SessionInfo {
    kind: 'local' | 'remote' | 'origin';
    /** The breadcrumb's first crumb (`demo-repo` / `e3.example.com`). */
    label: string;
    /** The repository id, or null for a bare origin. */
    repo: string | null;
    /** The API base URL. */
    apiUrl: string;
    /** The local repository path, for local sessions. */
    path: string | null;
    /** The remote origin, for remote / origin sessions. */
    origin: string | null;
    /** The signed-in identity (a JWT subject / email), for remote sessions. */
    identity: string | null;
    /** The persisted-state key for this repository. */
    stateKey: string;
    /** The argument the session was opened with (for `/about` and `lastRepo`). */
    target: string;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** The latest execution feed of a workspace. */
export interface ExecutionData {
    /** The polled state, or null when the workspace has never run. */
    state: DataflowExecutionState | null;
    /** The events received so far for this execution (the cursor is their length). */
    events: DataflowEvent[];
    /** `startedAt` of the execution the events belong to. */
    startedAt: string | null;
    /** True between `/run` and the first poll that shows it running. */
    settling: boolean;
    /** True after a `/stop` until the poll shows the run stopped. */
    stopping: boolean;
}

/** How a dataset is being shown. */
export type DatasetMode =
    | { kind: 'loading' }
    | { kind: 'unset' }
    | { kind: 'null' }
    | { kind: 'inline'; root: ValueTreeNodeValue; value: unknown }
    | { kind: 'paged'; totalRows: number; totalBytes: number; pages: ReadonlyMap<number, readonly ValueTreePagedRow[]>; loading: readonly number[] }
    | { kind: 'too-large' }
    | { kind: 'not-indexed'; loadable: boolean }
    | { kind: 'error'; message: string };

/** A dataset's status and content. */
export interface DatasetData {
    status: DatasetStatusDetail | null;
    /** The content hash the mode was built for. */
    hash: string | null;
    type: EastTypeValue | null;
    size: number;
    mode: DatasetMode;
    /** Whether the whole value was loaded despite the inline limit (`⏎ load whole value`). */
    forced: boolean;
}

/** A task's log stream. */
export interface LogsData {
    text: string;
    /** Bytes fetched so far. */
    offset: number;
    /** The stream's total size on the server. */
    totalSize: number;
    /** Whether `offset` reached `totalSize` on the last poll. */
    complete: boolean;
    /** Whether the 10 MB cap was hit. */
    capped: boolean;
    /** The last error, if a fetch failed. */
    error: string | null;
}

/** A repository's last deployment, for the repositories view. */
export interface RepoDeploy {
    workspace: string;
    packageName: string;
    packageVersion: string;
    deployedAt: Date;
}

/** The data the pollers fill. */
export interface DataState {
    /** Repositories on a bare origin, with lazily fetched statuses and last deployments. */
    repos: { names: string[]; status: Record<string, RepositoryStatus>; deploy: Record<string, RepoDeploy | null> } | null;
    workspaces: WorkspaceInfo[] | null;
    /** Per workspace: the deployed state (deployedAt), null when not deployed. */
    workspaceState: Record<string, WorkspaceState | null>;
    /** Per workspace: the latest status poll. */
    status: Record<string, { result: WorkspaceStatusResult; at: number }>;
    /** Per workspace: the last status error. */
    statusError: Record<string, string>;
    /** Per workspace: the latest execution. */
    execution: Record<string, ExecutionData>;
    /** Per workspace: every dataset with its type / hash / size. */
    datasets: Record<string, ListEntry[]>;
    /** Per workspace: the task list (with kinds). */
    taskList: Record<string, TaskListItem[]>;
    /** Per workspace, per task: task details. */
    taskDetails: Record<string, Record<string, TaskDetails>>;
    /** Per workspace, per task: execution history. */
    executions: Record<string, Record<string, ExecutionListItem[]>>;
    /** Per workspace, per dataset path: status + content. */
    dataset: Record<string, Record<string, DatasetData>>;
    /** Per workspace, per task, per stream: log text. */
    logs: Record<string, Record<string, Partial<Record<'stdout' | 'stderr', LogsData>>>>;
    /** Epoch milliseconds of the last successful status poll. */
    polledAt: number | null;
}

/** An empty data slice. */
export const emptyData = (): DataState => ({
    repos: null,
    workspaces: null,
    workspaceState: {},
    status: {},
    statusError: {},
    execution: {},
    datasets: {},
    taskList: {},
    taskDetails: {},
    executions: {},
    dataset: {},
    logs: {},
    polledAt: null,
});

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/** One recorded edit of an input's draft. */
export type EditOp =
    | { kind: 'edit'; path: ValueTreeStepValue[]; leaf: { type: string; value: unknown } }
    | { kind: 'insert'; path: ValueTreeStepValue[] }
    | { kind: 'remove'; path: ValueTreeStepValue[] }
    | { kind: 'tag'; path: ValueTreeStepValue[]; tag: string };

/** The editable-input draft: the base value, the ops, and the draft they produce. */
export interface EditState {
    ws: string;
    path: string;
    type: EastTypeValue;
    /** The value the ops were applied to. */
    base: unknown;
    /** The content hash of `base`. */
    baseHash: string;
    ops: EditOp[];
    /** `base` with `ops` applied. */
    draft: unknown;
    /** The draft, materialized. */
    root: ValueTreeNodeValue;
    /** Row ids the ops touched (`┆` markers). */
    changed: string[];
    /** A server-side change seen while dirty: the new hash. */
    conflict: string | null;
    /** True while an apply is in flight. */
    applying: boolean;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** The whole store state. */
export interface TuiState {
    size: Size;
    session: SessionInfo | null;
    connection: ConnectionState;
    view: View;
    history: View[];
    command: CommandUi;
    toast: Toast | null;
    edit: EditState | null;
    data: DataState;
    /** Pending multi-key prefix (`g` of `gg`). */
    pendingKey: string | null;
    /** Whether mouse reporting is on. */
    mouse: boolean;
}

/** The initial state for a target being opened. */
export function initialState(size: Size, target: string): TuiState {
    return {
        size,
        session: null,
        connection: { kind: 'idle' },
        view: { kind: 'launch', target, step: 'starting' },
        history: [],
        command: emptyCommand(),
        toast: null,
        edit: null,
        data: emptyData(),
        pendingKey: null,
        mouse: false,
    };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** A list navigation operation. */
export type NavOp = 'up' | 'down' | 'pageUp' | 'pageDown' | 'home' | 'end';

/** Every store action. */
export type Action =
    | { type: 'size'; size: Size }
    | { type: 'session'; session: SessionInfo | null }
    | { type: 'connection'; connection: ConnectionState }
    | { type: 'mouse'; enabled: boolean }
    | { type: 'pendingKey'; key: string | null }
    // views
    | { type: 'view/set'; view: View }
    | { type: 'view/root'; view: View }
    | { type: 'view/push'; view: View }
    | { type: 'view/pop' }
    | { type: 'view/launchStep'; step: string }
    | { type: 'list/move'; op: NavOp; count: number; visible: number }
    | { type: 'list/select'; index: number; count: number; visible: number }
    | { type: 'list/scroll'; delta: number; count: number; visible: number }
    | { type: 'tree/toggle'; id: string; expanded: boolean; descendants?: string[] }
    | { type: 'tree/expandAll' }
    | { type: 'tree/collapseAll' }
    | { type: 'tree/restore'; open: Record<string, boolean>; top: number; baseDepth: number | undefined }
    | { type: 'tree/match'; match: MatchUi | null }
    | { type: 'task/tab'; tab: TaskTab }
    | { type: 'runs/expand'; expanded: boolean }
    | { type: 'logs/stream'; stream: 'stdout' | 'stderr' }
    | { type: 'logs/follow'; follow: boolean }
    | { type: 'logs/scroll'; top: number }
    | { type: 'logs/match'; match: { text: string; index: number } | null }
    | { type: 'help/tab'; tab: HelpTab }
    | { type: 'input/editing'; editing: LeafEditUi | null }
    // command box
    | { type: 'command/edit'; text: string; cursor?: number }
    | { type: 'command/insert'; text: string }
    | { type: 'command/backspace' }
    | { type: 'command/delete' }
    | { type: 'command/cursor'; to: number | 'home' | 'end' | 'left' | 'right' }
    | { type: 'command/completion'; items: Candidate[] }
    | { type: 'command/completionMove'; delta: number }
    | { type: 'command/clear' }
    | { type: 'command/confirm'; confirm: Confirm }
    | { type: 'toast'; toast: Toast }
    | { type: 'toast/clear'; id: number }
    // data
    | { type: 'data/repos'; names: string[] }
    | { type: 'data/repoStatus'; repo: string; status: RepositoryStatus }
    | { type: 'data/repoDeploy'; repo: string; deploy: RepoDeploy | null }
    | { type: 'data/workspaces'; workspaces: WorkspaceInfo[] }
    | { type: 'data/workspaceState'; ws: string; state: WorkspaceState | null }
    | { type: 'data/status'; ws: string; result: WorkspaceStatusResult; at: number }
    | { type: 'data/statusError'; ws: string; error: string }
    | { type: 'data/execution'; ws: string; state: DataflowExecutionState | null; events: DataflowEvent[]; startedAt: string | null }
    | { type: 'data/executionFlag'; ws: string; settling?: boolean; stopping?: boolean }
    | { type: 'data/datasets'; ws: string; entries: ListEntry[] }
    | { type: 'data/taskList'; ws: string; tasks: TaskListItem[] }
    | { type: 'data/taskDetails'; ws: string; task: string; details: TaskDetails }
    | { type: 'data/executions'; ws: string; task: string; executions: ExecutionListItem[] }
    | { type: 'data/dataset'; ws: string; path: string; data: DatasetData }
    | { type: 'data/datasetMode'; ws: string; path: string; mode: DatasetMode }
    | { type: 'data/logs'; ws: string; task: string; stream: 'stdout' | 'stderr'; logs: LogsData }
    | { type: 'data/reset' }
    // editing
    | { type: 'edit/set'; edit: EditState | null };
