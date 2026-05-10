/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pill — soft inline chip primitive.
 *
 * @remarks
 * The canonical chrome for inline status / metadata chips: pill-shaped
 * (`borderRadius: full`), 1 px subtle border, neutral muted background,
 * compact mono numerics. Used by stakes tags, freshness chips, peer
 * indicators, novelty flags, and any other "small inline thing with a
 * label and a value" surface.
 *
 * Layout-only — no semantic colour. Authors compose coloured `<Text>`
 * children inside to express tone:
 *
 * ```tsx
 * <Pill>
 *     <Text textStyle="caption" color="fg.subtle">stakes</Text>
 *     <Text color="ink.warning" fontWeight="semibold">$8.4k impact</Text>
 *     <Text color="border.strong">·</Text>
 *     <Text color="fg.muted">3 workers</Text>
 * </Pill>
 * ```
 *
 * Three sizes (sm / md / lg) tweak padding + font; default is `md`.
 *
 * @packageDocumentation
 */

import { HStack, type HStackProps } from "@chakra-ui/react";
import type { ReactNode } from "react";

export type PillSize = "sm" | "md" | "lg";

export interface PillProps extends Omit<HStackProps, "children"> {
    /** Chip content. Typically labelled `<Text>` runs separated by `·`. */
    children: ReactNode;
    /** Size variant — defaults to `md`. */
    size?: PillSize;
}

const sizeProps: Record<PillSize, Pick<HStackProps, "px" | "py" | "fontSize" | "gap">> = {
    sm: { px: "2",   py: "0.5", fontSize: "2xs", gap: "1"   },
    md: { px: "2.5", py: "0.5", fontSize: "xs",  gap: "1.5" },
    lg: { px: "3",   py: "1",   fontSize: "sm",  gap: "2"   },
};

/**
 * Soft inline pill chip — neutral chrome, brand-agnostic. See module-level
 * docs for the canonical composition pattern.
 */
export function Pill({ children, size = "md", ...rest }: PillProps) {
    return (
        <HStack
            display="inline-flex"
            alignItems="center"
            borderRadius="full"
            borderWidth="1px"
            borderColor="border.subtle"
            bg="bg.muted"
            fontFamily="mono"
            fontVariantNumeric="tabular-nums"
            flexShrink={0}
            {...sizeProps[size]}
            {...rest}
        >
            {children}
        </HStack>
    );
}
