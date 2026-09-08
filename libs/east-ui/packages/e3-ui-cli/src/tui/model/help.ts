/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The help view's content — one tab per page (plus what works everywhere),
 * so the commands and keys listed are exactly the ones that work where you
 * are. `?` opens the tab of the page it was pressed on.
 *
 * @packageDocumentation
 */

import type { HelpTab, ViewKind } from '../state/actions.js';

/** A help column: a heading and `[key, effect]` rows. */
export interface HelpColumn {
    title: string;
    rows: [string, string][];
}

/** The tabs in order, with their labels. */
export const HELP_TABS: readonly { tab: HelpTab; label: string }[] = [
    { tab: 'everywhere', label: 'Everywhere' },
    { tab: 'repos', label: 'Repos' },
    { tab: 'workspaces', label: 'Workspaces' },
    { tab: 'dashboard', label: 'Dashboard' },
    { tab: 'task', label: 'Task' },
    { tab: 'input', label: 'Input' },
];

/**
 * The help tab a page opens on.
 *
 * @param from - The page `?` was pressed on
 * @returns Its tab (`everywhere` for the launch / refusal / help / about screens)
 */
export function helpTabFor(from: ViewKind): HelpTab {
    switch (from) {
        case 'repos': return 'repos';
        case 'workspaces': return 'workspaces';
        case 'dashboard': return 'dashboard';
        case 'task': return 'task';
        case 'input': return 'input';
        default: return 'everywhere';
    }
}

/**
 * The columns of a help tab.
 *
 * @param tab - The tab
 * @returns Three columns (some may be empty)
 */
