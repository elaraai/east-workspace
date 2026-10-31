/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A projection target's preview (`Decision Queue Spec.md` P8, P21–P25):
 * each option's series — the target's `points` over the option's own row,
 * which its case carries — a line on one plot, the chosen one drawn last and
 * glowing unless it is the option that changes nothing, which, not chosen, is
 * a dashed ghost; the limit a dashed rule over a wash below it, one tick up
 * the side, the round steps along the bottom, and each line's label
 * ({@link projectionPreview}). It reads no row of the record: what each option
 * leaves is its case's to say.
 *
 * @packageDocumentation
 */

import { useCallback, type CSSProperties } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FloatType, StringType, compareFor, equalFor } from "@elaraai/east";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import type { SlotStyles } from "@elaraai/east-ui-components/internal";
import type { DecisionTarget } from "../editing.js";
import { PreviewFailed, PreviewFrame, PreviewPending, flag, useHeld, type PreviewProps } from "./frame.js";
import { projectionPreview, type ProjectionLine, type ProjectionLineInput, type ProjectionModel } from "./projection-model.js";

/** A projection target's kind, decoded. */
type ProjectionKind = Extract<DecisionTarget["kind"], { type: "projection" }>["value"];

/** What the preview's read gives: the model, a read in flight, or no option with a series. */
type ProjectionRead = { readonly state: "ready"; readonly model: ProjectionModel } | { readonly state: "pending" } | { readonly state: "empty" };

const PENDING: ProjectionRead = { state: "pending" };
const EMPTY: ProjectionRead = { state: "empty" };
const stringEqual = equalFor(StringType);
const compareNumber = compareFor(FloatType);

/** Props of {@link ProjectionPreview}. */
export interface ProjectionPreviewProps extends PreviewProps {
    /** The target's projection kind. */
    readonly kind: ProjectionKind;
}

/** A place on the plot, as the recipe reads it. */
const at = (name: string, percent: number): CSSProperties => ({ [name]: `${percent}%` }) as CSSProperties;

/**
 * A projection target's preview (see the module docs).
 *
 * @param props - The case, its target, the card's view and the queue's words ({@link ProjectionPreviewProps})
 * @returns The preview
 */
export function ProjectionPreview({ c, view, target, kind, rows, words, styles, applied }: ProjectionPreviewProps) {
    const read = useCallback((): ProjectionRead => {
        if (rows === "reading" || rows === "failed") return PENDING;
        const lines: ProjectionLineInput[] = [];
        c.options.forEach((o, i) => {
            if (o.row.type !== "some") return;
            const ours = target.tags.some(tag => stringEqual(tag, o.change.tag));
            lines.push({
                key: `${i}`, label: o.label, points: kind.points(o.row.value), chosen: i === view.chosen,
                asis: ours && target.touched(o.change.patch).length === 0,
            });
        });
        if (lines.length === 0) return EMPTY;
        return { state: "ready", model: projectionPreview(lines, kind.limit.type === "some" ? kind.limit.value.y : undefined) };
    }, [rows, c.options, view.chosen, target, kind]);
    const { result: live } = useTrackedEvaluation(read);
    const result = useHeld(live, applied);
    const stale = rows === "stale";
    if (rows === "failed" || !result.ok) {
        if (!result.ok) console.error(`[DecisionQueue] case ${c.key}'s preview could not read its options' series:`, result.error);
        return <PreviewFailed kind="projection" layout="projection" words={words} styles={styles} />;
    }
    const got = result.value;
    if (got.state === "pending") return <PreviewPending kind="projection" layout="projection" rows={1} words={words} styles={styles} />;
    if (got.state === "empty") return <PreviewFrame kind="projection" layout="projection" label={view.option?.detail ?? ""} stale={stale} applied={applied} styles={styles} />;
    const { m } = words;
    const model = got.model;
    const limit = kind.limit.type === "some" ? kind.limit.value : undefined;
    const yText = (value: number) => (kind.format.type === "some" ? words.value(value, kind.format.value) : words.compact(value));
    const others = model.lines.filter(line => !line.chosen), chosen = model.lines.find(line => line.chosen);
    // The sentence says the chosen line first, then the others in the options' order.
    const label = stale ? m.previewStale({ names: undefined }) : m.previewProjection({
        lines: [...(chosen === undefined ? [] : [chosen]), ...others]
            .map(line => ({ label: line.label, chosen: line.chosen, low: yText(line.low), under: limit !== undefined && compareNumber(line.low, limit.y) < 0 })),
        limit: limit?.label,
    });
    const last = model.x.length - 1;
    return (
        <PreviewFrame kind="projection" layout="projection" label={label} stale={stale} applied={applied} styles={styles}>
            <Box css={styles.projection}>
                <Box css={styles.yAxis} aria-hidden="true" data-preview-axis="y">
                    {model.y !== undefined && <Box as="span" css={styles.yLabel} style={at("--pv-at", model.y.at)}>{yText(model.y.value)}</Box>}
                    {model.limit !== undefined && limit !== undefined
                        && <Box as="span" css={styles.yLabel} data-tone="warn" style={at("--pv-at", model.limit.at)}>{limit.label}</Box>}
                </Box>
                <Box css={styles.projPlot}>
                    {model.limit !== undefined && <Box as="span" css={styles.wash} style={at("--pv-at", model.limit.at)} />}
                    {model.x.slice(1, -1).map(tick => <Box as="span" key={tick.value} css={styles.gridLine} style={at("--pv-at", tick.at)} />)}
                    {model.limit !== undefined && <Box as="span" css={styles.limit} style={at("--pv-at", model.limit.at)} />}
                    <Lines lines={others} glow={false} styles={styles} />
                    {chosen !== undefined && <Lines lines={[chosen]} glow={!chosen.asis} styles={styles} />}
                    {model.lines.map(line => (
                        <Box as="span" key={line.key} css={styles.lineLabel} style={{ ...at("--pv-x", line.at.x), ...at("--pv-y", line.at.y) }}
                            data-place={line.run ? "run" : undefined} data-chosen={flag(line.chosen)} data-preview-row={line.label}>
                            {line.label}
                        </Box>
                    ))}
                </Box>
                <span />
                <Box css={styles.xAxis} aria-hidden="true" data-preview-axis="x">
                    {model.x.map((tick, i) => (
                        <Box as="span" key={tick.value} css={styles.tick} data-edge={i === 0 ? "first" : i === last ? "last" : undefined} style={at("--pv-at", tick.at)}>
                            {words.number(tick.value)}
                        </Box>
                    ))}
                </Box>
            </Box>
        </PreviewFrame>
    );
}

/** Lines on the plot, in one box: the chosen one's glows, unless it changes nothing. */
function Lines({ lines, glow, styles }: { readonly lines: readonly ProjectionLine[]; readonly glow: boolean; readonly styles: SlotStyles }) {
    if (lines.length === 0) return null;
    return (
        <chakra.svg css={styles.lines} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-glow={flag(glow)}>
            {lines.map(line => (
                <chakra.polyline key={line.key} css={styles.line} points={line.path.map(p => `${p.x},${p.y}`).join(" ")}
                    data-line={line.chosen ? "chosen" : line.asis ? "asis" : undefined} data-option={line.label} />
            ))}
        </chakra.svg>
    );
}
