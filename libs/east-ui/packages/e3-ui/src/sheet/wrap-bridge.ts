/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The wrappers (`Sheet Spec.md` §4.8) — each of the author's typed functions
 * inside its closed wire twin, over the sheet's bridge (`bridge.ts`): a fill
 * provider, a row proposer, an arity rule, an options rule, a member check,
 * and a custom kind's parse and print. Each is checked as the sheet builds
 * against the sheet's own context, naming the column.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    East,
    NullType,
    OptionType,
    StringType,
    StructType,
    isTypeEqual,
    none,
    some,
    variant,
    type BlockBuilder,
    type EastType,
    type ExprType,
    type FunctionType,
    type SubtypeExprOrValue,
} from "@elaraai/east";

import {
    SheetCellType,
    SheetCheckContextType,
    SheetCheckType,
    SheetContextType,
    SheetCountedType,
    SheetFillType,
    SheetOptionsRuleType,
    SheetProposalType,
    SheetProposerType,
    SheetProviderType,
} from "./types.js";
import { SheetDraftEntryTypeFor, SheetDraftGroupTypeFor } from "./drafts.js";
import { SheetDraftTypeFor } from "./transactions.js";
import { buildDraftBase } from "./context-bridge.js";
import { cellOfPayload, describeType, typeOf, type SheetColumnMeta } from "./column-meta.js";
import type { SheetBridge, SheetEntryVariant } from "./bridge.js";

/** Whether an East function value is asynchronous. */
export function isAsyncFunction(fn: ExprType<EastType>): boolean {
    return (typeOf(fn) as { type: string }).type === "AsyncFunction";
}

