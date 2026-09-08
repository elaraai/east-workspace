/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pollers — one per data feed, with an interval, an `AbortController`, at
 * most one request in flight, and exponential backoff on consecutive
 * failures (1 → 2 → 4 → 8 → 15 s). A feed runs only while a view that needs
 * it is mounted; the header's connection pill derives from the newest
 * results across the running pollers ({@link connectionState}).
 *
 * @packageDocumentation
 */

/** The backoff ladder after consecutive failures, in milliseconds. */
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;

/** Failures before the pill reads offline (the ladder's length). */
export const OFFLINE_AFTER = BACKOFF_MS.length;

/** The timer surface a poller schedules with (injectable for tests). */
export interface PollClock {
    now(): number;
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

/** The real timers. */
export const realClock: PollClock = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => {
        const handle = setTimeout(fn, ms);
        (handle as { unref?: () => void }).unref?.();
        return handle;
    },
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** What a poller is built from. */
export interface PollerConfig<T> {
    /** A name for diagnostics. */
    key: string;
    /** The steady-state interval between successful runs, in milliseconds. */
    intervalMs: number;
    /** The request; `signal` aborts when the poller stops or is superseded. */
    run: (signal: AbortSignal) => Promise<T>;
    /** Receives each successful result. */
    onResult: (result: T) => void;
    /** Receives each failure (after which the backoff applies). */
    onError?: ((error: unknown, failures: number) => void) | undefined;
    /** Timers (default: the real ones). */
    clock?: PollClock | undefined;
}

/** A poller's observable state. */
export interface PollerStatus {
    key: string;
    running: boolean;
    inFlight: boolean;
    /** Consecutive failures since the last success. */
    failures: number;
    /** Epoch milliseconds of the last success, or null. */
    lastOkAt: number | null;
    /** Epoch milliseconds of the last attempt (success or failure), or null. */
    lastAttemptAt: number | null;
}

/** A running feed. */
export interface Poller {
    /** Starts polling (the first run is immediate). No-op when running. */
    start(): void;
    /** Stops polling and aborts the request in flight. */
    stop(): void;
    /** Pauses without discarding state (a later `resume` continues). */
    pause(): void;
    /** Resumes a paused poller with an immediate run. */
    resume(): void;
    /** Runs now, regardless of the schedule (a superseded request is ignored). */
    fireNow(): void;
    /** Changes the steady-state interval (takes effect at the next schedule). */
    setInterval(ms: number): void;
    /** The current status. */
    status(): PollerStatus;
}

/**
 * Creates a poller.
 *
 * @typeParam T - The result type
 * @param config - The feed
 * @returns The poller (not started)
 */
export function createPoller<T>(config: PollerConfig<T>): Poller {
    const clock = config.clock ?? realClock;
    let intervalMs = config.intervalMs;
    let running = false;
    let paused = false;
    let inFlight = false;
    let failures = 0;
    let lastOkAt: number | null = null;
    let lastAttemptAt: number | null = null;
    let timer: unknown = undefined;
    let controller: AbortController | null = null;
    let generation = 0;

    const clearTimer = (): void => {
        if (timer !== undefined) {
            clock.clearTimeout(timer);
            timer = undefined;
        }
    };

    const schedule = (ms: number): void => {
        clearTimer();
        if (!running || paused) return;
        timer = clock.setTimeout(() => {
            timer = undefined;
            void tick();
        }, ms);
    };

    const tick = async (): Promise<void> => {
        if (!running || paused) return;
        if (inFlight) return;
        inFlight = true;
        const myGeneration = ++generation;
        controller = new AbortController();
        const signal = controller.signal;
        lastAttemptAt = clock.now();
        try {
            const result = await config.run(signal);
            if (myGeneration !== generation || signal.aborted) return;
            inFlight = false;
            failures = 0;
            lastOkAt = clock.now();
            config.onResult(result);
            schedule(intervalMs);
        } catch (error) {
            if (myGeneration !== generation || signal.aborted) return;
            inFlight = false;
            failures += 1;
            config.onError?.(error, failures);
            schedule(BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]!);
        }
    };

    const abortInFlight = (): void => {
        if (controller !== null) {
            controller.abort();
            controller = null;
        }
        inFlight = false;
        generation += 1;
    };

    return {
        start() {
            if (running) return;
            running = true;
            paused = false;
            void tick();
        },
        stop() {
            running = false;
            paused = false;
            clearTimer();
            abortInFlight();
        },
        pause() {
            if (!running) return;
            paused = true;
            clearTimer();
            abortInFlight();
        },
        resume() {
            if (!running || !paused) return;
            paused = false;
            void tick();
        },
        fireNow() {
            if (!running || paused) return;
            clearTimer();
            abortInFlight();
            void tick();
        },
        setInterval(ms: number) {
            intervalMs = ms;
        },
        status(): PollerStatus {
            return { key: config.key, running: running && !paused, inFlight, failures, lastOkAt, lastAttemptAt };
        },
    };
}

/** The header pill's connection state. */
export type ConnectionState =
    | { kind: 'idle' }
    | { kind: 'connected' }
    | { kind: 'reconnecting'; attempt: number; of: number }
    | { kind: 'offline' };

/**
 * Derives the connection pill from the running pollers: connected while the
 * most recently attempted poller succeeded, reconnecting `n/of` after
 * consecutive failures, offline once the backoff ladder is exhausted.
 *
 * @param pollers - The pollers (their statuses are read)
 * @returns The connection state (`idle` with no running poller)
 */
export function connectionState(pollers: readonly Pick<Poller, 'status'>[]): ConnectionState {
    const statuses = pollers.map(p => p.status()).filter(s => s.running && s.lastAttemptAt !== null);
    if (statuses.length === 0) return { kind: 'idle' };
    const worst = Math.max(...statuses.map(s => s.failures));
    if (worst === 0) return { kind: 'connected' };
    if (worst >= OFFLINE_AFTER) return { kind: 'offline' };
    return { kind: 'reconnecting', attempt: worst, of: OFFLINE_AFTER - 1 };
}
