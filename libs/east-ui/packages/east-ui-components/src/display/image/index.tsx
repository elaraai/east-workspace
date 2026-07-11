/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useEffect, useMemo, useState } from "react";
import { chakra } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Image } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { parseCssSize } from "../../style/parse-size.js";

const imageEqual = equalFor(Image.Types.Image);

/** East Image value type. */
export type ImageValue = ValueTypeOf<typeof Image.Types.Image>;

/** Image format tag → MIME type, for building object URLs from a `blob` source. */
const MIME: Record<string, string> = {
    png: "image/png",
    svg: "image/svg+xml",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
};

/** `object-fit` variant tag → CSS value (`scaleDown` ⇒ `scale-down`). */
const OBJECT_FIT: Record<string, string> = {
    contain: "contain",
    cover: "cover",
    fill: "fill",
    none: "none",
    scaleDown: "scale-down",
};

export interface EastChakraImageProps {
    value: ImageValue;
}

/**
 * Renders an East UI Image value as an `<img>`. `url` / `dataUri` sources set the
 * `src` directly; a `blob` source is turned into a revocable object URL for the
 * element's lifetime.
 */
export const EastChakraImage = memo(function EastChakraImage({ value }: EastChakraImageProps) {
    const source = value.source;

    // url / dataUri set the src directly; blob needs an object URL (below).
    const directSrc = useMemo(
        () => (source.type === "url" || source.type === "dataUri" ? source.value : undefined),
        [source],
    );

    // A `blob` source ⇒ build an object URL and revoke it when the source changes
    // or the component unmounts (no leaked blobs).
    const [blobSrc, setBlobSrc] = useState<string | undefined>(undefined);
    useEffect(() => {
        if (source.type !== "blob") { setBlobSrc(undefined); return; }
        // `bytes` is a plain Uint8Array; the `as BlobPart` narrows the lib.dom
        // generic `Uint8Array<ArrayBufferLike>` (whose `ArrayBufferLike` admits
        // `SharedArrayBuffer`) to the `BufferSource` the Blob constructor wants.
        const url = URL.createObjectURL(new Blob([source.value.bytes as BlobPart], { type: MIME[source.value.format.type] ?? "application/octet-stream" }));
        setBlobSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [source]);

    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const props = useMemo(() => {
        if (style === undefined) return {};
        const padding = getSomeorUndefined(style.padding);
        const margin = getSomeorUndefined(style.margin);
        const fit = getSomeorUndefined(style.fit)?.type;
        return {
            objectFit: fit ? OBJECT_FIT[fit] : undefined,
            aspectRatio: getSomeorUndefined(style.aspectRatio),
            width: parseCssSize(getSomeorUndefined(style.width)),
            height: parseCssSize(getSomeorUndefined(style.height)),
            minWidth: parseCssSize(getSomeorUndefined(style.minWidth)),
            minHeight: parseCssSize(getSomeorUndefined(style.minHeight)),
            maxWidth: parseCssSize(getSomeorUndefined(style.maxWidth)),
            maxHeight: parseCssSize(getSomeorUndefined(style.maxHeight)),
            opacity: getSomeorUndefined(style.opacity),
            borderRadius: getSomeorUndefined(style.borderRadius),
            background: getSomeorUndefined(style.background),
            pt: padding ? getSomeorUndefined(padding.top) : undefined,
            pr: padding ? getSomeorUndefined(padding.right) : undefined,
            pb: padding ? getSomeorUndefined(padding.bottom) : undefined,
            pl: padding ? getSomeorUndefined(padding.left) : undefined,
            mt: margin ? getSomeorUndefined(margin.top) : undefined,
            mr: margin ? getSomeorUndefined(margin.right) : undefined,
            mb: margin ? getSomeorUndefined(margin.bottom) : undefined,
            ml: margin ? getSomeorUndefined(margin.left) : undefined,
        };
    }, [style]);

    const alt = style ? getSomeorUndefined(style.alt) : undefined;
    const src = directSrc ?? blobSrc;

    return <chakra.img src={src} alt={alt ?? ""} {...props} />;
}, (prev, next) => imageEqual(prev.value, next.value));
