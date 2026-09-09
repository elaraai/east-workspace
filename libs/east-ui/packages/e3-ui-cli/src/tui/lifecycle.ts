/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Lifecycle — the process-level handlers the terminal UI installs:
 * SIGINT / SIGTERM / SIGHUP unmount cleanly (Ctrl-C is a key while the
 * UI runs, so SIGINT only arrives from outside), `uncaughtException` /
 * `unhandledRejection` restore the terminal first, then print the stack
 * and exit 70; and the `E3_UI_DEBUG=1` file logger, which never writes to
 * stdout or stderr while the UI owns the screen.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { statePath } from './state/persist.js';

/** The exit code for an unexpected failure (EX_SOFTWARE). */
export const EXIT_SOFTWARE = 70;

/** A line logger. */
export type Logger = (line: string) => void;

/**
 * The debug logger: appends to `$XDG_STATE_HOME/e3-ui/debug.log` (beside
 * the state file) when `E3_UI_DEBUG=1`, else a no-op.
 *
 * @param env - The environment
 * @returns The logger and the log path (null when disabled)
 */
export function createDebugLogger(env: NodeJS.ProcessEnv): { log: Logger; file: string | null } {
    if (env['E3_UI_DEBUG'] !== '1') return { log: () => undefined, file: null };
    const file = path.join(path.dirname(statePath(env, process.platform, os.homedir())), 'debug.log');
    let ready = false;
    const log: Logger = (line) => {
        try {
            if (!ready) {
                fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
                ready = true;
            }
            fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
        } catch {
            // The log must never take the UI down.
        }
    };
    return { log, file };
}

/** What the handlers call. */
export interface LifecycleHooks {
    /** A termination signal arrived: unmount and stop. */
    onSignal: (signal: NodeJS.Signals) => void;
    /** An unexpected error: the terminal is restored by the caller, then this reports it. */
    onFatal: (error: unknown) => void;
}

/**
 * Installs the process handlers.
 *
 * @param hooks - The callbacks
 * @returns A function that removes them
 */
export function installLifecycle(hooks: LifecycleHooks): () => void {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const onSignal = (signal: NodeJS.Signals): void => hooks.onSignal(signal);
    const onException = (error: unknown): void => hooks.onFatal(error);
    const onRejection = (reason: unknown): void => hooks.onFatal(reason);
    for (const signal of signals) process.on(signal, onSignal);
    process.on('uncaughtException', onException);
    process.on('unhandledRejection', onRejection);
    return () => {
        for (const signal of signals) process.off(signal, onSignal);
        process.off('uncaughtException', onException);
        process.off('unhandledRejection', onRejection);
    };
}

/**
 * The stack (or message) of an unexpected error, for stderr after the
 * terminal is restored.
 *
 * @param error - The error
 * @returns The text
 */
export function fatalText(error: unknown): string {
    if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
    return String(error);
}

/**
 * A one-line terminal description for the about view
 * (`kitty 0.36 · 120×36 · truecolor · mouse ● · kitty keyboard ○`).
 *
 * @param env - The environment
 * @param size - The terminal size
 * @param colorLevel - The colour level
 * @param mouse - Whether mouse reporting is on
 * @param glyphs - The glyphs for the dots
 * @returns The description
 */
export function describeTerminal(
    env: NodeJS.ProcessEnv,
    size: { columns: number; rows: number },
    colorLevel: number,
    mouse: boolean,
    glyphs: { dot: string; empty: string; sep: string },
): string {
    const program = env['TERM_PROGRAM'] ?? env['TERMINAL_EMULATOR'] ?? (env['TERM'] === 'xterm-kitty' ? 'kitty' : env['TERM'] ?? 'terminal');
    const version = env['TERM_PROGRAM_VERSION'] !== undefined ? ` ${env['TERM_PROGRAM_VERSION']}` : '';
    const colour = colorLevel >= 3 ? 'truecolor' : colorLevel === 2 ? '256 colours' : colorLevel === 1 ? '16 colours' : 'no colour';
    const on = (flag: boolean): string => (flag ? glyphs.dot : glyphs.empty);
    return `${program}${version} ${glyphs.sep} ${size.columns}×${size.rows} ${glyphs.sep} ${colour} ${glyphs.sep} mouse ${on(mouse)}`;
}
