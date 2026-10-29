/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A case's preview (`Decision Queue Spec.md` §8, D7, D8, P1–P26): one per
 * card, between its title and its chip line, on the closed and the open card
 * alike, drawn from the chosen option's change as edited — by its target's
 * kind, at its builder's own sizes, from its builder's own recipe and
 * arithmetic: the Roster's week (`roster.tsx`), the Plan's lanes (`plan.tsx`)
 * and the Calendar's a day a lane (`calendar.tsx`), each drawn by
 * `lanes.tsx`, and the Sheet's rows (`sheet.tsx`). Its frame, its
 * placeholders and its failure are every kind's (`frame.tsx`).
 *
 * @packageDocumentation
 */

import { memo } from "react";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { CalendarPreview } from "./calendar.js";
import { PreviewFrame, type PreviewProps } from "./frame.js";
import { PlanPreview } from "./plan.js";
import { RosterPreview } from "./roster.js";
import { SheetPreview } from "./sheet.js";

export { flag, sharedOf, type SharedRows } from "./frame.js";

/** Props of {@link DecisionPreview}: what a preview draws from, the recipe's styles its own. */
export type DecisionPreviewProps = Omit<PreviewProps, "styles">;

/**
 * A case's preview (see the module docs).
 *
 * @param props - The case, its target and record, the rows its change leaves and the queue's editing ({@link DecisionPreviewProps})
 * @returns The preview
 */
export const DecisionPreview = memo(function DecisionPreview(props: DecisionPreviewProps) {
    const styles = useSlotStyles("decisionPreview");
    const kind = props.target.kind;
    switch (kind.type) {
        case "roster":
            return <RosterPreview {...props} kind={kind.value} styles={styles} />;
        case "plan":
            return <PlanPreview {...props} kind={kind.value} styles={styles} />;
        case "calendar":
            return <CalendarPreview {...props} kind={kind.value} styles={styles} />;
        case "sheet":
            return <SheetPreview {...props} kind={kind.value} styles={styles} />;
        default:
            return <PreviewFrame kind={kind.type} layout={undefined} label={props.view.option?.detail ?? ""} stale={props.rows === "stale"} styles={styles} />;
    }
});
