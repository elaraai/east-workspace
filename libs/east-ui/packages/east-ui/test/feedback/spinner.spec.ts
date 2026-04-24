/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Spinner } from "@elaraai/east-ui";
import * as ex from "./spinner.examples.js";

describeEast("Spinner", (test) => {
    Assert.examples(test, {
        spinnerSizes: ex.spinnerSizes,
        spinnerBranded: ex.spinnerBranded,
    });

    test("creates default spinner with no style", $ => {
        const s = $.let(Spinner.Root());
        $(Assert.equal(s.unwrap().unwrap("Spinner").style.hasTag("none"), true));
    });

    test("creates spinner with size", $ => {
        const s = $.let(Spinner.Root({ style: { size: "md" } }));
        const v = s.unwrap().unwrap("Spinner").style.unwrap("some");
        $(Assert.equal(v.size.unwrap("some").hasTag("md"), true));
    });

    test("creates spinner with colorPalette", $ => {
        const s = $.let(Spinner.Root({ style: { colorPalette: "blue" } }));
        const v = s.unwrap().unwrap("Spinner").style.unwrap("some");
        $(Assert.equal(v.colorPalette.unwrap("some").hasTag("blue"), true));
    });

    test("creates spinner with thickness + speed", $ => {
        const s = $.let(Spinner.Root({ style: { thickness: "3px", speed: "0.6s" } }));
        const v = s.unwrap().unwrap("Spinner").style.unwrap("some");
        $(Assert.equal(v.thickness.unwrap("some"), "3px"));
        $(Assert.equal(v.speed.unwrap("some"), "0.6s"));
    });

    test("creates spinner with colour slots", $ => {
        const s = $.let(Spinner.Root({ style: { color: "#3d5cff", trackColor: "#e5e7eb" } }));
        const v = s.unwrap().unwrap("Spinner").style.unwrap("some");
        $(Assert.equal(v.color.unwrap("some"), "#3d5cff"));
        $(Assert.equal(v.trackColor.unwrap("some"), "#e5e7eb"));
    });
}, { platformFns: TestImpl });
