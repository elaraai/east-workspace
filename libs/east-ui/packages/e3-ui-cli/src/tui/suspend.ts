/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Terminal suspension for the device-flow login: the App registers Ink's
 * `suspendTerminal` here so the entry can hand the terminal to the login
 * flow (which prints a code and a URL and waits) and take it back.
 *
 * @packageDocumentation
 */

let current: ((fn: () => Promise<void>) => Promise<void>) | null = null;

/**
 * Registers the app's suspension function (from `useApp().suspendTerminal`).
 *
 * @param fn - The suspension function, or null on unmount
 */
export function registerSuspend(fn: ((fn: () => Promise<void>) => Promise<void>) | null): void {
    current = fn;
}

/**
 * Runs `fn` with the terminal handed over to it.
 *
 * @param fn - The work
 */
export async function suspendTerminal(fn: () => Promise<void>): Promise<void> {
    if (current === null) {
        await fn();
        return;
    }
    await current(fn);
}
