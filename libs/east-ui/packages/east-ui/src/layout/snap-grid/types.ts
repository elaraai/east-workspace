/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SnapGrid types — the 12-column snap grid of tiles (#989).
 *
 * The cell and root structs carry a `UIComponentType` content, so they live in
 * `index.ts` beside the factory (their inline twin in `component.ts` spells the
 * content with the recursion `node`). This file holds the plain vocabulary.
 */

import { NullType, VariantType } from "@elaraai/east";

/**
 * Where a cell shorter than its row sits in it.
 *
 * @property top - At the row's top
 * @property center - Centred in the row
 * @property stretch - As tall as the row
 */
export const SnapGridAlignType = VariantType({
    top: NullType,
    center: NullType,
    stretch: NullType,
});

/** Type representing a SnapGrid cell's alignment. */
export type SnapGridAlignType = typeof SnapGridAlignType;

/** Literal shorthand for {@link SnapGridAlignType}. */
export type SnapGridAlignLiteral = "top" | "center" | "stretch";

/**
 * How a SnapGrid draws its cells.
 *
 * @property tiles - Each cell's content, in its tile
 * @property wireframe - Each cell an outline at its tile's size, its content
 *   not drawn — the page library's thumbnails
 */
export const SnapGridVariantType = VariantType({
    tiles: NullType,
    wireframe: NullType,
});

/** Type representing a SnapGrid's variant. */
export type SnapGridVariantType = typeof SnapGridVariantType;

/** Literal shorthand for {@link SnapGridVariantType}. */
export type SnapGridVariantLiteral = "tiles" | "wireframe";
