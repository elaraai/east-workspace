/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Data platform function — workspace-scoped e3 dataset binding.
 *
 * `Data.bind([T], path)` returns a struct of closures: `{ read, write, has }`.
 * The workspace is resolved at runtime from the DataProvider context.
 *
 * @packageDocumentation
 */

import { East, NullType, BooleanType, FunctionType, StructType } from '@elaraai/east';
import { TreePathType } from '@elaraai/e3-types';

/**
 * Bind to an e3 dataset by path, returning reactive accessors.
 *
 * @typeParam T - The East type of the dataset value
 * @param path - The dataset path (e.g., `threshold.path` from a DatasetDef)
 * @returns A struct with `read`, `write`, and `has` closures
 *
 * @remarks
 * - `read()` returns the current value and tracks the dependency for reactive updates
 * - `write(value)` writes to the dataset (async, via e3 API)
 * - `has()` checks if the dataset has a value
 *
 * The workspace is resolved from the `DataProvider` context at runtime.
 * Use inside `Reactive.Root` for reactive re-rendering when the dataset changes.
 *
 * @example
 * ```ts
 * import { Data } from '@elaraai/e3-ui';
 * import { Reactive, Slider } from '@elaraai/east-ui';
 * import { East, FloatType, NullType } from '@elaraai/east';
 *
 * Reactive.Root($ => {
 *     const thresh = $(Data.bind([FloatType], threshold.path));
 *     const value = $(thresh.read());
 *     return Slider.Root(value, { onChange: thresh.write });
 * });
 * ```
 */
const data_bind = East.genericPlatform("data_bind", ["T"], [TreePathType],
  StructType({
    read: FunctionType([], "T"),
    write: FunctionType(["T"], NullType),
    has: FunctionType([], BooleanType),
  })
);

/**
 * Data platform functions for e3 dataset bindings.
 *
 * @example
 * ```ts
 * import { Data } from '@elaraai/e3-ui';
 *
 * const thresh = $(Data.bind([FloatType], threshold.path));
 * const value = $(thresh.read());
 * $(thresh.write(newValue));
 * ```
 */
export const Data = {
  bind: data_bind,
} as const;
