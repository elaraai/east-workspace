/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The R2 tone strip (#591) — what a **value-bearing** row collapses to.
 *
 * A row focus compresses its neighbours to 16px context strips. Rows whose
 * marks are *geometry* (span bars, cards chips, bucket tiles) simply shrink to
 * 7px and keep their positions. Rows whose marks are *values* cannot: a
 * numeral has no small form, and a 2px chart stroke is invisible at 7px. An
 * area silhouette does not rescue it either — squashed into 7px it fills solid
 * and carries no shape at all.
 *
 * Luminance is the only channel with resolution left at that height. So a
 * chart or table row re-encodes rather than resizes: one block per bucket,
 * depth tracking the value, negatives in the negative ink, no-data keeping the
 * 45° hatch, breaches in warn. That is precisely what a heat row already is —
 * which is the point. Three kinds collapse into one vocabulary the canvas
 * already speaks, instead of three new ones.
 *
 * @packageDocumentation
 */

import { Box } from "@chakra-ui/react";
import { usePlanScale } from "../context.js";
import type { PlanInstantValue } from "../instant.js";

type Styles = Record<string, Record<string, unknown>>;

/** One bucket's contribution to a tone strip. */
export interface ToneDatum {
    /** The bucket instant. */
    at: PlanInstantValue;
    /** The raw value — `undefined` renders the no-data hatch. */
    value: number | undefined;
    /** An explicit semantic tone, overriding the derived depth. */
    tone?: "neg" | "warn" | undefined;
}

export interface ToneStripProps {
    /** Per-bucket data, in any order (positioned by instant). */
    data: readonly ToneDatum[];
    styles: Styles;
}

/**
 * Render a per-bucket tone strip across the shared axis.
 *
 * @remarks
 * The depth ramp is normalised across THIS row's own values, like a heat row
 * with no declared scale — a strip says "where in this row's range each bucket
 * sits", not "how this row compares to the one above". Comparing rows is what
 * the full-height view is for.
 *
 * A row whose values are all equal (or has one bucket) has no range to
 * normalise against; every block takes the mid depth rather than collapsing to
 * invisible, so a flat row still reads as present rather than empty.
 *
 * @param props - The per-bucket data and the resolved recipe slots
 * @returns The positioned blocks
 */
export function ToneStrip({ data, styles }: ToneStripProps) {
    const scale = usePlanScale();
    const nums = data.filter((d) => d.value !== undefined).map((d) => d.value as number);
    const min = nums.length > 0 ? Math.min(...nums) : 0;
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    const span = max - min;
    return (
        <>
            {data.map((d, i) => {
                const bi = scale.bucketOf(d.at);
                if (bi < 0) return null;
                const b = scale.buckets[bi];
                if (b === undefined) return null;
                const nodata = d.value === undefined;
                // 0.18 floor: a bucket at the bottom of the range is still a
                // measured bucket, and washing it to nothing would read as
                // no-data — which is a different fact with its own hatch.
                const depth = nodata || span <= 0 ? 0.5 : 0.18 + 0.82 * ((d.value as number) - min) / span;
                return (
                    <Box
                        key={i}
                        css={styles.toneCell}
                        data-tone={d.tone}
                        data-nodata={nodata ? "" : undefined}
                        left={`calc(${b.x0 * 100}% + 1px)`}
                        width={`calc(${(b.x1 - b.x0) * 100}% - 2px)`}
                        background={d.tone === undefined && !nodata
                            ? `color-mix(in srgb, var(--chakra-colors-brand-600) ${Math.round(depth * 100)}%, transparent)`
                            : undefined}
                    />
                );
            })}
        </>
    );
}
