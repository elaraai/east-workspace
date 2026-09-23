/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas's local failures, stated in the chrome (#811).
 *
 * Nothing a row or a source gets wrong replaces the canvas any more — each
 * failure stays where it happened. What the chrome adds is the COUNT and the
 * way there: rows that could not be placed (the chip seeks to the first), a
 * source that could not report its size, a key search that failed, and an
 * axis the grid had to truncate. The desktop toolbar and the narrow layout's
 * chip row mount the same chips.
 */

import { Box, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleXmark, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { formatDerived } from "../format.js";

type Styles = Record<string, Record<string, unknown>>;

/** What the diagnostics chips report. */
export interface PlanDiagnostics {
    /** Rows that render as diagnostic rows (their instants ride another arm). */
    skipped: number;
    /** Seek to the first of them — `undefined` when none is reachable. */
    onSeekSkipped?: (() => void) | undefined;
    /** Why the source could not report its size, when its `total()` threw. */
    sourceError?: string | undefined;
    /** Why the last key search failed, when it did. */
    searchError?: string | undefined;
    /** How many buckets the grid shows, when the axis had to truncate. */
    truncatedAt?: number | undefined;
}

/**
 * Whether there is anything to report.
 *
 * @param d - The diagnostics, when the canvas has computed them
 * @returns `true` when at least one chip would mount
 */
export function hasDiagnostics(d: PlanDiagnostics | undefined): d is PlanDiagnostics {
    return d !== undefined && (d.skipped > 0 || d.sourceError !== undefined
        || d.searchError !== undefined || d.truncatedAt !== undefined);
}

/**
 * The diagnostics chips — the shared `chip` recipe, status on the glyph.
 *
 * @param props - The diagnostics and the resolved `plan` recipe styles
 * @returns The chip cluster
 */
export function PlanDiagnosticChips({ diagnostics, styles }: { diagnostics: PlanDiagnostics; styles: Styles }) {
    const chip = useRecipe({ key: "chip" });
    const base = chip({ size: "sm" });
    const { skipped, onSeekSkipped, sourceError, searchError, truncatedAt } = diagnostics;
    const glyph = (tone: "warning" | "danger") => (
        <Box as="span" css={styles.chipIcon} data-tone={tone}>
            <FontAwesomeIcon icon={tone === "danger" ? faCircleXmark : faTriangleExclamation} />
        </Box>
    );
    const skippedText = `${formatDerived(skipped)} row${skipped === 1 ? "" : "s"} skipped`;
    return (
        <Box css={styles.diagnostics} data-slot="planDiagnostics">
            {/* The rows chip is a button only when it can take you there. */}
            {skipped > 0 && onSeekSkipped !== undefined && (
                <chakra.button type="button" css={[base, styles.diagnosticChip]}
                    data-plan-diagnostics="rows" data-count={skipped}
                    aria-label={`${skippedText} — show the first`}
                    onClick={onSeekSkipped}>
                    {glyph("warning")}
                    <Box as="span">{skippedText}</Box>
                </chakra.button>
            )}
            {skipped > 0 && onSeekSkipped === undefined && (
                <Box as="span" css={[base, styles.diagnosticChip]} data-plan-diagnostics="rows" data-count={skipped} role="status">
                    {glyph("warning")}
                    <Box as="span">{skippedText}</Box>
                </Box>
            )}
            {sourceError !== undefined && (
                <Box as="span" css={[base, styles.diagnosticChip]} data-plan-diagnostics="source" role="status">
                    {glyph("danger")}
                    <Box as="span">{`source unavailable — ${sourceError}`}</Box>
                </Box>
            )}
            {searchError !== undefined && (
                <Box as="span" css={[base, styles.diagnosticChip]} data-plan-diagnostics="search" role="status">
                    {glyph("danger")}
                    <Box as="span">{`search failed — ${searchError}`}</Box>
                </Box>
            )}
            {truncatedAt !== undefined && (
                <Box as="span" css={[base, styles.diagnosticChip]} data-plan-diagnostics="truncated" role="status">
                    {glyph("warning")}
                    <Box as="span">{`showing the first ${formatDerived(truncatedAt)} buckets — zoom in`}</Box>
                </Box>
            )}
        </Box>
    );
}
