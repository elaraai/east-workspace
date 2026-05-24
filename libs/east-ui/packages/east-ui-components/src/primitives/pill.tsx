/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pill — soft inline chip primitive.
 *
 * @remarks
 * The canonical chrome for inline status / metadata chips per
 * pattern_spec/spec.css `.chip`: 4 px corner radius (NOT pill-full), 1 px
 * strong border, white background, body 12 px medium-weight text, compact
 * mono numerics for inline values. Used by stakes tags, freshness chips,
 * peer indicators, novelty flags, and any other "small inline thing with
 * a label and a value" surface.
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

import { HStack, type StackProps, useSlotRecipe } from "@chakra-ui/react";
import type { ReactNode } from "react";

export type PillSize = "sm" | "md" | "lg";

export interface PillProps extends Omit<StackProps, "children"> {
    /** Chip content. Typically labelled `<Text>` runs separated by `·`. */
    children: ReactNode;
    /** Size variant — defaults to `md`. */
    size?: PillSize;
}

const sizeProps: Record<PillSize, Pick<StackProps, "px" | "py" | "fontSize" | "gap">> = {
    sm: { px: "2",   py: "0.5", fontSize: "11px", gap: "1"   },
    md: { px: "2.5", py: "1",   fontSize: "xs",   gap: "1.5" },   // 12 px
    lg: { px: "3",   py: "1.5", fontSize: "sm",   gap: "2"   },   // 14 px
};

/**
 * Soft inline chip primitive per pattern_spec/spec.css `.chip` —
 * 4 px radius, 1 px strong border, white bg, body font, mono numerics.
 * Consumes the `tag` slot recipe's `outline` variant (`size="md"`) by
 * default — chrome flows from `theme/slot-recipes/tag.ts`. See
 * module-level docs for the canonical composition pattern.
 */
export function Pill({ children, size = "md", ...rest }: PillProps) {
    const recipe = useSlotRecipe({ key: "tag" });
    const styles = recipe({ variant: "outline", size: size === "lg" ? "lg" : size === "sm" ? "sm" : "md" });

    return (
        <HStack
            css={styles.root}
            fontVariantNumeric="tabular-nums"
            {...sizeProps[size]}
            {...rest}
        >
            {children}
        </HStack>
    );
}
