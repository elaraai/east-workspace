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
 * the `Sheet` arm of `UIComponentType` references {@link SheetRootType}
 * directly, like `Calendar` and `Blend`.
 *
 * This file holds only plain data and closed function types — no
 * `UIComponentType` — so `component.ts` imports it without a cycle. The
 * author-facing TYPED constructors (`Sheet.Types.Context(R, D)`, `Fill(T)`,
 * `Patch(R)`, `Proposal(R)`, `Edit(R)`, `CheckContext(R)`) live here too:
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

import { StatusValueType } from "../../feedback/status/types.js";
import { TickFormatType } from "../../format/types.js";
import { DensityType } from "../../style/interaction.js";
import { RowSourceType } from "../../contracts/source.js";
import { SliceChromeType, SliceStateType } from "../../platform/slice/index.js";

// ============================================================================
// Links — members, the typed link value, the cell
// ============================================================================

/**
 * One member of a link half — what the link grammar resolves a token to
 * (B§4.1).
 *
 * @remarks
 * A member is never a bare string the host has to re-parse: a code that
 * resolved against the register is `identified`, a `M2140-45` span is a
 * `range` the register expands, a `4 × CNC lathe` count is `counted`, `TBC` is
 * the dashed `placeholder`, and anything the grammar did not recognise is
 * kept verbatim as `text` — typed entry is never blocked.
 *
 * @property identified - A register code (`"M2140"`)
 * @property range - A span of codes, `from` to `to` (`"M2140-45"`, the upper bound completed)
 * @property counted - A count of a countable member (`{ n: 4, key: "CNC lathe" }`)
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
 * One cell of the wire row — the Table's literal cell (#206) plus the
 * typed link.
 *
 * @remarks
 * `Null` is the blank cell. A scalar column's cell is the field's value at
 * the column kind's primitive; a `set` / `link` column's cell is a
 * {@link SheetLinkType} value, never a string.
 *
 * @property Null - The blank cell
 * @property Boolean - A boolean value
 * @property Integer - An integer value
 * @property Float - A float value (a `quantity` column's cell)
 * @property String - A string value (text · lookup · reference · enum · stamped)
 * @property DateTime - A UTC-midnight date (a `date` column's cell)
 * @property Link - A typed link (a `set` / `link` column's cell)
 */
export const SheetCellType = VariantType({
    Null:     NullType,
    Boolean:  BooleanType,
    Integer:  IntegerType,
    Float:    FloatType,
    String:   StringType,
    DateTime: DateTimeType,
    Link:     SheetLinkType,
});
/** Type alias for {@link SheetCellType}. */
export type SheetCellType = typeof SheetCellType;

/**
 * One LINE of a group row on the wire (#740) — its cells, addressed within
 * its group by `key`.
 *
 * @remarks
 * A line has no id of its own: on `Array` lines `key` is the line's index
 * printed, on `Dict` lines the dictionary key. The line's cells are the line
 * columns' projection, exactly a flat row's `cells`.
 *
 * @property key - The line's address within its group
 * @property cells - Column key → cell, one entry per declared line column
 */
