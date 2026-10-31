/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Modify's form over one row a case's change writes (`Decision Queue Spec.md`
 * D9, R19): the form its builder's inspector shows for one row, never one of
 * the queue's own — each input chosen by its East type through the shared
 * `FieldForm`, or the kind's own `inspector` where it gives one.
 *
 * - A record, its zones or a projection: the side's own `inspector`, else its
 *   `fields` (east-ui's `Fields` hints over its row), each edit written
 *   through the side's `set`.
 * - The Roster: the duty's times, and its position and, for a person's duty,
 *   its activity — the Roster's own forms — written through the duty kind's
 *   roles; then the duty kind's own `inspector`, else its `fields`.
 * - The Calendar: the event's title and status, its placement — checked as
 *   the Calendar checks one before its `canDrop` — and the kind's own
 *   `inspector`, else its other fields; a field choosing a resource of the
 *   paged kind searches that kind by key, as the Calendar's Chooser does.
 * - The Plan: the kind's form over the fields its roles leave, or its own
 *   `inspector`.
 * - The Allocation: the Bin section's form — the lane as its segments, the
 *   quantity no less than the bin's parts take — then the bin kind's own
 *   `inspector`, else its `fields`.
 * - The Sheet: its inspector's row form over the row's fields — a select its
 *   register's members, the id field and a read-only column printed — or the
 *   author's own Details. A grouped sheet's form is a line's, none of the
 *   record's rows: its rows take Keep as it is alone.
 *
 * Each edit hands the row as it leaves it to the Edit panel, which keeps it as
 * the viewer's edit, so the card's preview follows it. An edit the kind
 * refuses — its write answers none, or throws — says so under the form, the
 * row as it was.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, chakra } from "@chakra-ui/react";
import {
    EastTypeType, SortedMap, StringType, compareFor, equalFor, fromEastTypeValue, isTypeEqual, none, some, variant, type EastType, type StructType,
} from "@elaraai/east";
import type { FieldSpecValue } from "@elaraai/east-ui";
import { EastChakraComponent, FieldForm, getSomeorUndefined, useTrackedEvaluation, type FieldFormWords, type FieldOption } from "@elaraai/east-ui-components";
import type { SlotStyles } from "@elaraai/east-ui-components/internal";
import { quantityFloor, quantitySet } from "../allocation/actions.js";
import { BinLaneSegments, binFormSpecs } from "../allocation/inspector.js";
import { placementRefusal, type CalendarPlacement } from "../calendar/actions.js";
import { CalendarChooserContext, type CalendarChooser } from "../calendar/chooser.js";
import { PlacementFields } from "../calendar/controls.js";
import { calendarEventForm, calendarFieldOptions, useReferenceControl } from "../calendar/inspector.js";
import { planFormSpecs } from "../plan/frame/inspector.js";
import type { RolesChange } from "../roster/actions.js";
import { AssignmentFields, TimesFields, type DutyFormValue } from "../roster/controls.js";
import { sheetFieldOptions, sheetFieldSpec } from "../sheet/frame/inspector.js";
import { indexRegisters } from "../sheet/model.js";
import { EMPTY_SCHEDULE_DRAFTS } from "../shared/schedule/editing.js";
import { fieldChange, rowCodec } from "../shared/schedule/records.js";
import type { DecisionRecord, DecisionTarget } from "./editing.js";
import type { DecisionQueueWords } from "./messages.js";
import { fieldAt, sameRow, withField } from "./state.js";