/** Pin an author function value and check its East input type against the bridge's context type. */
function pinProvider(
    bridge: SheetBridge,
    fn: unknown,
    where: string,
    expectedOutput: EastType,
): { fn: ExprType<EastType>; async: boolean } {
    const expr = East.value(fn as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const t = typeOf(expr) as { type: string; inputs?: EastType[]; output?: EastType };
    if (t.type !== "Function" && t.type !== "AsyncFunction") {
        throw new Error(`Sheet: ${where} must be an East.function or East.asyncFunction — got a ${t.type}`);
    }
    const inputs = t.inputs ?? [];
    if (inputs.length !== 1 || !isTypeEqual(inputs[0]!, bridge.ctxType)) {
        throw new Error(`Sheet: ${where} must take exactly this sheet's context — ${contextName(bridge)} — as its one argument; a function written over another row or driver type cannot run here`);
    }
    if (t.output === undefined || !isTypeEqual(t.output, expectedOutput)) {
        throw new Error(`Sheet: ${where} returns the wrong type — it must return ${describeType(expectedOutput)}`);
    }
    return { fn: expr, async: t.type === "AsyncFunction" };
}

/** How this sheet's context is spelt, for a refusal message. */
function contextName(bridge: SheetBridge): string {
    const driver = isTypeEqual(bridge.driverType, NullType) ? "" : ", DriverType";
    return bridge.group !== undefined
        ? `Sheet.Types.DraftContext(GroupType, "${bridge.group.linesField}"${driver})`
        : `Sheet.Types.DraftContext(RowType${driver})`;
}

/**
 * Wrap a fill provider — `Sheet.Types.DraftContext(R, D)` → `Option<Fill(T)>` —
 * into the wire provider variant (sync or async by the function's type). A
 * column holding a key's text is filled with the key, at its type
 * (east-workspace#1747), and the cell takes its text.
 */
export function wrapProvider(bridge: SheetBridge, meta: SheetColumnMeta, fn: unknown, index: number): ExprType<SheetProviderType> {
    const keys = meta.keys;
    const fillType = StructType({ value: keys?.type ?? meta.payloadType, meta: StringType });
    const { fn: author, async } = pinProvider(bridge, fn, `column "${meta.key}" fill provider #${index + 1}`, OptionType(fillType));
    const body = ($: BlockBuilder<OptionType<SheetFillType>>, ctx: ExprType<SheetContextType>): ExprType<OptionType<SheetFillType>> => {
        const a = $.const(author as unknown as ExprType<FunctionType<[StructType], OptionType<StructType<{ value: EastType; meta: StringType }>>>>);
        const bc = $.const(bridge.bridgeCtx);
        const encode = keys !== undefined ? $.const(keys.encode) : undefined;
        const typed = $.let(bc(ctx), bridge.ctxType);
        return a(typed).match({
            none: (_$) => East.value(none, OptionType(SheetFillType)),
            some: (_$, f) => East.value(some({
                value: encode !== undefined ? cellOfPayload("String", encode(f.value as ExprType<EastType>) as ExprType<EastType>) : cellOfPayload(meta.cellTag, f.value as ExprType<EastType>),
                meta: f.meta,
            }), OptionType(SheetFillType)),
        }) as ExprType<OptionType<SheetFillType>>;
    };
    const wire = async
        ? East.asyncFunction([SheetContextType], OptionType(SheetFillType), body)
        : East.function([SheetContextType], OptionType(SheetFillType), body);
    return East.value(variant(async ? "async" : "sync", wire) as unknown as SubtypeExprOrValue<SheetProviderType>, SheetProviderType);
}

/**
 * Wrap a row proposer — `Sheet.Types.DraftContext(R, D)` → `Array<Proposal(R)>` —
 * into the wire proposer variant.
 */
export function wrapProposer(bridge: SheetBridge, fn: unknown, index: number): ExprType<SheetProposerType> {
    const { fn: author, async } = pinProvider(bridge, fn, `suggest.propose #${index + 1}`, ArrayType(bridge.proposalType));
    const body = ($: BlockBuilder<ArrayType<SheetProposalType>>, ctx: ExprType<SheetContextType>): ExprType<ArrayType<SheetProposalType>> => {
        const a = $.const(author as unknown as ExprType<FunctionType<[StructType], ArrayType<StructType<{ patch: StructType; meta: StringType }>>>>);
        const bc = $.const(bridge.bridgeCtx);
        const enc = $.const(bridge.encodePatch);
        const typed = $.let(bc(ctx), bridge.ctxType);
        return a(typed).map((_$, p) => East.value({ cells: enc(p.patch), meta: p.meta }, SheetProposalType)) as unknown as ExprType<ArrayType<SheetProposalType>>;
    };
    const wire = async
        ? East.asyncFunction([SheetContextType], ArrayType(SheetProposalType), body)
        : East.function([SheetContextType], ArrayType(SheetProposalType), body);
    return East.value(variant(async ? "async" : "sync", wire) as unknown as SubtypeExprOrValue<SheetProposerType>, SheetProposerType);
}

/** Wrap an arity rule — `Sheet.Types.DraftContext(R, D)` → `Option<Counted>`. */
export function wrapArity(bridge: SheetBridge, meta: SheetColumnMeta, fn: unknown): ExprType<FunctionType<[SheetContextType], OptionType<SheetCountedType>>> {
    const { fn: author, async } = pinProvider(bridge, fn, `column "${meta.key}" arity rule`, OptionType(SheetCountedType));
    if (async) throw new Error(`Sheet: column "${meta.key}" arity rule must be synchronous — the strip reads it while the half is edited`);
    return East.function([SheetContextType], OptionType(SheetCountedType), ($, ctx) => {
        const a = $.const(author as unknown as ExprType<FunctionType<[StructType], OptionType<SheetCountedType>>>);
        const bc = $.const(bridge.bridgeCtx);
        return a(bc(ctx));
    });
}

/**
 * Wrap an options rule (#844) — `Sheet.Types.DraftContext(R, D)` →
 * `Option<Array<K>>`, the keys offered at the register's key type `K`
 * (east-workspace#1747) — into the wire rule, each key as its text.
 * Synchronous: the menu reads it as the cell opens.
 */
export function wrapOptions(bridge: SheetBridge, meta: SheetColumnMeta, fn: unknown): ExprType<SheetOptionsRuleType> {
    const keys = meta.keys;
    const { fn: author, async } = pinProvider(bridge, fn, `column "${meta.key}" options rule`, OptionType(ArrayType(keys?.type ?? StringType)));
    if (async) throw new Error(`Sheet: column "${meta.key}" options rule must be synchronous — the menu reads it as the cell opens`);
    return East.function([SheetContextType], OptionType(ArrayType(StringType)), ($, ctx) => {
        const a = $.const(author as unknown as ExprType<FunctionType<[StructType], OptionType<ArrayType<EastType>>>>);
        const bc = $.const(bridge.bridgeCtx);
        if (keys === undefined) return a(bc(ctx)) as unknown as ExprType<OptionType<ArrayType<StringType>>>;
        const encode = $.const(keys.encode);
        return a(bc(ctx)).match({
            some: (_$2, offered) => East.value(some(offered.map((_$3, k) => encode(k))), OptionType(ArrayType(StringType))),
            none: (_$2) => East.value(none, OptionType(ArrayType(StringType))),
        });
    });
}

/** Wrap an author member check — `Sheet.Types.CheckContext(R)` → `Option<String>` — into the `custom` check arm. */
export function wrapCheck(bridge: SheetBridge, meta: SheetColumnMeta, fn: unknown, index: number): ExprType<SheetCheckType> {
    const expr = East.value(fn as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const t = typeOf(expr) as { type: string; inputs?: EastType[]; output?: EastType };
    if (t.type !== "Function" || (t.inputs ?? []).length !== 1 || !isTypeEqual(t.inputs![0]!, bridge.checkCtxType) ||
        t.output === undefined || !isTypeEqual(t.output, OptionType(StringType))) {
        const spelt = bridge.group !== undefined ? `Sheet.Types.CheckContext(GroupType, "${bridge.group.linesField}")` : "Sheet.Types.CheckContext(RowType)";
        throw new Error(`Sheet: column "${meta.key}" check #${index + 1} must be an East.function over ${spelt} returning Option<String>`);
    }
    const groupHalf = bridge.group;
    const field = groupHalf?.linesField;
    const entryDraft = SheetDraftEntryTypeFor(bridge.rowType, field) as EastType;
    const draftType = (groupHalf === undefined ? entryDraft : SheetDraftGroupTypeFor(groupHalf.groupType, groupHalf.linesField)) as StructType;
    const rowDraft = SheetDraftTypeFor(bridge.lineType) as StructType;
    const base = buildDraftBase(bridge.rowType, field, bridge.rowById);
    const wire = East.function([SheetCheckContextType], OptionType(StringType), ($, c) => {
        const a = $.const(expr as ExprType<FunctionType<[StructType], OptionType<StringType>>>);
        const read = $.const(base);
        const dec = $.const(bridge.draftRow);
        const original = $.const(read(c.drafts, c.rowId, c.offset), OptionType(entryDraft));
        if (field === undefined || groupHalf === undefined) {
            const row = $.const(dec(c.rowId, c.row, original as ExprType<OptionType<StructType>>));
            return a($.const({ rowIndex: c.rowIndex, row, group: none, half: c.half, member: c.member } as SubtypeExprOrValue<StructType>, bridge.checkCtxType));
        }
        const decGroup = $.const(groupHalf.decodeGroup);
        /** A line's check: the line over its prior draft in its group, the group decoded over the wire group row. */
        const lineCheck = ($2: BlockBuilder<EastType>, own: ExprType<OptionType<StructType>>) => {
            const group = $2.const(c.group.match({
                none: () => own,
                some: (_$, wire) => some(decGroup(wire, own, some(wire))),
            }), OptionType(draftType));
            const prior = $2.const(group.match({
                none: () => none,
                some: (_$, value) => {
                    const children = value[field] as ExprType<ArrayType<StructType>>;
                    return c.rowIndex.greaterEqual(0n).and(() => c.rowIndex.less(children.size())).ifElse(() => some(children.get(c.rowIndex)), () => none);
                },
            }), OptionType(rowDraft));
            const row = $2.const(dec("", c.row, prior));
            return a($2.const({ rowIndex: c.rowIndex, row, group, half: c.half, member: c.member } as SubtypeExprOrValue<StructType>, bridge.checkCtxType));
        };
        const decLoose = groupHalf.decodeLoose;
        if (decLoose === undefined) return lineCheck($ as unknown as BlockBuilder<EastType>, original as ExprType<OptionType<StructType>>);
        // A source with loose rows (#846): the entry's arms. A loose row has
        // no line address — its own cells over its own draft, and no group.
        const entry = original as unknown as ExprType<OptionType<SheetEntryVariant>>;
        const decodeLoose = $.const(decLoose);
        return c.line.match({
            some: ($2) => {
                const own = $2.const(entry.match({ none: () => none, some: (_$, e) => e.match({ group: (_$3, g) => some(g), row: () => none }) }), OptionType(draftType));
                return lineCheck($2 as unknown as BlockBuilder<EastType>, own);
            },
            none: ($2) => {
                const own = $2.const(entry.match({ none: () => none, some: (_$, e) => e.match({ row: (_$3, r) => some(r), group: () => none }) }), OptionType(rowDraft));
                const row = $2.const(decodeLoose(c.rowId, c.row, own));
                return a($2.const({ rowIndex: c.rowIndex, row, group: none, half: c.half, member: c.member } as SubtypeExprOrValue<StructType>, bridge.checkCtxType));
            },
        });
    });
    return East.value(variant("custom", wire) as unknown as SubtypeExprOrValue<SheetCheckType>, SheetCheckType);
}

/** Wrap a custom kind's `parse` — `(text, Context(R, D))` → `Option<P>` — into the wire parse. */
export function wrapCustomParse(bridge: SheetBridge, meta: SheetColumnMeta, fn: unknown): ExprType<FunctionType<[StringType, SheetContextType], OptionType<SheetCellType>>> {
    const expr = East.value(fn as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const t = typeOf(expr) as { type: string; inputs?: EastType[]; output?: EastType };
    const inputs = t.inputs ?? [];
    if (t.type !== "Function" || inputs.length !== 2 || !isTypeEqual(inputs[0]!, StringType) || !isTypeEqual(inputs[1]!, bridge.ctxType)) {
        throw new Error(`Sheet: custom column "${meta.key}" \`parse\` must be an East.function over (String, ${contextName(bridge)}) returning Option<payload>`);
    }
    return East.function([StringType, SheetContextType], OptionType(SheetCellType), ($, text, ctx) => {
        const a = $.const(expr as unknown as ExprType<FunctionType<[StringType, StructType], OptionType<EastType>>>);
        const bc = $.const(bridge.bridgeCtx);
        return a(text, bc(ctx)).match({
            none: (_$) => East.value(none, OptionType(SheetCellType)),
            some: (_$, v) => East.value(some(cellOfPayload(meta.cellTag, v as ExprType<EastType>)), OptionType(SheetCellType)),
        });
    });
}

/** Wrap a custom kind's `print` — `P` → `String` — into the wire print. */
export function wrapCustomPrint(meta: SheetColumnMeta, fn: unknown): ExprType<FunctionType<[SheetCellType], StringType>> {
    const expr = East.value(fn as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const t = typeOf(expr) as { type: string; inputs?: EastType[]; output?: EastType };
    const inputs = t.inputs ?? [];
    if (t.type !== "Function" || inputs.length !== 1 || !isTypeEqual(inputs[0]!, meta.payloadType) ||
        t.output === undefined || !isTypeEqual(t.output, StringType)) {
        throw new Error(`Sheet: custom column "${meta.key}" \`print\` must be an East.function over the payload (${describeType(meta.payloadType)}) returning String`);
    }
    return East.function([SheetCellType], StringType, ($, cell) => {
        const a = $.const(expr as unknown as ExprType<FunctionType<[EastType], StringType>>);
        return cell.match(
            { [meta.cellTag]: (_$: unknown, v: ExprType<EastType>) => a(v) } as never,
            (_$: unknown) => East.value("", StringType),
        ) as ExprType<StringType>;
    });
}
