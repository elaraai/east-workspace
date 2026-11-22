/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Configure tab's Alerts (#1674, asked 22 November 2026): the selected
 * visual's alerts, in the builder's inspector — what its bell's popover holds
 * on the canvas, where a builder edits everything else of the visual. They are
 * listed, each by its name and where it stands, under New alert; one pressed,
 * or a new one, is edited in place with the editor the popover draws
 * (`alert-editor.tsx`): its name, its condition's rows, its pause and Now, its
 * Delete, Cancel and Save in a foot of the section's own.
 *
 * They are the alerts record's, as the bell's are, and no part of the page's
 * draft: Save, Delete and a pause are each one patch of the record, written as
 * they are made, which the page's Undo, Discard and Publish leave as it is —
 * the section's hint says so. The page's published version is what checks
 * them (`alert-checks.tsx`).
 *
 * Nothing is drawn where the builder was given no alerts record, or for a
 * visual whose source the surface does not list.
 *
 * @packageDocumentation
 */

import { useMemo, useState, type ReactNode } from "react";
import { Box, chakra, useRecipe } from "@chakra-ui/react";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { printSourceOf } from "../query/visual/source.js";
import { useAlertsRead, useStudioAlerts } from "./alert-context.js";
import { AlertEditor, AlertList, type HeldAlert } from "./alert-editor.js";
import { placementAlerts } from "./alerts.js";
import { useStudioMessages } from "./messages.js";
import { useVisualTitle } from "./visual-tile.js";
import type { Visual, VisualSource } from "./visual/values.js";

/** Props of {@link StudioVisualAlerts}. */
export interface StudioVisualAlertsProps {
    /** The selected placement's key: what its alerts name. */
    readonly placement: string;
    /** Its visual. */
    readonly visual: Visual;
    /** Its placement's own title; `undefined` for one with none, which is named as its tile's eyebrow names it. */
    readonly title: string | undefined;
    /** Its source, as the surface lists it; `undefined` for one it does not. */
    readonly source: VisualSource | undefined;
    /** Draws one field: its label over its control, its hint under it. */
    readonly field: (props: { label: string; part: string; hint?: string | undefined; children: ReactNode }) => ReactNode;
}

/**
 * The Alerts section — see the module docs.
 *
 * @param props - The placement, its visual, its title and its source, and how a field is drawn
 * @returns The section; nothing where the builder was given no alerts record, or the visual's source is not listed
 */
export function StudioVisualAlerts({ placement, visual, title, source, field }: StudioVisualAlertsProps) {
    const m = useStudioMessages();
    // Its name, as its tile's eyebrow says it: what a new alert is named after, as one set from its bell is.
    const name = useVisualTitle(visual, title);
    const styles = useSlotStyles("studioInspector");
    const button = useRecipe({ key: "button" });
    const studio = useStudioAlerts();
    const alerts = useAlertsRead(studio?.handle);
    const read = useMemo(() => (source === undefined ? undefined : printSourceOf(source)), [source]);
    const page = studio?.page;
    const mine = useMemo(() => (alerts === undefined || page === undefined ? [] : placementAlerts(alerts, page, placement)), [alerts, page, placement]);
    // What the section shows: the visual's alerts, or the one being edited — a new one where `held` is none.
    const [editing, setEditing] = useState<{ readonly held: HeldAlert | undefined } | undefined>(undefined);
    // The editor draws its actions into the section's own foot.
    const [footLeft, setFootLeft] = useState<HTMLElement | null>(null);
    const [footActions, setFootActions] = useState<HTMLElement | null>(null);
    if (studio === undefined || alerts === undefined || read === undefined) return null;
    return (
        <Box css={styles.part} data-configure-section="alerts">
            {field({
                label: m.alertBell(), part: "alerts", hint: editing === undefined ? m.alertsHint() : undefined,
                children: editing === undefined ? (
                    <>
                        {mine.length > 0 && <Box css={styles.alerts}><AlertList alerts={mine} onOpen={(held) => setEditing({ held })} /></Box>}
                        <chakra.button type="button" css={[button({ variant: "outline", size: "xs" }), styles.stop]} data-studio-new-alert=""
                            onClick={() => setEditing({ held: undefined })}>
                            {m.newAlert()}
                        </chakra.button>
                    </>
                ) : (
                    <Box css={styles.alertEditor} data-configure-alert={editing.held?.name ?? ""}>
                        <AlertEditor key={editing.held?.name ?? ""} visual={visual} name={name} read={read} placement={placement} studio={studio} alerts={alerts}
                            held={editing.held} foot={{ left: footLeft, actions: footActions }} onBack={() => setEditing(undefined)} />
                        <Box css={styles.alertFoot}>
                            <Box as="span" ref={setFootLeft} css={styles.alertFootStart} />
                            <Box as="span" ref={setFootActions} css={styles.alertFootActions} />
                        </Box>
                    </Box>
                ),
            })}
        </Box>
    );
}
