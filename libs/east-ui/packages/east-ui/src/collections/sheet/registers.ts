/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Sheet.register` and `Sheet.driver` — registers are the grammar's
 * vocabulary, projected from the host's rows through accessors reified once
 * (Plan's `derive` move, `Sheet Spec.md` §3.3). There is no attribute bag:
 * a value another declaration needs is read off a TYPED row by an accessor.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    East,
    Expr,
    ArrayType,
    DictType,
    FunctionType,
    OptionType,
    SetType,
    StringType,
    StructType,
    none,
} from "@elaraai/east";

import { StatusValueType } from "../../feedback/status/types.js";
import { SheetRegisterMemberType } from "./types.js";
import { SheetRegisterMembersType } from "./link.js";

/** A built register — its members, as an expression. What `Sheet.register.*` returns and `registers={…}` takes. */
export type SheetRegisterValue = ExprType<ArrayType<SheetRegisterMemberType>>;

/**
 * The accessors `Sheet.register.members` reifies over one data ENTRY — its
 * value and its key (`(_v, k) => k` is the normal spelling over a `Dict`;
 * over an `Array` the key is the index, printed).
 *
 * @typeParam T - The data's element type
 * @property kind - The member kind (`"machine"`, `"line"`, `"family"`)
 * @property key - What the grammar resolves — accessor
 * @property label - What a chip prints — accessor
 * @property aliases - Alternative spellings — accessor returning the field's array
 * @property meta - Chip meta — accessor returning the field's `Option`
 * @property parent - The parent key — accessor returning the field's `Option`
 * @property tone - An `enum` member's valence — accessor returning the field's `Option`
 */
export interface SheetMembersConfig<T extends EastType> {
    /** The member kind. */
    kind: string;
    /** What the grammar resolves. */
    key: (value: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** What a chip prints. */
    label: (value: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** Alternative spellings the grammar also resolves. */
    aliases?: (value: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<ArrayType<StringType>>;
    /** Chip meta — return the field's `Option`. */
    meta?: (value: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** The parent key — return the field's `Option`. */
    parent?: (value: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** The valence dot — return the field's `Option`. */
    tone?: (value: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StatusValueType>>;
}

/** Fold duplicate keys, keeping the FIRST occurrence in declaration order. */
const dedupeMembers = East.function([SheetRegisterMembersType], SheetRegisterMembersType, ($, ms) => {
    const out = $.let([], SheetRegisterMembersType);
    const seen = $.let(new Set<string>(), SetType(StringType));
    $.for(ms, ($2, m, _i, _label) => {
        $2.if(seen.has(m.key).not(), ($3) => {
            $3(seen.insert(m.key));
            $3(out.pushLast(m));
        });
    });
    return out;
});

/**
 * Projects the host's rows into register members — `Sheet.register.members`.
 *
 * @remarks
 * The accessors are reified ONCE into a describe function which the map
 * then CALLS (`shared/reify.ts`, `EAST_UI_PROP_PATTERNS.md`). Duplicate keys
 * fold, first occurrence wins — a countable-by-attribute kind (`"CNC lathe"`
 * from every machine of that family) declares one member per distinct value.
 *
 * @typeParam T - The data's element type
 * @param data - The rows — an `Array<T>` or a `Dict<String, T>` value or expression
 * @param config - The accessors ({@link SheetMembersConfig})
 * @returns The members, as an expression
 *
 * @example
 * ```ts
 * Sheet.register.members(machines, { kind: "machine", key: m => m.code, label: m => m.code,
 *     meta: m => some(m.family), parent: m => some(m.line) })
 * ```
 */
export function createMembers<T extends EastType>(
    data: SubtypeExprOrValue<ArrayType<T>> | SubtypeExprOrValue<DictType<StringType, T>>,
    config: SheetMembersConfig<T>,
): SheetRegisterValue {
    const expr = East.value(data as SubtypeExprOrValue<ArrayType<EastType>>) as ExprType<ArrayType<EastType>>;
    const t = Expr.type(expr) as { type: string; value?: EastType; key?: EastType };
    if (t.type !== "Array" && t.type !== "Dict") {
        throw new Error(`Sheet.register.members: data must be an Array or a Dict<String, T> — got a ${t.type}`);
    }
    if (t.type === "Dict" && (t.key as { type: string }).type !== "String") {
        throw new Error("Sheet.register.members: a keyed register must be a Dict<String, T> — its keys ride to the accessors as the second argument");
    }
    const elem = t.value as EastType;
    const cfg = config as unknown as SheetMembersConfig<EastType>;
    const describe = East.function([elem, StringType], SheetRegisterMemberType, (_$, v, k) => ({
        key:     cfg.key(v, k),
        label:   cfg.label(v, k),
        kind:    cfg.kind,
        aliases: cfg.aliases !== undefined ? cfg.aliases(v, k) : East.value([], ArrayType(StringType)),
        meta:    cfg.meta !== undefined ? cfg.meta(v, k) : East.value(none, OptionType(StringType)),
        parent:  cfg.parent !== undefined ? cfg.parent(v, k) : East.value(none, OptionType(StringType)),
        tone:    cfg.tone !== undefined ? cfg.tone(v, k) : East.value(none, OptionType(StatusValueType)),
    }));
    const list = t.type === "Dict"
        ? (expr as unknown as ExprType<DictType<StringType, EastType>>).toArray((_$, v, k) => describe(v, k))
        : expr.map((_$, v, i) => describe(v, East.print(i)));
    return dedupeMembers(list as ExprType<ArrayType<SheetRegisterMemberType>>);
}

/**
 * Joins member sets of different kinds into one register — `Sheet.register.concat`.
 *
 * @param parts - The member sets, in order
 * @returns The concatenated members
 */
export function concatMembers(parts: SheetRegisterValue[]): SheetRegisterValue {
    if (parts.length === 0) return East.value([], SheetRegisterMembersType);
    return parts.slice(1).reduce<SheetRegisterValue>(
        (acc, p) => acc.concat(p) as SheetRegisterValue,
        parts[0] as SheetRegisterValue,
    );
}

/**
 * The accessors `Sheet.driver` reifies over one driver row.
 *
 * @typeParam D - The driver's row type
 */
export interface SheetDriverConfig<D extends StructType> {
    /** The member key — what the driver column's cell stores. */
    key: (row: ExprType<D>) => SubtypeExprOrValue<StringType>;
    /** What a chip / candidate prints. */
    label: (row: ExprType<D>) => SubtypeExprOrValue<StringType>;
    /** Alternative spellings. */
    aliases?: (row: ExprType<D>) => SubtypeExprOrValue<ArrayType<StringType>>;
    /** Chip meta — return the field's `Option`. */
    meta?: (row: ExprType<D>) => SubtypeExprOrValue<OptionType<StringType>>;
}

/**
 * The driver declaration — the column, its data, the row type `D` every
 * driver-reading accessor is typed by, and the reified key lookup.
 *
 * @remarks
 * The typed parts (`rowType`, `data`, `keyFn`) never reach the IR: the root
 * applies a column's `uom` / `sides` accessors over `data` and the bridge
 * folds `data` into the `ctx.driver` lookup. Only `column` and `members`
 * ride ({@link SheetDriverType}).
 *
 */
export interface SheetDriverValue {
    /** The driver column's key — must be a `lookup` column on a `String` field. */
    readonly column: string;
    /** The driver's row type (erased here; the builders that read the driver's row take it explicitly). */
    readonly rowType: StructType;
    /** The driver rows. */
    readonly data: ExprType<ArrayType<StructType>>;
    /** The reified key accessor. */
    readonly keyFn: ExprType<FunctionType<[StructType], StringType>>;
    /** The driver's register members. */
    readonly members: SheetRegisterValue;
}

/**
 * Declares the driver — `Sheet.driver(column, data, { key, label })`: the
 * `lookup` column whose member decides what the row does, with its data,
 * so `D` reaches every `uom` / `sides` accessor and `ctx.driver` (§3.3).
 *
 * @typeParam D - The driver's row type (inferred from `data`)
 * @param column - The driver column's key
 * @param data - The driver rows — an `Array<D>` value or expression
 * @param config - The accessors ({@link SheetDriverConfig})
 * @returns The driver declaration the `driver` prop takes
 *
 * @example
 * ```ts
 * Sheet.driver("activity", activities, { key: a => a.name, label: a => a.name })
 * ```
 */
export function createDriver<D extends StructType>(
    column: string,
    data: SubtypeExprOrValue<ArrayType<D>>,
    config: SheetDriverConfig<D>,
): SheetDriverValue {
    const expr = East.value(data as SubtypeExprOrValue<ArrayType<StructType>>) as ExprType<ArrayType<StructType>>;
    const t = Expr.type(expr) as { type: string; value?: EastType };
    if (t.type !== "Array" || (t.value as { type?: string }).type !== "Struct") {
        throw new Error(`Sheet.driver("${column}"): data must be an Array of structs — got a ${t.type}`);
    }
    const rowType = t.value as StructType;
    const cfg = config as unknown as SheetDriverConfig<StructType>;
    const keyFn = East.function([rowType], StringType, (_$, d) => cfg.key(d));
    const members = createMembers(expr, {
        kind:  column,
        key:   (d) => keyFn(d),
        label: (d) => cfg.label(d),
        ...(cfg.aliases !== undefined ? { aliases: (d: ExprType<StructType>) => cfg.aliases!(d) } : {}),
        ...(cfg.meta !== undefined ? { meta: (d: ExprType<StructType>) => cfg.meta!(d) } : {}),
    });
    return { column, rowType, data: expr, keyFn, members };
}