/** A target's kind, decoded. */
type TargetKind = DecisionTarget["kind"];
/** One kind of target's own fields, decoded. */
type KindOf<T extends TargetKind["type"]> = Extract<TargetKind, { type: T }>["value"];
/** A record, its zones or a projection: a target over the app's own rows, with its side's forms. */
type RecordSide = KindOf<"record"> | KindOf<"zones"> | KindOf<"projection">;
/** A Schedule kind, as the Calendar's target carries it. */
type ScheduleKind = KindOf<"calendar">["events"][number];
/** What a kind's part of the form reads of its kind: its key, its fields, its row type, its write and its own form. */
type FormKind = Pick<ScheduleKind, "key" | "fields" | "editing" | "write" | "inspector">;
/** A row's own form, as its kind gives it: over the row's bytes, its writer handed the row as an edit leaves it. */
type OwnInspector = Extract<ScheduleKind["inspector"], { type: "some" }>["value"];
/** What a row's own form draws. */
type OwnView = ReturnType<OwnInspector>;
/** Takes the row as an edit leaves it; `undefined` where its kind refuses the edit, with why where the form says. */
type OnRow = (next: Uint8Array | undefined, refused?: string) => void;
/** Takes a field's edit: its path, and its new value, typed as the field. */
type OnField = (path: readonly string[], next: unknown) => void;

/** What each builder's form is handed. */
interface FormProps {
    /** The record the row is in. */
    readonly record: DecisionRecord;
    /** The row's key's text. */
    readonly rowKey: string;
    /** The row as the form shows it. */
    readonly row: Uint8Array;
    /** What a changed field is told from and put back to; `undefined` for none. */
    readonly baseline: Uint8Array | undefined;
    /** Takes no edit. */
    readonly readOnly: boolean;
    /** The queue's words. */
    readonly words: DecisionQueueWords;
    /** The shared form's words. */
    readonly formWords: FieldFormWords;
    /** What a kind's own form keeps its viewer's state under. */
    readonly storageKey: string;
    /** The `decisionQueue` recipe's styles. */
    readonly styles: SlotStyles;
    /** Takes the row as an edit leaves it. */
    readonly onRow: OnRow;
}

const stringEqual = equalFor(StringType);
const compareString = compareFor(StringType);
const sameTypeValue = equalFor(EastTypeType);
/** A placement read off a row given: the read reads no window. */
const EPOCH = new Date(0);
/** The Roster's resource kind of its staff: a duty on one of them names a person. */
const PEOPLE = "people";
/** No form's fields. */
const NO_SPECS: readonly FieldSpecValue[] = [];
/** The queue holds no window of the paged kind's resources to name one by. */
const NO_NAME = (): string | undefined => undefined;
/** The queue knows no column's options rule at a row: a select offers every member of its register. */
const EVERY_MEMBER = (): ReadonlySet<string> | undefined => undefined;

/**
 * What a kind's function answers, or `undefined` where it throws — said to the console, as the builders' forms say it.
 *
 * @param what - What failed, for the console
 * @param run - The call
 * @returns Its answer; `undefined` where it threw
 */
function tried<T>(what: string, run: () => T): T | undefined {
    try {
        return run();
    } catch (error) {
        console.error(`[DecisionQueue] ${what}:`, error);
        return undefined;
    }
}

/**
 * A field of a kind's form edited, as the kind writes it: its `field` gesture through its `write`.
 *
 * @param kind - The kind
 * @param id - The row's key's text
 * @param row - The row as it stands
 * @param path - The field's path
 * @param next - Its new value
 * @returns The row as the edit leaves it; `undefined` where the kind refuses it
 */
function kindField(kind: FormKind, id: string, row: Uint8Array, path: readonly string[], next: unknown): Uint8Array | undefined {
    const change = fieldChange(kind, id, path, next);
    if (change === undefined || !("gesture" in change)) return undefined;
    return getSomeorUndefined(kind.write([{ id, entry: row, gesture: change.gesture }])[0] ?? none);
}

/**
 * A field of a side's form edited, as the side writes it: through its `set`.
 *
 * @param side - The record's side
 * @param record - Its record
 * @param id - The row's key's text
 * @param row - The row as it stands
 * @param path - The field's path
 * @param next - Its new value
 * @returns The row as the edit leaves it; `undefined` where the side refuses it
 */
