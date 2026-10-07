/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Font Awesome icon where only CSS reaches — a pseudo-element's mark
 * (#1261). Every icon the UI draws is a Font Awesome solid icon, never a text
 * glyph: a glyph the page's font lacks falls back to whatever font has it, and
 * is drawn malformed. Here the icon's own path, in its own view box, masks the
 * element's background, so the mark takes the colour its style gives it.
 *
 * @packageDocumentation
 */

import type { SystemStyleObject } from "@chakra-ui/react";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

/**
 * An icon as a CSS `url()` of its SVG, for a mask.
 *
 * @param icon - A Font Awesome icon (`faBan`)
 * @returns `url("data:image/svg+xml,…")`, the icon's path in its view box
 */
export function iconMaskUrl(icon: IconDefinition): string {
    const [width, height, , , path] = icon.icon;
    const d = Array.isArray(path) ? path.join(" ") : path;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><path d="${d}"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * A pseudo-element's styles that draw an icon in a colour: an empty box of the
 * icon's size, filled with the colour, masked by the icon.
 *
 * @param icon - A Font Awesome solid icon
 * @param size - The icon's box, a CSS length
 * @param color - Its colour, a colour token
 * @returns The styles to spread into the pseudo-element's own
 */
export function iconMask(icon: IconDefinition, size: string, color: string): SystemStyleObject {
    const url = iconMaskUrl(icon);
    return {
        content: '""',
        width: size,
        height: size,
        background: color,
        maskImage: url,
        WebkitMaskImage: url,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
    };
}
