/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The inspector pane (#1188, `Sheet Builder Spec.md` §5.3, §8, §9.9,
 * SB46–SB53, SB58): the Sheet's end pane, when it is given one (#1216), its
 * tabs Details and Issues — Issues with its count — and, collapsed, a rail
 * with its icon, the issue count and what is selected.
 *
 * Details shows what the ring and the range select:
 *
 * - **one row or line** (SB47): its number and id, a Pending or New chip,
 *   the lock of a row owned upstream, its issues, every field of its type
 *   through `FieldForm` (the payload's form: a column's kind its field's
 *   editor, a field with no column by its type — and each member of a column
 *   from data a line of its own, its cell, #1561), its sub rows read only, then
 *   Duplicate and Delete. A link or set field shows its halves as the grid
 *   draws them, with Edit in sheet, which puts the ring on its cell (SB48). An
 *   edit is one transaction, as typing in the cell is: a field with a column
 *   is written through its cell — the cells a patch of it sets, or a custom
 *   column's text read by its own parse — and asks the copilot again when its
 *   column is a trigger; a field with none is set on the draft (SB52). A
 *   number's box emptied is its cell emptied, as emptying the cell is: blank,
 *   the field then not set, where its column takes a clear. An edit its cell
 *   refuses — a clear of a value that is never empty — leaves the field
 *   showing what the row holds, the reason under it as the footer's line says
 *   it. A field the drafts changed is tinted against what the source holds.
 *   With
 *   the author's own Details (SB58), a complete row shows what they return in
 *   place of the form, and their `update` is one transaction; a row still
 *   missing a field, or holding one unreadable, shows the form until it is
 *   complete;
 * - **a band** (SB49): its group's own fields, its line count and its issues,
 *   then Add line, Duplicate with its lines, Delete with its lines;
 * - **several rows** (SB50): their count, a column set or cleared across
 *   them, Duplicate and Delete — each one transaction;
 * - **nothing** (SB51): the rows, the pending drafts and the issues counted,
 *   over a record its last commit and who made it, and three hints.
 *
 * Issues (SB53) lists every issue of the batch by row — a field still
 * missing or unreadable, an author's check, an Apply's conflict or refusal —
 * each a control that goes to its cell, seeking its row on a paged sheet. An
 * issue whose row the rail's filters hide says so, and by which once e3 has
 * said — `hidden by Status: Ready — picking it clears that filter` — and a
 * click clears them and goes to the row (the hidden pick, `hidden.ts`).
 *
 * Styles are the `sheetInspector` recipe's, the form's `fieldForm`'s and a
 * link cell's the `sheet` recipe's; the pane — its tab row, its collapse
 * control and its rail — is the Dock's.
 *
 * A host with a view of its own (#1534) — the Record's — draws Details for one
 * row and for nothing in the Sheet's place ({@link SheetInspectorHost}), a
 * phone's drawer's among them, over the same reads and writes, the form's own
 * (`useTargetForm`) among them, and names an issue's row in the Issues tab in
 * its own words. Several rows stay the Sheet's; so does a complete row given
 * the author's own Details.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faLock, faMinus, faPlus } from "@fortawesome/free-solid-svg-icons";
import {
    ArrayType, FloatType, IntegerType, NullType, OptionType, StringType, VariantType, compareFor, decodeBeast2For, defaultValue, encodeBeast2For, equalFor, fromEastTypeValue, isTypeEqual, none, printFor, some,
    toEastTypeValue, variant, type EastType, type StructType, type ValueTypeOf, type option,
} from "@elaraai/east";
import type { FieldEditorValue, FieldSpecValue } from "@elaraai/east-ui/internal";
import { Sheet, type sheetKeys } from "@elaraai/e3-ui/internal";
import {
    EastChakraComponent, FieldForm, fieldBreachText, fieldBreaches, fieldFormMessages, getSomeorUndefined, useDataStable, type BuilderFrameDock, type EditIssue,
    type FieldOption,
} from "@elaraai/east-ui-components";
import { FrameDrawer, useSlotStyles } from "@elaraai/east-ui-components/internal";
import { useSheetInspect, type SheetCellEditorAt, type SheetInspect, type SheetInspectPlace, type SheetInspectTarget, type SheetInspectWrite, type SheetSelected } from "../index.js";
import { formatTime, splitTimeToken, todayUtc, withTime } from "../parse/date.js";
import { NULL_CELL, cellText, indexRegisters, takesClear, type SheetColumnMeta } from "../model.js";
import type { SheetCellValue } from "../values.js";
import { issueText, type SheetWords } from "../words.js";
import { actionColumnOf } from "../actions/model.js";
import { setAt } from "../actions/form-check.js";
import { namesMember } from "../Rows.js";
import type { SheetValue } from "./index.js";

/**
 * What the inspector reads of its payload: the grid's root, the inspector pane and the record's history — a Sheet's,
 * or a Record's (#1531), which mounts it over the same parts.
 */
export type SheetInspectorValue = Pick<SheetValue, "sheet" | "inspector" | "history">;

/** The inspector pane, decoded: its forms, and the author's own Details. */
export type PaneValue = Extract<SheetValue["inspector"], { type: "some" }>["value"];
/** One inspector form, decoded: its struct, its fields, the fields its columns write and show, and `encode`. */
export type FormValue = PaneValue["forms"]["row"];
/** What the author's own Details return for a complete row (SB58): the UI drawn in the form's place. */
export type AuthorDetails = ReturnType<Extract<PaneValue["custom"], { type: "some" }>["value"]>;
/** One field of a form, decoded. */
type FormField = FormValue["fields"][number];
/** The names the sheet keeps its viewer's state under. */
type SheetKeys = ReturnType<typeof sheetKeys>;
type Styles = Record<string, SystemStyleObject>;

const stringEqual = equalFor(StringType);
const pathEqual = equalFor(ArrayType(StringType));

/** The inspector open: the Calendar's 320px (§8). */
const INSPECTOR_SIZE = "320px";

/** The bulk edit's choice of a column: a name no struct's field takes. */
const PICK = "$column";

/** A field's path as one key. */
const pathKey = (path: readonly string[]) => path.join("\u001f");

/** The record's last commit, as the footer and the inspector say it (SB22, SB51). */
export interface SheetLastCommit {
    /** When — the day's time when it was today, in full otherwise. */
    when: string;
    /** Who made it: the commit's actor. */
    by: string;
}

/** Props of {@link useSheetInspector}. */
export interface SheetInspectorProps {
    /** The payload: its inspector pane, the sheet's registers and editing, and whether it is over a record. */
    value: SheetInspectorValue;
    /** The names the sheet keeps its viewer's state under. */
    keys: SheetKeys;
    /** The sheet's words. */
    words: SheetWords;
    /** The columns this viewer hides: a link field's Edit in sheet waits for its column to show. */
    hidden: ReadonlySet<string>;
    /** The record's last commit, when it has one. */
    lastCommit: SheetLastCommit | undefined;
    /** What a host draws in the Sheet's place (#1534): its own Details, and its words for an issue's row; absent, the Sheet's. */
    host?: SheetInspectorHost | undefined;
}

/**
 * What a host draws in the inspector in the Sheet's place (#1534) — the Record's: Details for one row and for nothing,
 * and the words an issue's line names its row by.
 */
export interface SheetInspectorHost {
    /**
     * Details while the ring selects one place — a row, a line or a band — or nothing: in a phone's drawer too, where
     * they draw at touch size, as the Sheet's own do there (SH12). Several rows are the Sheet's. A complete row given
     * the author's own Details shows them in the form's place ({@link useAuthorDetails}).
     */
    Details: ComponentType<SheetInspectorDetailsProps>;
    /**
     * How an issue's line in the Issues tab names its row, given where the row stands among the rows drawn —
     * `undefined` for one the sheet does not draw; absent, by its entry, a line by its place in its group.
     */
    where?: ((issue: EditIssue, place: SheetInspectPlace | undefined) => string) | undefined;
}

/** What a host's Details is given ({@link SheetInspectorHost.Details}). */
export interface SheetInspectorDetailsProps {
    /** The payload: the grid's root, the inspector pane and the record's history. */
    value: SheetInspectorValue;
    /** The pane: its forms, and the author's own Details. */
    pane: PaneValue;
    /** The names the sheet keeps its viewer's state under. */
    keys: SheetKeys;
    /** The sheet's words. */
    words: SheetWords;
    /** The columns this viewer hides. */
    hidden: ReadonlySet<string>;
    /** The host's word for a group. */
    noun: string;
    /** What the ring selects: one row's place, or nothing. */
    selected: Exclude<SheetSelected, { kind: "several" }>;
}

/** The host's word for a group, or the sheet's. */
function nounOf(value: SheetInspectorValue, words: SheetWords): string {
    const group = getSomeorUndefined(value.sheet.group);
    return (group !== undefined ? getSomeorUndefined(group.noun)?.singular : undefined) ?? words.m.groupNoun();
}

/**
 * What the inspector shows, as its head and its rail name it — `row 3`, `line 2 of WO-2201`, `order 4`.
 *
 * @param place - Where it stands
 * @param words - The sheet's words
 * @param noun - The host's word for a group
 * @returns Its name
 */
export function whatOf(place: SheetInspectPlace, words: SheetWords, noun: string): string {
    return words.m.inspectorWhat({ what: place.kind, number: words.number(place.number), title: place.group?.title, noun });
}

/**
 * The inspector pane, as `BuilderFrame` draws it — see the module docs.
 *
 * @param props - The payload, the sheet's keys, the words, the columns hidden, the last commit, and what a host draws in the Sheet's place
 * @returns The pane — its tabs Details and Issues, 320px wide, its collapsed state kept per viewer (SB24) — or `undefined`, no pane, when the sheet is given no inspector
 */
export function useSheetInspector({ value, keys, words, hidden, lastCommit, host }: SheetInspectorProps): BuilderFrameDock | undefined {
    const { m } = words;
    const inspect = useSheetInspect();
    const pane = getSomeorUndefined(value.inspector);
    // No `inspector`: no pane (#1216).
    if (pane === undefined) return undefined;
    const noun = nounOf(value, words);
    const issues = inspect.counts.issues;
    const selected = inspect.selected;
    // The rail's line: what is selected.
    const detail = selected.kind === "one" ? whatOf(selected.place, words, noun)
        : selected.kind === "several" ? m.inspectorSeveral({ n: selected.rs.length, count: words.number(selected.rs.length), lines: getSomeorUndefined(value.sheet.group) !== undefined })
            : undefined;
    return {
        label: m.inspectorPane(),
        icon: "sliders",
        size: INSPECTOR_SIZE,
        persist: "local",
        badge: issues > 0 ? words.number(issues) : undefined,
        detail,
        tabs: [
            { key: "details", label: m.inspectorTab({ tab: "details" }),
                body: <SheetInspectorDetails value={value} pane={pane} keys={keys} words={words} hidden={hidden} lastCommit={lastCommit} host={host} noun={noun} /> },
            { key: "issues", label: m.inspectorTab({ tab: "issues" }), count: words.number(issues),
                body: <SheetInspectorIssues forms={pane.forms} columns={value.sheet.columns} words={words} noun={noun} where={host?.where} /> },
        ],
    };
}

/** Props of the Details tab and its views. */
interface DetailsProps extends SheetInspectorProps {
    /** The pane: its forms, and the author's own Details. */
    pane: PaneValue;
    /** The host's word for a group. */
    noun: string;
}

/** The Details tab: what is selected — one row, a band, several rows, or nothing. */
const SheetInspectorDetails = memo(function SheetInspectorDetails(props: DetailsProps) {
    const inspect = useSheetInspect();
    const styles = useSlotRecipe({ key: "sheetInspector" })() as Styles;
    const selected = inspect.selected;
    // A host's own Details for one place and for nothing (#1534), a phone's drawer's too, at touch size (#1536).
    const Host = props.host?.Details;
    if (Host !== undefined && selected.kind !== "several") {
        return <Host value={props.value} pane={props.pane} keys={props.keys} words={props.words} hidden={props.hidden} noun={props.noun} selected={selected} />;
    }
    if (selected.kind === "none") {
        return <NothingSelected styles={styles} inspect={inspect} words={props.words} record={props.value.history.type === "some"} lastCommit={props.lastCommit} />;
    }
    // Each selection its own form: what was typed for one row never lands on the next.
    if (selected.kind === "several") return <SeveralRows key={`${selected.r0}:${selected.r1}`} {...props} styles={styles} inspect={inspect} rs={selected.rs} r0={selected.r0} r1={selected.r1} />;
    const place = selected.place;
    const form = place.kind === "band" ? getSomeorUndefined(props.pane.forms.group) : props.pane.forms.row;
    if (form === undefined) return null;
    return <TargetDetails key={`${place.kind}\u001f${place.entry}\u001f${place.child ?? ""}`} {...props} styles={styles} inspect={inspect} place={place} form={form} />;
});

// ============================================================================
// One row, line or band
// ============================================================================

/** A cell's value as a field of the spec's type: the payload, `undefined` for a blank or unreadable one — an Option's `some` or `none`. */
function cellValue(cell: SheetCellValue | undefined, optional: boolean): unknown {
    const held = cell === undefined || cell.type === "Null" || cell.type === "Invalid" ? undefined : cell.value;
    return optional ? (held === undefined ? none : some(held)) : held;
}

/** An action cell as its field's value (#1478): its case and its value, decoded at the case's type — an Option's `some` or `none`. */
function actionValue(meta: SheetColumnMeta, cell: SheetCellValue | undefined, optional: boolean): unknown {
    const c = cell?.type === "Action" ? actionColumnOf(meta)?.cases.get(cell.value.case) : undefined;
    const held = c === undefined || cell?.type !== "Action" ? undefined : variant(c.name, c.decode(cell.value.value));
    return optional ? (held === undefined ? none : some(held)) : held;
}

/** A payload as the cell its column holds it in. */
function cellOfPayload(type: EastType, payload: unknown): SheetCellValue {
    const tag = isTypeEqual(type, Sheet.Types.Link) ? "Link" : type.type;
    return variant(tag, payload) as SheetCellValue;
}

/** A custom column's text as its field: none (or `undefined`) for no text. */
function textValue(text: string, optional: boolean): unknown {
    return optional ? (text === "" ? none : some(text)) : (text === "" ? undefined : text);
}

/** A patch of one field of a struct, `next` its value: what a column's projection writes as the cells it sets. */
function patchOne(struct: StructType, name: string, next: unknown): Record<string, unknown> {
    return Object.fromEntries(Object.keys(struct.fields).map((field) => [field, stringEqual(field, name) ? some(next) : none]));
}

/**
 * A member's line's editor (#1561): its kind's, as the inspector's form gives a column's field its kind's — read only
 * where its column writes nothing, and for a stamped code, a link and a set, which the grid edits — at the cell's
 * value: a quantity in its unit at the row, a date at its level there.
 *
 * @param meta - The column made for the member
 * @param unit - A quantity's unit at the row
 * @param level - A date's level at the row
 * @returns The editor
 */
function memberEditor(meta: SheetColumnMeta, unit: string | undefined, level: "week" | "day" | "range" | "time" | undefined): FieldEditorValue {
    if (!meta.editable) return variant("readonly", null);
    switch (meta.kind) {
        case "text":
        case "title":
        case "custom": return variant("text", { placeholder: none });
        // A date at a week, a day or a range is a date alone, as the grid reads it; at the time level, a date and its time.
        case "date": return variant("datetime", { precision: level === "time" ? none : some(variant("date", null)) });
        case "quantity":
        case "integer": return variant("number", { unit: unit === undefined ? none : some(unit), step: none, min: none, max: none });
        // Its members at the row, by its key: a select's offered the column's own.
        case "enum":
        case "reference":
        case "person":
        case "cycle": return variant("reference", { of: meta.key });
        case "boolean":
        case "toggle": return variant("checkbox", null);
        default: return variant("readonly", null);
    }
}

/**
 * A member's line (#1561): the cell a column from data shows for its member, as a field of the form at the column's
 * key — of the value the cell holds, a custom column's its text, an Option where a clear writes none — labelled by
 * the member's header, its column's second line its help.
 *
 * @param meta - The column made for the member
 * @param editor - Its editor at the row ({@link memberEditor})
 * @returns The field's spec
 */
function memberSpec(meta: SheetColumnMeta, editor: FieldEditorValue): FieldSpecValue {
    const held = meta.kind === "custom" ? StringType : fromEastTypeValue(meta.raw.payloadType) as EastType;
    const optional = takesClear(meta);
    return {
        path: [meta.key], label: meta.header, help: meta.sub === undefined ? none : some(meta.sub), group: none,
        type: toEastTypeValue(optional ? OptionType(held) : held), optional, editor,
    };
}

/** Props of {@link TargetDetails}. */
interface PlaceProps extends DetailsProps {
    styles: Styles;
    inspect: SheetInspect;
    place: SheetInspectPlace;
    form: FormValue;
}

/** Props of {@link TargetView}. */
interface TargetProps extends Omit<PlaceProps, "place"> {
    target: SheetInspectTarget;
}

/** One row, line or band: its target — its draft and what the record holds — read as Details shows it, and drawn. */
function TargetDetails({ place, ...props }: PlaceProps) {
    const targetAt = props.inspect.targetAt;
    const target = useMemo(() => targetAt(place.r), [targetAt, place.r]);
    return target === undefined ? null : <TargetView {...props} target={target} />;
}

/** One target's form, as {@link useTargetForm} reads it: what `FieldForm` draws it with. */
export interface TargetForm {
    /** The specs at this row: the form's fields, then each member of a column from data a line of its own (#1561). */
    specs: FieldSpecValue[];
    /** The column each spec is read and written through, in the specs' order, by key — a member's line its column's; `undefined` for a field the draft holds alone. */
    columns: (string | undefined)[];
    /** Each select's members at this row, by the field's path. */
    options: Record<string, FieldOption[]>;
    /** The form's value: the draft's fields. */
    formValue: Record<string, unknown>;
    /** What the record holds, as the value holds the draft: a field that differs is tinted. */
    baseline: Record<string, unknown>;
    /** An edit of a field, written as typing in the grid writes it: why its cell refused it, in the Sheet's words, where it did. */
    onChange: (path: readonly string[], next: unknown) => string | void;
    /** The controls the form takes from the grid: a link's or a set's halves, an action's state, a member's label. */
    renderControl: (spec: FieldSpecValue) => ReactNode | undefined;
    /** The form's struct. */
    struct: StructType;
}

/**
 * The form's specs, values and edits for one target — the payload's form at
 * this row: a quantity's unit and a date's level from its row, a select's
 * members as its column's options rule offers them, a custom column's text
 * by its print and a read-only column's value from its cell, and each edit
 * written as typing in the grid writes it — each one step of the history, or,
 * given `joins`, one step with the edits before it under that key (a phone's
 * cell editor, SH10.1). A host's Details draws its form from it (#1534).
 *
 * Each member of a column from data is a line of its own after the form's
 * fields (#1561), whose field the form leaves out: the member's cell at the
 * column's key, read as the grid reads it at the day, tinted where it differs
 * from the cell the record holds, and written as typing in the cell writes it
 * — through the column's `write`, over the field as drafted so far. An age's
 * shows no line, as a column's age shows no field.
 *
 * @param input - The payload, the words, the columns hidden, the `sheetInspector` styles, the sheet's reads and writes, the target and its form — and the key its edits join under, if they are one step
 * @returns The form, as `FieldForm` draws it
 */
export function useTargetForm({ value, words, hidden, styles, inspect, target, form, joins }: Pick<TargetProps, "value" | "words" | "hidden" | "styles" | "inspect" | "target" | "form"> & { joins?: string | undefined }): TargetForm {
    const { m } = words;
    const button = useRecipe({ key: "button" });
    const r = target.r;
    // A write, and why its cell refused it in the Sheet's words — what the field says under it.
    const write = useCallback((writes: readonly SheetInspectWrite[]): string | undefined => {
        const refused = inspect.write(writes, joins);
        return refused === undefined ? undefined : m.cellRefused(refused);
    }, [inspect, joins, m]);
    const struct = useMemo(() => fromEastTypeValue(form.type) as StructType, [form.type]);
    const encodePatch = useMemo(() => encodeBeast2For(Sheet.Types.Patch(struct)), [struct]);
    const registers = useMemo(() => indexRegisters(value.sheet.registers), [value.sheet.registers]);
    const byPath = useMemo(() => new Map(form.fields.map((f) => [pathKey(f.spec.path), f])), [form.fields]);
    const metaOf = useCallback((f: FormField): SheetColumnMeta | undefined => {
        const key = getSomeorUndefined(f.column);
        return key === undefined ? undefined : inspect.columnAt(r, key);
    }, [inspect, r]);
    // The members of the columns from data at this row, each a line of its own (#1561) — but an age's, which shows no field.
    const members = useMemo(() => value.sheet.columns.flatMap((column): SheetColumnMeta[] => {
        if (getSomeorUndefined(column.from) === undefined) return [];
        const meta = inspect.columnAt(r, column.key);
        return meta === undefined || meta.kind === "age" ? [] : [meta];
    }), [value.sheet.columns, inspect, r]);
    const memberOf = useMemo(() => new Map(members.map((meta) => [meta.key, meta] as const)), [members]);
    // A member's line's editor at this row: a quantity's unit, a date's level, its own.
    const editorOf = useCallback((meta: SheetColumnMeta) => memberEditor(meta, meta.kind === "quantity" ? inspect.unitAt(r, meta.key) : undefined,
        meta.kind === "date" ? inspect.levelAt(r, meta.key) : undefined), [inspect, r]);

    // The specs at this row: a select's own members, a quantity's unit, a date's level, a stamped code's owner — and each
    // member's line.
    const specs = useMemo(() => [...form.fields.map((f): FieldSpecValue => {
        const meta = metaOf(f);
        const editor = f.spec.editor;
        // Each select its own members at this row, by its path: two fields over one register may be offered different ones.
        if (editor.type === "reference") return { ...f.spec, editor: variant("reference", { of: pathKey(f.spec.path) }) };
        if (meta?.kind === "quantity" && editor.type === "number" && editor.value.unit.type === "none") {
            const unit = inspect.unitAt(r, meta.key);
            return unit === undefined ? f.spec : { ...f.spec, editor: variant("number", { ...editor.value, unit: some(unit) }) };
        }
        if (meta?.kind === "date" && editor.type === "datetime" && editor.value.precision.type === "none" && inspect.levelAt(r, meta.key) !== "time") {
            // A date at a week, a day or a range is a date alone, as the grid reads it; at the time level, a date and its time.
            return { ...f.spec, editor: variant("datetime", { precision: some(variant("date", null)) }) };
        }
        if (meta?.kind === "stamped" && meta.owner !== undefined && f.spec.help.type === "none") return { ...f.spec, help: some(meta.owner) };
        return f.spec;
    }), ...members.map((meta) => memberSpec(meta, editorOf(meta)))], [form.fields, metaOf, inspect, r, members, editorOf]);
    const columns = useMemo(() => [...form.fields.map((f) => getSomeorUndefined(f.column)), ...members.map((meta) => meta.key)], [form.fields, members]);

    // A select's members: its register's, as its column's options rule offers them at this row — a member's line's, its column's.
    const options = useMemo(() => {
        const out: Record<string, FieldOption[]> = {};
        const offered = (register: string, key: string | undefined): FieldOption[] => {
            const allowed = key !== undefined ? inspect.allowedAt(r, key) : undefined;
            return (registers.byName.get(register) ?? [])
                .filter((member) => allowed === undefined || allowed.has(member.key))
                .map((member) => {
                    const meta = getSomeorUndefined(member.meta);
                    return { key: member.key, label: meta === undefined ? member.label : `${member.label} · ${meta}` };
                });
        };
        for (const f of form.fields) {
            if (f.spec.editor.type !== "reference") continue;
            out[pathKey(f.spec.path)] = offered(f.spec.editor.value.of, getSomeorUndefined(f.column));
        }
        for (const meta of members) {
            if (meta.register !== undefined && editorOf(meta).type === "reference") out[pathKey([meta.key])] = offered(meta.register, meta.key);
        }
        return out;
    }, [form.fields, registers, inspect, r, members, editorOf]);

    // The form's value and baseline: the draft's fields — a custom column's text by its print, a read-only column's from its cell.
    const { formValue, baseline } = useMemo(() => {
        const current: Record<string, unknown> = { ...(target.value ?? {}) };
        // A row never applied began from nothing: every field it has is a change.
        const began: Record<string, unknown> = target.baseline === undefined ? {} : { ...target.baseline };
        for (const f of form.fields) {
            const meta = metaOf(f);
            if (meta === undefined) continue;
            const name = f.spec.path[0]!;
            if (meta.kind === "custom" && f.spec.editor.type === "text") {
                current[name] = textValue(cellText(inspect.cellAt(r, meta.key), meta, words), f.spec.optional);
                if (target.baseline === undefined) continue;
                const was = target.baseline[name];
                const payload = f.spec.optional ? getSomeorUndefined(was as option<unknown>) : was;
                const payloadType = fromEastTypeValue(meta.raw.payloadType) as EastType;
                began[name] = textValue(payload === undefined ? "" : cellText(cellOfPayload(payloadType, payload), meta, words), f.spec.optional);
            } else if (meta.kind === "action") {
                // An action field: its case as its cell holds it, never tinted — the actions write it (#1478).
                current[name] = actionValue(meta, inspect.cellAt(r, meta.key), f.spec.optional);
                began[name] = current[name];
            } else if (f.spec.editor.type === "readonly") {
                // What the grid shows, never tinted.
                current[name] = cellValue(inspect.cellAt(r, meta.key), f.spec.optional);
                began[name] = current[name];
            }
        }
        // A member's line: its cell as the grid shows it, against the cell the record holds — as it stands on a row no
        // gesture has touched, and none on a new row, whose every value is a change.
        const changes = inspect.changesAt(r);
        for (const meta of members) {
            const optional = takesClear(meta);
            const valueOf = (cell: SheetCellValue | undefined) => (meta.kind === "custom" ? textValue(cellText(cell, meta, words), optional) : cellValue(cell, optional));
            current[meta.key] = valueOf(inspect.cellAt(r, meta.key));
            if (changes === undefined) began[meta.key] = current[meta.key];
            else if (!changes.added) began[meta.key] = valueOf(changes.held?.get(meta.key));
        }
        return { formValue: current, baseline: began };
    }, [target, form.fields, metaOf, inspect, r, words, members]);

    const onChange = useCallback((path: readonly string[], next: unknown): string | undefined => {
        // A member's line: its cell, written as typing in it writes it — the column's `write` over the field as drafted
        // so far; emptied, the blank cell, which the write refuses where a clear writes nothing.
        const member = path.length === 1 ? memberOf.get(path[0]!) : undefined;
        if (member !== undefined) {
            const held = takesClear(member) ? getSomeorUndefined(next as option<unknown>) : next;
            if (member.kind === "custom") return write([{ r, texts: new Map([[member.key, held === undefined ? "" : held as string]]) }]);
            const blank = held === undefined || (editorOf(member).type === "text" && stringEqual(held as string, ""));
            return write([{ r, cells: new Map([[member.key, blank ? NULL_CELL : cellOfPayload(fromEastTypeValue(member.raw.payloadType) as EastType, held)]]) }]);
        }
        const f = byPath.get(pathKey(path));
        if (f === undefined) return undefined;
        const key = getSomeorUndefined(f.column);
        const name = path[0]!;
        if (key !== undefined) {
            const meta = inspect.columnAt(r, key);
            if (meta === undefined) return undefined;
            // A custom column reads its text with its own parse, as typing in its cell does.
            if (meta.kind === "custom") {
                const text = f.spec.optional ? getSomeorUndefined(next as option<string>) ?? "" : next as string;
                return write([{ r, texts: new Map([[key, text]]) }]);
            }
            // Emptied, a field is the blank cell, as typing nothing in the cell is.
            const held = f.spec.optional ? getSomeorUndefined(next as option<unknown>) : next;
            if (held === undefined || (f.spec.editor.type === "text" && stringEqual(held as string, ""))) return write([{ r, cells: new Map([[key, NULL_CELL]]) }]);
            // The cells a patch of the one field sets, through the column's projection.
            return write([{ r, cells: form.encode(encodePatch(patchOne(struct, name, next) as never)) }]);
        }
        // No column: the field on the draft — a nested field rebuilt under its struct, and a case's value under its
        // variant while it holds that case (#1549), from its type's default when the field has none yet.
        if (path.length === 1) return write([{ r, fields: new Map([[name, next]]) }]);
        const fieldType = (struct.fields as Record<string, EastType>)[name]!;
        const top = target.value?.[name] ?? defaultValue(fieldType);
        return write([{ r, fields: new Map([[name, setAt(top, path.slice(1), next)]]) }]);
    }, [byPath, inspect, r, struct, form, encodePatch, target.value, write, memberOf, editorOf]);

    // A link or set field: its halves as the grid draws them, and Edit in sheet (SB48) — a member's line's too.
    const renderControl = useCallback((spec: FieldSpecValue): ReactNode | undefined => {
        const f = byPath.get(pathKey(spec.path));
        const key = f !== undefined ? getSomeorUndefined(f.column) : spec.path.length === 1 && memberOf.has(spec.path[0]!) ? spec.path[0] : undefined;
        const meta = key === undefined ? undefined : inspect.columnAt(r, key);
        // An action field: its state, the cases its row is offered, and a choice's or a form's inline (#1478).
        if (key !== undefined && meta?.kind === "action") return inspect.drawAction(r, key);
        // A read-only field naming a register member says its label, as its cell does — never its key (F7 of the hand test).
        if (key !== undefined && meta !== undefined && spec.editor.type === "readonly" && namesMember(meta)) {
            return <Box css={styles.linkCell} data-inspector-member={key}>{inspect.drawCell(r, key)}</Box>;
        }
        if (key === undefined || meta === undefined || (meta.kind !== "link" && meta.kind !== "set")) return undefined;
        const shown = !hidden.has(key);
        return (
            <Box css={styles.link} data-inspector-link={key}>
                <Box css={styles.linkCell}>{inspect.drawCell(r, key)}</Box>
                <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} disabled={!shown}
                    title={shown ? undefined : m.inspectorHiddenColumn({ header: meta.header })} data-inspector-edit-in-sheet=""
                    onClick={() => { inspect.editInSheet(r, key); }}>
                    {m.inspectorAction({ action: "editInSheet", header: undefined, withLines: false })}
                </chakra.button>
            </Box>
        );
    }, [byPath, inspect, r, hidden, styles, button, m, memberOf]);

    return { specs, columns, options, formValue, baseline, onChange, renderControl, struct };
}

/** One issue of a target, as Details lists it. */
export interface TargetIssue {
    /** Its place among the batch's issues: the list's key. */
    key: string;
    /** The field it names, by its label — a member's cell of a column from data by its column's header — else its name; `undefined` for an issue of the whole row. */
    field: string | undefined;
    /** The field's name, as the form keys it; `undefined` for an issue of the whole row. */
    name: string | undefined;
    /** What is wrong, in the sheet's words. */
    text: string;
    /** A field still missing, or one refused; or a stored row's number outside its bounds, which warns (#1585). */
    kind: "incomplete" | "invalid" | "warning";
}

/**
 * A form's fields' words by their names, as an issue names a field: a field's own spec's label — a variant's, never
 * one of its cases' fields' (#1549) — else, under a nested struct's name, the last of its fields'; and a nested field —
 * a case's among them — by its path joined by ".", as a number its bounds don't hold is named (#1585).
 *
 * @param fields - The form's fields
 * @returns Each name and its words, as a `Map` takes them: a field's own after its nested fields', which it overrides
 */
function labelsOf(fields: readonly FormField[]): (readonly [string, string])[] {
    const own = (f: FormField) => f.spec.path.length === 1;
    return [...fields.filter((f) => !own(f)), ...fields.filter(own)].flatMap((f) => (own(f) ? [[f.spec.path[0]!, f.spec.label] as const]
        : [[f.spec.path[0]!, f.spec.label] as const, [f.spec.path.join("."), f.spec.label] as const]));
}

/**
 * A target's issues, by field: each its field's label — else the header of the column it names, as one of a column
 * from data's cells is named by its column key, which no form field holds — else its name, and its text in the sheet's
 * words.
 *
 * @param target - The row, line or band
 * @param inspect - The sheet's reads: the batch's issues, and the columns at the target's row
 * @param form - The target's form: its fields' labels
 * @param words - The sheet's words
 * @returns Its issues, in the batch's order
 */
export function targetIssues(target: SheetInspectTarget, inspect: SheetInspect, form: FormValue, words: SheetWords): TargetIssue[] {
    const labels = new Map(labelsOf(form.fields));
    const out: TargetIssue[] = [];
    inspect.issues.forEach((issue, i) => {
        if (!stringEqual(issue.entry, target.entry)) return;
        const row = getSomeorUndefined(issue.row);
        // A line's issues are addressed to its place in the group; a row's and a band's to none.
        if (target.index === undefined ? row !== undefined : row === undefined || Number(row) !== target.index) return;
        const field = getSomeorUndefined(issue.field);
        const label = field === undefined ? undefined : labels.get(field) ?? inspect.columnAt(target.r, field)?.header ?? field;
        out.push({ key: `${i}`, field: label, name: field, text: issueText(issue.message, words), kind: inspect.kindOf(issue) });
    });
    return out;
}

/**
 * The author's own Details for a complete row (SB58): what their function returns for the row as bytes, its edit
 * written back as one transaction — every field its columns write through them at once, a field with none on the
 * draft. `undefined` for a band, for a row still missing a field or holding one unreadable, for a pane with no Details
 * of the author's, and where their function fails: the form shows there. A host's Details draws them too (#1534).
 *
 * @param input - The payload, the pane, the sheet's reads and writes, the target, its form and the form's struct
 * @returns What the author's function returns, drawn in the form's place
 */
export function useAuthorDetails({ value, pane, inspect, target, form, struct }: {
    value: SheetInspectorValue; pane: PaneValue; inspect: SheetInspect; target: SheetInspectTarget; form: FormValue; struct: StructType;
}): AuthorDetails | undefined {
    const band = target.kind === "band";
    const idField = getSomeorUndefined(value.sheet.editing.idField);
    const author = getSomeorUndefined(pane.custom);
    const codec = useMemo(() => ({ encode: encodeBeast2For(struct), decode: decodeBeast2For(struct), patch: encodeBeast2For(Sheet.Types.Patch(struct)) }), [struct]);
    const equals = useMemo(() => new Map(Object.entries(struct.fields as Record<string, EastType>).map(([k, t]) => [k, equalFor(t)])), [struct]);
    const rowEqual = useMemo(() => {
        const equal = equalFor(struct);
        return (a: unknown, b: unknown) => (a === undefined || b === undefined ? a === b : equal(a as never, b as never));
    }, [struct]);
    // The row held by its data: a gesture elsewhere never calls the author's function again.
    const complete = useDataStable(target.complete, rowEqual);
    const update = useCallback((bytes: Uint8Array): null => {
        if (complete === undefined) return null;
        const edited = codec.decode(bytes) as Record<string, unknown>;
        const before = complete as Record<string, unknown>;
        const columns = new Set(form.columns);
        const readonly = new Set(form.readonly);
        const fields = new Map<string, unknown>();
        let throughColumns = false;
        for (const [name, same] of equals) {
            // Its identity is the header's, and a read-only column's field the grid's: neither changes here.
            if ((idField !== undefined && stringEqual(name, idField)) || readonly.has(name) || same(edited[name], before[name])) continue;
            if (columns.has(name)) throughColumns = true;
            else fields.set(name, edited[name]);
        }
        // Every field its columns write, through them at once — a link's two halves one cell; a cell that holds its value already writes nothing.
        const cells = throughColumns
            ? form.encode(codec.patch(Object.fromEntries([...equals.keys()].map((name) => [name, columns.has(name) ? some(edited[name]) : none])) as never))
            : undefined;
        const write: SheetInspectWrite = { r: target.r, cells, fields };
        inspect.write([write]);
        return null;
    }, [complete, codec, equals, form, idField, inspect, target.r]);
    return useMemo(() => {
        if (band || author === undefined || complete === undefined) return undefined;
        try {
            return author(codec.encode(complete as Record<string, unknown>), update);
        } catch (err) {
            console.error("[Sheet] the inspector failed; the form shows instead:", err);
            return undefined;
        }
    }, [band, author, complete, codec, update]);
}

/** One row, line or band: its head, its issues, its fields, its sub rows and its gestures (SB47, SB49). */
function TargetView(props: TargetProps) {
    const { value, keys, words, styles, inspect, target, form, noun } = props;
    const { m } = words;
    const button = useRecipe({ key: "button" });
    const edit = useTargetForm(props);
    const band = target.kind === "band";
    const issues = targetIssues(target, inspect, form, words);
    const isNew = target.baseline === undefined && target.value !== undefined;
    const idField = getSomeorUndefined(value.sheet.editing.idField);
    // Its id: a line's own where it has one (beside loose rows), else its entry's.
    const ownId = target.kind === "line" && idField !== undefined ? target.value?.[idField] : undefined;
    // The author's own Details for a complete row (SB58): its row as bytes, its edit back as one transaction.
    const own = useAuthorDetails({ value, pane: props.pane, inspect, target, form, struct: edit.struct });

    const subRows = target.subRows;
    const can = inspect.can;
    // A sheet that takes edits keeps its chip's row while there is none (#1584): the first edit's chip moves nothing.
    const writes = !(getSomeorUndefined(value.sheet.readOnly) ?? false) && value.sheet.editing.onApply.type === "some";
    // In a phone's drawer (SH12): its head, each field a section of its own at touch size, and its gestures at 44.
    const phone = useContext(FrameDrawer);
    if (phone && own === undefined && target.value !== undefined) {
        return <PhoneTarget {...props} edit={edit} issues={issues} isNew={isNew} ownId={ownId as string | undefined} writes={writes} />;
    }
    return (
        <Box css={styles.root} data-sheet-inspector={target.kind}>
            <Box css={styles.head}>
                <Box css={styles.eyebrow} data-inspector-what="">{whatOf(target, words, noun)}</Box>
                <Box css={styles.name} data-inspector-id="">{ownId !== undefined ? ownId as string : target.entry}</Box>
                <Box css={styles.marks} data-writes={writes ? "" : undefined}>
                    {isNew ? <Box as="span" css={styles.chip} data-state="new">{m.inspectorChip({ state: "new" })}</Box>
                        : target.presentation.pending ? <Box as="span" css={styles.chip} data-state="pending">{m.inspectorChip({ state: "pending" })}</Box>
                            : null}
                    {target.owned && (
                        <Box as="span" css={styles.lock} role="img" aria-label={m.inspectorOwned()} title={m.inspectorOwned()} data-inspector-lock="">
                            <FontAwesomeIcon icon={faLock} />
                        </Box>
                    )}
                    {band && target.group !== undefined && (
                        <Box as="span" css={styles.lock} data-inspector-lines="">
                            {m.inspectorSection({ section: "lines", n: target.group.lines, count: words.number(target.group.lines) })}
                        </Box>
                    )}
                </Box>
            </Box>
            {issues.length > 0 && (
                <Box css={styles.issues} data-inspector-issues="">
                    <Box css={styles.sectionHead}>{m.inspectorSection({ section: "issues", n: issues.length, count: words.number(issues.length) })}</Box>
                    {issues.map((issue) => (
                        <Box key={issue.key} css={styles.issue}>
                            {issue.field !== undefined && <Box as="span" css={styles.issueField}>{issue.field}</Box>}
                            <Box as="span" css={styles.issueText} data-kind={issue.kind}>{issue.text}</Box>
                        </Box>
                    ))}
                </Box>
            )}
            <Box css={styles.fields} data-inspector-fields={own !== undefined ? "custom" : "form"}>
                {target.value === undefined
                    ? <Box css={styles.emptyHint}>{m.inspectorReading()}</Box>
                    : own !== undefined
                        ? <EastChakraComponent value={own} storageKey={`${keys.frame}.inspector`} />
                        : <FieldForm specs={edit.specs} value={edit.formValue} baseline={edit.baseline} options={edit.options}
                            onChange={edit.onChange} takesUnset readOnly={!inspect.writable} renderControl={edit.renderControl} />}
            </Box>
            {subRows.length > 0 && (
                <Box css={styles.subRows} data-inspector-sub-rows="">
                    <Box css={styles.sectionHead}>{m.inspectorSection({ section: "subRows", n: subRows.length, count: words.number(subRows.length) })}</Box>
                    {subRows.map((sub, i) => (
                        <Box key={`${sub.id}\u001f${i}`} css={styles.subRow} data-inspector-sub-row="">
                            {sub.code !== "" && <Box as="span" css={styles.subRowCode}>{sub.code}</Box>}
                            <Box as="span" css={styles.subRowName}>{sub.name}</Box>
                            {(sub.chips.length > 0 || sub.facets.length > 0) && (
                                <Box as="span" css={styles.subRowFacts}>
                                    {[...sub.chips, ...sub.facets.map((facet) => `${facet.label} ${facet.value}`)].join(" · ")}
                                </Box>
                            )}
                        </Box>
                    ))}
                </Box>
            )}
            <Box css={styles.actions} data-inspector-actions="">
                {band && (
                    <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} disabled={!can.insertRows}
                        data-inspector-action="addLine" onClick={() => inspect.addLine(target.r)}>
                        {m.inspectorAction({ action: "addLine", header: undefined, withLines: false })}
                    </chakra.button>
                )}
                <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} disabled={band ? !can.insertGroups : !can.insertRows}
                    data-inspector-action="duplicate" onClick={() => inspect.duplicate([target.r])}>
                    {m.inspectorAction({ action: "duplicate", header: undefined, withLines: band })}
                </chakra.button>
                <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} disabled={band ? !can.removeGroups : !can.removeRows}
                    data-inspector-action="delete" onClick={() => { if (band) inspect.removeGroup(target.r); else inspect.remove(target.r, target.r); }}>
                    {m.inspectorAction({ action: "delete", header: undefined, withLines: band })}
                </chakra.button>
            </Box>
        </Box>
    );
}

