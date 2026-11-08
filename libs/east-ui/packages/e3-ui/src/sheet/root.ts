/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The sheet's root — assembles the grid's whole root ({@link SheetRootType},
 * `Sheet Spec.md` §4.6), which `<Sheet>`'s payload carries (`sheet.ts`):
 * resolves the row source (both arms), describes every column against the
 * row type, compiles the typed bridge (§4.8), builds each column's wire
 * value, compiles `onUpdate` into the checked batch adapter (§4.7), and
 * refuses every mistake naming the column and the remedy.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    type VariantType,
    East,
    Expr,
    ArrayType,
    AsyncFunctionType,
    BooleanType,
    DateTimeType,
    DictType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    SetType,
    StringType,
    StructType,
    isTypeEqual,
    printType,
    toEastTypeValue,
    variant,
    some,
    none,
} from "@elaraai/east";

import { DensityType, StatusValueType, type DensityLiteral, type StatusValueLiteral } from "@elaraai/east-ui";
import {
    RecordSlicesChromeType,
    TickFormatType,
    buildRowSource,
    resolveRowSource,
    resolveTag,
    type DataRowType,
    type PagedSource,
} from "@elaraai/east-ui/internal";
import {
    SheetRootType,
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
    SheetRecordViewType,
    SheetSelectionType,
    SheetFooterItemType,
    SheetStyleType,
    SheetNarrowType,
    SheetGroupType,
    SheetGroupCellType,
    SheetNounType,
    SheetOptionsRuleType,
    SheetLookType,
    SheetAuditModeType,
    SHEET_TITLE_CELL,
    sheetLinesOf,
    sheetRuleCell,
    type SheetAnyContextOf,
    type SheetProposalOf,
    type SheetPatchOf,
    type SheetLinesField,
    type SheetLineOf,
    type SheetEntryOf,
    type SheetHalfLiteral,
    type SheetSidesLiteral,
    type SheetAgeUnitLiteral,
} from "./types.js";
import {
    type SheetColumnMeta,
    type SheetBridge,
    type SheetHold,
    describeColumn,
    describeGroupCell,
    buildBridge,
    wrapProvider,
    wrapProposer,
    wrapArity,
    wrapCheck,
    wrapOptions,
    wrapCustomParse,
    wrapCustomPrint,
    buildPatchCells,
} from "./bridge.js";
import { buildActionKind } from "./actions.js";
import { RECORD_COLUMN_KINDS, type SheetColumn, type SheetColumnSpec, type SheetFieldKey, type SheetMemberKindInput, type SheetMultipleInput } from "./columns.js";
import { dedupeMembers, groupMembers, type SheetDriverValue, type SheetRegisterValue } from "./registers.js";
import type { SheetGroupValue } from "./group.js";
import type { SheetSubRowsValue } from "./sub-rows.js";
import type { SheetEditsInput } from "./edits.js";
import { buildSheetEditing } from "./editing-bridge.js";
import { unsettableFields } from "./fields.js";
import { SheetApplyResultType, SheetNewRowType, SheetNewGroupType, SheetReadinessType, type SheetDraftOf, type SheetChangeSetTypeFor } from "./transactions.js";
import type { SheetPatchEventTypeFor, SheetDraftEntryOf } from "./drafts.js";
import { orderedRowSource, type OrderedRowSource } from "../utils/ordered-source.js";
import { scheduleLastKey } from "../schedule/window.js";
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
 * @typeParam R - The host's row type (a grouped sheet: the line type)
 */
export type SheetProposerInput<R extends StructType> =
    | SubtypeExprOrValue<FunctionType<[SheetAnyContextOf<R>], ArrayType<SheetProposalOf<R>>>>
    | SubtypeExprOrValue<AsyncFunctionType<[SheetAnyContextOf<R>], ArrayType<SheetProposalOf<R>>>>;

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

/** Business readiness checks add requirements without bypassing structural validity.
 * @typeParam R - The row struct (a grouped sheet's child struct)
 * @typeParam G - The group draft schema, when grouping is enabled
 */
export interface SheetReadyInput<R extends StructType, G extends EastType = never> {
    /**
     * Check a row draft and its current draft-aware context. Every check of
     * one evaluation runs in one call over the same `rows` (#882): read
     * them, never sort or edit them in place, or the checks after it see the
     * change. A check that throws marks its own row invalid.
     */
    row?: SubtypeExprOrValue<FunctionType<[SheetDraftOf<R>, SheetAnyContextOf<R>], typeof SheetReadinessType>>;
    /** Check the group's own draft fields; child issues are checked separately. */
    group?: [G] extends [never] ? never : SubtypeExprOrValue<FunctionType<[G], typeof SheetReadinessType>>;
}

/**
 * The sheet's own options (§3) — `<Sheet>`'s props beside its rows (`record`
 * or `data`, or its `slice`'s `rows` source), its `columns`, its panes, its
 * narrowing, its views and its name.
 *
 * @typeParam R - The host's row type
 * @typeParam K - The rows' key type: a record's own, else `String` — the keys `newKey` takes and gives
 * @property id - The `String` field that identifies a row of `data` (required on a positional source; a keyed paged source's key is its id)
 * @property owned - Rows the upstream system owns: no copilot, stamped columns read-only — an accessor
 * @property driver - The driver declaration (`Sheet.driver`)
 * @property registers - Register name → members (`Sheet.register.*`)
 * @property suggest - The row-proposal declaration
 * @property activeView - The active view's id
 * @property onUpdate - The whole collection with the edit applied (inline arm only)
 * @property onSelect - The ring moved
 * @property selection - Controlled selection (§3.14)
 * @property newKey - A new row's key, the app's: given the keys taken, one that is not
 * @property group - Never on a flat sheet — grouped rows take {@link SheetGroupedOptions}
 * @property subRows - Read-only sub rows under each row, from its array fields (`Sheet.subRows`, #844)
 * @property readOnly - The whole sheet is read-only
 * @property blanks - Padding rows below the last real one (default 18)
 * @property density - Row rhythm
 * @property footer - Footer items
 * @property style - The gutter width
 * @property narrow - On a phone: any column it pins at the left, and how many it shows at once ({@link SheetNarrowInput})
 */
export interface SheetOptions<R extends StructType, K extends EastType = StringType> {
    /** Structural capabilities; defaults depend on grouping and source ordering. */
    edits?: SheetEditsInput;
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
    /** The active view's id. */
    activeView?: SubtypeExprOrValue<OptionType<StringType>>;
    /** The whole collection with the edit applied (inline arm only). */
    onUpdate?: SubtypeExprOrValue<FunctionType<[ArrayType<R>], NullType>>;
    /** Observe one gesture's draft and domain patches; this does not authorize writes. */
    onPatch?: SubtypeExprOrValue<FunctionType<[ReturnType<typeof SheetPatchEventTypeFor<R>>], NullType>>;
    /** Submit one checked, idempotent batch to the authoritative source. */
    onApply?: SubtypeExprOrValue<FunctionType<[ReturnType<typeof SheetChangeSetTypeFor<R>>], typeof SheetApplyResultType>>
        | SubtypeExprOrValue<AsyncFunctionType<[ReturnType<typeof SheetChangeSetTypeFor<R>>], typeof SheetApplyResultType>>;
    /** The ring moved. */
    onSelect?: SubtypeExprOrValue<FunctionType<[SheetSelectionType], NullType>>;
    /** Controlled selection. */
    selection?: SubtypeExprOrValue<OptionType<SheetSelectionType>>;
    /** Additional author requirements; structural completeness always remains mandatory. */
    ready?: SheetReadyInput<R>;
    /** Explicit defaults for new rows, including required fields without columns. */
    newRow?: SubtypeExprOrValue<FunctionType<[typeof SheetNewRowType], SheetPatchOf<R>>>;
    /**
     * A new row's key, in the app's own scheme: given the keys taken — every key the sheet has read, and every one its
     * batch has drafted — one that is not. Without it a String key is a UUID, and an Integer one one past the largest
     * (#1549): of the keys taken, and of the last key a source paging the record's own entries serves. Any other key
     * needs it.
     */
    newKey?: SubtypeExprOrValue<FunctionType<[SetType<K>], K>>;
    /** Never on a flat sheet — grouped rows take {@link SheetGroupedOptions}. */
    group?: never;
    /** Read-only sub rows under each row, from its array fields. */
    subRows?: SheetSubRowsValue<R>;
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
    /** The gutter width. The sheet fills the box it is given, and scrolls its own rows there. */
    style?: {
        /** The gutter width, a CSS px size. */
        gutterWidth?: SubtypeExprOrValue<StringType>;
    };
    /** On a phone: any column it pins at the left, and how many it shows at once. */
    narrow?: SheetNarrowInput<SheetFieldKey<R>>;
}

