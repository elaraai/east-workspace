/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Sheet` IR — the UIComponent-free types of the planning spreadsheet
 * (`libs/east-ui/docs/proposals/Sheet Spec.md` §4).
 *
 * A sheet's rows are the host's structs, projected by the factory into a
 * CLOSED wire row — an id, an `owned` flag and one cell per declared column
 * — through the columns' reified accessors (the Table `valueFn` move, the
 * Plan `derive` move). The host's row type `R` and the driver's row type `D`
 * never appear here: everything the author writes over them is bridged by
 * the factory into the closed context / cell / edit types below (§4.8), so
 * the root `<Sheet>`'s payload carries ({@link SheetRootType}) is a closed
 * type.
 *
 * This file holds only plain data and closed function types — no
 * `UIComponentType`. The author-facing TYPED constructors (`Sheet.Types.Context(R, D)`, `Fill(T)`,
 * `Patch(R)`, `Proposal(R)`, `CheckContext(R)`) live here too:
 * they are type-level twins of the wire types, instantiated per row type
 * (the `Plan.Types.Series(R)` pattern).
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type SubtypeExprOrValue,
    ArrayType,
    type ArrayType as ArrayTypeOf,
    AsyncFunctionType,
    BooleanType,
    BlobType,
    DateTimeType,
    DictType,
    EastTypeType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { SheetDraftTypeFor, type SheetDraftOf } from "./transactions.js";
import { SheetDraftGroupTypeFor, type SheetDraftGroupOf } from "./drafts.js";
import { SheetEditingType } from "./editing-types.js";
import { DensityType, RowSourceType, StatusValueType } from "@elaraai/east-ui";
import { FieldOptionType, FieldSpecType, RecordSlicesChromeType, RecordSliceStateType, TickFormatType } from "@elaraai/east-ui/internal";

// ============================================================================
// Links — members, the typed link value, the cell
// ============================================================================

/**
 * One member of a link half — what the link grammar resolves a token to
 * (B§4.1).
 *
 * @remarks
 * A member is never a bare string the host has to re-parse: a code that
 * resolved against the register is `identified`, a `R2140-45` span is a
 * `range` the register expands, a `4 × CNC router` count is `counted`, `TBC` is
 * the dashed `placeholder`, and anything the grammar did not recognise is
 * kept verbatim as `text` — typed entry is never blocked.
 *
 * @property identified - A register code (`"R2140"`)
 * @property range - A span of codes, `from` to `to` (`"R2140-45"`, the upper bound completed)
 * @property counted - A count of a countable member (`{ n: 4, key: "CNC router" }`)
 * @property placeholder - The `TBC` placeholder
 * @property text - Free text the grammar kept as typed
 */
export const SheetMemberType = VariantType({
    identified:  StructType({ key: StringType }),
    range:       StructType({ from: StringType, to: StringType }),
    counted:     StructType({ n: IntegerType, key: StringType }),
    placeholder: NullType,
    text:        StringType,
});
/** Type alias for {@link SheetMemberType}. */
export type SheetMemberType = typeof SheetMemberType;

/**
 * The typed link value — a directed hyperedge between two sets of members
 * (B§4).
 *
 * @remarks
 * A destination-only link is `from: []`; a source-only link is `to: []`, so
 * the single-set data of B§4.2 needs no migration. The renderer's grammar is
 * the kind's parse / print pair (`Sheet.link.parse` / `Sheet.link.print`).
 *
 * @property from - The source members
 * @property to - The destination members
 */
export const SheetLinkType = StructType({
    from: ArrayType(SheetMemberType),
    to:   ArrayType(SheetMemberType),
});
/** Type alias for {@link SheetLinkType}. */
export type SheetLinkType = typeof SheetLinkType;

/**
 * An action column's cell (#1474) — the case a row is in, and its value
 * encoded (beast2, at the case's type), which the column's case names.
 *
 * @property case - The case's name
 * @property value - Its value, encoded
 */
export const SheetActionCellType = StructType({ case: StringType, value: BlobType });
/** Type alias for {@link SheetActionCellType}. */
export type SheetActionCellType = typeof SheetActionCellType;

/**
 * One cell of the wire row — the Table's literal cell (#206) plus the
 * typed link.
 *
 * @remarks
 * `Null` is the blank cell. A scalar column's cell is the field's value at
 * the column kind's primitive; a `set` / `link` column's cell is a
 * {@link SheetLinkType} value, never a string.
 *
 * @property Invalid - Unparseable draft text, retained verbatim until corrected
 * @property Null - The blank cell
 * @property Boolean - A boolean value (a Record's `boolean` / `toggle` column's cell)
 * @property Integer - An integer value
 * @property Float - A float value (a `quantity` column's cell)
 * @property String - A string value (text · lookup · reference · enum · stamped; a Record's title · person · cycle)
 * @property DateTime - A UTC-midnight date (a `date` column's cell); the moment an `age` counts from, or an `audit`'s change was made
 * @property Link - A typed link (a `set` / `link` column's cell)
 * @property Action - An action column's case (#1474): its name, and its value encoded (beast2, at the case's type)
 */
export const SheetCellType = VariantType({
    Invalid:  StringType,
    Null:     NullType,
    Boolean:  BooleanType,
    Integer:  IntegerType,
    Float:    FloatType,
    String:   StringType,
    DateTime: DateTimeType,
    Link:     SheetLinkType,
    Action:   SheetActionCellType,
});
/** Type alias for {@link SheetCellType}. */
export type SheetCellType = typeof SheetCellType;

/**
 * One labelled fact of a sub row's detail (#844).
 *
 * @property label - What the fact is (the renderer sets it in capitals)
 * @property value - The fact, printed
 */
export const SheetFacetType = StructType({
    label: StringType,
    value: StringType,
});
/** Type alias for {@link SheetFacetType}. */
export type SheetFacetType = typeof SheetFacetType;

/**
 * One SUB ROW on the wire (#844) — a read-only row under a line (or a flat
 * row) that shares none of the sheet's columns: a lead (`code` and `name`),
 * a detail (`chips`, then `facets`) and an `id` pinned right.
 *
 * @remarks
 * `code` and `id` are display strings, `""` for none (the band's `sub`
 * precedent). Build one with `Sheet.subRow({ … })`; declare where they come
 * from with `Sheet.subRows(R, { … })`.
 *
 * @property code - The lead's code (`"ASM"`, or a word for what the row is); `""` for none
 * @property name - The lead's words
 * @property chips - The detail's parameter chips, first
 * @property facets - The detail's labelled facts, after the chips
 * @property id - The record the sub row traces to; `""` for none
 */
export const SheetSubRowType = StructType({
    code:   StringType,
    name:   StringType,
    chips:  ArrayType(StringType),
    facets: ArrayType(SheetFacetType),
    id:     StringType,
});
/** Type alias for {@link SheetSubRowType}. */
export type SheetSubRowType = typeof SheetSubRowType;

/**
 * One LINE of a group row on the wire (#740) — its cells, addressed within
 * its group by `key`.
 *
 * @remarks
 * A line has no id of its own: its `key` is its index in the group's lines
 * array, printed. The line's cells are the line columns' projection, exactly
 * a flat row's `cells`.
 *
 * @property key - The line's address within its group
 * @property cells - Column key → cell, one entry per declared line column
 * @property subRows - The line's sub rows, in declaration order (#844; empty without `subRows`)
 */
export const SheetLineType = StructType({
    key:     StringType,
    cells:   DictType(StringType, SheetCellType),
    subRows: ArrayType(SheetSubRowType),
});
/** Type alias for {@link SheetLineType}. */
export type SheetLineType = typeof SheetLineType;

/**
 * The band a group row draws above its lines (#740) — what the band shows
 * beside its cells.
 *
 * @property sub - The eyebrow under the title (display only; `""` for none)
 * @property folded - Whether the plan opens folded
 */
export const SheetBandType = StructType({
    sub:    StringType,
    folded: BooleanType,
});
/** Type alias for {@link SheetBandType}. */
export type SheetBandType = typeof SheetBandType;

/** The cell key a group row's title rides under (#740) — never a line column's key. */
export const SHEET_TITLE_CELL = "$title";

/**
 * The key of an UNRENDERED cell a column's rule projects into (#844) — a
 * date column's `level` / `actual`, a column's `detail`. The `$` prefix keeps
 * it clear of every field name, as {@link SHEET_TITLE_CELL} is.
 *
 * @param rule - The rule (`"level"`, `"actual"`, `"detail"`; an action column's `"summary"`, `"name"`, `"title"`; an audit column's `"by"`, `"verb"`)
 * @param column - The column key
 * @returns The cell key (`"$level:start"`)
 */
export function sheetRuleCell(rule: "level" | "actual" | "detail" | "summary" | "name" | "title" | "by" | "verb", column: string): string {
    return `$${rule}:${column}`;
}

/**
 * One wire row — the closed projection of a host row.
 *
 * @remarks
 * `cells` carries one entry per DECLARED column, always present (a blank
 * cell is `Null`); a field of the host's row with no column never crosses
 * the wire — the bridge (§4.8) reads it off the real row instead. Blank
 * padding rows are renderer state, never rows.
 *
 * On a GROUPED sheet (#740) a group row's `cells` hold the band's cells (the
 * group's fields under line columns, the title under
 * {@link SHEET_TITLE_CELL}), `lines` its lines and `band` is `some`. On a
 * flat sheet `lines` is empty and `band` is `none` — and so on a grouped
 * sheet with LOOSE rows between its groups (#846): a loose row is a row of
 * the line type, its `cells` the line columns' projection, with no lines
 * and no band.
 *
 * @property id - The row identity (the `id` field, or a keyed source's key)
 * @property owned - `true` ⇒ the row belongs to the upstream system: no copilot, stamped columns read-only
 * @property cells - Column key → cell, one entry per declared column
 * @property lines - A group row's lines, in order (empty on a flat sheet, and for a loose row)
 * @property band - A group row's band (`none` on a flat sheet, and for a loose row)
 * @property subRows - A flat or loose row's sub rows (#844; empty for a group row, whose lines carry them)
 */
export const SheetRowType = StructType({
    id:      StringType,
    owned:   BooleanType,
    cells:   DictType(StringType, SheetCellType),
    lines:   ArrayType(SheetLineType),
    band:    OptionType(SheetBandType),
    subRows: ArrayType(SheetSubRowType),
});
/** Type alias for {@link SheetRowType}. */
export type SheetRowType = typeof SheetRowType;

/**
 * The sheet's own row COLLECTION — wire rows in sheet order.
 *
 * @remarks
 * The Sheet is POSITIONAL like the Table: the planner's order is the source's
 * order, so the collection is an `Array` (a `Dict` inline is refused at
 * build time — a sorted map would sit rows in key order).
 */
export const SheetRowsCollectionType = ArrayType(SheetRowType);
/** Type alias for {@link SheetRowsCollectionType}. */
export type SheetRowsCollectionType = typeof SheetRowsCollectionType;

/**
 * How a sheet's rows arrive — inline, or a window at a time — the shared
 * row-source contract (#567 / #576) at the sheet's row collection.
 */
export const SheetRowsType = RowSourceType(SheetRowsCollectionType);
/** Type alias for {@link SheetRowsType}. */
export type SheetRowsType = typeof SheetRowsType;

// ============================================================================
// Registers and the driver
// ============================================================================

/**
 * One register member — the grammar's vocabulary, and nothing else.
 *
 * @remarks
 * There is no attribute bag: what a declaration needs from a driver row
 * (`uom`, `sides`) is read by an accessor at build time and stored per driver
 * key on the column that needs it ({@link SheetColumnKindType}); what a
 * provider needs (`ctx.driver`) is the typed row, looked up by the bridge.
 *
 * @property key - What the grammar resolves (`"R2140"`, `"Bay 2"`, `"CNC router"`)
 * @property label - What a chip prints
 * @property kind - The member kind (`"machine"` · `"bay"` · `"family"` · `"activity"` · …)
 * @property aliases - Alternative spellings the grammar also resolves (`"the 2 bay"`)
 * @property meta - Chip meta, shown when a half holds one chip (`"CNC router"`, `"bay · 96"`)
 * @property parent - A member's parent key — countable → identified resolution and "enumerate"
 * @property tone - An `enum` member's valence dot
 */
export const SheetRegisterMemberType = StructType({
    key:     StringType,
    label:   StringType,
    kind:    StringType,
    aliases: ArrayType(StringType),
    meta:    OptionType(StringType),
    parent:  OptionType(StringType),
    tone:    OptionType(StatusValueType),
});
/** Type alias for {@link SheetRegisterMemberType}. */
export type SheetRegisterMemberType = typeof SheetRegisterMemberType;

/**
 * One register — a list of members a column resolves against.
 *
 * @property members - The members, in declaration order
 */
export const SheetRegisterType = StructType({
    members: ArrayType(SheetRegisterMemberType),
});
/** Type alias for {@link SheetRegisterType}. */
export type SheetRegisterType = typeof SheetRegisterType;

/**
 * The driver — the `lookup` column whose member decides what the row does
 * (B§1), with its members.
 *
 * @property column - The driver column's key
 * @property members - The driver's register members
 */
export const SheetDriverType = StructType({
    column:  StringType,
    members: ArrayType(SheetRegisterMemberType),
});
/** Type alias for {@link SheetDriverType}. */
export type SheetDriverType = typeof SheetDriverType;

// ============================================================================
// Link-column vocabulary — halves, sides, locks, counted members
// ============================================================================

/**
 * One half of a link.
 *
 * @property from - The source half
 * @property to - The destination half
 */
export const SheetHalfType = VariantType({ from: NullType, to: NullType });
/** Type alias for {@link SheetHalfType}. */
export type SheetHalfType = typeof SheetHalfType;
/** String-literal shorthand for {@link SheetHalfType}. */
export type SheetHalfLiteral = "from" | "to";

/**
 * Which halves of a link column a driver member makes live (B§4.2) —
 * `Sheet.Types.Sides`, the type a driver row's `sides` field carries.
 *
 * @property both - Both halves live
 * @property from - Only the source half
 * @property to - Only the destination half
 * @property in - In place: the minus glyph, neither half moves anything
 */
export const SheetSidesValueType = VariantType({ both: NullType, from: NullType, to: NullType, in: NullType });
/** Type alias for {@link SheetSidesValueType}. */
export type SheetSidesValueType = typeof SheetSidesValueType;
/** String-literal shorthand for {@link SheetSidesValueType}. */
export type SheetSidesLiteral = "both" | "from" | "to" | "in";

/**
 * How a `String`-backed link column writes its commit back (B§4.2).
 *
 * @property asTyped - The planner's text, verbatim
 * @property canonical - Rewritten to register labels (evaluated by the renderer)
 */
export const SheetStoreType = VariantType({ asTyped: NullType, canonical: NullType });
/** Type alias for {@link SheetStoreType}. */
export type SheetStoreType = typeof SheetStoreType;
/** String-literal shorthand for {@link SheetStoreType}. */
export type SheetStoreLiteral = "asTyped" | "canonical";

/**
 * One member kind a link column accepts, and how (B§4.1).
 *
 * @property kind - The register member kind (`"machine"`, `"bay"`, `"family"`, `"range"`)
 * @property identified - The kind resolves by code (bare digits try the code prefix)
 * @property countable - The kind takes the counted form (`N x kind`)
 * @property resolvesTo - What a counted member of this kind resolves to later (`"machine"`)
 * @property ranged - Runs of consecutive identified codes are offered and printed as one range (`R2140-45`, #844)
 */
export const SheetMemberKindType = StructType({
    kind:       StringType,
    identified: BooleanType,
    countable:  BooleanType,
    resolvesTo: OptionType(StringType),
    ranged:     BooleanType,
});
/** Type alias for {@link SheetMemberKindType}. */
export type SheetMemberKindType = typeof SheetMemberKindType;

/**
 * The counted-member grammar a link column declares (B§4.1).
 *
 * @property forms - The accepted forms (`"N x kind"`, `"kind x N"`)
 * @property ops - The multiplication tokens (`"x"`, `"X"`, `"*"`, `"×"`)
 * @property appliesTo - Which member kinds may be counted (`"countable"`)
 */
export const SheetMultipleType = StructType({
    forms:     ArrayType(StringType),
    ops:       ArrayType(StringType),
    appliesTo: StringType,
});
/** Type alias for {@link SheetMultipleType}. */
export type SheetMultipleType = typeof SheetMultipleType;

/**
 * One lock rule — the tag a half shows when the driver's sides value makes
 * it read-only (B§4.2).
 *
 * @property half - The locked half
 * @property when - The driver's sides value that locks it
 * @property label - The lock tag text (`"external"`, `"in place"`)
 */
export const SheetSideLockType = StructType({
    half:  SheetHalfType,
    when:  SheetSidesValueType,
    label: StringType,
});
/** Type alias for {@link SheetSideLockType}. */
export type SheetSideLockType = typeof SheetSideLockType;

/**
 * A link column's sides declaration — the driver's `sides` accessor APPLIED
 * over the driver data, plus the lock rules.
 *
 * @remarks
 * The accessor itself never reaches the wire: the builder reifies it against
 * the driver's row type and the root evaluates it once per driver member, so
 * the renderer looks a row's sides up by its driver key.
 *
 * @property byDriver - Driver member key → the sides value
 * @property locks - The lock rules
 */
export const SheetSidesType = StructType({
    byDriver: DictType(StringType, SheetSidesValueType),
    locks:    ArrayType(SheetSideLockType),
});
/** Type alias for {@link SheetSidesType}. */
export type SheetSidesType = typeof SheetSidesType;

/**
 * A count of a countable member — the `n × CNC router` form (B§4.5) —
 * `Sheet.Types.Counted`, what an arity rule proposes.
 *
 * @property n - The count
 * @property key - The countable member's key
 */
export const SheetCountedType = StructType({ n: IntegerType, key: StringType });
/** Type alias for {@link SheetCountedType}. */
export type SheetCountedType = typeof SheetCountedType;

// ============================================================================
// The copilot — the WIRE context, fills, proposals, providers
// ============================================================================

/**
 * The WIRE copilot context — what the renderer hands a bridged provider.
 *
 * @remarks
 * The bridge (§4.8) rebuilds the author's typed context from it: `row` is
 * decoded over the REAL source row (`rowById(rowId, offset)`), every entry of
 * `rows` over its own (`rowsOffset + index`), and `driver` through the
 * driver lookup — so a field of the host's row that has no column keeps its
 * value in every provider, check, edit event and patch.
 *
 * @property drafts - Row id → its current draft, encoded
 * @property rowIndex - The row's index in `rows` (a grouped sheet: a line's index within its group)
 * @property rowId - The row's id — the source lookup's argument (a grouped sheet: a line's GROUP's id, a loose row's own)
 * @property offset - The row's source offset — the paged arm's `page` lookup
 * @property line - A grouped sheet: the line's address within its group; `none` on a flat sheet, and for a loose row (#846)
 * @property row - The row as it would be if the open editor committed (a grouped sheet: the LINE's cells)
 * @property rows - The resident sheet, real rows in sheet order (a grouped sheet: the resident GROUP rows and loose rows)
 * @property rowsOffset - The source offset of `rows[0]` (`0` on the inline arm)
 * @property partial - `true` on a paged sheet whose source is not exhausted
 * @property driver - The resolved driver member's key
 * @property today - UTC midnight — so providers stay pure
 */
export const SheetContextType = StructType({
    drafts:     DictType(StringType, BlobType),
    rowIndex:   IntegerType,
    rowId:      StringType,
    offset:     IntegerType,
    line:       OptionType(StringType),
    row:        DictType(StringType, SheetCellType),
    rows:       ArrayType(SheetRowType),
    rowsOffset: IntegerType,
    partial:    BooleanType,
    driver:     OptionType(StringType),
    today:      DateTimeType,
});
/** Type alias for {@link SheetContextType}. */
export type SheetContextType = typeof SheetContextType;

/**
 * One row check of a readiness batch ({@link SheetReadyBatchType}, #882) —
 * where its row sits among the batch's rows, and its driver.
 * @internal
 *
 * @property index - The checked row's index in the batch's `rows` (a grouped sheet: a line's GROUP's)
 * @property line - A grouped sheet: the checked line's index within its group; `none` on a flat sheet, and for a loose row (#846)
 * @property driver - The resolved driver member's key
 */
export const SheetReadyCheckType = StructType({
    index:  IntegerType,
    line:   OptionType(IntegerType),
    driver: OptionType(StringType),
});
/** Type alias for {@link SheetReadyCheckType}. */
export type SheetReadyCheckType = typeof SheetReadyCheckType;

/**
 * The WIRE readiness batch (#882) — every row check of one readiness
 * evaluation, over the rows they share.
 * @internal
 *
 * @remarks
 * The shared fields cross the wire once, and the bridge builds the typed
 * rows from them once. A check carries only its place and its driver: its
 * row is the draft the bridge built at that place — the row's own cells over
 * its own draft — so nothing is substituted into the rows, as a
 * {@link SheetContextType}'s provisional row is.
 *
 * @property drafts - Row id → its current draft, encoded
 * @property rows - The rows, in sheet order (a grouped sheet: the GROUP rows)
 * @property rowsOffset - The source offset of `rows[0]`
 * @property partial - `true` on a paged sheet whose source is not exhausted
 * @property today - UTC midnight — so checks stay pure
 * @property checks - The checks; their results return in this order
 */
export const SheetReadyBatchType = StructType({
    drafts:     DictType(StringType, BlobType),
    rows:       ArrayType(SheetRowType),
    rowsOffset: IntegerType,
    partial:    BooleanType,
    today:      DateTimeType,
    checks:     ArrayType(SheetReadyCheckType),
});
/** Type alias for {@link SheetReadyBatchType}. */
export type SheetReadyBatchType = typeof SheetReadyBatchType;

/**
 * The WIRE fill — one proposed cell value with its provenance (B§5.1).
 *
 * @property value - The proposed cell
 * @property meta - The provenance line the strip prints
 */
export const SheetFillType = StructType({ value: SheetCellType, meta: StringType });
/** Type alias for {@link SheetFillType}. */
export type SheetFillType = typeof SheetFillType;

/**
 * The WIRE proposal — one proposed row as the cells a patch set, with its
 * provenance (B§5.2).
 *
 * @property cells - The set fields, encoded; a field the patch left `none` is absent
 * @property meta - The provenance line
 */
export const SheetProposalType = StructType({ cells: DictType(StringType, SheetCellType), meta: StringType });
/** Type alias for {@link SheetProposalType}. */
export type SheetProposalType = typeof SheetProposalType;

/**
 * One fill provider on the wire — synchronous, or asynchronous (a model
 * call). The factory picks the arm from the author's function value's East
 * type and bridges it (§4.8).
 *
 * @property sync - Runs inline within the kind's latency
 * @property async - The strip shows a pending chip; the result lands reactively, latest wins
 */
export const SheetProviderType = VariantType({
    sync:  FunctionType([SheetContextType], OptionType(SheetFillType)),
    async: AsyncFunctionType([SheetContextType], OptionType(SheetFillType)),
});
/** Type alias for {@link SheetProviderType}. */
export type SheetProviderType = typeof SheetProviderType;

/**
 * One row proposer on the wire — synchronous, or asynchronous.
 *
 * @property sync - Runs inline
 * @property async - Pending chip; latest wins
 */
export const SheetProposerType = VariantType({
    sync:  FunctionType([SheetContextType], ArrayType(SheetProposalType)),
    async: AsyncFunctionType([SheetContextType], ArrayType(SheetProposalType)),
});
/** Type alias for {@link SheetProposerType}. */
export type SheetProposerType = typeof SheetProposerType;

/**
 * The copilot's row-proposal declaration (B§5.2).
 *
 * @property ahead - At most this many proposed rows below the anchor
 * @property triggers - Column keys whose commit re-asks the proposers
 * @property ghost - Draw proposed rows as hatched ghosts (the default)
 * @property propose - The proposers, first that returns rows wins
 */
export const SheetSuggestType = StructType({
    ahead:    IntegerType,
    triggers: ArrayType(StringType),
    ghost:    BooleanType,
    propose:  ArrayType(SheetProposerType),
});
/** Type alias for {@link SheetSuggestType}. */
export type SheetSuggestType = typeof SheetSuggestType;

// ============================================================================
// Checks and arity — the WIRE check context
// ============================================================================

/**
 * The WIRE check context — what a bridged member check receives (B§2).
 *
 * @property drafts - Row id → its current draft, encoded
 * @property group - A grouped sheet: the line's GROUP row; `none` on a flat sheet, and for a loose row (#846)
 * @property rowIndex - Sheet position among real rows (a grouped sheet: a line's index within its group, a loose row's among the loose rows)
 * @property rowId - The row's id (the source lookup's argument; a grouped sheet: a line's GROUP's id, a loose row's own)
 * @property offset - The row's source offset
 * @property line - A grouped sheet: the line's address within its group; `none` on a flat sheet, and for a loose row (#846)
 * @property row - The row as it would be if the editor committed (a grouped sheet: the LINE's cells)
 * @property half - The half being edited
 * @property member - The resolved member under check
 */
export const SheetCheckContextType = StructType({
    drafts:   DictType(StringType, BlobType),
    group:    OptionType(SheetRowType),
    rowIndex: IntegerType,
    rowId:    StringType,
    offset:   IntegerType,
    line:     OptionType(StringType),
    row:      DictType(StringType, SheetCellType),
    half:     SheetHalfType,
    member:   SheetMemberType,
});
/** Type alias for {@link SheetCheckContextType}. */
export type SheetCheckContextType = typeof SheetCheckContextType;

/**
 * One member check on a link column.
 *
 * @property exists - The grammar's own: the member must resolve in the register
 * @property custom - An author rule — `some(message)` flags the member, `none` passes
 */
export const SheetCheckType = VariantType({
    exists: NullType,
    custom: FunctionType([SheetCheckContextType], OptionType(StringType)),
});
/** Type alias for {@link SheetCheckType}. */
export type SheetCheckType = typeof SheetCheckType;

/**
 * A link column's arity rule — how many members a half should hold, and
 * which countable member to propose when none are named (B§4.6).
 *
 * @property half - The half the rule counts
 * @property implied - The bridged rule over the wire context
 */
export const SheetArityType = StructType({
    half:    SheetHalfType,
    implied: FunctionType([SheetContextType], OptionType(SheetCountedType)),
});
/** Type alias for {@link SheetArityType}. */
export type SheetArityType = typeof SheetArityType;

// ============================================================================
// Column kinds
// ============================================================================

/**
 * How deep a date column reads and takes a row's date (#844) —
 * `Sheet.Types.DateLevel`, what a date column's `level` rule returns.
 *
 * @remarks
 * The cell is still one UTC instant; the level says how it is printed,
 * typed and compared with an `actual`.
 *
 * @property week - The week the date falls in (printed as its Monday)
 * @property day - The day
 * @property range - One end of the days the work may run in
 * @property time - The day and the time of day
 */
export const SheetDateLevelType = VariantType({ week: NullType, day: NullType, range: NullType, time: NullType });
/** Type alias for {@link SheetDateLevelType}. */
export type SheetDateLevelType = typeof SheetDateLevelType;
/** String-literal shorthand for {@link SheetDateLevelType}. */
export type SheetDateLevelLiteral = "week" | "day" | "range" | "time";

/**
 * A column's OPTIONS rule on the wire (#844) — the register member keys a
 * row may be offered; `none` offers the whole register.
 */
export const SheetOptionsRuleType = FunctionType([SheetContextType], OptionType(ArrayType(StringType)));
/** Type alias for {@link SheetOptionsRuleType}. */
export type SheetOptionsRuleType = typeof SheetOptionsRuleType;

// ============================================================================
// Action columns (#1474) — a variant's state machine as a column
// ============================================================================

/**
 * How an action column's case is asked for (`Sheet Actions - DX Proposal.md`
 * §2): by its type, or by the author's `take`.
 *
 * @property button - Nothing to ask (`NullType`): taken on click
 * @property menu - A choice among a variant's cases, each `NullType`, with their words
 * @property register - A choice of a register's members, by the register's name (a `String` value)
 * @property form - A form of fields over the case's value — `Fields`' specs; `scalar` when the value is no struct, its one field at the case's name
 */
export const SheetActionTakeType = VariantType({
    button:   NullType,
    menu:     ArrayType(FieldOptionType),
    register: StringType,
    form:     StructType({ specs: ArrayType(FieldSpecType), scalar: BooleanType }),
});
/** Type alias for {@link SheetActionTakeType}. */
export type SheetActionTakeType = typeof SheetActionTakeType;

/**
 * What else an action wrote, as the cells its patches set: the row's, by
 * column, and its group's band, by the column each band cell sits under.
 *
 * @property row - The row's cells
 * @property group - The band's cells (empty on a flat sheet)
 */
export const SheetActionUpdatesType = StructType({
    row:   DictType(StringType, SheetCellType),
    group: DictType(StringType, SheetCellType),
});
/** Type alias for {@link SheetActionUpdatesType}. */
export type SheetActionUpdatesType = typeof SheetActionUpdatesType;

/**
 * Whether a row may act now.
 *
 * @property open - It may: its offer is its state's `next` (or `start`)
 * @property blocked - It may not, and why — the column's `blocked` said so
 * @property incomplete - It may not: these fields of its draft are still missing or unread (T6)
 */
export const SheetActionGateType = VariantType({
    open:       NullType,
    blocked:    StringType,
    incomplete: ArrayType(StringType),
});
/** Type alias for {@link SheetActionGateType}. */
export type SheetActionGateType = typeof SheetActionGateType;

/**
 * One case of an action column on the wire — a state and the action into it.
 *
 * @property case - The case's name
 * @property label - The action's verb ("Complete")
 * @property state - The state's word ("Completed")
 * @property tone - The state's tone; `none` is neutral
 * @property icon - A Font Awesome solid icon's name
 * @property next - The cases a row in this state may go to, in order; empty for a final state
 * @property take - How the case is asked for
 * @property valueType - The case's value type
 * @property initial - What a form opens with, over the wire context, encoded at the case's type
 * @property updates - What else taking the case writes: its value encoded, the wire context and the moment → the cells
 */
export const SheetActionCaseType = StructType({
    case:      StringType,
    label:     StringType,
    state:     StringType,
    tone:      OptionType(StatusValueType),
    icon:      OptionType(StringType),
    next:      ArrayType(StringType),
    take:      SheetActionTakeType,
    valueType: EastTypeType,
    initial:   OptionType(FunctionType([SheetContextType], BlobType)),
    updates:   OptionType(FunctionType([BlobType, SheetContextType, DateTimeType], SheetActionUpdatesType)),
});
/** Type alias for {@link SheetActionCaseType}. */
export type SheetActionCaseType = typeof SheetActionCaseType;

/**
 * An action column's kind on the wire (#1474).
 *
 * @property start - What a row with nothing taken may do (an `Option` field's)
 * @property cases - Every case, in the author's order
 * @property gate - Whether a row may act now, over the wire context: its draft complete, and not `blocked`
 * @property summary - The rule cell holding a row's summary (S7)
 * @property name - The rule cell holding how menus, forms and the strip name the row; `none` names it by its number
 * @property title - The rule cell holding the row's words beside its name
 */
export const SheetActionKindType = StructType({
    start:   ArrayType(StringType),
    cases:   ArrayType(SheetActionCaseType),
    gate:    FunctionType([SheetContextType], SheetActionGateType),
    summary: StringType,
    name:    OptionType(StringType),
    title:   OptionType(StringType),
});
/** Type alias for {@link SheetActionKindType}. */
export type SheetActionKindType = typeof SheetActionKindType;

// ============================================================================
// The Record's kinds — a system of records' columns
// ============================================================================

/**
 * The last change to a row, as the app keeps it — `Record.Types.Change`, the
 * type a row field holds for an audit column to show and an age column to
 * count from.
 *
 * @remarks
 * The app's own processes write it (an import, an integration, a mutation of
 * its own); a Record reads it and never writes it.
 *
 * @property at - When the row last changed, or was confirmed
 * @property by - Who did it, as the app names them
 * @property verb - What they did ("changed", "confirmed", "created")
 */
export const RecordChangeType = StructType({
    at:   DateTimeType,
    by:   StringType,
    verb: StringType,
});
/** Type alias for {@link RecordChangeType}. */
export type RecordChangeType = typeof RecordChangeType;

/**
 * How a cycle or toggle cell draws its state.
 *
 * @property chip - A chip holding the state's label
 * @property mark - A quieter mark: pips for a scale, a dot and a word for a tone
 */
export const SheetLookType = VariantType({ chip: NullType, mark: NullType });
/** Type alias for {@link SheetLookType}. */
export type SheetLookType = typeof SheetLookType;
/** String-literal shorthand for {@link SheetLookType}. */
export type SheetLookLiteral = "chip" | "mark";

/**
 * What an age column counts.
 *
 * @property hours - Whole hours
 * @property days - Whole days
 * @property weeks - Whole weeks
 */
export const SheetAgeUnitType = VariantType({ hours: NullType, days: NullType, weeks: NullType });
/** Type alias for {@link SheetAgeUnitType}. */
export type SheetAgeUnitType = typeof SheetAgeUnitType;
/** String-literal shorthand for {@link SheetAgeUnitType}. */
export type SheetAgeUnitLiteral = "hours" | "days" | "weeks";

/**
 * How an audit cell reads its change.
 *
 * @property date - The date, its verb and who in the tooltip
 * @property blame - The date, then the verb and who beside it
 */
export const SheetAuditModeType = VariantType({ date: NullType, blame: NullType });
/** Type alias for {@link SheetAuditModeType}. */
export type SheetAuditModeType = typeof SheetAuditModeType;
/** String-literal shorthand for {@link SheetAuditModeType}. */
export type SheetAuditModeLiteral = "date" | "blame";

/**
 * The column kind — what a column parses, displays and proposes (§3.2).
 *
 * @remarks
 * Every function stored here takes the CLOSED context / cell types; the
 * author's typed functions are bridged into them by the factory. The
 * accessors that read the driver's row (`uom`, `sides.value`) are not stored
 * at all — the builder reifies them against the driver's row type, the root
 * applies them over the driver data, and they land as dictionaries keyed by
 * the driver member's key.
 *
 * A date's `level` and `actual` and an `options` rule (#844) ride here too:
 * `level` / `actual` name the unrendered cell ({@link sheetRuleCell}) the
 * row projection filled, `options` is the bridged rule over the wire
 * context — the renderer offers only those members, while typed text still
 * resolves against the whole register.
 *
 * @property text - Free text
 * @property date - A UTC-midnight date; `base` names the column relative entry counts from, `format` a display pattern, `level` the cell holding the row's {@link SheetDateLevelType} tag, `actual` the cell holding when the work really happened
 * @property quantity - A float with a unit per driver member (`uom`) or one `unit` for every row, and a display format
 * @property integer - A whole number
 * @property lookup - A scored register lookup — the driver column names the driver's register; `options` narrows what a row is offered
 * @property reference - A lookup over a flat member list
 * @property enum - An upper-cased register word with a valence dot; `options` narrows what a row is offered
 * @property set - Comma members, the link grammar without an arrow
 * @property link - `from > to` — the split cell (§3.4); `options` narrows what a row is offered
 * @property stamped - A read-only code an upstream system owns
 * @property custom - An author parse / print pair over the field's own payload
 * @property action - A variant's state machine: each case a state and the action into it (#1474)
 * @property title - A record's title, its initials before it when `avatar`; a Record's
 * @property person - A person, by a register's key: neutral initials, or no one; a Record's
 * @property boolean - A checkbox; a Record's
 * @property toggle - Two states on a Boolean, each a word; a Record's
 * @property cycle - A register's members, stepped by a click — a `scale` steps up the heat ramp, otherwise each member's tone; a Record's
 * @property age - Whole units from a moment to the browser's clock: `elapsed(since, now)`, warning at `stale`; read only, a Record's
 * @property audit - The last change the app kept: the cell its moment, `by` and `verb` the rule cells holding who and what; read only, a Record's
 */
export const SheetColumnKindType = VariantType({
    text:      NullType,
    date:      StructType({
        base:   OptionType(StringType),
        format: OptionType(StringType),
        level:  OptionType(StringType),
        actual: OptionType(StringType),
    }),
    quantity:  StructType({ uom: OptionType(DictType(StringType, StringType)), unit: OptionType(StringType), format: OptionType(TickFormatType) }),
    integer:   NullType,
    lookup:    StructType({ register: StringType, options: OptionType(SheetOptionsRuleType) }),
    reference: StructType({ register: StringType }),
    enum:      StructType({ register: StringType, options: OptionType(SheetOptionsRuleType) }),
    set:       StructType({
        register: StringType,
        members:  ArrayType(SheetMemberKindType),
        multiple: OptionType(SheetMultipleType),
        store:    SheetStoreType,
    }),
    link:      StructType({
        register: StringType,
        members:  ArrayType(SheetMemberKindType),
        multiple: OptionType(SheetMultipleType),
        sides:    OptionType(SheetSidesType),
        arity:    OptionType(SheetArityType),
        check:    ArrayType(SheetCheckType),
        store:    SheetStoreType,
        options:  OptionType(SheetOptionsRuleType),
    }),
    stamped:   StructType({ owner: OptionType(StringType) }),
    custom:    StructType({
        accepts: StringType,
        parse:   FunctionType([StringType, SheetContextType], OptionType(SheetCellType)),
        print:   FunctionType([SheetCellType], StringType),
    }),
    action:    SheetActionKindType,
    title:     StructType({ avatar: BooleanType }),
    person:    StructType({ register: StringType, unassigned: OptionType(StringType) }),
    boolean:   NullType,
    toggle:    StructType({ on: StringType, off: StringType, look: SheetLookType }),
    cycle:     StructType({ register: StringType, scale: BooleanType, look: SheetLookType }),
    age:       StructType({
        unit:    SheetAgeUnitType,
        stale:   OptionType(IntegerType),
        absent:  OptionType(StringType),
        elapsed: FunctionType([DateTimeType, DateTimeType], IntegerType),
    }),
    audit:     StructType({ mode: SheetAuditModeType, absent: OptionType(StringType), by: StringType, verb: StringType }),
});
/** Type alias for {@link SheetColumnKindType}. */
export type SheetColumnKindType = typeof SheetColumnKindType;
/** String-literal shorthand for the arms of {@link SheetColumnKindType}. */
export type SheetColumnKindLiteral =
    | "text" | "date" | "quantity" | "integer" | "lookup" | "reference" | "enum"
    | "set" | "link" | "stamped" | "custom" | "action"
    | "title" | "person" | "boolean" | "toggle" | "cycle" | "age" | "audit";

/**
 * One declared column.
 *
 * @remarks
 * `dataType` is the row field's static type and `payloadType` the kind's
 * payload (a custom kind's primitive), both as type values, so the renderer
 * parses and prints without the host types (the Table `dataType` / `valueType`
 * precedent). `editable` is `false` for a stamped column, a `value`-projected
 * column, or by option.
 *
 * @property key - The column key — the row field it sits on
 * @property header - The header line
 * @property sub - The grey second header line
 * @property width - CSS width
 * @property kind - The column kind
 * @property dataType - The row field's static type
 * @property payloadType - The kind's payload type
 * @property editable - Whether the sheet writes the column
 * @property fill - The fill providers; the first that yields wins
 * @property detailCell - The unrendered cell whose text is the column's detail — the hover and the strip (#844)
 */
export const SheetColumnType = StructType({
    key:         StringType,
    header:      StringType,
    sub:         OptionType(StringType),
    width:       OptionType(StringType),
    kind:        SheetColumnKindType,
    dataType:    EastTypeType,
    payloadType: EastTypeType,
    editable:    BooleanType,
    fill:        ArrayType(SheetProviderType),
    detailCell:  OptionType(StringType),
});
/** Type alias for {@link SheetColumnType}. */
export type SheetColumnType = typeof SheetColumnType;

// ============================================================================
// Grouped rows (#740) — the band's cells and the group declaration
// ============================================================================

/**
 * One cell of a group row's band (#740) — a group field drawn under a line
 * column (or the title), exactly a column declared over the group's row.
 *
 * @property key - The cell key: a line column's key, or {@link SHEET_TITLE_CELL}
 * @property field - The group row's field the cell reads and writes
 * @property kind - The cell's kind (the §3.2 table; no `lookup`, `set`, `link` or `custom` in a band)
 * @property dataType - The group field's static type
 * @property payloadType - The kind's payload type
 * @property editable - Whether the band writes the field
 */
export const SheetGroupCellType = StructType({
    key:         StringType,
    field:       StringType,
    kind:        SheetColumnKindType,
    dataType:    EastTypeType,
    payloadType: EastTypeType,
    editable:    BooleanType,
});
/** Type alias for {@link SheetGroupCellType}. */
export type SheetGroupCellType = typeof SheetGroupCellType;

/**
 * The host's word for a group (#844) — what fold-all, the footer count, hints
 * and the new-group button call a group. When the declaration names none the
 * wire carries none, and the renderer says its own word — its message
 * table's, so a translation reaches it (#861).
 *
 * @property singular - One group (`"order"`)
 * @property plural - Several (`"orders"`)
 */
export const SheetNounType = StructType({
    singular: StringType,
    plural:   StringType,
});
/** Type alias for {@link SheetNounType}. */
export type SheetNounType = typeof SheetNounType;

/**
 * The group declaration (#740) — how a grouped sheet's rows carry their
 * lines, and what the band draws.
 *
 * @property lines - The group row's field that holds the lines — an `Array<L>`, so a line's key is its position
 * @property cells - The band's cells, the title first under {@link SHEET_TITLE_CELL}
 * @property noun - The host's word for a group (#844); `none` ⇒ the renderer's own (#861)
 * @property loose - `true` ⇒ the source's entries are `Sheet.Types.Entry(P, "lines")`: a group, or a LOOSE row of the line type between the groups (#846) — a wire row with no band
 */
export const SheetGroupType = StructType({
    lines: StringType,
    cells: ArrayType(SheetGroupCellType),
    noun:  OptionType(SheetNounType),
    loose: BooleanType,
});
/** Type alias for {@link SheetGroupType}. */
export type SheetGroupType = typeof SheetGroupType;

// ============================================================================
// Views, edits, selection, footer, style
// ============================================================================

/**
 * One saved view (B§8, #1345) — `Sheet.Types.RecordView`: the narrowing of
 * every source of the sheet's `Slice.bindRecords` when the view was made, by
 * the source's name, evaluated live as a tab.
 *
 * @remarks
 * A source the view does not hold opens with nothing chosen, as a preset
 * clears a source it does not name. The `rows` source's narrowing is drawn
 * over the record's rows as the lens (B§8, #1349): a filtered spreadsheet,
 * showing only the rows the narrowing keeps, each at its row number.
 *
 * @property id - Stable identity
 * @property name - The tab name
 * @property narrowing - Each source's narrowing, by the source's name (`rows`, `rowTemplates`)
 * @property folds - A grouped sheet's fold overrides (#740): group id → folded; a group not listed opens as its `folded` accessor says
 */
export const SheetRecordViewType = StructType({
    id:        StringType,
    name:      StringType,
    narrowing: DictType(StringType, RecordSliceStateType),
    folds:     DictType(StringType, BooleanType),
});
/** Type alias for {@link SheetRecordViewType}. */
export type SheetRecordViewType = typeof SheetRecordViewType;


/**
 * Where an edit came from — provenance a host can measure copilot uptake by (B§1).
 *
 * @property typed - The planner typed it
 * @property pasted - A paste
 * @property fill - A copilot fill was taken
 * @property row - A row fill (⌘⏎)
 * @property pattern - A proposed row was taken
 */
export const SheetSourceType = VariantType({
    typed:   NullType,
    pasted:  NullType,
    fill:    NullType,
    row:     NullType,
    pattern: NullType,
});
/** Type alias for {@link SheetSourceType}. */
export type SheetSourceType = typeof SheetSourceType;
/** String-literal shorthand for {@link SheetSourceType}. */
export type SheetSourceLiteral = "typed" | "pasted" | "fill" | "row" | "pattern";

/**
 * The WIRE edit event — a raw commit / insert / remove carrying the wire row
 * inside a renderer gesture. These records never call an author callback;
 * the editing session emits one complete PatchEvent after the gesture.
 * @internal
 *
 * On a grouped sheet (#740) the three row arms are the GROUP's — a band
 * cell committed, a group created, groups removed — and the line arms carry
 * a line's address within its group; `row` is always the whole group row.
 *
 * @property commit - One cell committed: the row AFTER the commit, and its source offset
 * @property insert - A row appended after `afterRowId` (`none` ⇒ at the end)
 * @property remove - Rows removed by id
 * @property lineCommit - A line's cell committed: the GROUP row after the commit, the line's key, the column
 * @property lineInsert - A line inserted into a group after `after` (`none` ⇒ first), at `line`
 * @property lineRemove - Lines removed from a group, by key
 */
export const SheetEditType = VariantType({
    commit:     StructType({ rowId: StringType, offset: IntegerType, key: StringType, row: SheetRowType, source: SheetSourceType }),
    insert:     StructType({ afterRowId: OptionType(StringType), row: SheetRowType, source: SheetSourceType }),
    remove:     StructType({ rowIds: ArrayType(StringType) }),
    lineCommit: StructType({ rowId: StringType, offset: IntegerType, line: StringType, key: StringType, row: SheetRowType, source: SheetSourceType }),
    lineInsert: StructType({ rowId: StringType, offset: IntegerType, after: OptionType(StringType), line: StringType, row: SheetRowType, source: SheetSourceType }),
    lineRemove: StructType({ rowId: StringType, offset: IntegerType, lines: ArrayType(StringType), row: SheetRowType }),
});
/** Type alias for {@link SheetEditType}. */
export type SheetEditType = typeof SheetEditType;

/**
 * The selection ring's position — `Sheet.Types.Selection`.
 *
 * @property rowId - The selected row (`none` ⇒ a blank padding row or nothing); a grouped sheet: the GROUP's id
 * @property line - A grouped sheet: the selected line's key within its group (`none` on the band, a blank line, or a flat sheet)
 * @property key - The selected column (a band: the line column the cell sits under, or `$title`)
 */
export const SheetSelectionType = StructType({
    rowId: OptionType(StringType),
    line:  OptionType(StringType),
    key:   OptionType(StringType),
});
/** Type alias for {@link SheetSelectionType}. */
export type SheetSelectionType = typeof SheetSelectionType;

/**
 * One footer item (B§9).
 *
 * @property text - The footer text
 * @property tone - Optional status tint
 */
export const SheetFooterItemType = StructType({
    text: StringType,
    tone: OptionType(StatusValueType),
});
/** Type alias for {@link SheetFooterItemType}. */
export type SheetFooterItemType = typeof SheetFooterItemType;

/**
 * The Sheet style — the gutter width. The sheet fills the box it is given,
 * its frame's, and scrolls its own rows there (#1216).
 *
 * @property gutterWidth - The row-number gutter width, a CSS px size
 */
export const SheetStyleType = StructType({
    gutterWidth: OptionType(StringType),
});
/** Type alias for {@link SheetStyleType}. */
export type SheetStyleType = typeof SheetStyleType;

/**
 * The Sheet on a phone (`Mobile Sheet Spec.md` §9): a frame 560 px wide or
 * narrower pages a window of its columns, and pins the column `pin` names at
 * the left beside it — none unless it names one (ruled 3 Nov 2026). Above
 * 560 px it does nothing.
 *
 * @property pin - The column the phone pins at the left; `none` pins none
 * @property columns - How many columns the window shows at once beside any pinned one, 1 to 3; `none` shows 2
 */
export const SheetNarrowType = StructType({
    pin:     OptionType(StringType),
    columns: OptionType(IntegerType),
});
/** Type alias for {@link SheetNarrowType}. */
export type SheetNarrowType = typeof SheetNarrowType;

// ============================================================================
// Root
// ============================================================================

/**
 * The Sheet root IR — the whole planning spreadsheet, a CLOSED struct: the
 * grid, its rows and its session, which `<Sheet>`'s payload carries as its
 * `sheet`.
 *
 * @remarks
 * `editing` carries the exact schemas and checked batch callbacks. The
 * live onUpdate adapter writes once per application. `selection` present
 * makes the selection controlled (§3.14).
 *
 * @property rows - The row source: inline wire rows, or a paged source of them — with a `rows` source, its record's own rows, every one in the record's order, which the renderer draws the source's narrowing over as the lens (#1349): only the rows it keeps, each at its row number
 * @property columns - The declared columns, in order
 * @property registers - Register name → register
 * @property driver - The driver column and its members
 * @property suggest - The row-proposal declaration
 * @property slice - The narrowing's chrome (#1345): one rail over the sheet's `Slice.bindRecords`, its `rows` source the rows' own narrowing
 * @property views - The saved views, each every source's narrowing
 * @property activeView - The active view's id
 * @property onViewsChange - Views changed (snapshot, rename, reorder, close)
 * @property onSelect - The ring moved
 * @property selection - Controlled selection when `some`
 * @property newRowId - Overrides the renderer's id minting for inserted rows
 * @property group - The group declaration (#740); `none` on a flat sheet
 * @property readOnly - The whole sheet is read-only
 * @property blanks - Padding rows below the last real one (default 18)
 * @property density - Row rhythm
 * @property footer - Footer items
 * @property style - The gutter width
 * @property narrow - On a phone: any column it pins, and how many it shows at once ({@link SheetNarrowType})
 */
export const SheetRootType = StructType({
    rows:          SheetRowsType,
    editing:       SheetEditingType,
    columns:       ArrayType(SheetColumnType),
    registers:     DictType(StringType, SheetRegisterType),
    driver:        OptionType(SheetDriverType),
    suggest:       OptionType(SheetSuggestType),
    slice:         OptionType(RecordSlicesChromeType),
    views:         ArrayType(SheetRecordViewType),
    activeView:    OptionType(StringType),
    onViewsChange: OptionType(FunctionType([ArrayType(SheetRecordViewType)], NullType)),
    onSelect:      OptionType(FunctionType([SheetSelectionType], NullType)),
    selection:     OptionType(SheetSelectionType),
    newRowId:      OptionType(FunctionType([], StringType)),
    group:         OptionType(SheetGroupType),
    readOnly:      OptionType(BooleanType),
    blanks:        OptionType(IntegerType),
    density:       OptionType(DensityType),
    footer:        ArrayType(SheetFooterItemType),
    style:         OptionType(SheetStyleType),
    narrow:        OptionType(SheetNarrowType),
    /** Source order is authoritative, including when drafts are overlaid. */
    ordered: BooleanType,
});
/** Type alias for {@link SheetRootType}. */
export type SheetRootType = typeof SheetRootType;

// ============================================================================
// The TYPED constructors — the author's side (the `Plan.Types.Series(R)` pattern)
// ============================================================================

/**
 * `Sheet.Types.Context(R, D)` — the copilot context as the author sees it:
 * the host's row, the resident rows and the driver's row, all typed.
 *
 * @remarks
 * A constructor rather than a generic wire type, so the row type lives
 * structurally in a provider's signature: a provider written for one sheet
 * is a compile error on another. Omit `D` on a sheet without a driver —
 * `driver` is then `Option<Null>`, always `none`.
 *
 * @typeParam R - The host's row type
 * @typeParam D - The driver's row type
 * @param rowType - The row type value
 * @param driverType - The driver's row type value (default `NullType`)
 * @returns The concrete context `StructType`
 *
 * @property rowIndex - Sheet position among REAL (resident) rows
 * @property row - The row as it would be if the open editor committed — the host's struct
 * @property rows - The resident sheet, real rows in sheet order
 * @property partial - `true` on a paged sheet whose source is not exhausted
 * @property driver - The driver's row for `row` — typed, no attribute bag
 * @property today - UTC midnight — so providers stay pure
 */
export function SheetContextTypeFor<R extends StructType, D extends EastType = NullType>(rowType: R, driverType?: D) {
    return StructType({
        rowIndex: IntegerType,
        row:      SheetDraftTypeFor(rowType),
        rows:     ArrayType(SheetDraftTypeFor(rowType)),
        group:    OptionType(NullType),
        partial:  BooleanType,
        driver:   OptionType((driverType ?? NullType) as D),
        today:    DateTimeType,
    });
}

/**
 * `Sheet.Types.Fill(T)` — one proposed value of a column's payload with its
 * provenance, as a provider returns it.
 *
 * @typeParam T - The column kind's payload type (§3.2)
 * @param payloadType - The payload type value
 * @returns The concrete fill `StructType`
 *
 * @property value - The proposed value
 * @property meta - The provenance line the strip prints
 */
export function SheetFillTypeFor<T extends EastType>(payloadType: T) {
    return StructType({ value: payloadType, meta: StringType });
}

/**
 * The fields of a struct type as a record of East types — the shape every
 * per-field constructor below maps over.
 *
 * @typeParam R - The struct type
 */
export type SheetFieldsOf<R extends StructType> = R["fields"];

/**
 * `Sheet.Types.Patch(R)` — a row patch: every field of `R` as an `Option`,
 * `none` meaning "left blank".
 *
 * @remarks
 * Built with `Sheet.patch(R, { … })`, which takes the literal-record form of
 * `R`'s fields and fills the omitted ones with `none`. The runner encodes the
 * set fields that have editable columns; a set field with no column, a
 * stamped column or a `value`-projected column is ignored.
 *
 * @typeParam R - The host's row type
 * @param rowType - The row type value
 * @returns The concrete patch `StructType`
 */
export function SheetPatchTypeFor<R extends StructType>(rowType: R): StructType<{ [K in keyof SheetFieldsOf<R>]: OptionType<SheetFieldsOf<R>[K]> }> {
    const fields: Record<string, EastType> = {};
    for (const [name, type] of Object.entries(rowType.fields as Record<string, EastType>)) {
        fields[name] = OptionType(type);
    }
    return StructType(fields) as unknown as StructType<{ [K in keyof SheetFieldsOf<R>]: OptionType<SheetFieldsOf<R>[K]> }>;
}

/**
 * `Sheet.Types.Proposal(R)` — one proposed row: a patch plus its provenance.
 *
 * @typeParam R - The host's row type
 * @param rowType - The row type value
 * @returns The concrete proposal `StructType`
 *
 * @property patch - The fields the proposal sets (`Sheet.patch(R, …)`)
 * @property meta - The provenance line
 */
export function SheetProposalTypeFor<R extends StructType>(rowType: R) {
    return StructType({ patch: SheetPatchTypeFor(rowType), meta: StringType });
}

/**
 * `Sheet.Types.CheckContext(R)` — what an author's member check sees (§3.4):
 * the typed row, the half and the resolved member.
 *
 * @typeParam R - The host's row type
 * @param rowType - The row type value
 * @returns The concrete check-context `StructType`
 *
 * @property rowIndex - Sheet position among real rows
 * @property row - The row as it would be if the editor committed
 * @property half - The half being edited
 * @property member - The resolved member under check
 */
export function SheetCheckContextTypeFor<R extends StructType>(rowType: R) {
    return StructType({
        rowIndex: IntegerType,
        row:      SheetDraftTypeFor(rowType),
        group:    OptionType(NullType),
        half:     SheetHalfType,
        member:   SheetMemberType,
    });
}

// ============================================================================
// Grouped rows (#740) — the lines field and the grouped typed constructors
// ============================================================================

/**
 * The keys of a group row whose field can hold the lines — an `Array<L>` of
 * structs.
 *
 * @typeParam P - The group's row type
 */
export type SheetLinesField<P extends StructType> = {
    [K in Extract<keyof P["fields"], string>]:
        P["fields"][K] extends ArrayTypeOf<StructType> ? K : never
}[Extract<keyof P["fields"], string>];

/**
 * The LINE type a group row's lines field holds.
 *
 * @typeParam P - The group's row type
 * @typeParam F - The lines field
 */
export type SheetLineOf<P extends StructType, F extends SheetLinesField<P>> =
    P["fields"][F] extends ArrayTypeOf<infer L extends StructType> ? L
    : never;

/**
 * One entry of a source that holds LOOSE rows between its groups (#846) —
 * `Sheet.Types.Entry(P, "lines")`: a group, or a row of the line type.
 *
 * @typeParam P - The group's row type
 * @typeParam F - The lines field
 */
export type SheetEntryOf<P extends StructType, F extends SheetLinesField<P>> = VariantType<{ group: P; row: SheetLineOf<P, F> }>;

/**
 * The line type a group row's lines field holds, checked at build time.
 *
 * @param groupType - The group's row type value
 * @param field - The lines field
 * @returns The line type
 * @throws Error naming the field when it is not an `Array<Struct>`
 */
export function sheetLinesOf(groupType: StructType, field: string): { lineType: StructType } {
    const fields = groupType.fields as Record<string, EastType>;
    const t = fields[field] as { type?: string; key?: EastType; value?: EastType } | undefined;
    if (t === undefined) {
        throw new Error(`Sheet: \`group\` names "${field}", which is not a field of the row type (${Object.keys(fields).join(", ")})`);
    }
    if (t.type === "Array" && (t.value as { type?: string } | undefined)?.type === "Struct") {
        return { lineType: t.value as StructType };
    }
    throw new Error(`Sheet: the lines field "${field}" must be an Array of row structs — got ${t.type ?? "an unknown type"}`);
}

