/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    BlobType,
    FloatType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { PaddingType, MarginType } from "../../layout/style.js";

// ============================================================================
// Image Format
// ============================================================================

/**
 * East VariantType for an embedded image's binary format — drives the MIME type
 * when a `blob` source is turned into an object URL.
 *
 * @property png - `image/png`
 * @property svg - `image/svg+xml`
 * @property jpeg - `image/jpeg`
 * @property webp - `image/webp`
 * @property gif - `image/gif`
 */
export const ImageFormatType = VariantType({
    png: NullType,
    svg: NullType,
    jpeg: NullType,
    webp: NullType,
    gif: NullType,
});

/** Type alias for the image-format variant. */
export type ImageFormatType = typeof ImageFormatType;

/** String shorthands accepted for an image format. */
export type ImageFormatLiteral = "png" | "svg" | "jpeg" | "webp" | "gif";

// ============================================================================
// Image Fit (object-fit)
// ============================================================================

/**
 * East VariantType for how the image sizes within its box (CSS `object-fit`).
 *
 * @property contain - Scale to fit inside, preserving aspect ratio (letterbox) — the logo default
 * @property cover - Fill the box, preserving aspect ratio (crop)
 * @property fill - Stretch to fill, ignoring aspect ratio
 * @property none - Intrinsic size, no scaling
 * @property scaleDown - The smaller of `none` and `contain` (renders as CSS `scale-down`)
 */
export const ImageFitType = VariantType({
    contain: NullType,
    cover: NullType,
    fill: NullType,
    none: NullType,
    scaleDown: NullType,
});

/** Type alias for the object-fit variant. */
export type ImageFitType = typeof ImageFitType;

/** String shorthands accepted for {@link ImageStyle.fit}. */
export type ImageFitLiteral = "contain" | "cover" | "fill" | "none" | "scaleDown";

// ============================================================================
// Image Source
// ============================================================================

/**
 * East StructType for an embedded-binary image source — raw bytes plus the
 * `format` needed to build the object URL / MIME.
 *
 * @property bytes - The image's raw binary content
 * @property format - The binary format (drives the MIME type)
 */
export const ImageBlobType = StructType({
    bytes: BlobType,
    format: ImageFormatType,
});

/** Type alias for the embedded-blob source struct. */
export type ImageBlobType = typeof ImageBlobType;

/**
 * East VariantType for where an image's pixels come from — pick embed-vs-reference.
 *
 * @property url - A hosted / external URL (not self-contained; won't travel with the value)
 * @property dataUri - A self-contained data URI (`"data:image/png;base64,…"`); the MIME lives in the string
 * @property blob - Raw bytes + explicit `format`; the renderer builds a revocable object URL
 */
export const ImageSourceType = VariantType({
    url: StringType,
    dataUri: StringType,
    blob: ImageBlobType,
});

/** Type alias for the image-source variant. */
export type ImageSourceType = typeof ImageSourceType;

// ============================================================================
// Image Style
// ============================================================================

/**
 * East StructType for the Image style sub-struct — every visual field lives
 * here; the `source` stays on the main struct.
 *
 * @property alt - Alternative text (accessibility); empty ⇒ decorative
 * @property fit - How the image sizes within its box (CSS `object-fit`)
 * @property aspectRatio - CSS `aspect-ratio` (e.g. `"16 / 9"`, `"1"`)
 * @property width - CSS width
 * @property height - CSS height
 * @property minWidth - CSS min-width
 * @property minHeight - CSS min-height
 * @property maxWidth - CSS max-width
 * @property maxHeight - CSS max-height
 * @property opacity - CSS opacity (0–1)
 * @property borderRadius - Corner radius
 * @property background - Box background (behind a letterboxed image)
 * @property padding - Padding struct
 * @property margin - Margin struct
 */
export const ImageStyleType = StructType({
    alt: OptionType(StringType),
    fit: OptionType(ImageFitType),
    aspectRatio: OptionType(StringType),
    width: OptionType(StringType),
    height: OptionType(StringType),
    minWidth: OptionType(StringType),
    minHeight: OptionType(StringType),
    maxWidth: OptionType(StringType),
    maxHeight: OptionType(StringType),
    opacity: OptionType(FloatType),
    borderRadius: OptionType(StringType),
    background: OptionType(StringType),
    padding: OptionType(PaddingType),
    margin: OptionType(MarginType),
});

/** Type alias for the Image style struct. */
export type ImageStyleType = typeof ImageStyleType;

// ============================================================================
// Image Type
// ============================================================================

/**
 * East StructType for an Image component value — a raster/vector image or logo.
 *
 * @remarks
 * The main struct carries the required `source` (content); every visual field
 * nests under `style: OptionType(ImageStyleType)`.
 *
 * @property source - Where the pixels come from (`url` / `dataUri` / `blob`)
 * @property style - Optional visual style sub-struct
 */
export const ImageType = StructType({
    source: ImageSourceType,
    style: OptionType(ImageStyleType),
});

/** Type alias for the Image struct. */
export type ImageType = typeof ImageType;

// ============================================================================
// Image TS options bag
// ============================================================================

/**
 * TypeScript options bag for `Image.Root` — the flat style fields (the
 * `source` is a positional argument). The factory nests these into the IR shape.
 */
export interface ImageStyle {
    /** Alternative text (accessibility); empty ⇒ decorative. */
    alt?: SubtypeExprOrValue<StringType>;
    /** How the image sizes within its box (CSS `object-fit`). */
    fit?: SubtypeExprOrValue<ImageFitType> | ImageFitLiteral;
    /** CSS `aspect-ratio` (e.g. `"16 / 9"`, `"1"`). */
    aspectRatio?: SubtypeExprOrValue<StringType>;
    /** CSS width. */
    width?: SubtypeExprOrValue<StringType>;
    /** CSS height. */
    height?: SubtypeExprOrValue<StringType>;
    /** CSS min-width. */
    minWidth?: SubtypeExprOrValue<StringType>;
    /** CSS min-height. */
    minHeight?: SubtypeExprOrValue<StringType>;
    /** CSS max-width. */
    maxWidth?: SubtypeExprOrValue<StringType>;
    /** CSS max-height. */
    maxHeight?: SubtypeExprOrValue<StringType>;
    /** CSS opacity (0–1). */
    opacity?: SubtypeExprOrValue<FloatType>;
    /** Corner radius. */
    borderRadius?: SubtypeExprOrValue<StringType>;
    /** Box background (behind a letterboxed image). */
    background?: SubtypeExprOrValue<StringType>;
    /** Padding (struct or shorthand for all 4 sides). */
    padding?: SubtypeExprOrValue<PaddingType> | string;
    /** Margin (struct or shorthand for all 4 sides). */
    margin?: SubtypeExprOrValue<MarginType> | string;
}
