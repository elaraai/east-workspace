/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** The same pointer preview for Plan and Calendar; the label never inherits bar width. */
import { useSlotClass } from "@elaraai/east-ui-components/internal";
import type { ReactNode } from "react";

/**
 * A compact label and optional span, styled by the shared move-ghost recipe part. Plain elements with the slots' classes,
 * which {@link useMoveGhostClasses} makes ahead of the drag that first draws one.
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

/** The slots a move ghost is drawn with. */
const MOVE_GHOST_SLOTS = ["moveGhost", "moveGhostLabel", "moveGhostSpan"] as const;

/**
 * Makes the classes of what a gesture draws while its views are drawn, ahead of the gesture that first draws them: a
 * rule first added as a drag starts has the browser work out the whole page's styles and lay it all out again
 * (`useSlotClass`). A class is made once for the theme, so a part drawn many times may ask for it each time.
 *
 * @param styles - A recipe's slots; `undefined` while there is nothing to draw with
 * @param slots - The slots whose classes to make: one the recipe does not have makes none
 */
export function useClassesAhead(styles: Record<string, Record<string, unknown>> | undefined, slots: readonly string[]): void {
    const slot = useSlotClass();
    if (styles !== undefined) for (const name of slots) slot(styles[name]);
}

/**
 * Makes a move ghost's classes ahead of the drag that first draws one ({@link useClassesAhead}).
 *
 * @param styles - The slots the ghost is drawn with; `undefined` while there is nothing to draw with
 */
export function useMoveGhostClasses(styles: Record<string, Record<string, unknown>> | undefined): void {
    useClassesAhead(styles, MOVE_GHOST_SLOTS);
}
