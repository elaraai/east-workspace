/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Image } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./image.examples.js";

describeEast("Image", (test) => {
    Assert.examples(test, {
        imageLogo: ex.imageLogo,
        imageVariants: ex.imageVariants,
    });

    test("imageVariants is the live configurator", $ => {
        const panel = $.const(ex.imageVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    test("url source round-trips", $ => {
        const r = $.let(Image.Root(Image.url("https://x/y.png")));
        const src = $.let(r.unwrap().unwrap("Image").source);
        $(Assert.equal(src.hasTag("url"), true));
        $(Assert.equal(src.unwrap("url"), "https://x/y.png"));
    });

    test("dataUri source round-trips", $ => {
        const r = $.let(Image.Root(Image.dataUri("data:image/svg+xml,<svg/>")));
        $(Assert.equal(r.unwrap().unwrap("Image").source.hasTag("dataUri"), true));
    });

    test("blob source carries bytes + format", $ => {
        const r = $.let(Image.Root(Image.blob(new Uint8Array([1, 2, 3]), "png")));
        const blob = $.let(r.unwrap().unwrap("Image").source.unwrap("blob"));
        $(Assert.equal(blob.bytes.size(), 3n));
        $(Assert.equal(blob.format.hasTag("png"), true));
    });

    test("style fit + alt + height round-trip", $ => {
        const r = $.let(Image.Root(Image.url("u"), { fit: "cover", alt: "hi", height: "40px" }));
        const style = $.let(r.unwrap().unwrap("Image").style.unwrap("some"));
        $(Assert.equal(style.fit.unwrap("some").hasTag("cover"), true));
        $(Assert.equal(style.alt.unwrap("some"), "hi"));
        $(Assert.equal(style.height.unwrap("some"), "40px"));
    });

    test("no style ⇒ style is none", $ => {
        const r = $.let(Image.Root(Image.url("u")));
        $(Assert.equal(r.unwrap().unwrap("Image").style.hasTag("none"), true));
    });
}, { platformFns: TestImpl });