function sideField(side: RecordSide, record: DecisionRecord, id: string, row: Uint8Array, path: readonly string[], next: unknown): Uint8Array | undefined {
    const change = fieldChange({ key: record.key, fields: side.fields, editing: record.editing }, id, path, next);
    if (change === undefined || !("gesture" in change) || change.gesture.type !== "field") return undefined;
    return getSomeorUndefined(side.set(row, [change.gesture.value]));
}

/**
 * Whether a field of a form is a field of the row, at its type: a field a form reads through a column of its own — a
 * custom column's text, a projection — is none of the row's.
 *
 * @param rowType - The row's type
 * @param spec - The field
 * @returns Whether the row holds it at the field's type
 */
function fieldTypeHolds(rowType: StructType, spec: FieldSpecValue): boolean {
    let at: EastType | undefined = rowType;
    for (const name of spec.path) at = at !== undefined && "fields" in at ? (at as StructType).fields[name] : undefined;
    return at !== undefined && isTypeEqual(fromEastTypeValue(spec.type) as EastType, at);
}

/**
 * An event's placement, as its kind reads it off its row: the row given, never a window's.
 *
 * @param kind - The event's kind
 * @param id - The event's key's text
 * @param row - Its row
 * @returns Its placement; `undefined` for an event with none
 */
function placementOf(kind: ScheduleKind, id: string, row: Uint8Array): CalendarPlacement | undefined {
    const read = kind.event(id, EMPTY_SCHEDULE_DRAFTS, EPOCH, EPOCH, some(some(row)));
    if (read.type !== "some") return undefined;
    const { item } = read.value;
    return item.start.type === "some" && item.end.type === "some" ? { start: item.start.value, end: item.end.value, resource: item.resource } : undefined;
}

/**
 * A row's own form, as its kind gives it, read tracked as every builder reads one — a read of the app's data it makes
 * landing draws it again — its writer the same function while the form shows, handing each edit to the newest `onRow`.
 *
 * @param own - The kind's own form; `undefined` for none
 * @param row - The row
 * @param onRow - Takes the row as an edit leaves it
 * @returns `undefined` for none; else what it draws, or that it failed
 */
function useOwnForm(own: OwnInspector | undefined, row: Uint8Array, onRow: OnRow): { readonly ok: true; readonly view: OwnView } | { readonly ok: false } | undefined {
    const latest = useRef(onRow);
    latest.current = onRow;
    const update = useCallback((bytes: Uint8Array): null => {
        latest.current(bytes);
        return null;
    }, []);
    const read = useCallback(() => own?.(row, update), [own, row, update]);
    const { result } = useTrackedEvaluation(read);
    useEffect(() => {
        if (!result.ok) console.error("[DecisionQueue] a row's own form could not be shown:", result.error);
    }, [result]);
    if (own === undefined) return undefined;
    return result.ok && result.value !== undefined ? { ok: true, view: result.value } : { ok: false };
}

/**
 * A changed field's Reset: the field set as the baseline holds it.
 *
 * @param was - The baseline, decoded; `undefined` for none
 * @param onField - Takes a field's edit
 * @returns The Reset; `undefined` with no baseline
 */
function useFieldReset(was: unknown, onField: OnField): ((path: readonly string[]) => void) | undefined {
    const reset = useCallback((path: readonly string[]) => onField(path, fieldAt(was, path)), [was, onField]);
    return was === undefined ? undefined : reset;
}

/**
 * A field of a kind's form edited through the kind's `write`.
 *
 * @param kind - The kind
 * @param rowKey - The row's key's text
 * @param row - The row as it stands
 * @param onRow - Takes the row as the edit leaves it
 * @returns The field's edit
 */
function useKindField(kind: FormKind, rowKey: string, row: Uint8Array, onRow: OnRow): OnField {
    return useCallback((path: readonly string[], next: unknown) => onRow(tried("an edit of a field could not be written", () => kindField(kind, rowKey, row, path, next))),
        [kind, rowKey, row, onRow]);
}

