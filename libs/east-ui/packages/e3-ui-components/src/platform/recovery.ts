/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How a view whose read failed tries it again by itself.
 *
 * @remarks
 * A view on a screen no one touches, such as a kiosk's, has no one to reload
 * it, so a read the view depends on is tried again after it fails, for as long
 * as the view is mounted. The waits back off from 1 s to 30 s, and each is drawn
 * at random from the second half of its own, so views that failed together,
 * such as a fleet of kiosks behind one server, do not try again together.
 *
 * @packageDocumentation
 */

import { useEffect, useRef } from "react";
import type { QueryObserverResult } from "@tanstack/react-query";

/** The most a view waits before it tries a read again after its first
 *  failure; each failure in a row doubles it, up to {@link RECOVERY_MAX_MS}. */
export const RECOVERY_FIRST_MS = 1_000;

/** The most a view waits before it tries a read again. */
export const RECOVERY_MAX_MS = 30_000;

/**
 * How long a view waits before it tries a failed read again.
 *
 * @remarks
 * The wait backs off: at most 1 s after the first failure in a row, doubling
 * with each failure after it, up to 30 s. It is a random point in the second
 * half of that: 0.5–1 s after the first failure, 1–2 s after the second, and
 * 15–30 s from the sixth on. So views that failed together try again apart,
 * and none tries again sooner than half its backoff.
 *
 * @param failures - How many times in a row the read has failed, from 1
 * @param random - A draw from [0, 1); `Math.random` unless a test gives one
 * @returns The wait, in milliseconds
 */
export function recoveryDelay(failures: number, random: () => number = Math.random): number {
    const most = Math.min(RECOVERY_FIRST_MS * 2 ** Math.max(0, failures - 1), RECOVERY_MAX_MS);
    return Math.round((most / 2) * (1 + random()));
}

/** What {@link useQueryRecovery} reads of a query, as `useQuery` returns it. */
export type RecoveringQuery = Pick<
    QueryObserverResult<unknown, Error>,
    "error" | "errorUpdatedAt" | "dataUpdatedAt" | "fetchStatus" | "refetch"
>;

/** The failures of a query in a row, each counted once, by when it failed,
 *  and the latest of them. */
interface Streak {
    readonly failures: number;
    readonly at: number;
    readonly latest: Error | null;
}

const NO_STREAK: Streak = { failures: 0, at: 0, latest: null };

/**
 * Tries a failed query again by itself, for as long as the view is mounted,
 * and gives the failure to show meanwhile.
 *
 * @remarks
 * A query that failed fetches again only when the window regains focus or the
 * view mounts again, so a view on a screen no one touches would stay on the
 * failure. This fetches it again after {@link recoveryDelay}'s wait for each
 * failure in a row, once the query has stopped fetching.
 *
 * TanStack clears the error of a query that holds no data while it fetches
 * again, so a view that showed the query's error would go back to loading at
 * every try. The failure this gives stands until a fetch reads: the latest,
 * through each try.
 *
 * @param query - The query to keep trying while it fails
 * @returns The failure to show, or `null` while the query has not failed since
 *   it last read
 */
export function useQueryRecovery(query: RecoveringQuery): Error | null {
    const { error, errorUpdatedAt, dataUpdatedAt, fetchStatus, refetch } = query;
    // Whether the query has failed since it last read: a try in flight, which
    // TanStack shows with no error, does not end that.
    const failing = errorUpdatedAt > dataUpdatedAt;
    const streak = useRef<Streak>(NO_STREAK);
    useEffect(() => {
        if (!failing) {
            streak.current = NO_STREAK;
            return;
        }
        if (error === null || fetchStatus !== "idle") return;
        // An effect that runs again for the same failure backs off no further.
        if (streak.current.at !== errorUpdatedAt) {
            streak.current = { failures: streak.current.failures + 1, at: errorUpdatedAt, latest: error };
        }
        const timer = setTimeout(() => {
            void refetch();
        }, recoveryDelay(streak.current.failures));
        return () => clearTimeout(timer);
    }, [failing, error, errorUpdatedAt, fetchStatus, refetch]);
    return error ?? (failing ? streak.current.latest : null);
}
