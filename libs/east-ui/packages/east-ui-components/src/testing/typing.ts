/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Keys as a loaded machine sends them (east-workspace#1779) — a test runner
 * on a busy CI box. The work each key starts leaves the event loop
 * {@link LOADED_MS} behind, so the next key's timer is due before React's
 * later work for the key before it, in every run. A box whose
 * text React holds and Zag writes from it is typed into here to show that it
 * loses no key (`commitTypedText`): typed so, a box that commits its text
 * later loses one each time.
 *
 * Shared through `@elaraai/east-ui-components/testing` with the sibling
 * renderer packages' tests (the Sheet's editor): a DOM and no test framework.
 *
 * @packageDocumentation
 */

/** How long each key's work keeps the machine busy, ms: past the millisecond a test's next key waits. */
export const LOADED_MS = 5;

/**
 * Runs `type` — the keys a test types into `input` — as a loaded machine sends them (see the module docs).
 *
 * @param input - The box the keys are typed into
 * @param type - Types them: a user-event `type` or `keyboard` call
 * @returns What `type` returns
 */
export async function underLoad<T>(input: HTMLElement, type: () => Promise<T>): Promise<T> {
    const busy = (): void => {
        queueMicrotask(() => {
            const until = performance.now() + LOADED_MS;
            while (performance.now() < until) { /* the machine is busy */ }
        });
    };
    input.addEventListener("input", busy);
    try {
        return await type();
    } finally {
        input.removeEventListener("input", busy);
    }
}
