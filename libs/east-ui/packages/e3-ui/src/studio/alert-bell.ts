/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.AlertBell>` (#1674) — the bell a host puts in its bar: how many of
 * its alerts are firing, and the list of them. One opens its visual's page.
 *
 * The bell is an interface — the alerts record, bound with its patch, and
 * where a firing alert's page opens — which the `StudioAlertBell` renderer
 * draws. A solution places it where it wants: an app bar, a toolbar.
 *
 * @packageDocumentation
 */

import {
    FunctionType,
    NullType,
    OptionType,
    StructType,
    none,
    some,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import {
    EastUI,
    optionsTag,
    type JsxTag,
    type OptionsProps,
    type UIComponentType,
} from "@elaraai/east-ui/internal";
import { StudioAlertsHandleType, alertsPayload, type StudioAlertsHandle } from "./alerts.js";
import { StudioKeyType } from "./key.js";

/**
 * The `StudioAlertBell` renderer's payload — the bell's interface.
 *
 * @property alerts - The alerts record, bound with its patch: what the bell reads
 * @property onOpen - Told the key of the page a firing alert's visual is on, when the alert is opened; `none`, an alert opens nothing
 */
export const StudioAlertBellPayloadType = StructType({
    alerts: StudioAlertsHandleType,
    onOpen: OptionType(FunctionType([StudioKeyType], NullType)),
});

/** Type representing the `StudioAlertBell` renderer's payload. */
export type StudioAlertBellPayloadType = typeof StudioAlertBellPayloadType;

/**
 * Internal {@link EastUI.component} carrier. The React renderer registers
 * against this in `@elaraai/e3-ui-components` via `implementUIComponent`.
 */
export const StudioAlertBellComponent = EastUI.component("StudioAlertBell", StudioAlertBellPayloadType, { optional: true });

/**
 * `<Studio.AlertBell>` options.
 *
 * @property alerts - The alerts record, bound with its patch mutation — `Record.bind(alerts)`
 * @property onOpen - Told the key of a firing alert's page, as it is opened
 */
export interface StudioAlertBellOptions {
    /** The alerts record, bound with its patch mutation — `Record.bind(alerts)`. */
    alerts: StudioAlertsHandle;
    /**
     * Told the key of the page a firing alert's visual is on, when the alert
     * is opened. The alert's filters are already the page's — its reader's —
     * when it is told, and the page draws a banner naming the alert and when
     * it fired, so the host only shows the page: it navigates, or writes the
     * state its `<Studio.Page>`'s `page` reads. Omitted, an alert opens
     * nothing.
     */
    onOpen?: SubtypeExprOrValue<FunctionType<[StudioKeyType], NullType>>;
}

/**
 * The bell for a host's bar: how many of its alerts are firing, and the list
 * of them, each opening its visual's page.
 *
 * @remarks
 * The bell shows a count while any alert fires, and its list each firing
 * alert — its name, its page and when it fired, newest first; with none
 * firing, it says so. Opening one sets the page's filters to the alert's, as the page's
 * reader's, and tells `onOpen` the page's key; the page, given the same
 * alerts, draws a banner naming the alert and when it fired, whose Show rows
 * gives the rows that met it. The bell draws no border around itself.
 *
 * @param options - The bound alerts record, and where an alert's page opens ({@link StudioAlertBellOptions})
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```tsx
 * import { East, NullType } from "@elaraai/east";
 * import { Reactive, State, UIComponentType } from "@elaraai/east-ui";
 * import { Record, Studio, ui } from "@elaraai/e3-ui";
 *
 * // A host's bar: the bell, opening a firing alert's page in the surface's own state.
 * export const opsBar = ui("ops_bar", [], East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const open = $.let(State.bind([Studio.Types.Key], "studio.open", { project: "Ops console", page: "Overview" }));
 *         const go   = $.const(East.function([Studio.Types.Key], NullType, ($2, key) => { $2(open.write(key)); }));
 *         return <Studio.AlertBell alerts={Record.bind(d.alerts)} onOpen={go} />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createAlertBell(options: StudioAlertBellOptions): ExprType<UIComponentType> {
    return StudioAlertBellComponent.Root({
        alerts: alertsPayload(options.alerts),
        onOpen: options.onOpen === undefined ? none : some(options.onOpen),
    });
}

/**
 * `<Studio.AlertBell>` — the bell for a host's bar. See {@link createAlertBell}.
 */
export const StudioAlertBell: JsxTag<OptionsProps<typeof createAlertBell>> = optionsTag(createAlertBell);