/**
 * `Sheet.Types.Context(P, "lines", D)` — the copilot context of a GROUPED
 * sheet: the line as it would be, its group's lines, the group, the resident
 * groups and the driver's row, all typed.
 *
 * @typeParam P - The group's row type
 * @typeParam F - The lines field
 * @typeParam D - The driver's row type
 * @param groupType - The group's row type value
 * @param lines - The lines field
 * @param driverType - The driver's row type value (default `NullType`)
 * @returns The concrete context `StructType`
 *
 * On a sheet with loose rows between its groups (#846), a LOOSE row's
 * context has no group: `rows` are the resident loose rows, `rowIndex` its
 * index among them.
 *
 * @property rowIndex - The line's index WITHIN its group (a loose row: its index in `rows`)
 * @property row - The line as it would be if the open editor committed
 * @property rows - The group's lines, in order (a loose row: the resident loose rows)
 * @property group - The group row (`none` for a loose row)
 * @property groups - The resident groups, in sheet order
 * @property partial - `true` on a paged sheet whose source is not exhausted
 * @property driver - The driver's row for `row`
 * @property today - UTC midnight
 */
export function SheetGroupContextTypeFor<P extends StructType, F extends SheetLinesField<P>, D extends EastType = NullType>(
    groupType: P, lines: F, driverType?: D,
): SheetGroupContextOf<P, SheetLineOf<P, F>, D, F> {
    const { lineType } = sheetLinesOf(groupType, lines);
    return StructType({
        rowIndex: IntegerType,
        row:      SheetDraftTypeFor(lineType),
        rows:     ArrayType(SheetDraftTypeFor(lineType)),
        group:    OptionType(SheetDraftGroupTypeFor(groupType, lines)),
        groups:   ArrayType(SheetDraftGroupTypeFor(groupType, lines)),
        partial:  BooleanType,
        driver:   OptionType((driverType ?? NullType) as D),
        today:    DateTimeType,
    }) as unknown as SheetGroupContextOf<P, SheetLineOf<P, F>, D, F>;
}

