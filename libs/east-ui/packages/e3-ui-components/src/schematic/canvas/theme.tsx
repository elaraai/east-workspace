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
 *   `bg.surface`, `bg.canvas`, `border.subtle`, `border.strong`, `status.*`
 *   and the heat ramp a density's steps draw in, `heat.1` … `heat.5` — never a
 *   raw palette step, never a Chakra default;
 * - **its fonts** (`data-font`): its labels' and its eyebrows', the design
 *   system's mono face (`fonts.mono`);
 * - **each entity's colour** (`data-tint`), through the chain an item's card
 *   dot resolves its own by (`tints.ts`), so the canvas and the cards draw one
 *   colour in each mode, and a value naming no theme colour token draws its
 *   tone (D14, SC26);
 * - **the links' look** (#1403): the shared links part's own elements
 *   (`linkRibbons`), as the Plan's links layer draws them — the casing's paper,
 *   the muted ink and the strong ink, the ring, the knockout and a selected
 *   one's outline, the caption's ink and font, a drag's new line and a moved
 *   link's `was` line with their widths — so a change to the part changes the
 *   Plan's, the Allocation's and the Schematic's links together.
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
import type { RGB, SchematicLinkLook, SchematicPalette } from "./paint";
import { tintAttributes, type SchematicTint } from "./tints";

/** The palette's colour roles, each named after the token the probe resolves it from. */
export const PALETTE_ROLES = [
    "brandMark", "brandSolid", "brandTint",
    "fg", "fgStrong", "fgMuted", "fgSubtle", "fgFaint",
    "bgSurface", "bgCanvas", "borderSubtle", "borderStrong",
    "statusPos", "statusNeg", "statusWarn", "statusInfo",
    "heat1", "heat2", "heat3", "heat4", "heat5",
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
            <LinkParts />
        </Box>
    );
}, (prev, next) => prev.signature === next.signature && prev.probeRef === next.probeRef);

/**
 * The links' parts the probe holds (#1403): the shared links part's elements, as the Plan's links layer draws them —
 * a link at rest and one lit, a lit link's ring, a caption's knockout at rest and selected, a moved link's `was` line
 * and a drag's new line — which the recipe styles as it styles the Plan's.
 *
 * @returns The parts
 */
function LinkParts() {
    return (
        <svg data-schematic-links="">
            <path data-plan-casing="band" />
            <path data-plan-casing="head" />
            <g data-plan-link=""><path data-plan-ribbon-band="" /><path data-plan-ribbon-head="" /></g>
            <g data-plan-link="" data-lit=""><path data-plan-ribbon-band="" /><path data-plan-ribbon-head="" /><rect data-plan-linkend="to" /></g>
            <g data-plan-ribbon-label=""><rect data-plan-ribbon-knockout="" /><text data-plan-ribbon-caption="">0</text></g>
            <g data-plan-ribbon-label="" data-selected=""><rect data-plan-ribbon-knockout="" /></g>
            <g data-was=""><path data-plan-ribbon-band="" /><path data-plan-ribbon-head="" /></g>
            <g data-plan-link-preview=""><path data-plan-ribbon-band="" /><path data-plan-ribbon-head="" /></g>
        </svg>
    );
}

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

/** An RGB colour as a context takes it. */
const cssOf = ([r, g, b]: RGB): string => `rgb(${r},${g},${b})`;

/**
 * The links' look, as the page computes the shared links part's elements the probe holds (#1403).
 *
 * @param probe - The probe's element
 * @param colourOf - A colour the page computes for an element, as RGB
 * @returns The look
 */
function readLinkLook(probe: HTMLElement, colourOf: (el: Element | null, property: "stroke" | "fill") => RGB): SchematicLinkLook {
    const part = (selector: string): Element | null => probe.querySelector(`[data-schematic-links] ${selector}`);
    const paint = (selector: string, property: "stroke" | "fill"): string => cssOf(colourOf(part(selector), property));
    // A width the page computes for none — a document that lays nothing out — is the part's own.
    const widthOf = (selector: string, standing: number): number => {
        const el = part(selector);
        const width = el === null ? Number.NaN : Number.parseFloat(getComputedStyle(el).strokeWidth);
        return Number.isFinite(width) && width > 0 ? width : standing;
    };
    return {
        casing: paint("[data-plan-casing='band']", "stroke"),
        ink: paint("[data-plan-link]:not([data-lit]) [data-plan-ribbon-band]", "stroke"),
        strong: paint("[data-plan-link][data-lit] [data-plan-ribbon-band]", "stroke"),
        ring: paint("[data-plan-linkend]", "stroke"),
        ringWidth: widthOf("[data-plan-linkend]", 1),
        knockout: paint("[data-plan-ribbon-label]:not([data-selected]) [data-plan-ribbon-knockout]", "fill"),
        outline: paint("[data-plan-ribbon-label][data-selected] [data-plan-ribbon-knockout]", "stroke"),
        caption: paint("[data-plan-ribbon-caption]", "fill"),
        captionFont: fontOf(part("[data-plan-ribbon-caption]")),
        preview: paint("[data-plan-link-preview] [data-plan-ribbon-band]", "stroke"),
        previewWidth: widthOf("[data-plan-link-preview] [data-plan-ribbon-band]", 3),
        was: paint("[data-was] [data-plan-ribbon-band]", "stroke"),
        wasWidth: widthOf("[data-was] [data-plan-ribbon-band]", 1.5),
    };
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
    const colourOf = (el: Element | null, property: "color" | "stroke" | "fill" = "color"): RGB =>
        (el === null ? [0, 0, 0] : rgbOf(getComputedStyle(el)[property], context));
    const roles = Object.fromEntries(PALETTE_ROLES.map((role) => [role, colourOf(probe.querySelector(`[data-role="${role}"]`))])) as Record<PaletteRole, RGB>;
    const tints = new Map<string, RGB>();
    for (const el of probe.querySelectorAll("[data-tint]")) tints.set(el.getAttribute("data-tint") ?? "", colourOf(el));
    return {
        palette: {
            ...roles,
            labelFont: fontOf(probe.querySelector('[data-font="label"]')),
            eyebrowFont: fontOf(probe.querySelector('[data-font="eyebrow"]')),
            links: readLinkLook(probe, colourOf),
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