/** Props of {@link DecisionRowForm}. */
export interface DecisionRowFormProps {
    /** The target the change lands in: its kind decides the form. */
    readonly target: DecisionTarget;
    /** Its record, as the queue writes it. */
    readonly record: DecisionRecord;
    /** The row's key's text. */
    readonly rowKey: string;
    /** The row as the form shows it: as the viewer left it, else as the change leaves it — or, kept, as it stands. */
    readonly row: Uint8Array;
    /** What a changed field is told from and put back to: the row as the change leaves it; `undefined` for none. */
    readonly baseline: Uint8Array | undefined;
    /** Takes no edit: the row kept as it stands. */
    readonly readOnly: boolean;
    /** The queue's words. */
    readonly words: DecisionQueueWords;
    /** The shared form's words: the queue's formatters, and its Reset in the queue's words. */
    readonly formWords: FieldFormWords;
    /** What a kind's own form keeps its viewer's state under. */
    readonly storageKey: string;
    /** The `decisionQueue` recipe's styles. */
    readonly styles: SlotStyles;
    /** Takes the row as an edit leaves it. */
    readonly onWrite: (row: Uint8Array) => void;
}

/**
 * Modify's form over one row (see the module docs).
 *
 * @param props - The target, its record and the row, and where an edit goes ({@link DecisionRowFormProps})
 * @returns The form, and what an edit its kind refused says
 */
export const DecisionRowForm = memo(function DecisionRowForm({ target, onWrite, ...props }: DecisionRowFormProps) {
    const { row, words, styles } = props;
    // An edit its kind refused, said while the row is the one it was refused over.
    const [refused, setRefused] = useState<{ readonly at: Uint8Array; readonly text: string }>();
    const onRow = useCallback((next: Uint8Array | undefined, why?: string) => {
        if (next === undefined) {
            setRefused({ at: row, text: why ?? words.m.editRefused() });
            return;
        }
        setRefused(undefined);
        onWrite(next);
    }, [row, words, onWrite]);
    return (
        <>
            <KindForm kind={target.kind} {...props} onRow={onRow} />
            {refused !== undefined && sameRow(refused.at, row) && <Box role="alert" css={styles.error}>{refused.text}</Box>}
        </>
    );
});

/** The form a target's kind draws. */
function KindForm({ kind, ...props }: FormProps & { readonly kind: TargetKind }) {
    switch (kind.type) {
        case "record": case "zones": case "projection": return <SideForm side={kind.value} {...props} />;
        case "roster": return <RosterForm roster={kind.value} {...props} />;
        case "calendar": return <CalendarForm calendar={kind.value} {...props} />;
        case "plan": return <PlanForm plan={kind.value} {...props} />;
        case "allocation": return <AllocationForm allocation={kind.value} {...props} />;
        case "sheet": return <SheetForm sheet={kind.value} {...props} />;
    }
}

/** Props of {@link OwnOrFields}. */
interface OwnOrFieldsProps extends Omit<FormProps, "record" | "rowKey" | "baseline"> {
    /** The kind's own form; `undefined` for none. */
    readonly own: OwnInspector | undefined;
    /** Its fields, where it gives no form of its own. */
    readonly specs: readonly FieldSpecValue[];
    /** The row, decoded. */
    readonly value: unknown;
    /** What a changed field is told from, decoded; `undefined` for none. */
    readonly was: unknown;
    /** Each select's choices. */
    readonly options?: Readonly<Record<string, readonly FieldOption[]>> | undefined;
    /** A field's control of the host's. */
    readonly renderControl?: ((spec: FieldSpecValue) => ReactNode | undefined) | undefined;
    /** Takes a field's edit. */
    readonly onField: OnField;
}

/**
 * A kind's own form over the row where it gives one, else its fields through the shared form — the builders'
 * inspectors' rule — and, where its own fails, its fields in its place, saying so.
 */
