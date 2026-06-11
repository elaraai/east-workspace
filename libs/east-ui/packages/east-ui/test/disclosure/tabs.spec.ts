/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Tabs, Text } from "@elaraai/east-ui/internal";
import * as ex from "./tabs.examples.js";

describeEast("Tabs", (test) => {
    Assert.examples(test, {
        tabsBasic: ex.tabsBasic,
        tabsLine: ex.tabsLine,
        tabsFitted: ex.tabsFitted,
        tabsSizes: ex.tabsSizes,
        tabsWithDisabled: ex.tabsWithDisabled,
        tabsInteractive: ex.tabsInteractive,
        tabsWithCountBadges: ex.tabsWithCountBadges,
        tabsTwoLine: ex.tabsTwoLine,
        tabsReactive: ex.tabsReactive,
    });

    // =========================================================================
    // Tabs.Item — string trigger coerced to Text.Root
    // =========================================================================

    test("creates item with string trigger (coerced to Text.Root)", $ => {
        const item = $.let(Tabs.Item("tab-1", "Tab 1", [
            Text.Root("Content for tab 1"),
        ]));
        $(Assert.equal(item.value, "tab-1"));
        $(Assert.equal(item.trigger.unwrap().unwrap("Text").value, "Tab 1"));
        $(Assert.equal(item.disabled.hasTag("none"), true));
    });

    test("creates item with rich UIComp trigger", $ => {
        const item = $.let(Tabs.Item(
            "rich",
            Text.Root("Rich Label", { fontWeight: "bold" }),
            [Text.Root("Body")],
        ));
        $(Assert.equal(item.trigger.unwrap().unwrap("Text").value, "Rich Label"));
    });

    test("creates disabled item", $ => {
        const item = $.let(Tabs.Item("disabled-item", "Disabled Tab", [
            Text.Root("Cannot click"),
        ], { disabled: true }));
        $(Assert.equal(item.disabled.unwrap("some"), true));
    });

    // =========================================================================
    // Tabs.Root — defaults
    // =========================================================================

    test("creates tabs without options — everything none", $ => {
        const tabs = $.let(Tabs.Root([
            Tabs.Item("a", "A", [Text.Root("A content")]),
            Tabs.Item("b", "B", [Text.Root("B content")]),
        ]));
        const t = tabs.unwrap().unwrap("Tabs");
        $(Assert.equal(t.value.hasTag("none"), true));
        $(Assert.equal(t.defaultValue.hasTag("none"), true));
        $(Assert.equal(t.onValueChange.hasTag("none"), true));
        $(Assert.equal(t.style.hasTag("none"), true));
    });

    // =========================================================================
    // State on main — value / defaultValue
    // =========================================================================

    test("creates tabs with defaultValue (main)", $ => {
        const tabs = $.let(Tabs.Root([
            Tabs.Item("a", "A", [Text.Root("A")]),
            Tabs.Item("b", "B", [Text.Root("B")]),
        ], { defaultValue: "a" }));
        $(Assert.equal(tabs.unwrap().unwrap("Tabs").defaultValue.unwrap("some"), "a"));
    });

    test("creates tabs with controlled value (main)", $ => {
        const tabs = $.let(Tabs.Root([
            Tabs.Item("a", "A", [Text.Root("A")]),
        ], { value: "a" }));
        $(Assert.equal(tabs.unwrap().unwrap("Tabs").value.unwrap("some"), "a"));
    });

    // =========================================================================
    // Visual presets — inside style
    // =========================================================================

    test("creates line variant tabs (inside style)", $ => {
        const tabs = $.let(Tabs.Root([
            Tabs.Item("a", "A", [Text.Root("A")]),
        ], { variant: "line" }));
        $(Assert.equal(
            tabs.unwrap().unwrap("Tabs").style.unwrap("some").variant.unwrap("some").hasTag("line"),
            true,
        ));
    });

    test("creates tabs with size + orientation + fitted + colorPalette", $ => {
        const tabs = $.let(Tabs.Root([
            Tabs.Item("a", "A", [Text.Root("A")]),
        ], {
            size: "lg",
            orientation: "vertical",
            fitted: true,
            colorPalette: "blue",
        }));
        const s = tabs.unwrap().unwrap("Tabs").style.unwrap("some");
        $(Assert.equal(s.size.unwrap("some").hasTag("lg"), true));
        $(Assert.equal(s.orientation.unwrap("some").hasTag("vertical"), true));
        $(Assert.equal(s.fitted.unwrap("some"), true));
        $(Assert.equal(s.colorPalette.unwrap("some").hasTag("blue"), true));
    });

    test("creates tabs with activationMode manual + justify", $ => {
        const tabs = $.let(Tabs.Root([
            Tabs.Item("a", "A", [Text.Root("A")]),
        ], {
            activationMode: "manual", justify: "center",
        }));
        const s = tabs.unwrap().unwrap("Tabs").style.unwrap("some");
        $(Assert.equal(s.activationMode.unwrap("some").hasTag("manual"), true));
        $(Assert.equal(s.justify.unwrap("some").hasTag("center"), true));
    });

    test("creates tabs with lazyMount + unmountOnExit", $ => {
        const tabs = $.let(Tabs.Root([
            Tabs.Item("a", "A", [Text.Root("A")]),
        ], {
            lazyMount: true, unmountOnExit: true,
        }));
        const s = tabs.unwrap().unwrap("Tabs").style.unwrap("some");
        $(Assert.equal(s.lazyMount.unwrap("some"), true));
        $(Assert.equal(s.unmountOnExit.unwrap("some"), true));
    });

    // =========================================================================
    // Colour slots
    // =========================================================================

    test("creates tabs with full colour escape hatches", $ => {
        const tabs = $.let(Tabs.Root([
            Tabs.Item("a", "A", [Text.Root("A")]),
        ], {
            listBackground: "#f9fafb",
            indicatorColor: "#3d5cff",
            activeTriggerColor: "#1a2234",
            inactiveTriggerColor: "#6b7280",
            contentBackground: "#ffffff",
        }));
        const s = tabs.unwrap().unwrap("Tabs").style.unwrap("some");
        $(Assert.equal(s.listBackground.unwrap("some"), "#f9fafb"));
        $(Assert.equal(s.indicatorColor.unwrap("some"), "#3d5cff"));
        $(Assert.equal(s.activeTriggerColor.unwrap("some"), "#1a2234"));
        $(Assert.equal(s.inactiveTriggerColor.unwrap("some"), "#6b7280"));
        $(Assert.equal(s.contentBackground.unwrap("some"), "#ffffff"));
    });

    // =========================================================================
    // TabsVariant helper
    // =========================================================================

    test("creates tabs with TabsVariant helper", $ => {
        const tabs = $.let(Tabs.Root([
            Tabs.Item("a", "A", [Text.Root("A")]),
        ], { variant: Tabs.Variant("plain") }));
        $(Assert.equal(
            tabs.unwrap().unwrap("Tabs").style.unwrap("some").variant.unwrap("some").hasTag("plain"),
            true,
        ));
    });

    // =========================================================================
    // Combined
    // =========================================================================

    test("creates fully-configured tabs", $ => {
        const tabs = $.let(Tabs.Root([
            Tabs.Item("overview", "Overview", [Text.Root("Overview")]),
            Tabs.Item("details", "Details", [Text.Root("Details")]),
        ], {
            defaultValue: "overview",
            variant: "line",
            size: "md",
            colorPalette: "blue",
            fitted: true,
        }));
        const t = tabs.unwrap().unwrap("Tabs");
        $(Assert.equal(t.defaultValue.unwrap("some"), "overview"));
        const s = t.style.unwrap("some");
        $(Assert.equal(s.variant.unwrap("some").hasTag("line"), true));
        $(Assert.equal(s.size.unwrap("some").hasTag("md"), true));
        $(Assert.equal(s.colorPalette.unwrap("some").hasTag("blue"), true));
        $(Assert.equal(s.fitted.unwrap("some"), true));
    });
}, { platformFns: TestImpl });