/**
 * The Sheet on a phone (`Mobile Sheet Spec.md` §9): a frame 560 px wide or
 * narrower shows a window of its columns, which its pager pages, and pins no
 * column unless `pin` names one (ruled 3 Nov 2026) — then that column leads
 * the row at the left, 150 wide, beside the window of the others. Above
 * 560 px it does nothing.
 *
 * @typeParam K - The columns' keys
 * @property pin - The column the phone pins at the left (default: none pinned)
 * @property columns - How many columns the window shows at once beside any pinned one, 1 to 3 (default 2)
 */
export interface SheetNarrowInput<K extends string = string> {
    /** The column the phone pins at the left; none is pinned without it. */
    pin?: K;
    /** How many columns the window shows at once beside any pinned one, 1 to 3. */
    columns?: 1 | 2 | 3;
}

/** A secondary-index view edits by original primary identity. */
export interface SheetIndexedOptions<K extends EastType, R extends StructType> extends Omit<SheetOptions<R, K>, "onApply"> {
    /** Checked keyed batch, usually Record.onApply(record, { keyed: true }). */
    onApply?: SubtypeExprOrValue<FunctionType<[ReturnType<typeof SheetChangeSetTypeFor<R, K>>], typeof SheetApplyResultType>>
        | SubtypeExprOrValue<AsyncFunctionType<[ReturnType<typeof SheetChangeSetTypeFor<R, K>>], typeof SheetApplyResultType>>;
}

/**
 * The options of a GROUPED sheet (#740) — `<Sheet data={plans}
 * group={Sheet.group(P, "lines", …)} …>`: the group `P` is the row,
 * `columns` are declared over the line type its lines field holds, and the
 * edit channel addresses lines within their group.
 *
 * @typeParam P - The group's row type
 * @typeParam F - The lines field
 * @typeParam K - The groups' key type: a record's own, else `String` — the keys `newKey` takes and gives
 * @property group - The group declaration (`Sheet.group`)
 * @property suggest - The row-proposal declaration, over the LINE type
 * @property onUpdate - The whole collection of groups with the edit applied (inline arm only)
 * @property subRows - Read-only sub rows under each LINE, declared over the line type (#844)
 */
export interface SheetGroupedOptions<P extends StructType, F extends SheetLinesField<P>, K extends EastType = StringType>
    extends Omit<SheetOptions<P, K>, "group" | "suggest" | "onPatch" | "newRow" | "ready" | "subRows" | "narrow"> {
    /** On a phone: any line column it pins at the left, and how many it shows at once. */
    narrow?: SheetNarrowInput<SheetFieldKey<SheetLineOf<P, F>>>;
    /** Additional row and group requirements over complete field drafts. */
    ready?: SheetReadyInput<SheetLineOf<P, F>, SheetDraftEntryOf<P, F>>;
    /** Explicit defaults for each new child row. */
    newRow?: SubtypeExprOrValue<FunctionType<[typeof SheetNewRowType], SheetPatchOf<SheetLineOf<P, F>>>>;
    /** Explicit defaults for a new group. */
    newGroup?: SubtypeExprOrValue<FunctionType<[typeof SheetNewGroupType], SheetPatchOf<P>>>;
    /** The group declaration. */
    group: SheetGroupValue<P, F>;
    /** The row-proposal declaration, over the line type. */
    suggest?: SheetSuggestInput<SheetLineOf<P, F>>;
    /** Observe a gesture with drafts over this group's child array. */
    onPatch?: SubtypeExprOrValue<FunctionType<[ReturnType<typeof SheetPatchEventTypeFor<P, F>>], NullType>>;
    /** Read-only sub rows under each line, declared over the line type. */
    subRows?: SheetSubRowsValue<SheetLineOf<P, F>>;
}

/**
 * The options of a sheet with LOOSE rows between its groups (#846) —
 * `<Sheet data={entries} group={Sheet.group(P, "lines", …)} …>` over
 * entries `Sheet.Types.Entry(P, "lines")`: each entry a group, or a row
 * of the line type standing between the groups. Everything a grouped sheet
 * takes, with `id`, `owned` and the write-back over the entry.
 *
 * @typeParam P - The group's row type
 * @typeParam F - The lines field
 * @property id - The `String` field that identifies an entry — a field of both the group type and the line type (a keyed paged source needs none: its key is the id)
 * @property owned - Entries the upstream system owns — an accessor over the entry
 * @property onUpdate - The whole collection of entries with the batch applied (inline arm only)
 * @property onPatch - Observe one gesture's draft and domain patches over the entries
 * @property onApply - Submit one checked, idempotent batch of entries
 */
export interface SheetEntriesOptions<P extends StructType, F extends SheetLinesField<P>> extends Omit<SheetGroupedOptions<P, F>, "id" | "owned" | "onUpdate" | "onPatch" | "onApply"> {
    /** The `String` field that identifies an entry — a field of both the group type and the line type. */
    id?: SheetStringField<P> & SheetStringField<SheetLineOf<P, F>>;
    /** Entries the upstream system owns — an accessor over the entry. */
    owned?: (entry: ExprType<SheetEntryOf<P, F>>) => SubtypeExprOrValue<BooleanType>;
    /** The whole collection of entries with the batch applied (inline arm only). */
    onUpdate?: SubtypeExprOrValue<FunctionType<[ArrayType<SheetEntryOf<P, F>>], NullType>>;
    /** Observe one gesture's draft and domain patches over the entries; this does not authorize writes. */
    onPatch?: SubtypeExprOrValue<FunctionType<[ReturnType<typeof SheetPatchEventTypeFor<SheetEntryOf<P, F>>>], NullType>>;
    /** Submit one checked, idempotent batch of entries to the authoritative source. */
    onApply?: SubtypeExprOrValue<FunctionType<[ReturnType<typeof SheetChangeSetTypeFor<SheetEntryOf<P, F>>>], typeof SheetApplyResultType>>
        | SubtypeExprOrValue<AsyncFunctionType<[ReturnType<typeof SheetChangeSetTypeFor<SheetEntryOf<P, F>>>], typeof SheetApplyResultType>>;
}

/**
 * Either arm's options, erased — what the implementation reads: the sheet's
 * own, and its views and their write-back, which `<Sheet>` reads off its
 * `views` handle (`views.ts`).
 */