/** Props of {@link PhoneTarget}. */
interface PhoneTargetProps extends TargetProps {
    edit: ReturnType<typeof useTargetForm>;
    issues: TargetIssue[];
    isNew: boolean;
    ownId: string | undefined;
    /** Whether the sheet takes edits: its head keeps its chip's row. */
    writes: boolean;
}

/**
 * One row, line or band in a phone's drawer (`Mobile Sheet Spec.md` SH12, the
 * designer's `WorkOrdersPhone`): its head — the eyebrow naming its line, its
 * action's name and its entry, then its title (the action column's, else its
 * id) and a draft's chip — its issues, each field it edits a section of its
 * own (its label over its name, then its control: a number's stepper and a
 * time's field as the cell editor draws them, an action's state and cases, and
 * every other kind its form's own input at touch size), its sub rows, and its
 * gestures as Default 44 buttons.
 */
function PhoneTarget({ value, words, hidden, styles, inspect, target, form, noun, edit, issues, isNew, ownId, writes }: PhoneTargetProps) {
    const { m } = words;
    const button = useRecipe({ key: "button" });
    const bar = useSlotStyles("sheetAction");
    const r = target.r;
    const band = target.kind === "band";
    const byPath = useMemo(() => new Map(form.fields.map((f) => [pathKey(f.spec.path), f])), [form.fields]);
    // Its action column's name and title — `step 20`, `Weld frame` — as the grid's action cell reads them.
    const action = form.fields.map((f) => getSomeorUndefined(f.column)).map((key) => (key === undefined ? undefined : actionColumnOf(inspect.columnAt(r, key))))
        .find((c) => c !== undefined);
    const ruleText = (key: string | undefined): string | undefined => {
        const cell = key === undefined ? undefined : inspect.cellAt(r, key);
        return cell?.type === "String" && cell.value !== "" ? cell.value : undefined;
    };
    const actionName = ruleText(action?.name);
    const title = ruleText(action?.title);
    const id = ownId ?? target.entry;
    const where = m.inspectorPhoneWhat({ what: target.kind, number: words.number(target.number), noun });
    const eyebrow = [where, actionName, stringEqual(id, title ?? "") ? undefined : id].filter((t): t is string => t !== undefined && t !== "").join(" · ");
    const chip = isNew ? "new" : target.presentation.pending ? "pending" : undefined;
    // The fields it edits: every field but those the grid alone shows — an action's, which its cases write, among them.
    const specs = useMemo(() => edit.specs.filter((spec) => {
        if (spec.editor.type !== "readonly") return true;
        const key = getSomeorUndefined(byPath.get(pathKey(spec.path))?.column ?? none);
        return key !== undefined && inspect.columnAt(r, key)?.kind === "action";
    }), [edit.specs, byPath, inspect, r]);
    // Each field a section of its own: a variant's with the fields of its cases, which its form draws in a block under
    // its choice (#1549) — the fields after it at paths through it.
    const sections = useMemo(() => {
        const out: FieldSpecValue[][] = [];
        for (const spec of specs) {
            const head = out[out.length - 1]?.[0];
            if (head !== undefined && spec.path.length > head.path.length && pathEqual(spec.path.slice(0, head.path.length), head.path)) out[out.length - 1]!.push(spec);
            else out.push([spec]);
        }
        return out;
    }, [specs]);
    const can = inspect.can;
    return (
        <Box css={styles.root} data-sheet-inspector={target.kind} data-phone="">
            <Box css={styles.phoneHead} data-writes={writes ? "" : undefined}>
                <Box as="span" css={styles.phoneEyebrow} data-inspector-what="">{eyebrow}</Box>
                <Box as="span" css={styles.phoneName} data-inspector-id="">{title ?? id}</Box>
                {chip !== undefined && <Box as="span" css={styles.phoneChip} data-state={chip}>{m.inspectorChip({ state: chip })}</Box>}
                {target.owned && (
                    <Box as="span" css={styles.lock} data-inspector-lock=""><FontAwesomeIcon icon={faLock} aria-hidden />{m.inspectorOwned()}</Box>
                )}
            </Box>
            {issues.length > 0 && (
                <Box css={styles.issues} data-inspector-issues="">
                    <Box css={styles.sectionHead}>{m.inspectorSection({ section: "issues", n: issues.length, count: words.number(issues.length) })}</Box>
                    {issues.map((issue) => (
                        <Box key={issue.key} css={styles.issue}>
                            {issue.field !== undefined && <Box as="span" css={styles.issueField}>{issue.field}</Box>}
                            <Box as="span" css={styles.issueText} data-kind={issue.kind}>{issue.text}</Box>
                        </Box>
                    ))}
                </Box>
            )}
            <Box data-inspector-fields="phone">
                {sections.map((section) => {
                    const spec = section[0]!;
                    const f = byPath.get(pathKey(spec.path));
                    const key = f === undefined ? undefined : getSomeorUndefined(f.column);
                    return <PhoneField key={pathKey(spec.path)} words={words} hidden={hidden} styles={styles} bar={bar} inspect={inspect} r={r} columnKey={key} spec={spec} section={section} edit={edit} value={value} />;
                })}
            </Box>
            {target.subRows.length > 0 && (
                <Box css={styles.subRows} data-inspector-sub-rows="">
                    <Box css={styles.sectionHead}>{m.inspectorSection({ section: "subRows", n: target.subRows.length, count: words.number(target.subRows.length) })}</Box>
                    {target.subRows.map((sub, i) => (
                        <Box key={`${sub.id}\u001f${i}`} css={styles.subRow} data-inspector-sub-row="">
                            {sub.code !== "" && <Box as="span" css={styles.subRowCode}>{sub.code}</Box>}
                            <Box as="span" css={styles.subRowName}>{sub.name}</Box>
                        </Box>
                    ))}
                </Box>
            )}
            <Box css={styles.phoneActions} data-inspector-actions="">
                {band && (
                    <chakra.button type="button" css={[button({ variant: "outline", size: "md" }), styles.phoneButton]} disabled={!can.insertRows}
                        data-inspector-action="addLine" onClick={() => inspect.addLine(r)}>
                        {m.inspectorAction({ action: "addLine", header: undefined, withLines: false })}
                    </chakra.button>
                )}
                <chakra.button type="button" css={[button({ variant: "outline", size: "md" }), styles.phoneButton]} disabled={band ? !can.insertGroups : !can.insertRows}
                    data-inspector-action="duplicate" onClick={() => inspect.duplicate([r])}>
                    {m.inspectorAction({ action: "duplicate", header: undefined, withLines: band })}
                </chakra.button>
                <chakra.button type="button" css={[button({ variant: "outline", size: "md" }), styles.phoneButton]} disabled={band ? !can.removeGroups : !can.removeRows}
                    data-inspector-action="delete" onClick={() => { if (band) inspect.removeGroup(r); else inspect.remove(r, r); }}>
                    {m.inspectorAction({ action: "delete", header: undefined, withLines: band })}
                </chakra.button>
            </Box>
        </Box>
    );
}

