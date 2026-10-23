/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shared loading parts every builder draws a read in flight, or one that
 * failed, with (#1398): the placeholder shapes, each in the slot its value
 * will fill ({@link PlaceholderShape}); the region wash over a region whose
 * items have no known position yet ({@link LoadingWash}); a failure said once
 * — a line in a row grid's first row in view ({@link LoadingFailedLine}), or
 * the message box at the top-left of a region with no row to hold one
 * ({@link LoadingFailedBox}); a region its read found empty, said once in the
 * failed line's slot and shape ({@link LoadingEmptyLine}); and the narrow
 * layouts' placeholder card ({@link PlaceholderCard}). Every placeholder is
 * `aria-hidden` (CL12) and states no value; the `loading` slot recipe owns
 * every style, and these set data attributes and geometry only. Inside a
 * builder's `LoadingReveal` a shape and a wash keep their footprint
 * unseen until the reveal says so (`data-unrevealed`, CL4), each reading the
 * clock itself, so its flip renders them again and never their builder.
 *
 * @packageDocumentation
 */

import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Box, Button, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleExclamation, type IconDefinition } from "@fortawesome/free-solid-svg-icons";
import { barShare } from "./run-rows.js";
import { loadingMessages } from "./messages.js";
import { useRevealed } from "./reveal.js";

type Styles = Record<string, SystemStyleObject>;

/**
 * What a value is drawn as before it lands — one shape per kind of content
 * (#1398's "Placeholder shapes"):
 *
 * - `text` (and a lookup, a reference, a custom value): a bar, aligned like the column;
 * - `number` (a quantity, money, an integer): a short bar at the end;
 * - `date` (a time, a duration, a stamp): a medium bar;
 * - `boolean`: the Checkbox's 14px square, in the control's place;
 * - `chip` (a tag, a duty, a set's value): the Chip's rect;
 * - `link`: a chip's rect in each half, either side of `→`;
 * - `enum`: an 8px dot and a short bar;
 * - `label`: a bar in a label column; `label2`, with a shorter bar under it, a two-line row's;
 * - `aggregate` (hours booked, coverage, a lane's totals): a short label bar;
 * - `count`: the Count's 24 × 16 rect;
 * - `check`: a selection's checkbox, drawn disabled until its row lands;
 * - `rowNumber`: a flat sheet's real row number — its place in the collection, plus one;
 * - `wash`: the region wash, over a region whose items have no known position;
 * - `blank`: nothing — the cell's rules alone.
 */
export type PlaceholderKind =
    | "text" | "number" | "date" | "boolean" | "chip" | "link" | "enum" | "label" | "label2" | "aggregate" | "count" | "check"
    | "rowNumber" | "wash" | "blank";

/** How a kind aligns its shape when its column says nothing: a number's at the end, a boolean's and a count's in the middle. */
export function placeholderAlign(kind: PlaceholderKind): "start" | "end" | "center" {
    return kind === "number" ? "end" : kind === "boolean" || kind === "check" ? "center" : "start";
}

/** The `loading` recipe's styles. */
export function useLoadingStyles(): Styles {
    const recipe = useSlotRecipe({ key: "loading" });
    return useMemo(() => recipe() as Styles, [recipe]);
}

/**
 * A text or label bar's share of its length, keyed to its row so the pattern
 * never crawls (`--placeholder-share`): the one value of a shape that is the
 * row's, not the kind's. Each kind's length, a share of its cell with a px cap,
 * is the `loading` recipe's, by the bar's `data-length`.
 */
function share(index: number): CSSProperties {
    return { "--placeholder-share": String(barShare(index)) } as CSSProperties;
}

/** Props of {@link PlaceholderShape}. */
export interface PlaceholderShapeProps {
    /** What the value is. */
    readonly kind: PlaceholderKind;
    /** The row's index in its collection: what keys a text bar's width, so the pattern never crawls. */
    readonly index: number;
    /** A real row number for `rowNumber`; absent, a short bar (a grouped sheet's lines, whose numbers are not known yet). */
    readonly number?: string | undefined;
    /** What a `wash` cell draws over it, the same in every row: a plot's grid and its now line. */
    readonly overlay?: ReactNode;
    /** The `loading` recipe's styles, when the caller has them. */
    readonly styles?: Styles | undefined;
}

