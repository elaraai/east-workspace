/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Flex } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { AlignedStack } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { parseCssSize } from "../../style/parse-size.js";
import { EastChakraComponent } from "../../component";
import { PlotGutterProvider, type PlotGutter } from "../../contracts/plot-gutter.js";
import { DensityProvider, type Density } from "../../contracts/density";

const alignedStackEqual = equalFor(AlignedStack.Types.AlignedStack);

/** East AlignedStack value type. */
export type AlignedStackValue = ValueTypeOf<typeof AlignedStack.Types.AlignedStack>;

export interface EastChakraAlignedStackProps {
    value: AlignedStackValue;
    storageKey: string;
}

/**
 * Renders an `<AlignedStack>` — a vertical flex column of axis/lane components
 * that share one plot gutter. A `fixed` gutter is published to the children via
 * {@link PlotGutterProvider}; each lane reads it (`usePlotGutter`) and insets its
 * data lane to `[left, W − right]`.
 *
 * `gutter="auto"` (measure the max gutter across children) is a follow-up: it
 * needs a measure→report→reduce pass where each lane reports the natural gutter
 * its own chrome needs (the chart's y-axis width, a grid's frozen-pane width, …)
 * and the stack imposes the max. Until then `auto` imposes nothing (each child
 * keeps its own gutter); an explicit `gutter={{ left, right }}` is fully wired and
 * is the recommended path for aligning stacked lanes.
 */
export const EastChakraAlignedStack = memo(function EastChakraAlignedStack({ value, storageKey }: EastChakraAlignedStackProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    // Resolve a `fixed` gutter to concrete left/right strings (auto → not yet imposed).
    const gutter = useMemo<PlotGutter | undefined>(() => {
        const g = getSomeorUndefined(value.gutter);
        if (g?.type !== "fixed") return undefined;
        const left = getSomeorUndefined(g.value.left);
        const right = getSomeorUndefined(g.value.right);
        return { ...(left !== undefined ? { left } : {}), ...(right !== undefined ? { right } : {}) };
    }, [value.gutter]);

    // Density imposed on every lane child (#147) — published via the same
    // DensityProvider the components already read (`useDensity`); a child's own
    // `density` still wins.
    const density = useMemo<Density | undefined>(
        () => (style ? getSomeorUndefined(style.density)?.type : undefined),
        [style],
    );

    const content = (
        <Flex
            direction="column"
            gap={(style ? getSomeorUndefined(style.gap) : undefined) ?? "0"}
            width={parseCssSize(style ? getSomeorUndefined(style.width) : undefined) ?? "100%"}
            {...((style && getSomeorUndefined(style.height)) ? { height: parseCssSize(getSomeorUndefined(style.height)) } : {})}
            {...((style && getSomeorUndefined(style.minHeight)) ? { minHeight: parseCssSize(getSomeorUndefined(style.minHeight)) } : {})}
        >
            {value.children.map((child, index) => (
                <EastChakraComponent key={index} value={child} storageKey={`${storageKey}.${index}`} />
            ))}
        </Flex>
    );

    // Compose the providers: density (outermost) → gutter → content. Either is
    // applied only when set, so a plain AlignedStack adds no wrappers.
    let node = content;
    if (gutter !== undefined) node = <PlotGutterProvider value={gutter}>{node}</PlotGutterProvider>;
    if (density !== undefined) node = <DensityProvider value={density}>{node}</DensityProvider>;
    return node;
}, (prev, next) => alignedStackEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
