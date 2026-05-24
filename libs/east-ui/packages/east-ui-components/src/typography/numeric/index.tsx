/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Enforcement:
 *   - Locale-aware formatting (Intl.NumberFormat): this renderer
 *   - Sentiment → colour mapping: this renderer (theme resolves values)
 *   - Style override priority: style.color > sentiment-derived default > theme
 */

import { memo, useMemo } from "react";
import { Box, Text as ChakraText } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Numeric } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import { formatTick } from "./format-tick";

const numericEqual = equalFor(Numeric.Types.Numeric);

/** East Numeric value type */
export type NumericValue = ValueTypeOf<typeof Numeric.Types.Numeric>;

export interface EastChakraNumericProps {
    value: NumericValue;
}

function sentimentColour(sentimentTag: string | undefined): string | undefined {
    switch (sentimentTag) {
        case "positive": return "fg.success";
        case "negative": return "fg.danger";
        case "neutral":  return "fg.muted";
        default: return undefined;
    }
}

/**
 * Renders an East UI Numeric value. Default `textStyle` is an inline 14px
 * tabular mono run (`mono.lg`); opt into a hero size via `style.textStyle`
 * (e.g. `"mono-kpi"`). Leading `+` / `−` are split
 * into a separate span when `style.signColor` is set so they can be tinted
 * independently of the digit run.
 */
export const EastChakraNumeric = memo(function EastChakraNumeric({ value }: EastChakraNumericProps) {
    const rendered = useMemo(() => {
        const style = getSomeorUndefined(value.style);
        const sentimentTag = getSomeorUndefined(value.sentiment)?.type;
        const showSign = getSomeorUndefined(value.showSign) ?? false;
        const textStyleTag = style ? getSomeorUndefined(style.textStyle)?.type : undefined;
        const color = style ? getSomeorUndefined(style.color) : undefined;
        const background = style ? getSomeorUndefined(style.background) : undefined;
        const signColor = style ? getSomeorUndefined(style.signColor) : undefined;
        const opacity = style ? getSomeorUndefined(style.opacity) : undefined;

        const formatted = formatTick(value.value, getSomeorUndefined(value.format), showSign);
        const tintedColor = color ?? sentimentColour(sentimentTag);
        // Inline-friendly default: a 14px tabular mono run that sits in body
        // text. Hero KPIs opt into a display size via `style.textStyle`
        // (e.g. "mono-kpi").
        const resolvedTextStyle = textStyleTag ?? "mono.lg";

        // If the caller wants the sign glyph tinted separately AND the formatted
        // string leads with a sign, split it so we can colour the sign span on
        // its own. Otherwise the whole run shares a single colour.
        const splitSign = signColor !== undefined && /^[+\-−]/.test(formatted);
        if (splitSign) {
            const first = formatted.charAt(0);
            const rest = formatted.slice(1);
            return (
                <ChakraText
                    as="span"
                    textStyle={resolvedTextStyle}
                    fontVariantNumeric="tabular-nums"
                    color={tintedColor}
                    bg={background}
                    opacity={opacity}
                >
                    <Box as="span" color={signColor}>{first}</Box>{rest}
                </ChakraText>
            );
        }

        return (
            <ChakraText
                as="span"
                textStyle={resolvedTextStyle}
                fontVariantNumeric="tabular-nums"
                color={tintedColor}
                bg={background}
                opacity={opacity}
            >
                {formatted}
            </ChakraText>
        );
    }, [value]);

    return rendered;
}, (prev, next) => numericEqual(prev.value, next.value));
