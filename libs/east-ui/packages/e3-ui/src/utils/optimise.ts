/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The `optimise` prop's binding (#1409, `Optimise Spec.md` §4): `Func.bind` of
 * the app's `e3.function` from a builder's `OptimiseRequest` — the period in
 * view and its rows, as the session holds them — to its `OptimiseResult`, the
 * same rows complete, checked at build as `fit` is. Each builder names its own
 * types and its own words; the check is one.
 *
 * @packageDocumentation
 */

import { isTypeEqual, printType, type EastType, type ExprType, type NullType, type StructType } from "@elaraai/east";
import { FuncBindingType, boundFuncSignature } from "../bind/func.js";

/**
 * A `Func.bind` handle of the app's optimiser, as a tag takes it where its
 * rows' types are its kinds' or its source's — the Calendar's, the Plan's and
 * the Sheet's `optimise` — which TypeScript cannot see from the tag alone: the
 * tag checks the handle at build against the builder's `OptimiseRequest` and
 * `OptimiseResult` over its rows, and refuses one over other rows, naming both.
 * Every `Func.bind` handle has this shape; nothing else does that the check
 * would take.
 *
 * @property call - The function's call, which a run makes once
 * @property read - Its last result, which a run reads once the call lands
 * @property binding - The binding, which names the function
 */
export interface OptimiseHandle {
    call: (...args: never[]) => ExprType<NullType>;
    read: (...args: never[]) => unknown;
    binding: ExprType<typeof FuncBindingType>;
}

/**
 * What a builder holds its `optimise` to, and the words its refusals use.
 *
 * @property builder - The builder, as the refusals name it (`Roster`)
 * @property request - The request type the function must ask: the builder's `OptimiseRequest` over its rows
 * @property result - The result type it must answer: the builder's `OptimiseResult` over its rows
 * @property signature - The signature in words, for a value that is no `Func.bind` handle (`from Roster.Types.OptimiseRequest(R) to Roster.Types.OptimiseResult(R), R the duties' row type`)
 * @property names - The constructors, as the refusals spell them (`Roster.Types.OptimiseRequest`, `Roster.Types.OptimiseResult`)
 * @property rows - The builder's rows, printed, as each constructor takes them (`.Struct […]`)
 * @property noun - What rows are called when a function is bound over others (`duty rows`), and whose the builder's are (`the duty kind's rows`)
 * @property of - What the remedy binds a request over (`the duties' row type`)
 * @property otherRows - The rows a request of the request's shape over other rows was built over, printed, when `asked` is one; `undefined` otherwise
 */
export interface OptimiseContract {
    builder: string;
    request: EastType;
    result: EastType;
    signature: string;
    names: { request: string; result: string };
    rows: { request: string; result: string };
    noun: { theirs: string; ours: string };
    of: string;
    otherRows: (asked: EastType) => string | undefined;
}

/**
 * The `optimise` binding, checked: `Func.bind` of an `e3.function` from the
 * builder's `OptimiseRequest` to its `OptimiseResult`.
 *
 * @param optimise - What the app passed as `optimise`
 * @param contract - The types it is held to, and the words
 * @returns The binding's descriptor, which names the function
 * @throws {Error} When it is not a `Func.bind` handle, or its function asks or answers another type, naming it — one bound
 *   over other rows naming both
 * @internal
 */
export function optimiseBinding(optimise: unknown, contract: OptimiseContract): ExprType<typeof FuncBindingType> {
    const { builder, names } = contract;
    const signature = boundFuncSignature(optimise);
    if (signature === undefined) {
        throw new Error(`${builder}: \`optimise\` is Func.bind of the app's e3.function ${contract.signature} — the period's rows in, the same rows out, complete`);
    }
    const asked = signature.asks;
    if (!isTypeEqual(asked, contract.request)) {
        const theirs = contract.otherRows(asked);
        throw new Error(theirs !== undefined
            ? `${builder}: \`optimise\` is bound over ${contract.noun.theirs} ${theirs}, and ${contract.noun.ours} are ${contract.rows.request} — ` +
                `bind an optimiser over ${names.request} of ${contract.of}`
            : `${builder}: \`optimise\` asks ${printType(asked)}, not ${names.request}(${contract.rows.request})`);
    }
    if (!isTypeEqual(signature.answers, contract.result)) {
        throw new Error(`${builder}: \`optimise\` answers ${printType(signature.answers)}, not ${names.result}(${contract.rows.result})`);
    }
    return (optimise as ExprType<StructType<{ binding: typeof FuncBindingType }>>).binding;
}
