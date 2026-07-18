/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useCallback, useMemo } from "react";
import { useToken } from "@chakra-ui/react";

/**
 * The shared density-driven control heights (px) — the column-header band and
 * one text row — read from the `sizes.density.*` theme tokens (the single
 * source). In the Planner a "row" is one bucket (AM/PM/EV). Consumed by Table
 * rows, Gantt/Planner header bands, and Planner slot rows so every text row
 * aligns across the three components.
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
 * Convert a Chakra-style colour token (e.g. `"blue.400"`) to a CSS
 * variable reference (`"var(--chakra-colors-blue-400)"`). Non-token
 * values (hex, rgb, named colours) are returned unchanged. Used by
 * renderers that bypass Chakra's prop system but still want theme
 * awareness.
 */
export function tokenToCssVar(token: string): string {
    if (!token.includes(".")) return token;
    return `var(--chakra-colors-${token.split(".").join("-")})`;
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
 * for an optional East `rowStatus` callback. Shared across Planner,
 * Gantt and Table renderers.
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