/**
 * One value's placeholder, in the slot it will fill (see {@link PlaceholderKind}).
 * Its shapes are `aria-hidden`; a real row number is drawn as text. Inside a
 * builder's `LoadingReveal` a shape keeps its footprint unseen until the reveal
 * says so (`data-unrevealed`, CL4); a real row number is geometry, and shows at
 * once.
 *
 * @param props - The kind, the row, and a real number or an overlay where the kind takes one
 * @returns The shape
 */
export function PlaceholderShape({ kind, index, number, overlay, styles: given }: PlaceholderShapeProps) {
    const own = useLoadingStyles();
    const styles = given ?? own;
    const hidden = useRevealed() === false ? "" : undefined;
    switch (kind) {
        case "text":
            return <Box as="span" css={styles.bar} style={share(index)} aria-hidden="true" data-shape={kind} data-length="text" data-unrevealed={hidden} />;
        case "label":
            return <Box as="span" css={styles.bar} style={share(index)} aria-hidden="true" data-shape={kind} data-length="label" data-unrevealed={hidden} />;
        case "label2":
            return (
                <Box as="span" css={styles.stack} aria-hidden="true" data-shape={kind} data-unrevealed={hidden}>
                    <Box as="span" css={styles.bar} style={share(index)} data-length="label" />
                    <Box as="span" css={styles.bar} data-size="label" style={share(index + 2)} data-length="sub" />
                </Box>
            );
        case "number":
            return <Box as="span" css={styles.bar} aria-hidden="true" data-shape={kind} data-length="number" data-unrevealed={hidden} />;
        case "date":
            return <Box as="span" css={styles.bar} aria-hidden="true" data-shape={kind} data-length="date" data-unrevealed={hidden} />;
        case "aggregate":
            return <Box as="span" css={styles.bar} data-size="label" aria-hidden="true" data-shape={kind} data-length="aggregate" data-unrevealed={hidden} />;
        case "boolean":
            return <Box as="span" css={styles.box} aria-hidden="true" data-shape={kind} data-unrevealed={hidden} />;
        case "check":
            return <Box as="span" css={styles.check} aria-hidden="true" data-shape={kind} />;
        case "count":
            return <Box as="span" css={styles.count} aria-hidden="true" data-shape={kind} data-unrevealed={hidden} />;
        case "chip":
            return <Box as="span" css={styles.chip} aria-hidden="true" data-shape={kind} data-unrevealed={hidden} />;
        case "link":
            return (
                <Box as="span" css={styles.pair} aria-hidden="true" data-shape={kind} data-unrevealed={hidden}>
                    <Box as="span" css={styles.chip} data-length="link" />
                    <Box as="span" css={styles.arrow}>→</Box>
                    <Box as="span" css={styles.chip} data-length="link" />
                </Box>
            );
        case "enum":
            return (
                <Box as="span" css={styles.pair} aria-hidden="true" data-shape={kind} data-unrevealed={hidden}>
                    <Box as="span" css={styles.dot} />
                    <Box as="span" css={styles.bar} data-length="enum" />
                </Box>
            );
        case "rowNumber":
            return number !== undefined
                ? <Box as="span" css={styles.number} aria-hidden="true" data-shape={kind}>{number}</Box>
                : <Box as="span" css={styles.bar} data-size="label" aria-hidden="true" data-shape={kind} data-length="rowNumber" data-unrevealed={hidden} />;
        case "wash":
            return <>
                <Box as="span" css={styles.wash} aria-hidden="true" data-shape={kind} data-loading-wash="" data-unrevealed={hidden} />
                {overlay}
            </>;
        case "blank":
            return null;
    }
}

/** Props of {@link LoadingWash}. */
export interface LoadingWashProps {
    /** Whether it shows: past the reveal's delay (CL4); absent, it shows. */
    readonly shown?: boolean | undefined;
    /** Where it lies in its region, when it covers part of it (a canvas's unread area); absent, the whole region. */
    readonly geometry?: Pick<CSSProperties, "top" | "left" | "width" | "height" | "right" | "bottom"> | undefined;
}

