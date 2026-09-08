/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The state file — where `e3-ui` remembers the last repository, each
 * repository's last workspace and view, and each value tree's expand-set
 * and top row.
 *
 * Path: `$E3_UI_STATE`, else `$XDG_STATE_HOME/e3-ui/state.json`, else
 * `~/.local/state/e3-ui/state.json` (`%LOCALAPPDATA%\e3-ui\state.json` on
 * Windows). Mode 0600, written atomically (tmp + rename), debounced 250 ms,
 * schema v1 with a `version` guard, tree entries bounded to 200 (LRU), a
 * corrupt file renamed to `.bak` and started fresh. Never tokens — those
 * stay in `~/.e3/credentials.json`.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** The state schema version this build reads and writes. */
export const STATE_VERSION = 1;
/** Tree entries kept (least recently used dropped first). */
export const MAX_TREE_ENTRIES = 200;
/** Debounce between a change and the write, in milliseconds. */
export const WRITE_DEBOUNCE_MS = 250;

/** A value tree's remembered UI state. */
export interface TreeState {
    /** Per-row expansion overrides keyed by row id. */
    open: Record<string, boolean>;
    /** The first visible flat row. */
    topRow: number;
    /** The collapse-all / expand-all override of the open depth. */
    baseDepth?: number | undefined;
    /** Epoch milliseconds of the last touch (the LRU key). */
    touched: number;
}

/** A repository's remembered state. */
export interface RepoState {
    /** The last workspace opened. */
    workspace?: string | undefined;
    /** The last view (`dashboard`, `task:<name>`, `input:<name>`). */
    view?: string | undefined;
    /** Value trees by storage key (`${ws}:${path}`). */
    trees: Record<string, TreeState>;
}

/** The whole state file. */
export interface PersistedState {
    version: typeof STATE_VERSION;
    /** The last repository argument opened. */
    lastRepo?: string | undefined;
    /** Repositories by key (the resolved local path or the remote URL). */
    repos: Record<string, RepoState>;
}

/** An empty state file. */
export function emptyState(): PersistedState {
    return { version: STATE_VERSION, repos: {} };
}

/**
 * Resolves the state file path.
 *
 * @param env - The environment
 * @param platform - `process.platform`
 * @param home - The home directory
 * @returns `$E3_UI_STATE`, else `$XDG_STATE_HOME/e3-ui/state.json`, else the platform default
 */
export function statePath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
    const explicit = env['E3_UI_STATE'];
    if (explicit !== undefined && explicit !== '') return explicit;
    const xdg = env['XDG_STATE_HOME'];
    if (xdg !== undefined && xdg !== '') return path.join(xdg, 'e3-ui', 'state.json');
    if (platform === 'win32') {
        const local = env['LOCALAPPDATA'];
        return path.join(local !== undefined && local !== '' ? local : path.join(home, 'AppData', 'Local'), 'e3-ui', 'state.json');
    }
    return path.join(home, '.local', 'state', 'e3-ui', 'state.json');
}

/**
 * Whether a parsed value is a state file this build can read.
 *
 * @param value - The parsed JSON
 * @returns `true` for a v1 object with a `repos` record
 */
export function isPersistedState(value: unknown): value is PersistedState {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return v['version'] === STATE_VERSION && typeof v['repos'] === 'object' && v['repos'] !== null;
}

/**
 * Loads the state file. A missing file starts fresh; a corrupt or
 * incompatible one is renamed to `<file>.bak` and started fresh.
 *
 * @param file - The state file path
 * @returns The state and, when the file was set aside, the backup path
 */
export function loadState(file: string): { state: PersistedState; recoveredFrom?: string } {
    let text: string;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch {
        return { state: emptyState() };
    }
    try {
        const parsed: unknown = JSON.parse(text);
        if (isPersistedState(parsed)) return { state: parsed };
    } catch {
        // fall through to recovery
    }
    const backup = `${file}.bak`;
    try {
        fs.renameSync(file, backup);
    } catch {
        // an unreadable file we cannot move: start fresh in memory
    }
    return { state: emptyState(), recoveredFrom: backup };
}

/**
 * Writes the state file atomically (temp file + rename) with mode 0600,
 * creating its directory (0700) as needed.
 *
 * @param file - The state file path
 * @param state - The state
 */
export function writeStateSync(file: string, state: PersistedState): void {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
}

/**
 * Drops the least recently touched tree entries beyond the cap.
 *
 * @param state - The state (mutated)
 * @param max - The cap
 */
export function pruneTrees(state: PersistedState, max = MAX_TREE_ENTRIES): void {
    const all: { repo: string; key: string; touched: number }[] = [];
    for (const [repo, r] of Object.entries(state.repos)) {
        for (const [key, tree] of Object.entries(r.trees)) all.push({ repo, key, touched: tree.touched });
    }
    if (all.length <= max) return;
    all.sort((a, b) => a.touched - b.touched);
    for (const drop of all.slice(0, all.length - max)) {
        delete state.repos[drop.repo]!.trees[drop.key];
    }
}

/** The debounced writer. */
export interface Persister {
    /** The current state (read-only view). */
    readonly state: PersistedState;
    /** Applies a change and schedules a write. */
    update(fn: (state: PersistedState) => void): void;
    /** Writes now if anything is pending. */
    flush(): void;
    /** Whether a write is pending. */
    readonly dirty: boolean;
}

/**
 * Creates the debounced writer over a state file.
 *
 * @param file - The state file path
 * @param initial - The loaded state
 * @param options - `debounceMs` (default 250) and `onError` for write failures
 * @returns The persister
 */
export function createPersister(
    file: string,
    initial: PersistedState,
    options: { debounceMs?: number; onError?: (error: unknown) => void } = {},
): Persister {
    const debounceMs = options.debounceMs ?? WRITE_DEBOUNCE_MS;
    const state = initial;
    let dirty = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const write = (): void => {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        if (!dirty) return;
        dirty = false;
        try {
            pruneTrees(state);
            writeStateSync(file, state);
        } catch (error) {
            options.onError?.(error);
        }
    };
    return {
        get state() { return state; },
        get dirty() { return dirty; },
        update(fn) {
            fn(state);
            dirty = true;
            if (timer === undefined) {
                timer = setTimeout(write, debounceMs);
                timer.unref?.();
            }
        },
        flush: write,
    };
}

/**
 * The repository's state entry, created when missing.
 *
 * @param state - The state file
 * @param repoKey - The repository key
 * @returns The entry
 */
export function repoEntry(state: PersistedState, repoKey: string): RepoState {
    let entry = state.repos[repoKey];
    if (entry === undefined) {
        entry = { trees: {} };
        state.repos[repoKey] = entry;
    }
    return entry;
}
