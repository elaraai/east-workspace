/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A further change to a record a builder edits, as a draft
 * (east-workspace#1624, rule 10): what a builder hands a function beside its
 * sessions' pending Save for a question about its drafts as they would be — a
 * derived plan's change, laid after the Save and committed nowhere. It is a
 * draft of the record's patch door, the mutation the builder's session saves
 * through (`SCHEDULE_PATCH_DOOR`), its patch the entries' own: an insert, a
 * delete carrying what the entry was, or an update, the entry's patch from
 * what it was — the operations a Save's patch holds, so the record checks the
 * change as it checks a Save.
 *
 * @packageDocumentation
 */

import { DictType, PatchType, SortedMap, compareFor, diffFor, encodeBeast2For, equalFor, variant, type EastType } from "@elaraai/east";
import { SCHEDULE_PATCH_DOOR } from "@elaraai/e3-ui/internal";
import type { FuncCallDraft } from "./use-func-call.js";

/** One entry's change: what it was under the drafts, and what the derived plan makes it; `undefined` where it is absent. */
export interface EntryChange {
    /** The entry's key, at the record's key type. */
    readonly key: unknown;
    /** The entry's row under the drafts. */
    readonly before: unknown;
    /** Its row in the derived plan. */
    readonly after: unknown;
}

/**
 * Makes drafts of a record's patch door from its entries' changes.
 *
 * @param record - The record's name in the deployed package
 * @param keyType - The record's key type
 * @param rowType - Its row type
 * @returns From the changes, the draft; `undefined` where they change no entry
 */
export function recordPatchDrafts(record: string, keyType: EastType, rowType: EastType): (changes: readonly EntryChange[]) => FuncCallDraft | undefined {
    const encode = encodeBeast2For(PatchType(DictType(keyType, rowType))) as (patch: unknown) => Uint8Array;
    const byKey = compareFor(keyType) as (a: unknown, b: unknown) => number;
    const sameRow = equalFor(rowType) as (a: unknown, b: unknown) => boolean;
    const rowDiff = diffFor(rowType) as (before: unknown, after: unknown) => unknown;
    return (changes) => {
        // Each entry's operation, as a Save's patch holds it: the record's whole patch is never made of some entries' rows.
        const ops = new SortedMap<unknown, unknown>([], byKey);
        for (const { key, before, after } of changes) {
            if (before === undefined && after === undefined) continue;
            if (before === undefined) ops.set(key, variant("insert", after));
            else if (after === undefined) ops.set(key, variant("delete", before));
            else if (!sameRow(before, after)) ops.set(key, variant("update", rowDiff(before, after)));
        }
        return ops.size === 0 ? undefined : { record, mutation: SCHEDULE_PATCH_DOOR, args: [encode(variant("patch", ops))] };
    };
}
