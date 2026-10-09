/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The async providers' in-flight registry (`Sheet Spec.md` §5 row 11): every
 * run of the copilot opens a generation; a settlement is delivered only while
 * its generation is current — a newer context cancels the wait (latest wins),
 * and a cancelled result is dropped, never landed. A rejected or thrown
 * provider is skipped with a diagnostic naming the column (the runner's
 * memoised promise carries the diagnostic; here the settlement just lands as
 * nothing).
 *
 * @packageDocumentation
 */

import type { AsyncWork, AsyncResult } from "./suggest.js";

/** The in-flight registry — one generation at a time. */
export class InFlight {
    private gen = 0;
    /** Open a new generation: everything still in flight is superseded. */
    begin(): number {
        this.gen += 1;
        return this.gen;
    }
    /** Whether a generation is still the current one. */
    isCurrent(gen: number): boolean {
        return gen === this.gen;
    }
    /** Supersede everything in flight. */
    cancel(): void {
        this.gen += 1;
    }
}

/**
 * Track one piece of async work: deliver its settlement under the generation
 * guard. The delivery callback runs after the promise settles, on a microtask.
 */
export function trackWork(
    inflight: InFlight,
    gen: number,
    work: AsyncWork,
    deliver: (key: string, result: AsyncResult) => void,
): void {
    void work.run().then(
        (result) => { if (inflight.isCurrent(gen)) deliver(work.key, result); },
        (err: unknown) => {
            console.error(`[Sheet] async provider on "${work.key}" failed:`, err);
            if (inflight.isCurrent(gen)) deliver(work.key, work.key === "rows" ? { kind: "rows", rows: [] } : { kind: "fill", fill: null });
        },
    );
}
