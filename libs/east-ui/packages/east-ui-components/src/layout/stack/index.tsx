/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { parseCssSize } from "../../style/parse-size.js";
import { Stack as ChakraStack, type StackProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Stack } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { resolveSizingShorthands } from "../sizing.js";
import { DensityProvider } from "../../contracts/density.js";

// Pre-define the equality function at module level
const stackEqual = equalFor(Stack.Types.Stack);

/** East Stack value type */
export type StackValue = ValueTypeOf<typeof Stack.Types.Stack>;

/**
 * Converts an East UI Stack value to Chakra UI Stack props.
 * Pure function - easy to test independently.
 *
 * @param value - The East Stack value
 * @returns Chakra Stack props
 */
export function toChakraStack(value: StackValue): StackProps {
    const style = getSomeorUndefined(value.style);
    const padding = style ? getSomeorUndefined(style.padding) : undefined;
    const margin = style ? getSomeorUndefined(style.margin) : undefined;

    // Sizing shorthands (fill / scroll / definite-size shrink) resolve to the
    // flex-item + overflow + min-size subset, spread last so they win (#320).
    const heightVal = style ? getSomeorUndefined(style.height) : undefined;
    const widthVal = style ? getSomeorUndefined(style.width) : undefined;
    const sizing = resolveSizingShorthands({
        fill: style ? getSomeorUndefined(style.fill) : undefined,
        scroll: style ? getSomeorUndefined(style.scroll) : undefined,
        scrollX: style ? getSomeorUndefined(style.scrollX) : undefined,
        scrollY: style ? getSomeorUndefined(style.scrollY) : undefined,
        hasHeight: heightVal !== undefined,
        hasWidth: widthVal !== undefined,
        explicit: {
            flex: style ? getSomeorUndefined(style.flex) : undefined,
            flexGrow: style ? getSomeorUndefined(style.flexGrow) : undefined,
            flexShrink: style ? getSomeorUndefined(style.flexShrink) : undefined,
            overflow: style ? getSomeorUndefined(style.overflow)?.type : undefined,
            overflowX: style ? getSomeorUndefined(style.overflowX)?.type : undefined,
            overflowY: style ? getSomeorUndefined(style.overflowY)?.type : undefined,
            minWidth: parseCssSize(style ? getSomeorUndefined(style.minWidth) : undefined),
            minHeight: parseCssSize(style ? getSomeorUndefined(style.minHeight) : undefined),
        },
    });

    return {
        direction: style ? getSomeorUndefined(style.direction)?.type : undefined,
        gap: style ? getSomeorUndefined(style.gap) : undefined,
        align: style ? getSomeorUndefined(style.align)?.type : undefined,
        justify: style ? getSomeorUndefined(style.justify)?.type : undefined,
        wrap: style ? getSomeorUndefined(style.wrap)?.type : undefined,
        pt: padding ? getSomeorUndefined(padding.top) : undefined,
        pr: padding ? getSomeorUndefined(padding.right) : undefined,
        pb: padding ? getSomeorUndefined(padding.bottom) : undefined,
        pl: padding ? getSomeorUndefined(padding.left) : undefined,
        // Margin struct -> individual props
        mt: margin ? getSomeorUndefined(margin.top) : undefined,
        mr: margin ? getSomeorUndefined(margin.right) : undefined,
        mb: margin ? getSomeorUndefined(margin.bottom) : undefined,
        ml: margin ? getSomeorUndefined(margin.left) : undefined, 
        background: style ? getSomeorUndefined(style.background) : undefined,
        borderRadius: style ? getSomeorUndefined(style.borderRadius) : undefined,
        border: style ? getSomeorUndefined(style.border) : undefined,
        borderColor: style ? getSomeorUndefined(style.borderColor) : undefined,
        borderWidth: style ? getSomeorUndefined(style.borderWidth) : undefined,
        width: parseCssSize(style ? getSomeorUndefined(style.width) : undefined),
        height: parseCssSize(style ? getSomeorUndefined(style.height) : undefined),
        minHeight: parseCssSize(style ? getSomeorUndefined(style.minHeight) : undefined),
        minWidth: parseCssSize(style ? getSomeorUndefined(style.minWidth) : undefined),
        maxHeight: parseCssSize(style ? getSomeorUndefined(style.maxHeight) : undefined),
        maxWidth: parseCssSize(style ? getSomeorUndefined(style.maxWidth) : undefined),
        overflow: style ? getSomeorUndefined(style.overflow)?.type : undefined,
        overflowX: style ? getSomeorUndefined(style.overflowX)?.type : undefined,
        overflowY: style ? getSomeorUndefined(style.overflowY)?.type : undefined,
        ...sizing,
    };
}

export interface EastChakraStackProps {
    value: StackValue;
    storageKey: string;
}

/**
 * Renders an East UI Stack value using Chakra UI Stack component.
 */
export const EastChakraStack = memo(function EastChakraStack({ value, storageKey }: EastChakraStackProps) {
    const props = useMemo(() => toChakraStack(value), [value]);
    const localDensity = useMemo(() => getSomeorUndefined(value.density)?.type, [value.density]);

    const content = (
        <ChakraStack {...props}>
            {value.children.map((child, index) => (
                <EastChakraComponent key={index} value={child} storageKey={`${storageKey}.${index}`} />
            ))}
        </ChakraStack>
    );

    return localDensity !== undefined
        ? <DensityProvider value={localDensity}>{content}</DensityProvider>
        : content;
}, (prev, next) => stackEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
