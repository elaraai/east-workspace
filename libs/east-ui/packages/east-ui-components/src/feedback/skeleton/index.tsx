/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import {
    Skeleton as ChakraSkeleton,
    SkeletonText as ChakraSkeletonText,
    SkeletonCircle as ChakraSkeletonCircle,
    VStack as ChakraVStack,
} from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Skeleton } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

const skeletonEqual = equalFor(Skeleton.Types.Skeleton);

export type SkeletonValue = ValueTypeOf<typeof Skeleton.Types.Skeleton>;

export interface EastChakraSkeletonProps {
    value: SkeletonValue;
}

/**
 * Renders an East UI Skeleton. Dispatches on `shape` to one of Chakra's
 * `<Skeleton>` / `<SkeletonText>` / `<SkeletonCircle>` primitives. `count > 1`
 * wraps the result in a `<VStack>`.
 */
export const EastChakraSkeleton = memo(function EastChakraSkeleton({ value }: EastChakraSkeletonProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const width = style ? getSomeorUndefined(style.width) : undefined;
    const height = style ? getSomeorUndefined(style.height) : undefined;
    const fontSize = style ? getSomeorUndefined(style.fontSize) : undefined;
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const shimmer = style ? getSomeorUndefined(style.shimmerColor) : undefined;
    const count = getSomeorUndefined(value.count);
    const repeats = count !== undefined ? Number(count) : 1;

    const css: Record<string, string> = {};
    if (background !== undefined) css["--chakra-colors-bg-emphasized"] = background;
    if (shimmer !== undefined) css["--chakra-colors-bg"] = shimmer;

    const shapeTag = value.shape.type;
    const renderOne = (key: number) => {
        if (shapeTag === "text") {
            const lines = getSomeorUndefined(value.lines);
            return (
                <ChakraSkeletonText
                    key={key}
                    noOfLines={lines !== undefined ? Number(lines) : 3}
                    {...(fontSize !== undefined ? { fontSize } : {})}
                    {...(width !== undefined ? { width } : {})}
                    css={css}
                />
            );
        }
        if (shapeTag === "circle") {
            return (
                <ChakraSkeletonCircle
                    key={key}
                    size={width ?? height ?? "10"}
                    css={css}
                />
            );
        }
        // rect
        return (
            <ChakraSkeleton
                key={key}
                {...(width !== undefined ? { width } : {})}
                {...(height !== undefined ? { height } : { height: "20px" })}
                css={css}
            />
        );
    };

    if (repeats <= 1) return renderOne(0);
    return (
        <ChakraVStack align="stretch" gap="2">
            {Array.from({ length: repeats }, (_, i) => renderOne(i))}
        </ChakraVStack>
    );
}, (prev, next) => skeletonEqual(prev.value, next.value));
