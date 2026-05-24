/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * State platform function — browser-local key-value store with reactive tracking.
 *
 * `State.bind([T], key, defaultValue)` returns a struct of closures: `{ read, write, has }`.
 * Use inside `Reactive.Root` for reactive re-rendering when state changes.
 *
 * @packageDocumentation
 */

import { East, StringType, NullType, BooleanType, FunctionType, StructType } from "@elaraai/east";

/**
 * Bind to a browser-local state key, returning reactive accessors.
 *
 * @typeParam T - The East type of the state value
 * @param key - The state key
 * @param defaultValue - Initial value used if the key is not yet set
 * @returns A struct with `read`, `write`, and `has` closures
 *
 * @remarks
 * - On first bind, if the key is not yet set, it is initialized to `defaultValue`
 * - `read()` returns the current value and tracks the dependency for reactive updates
 * - `write(value)` writes to the state store
 * - `has()` checks if the key exists (always true after the first bind)
 *
 * Implementation provided by `StateImpl` in `@elaraai/east-ui-components`.
 *
 * @example
 * ```ts
 * import { State, Reactive, Text } from "@elaraai/east-ui";
 * import { East, IntegerType } from "@elaraai/east";
 *
 * Reactive.Root($ => {
 *     const counter = $(State.bind([IntegerType], "clickCount", 0n));
 *     const count = $(counter.read());
 *     return Text.Root(East.str`Count: ${count}`);
 * });
 * ```
 */
const state_bind = East.genericPlatform("state_bind", ["T"], [StringType, "T"],
    StructType({
        read: FunctionType([], "T"),
        write: FunctionType(["T"], NullType),
        has: FunctionType([], BooleanType),
    }),
    { optional: true }
);

/**
 * State management platform functions for East UI.
 *
 * @example
 * ```ts
 * import { State } from "@elaraai/east-ui";
 * import { IntegerType } from "@elaraai/east";
 *
 * const counter = $(State.bind([IntegerType], "myKey", 0n));
 * const value = $(counter.read());
 * $(counter.write(value.add(1n)));
 * ```
 */
export const State = {
    bind: state_bind,
} as const;
