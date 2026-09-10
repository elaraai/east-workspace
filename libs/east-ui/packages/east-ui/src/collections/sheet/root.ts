/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Sheet.Root` — assembles the whole sheet value against the `Sheet` arm of
 * `component.ts` (`Sheet Spec.md` §4.6): resolves the row source (both
 * arms), describes every column against the row type, compiles the typed
 * bridge (§4.8), builds each column's wire value, compiles `onUpdate` into
 * the edit channel (§4.7), and refuses every mistake of §3.12 naming the
 * column and the remedy.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    AsyncFunctionType,
    BooleanType,
    DictType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    toEastTypeValue,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SliceBindType, SliceChromeType } from "../../platform/slice/index.js";
import { SliceAffordanceType, type SliceAffordanceLiteral } from "../../contracts/slice-affordances.js";
import { DensityType, type DensityLiteral } from "../../style/interaction.js";
import { StatusValueType, type StatusValueLiteral } from "../../feedback/status/types.js";
import { TickFormatType } from "../../format/types.js";
import { resolveRowSource, buildRowSource, type PagedSource } from "../../contracts/source.js";
import { resolveTag } from "../plan/builders.js";
import type { DataRowType } from "../table/index.js";
import {
    SheetRowType,
    SheetRowsCollectionType,
    SheetRegisterType,
    SheetDriverType,
    SheetColumnType,
    SheetColumnKindType,
    SheetMemberKindType,
    SheetMultipleType,
    SheetSideLockType,
    SheetSidesType,
    SheetSidesValueType,
    SheetStoreType,
    SheetCheckType,
    SheetSuggestType,
    SheetViewType,
    SheetSelectionType,
    SheetFooterItemType,
    SheetStyleType,
    SheetEditType,
    type SheetContextOf,
    type SheetProposalOf,
    type SheetEditOf,
    type SheetHalfLiteral,
    type SheetSidesLiteral,
} from "./types.js";
import {
    type SheetColumnMeta,
    type SheetBridge,
    describeColumn,
    buildBridge,
    wrapProvider,
    wrapProposer,
    wrapArity,
    wrapCheck,
    wrapCustomParse,
    wrapCustomPrint,
    wrapOnEdit,
    compileOnUpdate,
    composeEditHandlers,
} from "./bridge.js";
import type { SheetColumn, SheetColumnSpec, SheetFieldKey, SheetMemberKindInput, SheetMultipleInput } from "./columns.js";
import type { SheetDriverValue, SheetRegisterValue } from "./registers.js";
import { isExistsCheck, type SheetLocksInput } from "./link.js";

// ============================================================================
// Options
// ============================================================================

/** The keys of a row struct whose field is a `String` — what `id` may name. */
export type SheetStringField<R extends StructType> = {
    [K in SheetFieldKey<R>]: R["fields"][K] extends StringType ? K : never
}[SheetFieldKey<R>];

/**
 * One row proposer — a synchronous or asynchronous East function over
 * `Sheet.Types.Context(R, D)` to `Array<Sheet.Types.Proposal(R)>` (§3.6).
 * The driver type is checked at build time against the sheet's driver.
 *
 * @typeParam R - The host's row type
 */
export type SheetProposerInput<R extends StructType> =
    | SubtypeExprOrValue<FunctionType<[SheetContextOf<R, any>], ArrayType<SheetProposalOf<R>>>>
    | SubtypeExprOrValue<AsyncFunctionType<[SheetContextOf<R, any>], ArrayType<SheetProposalOf<R>>>>;

/**
 * The copilot's row-proposal declaration (B§5.2).
 *
 * @typeParam R - The host's row type
 * @property ahead - At most this many proposed rows below the anchor (default 2)
 * @property triggers - Column keys whose commit re-asks the proposers (default: every editable column)
 * @property ghost - Draw proposed rows as hatched ghosts (default `true`)
 * @property propose - The proposers; the first that returns rows wins
 */
export interface SheetSuggestInput<R extends StructType> {
    /** At most this many proposed rows below the anchor. */
    ahead?: SubtypeExprOrValue<IntegerType> | number;
    /** Column keys whose commit re-asks the proposers. */
    triggers?: SheetFieldKey<R>[];
    /** Draw proposed rows as hatched ghosts. */
    ghost?: boolean;
    /** The proposers; the first that returns rows wins. */
    propose: SheetProposerInput<R>[];
}

/**
 * The options of `Sheet.Root` / the `<Sheet>` tag's props beside `data` and
 * `columns` (§3).
 *
 * @typeParam R - The host's row type
 * @property id - The `String` field that identifies a row (required on a positional source; a keyed paged source's key is its id)
 * @property owned - Rows the upstream system owns: no copilot, stamped columns read-only — an accessor
 * @property driver - The driver declaration (`Sheet.driver`)
 * @property registers - Register name → members (`Sheet.register.*`)
 * @property suggest - The row-proposal declaration
 * @property slice - The bound slice whose narrowing the lens draws; the rail mounts `affordances`
 * @property affordances - Rail affordances when `slice` is set (default `["search"]`; `brush` / `legend` / `breakdown` refused)
 * @property views - The saved views
 * @property activeView - The active view's id
 * @property onViewsChange - Views changed
 * @property onUpdate - The whole collection with the edit applied (inline arm only)
 * @property onEdit - The raw edit event, typed over the row (either arm)
 * @property onSelect - The ring moved
 * @property selection - Controlled selection (§3.14)
 * @property newRowId - Overrides the renderer's id minting for inserted rows
 * @property readOnly - The whole sheet is read-only
 * @property blanks - Padding rows below the last real one (default 18)
 * @property density - Row rhythm
 * @property footer - Footer items
 * @property style - Sizing and the gutter width
 */
export interface SheetOptions<R extends StructType> {
    /** The `String` field that identifies a row. */
    id?: SheetStringField<R>;
    /** Rows the upstream system owns — an accessor. */
    owned?: (row: ExprType<R>) => SubtypeExprOrValue<BooleanType>;
    /** The driver declaration. */
    driver?: SheetDriverValue;
    /** Register name → members. */
    registers?: Record<string, SheetRegisterValue>;
    /** The row-proposal declaration. */
    suggest?: SheetSuggestInput<R>;
    /** The bound slice whose narrowing the lens draws. */
    slice?: SubtypeExprOrValue<SliceBindType>;
    /** Rail affordances when `slice` is set. */
    affordances?: SliceAffordanceLiteral[];
    /** The saved views. */
    views?: SubtypeExprOrValue<ArrayType<SheetViewType>>;
    /** The active view's id. */
    activeView?: SubtypeExprOrValue<OptionType<StringType>>;
    /** Views changed. */
    onViewsChange?: SubtypeExprOrValue<FunctionType<[ArrayType<SheetViewType>], NullType>>;
    /** The whole collection with the edit applied (inline arm only). */
    onUpdate?: SubtypeExprOrValue<FunctionType<[ArrayType<R>], NullType>>;
    /** The raw edit event, typed over the row. */
    onEdit?: SubtypeExprOrValue<FunctionType<[SheetEditOf<R>], NullType>>;
    /** The ring moved. */
    onSelect?: SubtypeExprOrValue<FunctionType<[SheetSelectionType], NullType>>;
    /** Controlled selection. */
    selection?: SubtypeExprOrValue<OptionType<SheetSelectionType>>;
    /** Overrides the renderer's id minting for inserted rows. */
    newRowId?: SubtypeExprOrValue<FunctionType<[], StringType>>;
    /** The whole sheet is read-only. */
    readOnly?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Padding rows below the last real one. */
    blanks?: SubtypeExprOrValue<IntegerType> | number;
    /** Row rhythm. */
    density?: DensityLiteral | SubtypeExprOrValue<DensityType>;
    /** Footer items. */
    footer?: {
        /** The footer text. */
        text: SubtypeExprOrValue<StringType>;
        /** Optional status tint. */
        tone?: StatusValueLiteral | SubtypeExprOrValue<StatusValueType>;
    }[];
    /** Sizing and the gutter width. */
    style?: {
        /** Definite height (`"fill"` fills the parent). */
        height?: SubtypeExprOrValue<StringType>;
        /** Max-height cap. */
        maxHeight?: SubtypeExprOrValue<StringType>;
        /** The gutter width, a CSS px size. */
        gutterWidth?: SubtypeExprOrValue<StringType>;
    };
}

/** A whole-value bind handle (`State.bind` / `Data.bind`) over `Array<R>` — accepted as `data`. */
export interface SheetBindHandle<R extends StructType> {
    /** The handle's read. */
    read: (...args: never[]) => ExprType<ArrayType<R>>;
}

// ============================================================================
// Root
// ============================================================================

/** The wire member-kind list of a `set` / `link` column. */
function memberKinds(input: SheetMemberKindInput[] | undefined): ExprType<ArrayType<SheetMemberKindType>> {
    return East.value((input ?? []).map((k) => ({
        kind:       k.kind,
        identified: k.identified ?? false,
        countable:  k.countable ?? false,
        resolvesTo: k.resolvesTo !== undefined ? some(k.resolvesTo) : none,
    })), ArrayType(SheetMemberKindType));
}

/** The wire counted-member grammar, with the B§4.1 defaults. */
function multipleOpt(input: SheetMultipleInput | undefined): ExprType<OptionType<SheetMultipleType>> {
    if (input === undefined) return East.value(none, OptionType(SheetMultipleType));
    return East.value(some({
        forms:     input.forms ?? ["N x kind", "kind x N"],
        ops:       input.ops ?? ["x", "X", "*", "×"],
        appliesTo: input.appliesTo ?? "countable",
    }), OptionType(SheetMultipleType));
}

/** The wire lock rules of a link column's sides declaration. */
function lockRules(locks: SheetLocksInput | undefined): ExprType<ArrayType<SheetSideLockType>> {
    const rules: { half: unknown; when: unknown; label: string }[] = [];
    for (const [half, byWhen] of Object.entries(locks ?? {}) as [SheetHalfLiteral, Partial<Record<SheetSidesLiteral, string>>][]) {
        for (const [when, label] of Object.entries(byWhen ?? {}) as [SheetSidesLiteral, string][]) {
            rules.push({ half: variant(half, null), when: variant(when, null), label });
        }
    }
    return East.value(rules as unknown as SubtypeExprOrValue<ArrayType<SheetSideLockType>>, ArrayType(SheetSideLockType));
}

/** `some(x)` at an East type, or `none`. */
function optionOf<T extends EastType>(v: SubtypeExprOrValue<T> | undefined, type: T): ExprType<OptionType<T>> {
    return v !== undefined
        ? East.value(some(v), OptionType(type))
        : East.value(none, OptionType(type));
}

/** Build one column's wire kind value. */
function buildKind(meta: SheetColumnMeta, bridge: SheetBridge, driver: SheetDriverValue | undefined): ExprType<SheetColumnKindType> {
    const cfg = meta.config;
    const kindOf = (tag: string, payload: unknown): ExprType<SheetColumnKindType> =>
        East.value(variant(tag, payload) as unknown as SubtypeExprOrValue<SheetColumnKindType>, SheetColumnKindType);
    switch (meta.kind) {
        case "text":    return kindOf("text", null);
        case "integer": return kindOf("integer", null);
        case "date":    return kindOf("date", {
            base:   optionOf(cfg.base as string | undefined, StringType),
            format: optionOf(cfg.format as SubtypeExprOrValue<StringType> | undefined, StringType),
        });
        case "quantity": {
            let uom: ExprType<OptionType<DictType<StringType, StringType>>> = East.value(none, OptionType(DictType(StringType, StringType)));
            if (cfg.uom !== undefined) {
                if (driver === undefined) {
                    throw new Error(`Sheet: column "${meta.key}" reads \`uom\` off the driver's row, but the sheet declares no driver — pass \`driver={Sheet.driver(…)}\``);
                }
                const uomFn = East.function([driver.rowType], StringType, (_$, d) => cfg.uom!(d));
                const byDriver = driver.data.toDict((_$, d) => driver.keyFn(d), (_$, d) => uomFn(d));
                uom = East.value(some(byDriver), OptionType(DictType(StringType, StringType)));
            }
            return kindOf("quantity", {
                uom,
                format: cfg.format !== undefined
                    ? East.value(some(East.value(cfg.format as SubtypeExprOrValue<TickFormatType>, TickFormatType)), OptionType(TickFormatType))
                    : East.value(none, OptionType(TickFormatType)),
            });
        }
        case "lookup":    return kindOf("lookup", { register: meta.register });
        case "reference": return kindOf("reference", { register: meta.register });
        case "enum":      return kindOf("enum", { register: meta.register });
        case "set": return kindOf("set", {
            register: meta.register,
            members:  memberKinds(cfg.members),
            multiple: multipleOpt(cfg.multiple),
            store:    resolveTag(cfg.store ?? "asTyped", SheetStoreType),
        });
        case "link": {
            let sides: ExprType<OptionType<SheetSidesType>> = East.value(none, OptionType(SheetSidesType));
            if (cfg.sides !== undefined) {
                if (driver === undefined) {
                    throw new Error(`Sheet: column "${meta.key}" reads \`sides\` off the driver's row, but the sheet declares no driver — pass \`driver={Sheet.driver(…)}\``);
                }
                const sidesCfg = cfg.sides;
                const sidesFn = East.function([driver.rowType], SheetSidesValueType, (_$, d) => resolveTag(sidesCfg.value(d), SheetSidesValueType));
                const byDriver = driver.data.toDict((_$, d) => driver.keyFn(d), (_$, d) => sidesFn(d));
                sides = East.value(some({ byDriver, locks: lockRules(sidesCfg.locks) }), OptionType(SheetSidesType));
            }
            return kindOf("link", {
                register: meta.register,
                members:  memberKinds(cfg.members),
                multiple: multipleOpt(cfg.multiple),
                sides,
                arity: cfg.arity !== undefined
                    ? some({ half: variant(cfg.arity.half, null), implied: wrapArity(bridge, meta, cfg.arity.implied) })
                    : none,
                check: East.value((cfg.check ?? []).map((c, i) =>
                    isExistsCheck(c)
                        ? East.value(variant("exists", null), SheetCheckType)
                        : wrapCheck(bridge, meta, c, i)), ArrayType(SheetCheckType)),
                store: resolveTag(cfg.store ?? "asTyped", SheetStoreType),
            });
        }
        case "stamped": return kindOf("stamped", { owner: optionOf(cfg.owner as SubtypeExprOrValue<StringType> | undefined, StringType) });
        case "custom":  return kindOf("custom", {
            accepts: cfg.accepts,
            parse:   wrapCustomParse(bridge, meta, cfg.parse),
            print:   wrapCustomPrint(meta, cfg.print),
        });
    }
}

