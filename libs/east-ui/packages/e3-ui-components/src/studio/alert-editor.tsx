/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A visual's alerts, listed, and one of them edited (#1674): what its bell's
 * popover (`alert-popover.tsx`) and the builder's inspector
 * (`alert-section.tsx`) both draw.
 *
 * - **The list** ({@link AlertList}): each alert by its name and where it
 *   stands (`alert-row.tsx`: the row every flush popover's list draws) —
 *   firing or cleared since when, on the reader's own clock (`localDateTime`,
 *   ruled 23 November 2026).
 * - **The editor** ({@link AlertEditor}): its name; its condition, the query
 *   builder's condition rows over the visual's rows, as its check reads them
 *   under its filters — its groups, then its values (`filter-editor.tsx`), their
 *   ranges and the values offered those rows' own; whether it is paused; and Now, the rows over
 *   the line now as a table — its numbers in their fields' formats
 *   (`alert-rows.ts`) — asked as the editor opens and on Run, never on an edit. Its condition is a draft: what its rows say as they stand, so
 *   one with no finished row — its last removed, or its only one being
 *   rewritten — says a condition is needed, and Save waits for it. Save writes
 *   one patch on the alerts record; Delete confirms in place. A new alert
 *   starts from the visual's first value — under its goal where it has one,
 *   else above a number to write — and the page's filters as it is made. Two
 *   people saving one alert meet a conflict that names it, and nothing is
 *   overwritten; a visual of more rows than an alert watches is refused at
 *   Save, with the count. Its actions — Delete, Cancel and Save — are drawn
 *   into the foot its host gives it: a popover's, or the inspector's own.
 *
 * The rules are `alerts.ts`'s and the query layer's (`query/visual/alert.ts`);
 * this draws.
 *
 * @packageDocumentation
 */

import { useCallback, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Button as ChakraButton, chakra, useRecipe } from "@chakra-ui/react";
import { ArrayType, StructType, none, some, type JqNode } from "@elaraai/east";
import { EastChakraCheckbox, EastChakraTable, useFormatters } from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { ALERT_ROW_LIMIT, alertConditionOf, alertQuery, alertRowType, alertRowsStage, alertStart, printAlert, type AlertField } from "../query/visual/alert.js";
import type { VisualAnswer } from "../query/visual/ask.js";
import { useVisualAnswers, useVisualAsk, useVisualMinute, useVisualRoot, useVisualSource } from "../query/visual/answers.js";
import { printStateOf, type ConditionDraft, type PageFilter } from "../query/visual/filters.js";
import type { PrintSource, PrintState, VisualAsk } from "../query/visual/print.js";
import type { StepQuery } from "../query/steps/values.js";
import { useQueryWords } from "../query/words.js";
import { messageOf } from "../shared/message.js";
import { useSaveAlerts, type StudioAlerts } from "./alert-context.js";
import { AlertRow } from "./alert-row.js";
import { alertRowsTable } from "./alert-rows.js";
import { alertChanges, alertNameRefusal, isFiring, type Alert, type AlertWrite, type Alerts } from "./alerts.js";
import { ConditionEditor } from "./filter-editor.js";
import { useStudioMessages, type StudioMessages } from "./messages.js";
import { usePageFilters } from "./page-filters.js";
import { problemOf } from "./visual/notes.js";
import type { Visual, VisualSource } from "./visual/values.js";

/** No programs: what Now asks while its condition is unfinished. */
const NO_ASKS: readonly VisualAsk[] = [];
/** No fields: Now's rows' while its condition is unfinished. */
const NO_FIELDS: readonly AlertField[] = [];
/** No filters: a new alert's on a page that holds none. */
const NO_FILTERS: readonly PageFilter[] = [];

