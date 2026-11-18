/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's handles made by hand, for specs that read and write no e3: a
 * `Record.bind` handle and a `Data.bind` handle over a value the spec holds,
 * each of the type its binding gives, so a kind over the app's record — the
 * Flowchart's, the Schematic's, the Plan's link kinds — tells it as it tells
 * a binding (`kindBinding`), reads it, and builds its session over it.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BooleanType, East, NullType, OptionType, PatchType, StringType, none, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { DatasetStatusType, RecordCommitInfoType } from "@elaraai/e3-types";
import { DataBindHandleType, FuncDraftType, RecordBindHandleType, RecordErrorType, RecordMutateStatusType, RecordOutcomeType } from "@elaraai/e3-ui";

/**
 * A `Record.bind` handle over a record of `type`, as `Record.bind` gives one.
 *
 * @typeParam T - The record's type
 * @param type - The record's type
 * @param value - What its read answers
 * @param name - The record's name, as its binding carries it
 * @param patch - Whether it is bound with its patch door: its commit answers committed, and its draft the patch as a draft
 * @returns `()` → the handle
 */
export function recordHandle<T extends EastType>(type: T, value: ValueTypeOf<T>, name: string, patch = true) {
    const handleType = RecordBindHandleType(type, patch ? { patch: [PatchType(type)] } : {});
    return East.function([], handleType, (_$) => ({
        read: East.function([], type, (_$2) => value as never),
        status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
        history: East.function([], OptionType(ArrayType(RecordCommitInfoType)), (_$2) => none),
        mutate: {
            pending: East.function([], BooleanType, (_$2) => false),
            status: East.function([], RecordMutateStatusType, (_$2) => variant("idle", null)),
            error: East.function([], OptionType(RecordErrorType), (_$2) => none),
            cancel: East.function([], NullType, (_$2) => null),
            ...(patch ? { patch: East.function([PatchType(type)], NullType, (_$2) => null) } : {}),
        },
        commit: patch
            ? { patch: East.asyncFunction([StringType, PatchType(type)], RecordOutcomeType, (_$2) => variant("committed", { commitHash: "c", stateHash: "s" })) }
            : {},
        draft: patch
            ? { patch: East.function([PatchType(type)], FuncDraftType, (_$2, change) => ({ record: name, mutation: "patch", args: [East.Blob.encodeBeast(change as never, "v2")] })) }
            : {},
        start: East.function([], NullType, (_$2) => null),
        binding: { name, mutations: patch ? ["patch"] : [] },
    }) as never);
}


/**
 * A `Data.bind` handle over a record of `type`, as `Data.bind` gives one.
 *
 * @typeParam T - The record's type
 * @param type - The record's type
 * @param value - What its read answers
 * @param name - The dataset's name, as its binding's path carries it
 * @returns `()` → the handle
 */
export function dataHandle<T extends EastType>(type: T, value: ValueTypeOf<T>, name: string) {
    return East.function([], DataBindHandleType(type), (_$) => ({
        read: East.function([], type, (_$2) => value as never),
        write: East.function([type], NullType, (_$2) => null),
        writeAndStart: East.function([type], NullType, (_$2) => null),
        start: East.function([], NullType, (_$2) => null),
        source: East.function([], type, (_$2) => value as never),
        pending: East.function([], BooleanType, (_$2) => false),
        commit: East.function([], NullType, (_$2) => null),
        discard: East.function([], NullType, (_$2) => null),
        has: East.function([], BooleanType, (_$2) => true),
        status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
        binding: { source: [variant("field", "inputs"), variant("field", name)], patch: none, mode: variant("staged", null) },
    }) as never);
}
