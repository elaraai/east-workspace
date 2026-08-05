/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, Image, Reactive, SegmentGroup, Text } from "@elaraai/east-ui";

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

export const imageVariants = example({
    keywords: ["Image", "source", "dataUri", "blob", "BlobType", "bytes", "url", "hosted", "fit", "objectFit", "contain", "cover", "aspectRatio", "borderRadius", "background", "Reactive", "State", "SegmentGroup", "Configurator", "getTag", "configurator"],
    description: "Image configurator — source (dataUri / blob / url) and fit (contain / cover) axes in a fixed 112×64 box",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const sources = $.const(["dataUri", "blob", "url"], ArrayType(StringType));
            const fits = $.const(["contain", "cover"], ArrayType(StringType));

            const sourceBind = $.let(State.bind([StringType], "image_source", "dataUri"));
            const fitBind = $.let(State.bind([StringType], "image_fit", "contain"));

            const sKey = $.let(sourceBind.read());
            const fKey = $.let(fitBind.read());

            const onSource = $.const(East.function([StringType], NullType, ($, next) => { $(sourceBind.write(next)); }));
            const onFit = $.const(East.function([StringType], NullType, ($, next) => { $(fitBind.write(next)); }));

            const isCover = $.let(fKey.equal("cover"));

            // Source constructors and fit are build-time, so the axes pick
            // between prebuilt images; the url arm shows alt-text fallback
            // (the value doesn't carry the pixels).
            const preview = $.const(sKey.equal("blob").ifElse(
                _$ => isCover.ifElse(
                    _$ => <Image source={Image.blob(LOGO_BYTES, "svg")} width="112px" height="64px" fit="cover" borderRadius="8px" alt="embedded logo" />,
                    _$ => <Image source={Image.blob(LOGO_BYTES, "svg")} width="112px" height="64px" fit="contain" borderRadius="8px" background="bg.subtle" alt="embedded logo" />,
                ),
                _$ => sKey.equal("url").ifElse(
                    _$ => isCover.ifElse(
                        _$ => <Image source={Image.url("https://example.com/logo.svg")} width="112px" height="64px" fit="cover" borderRadius="8px" alt="hosted logo" />,
                        _$ => <Image source={Image.url("https://example.com/logo.svg")} width="112px" height="64px" fit="contain" borderRadius="8px" background="bg.subtle" alt="hosted logo" />,
                    ),
                    _$ => isCover.ifElse(
                        _$ => <Image source={Image.dataUri(WIDE_DATA_URI)} width="112px" height="64px" fit="cover" borderRadius="8px" alt="cover" />,
                        _$ => <Image source={Image.dataUri(WIDE_DATA_URI)} width="112px" height="64px" fit="contain" borderRadius="8px" background="bg.subtle" alt="contain" />,
                    ),
                ),
            ));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Source", sKey,
                            <SegmentGroup value={sKey} onChange={onSource} size="sm"
                                items={sources.map((_$, o) => SegmentGroup.Item(o, <Text>{o.upperCase()}</Text>))} />),
                        Configurator.Control("Fit", fKey,
                            <SegmentGroup value={fKey} onChange={onFit} size="sm"
                                items={fits.map((_$, o) => SegmentGroup.Item(o, <Text>{o.upperCase()}</Text>))} />),
                    ]}
                    preview={preview}
                    spec={[
                        Configurator.Spec("Self-contained", sKey.equal("url").ifElse(_$ => "no · alt fallback", _$ => "yes")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