/** Props of {@link PhoneField}. */
interface PhoneFieldProps {
    value: SheetInspectorValue;
    words: SheetWords;
    hidden: ReadonlySet<string>;
    styles: Styles;
    bar: Styles;
    inspect: SheetInspect;
    r: number;
    columnKey: string | undefined;
    spec: FieldSpecValue;
    /** The field's specs: its own, then — a variant's — the fields of its cases, drawn in its block (#1549). */
    section: readonly FieldSpecValue[];
    edit: ReturnType<typeof useTargetForm>;
}

/** One field of a phone's Details (SH12): a section of its own, its label over its name, then its control at touch size. */
function PhoneField({ words, styles, bar, inspect, r, columnKey, spec, section, edit }: PhoneFieldProps) {
    const dirty = useDirty(spec, edit.formValue, edit.baseline);
    const meta = columnKey === undefined ? undefined : inspect.columnAt(r, columnKey);
    const header = meta?.header ?? spec.label;
    const touch = columnKey === undefined ? undefined : touchKind(inspect, r, columnKey, spec);
    return (
        <Box css={styles.phoneField} data-inspector-field={pathKey(spec.path)}>
            <Box css={styles.phoneFieldHead}>
                <Box as="span" css={styles.phoneLabel}>
                    {spec.label}
                    {/* An action's state stands where its name would, at the row's end. */}
                    {meta?.kind !== "action" && <Box as="span" css={styles.phoneKey}>{spec.path.join(".")}</Box>}
                </Box>
            </Box>
            {columnKey !== undefined && meta?.kind === "action"
                ? inspect.drawAction(r, columnKey)
                : columnKey !== undefined && touch !== undefined
                    ? <TouchControl inspect={inspect} words={words} bar={bar} r={r} columnKey={columnKey} spec={spec} header={header} dirty={dirty} joins={undefined} />
                    : <FieldForm specs={section} value={edit.formValue} baseline={edit.baseline} options={edit.options}
                        onChange={edit.onChange} takesUnset readOnly={!inspect.writable} renderControl={edit.renderControl} />}
        </Box>
    );
}

