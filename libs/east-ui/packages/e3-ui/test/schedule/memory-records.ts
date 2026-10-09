/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Record.bind` and `Data.bind`, in memory, for the `Schedule` and Plan specs:
 * each record's handle reads a fixed state, and its patch door commits at
 * `state-1`; each dataset's handle reads a fixed value — the handles the
 * runtimes build, their methods plain functions.
 */

import { none, variant, type EastTypeValue } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { bindPlatformFn, recordBindPlatformFn } from "@elaraai/e3-ui/internal";

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

/**
 * The platform a compiled function binds datasets through, each dataset's value by its name — the last field of its path.
 *
 * @param values - Each dataset's value, by the dataset's name
 * @returns The `Data.bind` implementation, for `East.compile`'s platform
 */
export function memoryData(values: ReadonlyMap<string, unknown>): PlatformFunction[] {
    return [bindPlatformFn.implement((_type: EastTypeValue) => (sourceArg: unknown, patch: unknown, mode: unknown) => {
        const source = sourceArg as readonly { type: string; value: string }[];
        const value = values.get(source[source.length - 1]!.value);
        return {
            read: () => value,
            write: () => null,
            writeAndStart: () => null,
            start: () => null,
            source: () => value,
            pending: () => false,
            commit: () => null,
            discard: () => null,
            has: () => true,
            status: () => variant("up-to-date", null),
            binding: { source, patch, mode },
        };
    })];
}
