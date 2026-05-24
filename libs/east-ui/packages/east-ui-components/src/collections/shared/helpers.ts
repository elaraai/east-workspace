/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useCallback, useMemo } from "react";

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
 */
export function statusTokenToBg(tag: string | undefined): string | undefined {
    if (tag === "success") return "var(--chakra-colors-green-50)";
    if (tag === "warning") return "var(--chakra-colors-yellow-50)";
    if (tag === "danger") return "var(--chakra-colors-red-50)";
    if (tag === "info") return "var(--chakra-colors-blue-50)";
    if (tag === "neutral") return "var(--chakra-colors-gray-50)";
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
