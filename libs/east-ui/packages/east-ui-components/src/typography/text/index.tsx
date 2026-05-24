/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Text as ChakraText, type TextProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Text } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

// Pre-define the equality function at module level
const textEqual = equalFor(Text.Types.Text);

/** East Text value type */
export type TextValue = ValueTypeOf<typeof Text.Types.Text>;

/**
 * Converts an East UI Text value to Chakra UI Text props.
 * Pure function — reads from the nested `style` sub-struct. Chakra v3's
 * `textStyle` prop resolves the semantic type-scale tokens (display-* /
 * heading-* / body-* / code-* / mono-kpi) through the host theme.
 *
 * @param value - The East Text value
 * @returns Chakra Text props
 */
export function toChakraText(value: TextValue): TextProps {
    const style = getSomeorUndefined(value.style);
    const padding = style ? getSomeorUndefined(style.padding) : undefined;
    const margin = style ? getSomeorUndefined(style.margin) : undefined;

    return {
        // Chakra v3 textStyle consumes the semantic token directly.
        textStyle: style ? getSomeorUndefined(style.textStyle)?.type : undefined,
        color: style ? getSomeorUndefined(style.color) : undefined,
        background: style ? getSomeorUndefined(style.background) : undefined,
        fontWeight: style ? getSomeorUndefined(style.fontWeight)?.type : undefined,
        fontStyle: style ? getSomeorUndefined(style.fontStyle)?.type : undefined,
        fontFamily: style ? getSomeorUndefined(style.fontFamily)?.type : undefined,
        fontVariantNumeric: style ? getSomeorUndefined(style.fontVariantNumeric)?.type : undefined,
        textTransform: style ? getSomeorUndefined(style.textTransform)?.type : undefined,
        textAlign: style ? getSomeorUndefined(style.textAlign)?.type : undefined,
        textOverflow: style ? getSomeorUndefined(style.textOverflow)?.type : undefined,
        textDecoration: style ? getSomeorUndefined(style.textDecoration)?.type : undefined,
        whiteSpace: style ? getSomeorUndefined(style.whiteSpace)?.type : undefined,
        overflow: style ? getSomeorUndefined(style.overflow)?.type : undefined,
        overflowX: style ? getSomeorUndefined(style.overflowX)?.type : undefined,
        overflowY: style ? getSomeorUndefined(style.overflowY)?.type : undefined,
        borderWidth: style ? getSomeorUndefined(style.borderWidth)?.type : undefined,
        borderStyle: style ? getSomeorUndefined(style.borderStyle)?.type : undefined,
        borderColor: style ? getSomeorUndefined(style.borderColor) : undefined,
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

export interface EastChakraTextProps {
    value: TextValue;
}

/**
 * Renders an East UI Text value using Chakra UI Text component.
 */
export const EastChakraText = memo(function EastChakraText({ value }: EastChakraTextProps) {
    const props = useMemo(() => toChakraText(value), [value]);

    return (
        <ChakraText {...props}>
            {value.value}
        </ChakraText>
    );
}, (prev, next) => textEqual(prev.value, next.value));
