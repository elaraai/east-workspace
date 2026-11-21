/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio page's alerts (#1674), and their rules: what a visual's bell, an
 * open page's check and `<Studio.AlertBell>` draw and do by — never a
 * renderer's.
 *
 * - **Where an alert stands** ({@link alertStanding}): due, to be checked;
 *   paused; its visual removed from its page's live version, which leaves it
 *   unchecked; or its visual's source not listed where it is checked.
 * - **A project's alerts** ({@link projectAlerts}): those an open page of the
 *   project checks, each by its name.
 * - **The program a check asks** ({@link checkOf}): its visual's, printed from
 *   the page's live version with the alert's filters in place of a reader's,
 *   then the rows that meet its condition (`query/visual/alert.ts`).
 * - **What a check found** ({@link alertFound}): how many rows met it, and
 *   those rows as self-describing beast2 — what e3-ui's `alertFiring` decides
 *   by.
 * - **The writes** ({@link alertChanges}, {@link firingChanges}): a Save, a
 *   pause, a delete and a firing, each one batch by the alert's name, from what
 *   it was to what it is — what e3-ui's `saveAlerts` commits as one patch.
 * - **A visual's alerts** ({@link placementAlerts}), whether one fires
 *   ({@link isFiring}), and what refuses an alert's name ({@link alertNameRefusal}).
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

