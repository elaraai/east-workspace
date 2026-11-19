/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Configure tab's Filter field (#1673, ruled 19 November 2026): a
 * visual's own filter — the condition its rows pass before the page's filters
 * narrow it — written in place with the condition rows a page filter's
 * popover draws (`./filter-editor.tsx`), over the visual's source, the shared
 * picker under them while a slot is open. Each condition finished is the
 * visual's, one gesture of the canvas, saved with the page; Remove filter
 * takes it off. The rows hold their own drafts, so a change of the filter
 * they did not make — an undo, a redo, Remove filter — starts them afresh
 * over what the visual holds.
 *
 * @packageDocumentation
 */

import { useMemo, useState, type ReactNode } from "react";
import { chakra, useRecipe } from "@chakra-ui/react";
import { JqType, equalFor, none, some, type JqNode } from "@elaraai/east";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { useVisualRoot } from "../query/visual/answers.js";
import { printSourceOf } from "../query/visual/source.js";
import { FilterConditions } from "./filter-editor.js";
import { useStudioMessages } from "./messages.js";
import type { Visual, VisualSource } from "./visual/values.js";

const sameCondition = equalFor(JqType);

/** Whether two filters are one: none at all, or equal conditions. */
function sameFilter(a: JqNode | undefined, b: JqNode | undefined): boolean {
    return a === undefined || b === undefined ? a === undefined && b === undefined : sameCondition(a, b);
}

/** What the rows stand on: the filter last seen, the one they hold, and how many times they have started afresh. */
interface Held {
    readonly seen: JqNode | undefined;
    readonly held: JqNode | undefined;
    readonly start: number;
}

/** Props of {@link StudioOwnFilter}. */
export interface StudioOwnFilterProps {
    /** The selected placement's key. */
    readonly placement: string;
    /** Its visual. */
    readonly visual: Visual;
    /** Its source, as the surface lists it; `undefined` for one it does not. */
    readonly source: VisualSource | undefined;
    /** Draws one field: its label over its control, its hint under it, tinted while an edit changed it. */
    readonly field: (props: { label: string; part: string; hint?: string | undefined; children: ReactNode }) => ReactNode;
    /** Writes the visual: one gesture of the canvas. */
    readonly onEdit: (visual: Visual) => void;
}

/**
 * The Filter field — see the module docs.
 *
 * @param props - The placement, its visual and source, how a field is drawn and where an edit goes
 * @returns The field and Remove filter; nothing for a source the surface does not list, or a page that cannot query its sources
 */
export function StudioOwnFilter({ placement, visual, source, field, onEdit }: StudioOwnFilterProps) {
    const m = useStudioMessages();
    const styles = useSlotStyles("studioInspector");
    const button = useRecipe({ key: "button" });
    const root = useVisualRoot();
    const read = useMemo(() => (source === undefined ? undefined : printSourceOf(source)), [source]);
    const where = visual.where.type === "some" ? visual.where.value : undefined;
    const [rows, setRows] = useState<Held>({ seen: where, held: where, start: 0 });
    if (!sameFilter(where, rows.seen)) {
        // The visual's filter moved. The rows' own edit leaves them as they stand; any other starts them afresh over it.
        setRows({ seen: where, held: where, start: sameFilter(where, rows.held) ? rows.start : rows.start + 1 });
    }
    if (read === undefined || root === undefined) return null;
    return (
        <>
            {field({
                label: m.ownFilter(), part: "where", hint: m.ownFilterHint(),
                children: (
                    <FilterConditions key={`${placement}:${visual.source}:${rows.start}`} id={`own:${placement}:${visual.source}`} where={where} read={read} root={root}
                        onChange={(next) => {
                            setRows((was) => ({ ...was, held: next }));
                            onEdit({ ...visual, where: some(next) });
                        }} />
                ),
            })}
            {where !== undefined && (
                <chakra.button type="button" css={[button({ variant: "outline", size: "xs" }), styles.stop]} data-configure-remove-filter=""
                    onClick={() => onEdit({ ...visual, where: none })}>
                    {m.removeFilter()}
                </chakra.button>
            )}
        </>
    );
}
