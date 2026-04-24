/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Badge as ChakraBadge, type BadgeProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Badge } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

const badgeEqual = equalFor(Badge.Types.Badge);

/** East Badge value type. */
export type BadgeValue = ValueTypeOf<typeof Badge.Types.Badge>;

/**
 * Converts an East UI Badge value into Chakra `BadgeProps`.
 *
 * @remarks
 * Per the main/style type-shape convention, the main struct carries only
 * `value` (the badge text). Every visual field lives in `value.style`.
 */
export function toChakraBadge(value: BadgeValue): BadgeProps {
    const style = getSomeorUndefined(value.style);
    if (style === undefined) {
        return { display: "flex" };
    }

    const padding = getSomeorUndefined(style.padding);
    const margin = getSomeorUndefined(style.margin);

    return {
        display: "flex",
        variant: getSomeorUndefined(style.variant)?.type,
        colorPalette: getSomeorUndefined(style.colorPalette)?.type,
        size: getSomeorUndefined(style.size)?.type,
        opacity: getSomeorUndefined(style.opacity),
        color: getSomeorUndefined(style.color),
        background: getSomeorUndefined(style.background),
        borderRadius: getSomeorUndefined(style.borderRadius),
        borderWidth: getSomeorUndefined(style.borderWidth)?.type,
        borderStyle: getSomeorUndefined(style.borderStyle)?.type,
        borderColor: getSomeorUndefined(style.borderColor),
        overflow: getSomeorUndefined(style.overflow)?.type,
        overflowX: getSomeorUndefined(style.overflowX)?.type,
        overflowY: getSomeorUndefined(style.overflowY)?.type,
        justifyContent: getSomeorUndefined(style.justifyContent)?.type,
        alignItems: getSomeorUndefined(style.alignItems)?.type,
        width: getSomeorUndefined(style.width),
        height: getSomeorUndefined(style.height),
        minWidth: getSomeorUndefined(style.minWidth),
        minHeight: getSomeorUndefined(style.minHeight),
        maxWidth: getSomeorUndefined(style.maxWidth),
        maxHeight: getSomeorUndefined(style.maxHeight),
        pt: padding ? getSomeorUndefined(padding.top) : undefined,
        pr: padding ? getSomeorUndefined(padding.right) : undefined,
        pb: padding ? getSomeorUndefined(padding.bottom) : undefined,
        pl: padding ? getSomeorUndefined(padding.left) : undefined,
        mt: margin ? getSomeorUndefined(margin.top) : undefined,
        mr: margin ? getSomeorUndefined(margin.right) : undefined,
        mb: margin ? getSomeorUndefined(margin.bottom) : undefined,
        ml: margin ? getSomeorUndefined(margin.left) : undefined,
    };
}

export interface EastChakraBadgeProps {
    value: BadgeValue;
}

/** Renders an East UI Badge value using Chakra v3 `Badge`. */
export const EastChakraBadge = memo(function EastChakraBadge({ value }: EastChakraBadgeProps) {
    const props = useMemo(() => toChakraBadge(value), [value]);
    return <ChakraBadge {...props}>{value.value}</ChakraBadge>;
}, (prev, next) => badgeEqual(prev.value, next.value));