export function helpColumns(tab: HelpTab): HelpColumn[] {
    switch (tab) {
        case 'everywhere':
            return [
                {
                    title: 'COMMANDS',
                    rows: [
                        ['/task <name>', 'open a task'],
                        ['/input <name>', 'open an input'],
                        ['/dataset <path>', 'open a dataset'],
                        ['/workspace <name>', 'switch workspace'],
                        ['/workspaces  /repos', 'the lists'],
                        ['/repo <path|url>', 'open another repo'],
                        ['/login <url>', 'device-flow login'],
                        ['/refresh', 'poll everything now'],
                        ['/help  /about  /quit', ''],
                        ['', ''],
                        ['typing without /', 'fuzzy-jumps anywhere'],
                    ],
                },
                {
                    title: 'KEYS',
                    rows: [
                        ['?', 'help for this page'],
                        ['q  ^c', 'quit'],
                        ['esc  ⌫', 'back'],
                        ['tab  ⇧tab', 'next / prev pane'],
                        ['1 2 3 …', 'tabs'],
                        ['R', 'refresh now'],
                        ['/', 'a command'],
                        ['↑↓  j k', 'move'],
                        ['pgup pgdn  ^u ^d', 'page'],
                        ['gg  G', 'top / bottom'],
                    ],
                },
                {
                    title: 'MOUSE',
                    rows: [
                        ['wheel', 'scroll'],
                        ['click', 'select'],
                        ['click ▸', 'toggle'],
                        ['drag ▮', 'scrollbar'],
                        ['click tab / crumb', 'act'],
                        ['', ''],
                        ['--no-mouse', 'keyboard only'],
                    ],
                },
            ];
        case 'repos':
            return [
                { title: 'COMMANDS', rows: [['/repo <name>', 'open a repository'], ['/login <url>', 'device-flow login'], ['/refresh', 'poll now']] },
                { title: 'KEYS', rows: [['↑↓  j k', 'move'], ['⏎  →', 'open the repository'], ['q', 'quit']] },
                { title: '', rows: [] },
            ];
        case 'workspaces':
            return [
                { title: 'COMMANDS', rows: [['/workspace <name>', 'open a workspace'], ['/repos', 'back to the repositories'], ['/refresh', 'poll now']] },
                { title: 'KEYS', rows: [['↑↓  j k', 'move'], ['⏎  →', 'open the workspace'], ['q', 'quit']] },
                { title: '', rows: [] },
            ];
        case 'dashboard':
            return [
                {
                    title: 'COMMANDS',
                    rows: [
                        ['/run [--force]', 'run the dataflow'],
                        ['/run --filter <glob>', 'only matching tasks'],
                        ['/run --concurrency <n>', ''],
                        ['/stop', 'cancel the dataflow'],
                        ['/task  /input', 'open a row'],
                        ['/logs <task> [stderr]', 'a task\'s logs'],
                        ['/runs <task>', 'a task\'s runs'],
                        ['/workspace <name>', 'switch workspace'],
                    ],
                },
                {
                    title: 'KEYS',
                    rows: [
                        ['↑↓  j k', 'move'],
                        ['⏎  →', 'open the task / input'],
                        ['r', 'prefill /run'],
                        ['x', 'prefill /stop'],
                        ['w', 'workspaces'],
                        ['R', 'refresh now'],
                    ],
                },
                { title: 'ROWS', rows: [['tasks', '● up-to-date ◐ waiting ◔ running'], ['', '○ ready ✗ failed'], ['inputs', '● up-to-date ◐ stale ○ unset'], ['execution', '⏎ on a failed row → logs']] },
            ];
        case 'task':
            return [
                {
                    title: 'COMMANDS',
                    rows: [
                        ['/find <"key">', 'exact key'],
                        ['/find <prefix>', 'key prefix'],
                        ['/find f1|f2', 'struct-key fields'],
                        ['/goto <row>  /goto N%', 'jump'],
                        ['/save [file]', 'write .beast2 / .log'],
                        ['/logs [stderr]  /runs', 'switch tab'],
                    ],
                },
                {
                    title: 'KEYS · VALUE TREE',
                    rows: [
                        ['↑↓  j k', 'move'],
                        ['→  l', 'expand'],
                        ['←  h', 'collapse'],
                        ['⏎  space', 'toggle'],
                        ['⇧←', 'collapse subtree'],
                        ['pgup pgdn  ^u ^d', 'page'],
                        ['gg  G', 'top / bottom'],
                        ['n  N', 'next / prev match'],
                        ['s', 'save .beast2'],
                        ['1 2 3 4', 'Output Logs Runs Reads'],
                    ],
                },
                {
                    title: 'KEYS · LOGS',
                    rows: [
                        ['↑↓  pgup pgdn', 'scroll'],
                        ['G', 'end'],
                        ['F', 'follow the tail'],
                        ['o  e', 'stdout / stderr'],
                        ['n  N', 'next / prev match'],
                        ['s', 'save .log'],
                        ['c', 'copy'],
                        ['', ''],
                        ['KEYS · RUNS', ''],
                        ['⏎', 'expand the inputs'],
                    ],
                },
            ];
        case 'input':
            return [
                {
                    title: 'COMMANDS',
                    rows: [
                        ['/tag <name>', 'switch a variant tag'],
                        ['/tag some  /tag none', 'set / clear an option'],
                        ['/add [key]', 'add an item / entry'],
                        ['/remove', 'remove the item'],
                        ['/apply  /discard', 'the pending edits'],
                        ['/find  /goto', 'as in a task'],
                    ],
                },
                {
                    title: 'KEYS',
                    rows: [
                        ['e', 'edit the leaf'],
                        ['a', 'add'],
                        ['x', 'remove'],
                        ['t', 'tag / set / clear'],
                        ['⏎', 'apply all'],
                        ['esc', 'discard'],
                        ['↑↓  → ←', 'move / expand / collapse'],
                    ],
                },
                {
                    title: 'EDITING',
                    rows: [
                        ['⏎', 'commit the leaf'],
                        ['esc', 'cancel the leaf'],
                        ['space', 'toggle a boolean'],
                        ['', ''],
                        ['◆ N DIRTY', 'the header pill'],
                        ['┆', 'a changed row'],
                        ['conflict', 'the server changed:'],
                        ['', '⏎ reload · esc keep'],
                    ],
                },
            ];
    }
}