function OwnOrFields({ own, specs, value, was, options, renderControl, row, readOnly, words, formWords, storageKey, styles, onField, onRow }: OwnOrFieldsProps) {
    const form = useOwnForm(own, row, onRow);
    const reset = useFieldReset(was, onField);
    if (form?.ok === true) {
        return <chakra.fieldset disabled={readOnly}><EastChakraComponent value={form.view} storageKey={storageKey} /></chakra.fieldset>;
    }
    return (
        <>
            {specs.length > 0 && (
                <FieldForm specs={specs} value={value} baseline={was} options={options} renderControl={renderControl} readOnly={readOnly} words={formWords}
                    onChange={onField} onReset={readOnly ? undefined : reset} />
            )}
            {form !== undefined && <Box role="alert" css={styles.error}>{words.m.ownFormFailed()}</Box>}
        </>
    );
}

/** A kind's part of a builder's form: its own form, else its fields — those its builder's roles leave — written through its `write`. */
function KindPart({ kind, specs, rowKey, row, baseline, ...rest }: Omit<FormProps, "record"> & { readonly kind: FormKind; readonly specs: readonly FieldSpecValue[] }) {
    const codec = rowCodec(kind.editing.entryType);
    const value = useMemo(() => codec.decode(row), [codec, row]);
    const was = useMemo(() => (baseline === undefined ? undefined : codec.decode(baseline)), [codec, baseline]);
    const onField = useKindField(kind, rowKey, row, rest.onRow);
    return <OwnOrFields own={getSomeorUndefined(kind.inspector)} specs={specs} value={value} was={was} row={row} onField={onField} {...rest} />;
}

/** A record's, its zones' or a projection's row: its side's own form, else its fields, written through its `set`. */
function SideForm({ side, record, rowKey, row, baseline, ...rest }: FormProps & { readonly side: RecordSide }) {
    const codec = rowCodec(record.editing.entryType);
    const value = useMemo(() => codec.decode(row), [codec, row]);
    const was = useMemo(() => (baseline === undefined ? undefined : codec.decode(baseline)), [codec, baseline]);
    const { onRow } = rest;
    const onField = useCallback((path: readonly string[], next: unknown) => onRow(tried("an edit of a field could not be written", () => sideField(side, record, rowKey, row, path, next))),
        [side, record, rowKey, row, onRow]);
    return <OwnOrFields own={getSomeorUndefined(side.inspector)} specs={side.fields} value={value} was={was} row={row} onField={onField} {...rest} />;
}

/**
 * A duty, as the Roster's inspector draws one (§5.5): its times, and its position and, for a person's duty, its
 * activity — the Roster's own forms, written through the duty kind's roles — then the duty kind's own form.
 */
