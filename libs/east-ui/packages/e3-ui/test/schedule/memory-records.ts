/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Record.bind`, in memory, for the `Schedule` specs: each record's handle
 * reads a fixed state, and its patch door commits at `state-1` — the handle the
 * record runtime builds, its methods plain functions.
 */

import { none, variant, type EastTypeValue } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { recordBindPlatformFn } from "@elaraai/e3-ui/internal";

/**
 * The platform a compiled function binds records through, each record's state by its name.
 *
 * @param states - Each record's state, by the record's name
 * @returns The `Record.bind` implementation, for `East.compile`'s platform
 */
export function memoryRecords(states: ReadonlyMap<string, unknown>): PlatformFunction[] {
    return [recordBindPlatformFn.implement((_handleType: EastTypeValue) => (nameArg: unknown) => {
        const name = nameArg as string;
        return {
            read: () => states.get(name),
            status: () => variant("up-to-date", null),
            history: () => none,
            mutate: { pending: () => false, status: () => variant("idle", null), error: () => none, cancel: () => null, patch: () => null },
            commit: { patch: async () => variant("committed", { commitHash: "commit-1", stateHash: "state-1" }) },
            start: () => null,
            binding: { name, mutations: ["patch"] },
        };
    })];
}