type SheetAnyOptions = Omit<SheetOptions<StructType>, "group" | "suggest" | "onPatch" | "newRow" | "ready" | "subRows" | "narrow"> & {
    narrow?: SheetNarrowInput;
    subRows?: SheetSubRowsValue<StructType>;
    ready?: { row?: unknown; group?: unknown };
    group?: SheetGroupValue<StructType, string>;
    suggest?: SheetSuggestInput<StructType>;
    onPatch?: unknown;
    newRow?: unknown;
    newGroup?: unknown;
    views?: SubtypeExprOrValue<ArrayType<SheetRecordViewType>>;
    onViewsChange?: SubtypeExprOrValue<FunctionType<[ArrayType<SheetRecordViewType>], NullType>>;
};

/**
 * What only e3-ui's own factories pass a sheet's root, never an author's prop
 * (#1182): a record's rows, as `<Sheet record>` reads them, and the
 * narrowing's chrome `<Sheet slice>` checked (#1345).
 *
 * @internal
 */
export interface SheetInternalOptions {
    /** The rows are a record's whole Dict, read in key order: a keyed inline source, as a keyed paged one is. */
    keyOrdered?: boolean;
    /** The Apply over the session's keyed batches as they come, `ChangeSet(R, K)`: a record's `Record.onApply(record, { keyed: true })`. */
    applyKeyed?: unknown;
    /** The session's source identity, when the factory names it: a record, or one entry of it, or the `rows` source's record. */
    sourceId?: SubtypeExprOrValue<StringType>;
    /** The narrowing's chrome: one rail over the sheet's `Slice.bindRecords`, checked by `<Sheet>`. */
    slice?: SubtypeExprOrValue<OptionType<RecordSlicesChromeType>>;
    /** Binds each of the bridge's functions once in the block the sheet is built in, for every wire function built
     *  from it to refer to (`<Sheet>`'s block); without it each is written where it is used. */
    hold?: SheetHold;
    /** The columns may be the Record's kinds — title, person, boolean, toggle, cycle, age, audit — which only the Record's grid draws: `<Record>`'s build. */
    recordKinds?: boolean;
    /** The inspector's hints, when `<Sheet>` shows the pane — `fields` a row's, `groupFields` a group's: what its form lets a person set on a new entry (#1536). Left out, the sheet has no inspector. */
    inspector?: { fields?: Readonly<Record<string, unknown>> | undefined; groupFields?: Readonly<Record<string, unknown>> | undefined };
}

/** A whole-value bind handle (`State.bind` / `Data.bind`) over `Array<R>` — accepted as `data`; `R` a row struct, or an entry `Sheet.Types.Entry(P, "lines")` (#846). */
export interface SheetBindHandle<R extends EastType> {
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
        ranged:     k.ranged ?? false,
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

/** The wire key of a column's rule cell, when the column declares that rule (#844). */
function ruleCellKey(meta: SheetColumnMeta, rule: "level" | "actual" | "detail"): ExprType<OptionType<StringType>> {
    const key = sheetRuleCell(rule, meta.key);
    return optionOf((meta.ruleCells ?? []).some((c) => c.key === key) ? key : undefined, StringType);
}

/** What an action column's kind needs beside the column and the bridge (#1474). */
interface SheetActionKindContext {
    /** Every declared column. */
    metas: readonly SheetColumnMeta[];
    /** The registers, by name. */
    registers: Record<string, SheetRegisterValue>;
    /** A grouped sheet's band cells, described against the group. */
    groupCells?: SheetColumnMeta[] | undefined;
}

/**
 * Build one column's wire kind value — a column from data's for one of its
 * columns, `cellKey` that column's key, which the cells an audit's change
 * projects beside its own are keyed by.
 */
function buildKind(meta: SheetColumnMeta, bridge: SheetBridge, driver: SheetDriverValue | undefined, actions?: SheetActionKindContext, cellKey?: ExprType<StringType>): ExprType<SheetColumnKindType> {
    const cfg = meta.config;
    const options = cfg.options !== undefined
        ? East.value(some(wrapOptions(bridge, meta, cfg.options)), OptionType(SheetOptionsRuleType))
        : East.value(none, OptionType(SheetOptionsRuleType));
    const kindOf = (tag: string, payload: unknown): ExprType<SheetColumnKindType> =>
        East.value(variant(tag, payload) as unknown as SubtypeExprOrValue<SheetColumnKindType>, SheetColumnKindType);
    switch (meta.kind) {
        case "text":    return kindOf("text", null);
        case "integer": return kindOf("integer", null);
        case "date":    return kindOf("date", {
            base:   optionOf(cfg.base as string | undefined, StringType),
            format: optionOf(cfg.format as SubtypeExprOrValue<StringType> | undefined, StringType),
            level:  ruleCellKey(meta, "level"),
            actual: ruleCellKey(meta, "actual"),
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
                unit: optionOf(cfg.unit, StringType),
                format: cfg.format !== undefined
                    ? East.value(some(East.value(cfg.format as SubtypeExprOrValue<TickFormatType>, TickFormatType)), OptionType(TickFormatType))
                    : East.value(none, OptionType(TickFormatType)),
            });
        }
        case "lookup":    return kindOf("lookup", { register: meta.register, options });
        case "reference": return kindOf("reference", { register: meta.register });
        case "enum":      return kindOf("enum", { register: meta.register, options });
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
                options,
            });
        }
        case "stamped": return kindOf("stamped", { owner: optionOf(cfg.owner as SubtypeExprOrValue<StringType> | undefined, StringType) });
        case "action": {
            if (actions === undefined) throw new Error(`Sheet: "${meta.key}" is an action column — a band draws no action cell`);
            // A group patch lands as the band's cells, read-only ones too: the action writes them.
            const groupType = bridge.group?.groupType;
            const encodeGroup = groupType !== undefined && actions.groupCells !== undefined
                ? buildPatchCells(groupType, actions.groupCells, actions.registers, false)
                : undefined;
            return kindOf("action", buildActionKind({
                meta, bridge, metas: actions.metas, registers: actions.registers,
                groupCells: actions.groupCells, encodeGroup,
            }));
        }
        case "custom":  return kindOf("custom", {
            accepts: cfg.accepts,
            parse:   wrapCustomParse(bridge, meta, cfg.parse),
            print:   wrapCustomPrint(meta, cfg.print),
        });
        case "title":   return kindOf("title", { avatar: cfg.avatar === true });
        case "person":  return kindOf("person", { register: meta.register, unassigned: optionOf(cfg.unassigned, StringType) });
        case "boolean": return kindOf("boolean", null);
        case "toggle":  return kindOf("toggle", { on: cfg.on, off: cfg.off, look: resolveTag(cfg.look ?? "chip", SheetLookType) });
        case "cycle":   return kindOf("cycle", { register: meta.register, scale: cfg.scale === true, look: resolveTag(cfg.look ?? "chip", SheetLookType) });
        case "age": {
            const unit = (cfg as { unit?: SheetAgeUnitLiteral }).unit ?? "days";
            const span = unit === "hours" ? 3_600_000n : unit === "weeks" ? 604_800_000n : 86_400_000n;
            // Whole units from the moment to the browser's clock, the renderer's to call; a moment ahead of it counts 0.
            const elapsed = East.function([DateTimeType, DateTimeType], IntegerType, ($, since, now) => {
                const ms = $.const(since.durationMilliseconds(now));
                return ms.less(0n).ifElse(() => 0n, () => ms.divide(span));
            });
            return kindOf("age", {
                unit:   variant(unit, null),
                stale:  optionOf(cfg.stale, IntegerType),
                absent: optionOf(cfg.absent, StringType),
                elapsed,
            });
        }
        case "audit":   return kindOf("audit", {
            mode:   resolveTag(cfg.mode ?? "date", SheetAuditModeType),
            absent: optionOf(cfg.absent, StringType),
            by:     cellKey !== undefined ? East.str`$by:${cellKey}` : sheetRuleCell("by", meta.key),
            verb:   cellKey !== undefined ? East.str`$verb:${cellKey}` : sheetRuleCell("verb", meta.key),
        });
    }
}

