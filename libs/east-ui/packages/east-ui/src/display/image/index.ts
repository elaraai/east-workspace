/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    BlobType,
    StringType,
    East,
    variant,
    some,
    none,
} from "@elaraai/east";

import { PaddingType, MarginType } from "../../layout/style.js";
import { UIComponentType } from "../../component.js";
import {
    ImageType,
    ImageStyleType,
    ImageSourceType,
    ImageBlobType,
    ImageFormatType,
    ImageFitType,
    type ImageStyle,
    type ImageFormatLiteral,
} from "./types.js";

export {
    ImageType,
    ImageStyleType,
    ImageSourceType,
    ImageBlobType,
    ImageFormatType,
    ImageFitType,
    type ImageStyle,
    type ImageFormatLiteral,
    type ImageFitLiteral,
} from "./types.js";

// ============================================================================
// Source builders
// ============================================================================

/**
 * A hosted / external image URL source. Not self-contained — the image lives at
 * the URL, so the East value doesn't carry the pixels.
 *
 * @param url - The image URL
 * @returns An `ImageSourceType` expression
 */
function imageUrl(url: SubtypeExprOrValue<StringType>): ExprType<ImageSourceType> {
    return East.value(variant("url", url), ImageSourceType);
}

/**
 * A self-contained data-URI source (`"data:image/png;base64,…"` or
 * `"data:image/svg+xml,…"`). The MIME type lives in the string, so it travels
 * and serializes with the value.
 *
 * @param uri - The data URI
 * @returns An `ImageSourceType` expression
 */
function imageDataUri(uri: SubtypeExprOrValue<StringType>): ExprType<ImageSourceType> {
    return East.value(variant("dataUri", uri), ImageSourceType);
}

/**
 * A raw-bytes source — the renderer builds a revocable object URL from the bytes
 * and `format` (which supplies the MIME).
 *
 * @param bytes - The image's binary content
 * @param format - The binary format (`"png"` / `"svg"` / `"jpeg"` / `"webp"` / `"gif"`)
 * @returns An `ImageSourceType` expression
 */
function imageBlob(
    bytes: SubtypeExprOrValue<BlobType>,
    format: ImageFormatLiteral | SubtypeExprOrValue<ImageFormatType>,
): ExprType<ImageSourceType> {
    const formatValue = typeof format === "string"
        ? East.value(variant(format, null), ImageFormatType)
        : format;
    return East.value(variant("blob", East.value({ bytes, format: formatValue }, ImageBlobType)), ImageSourceType);
}

// ============================================================================
// Style builder
// ============================================================================

/** Internal — wraps a flat `ImageStyle` into an `ImageStyleType` expression. */
function buildImageStyle(style: ImageStyle | undefined): ExprType<ImageStyleType> | undefined {
    if (style === undefined) return undefined;
    const hasAny = style.alt !== undefined
        || style.fit !== undefined
        || style.aspectRatio !== undefined
        || style.width !== undefined
        || style.height !== undefined
        || style.minWidth !== undefined
        || style.minHeight !== undefined
        || style.maxWidth !== undefined
        || style.maxHeight !== undefined
        || style.opacity !== undefined
        || style.borderRadius !== undefined
        || style.background !== undefined
        || style.padding !== undefined
        || style.margin !== undefined;
    if (!hasAny) return undefined;

    const fitValue = style.fit !== undefined
        ? (typeof style.fit === "string"
            ? East.value(variant(style.fit, null), ImageFitType)
            : style.fit)
        : undefined;
    const paddingValue = style.padding !== undefined
        ? (typeof style.padding === "string"
            ? East.value({ top: some(style.padding), right: some(style.padding), bottom: some(style.padding), left: some(style.padding) }, PaddingType)
            : style.padding)
        : undefined;
    const marginValue = style.margin !== undefined
        ? (typeof style.margin === "string"
            ? East.value({ top: some(style.margin), right: some(style.margin), bottom: some(style.margin), left: some(style.margin) }, MarginType)
            : style.margin)
        : undefined;

    return East.value({
        alt: style.alt !== undefined ? some(style.alt) : none,
        fit: fitValue ? some(fitValue) : none,
        aspectRatio: style.aspectRatio !== undefined ? some(style.aspectRatio) : none,
        width: style.width !== undefined ? some(style.width) : none,
        height: style.height !== undefined ? some(style.height) : none,
        minWidth: style.minWidth !== undefined ? some(style.minWidth) : none,
        minHeight: style.minHeight !== undefined ? some(style.minHeight) : none,
        maxWidth: style.maxWidth !== undefined ? some(style.maxWidth) : none,
        maxHeight: style.maxHeight !== undefined ? some(style.maxHeight) : none,
        opacity: style.opacity !== undefined ? some(style.opacity) : none,
        borderRadius: style.borderRadius !== undefined ? some(style.borderRadius) : none,
        background: style.background !== undefined ? some(style.background) : none,
        padding: paddingValue ? some(paddingValue) : none,
        margin: marginValue ? some(marginValue) : none,
    }, ImageStyleType);
}