function RosterForm({ roster, rowKey, row, baseline, readOnly, words, formWords, storageKey, styles, onRow }: FormProps & { readonly roster: KindOf<"roster"> }) {
    const duty = roster.roster.duty;
    const roles = useMemo(() => tried("a duty's roles could not be read", () => duty.read(row, rowKey)), [duty, row, rowKey]);
    const held = useMemo(() => (baseline === undefined ? undefined : tried("a duty's roles could not be read", () => duty.read(baseline, rowKey))), [duty, baseline, rowKey]);
    const form = useMemo((): DutyFormValue | undefined => (roles === undefined ? undefined
        : { position: roles.position, activity: roles.activity, start: roles.start, end: roles.end }), [roles]);
    const was = useMemo((): DutyFormValue | undefined => (held === undefined ? undefined
        : { position: held.position, activity: held.activity, start: held.start, end: held.end }), [held]);
    const value = useMemo(() => ({ duty, positions: roster.roster.positions, activities: roster.roster.activities, visibleActivities: none }),
        [duty, roster.roster.positions, roster.roster.activities]);
    const change = useCallback((next: RolesChange) => {
        if (roles === undefined) return;
        onRow(tried("a duty's edit could not be written", () => getSomeorUndefined(duty.write(row, { ...roles, ...next }))));
    }, [duty, row, roles, onRow]);
    const reset = useCallback((path: readonly string[]) => {
        if (was === undefined) return;
        const name = path[0] ?? "";
        change(stringEqual(name, "start") ? { start: was.start } : stringEqual(name, "end") ? { end: was.end }
            : stringEqual(name, "position") ? { position: was.position } : { activity: was.activity });
    }, [was, change]);
    if (roles === undefined || form === undefined) return <Box role="alert" css={styles.error}>{words.m.formFailed()}</Box>;
    const person = roles.resource.type === "some" && stringEqual(roles.resource.value.kind, PEOPLE);
    const onReset = readOnly || was === undefined ? undefined : reset;
    return (
        <>
            <TimesFields form={form} baseline={was} readOnly={readOnly} words={formWords} onChange={change} onReset={onReset} />
            <AssignmentFields group={roles.group} person={person} form={form} baseline={was} value={value} readOnly={readOnly} words={formWords}
                onChange={change} onReset={onReset} />
            <KindPart kind={duty.kind} specs={duty.kind.fields} rowKey={rowKey} row={row} baseline={baseline} readOnly={readOnly} words={words}
                formWords={formWords} storageKey={storageKey} styles={styles} onRow={onRow} />
        </>
    );
}

/** An event, as the Calendar's inspector draws one: the paged resource kind's Chooser given to its fields, where a kind pages. */
function CalendarForm({ calendar, ...props }: FormProps & { readonly calendar: KindOf<"calendar"> }) {
    const kind = calendar.events.find(k => stringEqual(k.key, calendar.event));
    const paged = getSomeorUndefined(calendar.paged);
    const locale = props.words.locale;
    const chooser = useMemo((): CalendarChooser | undefined => (paged === undefined ? undefined : {
        paged,
        noun: (calendar.resources.find(r => stringEqual(r.key, paged.kind))?.name ?? paged.kind).toLocaleLowerCase(locale),
        nameOf: NO_NAME,
    }), [paged, calendar.resources, locale]);
    if (kind === undefined) return null;
    return (
        <CalendarChooserContext.Provider value={chooser}>
            <CalendarKindForm kind={kind} calendar={calendar} {...props} />
        </CalendarChooserContext.Provider>
    );
}

/**
 * An event's form, the Calendar's inspector's: its title and status, its placement — refused as the Calendar refuses
 * one before its `canDrop` — then its kind's own form, else its other fields.
 */