/**
 * Creates the sheet's root alone — the grid, its rows and its session
 * ({@link SheetRootType}) that `<Sheet>`'s payload carries — for the root's
 * own specs, which read it whole. It takes the rows, the columns and the
 * sheet's own options as `<Sheet data>` takes them, form for form, and
 * refuses what `<Sheet>` refuses of them.
 *
 * @remarks
 * `id` is required on a positional source. `onUpdate` is refused on the
 * paged arm; edit paged rows with onApply over a pinned source — one that
 * names its snapshot (`Data.bindPaged`'s handle). A `Dict` inline is refused:
 * a sorted map would sit rows in key order, not the planner's.
 *
 * With `group` (#740) the rows are GROUPS: `columns` are declared over the
 * line type the group's lines field holds, `onUpdate` rebuilds the groups
 * with their lines inside. onPatch observes one gesture; onApply confirms an
 * atomic checked batch. Rows of the line type may stand between the groups
 * (#846): pass entries `Sheet.Types.Entry(GroupType, "lines")` — a group, or
 * a LOOSE row, drawn as a plain row numbered in the groups' sequence — with
 * an `id` that both types carry.
 *
 * @param data - The rows: an `Array<R>` value or expression, a whole-value bind handle, or a paged source
 * @param columns - The columns, keyed by the row's fields ({@link SheetColumnSpec})
 * @param options - Everything else ({@link SheetOptions})
 * @returns An East expression of {@link SheetRootType}
 * @internal
 */
export function createSheetRoot<P extends StructType, F extends SheetLinesField<P>>(
    data: NoInfer<SubtypeExprOrValue<ArrayType<SheetEntryOf<P, F>>> | SheetBindHandle<SheetEntryOf<P, F>> | PagedSource<ArrayType<SheetEntryOf<P, F>>> | PagedSource<DictType<StringType, SheetEntryOf<P, F>>>>,
    columns: SheetColumnSpec<SheetLineOf<P, F>>,
    options: SheetEntriesOptions<P, F>,
): ExprType<SheetRootType>;
/** GROUPED rows — an `Array<P>` value or expression of groups. */
export function createSheetRoot<T extends SubtypeExprOrValue<ArrayType<StructType>>, F extends SheetLinesField<DataRowType<T>>>(
    data: T,
    columns: SheetColumnSpec<SheetLineOf<DataRowType<T>, F>>,
    options: SheetGroupedOptions<DataRowType<T>, F>,
): ExprType<SheetRootType>;
/** GROUPED rows over a whole-value bind handle of groups. */
export function createSheetRoot<P extends StructType, F extends SheetLinesField<P>>(
    data: SheetBindHandle<P>,
    columns: SheetColumnSpec<SheetLineOf<P, F>>,
    options: SheetGroupedOptions<P, F>,
): ExprType<SheetRootType>;
/** GROUPED rows over a paged source of groups. */
export function createSheetRoot<P extends StructType, F extends SheetLinesField<P>>(
    data: PagedSource<ArrayType<P>> | PagedSource<DictType<StringType, P>>,
    columns: SheetColumnSpec<SheetLineOf<P, F>>,
    options: SheetGroupedOptions<P, F>,
): ExprType<SheetRootType>;
/** The inline arm — an `Array<R>` value or expression. */
export function createSheetRoot<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    data: T,
    columns: SheetColumnSpec<DataRowType<T>>,
    options: SheetOptions<DataRowType<T>>,
): ExprType<SheetRootType>;
/** A whole-value bind handle retains its live reader for atomic onUpdate. */
export function createSheetRoot<R extends StructType>(
    data: SheetBindHandle<R>,
    columns: SheetColumnSpec<R>,
    options: SheetOptions<R>,
): ExprType<SheetRootType>;
/** The PAGED arm — positional (`Array<R>` windows) or keyed (`Dict<String, R>` windows, the key is the id). */
export function createSheetRoot<R extends StructType>(
    data: PagedSource<ArrayType<R>> | PagedSource<DictType<StringType, R>>,
    columns: SheetColumnSpec<R>,
    options?: SheetOptions<R>,
): ExprType<SheetRootType>;
/** Indexed windows retain their secondary order and edit by original primary key. */
export function createSheetRoot<K extends EastType, R extends StructType, P extends EastType, IK extends EastType>(
    data: OrderedRowSource<K, R, P, IK>, columns: SheetColumnSpec<R>, options?: SheetIndexedOptions<K, R>,
): ExprType<SheetRootType>;
export function createSheetRoot(
    data: unknown,
    columns: unknown,
    options?: unknown,
): ExprType<SheetRootType> {
    return heldRoot(data, columns, options, {});
}

/**
 * Creates a sheet's root with the options only e3-ui's own factories pass
 * (#1182): what {@link createSheetRoot} builds, with a record's whole Dict
 * read in key order, the keyed Apply that commits to it, and the session's
 * source identity.
 *
 * @param data - The rows, as {@link createSheetRoot} takes them; with `keyOrdered`, a Dict or a bind handle of one
 * @param columns - The columns, keyed by the row's fields
 * @param options - The sheet's options, as {@link createSheetRoot} takes them
 * @param internal - The factory's own options
 * @returns An East expression of {@link SheetRootType}
 * @throws Error for everything {@link createSheetRoot} refuses, and for a key-ordered sheet over anything but a Dict
 * @internal
 */
export function createSheetRootWith(
    data: unknown,
    columns: unknown,
    options: unknown,
    internal: SheetInternalOptions,
): ExprType<SheetRootType> {
    return heldRoot(data, columns, options, internal);
}

/**
 * A sheet's root, built in a block of its own that holds each of its bridge's
 * functions once ({@link SheetHold}): a root built alone has no block of its
 * caller's to hold them in.
 */
function heldRoot(data: unknown, columns: unknown, options: unknown, internal: SheetInternalOptions): ExprType<SheetRootType> {
    return Expr.block(($) => {
        const hold = internal.hold ?? (<T extends EastType>(value: ExprType<T>): ExprType<T> => $.const(value) as ExprType<T>);
        return buildSheet(data, columns, options, { ...internal, hold }).root;
    }) as ExprType<SheetRootType>;
}

/**
 * One build of a sheet: its root, and the bridge it was compiled with —
 * what `<Sheet>` builds its templates' seeds and cards over (#1183), so a
 * template's draft and the cells its card shows come from the very code
 * `newRow`'s do.
 *
 * @internal
 */
export interface SheetBuild {
    /** The sheet's root. */
    root: ExprType<SheetRootType>;
    /** The typed bridge the root was compiled with. */
    bridge: SheetBridge;
    /** The declared columns, each described against the type they are declared over — the row, or a grouped sheet's line: what the inspector reads its fields through (#1188). A column from data is among `data` instead. */
    metas: readonly SheetColumnMeta[];
    /** The columns from data, described: each a family of wire columns, one per member of a register or field of a struct. */
    data: readonly SheetColumnMeta[];
    /** The registers' names — the declared ones, and the driver's under its column: what a `reference` hint in the inspector may name (#1188). */
    registers: readonly string[];
    /** A keyed source's key type — a record's own, a keyed paged source's String — whose rows' ids are its keys' text; `undefined` for an Array source, whose rows are keyed by their id field (#1409). */
    keyType: EastType | undefined;
}

