/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Heading as ChakraHeading, type HeadingProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Heading } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

// Pre-define the equality function at module level
const headingEqual = equalFor(Heading.Types.Heading);

/** East Heading value type */
export type HeadingValue = ValueTypeOf<typeof Heading.Types.Heading>;

/**
 * Converts an East UI Heading value to Chakra UI Heading props.
 * Pure function — reads `as` from the main struct and all visual fields from
 * the nested `style` sub-struct. Chakra v3's `textStyle` prop consumes the
 * semantic type-scale token.
 */
export function toChakraHeading(value: HeadingValue): HeadingProps {
    const style = getSomeorUndefined(value.style);
    const padding = style ? getSomeorUndefined(style.padding) : undefined;
    const margin = style ? getSomeorUndefined(style.margin) : undefined;

    return {
        as: getSomeorUndefined(value.as)?.type as HeadingProps["as"],
        textStyle: style ? getSomeorUndefined(style.textStyle)?.type : undefined,
        fontWeight: style ? getSomeorUndefined(style.fontWeight)?.type : undefined,
        fontStyle: style ? getSomeorUndefined(style.fontStyle)?.type : undefined,
        fontFamily: style ? getSomeorUndefined(style.fontFamily)?.type : undefined,
        color: style ? getSomeorUndefined(style.color) : undefined,
        background: style ? getSomeorUndefined(style.background) : undefined,
        textAlign: style ? getSomeorUndefined(style.textAlign)?.type : undefined,
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
}

export interface EastChakraHeadingProps {
    value: HeadingValue;
}

/**
 * Renders an East UI Heading value using Chakra UI Heading component.
 */
export const EastChakraHeading = memo(function EastChakraHeading({ value }: EastChakraHeadingProps) {
    const props = useMemo(() => toChakraHeading(value), [value]);

    return <ChakraHeading {...props}>{value.value}</ChakraHeading>;
}, (prev, next) => headingEqual(prev.value, next.value));