/**
 * Creates the Sheet root — the whole planning spreadsheet.
 *
 * @typeParam T - The inline data's type (an `Array<R>` value or expression)
 * @param data - The rows: an `Array<R>` value or expression, a whole-value bind handle, or a paged source
 * @param columns - The columns, keyed by the row's fields ({@link SheetColumnSpec})
 * @param options - Everything else ({@link SheetOptions})
 * @returns An East expression of `UIComponentType`
 *
 * @remarks
 * `id` is required on a positional source. `onUpdate` is refused on the
 * paged arm (there is no collection to rebuild — route `onEdit` events to
 * the dataset you page from). A `Dict` inline is refused: a sorted map would
 * sit rows in key order, not the planner's.
 *
 * @example
 * ```ts
 * import { East, ArrayType, DateTimeType, FloatType, OptionType, StringType, StructType, none } from "@elaraai/east";
 * import { Reactive, Sheet, State, UIComponentType } from "@elaraai/east-ui/internal";
 *
 * const JobType = StructType({ id: StringType, start: OptionType(DateTimeType), task: StringType, qty: OptionType(FloatType) });
 *
 * const example = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
 *     const jobs = $.let(State.bind([ArrayType(JobType)], "jobs", [{ id: "j1", start: none, task: "Machining", qty: none }]));
 *     return Sheet.Root(jobs.read(), {
 *         start: Sheet.column.date(JobType, { header: "Start" }),
 *         task:  Sheet.column.text(JobType, { header: "Task" }),
 *         qty:   Sheet.column.quantity(JobType, { header: "Qty" }),
 *     }, { id: "id", onUpdate: jobs.write });
 * })));
 * ```
 */
