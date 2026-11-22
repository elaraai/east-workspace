/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A visual's alerts, from its header (#1674): a bell beside its menu — plain
 * with no alert, marked while one of its alerts fires — whose popover lists
 * them, each by its name and where it stands (`alert-row.tsx`: the row every
 * flush popover's list draws), and edits one: its name; its
 * condition, the query builder's condition rows over the visual's rows — its
 * groups, then its values (`filter-editor.tsx`); whether it is paused; and Now,
 * the rows over the line now as a result table, asked as the popover opens on
 * it and on Run, never on an edit. Its condition is a draft: what its rows say
 * as they stand, so one with no finished row — its last removed, or its only
 * one being rewritten — says a condition is needed, and Save waits for it.
 * Save writes one patch on the alerts record;
 * Delete confirms in the popover. A new alert starts from the visual's first
 * value — under its goal where it has one, else above a number to write — and
 * the page's filters as it is made. Two people saving one alert meet a
 * conflict that names it, and nothing is overwritten; a visual of more rows
 * than an alert watches is refused at Save, with the count. The rules are
 * `alerts.ts`'s and the query layer's (`query/visual/alert.ts`); this draws.
 *
 * @packageDocumentation
 */

import { useCallback, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Button as ChakraButton, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell } from "@fortawesome/free-solid-svg-icons";
import { ArrayType, StructType, none, some, type JqNode } from "@elaraai/east";
import { EastChakraCheckbox, EastChakraTable, SliceEditPopover, useFormatters } from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { resultTable } from "../query/results-table.js";
import { ALERT_ROW_LIMIT, alertConditionOf, alertQuery, alertRowType, alertRowsStage, alertStart, printAlert } from "../query/visual/alert.js";
import type { VisualAnswer } from "../query/visual/ask.js";
import { useVisualAnswers, useVisualAsk, useVisualMinute, useVisualRoot } from "../query/visual/answers.js";
import { printStateOf, type ConditionDraft, type PageFilter } from "../query/visual/filters.js";
import type { PrintSource, PrintState, VisualAsk } from "../query/visual/print.js";
import type { StepQuery } from "../query/steps/values.js";
import { useQueryWords } from "../query/words.js";
import { messageOf } from "../shared/message.js";
import { useAlertsRead, useSaveAlerts, useStudioAlerts, type StudioAlerts } from "./alert-context.js";
import { AlertRow } from "./alert-row.js";
import { alertChanges, alertNameRefusal, isFiring, placementAlerts, type Alert, type AlertWrite, type Alerts } from "./alerts.js";
import { ConditionEditor } from "./filter-editor.js";
import { useStudioMessages, type StudioMessages } from "./messages.js";
import { usePageFilters } from "./page-filters.js";
import { problemOf } from "./visual/notes.js";
import type { Visual } from "./visual/values.js";

/** No programs: what Now asks while its condition is unfinished. */
const NO_ASKS: readonly VisualAsk[] = [];
/** No filters: a new alert's on a page that holds none. */
const NO_FILTERS: readonly PageFilter[] = [];

/** One of a visual's alerts, by its name. */
interface Held {
    readonly name: string;
    readonly alert: Alert;
}

/** A write's request id: fresh for every Save, so a retry of one resolves to its commit and no other. */
function requestId(): string {
    return globalThis.crypto.randomUUID();
}

/** Where an alert stands, as its row in the list says it: firing since, cleared, paused or watching. */
function statusOf(alert: Alert, m: StudioMessages, at: (instant: Date) => string): { readonly kind: "firing" | "cleared" | "paused" | "watching"; readonly words: string } {
    if (isFiring(alert) && alert.firing.type === "some") return { kind: "firing", words: m.alertStatus({ status: "firing", at: at(alert.firing.value.at) }) };
    if (alert.paused) return { kind: "paused", words: m.alertStatus({ status: "paused" }) };
    if (alert.firing.type === "some" && alert.firing.value.cleared.type === "some") {
        return { kind: "cleared", words: m.alertStatus({ status: "cleared", at: at(alert.firing.value.cleared.value) }) };
    }
    return { kind: "watching", words: m.alertStatus({ status: "watching" }) };
}

/** Props of {@link VisualAlerts}. */
export interface VisualAlertsProps {
    /** The visual. */
    readonly visual: Visual;
    /** Its name, as its eyebrow says it: its alerts' popover's head, and a new alert's name. */
    readonly name: string;
    /** Its source, as the printer reads it. */
    readonly read: PrintSource;
    /** Its placement's key: what its alerts name; `undefined` outside a layout, which shows no bell. */
    readonly placement: string | undefined;
}

/**
 * A visual's bell and its alerts' popover — see the module docs.
 *
 * @param props - The visual, its name, its source and its placement
 * @returns The bell; nothing where the page was given no alerts, or the visual stands in no layout
 */
export function VisualAlerts({ visual, name, read, placement }: VisualAlertsProps) {
    const studio = useStudioAlerts();
    const alerts = useAlertsRead(studio?.handle);
    if (studio === undefined || placement === undefined || alerts === undefined) return null;
    return <AlertsBell visual={visual} name={name} read={read} placement={placement} studio={studio} alerts={alerts} />;
}

/** Props of {@link AlertsBell}: the visual's, its page's alerts, and the record as it stands. */
interface AlertsBellProps extends Omit<VisualAlertsProps, "placement"> {
    readonly placement: string;
    readonly studio: StudioAlerts;
    readonly alerts: Alerts;
}

/** The bell, and its popover: the visual's alerts listed, or one edited. */
function AlertsBell({ visual, name, read, placement, studio, alerts }: AlertsBellProps) {
    const m = useStudioMessages();
    const f = useFormatters();
    const styles = useSlotStyles("studioVisual");
    const iconButton = useRecipe({ key: "iconButton" });
    const mine = useMemo(() => placementAlerts(alerts, studio.page, placement), [alerts, studio.page, placement]);
    const firing = mine.filter((held) => isFiring(held.alert)).length;
    const [open, setOpen] = useState(false);
    // What the popover shows: the visual's alerts — or, while it has none, a new one — or the one being edited.
    const [editing, setEditing] = useState<{ readonly held: Held | undefined } | undefined>(undefined);
    const onOpenChange = useCallback((next: boolean) => {
        setOpen(next);
        if (next) setEditing(undefined);
    }, []);
    const label = m.alertsOf({ name });
    const said = firing === 0 ? label : `${label} · ${m.alertsFiring({ n: firing, count: f.number(firing) })}`;
    const trigger = (
        <chakra.button type="button" css={[iconButton({ variant: "ghost", size: "2xs" }), styles.bell]} aria-label={said} title={said}
            data-studio-alert-bell="" data-firing={firing > 0 ? "" : undefined}>
            <FontAwesomeIcon icon={faBell} />
        </chakra.button>
    );
    // One popover, whichever it shows: the editor draws its foot's actions into the popover's foot.
    const [footLeft, setFootLeft] = useState<HTMLElement | null>(null);
    const [footActions, setFootActions] = useState<HTMLElement | null>(null);
    const edited = editing ?? (mine.length === 0 ? { held: undefined } : undefined);
    return (
        <SliceEditPopover trigger={trigger} open={open} onOpenChange={onOpenChange} label={edited === undefined ? label : edited.held?.name ?? m.newAlert()} size="lg"
            flush={edited === undefined}
            footLeft={edited === undefined ? undefined : <Box as="span" ref={setFootLeft} css={styles.alertFoot} />}
            footActions={edited === undefined
                ? <ChakraButton type="button" variant="outline" size="xs" data-studio-new-alert="" onClick={() => setEditing({ held: undefined })}>{m.newAlert()}</ChakraButton>
                : <Box as="span" ref={setFootActions} css={styles.alertFoot} />}>
            {edited === undefined ? (
                <Box css={styles.alerts} data-studio-alerts="">
                    {mine.map((held) => {
                        const status = statusOf(held.alert, m, (at) => f.dateTime(at));
                        return <AlertRow key={held.name} name={held.name} status={status.kind} words={status.words} onOpen={() => setEditing({ held })} />;
                    })}
                </Box>
            ) : (
                <AlertEditor key={edited.held?.name ?? ""} visual={visual} name={name} read={read} placement={placement} studio={studio} alerts={alerts}
                    held={edited.held} foot={{ left: footLeft, actions: footActions }}
                    onBack={mine.length === 0 ? () => setOpen(false) : () => setEditing(undefined)} />
            )}
        </SliceEditPopover>
    );
}

/** Props of {@link AlertEditor}. */
interface AlertEditorProps extends AlertsBellProps {
    /** The alert edited; `undefined` for a new one. */
    readonly held: Held | undefined;
    /** The popover's foot, which its actions are drawn into: its left, and its actions' cluster; `null` until they are drawn. */
    readonly foot: { readonly left: HTMLElement | null; readonly actions: HTMLElement | null };
    /** Leaves it: back to the visual's alerts, or — where it has none — the popover closed. */
    readonly onBack: () => void;
}

/** One alert, edited in the bell's popover: its name, its condition, its pause, Now, Delete and Save. */
function AlertEditor({ visual, name, read, placement, studio, alerts, held, foot: slots, onBack }: AlertEditorProps) {
    const m = useStudioMessages();
    const f = useFormatters();
    const words = useQueryWords();
    const edit = useSlotStyles("sliceEdit");
    const input = useRecipe({ key: "input" })({});
    const formId = useId();
    const root = useVisualRoot();
    const minute = useVisualMinute();
    const ask = useVisualAsk(visual.source);
    const save = useSaveAlerts(studio.handle);
    const pageFilters = usePageFilters()?.filters ?? NO_FILTERS;
    // The visual's rows as the condition rows read them, their type, and where a new alert starts.
    const stage = useMemo(() => alertRowsStage(visual, read), [visual, read]);
    const rows = "kind" in stage ? undefined : stage;
    const row = useMemo(() => (rows === undefined || root === undefined ? undefined : alertRowType(rows, read, root.type)), [rows, read, root]);
    const start = useMemo(() => (rows === undefined || row === undefined || held !== undefined ? undefined : alertStart(visual, rows.fields, row)), [rows, row, held, visual]);
    const opened = held?.alert.condition ?? (start !== undefined && "condition" in start ? start.condition : undefined);
    const [alertName, setAlertName] = useState(held?.name ?? m.alertNameFor({ name }));
    const [condition, setCondition] = useState<JqNode | undefined>(opened);
    const [paused, setPaused] = useState(held?.alert.paused ?? false);
    // A new alert's filters are the page's as it is made; an alert's own stay its own.
    const [filters] = useState<readonly PageFilter[]>(held?.alert.filters ?? pageFilters);
    // Now: asked for the condition it opened with, then each one Run asks for — never an edit.
    const [now, setNow] = useState<JqNode | undefined>(opened);
    const [busy, setBusy] = useState(false);
    const [refused, setRefused] = useState<string | undefined>(undefined);
    const [confirming, setConfirming] = useState(false);
    const stateOf = useCallback((): PrintState => (minute === undefined ? { filters: [] } : printStateOf(filters, visual.source, read, minute)), [filters, visual.source, read, minute]);
    const query = useCallback((): StepQuery => alertQuery(rows!, row!, read, held?.alert.condition ?? start), [rows, row, read, held, start]);
    const conditionOf = useCallback((edited: StepQuery) => alertConditionOf(edited, row!), [row]);
    // Its condition is what its rows say as they stand: none, while no row is finished.
    const onDraft = useCallback((draft: ConditionDraft) => setCondition(draft.kind === "condition" ? draft.where : undefined), []);
    const printedNow = useMemo(() => (now === undefined ? undefined : printAlert(visual, read, stateOf(), now)), [now, visual, read, stateOf]);
    const nowAsks = printedNow?.kind === "ask" ? [printedNow.ask] : NO_ASKS;
    const asked = useVisualAnswers(nowAsks, visual.source);
    const trimmed = alertName.trim();
    const nameRefusal = alertNameRefusal(trimmed, alerts, held?.name);
    const writeOf = useCallback(async (writes: readonly AlertWrite[], label: string) => {
        const result = await save(alertChanges(writes, label, requestId()));
        if (result.type === "applied") return undefined;
        return result.value.map((issue) => m.alertConflict({ name: issue.entry === "" ? trimmed : issue.entry, why: issue.message })).join(" ");
    }, [save, m, trimmed]);
    const onSave = useCallback(async () => {
        if (nameRefusal !== undefined || condition === undefined || busy) return;
        setBusy(true);
        setRefused(undefined);
        try {
            // How many rows the visual has: an alert watches at most ALERT_ROW_LIMIT of them (ALR-6).
            const printed = printAlert(visual, read, stateOf(), condition);
            if (printed.kind !== "ask") {
                setRefused(m.alertCannot());
                return;
            }
            const [answer] = await ask([printed.ask]);
            if (answer?.kind === "problem") {
                setRefused(problemOf(answer, m));
                return;
            }
            if (answer !== undefined && answer.groups > ALERT_ROW_LIMIT) {
                setRefused(m.alertTooMany({ count: f.number(answer.groups), limit: f.number(ALERT_ROW_LIMIT) }));
                return;
            }
            const after: Alert = { page: studio.page, cell: placement, condition, filters: [...filters], paused, firing: held?.alert.firing ?? none };
            // A rename deletes the old name and writes the new, in one patch.
            const writes: AlertWrite[] = held === undefined || held.name === trimmed
                ? [{ name: trimmed, before: held?.alert, after }]
                : [{ name: held.name, before: held.alert, after: undefined }, { name: trimmed, before: undefined, after }];
            const why = await writeOf(writes, held === undefined ? m.newAlert() : m.alertSave());
            if (why === undefined) onBack();
            else setRefused(why);
        } catch (err) {
            setRefused(messageOf(err));
        } finally {
            setBusy(false);
        }
    }, [nameRefusal, condition, busy, visual, read, stateOf, ask, m, f, studio.page, placement, filters, paused, held, trimmed, writeOf, onBack]);
    const onDelete = useCallback(async () => {
        if (held === undefined || busy) return;
        setBusy(true);
        setRefused(undefined);
        try {
            const why = await writeOf([{ name: held.name, before: held.alert, after: undefined }], m.alertDelete());
            if (why === undefined) onBack();
            else {
                setConfirming(false);
                setRefused(why);
            }
        } catch (err) {
            setRefused(messageOf(err));
        } finally {
            setBusy(false);
        }
    }, [held, busy, writeOf, m, onBack]);
    const pausedBox = useMemo(() => ({
        checked: paused, label: some(m.alertPaused()), indeterminate: none, disabled: none, style: none,
        onChange: some((next: boolean) => { setPaused(next); return null; }),
    }), [paused, m]);
    const foot = confirming
        ? {
            left: <Box as="span" css={edit.hint} data-studio-alert-confirm="">{m.alertDeleteConfirm({ name: held?.name ?? trimmed })}</Box>,
            actions: (
                <>
                    <ChakraButton type="button" variant="outline" size="xs" disabled={busy} onClick={() => setConfirming(false)}>{m.alertKeep()}</ChakraButton>
                    <ChakraButton type="button" variant="outline" size="xs" loading={busy} data-studio-alert-delete-confirmed="" onClick={() => { void onDelete(); }}>{m.alertDelete()}</ChakraButton>
                </>
            ),
        }
        : {
            left: held === undefined ? undefined : (
                <ChakraButton type="button" variant="outline" size="xs" disabled={busy} data-studio-alert-delete="" onClick={() => setConfirming(true)}>{m.alertDelete()}</ChakraButton>
            ),
            actions: (
                <>
                    <ChakraButton type="button" variant="outline" size="xs" disabled={busy} onClick={onBack}>{m.cancel()}</ChakraButton>
                    <ChakraButton type="submit" form={formId} variant="outline" size="xs" loading={busy} disabled={nameRefusal !== undefined || condition === undefined}
                        data-studio-alert-save="">{m.alertSave()}</ChakraButton>
                </>
            ),
        };
    return (
        <>
            {slots.left !== null && foot.left !== undefined && createPortal(foot.left, slots.left)}
            {slots.actions !== null && createPortal(foot.actions, slots.actions)}
            {rows === undefined || row === undefined || root === undefined ? (
                <Box as="span" css={edit.hint} data-studio-alert-cannot="">{m.alertCannot()}</Box>
            ) : (
                <chakra.form id={formId} css={edit.form} noValidate data-studio-alert-editor=""
                    onSubmit={(e: React.FormEvent) => { e.preventDefault(); void onSave(); }}>
                    <Box css={edit.field}>
                        <chakra.label htmlFor={`${formId}-name`} css={edit.fieldLabel}>{m.alertName()}</chakra.label>
                        <chakra.input id={`${formId}-name`} css={input} value={alertName} autoComplete="off" aria-invalid={nameRefusal === "taken" ? true : undefined}
                            data-studio-alert-name="" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAlertName(e.target.value)} />
                        {nameRefusal === "missing" && <Box as="span" css={edit.hint}>{m.alertNameMissing()}</Box>}
                        {nameRefusal === "taken" && <Box as="span" css={edit.hintError}>{m.alertNameTaken({ name: trimmed })}</Box>}
                    </Box>
                    <Box css={edit.field}>
                        <Box as="span" css={edit.fieldLabel}>{m.alertCondition()}</Box>
                        <ConditionEditor id={`alert:${placement}:${held?.name ?? ""}`} query={query} held={opened} conditionOf={conditionOf} root={root} onDraft={onDraft} />
                        {condition === undefined && <Box as="span" css={edit.hint}>{m.alertUnfinished()}</Box>}
                    </Box>
                    <EastChakraCheckbox value={pausedBox} />
                    <AlertNow asked={asked} waiting={now === undefined} words={words} onRun={condition === undefined ? undefined : () => setNow(condition)} />
                    {refused !== undefined && <Box as="span" role="alert" css={edit.hintError} data-studio-alert-refused="">{refused}</Box>}
                </chakra.form>
            )}
        </>
    );
}

