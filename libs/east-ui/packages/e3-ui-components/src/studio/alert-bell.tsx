/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraStudioAlertBell` — the renderer of the `StudioAlertBell`
 * extension declared in `@elaraai/e3-ui` (#1674): the bell a host puts in its
 * bar, how many of its alerts are firing, and the list of them, newest
 * first — each its name, its page and when it fired. Opening one sets the
 * page's filters, as its reader's, to the alert's, marks the page opened for
 * it, and tells the host's `onOpen` the page's key; the page draws a banner
 * naming the alert and when it fired ({@link AlertOpenedBanner}), whose Show
 * rows gives the rows that met it.
 *
 * @packageDocumentation
 */

import { memo, useMemo, useState } from "react";
import { Box, Button as ChakraButton } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell } from "@fortawesome/free-solid-svg-icons";
import { StringType, compareFor, DateTimeType, decodeBeast2, equivalentFor, fromEastTypeValue, type ValueTypeOf } from "@elaraai/east";
import {
    StudioAlertBellComponent, StudioFiltersType, studioAlertOpenedKey, studioFiltersKey, type StudioKeyType,
} from "@elaraai/e3-ui/internal";
import { BannerView, EastChakraTable, SliceEditPopover, implementUIComponent, useFormatters } from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { resultTable } from "../query/results-table.js";
import { useQueryWords } from "../query/words.js";
import { changeStoredValue, forgetStoredValue, storedCodec, useStoredValue } from "../shared/stored-value.js";
import { useAlertsRead, useStudioAlerts } from "./alert-context.js";
import { AlertRow } from "./alert-row.js";
import { isFiring, type Alert } from "./alerts.js";
import { useStudioMessages } from "./messages.js";

/** The renderer's payload, decoded. */
type StudioAlertBellValue = ValueTypeOf<typeof StudioAlertBellComponent.schema>;
/** A page's key. */
type Key = ValueTypeOf<typeof StudioKeyType>;

const bellEqual = equivalentFor(StudioAlertBellComponent.schema);
const compareInstant = compareFor(DateTimeType);
/** A page's filters, as the UI store holds them. */
const FILTERS = storedCodec(StudioFiltersType);
/** The alert a page was opened for, as the UI store holds it. */
const OPENED = storedCodec(StringType);

/** When an alert fired: what its line, and its banner, say. */
function firedAt(alert: Alert): Date | undefined {
    return alert.firing.type === "some" ? alert.firing.value.at : undefined;
}

/**
 * Opens an alert's page: its filters the page's, as its reader's — in place of
 * theirs, where a click that opens a page adds its group to them — and the
 * page marked opened for it, which the page draws its banner by.
 *
 * @param name - The alert's name
 * @param alert - The alert
 */
function openAlertPage(name: string, alert: Alert): void {
    changeStoredValue(FILTERS, studioFiltersKey(alert.page), () => [...alert.filters]);
    changeStoredValue(OPENED, studioAlertOpenedKey(alert.page), () => name);
}

/** Props of {@link EastChakraStudioAlertBell}. */
export interface EastChakraStudioAlertBellProps {
    /** The payload, decoded. */
    value: StudioAlertBellValue;
    /** The structural storage key. */
    storageKey: string;
}

/**
 * Renders the bell — see the module docs.
 *
 * @param props - The payload and its storage key
 * @returns The bell, and its list while open
 */
export const EastChakraStudioAlertBell = memo(function EastChakraStudioAlertBell({ value }: EastChakraStudioAlertBellProps) {
    const m = useStudioMessages();
    const f = useFormatters();
    const styles = useSlotStyles("studioVisual");
    const alerts = useAlertsRead(value.alerts);
    const [open, setOpen] = useState(false);
    // The alerts firing, the one that fired last first.
    const firing = useMemo(() => [...(alerts ?? [])].filter(([, alert]) => isFiring(alert))
        .sort(([, a], [, b]) => compareInstant(firedAt(b)!, firedAt(a)!)), [alerts]);
    const told = value.onOpen.type === "some" ? value.onOpen.value : undefined;
    const label = m.alertBell();
    const said = firing.length === 0 ? label : `${label} · ${m.alertsFiring({ n: firing.length, count: f.number(firing.length) })}`;
    const trigger = (
        <ChakraButton type="button" variant="outline" size="sm" css={styles.bell} aria-label={said} title={said}
            data-studio-alert-bar="" data-firing={firing.length > 0 ? "" : undefined}>
            <FontAwesomeIcon icon={faBell} />
            {firing.length > 0 && <span>{f.number(firing.length)}</span>}
        </ChakraButton>
    );
    return (
        <SliceEditPopover trigger={trigger} open={open} onOpenChange={setOpen} label={label} size="lg" flush>
            {firing.length === 0 ? (
                <Box as="span" css={styles.note} data-studio-alerts-none="">{m.alertNoneFiring()}</Box>
            ) : (
                <Box css={styles.alerts} data-studio-alerts-firing="">
                    {firing.map(([name, alert]) => (
                        <AlertRow key={name} name={name} status="firing" words={m.alertWhere({ page: alert.page.page, at: f.dateTime(firedAt(alert)!) })}
                            onOpen={() => {
                                openAlertPage(name, alert);
                                setOpen(false);
                                told?.(alert.page);
                            }} />
                    ))}
                </Box>
            )}
        </SliceEditPopover>
    );
}, (prev, next) => bellEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

implementUIComponent(StudioAlertBellComponent, EastChakraStudioAlertBell);

/** Props of {@link AlertOpenedBanner}. */
export interface AlertOpenedBannerProps {
    /** The page drawn. */
    readonly page: Key;
}

/**
 * The banner over a page opened for an alert: its name and when it fired,
 * how many rows met it, Show rows — the rows, as a result table in a popover
 * hanging from it — and Dismiss, which puts it away. Nothing on a page not
 * opened for one, or for one that no longer fires.
 *
 * @param props - The page
 * @returns The banner
 */
export function AlertOpenedBanner({ page }: AlertOpenedBannerProps) {
    const m = useStudioMessages();
    const f = useFormatters();
    const words = useQueryWords();
    const styles = useSlotStyles("studioVisual");
    const studio = useStudioAlerts();
    const alerts = useAlertsRead(studio?.handle);
    const key = studioAlertOpenedKey(page);
    const [opened] = useStoredValue(OPENED, key);
    const [showing, setShowing] = useState(false);
    const alert = opened === undefined ? undefined : alerts?.get(opened);
    const firing = alert?.firing.type === "some" ? alert.firing.value : undefined;
    const table = useMemo(() => {
        if (firing === undefined) return undefined;
        const decoded = decodeBeast2(firing.rows);
        return resultTable({ type: fromEastTypeValue(decoded.type), value: decoded.value }, words);
    }, [firing, words]);
    if (opened === undefined || firing === undefined || table === undefined) return null;
    const count = Number(firing.count);
    const rows = (
        <SliceEditPopover open={showing} onOpenChange={setShowing} label={m.rowsOf({ name: opened })} size="lg" flush
            trigger={<ChakraButton type="button" size="xs" variant="outline" data-studio-alert-show-rows="">{m.showRows()}</ChakraButton>}>
            <Box css={styles.alertTable} data-studio-alert-fired-rows="">
                <EastChakraTable value={table} storageKey="studio.alert.fired" tile />
            </Box>
        </SliceEditPopover>
    );
    return (
        <BannerView status="warning" title={m.alertBanner({ name: opened, at: f.dateTime(firing.at) })} description={m.alertBannerRows({ n: count, count: f.number(count) })}
            actions={<>{rows}<ChakraButton type="button" size="xs" variant="outline" onClick={() => forgetStoredValue(key)}>{m.dismiss()}</ChakraButton></>} />
    );
}
