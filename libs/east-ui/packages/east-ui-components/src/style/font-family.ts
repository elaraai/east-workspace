/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import type { SystemContext } from "@chakra-ui/react";

/**
 * The theme's face for one of East's font families, as a CSS font family:
 * `mono` the theme's mono stack; `sans` an explicit `fonts.sans` token, else
 * the theme body stack (this theme names its sans `body`); `serif` likewise,
 * else the CSS generic — so a host theme owns the concrete stacks (#315). The
 * charts and Box, Text and Heading all take a family through it.
 *
 * @param system - the Chakra system whose font tokens hold the faces
 * @param tag - the family's case name: `sans`, `serif` or `mono`
 * @returns the CSS font family
 */
export function themeFontFamily(system: SystemContext, tag: string): string {
    if (tag === "mono") return system.token("fonts.mono", "monospace");
    if (tag === "serif") return system.token("fonts.serif", "serif");
    return system.token("fonts.sans", system.token("fonts.body", "sans-serif"));
}