// ============================================================================
// A phone's cell editor (`Mobile Sheet Spec.md` SH10, R9, R10)
// ============================================================================

/** The runs of a phone's cell editor: each editor opened is one, its edits one step of the history (SH10.1). */
let cellEditorRuns = 0;

const printInteger = printFor(IntegerType);
const printFloat = printFor(FloatType);
const compareIntegers = compareFor(IntegerType);
const compareFloats = compareFor(FloatType);

/**
 * A phone's cell editor for a sheet given an inspector (SH10, R9): what the
 * Sheet's bottom container shows for the ring's cell — the pane's form at
 * touch size, the field the cell's column writes — or `undefined` where the
 * sheet has no inspector, or its form no field for that column, and the
 * docked strip shows.
 *
 * @param value - The payload: its inspector's forms
 * @param words - The sheet's words
 * @param hidden - The columns this viewer hides
 * @returns The editor for a cell, as `SheetHost.cellEditor` takes it
 */
export function sheetCellEditor(value: SheetInspectorValue, words: SheetWords, hidden: ReadonlySet<string>): (at: SheetCellEditorAt) => ReactNode | undefined {
    const pane = getSomeorUndefined(value.inspector);
    const noun = nounOf(value, words);
    return (at) => {
        if (pane === undefined) return undefined;
        const form = at.band ? getSomeorUndefined(pane.forms.group) : pane.forms.row;
        const field = form?.fields.find((f) => { const key = getSomeorUndefined(f.column); return key !== undefined && stringEqual(key, at.columnKey); });
        if (form === undefined || field === undefined || field.spec.editor.type === "readonly") return undefined;
        // Its row's by its id, never its place: the rows moving under it — a window landing above, another session's
        // row — never draw it afresh, and what is typed in it stays.
        return <SheetCellEditor key={`${at.id}\u001f${at.columnKey}`} value={value} words={words} hidden={hidden} at={at} form={form} field={field} noun={noun} />;
    };
}

