/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { HStack, Image, Text, VStack } from "@elaraai/east-ui";

// Tiny self-contained brandmark (a rounded teal tile with a bolt) — kept inline
// so the examples render with no external asset.
//
// The fills below are literal hex ON PURPOSE: an SVG inside a `data:` URI is a
// separate document, so Chakra tokens and CSS vars do not resolve there. The
// values are East palette colours (tokens/colors.css) — brand.500, paper,
// gray.800, --warn, brand.400 — not arbitrary ones. Do not tokenise these.
const LOGO_SVG = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='#488e97'/><path d='M36 8 L18 38 h12 l-4 18 20-30 H34 z' fill='#ffffff'/></svg>";
const LOGO_DATA_URI = `data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}`;
const LOGO_BYTES = new TextEncoder().encode(LOGO_SVG);

// A deliberately wide mark, to show letterbox (contain) vs crop (cover).
const WIDE_SVG = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 40'><rect width='120' height='40' fill='#253333'/><circle cx='22' cy='20' r='13' fill='#b8862d'/><rect x='44' y='14' width='66' height='12' rx='6' fill='#5ce5e5'/></svg>";
const WIDE_DATA_URI = `data:image/svg+xml,${encodeURIComponent(WIDE_SVG)}`;

export const imageLogo = example({
    keywords: ["Image", "logo", "dataUri", "svg", "fit", "contain", "alt", "header"],
    description: "A self-contained SVG logo from a data URI — sized by height, object-fit contain, with alt text (an app-shell header lockup)",
    fn: East.function([], UIComponentType, (_$) => (
        <HStack gap="3" align="center">
            <Image source={Image.dataUri(LOGO_DATA_URI)} height="36px" fit="contain" alt="Acme" />
            <Text textStyle="body-lg" fontWeight="bold">Acme Industries</Text>
        </HStack>
    )),
    inputs: [],
});

export const imageFit = example({
    keywords: ["Image", "fit", "objectFit", "contain", "cover", "aspectRatio", "borderRadius", "background"],
    description: "object-fit in a fixed 112×64 box — `contain` letterboxes (over a background), `cover` crops to fill",
    fn: East.function([], UIComponentType, (_$) => (
        <HStack gap="6" align="flex-start">
            <VStack gap="1" align="center">
                <Image source={Image.dataUri(WIDE_DATA_URI)} width="112px" height="64px" fit="contain" borderRadius="8px" background="bg.subtle" alt="contain" />
                <Text textStyle="body-sm" color="fg.muted">contain</Text>
            </VStack>
            <VStack gap="1" align="center">
                <Image source={Image.dataUri(WIDE_DATA_URI)} width="112px" height="64px" fit="cover" borderRadius="8px" alt="cover" />
                <Text textStyle="body-sm" color="fg.muted">cover</Text>
            </VStack>
        </HStack>
    )),
    inputs: [],
});

export const imageBlob = example({
    keywords: ["Image", "blob", "BlobType", "bytes", "format", "svg", "embed", "self-contained"],
    description: "An embedded image from raw bytes — Image.blob(bytes, \"svg\") builds a revocable object URL (no hosting, no base64)",
    fn: East.function([], UIComponentType, (_$) => (
        <Image source={Image.blob(LOGO_BYTES, "svg")} height="48px" fit="contain" alt="embedded logo" />
    )),
    inputs: [],
});

export const imageUrl = example({
    keywords: ["Image", "url", "hosted", "external", "src"],
    description: "A hosted image referenced by URL (not self-contained — the value doesn't carry the pixels)",
    fn: East.function([], UIComponentType, (_$) => (
        <Image source={Image.url("https://example.com/logo.svg")} height="36px" fit="contain" alt="hosted logo" />
    )),
    inputs: [],
});