function CalendarKindForm({ kind, calendar, rowKey, row, baseline, readOnly, words, formWords, storageKey, styles, onRow }:
    FormProps & { readonly kind: ScheduleKind; readonly calendar: KindOf<"calendar"> }) {
    const form = useMemo(() => calendarEventForm(kind), [kind]);
    const codec = rowCodec(kind.editing.entryType);
    const value = useMemo(() => codec.decode(row), [codec, row]);
    const was = useMemo(() => (baseline === undefined ? undefined : codec.decode(baseline)), [codec, baseline]);
    // Every resource is offered: the queue has no rail.
    const options = useMemo(() => calendarFieldOptions(calendar.resources, calendar.resources, kind.fields, value), [calendar.resources, kind.fields, value]);
    const onField = useKindField(kind, rowKey, row, onRow);
    const renderControl = useReferenceControl(value, readOnly, onField);
    const reset = useFieldReset(was, onField);
    // Its placement and the one it is told from, as the kind reads an event off its row: tracked, as the kind's read may read the app's data.
    const readPlacement = useCallback(() => ({
        at: placementOf(kind, rowKey, row),
        was: baseline === undefined ? undefined : placementOf(kind, rowKey, baseline),
    }), [kind, rowKey, row, baseline]);
    const { result: placed } = useTrackedEvaluation(readPlacement);
    useEffect(() => {
        if (!placed.ok) console.error("[DecisionQueue] an event's placement could not be read:", placed.error);
    }, [placed]);
    const place = useCallback((at: CalendarPlacement) => {
        const refused = placementRefusal(kind, at, calendar.resources, calendar.paged);
        if (refused !== undefined) {
            onRow(undefined, refused);
            return;
        }
        onRow(tried("an event's placement could not be written", () => getSomeorUndefined(
            kind.write([{ id: rowKey, entry: row, gesture: variant("place", { start: at.start, end: at.end, resource: at.resource }) }])[0] ?? none)));
    }, [kind, calendar.resources, calendar.paged, rowKey, row, onRow]);
    return (
        <>
            <FieldForm specs={form.roles} value={value} baseline={was} options={options} renderControl={renderControl} readOnly={readOnly} words={formWords}
                onChange={onField} onReset={readOnly ? undefined : reset} />
            {placed.ok && placed.value.at !== undefined && (
                <PlacementFields takes={kind.takes} resources={calendar.resources} shown={calendar.resources} placement={placed.value.at} baseline={placed.value.was}
                    readOnly={readOnly} words={formWords} onChange={place} />
            )}
            <OwnOrFields own={getSomeorUndefined(kind.inspector)} specs={form.fields} value={value} was={was} options={options} renderControl={renderControl}
                row={row} readOnly={readOnly} words={words} formWords={formWords} storageKey={storageKey} styles={styles} onField={onField} onRow={onRow} />
        </>
    );
}

/** An event, as the Plan's inspector draws its kind's form: over the fields its roles leave, or the kind's own. */
function PlanForm({ plan, record: _record, ...props }: FormProps & { readonly plan: KindOf<"plan"> }) {
    const kind = plan.events.find(k => stringEqual(k.key, plan.event));
    const specs = useMemo(() => (kind === undefined ? NO_SPECS : planFormSpecs(kind)), [kind]);
    return kind === undefined ? null : <KindPart kind={kind} specs={specs} {...props} />;
}

/**
 * A bin, as the Allocation's inspector draws one (A57): its lane — the shared segments — its time, printed, and its
 * quantity, no less than its parts take, a part wholly holding it following it; then the bin kind's own form, else its
 * fields.
 */
function AllocationForm({ allocation, rowKey, row, baseline, readOnly, words, formWords, storageKey, styles, onRow }:
    FormProps & { readonly allocation: KindOf<"allocation"> }) {
    const { bin, labels, lanes } = allocation;
    const roles = useMemo(() => tried("a bin's roles could not be read", () => bin.read(row)), [bin, row]);
    const held = useMemo(() => (baseline === undefined ? undefined : tried("a bin's roles could not be read", () => bin.read(baseline))), [bin, baseline]);
    const min = roles === undefined ? 0 : quantityFloor(roles);
    const unit = getSomeorUndefined(bin.unit) ?? "";
    const own = bin.kind.inspector.type === "some";
    const specs = useMemo(() => binFormSpecs({ lane: labels.lane.one, quantity: labels.quantity }, min, unit, own), [labels.lane.one, labels.quantity, min, unit, own]);
    const options = useMemo(() => ({ lanes: lanes.map(l => ({ key: l.key, label: l.label })) }), [lanes]);
    const value = useMemo(() => (roles === undefined ? undefined : { lane: roles.lane, at: roles.at, quantity: roles.quantity }), [roles]);
    const was = useMemo(() => (held === undefined ? undefined : { lane: held.lane, at: held.at, quantity: held.quantity }), [held]);
    const write = useCallback((next: NonNullable<typeof roles>) => onRow(tried("a bin's edit could not be written", () => bin.write(row, next))), [bin, row, onRow]);
    const setLane = useCallback((lane: string) => {
        if (roles !== undefined) write({ ...roles, lane });
    }, [roles, write]);
    const onField = useCallback((path: readonly string[], next: unknown) => {
        if (roles === undefined) return;
        const name = path[0] ?? "";
        if (stringEqual(name, "lane")) {
            setLane(next as string);
            return;
        }
        if (!stringEqual(name, "quantity")) return;
        const quantity = next as number;
        const set = quantitySet(roles, quantity);
        if (set === false) {
            onRow(undefined);
            return;
        }
        const parts = new SortedMap(roles.parts, compareString);
        if (set.part !== undefined) parts.set(set.part, quantity);
        write({ ...roles, quantity, parts });
    }, [roles, setLane, write, onRow]);
    const reset = useFieldReset(was, onField);
    const lane = roles?.lane ?? "";
    const renderControl = useCallback((spec: FieldSpecValue) => (stringEqual(spec.path[0] ?? "", "lane")
        ? <BinLaneSegments label={labels.lane.one} lanes={lanes} lane={lane} onPick={setLane} /> : undefined), [labels.lane.one, lanes, lane, setLane]);
    if (value === undefined) return <Box role="alert" css={styles.error}>{words.m.formFailed()}</Box>;
    return (
        <>
            <FieldForm specs={specs} value={value} baseline={was} options={options} renderControl={readOnly ? undefined : renderControl} readOnly={readOnly}
                words={formWords} onChange={onField} onReset={readOnly ? undefined : reset} />
            <KindPart kind={bin.kind} specs={bin.kind.fields} rowKey={rowKey} row={row} baseline={baseline} readOnly={readOnly} words={words}
                formWords={formWords} storageKey={storageKey} styles={styles} onRow={onRow} />
        </>
    );
}