/**
 * `Sheet.Types.CheckContext(P, "lines")` — what an author's member check
 * sees on a GROUPED sheet: the typed line, its group, the half and the member.
 *
 * @typeParam P - The group's row type
 * @typeParam F - The lines field
 * @param groupType - The group's row type value
 * @param lines - The lines field
 * @returns The concrete check-context `StructType`
 */
export function SheetGroupCheckContextTypeFor<P extends StructType, F extends SheetLinesField<P>>(groupType: P, lines: F): SheetGroupCheckContextOf<P, F> {
    const { lineType } = sheetLinesOf(groupType, lines);
    return StructType({
        rowIndex: IntegerType,
        row:      SheetDraftTypeFor(lineType),
        group:    OptionType(SheetDraftGroupTypeFor(groupType, lines)),
        half:     SheetHalfType,
        member:   SheetMemberType,
    }) as unknown as SheetGroupCheckContextOf<P, F>;
}

// ============================================================================
// TypeScript faces of the typed constructors
// ============================================================================

/** The TS type of `Sheet.Types.Context(R, D)`. */
export type SheetContextOf<R extends StructType, D extends EastType = NullType> = ReturnType<typeof SheetContextTypeFor<R, D>>;
/** The TS type of `Sheet.Types.Fill(T)`. */
export type SheetFillOf<T extends EastType> = ReturnType<typeof SheetFillTypeFor<T>>;
/** The TS type of `Sheet.Types.Patch(R)`. */
export type SheetPatchOf<R extends StructType> = ReturnType<typeof SheetPatchTypeFor<R>>;
/** The TS type of `Sheet.Types.Proposal(R)`. */
export type SheetProposalOf<R extends StructType> = ReturnType<typeof SheetProposalTypeFor<R>>;
/** The TS type of `Sheet.Types.CheckContext(R)`. */
export type SheetCheckContextOf<R extends StructType> = ReturnType<typeof SheetCheckContextTypeFor<R>>;
/** The TS type of `Sheet.Types.Context(P, "lines", D)` — parameterised by the LINE type the context carries. */
export type SheetGroupContextOf<P extends StructType, L extends StructType, D extends EastType = NullType, F extends SheetLinesField<P> = SheetLinesField<P>> = StructType<{
    rowIndex: IntegerType;
    row:      SheetDraftOf<L>;
    rows:     ArrayTypeOf<SheetDraftOf<L>>;
    group:    OptionType<SheetDraftGroupOf<P, F>>;
    groups:   ArrayTypeOf<SheetDraftGroupOf<P, F>>;
    partial:  BooleanType;
    driver:   OptionType<D>;
    today:    DateTimeType;
}>;
/** The TS type of `Sheet.Types.CheckContext(P, "lines")` — the LINE's draft as the row, so a check reads the line's fields. */
export type SheetGroupCheckContextOf<P extends StructType, F extends SheetLinesField<P>> = StructType<{
    rowIndex: IntegerType;
    row:      SheetDraftOf<SheetLineOf<P, F>>;
    group:    OptionType<SheetDraftGroupOf<P, F>>;
    half:     SheetHalfType;
    member:   SheetMemberType;
}>;
/** Either context an author function may take — a flat sheet's over `R`, or a grouped sheet's over the line `R`. */
export type SheetAnyContextOf<R extends StructType, D extends EastType = any> = SheetContextOf<R, D> | StructType<{
    rowIndex: IntegerType;
    row: SheetDraftOf<R>;
    rows: ArrayTypeOf<SheetDraftOf<R>>;
    group: OptionType<StructType>;
    groups: ArrayTypeOf<StructType>;
    partial: BooleanType;
    driver: OptionType<D>;
    today: DateTimeType;
}>;
/** Either check context an author check may take — a flat sheet's over `R`, or a grouped sheet's over the line `R`. */
export type SheetAnyCheckContextOf<R extends StructType> = SheetCheckContextOf<R> | StructType<{ rowIndex: IntegerType; row: SheetDraftOf<R>; group: OptionType<StructType>; half: SheetHalfType; member: SheetMemberType }>;

