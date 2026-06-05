/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Stat as ChakraStat, HStack, Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Stat } from "@elaraai/east-ui/internal";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";
import { formatTick } from "../../typography/numeric/format-tick";

const statEqual = equalFor(Stat.Types.Stat);

/** East Stat value type. */
export type StatValue = ValueTypeOf<typeof Stat.Types.Stat>;

export interface EastChakraStatProps {
    value: StatValue;
    storageKey: string;
}

const SIZE_MAP: Record<string, "sm" | "md" | "lg"> = {
    sm: "sm",
    md: "md",
    lg: "lg",
};

/* Sentiment colours route through the muted spec palette
 * (pattern_spec/colors_and_type.css `--pos / --neg / --warn / --info`)
 * via the `fg.{success,danger,muted}` semantic tokens. */
const SENTIMENT_PALETTE: Record<string, string> = {
    positive: "fg.success",
    negative: "fg.danger",
    neutral:  "fg.muted",
};

/**
 * Renders an East UI Stat value using Chakra v3 `Stat`.
 *
 * @remarks
 * Dispatches on the main struct slots:
 *
 * - `label` → `Stat.Label`, optionally followed by the `info` ⓘ trigger.
 * - `value` → `Stat.ValueText`, coloured by `style.valueColor` when set.
 * - `baseline` → rendered as a secondary line beneath the value.
 * - `helpText` + `indicator` → `Stat.HelpText`; renderer chooses between
 *   Chakra's built-in Up / Down indicators driven by `indicator.direction`
 *   and, when `indicator.icon` is set, renders that explicit icon instead.
 *   Colour defaults to the palette derived from `indicator.sentiment`
 *   (positive → green, negative → red, neutral → grey), overridden by
 *   `style.indicatorColor`.
 * - `delta` → rendered trailing to the help-text line as a chip.
 */
export const EastChakraStat = memo(function EastChakraStat({ value, storageKey }: EastChakraStatProps) {
    const helpText = useMemo(() => getSomeorUndefined(value.helpText), [value.helpText]);
    const baseline = useMemo(() => getSomeorUndefined(value.baseline), [value.baseline]);
    const delta = useMemo(() => getSomeorUndefined(value.delta), [value.delta]);
    const info = useMemo(() => getSomeorUndefined(value.info), [value.info]);
    const indicator = useMemo(() => getSomeorUndefined(value.indicator), [value.indicator]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    // The value is a scalar `LiteralValueType` variant; numeric tags run
    // through the shared tick formatter, strings render verbatim.
    const formattedValue = useMemo(() => {
        const v = value.value as { type: string; value: unknown };
        const formatOpt = getSomeorUndefined(value.format);
        switch (v.type) {
            case "Float":
            case "Integer":
                return formatTick(Number(v.value as number | bigint), formatOpt);
            case "DateTime":
                return formatTick(new Date(v.value as Date).getTime(), formatOpt);
            case "String":
                return v.value as string;
            default:
                return String(v.value);
        }
    }, [value.value, value.format]);

    const direction = indicator ? indicator.direction.type : undefined;
    const sentiment = indicator ? getSomeorUndefined(indicator.sentiment)?.type : undefined;
    const explicitIcon = indicator ? getSomeorUndefined(indicator.icon) : undefined;

    const sizeType = style ? getSomeorUndefined(style.size)?.type : undefined;
    const size = sizeType ? SIZE_MAP[sizeType] : undefined;
    const valueColor = style ? getSomeorUndefined(style.valueColor) : undefined;
    const labelColor = style ? getSomeorUndefined(style.labelColor) : undefined;
    const helpTextColor = style ? getSomeorUndefined(style.helpTextColor) : undefined;
    const indicatorColor = style
        ? getSomeorUndefined(style.indicatorColor)
            ?? (sentiment ? SENTIMENT_PALETTE[sentiment] : undefined)
        : (sentiment ? SENTIMENT_PALETTE[sentiment] : undefined);

    return (
        <ChakraStat.Root size={size}>
            <HStack gap="1" align="baseline">
                <ChakraStat.Label color={labelColor}>{value.label}</ChakraStat.Label>
                {info && (
                    <Box>
                        <EastChakraComponent value={info} storageKey={`${storageKey}.info`} />
                    </Box>
                )}
            </HStack>
            <ChakraStat.ValueText color={valueColor}>
                {formattedValue}
            </ChakraStat.ValueText>
            {baseline && (
                <Box mt="0.5">
                    <EastChakraComponent value={baseline} storageKey={`${storageKey}.baseline`} />
                </Box>
            )}
            {(helpText || direction || delta) && (
                <ChakraStat.HelpText color={helpTextColor}>
                    <HStack gap="1" align="center">
                        {direction !== undefined && explicitIcon === undefined && (
                            <Box color={indicatorColor}>
                                {direction === "up" && <ChakraStat.UpIndicator />}
                                {direction === "down" && <ChakraStat.DownIndicator />}
                            </Box>
                        )}
                        {explicitIcon !== undefined && (
                            <Box color={indicatorColor}>
                                <FontAwesomeIcon icon={[explicitIcon.prefix as IconPrefix, explicitIcon.name as IconName]} aria-hidden />
                            </Box>
                        )}
                        {helpText && <span>{helpText}</span>}
                        {delta && (
                            <Box ml="auto">
                                <EastChakraComponent value={delta} storageKey={`${storageKey}.delta`} />
                            </Box>
                        )}
                    </HStack>
                </ChakraStat.HelpText>
            )}
        </ChakraStat.Root>
    );
}, (prev, next) => statEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
