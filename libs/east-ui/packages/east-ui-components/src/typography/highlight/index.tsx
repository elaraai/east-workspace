/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Highlight as ChakraHighlight, Box, type BoxProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Highlight } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";

// Pre-define the equality function at module level
const highlightEqual = equalFor(Highlight.Types.Highlight);

/** East Highlight value type */
export type HighlightValue = ValueTypeOf<typeof Highlight.Types.Highlight>;

export interface HighlightStyleProps {
    query: string[];
    styles?: { color?: string; bg?: string } | undefined;
    wrapperProps?: BoxProps | undefined;
}

/**
 * Converts an East UI Highlight value to Chakra Highlight props.
 * Pure function — reads from the nested `style` sub-struct.
 */
export function toChakraHighlight(value: HighlightValue): HighlightStyleProps {
    const style = getSomeorUndefined(value.style);
    const color = style ? getSomeorUndefined(style.color) : undefined;
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const padding = style ? getSomeorUndefined(style.padding) : undefined;
    const margin = style ? getSomeorUndefined(style.margin) : undefined;

    const highlightStyles: { color?: string; bg?: string } | undefined =
        color || background
            ? {
                ...(color ? { color } : {}),
                ...(background ? { bg: background } : {}),
            }
            : undefined;

    const wrapperProps: BoxProps = {
        textDecoration: style ? getSomeorUndefined(style.textDecoration)?.type : undefined,
        overflow: style ? getSomeorUndefined(style.overflow)?.type : undefined,
        overflowX: style ? getSomeorUndefined(style.overflowX)?.type : undefined,
        overflowY: style ? getSomeorUndefined(style.overflowY)?.type : undefined,
        width: style ? getSomeorUndefined(style.width) : undefined,
        height: style ? getSomeorUndefined(style.height) : undefined,
        minWidth: style ? getSomeorUndefined(style.minWidth) : undefined,
        minHeight: style ? getSomeorUndefined(style.minHeight) : undefined,
        maxWidth: style ? getSomeorUndefined(style.maxWidth) : undefined,
        maxHeight: style ? getSomeorUndefined(style.maxHeight) : undefined,
        pt: padding ? getSomeorUndefined(padding.top) : undefined,
        pr: padding ? getSomeorUndefined(padding.right) : undefined,
        pb: padding ? getSomeorUndefined(padding.bottom) : undefined,
        pl: padding ? getSomeorUndefined(padding.left) : undefined,
        mt: margin ? getSomeorUndefined(margin.top) : undefined,
        mr: margin ? getSomeorUndefined(margin.right) : undefined,
        mb: margin ? getSomeorUndefined(margin.bottom) : undefined,
        ml: margin ? getSomeorUndefined(margin.left) : undefined,
        lineHeight: style ? getSomeorUndefined(style.lineHeight) : undefined,
        letterSpacing: style ? getSomeorUndefined(style.letterSpacing) : undefined,
        opacity: style ? getSomeorUndefined(style.opacity) : undefined,
    };

    // Only include wrapperProps if at least one value is defined
    const hasWrapperProps = Object.values(wrapperProps).some(v => v !== undefined);

    return {
        query: value.query,
        styles: highlightStyles,
        wrapperProps: hasWrapperProps ? wrapperProps : undefined,
    };
}

export interface EastChakraHighlightProps {
    value: HighlightValue;
}

/**
 * Renders an East UI Highlight value using Chakra UI Highlight component.
 */
export const EastChakraHighlight = memo(function EastChakraHighlight({ value }: EastChakraHighlightProps) {
    const props = useMemo(() => toChakraHighlight(value), [value]);

    const highlight = (
        <ChakraHighlight query={props.query} styles={props.styles}>
            {value.value}
        </ChakraHighlight>
    );

    if (props.wrapperProps) {
        return <Box as="span" {...props.wrapperProps}>{highlight}</Box>;
    }

    return highlight;
}, (prev, next) => highlightEqual(prev.value, next.value));
