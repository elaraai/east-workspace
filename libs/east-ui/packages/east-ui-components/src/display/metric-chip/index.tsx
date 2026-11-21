/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, type ReactNode } from "react";
import { Box, Text as ChakraText, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { MetricChip } from "@elaraai/east-ui/internal";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";
import { useDensity, type Density } from "../../contracts/density";

const metricChipEqual = equivalentFor(MetricChip.Types.MetricChip);

/** East MetricChip value type. */
export type MetricChipValue = ValueTypeOf<typeof MetricChip.Types.MetricChip>;

/**
 * The palette each tone gives the outline and solid emphases — the outline
 * is the design system's outlined DeltaPill: the panel paper and a strong
 * rule, a rising or falling value on its own hue's wash and edge. Text takes
 * the valence's text step; an edge or a fill is a mark, the valence base.
 */
const TONE_PALETTE: Record<string, { fg: string; outlineBg: string; outlineBorder: string; solidBg: string; solidFg: string }> = {
    positive: { fg: "fg.success", outlineBg: "success.subtle", outlineBorder: "status.pos",    solidBg: "status.pos",  solidFg: "white" },
    negative: { fg: "fg.danger",  outlineBg: "danger.subtle",  outlineBorder: "status.neg",    solidBg: "status.neg",  solidFg: "white" },
    neutral:  { fg: "fg.subtle",  outlineBg: "bg.panel",       outlineBorder: "border.strong", solidBg: "fg.muted",    solidFg: "white" },
    info:     { fg: "brand.solid", outlineBg: "bg.panel",      outlineBorder: "border.strong", solidBg: "status.info", solidFg: "white" },
};

/** The sizes around the default — `sm` is the recipe's own, the design system's 20px pill; each other is as tall as its line and padding make it. */
const SIZE_PADDING: Record<string, { px: string; py: string; fontSize: string; height: string }> = {
    xs: { px: "1.5", py: "0", fontSize: "body.sm", height: "auto" },
    md: { px: "2.5", py: "1", fontSize: "body.lg", height: "auto" },
    lg: { px: "3", py: "1.5", fontSize: "body.lg", height: "auto" },
    xl: { px: "3.5", py: "2", fontSize: "body.lg", height: "auto" },
};

export interface EastChakraMetricChipProps {
    value: MetricChipValue;
    storageKey: string;
}

/* Map the IR tone tag onto the metricChip slot recipe sentiment variant. */
const TONE_TO_SENTIMENT: Record<string, "up" | "down" | "flat" | "brand"> = {
    positive: "up",
    negative: "down",
    neutral:  "flat",
    info:     "brand",
};

/** A chip's tone: a rising, a falling or a flat value, or the brand's. */
export type MetricChipTone = "positive" | "negative" | "neutral" | "info";

/** Props of {@link MetricChipFrame}. */
export interface MetricChipFrameProps {
    /** Its tone. */
    readonly tone: MetricChipTone;
    /** How it is filled; `subtle` unless given — the design system's DeltaPill, its valence's 6% wash; `outline` adds the valence's edge, `solid` fills it. */
    readonly emphasis?: "subtle" | "outline" | "solid";
    /** Its size; the recipe's own `sm`, the 20px pill, unless given. */
    readonly size?: "xs" | "sm" | "md" | "lg" | "xl";
    /** Its density; the page's unless given. */
    readonly density?: Density;
    /** A Font Awesome icon before the value. */
    readonly icon?: { readonly prefix: string; readonly name: string };
    /** A unit after the value. */
    readonly unit?: string;
    /** Colours over the tone's: a MetricChip's style overrides. */
    readonly colors?: { readonly color?: string; readonly background?: string; readonly borderColor?: string; readonly iconColor?: string };
    /** The value it shows. */
    readonly children: ReactNode;
}

/**
 * A metric chip's frame — the design system's DeltaPill — around any value:
 * the `metricChip` slot recipe's sentiment chrome, an icon, the value and a
 * unit. {@link EastChakraMetricChip} draws its East value in it; a renderer
 * with a number to show — a KPI's change — draws its text in it, with no
 * East component to build.
 *
 * @param props - The tone, the emphasis, the size, an icon, a unit and the value
 * @returns The chip
 */
export function MetricChipFrame({ tone, emphasis = "subtle", size = "sm", density, icon, unit, colors, children }: MetricChipFrameProps) {
    const recipe = useSlotRecipe({ key: "metricChip" });
    const inheritedDensity = useDensity();
    const styles = recipe({ sentiment: TONE_TO_SENTIMENT[tone] ?? "flat", density: density ?? inheritedDensity });
    const sizeProps = SIZE_PADDING[size];
    const palette = TONE_PALETTE[tone] ?? TONE_PALETTE["neutral"]!;

    /* Caller-side colour overrides over the recipe's. Solid emphasis flips the
     * foreground to the high-contrast `solidFg` (white over the saturated
     * background) — without it, the text takes the tone's recipe colour (e.g.
     * `fg.danger`) and reads as red-on-red. */
    const colorOverride = colors?.color ?? (emphasis === "solid" ? palette.solidFg : undefined);
    const backgroundOverride = colors?.background ?? (emphasis === "solid" ? palette.solidBg : emphasis === "outline" ? palette.outlineBg : undefined);
    const borderColorOverride = colors?.borderColor ?? (emphasis === "outline" ? palette.outlineBorder : undefined);
    const iconColor = colors?.iconColor ?? colorOverride ?? palette.fg;

    return (
        <Box
            css={styles.root}
            {...(sizeProps !== undefined ? { px: sizeProps.px, py: sizeProps.py, fontSize: sizeProps.fontSize, height: sizeProps.height } : {})}
            {...(colorOverride !== undefined ? { color: colorOverride } : {})}
            {...(backgroundOverride !== undefined ? { bg: backgroundOverride } : {})}
            {...(borderColorOverride !== undefined ? { borderColor: borderColorOverride } : {})}
            {...(emphasis === "solid" ? { borderColor: "transparent" } : {})}
        >
            {icon && (
                <Box css={styles.indicator} color={iconColor}>
                    <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} aria-hidden />
                </Box>
            )}
            <Box css={styles.value}>{children}</Box>
            {unit && <ChakraText as="span" opacity={0.75}>{unit}</ChakraText>}
        </Box>
    );
}