/**
 * Builds a sheet for `<Sheet>` (#1183): {@link createSheetRootWith}'s root,
 * with the bridge it was compiled with.
 *
 * @param data - The rows, as {@link createSheetRootWith} takes them
 * @param columns - The columns, keyed by the row's fields
 * @param options - The sheet's options
 * @param internal - The factory's own options
 * @returns The root and its bridge
 * @throws Error for everything {@link createSheetRootWith} refuses
 * @internal
 */
export function createSheetBuild(
    data: unknown,
    columns: unknown,
    options: unknown,
    internal: SheetInternalOptions,
): SheetBuild {
    return buildSheet(data, columns, options, internal);
}

/** The sheet's payload and its bridge, built and checked. */
function buildSheet(
    data: unknown,
    columns: unknown,
    options?: unknown,
    internal: SheetInternalOptions = {},
): SheetBuild {
    const opts = (options ?? {}) as SheetAnyOptions;
    const incoming = resolveRowSource(data, "Sheet");
    const ordered = incoming.kind === "ordered" ? orderedRowSource(incoming, "Sheet") : undefined;
    const resolved = ordered?.resolved ?? incoming;
    // The source's rows: structs — or, with LOOSE rows between the groups
    // (#846), entries `Sheet.Types.Entry(P, "lines")`: a group, or a row of
    // the line type.
    const rowType = resolved.elementType;
    const loose = rowType.type === "Variant";
    const arms = loose ? (rowType as VariantType).cases as Record<string, EastType> : undefined;
    if (arms !== undefined && (Object.keys(arms).length !== 2 || arms["group"]?.type !== "Struct" || arms["row"]?.type !== "Struct")) {
        throw new Error(`Sheet: rows must be structs, or entries of a group or a row — Sheet.Types.Entry(GroupType, "lines") — got a variant of ${Object.keys(arms).join(", ")}`);
    }
    if (!loose && rowType.type !== "Struct") {
        throw new Error(`Sheet: rows must be structs — got ${rowType.type}`);
    }
    // Grouped rows (#740): the group is the row; the columns are over its lines.
    const groupDecl = opts.group;
    if (arms !== undefined && groupDecl === undefined) {
        throw new Error("Sheet: entries of groups and loose rows need their group declared — pass `group={Sheet.group(GroupType, \"lines\", …)}` over the entries' group type");
    }
    if (arms !== undefined && groupDecl !== undefined && !isTypeEqual(groupDecl.rowType, arms["group"]!)) {
        throw new Error("Sheet: `group` was built over a different type than the entries' groups — pass the same StructType to `Sheet.Types.Entry(…)` and `Sheet.group(…)`");
    }
    if (arms === undefined && groupDecl !== undefined && groupDecl.rowType !== rowType) {
        throw new Error("Sheet: `group` was built over a different row type than `data` holds — pass the same StructType to `Sheet.group(…)`");
    }
    // The group's type: the row, or the entries' group arm as the declaration holds it.
    const groupType = groupDecl !== undefined ? groupDecl.rowType : rowType as StructType;
    const shape = groupDecl !== undefined ? sheetLinesOf(groupType, groupDecl.lines) : undefined;
    const lineType = shape?.lineType ?? groupType;
    if (arms !== undefined && groupDecl !== undefined && !isTypeEqual(lineType, arms["row"]!)) {
        throw new Error(`Sheet: an entry's loose row must be of the line type \`${groupDecl.lines}\` holds — build the entries' type with Sheet.Types.Entry(GroupType, "${groupDecl.lines}")`);
    }
    const collectionTag = (resolved.collectionType as { type: string }).type;
    // A record's whole Dict, read in key order (#1182), comes from e3-ui's own
    // factories; an author's inline Dict is still refused.
    const keyOrdered = internal.keyOrdered === true;
    if (keyOrdered && collectionTag !== "Dict") {
        throw new Error(`Sheet: a key-ordered sheet reads a Dict — a record's entries, in key order — and this source holds ${printType(resolved.collectionType)}`);
    }
    if (resolved.kind === "inline" && collectionTag !== "Array" && !keyOrdered) {
        throw new Error(
            "Sheet: a dictionary's rows sit in key order, not the planner's — pass an Array<R> (or a bind handle of one), " +
            "or page a keyed source (`Data.bindPaged` over the Dict)",
        );
    }
    const keyed = collectionTag === "Dict" && (resolved.kind === "paged" || keyOrdered);
    const keyType = keyed ? resolved.keyType : undefined;
    // Whether the sheet adds entries of a kind: it writes somewhere, the author has not made it read only, and its edits
    // insert them.
    const writes = opts.onApply !== undefined || opts.onUpdate !== undefined || internal.applyKeyed !== undefined;
    const adds = (what: "insertRows" | "insertGroups"): boolean => writes && opts.readOnly !== true && opts.edits?.[what] !== false;
    // A new entry — a row, or a group, never a group's line, keyed within it — takes the source's key: the app's, from
    // `newKey`; else a UUID the renderer mints for a String key, and one past the largest for an Integer one (#1182,
    // #1536, #1549). Any other key needs `newKey`.
    const entry = groupDecl === undefined ? "row" : "group";
    if (keyType !== undefined && keyType.type !== "String" && keyType.type !== "Integer" && opts.newKey === undefined
        && (groupDecl === undefined ? adds("insertRows") : adds("insertGroups"))) {
        throw new Error(
            `Sheet: the ${entry}s are keyed by ${printType(keyType)}, and a new ${entry}'s key is made only for a String key or an Integer one — ` +
            `pass \`newKey\`, an East function from the keys taken to a new one, or \`edits={{ ${groupDecl === undefined ? "insertRows" : "insertGroups"}: false }}\``,
        );
    }
    // The app's `newKey` on the wire: over the keys' text, as the rows' ids are — a String key's function as it is, any
    // other key's read from its text and printed back, as `Record.onApply` reads an id.
    const appKey = opts.newKey === undefined ? undefined : (() => {
        const key = keyType ?? StringType;
        const fn = East.value(opts.newKey as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
        const type = Expr.type(fn as Expr<EastType>) as EastType;
        if (type.type !== "Function" || type.inputs.length !== 1 || !isTypeEqual(type.inputs[0]!, SetType(key)) || !isTypeEqual(type.output, key)) {
            throw new Error(`Sheet: \`newKey\` takes the keys taken and gives a new one — an East function from ${printType(SetType(key))} to ${printType(key)}`);
        }
        if (key.type === "String") return fn as ExprType<FunctionType<[SetType<StringType>], StringType>>;
        return East.function([SetType(StringType)], StringType, ($, taken) => {
            const mint = $.const(fn as ExprType<FunctionType<[SetType<EastType>], EastType>>);
            return East.print(mint(taken.toSet((_$, id) => id.parse(key))));
        });
    })();
    // With no `newKey`, an Integer key is one past the largest (#1549), as the Plan's is: of every key taken — the rows the
    // sheet has read, its drafts and what its gesture made — and, paging the record's own entries, of the last key they
    // hold, once that read lands. A key the record holds unread is a conflict at Save, never written over; with no key at
    // all, the first is 1.
    const integerKey = opts.newKey !== undefined || keyType?.type !== "Integer" ? undefined : (() => {
        // The record's own entries, paged, end at its largest key: an index's window ends at the last of its own order,
        // and a narrowing at the last it keeps.
        const lastKey = incoming.kind === "paged" && !incoming.query
            ? scheduleLastKey(incoming.source as unknown as ExprType<EastType>, IntegerType)
            : undefined;
        return East.function([SetType(StringType)], StringType, ($, taken) => {
            const largest = $.let(taken.reduce(($2, most, id) => {
                const key = $2.const(id.parse(IntegerType));
                return East.less(most, key).ifElse(() => key, () => most);
            }, 0n), IntegerType);
            if (lastKey !== undefined) {
                const last = $.const(lastKey);
                $.match(last(), {
                    some: ($2, read) => {
                        $2.match(read, {
                            some: ($3, text) => {
                                const key = $3.const(text.parse(IntegerType));
                                $3.if(East.less(largest, key), ($4) => { $4.assign(largest, key); });
                            },
                        });
                    },
                });
            }
            return East.print(largest.add(1n));
        });
    })();
    const newKey = appKey ?? integerKey;
    const fields = groupType.fields as Record<string, EastType>;
    const idField = opts.id as string | undefined;
    if (!keyed && idField === undefined) {
        throw new Error("Sheet: `id` is required — the String field that identifies a row (a keyed paged source needs none: its key is the id)");
    }
    if (idField !== undefined) {
        const t = fields[idField];
        if (t === undefined || (t as { type: string }).type !== "String") {
            throw new Error(`Sheet: \`id\` must name a String field of the row — "${idField}" is ${t === undefined ? "not a field" : (t as { type: string }).type}`);
        }
        // A loose row is an entry too (#846): its id field is its identity.
        const own = loose ? (lineType.fields as Record<string, EastType>)[idField] : undefined;
        if (loose && (own === undefined || own.type !== "String")) {
            throw new Error(`Sheet: \`id\` must name a String field of both the group type and the line type — a loose row is an entry, identified like a group; "${idField}" is ${own === undefined ? "not a field" : own.type} of the line type`);
        }
    }

    // Pass 1 — every column against the row type (a grouped sheet: the line type).
    const columnEntries = Object.entries(columns as Record<string, SheetColumn<StructType, EastType> | undefined>)
        .filter((e): e is [string, SheetColumn<StructType, EastType>] => e[1] !== undefined);
    if (columnEntries.length === 0) throw new Error("Sheet: declare at least one column");
    for (const [key, col] of columnEntries) {
        if (internal.recordKinds !== true && RECORD_COLUMN_KINDS.has(col.kind)) {
            throw new Error(`Sheet: column "${key}" is a ${col.kind} column, which a Record draws and a Sheet does not — show a system of records' rows with <Record>`);
        }
        // Columns from data and marks meet the Sheet's fill providers, driver, grouped lines and proposals, which know no members yet.
        if (internal.recordKinds !== true && (col.config.each !== undefined || col.config.mark !== undefined)) {
            throw new Error(`Sheet: column "${key}" ${col.config.each !== undefined ? "makes its columns from data, with `each`," : "has a `mark`,"} which a Record draws and a Sheet does not yet — show a system of records' rows with <Record>`);
        }
        if (col.rowType === undefined || col.rowType === lineType) continue;
        throw new Error(groupDecl !== undefined && col.rowType === groupType
            ? `Sheet: column "${key}" was built over the group's row type — columns are declared over the line type \`${groupDecl.lines}\` holds (Sheet.column.${col.kind}(LineType, …))`
            : `Sheet: column "${key}" was built over a different row type than the sheet's — pass the same StructType to Sheet.column.${col.kind}(RowType, …) and \`data\``);
    }
    // Every column, described in the columns map's order; a column from data's cells are read at the Record's day, so
    // its row carries none of them, and the session reaches its field through its own functions.
    const described = columnEntries.map(([key, col]) => describeColumn(key, col, lineType));
    const metas = described.filter((m) => m.data === undefined);
    const dataMetas = described.filter((m) => m.data !== undefined);
    const metaByKey = new Map(metas.map((m) => [m.key, m]));
    for (const m of described) {
        if (m.otherField !== undefined && metaByKey.has(m.otherField)) {
            throw new Error(`Sheet: link column "${m.key}" names "${m.otherField}" as its other half, which is also a column — a half's field is written through the link column, never on its own`);
        }
        // A flat row's id is its identity — and so is a loose row's (#846).
        if ((groupDecl === undefined || loose) && m.field === idField) throw new Error(`Sheet: the id field "${idField}" cannot also be a column`);
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
    for (const m of described) {
        if (m.kind === "lookup" && (driver === undefined || m.key !== driver.column)) {
            throw new Error(`Sheet: column "${m.key}" is a lookup column, which is the driver column — declare \`driver={Sheet.driver("${m.key}", …)}\`, or use \`Sheet.column.reference\` for a plain register lookup`);
        }
        if (m.driverType !== undefined && (driver === undefined || driver.rowType !== m.driverType)) {
            throw new Error(`Sheet: column "${m.key}" was built over a driver row type that is not this sheet's driver's — pass the same type to \`Sheet.column.${m.kind}(RowType, DriverType, …)\` and \`Sheet.driver(…)\`${driver === undefined ? " (the sheet declares no driver)" : ""}`);
        }
    }

    // Registers — by name, plus the driver's under its column name, and each cycle over a variant's steps under its own.
    const registers: Record<string, SheetRegisterValue> = { ...(opts.registers ?? {}) };
    if (driver !== undefined) registers[driver.column] = driver.members;
    for (const m of described) {
        if (m.steps === undefined) continue;
        if (registers[m.register!] !== undefined) throw new Error(`Sheet: \`registers\` declares "${m.register}", the name column "${m.key}"'s steps take — name the register another way`);
        registers[m.register!] = m.steps.members;
    }
    for (const m of described) {
        if (m.register !== undefined && registers[m.register] === undefined) {
            throw new Error(`Sheet: column "${m.key}" names register "${m.register}", which \`registers\` does not declare (${Object.keys(registers).join(", ") || "none declared"})`);
        }
        // A column from data's members and its groups' heads are registers too.
        if (m.data?.from !== "register") continue;
        for (const [option, name] of [["each", m.data.register], ["groups", m.data.groups]] as const) {
            if (name !== undefined && registers[name] === undefined) {
                throw new Error(`Sheet: column "${m.key}" names register "${name}" in \`${option}\`, which \`registers\` does not declare (${Object.keys(registers).join(", ") || "none declared"})`);
            }
        }
    }

    // The band's cells (#740) — the title first, then each cell under its line column.
    let cellMetas: SheetColumnMeta[] | undefined;
    if (groupDecl !== undefined) {
        const cfg = groupDecl.config;
        const titleType = fields[cfg.title];
        if (titleType === undefined || (titleType as { type: string }).type !== "String") {
            throw new Error(`Sheet: \`group.title\` must name a String field of the row — "${cfg.title}" is ${titleType === undefined ? "not a field" : (titleType as { type: string }).type}`);
        }
        cellMetas = [describeGroupCell(SHEET_TITLE_CELL, { kind: "text", field: cfg.title, config: {} }, groupType)];
        for (const [key, cell] of Object.entries(cfg.cells ?? {})) {
            if (cell === undefined) continue;
            const under = metaByKey.get(key);
            if (under === undefined) {
                throw new Error(`Sheet: band cell "${key}" is not a declared column — \`group.cells\` is keyed by the line columns the cells sit under (${[...metaByKey.keys()].join(", ")})`);
            }
            const meta = describeGroupCell(key, cell, groupType);
            // Under an action column (#1474) a band shows the group's own status — a word, never an action.
            if (under.kind === "action") {
                if (meta.kind !== "enum" && meta.kind !== "text" && meta.kind !== "stamped") {
                    throw new Error(`Sheet: band cell "${key}" is a ${meta.kind} cell under an action column — a band shows its group's status there: an enum, text or stamped cell`);
                }
            } else if (meta.payloadType !== under.payloadType) {
                throw new Error(`Sheet: band cell "${key}" is a ${meta.kind} cell (${(meta.payloadType as { type: string }).type}) under a ${under.kind} column (${(under.payloadType as { type: string }).type}) — a band cell's payload must match the column it sits under`);
            }
            if (meta.register !== undefined && registers[meta.register] === undefined) {
                throw new Error(`Sheet: band cell "${key}" names register "${meta.register}", which \`registers\` does not declare (${Object.keys(registers).join(", ") || "none declared"})`);
            }
            cellMetas.push(meta);
        }
    }

    // The fields only the app gives a new entry (#1536), on a sheet that adds that kind of entry: a row's — a line's, a
    // loose row's — and a group's. The session sets an entry's id field itself (a flat row's, a loose row's, a line's
    // beside loose rows) and a group's lines. A sheet that applies nothing drafts what it likes.
    const hinted = internal.inspector;
    const lineLeave = new Set(idField !== undefined && (groupDecl === undefined || loose) && idField in lineType.fields ? [idField] : []);
    const unsettable = {
        row: adds("insertRows") ? unsettableFields(lineType, described, hinted === undefined ? undefined : hinted.fields ?? {}, lineLeave) : [],
        group: groupDecl !== undefined && cellMetas !== undefined && adds("insertGroups")
            ? unsettableFields(groupType, cellMetas, hinted === undefined ? undefined : hinted.groupFields ?? {}, new Set([groupDecl.lines, ...(idField !== undefined ? [idField] : [])]))
            : [],
    };
    const lineWord = groupDecl === undefined ? "row's" : loose ? "line's or loose row's" : "line's";
    if (unsettable.row[0] !== undefined && opts.newRow === undefined) {
        throw new Error(
            `Sheet: a new ${lineWord} "${unsettable.row[0].field}" is required, and no column or form sets it — ` +
            "give it in `newRow`, make it an Option, or `edits={{ insertRows: false }}`",
        );
    }
    if (unsettable.group[0] !== undefined && opts.newGroup === undefined) {
        throw new Error(
            `Sheet: a new group's "${unsettable.group[0].field}" is required, and no band cell or form sets it — ` +
            "give it in `newGroup`, make it an Option, or `edits={{ insertGroups: false }}`",
        );
    }

    // The bridge.
    const bridge = buildBridge({
        rowType, idField, metas, dataMetas, registers, driver,
        source: resolved.kind === "inline"
            ? keyType !== undefined
                ? { kind: "keyed", rows: resolved.rows as ExprType<DictType<EastType, EastType>>, keyType }
                : { kind: "inline", rows: resolved.rows as ExprType<ArrayType<StructType>> }
            : { kind: "paged", source: resolved.source, keyed, keyType },
        ...(groupDecl !== undefined && cellMetas !== undefined ? { group: { linesField: groupDecl.lines, cellMetas } } : {}),
        ...(opts.subRows !== undefined ? { subRows: opts.subRows } : {}),
        ...(internal.hold !== undefined ? { hold: internal.hold } : {}),
    });

    // Pass 2 — the wire columns, in the columns map's order: one for each column, and for a column from data one for each
    // of its members, keyed `column:member` — a struct's fields fixed here, a register's members mapped as the page runs,
    // their groups' order theirs where `groups` heads them, so each group is a run of adjacent columns.
    const parts: ExprType<ArrayType<SheetColumnType>>[] = [];
    let fixed: ExprType<SheetColumnType>[] = [];
    for (const m of described) {
        const data = m.data;
        if (data === undefined) {
            fixed.push(East.value({
                key:         m.key,
                header:      m.config.header ?? m.key,
                sub:         optionOf(m.config.sub, StringType),
                width:       optionOf(m.config.width, StringType),
                kind:        buildKind(m, bridge, driver, { metas, registers, groupCells: cellMetas }),
                dataType:    toEastTypeValue(m.fieldType),
                payloadType: toEastTypeValue(m.payloadType),
                editable:    m.editable,
                fill:        (m.config.fill ?? []).map((f, i) => wrapProvider(bridge, m, f, i)),
                detailCell:  ruleCellKey(m, "detail"),
            }, SheetColumnType));
            continue;
        }
        if (data.from === "fields") {
            for (const member of data.members) {
                const key = `${m.key}:${member.name}`;
                fixed.push(East.value({
                    key,
                    header:      member.header,
                    sub:         optionOf(m.config.sub, StringType),
                    width:       optionOf(m.config.width, StringType),
                    kind:        buildKind(m, bridge, driver, undefined, East.value(key, StringType)),
                    dataType:    toEastTypeValue(member.valueType),
                    payloadType: toEastTypeValue(m.payloadType),
                    editable:    m.editable,
                    fill:        [],
                    detailCell:  ruleCellKey(m, "detail"),
                }, SheetColumnType));
            }
            continue;
        }
        if (fixed.length > 0) parts.push(East.value(fixed, ArrayType(SheetColumnType)));
        fixed = [];
        const members = registers[data.register]!;
        const ordered = data.groups === undefined
            ? dedupeMembers(members)
            : groupMembers(members, registers[data.groups]!).flatMap((_$, group) => group.members);
        // The column's element type as TypeScript infers it expands the recursive type of a type, which the wire's names once.
        parts.push(ordered.map(($, member) => {
            const key = $.const(East.str`${m.key}:${member.key}`);
            return East.value({
                key,
                header:      member.label,
                sub:         optionOf(m.config.sub, StringType),
                width:       optionOf(m.config.width, StringType),
                kind:        buildKind(m, bridge, driver, undefined, key),
                dataType:    toEastTypeValue(data.valueType),
                payloadType: toEastTypeValue(m.payloadType),
                editable:    m.editable,
                fill:        [],
                detailCell:  ruleCellKey(m, "detail"),
            }, SheetColumnType);
        }) as unknown as ExprType<ArrayType<SheetColumnType>>);
    }
    if (fixed.length > 0 || parts.length === 0) parts.push(East.value(fixed, ArrayType(SheetColumnType)));
    const columnValues = parts.slice(1).reduce((all, part) => all.concat(part), parts[0]!);

    // The rows — the same projection on both arms. A grouped sheet's row is
    // the group: the band's cells, its lines and the band; a loose row between
    // the groups (#846) is a row of the line type: its cells, no lines, no band.
    const ownedAccessor = opts.owned;
    const ownedFn = East.function([rowType], BooleanType, (_$, r) =>
        ownedAccessor !== undefined ? ownedAccessor(r as ExprType<StructType>) : East.value(false, BooleanType));
    const groupBridge = bridge.group;
    const subAccessor = groupDecl?.config.sub;
    const foldedAccessor = groupDecl?.config.folded;
    const subFn = East.function([groupType], StringType, (_$, r) =>
        subAccessor !== undefined ? subAccessor(r) : East.value("", StringType));
    const foldedFn = East.function([groupType], BooleanType, (_$, r) =>
        foldedAccessor !== undefined ? foldedAccessor(r) : East.value(false, BooleanType));
    const rowOf = East.function([rowType, StringType], SheetRowType, ($, r, id) => {
        const ownedOf = $.const(ownedFn);
        const owned = $.let(ownedOf(r), BooleanType);
        if (groupBridge === undefined) {
            const project = $.const(bridge.projectRow);
            const subRowsOf = $.const(bridge.projectSubRows);
            return $.let({ id, owned, cells: project(r as ExprType<StructType>), lines: [], band: none, subRows: subRowsOf(r as ExprType<StructType>) }, SheetRowType);
        }
        const cellsOf = $.const(groupBridge.projectGroupCells);
        const linesOf = $.const(groupBridge.projectLines);
        const subOf = $.const(subFn);
        const foldedOf = $.const(foldedFn);
        if (!loose) {
            const g = r as ExprType<StructType>;
            return $.let({ id, owned, cells: cellsOf(g), lines: linesOf(g), band: some({ sub: subOf(g), folded: foldedOf(g) }), subRows: [] }, SheetRowType);
        }
        const project = $.const(bridge.projectRow);
        const subRowsOf = $.const(bridge.projectSubRows);
        return (r as unknown as ExprType<VariantType<{ group: StructType; row: StructType }>>).match({
            group: ($2, g) => $2.let({ id, owned, cells: cellsOf(g), lines: linesOf(g), band: some({ sub: subOf(g), folded: foldedOf(g) }), subRows: [] }, SheetRowType),
            row: ($2, l) => $2.let({ id, owned, cells: project(l), lines: [], band: none, subRows: subRowsOf(l) }, SheetRowType),
        });
    });
    // A keyed row's id is its key's text (#1182): a String key itself, any
    // other key its `.east` printing, which `Record.onApply` reads back.
    const idOfKey = keyType !== undefined && keyType.type !== "String"
        ? (k: ExprType<EastType>): ExprType<StringType> => East.print(k)
        : (k: ExprType<EastType>): ExprType<StringType> => k as ExprType<StringType>;
    const makeKeyed = (collection: ExprType<EastType>) =>
        (collection as unknown as ExprType<DictType<EastType, EastType>>).toArray((_$, v, k) => rowOf(v, idOfKey(k)));
    // A positional row's id is its id field — an entry's, through whichever arm it holds (#846).
    const idAt = (r: ExprType<EastType>): ExprType<StringType> => (loose
        ? (r as unknown as ExprType<VariantType<{ group: StructType; row: StructType }>>).match({
            group: (_$, g) => (g as unknown as Record<string, ExprType<StringType>>)[idField!] as ExprType<StringType>,
            row: (_$, l) => (l as unknown as Record<string, ExprType<StringType>>)[idField!] as ExprType<StringType>,
        })
        : (r as unknown as Record<string, ExprType<StringType>>)[idField!] as ExprType<StringType>);
    const makePositional = (collection: ExprType<EastType>) =>
        (collection as unknown as ExprType<ArrayType<EastType>>).map((_$, r) => rowOf(r, idAt(r)));
    const makeOrdered = (collection: ExprType<EastType>) =>
        (collection as ExprType<ArrayType<StructType>>).map((_$, entry) => rowOf(ordered!.valueOf(entry), ordered!.idOf(entry.key!)));
    const rowsValue = buildRowSource(incoming, SheetRowsCollectionType, ordered !== undefined ? makeOrdered : keyed ? makeKeyed : makePositional);

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

    // The narrowing's chrome, as `<Sheet>` checked it (#1345): one rail over its Slice.bindRecords.
    const slice = East.value(internal.slice ?? none, OptionType(RecordSlicesChromeType));

    const editing = buildSheetEditing(resolved, bridge, idField, {
        ...opts,
        ...(ordered !== undefined && opts.onApply !== undefined ? { onApply: undefined, applyKeyed: opts.onApply } : {}),
        ...(internal.applyKeyed !== undefined ? { applyKeyed: internal.applyKeyed } : {}),
        ...(internal.sourceId !== undefined ? { sourceId: internal.sourceId } : {}),
        unsettable,
    }, rowOf as unknown as ExprType<FunctionType<[EastType, StringType], typeof SheetRowType>>, driver?.column);
    // The group declaration on the wire (#740).
    const groupValue = groupBridge !== undefined && groupDecl !== undefined && cellMetas !== undefined
        ? East.value(some({
            lines: groupDecl.lines,
            cells: East.value(cellMetas.map((m) => East.value({
                key:         m.key,
                field:       m.field,
                kind:        buildKind(m, bridge, driver),
                dataType:    toEastTypeValue(m.fieldType),
                payloadType: toEastTypeValue(m.payloadType),
                editable:    m.editable,
            }, SheetGroupCellType)), ArrayType(SheetGroupCellType)),
            // The host's word; with none, the renderer says its own (#861).
            noun: optionOf(groupDecl.config.noun, SheetNounType),
            // Loose rows between the groups (#846): a row without a band.
            loose,
        }), OptionType(SheetGroupType))
        : East.value(none, OptionType(SheetGroupType));

    const footer = East.value((opts.footer ?? []).map((f) => ({
        text: f.text,
        tone: f.tone !== undefined ? some(resolveTag(f.tone, StatusValueType)) : none,
    })), ArrayType(SheetFooterItemType));
    const style = opts.style !== undefined
        ? East.value(some({
            gutterWidth: optionOf(opts.style.gutterWidth, StringType),
        }), OptionType(SheetStyleType))
        : East.value(none, OptionType(SheetStyleType));
    // On a phone (`Mobile Sheet Spec.md` §9): a pinned column one of the sheet's, and one to three columns in view.
    const narrowOpt = opts.narrow;
    if (narrowOpt?.pin !== undefined && !metaByKey.has(narrowOpt.pin)) {
        throw new Error(`Sheet: \`narrow.pin\` names "${narrowOpt.pin}", which is not a column (${[...metaByKey.keys()].join(", ")})`);
    }
    if (narrowOpt?.columns !== undefined && ![1, 2, 3].includes(narrowOpt.columns)) {
        throw new Error(`Sheet: \`narrow.columns\` is how many columns a phone shows at once beside any pinned one, 1 to 3 — got ${String(narrowOpt.columns)}`);
    }
    const narrow = narrowOpt !== undefined
        ? East.value(some({
            pin:     optionOf(narrowOpt.pin, StringType),
            columns: narrowOpt.columns !== undefined ? some(BigInt(narrowOpt.columns)) : none,
        }), OptionType(SheetNarrowType))
        : East.value(none, OptionType(SheetNarrowType));

    const root = East.value({
        rows:          rowsValue,
        editing,
        columns:       columnValues,
        registers:     East.value(new Map(Object.entries(registers).map(([name, members]) => [name, East.value({ members }, SheetRegisterType)])), DictType(StringType, SheetRegisterType)),
        driver:        driver !== undefined
            ? East.value(some({ column: driver.column, members: driver.members }), OptionType(SheetDriverType))
            : East.value(none, OptionType(SheetDriverType)),
        suggest,
        slice,
        views:         East.value(opts.views ?? [], ArrayType(SheetRecordViewType)),
        activeView:    opts.activeView !== undefined ? East.value(opts.activeView, OptionType(StringType)) : East.value(none, OptionType(StringType)),
        onViewsChange: opts.onViewsChange !== undefined
            ? some(East.value(opts.onViewsChange, FunctionType([ArrayType(SheetRecordViewType)], NullType)))
            : none,
        onSelect:      opts.onSelect !== undefined
            ? some(East.value(opts.onSelect, FunctionType([SheetSelectionType], NullType)))
            : none,
        selection:     opts.selection !== undefined ? East.value(opts.selection, OptionType(SheetSelectionType)) : East.value(none, OptionType(SheetSelectionType)),
        newKey:        newKey !== undefined ? some(newKey) : none,
        group:         groupValue,
        readOnly:      opts.readOnly !== undefined ? some(opts.readOnly) : none,
        blanks:        opts.blanks !== undefined ? some(typeof opts.blanks === "number" ? BigInt(opts.blanks) : opts.blanks) : none,
        density:       opts.density !== undefined ? some(resolveTag(opts.density, DensityType)) : none,
        footer,
        style,
        narrow,
        ordered: ordered !== undefined,
    }, SheetRootType);
    return { root, bridge, metas, data: dataMetas, registers: Object.keys(registers), keyType };
}
