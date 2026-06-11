/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { AvatarGroup as ChakraAvatarGroup, Avatar as ChakraAvatar, type AvatarRootProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { AvatarGroup } from "@elaraai/east-ui/internal";
import { toChakraAvatar } from "../avatar";
import { getSomeorUndefined } from "../../utils";
import { useDensity } from "../../contracts/density";

const avatarGroupEqual = equalFor(AvatarGroup.Types.AvatarGroup);

/** East AvatarGroup value type. */
export type AvatarGroupValue = ValueTypeOf<typeof AvatarGroup.Types.AvatarGroup>;

export interface EastChakraAvatarGroupProps {
    value: AvatarGroupValue;
}

/**
 * Renders an East UI AvatarGroup using Chakra v3's `<AvatarGroup>`
 * compound — shared size from `style.size` propagates to every member,
 * `max` controls the overflow threshold.
 */
export const EastChakraAvatarGroup = memo(function EastChakraAvatarGroup({ value }: EastChakraAvatarGroupProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const size = style ? getSomeorUndefined(style.size)?.type : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const maxOpt = useMemo(() => getSomeorUndefined(value.max), [value.max]);
    const inheritedDensity = useDensity();
    const localDensity = useMemo(() => getSomeorUndefined(value.density)?.type, [value.density]);
    const density = localDensity ?? inheritedDensity;

    const avatars = value.avatars;
    const visibleCount = maxOpt !== undefined ? Math.min(Number(maxOpt), avatars.length) : avatars.length;
    const overflowCount = avatars.length - visibleCount;

    return (
        // `spaceX` overrides Chakra's hardcoded -3 (-12px) overlap, which crushes
        // small (22px) avatars to slivers; -1.5 (-6px) reads as a clean stack.
        <ChakraAvatarGroup size={size ?? "xs"} spaceX="-1.5" borderColor={borderColor ?? "bg.surface"}>
            {avatars.slice(0, visibleCount).map((av: typeof avatars[number], i: number) => {
                const props = toChakraAvatar(av);
                const src = getSomeorUndefined(av.src);
                const name = getSomeorUndefined(av.name);
                // No DensityProvider wraps the group's members — the resolved
                // density goes onto each member's root explicitly, with a
                // per-member override winning over the group value.
                const memberDensity = getSomeorUndefined(av.density)?.type ?? density;
                return (
                    <ChakraAvatar.Root key={i} {...props} {...(memberDensity !== undefined ? ({ density: memberDensity } as AvatarRootProps) : {})}>
                        <ChakraAvatar.Fallback name={name} />
                        {src && <ChakraAvatar.Image src={src} />}
                    </ChakraAvatar.Root>
                );
            })}
            {overflowCount > 0 && (
                <ChakraAvatar.Root {...(density !== undefined ? ({ density } as AvatarRootProps) : {})}>
                    <ChakraAvatar.Fallback>+{overflowCount}</ChakraAvatar.Fallback>
                </ChakraAvatar.Root>
            )}
        </ChakraAvatarGroup>
    );
}, (prev, next) => avatarGroupEqual(prev.value, next.value));
