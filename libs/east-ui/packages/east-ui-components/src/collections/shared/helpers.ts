/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useCallback, useMemo } from "react";
import { useToken, type SystemContext } from "@chakra-ui/react";

/**
 * The shared density-driven control heights (px) — the column-header band and
 * one text row — read from the `sizes.density.*` theme tokens (the single
 * source). Consumed by Table rows and header bands so every text row aligns.
 */
export function useDensityHeights(size: "sm" | "md" | "lg"): { header: number; row: number } {
    const [header, row] = useToken("sizes", [`density.header.${size}`, `density.row.${size}`]);
    return {
        header: parseInt(header ?? "", 10) || 36,
        row: parseInt(row ?? "", 10) || 36,
    };
}

/**
 * Map a `MatrixSegmentAlign` / shared `Align` variant tag to the
 * matching CSS flex alignment value.
 */
export function alignToCss(tag: string | undefined): "flex-start" | "center" | "flex-end" {
    if (tag === "start") return "flex-start";
    if (tag === "end") return "flex-end";
    return "center";
}

/**
 * Resolve a colour string against the Chakra system: the theme token it names
 * (`"teal.solid"`, `"colors.teal.solid"`, `"{colors.teal.solid}"`) becomes
 * that token's CSS variable, and anything else — `"#1a2b3c"`, `"var(--x)"`,
 * `"rgb(…)"`, `"red"` — is raw CSS and comes back as it is.
 *
 * @remarks
 * The one resolver renderers use instead of guessing token-vs-CSS from the
 * string's shape (#817): a dot does not make a token (`"1.5"` is not one), and
 * the system, not the spelling, knows which paths it holds.
 *
 * @param system - The Chakra system (`useChakraContext()`)
 * @param color - A theme colour token path, or a CSS colour
 * @returns A CSS colour value
 */
export function resolveColor(system: SystemContext, color: string): string {
    const path = color.replace(/^\{|\}$/g, "");
    // `token.var` — the token's CSS VARIABLE, so a semantic token keeps
    // following the colour mode; `token()` would hand back one mode's value.
    const ref = system.token.var(path.startsWith("colors.") ? path : `colors.${path}`, undefined) as unknown;
    return typeof ref === "string" ? ref : color;
}

type StatusToken = { type?: string };

/**
 * Map a `StatusToken` variant tag to a Chakra background CSS variable.
 * Returns `undefined` when the tag is unrecognised.
 *
 * Uses the semantic status washes (spec banner tints), not raw palette
 * `*-50` stops — the raw pastels are light-fixed and rendered rows as
 * near-white slabs under dark-mode ink (#362).
 */
export function statusTokenToBg(tag: string | undefined): string | undefined {
    if (tag === "success") return "var(--chakra-colors-status-pos-subtle)";
    if (tag === "warning") return "var(--chakra-colors-status-warn-subtle)";
    if (tag === "danger") return "var(--chakra-colors-status-neg-subtle)";
    if (tag === "info") return "var(--chakra-colors-status-info-subtle)";
    if (tag === "neutral") return "var(--chakra-colors-bg-subtle)";
    return undefined;
}

/**
 * React hook returning a memoised `(rowIndex) => background?` lookup
 * for an optional East `rowStatus` callback (the Table renderer).
 */
export function useRowStatusBg(
    rowStatus: ((idx: bigint) => unknown) | undefined,
): (idx: number) => string | undefined {
    const rowStatusFn = useMemo(() => rowStatus, [rowStatus]);
    return useCallback((idx: number): string | undefined => {
        if (!rowStatusFn) return undefined;
        try {
            const token = rowStatusFn(BigInt(idx)) as StatusToken;
            return statusTokenToBg(token?.type);
        } catch {
            return undefined;
        }
    }, [rowStatusFn]);
}
