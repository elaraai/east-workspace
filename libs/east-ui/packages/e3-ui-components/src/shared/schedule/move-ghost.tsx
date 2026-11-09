/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** The same pointer preview for Plan and Calendar; the label never inherits bar width. */
import { useSlotClass } from "@elaraai/east-ui-components/internal";
import type { ReactNode } from "react";

/**
 * A compact label and optional span, styled by the shared move-ghost recipe part. Plain elements with the slots' classes,
 * so a class {@link useMoveGhostClasses} made ahead is the one drawn: a styled element makes a class of its own.
 */
export function MoveGhost({ label, detail, styles, planKind }: {
    label: string; detail?: ReactNode; styles: Record<string, Record<string, unknown>>; planKind?: string;
}) {
    const slot = useSlotClass();
    return <div className={slot(styles.moveGhost)} data-move-ghost="" data-plan-ghost={planKind}>
        <span className={slot(styles.moveGhostLabel)} data-move-ghost-label="">{label}</span>
        {detail !== undefined && <span className={slot(styles.moveGhostSpan)} data-plan-ghost-span={planKind === undefined ? undefined : ""}>{detail}</span>}
    </div>;
}

/**
 * Makes a move ghost's classes while its views are drawn, ahead of the drag that first draws one: a rule first added as
 * the drag starts has the browser work out the whole page's styles and lay it all out again (`useSlotClass`).
 *
 * @param styles - The slots the ghost is drawn with
 */
export function useMoveGhostClasses(styles: Record<string, Record<string, unknown>>): void {
    const slot = useSlotClass();
    slot(styles.moveGhost);
    slot(styles.moveGhostLabel);
}
