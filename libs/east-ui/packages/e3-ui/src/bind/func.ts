/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Reactive function binding for e3 UI tasks — call a named package
 * function (`e3.function`) from East UI code, RPC-style.
 *
 * `Func.bind` is the function-shaped sibling of `Data.bind`: it returns a
 * handle whose `call` launches the workspace-scoped function
 * fire-and-forget from any sync UI callback, while `read` / `status` /
 * `error` / `pending` observe the call lifecycle reactively inside
 * `Reactive.Root`. See `libs/e3/design/e3-ui-functions.md`.
 *
 * @packageDocumentation
 */

import {
    East,
    ArrayType,
    BooleanType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    type EastType,
    type ExprType,
} from '@elaraai/east';
import type { FunctionDef } from '@elaraai/e3';

// ============================================================================
// Status + error types
// ============================================================================

/**
 * Tracked-call lifecycle for a bound function.
 *
 * @remarks
 * Client-defined — the sync-only function surface has no server-side call
 * state. `idle` means the function has never been launched through this
 * binding; `cancelled` means the client stopped waiting (via `cancel()` or
 * a superseding `call`) — the server still ran the call to completion or
 * its deadline.
 *
 * @property idle - Never launched
 * @property running - A call is in flight
 * @property succeeded - The most recent call returned a value (see `read`)
 * @property failed - The most recent call failed (see `error`)
 * @property cancelled - The client stopped waiting for the most recent call
 */
export const FuncStatusType = VariantType({
    idle:      NullType,
    running:   NullType,
    succeeded: NullType,
    failed:    NullType,
    cancelled: NullType,
});

/**
 * Type representing the FuncStatus structure.
 */
export type FuncStatusType = typeof FuncStatusType;

/**
 * Failure detail for a bound function call, mirroring the server's
 * `ExecuteResult` outcome arms plus client-side transport errors.
 *
 * @remarks
 * `stdout` / `stderr` ride along exactly as the server returns them
 * (already truncated server-side); they are empty for `transport`
 * failures, which never reached an execution.
 *
 * @property kind - Which way the call failed:
 *   `failed` (runner exited non-zero), `invalid` (argument or signature
 *   diagnostics), `too_large` (result exceeded the server limit),
 *   `timed_out` (server deadline hit), `transport` (HTTP/decode failure).
 * @property message - One-line human-readable summary, always present
 * @property stdout - Captured runner stdout (may be truncated)
 * @property stderr - Captured runner stderr (may be truncated)
 */
export const FuncErrorType = StructType({
    kind: VariantType({
        failed:    StructType({ exitCode: IntegerType }),
        invalid:   StructType({ diagnostics: ArrayType(StringType) }),
        too_large: StructType({ bytes: IntegerType, limit: IntegerType }),
        timed_out: StructType({ ms: IntegerType }),
        transport: StructType({ message: StringType }),
    }),
    message: StringType,
    stdout:  StringType,
    stderr:  StringType,
});

/**
 * Type representing the FuncError structure.
 */
export type FuncErrorType = typeof FuncErrorType;

/**
 * Descriptor for a function binding — carried on the handle's `binding`
 * field for inspector surfaces.
 *
 * @property name - The bound function's name in the deployed package
 */
export const FuncBindingType = StructType({
    name: StringType,
});

/**
 * Type representing the FuncBinding structure.
 */
export type FuncBindingType = typeof FuncBindingType;

// ============================================================================
// Bind handle — return type of `Func.bind`.
// ============================================================================

