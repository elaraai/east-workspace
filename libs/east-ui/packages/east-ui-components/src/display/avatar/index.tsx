/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Avatar as ChakraAvatar, type AvatarRootProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Avatar } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { parseCssSize } from "../../style/parse-size.js";
import { useDensity } from "../../contracts/density";

const avatarEqual = equalFor(Avatar.Types.Avatar);

/** East Avatar value type. */
export type AvatarValue = ValueTypeOf<typeof Avatar.Types.Avatar>;

/**
 * Converts an East UI Avatar value into Chakra `AvatarRootProps`.
 *
 * @remarks
 * Per the main/style type-shape convention, the main struct carries only
 * `src` + `name` (content). Every visual field lives in `value.style`.
 */
export function toChakraAvatar(value: AvatarValue): AvatarRootProps {
    const style = getSomeorUndefined(value.style);
    if (style === undefined) return {};

    const padding = getSomeorUndefined(style.padding);
    const margin = getSomeorUndefined(style.margin);

    return {
        size: getSomeorUndefined(style.size)?.type,
        variant: getSomeorUndefined(style.variant)?.type as AvatarRootProps["variant"] | undefined,
        colorPalette: getSomeorUndefined(style.colorPalette)?.type,
        opacity: getSomeorUndefined(style.opacity),
        borderRadius: getSomeorUndefined(style.borderRadius),
        overflow: getSomeorUndefined(style.overflow)?.type,
        overflowX: getSomeorUndefined(style.overflowX)?.type,
        overflowY: getSomeorUndefined(style.overflowY)?.type,
        width: parseCssSize(getSomeorUndefined(style.width)),
        height: parseCssSize(getSomeorUndefined(style.height)),
        minWidth: parseCssSize(getSomeorUndefined(style.minWidth)),
        minHeight: parseCssSize(getSomeorUndefined(style.minHeight)),
        maxWidth: parseCssSize(getSomeorUndefined(style.maxWidth)),
        maxHeight: parseCssSize(getSomeorUndefined(style.maxHeight)),
        color: getSomeorUndefined(style.color),
        background: getSomeorUndefined(style.background),
        borderColor: getSomeorUndefined(style.borderColor),
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

export interface EastChakraAvatarProps {
    value: AvatarValue;
}

/** Renders an East UI Avatar value using Chakra v3 `Avatar`. */
export const EastChakraAvatar = memo(function EastChakraAvatar({ value }: EastChakraAvatarProps) {
    const props = useMemo(() => toChakraAvatar(value), [value]);
    const src = useMemo(() => getSomeorUndefined(value.src), [value.src]);
    const name = useMemo(() => getSomeorUndefined(value.name), [value.name]);
    const inheritedDensity = useDensity();
    const localDensity = useMemo(() => getSomeorUndefined(value.density)?.type, [value.density]);
    const density = localDensity ?? inheritedDensity;

    return (
        <ChakraAvatar.Root {...props} {...(density !== undefined ? ({ density } as AvatarRootProps) : {})}>
            <ChakraAvatar.Fallback name={name} />
            {src && <ChakraAvatar.Image src={src} />}
        </ChakraAvatar.Root>
    );
}, (prev, next) => avatarEqual(prev.value, next.value));
