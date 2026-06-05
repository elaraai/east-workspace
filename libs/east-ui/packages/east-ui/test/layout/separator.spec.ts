/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Separator } from "@elaraai/east-ui/internal";
import * as ex from "./separator.examples.js";

describeEast("Separator", (test) => {
    Assert.examples(test, {
        separatorHorizontal: ex.separatorHorizontal,
        separatorVertical: ex.separatorVertical,
        separatorSubtle: ex.separatorSubtle,
        separatorStrong: ex.separatorStrong,
        separatorDashed: ex.separatorDashed,
        separatorBrand: ex.separatorBrand,
        separatorLabeled: ex.separatorLabeled,
        separatorFormDivider: ex.separatorFormDivider,
        separatorWithEyebrow: ex.separatorWithEyebrow,
        separatorAlignedStart: ex.separatorAlignedStart,
    });

    // =========================================================================
    // Basic Creation
    // =========================================================================

    test("creates separator with no options", $ => {
        const separator = $.let(Separator.Root());
        const v = separator.unwrap().unwrap("Separator");
        $(Assert.equal(v.style.hasTag("none"), true));
        $(Assert.equal(v.label.hasTag("none"), true));
    });

    // =========================================================================
    // Orientation
    // =========================================================================

    test("creates horizontal separator", $ => {
        const separator = $.let(Separator.Root({ orientation: "horizontal" }));
        const sv = separator.unwrap().unwrap("Separator").style.unwrap("some");
        $(Assert.equal(sv.orientation.unwrap("some").hasTag("horizontal"), true));
    });

    test("creates vertical separator", $ => {
        const separator = $.let(Separator.Root({ orientation: "vertical" }));
        const sv = separator.unwrap().unwrap("Separator").style.unwrap("some");
        $(Assert.equal(sv.orientation.unwrap("some").hasTag("vertical"), true));
    });

    // =========================================================================
    // Variant (hairline: subtle | strong | dashed | brand)
    // =========================================================================

    test("creates separator with subtle variant", $ => {
        const separator = $.let(Separator.Root({ variant: "subtle" }));
        const sv = separator.unwrap().unwrap("Separator").style.unwrap("some");
        $(Assert.equal(sv.variant.unwrap("some").hasTag("subtle"), true));
    });

    test("creates separator with strong variant", $ => {
        const separator = $.let(Separator.Root({ variant: "strong" }));
        const sv = separator.unwrap().unwrap("Separator").style.unwrap("some");
        $(Assert.equal(sv.variant.unwrap("some").hasTag("strong"), true));
    });

    test("creates separator with dashed variant", $ => {
        const separator = $.let(Separator.Root({ variant: "dashed" }));
        const sv = separator.unwrap().unwrap("Separator").style.unwrap("some");
        $(Assert.equal(sv.variant.unwrap("some").hasTag("dashed"), true));
    });

    test("creates separator with brand variant", $ => {
        const separator = $.let(Separator.Root({ variant: "brand" }));
        const sv = separator.unwrap().unwrap("Separator").style.unwrap("some");
        $(Assert.equal(sv.variant.unwrap("some").hasTag("brand"), true));
    });

    // =========================================================================
    // Label
    // =========================================================================

    test("creates separator with label", $ => {
        const separator = $.let(Separator.Root({ label: "OR" }));
        $(Assert.equal(separator.unwrap().unwrap("Separator").label.hasTag("some"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "OR"));
    });

    test("creates separator with long label", $ => {
        const separator = $.let(Separator.Root({ label: "Continue with" }));
        $(Assert.equal(separator.unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "Continue with"));
    });

    // =========================================================================
    // Multiple Properties
    // =========================================================================

    test("creates separator with multiple properties", $ => {
        const separator = $.let(Separator.Root({
            orientation: "horizontal",
            variant: "dashed",
            label: "Section Break",
        }));
        const v = separator.unwrap().unwrap("Separator");
        const sv = v.style.unwrap("some");
        $(Assert.equal(sv.orientation.unwrap("some").hasTag("horizontal"), true));
        $(Assert.equal(sv.variant.unwrap("some").hasTag("dashed"), true));
        $(Assert.equal(v.label.unwrap("some").unwrap().unwrap("Text").value, "Section Break"));
    });

    // =========================================================================
    // Typical Use Cases
    // =========================================================================

    test("creates simple horizontal divider", $ => {
        const divider = $.let(Separator.Root({ orientation: "horizontal" }));
        const sv = divider.unwrap().unwrap("Separator").style.unwrap("some");
        $(Assert.equal(sv.orientation.unwrap("some").hasTag("horizontal"), true));
    });

    test("creates labeled OR separator for forms", $ => {
        const orSeparator = $.let(Separator.Root({ label: "OR" }));
        const v = orSeparator.unwrap().unwrap("Separator");
        $(Assert.equal(v.label.unwrap("some").unwrap().unwrap("Text").value, "OR"));
    });

    test("creates vertical separator for side-by-side content", $ => {
        const verticalDivider = $.let(Separator.Root({ orientation: "vertical", variant: "subtle" }));
        const sv = verticalDivider.unwrap().unwrap("Separator").style.unwrap("some");
        $(Assert.equal(sv.orientation.unwrap("some").hasTag("vertical"), true));
        $(Assert.equal(sv.variant.unwrap("some").hasTag("subtle"), true));
    });

    test("creates styled section divider", $ => {
        const sectionDivider = $.let(Separator.Root({
            variant: "brand",
        }));
        const sv = sectionDivider.unwrap().unwrap("Separator").style.unwrap("some");
        $(Assert.equal(sv.variant.unwrap("some").hasTag("brand"), true));
    });

    // =========================================================================
    // Label alignment (start | center | end)
    // =========================================================================

    test("creates separator with align: start", $ => {
        const sep = $.let(Separator.Root({ label: "Phase 1", align: "start" }));
        const sv = sep.unwrap().unwrap("Separator").style.unwrap("some");
        $(Assert.equal(sv.align.unwrap("some").hasTag("start"), true));
    });

    test("creates separator with align: center", $ => {
        const sep = $.let(Separator.Root({ label: "Cross-phase decisions", align: "center" }));
        const sv = sep.unwrap().unwrap("Separator").style.unwrap("some");
        $(Assert.equal(sv.align.unwrap("some").hasTag("center"), true));
    });

    test("creates separator with align: end", $ => {
        const sep = $.let(Separator.Root({ label: "Notes", align: "end" }));
        const sv = sep.unwrap().unwrap("Separator").style.unwrap("some");
        $(Assert.equal(sv.align.unwrap("some").hasTag("end"), true));
    });

    test("style absent when only label is set", $ => {
        const sep = $.let(Separator.Root({ label: "OR" }));
        $(Assert.equal(sep.unwrap().unwrap("Separator").style.hasTag("none"), true));
    });
}, {   platformFns: TestImpl,});