/**
 * The struct returned by every {@link Func.bind} call. All closures are
 * sync — the call's async effects happen behind the platform and are
 * observed reactively.
 *
 * @remarks
 * The field set is deliberately the function-shaped subset of
 * `DataBindHandleType`'s vocabulary — `read` / `status` / `pending` mean
 * the same kind of thing they mean on a dataset binding, plus the
 * call-specific `call` / `error` / `cancel`. The value types live
 * structurally in the `call` / `read` signatures, so a component requiring
 * a specific {@link BoundFunc} rejects handles bound to any other
 * signature at compile time.
 *
 * @param inputs - Positional parameter East types.
 * @param output - Return East type.
 * @returns The handle StructType for that signature.
 *
 * @property call - The one entry point: launch the function with these
 *   arguments, fire-and-forget, returning null immediately — callable from
 *   any sync UI callback. Latest-wins: calling while a call is in flight
 *   abandons the previous one.
 * @property read - Last successful result; `none` until the first
 *   `succeeded` call, then survives until the next launch overwrites it.
 * @property status - Lifecycle of the most recent `call` — see
 *   {@link FuncStatusType}.
 * @property error - Last failure detail; `none` unless status is `failed`.
 * @property pending - True while a call is in flight (== status `running`).
 * @property cancel - Stop waiting for the in-flight call (no-op when idle
 *   or terminal). Client-side only: the server runs the call to completion
 *   or its deadline regardless; the late response is discarded.
 * @property binding - Descriptor for this binding — see
 *   {@link FuncBindingType}.
 */
export const FuncBindHandleType = <I extends EastType[], O extends EastType>(
    inputs: [...I],
    output: O,
) => StructType({
    call:    FunctionType(inputs, NullType),
    read:    FunctionType([], OptionType(output)),
    status:  FunctionType([], FuncStatusType),
    error:   FunctionType([], OptionType(FuncErrorType)),
    pending: FunctionType([], BooleanType),
    cancel:  FunctionType([], NullType),
    binding: FuncBindingType,
});

/**
 * The TypeScript type of a {@link Func.bind} handle bound to the signature
 * `(...Inputs) => Output` — i.e. the return of
 * `Func.bind([[...Inputs], Output], name)`.
 *
 * @remarks
 * The signature lives in the East type itself (the `call` / `read` field
 * types), not a phantom TS brand, so it survives `$.let` / `$.const` and
 * ordinary expression plumbing.
 *
 * @typeParam I - Positional parameter East types.
 * @typeParam O - Return East type.
 */
export type BoundFunc<I extends EastType[], O extends EastType> =
    ExprType<ReturnType<typeof FuncBindHandleType<I, O>>>;

// ============================================================================
// Platform function — single generic over the instantiated handle type.
// ============================================================================

/**
 * The underlying `Func.bind` platform-function definition. End-users
 * should call {@link Func.bind} (the typed factory in this module);
 * runtime implementations register against this raw definition via
 * `funcBindPlatformFn.implement(...)`.
 *
 * @remarks
 * Generic over `H`, the fully-instantiated handle struct — the handle's
 * shape IS the signature (runtimes recover the input types from the `call`
 * field and the output type from `read`), so there are no duplicate
 * signature arguments to drift out of sync.
 */
export const funcBindPlatformFn = East.genericPlatform(
    "function_bind",
    ["H"],
    [StringType],
    "H",
    { optional: true },
);

// Low-level primitives backing a `Func.bind` handle's methods (issue #106).
//
// The handle's `call`/`read`/… are thin `East.function`s over these primitives,
// capturing only the plain-data function name (the arg/return types ride as
// type-args), so a `Func.bind` handle is ordinary serializable East data and
// re-binds to the decoder's runtime on decode. Implemented by `FuncRuntime` in
// `@elaraai/e3-ui-components`.
//
// `call` is variadic but platform fns are fixed-arity, so its N positional args
// are bundled into one `ArgsStruct` (StructType({arg0,arg1,…})); `function_call`
// is generic over that struct type `A` *and* the output type `O` so the impl can
// recover per-arg types from `A`'s fields and `launch` keeps its output type.
const function_call = East.genericPlatform("function_call", ["A", "O"], [StringType, "A"], NullType, { optional: true });
const function_read = East.genericPlatform("function_read", ["O"], [StringType], OptionType("O"), { optional: true });
const function_status = East.platform("function_status", [StringType], FuncStatusType, { optional: true });
const function_error = East.platform("function_error", [StringType], OptionType(FuncErrorType), { optional: true });
const function_pending = East.platform("function_pending", [StringType], BooleanType, { optional: true });
const function_cancel = East.platform("function_cancel", [StringType], NullType, { optional: true });

/**
 * Low-level platform primitives that back {@link Func.bind}'s handle methods.
 *
 * @internal Not for direct use — author against {@link Func.bind}. These exist
 * so the handle's methods can be IR-bearing `East.function`s (serializable)
 * rather than raw host closures.
 */
