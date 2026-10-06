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
 *   editor, a field with no column by its type), its sub rows read only, then
 *   Duplicate and Delete. A link or set field shows its halves as the grid
 *   draws them, with Edit in sheet, which puts the ring on its cell (SB48). An
 *   edit is one transaction, as typing in the cell is: a field with a column
 *   is written through its cell — the cells a patch of it sets, or a custom
 *   column's text read by its own parse — and asks the copilot again when its
 *   column is a trigger; a field with none is set on the draft (SB52). A
 *   field the drafts changed is tinted against what the source holds. With
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
 * each a control that goes to its cell, seeking its row on a paged sheet.
 *
 * Styles are the `sheetInspector` recipe's, the form's `fieldForm`'s and a
 * link cell's the `sheet` recipe's; the pane — its tab row, its collapse
 * control and its rail — is the Dock's.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock } from "@fortawesome/free-solid-svg-icons";
import {
    NullType, StringType, VariantType, decodeBeast2For, defaultValue, encodeBeast2For, equalFor, fromEastTypeValue, isTypeEqual, none, some,
    toEastTypeValue, variant, type EastType, type StructType, type ValueTypeOf, type option,
} from "@elaraai/east";
import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { Sheet, type sheetKeys } from "@elaraai/e3-ui/internal";
import {
    EastChakraComponent, FieldForm, getSomeorUndefined, useDataStable, type BuilderFrameDock, type EditIssue, type FieldOption,
} from "@elaraai/east-ui-components";
import { useSheetInspect, type SheetInspect, type SheetInspectPlace, type SheetInspectTarget, type SheetInspectWrite } from "../index.js";
import { NULL_CELL, cellText, indexRegisters, type SheetColumnMeta } from "../model.js";
import type { SheetCellValue } from "../values.js";
import { issueText, type SheetWords } from "../words.js";
import type { SheetValue } from "./index.js";

/** The inspector pane, decoded: its forms, and the author's own Details. */
type PaneValue = Extract<SheetValue["inspector"], { type: "some" }>["value"];
/** One inspector form, decoded: its struct, its fields, the fields its columns write and show, and `encode`. */
type FormValue = PaneValue["forms"]["row"];
/** One field of a form, decoded. */
type FormField = FormValue["fields"][number];
/** The names the sheet keeps its viewer's state under. */
type SheetKeys = ReturnType<typeof sheetKeys>;
type Styles = Record<string, SystemStyleObject>;

const stringEqual = equalFor(StringType);

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
    /** The sheet's payload: its inspector pane, the sheet's registers and editing, and whether it is over a record. */
    value: SheetValue;
    /** The names the sheet keeps its viewer's state under. */
    keys: SheetKeys;
    /** The sheet's words. */
    words: SheetWords;
    /** The columns this viewer hides: a link field's Edit in sheet waits for its column to show. */
    hidden: ReadonlySet<string>;
    /** The record's last commit, when it has one. */
    lastCommit: SheetLastCommit | undefined;
}

/** The host's word for a group, or the sheet's. */
function nounOf(value: SheetValue, words: SheetWords): string {
    const group = getSomeorUndefined(value.sheet.group);
    return (group !== undefined ? getSomeorUndefined(group.noun)?.singular : undefined) ?? words.m.groupNoun();
}

/** What the inspector shows, as its head and its rail name it — `row 3`, `line 2 of WO-2201`, `order 4`. */
function whatOf(place: SheetInspectPlace, words: SheetWords, noun: string): string {
    return words.m.inspectorWhat({ what: place.kind, number: words.number(place.number), title: place.group?.title, noun });
}

/**
 * The inspector pane, as `BuilderFrame` draws it — see the module docs.
 *
 * @param props - The payload, the sheet's keys, the words, the columns hidden and the last commit
 * @returns The pane — its tabs Details and Issues, 320px wide, its collapsed state kept per viewer (SB24) — or `undefined`, no pane, when the sheet is given no inspector
 */
export function useSheetInspector({ value, keys, words, hidden, lastCommit }: SheetInspectorProps): BuilderFrameDock | undefined {
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
                body: <SheetInspectorDetails value={value} pane={pane} keys={keys} words={words} hidden={hidden} lastCommit={lastCommit} noun={noun} /> },
            { key: "issues", label: m.inspectorTab({ tab: "issues" }), count: words.number(issues),
                body: <SheetInspectorIssues forms={pane.forms} words={words} noun={noun} /> },
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

/**
 * The form's specs, values and edits for one target — the payload's form at
 * this row: a quantity's unit and a date's level from its row, a select's
 * members as its column's options rule offers them, a custom column's text
 * by its print and a read-only column's value from its cell, and each edit
 * written as typing in the grid writes it.
 */
