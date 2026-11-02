/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Save's patch over rows read beside their nested series index, restated by
 * key (#1438). East's diff of a Dict whose every key went one way is one whole
 * `replace`: a machine whose only job moves off it sends `replace { before: {
 * j-42 }, after: {} }`, which conflicts with another planner's job added to it
 * meanwhile. The Plan restates each collection the index lists as the
 * operations a `replace` stands for, key by key — a `delete` of each key it
 * held, an `insert` of each it holds, an `update` of each in both that changed
 * — down through child rows, so a commit's patch names only the items and
 * values it changed, and e3 checks each against what it was. A node of a
 * recursive tree is a whole value to East's patches, so its update replaces it
 * whole, by its key.
 *
 * @packageDocumentation
 */

import {
    DictType, East, OptionType, PatchType, dictPatchOpsType, some, variant,
    type EastType, type ExprType, type FunctionExpr,
} from "@elaraai/east";
import { EditingChangeSetTypeFor } from "@elaraai/east-ui/internal";
import type { PlanNestedDeclaration, PlanNestedIndex } from "./nested-checks.js";

/** A patch's restatement: `(PatchType(T)) → PatchType(T)`. */
type Restatement = FunctionExpr<[EastType], EastType>;

/** An East expression read loosely, as a restatement built over a declaration's types reads its patches. */
type Loose = ExprType<EastType> & Record<string, ExprType<EastType>>;

/**
 * A Dict's patch with its `replace` restated by key, and each `update` of a
 * value restated within where its values hold more collections.
 *
 * @param type - The Dict's type
 * @param inner - The restatement of its values' patches, where they hold collections
 * @returns The restatement
 */
function dictByKey(type: DictType<EastType, EastType>, inner: Restatement | undefined): Restatement {
    const patchType: EastType = PatchType(type as EastType);
    const opType = dictPatchOpsType(type.value);
    const opsType = DictType(type.key, opType);
    return East.function([patchType], patchType, ($, patch) => {
        const out = $.let(patch);
        $.match(patch as never, {
            replace: ($2: typeof $, whole: Loose) => {
                const ops = $2.let(new Map(), opsType) as unknown as Loose;
                $2.for(whole.before as never, ($3: typeof $, was: ExprType<EastType>, key: ExprType<EastType>) => {
                    $3.match((whole.after as unknown as { tryGet(k: unknown): ExprType<EastType> }).tryGet(key) as never, {
                        none: ($4: typeof $) => { $4((ops as unknown as { insert(k: unknown, v: unknown): ExprType<EastType> }).insert(key, East.value(variant("delete", was) as never, opType))); },
                        some: ($4: typeof $, now: ExprType<EastType>) => {
                            $4.if(East.notEqual(was as never, now as never), ($5) => {
                                $5((ops as unknown as { insert(k: unknown, v: unknown): ExprType<EastType> }).insert(key, East.value(variant("update", East.diff(was as never, now as never)) as never, opType)));
                            });
                        },
                    });
                });
                $2.for(whole.after as never, ($3: typeof $, now: ExprType<EastType>, key: ExprType<EastType>) => {
                    $3.if((whole.before as unknown as { has(k: unknown): { not(): ExprType<EastType> } }).has(key).not() as never, ($4) => {
                        $4((ops as unknown as { insert(k: unknown, v: unknown): ExprType<EastType> }).insert(key, East.value(variant("insert", now) as never, opType)));
                    });
                });
                $2.assign(out, East.value(variant("patch", ops) as never, patchType) as never);
            },
            ...(inner === undefined ? {} : {
                patch: ($2: typeof $, ops: ExprType<EastType>) => {
                    const restate = $2.const(inner) as unknown as (p: ExprType<EastType>) => ExprType<EastType>;
                    const restated = (ops as unknown as { map(fn: unknown): ExprType<EastType> }).map((_$3: unknown, op: Loose) =>
                        (op as unknown as { match(cases: unknown, otherwise: unknown): ExprType<EastType> }).match(
                            { update: (_$4: unknown, value: ExprType<EastType>) => East.value(variant("update", restate(value)) as never, opType) },
                            () => op));
                    $2.assign(out, East.value(variant("patch", restated) as never, patchType) as never);
                },
            }),
        } as never);
        return out;
    }) as unknown as Restatement;
}

/**
 * A row's patch with each collection the index lists restated by key, down
 * through its child rows; `undefined` for a row of a recursive tree, which
 * East patches whole, or one listing no Dict.
 *
 * @param rowType - The row's type
 * @param collections - The collections the index lists in it, by field
 * @returns The restatement
 */
function rowByKey(rowType: EastType, collections: ReadonlyMap<string, PlanNestedDeclaration>): Restatement | undefined {
    if (rowType.type !== "Struct") return undefined;
    const fields: (readonly [string, Restatement])[] = [];
    for (const [field, declared] of collections) {
        const fieldType = (rowType.fields as Readonly<Record<string, EastType>>)[field];
        if (fieldType?.type !== "Dict") continue;
        const dict = fieldType as DictType<EastType, EastType>;
        const inner = declared.kind === "rows" ? rowByKey(dict.value, declared.collections) : undefined;
        fields.push([field, dictByKey(dict, inner)]);
    }
    if (fields.length === 0) return undefined;
    const patchType: EastType = PatchType(rowType);
    return East.function([patchType], patchType, ($, patch) => {
        const restate = fields.map(([field, fn]) => [field, $.const(fn) as unknown as (p: ExprType<EastType>) => ExprType<EastType>] as const);
        const out = $.let(patch);
        $.match(patch as never, {
            patch: ($2: typeof $, parts: ExprType<EastType>) => {
                // Each step held in a variable of its own: an expression read twice is written out twice.
                const next = restate.reduce<ExprType<EastType>>((was, [field, fn]) => {
                    const held = $2.let(was);
                    return East.withField(held as never, field, fn(East.field(held as never, field) as ExprType<EastType>)) as ExprType<EastType>;
                }, parts);
                $2.assign(out, East.value(variant("patch", next) as never, patchType) as never);
            },
        } as never);
        return out;
    }) as unknown as Restatement;
}

/**
 * A Plan's batch over rows read beside their nested series index, each
 * change's patch restated by key (see the module docs).
 *
 * @param entryType - The rows' type
 * @param keyType - Their key's type
 * @param index - The nested series index the rows are read beside
 * @returns `(ChangeSet(R, K)) → ChangeSet(R, K)`; `undefined` where the index lists no collection a patch reaches by key
 */
export function planNestedRestatement(entryType: EastType, keyType: EastType, index: PlanNestedIndex): Restatement | undefined {
    const row = rowByKey(entryType, index.collections);
    if (row === undefined) return undefined;
    const entryPatch: EastType = PatchType(OptionType(entryType) as EastType);
    const entry = East.function([entryPatch], entryPatch, ($, patch) => {
        const restate = $.const(row) as unknown as (p: ExprType<EastType>) => ExprType<EastType>;
        const out = $.let(patch);
        $.match(patch as never, {
            patch: ($2: typeof $, inner: ExprType<EastType>) => {
                $2.match(inner as never, {
                    some: ($3: typeof $, rowPatch: ExprType<EastType>) => {
                        // The option's patch, its `some` case the row's.
                        $3.assign(out, East.value(variant("patch", some(restate(rowPatch))) as never, entryPatch) as never);
                    },
                } as never);
            },
        } as never);
        return out;
    });
    const batchType = EditingChangeSetTypeFor(entryType, keyType);
    return East.function([batchType], batchType, ($, batch) => {
        const restate = $.const(entry) as unknown as (p: ExprType<EastType>) => ExprType<EastType>;
        const changes = (batch as unknown as Loose).changes as unknown as { map(fn: unknown): ExprType<EastType> };
        return East.withField(batch as never, "changes", changes.map((_$2: unknown, change: Loose) =>
            East.withField(change as never, "patch", restate(change.patch!)))) as never;
    }) as unknown as Restatement;
}
