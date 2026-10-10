/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType, BooleanType, East, Expr, FloatType, OptionType, StringType, StructType, none, some,
    type DictType, type EastType, type ExprType, type FunctionType, type SubtypeExprOrValue,
} from "@elaraai/east";

/** A card's permitted assignment changes. An absent field leaves it untouched. */
export const RosterPatchType = StructType({
    position: OptionType(StringType), activity: OptionType(OptionType(StringType)),
    offset: OptionType(FloatType), overtime: OptionType(FloatType), agreed: OptionType(OptionType(BooleanType)),
});
/** One resolved author card; its original key is retained as East text. */
export const RosterCardType = StructType({
    key: StringType, label: StringType, meta: OptionType(StringType), group: OptionType(StringType), patch: OptionType(RosterPatchType),
});
/** An author-defined tab, resolved without UI or editing programs. */
export const RosterAuthorTabType = StructType({ name: StringType, icon: OptionType(StringType), cards: ArrayType(RosterCardType) });

/** Fields a library card can set on a named assignment. */
export interface RosterPatchOptions {
    /** Position key. */
    position?: SubtypeExprOrValue<StringType>;
    /** Activity key, or none to clear it. */
    activity?: SubtypeExprOrValue<OptionType<StringType>>;
    /** Start offset in hours. */
    offset?: SubtypeExprOrValue<FloatType>;
    /** Additional hours. */
    overtime?: SubtypeExprOrValue<FloatType>;
    /** Explicit agreement, or none to clear it. */
    agreed?: SubtypeExprOrValue<OptionType<BooleanType>>;
}
/**
 * Describes an author card's assignment changes, retaining every unlisted field.
 * @param fields - Position, activity or changed hours and agreement
 * @returns A typed patch for Roster.library.tab's drop accessor
 * @remarks Slot and person identity cannot be changed by a card patch.
 */
export function rosterPatch(fields: RosterPatchOptions): ExprType<typeof RosterPatchType> {
    for (const key of Object.keys(fields)) {
        if (!["position", "activity", "offset", "overtime", "agreed"].includes(key)) throw new Error(`Roster.patch: ${key} cannot be changed by a library card`);
    }
    return East.value({
        position: fields.position === undefined ? none : some(fields.position),
        activity: fields.activity === undefined ? none : some(fields.activity),
        offset: fields.offset === undefined ? none : some(fields.offset),
        overtime: fields.overtime === undefined ? none : some(fields.overtime),
        agreed: fields.agreed === undefined ? none : some(fields.agreed),
    }, RosterPatchType);
}
/** Typed accessors for cards over an author's keyed data. */
export interface RosterLibraryTabConfig<K extends EastType, R extends EastType> {
    /** Tab label. */
    name: string;
    /** Font Awesome solid icon name. */
    icon?: string;
    /** Card label. */
    label: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<StringType>;
    /** Optional second line. */
    meta?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** Group heading. */
    group?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<StringType>;
    /** Restricted assignment patch produced when the card is placed. */
    drop?: (row: ExprType<R>, key: ExprType<K>) => SubtypeExprOrValue<typeof RosterPatchType>;
}
/** One library declaration. Omit the library to omit its pane. */
export type RosterLibraryTab = { readonly kind: "people" | "activities" } | {
    readonly kind: "tab"; readonly rows: unknown; readonly config: RosterLibraryTabConfig<EastType, EastType>;
};
/** Declares the shared staff library, including configured agency requests. */
export function rosterPeopleTab(): RosterLibraryTab { return { kind: "people" }; }
/** Declares the skills and duties library. */
export function rosterActivitiesTab(): RosterLibraryTab { return { kind: "activities" }; }
/**
 * Declares an author tab over keyed data, including bound records.
 * @typeParam K - Original key type
 * @typeParam R - Card row type
 * @param rows - Keyed cards
 * @param config - Card accessors and optional assignment patch
 * @returns A tab declaration for Roster's library prop
 */
export function rosterLibraryTab<K extends EastType, R extends EastType>(
    rows: SubtypeExprOrValue<DictType<K, R>>, config: RosterLibraryTabConfig<K, R>,
): RosterLibraryTab {
    return { kind: "tab", rows, config: config as unknown as RosterLibraryTabConfig<EastType, EastType> };
}
/** Reifies each author's accessors once, then resolves the keyed cards. @internal */
export function buildRosterTab(tab: Extract<RosterLibraryTab, { kind: "tab" }>): ExprType<typeof RosterAuthorTabType> {
    const rows = East.value(tab.rows as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const type = Expr.type(rows as Expr) as EastType;
    if (type.type !== "Dict") throw new Error(`Roster: library tab "${tab.config.name}" requires keyed rows`);
    const keyType = type.key as EastType;
    const rowType = type.value as EastType;
    const text = keyType.type === "String" ? East.function([StringType], StringType, (_$, key) => key)
        : East.function([keyType], StringType, (_$, key) => East.print(key));
    const card = East.function([rowType, keyType], RosterCardType, ($, row, key) => {
        const keyText = $.const(text as ExprType<FunctionType<[EastType], StringType>>);
        return {
            key: keyText(key), label: tab.config.label(row, key),
            meta: tab.config.meta?.(row, key) ?? none,
            group: tab.config.group === undefined ? none : some(tab.config.group(row, key)),
            patch: tab.config.drop === undefined ? none : some(tab.config.drop(row, key)),
        };
    });
    return East.value({
        name: tab.config.name, icon: tab.config.icon === undefined ? none : some(tab.config.icon),
        cards: (rows as ExprType<DictType<EastType, EastType>>).toArray(($, row, key) => {
            const describe = $.const(card); return describe(row, key);
        }),
    }, RosterAuthorTabType);
}
