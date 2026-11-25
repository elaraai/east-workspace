/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The page's colour reader, for the specs that hold a colour to the design
 * system's or to a ratio: any CSS colour — a token, a mix, a literal —
 * resolved by the page, drawn over a ground on a one-pixel canvas and read
 * back as sRGB, so a mix in oklch compares as the colour it renders; and the
 * WCAG contrast of one colour drawn over another. No image is kept or compared.
 */

import type { Page } from "playwright/test";

/** What {@link installColourReader} puts on the page, as `window.__colour`. */
export interface ColourReader {
    /** A CSS colour as the page computes it. */
    resolve: (css: string) => string;
    /** A CSS colour as it paints, over a ground where it is given one: its sRGB channels and alpha, 0–255. */
    rgb: (css: string, under?: string) => [number, number, number, number];
    /** The WCAG contrast of a colour drawn over a ground — a line on its paper, text on its wash. */
    contrast: (text: string, ground: string) => number;
}

/**
 * Installs the page's colour reader as `window.__colour` ({@link ColourReader}).
 *
 * @param page - The page
 */
export async function installColourReader(page: Page): Promise<void> {
    await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.setAttribute("data-colour-probe", "");
        document.body.append(probe);
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const resolve = (css: string): string => {
            probe.style.color = "";
            probe.style.color = css;
            return getComputedStyle(probe).color;
        };
        const rgb = (css: string, under?: string): [number, number, number, number] => {
            ctx.clearRect(0, 0, 1, 1);
            if (under !== undefined) {
                ctx.fillStyle = resolve(under);
                ctx.fillRect(0, 0, 1, 1);
            }
            ctx.fillStyle = resolve(css);
            ctx.fillRect(0, 0, 1, 1);
            const d = ctx.getImageData(0, 0, 1, 1).data;
            return [d[0]!, d[1]!, d[2]!, d[3]!];
        };
        const lum = ([r, g, b]: number[]): number => {
            const lin = (x: number) => { const s = x / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
            return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
        };
        /** The WCAG contrast of a text colour on a ground (the text drawn over it). */
        const contrast = (text: string, ground: string): number => {
            const g = rgb(ground, "#808080");
            const t = rgb(text, ground);
            const [a, b] = [lum(t), lum(g)];
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        (window as unknown as { __colour: unknown }).__colour = { resolve, rgb, contrast };
    });
}
