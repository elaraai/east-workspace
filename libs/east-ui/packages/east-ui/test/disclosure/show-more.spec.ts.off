/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Disclosure, Text } from "@elaraai/east-ui";
import * as ex from "./show-more.examples.js";

describeEast("Disclosure", (test) => {
    Assert.examples(test, {
        disclosureRationale: ex.disclosureRationale,
        disclosureNarrative: ex.disclosureNarrative,
        disclosureDefault: ex.disclosureDefault,
        disclosureBranded: ex.disclosureBranded,
    });

    test("creates disclosure with string text (coerced to Text.Root)", $ => {
        const d = $.let(Disclosure.Root("Short blurb"));
        const v = d.unwrap().unwrap("Disclosure");
        $(Assert.equal(v.text.unwrap().unwrap("Text").value, "Short blurb"));
        $(Assert.equal(v.lines.hasTag("none"), true));
        $(Assert.equal(v.moreLabel.hasTag("none"), true));
        $(Assert.equal(v.lessLabel.hasTag("none"), true));
        $(Assert.equal(v.style.hasTag("none"), true));
    });

    test("creates disclosure with rich UIComp text", $ => {
        const d = $.let(Disclosure.Root(Text.Root("Rich", { fontWeight: "bold" })));
        $(Assert.equal(d.unwrap().unwrap("Disclosure").text.unwrap().unwrap("Text").value, "Rich"));
    });

    test("creates disclosure with lines", $ => {
        const d = $.let(Disclosure.Root("Body", { lines: 5n }));
        $(Assert.equal(d.unwrap().unwrap("Disclosure").lines.unwrap("some"), 5n));
    });

    test("creates disclosure with custom more/less labels", $ => {
        const d = $.let(Disclosure.Root("Body", { moreLabel: "Read more", lessLabel: "Hide" }));
        const v = d.unwrap().unwrap("Disclosure");
        $(Assert.equal(v.moreLabel.unwrap("some"), "Read more"));
        $(Assert.equal(v.lessLabel.unwrap("some"), "Hide"));
    });

    test("creates disclosure with full colour escape hatches", $ => {
        const d = $.let(Disclosure.Root("Body", {
            style: { color: "#374151", triggerColor: "#3d5cff" },
        }));
        const s = d.unwrap().unwrap("Disclosure").style.unwrap("some");
        $(Assert.equal(s.color.unwrap("some"), "#374151"));
        $(Assert.equal(s.triggerColor.unwrap("some"), "#3d5cff"));
    });
}, { platformFns: TestImpl });