function useTargetForm({ value, words, hidden, styles, inspect, target, form }: TargetProps) {
    const { m } = words;
    const button = useRecipe({ key: "button" });
    const r = target.r;
    const struct = useMemo(() => fromEastTypeValue(form.type) as StructType, [form.type]);
    const encodePatch = useMemo(() => encodeBeast2For(Sheet.Types.Patch(struct)), [struct]);
    const registers = useMemo(() => indexRegisters(value.sheet.registers), [value.sheet.registers]);
    const byPath = useMemo(() => new Map(form.fields.map((f) => [pathKey(f.spec.path), f])), [form.fields]);
    const metaOf = useCallback((f: FormField): SheetColumnMeta | undefined => {
        const key = getSomeorUndefined(f.column);
        return key === undefined ? undefined : inspect.columnAt(r, key);
    }, [inspect, r]);

    // The specs at this row: a select's own members, a quantity's unit, a date's level, a stamped code's owner.
    const specs = useMemo(() => form.fields.map((f): FieldSpecValue => {
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
    }), [form.fields, metaOf, inspect, r]);

    // A select's members: its register's, as its column's options rule offers them at this row.
    const options = useMemo(() => {
        const out: Record<string, FieldOption[]> = {};
        for (const f of form.fields) {
            if (f.spec.editor.type !== "reference") continue;
            const key = getSomeorUndefined(f.column);
            const allowed = key !== undefined ? inspect.allowedAt(r, key) : undefined;
            out[pathKey(f.spec.path)] = (registers.byName.get(f.spec.editor.value.of) ?? [])
                .filter((member) => allowed === undefined || allowed.has(member.key))
                .map((member) => {
                    const meta = getSomeorUndefined(member.meta);
                    return { key: member.key, label: meta === undefined ? member.label : `${member.label} · ${meta}` };
                });
        }
        return out;
    }, [form.fields, registers, inspect, r]);

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
            } else if (f.spec.editor.type === "readonly") {
                // What the grid shows, never tinted.
                current[name] = cellValue(inspect.cellAt(r, meta.key), f.spec.optional);
                began[name] = current[name];
            }
        }
        return { formValue: current, baseline: began };
    }, [target, form.fields, metaOf, inspect, r, words]);

    const onChange = useCallback((path: readonly string[], next: unknown) => {
        const f = byPath.get(pathKey(path));
        if (f === undefined) return;
        const key = getSomeorUndefined(f.column);
        const name = path[0]!;
        if (key !== undefined) {
            const meta = inspect.columnAt(r, key);
            if (meta === undefined) return;
            // A custom column reads its text with its own parse, as typing in its cell does.
            if (meta.kind === "custom") {
                const text = f.spec.optional ? getSomeorUndefined(next as option<string>) ?? "" : next as string;
                inspect.write([{ r, texts: new Map([[key, text]]) }]);
                return;
            }
            // Emptied, a field is the blank cell, as typing nothing in the cell is.
            const held = f.spec.optional ? getSomeorUndefined(next as option<unknown>) : next;
            if (held === undefined || (f.spec.editor.type === "text" && stringEqual(held as string, ""))) {
                inspect.write([{ r, cells: new Map([[key, NULL_CELL]]) }]);
                return;
            }
            // The cells a patch of the one field sets, through the column's projection.
            inspect.write([{ r, cells: form.encode(encodePatch(patchOne(struct, name, next) as never)) }]);
            return;
        }
        // No column: the field on the draft — a nested field rebuilt under its struct, from its type's default when the struct has none yet.
        if (path.length === 1) { inspect.write([{ r, fields: new Map([[name, next]]) }]); return; }
        const fieldType = (struct.fields as Record<string, EastType>)[name]!;
        const top = target.value?.[name] ?? defaultValue(fieldType);
        const rebuild = (at: Record<string, unknown>, rest: readonly string[]): Record<string, unknown> =>
            ({ ...at, [rest[0]!]: rest.length === 1 ? next : rebuild(at[rest[0]!] as Record<string, unknown>, rest.slice(1)) });
        inspect.write([{ r, fields: new Map([[name, rebuild(top as Record<string, unknown>, path.slice(1))]]) }]);
    }, [byPath, inspect, r, struct, form, encodePatch, target.value]);

    // A link or set field: its halves as the grid draws them, and Edit in sheet (SB48).
    const renderControl = useCallback((spec: FieldSpecValue): ReactNode | undefined => {
        const f = byPath.get(pathKey(spec.path));
        const key = f === undefined ? undefined : getSomeorUndefined(f.column);
        const meta = key === undefined ? undefined : inspect.columnAt(r, key);
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
    }, [byPath, inspect, r, hidden, styles, button, m]);

    return { specs, options, formValue, baseline, onChange, renderControl, struct };
}

