/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Code as ChakraCode, type CodeProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Code } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { parseCssSize } from "../../style/parse-size.js";

// Pre-define the equality function at module level
const codeEqual = equalFor(Code.Types.Code);

/** East Code value type */
export type CodeValue = ValueTypeOf<typeof Code.Types.Code>;

/**
 * Converts an East UI Code value to Chakra UI Code props.
 * Pure function — reads from the nested `style` sub-struct.
 */
export function toChakraCode(value: CodeValue): CodeProps {
    const style = getSomeorUndefined(value.style);
    const padding = style ? getSomeorUndefined(style.padding) : undefined;
    const margin = style ? getSomeorUndefined(style.margin) : undefined;

    return {
        variant: style ? getSomeorUndefined(style.variant)?.type : undefined,
        colorPalette: style ? getSomeorUndefined(style.colorPalette) : undefined,
        size: style ? getSomeorUndefined(style.size)?.type : undefined,
        color: style ? getSomeorUndefined(style.color) : undefined,
        bg: style ? getSomeorUndefined(style.background) : undefined,
        borderColor: style ? getSomeorUndefined(style.borderColor) : undefined,
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

export interface EastChakraCodeProps {
    value: CodeValue;
}

/**
 * Renders an East UI Code value using Chakra UI Code component.
 */
export const EastChakraCode = memo(function EastChakraCode({ value }: EastChakraCodeProps) {
    const props = useMemo(() => toChakraCode(value), [value]);

    return <ChakraCode {...props}>{value.value}</ChakraCode>;
}, (prev, next) => codeEqual(prev.value, next.value));
