/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Flex } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { AlignedStack } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { PlotGutterProvider, type PlotGutter } from "../../contracts/plot-gutter.js";

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
 * `gutter="auto"` (measure the max gutter across children) is not yet wired — it
 * needs a measure→reduce pass and lands with the Gantt phase; `auto` currently
 * imposes nothing (children keep their own gutters).
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

    const content = (
        <Flex
            direction="column"
            gap={(style ? getSomeorUndefined(style.gap) : undefined) ?? "0"}
            width={(style ? getSomeorUndefined(style.width) : undefined) ?? "100%"}
            {...((style && getSomeorUndefined(style.height)) ? { height: getSomeorUndefined(style.height) } : {})}
            {...((style && getSomeorUndefined(style.minHeight)) ? { minHeight: getSomeorUndefined(style.minHeight) } : {})}
        >
            {value.children.map((child, index) => (
                <EastChakraComponent key={index} value={child} storageKey={`${storageKey}.${index}`} />
            ))}
        </Flex>
    );

    return gutter !== undefined
        ? <PlotGutterProvider value={gutter}>{content}</PlotGutterProvider>
        : content;
}, (prev, next) => alignedStackEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
