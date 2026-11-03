/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The themes a spec runs in. Layout, geometry and behaviour do not depend on
 * the theme: a spec of those runs in light alone. A spec that holds a colour
 * of its own runs in both (`["light", "dark"]`). A theme's tokens are held to
 * the design system by `east-ui-components/src/theme/design-system.test.ts`,
 * and lint refuses a raw colour in a recipe, so a dark-only fault of a
 * renderer's layout has nowhere to come from.
 */
export const LAYOUT_THEMES = ["light"] as const;
