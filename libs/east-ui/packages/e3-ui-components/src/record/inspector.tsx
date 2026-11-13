/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record's Details (`Record - DX Proposal.md` IN1–IN8), drawn in the
 * Sheet's inspector pane in the Sheet's place (`SheetInspectorHost`), over the
 * Sheet's reads and writes:
 *
 * - **one row** — its head: the eyebrow naming its row, its title, and a
 *   chip, New or how many of its fields its drafts change (IN2); its issues
 *   over its form, each field's label and message, the field each names washed
 *   in the form (IN3) and saying the issue's words under it (ruled 13 Nov
 *   2026); its fields in column order, each column group a section
 *   under its label — an unlabelled group's `Other` — and the fields no column
 *   shows after them (IN4), each member of a column from data a line of its
 *   own in its group's section (#1561), a cycle, a toggle and a boolean each
 *   one line of radios (IN5); a cell's mark its field's help, and a lock's
 *   field read only (D1); its facts last, the audit's and the age's, read
 *   only, an age warning once stale (IN6); then Duplicate and Delete (IN7);
 * - **nothing** — the rows shown, the drafts pending and the rows stale, then
 *   where a row's fields show (IN8).
 *
 * Every edit is the Sheet's form's, written as the row's cell writes it — a
 * number's box emptied as its cell emptied: one draft and one step of the
 * history — or, refused by its cell, none, the field
 * showing what the row holds and why under it. A number its field's bounds
 * don't hold is said once, in its help line, in the tone the row's Save stands
 * in (#1585): a warning while the row is as stored, an error once its change
 * holds Save. A complete row given the author's own
 * Details shows them in the form's place (SB58). A title opened, a copy made
 * and an issue gone to put the keyboard in their field (AD1, IN7, IN9): the
 * focus the Record asks for ({@link RecordInspector}). Several rows are the
 * Sheet's. A phone's drawer holds these Details at touch size (SH12): the head
 * and the gestures as the Sheet's phone Details draw theirs, the form's lines
 * and inputs touch-sized there already, and no field taking the keyboard
 * unasked — a tap gives it.
 *
 * Styles are the `sheetInspector` recipe's, the form's `fieldForm`'s, and a
 * fact's value the `record` recipe's.
 *
 * @packageDocumentation
 */

import { createContext, memo, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock } from "@fortawesome/free-solid-svg-icons";
import { defaultValue, equalFor, fromEastTypeValue, none, some, variant, type EastType } from "@elaraai/east";
import { Field, type FieldSpecValue } from "@elaraai/east-ui/internal";
import {
    EastChakraComponent, EastChakraField, FieldForm, fieldFormMessages, getSomeorUndefined, type FieldLineChoice,
} from "@elaraai/east-ui-components";
import { FrameDrawer, formatDatePattern } from "@elaraai/east-ui-components/internal";
import { useSheetEntries, useSheetInspect, type SheetInspect, type SheetInspectPlace, type SheetInspectTarget } from "../sheet/index.js";
import { issuesByField, targetIssues, useAuthorDetails, useTargetForm, whatOf, type FormValue, type SheetInspectorDetailsProps } from "../sheet/frame/inspector.js";
import { indexColumns, indexRegisters, markOf, type SheetColumnIndex } from "../sheet/model.js";
import type { SheetWords } from "../sheet/words.js";
import { ageOf, useRecordNow } from "./clock.js";
import { staleCountOf } from "./footer.js";
import { nameOf, titleColumnOf, titleOf, useRecordGrid } from "./grid.js";
import { recordMessages as rm } from "./messages.js";
import type { RecordNoun, RecordStatus } from "./status.js";
import type { RecordTicks } from "./ticks.js";

type Styles = Record<string, SystemStyleObject>;

// The shared Field's payload with nothing set: a fact's label and key over the value the Record draws itself.
const FIELD = defaultValue<typeof Field.Types.Field>(Field.Types.Field);
const FIELD_STYLE = defaultValue<typeof Field.Types.Field.fields.style.cases.some>(Field.Types.Field.fields.style.cases.some);

/** A field's key, as the form keys it. */
const formKey = (path: readonly string[]) => path.join(".");

/** A request for the keyboard in a field of a row's Details: a title opened (AD1), a copy made (IN7), an issue gone to (IN9). */
export interface RecordFocus {
    /** The row's row-space index. */
    r: number;
    /** The field, by the form's key. */
    key: string;
    /** Which request it is: each later than the one before. */
    seq: number;
}

/** What the Record's Details read beside the Sheet's. */
export interface RecordInspector {
    /** The field asked to take the keyboard, until the form has given it. */
    focus: RecordFocus | undefined;
    /** Says the form gave the keyboard to the field a request asked for — or that the ring left its row first. */
    focused: (seq: number) => void;
    /** The status line's steps: what a Duplicate tells (IN7). */
    status: RecordStatus;
    /** The rows ticked: a row Details deletes is unticked. */
    ticks: RecordTicks;
    /** No gesture changes the Record: no Duplicate, no Delete. */
    readOnly: boolean;
}

const RecordInspectorContext = createContext<RecordInspector | undefined>(undefined);

/** Provides what the Record's Details read beside the Sheet's. */
export const RecordInspectorProvider = RecordInspectorContext.Provider;

/** What the Record's Details read; a Details outside a {@link RecordInspectorProvider} is a mistake of the frame's, and throws. */
function useRecordInspector(): RecordInspector {
    const inspector = useContext(RecordInspectorContext);
    if (inspector === undefined) throw new Error("A Record's Details are drawn outside a RecordInspectorProvider");
    return inspector;
}

/**
 * How an issue's line in the Issues tab names its row (IN9): by its title — `C. Patel`; a new row with none yet in the
 * Record's word for its rows, `New person` — else, where the narrowing hides it or it is not read yet, by its key. A
 * Record draws no row numbers, so a row's place among the rows names nothing a person sees.
 *
 * @param columns - The columns drawn: where a row's title is
 * @param noun - The Record's word for its rows
 * @param added - Whether the row at a row-space index is new, never applied
 * @returns The words for an issue's row, as `SheetInspectorHost.where` takes them
 */
export function recordIssueWhere(columns: SheetColumnIndex, noun: RecordNoun, added: (r: number) => boolean): (issue: { entry: string }, place: SheetInspectPlace | undefined) => string {
    return (issue, place) => {
        if (place === undefined) return issue.entry;
        return titleOf(place.row, columns) ?? (added(place.r) ? rm.newRow({ noun: noun.singular }) : issue.entry);
    };
}

/**
 * The Record's Details — see the module docs: one row's, or nothing's.
 *
 * @param props - The payload, the pane, the keys, the words, the columns hidden, the word for a group, and what the ring selects
 * @returns The Details
 */
export const RecordDetails = memo(function RecordDetails(props: SheetInspectorDetailsProps) {
    const { value, pane, words, selected } = props;
    const inspect = useSheetInspect();
    const styles = useSlotRecipe({ key: "sheetInspector" })() as Styles;
    const { focus, focused } = useRecordInspector();
    const columns = useMemo(() => indexColumns(value.sheet.columns), [value.sheet.columns]);
    // A field asked for on a row the ring has left goes unanswered: it never takes the keyboard on that row's next visit.
    const at = selected.kind === "one" ? selected.place.r : undefined;
    useEffect(() => {
        if (focus !== undefined && focus.r !== at) focused(focus.seq);
    }, [focus, at, focused]);
    if (selected.kind === "none") return <RecordNothing styles={styles} inspect={inspect} words={words} columns={columns} />;
    const place = selected.place;
    const form = place.kind === "band" ? getSomeorUndefined(pane.forms.group) : pane.forms.row;
    if (form === undefined) return null;
    // Each row its own form: what was typed for one never lands on the next.
    return <RecordTargetDetails key={`${place.kind}\u001f${place.entry}\u001f${place.child ?? ""}`} {...props} styles={styles} inspect={inspect}
        columns={columns} place={place} form={form} />;
});

/** Props of {@link RecordTargetDetails}. */
interface RecordPlaceProps extends SheetInspectorDetailsProps {
    styles: Styles;
    inspect: SheetInspect;
    columns: SheetColumnIndex;
    place: SheetInspectPlace;
    form: FormValue;
}

/** One row: its target — its draft and what the record holds — read as Details shows it, and drawn. */
function RecordTargetDetails({ place, ...props }: RecordPlaceProps) {
    const targetAt = props.inspect.targetAt;
    const target = useMemo(() => targetAt(place.r), [targetAt, place.r]);
    return target === undefined ? null : <RecordTarget {...props} target={target} />;
}

/** One fact of a row (IN6): its column, and its value in words. */
interface RecordFact {
    key: string;
    label: string;
    text: string;
    stale: boolean;
}

/** One row's Details: its head, its issues, its fields, its facts and its gestures (IN2–IN7). */
function RecordTarget({ value, pane, keys, words, hidden, noun, styles, inspect, columns, form, target }: Omit<RecordPlaceProps, "place"> & { target: SheetInspectTarget }) {
    const { m } = words;
    const button = useRecipe({ key: "button" });
    const { styles: record, groups } = useRecordGrid();
    const { focus, focused, status, ticks, readOnly } = useRecordInspector();
    const entries = useSheetEntries();
    const now = useRecordNow();
    const edit = useTargetForm({ value, words, hidden, styles, inspect, target, form });
    const own = useAuthorDetails({ value, pane, inspect, target, form, struct: edit.struct });
    const issues = targetIssues(target, inspect, form, words);
    // A bound the row breaks (#1585), said in the tone its Save stands in: as stored it warns; its change held, an error.
    const breaches = issues.some((issue) => issue.kind !== "warning") ? "error" : "warn";
    const registers = useMemo(() => indexRegisters(value.sheet.registers), [value.sheet.registers]);
    const isNew = target.baseline === undefined && target.value !== undefined;
    const r = target.r;
    // In a phone's drawer (SH12): its head and its gestures at touch size.
    const phone = useContext(FrameDrawer);

    // Its title, as the head names it: the title column's text — else, with no title column, its first text, else its key.
    const titleKey = useMemo(() => titleColumnOf(columns)?.key, [columns]);
    const titleCell = titleKey === undefined ? undefined : target.row.cells.get(titleKey);
    const title = titleKey === undefined ? nameOf(target.row, columns) : titleCell?.type === "String" ? titleCell.value.trim() : "";

    // How many of its fields its drafts change (IN2), each compared by East at its type: what the chip counts.
    const equals = useMemo(() => Object.entries(edit.struct.fields as Record<string, EastType>).map(([name, type]) => [name, equalFor(type)] as const), [edit.struct]);
    const changed = useMemo(() => {
        const now = target.value;
        const was = target.baseline;
        if (now === undefined || was === undefined) return 0;
        return equals.reduce((n, [name, same]) => {
            const a = now[name];
            const b = was[name];
            const differs = a === undefined || b === undefined ? (a === undefined) !== (b === undefined) : !same(a as never, b as never);
            return differs ? n + 1 : n;
        }, 0);
    }, [target, equals]);

    // Its fields in column order, each column group a section under its label — an unlabelled group's `Other` — the fields
    // no column shows after them, in the form's order (IN4): a variant's cases' fields right after it, its block under its
    // choice (#1549) — a column's field is one spec, never a variant's cases'. Each member of a column from data is a line
    // in its column's place, in its group's section (#1561). The audit is a fact, never a field (IN6). A cell's mark is its
    // field's help, after its own, a lock's words saying so — and a lock reads the field only, as the grid's cell (D1).
    const cells = target.row.cells;
    const specs = useMemo(() => {
        const order = new Map(columns.list.map((meta, i) => [meta.key, i] as const));
        const groupOf = new Map<string, string>();
        for (const group of groups) for (const key of group.columnKeys) groupOf.set(key, group.label.trim().length === 0 ? rm.otherGroup() : group.label);
        const placed = edit.specs.flatMap((spec, i): { spec: FieldSpecValue; at: number }[] => {
            const key = edit.columns[i];
            const at = key === undefined ? undefined : order.get(key);
            if (key === undefined || at === undefined) return [{ spec, at: columns.list.length + i }];
            const meta = columns.byKey.get(key);
            if (meta?.kind === "audit") return [];
            const group = groupOf.get(key);
            const grouped = group === undefined ? spec : { ...spec, group: some(group) };
            const mark = meta === undefined ? undefined : markOf(meta, cells);
            if (mark === undefined) return [{ spec: grouped, at }];
            const help = rm.marked({ text: getSomeorUndefined(spec.help), words: mark.words, lock: mark.lock });
            return [{ spec: { ...grouped, help: help === "" ? none : some(help), ...(mark.lock ? { editor: variant("readonly", null) } : {}) }, at }];
        });
        return placed.sort((a, b) => a.at - b.at).map((p) => p.spec);
    }, [edit.specs, edit.columns, columns, groups, cells]);

    // A cycle, a toggle and a boolean, each one line of radios (IN5) — a member's line's among them: a cycle's members as
    // its options rule offers them at this row, a toggle's on and off, a boolean's yes and no.
    const lines = useMemo(() => {
        const out = new Map<string, readonly FieldLineChoice[]>();
        edit.specs.forEach((spec, i) => {
            const key = edit.columns[i];
            const kind = key === undefined ? undefined : inspect.columnAt(r, key)?.raw.kind;
            if (key === undefined || kind === undefined) return;
            if (kind.type === "cycle") {
                const allowed = inspect.allowedAt(r, key);
                // What a member's choice sets: a String field its key — and a cycle over a variant, whose steps the wire
                // keys by the cases' names, the case its key names. A member's line holds its cell's key.
                const ofCases = (fromEastTypeValue(spec.type) as EastType).type === "Variant" && !spec.optional;
                out.set(formKey(spec.path), (registers.byName.get(kind.value.register) ?? [])
                    .filter((member) => allowed === undefined || allowed.has(member.key))
                    .map((member) => ({ value: ofCases ? variant(member.key, null) : member.key, label: member.label !== "" ? member.label : member.key })));
            } else if (kind.type === "toggle") {
                out.set(formKey(spec.path), [{ value: true, label: kind.value.on }, { value: false, label: kind.value.off }]);
            } else if (kind.type === "boolean") {
                out.set(formKey(spec.path), [{ value: true, label: fieldFormMessages.yesNo({ value: true }) }, { value: false, label: fieldFormMessages.yesNo({ value: false }) }]);
            }
        });
        return out;
    }, [edit.specs, edit.columns, inspect, r, registers]);
    // A line draws its choices, or read only the choice made — a lock's too: never its cell's own control.
    const editControl = edit.renderControl;
    const renderControl = useCallback((spec: FieldSpecValue) => (lines.has(formKey(spec.path)) ? undefined : editControl(spec)), [lines, editControl]);

    // The fields its issues name, washed in the form (IN3), each saying under it what its issues say of it, in their
    // order (ruled 13 Nov 2026): a field gone to says why it is named, whatever of the issues over the form is in view.
    const named = issuesByField(issues);

    // The field asked to take the keyboard on this row, once the form is drawn to give it; then the request is answered —
    // in a phone's drawer at once, the field left to a tap, so no keyboard rises over the drawer unasked. The author's own
    // Details take no request: it is answered as they show, so it never fires once the form takes their place.
    const drawn = target.value !== undefined && own === undefined;
    const asked = focus !== undefined && focus.r === r && drawn ? focus.key : undefined;
    const focusKey = phone ? undefined : asked;
    const ownShown = target.value !== undefined && own !== undefined;
    useEffect(() => {
        if (focus !== undefined && (asked !== undefined || (ownShown && focus.r === r))) focused(focus.seq);
    }, [focus, asked, ownShown, r, focused]);

    // Its facts (IN6): the audit's when, verb and who, and the age's count — none on a row the record does not hold yet.
    const facts = useMemo((): RecordFact[] => {
        if (isNew) return [];
        return columns.list.flatMap((meta): RecordFact[] => {
            const kind = meta.raw.kind;
            const cell = target.row.cells.get(meta.key);
            if (kind.type === "audit") {
                if (cell?.type !== "DateTime") return [{ key: meta.key, label: meta.header, text: getSomeorUndefined(kind.value.absent) ?? rm.absent(), stale: false }];
                const verbCell = target.row.cells.get(kind.value.verb);
                const byCell = target.row.cells.get(kind.value.by);
                const when = formatDatePattern("YYYY-MM-DD HH:mm", cell.value);
                return [{ key: meta.key, label: meta.header, stale: false, text: rm.auditTitle({
                    when, verb: verbCell?.type === "String" ? verbCell.value : "", by: byCell?.type === "String" ? byCell.value : "",
                }) }];
            }
            if (kind.type === "age") {
                const age = ageOf(meta, cell, now);
                return [age === undefined
                    ? { key: meta.key, label: meta.header, text: getSomeorUndefined(kind.value.absent) ?? rm.absent(), stale: false }
                    : { key: meta.key, label: meta.header, text: words.number(age.n), stale: age.stale }];
            }
            return [];
        });
    }, [isNew, columns, target.row, now, words]);

    // Its gestures (IN7): a copy after it, its title empty and the keyboard in it, and its deletion — none on a Record no
    // gesture changes, nor a gesture the record does not take.
    const capabilities = value.sheet.editing.edits;
    const name = nameOf(target.row, columns);
    const onDuplicate = () => {
        if (inspect.duplicate([r], { empty: titleKey, ring: titleKey })) status.say({ id: "duplicated", name });
    };
    const onDelete = () => {
        if (ticks.has(target.entry)) ticks.toggle(target.entry);
        entries.remove([target.entry]);
    };
    const chipCss = phone ? styles.phoneChip : styles.chip;
    const chip: ReactNode = isNew ? <Box as="span" css={chipCss} data-state="new">{m.inspectorChip({ state: "new" })}</Box>
        : target.presentation.pending
            ? <Box as="span" css={chipCss} data-state="pending">{changed > 0 ? rm.detailsPending({ count: words.number(changed) }) : m.inspectorChip({ state: "pending" })}</Box>
            : null;
    const heading = title !== "" ? title : <Box as="span" css={record.absent}>{rm.absent()}</Box>;
    // Duplicate and Delete: a phone's touch-sized Default buttons, as the Sheet's phone Details draw theirs.
    const gesture = phone ? [button({ variant: "outline", size: "md" }), styles.phoneButton] : [button({ variant: "outline", size: "xs" })];
    // A Record that takes edits keeps its chip's row while there is none (#1584): the first edit's chip moves nothing.
    const writes = readOnly ? undefined : "";
    return (
        <Box css={styles.root} data-sheet-inspector={target.kind} data-record-details="row" data-record-entry={target.entry} data-phone={phone ? "" : undefined}>
            {phone ? (
                <Box css={styles.phoneHead} data-writes={writes}>
                    <Box as="span" css={styles.phoneEyebrow} data-inspector-what="">{whatOf(target, words, noun)}</Box>
                    <Box as="span" css={styles.phoneName} data-inspector-id="">{heading}</Box>
                    {chip}
                    {target.owned && <Box as="span" css={styles.lock} data-inspector-lock=""><FontAwesomeIcon icon={faLock} aria-hidden />{m.inspectorOwned()}</Box>}
                </Box>
            ) : (
                <Box css={styles.head}>
                    <Box css={styles.eyebrow} data-inspector-what="">{whatOf(target, words, noun)}</Box>
                    <Box css={styles.name} data-inspector-id="">{heading}</Box>
                    <Box css={styles.marks} data-writes={writes}>
                        {chip}
                        {target.owned && (
                            <Box as="span" css={styles.lock} role="img" aria-label={m.inspectorOwned()} title={m.inspectorOwned()} data-inspector-lock="">
                                <FontAwesomeIcon icon={faLock} />
                            </Box>
                        )}
                    </Box>
                </Box>
            )}
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
                        : <FieldForm specs={specs} value={edit.formValue} baseline={edit.baseline} options={edit.options} onChange={edit.onChange}
                            takesUnset readOnly={!inspect.writable} renderControl={renderControl} lines={lines} issues={named} focus={focusKey} breaches={breaches} />}
            </Box>
            {facts.length > 0 && (
                <Box css={record.facts} data-record-facts="">
                    {facts.map((fact) => (
                        <Box key={fact.key} data-record-fact={fact.key}>
                            <EastChakraField value={{ ...FIELD, label: fact.label, readOnly: some(true), style: some({ ...FIELD_STYLE, schemaKey: some(fact.key) }) }}
                                storageKey={`record.fact.${fact.key}`}
                                controlNode={<chakra.input css={record.factValue} readOnly value={fact.text} title={fact.text} aria-label={fact.label}
                                    data-stale={fact.stale ? "" : undefined} />} />
                        </Box>
                    ))}
                </Box>
            )}
            {!readOnly && (capabilities.insertRows || capabilities.removeRows) && (
                <Box css={phone ? styles.phoneActions : styles.actions} data-inspector-actions="">
                    {capabilities.insertRows && (
                        <chakra.button type="button" css={gesture} disabled={!inspect.can.insertRows}
                            data-inspector-action="duplicate" onClick={onDuplicate}>
                            {m.inspectorAction({ action: "duplicate", header: undefined, withLines: false })}
                        </chakra.button>
                    )}
                    {capabilities.removeRows && (
                        <chakra.button type="button" css={gesture} disabled={!inspect.can.removeRows}
                            data-inspector-action="delete" onClick={onDelete}>
                            {m.inspectorAction({ action: "delete", header: undefined, withLines: false })}
                        </chakra.button>
                    )}
                </Box>
            )}
        </Box>
    );
}

