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

const numericEqual = equalFor(Numeric.Types.Numeric);

/** East Numeric value type */
export type NumericValue = ValueTypeOf<typeof Numeric.Types.Numeric>;

export interface EastChakraNumericProps {
    value: NumericValue;
}

interface ResolvedFormat {
    intlOptions: Intl.NumberFormatOptions;
    unitSuffix?: string | undefined;
}

/**
 * Resolves a NumericFormatType variant into `Intl.NumberFormat` options.
 */
function resolveFormat(value: NumericValue): ResolvedFormat {
    const formatOpt = getSomeorUndefined(value.format);
    if (!formatOpt) {
        return { intlOptions: {} };
    }

    switch (formatOpt.type) {
        case "Number": {
            const cfg = formatOpt.value as {
                minimumFractionDigits?: { type: "none" } | { type: "some"; value: bigint };
                maximumFractionDigits?: { type: "none" } | { type: "some"; value: bigint };
                signDisplay?: { type: "none" } | { type: "some"; value: { type: Intl.NumberFormatOptions["signDisplay"] } };
            };
            return {
                intlOptions: {
                    style: "decimal",
                    minimumFractionDigits: someNumber(cfg.minimumFractionDigits),
                    maximumFractionDigits: someNumber(cfg.maximumFractionDigits),
                    signDisplay: someSign(cfg.signDisplay),
                },
            };
        }
        case "Currency": {
            const cfg = formatOpt.value as {
                currency: { type: string };
                display?: { type: "none" } | { type: "some"; value: { type: Intl.NumberFormatOptions["currencyDisplay"] } };
                compact?: { type: "none" } | { type: "some"; value: { type: Intl.NumberFormatOptions["compactDisplay"] } };
                minimumFractionDigits?: { type: "none" } | { type: "some"; value: bigint };
                maximumFractionDigits?: { type: "none" } | { type: "some"; value: bigint };
            };
            return {
                intlOptions: {
                    style: "currency",
                    currency: cfg.currency.type,
                    currencyDisplay: cfg.display?.type === "some" ? cfg.display.value.type as Intl.NumberFormatOptions["currencyDisplay"] : undefined,
                    notation: cfg.compact?.type === "some" ? "compact" : undefined,
                    compactDisplay: cfg.compact?.type === "some" ? cfg.compact.value.type as Intl.NumberFormatOptions["compactDisplay"] : undefined,
                    minimumFractionDigits: someNumber(cfg.minimumFractionDigits),
                    maximumFractionDigits: someNumber(cfg.maximumFractionDigits),
                },
            };
        }
        case "Percent": {
            const cfg = formatOpt.value as {
                minimumFractionDigits?: { type: "none" } | { type: "some"; value: bigint };
                maximumFractionDigits?: { type: "none" } | { type: "some"; value: bigint };
                signDisplay?: { type: "none" } | { type: "some"; value: { type: Intl.NumberFormatOptions["signDisplay"] } };
            };
            return {
                intlOptions: {
                    style: "percent",
                    minimumFractionDigits: someNumber(cfg.minimumFractionDigits),
                    maximumFractionDigits: someNumber(cfg.maximumFractionDigits),
                    signDisplay: someSign(cfg.signDisplay),
                },
            };
        }
        case "Compact": {
            const cfg = formatOpt.value as {
                display?: { type: "none" } | { type: "some"; value: { type: Intl.NumberFormatOptions["compactDisplay"] } };
            };
            return {
                intlOptions: {
                    notation: "compact",
                    compactDisplay: cfg.display?.type === "some" ? cfg.display.value.type as Intl.NumberFormatOptions["compactDisplay"] : undefined,
                },
            };
        }
        case "Unit": {
            const cfg = formatOpt.value as {
                unit: { type: string };
                display?: { type: "none" } | { type: "some"; value: { type: Intl.NumberFormatOptions["unitDisplay"] } };
            };
            return {
                intlOptions: {
                    style: "unit",
                    unit: cfg.unit.type,
                    unitDisplay: cfg.display?.type === "some" ? cfg.display.value.type as Intl.NumberFormatOptions["unitDisplay"] : undefined,
                },
            };
        }
    }

    return { intlOptions: {} };
}

function someNumber(opt?: { type: "none" } | { type: "some"; value: bigint }): number | undefined {
    if (!opt || opt.type === "none") return undefined;
    return Number(opt.value);
}

function someSign(opt?: { type: "none" } | { type: "some"; value: { type: Intl.NumberFormatOptions["signDisplay"] } }): Intl.NumberFormatOptions["signDisplay"] | undefined {
    if (!opt || opt.type === "none") return undefined;
    return opt.value.type;
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
 * Renders an East UI Numeric value. Default `textStyle` is `mono-kpi`
 * (mono font + tabular-nums + display sizing). Leading `+` / `−` are split
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

        const { intlOptions } = resolveFormat(value);
        const formatter = new Intl.NumberFormat(undefined, {
            ...(showSign && !intlOptions.signDisplay ? { signDisplay: "exceptZero" } : {}),
            ...intlOptions,
        });

        const formatted = formatter.format(value.value);
        const tintedColor = color ?? sentimentColour(sentimentTag);

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
                    textStyle={textStyleTag ?? "mono-kpi"}
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
                textStyle={textStyleTag ?? "mono-kpi"}
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