export function createSheet<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    data: T,
    columns: SheetColumnSpec<DataRowType<T>>,
    options: SheetOptions<DataRowType<T>>,
): ExprType<UIComponentType>;
/** The whole-value bind handle — `data={jobs}` builds the same IR as `data={jobs.read()}`. */
export function createSheet<R extends StructType>(
    data: SheetBindHandle<R>,
    columns: SheetColumnSpec<R>,
    options: SheetOptions<R>,
): ExprType<UIComponentType>;
/** The PAGED arm — positional (`Array<R>` windows) or keyed (`Dict<String, R>` windows, the key is the id). */
export function createSheet<R extends StructType>(
    data: PagedSource<ArrayType<R>> | PagedSource<DictType<StringType, R>>,
    columns: SheetColumnSpec<R>,
    options?: SheetOptions<R>,
): ExprType<UIComponentType>;
export function createSheet(
    data: unknown,
    columns: unknown,
    options?: SheetOptions<StructType>,
): ExprType<UIComponentType> {
    const opts = options ?? {};
    const resolved = resolveRowSource(data, "Sheet");
    const rowType = resolved.elementType as StructType;
    if ((rowType as { type: string }).type !== "Struct") {
        throw new Error(`Sheet: rows must be structs — got ${(rowType as { type: string }).type}`);
    }
    const collectionTag = (resolved.collectionType as { type: string }).type;
    if (resolved.kind === "inline" && collectionTag !== "Array") {
        throw new Error(
            "Sheet: a dictionary's rows sit in key order, not the planner's — pass an Array<R> (or a bind handle of one), " +
            "or page a keyed source (`Paged.of` / `Data.bindPaged` over the Dict)",
        );
    }
    const keyed = resolved.kind === "paged" && collectionTag === "Dict";
    const fields = rowType.fields as Record<string, EastType>;
    const idField = opts.id as string | undefined;
    if (!keyed && idField === undefined) {
        throw new Error("Sheet: `id` is required — the String field that identifies a row (a keyed paged source needs none: its key is the id)");
    }
    if (idField !== undefined) {
        const t = fields[idField];
        if (t === undefined || (t as { type: string }).type !== "String") {
            throw new Error(`Sheet: \`id\` must name a String field of the row — "${idField}" is ${t === undefined ? "not a field" : (t as { type: string }).type}`);
        }
    }

    // Pass 1 — every column against the row type.
    const columnEntries = Object.entries(columns as Record<string, SheetColumn<StructType, EastType> | undefined>)
        .filter((e): e is [string, SheetColumn<StructType, EastType>] => e[1] !== undefined);
    if (columnEntries.length === 0) throw new Error("Sheet: declare at least one column");
    const metas = columnEntries.map(([key, col]) => describeColumn(key, col, rowType));
    const metaByKey = new Map(metas.map((m) => [m.key, m]));
    for (const m of metas) {
        if (m.otherField !== undefined && metaByKey.has(m.otherField)) {
            throw new Error(`Sheet: link column "${m.key}" names "${m.otherField}" as its other half, which is also a column — a half's field is written through the link column, never on its own`);
        }
        if (m.key === idField) throw new Error(`Sheet: the id field "${idField}" cannot also be a column`);
    }

    // The driver — a lookup column on a String field.
    const driver = opts.driver;
    if (driver !== undefined) {
        const dm = metaByKey.get(driver.column);
        if (dm === undefined || dm.kind !== "lookup") {
            throw new Error(`Sheet: the driver column "${driver.column}" must be a \`Sheet.column.lookup\` column — ${dm === undefined ? "it is not a column" : `it is a ${dm.kind} column`}`);
        }
        dm.register = driver.column;
    }
    for (const m of metas) {
        if (m.kind === "lookup" && (driver === undefined || m.key !== driver.column)) {
            throw new Error(`Sheet: column "${m.key}" is a lookup column, which is the driver column — declare \`driver={Sheet.driver("${m.key}", …)}\`, or use \`Sheet.column.reference\` for a plain register lookup`);
        }
        if (m.driverType !== undefined && (driver === undefined || driver.rowType !== m.driverType)) {
            throw new Error(`Sheet: column "${m.key}" was built over a driver row type that is not this sheet's driver's — pass the same type to \`Sheet.column.${m.kind}(RowType, DriverType, …)\` and \`Sheet.driver(…)\`${driver === undefined ? " (the sheet declares no driver)" : ""}`);
        }
    }

    // Registers — by name, plus the driver's under its column name.
    const registers: Record<string, SheetRegisterValue> = { ...(opts.registers ?? {}) };
    if (driver !== undefined) registers[driver.column] = driver.members;
    for (const m of metas) {
        if (m.register !== undefined && registers[m.register] === undefined) {
            throw new Error(`Sheet: column "${m.key}" names register "${m.register}", which \`registers\` does not declare (${Object.keys(registers).join(", ") || "none declared"})`);
        }
    }

    // The bridge.
    const bridge = buildBridge({
        rowType, idField, metas, registers, driver,
        source: resolved.kind === "inline"
            ? { kind: "inline", rows: resolved.rows as ExprType<ArrayType<StructType>> }
            : { kind: "paged", source: resolved.source, keyed },
    });

    // Pass 2 — the wire columns.
    const columnValues = metas.map((m) => East.value({
        key:         m.key,
        header:      m.config.header ?? m.key,
        sub:         optionOf(m.config.sub, StringType),
        width:       optionOf(m.config.width, StringType),
        kind:        buildKind(m, bridge, driver),
        dataType:    toEastTypeValue(m.fieldType),
        payloadType: toEastTypeValue(m.payloadType),
        editable:    m.editable,
        fill:        (m.config.fill ?? []).map((f, i) => wrapProvider(bridge, m, f, i)),
    }, SheetColumnType));

    // The rows — the same projection on both arms.
    const ownedAccessor = opts.owned;
    const ownedFn = East.function([rowType], BooleanType, (_$, r) =>
        ownedAccessor !== undefined ? ownedAccessor(r) : East.value(false, BooleanType));
    const rowOf = East.function([rowType, StringType], SheetRowType, ($, r, id) => {
        const project = $.const(bridge.projectRow);
        const ownedOf = $.const(ownedFn);
        const owned = $.let(ownedOf(r), BooleanType);
        return $.let({ id, owned, cells: project(r) }, SheetRowType);
    });
    const makeKeyed = (collection: ExprType<EastType>) =>
        (collection as unknown as ExprType<DictType<StringType, StructType>>).toArray((_$, v, k) => rowOf(v, k));
    const makePositional = (collection: ExprType<EastType>) =>
        (collection as unknown as ExprType<ArrayType<StructType>>).map((_$, r) =>
            rowOf(r, (r as unknown as Record<string, ExprType<StringType>>)[idField!] as ExprType<StringType>));
    const rowsValue = buildRowSource(resolved, SheetRowsCollectionType, keyed ? makeKeyed : makePositional);

    // The copilot's row proposals.
    const suggest = opts.suggest !== undefined
        ? (() => {
            const s = opts.suggest!;
            for (const t of s.triggers ?? []) {
                if (!metaByKey.has(t as string)) throw new Error(`Sheet: suggest.triggers names "${String(t)}", which is not a column`);
            }
            return East.value(some({
                ahead:    typeof s.ahead === "number" ? BigInt(s.ahead) : (s.ahead ?? 2n),
                triggers: East.value((s.triggers ?? metas.filter((m) => m.editable).map((m) => m.key)) as string[], ArrayType(StringType)),
                ghost:    s.ghost ?? true,
                propose:  s.propose.map((p, i) => wrapProposer(bridge, p, i)),
            }), OptionType(SheetSuggestType));
        })()
        : East.value(none, OptionType(SheetSuggestType));

    // The slice chrome — search, filter, cohort; nothing with an axis.
    for (const a of opts.affordances ?? []) {
        if (a === "brush" || a === "legend" || a === "breakdown") {
            throw new Error(`Sheet does not support the '${a}' affordance — it has no axis and no series. Mount search, filter or cohort.`);
        }
    }
    const slice = opts.slice !== undefined
        ? East.value(some({
            slice: opts.slice,
            affordances: East.value((opts.affordances ?? ["search"]).map((a) => variant(a, null)), ArrayType(SliceAffordanceType)),
        }), OptionType(SliceChromeType))
        : East.value(none, OptionType(SliceChromeType));
    if (opts.affordances !== undefined && opts.slice === undefined) {
        throw new Error("Sheet: `affordances` needs `slice` — the rail mounts them on the bound slice");
    }

    // Edits — `onUpdate` compiles to the wire channel; a typed `onEdit` is bridged; both compose.
    if (opts.onUpdate !== undefined && resolved.kind === "paged") {
        throw new Error("Sheet: `onUpdate` cannot be combined with a paged source — the whole-value rebuild needs the whole collection; use `onEdit` and route the events to the dataset you page from");
    }
    const observe = opts.onEdit !== undefined ? wrapOnEdit(bridge, opts.onEdit) : undefined;
    const write = opts.onUpdate !== undefined && resolved.kind === "inline"
        ? compileOnUpdate(bridge, resolved.rows as ExprType<ArrayType<StructType>>, idField!, opts.onUpdate)
        : undefined;
    const onEdit = composeEditHandlers(observe, write);

    const footer = East.value((opts.footer ?? []).map((f) => ({
        text: f.text,
        tone: f.tone !== undefined ? some(resolveTag(f.tone, StatusValueType)) : none,
    })), ArrayType(SheetFooterItemType));
    const style = opts.style !== undefined
        ? East.value(some({
            height:      optionOf(opts.style.height, StringType),
            maxHeight:   optionOf(opts.style.maxHeight, StringType),
            gutterWidth: optionOf(opts.style.gutterWidth, StringType),
        }), OptionType(SheetStyleType))
        : East.value(none, OptionType(SheetStyleType));

    return East.value(variant("Sheet", {
        rows:          rowsValue,
        columns:       East.value(columnValues, ArrayType(SheetColumnType)),
        registers:     East.value(new Map(Object.entries(registers).map(([name, members]) => [name, East.value({ members }, SheetRegisterType)])), DictType(StringType, SheetRegisterType)),
        driver:        driver !== undefined
            ? East.value(some({ column: driver.column, members: driver.members }), OptionType(SheetDriverType))
            : East.value(none, OptionType(SheetDriverType)),
        suggest,
        slice,
        views:         East.value(opts.views ?? [], ArrayType(SheetViewType)),
        activeView:    opts.activeView !== undefined ? East.value(opts.activeView, OptionType(StringType)) : East.value(none, OptionType(StringType)),
        onViewsChange: opts.onViewsChange !== undefined
            ? some(East.value(opts.onViewsChange, FunctionType([ArrayType(SheetViewType)], NullType)))
            : none,
        onEdit:        onEdit !== undefined ? some(onEdit) : East.value(none, OptionType(FunctionType([SheetEditType], NullType))),
        onSelect:      opts.onSelect !== undefined
            ? some(East.value(opts.onSelect, FunctionType([SheetSelectionType], NullType)))
            : none,
        selection:     opts.selection !== undefined ? East.value(opts.selection, OptionType(SheetSelectionType)) : East.value(none, OptionType(SheetSelectionType)),
        newRowId:      opts.newRowId !== undefined ? some(East.value(opts.newRowId, FunctionType([], StringType))) : none,
        readOnly:      opts.readOnly !== undefined ? some(opts.readOnly) : none,
        blanks:        opts.blanks !== undefined ? some(typeof opts.blanks === "number" ? BigInt(opts.blanks) : opts.blanks) : none,
        density:       opts.density !== undefined ? some(resolveTag(opts.density, DensityType)) : none,
        footer,
        style,
    }), UIComponentType);
}