/** Props of {@link SheetCellEditor}. */
interface CellEditorProps {
    value: SheetInspectorValue;
    words: SheetWords;
    hidden: ReadonlySet<string>;
    at: SheetCellEditorAt;
    form: FormValue;
    field: FormField;
    noun: string;
}

/**
 * A phone's cell editor (SH10): in the bottom container, under its head — the
 * eyebrow naming the column and the row, and ⌄ close — the field the cell's
 * column writes. A number is − · the field · its unit · + (digits only), a
 * time of day its `hh:mm` field, filled as digits are typed, and Clear; every
 * other kind its form's own input at touch size (R9). Its edits while it stays
 * open are one step of the history (SH10.1), each written as the inspector
 * writes it.
 */
function SheetCellEditor({ value, words, hidden, at, form, field, noun }: CellEditorProps) {
    const inspect = useSheetInspect();
    const styles = useSlotRecipe({ key: "sheetInspector" })() as Styles;
    const bar = useSlotStyles("sheetAction");
    const { m } = words;
    const targetAt = inspect.targetAt;
    const target = useMemo(() => targetAt(at.r), [targetAt, at.r]);
    const meta = inspect.columnAt(at.r, at.columnKey);
    const header = meta?.header ?? field.spec.label;
    const head = (
        <chakra.div css={bar.barHead}>
            <chakra.span css={bar.barEyebrow} data-cell-editor-eyebrow="">
                {target === undefined && at.name === undefined ? header : m.cellEditorEyebrow({ header, what: at.name ?? whatOf(target!, words, noun) })}
            </chakra.span>
            <chakra.button type="button" css={bar.barClose} aria-label={m.cellEditorClose()} data-cell-editor-close="" onClick={at.onClose}>
                <FontAwesomeIcon icon={faChevronDown} aria-hidden />
            </chakra.button>
        </chakra.div>
    );
    return (
        <chakra.div css={bar.bar} data-sheet-cell-editor={at.columnKey} role="group" aria-label={header}>
            {head}
            {target === undefined || target.value === undefined
                ? <chakra.span css={bar.cellHelp}>{m.inspectorReading()}</chakra.span>
                : <CellEditorField value={value} words={words} hidden={hidden} styles={styles} bar={bar} inspect={inspect} target={target} form={form} field={field} at={at} header={header} />}
        </chakra.div>
    );
}