/**
 * `Sheet.Types.Context` — the copilot context: `Context(R, D?)` on a flat
 * sheet, `Context(P, "lines", D?)` on a grouped one.
 */
export function sheetContextType<R extends StructType, D extends EastType = NullType>(rowType: R, driverType?: D): SheetContextOf<R, D>;
export function sheetContextType<P extends StructType, F extends SheetLinesField<P>, D extends EastType = NullType>(groupType: P, lines: F, driverType?: D): SheetGroupContextOf<P, SheetLineOf<P, F>, D, F>;
export function sheetContextType(first: StructType, second?: unknown, third?: unknown): unknown {
    if (typeof second === "string") return SheetGroupContextTypeFor(first, second as never, third as EastType | undefined);
    return SheetContextTypeFor(first, second as EastType | undefined);
}

/** `Sheet.Types.CheckContext` — a member check's context: `CheckContext(R)` on a flat sheet, `CheckContext(P, "lines")` on a grouped one. */
export function sheetCheckContextType<R extends StructType>(rowType: R): SheetCheckContextOf<R>;
export function sheetCheckContextType<P extends StructType, F extends SheetLinesField<P>>(groupType: P, lines: F): SheetGroupCheckContextOf<P, F>;
export function sheetCheckContextType(first: StructType, second?: unknown): unknown {
    if (typeof second === "string") return SheetGroupCheckContextTypeFor(first, second as never);
    return SheetCheckContextTypeFor(first);
}

/**
 * The literal-record input of `Sheet.patch(R, …)` — every field of `R`
 * optional, each a literal or an expression of the FIELD's type (the Plan
 * `PlanRecordInput` shape); an omitted field is `none`.
 *
 * @typeParam R - The host's row type
 */
export type SheetPatchInput<R extends StructType> = { [K in keyof SheetFieldsOf<R>]?: SubtypeExprOrValue<SheetFieldsOf<R>[K]> };
