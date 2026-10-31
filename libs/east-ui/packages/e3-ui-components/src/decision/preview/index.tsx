/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A case's preview (`Decision Queue Spec.md` §8, D7, D8, P1–P26): one per
 * card, between its title and its chip line, on the closed and the open card
 * alike, drawn from the chosen option's change as edited — by its target's
 * kind, at its builder's own sizes, from its builder's own recipe and
 * arithmetic: the Roster's week (`roster.tsx`), the Plan's lanes (`plan.tsx`),
 * the Calendar's a day a lane (`calendar.tsx`) and the Allocation's resources
 * and waiting row (`allocation.tsx`), each drawn by `lanes.tsx`, and the
 * Sheet's rows (`sheet.tsx`); a record no builder draws, its fields, its mix
 * or its groups (`record.tsx`), a projection of each option's series
 * (`projection.tsx`) and zones (`zones.tsx`). Its frame, its placeholders, its failure and its
 * hold while it settles once applied (P22) are every kind's (`frame.tsx`). A row Modify keeps as it is, or edits back to
 * it, is no change (R19): the preview draws what is left of the change, and a
 * change left with none as an option that changes nothing (P4).
 *
 * @packageDocumentation
 */

import { memo, useMemo } from "react";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { endsAsItStands } from "../state.js";
import { AllocationPreview } from "./allocation.js";
import { CalendarPreview } from "./calendar.js";
import type { PreviewProps } from "./frame.js";
import { PlanPreview } from "./plan.js";
import { ProjectionPreview } from "./projection.js";
import { RecordPreview } from "./record.js";
import { RosterPreview } from "./roster.js";
import { SheetPreview } from "./sheet.js";
import { ZonesPreview } from "./zones.js";

export { flag, useHeld } from "./frame.js";

/** Props of {@link DecisionPreview}: what a preview draws from, the recipe's styles its own. */
export type DecisionPreviewProps = Omit<PreviewProps, "styles">;

/**
 * A case's preview (see the module docs).
 *
 * @param props - The case, its target and record, the rows its change leaves and the queue's editing ({@link DecisionPreviewProps})
 * @returns The preview
 */
export const DecisionPreview = memo(function DecisionPreview(given: DecisionPreviewProps) {
    const styles = useSlotStyles("decisionPreview");
    // The rows the change still changes: those that end as they stand left out, the same array while none does.
    const changed = useMemo(() => {
        const left = given.changed.filter(row => !endsAsItStands(row));
        return left.length === given.changed.length ? given.changed : left;
    }, [given.changed]);
    const props = { ...given, changed };
    const kind = props.target.kind;
    switch (kind.type) {
        case "roster":
            return <RosterPreview {...props} kind={kind.value} styles={styles} />;
        case "plan":
            return <PlanPreview {...props} kind={kind.value} styles={styles} />;
        case "calendar":
            return <CalendarPreview {...props} kind={kind.value} styles={styles} />;
        case "allocation":
            return <AllocationPreview {...props} kind={kind.value} styles={styles} />;
        case "sheet":
            return <SheetPreview {...props} kind={kind.value} styles={styles} />;
        case "record":
            return <RecordPreview {...props} kind={kind.value} styles={styles} />;
        case "zones":
            return <ZonesPreview {...props} kind={kind.value} styles={styles} />;
        case "projection":
            return <ProjectionPreview {...props} kind={kind.value} styles={styles} />;
    }
});
