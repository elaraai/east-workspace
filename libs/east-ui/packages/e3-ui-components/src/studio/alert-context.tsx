/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A page's alerts, held for React (#1674): the alerts record a page or the
 * builder was given, bound with its patch, and the page it draws — what its
 * visuals' bells read, and set an alert on. One {@link StudioAlertsProvider}
 * a page; none, and no visual shows a bell.
 *
 * @packageDocumentation
 */

import { createContext, createElement, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { StudioAlertsHandleType, StudioKeyType } from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import type { AlertChanges, Alerts } from "./alerts.js";
import { studioEast } from "./studio-east.js";

/** The alerts record, bound with its patch: its read, its history and its patch write. */
export type AlertsHandle = ValueTypeOf<typeof StudioAlertsHandleType>;
/** A page's key. */
type Key = ValueTypeOf<typeof StudioKeyType>;

/**
 * A page's alerts: the record, bound, and the page — what an alert set on one
 * of its visuals names.
 *
 * @property handle - The alerts record, bound with its patch
 * @property page - The page drawn
 */
export interface StudioAlerts {
    /** The alerts record, bound with its patch. */
    readonly handle: AlertsHandle;
    /** The page drawn. */
    readonly page: Key;
}

const StudioAlertsContext = createContext<StudioAlerts | null>(null);

/** Props of {@link StudioAlertsProvider}. */
export interface StudioAlertsProviderProps {
    /** The alerts record, bound — `undefined` where none was given, and no visual shows a bell. */
    readonly handle: AlertsHandle | undefined;
    /** The page drawn. */
    readonly page: Key;
    /** The page. */
    readonly children?: ReactNode;
}

/**
 * Holds a page's alerts for its visuals' bells.
 *
 * @param props - The record, bound, the page, and its content
 * @returns The page, its bells able to read and set its alerts
 */
export function StudioAlertsProvider({ handle, page, children }: StudioAlertsProviderProps) {
    const value = useMemo(() => (handle === undefined ? null : { handle, page }), [handle, page]);
    return createElement(StudioAlertsContext.Provider, { value }, children);
}

/**
 * A page's alerts.
 *
 * @returns The record and the page; `undefined` where none was given
 */
export function useStudioAlerts(): StudioAlerts | undefined {
    return useContext(StudioAlertsContext) ?? undefined;
}

/**
 * The alerts record as it stands: read where it is drawn, and again as it
 * moves.
 *
 * @param handle - The record, bound; `undefined` for none
 * @returns Every alert by its name; `undefined` without a record, or while it cannot be read
 */
export function useAlertsRead(handle: AlertsHandle | undefined): Alerts | undefined {
    const read = useCallback(() => handle?.read(), [handle]);
    const { result } = useTrackedEvaluation(read);
    return result.ok ? result.value : undefined;
}

/**
 * Writes a batch to the alerts record: one patch through its patch write
 * (e3-ui's `saveAlerts`).
 *
 * @param handle - The record, bound
 * @returns The write, answering as an editing session's Save does: applied, rejected, or a conflict naming each alert another write changed
 */
export function useSaveAlerts(handle: AlertsHandle): (changes: AlertChanges) => ReturnType<ReturnType<typeof studioEast>["saveAlerts"]> {
    const east = studioEast();
    return useCallback((changes: AlertChanges) => east.saveAlerts(handle, changes), [east, handle]);
}