/** Props of {@link CellEditorField}. */
interface CellEditorFieldProps {
    value: SheetInspectorValue;
    words: SheetWords;
    hidden: ReadonlySet<string>;
    styles: Styles;
    bar: Styles;
    inspect: SheetInspect;
    target: SheetInspectTarget;
    form: FormValue;
    field: FormField;
    at: SheetCellEditorAt;
    header: string;
}

/** The field a phone's cell editor holds — see {@link SheetCellEditor}. */
function CellEditorField({ value, words, hidden, styles, bar, inspect, target, form, field, at, header }: CellEditorFieldProps) {
    // One run while the editor is open: its edits are one step (SH10.1).
    const [joins] = useState(() => `cellEditor:${++cellEditorRuns}`);
    const edit = useTargetForm({ value, words, hidden, styles, inspect, target, form, joins });
    const spec = edit.specs.find((s) => stringEqual(pathKey(s.path), pathKey(field.spec.path))) ?? field.spec;
    const specs = useMemo(() => [spec], [spec]);
    const writable = inspect.writable;
    const dirty = useDirty(spec, edit.formValue, edit.baseline);
    if (touchKind(inspect, at.r, at.columnKey, spec) !== undefined) {
        return <TouchControl inspect={inspect} words={words} bar={bar} r={at.r} columnKey={at.columnKey} spec={spec} header={header} dirty={dirty} joins={joins} />;
    }
    // Every other kind (R9): the form's own input, at touch size.
    return (
        <chakra.div css={bar.cellForm} data-cell-form="">
            <FieldForm specs={specs} value={edit.formValue} baseline={edit.baseline} options={edit.options}
                onChange={edit.onChange} readOnly={!writable} renderControl={edit.renderControl} live />
        </chakra.div>
    );
}

/** Whether a field's value as the drafts hold it differs from what the record holds: the field tinted. */
function useDirty(spec: FieldSpecValue, formValue: Record<string, unknown>, baseline: Record<string, unknown>): boolean {
    const fieldType = useMemo(() => fromEastTypeValue(spec.type) as EastType, [spec.type]);
    const same = useMemo(() => equalFor(fieldType), [fieldType]);
    const name = spec.path[0]!;
    const now = formValue[name];
    const was = baseline[name];
    return now === undefined || was === undefined ? now !== was : !same(now as never, was as never);
}

/** Which touch control a field takes at a row (SH10): a number's stepper, a time of day's field, or none. */
function touchKind(inspect: SheetInspect, r: number, columnKey: string, spec: FieldSpecValue): "number" | "time" | undefined {
    const meta = inspect.columnAt(r, columnKey);
    if ((meta?.kind === "integer" || meta?.kind === "quantity") && spec.editor.type === "number") return "number";
    if (meta?.kind === "date" && inspect.levelAt(r, columnKey) === "time") return "time";
    return undefined;
}

