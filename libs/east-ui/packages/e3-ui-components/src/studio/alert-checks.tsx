/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An open Studio page's check of its project's alerts (#1674): each alert
 * that is due — not paused, its visual on its page's live version, its source
 * listed — asked as a tile's programs are, through the page's answers: as the
 * page opens, and again when a dataset its program reads has a new hash, the
 * page's poll following the hash without reading the data. What its answer
 * does to its firing is e3-ui's `alertFiring`, and a firing that moved is
 * written: one patch, once. Another page that wrote the same firing first
 * leaves this one's write refused, which reads the record again and finds
 * nothing to write. The rules are `alerts.ts`'s; this holds them for React,
 * and draws nothing.
 *
 * @packageDocumentation
 */

import { useEffect, useMemo, useRef } from "react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { StudioAlertType, type StudioPagesType, type StudioSourceType } from "@elaraai/e3-ui/internal";
import { useVisualAnswers, useVisualMinute } from "../query/visual/answers.js";
import type { VisualAsk } from "../query/visual/print.js";
import { useAlertsRead, useSaveAlerts, type AlertsHandle } from "./alert-context.js";
import { alertFound, checkOf, firingChanges, projectAlerts, type Alert, type AlertStanding } from "./alerts.js";
import { studioEast } from "./studio-east.js";

/** A listed source. */
type Source = ValueTypeOf<typeof StudioSourceType>;

const alertEqual = equalFor(StudioAlertType);
/** No programs: a check whose visual has none to print. */
const NO_ASKS: readonly VisualAsk[] = [];

/** Props of {@link StudioAlertChecks}. */
export interface StudioAlertChecksProps {
    /** The alerts record, bound with its patch. */
    readonly handle: AlertsHandle;
    /** The pages record: where each alert's visual is found, on its page's live version. */
    readonly pages: ValueTypeOf<typeof StudioPagesType>;
    /** The project whose alerts the page checks. */
    readonly project: string;
    /** The sources the surface lists. */
    readonly sources: readonly Source[];
}

/**
 * Checks a project's alerts from an open page — see the module docs.
 *
 * @param props - The alerts record, the pages record, the project and the sources
 * @returns Nothing drawn: one check a due alert
 */
export function StudioAlertChecks({ handle, pages, project, sources }: StudioAlertChecksProps) {
    const alerts = useAlertsRead(handle);
    const byKey = useMemo(() => new Map(sources.map((source) => [source.key, source])), [sources]);
    const due = useMemo(() => (alerts === undefined ? [] : projectAlerts(alerts, project, pages, byKey)), [alerts, project, pages, byKey]);
    return (
        <>
            {due.map((held) => (held.standing.kind === "due"
                ? <AlertCheck key={held.name} name={held.name} alert={held.alert} due={held.standing} handle={handle} />
                : null))}
        </>
    );
}

/** Props of {@link AlertCheck}. */
interface AlertCheckProps {
    readonly name: string;
    readonly alert: Alert;
    readonly due: Extract<AlertStanding, { kind: "due" }>;
    readonly handle: AlertsHandle;
}

/** One alert's check: its program asked through the page's answers, and its firing written where it moved. */
function AlertCheck({ name, alert, due, handle }: AlertCheckProps) {
    const east = studioEast();
    const save = useSaveAlerts(handle);
    const minute = useVisualMinute();
    const printed = useMemo(() => (minute === undefined ? undefined : checkOf(due, alert, minute)), [due, alert, minute]);
    const asks = useMemo(() => (printed?.kind === "ask" ? [printed.ask] : NO_ASKS), [printed]);
    const asked = useVisualAnswers(asks, due.visual.source);
    // What it last wrote from: the alert as it read it, and the step — written once, until the record moves.
    const wrote = useRef<{ readonly alert: Alert; readonly step: string } | undefined>(undefined);
    const answer = asked.status === "answered" ? asked.answers[0] : undefined;
    useEffect(() => {
        if (answer?.kind !== "answered" || minute === undefined) return;
        const step = east.alertFiring(alert.firing, alertFound(answer), minute);
        const changes = firingChanges(name, alert, step, globalThis.crypto.randomUUID());
        if (changes === undefined) return;
        if (wrote.current !== undefined && wrote.current.step === step.type && alertEqual(wrote.current.alert, alert)) return;
        wrote.current = { alert, step: step.type };
        // Refused — another page wrote it first — the record is read again, and its firing is what this check finds.
        void save(changes).catch(() => { wrote.current = undefined; });
    }, [answer, minute, east, alert, name, save]);
    return null;
}
