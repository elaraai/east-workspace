/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Accordion, Text } from "@elaraai/east-ui";
import * as ex from "./accordion.examples.js";

describeEast("Accordion", (test) => {
    Assert.examples(test, {
        accordionBasic: ex.accordionBasic,
        accordionMultiple: ex.accordionMultiple,
        accordionCollapsible: ex.accordionCollapsible,
        accordionFaq: ex.accordionFaq,
        accordionInteractive: ex.accordionInteractive,
        accordionGridTrigger: ex.accordionGridTrigger,
        accordionReactiveMulti: ex.accordionReactiveMulti,
    });

    // =========================================================================
    // Accordion.Item — title + optional meta
    // =========================================================================

    test("creates item with title", $ => {
        const item = $.let(Accordion.Item("item-1", "Section 1", [
            Text.Root("Content for section 1"),
        ]));
        $(Assert.equal(item.value, "item-1"));
        $(Assert.equal(item.title, "Section 1"));
        $(Assert.equal(item.meta.hasTag("none"), true));
        $(Assert.equal(item.disabled.hasTag("none"), true));
    });

    test("creates item with trailing meta", $ => {
        const item = $.let(Accordion.Item(
            "rich",
            "Shift rules",
            [Text.Root("Body")],
            { meta: "4 fields" },
        ));
        $(Assert.equal(item.title, "Shift rules"));
        $(Assert.equal(item.meta.unwrap("some"), "4 fields"));
    });

    test("creates item with multiple children", $ => {
        const item = $.let(Accordion.Item(
            "item-2",
            "Section 2",
            [
                Text.Root("First line"),
                Text.Root("Second line"),
            ]
        ));
        $(Assert.equal(item.value, "item-2"));
        $(Assert.equal(item.title, "Section 2"));
    });

    test("creates disabled item", $ => {
        const item = $.let(Accordion.Item("disabled-item", "Disabled Section", [
            Text.Root("Cannot expand"),
        ], { disabled: true }));
        $(Assert.equal(item.disabled.unwrap("some"), true));
    });

    test("creates enabled item explicitly", $ => {
        const item = $.let(Accordion.Item("enabled-item", "Enabled Section", [
            Text.Root("Can expand"),
        ], { disabled: false }));
        $(Assert.equal(item.disabled.unwrap("some"), false));
    });

    // =========================================================================
    // Accordion.Root — defaults (all options none)
    // =========================================================================

    test("creates accordion with items only — all main/style options none", $ => {
        const accordion = $.let(Accordion.Root([
            Accordion.Item("a", "Section A", [Text.Root("Content A")]),
            Accordion.Item("b", "Section B", [Text.Root("Content B")]),
        ]));
        const a = accordion.unwrap().unwrap("Accordion");
        $(Assert.equal(a.style.hasTag("none"), true));
        $(Assert.equal(a.multiple.hasTag("none"), true));
        $(Assert.equal(a.collapsible.hasTag("none"), true));
        $(Assert.equal(a.value.hasTag("none"), true));
        $(Assert.equal(a.defaultValue.hasTag("none"), true));
        $(Assert.equal(a.onValueChange.hasTag("none"), true));
    });

    test("creates empty accordion", $ => {
        const accordion = $.let(Accordion.Root([]));
        $(Assert.equal(accordion.unwrap().unwrap("Accordion").items.size(), 0n));
    });

    // =========================================================================
    // Config on main — multiple / collapsible
    // =========================================================================

    test("creates accordion with multiple enabled (main)", $ => {
        const accordion = $.let(Accordion.Root([
            Accordion.Item("a", "A", [Text.Root("Content A")]),
            Accordion.Item("b", "B", [Text.Root("Content B")]),
        ], { multiple: true }));
        $(Assert.equal(accordion.unwrap().unwrap("Accordion").multiple.unwrap("some"), true));
    });

    test("creates accordion with multiple disabled (main)", $ => {
        const accordion = $.let(Accordion.Root([
            Accordion.Item("a", "A", [Text.Root("Content A")]),
        ], { multiple: false }));
        $(Assert.equal(accordion.unwrap().unwrap("Accordion").multiple.unwrap("some"), false));
    });

    test("creates collapsible accordion (main)", $ => {
        const accordion = $.let(Accordion.Root([
            Accordion.Item("item", "Section", [Text.Root("Content")]),
        ], { collapsible: true }));
        $(Assert.equal(accordion.unwrap().unwrap("Accordion").collapsible.unwrap("some"), true));
    });

    test("creates non-collapsible accordion (main)", $ => {
        const accordion = $.let(Accordion.Root([
            Accordion.Item("item", "Section", [Text.Root("Content")]),
        ], { collapsible: false }));
        $(Assert.equal(accordion.unwrap().unwrap("Accordion").collapsible.unwrap("some"), false));
    });

    // =========================================================================
    // State on main — defaultValue
    // =========================================================================

    test("creates accordion with defaultValue", $ => {
        const accordion = $.let(Accordion.Root([
            Accordion.Item("a", "A", [Text.Root("A")]),
            Accordion.Item("b", "B", [Text.Root("B")]),
        ], { defaultValue: ["a"] }));
        $(Assert.equal(accordion.unwrap().unwrap("Accordion").defaultValue.unwrap("some").get(0n), "a"));
    });

    // =========================================================================
    // Variants — inside style
    // =========================================================================

    test("creates enclosed variant accordion (inside style)", $ => {
        const accordion = $.let(Accordion.Root([
            Accordion.Item("item", "Section", [Text.Root("Content")]),
        ], { style: { variant: "enclosed" } }));
        $(Assert.equal(
            accordion.unwrap().unwrap("Accordion").style.unwrap("some").variant.unwrap("some").hasTag("enclosed"),
            true,
        ));
    });

    test("creates plain variant accordion", $ => {
        const accordion = $.let(Accordion.Root([
            Accordion.Item("item", "Section", [Text.Root("Content")]),
        ], { style: { variant: "plain" } }));
        $(Assert.equal(
            accordion.unwrap().unwrap("Accordion").style.unwrap("some").variant.unwrap("some").hasTag("plain"),
            true,
        ));
    });

    test("creates subtle variant accordion", $ => {
        const accordion = $.let(Accordion.Root([
            Accordion.Item("item", "Section", [Text.Root("Content")]),
        ], { style: { variant: "subtle" } }));
        $(Assert.equal(
            accordion.unwrap().unwrap("Accordion").style.unwrap("some").variant.unwrap("some").hasTag("subtle"),
            true,
        ));
    });

    test("creates accordion with AccordionVariant helper", $ => {
        const accordion = $.let(Accordion.Root([
            Accordion.Item("item", "Section", [Text.Root("Content")]),
        ], { style: { variant: Accordion.Variant("enclosed") } }));
        $(Assert.equal(
            accordion.unwrap().unwrap("Accordion").style.unwrap("some").variant.unwrap("some").hasTag("enclosed"),
            true,
        ));
    });

    // =========================================================================
    // Colour escape hatches + size (inside style)
    // =========================================================================

    test("creates accordion with colour slots + size", $ => {
        const accordion = $.let(Accordion.Root([
            Accordion.Item("item", "Section", [Text.Root("Content")]),
        ], {
            style: {
                size: "lg",
                background: "#ffffff",
                borderColor: "#e5e7eb",
                triggerBackground: "#f9fafb",
                triggerHoverBackground: "#eef2ff",
                contentBackground: "#ffffff",
            },
        }));
        const s = accordion.unwrap().unwrap("Accordion").style.unwrap("some");
        $(Assert.equal(s.size.unwrap("some").hasTag("lg"), true));
        $(Assert.equal(s.background.unwrap("some"), "#ffffff"));
        $(Assert.equal(s.borderColor.unwrap("some"), "#e5e7eb"));
        $(Assert.equal(s.triggerBackground.unwrap("some"), "#f9fafb"));
        $(Assert.equal(s.triggerHoverBackground.unwrap("some"), "#eef2ff"));
        $(Assert.equal(s.contentBackground.unwrap("some"), "#ffffff"));
    });

    // =========================================================================
    // Combined — kitchen sink
    // =========================================================================

    test("creates accordion with all main + style options", $ => {
        const accordion = $.let(Accordion.Root([
            Accordion.Item("a", "Section A", [Text.Root("Content A")]),
            Accordion.Item("b", "Section B", [Text.Root("Content B")]),
        ], {
            multiple: true,
            collapsible: true,
            defaultValue: ["a"],
            style: { variant: "enclosed", size: "md" },
        }));
        const a = accordion.unwrap().unwrap("Accordion");
        $(Assert.equal(a.multiple.unwrap("some"), true));
        $(Assert.equal(a.collapsible.unwrap("some"), true));
        $(Assert.equal(a.defaultValue.unwrap("some").get(0n), "a"));
        const s = a.style.unwrap("some");
        $(Assert.equal(s.variant.unwrap("some").hasTag("enclosed"), true));
        $(Assert.equal(s.size.unwrap("some").hasTag("md"), true));
    });

    test("creates accordion with disabled item", $ => {
        const accordion = $.let(Accordion.Root([
            Accordion.Item("active", "Active Section", [Text.Root("Can be expanded")]),
            Accordion.Item("disabled", "Disabled Section", [Text.Root("Cannot be expanded")], { disabled: true }),
        ], { collapsible: true }));
        $(Assert.equal(accordion.unwrap().unwrap("Accordion").collapsible.unwrap("some"), true));
        $(Assert.equal(accordion.unwrap().unwrap("Accordion").items.get(1n).disabled.unwrap("some"), true));
    });

    test("creates accordion item with nested components", $ => {
        const item = $.let(Accordion.Item("nested", "Nested Content", [
            Text.Root("Line 1"),
            Text.Root("Line 2"),
            Text.Root("Line 3"),
        ]));
        $(Assert.equal(item.value, "nested"));
        $(Assert.equal(item.title, "Nested Content"));
    });
}, { platformFns: TestImpl });