import { ArrayType, OptionType, StructType, diffFor, encodeBeast2For, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import {
    StudioAlertType, StudioKeyType,
    type StudioAlertChangesType, type StudioAlertCheckType, type StudioAlertStepType, type StudioAlertsType, type StudioPagesType,
} from "@elaraai/e3-ui/internal";
import { printAlert, type PrintedAlert } from "../query/visual/alert.js";
import type { VisualAnswered } from "../query/visual/ask.js";
import { printStateOf } from "../query/visual/filters.js";
import type { PrintSource } from "../query/visual/print.js";
import { printSourceOf } from "../query/visual/source.js";
import { liveVisualOf } from "./page-entry.js";
import type { Visual, VisualSource } from "./visual/values.js";

/** An alert, decoded. */
export type Alert = ValueTypeOf<typeof StudioAlertType>;
/** The alerts record, decoded: every alert by its name. */
export type Alerts = ValueTypeOf<typeof StudioAlertsType>;
/** What a check does to an alert's firing. */
export type AlertStep = ValueTypeOf<typeof StudioAlertStepType>;
/** What a check of an alert found. */
export type AlertFound = ValueTypeOf<typeof StudioAlertCheckType>;
/** A batch of writes to alerts. */
export type AlertChanges = ValueTypeOf<typeof StudioAlertChangesType>;
/** A page's key. */
type Key = ValueTypeOf<typeof StudioKeyType>;
/** The pages record. */
type Pages = ValueTypeOf<typeof StudioPagesType>;

const keyEqual = equalFor(StudioKeyType);
const alertPatch = diffFor(OptionType(StudioAlertType));

/**
 * Where an alert stands for an open page's check.
 *
 * @remarks
 * - `due` — checked: its visual, as its page's live version holds it, and its source.
 * - `paused` — left unchecked by its author.
 * - `removed` — its visual is on its page's live version no more — or never
 *   was, its page not published: it is unchecked, and says so.
 * - `unlisted` — its visual's source is one the surface checking it does not list.
 */
export type AlertStanding =
    | { readonly kind: "due"; readonly visual: Visual; readonly source: VisualSource; readonly read: PrintSource }
    | { readonly kind: "paused" }
    | { readonly kind: "removed" }
    | { readonly kind: "unlisted" };

/**
 * Where an alert stands ({@link AlertStanding}): a removed visual says so
 * before a pause does.
 *
 * @param alert - The alert
 * @param pages - The pages record
 * @param sources - The sources the surface lists, by key
 * @returns Where it stands
 */
export function alertStanding(alert: Alert, pages: Pages, sources: ReadonlyMap<string, VisualSource>): AlertStanding {
    const visual = liveVisualOf(pages, alert.page, alert.cell);
    if (visual === undefined) return { kind: "removed" };
    if (alert.paused) return { kind: "paused" };
    const source = sources.get(visual.source);
    const read = source === undefined ? undefined : printSourceOf(source);
    if (source === undefined || read === undefined) return { kind: "unlisted" };
    return { kind: "due", visual, source, read };
}

/**
 * One of a project's alerts, as an open page of it checks it.
 *
 * @property name - Its name: its key in the record
 * @property alert - The alert
 * @property standing - Where it stands
 */
export interface ProjectAlert {
    /** Its name: its key in the record. */
    readonly name: string;
    /** The alert. */
    readonly alert: Alert;
    /** Where it stands. */
    readonly standing: AlertStanding;
}

/**
 * A project's alerts (#1674): those on its pages, which an open page of it
 * checks, in the record's order.
 *
 * @param alerts - The alerts record
 * @param project - The project
 * @param pages - The pages record
 * @param sources - The sources the surface lists, by key
 * @returns Each of the project's alerts, and where it stands
 */
export function projectAlerts(alerts: Alerts, project: string, pages: Pages, sources: ReadonlyMap<string, VisualSource>): ProjectAlert[] {
    const held: ProjectAlert[] = [];
    for (const [name, alert] of alerts) {
        if (alert.page.project !== project) continue;
        held.push({ name, alert, standing: alertStanding(alert, pages, sources) });
    }
    return held;
}

/**
 * The program an alert's check asks: its visual's, printed from its page's
 * live version with the alert's filters in place of a reader's, then the rows
 * that meet its condition.
 *
 * @param due - Where it stands: due, its visual and source
 * @param alert - The alert
 * @param now - The page's minute, which a filter that counts back from now counts from
 * @returns The ask, or why its visual has none
 */
export function checkOf(due: Extract<AlertStanding, { kind: "due" }>, alert: Alert, now: Date): PrintedAlert {
    const state = printStateOf(alert.filters, due.visual.source, due.read, now);
    return printAlert(due.visual, due.read, state, alert.condition);
}

/**
 * What a check found, as e3-ui's `alertFiring` reads it: how many rows met
 * the condition, and those rows, as self-describing beast2 — their type
 * travels with them.
 *
 * @param answer - The check's answer
 * @returns How many, and which
 */
export function alertFound(answer: VisualAnswered): AlertFound {
    const rows = encodeBeast2For(ArrayType(StructType([...answer.columns])))(answer.rows as never);
    return { count: BigInt(answer.rows.length), rows };
}

/**
 * One write to an alert: what it was as the edit began, and what it is.
 *
 * @property name - Its name
 * @property before - What it was; `undefined` for a new one
 * @property after - What it is; `undefined` for one deleted
 */
export interface AlertWrite {
    /** Its name. */
    readonly name: string;
    /** What it was; `undefined` for a new one. */
    readonly before: Alert | undefined;
    /** What it is; `undefined` for one deleted. */
    readonly after: Alert | undefined;
}

/**
 * A batch of writes to alerts — what e3-ui's `saveAlerts` commits as one
 * patch: each by its alert's name, from what it was to what it is, so one
 * another write changed since is refused, naming it.
 *
 * @param writes - The writes: a Save's one, a rename's two — the old name deleted, the new written
 * @param label - What the batch is, in words
 * @param requestId - The batch's request id: a retry of it with the same id resolves to its commit
 * @returns The batch
 */
export function alertChanges(writes: readonly AlertWrite[], label: string, requestId: string): AlertChanges {
    return {
        requestId,
        base: variant("snapshot", writes.flatMap((write) => (write.before === undefined ? [] : [write.before]))),
        label,
        changes: writes.map((write) => ({
            id: write.name,
            patch: alertPatch(write.before === undefined ? none : some(write.before), write.after === undefined ? none : some(write.after)),
            place: none,
        })),
    };
}

/**
 * The batch a check's firing writes: the alert's latest firing — set as it
 * fires, `cleared` stamped as it stops — and nothing where it did neither.
 *
 * @param name - The alert's name
 * @param alert - The alert, as the check read it
 * @param step - What the check did to its firing (`alertFiring`)
 * @param requestId - The batch's request id
 * @returns The batch; `undefined` when the firing is as it was
 */
export function firingChanges(name: string, alert: Alert, step: AlertStep, requestId: string): AlertChanges | undefined {
    if (step.type === "unchanged") return undefined;
    return alertChanges([{ name, before: alert, after: { ...alert, firing: some(step.value) } }], step.type === "fired" ? "Alert fired" : "Alert cleared", requestId);
}

/**
 * A visual's alerts: those on its placement of its page, in the record's
 * order.
 *
 * @param alerts - The alerts record
 * @param page - The page's key
 * @param cell - The visual's placement's key
 * @returns Each, by its name
 */
export function placementAlerts(alerts: Alerts, page: Key, cell: string): { readonly name: string; readonly alert: Alert }[] {
    const held: { name: string; alert: Alert }[] = [];
    for (const [name, alert] of alerts) {
        if (alert.cell === cell && keyEqual(alert.page, page)) held.push({ name, alert });
    }
    return held;
}

/**
 * Whether an alert fires: it fired, and has not cleared.
 *
 * @param alert - The alert
 * @returns Whether it fires
 */
export function isFiring(alert: Alert): boolean {
    return alert.firing.type === "some" && alert.firing.value.cleared.type === "none";
}

/**
 * What refuses an alert's name: none at all, or a name another alert holds.
 *
 * @param name - The name, as typed and trimmed
 * @param alerts - The alerts record
 * @param was - The name the alert held as its edit began; `undefined` for a new one
 * @returns Why it is refused; `undefined` for a name it may take
 */
export function alertNameRefusal(name: string, alerts: Alerts, was: string | undefined): "missing" | "taken" | undefined {
    if (name === "") return "missing";
    return name !== was && alerts.has(name) ? "taken" : undefined;
}