/** Props of {@link TouchControl}. */
interface TouchControlProps {
    inspect: SheetInspect;
    words: SheetWords;
    bar: Styles;
    r: number;
    columnKey: string;
    spec: FieldSpecValue;
    header: string;
    dirty: boolean;
    /** The key a run of edits joins under as one step, if it is one (SH10.1). */
    joins: string | undefined;
}

/**
 * A field's touch control, as a phone's cell editor and a phone's Details draw
 * it (SH10, SH12): a number − · the field · its unit · + (digits only), and
 * under it, a value its bounds don't hold in its hint's own words (#1585); a
 * time of day its `hh:mm` field, filled as digits are typed, and Clear — or
 * `null` for every other kind, which its form's own input edits.
 */
function TouchControl({ inspect, words, bar, r, columnKey, spec, header, dirty, joins }: TouchControlProps) {
    const { m } = words;
    const kind = touchKind(inspect, r, columnKey, spec);
    const cell = inspect.cellAt(r, columnKey);
    const writable = inspect.writable;
    const fieldType = useMemo(() => fromEastTypeValue(spec.type) as EastType, [spec.type]);
    const writeCell = useCallback((next: SheetCellValue) => inspect.write([{ r, cells: new Map([[columnKey, next]]) }], joins), [inspect, r, columnKey, joins]);
    const writeText = useCallback((text: string) => inspect.write([{ r, texts: new Map([[columnKey, text]]) }], joins), [inspect, r, columnKey, joins]);
    // A number (SH10): − · the field · its unit · +, digits only, held to its editor's bounds.
    if (kind === "number" && spec.editor.type === "number") {
        const number = spec.editor.value;
        // An Option's input edits its value's type, as the form's does.
        const inner = spec.optional && fieldType.type === "Variant" ? (fieldType.cases as Record<string, EastType>)["some"]! : fieldType;
        const integer = isTypeEqual(inner, IntegerType);
        const held = cell?.type === "Integer" || cell?.type === "Float" ? cell.value : undefined;
        const unit = getSomeorUndefined(number.unit) ?? inspect.unitAt(r, columnKey);
        const min = getSomeorUndefined(number.min);
        const max = getSomeorUndefined(number.max);
        const step = getSomeorUndefined(number.step) ?? 1;
        const stepBy = (more: boolean) => {
            if (integer) {
                const by = BigInt(Math.max(1, Math.round(step)));
                let n = ((held as bigint | undefined) ?? 0n) + (more ? by : -by);
                if (min !== undefined && compareIntegers(n, BigInt(Math.ceil(min))) < 0) n = BigInt(Math.ceil(min));
                if (max !== undefined && compareIntegers(n, BigInt(Math.floor(max))) > 0) n = BigInt(Math.floor(max));
                writeCell(variant("Integer", n));
                return;
            }
            let f = ((held as number | undefined) ?? 0) + (more ? step : -step);
            if (min !== undefined && compareFloats(f, min) < 0) f = min;
            if (max !== undefined && compareFloats(f, max) > 0) f = max;
            writeCell(variant("Float", f));
        };
        const printed = held === undefined ? "" : integer ? printInteger(held as bigint) : printFloat(held as number);
        // Its help, and its bounds as the form words them (`Min 0`).
        const bounds = min === undefined && max === undefined ? undefined : fieldFormMessages.numberHelp({
            min: min === undefined ? undefined : words.number(min), max: max === undefined ? undefined : words.number(max), unit: undefined, step: undefined,
        });
        const help = [bounds, getSomeorUndefined(spec.help)].filter((part): part is string => part !== undefined && part !== "");
        // A value its bounds don't hold, said under it in its hint's own words, as Details says it (#1585).
        const breach = held === undefined ? undefined
            : fieldBreaches([spec], spec.path.reduceRight<unknown>((inner, name) => ({ [name]: inner }), spec.optional ? some(held) : held))[0];
        return (
            <>
                <chakra.div css={bar.cellLine}>
                    <chakra.button type="button" css={bar.cellStep} aria-label={m.cellEditorStep({ header, more: false })} disabled={!writable} data-cell-step="fewer" onClick={() => stepBy(false)}>
                        <FontAwesomeIcon icon={faMinus} aria-hidden />
                    </chakra.button>
                    <TypedInput css={bar.cellInput} printed={printed} dirty={dirty} label={header} disabled={!writable} inputMode={integer ? "numeric" : "decimal"}
                        accept={(typed) => (integer ? typed.replace(/[^\d-]/g, "") : typed.replace(/[^\d.,-]/g, ""))} onTyped={writeText} />
                    {unit !== undefined && <chakra.span css={bar.cellUnit} data-cell-unit="">{unit}</chakra.span>}
                    <chakra.button type="button" css={bar.cellStep} aria-label={m.cellEditorStep({ header, more: true })} disabled={!writable} data-cell-step="more" onClick={() => stepBy(true)}>
                        <FontAwesomeIcon icon={faPlus} aria-hidden />
                    </chakra.button>
                </chakra.div>
                {help.length > 0 && <chakra.span css={bar.cellHelp} data-cell-help="">{help.join(" · ")}</chakra.span>}
                {breach !== undefined && <chakra.span css={bar.cellError} data-cell-error="">{fieldBreachText(breach, { ...words, m: fieldFormMessages })}</chakra.span>}
            </>
        );
    }
    // A time of day (SH10): its `hh:mm`, filled as digits are typed, on the day the cell holds — today, where it holds none — and Clear.
    if (kind === "time") {
        const held = cell?.type === "DateTime" ? cell.value : undefined;
        const printed = held === undefined ? "" : formatTime(held);
        const fill = (typed: string): string => {
            const digits = typed.replace(/\D/g, "").slice(0, 4);
            return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
        };
        const onTyped = (text: string) => {
            const split = splitTimeToken(text);
            if (text.length === 5 && split.time !== undefined) writeCell(variant("DateTime", withTime(held ?? todayUtc(), split.time.hh, split.time.mm)));
        };
        return (
            <>
                <chakra.div css={bar.cellLine}>
                    <TypedInput css={bar.cellInput} printed={printed} dirty={dirty} label={header} disabled={!writable} inputMode="numeric"
                        placeholder={m.editorTimePlaceholder()} accept={fill} onTyped={onTyped} />
                    <chakra.button type="button" css={bar.cellClear} disabled={!writable || held === undefined} data-cell-clear="" onClick={() => writeCell(NULL_CELL)}>
                        {m.cellEditorClear()}
                    </chakra.button>
                </chakra.div>
                <chakra.span css={bar.cellHelp} data-cell-help="">{m.cellEditorTimeHelp()}</chakra.span>
            </>
        );
    }
    return null;
}

/** Props of {@link TypedInput}. */
interface TypedInputProps {
    css: SystemStyleObject | undefined;
    /** The cell's value as the field shows it, while it is not being typed into. */
    printed: string;
    dirty: boolean;
    label: string;
    disabled: boolean;
    inputMode: "numeric" | "decimal";
    placeholder?: string | undefined;
    /** What the field holds of what was typed: the characters it takes, in its form. */
    accept: (typed: string) => string;
    /** Told what the field holds after each keystroke. */
    onTyped: (text: string) => void;
}

/** A phone's cell editor's field: what is typed into it stands while it is typed, and the cell's value otherwise. */
function TypedInput({ css, printed, dirty, label, disabled, inputMode, placeholder, accept, onTyped }: TypedInputProps) {
    const [typed, setTyped] = useState<string | undefined>(undefined);
    return (
        <chakra.input css={css} value={typed ?? printed} aria-label={label} disabled={disabled} inputMode={inputMode} placeholder={placeholder}
            data-dirty={dirty ? "" : undefined} data-cell-input=""
            onChange={(e) => { const next = accept(e.currentTarget.value); setTyped(next); onTyped(next); }}
            onBlur={() => setTyped(undefined)} />
    );
}

// ============================================================================
// Several rows (SB50)
// ============================================================================

/** Props of {@link SeveralRows}. */
interface SeveralProps extends DetailsProps {
    styles: Styles;
    inspect: SheetInspect;
    rs: readonly number[];
    r0: number;
    r1: number;
}