/** Renders an East UI MetricChip value in its {@link MetricChipFrame}, whose
 * sentiment chrome flows from `theme/slot-recipes/metricChip.ts`. */
export const EastChakraMetricChip = memo(function EastChakraMetricChip({ value, storageKey }: EastChakraMetricChipProps) {
    const localDensity = useMemo(() => getSomeorUndefined(value.density)?.type, [value.density]);
    const unit = useMemo(() => getSomeorUndefined(value.unit), [value.unit]);
    const icon = useMemo(() => getSomeorUndefined(value.icon), [value.icon]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const colors = useMemo(() => {
        if (style === undefined) return undefined;
        const color = getSomeorUndefined(style.color);
        const background = getSomeorUndefined(style.background);
        const borderColor = getSomeorUndefined(style.borderColor);
        const iconColor = getSomeorUndefined(style.iconColor);
        return {
            ...(color !== undefined ? { color } : {}),
            ...(background !== undefined ? { background } : {}),
            ...(borderColor !== undefined ? { borderColor } : {}),
            ...(iconColor !== undefined ? { iconColor } : {}),
        };
    }, [style]);
    const emphasis = style ? getSomeorUndefined(style.emphasis)?.type : undefined;
    const size = style ? getSomeorUndefined(style.size)?.type : undefined;
    return (
        <MetricChipFrame
            tone={value.tone.type}
            {...(emphasis !== undefined ? { emphasis } : {})}
            {...(size !== undefined ? { size } : {})}
            {...(localDensity !== undefined ? { density: localDensity } : {})}
            {...(icon !== undefined ? { icon } : {})}
            {...(unit !== undefined ? { unit } : {})}
            {...(colors !== undefined ? { colors } : {})}
        >
            <EastChakraComponent value={value.value} storageKey={`${storageKey}.value`} />
        </MetricChipFrame>
    );
}, (prev, next) => metricChipEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