export const SheetLineType = StructType({
    key:   StringType,
    cells: DictType(StringType, SheetCellType),
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
 * One wire row — the closed projection of a host row.
 *
 * @remarks
 * `cells` carries one entry per DECLARED column, always present (a blank
 * cell is `Null`); a field of the host's row with no column never crosses
 * the wire — the bridge (§4.8) reads it off the real row instead. Blank
 * padding rows are renderer state, never rows.
 *
 * On a GROUPED sheet (#740) every row is a group: `cells` holds the band's
 * cells (the group's fields under line columns, the title under
 * {@link SHEET_TITLE_CELL}), `lines` its lines and `band` is `some`. On a
 * flat sheet `lines` is empty and `band` is `none`.
 *
 * @property id - The row identity (the `id` field, or a keyed source's key)
 * @property owned - `true` ⇒ the row belongs to the upstream system: no copilot, stamped columns read-only
 * @property cells - Column key → cell, one entry per declared column
 * @property lines - A group row's lines, in order (empty on a flat sheet)
 * @property band - A group row's band (`none` on a flat sheet)
 */
export const SheetRowType = StructType({
    id:    StringType,
    owned: BooleanType,
    cells: DictType(StringType, SheetCellType),
    lines: ArrayType(SheetLineType),
    band:  OptionType(SheetBandType),
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
 * @property key - What the grammar resolves (`"M2140"`, `"Line 2"`, `"CNC lathe"`)
 * @property label - What a chip prints
 * @property kind - The member kind (`"machine"` · `"line"` · `"family"` · `"activity"` · …)
 * @property aliases - Alternative spellings the grammar also resolves (`"the 2 line"`)
 * @property meta - Chip meta, shown when a half holds one chip (`"CNC lathe"`, `"line · 96"`)
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
 * @property kind - The register member kind (`"machine"`, `"line"`, `"family"`, `"range"`)
 * @property identified - The kind resolves by code (bare digits try the code prefix)
 * @property countable - The kind takes the counted form (`N x kind`)
 * @property resolvesTo - What a counted member of this kind resolves to later (`"machine"`)
 */
export const SheetMemberKindType = StructType({
    kind:       StringType,
    identified: BooleanType,
    countable:  BooleanType,
    resolvesTo: OptionType(StringType),
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
 * A count of a countable member — the `n × CNC lathe` form (B§4.5) —
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
 * @property rowIndex - Sheet position among REAL (resident) rows (a grouped sheet: the line's index within its group)
 * @property rowId - The row's id — the source lookup's argument (a grouped sheet: the GROUP's id)
 * @property offset - The row's source offset — the paged arm's `page` lookup
 * @property line - A grouped sheet: the line's address within its group; `none` on a flat sheet
 * @property row - The row as it would be if the open editor committed (a grouped sheet: the LINE's cells)
 * @property rows - The resident sheet, real rows in sheet order (a grouped sheet: the resident GROUP rows)
 * @property rowsOffset - The source offset of `rows[0]` (`0` on the inline arm)
 * @property partial - `true` on a paged sheet whose source is not exhausted
 * @property driver - The resolved driver member's key
 * @property today - UTC midnight — so providers stay pure
 */
export const SheetContextType = StructType({
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
 * @property rowIndex - Sheet position among real rows (a grouped sheet: the line's index within its group)
 * @property rowId - The row's id (the source lookup's argument; a grouped sheet: the GROUP's id)
 * @property offset - The row's source offset
 * @property line - A grouped sheet: the line's address within its group; `none` on a flat sheet
 * @property row - The row as it would be if the editor committed (a grouped sheet: the LINE's cells)
 * @property half - The half being edited
 * @property member - The resolved member under check
 */
export const SheetCheckContextType = StructType({
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
 * @property text - Free text
 * @property date - A UTC-midnight date; `base` names the column relative entry counts from, `format` a display pattern
 * @property quantity - A float with a unit per driver member (`uom`) and a display format
 * @property integer - A whole number
 * @property lookup - A scored register lookup — the driver column names the driver's register
 * @property reference - A lookup over a flat member list
 * @property enum - An upper-cased register word with a valence dot
 * @property set - Comma members, the link grammar without an arrow
 * @property link - `from > to` — the split cell (§3.4)
 * @property stamped - A read-only code an upstream system owns
 * @property custom - An author parse / print pair over the field's own payload
 */
export const SheetColumnKindType = VariantType({
    text:      NullType,
    date:      StructType({ base: OptionType(StringType), format: OptionType(StringType) }),
    quantity:  StructType({ uom: OptionType(DictType(StringType, StringType)), format: OptionType(TickFormatType) }),
    integer:   NullType,
    lookup:    StructType({ register: StringType }),
    reference: StructType({ register: StringType }),
    enum:      StructType({ register: StringType }),
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
    }),
    stamped:   StructType({ owner: OptionType(StringType) }),
    custom:    StructType({
        accepts: StringType,
        parse:   FunctionType([StringType, SheetContextType], OptionType(SheetCellType)),
        print:   FunctionType([SheetCellType], StringType),
    }),
});
/** Type alias for {@link SheetColumnKindType}. */
export type SheetColumnKindType = typeof SheetColumnKindType;
/** String-literal shorthand for the arms of {@link SheetColumnKindType}. */
export type SheetColumnKindLiteral =
    | "text" | "date" | "quantity" | "integer" | "lookup" | "reference" | "enum"
    | "set" | "link" | "stamped" | "custom";

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
 * The group declaration (#740) — how a grouped sheet's rows carry their
 * lines, and what the band draws.
 *
 * @property lines - The group row's field that holds the lines
 * @property keyed - `true` ⇒ `Dict<String, L>` lines (keys are stable), `false` ⇒ `Array<L>` lines (a line's key is its position)
 * @property cells - The band's cells, the title first under {@link SHEET_TITLE_CELL}
 */
export const SheetGroupType = StructType({
    lines: StringType,
    keyed: BooleanType,
    cells: ArrayType(SheetGroupCellType),
});
/** Type alias for {@link SheetGroupType}. */
export type SheetGroupType = typeof SheetGroupType;

// ============================================================================
// Views, edits, selection, footer, style
// ============================================================================

/**
 * One saved view — a slice-state snapshot plus the lens's context and reveals
 * (B§8), evaluated live.
 *
 * @property id - Stable identity
 * @property name - The tab name
 * @property narrowing - The slice state the view was made with
 * @property context - The lens's band width (`0` · `1` · `3`)
 * @property reveals - Revealed row indices
 * @property folds - A grouped sheet's fold overrides (#740): group id → folded; a group not listed opens as its `folded` accessor says
 */
export const SheetViewType = StructType({
    id:        StringType,
    name:      StringType,
    narrowing: SliceStateType,
    context:   IntegerType,
    reveals:   ArrayType(IntegerType),
    folds:     DictType(StringType, BooleanType),
});
/** Type alias for {@link SheetViewType}. */
export type SheetViewType = typeof SheetViewType;

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
 * (§3.7). The author sees the typed twin, `Sheet.Types.Edit(R)`, through the
 * bridge.
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
 * The Sheet style — uniform sizing (#320) and the gutter width.
 *
 * @property height - Definite height (`"fill"` fills the parent); the rows scroll within
 * @property maxHeight - Max-height cap; content-sized up to it, then scrolls
 * @property gutterWidth - The row-number gutter width, a CSS px size
 */
export const SheetStyleType = StructType({
    height:      OptionType(StringType),
    maxHeight:   OptionType(StringType),
    gutterWidth: OptionType(StringType),
});
/** Type alias for {@link SheetStyleType}. */
export type SheetStyleType = typeof SheetStyleType;

// ============================================================================
// Root
// ============================================================================

/**
 * The Sheet root IR — the whole planning spreadsheet, a CLOSED struct the
 * `Sheet` arm of `UIComponentType` references directly.
 *
 * @remarks
 * `onUpdate` never reaches the wire: the factory compiles it into `onEdit`
 * (§4.7), and a typed `onEdit` is bridged into the same closed function
 * (§4.8). `selection` present makes the selection controlled (§3.14).
 *
 * @property rows - The row source: inline wire rows, or a paged source of them
 * @property columns - The declared columns, in order
 * @property registers - Register name → register
 * @property driver - The driver column and its members
 * @property suggest - The row-proposal declaration
 * @property slice - The slice chrome (search / filter / cohort); the lens reads the bound state
 * @property views - The saved views
 * @property activeView - The active view's id
 * @property onViewsChange - Views changed (snapshot, rename, reorder, close)
 * @property onEdit - The raw edit channel (`onUpdate` compiles to it)
 * @property onSelect - The ring moved
 * @property selection - Controlled selection when `some`
 * @property newRowId - Overrides the renderer's id minting for inserted rows
 * @property group - The group declaration (#740); `none` on a flat sheet
 * @property newLineKey - Overrides the renderer's key minting for lines inserted into `Dict` lines
 * @property readOnly - The whole sheet is read-only
 * @property blanks - Padding rows below the last real one (default 18)
 * @property density - Row rhythm
 * @property footer - Footer items
 * @property style - Sizing and the gutter width
 */
export const SheetRootType = StructType({
    rows:          SheetRowsType,
    columns:       ArrayType(SheetColumnType),
    registers:     DictType(StringType, SheetRegisterType),
    driver:        OptionType(SheetDriverType),
    suggest:       OptionType(SheetSuggestType),
    slice:         OptionType(SliceChromeType),
    views:         ArrayType(SheetViewType),
    activeView:    OptionType(StringType),
    onViewsChange: OptionType(FunctionType([ArrayType(SheetViewType)], NullType)),
    onEdit:        OptionType(FunctionType([SheetEditType], NullType)),
    onSelect:      OptionType(FunctionType([SheetSelectionType], NullType)),
    selection:     OptionType(SheetSelectionType),
    newRowId:      OptionType(FunctionType([], StringType)),
    group:         OptionType(SheetGroupType),
    newLineKey:    OptionType(FunctionType([], StringType)),
    readOnly:      OptionType(BooleanType),
    blanks:        OptionType(IntegerType),
    density:       OptionType(DensityType),
    footer:        ArrayType(SheetFooterItemType),
    style:         OptionType(SheetStyleType),
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
        row:      rowType,
        rows:     ArrayType(rowType),
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
 * `Sheet.Types.Edit(R)` — the raw edit event typed over the host's row
 * (§3.7): `commit` carries the row AFTER the commit, `insert` the new row,
 * `remove` the ids.
 *
 * @typeParam R - The host's row type
 * @param rowType - The row type value
 * @returns The concrete edit `VariantType`
 *
 * @property commit - One cell committed: `{ rowId, key, row, source }`
 * @property insert - A row inserted after `afterRowId` (`none` ⇒ at the end): `{ afterRowId, row, source }`
 * @property remove - Rows removed: `{ rowIds }`
 */
export function SheetEditTypeFor<R extends StructType>(rowType: R) {
    return VariantType({
        commit: StructType({ rowId: StringType, key: StringType, row: rowType, source: SheetSourceType }),
        insert: StructType({ afterRowId: OptionType(StringType), row: rowType, source: SheetSourceType }),
        remove: StructType({ rowIds: ArrayType(StringType) }),
    });
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
        row:      rowType,
        half:     SheetHalfType,
        member:   SheetMemberType,
    });
}

// ============================================================================
// Grouped rows (#740) — the lines field and the grouped typed constructors
// ============================================================================

/**
 * The keys of a group row whose field can hold the lines — an `Array<L>` or a
 * `Dict<String, L>` of structs.
 *
 * @typeParam P - The group's row type
 */
export type SheetLinesField<P extends StructType> = {
    [K in Extract<keyof P["fields"], string>]:
        P["fields"][K] extends ArrayTypeOf<StructType> ? K
        : P["fields"][K] extends DictType<StringType, StructType> ? K
        : never
}[Extract<keyof P["fields"], string>];

/**
 * The LINE type a group row's lines field holds.
 *
 * @typeParam P - The group's row type
 * @typeParam F - The lines field
 */
export type SheetLineOf<P extends StructType, F extends SheetLinesField<P>> =
    P["fields"][F] extends ArrayTypeOf<infer L extends StructType> ? L
    : P["fields"][F] extends DictType<StringType, infer L extends StructType> ? L
    : never;

/**
 * A line's address within its group — the index of `Array` lines, the key of
 * `Dict` lines.
 *
 * @typeParam P - The group's row type
 * @typeParam F - The lines field
 */
export type SheetLineAddress<P extends StructType, F extends SheetLinesField<P>> =
    P["fields"][F] extends ArrayTypeOf<StructType> ? IntegerType : StringType;

/**
 * The line type and shape a group row's lines field holds, checked at build time.
 *
 * @param groupType - The group's row type value
 * @param field - The lines field
 * @returns The line type and whether the lines are keyed
 * @throws Error naming the field when it is not an `Array<Struct>` or `Dict<String, Struct>`
 */
export function sheetLinesOf(groupType: StructType, field: string): { lineType: StructType; keyed: boolean } {
    const fields = groupType.fields as Record<string, EastType>;
    const t = fields[field] as { type?: string; key?: EastType; value?: EastType } | undefined;
    if (t === undefined) {
        throw new Error(`Sheet: \`group\` names "${field}", which is not a field of the row type (${Object.keys(fields).join(", ")})`);
    }
    if (t.type === "Array" && (t.value as { type?: string } | undefined)?.type === "Struct") {
        return { lineType: t.value as StructType, keyed: false };
    }
    if (t.type === "Dict" && (t.key as { type?: string } | undefined)?.type === "String" && (t.value as { type?: string } | undefined)?.type === "Struct") {
        return { lineType: t.value as StructType, keyed: true };
    }
    throw new Error(`Sheet: the lines field "${field}" must be an Array<Line> or a Dict<String, Line> of structs — got ${t.type ?? "an unknown type"}`);
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
 * @property rowIndex - The line's index WITHIN its group
 * @property row - The line as it would be if the open editor committed
 * @property rows - The group's lines, in order
 * @property group - The group row
 * @property groups - The resident groups, in sheet order
 * @property partial - `true` on a paged sheet whose source is not exhausted
 * @property driver - The driver's row for `row`
 * @property today - UTC midnight
 */
export function SheetGroupContextTypeFor<P extends StructType, F extends SheetLinesField<P>, D extends EastType = NullType>(
    groupType: P, lines: F, driverType?: D,
): SheetGroupContextOf<P, SheetLineOf<P, F>, D> {
    const { lineType } = sheetLinesOf(groupType, lines);
    return StructType({
        rowIndex: IntegerType,
        row:      lineType,
        rows:     ArrayType(lineType),
        group:    groupType,
        groups:   ArrayType(groupType),
        partial:  BooleanType,
        driver:   OptionType((driverType ?? NullType) as D),
        today:    DateTimeType,
    }) as unknown as SheetGroupContextOf<P, SheetLineOf<P, F>, D>;
}

/**
 * `Sheet.Types.Edit(P, "lines")` — the raw edit event of a GROUPED sheet,
 * typed over the group's row: the three line arms address a line by its
 * group's id and its index (`Array` lines) or key (`Dict` lines); the three
 * group arms are the band's.
 *
 * @typeParam P - The group's row type
 * @typeParam F - The lines field
 * @param groupType - The group's row type value
 * @param lines - The lines field
 * @returns The concrete edit `VariantType`
 *
 * @property commit - A line's cell committed: `{ rowId, line, key, row, source }` — `row` is the GROUP after the commit
 * @property insert - A line inserted into a group after `after` (`none` ⇒ first), at `line`
 * @property remove - Lines removed from a group
 * @property groupCommit - A band cell committed: `{ rowId, key, row, source }`
 * @property groupInsert - A group created after `afterRowId` (`none` ⇒ at the end)
 * @property groupRemove - Groups removed
 */
export function SheetGroupEditTypeFor<P extends StructType, F extends SheetLinesField<P>>(groupType: P, lines: F) {
    const { keyed } = sheetLinesOf(groupType, lines);
    const address = (keyed ? StringType : IntegerType) as SheetLineAddress<P, F>;
    return VariantType({
        commit:      StructType({ rowId: StringType, line: address, key: StringType, row: groupType, source: SheetSourceType }),
        insert:      StructType({ rowId: StringType, after: OptionType(address), line: address, row: groupType, source: SheetSourceType }),
        remove:      StructType({ rowId: StringType, lines: ArrayType(address) }),
        groupCommit: StructType({ rowId: StringType, key: StringType, row: groupType, source: SheetSourceType }),
        groupInsert: StructType({ afterRowId: OptionType(StringType), row: groupType }),
        groupRemove: StructType({ rowIds: ArrayType(StringType) }),
    });
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
export function SheetGroupCheckContextTypeFor<P extends StructType, F extends SheetLinesField<P>>(groupType: P, lines: F) {
    const { lineType } = sheetLinesOf(groupType, lines);
    return StructType({
        rowIndex: IntegerType,
        row:      lineType,
        group:    groupType,
        half:     SheetHalfType,
        member:   SheetMemberType,
    });
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
/** The TS type of `Sheet.Types.Edit(R)`. */
export type SheetEditOf<R extends StructType> = ReturnType<typeof SheetEditTypeFor<R>>;
/** The TS type of `Sheet.Types.CheckContext(R)`. */
export type SheetCheckContextOf<R extends StructType> = ReturnType<typeof SheetCheckContextTypeFor<R>>;
/** The TS type of `Sheet.Types.Context(P, "lines", D)` — parameterised by the LINE type the context carries. */
export type SheetGroupContextOf<P extends StructType, L extends StructType, D extends EastType = NullType> = StructType<{
    rowIndex: IntegerType;
    row:      L;
    rows:     ArrayTypeOf<L>;
    group:    P;
    groups:   ArrayTypeOf<P>;
    partial:  BooleanType;
    driver:   OptionType<D>;
    today:    DateTimeType;
}>;
/** The TS type of `Sheet.Types.Edit(P, "lines")`. */
export type SheetGroupEditOf<P extends StructType, F extends SheetLinesField<P>> = ReturnType<typeof SheetGroupEditTypeFor<P, F>>;
/** The TS type of `Sheet.Types.CheckContext(P, "lines")`. */
export type SheetGroupCheckContextOf<P extends StructType, F extends SheetLinesField<P>> = ReturnType<typeof SheetGroupCheckContextTypeFor<P, F>>;
/** Either context an author function may take — a flat sheet's over `R`, or a grouped sheet's over the line `R`. */
export type SheetAnyContextOf<R extends StructType, D extends EastType = any> = SheetContextOf<R, D> | SheetGroupContextOf<StructType, R, D>;
/** Either check context an author check may take — a flat sheet's over `R`, or a grouped sheet's over the line `R`. */
export type SheetAnyCheckContextOf<R extends StructType> = SheetCheckContextOf<R> | StructType<{ rowIndex: IntegerType; row: R; group: StructType; half: SheetHalfType; member: SheetMemberType }>;

/**
 * `Sheet.Types.Context` — the copilot context: `Context(R, D?)` on a flat
 * sheet, `Context(P, "lines", D?)` on a grouped one.
 */
export function sheetContextType<R extends StructType, D extends EastType = NullType>(rowType: R, driverType?: D): SheetContextOf<R, D>;
export function sheetContextType<P extends StructType, F extends SheetLinesField<P>, D extends EastType = NullType>(groupType: P, lines: F, driverType?: D): SheetGroupContextOf<P, SheetLineOf<P, F>, D>;
export function sheetContextType(first: StructType, second?: unknown, third?: unknown): unknown {
    if (typeof second === "string") return SheetGroupContextTypeFor(first, second as never, third as EastType | undefined);
    return SheetContextTypeFor(first, second as EastType | undefined);
}

/** `Sheet.Types.Edit` — the raw edit event: `Edit(R)` on a flat sheet, `Edit(P, "lines")` on a grouped one. */
export function sheetEditType<R extends StructType>(rowType: R): SheetEditOf<R>;
export function sheetEditType<P extends StructType, F extends SheetLinesField<P>>(groupType: P, lines: F): SheetGroupEditOf<P, F>;
export function sheetEditType(first: StructType, second?: unknown): unknown {
    if (typeof second === "string") return SheetGroupEditTypeFor(first, second as never);
    return SheetEditTypeFor(first);
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