/** One of a visual's alerts, by its name. */
export interface HeldAlert {
    /** Its name: its key in the record. */
    readonly name: string;
    /** The alert. */
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

/** Props of {@link AlertList}. */
export interface AlertListProps {
    /** The visual's alerts, in the record's order. */
    readonly alerts: readonly HeldAlert[];
    /** Opens one: its editor. */
    readonly onOpen: (held: HeldAlert) => void;
}

/**
 * A visual's alerts, listed: each a row, its name over where it stands —
 * firing since when, cleared, paused or watching.
 *
 * @param props - The alerts, and what opens one
 * @returns The list
 */
export function AlertList({ alerts, onOpen }: AlertListProps) {
    const m = useStudioMessages();
    const f = useFormatters();
    const styles = useSlotStyles("studioVisual");
    return (
        <Box css={styles.alerts} data-studio-alerts="">
            {alerts.map((held) => {
                const status = statusOf(held.alert, m, (at) => f.localDateTime(at));
                return <AlertRow key={held.name} name={held.name} status={status.kind} words={status.words} onOpen={() => onOpen(held)} />;
            })}
        </Box>
    );
}

/** Props of {@link AlertEditor}. */
export interface AlertEditorProps {
    /** The visual. */
    readonly visual: Visual;
    /** Its name, as its eyebrow says it: what a new alert is named after. */
    readonly name: string;
    /** Its source, as the printer reads it. */
    readonly read: PrintSource;
    /** Its placement's key: what its alerts name. */
    readonly placement: string;
    /** The page's alerts: the record, bound, and the page. */
    readonly studio: StudioAlerts;
    /** The record as it stands. */
    readonly alerts: Alerts;
    /** The alert edited; `undefined` for a new one. */
    readonly held: HeldAlert | undefined;
    /** Its host's foot, which its actions are drawn into: its start, and its actions' cluster; `null` until they are drawn. */
    readonly foot: { readonly left: HTMLElement | null; readonly actions: HTMLElement | null };
    /** Leaves it: back to the visual's alerts, or — where it has none — its host closed. */
    readonly onBack: () => void;
}

/**
 * One alert, edited: its name, its condition, its pause, Now, and — in its
 * host's foot — Delete, Cancel and Save. See the module docs.
 *
 * @param props - The visual and its alerts, the alert edited, its host's foot, and what leaves it
 * @returns The editor's fields; its actions through portals into the foot
 */
export function AlertEditor({ visual, name, read, placement, studio, alerts, held, foot: slots, onBack }: AlertEditorProps) {
    const m = useStudioMessages();
    const f = useFormatters();
    const words = useQueryWords();
    const edit = useSlotStyles("sliceEdit");
    const input = useRecipe({ key: "input" })({});
    const formId = useId();
    const root = useVisualRoot();
    const minute = useVisualMinute();
    const ask = useVisualAsk(visual.source);
    // Its source, as the surface lists it: the formats Now prints its numbers in.
    const source = useVisualSource(visual.source);
    const save = useSaveAlerts(studio.handle);
    const pageFilters = usePageFilters()?.filters ?? NO_FILTERS;
    // A new alert's filters are the page's as it is made; an alert's own stay its own.
    const [filters] = useState<readonly PageFilter[]>(held?.alert.filters ?? pageFilters);
    // The alert's filters as the printer reads them, at a minute of the page's.
    const stateAt = useCallback((at: Date | undefined): PrintState => (at === undefined ? { filters: [] } : printStateOf(filters, visual.source, read, at)), [filters, visual.source, read]);
    const stateOf = useCallback((): PrintState => stateAt(minute), [stateAt, minute]);
    // The visual's rows as the condition rows read them — the rows its check reads, under the alert's filters, so the
    // ranges and the values they offer are of what it watches (ruled 22 November 2026) — their type, and where a new
    // alert starts. Read at the minute the editor opened, as its condition rows hold them from then: a minute moving on
    // reads none again. Where the filters leave the check no rows to read — a value over another period, on a page with
    // no dates — every row of the source: its condition can still be written, and Now says why it cannot be checked.
    const [openedAt] = useState(minute);
    const stage = useMemo(() => {
        const checked = alertRowsStage(visual, read, stateAt(openedAt));
        return "kind" in checked ? alertRowsStage(visual, read) : checked;
    }, [visual, read, stateAt, openedAt]);
    const rows = "kind" in stage ? undefined : stage;
    const row = useMemo(() => (rows === undefined || root === undefined ? undefined : alertRowType(rows, read, root.type)), [rows, read, root]);
    const start = useMemo(() => (rows === undefined || row === undefined || held !== undefined ? undefined : alertStart(visual, rows.fields, row)), [rows, row, held, visual]);
    const opened = held?.alert.condition ?? (start !== undefined && "condition" in start ? start.condition : undefined);
    const [alertName, setAlertName] = useState(held?.name ?? m.alertNameFor({ name }));
    const [condition, setCondition] = useState<JqNode | undefined>(opened);
    const [paused, setPaused] = useState(held?.alert.paused ?? false);
    // Now: asked for the condition it opened with, then each one Run asks for — never an edit.
    const [now, setNow] = useState<JqNode | undefined>(opened);
    const [busy, setBusy] = useState(false);
    const [refused, setRefused] = useState<string | undefined>(undefined);
    const [confirming, setConfirming] = useState(false);
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
                    <AlertNow asked={asked} waiting={now === undefined} words={words} visual={visual} source={source}
                        fields={printedNow?.kind === "ask" ? printedNow.fields : NO_FIELDS} onRun={condition === undefined ? undefined : () => setNow(condition)} />
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
    /** Whether nothing has been asked yet: a new alert's condition, still to be written, or written and not yet run. */
    readonly waiting: boolean;
    /** The query builder's words, which its table prints with. */
    readonly words: ReturnType<typeof useQueryWords>;
    /** The visual, whose values' formats its numbers print in. */
    readonly visual: Visual;
    /** Its source, as the surface lists it: the fields' formats; `undefined` for one it does not list. */
    readonly source: VisualSource | undefined;
    /** The fields of the rows asked for, as the check's program names them. */
    readonly fields: readonly AlertField[];
    /** Runs it again for the condition as it stands; `undefined` while that is unfinished. */
    readonly onRun: (() => void) | undefined;
}

/** Now: the visual's rows that meet the condition now, as a table — its numbers in their fields' formats — and how many of how many. */
function AlertNow({ asked, waiting, words, visual, source, fields, onRun }: AlertNowProps) {
    const m = useStudioMessages();
    const f = useFormatters();
    const styles = useSlotStyles("studioVisual");
    const answer: VisualAnswer | undefined = asked.status === "answered" ? asked.answers[0] : undefined;
    const table = useMemo(() => (answer?.kind !== "answered" ? undefined
        : alertRowsTable({ type: ArrayType(StructType([...answer.columns])), value: answer.rows }, visual, source, fields, words, m)), [answer, visual, source, fields, words, m]);
    let note: string | undefined;
    // Nothing asked yet: while its condition is unfinished, what Run waits for; once it is finished, Run says the rest.
    if (waiting) note = onRun === undefined ? m.alertNowWaits() : undefined;
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
