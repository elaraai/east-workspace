/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Link as ChakraLink, type LinkProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Link } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

// Pre-define the equality function at module level
const linkEqual = equalFor(Link.Types.Link);

/** East Link value type */
export type LinkValue = ValueTypeOf<typeof Link.Types.Link>;

/**
 * Converts an East UI Link value to Chakra UI Link props.
 * Pure function — reads `external` from the main struct and visual fields
 * from the nested `style` sub-struct.
 */
export function toChakraLink(value: LinkValue): LinkProps {
    const external = getSomeorUndefined(value.external);
    const style = getSomeorUndefined(value.style);
    const padding = style ? getSomeorUndefined(style.padding) : undefined;
    const margin = style ? getSomeorUndefined(style.margin) : undefined;
    const color = style ? getSomeorUndefined(style.color) : undefined;
    const hoverColor = style ? getSomeorUndefined(style.hoverColor) : undefined;
    const visitedColor = style ? getSomeorUndefined(style.visitedColor) : undefined;

    // Compose hover / visited colour overrides via the `css` prop since Chakra's
    // Link props don't natively expose per-pseudo-class colour slots.
    const css: Record<string, unknown> = {};
    if (hoverColor !== undefined) {
        css["&:hover"] = { color: hoverColor };
    }
    if (visitedColor !== undefined) {
        css["&:visited"] = { color: visitedColor };
    }

    return {
        href: value.href,
        variant: style ? getSomeorUndefined(style.variant)?.type : undefined,
        colorPalette: style ? getSomeorUndefined(style.colorPalette) : undefined,
        color,
        ...(external ? { target: "_blank", rel: "noopener noreferrer" } : {}),
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
        ...(Object.keys(css).length > 0 ? { css } : {}),
    };
}

export interface EastChakraLinkProps {
    value: LinkValue;
}

/**
 * Renders an East UI Link value using Chakra UI Link component.
 */
export const EastChakraLink = memo(function EastChakraLink({ value }: EastChakraLinkProps) {
    const props = useMemo(() => toChakraLink(value), [value]);

    return <ChakraLink {...props}>{value.value}</ChakraLink>;
}, (prev, next) => linkEqual(prev.value, next.value));
