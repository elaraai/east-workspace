/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Shared author-defined library cards for record-backed builders. */
import {
    ArrayType, DictType, East, Expr, OptionType, StringType, StructType, isTypeEqual, none, printType, some,
    type EastType, type ExprType, type FunctionType, type SubtypeExprOrValue,
} from "@elaraai/east";
import type { ScheduleEventKind } from "./events.js";
import { SchedulePatchTypeFor } from "./patch.js";
import { ScheduleFieldWriteType } from "./types.js";

/** One keyed card, carrying the field writes its drop makes. */
export const ScheduleLibraryCardType = StructType({
    key: StringType,
    label: StringType,
    meta: OptionType(StringType),
    group: OptionType(StringType),
    sets: ArrayType(ScheduleFieldWriteType),
});

/** Type representing {@link ScheduleLibraryCardType}. */
export type ScheduleLibraryCardType = typeof ScheduleLibraryCardType;

/** An author's tab, resolved for a renderer. */
export const ScheduleAuthorTabType = StructType({
    name: StringType, icon: OptionType(StringType), drop: OptionType(StringType), cards: ArrayType(ScheduleLibraryCardType),
});

/** Typed accessors describing one author-defined library card. */
export interface ScheduleLibraryTabConfig<K extends EastType, R extends EastType, P extends EastType = EastType> {
    /** The tab's name: its label in the tab row. */
    name: string;
    /** A Font Awesome solid icon name for the tab's cards. */
    icon?: string;
    /** The card's name. */
    label: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<StringType>;
    /** The line under it — return the field's `Option`. */
    meta?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** The tab's group the card sits under. */
    group?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<StringType>;
    /** What a card dropped on an event sets: `Schedule.patch(KindRowType, …)`, whose type names the event kind it lands on. */
    drop?: (row: ExprType<R>, key: ExprType<K>) => ExprType<P>;
}

/** An author's declared tab, before its accessors are reified. */
export interface ScheduleTabDeclaration {
    /** Identifies an author-defined tab. */
    readonly kind: "tab";
    /** The keyed rows. */
    readonly rows: unknown;
    /** The row accessors. */
    readonly config: ScheduleLibraryTabConfig<EastType, EastType>;
}

/**
 * Resolves author cards and checks the patch type against the event kinds.
 * @param tab - The declared tab
 * @param events - Event kinds by slot
 * @param owner - The builder's name for diagnostics
 * @returns The closed author tab
 * @throws {Error} When rows are not keyed, or a drop matches zero or several kinds
 */
export function buildScheduleTab(tab: ScheduleTabDeclaration, events: readonly (readonly [string, ScheduleEventKind<EastType, EastType>])[], owner: string): ExprType<typeof ScheduleAuthorTabType> {
    const cfg = tab.config;
    const where = owner + ': the "' + cfg.name + '" tab';
    const source = East.value(tab.rows as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const type = Expr.type(source as unknown as Expr) as EastType;
    if (type.type !== "Dict") {
        throw new Error(`${where} reads its rows as Schedule.resources does — a Dict, usually a record's read() — and these are ${printType(type)}`);
    }
    const keyType = type.key as EastType;
    const rowType = type.value as EastType;

    // The drop: reified once, its patch's type naming the event kind it lands on.
    let lands: string | undefined;
    let writes: ExprType<FunctionType<[EastType, EastType], ArrayType<typeof ScheduleFieldWriteType>>> | undefined;
    if (cfg.drop !== undefined) {
        const drop = cfg.drop;
        const dropFn = East.function([rowType, keyType], undefined, (_$, row, key) => drop(row, key));
        const patchType = (Expr.type(dropFn as unknown as Expr) as FunctionType).output as EastType;
        const takers = events.filter(([, kind]) => (kind.rowType as EastType).type === "Struct"
            && isTypeEqual(patchType, SchedulePatchTypeFor(kind.rowType as StructType)));
        if (takers.length === 0) {
            const kinds = events.map(([slot]) => slot).join(", ");
            throw new Error(`${where}'s \`drop\` returns a patch over no event kind's row type — build it with Schedule.patch(RowType, { … }) ` +
                `over the row type of the kind its cards land on (${kinds === "" ? "this " + owner + " has no event kinds" : kinds})`);
        }
        if (takers.length > 1) {
            throw new Error(`${where}'s \`drop\` returns a patch over a row type ${takers.length} event kinds share ` +
                `(${takers.map(([slot]) => slot).join(", ")}) — a card lands on one kind, so give each kind a row type of its own`);
        }
        lands = takers[0]![0];
        // Each field the patch sets, as the kind's field write: its path, and its value's bytes.
        const fields = Object.keys((patchType as StructType).fields as Record<string, EastType>);
        writes = East.function([rowType, keyType], ArrayType(ScheduleFieldWriteType), ($, row, key) => {
            const patchOf = $.const(dropFn);
            const patch = $.const(patchOf(row as never, key as never)) as unknown as Record<string, ExprType<OptionType<EastType>>>;
            const written = $.let([], ArrayType(ScheduleFieldWriteType));
            for (const name of fields) {
                $.match(patch[name]!, {
                    some: ($2, value) => { $2(written.pushLast({ path: [name], value: East.Blob.encodeBeast(value as ExprType<EastType>, "v2") })); },
                });
            }
            return written;
        }) as unknown as ExprType<FunctionType<[EastType, EastType], ArrayType<typeof ScheduleFieldWriteType>>>;
    }

    // A String key is its own text; any other key as East prints it.
    const text = keyType.type === "String"
        ? East.function([StringType], StringType, (_$, key) => key)
        : East.function([keyType], StringType, (_$, key) => East.print(key));
    const describe = East.function([rowType, keyType], ScheduleLibraryCardType, ($, row, key) => {
        const keyText = $.const(text as unknown as ExprType<FunctionType<[EastType], StringType>>);
        const sets = $.let([], ArrayType(ScheduleFieldWriteType));
        if (writes !== undefined) {
            const setsOf = $.const(writes);
            $.assign(sets, setsOf(row as never, key as never));
        }
        return {
            key: keyText(key),
            label: cfg.label(row, key),
            meta: cfg.meta !== undefined ? cfg.meta(row, key) : East.value(none, OptionType(StringType)),
            group: cfg.group !== undefined ? some(cfg.group(row, key)) : East.value(none, OptionType(StringType)),
            sets,
        };
    });
    const cards = (source as unknown as ExprType<DictType<EastType, EastType>>).toArray(($, row, key) => {
        const card = $.const(describe);
        return card(row, key);
    });
    return East.value({
        name: cfg.name,
        icon: cfg.icon === undefined ? none : some(cfg.icon),
        drop: lands === undefined ? none : some(lands),
        cards,
    }, ScheduleAuthorTabType);
}
