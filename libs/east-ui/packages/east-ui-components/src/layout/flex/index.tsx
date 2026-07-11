/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { parseCssSize } from "../../style/parse-size.js";
import { Flex as ChakraFlex, type FlexProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Flex } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { resolveSizingShorthands } from "../sizing.js";
import { DensityProvider } from "../../contracts/density.js";

// Pre-define the equality function at module level
const flexEqual = equalFor(Flex.Types.Flex);

/** East Flex value type */
export type FlexValue = ValueTypeOf<typeof Flex.Types.Flex>;

/**
 * Converts an East UI Flex value to Chakra UI Flex props.
 * Pure function - easy to test independently.
 *
 * @param value - The East Flex value
 * @returns Chakra Flex props
 */
export function toChakraFlex(value: FlexValue): FlexProps {
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
        wrap: style ? getSomeorUndefined(style.wrap)?.type : undefined,
        justifyContent: style ? getSomeorUndefined(style.justifyContent)?.type : undefined,
        alignItems: style ? getSomeorUndefined(style.alignItems)?.type : undefined,
        gap: style ? getSomeorUndefined(style.gap) : undefined,
        width: parseCssSize(style ? getSomeorUndefined(style.width) : undefined),
        height: parseCssSize(style ? getSomeorUndefined(style.height) : undefined),
        minHeight: parseCssSize(style ? getSomeorUndefined(style.minHeight) : undefined),
        minWidth: parseCssSize(style ? getSomeorUndefined(style.minWidth) : undefined),
        maxHeight: parseCssSize(style ? getSomeorUndefined(style.maxHeight) : undefined),
        maxWidth: parseCssSize(style ? getSomeorUndefined(style.maxWidth) : undefined),
        // Padding struct -> individual props
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
        color: style ? getSomeorUndefined(style.color) : undefined,
        borderRadius: style ? getSomeorUndefined(style.borderRadius) : undefined,
        border: style ? getSomeorUndefined(style.border) : undefined,
        borderColor: style ? getSomeorUndefined(style.borderColor) : undefined,
        borderWidth: style ? getSomeorUndefined(style.borderWidth) : undefined,
        overflow: style ? getSomeorUndefined(style.overflow)?.type : undefined,
        overflowX: style ? getSomeorUndefined(style.overflowX)?.type : undefined,
        overflowY: style ? getSomeorUndefined(style.overflowY)?.type : undefined,
        flex: style ? getSomeorUndefined(style.flex) : undefined,
        flexGrow: style ? getSomeorUndefined(style.flexGrow) : undefined,
        flexShrink: style ? getSomeorUndefined(style.flexShrink) : undefined,
        ...sizing,
    };
}

export interface EastChakraFlexProps {
    value: FlexValue;
    storageKey: string;
}

/**
 * Renders an East UI Flex value using Chakra UI Flex component.
 */
export const EastChakraFlex = memo(function EastChakraFlex({ value, storageKey }: EastChakraFlexProps) {
    const props = useMemo(() => toChakraFlex(value), [value]);
    const localDensity = useMemo(() => getSomeorUndefined(value.density)?.type, [value.density]);

    const content = (
        <ChakraFlex {...props}>
            {value.children.map((child, index) => (
                <EastChakraComponent key={index} value={child} storageKey={`${storageKey}.${index}`} />
            ))}
        </ChakraFlex>
    );

    return localDensity !== undefined
        ? <DensityProvider value={localDensity}>{content}</DensityProvider>
        : content;
}, (prev, next) => flexEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
