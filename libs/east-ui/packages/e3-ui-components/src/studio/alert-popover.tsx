/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A visual's alerts, from its header (#1674): a bell beside its menu — plain
 * with no alert, marked while one of its alerts fires — whose popover lists
 * them, each by its name and where it stands, and edits one — the popover's
 * head then without its close ×, its foot's Cancel what leaves it. The list
 * and the editor are `alert-editor.tsx`'s, which the builder's inspector draws
 * too (`alert-section.tsx`); the rules are `alerts.ts`'s. This draws the bell,
 * and holds which of the two its popover shows — and says which (`view`), so
 * the editor opens on the side of the bell that holds it, not in the room the
 * list took.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useState } from "react";
import { Box, Button as ChakraButton, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell } from "@fortawesome/free-solid-svg-icons";
import { SliceEditPopover, useFormatters } from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import type { PrintSource } from "../query/visual/print.js";
import { useAlertsRead, useStudioAlerts, type StudioAlerts } from "./alert-context.js";
import { AlertEditor, AlertList, type HeldAlert } from "./alert-editor.js";
import { isFiring, placementAlerts, type Alerts } from "./alerts.js";
import { useStudioMessages } from "./messages.js";
import type { Visual } from "./visual/values.js";

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
    const [editing, setEditing] = useState<{ readonly held: HeldAlert | undefined } | undefined>(undefined);
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
            flush={edited === undefined} view={edited === undefined ? "list" : "editor"}
            // An alert's editor closes by its foot's Cancel: no × in its head, over its condition's rows' ×s. Its list keeps one.
            headClose={edited === undefined}
            footLeft={edited === undefined ? undefined : <Box as="span" ref={setFootLeft} css={styles.alertFoot} />}
            footActions={edited === undefined
                ? <ChakraButton type="button" variant="outline" size="xs" data-studio-new-alert="" onClick={() => setEditing({ held: undefined })}>{m.newAlert()}</ChakraButton>
                : <Box as="span" ref={setFootActions} css={styles.alertFoot} />}>
            {edited === undefined ? <AlertList alerts={mine} onOpen={(held) => setEditing({ held })} /> : (
                <AlertEditor key={edited.held?.name ?? ""} visual={visual} name={name} read={read} placement={placement} studio={studio} alerts={alerts}
                    held={edited.held} foot={{ left: footLeft, actions: footActions }}
                    onBack={mine.length === 0 ? () => setOpen(false) : () => setEditing(undefined)} />
            )}
        </SliceEditPopover>
    );
}
