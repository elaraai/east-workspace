/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Sheet.library` — the sheet's library pane, the author's (#1186,
 * `Sheet Builder Spec.md` §4.4, SB32, SB59, SB60). `library` lists the
 * pane's tabs, in order, each built here: `Sheet.library.rows()` (the
 * templates), `Sheet.library.columns()` (the columns a viewer shows and
 * hides) and `Sheet.library.tab(data, { … })`, cards of the author's own.
 * Left out, or empty, the sheet has no library pane.
 *
 * An author's tab reads its rows as `Sheet.register.members` does — an
 * `Array<T>` or a `Dict<String, T>`, its accessors reified ONCE into a
 * describe function the map then calls — and its `drop` returns what a
 * dropped card sets, as a template's `values` do: `Sheet.patch` over the row
 * type lands on a row, over the group type on a band. The patch crosses the
 * closed payload as the cells it sets through the sheet's editable columns
 * (or band cells), as a proposed row's does.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    DictType,
    East,
    Expr,
    NullType,
    OptionType,
    SetType,
    StringType,
    StructType,
    VariantType,
    isTypeEqual,
    none,
    some,
    variant,
    type EastType,
    type ExprType,
    type FunctionType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import { SheetCellType, SheetPatchTypeFor } from "./types.js";
import { SheetCellsType, buildPatchCells, type SheetBridge } from "./bridge.js";

// ============================================================================
// The wire
// ============================================================================

/**
 * One card of an author's tab on the wire.
 *
 * @property key - The card's key, unique within its tab
 * @property label - Its name
 * @property meta - The line under its name
 * @property group - The tab's group the card sits under
 * @property sets - What a drop writes: the tab's `drop` patch, through the sheet's editable columns (or a band's cells); empty without a `drop`
 */
export const SheetLibraryCardType = StructType({
    key: StringType,
    label: StringType,
    meta: OptionType(StringType),
    group: OptionType(StringType),
    sets: DictType(StringType, SheetCellType),
});

/** Type representing {@link SheetLibraryCardType}. */
export type SheetLibraryCardType = typeof SheetLibraryCardType;

/** Where an author's tab's cards land: on rows (a grouped sheet's lines), or on a grouped sheet's bands. */
export const SheetLibraryDropType = VariantType({ row: NullType, group: NullType });

/** Type representing {@link SheetLibraryDropType}. */
export type SheetLibraryDropType = typeof SheetLibraryDropType;

/**
 * One tab of the library pane on the wire, in the order `library` lists them.
 *
 * - `rows` — the templates (`templates`), by their group;
 * - `columns` — the declared columns, each with an eye;
 * - `tab` — the author's own: its name, its icon, where its cards land, and its cards.
 */
export const SheetLibraryTabType = VariantType({
    rows: NullType,
    columns: NullType,
    tab: StructType({
        name: StringType,
        icon: OptionType(StringType),
        drop: OptionType(SheetLibraryDropType),
        cards: ArrayType(SheetLibraryCardType),
    }),
});

/** Type representing {@link SheetLibraryTabType}. */
export type SheetLibraryTabType = typeof SheetLibraryTabType;

// ============================================================================
// The author's surface
// ============================================================================

/**
 * An author's tab: its name and icon, and the accessors over one entry of its
 * data — its value and its key — as `Sheet.register.members` takes them
 * (`(_v, k) => k` over a `Dict`; over an `Array` the key is the index,
 * printed).
 *
 * @typeParam T - The data's element type
 * @typeParam P - The patch `drop` returns: `Sheet.Types.Patch` of the row type, or of the group type
 */
export interface SheetLibraryTabConfig<T extends EastType, P extends EastType = EastType> {
    /** The tab's name: its label in the tab row. */
    name: string;
    /** A Font Awesome solid icon name for the tab's cards. */
    icon?: string;
    /** The card's key — unique within the tab; a key that repeats keeps its first card. */
    key: (value: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** The card's name. */
    label: (value: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** The line under it — return the field's `Option`. */
    meta?: (value: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** The tab's group the card sits under. */
    group?: (value: ExprType<T>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** What a dropped card sets: `Sheet.patch(RowType, …)` lands on a row, `Sheet.patch(GroupType, …)` on a grouped sheet's band. */
    drop?: (value: ExprType<T>, key: ExprType<StringType>) => ExprType<P>;
}

/** One tab of the library pane — what each `Sheet.library.*` call returns, and `library` lists. */
export type SheetLibraryTab =
    | { readonly kind: "rows" }
    | { readonly kind: "columns" }
    | { readonly kind: "tab"; readonly data: unknown; readonly config: SheetLibraryTabConfig<EastType> };

/**
 * The library's Rows tab — `Sheet.library.rows()`: the sheet's templates,
 * by their group, each card saying what it sets (SB33).
 *
 * @returns The tab
 */
export function libraryRows(): SheetLibraryTab {
    return { kind: "rows" };
}

/**
 * The library's Columns tab — `Sheet.library.columns()`: the declared
 * columns, each with its kind and an eye that hides it from the grid for the
 * viewer (SB36).
 *
 * @returns The tab
 */
export function libraryColumns(): SheetLibraryTab {
    return { kind: "columns" };
}

/**
 * A tab of the author's own cards — `Sheet.library.tab(data, { … })` (SB60):
 * one card per entry of `data`, read through accessors as
 * `Sheet.register.members` reads a register, and a `drop` that says what a
 * dropped card sets.
 *
 * @typeParam T - The data's element type
 * @typeParam P - The patch `drop` returns
 * @param data - The rows — an `Array<T>` or a `Dict<String, T>` value or expression, a record's `read()`
 * @param config - The tab's name and icon, and the accessors ({@link SheetLibraryTabConfig})
 * @returns The tab
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { ArrayType, DateTimeType, DictType, East, FloatType, OptionType, StringType, StructType, none, some } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Record, Sheet } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const SheetJob = StructType({ task: StringType, start: OptionType(DateTimeType), qty: OptionType(FloatType) });
 * export const sheetJobs = e3.record("sheet_jobs", DictType(StringType, SheetJob), new Map([
 *     ["J-0001", { task: "Panel cutting", start: some(new Date("2026-10-12T00:00:00Z")), qty: some(48.0) }],
 *     ["J-0002", { task: "Edge banding", start: some(new Date("2026-10-13T00:00:00Z")), qty: some(120.0) }],
 *     ["J-0003", { task: "CNC routing", start: none, qty: some(48.0) }],
 *     ["J-0004", { task: "Spray finish", start: none, qty: none }],
 * ]));
 * export const sheetJobsPatch = e3.mutation.patch(sheetJobs);
 * export const LibraryTask = StructType({ name: StringType, stage: StringType });
 *
 * const sheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const jobs = $.let(Record.bind(sheetJobs, [sheetJobsPatch]));
 *         const tasks = $.let([
 *             { name: "Panel cutting", stage: "Cutting" },
 *             { name: "Edge banding",  stage: "Cutting" },
 *             { name: "CNC routing",   stage: "Machining" },
 *             { name: "Sanding",       stage: "Finishing" },
 *             { name: "Spray finish",  stage: "Finishing" },
 *         ], ArrayType(LibraryTask));
 *         return (
 *             <Box height="560px">
 *                 <Sheet
 *                     record={jobs}
 *                     name="library"
 *                     columns={{
 *                         task:  Sheet.column.text(SheetJob, { header: "Task", width: "240px" }),
 *                         start: Sheet.column.date(SheetJob, { header: "Start", width: "96px" }),
 *                         qty:   Sheet.column.quantity(SheetJob, { header: "Qty", width: "96px" }),
 *                     }}
 *                     library={[
 *                         // The tasks a job takes, by their stage: a card dropped on a job sets its task.
 *                         Sheet.library.tab(tasks, { name: "Tasks", icon: "hammer",
 *                             key: t => t.name, label: t => t.name, group: t => t.stage,
 *                             drop: t => Sheet.patch(SheetJob, { task: t.name }) }),
 *                         Sheet.library.columns(),
 *                     ]}
 *                 />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function libraryTab<T extends EastType, P extends EastType = EastType>(
    data: SubtypeExprOrValue<ArrayType<T>> | SubtypeExprOrValue<DictType<StringType, T>>,
    config: SheetLibraryTabConfig<T, P>,
): SheetLibraryTab {
    return { kind: "tab", data, config: config as unknown as SheetLibraryTabConfig<EastType> };
}

// ============================================================================
// The build
// ============================================================================

/** Fold the cards a key repeats on, keeping the FIRST, in the data's order — as a register's members fold. */
const dedupeCards = East.function([ArrayType(SheetLibraryCardType)], ArrayType(SheetLibraryCardType), ($, cards) => {
    const out = $.let([], ArrayType(SheetLibraryCardType));
    const seen = $.let(new Set<string>(), SetType(StringType));
    $.for(cards, ($2, card) => {
        $2.if(seen.has(card.key).not(), ($3) => {
            $3(seen.insert(card.key));
            $3(out.pushLast(card));
        });
    });
    return out;
});

/** How a tab names itself in a refusal. */
function tabName(tab: SheetLibraryTab): string {
    return tab.kind === "tab" ? `the "${tab.config.name}" tab` : `Sheet.library.${tab.kind}()`;
}

/**
 * An author's tab on the wire: its cards, read through its accessors, and
 * where its `drop` patch lands, decided by the patch's type.
 *
 * @param tab - The tab
 * @param bridge - The sheet's bridge, as its root compiled it
 * @returns The tab's wire value
 * @throws Error naming the tab: data that is not an Array or a `Dict<String, T>`, or a `drop` over neither the row type nor the group type
 */
function buildTab(tab: Extract<SheetLibraryTab, { kind: "tab" }>, bridge: SheetBridge): ExprType<SheetLibraryTabType> {
    const cfg = tab.config;
    const expr = East.value(tab.data as SubtypeExprOrValue<ArrayType<EastType>>) as ExprType<ArrayType<EastType>>;
    // The data is an Array or a Dict whatever the cast above says: widen to read its real East type.
    const t = Expr.type(expr) as EastType;
    if (t.type !== "Array" && t.type !== "Dict") {
        throw new Error(`Sheet: ${tabName(tab)}'s data must be an Array or a Dict<String, T> — got a ${t.type}`);
    }
    if (t.type === "Dict" && (t.key as EastType).type !== "String") {
        throw new Error(`Sheet: ${tabName(tab)}'s data must be a Dict<String, T> — its keys ride to the accessors as the second argument`);
    }
    const elem: EastType = t.value;

    // The drop: reified once, its patch's type deciding where a card lands.
    let landing: "row" | "group" | undefined;
    let dropFn: ExprType<FunctionType<[EastType, StringType], StructType>> | undefined;
    let project: SheetBridge["encodePatch"] | undefined;
    if (cfg.drop !== undefined) {
        const drop = cfg.drop;
        dropFn = East.function([elem, StringType], undefined, (_$, v, k) => drop(v, k)) as unknown as ExprType<FunctionType<[EastType, StringType], StructType>>;
        const out = (Expr.type(dropFn) as FunctionType).output as EastType;
        const groupHalf = bridge.group;
        if (isTypeEqual(out, bridge.patchType)) {
            landing = "row";
            project = bridge.encodePatch;
        } else if (groupHalf !== undefined && isTypeEqual(out, SheetPatchTypeFor(groupHalf.groupType))) {
            landing = "group";
            project = buildPatchCells(groupHalf.groupType, groupHalf.cellMetas, {});
        } else {
            throw new Error(`Sheet: ${tabName(tab)}'s \`drop\` returns a patch over neither the row type nor the group type — build it with Sheet.patch(RowType, …)${bridge.group !== undefined ? ", or Sheet.patch(GroupType, …) for a band" : " over the sheet's row type"}`);
        }
    }

    const describe = East.function([elem, StringType], SheetLibraryCardType, ($, v, k) => {
        const sets = dropFn === undefined || project === undefined
            ? $.const(new Map(), SheetCellsType)
            : $.const(($.const(project))(($.const(dropFn))(v, k)), SheetCellsType);
        return {
            key:   cfg.key(v, k),
            label: cfg.label(v, k),
            meta:  cfg.meta !== undefined ? cfg.meta(v, k) : East.value(none, OptionType(StringType)),
            group: cfg.group !== undefined ? some(cfg.group(v, k)) : East.value(none, OptionType(StringType)),
            sets,
        };
    });
    const list = t.type === "Dict"
        ? (expr as unknown as ExprType<DictType<StringType, EastType>>).toArray((_$, v, k) => describe(v, k))
        : expr.map((_$, v, i) => describe(v, East.print(i)));
    return East.value(variant("tab", {
        name: cfg.name,
        icon: cfg.icon === undefined ? none : some(cfg.icon),
        drop: landing === undefined ? none : some(variant(landing, null)),
        cards: dedupeCards(list as ExprType<ArrayType<SheetLibraryCardType>>),
    }), SheetLibraryTabType);
}

