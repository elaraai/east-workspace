/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * State platform function — browser-local key-value store with reactive tracking.
 *
 * `State.bind([T], key)` returns a struct of closures: `{ read, write, has }`.
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
 * @returns A struct with `read`, `write`, and `has` closures
 *
 * @remarks
 * - `read()` returns the current value and tracks the dependency for reactive updates
 * - `write(value)` writes to the state store
 * - `has()` checks if the key exists
 *
 * Implementation provided by `StateImpl` in `@elaraai/east-ui-components`.
 *
 * @example
 * ```ts
 * import { State, Reactive, Text } from "@elaraai/east-ui";
 * import { East, IntegerType, NullType } from "@elaraai/east";
 *
 * Reactive.Root($ => {
 *     const counter = $(State.bind([IntegerType], "clickCount"));
 *     const count = $(counter.read());
 *     return Text.Root(East.str`Count: ${count}`);
 * });
 * ```
 */
const state_bind = East.genericPlatform("state_bind", ["T"], [StringType],
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
 * const counter = $(State.bind([IntegerType], "myKey"));
 * const value = $(counter.read());
 * $(counter.write(value.add(1n)));
 * ```
 */
export const State = {
    bind: state_bind,
} as const;