/** Props of {@link AlertNow}. */
interface AlertNowProps {
    /** Now's answer, as the page's answers give it. */
    readonly asked: ReturnType<typeof useVisualAnswers>;
    /** Whether it has no condition to ask yet. */
    readonly waiting: boolean;
    /** The query builder's words, which its table prints with. */
    readonly words: ReturnType<typeof useQueryWords>;
    /** Runs it again for the condition as it stands; `undefined` while that is unfinished. */
    readonly onRun: (() => void) | undefined;
}

/** Now: the visual's rows that meet the condition now, as a result table, and how many of how many. */
function AlertNow({ asked, waiting, words, onRun }: AlertNowProps) {
    const m = useStudioMessages();
    const f = useFormatters();
    const styles = useSlotStyles("studioVisual");
    const answer: VisualAnswer | undefined = asked.status === "answered" ? asked.answers[0] : undefined;
    const table = useMemo(() => (answer?.kind !== "answered" ? undefined
        : resultTable({ type: ArrayType(StructType([...answer.columns])), value: answer.rows }, words)), [answer, words]);
    let note: string | undefined;
    if (waiting) note = m.alertNowWaits();
    else if (asked.status === "failed") note = asked.message;
    else if (answer?.kind === "problem") note = problemOf(answer, m);
    else if (answer?.kind === "answered") {
        const of = f.number(answer.groups);
        note = answer.rows.length === 0 ? m.alertNowNone({ total: answer.groups, of })
            : m.alertNowCount({ n: answer.rows.length, count: f.number(answer.rows.length), total: answer.groups, of });
    }
    return (
        <Box css={styles.alertNow} data-studio-alert-now={asked.status}>
            <Box css={styles.alertNowHead}>
                <Box as="span" css={styles.alertNowLabel}>{m.alertNow()}</Box>
                <ChakraButton type="button" variant="outline" size="xs" disabled={onRun === undefined} data-studio-alert-run="" onClick={onRun}>{m.alertRun()}</ChakraButton>
            </Box>
            {table !== undefined && answer?.kind === "answered" && answer.rows.length > 0 && (
                <Box css={styles.alertTable} data-studio-alert-rows="">
                    <EastChakraTable value={table} storageKey="studio.alert.now" tile />
                </Box>
            )}
            {note !== undefined && <Box as="span" css={styles.note}>{note}</Box>}
        </Box>
    );
}