/** One issue of a target, as Details lists it. */
interface TargetIssue {
    key: string;
    field: string | undefined;
    text: string;
    kind: "incomplete" | "invalid";
}

/** A target's issues, by field: each its field's label (else its name) and its text in the sheet's words. */
function targetIssues(target: SheetInspectTarget, inspect: SheetInspect, form: FormValue, words: SheetWords): TargetIssue[] {
    const labels = new Map(form.fields.map((f) => [f.spec.path[0]!, f.spec.label]));
    const out: TargetIssue[] = [];
    inspect.issues.forEach((issue, i) => {
        if (!stringEqual(issue.entry, target.entry)) return;
        const row = getSomeorUndefined(issue.row);
        // A line's issues are addressed to its place in the group; a row's and a band's to none.
        if (target.index === undefined ? row !== undefined : row === undefined || Number(row) !== target.index) return;
        const field = getSomeorUndefined(issue.field);
        out.push({ key: `${i}`, field: field === undefined ? undefined : labels.get(field) ?? field, text: issueText(issue.message, words), kind: inspect.kindOf(issue) });
    });
    return out;
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
    const author = getSomeorUndefined(props.pane.custom);
    const struct = edit.struct;
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
    const own = useMemo(() => {
        if (band || author === undefined || complete === undefined) return undefined;
        try {
            return author(codec.encode(complete as Record<string, unknown>), update);
        } catch (err) {
            console.error("[Sheet] the inspector failed; the form shows instead:", err);
            return undefined;
        }
    }, [band, author, complete, codec, update]);

    const subRows = target.subRows;
    const can = inspect.can;
    return (
        <Box css={styles.root} data-sheet-inspector={target.kind}>
            <Box css={styles.head}>
                <Box css={styles.eyebrow} data-inspector-what="">{whatOf(target, words, noun)}</Box>
                <Box css={styles.name} data-inspector-id="">{ownId !== undefined ? ownId as string : target.entry}</Box>
                <Box css={styles.marks}>
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
                            onChange={edit.onChange} readOnly={!inspect.writable} renderControl={edit.renderControl} />}
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
    // The columns a bulk edit sets: the editable ones the form edits — never a stamped, a link or a set column, which the grid edits.
    const editable = useMemo(() => form.fields.filter((f) => {
        const key = getSomeorUndefined(f.column);
        const meta = key === undefined ? undefined : inspect.columnAt(rs[0]!, key);
        return meta !== undefined && meta.editable && meta.kind !== "stamped" && meta.kind !== "link" && meta.kind !== "set" && f.spec.editor.type !== "readonly";
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
                    <FieldForm specs={specs} value={formValue} options={options} onChange={onChange} readOnly={!inspect.writable} />
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
const SheetInspectorIssues = memo(function SheetInspectorIssues({ forms, words, noun }: { forms: PaneValue["forms"]; words: SheetWords; noun: string }) {
    const { m } = words;
    const inspect = useSheetInspect();
    const styles = useSlotRecipe({ key: "sheetInspector" })() as Styles;
    // A field's words: its label in the row's form or the group's, else its name.
    const labels = useMemo(() => new Map([
        ...(getSomeorUndefined(forms.group)?.fields ?? []).map((f) => [f.spec.path[0]!, f.spec.label] as const),
        ...forms.row.fields.map((f) => [f.spec.path[0]!, f.spec.label] as const),
    ]), [forms]);
    // An issue's place: its entry, or a line of its group.
    const where = useCallback((issue: EditIssue) => {
        const row = getSomeorUndefined(issue.row);
        return row === undefined ? issue.entry : m.rowRef({ line: true, number: words.number(Number(row) + 1), title: issue.entry, noun });
    }, [m, words, noun]);
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
                return (
                    <Box as="li" key={i}>
                        <chakra.button type="button" css={styles.issueItem} onClick={() => inspect.goToIssue(issue)} data-inspector-issue="">
                            <Box as="span" css={styles.issueWhere}>{m.inspectorIssueAt({ where: where(issue), field: field === undefined ? undefined : labels.get(field) ?? field })}</Box>
                            <Box as="span" css={styles.issueMessage} data-kind={inspect.kindOf(issue)}>{issueText(issue.message, words)}</Box>
                        </chakra.button>
                    </Box>
                );
            })}
        </Box>
    );
});
