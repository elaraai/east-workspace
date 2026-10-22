/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The theme bridge for the Canvas2D schematic (#1387, "The canvas's theme and
 * styles"). The canvas can't read Chakra's CSS custom properties, so it reads
 * what the recipe resolves: hidden elements in the `schematic` recipe's
 * `probe` slot, each named by a data attribute, never styled inline —
 *
 * - **its own marks' colours**, a role each (`data-role`), each a design-system
 *   token: `brandMark`, `brand.solid`, `brandTint`, `fg` … `fg.faint`,
 *   `bg.surface`, `bg.canvas`, `border.subtle`, `border.strong` and
 *   `status.*` — never a raw palette step, never a Chakra default;
 * - **its fonts** (`data-font`): its labels' and its eyebrows', the design
 *   system's mono face (`fonts.mono`);
 * - **each entity's colour** (`data-tint`), through the chain an item's card
 *   dot resolves its own by (`tints.ts`), so the canvas and the cards draw one
 *   colour in each mode, and a value naming no theme colour token draws its
 *   tone (D14, SC26).
 *
 * A colour is read as the page computes it and converted to RGB on a 1×1
 * canvas, which takes every colour the page can compute (`oklch()`, a
 * `color-mix()`'s result); with no canvas — jsdom — an `rgb()` is parsed. The
 * canvas reads again when the colours its drawing names change, or the
 * document's theme does.
 *
 * @packageDocumentation
 */

import { memo, useLayoutEffect, useState, type Ref } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import type { RGB, SchematicPalette } from "./paint";
import { tintAttributes, type SchematicTint } from "./tints";

/** The palette's colour roles, each named after the token the probe resolves it from. */
export const PALETTE_ROLES = [
    "brandMark", "brandSolid", "brandTint",
    "fg", "fgStrong", "fgMuted", "fgSubtle", "fgFaint",
    "bgSurface", "bgCanvas", "borderSubtle", "borderStrong",
    "statusPos", "statusNeg", "statusWarn", "statusInfo",
] as const satisfies readonly (keyof SchematicPalette)[];

/** A palette role. */
type PaletteRole = (typeof PALETTE_ROLES)[number];

/** Props of {@link SchematicProbe}. */
export interface SchematicProbeProps {
    /** Every colour the drawing names, by its key (`tintsOf`). */
    readonly tints: ReadonlyMap<string, SchematicTint>;
    /** The colours' keys, in order (`tintsOf`'s signature): the probe draws again only when it moves. */
    readonly signature: string;
    /** The probe's element: what {@link readPalette} reads. */
    readonly probeRef: Ref<HTMLDivElement>;
}

/**
 * The probe: hidden, in the recipe's `probe` slot, one element per palette
 * role, per font and per colour the drawing names (see the module docs). It
 * draws again only when the colours named do — a drawing that moves and names
 * the same colours probes nothing new.
 *
 * @param props - The colours, their signature, and where the probe's element goes
 * @returns The probe
 */
export const SchematicProbe = memo(function SchematicProbe({ tints, probeRef }: SchematicProbeProps) {
    const styles = useSlotRecipe({ key: "schematic" })() as Record<string, SystemStyleObject>;
    return (
        <Box ref={probeRef} css={styles.probe} aria-hidden="true" data-schematic-probe="">
            {PALETTE_ROLES.map((role) => <span key={role} data-role={role} />)}
            <span data-font="label" />
            <span data-font="eyebrow" />
            {[...tints].map(([key, tint]) => <span key={key} data-tint={key} {...tintAttributes(tint)} />)}
        </Box>
    );
}, (prev, next) => prev.signature === next.signature && prev.probeRef === next.probeRef);

/** Parse a computed `rgb(...)` / `rgba(...)` string into an `[r,g,b]` triple. */
function parseRGB(s: string): RGB {
    const m = s.match(/[\d.]+/g);
    if (m === null || m.length < 3) return [0, 0, 0];
    return [Math.round(+m[0]!), Math.round(+m[1]!), Math.round(+m[2]!)];
}

/**
 * A computed colour as RGB: painted on a 1×1 canvas and read back, which
 * takes every colour the page can compute; parsed, with no canvas.
 *
 * @param color - The computed colour
 * @param scratch - The 1×1 canvas's context; `null` with none
 * @returns Its RGB
 */
function rgbOf(color: string, scratch: CanvasRenderingContext2D | null): RGB {
    if (scratch === null) return parseRGB(color);
    scratch.clearRect(0, 0, 1, 1);
    scratch.fillStyle = "#000000";
    scratch.fillStyle = color;
    scratch.fillRect(0, 0, 1, 1);
    const [r, g, b] = scratch.getImageData(0, 0, 1, 1).data;
    return [r ?? 0, g ?? 0, b ?? 0];
}

/** An element's font, as `ctx.font` takes it: its weight, its size and its family — none for no element, which the canvas ignores. */
function fontOf(el: Element | null): string {
    if (el === null) return "";
    const s = getComputedStyle(el);
    return `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
}

/** What the probe reads: the palette, and each colour the drawing names, by its key. */
export interface ProbeReading {
    /** The canvas's own colours and fonts. */
    readonly palette: SchematicPalette;
    /** Each colour the drawing names, by its key. */
    readonly tints: ReadonlyMap<string, RGB>;
}

/**
 * Reads the probe (see the module docs).
 *
 * @param probe - The probe's element, its children committed
 * @returns The palette and the drawing's colours
 */
export function readPalette(probe: HTMLElement): ProbeReading {
    const scratch = probe.ownerDocument.createElement("canvas");
    scratch.width = 1;
    scratch.height = 1;
    const context = scratch.getContext("2d", { willReadFrequently: true });
    const colourOf = (el: Element | null): RGB => (el === null ? [0, 0, 0] : rgbOf(getComputedStyle(el).color, context));
    const roles = Object.fromEntries(PALETTE_ROLES.map((role) => [role, colourOf(probe.querySelector(`[data-role="${role}"]`))])) as Record<PaletteRole, RGB>;
    const tints = new Map<string, RGB>();
    for (const el of probe.querySelectorAll("[data-tint]")) tints.set(el.getAttribute("data-tint") ?? "", colourOf(el));
    return {
        palette: {
            ...roles,
            labelFont: fontOf(probe.querySelector('[data-font="label"]')),
            eyebrowFont: fontOf(probe.querySelector('[data-font="eyebrow"]')),
        },
        tints,
    };
}

/**
 * The document's theme's version: it moves when the document root's class,
 * `data-theme` or style does — a light/dark switch — so the canvas reads its
 * palette again.
 *
 * @returns The version
 */
export function useThemeVersion(): number {
    const [version, setVersion] = useState(0);
    useLayoutEffect(() => {
        const observer = new MutationObserver(() => setVersion((v) => v + 1));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
        return () => observer.disconnect();
    }, []);
    return version;
}
