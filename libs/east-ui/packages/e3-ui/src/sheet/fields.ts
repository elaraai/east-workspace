/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet's inspector forms (#1188, `Sheet Builder Spec.md` §5.3,
 * SB10): every field of a row — a grouped sheet's line — and of a group,
 * resolved through `Fields`, each column's kind its field's default hint and
 * an explicit hint (`fields`, `groupFields`) winning.
 *
 * | The field's column | Its editor |
 * |---|---|
 * | `text` | Text |
 * | `custom` | Text — the column's own `print` shows it, its `parse` reads it |
 * | `date` | The date field, at the row's date level (the renderer sets its precision) |
 * | `quantity`, `integer` | The number field — a quantity in the driver's unit |
 * | `lookup`, `reference`, `enum` | A select over the register's members (`reference` of the register) |
 * | `set`, `link` | Read only here: the renderer draws the members, and edits them in the grid |
 * | `stamped`, a `value` projection, `editable: false` | Read only |
 * | No column | By its type, as `Fields.specs` resolves it |
 *
 * A field with a column is read and written through it: its spec names the
 * column (or the band cell, on a group), and an edit in the inspector is the
 * cell's write, as typing in it is (SB52). A field with none is the draft's
 * own. A hint may label a column's field, give it a help line, make it read
 * only or hide it; an editor hint must fit the field's type, and a read-only
 * column takes none. Each form carries the cells a patch of its struct sets
 * (`encode`) — the projection the copilot's proposals and the templates go
 * through — so a whole-row write (a custom inspector's `update`, SB58) lands
 * on the cells as the grid would write them.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BlobType,
    East,
    EastTypeType,
    FunctionType,
    OptionType,
    StringType,
    StructType,
    none,
    some,
    toEastTypeValue,
    variant,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import { FIELD_HINT, FieldSpecType, Fields, fieldSpecs, spellOut, type FieldEditorValue, type FieldHints } from "@elaraai/east-ui/internal";
import { SheetCellsType, buildPatchCells, type SheetBridge, type SheetColumnMeta } from "./bridge.js";
import { SheetPatchTypeFor } from "./types.js";

// ============================================================================
// The wire
// ============================================================================

/**
 * One field of an inspector form on the wire.
 *
 * @property spec - What the form draws — `Fields`' spec
 * @property column - The column it is read and written through, by key (on a group, the band cell's key); `none` for a field the draft holds alone
 */
export const SheetFieldType = StructType({
    spec: FieldSpecType,
    column: OptionType(StringType),
});

/** Type representing {@link SheetFieldType}. */
export type SheetFieldType = typeof SheetFieldType;

/**
 * One inspector form on the wire: the struct it edits, its fields in the
 * form's order, and the cells a patch of the struct sets.
 *
 * @property type - The struct the form edits — the row (a grouped sheet's line), or the group
 * @property fields - Its fields: the hinted first, in hint order, then the rest in declared order
 * @property columns - The struct's fields its editable columns write — a column's own, a link's other half — whatever the form shows: a whole-row write sets these through `encode`
 * @property readonly - The struct's fields its read-only columns show — a stamped code, a `value` projection, a column `editable: false` — which a whole-row write leaves as they are, as the grid does; every other field a whole-row write sets on the draft
 * @property encode - A `Sheet.Types.Patch` of the struct, encoded (beast2) → the cells it sets through the sheet's editable columns (or the band's cells)
 */
export const SheetFormType = StructType({
    type: EastTypeType,
    fields: ArrayType(SheetFieldType),
    columns: ArrayType(StringType),
    readonly: ArrayType(StringType),
    encode: FunctionType([BlobType], SheetCellsType),
});

/** Type representing {@link SheetFormType}. */
export type SheetFormType = typeof SheetFormType;

/**
 * The inspector's forms on the wire.
 *
 * @property row - A row's — a grouped sheet's line's
 * @property group - A group's own fields, on a grouped sheet
 */
export const SheetFormsType = StructType({
    row: SheetFormType,
    group: OptionType(SheetFormType),
});

/** Type representing {@link SheetFormsType}. */
export type SheetFormsType = typeof SheetFormsType;

// ============================================================================
// The build
// ============================================================================

/** A hint as the resolver reads it. */
type AnyHint = { readonly [FIELD_HINT]: string; readonly label?: string; readonly help?: string };

/** Whether a value is a hint rather than a nested struct's hints. */
function isHint(value: unknown): value is AnyHint {
    return value !== null && typeof value === "object" && FIELD_HINT in value;
}

/** Why a column's field takes no editor hint, or `undefined` when it does. */
function readOnlyReason(meta: SheetColumnMeta): string | undefined {
    if (meta.derived !== undefined) return "is a `value` projection, a derived read";
    if (meta.kind === "stamped") return "is stamped — a code an upstream system owns";
    if (meta.kind === "set" || meta.kind === "link") return `is a ${meta.kind} column, whose members are edited in the sheet`;
    if (meta.kind === "custom") return "is a custom column, read through its own `parse`";
    if (!meta.editable) return "is read only (`editable: false`)";
    return undefined;
}

/** A hint's `reference` editor, checked against the sheet's registers: the keyed set a select lists is one of them. */
function checkReference(editor: FieldEditorValue, field: string, registers: ReadonlySet<string>): void {
    if (editor.type !== "reference" || registers.has(editor.value.of)) return;
    throw new Error(`Sheet: \`${field}\` is a reference to "${editor.value.of}", which is not one of the sheet's registers (${[...registers].join(", ") || "none declared"}) — declare it in \`registers\`, or name one of them`);
}

/** A column's field's editor with no hint: its kind's. */
function kindEditor(meta: SheetColumnMeta): FieldEditorValue {
    if (meta.derived !== undefined || !meta.editable) return variant("readonly", null);
    switch (meta.kind) {
        case "text":
        case "custom": return variant("text", { placeholder: none });
        case "date": return variant("datetime", { precision: none });
        case "quantity":
        case "integer": return variant("number", { unit: none, step: none, min: none, max: none });
        case "lookup":
        case "reference":
        case "enum": return variant("reference", { of: meta.register! });
        default: return variant("readonly", null);
    }
}

/**
 * The spec of a field read and written through a column — its kind's editor,
 * or its hint's; the column's header (else the field's name spelled out) and
 * its second line its label and help, unless the hint names its own.
 */
function columnField(name: string, meta: SheetColumnMeta, hint: AnyHint | undefined, where: string, registers: ReadonlySet<string>): ExprType<SheetFieldType> {
    const kind = hint?.[FIELD_HINT];
    let editor: FieldEditorValue;
    let type: EastType;
    if (meta.derived !== undefined) {
        // A projection's value is the cell's, never the field's.
        type = meta.derivedOptional === true ? OptionType(meta.payloadType) : meta.payloadType;
    } else if (meta.kind === "custom") {
        // A custom column's text: shown by its print, read by its parse.
        type = meta.optional ? OptionType(StringType) : StringType;
    } else {
        type = meta.fieldType;
    }
    if (kind === undefined || kind === "readonly") {
        editor = kind === "readonly" ? variant("readonly", null) : kindEditor(meta);
    } else {
        const reason = readOnlyReason(meta);
        if (reason !== undefined) {
            throw new Error(`Sheet: \`${where}.${name}\` gives its field an editor, but its column ${reason} — hint it Sheet.field.readonly() or Sheet.field.hidden(), or give it a label or help alone`);
        }
        // The hint's editor, checked against the field's type as Fields checks it, and a select's set against the registers.
        editor = fieldSpecs(StructType({ [name]: meta.fieldType }), { [name]: hint } as never)[0]!.editor;
        checkReference(editor, `${where}.${name}`, registers);
    }
    return East.value({
        spec: {
            path: [name],
            // The hint's label, else the column's header, else the field's name spelled out.
            label: hint?.label ?? meta.config.header ?? spellOut(name),
            help: hint?.help !== undefined ? some(hint.help) : meta.config.sub !== undefined ? some(meta.config.sub) : none,
            group: none,
            type: toEastTypeValue(type),
            optional: (type as { type: string }).type === "Variant" && Object.keys((type as { cases: object }).cases).length === 2 && "some" in (type as { cases: object }).cases && "none" in (type as { cases: object }).cases,
            editor,
        },
        column: some(meta.key),
    } as SubtypeExprOrValue<SheetFieldType>, SheetFieldType);
}

/**
 * One inspector form: the struct's fields, each through its column or by its
 * type, in the form's order.
 *
 * @param struct - The struct the form edits
 * @param metas - The columns its fields are read through, by field
 * @param hints - The author's hints, by field
 * @param leave - The fields the form leaves out: an identity field, a group's lines field
 * @param where - The prop the hints came from, for a refusal (`fields`, `groupFields`)
 * @param registers - The sheet's registers, by name: what a `reference` hint may name
 * @returns The form's fields
 * @throws Error naming the field: a hint for a field the struct does not have, one that does not fit it, or a reference to a register the sheet does not declare
 */
function formFields(
    struct: StructType,
    metas: ReadonlyMap<string, SheetColumnMeta>,
    hints: Readonly<Record<string, unknown>>,
    leave: ReadonlySet<string>,
    where: string,
    registers: ReadonlySet<string>,
): ExprType<SheetFieldType>[] {
    const fields = struct.fields as Record<string, EastType>;
    // A link column's other half is written through that column, never on its own.
    const halves = new Set([...metas.values()].flatMap((m) => (m.otherField !== undefined ? [m.otherField] : [])));
    for (const name of Object.keys(hints)) {
        if (!(name in fields)) {
            throw new Error(`Sheet: \`${where}\` names "${name}", which is not a field of ${where === "groupFields" ? "the group type" : "the row type"} (${Object.keys(fields).join(", ")})`);
        }
        if (leave.has(name) || halves.has(name)) {
            throw new Error(`Sheet: \`${where}\` names "${name}", which the inspector does not show as a field of its own — ${halves.has(name) ? "it is a link column's other half, shown with that column" : "it is the row's identity, or the group's rows"}`);
        }
    }
    const order = [...Object.keys(hints), ...Object.keys(fields).filter((name) => !(name in hints))];
    const out: ExprType<SheetFieldType>[] = [];
    for (const name of order) {
        if (leave.has(name) || halves.has(name)) continue;
        const hint = hints[name];
        if (isHint(hint) && hint[FIELD_HINT] === "hidden") continue;
        const meta = metas.get(name);
        if (meta !== undefined) {
            if (hint !== undefined && !isHint(hint)) {
                throw new Error(`Sheet: \`${where}.${name}\` is shown through its column — its hint is one of Sheet.field's, never a hint per nested field`);
            }
            out.push(columnField(name, meta, hint, where, registers));
            continue;
        }
        // No column: the field by its type, as Fields resolves it — a nested struct's fields under its name.
        const others = Object.keys(fields).filter((f) => f !== name);
        for (const spec of fieldSpecs(struct, (hint === undefined ? {} : { [name]: hint }) as FieldHints<Record<string, EastType>>, others)) {
            checkReference(spec.editor, `${where}.${spec.path.join(".")}`, registers);
            out.push(East.value({ spec, column: none }, SheetFieldType));
        }
    }
    return out;
}

/**
 * The fields a whole-row write sets through the columns — the fields `encode`
 * writes: an editable column's own and a link's other half — and the fields
 * it leaves, under the read-only columns.
 */
function columnFields(metas: readonly SheetColumnMeta[]): { columns: string[]; readonly: string[] } {
    const writes = (m: SheetColumnMeta) => m.editable && m.derived === undefined;
    const columns = new Set(metas.filter(writes).flatMap((m) => (m.otherField !== undefined ? [m.field, m.otherField] : [m.field])));
    const readonly = new Set(metas.filter((m) => !writes(m) && !columns.has(m.field)).map((m) => m.field));
    return { columns: [...columns], readonly: [...readonly] };
}

/** A form's `encode`: a patch of the struct, as bytes, through the cells it sets. */
function encodeOf(patchType: StructType, cells: SheetBridge["encodePatch"]): ExprType<FunctionType<[BlobType], typeof SheetCellsType>> {
    return East.function([BlobType], SheetCellsType, ($, bytes) => {
        const encode = $.const(cells);
        const patch = $.const(bytes.decodeBeast(patchType, "v2"));
        return encode(patch);
    });
}

/**
 * Builds the inspector's forms (SB10): a row's (a grouped sheet's line's) and,
 * on a grouped sheet, a group's.
 *
 * @param bridge - The sheet's bridge, as its root compiled it
 * @param metas - The declared columns, described against the row (or line) type
 * @param hints - `fields`: the author's hints for the row's fields
 * @param groupHints - `groupFields`: the author's hints for the group's own fields
 * @param idField - The rows' identity field, which the form leaves to the header
 * @param registers - The sheet's registers' names, the driver's among them: what a `reference` hint may name
 * @returns The forms on the wire
 * @throws Error naming the prop: `groupFields` on a flat sheet, and each refusal of a hint
 * @internal
 */
export function buildForms(
    bridge: SheetBridge,
    metas: readonly SheetColumnMeta[],
    hints: Readonly<Record<string, unknown>> | undefined,
    groupHints: Readonly<Record<string, unknown>> | undefined,
    idField: string | undefined,
    registers: readonly string[],
): ExprType<SheetFormsType> {
    const named = new Set(registers);
    const groupHalf = bridge.group;
    if (groupHalf === undefined && groupHints !== undefined) {
        throw new Error("Sheet: `groupFields` hints a group's fields, and this sheet declares no group — pass `group={Sheet.group(…)}`, or hint the rows with `fields`");
    }
    // A row's identity is its header's, never a field to edit: a flat row's, and a loose row's line beside the groups (#846).
    const lineLeave = new Set(idField !== undefined && idField in bridge.lineType.fields ? [idField] : []);
    const row = East.value({
        type: toEastTypeValue(bridge.lineType),
        fields: formFields(bridge.lineType, new Map(metas.map((m) => [m.field, m])), hints ?? {}, lineLeave, "fields", named),
        ...columnFields(metas),
        encode: encodeOf(bridge.patchType, bridge.encodePatch),
    }, SheetFormType);
    if (groupHalf === undefined) return East.value({ row, group: none }, SheetFormsType);
    const groupType = groupHalf.groupType;
    const groupLeave = new Set([groupHalf.linesField, ...(idField !== undefined && idField in groupType.fields ? [idField] : [])]);
    const group = East.value({
        type: toEastTypeValue(groupType),
        fields: formFields(groupType, new Map(groupHalf.cellMetas.map((m) => [m.field, m])), groupHints ?? {}, groupLeave, "groupFields", named),
        ...columnFields(groupHalf.cellMetas),
        encode: encodeOf(SheetPatchTypeFor(groupType) as unknown as StructType, buildPatchCells(groupType, groupHalf.cellMetas, {})),
    }, SheetFormType);
    return East.value({ row, group: some(group) }, SheetFormsType);
}

/**
 * `Sheet.field` — the inspector's hints, `Fields`' own (#1147): a label, a
 * help line, an editor for a field the inspector shows by its type, a field
 * read only or hidden. A column's field takes a label, a help line, read only
 * or hidden, and an editor that fits its type when its column is written.
 */
export const SheetField = Fields;