/**
 * No row selected (IN8): the rows the narrowing shows, the drafts pending and the rows stale — each a dash while it is
 * not known, the stale count until every row shown is read — then where a row's fields show.
 */
function RecordNothing({ styles, inspect, words, columns }: { styles: Styles; inspect: SheetInspect; words: SheetWords; columns: SheetColumnIndex }) {
    const { styles: record } = useRecordGrid();
    const entries = useSheetEntries();
    const now = useRecordNow();
    const shown = entries.count.shown;
    const stale = entries.whole ? staleCountOf(columns, entries.rows, entries.changes, now) : undefined;
    const stats: [stat: "shown" | "pending" | "stale", text: string | undefined][] = [
        ["shown", shown === undefined ? undefined : words.number(shown)],
        ["pending", words.number(inspect.counts.pending)],
        ["stale", stale === undefined ? undefined : words.number(stale.n)],
    ];
    return (
        <Box css={styles.root} data-sheet-inspector="none" data-record-details="none">
            <Box css={styles.stats} data-inspector-counts="">
                {stats.map(([stat, text]) => (
                    <Box key={stat} css={styles.stat} data-count={stat}>
                        <Box as="span" css={[styles.statValue, record.statValue]}>{text ?? rm.absent()}</Box>
                        <Box as="span" css={styles.statLabel}>{rm.detailsStat({ stat })}</Box>
                    </Box>
                ))}
            </Box>
            <Box css={styles.hints}>
                <Box as="p" css={styles.hint} data-record-hint="">{rm.detailsHint()}</Box>
            </Box>
        </Box>
    );
}
