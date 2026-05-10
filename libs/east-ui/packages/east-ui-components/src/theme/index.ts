/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Canonical Elara Chakra v3 system.
 *
 * Consumers (east-ui-showcase, east-ui-patterns-showcase, future apps) wrap
 * their root in `<ChakraProvider value={system}>` and inherit:
 *  - tokens (raw colour scales + fonts + spacing + radii + shadows)
 *  - semantic tokens (`bg.canvas`/`bg.surface`/`fg`/`fg.muted`/`border.subtle`/`ink.success`/...)
 *  - text styles (`display.{xl,lg,md,sm,xs}`, `body.{lg,md,sm}`, `eyebrow`, `caption`, `mono.*`)
 *  - layer styles (`card`, `card.flat`, `card.elevated`, `surface.muted`, `pill`)
 *  - button + input recipe overrides (visual: solid|ink|outline|ghost · size: sm|md|lg)
 *  - global CSS (font @import, focus-visible ring, prefers-reduced-motion)
 *
 * @example
 * ```tsx
 * import { ChakraProvider } from "@chakra-ui/react";
 * import { system } from "@elaraai/east-ui-components";
 *
 * <ChakraProvider value={system}>
 *     <App />
 * </ChakraProvider>
 * ```
 *
 * @packageDocumentation
 */

import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

import { tokens } from "./tokens.js";
import { semanticTokens } from "./semantic-tokens.js";
import { textStyles } from "./text-styles.js";
import { layerStyles } from "./layer-styles.js";
import { globalCss } from "./global-css.js";
import { buttonRecipe } from "./recipes/button.js";
import { inputRecipe } from "./recipes/input.js";

const config = defineConfig({
    globalCss,
    theme: {
        tokens,
        semanticTokens,
        textStyles,
        layerStyles,
        recipes: {
            button: buttonRecipe,
            input:  inputRecipe,
        },
    },
});

/**
 * The canonical Elara Chakra v3 system. Wrap your root in
 * `<ChakraProvider value={system}>` to consume.
 */
export const system = createSystem(defaultConfig, config);

/* Re-export the building blocks so apps can compose / extend them. */
export { tokens } from "./tokens.js";
export { semanticTokens } from "./semantic-tokens.js";
export { textStyles } from "./text-styles.js";
export { layerStyles } from "./layer-styles.js";
export { globalCss } from "./global-css.js";
export { buttonRecipe } from "./recipes/button.js";
export { inputRecipe } from "./recipes/input.js";
