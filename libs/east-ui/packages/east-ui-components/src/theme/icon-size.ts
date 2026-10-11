/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Font Awesome sizes its SVG in ems outside Chakra's recipe layer. Set the font and its width variable together. */
export function fontAwesomeSize(size: string) {
    return { width: size, height: size, fontSize: size, "--fa-width": "1em", lineHeight: 1,
        "& svg": { width: "100%", height: "100%", "--fa-width": "1em" } } as const;
}
