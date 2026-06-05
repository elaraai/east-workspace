/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { OptionList, Text } from "@elaraai/east-ui";
import * as ex from "./option-list.examples.js";

describeEast("OptionList", (test) => {
    Assert.examples(test, {
        optionListAlternatives: ex.optionListAlternatives,
        optionListWhatIf: ex.optionListWhatIf,
        optionListReactive: ex.optionListReactive,
    });

    // =========================================================================
    // OptionList.Option — id + label
    // =========================================================================

    test("creates option with string label (coerced to Text.Root)", $ => {
        const opt = $.let(OptionList.Option("alt-1", "Keep current plan"));
        $(Assert.equal(opt.id, "alt-1"));
        $(Assert.equal(opt.label.unwrap().unwrap("Text").value, "Keep current plan"));
        $(Assert.equal(opt.description.hasTag("none"), true));
        $(Assert.equal(opt.trailing.hasTag("none"), true));
        $(Assert.equal(opt.disabled.hasTag("none"), true));
    });

    test("creates option with rich UIComp label", $ => {
        const opt = $.let(OptionList.Option("alt-2", Text.Root("Rich", { fontWeight: "bold" })));
        $(Assert.equal(opt.id, "alt-2"));
        $(Assert.equal(opt.label.unwrap().unwrap("Text").value, "Rich"));
    });

    test("creates option with description + trailing string slots", $ => {
        const opt = $.let(OptionList.Option("alt-3", "Shift batch", {
            description: "+0.8h idle, −£312 overtime",
            trailing: "−£312",
        }));
        $(Assert.equal(
            opt.description.unwrap("some").unwrap().unwrap("Text").value,
            "+0.8h idle, −£312 overtime",
        ));
        $(Assert.equal(
            opt.trailing.unwrap("some").unwrap().unwrap("Text").value,
            "−£312",
        ));
    });

    test("creates option with rich UIComp description + trailing", $ => {
        const opt = $.let(OptionList.Option("alt-4", "L", {
            description: Text.Root("RD"),
            trailing: Text.Root("RT"),
        }));
        $(Assert.equal(opt.description.unwrap("some").unwrap().unwrap("Text").value, "RD"));
        $(Assert.equal(opt.trailing.unwrap("some").unwrap().unwrap("Text").value, "RT"));
    });

    test("creates option with disabled flag", $ => {
        const opt = $.let(OptionList.Option("alt-5", "L", { disabled: true }));
        $(Assert.equal(opt.disabled.unwrap("some"), true));
    });

    // =========================================================================
    // OptionList.Root
    // =========================================================================

    test("creates list with options and selectedId", $ => {
        const list = $.let(OptionList.Root([
            OptionList.Option("a", "Alpha"),
            OptionList.Option("b", "Bravo"),
            OptionList.Option("c", "Charlie"),
        ], { selectedId: "b" }));
        const v = list.unwrap().unwrap("OptionList");
        $(Assert.equal(v.options.size(), 3n));
        $(Assert.equal(v.selectedId.unwrap("some"), "b"));
    });

    test("creates list without options — all optional fields none", $ => {
        const list = $.let(OptionList.Root([OptionList.Option("a", "Alpha")]));
        const v = list.unwrap().unwrap("OptionList");
        $(Assert.equal(v.selectedId.hasTag("none"), true));
        $(Assert.equal(v.onSelect.hasTag("none"), true));
        $(Assert.equal(v.style.hasTag("none"), true));
    });

    // =========================================================================
    // Style
    // =========================================================================

    test("creates list with colour slots", $ => {
        const list = $.let(OptionList.Root([OptionList.Option("a", "A")], {
            itemColor: "#111827",
            itemHoverBackground: "#f8fafc",
            selectedBackground: "#eef2ff",
            borderColor: "#e5e7eb",
            impactColor: "#dc2626",
        }));
        const s = list.unwrap().unwrap("OptionList").style.unwrap("some");
        $(Assert.equal(s.itemColor.unwrap("some"), "#111827"));
        $(Assert.equal(s.itemHoverBackground.unwrap("some"), "#f8fafc"));
        $(Assert.equal(s.selectedBackground.unwrap("some"), "#eef2ff"));
        $(Assert.equal(s.borderColor.unwrap("some"), "#e5e7eb"));
        $(Assert.equal(s.impactColor.unwrap("some"), "#dc2626"));
    });
}, { platformFns: TestImpl });
