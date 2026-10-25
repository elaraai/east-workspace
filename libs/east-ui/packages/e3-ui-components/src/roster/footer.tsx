/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useRef } from "react";
import { Box } from "@chakra-ui/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { OptimiseLegendItem } from "@elaraai/east-ui-components";
import { FooterMore, LoadingLine, RecordSliceSaveNotice, footerCut, useFooterFit, useRevealed, type LoadingLineValue } from "@elaraai/east-ui-components/internal";
import type { RosterStyles } from "./model.js";

/** The coverage marks the legend explains: who fills a slot's hours, and what it needs. Overtime is the app's pay's to say (§5.6). */
const LEGEND = [
    { key: "permanent", label: "Permanent" }, { key: "agency", label: "Agency staff" },
    { key: "requested", label: "Requested" }, { key: "open", label: "Open" }, { key: "needed", label: "Hours needed" },
] as const;
/**
 * The shared footer rail explains the coverage marks, then a Save's notice of
 * the duties that left the week's window, and at its trailing end the shared
 * loading line (#1398, CL3): the week being read — `Loading 12–18 Mar` — or
 * why it could not be, with Retry. The rail never wraps and never cuts a word:
 * the legend stays whole and in place, ending at a whole mark, then "…", only
 * where it cannot fit. Details stay in the inspector. The line shows on the
 * frame's one reveal clock (CL4, its `LoadingReveal`), which the week's
 * placeholders keep too — or says what a run of the app's optimiser does
 * (#1409), at once. During a run's highlight the legend ends with `Elara
 * change`.
 */
export function RosterFooter({ styles, duties, noun, line, optimise }: {
    styles: RosterStyles;
    /** The slice's part over the duties, whose Save notice counts what leaves the week's window. */
    duties: ValueTypeOf<RecordSliceBindType> | undefined;
    /** What a duty is called, singular and plural. */
    noun: { singular: string; plural: string };
    /** What the week's read says: the week being read, or why it could not be; `undefined` while it has landed. */
    line: LoadingLineValue | undefined;
    /** A run of the app's optimiser (#1409): what its line says while the call is out or just stopped, and whether its highlight is on. */
    optimise?: { readonly line: LoadingLineValue | undefined; readonly legend: boolean } | undefined;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const fit = useFooterFit(ref);
    const shown = useRevealed() === true;
    const elara = optimise?.legend === true;
    const runLine = optimise?.line;
    const units = LEGEND.length + (elara ? 1 : 0);
    return <Box ref={ref} css={styles.footer} data-roster-footer="">
        {LEGEND.map((item, i) => <Box as="span" key={item.key} css={[styles.footerItem, styles.legendItem]} data-roster-legend={item.key}
            data-footer-unit="" data-footer-cut={footerCut(i, fit)}>
            <Box as="span" aria-hidden="true" css={[item.key === "needed" ? styles.coverageTick : styles.coverageSegment, styles.legendSwatch]} data-kind={item.key} />{item.label}
        </Box>)}
        {elara && <OptimiseLegendItem css={[styles.footerItem ?? {}, styles.legendItem ?? {}]} cut={footerCut(LEGEND.length, fit)} />}
        <FooterMore shown={fit.kept < units} />
        {duties !== undefined && <RecordSliceSaveNotice slice={duties} singular={noun.singular} plural={noun.plural} />}
        {/* A run's line shows at once, whatever the reveal says: a run is not a read (#1409). */}
        <LoadingLine value={runLine ?? line} shown={shown || runLine !== undefined} form={fit.form} />
    </Box>;
}
