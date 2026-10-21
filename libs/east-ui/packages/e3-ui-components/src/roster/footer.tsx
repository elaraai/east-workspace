/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useRef } from "react";
import { Box } from "@chakra-ui/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { RecordSliceSaveNotice } from "@elaraai/east-ui-components/internal";
import { useRailWrap } from "../shared/schedule/footer.js";
import type { RosterStyles } from "./model.js";

/** The coverage marks the legend explains: who fills a slot's hours, and what it needs. Overtime is the app's pay's to say (§5.6). */
const LEGEND = [
    { key: "permanent", label: "Permanent" }, { key: "agency", label: "Agency staff" },
    { key: "requested", label: "Requested" }, { key: "open", label: "Open" }, { key: "needed", label: "Hours needed" },
] as const;
/**
 * The shared footer rail explains the coverage marks, and a Save's notice of
 * the duties that left the week's window; details stay in the inspector.
 */
export function RosterFooter({ styles, narrow, duties, noun }: {
    styles: RosterStyles; narrow: boolean;
    /** The slice's part over the duties, whose Save notice counts what leaves the week's window. */
    duties: ValueTypeOf<RecordSliceBindType> | undefined;
    /** What a duty is called, singular and plural. */
    noun: { singular: string; plural: string };
}) {
    const ref = useRef<HTMLDivElement>(null);
    const wrap = useRailWrap(ref, LEGEND);
    return <Box ref={ref} css={styles.footer} data-roster-footer="" data-builder-narrow={narrow || wrap ? "" : undefined}>
        {LEGEND.map(item => <Box as="span" key={item.key} css={[styles.footerItem, styles.legendItem]} data-roster-legend={item.key}>
            <Box as="span" aria-hidden="true" css={[item.key === "needed" ? styles.coverageTick : styles.coverageSegment, styles.legendSwatch]} data-kind={item.key} />{item.label}
        </Box>)}
        {duties !== undefined && <RecordSliceSaveNotice slice={duties} singular={noun.singular} plural={noun.plural} />}
    </Box>;
}
