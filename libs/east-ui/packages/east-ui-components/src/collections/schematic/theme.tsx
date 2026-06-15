/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Theme bridge for the Canvas2D schematic. The canvas can't use Chakra's CSS
 * custom properties directly, so this resolves the semantic tokens the paint
 * layer needs into concrete RGB by reading `getComputedStyle` off hidden probe
 * elements Chakra has themed — re-resolving on a light/dark switch via a
 * `MutationObserver` on the document root.
 *
 * @packageDocumentation
 */

import { memo, useLayoutEffect, useRef } from "react";
import { Box } from "@chakra-ui/react";
import { type SchematicPalette, type RGB } from "./paint";

/** Palette key → Chakra colour token. */
const TOKENS: Record<keyof SchematicPalette, string> = {
    brand600: "brand.600",
    brand500: "brand.500",
    fg: "fg",
    fgMuted: "fg.muted",
    fgSubtle: "fg.subtle",
    borderStrong: "border.strong",
    borderSubtle: "border.subtle",
    bgSurface: "bg.surface",
    bgPanel: "bg.panel",
    statusOk: "status.ok",
    statusWarn: "status.warn",
    statusBad: "status.bad",
    white: "white",
};
const KEYS = Object.keys(TOKENS) as (keyof SchematicPalette)[];

/** Parse a computed `rgb(...)` / `rgba(...)` string into an `[r,g,b]` triple. */
function parseRGB(s: string): RGB {
    const m = s.match(/[\d.]+/g);
    if (m === null || m.length < 3) return [0, 0, 0];
    return [Math.round(+m[0]!), Math.round(+m[1]!), Math.round(+m[2]!)];
}

/**
 * Renders a visually-hidden set of themed probes and reports the resolved
 * {@link SchematicPalette} to `onResolve` on mount and on every theme change.
 */
export const SchematicPaletteProbe = memo(function SchematicPaletteProbe(
    { onResolve }: { onResolve: (palette: SchematicPalette) => void },
) {
    const ref = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
        const read = () => {
            const el = ref.current;
            if (el === null) return;
            const kids = el.children;
            const palette = {} as SchematicPalette;
            KEYS.forEach((k, i) => {
                const child = kids[i];
                if (child !== undefined) palette[k] = parseRGB(getComputedStyle(child).color);
            });
            onResolve(palette);
        };
        read();
        const obs = new MutationObserver(read);
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
        return () => obs.disconnect();
    }, [onResolve]);
    return (
        <Box ref={ref} aria-hidden="true" css={{ position: "absolute", width: "0", height: "0", overflow: "hidden", pointerEvents: "none" }}>
            {KEYS.map(k => <Box key={k} color={TOKENS[k]} />)}
        </Box>
    );
});