/**
 * The region wash (#1398; the design's `.wash`): `--ink` at 6% over a region
 * whose items have no known position yet — a time grid's day column, a month
 * cell below its date, a timeline row's plot, a lane-hour cell, a Plan row's
 * plot, a canvas's unread area. Edge to edge between the region's real rules,
 * with nothing drawn in it: no item's shape implies a time or a place. It
 * paints under whatever its region draws after it — the rules, the off-hours
 * shading's copy over it, the now line — so place it before them.
 * `aria-hidden`; the region it washes is `aria-busy`. Inside a builder's
 * `LoadingReveal` it is unseen until the reveal says so (`data-unrevealed`).
 *
 * @param props - Whether it shows, and the part of the region it covers
 * @returns The wash, or nothing
 */
export function LoadingWash({ shown = true, geometry }: LoadingWashProps) {
    const styles = useLoadingStyles();
    const hidden = useRevealed() === false ? "" : undefined;
    if (!shown) return null;
    return <Box as="span" css={styles.wash} style={geometry} aria-hidden="true" data-loading-wash="" data-unrevealed={hidden} />;
}

/** What a failure in place offers: its Retry. */
export interface LoadingRetry {
    /** Asks again. */
    readonly onRetry: () => void;
    /** Its words: the shared `Retry` unless given. */
    readonly label?: string | undefined;
    /** Its accessible name, when its words alone do not say what it asks again — `Retry work orders 8,301–8,500`. */
    readonly name?: string | undefined;
    /** Whether the retry is under way: the button says so, and takes no second press. */
    readonly busy?: boolean | undefined;
    /**
     * Whether it is a tab stop of its own — it is unless `false`: a grid that is one tab stop and walks its rows'
     * widgets itself (the Plan's treegrid) takes it out of the tab order.
     */
    readonly tabStop?: boolean | undefined;
}

/** Props of {@link LoadingFailedLine}. */
export interface LoadingFailedLineProps {
    /** The reason, in the record's noun: `Couldn't read work orders 8,301–8,500`. */
    readonly message: ReactNode;
    /** Its Retry; absent, none (an empty line in the failed line's slot and shape). */
    readonly retry?: LoadingRetry | undefined;
}

/**
 * A failure said once, in a row grid (#1398, CL11): one line in the failed
 * run's or region's first row in view, across that row's cells — the
 * Sheet's and the Plan's runs, the Roster's week, the Allocation's day — with
 * the reason and Retry; the failed region's other cells stay blank. The host
 * places it in the row: {@link UnloadedRun} does for a failed run.
 *
 * @param props - The reason and its Retry
 * @returns The line
 */
export function LoadingFailedLine({ message, retry }: LoadingFailedLineProps) {
    const styles = useLoadingStyles();
    return (
        <Box as="span" css={styles.failedLine} data-loading-failed="">
            <Box as="span" css={styles.failedIcon} aria-hidden="true"><FontAwesomeIcon icon={faCircleExclamation} /></Box>
            <Box as="span" css={styles.failedMessage} data-loading-failed-message="">{message}</Box>
            {retry !== undefined && <RetryButton retry={retry} size="xs" />}
        </Box>
    );
}

/** Props of {@link LoadingEmptyLine}. */
export interface LoadingEmptyLineProps {
    /** Its glyph, the Empty state's at the line's size: a Font Awesome solid icon. */
    readonly icon: IconDefinition;
    /** What the read found empty, in the builder's words: `No bins on Wed 12 May`. */
    readonly message: string;
    /** How to fill it — `Drag an arrival onto a lane hour` — after its words where the whole line fits; else dropped whole, kept for screen readers. */
    readonly hint?: string | undefined;
}

/**
 * A region its read found empty, said once (#1398, CL13): one line in the
 * failed line's slot and shape — a row grid's first row in view, the
 * Allocation's day with no bins — the Empty state's glyph, the builder's words
 * and how to fill it, only after the read has landed. One line, never a cut
 * word: the hint follows the words only where the whole line fits, and drops
 * whole where it does not — its words still heard. The host places it in its
 * row, as it places a failed line.
 *
 * @param props - Its glyph, its words and its hint
 * @returns The line
 */
