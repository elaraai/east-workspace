/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Image>` tag — a raster/vector image or logo. */

import { Image as ImageFactory } from "../../display/image/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * A raster/vector image or logo, with fine-grained control over size, aspect
 * ratio and object-fit. The required `source` prop is built with a source helper
 * — `Image.url(url)` (hosted), `Image.dataUri(uri)` (self-contained base64), or
 * `Image.blob(bytes, format)` (raw bytes) — and the rest are flat style props
 * ({@link ImageStyle}: `alt`, `fit`, `aspectRatio`, `width`/`height`,
 * `borderRadius`, …).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Image, UIComponentType } from "@elaraai/east-ui";
 *
 * const logo = East.function([], UIComponentType, _$ => (
 *     <Image source={Image.url("https://example.com/logo.svg")} height="32px" fit="contain" alt="Acme" />
 * ));
 * ```
 *
 * @remarks
 * Carries `Image.Types` — the East data type, the source/format/fit variants, and
 * the style struct. Desugars to `Image.Root(source, options)`.
 */
export const Image: JsxTag<ValueProps<typeof ImageFactory.Root, "source">> & {
    Types: typeof ImageFactory.Types;
    url: typeof ImageFactory.url;
    dataUri: typeof ImageFactory.dataUri;
    blob: typeof ImageFactory.blob;
} = Object.assign(leaf(ImageFactory.Root, "source"), {
    Types: ImageFactory.Types,
    url: ImageFactory.url,
    dataUri: ImageFactory.dataUri,
    blob: ImageFactory.blob,
});
