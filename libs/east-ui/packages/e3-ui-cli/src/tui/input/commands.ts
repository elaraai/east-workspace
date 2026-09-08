/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The command grammar — `parseCommand(text)` for everything the command
 * box accepts, `describe(cmd, ctx)` for the consequence line the box shows
 * before Enter, and `hotkeyToCommand` for the keys that prefill a command.
 *
 * @packageDocumentation
 */

/** A parsed command. */
export type ParsedCommand =
    | { name: 'task'; target: string }
    | { name: 'input'; target: string }
    | { name: 'dataset'; target: string }
    | { name: 'workspace'; target: string }
    | { name: 'workspaces' }
    | { name: 'repos' }
    | { name: 'repo'; target: string }
    | { name: 'login'; url: string }
    | { name: 'run'; force: boolean; filter: string | undefined; concurrency: number | undefined }
    | { name: 'stop' }
    | { name: 'logs'; task: string; stream: 'stdout' | 'stderr' | undefined }
    | { name: 'runs'; task: string }
    | { name: 'find'; query: string }
    | { name: 'goto'; target: { kind: 'row'; row: number } | { kind: 'percent'; percent: number } }
    | { name: 'save'; file: string | undefined; force: boolean }
    | { name: 'refresh' }
    | { name: 'help' }
    | { name: 'about' }
    | { name: 'quit'; force: boolean }
    | { name: 'tag'; tag: string }
    | { name: 'add'; key: string | undefined }
    | { name: 'remove'; force: boolean }
    | { name: 'apply' }
    | { name: 'discard'; then: string | undefined }
    | { name: 'reload' };

export type CommandName = ParsedCommand['name'];

/** A parse failure. */
export interface ParseError {
    error: string;
}

/** The result of {@link parseCommand}. */
export type ParseResult = { ok: true; command: ParsedCommand } | { ok: false; error: string };

/** Every command name, with its argument summary and one-line effect (the help view and completion). */
export const COMMANDS: readonly { name: CommandName; usage: string; effect: string }[] = [
    { name: 'task', usage: '/task <name>', effect: 'open a task' },
    { name: 'input', usage: '/input <name>', effect: 'open an input' },
    { name: 'dataset', usage: '/dataset <path>', effect: 'open a dataset by path' },
    { name: 'workspace', usage: '/workspace <name>', effect: 'switch workspace' },
    { name: 'workspaces', usage: '/workspaces', effect: 'list the workspaces' },
    { name: 'repos', usage: '/repos', effect: 'list the repositories' },
    { name: 'repo', usage: '/repo <path|url>', effect: 'open another repo' },
    { name: 'login', usage: '/login <url>', effect: 'device-flow login' },
    { name: 'run', usage: '/run [--force] [--filter g]', effect: 'run the dataflow' },
    { name: 'stop', usage: '/stop', effect: 'cancel the dataflow' },
    { name: 'logs', usage: '/logs <task> [stderr]', effect: 'open a task\'s logs' },
    { name: 'runs', usage: '/runs <task>', effect: 'open a task\'s runs' },
    { name: 'find', usage: '/find <key|prefix|f1|f2>', effect: 'jump to key' },
    { name: 'goto', usage: '/goto <row|N%>', effect: 'jump to row' },
    { name: 'save', usage: '/save [file]', effect: 'write .beast2 / .log' },
    { name: 'tag', usage: '/tag <name>', effect: 'switch a variant tag' },
    { name: 'add', usage: '/add [key]', effect: 'add an item / entry' },
    { name: 'remove', usage: '/remove', effect: 'remove the item' },
    { name: 'apply', usage: '/apply', effect: 'apply pending edits' },
    { name: 'discard', usage: '/discard', effect: 'discard pending edits' },
    { name: 'refresh', usage: '/refresh', effect: 'poll everything now' },
    { name: 'help', usage: '/help', effect: 'this help' },
    { name: 'about', usage: '/about', effect: 'version · server · logo' },
    { name: 'quit', usage: '/quit', effect: 'exit' },
];

/** Splits a command line into words, honouring double quotes. */
export function splitWords(text: string): string[] {
    const words: string[] = [];
    let current = '';
    let quoted = false;
    let had = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]!;
        if (ch === '"') {
            quoted = !quoted;
            had = true;
            continue;
        }
        if (!quoted && /\s/.test(ch)) {
            if (current !== '' || had) words.push(current);
            current = '';
            had = false;
            continue;
        }
        current += ch;
    }
    if (current !== '' || had) words.push(current);
    return words;
}

/** Whether a word is one of the command names. */
export function isCommandName(word: string): word is CommandName {
    return COMMANDS.some(c => c.name === word);
}

/**
 * Parses a command line (with or without the leading `/`).
 *
 * @param text - The text in the command box
 * @returns The parsed command, or the error to show
 */