/**
 * Builds the library pane on the wire (SB59, SB60): its tabs in the
 * order `library` lists them; none when it is left out.
 *
 * @param tabs - The tabs, each a `Sheet.library.*` call
 * @param bridge - The sheet's bridge, as its root compiled it
 * @returns The tabs on the wire
 * @throws Error naming the tab: a tab listed twice (an author's tab by its name), and each of an author's tab's refusals
 * @internal
 */
export function buildLibrary(tabs: readonly SheetLibraryTab[] | undefined, bridge: SheetBridge): ExprType<ArrayType<SheetLibraryTabType>> {
    const seen = new Set<string>();
    for (const tab of tabs ?? []) {
        const id = tab.kind === "tab" ? `tab:${tab.config.name}` : tab.kind;
        if (seen.has(id)) {
            throw new Error(tab.kind === "tab"
                ? `Sheet: the library lists two tabs named "${tab.config.name}" — each tab's name is its own`
                : `Sheet: the library lists ${tabName(tab)} twice — each tab once`);
        }
        seen.add(id);
    }
    const wires = (tabs ?? []).map((tab): ExprType<SheetLibraryTabType> => tab.kind === "tab"
        ? buildTab(tab, bridge)
        : East.value(variant(tab.kind, null), SheetLibraryTabType));
    return East.value(wires, ArrayType(SheetLibraryTabType));
}