/** Several rows: their count, a column set or cleared across them, Duplicate and Delete — each one transaction. */
function SeveralRows({ value, pane, words, styles, inspect, rs, r0, r1 }: SeveralProps) {
    const { m } = words;
    const button = useRecipe({ key: "button" });
    const form = pane.forms.row;
    const lines = getSomeorUndefined(value.sheet.group) !== undefined;
    // The columns a bulk edit sets: the editable ones the form edits — never a stamped, a link or a set column, which the grid
    // edits — and of those only one a cell of the rows takes: a column every row's mark locks is no input at all.
    const editable = useMemo(() => form.fields.filter((f) => {
        const key = getSomeorUndefined(f.column);
        if (key === undefined) return false;
        const meta = inspect.columnAt(rs[0]!, key);
        return meta !== undefined && meta.editable && meta.kind !== "stamped" && meta.kind !== "link" && meta.kind !== "set" && f.spec.editor.type !== "readonly"
            && rs.some((r) => inspect.writableAt(r, key));
    }), [form.fields, inspect, rs]);
    const [column, setColumn] = useState<string | undefined>(undefined);
    const [held, setHeld] = useState<unknown>(undefined);
    const chosen = editable.find((f) => column !== undefined && stringEqual(getSomeorUndefined(f.column) ?? "", column)) ?? editable[0];
    const chosenKey = chosen === undefined ? undefined : getSomeorUndefined(chosen.column);
    const chosenMeta = chosenKey === undefined ? undefined : inspect.columnAt(rs[0]!, chosenKey);
    const struct = useMemo(() => fromEastTypeValue(form.type) as StructType, [form.type]);
    const encodePatch = useMemo(() => encodeBeast2For(Sheet.Types.Patch(struct)), [struct]);
    const registers = useMemo(() => indexRegisters(value.sheet.registers), [value.sheet.registers]);
    // The column choice: a select of the columns, as FieldForm draws a variant's cases.
    const pickSpec = useMemo((): FieldSpecValue | undefined => {
        if (editable.length === 0) return undefined;
        const cases = Object.fromEntries(editable.map((f) => [getSomeorUndefined(f.column)!, NullType]));
        return {
            path: [PICK], label: m.inspectorBulk({ part: "pick" }), help: none, group: none,
            type: toEastTypeValue(VariantType(cases)), optional: false,
            editor: variant("select", editable.map((f) => ({ case: getSomeorUndefined(f.column)!, label: f.spec.label }))),
        };
    }, [editable, m]);
    // The value to set: the chosen column's field — a select over its register's every member, as no one row narrows them.
    const valueSpec = useMemo((): FieldSpecValue | undefined => {
        if (chosen === undefined) return undefined;
        const spec = { ...chosen.spec, help: some(m.inspectorBulk({ part: "hint" })) };
        return chosen.spec.editor.type === "reference" ? { ...spec, editor: variant("reference", { of: pathKey(chosen.spec.path) }) } : spec;
    }, [chosen, m]);
    const specs = useMemo(() => (pickSpec === undefined || valueSpec === undefined ? [] : [pickSpec, valueSpec]), [pickSpec, valueSpec]);
    const options = useMemo(() => {
        if (chosen === undefined || chosen.spec.editor.type !== "reference") return undefined;
        const members = registers.byName.get(chosen.spec.editor.value.of) ?? [];
        return { [pathKey(chosen.spec.path)]: members.map((member): FieldOption => ({ key: member.key, label: member.label })) };
    }, [chosen, registers]);
    const formValue = useMemo(() => (chosen === undefined || chosenKey === undefined ? {} : { [PICK]: variant(chosenKey, null), [chosen.spec.path[0]!]: held }), [chosen, chosenKey, held]);
    const writeAcross = useCallback((write: (r: number) => SheetInspectWrite) => { inspect.write(rs.map(write)); }, [inspect, rs]);
    const onChange = useCallback((path: readonly string[], next: unknown) => {
        if (stringEqual(path[0]!, PICK)) { setColumn((next as ValueTypeOf<VariantType>).type as string); setHeld(undefined); return; }
        if (chosen === undefined || chosenKey === undefined || chosenMeta === undefined) return;
        setHeld(next);
        const name = chosen.spec.path[0]!;
        const set = chosen.spec.optional ? getSomeorUndefined(next as option<unknown>) : next;
        // A custom column's text, read on each row by its own parse.
        if (chosenMeta.kind === "custom") {
            const text = set === undefined ? "" : set as string;
            writeAcross((r) => ({ r, texts: new Map([[chosenKey, text]]) }));
            return;
        }
        if (set === undefined || (chosen.spec.editor.type === "text" && stringEqual(set as string, ""))) {
            writeAcross((r) => ({ r, cells: new Map([[chosenKey, NULL_CELL]]) }));
            return;
        }
        const cells = form.encode(encodePatch(patchOne(struct, name, next) as never));
        writeAcross((r) => ({ r, cells }));
    }, [chosen, chosenKey, chosenMeta, struct, form, encodePatch, writeAcross]);
    const can = inspect.can;
    return (
        <Box css={styles.root} data-sheet-inspector="several">
            <Box css={styles.head}>
                <Box css={styles.summary} data-inspector-several="">{m.inspectorSeveral({ n: rs.length, count: words.number(rs.length), lines })}</Box>
            </Box>
            {chosen !== undefined && chosenKey !== undefined && (
                <Box css={styles.bulk} data-inspector-bulk="">
                    <Box css={styles.sectionHead}>{m.inspectorBulk({ part: "column" })}</Box>
                    <FieldForm specs={specs} value={formValue} options={options} onChange={onChange} takesUnset readOnly={!inspect.writable} />
                    <Box css={styles.marks}>
                        <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} disabled={!inspect.writable} data-inspector-action="clear"
                            onClick={() => { setHeld(undefined); writeAcross((r) => ({ r, cells: new Map([[chosenKey, NULL_CELL]]) })); }}>
                            {m.inspectorAction({ action: "clear", header: chosen.spec.label, withLines: false })}
                        </chakra.button>
                    </Box>
                </Box>
            )}
            <Box css={styles.actions} data-inspector-actions="">
                <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} disabled={!can.insertRows}
                    data-inspector-action="duplicate" onClick={() => inspect.duplicate(rs)}>
                    {m.inspectorAction({ action: "duplicate", header: undefined, withLines: false })}
                </chakra.button>
                <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} disabled={!can.removeRows}
                    data-inspector-action="delete" onClick={() => inspect.remove(r0, r1)}>
                    {m.inspectorAction({ action: "delete", header: undefined, withLines: false })}
                </chakra.button>
            </Box>
        </Box>
    );
}

// ============================================================================
// Nothing selected (SB51)
// ============================================================================

/**
 * Nothing selected: the counts, over a record its last commit and who made
 * it, and three hints.
 */
function NothingSelected({ styles, inspect, words, record, lastCommit }: {
    styles: Styles; inspect: SheetInspect; words: SheetWords; record: boolean; lastCommit: SheetLastCommit | undefined;
}) {
    const { m } = words;
    const { rows, pending, issues } = inspect.counts;
    const stats: [what: "rows" | "pending" | "issues", n: number][] = [["rows", rows], ["pending", pending], ["issues", issues]];
    return (
        <Box css={styles.root} data-sheet-inspector="none">
            <Box css={styles.stats} data-inspector-counts="">
                {stats.map(([what, n]) => (
                    <Box key={what} css={styles.stat} data-count={what}>
                        <Box as="span" css={styles.statValue}>{words.number(n)}</Box>
                        <Box as="span" css={styles.statLabel}>{m.inspectorCount({ what, n })}</Box>
                    </Box>
                ))}
            </Box>
            {record && <Box css={styles.commit} data-inspector-commit="">{m.inspectorLastCommit({ when: lastCommit?.when, by: lastCommit?.by })}</Box>}
            <Box as="ul" css={styles.hints}>
                {([1, 2, 3] as const).map((n) => <Box as="li" key={n} css={styles.hint}>{m.inspectorHint({ n })}</Box>)}
            </Box>
        </Box>
    );
}

// ============================================================================
// Issues (SB53)
// ============================================================================

/** The Issues tab: every issue of the batch by row, each a control that goes to its cell. */
const SheetInspectorIssues = memo(function SheetInspectorIssues({ forms, columns, words, noun, where: hostWhere }: {
    forms: PaneValue["forms"]; columns: SheetInspectorValue["sheet"]["columns"]; words: SheetWords; noun: string; where?: SheetInspectorHost["where"];
}) {
    const { m } = words;
    const inspect = useSheetInspect();
    const styles = useSlotRecipe({ key: "sheetInspector" })() as Styles;
    // A field's words: its label in the row's form or the group's — else the header of the column it names, as one of a
    // column from data's cells is named by its column key, which no form field holds — else its name.
    const labels = useMemo(() => new Map([
        ...columns.map((column) => [column.key, column.header] as const),
        ...labelsOf(getSomeorUndefined(forms.group)?.fields ?? []), ...labelsOf(forms.row.fields),
    ]), [forms, columns]);
    // An issue's place: a host's words for it, given where its row stands among the rows drawn (#1534) — else its entry,
    // or a line of its group.
    const placeOf = inspect.placeOf;
    const where = useCallback((issue: EditIssue) => {
        if (hostWhere !== undefined) return hostWhere(issue, placeOf(issue));
        const row = getSomeorUndefined(issue.row);
        return row === undefined ? issue.entry : m.rowRef({ line: true, number: words.number(Number(row) + 1), title: issue.entry, noun });
    }, [m, words, noun, hostWhere, placeOf]);
    // Whether the rail's filters hide the rows of the issues the sheet does not draw, and by which, asked of e3 while the
    // tab lists them (the hidden pick).
    const { issues, askHidden } = inspect;
    useEffect(() => { askHidden(issues); }, [askHidden, issues]);
    if (inspect.issues.length === 0) {
        return (
            <Box css={styles.empty} data-inspector-no-issues="">
                <Box as="span" css={styles.emptyTitle}>{m.inspectorNoIssues({ part: "title" })}</Box>
                <Box as="span" css={styles.emptyHint}>{m.inspectorNoIssues({ part: "hint" })}</Box>
            </Box>
        );
    }
    return (
        <Box as="ul" css={styles.issueList} data-inspector-issue-list="">
            {inspect.issues.map((issue, i) => {
                const field = getSomeorUndefined(issue.field);
                const hidden = inspect.hiddenNote(issue);
                return (
                    <Box as="li" key={i}>
                        <chakra.button type="button" css={styles.issueItem} onClick={() => inspect.goToIssue(issue)} data-inspector-issue="">
                            <Box as="span" css={styles.issueWhere}>{m.inspectorIssueAt({ where: where(issue), field: field === undefined ? undefined : labels.get(field) ?? field })}</Box>
                            <Box as="span" css={styles.issueMessage} data-kind={inspect.kindOf(issue)}>{issueText(issue.message, words)}</Box>
                            {hidden !== undefined && <Box as="span" css={styles.issueHidden} data-inspector-issue-hidden="">{hidden}</Box>}
                        </chakra.button>
                    </Box>
                );
            })}
        </Box>
    );
});