/**
 * A row, as the Sheet's inspector draws one: its row form over the row's own fields — a select its register's members,
 * the id field printed, as the form prints a read-only column — or the author's own Details; none where the form is
 * none of the record's rows.
 */
function SheetForm({ sheet, record, row, baseline, readOnly, words, formWords, storageKey, styles, onRow }: FormProps & { readonly sheet: KindOf<"sheet"> }) {
    const payload = sheet.sheet;
    const pane = getSomeorUndefined(payload.inspector);
    // A grouped sheet's form is a line's: the record's row is its group.
    const form = pane !== undefined && sameTypeValue(pane.forms.row.type, record.editing.entryType) ? pane.forms.row : undefined;
    const codec = rowCodec(record.editing.entryType);
    const rowType = useMemo(() => fromEastTypeValue(record.editing.entryType) as StructType, [record.editing.entryType]);
    const idField = getSomeorUndefined(payload.sheet.editing.idField);
    const specs = useMemo(() => (form === undefined ? NO_SPECS : form.fields.filter(f => fieldTypeHolds(rowType, f.spec)).map((f): FieldSpecValue => (
        idField !== undefined && stringEqual(f.spec.path[0] ?? "", idField) ? { ...f.spec, editor: variant("readonly", null) } : sheetFieldSpec(f.spec)))),
    [form, rowType, idField]);
    const registers = useMemo(() => indexRegisters(payload.sheet.registers), [payload.sheet.registers]);
    const options = useMemo(() => (form === undefined ? undefined : sheetFieldOptions(form.fields, registers, EVERY_MEMBER)), [form, registers]);
    const value = useMemo(() => codec.decode(row), [codec, row]);
    const was = useMemo(() => (baseline === undefined ? undefined : codec.decode(baseline)), [codec, baseline]);
    const onField = useCallback((path: readonly string[], next: unknown) => onRow(tried("an edit of a field could not be written",
        () => codec.encode(withField(codec.decode(row), path, next)))), [codec, row, onRow]);
    if (form === undefined) return null;
    return (
        <OwnOrFields own={getSomeorUndefined(pane?.custom ?? none)} specs={specs} value={value} was={was} options={options} row={row} readOnly={readOnly}
            words={words} formWords={formWords} storageKey={storageKey} styles={styles} onField={onField} onRow={onRow} />
    );
}
