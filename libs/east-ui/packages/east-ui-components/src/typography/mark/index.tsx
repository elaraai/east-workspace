/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Mark as ChakraMark, type MarkProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Mark } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { parseCssSize } from "../../style/parse-size.js";

// Pre-define the equality function at module level
const markEqual = equalFor(Mark.Types.Mark);

/** East Mark value type */
export type MarkValue = ValueTypeOf<typeof Mark.Types.Mark>;

/**
 * Converts an East UI Mark value to Chakra UI Mark props.
 * Pure function — reads from the nested `style` sub-struct.
 */
export function toChakraMark(value: MarkValue): MarkProps {
    const style = getSomeorUndefined(value.style);
    const padding = style ? getSomeorUndefined(style.padding) : undefined;
    const margin = style ? getSomeorUndefined(style.margin) : undefined;

    return {
        variant: style ? getSomeorUndefined(style.variant)?.type : undefined,
        colorPalette: style ? getSomeorUndefined(style.colorPalette) : undefined,
        color: style ? getSomeorUndefined(style.color) : undefined,
        bg: style ? getSomeorUndefined(style.background) : undefined,
        textDecoration: style ? getSomeorUndefined(style.textDecoration)?.type : undefined,
        overflow: style ? getSomeorUndefined(style.overflow)?.type : undefined,
        overflowX: style ? getSomeorUndefined(style.overflowX)?.type : undefined,
        overflowY: style ? getSomeorUndefined(style.overflowY)?.type : undefined,
        width: parseCssSize(style ? getSomeorUndefined(style.width) : undefined),
        height: parseCssSize(style ? getSomeorUndefined(style.height) : undefined),
        minWidth: parseCssSize(style ? getSomeorUndefined(style.minWidth) : undefined),
        minHeight: parseCssSize(style ? getSomeorUndefined(style.minHeight) : undefined),
        maxWidth: parseCssSize(style ? getSomeorUndefined(style.maxWidth) : undefined),
        maxHeight: parseCssSize(style ? getSomeorUndefined(style.maxHeight) : undefined),
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

export interface EastChakraMarkProps {
    value: MarkValue;
}

/**
 * Renders an East UI Mark value using Chakra UI Mark component.
 */
export const EastChakraMark = memo(function EastChakraMark({ value }: EastChakraMarkProps) {
    const props = useMemo(() => toChakraMark(value), [value]);

    return <ChakraMark {...props}>{value.value}</ChakraMark>;
}, (prev, next) => markEqual(prev.value, next.value));
