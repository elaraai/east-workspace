/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Sheet` — the planning spreadsheet (`libs/east-ui/docs/proposals/Sheet
 * Spec.md`): a sheet whose rows are the host's records, whose columns are
 * TYPED (a date, a quantity with a unit, a register lookup, a directed link
 * between register members, a stamped read-only code), whose blank tail
 * invites the next row, and whose copilot fills cells and proposes whole
 * rows from rules the author writes as East functions.
 *
 * The module is the namespace assembler over the split sources:
 * `types.ts` (the closed wire types + the typed constructors) ·
 * `columns.ts` (`Sheet.column.*`) · `registers.ts` (`Sheet.register.*`,
 * `Sheet.driver`) · `link.ts` (`Sheet.link.*`) · `group.ts` (`Sheet.group`,
 * `Sheet.group.cell.*`) · `sub-rows.ts` (`Sheet.subRows` / `Sheet.subRow`) ·
 * `transactions.ts` and `drafts.ts` (the Sheet's names for the shared editing
 * contract, `contracts/editing.ts` #879 — `Sheet.apply`, the checked batch
 * types, the draft entry types and the `onPatch` event — plus the new-row
 * contexts only a sheet has) · `edits.ts` (the `edits` capabilities) ·
 * `bridge.ts` (the typed bridge) · `context-bridge.ts`, `draft-bridge.ts` and
 * `seed-bridge.ts` (draft-aware contexts, draft decoding and the `newRow` /
 * `newGroup` defaults) · `editing-bridge.ts` and `editing-types.ts` (the
 * editing session's callbacks and their closed transport, the inline
 * `onUpdate` adapter among them) · `root.ts` (the grid's root) · `sheet.ts`
 * (`<Sheet>` itself, its payload and its `Sheet` carrier, #1216) with
 * `record.ts` (a record's rows, #1182), `templates.ts` (the Rows tab's
 * cards), `library.ts` (`Sheet.library.*`, the library pane's tabs, #1186),
 * `fields.ts` (`Sheet.field`, the inspector pane's forms, #1188) and
 * `views.ts` (the views' bind handle).
 *
 * `Sheet` is the tag and the namespace at once, as east-ui's `Table` is: one
 * namespace object per category on it, the `Plan.series` / `Plan.at` /
 * `Plan.Types` split, so categories never mix as they grow.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    East,
    type StructType,
    some,
    none,
} from "@elaraai/east";

import {
    SheetMemberType,
    SheetLinkType,
    SheetCellType,
    SheetRowType,
    SheetLineType,
    SheetBandType,
    SheetGroupCellType,
    SheetGroupType,
    SheetRowsCollectionType,
    SheetRowsType,
    SheetRegisterMemberType,
    SheetRegisterType,
    SheetDriverType,
    SheetHalfType,
    SheetSidesValueType,
    SheetStoreType,
    SheetMemberKindType,
    SheetMultipleType,
    SheetSideLockType,
    SheetSidesType,
    SheetCountedType,
    SheetContextType,
    SheetFillType,
    SheetProposalType,
    SheetProviderType,
    SheetProposerType,
    SheetSuggestType,
    SheetCheckContextType,
    SheetCheckType,
    SheetArityType,
    SheetColumnKindType,
    SheetColumnType,
    SheetViewType,
    SheetEditType,
    SheetSelectionType,
    SheetFooterItemType,
    SheetStyleType,
    SheetRootType,
    SheetFillTypeFor,
    SheetPatchTypeFor,
    SheetProposalTypeFor,
    SheetFacetType,
    SheetSubRowType,
    SheetDateLevelType,
    SheetOptionsRuleType,
    SheetNounType,
    sheetContextType,
    sheetCheckContextType,
    type SheetPatchInput,
    type SheetPatchOf,
} from "./types.js";
import { text, date, quantity, integer, lookup, reference, enumColumn, set, link, stamped, custom } from "./columns.js";
import { createMembers, concatMembers, createDriver } from "./registers.js";
import { createArity, check, parseLink, printLink, SheetMembersType, SheetRegisterMembersType } from "./link.js";
import { createSheetRoot } from "./root.js";
import { SheetComponent, SheetTag, createSheetPayload, type SheetTagType } from "./sheet.js";
import { libraryColumns, libraryRows, libraryTab } from "./library.js";
import { SheetField } from "./fields.js";
import { createSubRows, createSubRow } from "./sub-rows.js";
import {
    createGroup,
    text as groupText,
    date as groupDate,
    quantity as groupQuantity,
    integer as groupInteger,
    reference as groupReference,
    enumCell as groupEnum,
    stamped as groupStamped,
} from "./group.js";

import { applySheet, SheetPositionType, SheetEntryPlacementType, SheetRowDestinationType, SheetFieldIssueType, SheetReadinessType, SheetIssueType, SheetBatchReadinessType, SheetOriginType, SheetApplyResultType, SheetNewRowType, SheetNewGroupType, SheetDraftTypeFor, SheetBaseTypeFor, SheetChangeTypeFor, SheetChangeSetTypeFor, SheetAppliedTypeFor } from "./transactions.js";
export * from "./transactions.js";
import { SheetEntryTypeFor, SheetDraftGroupTypeFor, SheetDraftEntryTypeFor, SheetDraftChangeTypeFor, SheetPatchEventTypeFor } from "./drafts.js";
export * from "./drafts.js";
export * from "./editing-types.js";

// Re-export the UIComp-free types so consumers reach everything via this barrel.
export {
    SheetMemberType,
    SheetLinkType,
    SheetCellType,
    SheetRowType,
    SheetLineType,
    SheetBandType,
    SheetFacetType,
    SheetSubRowType,
    SheetDateLevelType,
    type SheetDateLevelLiteral,
    SheetOptionsRuleType,
    SheetNounType,
    SHEET_TITLE_CELL,
    sheetRuleCell,
    SheetGroupCellType,
    SheetGroupType,
    SheetRowsCollectionType,
    SheetRowsType,
    SheetRegisterMemberType,
    SheetRegisterType,
    SheetDriverType,
    SheetHalfType,
    type SheetHalfLiteral,
    SheetSidesValueType,
    type SheetSidesLiteral,
    SheetStoreType,
    type SheetStoreLiteral,
    SheetMemberKindType,
    SheetMultipleType,
    SheetSideLockType,
    SheetSidesType,
    SheetCountedType,
    SheetContextType,
    SheetFillType,
    SheetProposalType,
    SheetProviderType,
    SheetProposerType,
    SheetSuggestType,
    SheetCheckContextType,
    SheetCheckType,
    SheetArityType,
    SheetColumnKindType,
    type SheetColumnKindLiteral,
    SheetColumnType,
    SheetViewType,
    SheetEditType,
    SheetSelectionType,
    SheetFooterItemType,
    SheetStyleType,
    SheetRootType,
    SheetContextTypeFor,
    SheetFillTypeFor,
    SheetPatchTypeFor,
    SheetProposalTypeFor,
    SheetCheckContextTypeFor,
    SheetGroupContextTypeFor,
    SheetGroupCheckContextTypeFor,
    sheetContextType,
    sheetCheckContextType,
    sheetLinesOf,
    type SheetContextOf,
    type SheetFillOf,
    type SheetPatchOf,
    type SheetProposalOf,
    type SheetCheckContextOf,
    type SheetGroupContextOf,
    type SheetGroupCheckContextOf,
    type SheetAnyContextOf,
    type SheetAnyCheckContextOf,
    type SheetLinesField,
    type SheetLineOf,
    type SheetEntryOf,
    type SheetPatchInput,
    type SheetFieldsOf,
} from "./types.js";
export {
    type SheetColumn,
    type SheetColumnSpec,
    type SheetFieldKey,
    type SheetMemberArrayField,
    type SheetFillInput,
    type SheetOptionsInput,
    type SheetColumnBaseConfig,
    type SheetValueConfig,
    type SheetTextConfig,
    type SheetDateConfig,
    type SheetQuantityConfig,
    type SheetIntegerConfig,
    type SheetLookupConfig,
    type SheetReferenceConfig,
    type SheetEnumConfig,
    type SheetMemberKindInput,
    type SheetMultipleInput,
    type SheetSetConfig,
    type SheetSidesInput,
    type SheetLinkConfig,
    type SheetStampedConfig,
    type SheetCustomConfig,
} from "./columns.js";
export {
    type SheetRegisterValue,
    type SheetMembersConfig,
    type SheetDriverConfig,
    type SheetDriverValue,
} from "./registers.js";
export {
    type SheetArityInput,
    type SheetCheckInput,
    type SheetExistsCheck,
    type SheetLocksInput,
    SheetMembersType,
    SheetRegisterMembersType,
    printMember,
    linkKeys,
} from "./link.js";
export {
    type SheetOptions,
    type SheetReadyInput,
    type SheetGroupedOptions,
    type SheetEntriesOptions,
    type SheetSuggestInput,
    type SheetProposerInput,
    type SheetStringField,
    type SheetBindHandle,
    createSheetRoot,
} from "./root.js";
export {
    SheetTag,
    SheetComponent,
    SheetPayloadType,
    SheetInspectorType,
    SheetInspectorPaneType,
    SheetHistoryType,
    createSheetPayload,
    buildInspector,
    buildInspectorPane,
    sheetKeys,
    type SheetTagType,
    type SheetRecordHandle,
    type SheetEntryRows,
    type SheetLooseEntryRows,
    type SheetEntriesField,
    type SheetCommon,
} from "./sheet.js";
export { SheetTemplateWireType, type SheetTemplate, type SheetTemplatesInput } from "./templates.js";
export {
    SheetLibraryCardType,
    SheetLibraryDropType,
    SheetLibraryTabType,
    type SheetLibraryTab,
    type SheetLibraryTabConfig,
} from "./library.js";
export { SheetFieldType, SheetFormType, SheetFormsType } from "./fields.js";
export {
    type SheetGroupCell,
    type SheetGroupConfig,
    type SheetGroupValue,
    type SheetGroupCellBaseConfig,
    type SheetGroupValueConfig,
    type SheetGroupDateConfig,
    type SheetGroupQuantityConfig,
    type SheetGroupStampedConfig,
    type SheetFieldOf,
    createGroup,
} from "./group.js";
export {
    type SheetArrayField,
    type SheetElementOf,
    type SheetSubRowSources,
    type SheetSubRowsValue,
    type SheetSubRowInput,
    createSubRows,
    createSubRow,
} from "./sub-rows.js";
export { type SheetColumnMeta, type SheetRuleCellMeta, describeColumn, describeGroupCell, optionPayload, cellTagOf } from "./bridge.js";

// ============================================================================
// Sheet.patch
// ============================================================================

/**
 * Builds a row patch — `Sheet.patch(R, { … })`: the fields it sets, every
 * other field `none`. A proposer returns patches as its proposed rows
 * (§3.6), and `newRow` / `newGroup` return one as a new row's explicit
 * defaults, including required fields no column shows — a field it leaves
 * `none` starts missing. Takes the literal-record form of `R`'s fields, each
 * a literal or an expression of the FIELD's type.
 *
 * @typeParam R - The host's row type
 * @param rowType - The row type value
 * @param record - The fields to set
 * @returns An expression of `Sheet.Types.Patch(R)`
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { ArrayType, DictType, East, FloatType, IntegerType, OptionType, StringType, StructType, VariantType, none, some, variant } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Record, Sheet } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const BatchPart = StructType({ id: StringType, code: StringType, name: StringType, materials: ArrayType(StringType), station: OptionType(StringType) });
 * export const BatchBooking = VariantType({
 *     labour:    StructType({ team: StringType, people: IntegerType, hours: FloatType }),
 *     equipment: StructType({ resource: StringType }),
 * });
 * export const BatchStep = StructType({ task: StringType, qty: OptionType(FloatType), parts: ArrayType(BatchPart), bookings: ArrayType(BatchBooking) });
 * export const Batch = StructType({ id: StringType, name: StringType, steps: ArrayType(BatchStep) });
 * export const BatchDay = StructType({ batches: ArrayType(Batch) });
 * export const sheetBatchDays = e3.record("sheet_batch_days", DictType(StringType, BatchDay), new Map([
 *     ["2026-10-12", { batches: [
 *         { id: "B-101", name: "Doors, oak", steps: [
 *             { task: "Cut doors", qty: some(12.0), parts: [
 *                 { id: "B-101-1", code: "CUT", name: "Cut the door blanks", materials: ["Oak veneered board × 6"], station: some("S101") },
 *             ], bookings: [variant("labour", { team: "Cutting", people: 1n, hours: 3.0 })] },
 *             { task: "Band doors", qty: some(48.0), parts: [], bookings: [variant("equipment", { resource: "Edge bander E201" })] },
 *             { task: "Spray doors", qty: some(12.0), parts: [
 *                 { id: "B-101-3", code: "SPR", name: "Seal and lacquer", materials: ["Sealer", "Matt lacquer"], station: none },
 *             ], bookings: [] },
 *         ] },
 *         { id: "B-102", name: "Carcasses, birch", steps: [
 *             { task: "Cut carcasses", qty: some(8.0), parts: [], bookings: [] },
 *             { task: "Drill carcasses", qty: some(8.0), parts: [], bookings: [variant("labour", { team: "Machining", people: 2n, hours: 2.5 })] },
 *         ] },
 *         { id: "B-103", name: "Shelves, ash", steps: [
 *             { task: "Cut shelves", qty: some(20.0), parts: [], bookings: [] },
 *             { task: "Sand shelves", qty: some(20.0), parts: [], bookings: [] },
 *         ] },
 *     ] }],
 * ]));
 * export const sheetBatchDaysPatch = e3.mutation.patch(sheetBatchDays);
 *
 * const sheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const days = $.let(Record.bind(sheetBatchDays, [sheetBatchDaysPatch]));
 *         // The steps a finishing batch starts with: the batch template's lines.
 *         const finishing = $.let([
 *             { task: "Sand", qty: none, parts: [], bookings: [] },
 *             { task: "Seal", qty: none, parts: [], bookings: [] },
 *             { task: "Spray", qty: none, parts: [], bookings: [] },
 *         ], ArrayType(BatchStep));
 *         // A batch needs a name before Save.
 *         const readyBatch = $.const(East.function([Sheet.Types.DraftGroup(Batch, "steps")], Sheet.Types.Readiness, ($, batch) => {
 *             $.if(batch.name.hasTag("value").and(() => batch.name.unwrap("value").length().equal(0n)), $ => {
 *                 $.return(East.value(variant("incomplete", [{ field: "name", message: "Name the batch" }]), Sheet.Types.Readiness));
 *             });
 *             return East.value(variant("ready", null), Sheet.Types.Readiness);
 *         }));
 *         const newStep = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(BatchStep), () => Sheet.patch(BatchStep, { qty: none, parts: [], bookings: [] })));
 *         const newBatch = $.const(East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(Batch), () => Sheet.patch(Batch, { steps: [] })));
 *         return (
 *             <Box height="560px">
 *                 <Sheet
 *                     record={days}
 *                     entry={{ key: "2026-10-12", rows: "batches", id: "id" }}
 *                     group={Sheet.group(Batch, "steps", { title: "name", noun: { singular: "batch", plural: "batches" } })}
 *                     name="batches"
 *                     columns={{
 *                         task: Sheet.column.text(BatchStep, { header: "Step", width: "240px" }),
 *                         qty:  Sheet.column.quantity(BatchStep, { header: "Qty", width: "96px" }),
 *                     }}
 *                     subRows={Sheet.subRows(BatchStep, {
 *                         parts: (p) => Sheet.subRow({
 *                             code:   p.code,
 *                             name:   p.name,
 *                             chips:  p.materials,
 *                             facets: { station: p.station },   // a none drops out
 *                             id:     p.id,
 *                         }),
 *                         bookings: (b) => b.match({
 *                             labour:    (_$2, l) => Sheet.subRow({ code: "LABOUR", name: East.str`${l.team} · ${l.people} people · ${l.hours} hours` }),
 *                             equipment: (_$2, e) => Sheet.subRow({ code: "EQUIPMENT", name: e.resource }),
 *                         }),
 *                     })}
 *                     // The sub rows show a step's parts and bookings; the inspector's form leaves them out.
 *                     inspector
 *                     fields={{ parts: Sheet.field.hidden(), bookings: Sheet.field.hidden() }}
 *                     templates={{
 *                         groups: [{ key: "finishing", name: "Finishing batch", group: "Batches",
 *                                    values: Sheet.patch(Batch, { name: "Finishing", steps: finishing }) }],
 *                         rows:   [{ key: "sand", name: "Sand", group: "Steps", values: Sheet.patch(BatchStep, { task: "Sand", qty: none }) },
 *                                  { key: "seal", name: "Seal", group: "Steps", values: Sheet.patch(BatchStep, { task: "Seal", qty: none }) }],
 *                     }}
 *                     library={[Sheet.library.rows(), Sheet.library.columns()]}
 *                     ready={{ group: readyBatch }}
 *                     newRow={newStep}
 *                     newGroup={newBatch}
 *                 />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function createPatch<R extends StructType>(rowType: R, record: SheetPatchInput<R>): ExprType<SheetPatchOf<R>> {
    const patchType = SheetPatchTypeFor(rowType);
    const fields: Record<string, unknown> = {};
    const rec = record as Record<string, unknown>;
    for (const name of Object.keys(rowType.fields as Record<string, EastType>)) {
        fields[name] = rec[name] !== undefined ? some(rec[name] as SubtypeExprOrValue<EastType>) : none;
    }
    return East.value(fields as never, patchType) as ExprType<SheetPatchOf<R>>;
}

// ============================================================================
// Namespace
// ============================================================================

/**
 * The type of `Sheet`: the `<Sheet>` tag — every form its props take — and
 * its namespace. Declared explicitly (rather than inferred from `as const`)
 * so the declaration emit stays within TypeScript's serialization limit.
 */
export interface SheetNamespace extends SheetTagType {
    /** The column builders — each takes the row type first (§3.2). */
    column: {
        /** Free text. */
        text: typeof text;
        /** A UTC-midnight date with the B§3 grammar. */
        date: typeof date;
        /** A float with a unit per driver member. */
        quantity: typeof quantity;
        /** A whole number. */
        integer: typeof integer;
        /** The driver column — scored candidates from the driver's register. */
        lookup: typeof lookup;
        /** A lookup over a flat member list. */
        reference: typeof reference;
        /** An upper-cased register word with a valence dot. */
        enum: typeof enumColumn;
        /** Comma members — the link grammar without an arrow. */
        set: typeof set;
        /** `from > to` — the split cell (§3.4). */
        link: typeof link;
        /** A read-only code an upstream system owns. */
        stamped: typeof stamped;
        /** An author parse / print pair over the field's payload (§3.9). */
        custom: typeof custom;
    };
    /** Registers — the grammar's vocabulary, projected from the host's rows (§3.3). */
    register: {
        /** Members from rows through accessors, reified once; duplicates fold by key. */
        members: typeof createMembers;
        /** Joins member sets of different kinds into one register. */
        concat: typeof concatMembers;
    };
    /** The driver declaration — the `lookup` column whose member decides what the row does. */
    driver: typeof createDriver;
    /** The link value's helpers (§3.4). */
    link: {
        /** A link column's arity rule. */
        arity: typeof createArity;
        /** The built-in member checks (`exists`). */
        check: typeof check;
        /** The grammar's parse — text and a register's members to a link value. */
        parse: typeof parseLink;
        /** The grammar's print — a link value to the planner's text. */
        print: typeof printLink;
    };
    /** A row patch — the fields a proposal or a new row's defaults set (§3.6). */
    patch: typeof createPatch;
    /** The library pane's tabs, listed in order by `<Sheet library={[…]}>` (#1186). */
    library: {
        /** The Rows tab: the templates, by their group. */
        rows: typeof libraryRows;
        /** The Columns tab: the columns, each with an eye. */
        columns: typeof libraryColumns;
        /** A tab of the author's own cards, read as a register's members are, each dropping the `Sheet.patch` its `drop` returns. */
        tab: typeof libraryTab;
    };
    /** The inspector pane's hints — `Fields`' own (#1147, #1188): `<Sheet inspector fields={{ created_by: Sheet.field.readonly() }}>`. */
    field: typeof SheetField;
    /** Sub rows (#844) — `Sheet.subRows(R, { field: (item, row) => Sheet.subRow({ … }) })`, keyed by `R`'s array fields. */
    subRows: typeof createSubRows;
    /** One sub row — `Sheet.subRow({ code?, name, chips?, facets?, id? })`. */
    subRow: typeof createSubRow;
    /** Applies a checked entry batch atomically to a collection — the shared `Editing.apply` (#879). */
    apply: typeof applySheet;
    /**
     * Grouped rows (#740) — `Sheet.group(P, "lines", { title, sub?, cells?, folded?, noun? })`
     * declares the group's lines field (an `Array` of line structs) and its
     * band; `Sheet.group.cell.*` builds the band's cells over the group's
     * fields. Over `Types.Entry(P, "lines")` entries, rows of the line type
     * stand between the groups as loose rows (#846).
     */
    group: typeof createGroup & {
        /** The band cell builders — each takes the group's row type first. */
        cell: {
            /** Free text. */
            text: typeof groupText;
            /** A UTC-midnight date. */
            date: typeof groupDate;
            /** A float — no unit on a band. */
            quantity: typeof groupQuantity;
            /** A whole number. */
            integer: typeof groupInteger;
            /** A lookup over a flat member list. */
            reference: typeof groupReference;
            /** An upper-cased register word with a valence dot. */
            enum: typeof groupEnum;
            /** A read-only code an upstream system owns. */
            stamped: typeof groupStamped;
        };
    };
    /**
     * The Sheet East types — the closed wire types and the typed constructors.
     * The transaction and draft types (`Entry`, `DraftGroup`, `DraftEntry`,
     * `DraftChange`, `PatchEvent`, `Position`, `EntryPlacement`, `FieldIssue`,
     * `Readiness`, `Issue`, `BatchReadiness`, `Origin`, `ApplyResult`, `Draft`,
     * `Base`, `Change`, `ChangeSet`, `Applied`) are the shared editing
     * contract's — each the same value as its `Editing.Types` name (#879).
     */
    Types: {
        /** `Entry(G, "rows")` — the group-or-row union of a source holding groups beside ungrouped rows: as a sheet's `data`, loose rows between the groups (#846) ({@link SheetEntryTypeFor}). */
        Entry: typeof SheetEntryTypeFor;
        /** DraftGroup type for source-bound editing. */
        DraftGroup: typeof SheetDraftGroupTypeFor;
        /** DraftEntry type for source-bound editing. */
        DraftEntry: typeof SheetDraftEntryTypeFor;
        /** DraftChange type for source-bound editing. */
        DraftChange: typeof SheetDraftChangeTypeFor;
        /** PatchEvent type for source-bound editing. */
        PatchEvent: typeof SheetPatchEventTypeFor;
        /** Position contract for checked Sheet transactions. */
        Position: typeof SheetPositionType;
        /** EntryPlacement contract for checked Sheet transactions. */
        EntryPlacement: typeof SheetEntryPlacementType;
        /** RowDestination contract for checked Sheet transactions. */
        RowDestination: typeof SheetRowDestinationType;
        /** FieldIssue contract for checked Sheet transactions. */
        FieldIssue: typeof SheetFieldIssueType;
        /** Readiness contract for checked Sheet transactions. */
        Readiness: typeof SheetReadinessType;
        /** Issue contract for checked Sheet transactions. */
        Issue: typeof SheetIssueType;
        /** BatchReadiness contract for checked Sheet transactions. */
        BatchReadiness: typeof SheetBatchReadinessType;
        /** Origin contract for checked Sheet transactions. */
        Origin: typeof SheetOriginType;
        /** ApplyResult contract for checked Sheet transactions. */
        ApplyResult: typeof SheetApplyResultType;
        /** NewRow contract for checked Sheet transactions. */
        NewRow: typeof SheetNewRowType;
        /** NewGroup contract for checked Sheet transactions. */
        NewGroup: typeof SheetNewGroupType;
        /** Draft contract for checked Sheet transactions. */
        Draft: typeof SheetDraftTypeFor;
        /** Base contract for checked Sheet transactions. */
        Base: typeof SheetBaseTypeFor;
        /** Change contract for checked Sheet transactions. */
        Change: typeof SheetChangeTypeFor;
        /** ChangeSet contract for checked Sheet transactions. */
        ChangeSet: typeof SheetChangeSetTypeFor;
        /** Applied contract for checked Sheet transactions. */
        Applied: typeof SheetAppliedTypeFor;
        /** The Sheet root IR ({@link SheetRootType}). */
        Root: typeof SheetRootType;
        /** One wire row — id, `owned`, one cell per declared column, and on a grouped sheet its lines and band ({@link SheetRowType}). */
        Row: typeof SheetRowType;
        /** One line of a group row on the wire ({@link SheetLineType}). */
        Line: typeof SheetLineType;
        /** One sub row — a lead, a detail and an id ({@link SheetSubRowType}). */
        SubRow: typeof SheetSubRowType;
        /** One labelled fact of a sub row's detail ({@link SheetFacetType}). */
        Facet: typeof SheetFacetType;
        /** How deep a date column reads a row's date ({@link SheetDateLevelType}). */
        DateLevel: typeof SheetDateLevelType;
        /** A column's options rule on the wire ({@link SheetOptionsRuleType}). */
        OptionsRule: typeof SheetOptionsRuleType;
        /** The word the renderer prints for a group ({@link SheetNounType}). */
        Noun: typeof SheetNounType;
        /** The band a group row draws ({@link SheetBandType}). */
        Band: typeof SheetBandType;
        /** The group declaration on the wire ({@link SheetGroupType}). */
        Group: typeof SheetGroupType;
        /** One band cell on the wire ({@link SheetGroupCellType}). */
        GroupCell: typeof SheetGroupCellType;
        /** The sheet's row collection ({@link SheetRowsCollectionType}). */
        Rows: typeof SheetRowsCollectionType;
        /** How the rows arrive — inline or paged ({@link SheetRowsType}). */
        RowSource: typeof SheetRowsType;
        /** One cell — the literal cell plus the typed link ({@link SheetCellType}). */
        Cell: typeof SheetCellType;
        /** The typed link value — `{ from, to }` member lists ({@link SheetLinkType}). */
        Link: typeof SheetLinkType;
        /** One link member ({@link SheetMemberType}). */
        Member: typeof SheetMemberType;
        /** A list of link members. */
        Members: typeof SheetMembersType;
        /** A count of a countable member ({@link SheetCountedType}). */
        Counted: typeof SheetCountedType;
        /** Which halves a driver member makes live ({@link SheetSidesValueType}). */
        Sides: typeof SheetSidesValueType;
        /** One half of a link ({@link SheetHalfType}). */
        Half: typeof SheetHalfType;
        /** How a `String`-backed link writes back ({@link SheetStoreType}). */
        Store: typeof SheetStoreType;
        /** One register member ({@link SheetRegisterMemberType}). */
        RegisterMember: typeof SheetRegisterMemberType;
        /** A list of register members — what `Sheet.link.parse` resolves against. */
        RegisterMembers: typeof SheetRegisterMembersType;
        /** One register ({@link SheetRegisterType}). */
        Register: typeof SheetRegisterType;
        /** The driver ({@link SheetDriverType}). */
        Driver: typeof SheetDriverType;
        /** One member kind a link column accepts ({@link SheetMemberKindType}). */
        MemberKind: typeof SheetMemberKindType;
        /** The counted-member grammar ({@link SheetMultipleType}). */
        Multiple: typeof SheetMultipleType;
        /** One lock rule ({@link SheetSideLockType}). */
        SideLock: typeof SheetSideLockType;
        /** A link column's applied sides declaration ({@link SheetSidesType}). */
        SidesDeclaration: typeof SheetSidesType;
        /** One declared column ({@link SheetColumnType}). */
        Column: typeof SheetColumnType;
        /** The column kind ({@link SheetColumnKindType}). */
        ColumnKind: typeof SheetColumnKindType;
        /** The WIRE copilot context ({@link SheetContextType}); authors use `Context(R, D)`. */
        WireContext: typeof SheetContextType;
        /** The WIRE fill ({@link SheetFillType}); authors use `Fill(T)`. */
        WireFill: typeof SheetFillType;
        /** The WIRE proposal ({@link SheetProposalType}); authors use `Proposal(R)`. */
        WireProposal: typeof SheetProposalType;
        /** A fill provider on the wire — sync or async ({@link SheetProviderType}). */
        Provider: typeof SheetProviderType;
        /** A row proposer on the wire ({@link SheetProposerType}). */
        Proposer: typeof SheetProposerType;
        /** The row-proposal declaration ({@link SheetSuggestType}). */
        Suggest: typeof SheetSuggestType;
        /** The WIRE check context ({@link SheetCheckContextType}); authors use `CheckContext(R)`. */
        WireCheckContext: typeof SheetCheckContextType;
        /** One member check ({@link SheetCheckType}). */
        Check: typeof SheetCheckType;
        /** A link column's arity rule on the wire ({@link SheetArityType}). */
        Arity: typeof SheetArityType;
        /** One saved view ({@link SheetViewType}). */
        View: typeof SheetViewType;
        /** The WIRE edit event ({@link SheetEditType}); internal gesture transport. */
        WireEdit: typeof SheetEditType;
        /** The selection ring's position ({@link SheetSelectionType}). */
        Selection: typeof SheetSelectionType;
        /** One footer item ({@link SheetFooterItemType}). */
        FooterItem: typeof SheetFooterItemType;
        /** The Sheet style ({@link SheetStyleType}). */
        Style: typeof SheetStyleType;
        /** `Context(R, D)` — the copilot context typed over the host's row and the driver's; `Context(P, "lines", D)` on a grouped sheet ({@link SheetContextTypeFor}, {@link SheetGroupContextTypeFor}). */
        Context: typeof sheetContextType;
        /** Constructs the draft-aware row, neighbours, group and driver context. */
        DraftContext: typeof sheetContextType;
        /** `Fill(T)` — a proposed value of a column's payload ({@link SheetFillTypeFor}). */
        Fill: typeof SheetFillTypeFor;
        /** `Patch(R)` — a row patch, every field an `Option` ({@link SheetPatchTypeFor}). */
        Patch: typeof SheetPatchTypeFor;
        /** `Proposal(R)` — a patch plus its provenance ({@link SheetProposalTypeFor}). */
        Proposal: typeof SheetProposalTypeFor;
        /** `CheckContext(R)` — what an author's member check sees; `CheckContext(P, "lines")` on a grouped sheet ({@link SheetCheckContextTypeFor}, {@link SheetGroupCheckContextTypeFor}). */
        CheckContext: typeof sheetCheckContextType;
    };
}

/** The namespace's members — everything `Sheet` carries beside the tag itself. */
const SHEET_MEMBERS = {
    column: { text, date, quantity, integer, lookup, reference, enum: enumColumn, set, link, stamped, custom },
    register: { members: createMembers, concat: concatMembers },
    driver: createDriver,
    link: { arity: createArity, check, parse: parseLink, print: printLink },
    patch: createPatch,
    library: { rows: libraryRows, columns: libraryColumns, tab: libraryTab },
    field: SheetField,
    subRows: createSubRows,
    subRow: createSubRow,
    apply: applySheet,
    group: Object.assign(createGroup, {
        cell: { text: groupText, date: groupDate, quantity: groupQuantity, integer: groupInteger, reference: groupReference, enum: groupEnum, stamped: groupStamped },
    }),
    Types: {
        Entry: SheetEntryTypeFor,
        DraftGroup: SheetDraftGroupTypeFor,
        DraftEntry: SheetDraftEntryTypeFor,
        DraftChange: SheetDraftChangeTypeFor,
        PatchEvent: SheetPatchEventTypeFor,
        Position: SheetPositionType,
        EntryPlacement: SheetEntryPlacementType,
        RowDestination: SheetRowDestinationType,
        FieldIssue: SheetFieldIssueType,
        Readiness: SheetReadinessType,
        Issue: SheetIssueType,
        BatchReadiness: SheetBatchReadinessType,
        Origin: SheetOriginType,
        ApplyResult: SheetApplyResultType,
        NewRow: SheetNewRowType,
        NewGroup: SheetNewGroupType,
        Draft: SheetDraftTypeFor,
        Base: SheetBaseTypeFor,
        Change: SheetChangeTypeFor,
        ChangeSet: SheetChangeSetTypeFor,
        Applied: SheetAppliedTypeFor,
        Root: SheetRootType,
        Row: SheetRowType,
        Line: SheetLineType,
        SubRow: SheetSubRowType,
        Facet: SheetFacetType,
        DateLevel: SheetDateLevelType,
        OptionsRule: SheetOptionsRuleType,
        Noun: SheetNounType,
        Band: SheetBandType,
        Group: SheetGroupType,
        GroupCell: SheetGroupCellType,
        Rows: SheetRowsCollectionType,
        RowSource: SheetRowsType,
        Cell: SheetCellType,
        Link: SheetLinkType,
        Member: SheetMemberType,
        Members: SheetMembersType,
        Counted: SheetCountedType,
        Sides: SheetSidesValueType,
        Half: SheetHalfType,
        Store: SheetStoreType,
        RegisterMember: SheetRegisterMemberType,
        RegisterMembers: SheetRegisterMembersType,
        Register: SheetRegisterType,
        Driver: SheetDriverType,
        MemberKind: SheetMemberKindType,
        Multiple: SheetMultipleType,
        SideLock: SheetSideLockType,
        SidesDeclaration: SheetSidesType,
        Column: SheetColumnType,
        ColumnKind: SheetColumnKindType,
        WireContext: SheetContextType,
        WireFill: SheetFillType,
        WireProposal: SheetProposalType,
        Provider: SheetProviderType,
        Proposer: SheetProposerType,
        Suggest: SheetSuggestType,
        WireCheckContext: SheetCheckContextType,
        Check: SheetCheckType,
        Arity: SheetArityType,
        View: SheetViewType,
        WireEdit: SheetEditType,
        Selection: SheetSelectionType,
        FooterItem: SheetFooterItemType,
        Style: SheetStyleType,
        Context: sheetContextType,
        DraftContext: sheetContextType,
        Fill: SheetFillTypeFor,
        Patch: SheetPatchTypeFor,
        Proposal: SheetProposalTypeFor,
        CheckContext: sheetCheckContextType,
    },
};

/**
 * The planning spreadsheet, `<Sheet>`: the one Sheet. It renders in its
 * `BuilderFrame` wherever it is used — one toolbar holding every control the
 * sheet has, the banners, the grid in main with its strip docked under it,
 * the footer — and its panes are optional props: no prop, no pane.
 *
 * @remarks
 * - **The rows** are `record`'s — its entries, in key order, each row's id
 *   its key's text (`window` reads a large one a window at a time); or with
 *   `entry`, one entry's Array field, in its own order, identified by
 *   `entry.id` — its rows, its groups, or its groups with loose rows between
 *   them (`Sheet.Types.Entry(P, "lines")`, #846). Or they are `data`'s: an
 *   `Array<R>`, a bind handle or a paged source, identified by `id`.
 * - **Every gesture is a draft** of the shared editing session, which the
 *   history item in the one toolbar undoes, redoes and discards. Over a
 *   record, Save commits the drafts as one patch through the record's patch
 *   mutation, checked against what each row was when the edit began; over
 *   `data`, it hands the checked batch to `onApply` (or `onUpdate` rebuilds
 *   the collection), and with neither the sheet is read only.
 * - **The library pane** (`library`) lists its tabs, in order:
 *   `Sheet.library.rows()` (the templates), `Sheet.library.columns()` (hide
 *   and show columns, per viewer) and `Sheet.library.tab(data, { … })`, the
 *   author's own cards, whose `drop` is the `Sheet.patch` a dropped card sets.
 * - **The inspector pane** (`inspector`) shows the selected row's every
 *   field — a field with a column through its column's kind, any other by its
 *   type, hinted with `fields={{ created_by: Sheet.field.readonly() }}` (and
 *   `groupFields` for a group's own) — and the batch's Issues; given a
 *   function `(row, update) => UIComponentType`, Details for a complete row
 *   are the author's own.
 * - **Templates** (`templates={{ rows, groups }}`) are the Rows tab's cards,
 *   each `{ key, name, group?, values: Sheet.patch(…) }`: a dropped card is
 *   `newRow`'s (or `newGroup`'s) defaults with the template's fields over them.
 * - **Views** (`views`) are a bind handle: `State.bind` keeps them per viewer,
 *   `Data.bind` shares them.
 * - **The namespace**: the columns (`Sheet.column.*`, row type first),
 *   registers (`Sheet.register.members` / `.concat`) and the driver
 *   (`Sheet.driver`), link rules (`Sheet.link.*`), proposed rows and new-row
 *   defaults (`Sheet.patch`), the library's tabs (`Sheet.library.*`) and the
 *   inspector's hints (`Sheet.field.*`), groups (`Sheet.group`, #740), sub
 *   rows (`Sheet.subRows` / `Sheet.subRow`, #844), a checked batch applied to
 *   a collection (`Sheet.apply`), and every East type — the closed wire types
 *   and the typed constructors `DraftContext(R, D)` / `Fill(T)` / `Patch(R)`
 *   / `Proposal(R)` / `PatchEvent(E)` / `ChangeSet(E)` / `Entry(G, "rows")` /
 *   `CheckContext(R)` — via `Sheet.Types.*`.
 *
 * The sheet fills its parent and draws no border of its own: a ui task's
 * page fills the window, and a sheet among other components is given a box
 * of its own height. `name` keeps two sheets on one surface apart.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { DateTimeType, DictType, East, FloatType, OptionType, StringType, StructType, none, some } from "@elaraai/east";
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
 *
 * const sheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const jobs = $.let(Record.bind(sheetJobs, [sheetJobsPatch]));
 *         return (
 *             <Box height="560px">
 *                 <Sheet
 *                     record={jobs}
 *                     columns={{
 *                         task:  Sheet.column.text(SheetJob, { header: "Task", width: "240px" }),
 *                         start: Sheet.column.date(SheetJob, { header: "Start", width: "96px" }),
 *                         qty:   Sheet.column.quantity(SheetJob, { header: "Qty", width: "96px" }),
 *                     }}
 *                 />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export const Sheet: SheetNamespace = Object.assign(SheetTag, SHEET_MEMBERS);

/**
 * The type of the internal Sheet namespace — the public one, the payload the
 * tag returns through its carrier, the grid's root alone, and the carrier the
 * renderer registers against.
 */
export interface SheetInternalNamespace extends SheetNamespace {
    /** Creates the sheet's payload alone — what `<Sheet>` returns through the `Sheet` carrier ({@link createSheetPayload}). */
    Payload: typeof createSheetPayload;
    /** Creates the grid's root alone — the rows, the columns and the session the payload carries as its `sheet` ({@link createSheetRoot}). */
    Root: typeof createSheetRoot;
    /** The `Sheet` carrier ({@link SheetComponent}). */
    Component: typeof SheetComponent;
}

/** `<Sheet>`, for the internal namespace: the tag, on an object of its own, so the public `Sheet` carries none of the internal members. */
function SheetInternalTag(props: { columns: unknown }): ReturnType<SheetTagType> {
    return (SheetTag as (p: { columns: unknown }) => ReturnType<SheetTagType>)(props);
}

/**
 * The internal Sheet namespace — `@elaraai/e3-ui/internal`'s `Sheet`: the
 * public one, `Sheet.Payload`, `Sheet.Root` and the `Sheet` carrier, for the
 * renderer and the tests.
 *
 * @internal
 */
export const SheetInternal: SheetInternalNamespace = Object.assign(SheetInternalTag as SheetTagType, SHEET_MEMBERS, {
    Payload: createSheetPayload,
    Root: createSheetRoot,
    Component: SheetComponent,
});