export function parseCommand(text: string): ParseResult {
    const trimmed = text.trim();
    const body = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
    const words = splitWords(body);
    const name = words[0] ?? '';
    const args = words.slice(1);
    const fail = (error: string): ParseResult => ({ ok: false, error });
    const need = (what: string): ParseResult => fail(`${what} required — ${COMMANDS.find(c => c.name === name)?.usage ?? `/${name}`}`);
    switch (name) {
        case '':
            return fail('type a command after /');
        case 'task':
        case 'input':
        case 'dataset':
        case 'workspace':
        case 'repo': {
            const target = args[0];
            if (target === undefined) return need(name === 'dataset' ? 'a path' : name === 'repo' ? 'a path or url' : 'a name');
            return { ok: true, command: { name, target } };
        }
        case 'workspaces':
        case 'repos':
        case 'stop':
        case 'refresh':
        case 'help':
        case 'about':
        case 'apply':
        case 'reload':
            return { ok: true, command: { name } };
        case 'discard':
            return { ok: true, command: { name, then: args[0] === '--then' ? args.slice(1).join(' ') : undefined } };
        case 'quit':
            return { ok: true, command: { name, force: args.includes('--force') } };
        case 'login': {
            const url = args[0];
            if (url === undefined) return need('a server url');
            if (!/^https?:\/\//.test(url)) return fail(`/login needs an http(s) url, got ${url}`);
            return { ok: true, command: { name, url } };
        }
        case 'run': {
            let force = false;
            let filter: string | undefined;
            let concurrency: number | undefined;
            for (let i = 0; i < args.length; i++) {
                const a = args[i]!;
                if (a === '--force') force = true;
                else if (a === '--filter') {
                    filter = args[++i];
                    if (filter === undefined) return fail('--filter needs a glob');
                } else if (a.startsWith('--filter=')) filter = a.slice('--filter='.length);
                else if (a === '--concurrency' || a.startsWith('--concurrency=')) {
                    const raw = a === '--concurrency' ? args[++i] : a.slice('--concurrency='.length);
                    const n = Number(raw);
                    if (raw === undefined || !Number.isInteger(n) || n < 1) return fail(`--concurrency must be a positive integer, got ${raw ?? '(nothing)'}`);
                    concurrency = n;
                } else return fail(`unknown /run flag ${a} — /run [--force] [--filter <glob>] [--concurrency <n>]`);
            }
            return { ok: true, command: { name, force, filter, concurrency } };
        }
        case 'logs': {
            const task = args[0];
            if (task === undefined) return need('a task');
            const stream = args[1];
            if (stream !== undefined && stream !== 'stdout' && stream !== 'stderr') return fail(`stream must be stdout or stderr, got ${stream}`);
            return { ok: true, command: { name, task, stream } };
        }
        case 'runs': {
            const task = args[0];
            if (task === undefined) return need('a task');
            return { ok: true, command: { name, task } };
        }
        case 'find': {
            const query = body.slice(body.indexOf('find') + 4).trim();
            if (query === '') return need('a key, prefix or f1|f2 fields');
            return { ok: true, command: { name, query } };
        }
        case 'goto': {
            const target = args[0];
            if (target === undefined) return need('a row or N%');
            if (target.endsWith('%')) {
                const percent = Number(target.slice(0, -1));
                if (!Number.isFinite(percent) || percent < 0 || percent > 100) return fail(`/goto percent must be 0–100, got ${target}`);
                return { ok: true, command: { name, target: { kind: 'percent', percent } } };
            }
            const row = Number(target.replace(/[,_]/g, ''));
            if (!Number.isInteger(row) || row < 1) return fail(`/goto needs a row number (1-based) or N%, got ${target}`);
            return { ok: true, command: { name, target: { kind: 'row', row } } };
        }
        case 'save': {
            const force = args.includes('--force');
            const file = args.find(a => a !== '--force');
            return { ok: true, command: { name, file, force } };
        }
        case 'tag': {
            const tag = args[0];
            if (tag === undefined) return need('a tag');
            return { ok: true, command: { name, tag } };
        }
        case 'add':
            return { ok: true, command: { name, key: args[0] } };
        case 'remove':
            return { ok: true, command: { name, force: args.includes('--force') } };
        default:
            return fail(`unknown command /${name} — ? for help`);
    }
}

/** What {@link describe} needs to spell a consequence. */
export interface DescribeContext {
    /** The open workspace. */
    workspace: string | null;
    /** Tasks in the workspace. */
    taskCount: number;
    /** Whether a run is in progress. */
    running: boolean;
    /** The default concurrency. */
    concurrency: number;
    /** Pending edits. */
    dirty: number;
}

/**
 * The consequence line the command box shows for a parsed command
 * (`run 6 tasks in main, ignoring the cache · concurrency 4`).
 *
 * @param command - The parsed command
 * @param ctx - The context
 * @returns The line, and the key hint (`⏎ run · esc`)
 */
export function describe(command: ParsedCommand, ctx: DescribeContext): { text: string; keys: string } {
    const ws = ctx.workspace ?? '?';
    switch (command.name) {
        case 'run': {
            const scope = command.filter !== undefined ? `tasks matching ${command.filter}` : `${ctx.taskCount} task${ctx.taskCount === 1 ? '' : 's'}`;
            const cache = command.force ? ', ignoring the cache' : '';
            const conc = command.concurrency ?? ctx.concurrency;
            return { text: ctx.running ? 'a run is already in progress' : `run ${scope} in ${ws}${cache} · concurrency ${conc}`, keys: ctx.running ? 'esc' : '⏎ run · esc' };
        }
        case 'stop':
            return { text: ctx.running ? `cancel the run in ${ws}` : 'no run in progress', keys: ctx.running ? '⏎ stop · esc' : 'esc' };
        case 'task': return { text: `open task ${command.target}`, keys: '⏎ open · esc' };
        case 'input': return { text: `open input ${command.target}`, keys: '⏎ open · esc' };
        case 'dataset': return { text: `open dataset ${command.target}`, keys: '⏎ open · esc' };
        case 'workspace': return { text: `switch to workspace ${command.target}`, keys: '⏎ switch · esc' };
        case 'workspaces': return { text: 'list the workspaces', keys: '⏎ · esc' };
        case 'repos': return { text: 'list the repositories', keys: '⏎ · esc' };
        case 'repo': return { text: `open ${command.target}${ctx.dirty > 0 ? ` · ${ctx.dirty} unsaved edits are discarded` : ''}`, keys: '⏎ open · esc' };
        case 'login': return { text: 'run the device-flow login', keys: '⏎ login · esc' };
        case 'logs': return { text: `open ${command.task} logs${command.stream !== undefined ? ` (${command.stream})` : ''}`, keys: '⏎ open · esc' };
        case 'runs': return { text: `open ${command.task} runs`, keys: '⏎ open · esc' };
        case 'find': return { text: `find ${command.query}`, keys: '⏎ jump · esc' };
        case 'goto': return { text: command.target.kind === 'row' ? `go to row ${command.target.row.toLocaleString()}` : `go to ${command.target.percent}%`, keys: '⏎ jump · esc' };
        case 'save': return { text: `save${command.file !== undefined ? ` to ${command.file}` : ''}${command.force ? ' (overwrite)' : ''}`, keys: '⏎ save · esc' };
        case 'refresh': return { text: 'poll every feed now', keys: '⏎ · esc' };
        case 'help': return { text: 'open help', keys: '⏎ · esc' };
        case 'about': return { text: 'about e3-ui', keys: '⏎ · esc' };
        case 'quit': return { text: ctx.dirty > 0 && !command.force ? `quit with ${ctx.dirty} unsaved edit${ctx.dirty === 1 ? '' : 's'}` : 'quit', keys: '⏎ quit · esc' };
        case 'tag': return { text: `switch to ${command.tag}`, keys: '⏎ · esc' };
        case 'add': return { text: command.key !== undefined ? `add entry ${command.key}` : 'add an item', keys: '⏎ add · esc' };
        case 'remove': return { text: 'remove the selected item', keys: '⏎ remove · esc' };
        case 'apply': return { text: `apply ${ctx.dirty} pending edit${ctx.dirty === 1 ? '' : 's'}`, keys: '⏎ apply · esc' };
        case 'discard': return { text: `discard ${ctx.dirty} pending edit${ctx.dirty === 1 ? '' : 's'}${command.then !== undefined ? ` then ${command.then}` : ''}`, keys: '⏎ discard · esc' };
        case 'reload': return { text: 'reload the value and re-apply your edits', keys: '⏎ reload · esc' };
    }
}

/**
 * The command a single-key hotkey prefills (`r` → `/run `, `x` → `/stop`,
 * `w` → `/workspaces`, `s` → `/save`, `t` → `/tag `).
 *
 * @param key - The key
 * @returns The command text, or undefined
 */
export function hotkeyToCommand(key: string): string | undefined {
    switch (key) {
        case 'r': return '/run ';
        case 'x': return '/stop';
        case 'w': return '/workspaces';
        case 's': return '/save';
        case 't': return '/tag ';
        default: return undefined;
    }
}

/** The flags `/run` accepts and their one-line hints, for the hint bar. */
export const RUN_FLAGS: readonly { flag: string; hint: string }[] = [
    { flag: '--force', hint: 're-run everything' },
    { flag: '--filter <glob>', hint: 'only matching tasks' },
    { flag: '--concurrency <n>', hint: '' },
];
