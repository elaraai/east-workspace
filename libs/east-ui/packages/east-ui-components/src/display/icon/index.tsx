/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Box as ChakraBox, type BoxProps } from "@chakra-ui/react";
import { FontAwesomeIcon, type FontAwesomeIconProps } from "@fortawesome/react-fontawesome";
import { library, type IconName, type IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { far } from "@fortawesome/free-regular-svg-icons";
import { fab } from "@fortawesome/free-brands-svg-icons";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Icon } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

library.add(fas, far, fab);

const iconEqual = equalFor(Icon.Types.Icon);

/** East Icon value type. */
export type IconValue = ValueTypeOf<typeof Icon.Types.Icon>;

/** Map East size to Font Awesome size. */
const sizeMap: Record<string, FontAwesomeIconProps["size"]> = {
    xs: "xs",
    sm: "sm",
    md: undefined,
    lg: "lg",
    xl: "xl",
    "2xl": "2xl",
};

/**
 * Converts an East UI Icon value into `FontAwesomeIconProps`.
 *
 * @remarks
 * Visual style lives under `value.style`. When `value.label` is present
 * the Font Awesome `title` prop is set (§0.2 meaningful-icon contract);
 * otherwise the library's default `aria-hidden="true"` applies (decorative).
 */
export function toFontAwesomeIcon(value: IconValue): FontAwesomeIconProps {
    const style = getSomeorUndefined(value.style);
    const label = getSomeorUndefined(value.label);
    const sizeType = style ? getSomeorUndefined(style.size)?.type : undefined;
    const color = style ? getSomeorUndefined(style.color) : undefined;
    const colorPalette = style ? getSomeorUndefined(style.colorPalette)?.type : undefined;

    const size = sizeType ? sizeMap[sizeType] : undefined;

    return {
        icon: [value.prefix as IconPrefix, value.name as IconName],
        size,
        color: color ?? (colorPalette ? `var(--chakra-colors-${colorPalette}-500)` : undefined),
        ...(label !== undefined
            ? { title: label }
            : { "aria-hidden": true }),
    };
}

/**
 * Extracts wrapper style props from an East UI Icon value for the
 * containing Box — returns `undefined` when no wrapper-level visual field
 * is set.
 */
export function toIconWrapperProps(value: IconValue): BoxProps | undefined {
    const style = getSomeorUndefined(value.style);
    if (!style) return undefined;

    const padding = getSomeorUndefined(style.padding);
    const margin = getSomeorUndefined(style.margin);

    const opacity = getSomeorUndefined(style.opacity);
    const background = getSomeorUndefined(style.background);
    const borderRadius = getSomeorUndefined(style.borderRadius);
    const overflow = getSomeorUndefined(style.overflow)?.type;
    const overflowX = getSomeorUndefined(style.overflowX)?.type;
    const overflowY = getSomeorUndefined(style.overflowY)?.type;
    const width = getSomeorUndefined(style.width);
    const height = getSomeorUndefined(style.height);
    const minWidth = getSomeorUndefined(style.minWidth);
    const minHeight = getSomeorUndefined(style.minHeight);
    const maxWidth = getSomeorUndefined(style.maxWidth);
    const maxHeight = getSomeorUndefined(style.maxHeight);

    if (
        opacity === undefined &&
        background === undefined &&
        borderRadius === undefined &&
        overflow === undefined &&
        overflowX === undefined &&
        overflowY === undefined &&
        width === undefined &&
        height === undefined &&
        minWidth === undefined &&
        minHeight === undefined &&
        maxWidth === undefined &&
        maxHeight === undefined &&
        !padding &&
        !margin
    ) {
        return undefined;
    }

    return {
        display: "inline-block",
        opacity,
        background,
        borderRadius,
        overflow,
        overflowX,
        overflowY,
        width,
        height,
        minWidth,
        minHeight,
        maxWidth,
        maxHeight,
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

export interface EastChakraIconProps {
    value: IconValue;
}

/**
 * Renders an East UI Icon value using Font Awesome.
 *
 * @remarks
 * The §0.2 a11y contract is enforced here: absent `label` ⇒
 * `aria-hidden="true"` (decorative); present `label` ⇒ `title={label}`
 * which Font Awesome renders into a `<title>` SVG element so screen
 * readers pick it up.
 */
export const EastChakraIcon = memo(function EastChakraIcon({ value }: EastChakraIconProps) {
    const props = useMemo(() => toFontAwesomeIcon(value), [value]);
    const wrapperProps = useMemo(() => toIconWrapperProps(value), [value]);

    if (wrapperProps) {
        return (
            <ChakraBox {...wrapperProps}>
                <FontAwesomeIcon {...props} />
            </ChakraBox>
        );
    }

    return <FontAwesomeIcon {...props} />;
}, (prev, next) => iconEqual(prev.value, next.value));