export const FuncBindPrimitives = {
    /** `function_call([ArgsStruct, O], name, argsStruct) -> Null` — launch. */
    call: function_call,
    /** `function_read([O], name) -> Option(O)` — last successful result. */
    read: function_read,
    /** `function_status(name) -> FuncStatus`. */
    status: function_status,
    /** `function_error(name) -> Option(FuncError)`. */
    error: function_error,
    /** `function_pending(name) -> Bool`. */
    pending: function_pending,
    /** `function_cancel(name) -> Null`. */
    cancel: function_cancel,
} as const;

// ============================================================================
// User-facing factory.
// ============================================================================

/**
 * Bind an `e3.function` to a reactive call handle.
 *
 * Takes the {@link FunctionDef} returned by `e3.function` — the binding's
 * name, parameter types and return type are all taken from the def, the
 * same way task wiring takes a dataset's path and type from its
 * `DatasetDef`. The binding is correct by construction: it cannot drift
 * from the deployed function's signature, because both come from the same
 * object.
 *
 * @typeParam Inputs - Positional parameter East types (from the def).
 * @typeParam Output - Return East type (from the def).
 * @param fn - The `e3.function` definition to bind.
 * @returns A handle struct described by {@link FuncBindHandleType} —
 *   `call` / `read` / `status` / `error` / `pending` / `cancel` /
 *   `binding`.
 *
 * @remarks
 * The launch/observe split is the same shape `Data.bind` uses for
 * `write` (sync IR, async effects behind the platform): `call` never
 * blocks, and everything you'd want back from the call arrives through
 * `read` / `status` / `error` on the next reactive render. All handles
 * bound to the same function in the same workspace share one tracked
 * channel — one component can launch while another renders the spinner.
 *
 * @example
 * ```ts
 * import { East, FloatType, IntegerType, NullType } from "@elaraai/east";
 * import { Button, Reactive, Stat, UIComponentType, VStack } from "@elaraai/east-ui";
 * import { Func } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * const forecastFn = e3.function('forecast',
 *     East.function([IntegerType, FloatType], FloatType, ($, periods, growth) => ...));
 *
 * // Mirrors `funcBindCall` in test/func/func.examples.tsx.
 * const funcBindCall = East.function([], UIComponentType, _$ => {
 *     return Reactive.Root(East.function([], UIComponentType, $ => {
 *         const forecast = $.let(Func.bind(forecastFn));
 *         const run = $.const(East.function([], NullType, $ => {
 *             $(forecast.call(12n, 1.05));
 *         }));
 *         return VStack.Root([
 *             Button.Root("Run forecast", { onClick: run, loading: forecast.pending() }),
 *             Stat.Root({ label: "Forecast", value: East.print(forecast.read()) }),
 *         ], { gap: "3" });
 *     }));
 * });
 * ```
 */
function bindFunction<Inputs extends EastType[], Output extends EastType>(
    fn: FunctionDef<Inputs, Output>,
): BoundFunc<Inputs, Output> {
    const handleType = FuncBindHandleType([...fn.inputTypes], fn.outputType);
    // The name must be a single literal Value IR node — the only shape
    // manifest derivation (`derive.ts`) handles. `fn.name` is a static JS
    // string at IR-build time, so this holds by construction.
    const nameValue = East.value(fn.name, StringType);
    return funcBindPlatformFn([handleType], nameValue) as BoundFunc<Inputs, Output>;
}

/**
 * The Func namespace — reactive function (RPC) binding for e3 UI tasks.
 *
 * @remarks
 * `Func.bind` binds a named function in the workspace's deployed package
 * (`e3.function`) to a call handle: `call` launches it fire-and-forget,
 * and `read` / `status` / `error` / `pending` observe the call lifecycle.
 * An `e3.function` is a *bounded* RPC — the server enforces a wall-clock
 * deadline and a result-size limit on the sync call path; long compute
 * belongs in dataflow tasks (`Data.bind`'s `writeAndStart`).
 *
 * Use inside `Reactive.Root` for reactive re-rendering as the call
 * progresses.
 */
export const Func = {
    bind: bindFunction,
} as const;