// ============================================================================
// Image Factory
// ============================================================================

/**
 * Creates an Image component value — a raster/vector image or logo.
 *
 * @param source - Where the pixels come from — `Image.url(...)`, `Image.dataUri(...)`, or `Image.blob(bytes, format)`
 * @param style - Optional visual style (`alt`, `fit`, `aspectRatio`, `width`/`height`, `borderRadius`, …)
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Image, UIComponentType } from "@elaraai/east-ui";
 *
 * const logo = East.function([], UIComponentType, _$ =>
 *     Image.Root(Image.url("https://example.com/logo.svg"), { height: "32px", fit: "contain", alt: "Acme" }));
 * ```
 */
function createImage(source: SubtypeExprOrValue<ImageSourceType>, style?: ImageStyle): ExprType<UIComponentType> {
    const styleValue = buildImageStyle(style);
    return East.value(variant("Image", {
        source,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

interface ImageNamespace {
    Root: typeof createImage;
    url: typeof imageUrl;
    dataUri: typeof imageDataUri;
    blob: typeof imageBlob;
    Types: {
        Image: typeof ImageType;
        Source: typeof ImageSourceType;
        Blob: typeof ImageBlobType;
        Format: typeof ImageFormatType;
        Fit: typeof ImageFitType;
        Style: typeof ImageStyleType;
    };
}

/**
 * `Image` — a raster/vector image or logo primitive with fine-grained size,
 * aspect-ratio and object-fit control.
 *
 * @remarks
 * Use `Image.Root(source, style?)` with a source builder: `Image.url(...)` for a
 * hosted URL, `Image.dataUri(...)` for a self-contained data URI, or
 * `Image.blob(bytes, format)` for raw bytes.
 */
export const Image: ImageNamespace = {
    /**
     * Creates an Image component value. See {@link createImage}.
     */
    Root: createImage,
    /**
     * Builds a hosted / external URL source. See {@link imageUrl}.
     */
    url: imageUrl,
    /**
     * Builds a self-contained data-URI source. See {@link imageDataUri}.
     */
    dataUri: imageDataUri,
    /**
     * Builds a raw-bytes source with an explicit format. See {@link imageBlob}.
     */
    blob: imageBlob,
    Types: {
        /**
         * East StructType for an Image value.
         *
         * @property source - Where the pixels come from (`url` / `dataUri` / `blob`)
         * @property style - Optional visual style sub-struct
         */
        Image: ImageType,
        /**
         * East VariantType for an image source (`url` / `dataUri` / `blob`).
         */
        Source: ImageSourceType,
        /**
         * East StructType for an embedded-blob source (`bytes` + `format`).
         */
        Blob: ImageBlobType,
        /**
         * East VariantType for an embedded image's binary format.
         */
        Format: ImageFormatType,
        /**
         * East VariantType for object-fit (`contain` / `cover` / `fill` / `none` / `scaleDown`).
         */
        Fit: ImageFitType,
        /**
         * East StructType holding every visual field for an Image.
         */
        Style: ImageStyleType,
    },
};