export function LoadingEmptyLine({ icon, message, hint }: LoadingEmptyLineProps) {
    const styles = useLoadingStyles();
    return (
        <Box as="span" css={styles.emptyLine} data-loading-empty="">
            <Box as="span" css={styles.emptyLead}>
                <Box as="span" css={styles.emptyIcon} aria-hidden="true"><FontAwesomeIcon icon={icon} /></Box>
                <Box as="span" css={styles.failedMessage} data-loading-empty-message="">{message}</Box>
            </Box>
            {hint !== undefined && <Box as="span" css={styles.emptyHint} data-loading-empty-hint="">{`· ${hint}`}</Box>}
        </Box>
    );
}

/** A failure's Retry: the shared Button, Default. */
function RetryButton({ retry, size }: { retry: LoadingRetry; size: "xs" | "md" }) {
    return (
        <Button size={size} variant="outline" data-loading-retry="" aria-label={retry.name} loading={retry.busy === true}
            tabIndex={retry.tabStop === false ? -1 : undefined}
            onMouseDown={(event) => { event.stopPropagation(); }}
            onClick={(event) => { event.stopPropagation(); retry.onRetry(); }}>
            {retry.label ?? loadingMessages.retry()}
        </Button>
    );
}

/** Props of {@link LoadingFailedBox}. */
export interface LoadingFailedBoxProps extends LoadingFailedLineProps {
    /** Where it sits: the region's top-left in view, px from the region's own top-left. */
    readonly at: { readonly top: number; readonly left: number };
}

/**
 * A failure said once where no row can hold a line (#1398, CL11): the
 * Schematic's message box, at the region's top-left in view — the
 * Schematic's canvas, the Calendar's month and time grids — never across a
 * row boundary. Its region is its containing block (positioned).
 *
 * @param props - The reason, its Retry and where it sits
 * @returns The box
 */
export function LoadingFailedBox({ message, retry, at }: LoadingFailedBoxProps) {
    const styles = useLoadingStyles();
    return (
        <Box css={styles.failedBox} style={{ top: `${at.top}px`, left: `${at.left}px` }} data-loading-failed-box="">
            <Box as="span" css={styles.failedLine}>
                <Box as="span" css={styles.failedIcon} aria-hidden="true"><FontAwesomeIcon icon={faCircleExclamation} /></Box>
                <Box as="span" css={styles.failedMessage} data-loading-failed-message="">{message}</Box>
            </Box>
            {retry !== undefined && <RetryButton retry={retry} size="md" />}
        </Box>
    );
}

/** Props of {@link PlaceholderCard}. */
export interface PlaceholderCardProps {
    /** Its height, px: a real card of its kind's — never a flat guess. */
    readonly height: number;
    /** Its title when it is already known; absent, a bar in the title line. */
    readonly title?: ReactNode;
    /** The card's index in its list: what keys its bars' widths. */
    readonly index: number;
    /** Whether its placeholders are drawn; absent, they are, unseen inside a builder's `LoadingReveal` until it says so (CL4). */
    readonly filled?: boolean | undefined;
}

/**
 * The narrow layouts' placeholder card (#1398): the Item card at its kind's
 * height, a title bar in its 20px title line — or its real title, already
 * known — and one meta bar in its 16px meta line. `aria-hidden` but for a real
 * title.
 *
 * @param props - Its height, its title when known, its index and whether it is filled
 * @returns The card
 */
export function PlaceholderCard({ height, title, index, filled = true }: PlaceholderCardProps) {
    const styles = useLoadingStyles();
    return (
        <Box css={styles.card} style={{ minHeight: `${height}px` }} data-placeholder-card="" aria-hidden={title === undefined ? "true" : undefined}>
            <Box css={styles.cardBody}>
                <Box css={styles.cardHead}>
                    <Box css={styles.cardTitle}>
                        {title ?? (filled ? <PlaceholderShape kind="label" index={index} styles={styles} /> : null)}
                    </Box>
                    <Box css={styles.cardMeta} aria-hidden="true">
                        {filled && <PlaceholderShape kind="aggregate" index={index} styles={styles} />}
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
