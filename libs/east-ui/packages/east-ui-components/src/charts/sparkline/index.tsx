/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { useChakraContext } from "@chakra-ui/react";
import { FloatType, equivalentFor, lessFor, type ValueTypeOf } from "@elaraai/east";
import { Sparkline, drawsDomain } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";

// Pre-define the equality function at module level
const sparklineEqual = equivalentFor(Sparkline.Types.Sparkline);

/** East Sparkline value type */
export type SparklineValue = ValueTypeOf<typeof Sparkline.Types.Sparkline>;

/**
 * Sparkline style props for rendering.
 */
export interface SparklineStyleProps {
    data: number[];
    chartType: "line" | "area";
    color: string;
    width: string;
    height: string;
}

/**
 * Converts an East UI Sparkline value to Sparkline style props.
 * Pure function - easy to test independently.
 *
 * @param value - The East Sparkline value
 * @returns Sparkline style props
 */
export function toChakraSparkline(value: SparklineValue): SparklineStyleProps {
    const style = getSomeorUndefined(value.style);
    return {
        data: value.data,
        chartType: getSomeorUndefined(value.type)?.type ?? "line",
        color: (style ? getSomeorUndefined(style.color) : undefined) ?? "currentColor",
        width: (style ? getSomeorUndefined(style.width) : undefined) ?? "100%",
        height: (style ? getSomeorUndefined(style.height) : undefined) ?? "100%",
    };
}

export interface EastChakraSparklineProps {
    value: SparklineValue;
}

/** East's order of Floats: what says a series' min is below its max. */
const floatLess = lessFor(FloatType);

/**
 * Generates SVG path data for sparkline.
 * Uses a normalized coordinate system (0-100) that scales with viewBox.
 *
 * @param data - The values, in order
 * @param isArea - Whether the area under the line is filled too
 * @param domain - One vertical scale for the values (east-workspace#1729): each drawn at its place in it, one past
 *   either end at that end; `undefined`, or one whose bounds are no finite numbers or whose max is not past its min,
 *   the data's own min and max — and a single value, or one value throughout, at the middle
 * @returns The line's path, and the area's (`""` for a line)
 */
export function generatePaths(
    data: number[],
    isArea: boolean,
    domain?: { readonly min: number; readonly max: number },
): { linePath: string; areaPath: string } {
    if (data.length === 0) {
        return { linePath: "", areaPath: "" };
    }

    const padding = 2;
    const width = 100;
    const height = 100;
    const scale = domain !== undefined && drawsDomain(domain.min, domain.max) ? domain : undefined;
    // A value's height on the domain, a value past either end at that end.
    const yOn = (value: number, min: number, max: number) =>
        height - padding - ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * (height - padding * 2);

    if (data.length === 1) {
        const y = scale !== undefined ? yOn(data[0]!, scale.min, scale.max) : height / 2;
        const linePath = `M ${padding} ${y} L ${width - padding} ${y}`;
        const areaPath = isArea
            ? `M ${padding} ${height - padding} L ${padding} ${y} L ${width - padding} ${y} L ${width - padding} ${height - padding} Z`
            : "";
        return { linePath, areaPath };
    }

    const min = scale?.min ?? Math.min(...data);
    const max = scale?.max ?? Math.max(...data);
    const range = max - min || 1;
    // One value throughout, and no domain to place it on: the line runs across the middle, as a single value's does
    // (east-workspace#1734's review) — over a range of none it would lie on the box's foot.
    const flat = scale === undefined && !floatLess(min, max);

    const xStep = (width - padding * 2) / (data.length - 1);
    const yScale = (height - padding * 2) / range;

    const points = data.map((value, i) => {
        const x = padding + i * xStep;
        const y = scale !== undefined ? yOn(value, scale.min, scale.max) : flat ? height / 2 : height - padding - (value - min) * yScale;
        return { x, y };
    });

    const linePath = `M ${points.map(p => `${p.x} ${p.y}`).join(" L ")}`;

    let areaPath = "";
    let first = points[0]
    let last = points[points.length - 1]
    if (isArea && first !== undefined && last !== undefined) {
        const firstX = first.x;
        const lastX = last.x;
        const bottom = height - padding;
        areaPath = `M ${firstX} ${bottom} L ${points.map(p => `${p.x} ${p.y}`).join(" L ")} L ${lastX} ${bottom} Z`;
    }

    return { linePath, areaPath };
}

/**
 * Renders an East UI Sparkline value using simple inline SVG.
 * Lightweight implementation suitable for table cells and dense layouts.
 */
export const EastChakraSparkline = memo(function EastChakraSparkline({ value }: EastChakraSparklineProps) {
    const props = useMemo(() => toChakraSparkline(value), [value]);
    const system = useChakraContext();

    const isArea = useMemo(() => props.chartType === "area", [props.chartType]);
    // One vertical scale, where the value gives one (east-workspace#1729).
    const domain = useMemo(() => getSomeorUndefined(value.domain), [value.domain]);

    const paths = useMemo(
        () => generatePaths(props.data, isArea, domain),
        [props.data, isArea, domain]
    );

    // Resolve color token using Chakra's token system
    const resolvedColor = useMemo(() => {
        if (props.color === "currentColor") {
            return props.color;
        }
        // Use Chakra's token function to resolve "blue.500" -> "var(--chakra-colors-blue-500)"
        return system.token(`colors.${props.color}`, props.color);
    }, [props.color, system]);

    if (props.data.length === 0) {
        return null;
    }

    return (
        <svg
            width={props.width}
            height={props.height}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ display: "block" }}
        >
            {isArea && paths.areaPath && (
                <path
                    d={paths.areaPath}
                    fill={resolvedColor}
                    fillOpacity={0.2}
                />
            )}
            <path
                d={paths.linePath}
                fill="none"
                stroke={resolvedColor}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}, (prev, next) => sparklineEqual(prev.value, next.value));
