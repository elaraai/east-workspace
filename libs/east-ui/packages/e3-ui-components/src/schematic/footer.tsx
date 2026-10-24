/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's footer (#1387, `Schematic Builder Spec.md` §6.3), on the
 * shared builder rail (`builder-footer.ts`): only what is live (ruled 23 Oct
 * 2026) — each kind drawn as its density in place of items (#1393, D25): how
 * many rows it shades in the viewport where it rests (`densityInView`), and
 * that zooming in draws them, the side of its cells named on it
 * (`data-density-cell`); why the last gesture was refused, until one is
 * recorded — a Delete a read-only link or net blocks, a drop, an inspector
 * edit (#1390, #1391); each Save's notice, the rows it took out of a source's
 * narrowing (`RecordSliceSaveNotice`); and where Find's last pick landed on
 * an item the canvas doesn't show as itself, why — the rail's filters, with
 * Clear filters; its layer; no position (#1404). With nothing live the rail is
 * empty. The drawing's counts and each record's last save are the
 * inspector's, in its Details with nothing selected (`counts.ts`), and the
 * changes waiting on Save the history's.
 *
 * At the rail's trailing end, in a slot of its own, the shared loading line
 * (#1398, CL3): what is read now, in a kind's noun — `Loading racks…`,
 * `Filtering racks…` while a new narrowing's rows are read and the last stand
 * in — or why a read failed, with Retry; shown on the frame's one reveal
 * clock (CL4, its `LoadingReveal`). The rail never wraps and never cuts a
 * word: the line shows its full text, its short form or its dot alone, as the
 * rail fits it (`useFooterFit`). The live notices are one item of the rail,
 * which takes what the line leaves (`data-footer-slack`) and wraps within
 * itself item by item where it is narrow (`useRailWrap`), an item wider than
 * it wrapping its own words.
 *
 * @packageDocumentation
 */

import { useMemo, useRef, useSyncExternalStore } from "react";
import { Box, Button, type SystemStyleObject } from "@chakra-ui/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { LoadingLine, RecordSliceSaveNotice, useFooterFit, useRevealed, type LoadingLineValue } from "@elaraai/east-ui-components/internal";
import { useRailWrap } from "../shared/schedule/footer.js";
import { densityInView, type SchematicDensity, type SchematicViewportStore } from "./area.js";
import type { SchematicWords } from "./messages.js";

type Styles = Record<string, SystemStyleObject>;

/** A kind read through its source that writes: what its Save's notice counts the rows it took out of the narrowing in. */
export interface SchematicNotice {
    /** The kind's slot. */
    readonly slot: string;
    /** Its source of the slice. */
    readonly slice: ValueTypeOf<RecordSliceBindType>;
    /** One of its rows, as running text names it — `rack`. */
    readonly singular: string;
    /** Several. */
    readonly plural: string;
}

/** What the footer says of the item Find's last pick landed on, where the canvas doesn't show it as itself. */
export interface SchematicFoundNotice {
    /** Its words: `A07 is hidden by the filters`. */
    readonly words: string;
    /** Clears the filters that leave it out, and selects it once it draws; `undefined` where no filter does. */
    readonly clear: (() => void) | undefined;
}

/** Props of {@link SchematicFooter}. */
export interface SchematicFooterProps {
    /** The `schematic` recipe's styles. */
    readonly styles: Styles;
    /** The Schematic's words. */
    readonly words: SchematicWords;
    /** Each kind read by area drawing its density in place of items, by its slot (D25). */
    readonly density: ReadonlyMap<string, SchematicDensity>;
    /** Each kind's name, by its slot. */
    readonly names: ReadonlyMap<string, string>;
    /** Where the canvas's viewport rests, which the canvas writes as its camera comes to rest: what a density's count is of. */
    readonly viewport: SchematicViewportStore;
    /** The drawing's extent, in world units from its origin: where a density's rows lie. */
    readonly extent: { readonly width: number; readonly height: number };
    /** Why the last gesture was refused; `undefined` once one is recorded, or for none. */
    readonly refusal: string | undefined;
    /** Each kind read through its source that writes: its Save's notice. */
    readonly notices: readonly SchematicNotice[];
    /**
     * What keeps the item Find's last pick landed on from the canvas as itself (#1404) — the rail's filters, with their
     * Clear filters; its layer; no position — or `undefined` while nothing does.
     */
    readonly found?: SchematicFoundNotice | undefined;
    /** What the loading line says: a read in flight, or one that failed, with Retry; `undefined` while nothing is read. */
    readonly line: LoadingLineValue | undefined;
}

/**
 * Renders the footer — see the module docs.
 *
 * @param props - The densities and where the viewport rests, the refusal, the Saves' notices, where Find's last pick
 *   landed, and the loading line
 * @returns The footer: its rail, its notices and its loading line, empty while nothing is live
 */
export function SchematicFooter({ styles, words, density, names, viewport, extent, refusal, notices, found, line }: SchematicFooterProps) {
    // Where the viewport rests: the footer alone renders again as it moves, and only while a kind draws its density.
    const rests = useSyncExternalStore(viewport.subscribe, viewport.get, viewport.get);
    const { width, height } = extent;
    // Each kind drawn as its density, by its slot: how many rows it shades in the viewport — none while it shades none there —
    // and the side of the cells it shades them in, which one view draws alike by whatever route it was reached.
    const dense = useMemo(() => (rests === undefined ? [] : [...density].flatMap(([slot, raster]) => {
        const seen = densityInView(raster, rests.box, { minX: 0, minY: 0, maxX: width, maxY: height });
        if (seen.rows === 0) return [];
        const name = (names.get(slot) ?? slot).toLocaleLowerCase(words.locale);
        const text = words.m.densityNotice({ n: seen.rows, count: words.number(seen.rows), name, about: !seen.exact, unfiltered: raster.unnarrowed });
        return [{ slot, text, side: raster.side }];
    })), [rests, density, width, height, names, words]);
    const rail = useRef<HTMLDivElement>(null);
    const fit = useFooterFit(rail);
    const shown = useRevealed() === true;
    const live = useRef<HTMLDivElement>(null);
    const wrap = useRailWrap(live, [...dense.map((notice) => notice.text), refusal ?? "", found?.words ?? ""].join("\n"));
    return (
        <Box ref={rail} css={styles.footer} data-schematic-footer="">
            <Box ref={live} css={styles.footerNotices} data-schematic-notices="" data-footer-slack="" data-builder-narrow={wrap ? "" : undefined}>
                {dense.map((notice) => (
                    <Box as="span" key={notice.slot} css={styles.footerItem} data-schematic-density={notice.slot} data-density-cell={notice.side}>{notice.text}</Box>
                ))}
                {refusal !== undefined && <Box as="span" css={styles.footerItem} data-schematic-refused="" role="alert">{refusal}</Box>}
                {notices.map((notice) => <RecordSliceSaveNotice key={notice.slot} slice={notice.slice} singular={notice.singular} plural={notice.plural} />)}
                {/* Where Find's last pick landed, the canvas not showing it as itself: why, and — the filters — their Clear, as the Save notice's Retry. */}
                {found !== undefined && (
                    <Box as="span" css={styles.footerItem} data-schematic-found="" role="status">
                        {found.words}
                        {found.clear !== undefined && <> <Button size="xs" variant="plain" onClick={found.clear}>{words.m.clearFilters()}</Button></>}
                    </Box>
                )}
            </Box>
            <LoadingLine value={line} shown={shown} form={fit.form} />
        </Box>
    );
}
