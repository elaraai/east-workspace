/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { Combobox, Style, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./combobox.examples.js";

describeEast("Combobox", (test) => {
    Assert.examples(test, {
        comboboxBasic: ex.comboboxBasic,
        comboboxVariants: ex.comboboxVariants,
        comboboxInteractive: ex.comboboxInteractive,
        comboboxEvents: ex.comboboxEvents,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#462).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("comboboxVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.comboboxVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 8n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "WITH VALUE"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "SIZES"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "DISABLED"));
        $(Assert.equal(rows.get(6n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "CUSTOM VALUE"));
    });

    test("comboboxInteractive panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.comboboxInteractive.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 6n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "MULTIPLE"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "INTERACTIVE"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "INTERACTIVE MULTI"));
    });

    test("comboboxEvents panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.comboboxEvents.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "ON INPUT VALUE CHANGE"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "ON OPEN CHANGE"));
    });

    // =========================================================================
    // Combobox.Item
    // =========================================================================

    test("creates combobox item with value and label", $ => {
        const item = $.let(Combobox.Item("us", "United States"));

        $(Assert.equal(item.value, "us"));
        $(Assert.equal(item.label, "United States"));
        $(Assert.equal(item.disabled.hasTag("none"), true));
    });

    test("creates combobox item with string expressions", $ => {
        const item = $.let(Combobox.Item(
            "uk",
            "United Kingdom"
        ));

        $(Assert.equal(item.value, "uk"));
        $(Assert.equal(item.label, "United Kingdom"));
    });

    test("creates disabled combobox item", $ => {
        const item = $.let(Combobox.Item("restricted", "Restricted Option", {
            disabled: true,
        }));

        $(Assert.equal(item.value, "restricted"));
        $(Assert.equal(item.disabled.hasTag("some"), true));
        $(Assert.equal(item.disabled.unwrap("some"), true));
    });

    test("creates enabled combobox item explicitly", $ => {
        const item = $.let(Combobox.Item("enabled", "Enabled Option", {
            disabled: false,
        }));

        $(Assert.equal(item.disabled.unwrap("some"), false));
    });

    // =========================================================================
    // Combobox.Root - Basic Creation
    // =========================================================================

    test("creates combobox with no initial value", $ => {
        const combobox = $.let(Combobox.Root({ value: "", items: [
            Combobox.Item("us", "United States"),
        ] }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").value.hasTag("none"), true));
    });

    test("creates combobox with string initial value", $ => {
        const combobox = $.let(Combobox.Root({ value: "us", items: [
            Combobox.Item("us", "United States"),
            Combobox.Item("uk", "United Kingdom"),
        ] }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").value.hasTag("some"), true));
        $(Assert.equal(combobox.unwrap().unwrap("Combobox").value.unwrap("some"), "us"));
    });

    test("creates combobox with multiple items", $ => {
        const combobox = $.let(Combobox.Root({ value: "", items: [
            Combobox.Item("us", "United States"),
            Combobox.Item("uk", "United Kingdom"),
            Combobox.Item("ca", "Canada"),
            Combobox.Item("au", "Australia"),
        ] }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").value.hasTag("none"), true));
    });

    // =========================================================================
    // Placeholder
    // =========================================================================

    test("creates combobox with placeholder", $ => {
        const combobox = $.let(Combobox.Root({ value: "", items: [
            Combobox.Item("us", "United States"),
        ], 
            placeholder: "Search countries...",
        }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").placeholder.hasTag("some"), true));
        $(Assert.equal(combobox.unwrap().unwrap("Combobox").placeholder.unwrap("some"), "Search countries..."));
    });

    test("creates combobox without placeholder", $ => {
        const combobox = $.let(Combobox.Root({ value: "", items: [
            Combobox.Item("us", "United States"),
        ] }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").placeholder.hasTag("none"), true));
    });

    // =========================================================================
    // Multiple Selection
    // =========================================================================

    test("creates multiple selection combobox", $ => {
        const combobox = $.let(Combobox.Root({ value: "", items: [
            Combobox.Item("red", "Red"),
            Combobox.Item("green", "Green"),
            Combobox.Item("blue", "Blue"),
        ], 
            multiple: true,
        }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").multiple.hasTag("some"), true));
        $(Assert.equal(combobox.unwrap().unwrap("Combobox").multiple.unwrap("some"), true));
    });

    test("creates single selection combobox explicitly", $ => {
        const combobox = $.let(Combobox.Root({ value: "", items: [
            Combobox.Item("a", "Option A"),
        ], 
            multiple: false,
        }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").multiple.unwrap("some"), false));
    });

    // =========================================================================
    // Disabled State
    // =========================================================================

    test("creates disabled combobox", $ => {
        const combobox = $.let(Combobox.Root({ value: "", items: [
            Combobox.Item("us", "United States"),
        ], 
            disabled: true,
        }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").disabled.hasTag("some"), true));
        $(Assert.equal(combobox.unwrap().unwrap("Combobox").disabled.unwrap("some"), true));
    });

    test("creates enabled combobox explicitly", $ => {
        const combobox = $.let(Combobox.Root({ value: "", items: [
            Combobox.Item("us", "United States"),
        ], 
            disabled: false,
        }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").disabled.unwrap("some"), false));
    });

    // =========================================================================
    // Size
    // =========================================================================

    test("creates small combobox", $ => {
        const combobox = $.let(Combobox.Root({ value: "", items: [
            Combobox.Item("us", "United States"),
        ], 
            size: "sm",
        }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").style.unwrap("some").size.hasTag("some"), true));
        $(Assert.equal(combobox.unwrap().unwrap("Combobox").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates medium combobox", $ => {
        const combobox = $.let(Combobox.Root({ value: "", items: [
            Combobox.Item("us", "United States"),
        ], 
            size: "md",
        }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
    });

    test("creates large combobox", $ => {
        const combobox = $.let(Combobox.Root({ value: "", items: [
            Combobox.Item("us", "United States"),
        ], 
            size: "lg",
        }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").style.unwrap("some").size.unwrap("some").hasTag("lg"), true));
    });

    test("creates combobox with Style.Size helper", $ => {
        const combobox = $.let(Combobox.Root({ value: "", items: [
            Combobox.Item("us", "United States"),
        ], 
            size: Style.Size("md"),
        }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
    });

    // =========================================================================
    // Allow Custom Value
    // =========================================================================

    test("creates combobox with allowCustomValue", $ => {
        const combobox = $.let(Combobox.Root({ value: "", items: [
            Combobox.Item("us", "United States"),
        ], 
            allowCustomValue: true,
        }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").allowCustomValue.hasTag("some"), true));
        $(Assert.equal(combobox.unwrap().unwrap("Combobox").allowCustomValue.unwrap("some"), true));
    });

    test("creates combobox without allowCustomValue", $ => {
        const combobox = $.let(Combobox.Root({ value: "", items: [
            Combobox.Item("us", "United States"),
        ] }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").allowCustomValue.hasTag("none"), true));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates combobox with all options", $ => {
        const combobox = $.let(Combobox.Root({ value: "us", items: [
            Combobox.Item("us", "United States"),
            Combobox.Item("uk", "United Kingdom"),
            Combobox.Item("ca", "Canada"),
        ], 
            placeholder: "Search countries...",
            multiple: false,
            disabled: false,
            size: "md",
            allowCustomValue: false,
        }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").value.unwrap("some"), "us"));
        $(Assert.equal(combobox.unwrap().unwrap("Combobox").placeholder.unwrap("some"), "Search countries..."));
        $(Assert.equal(combobox.unwrap().unwrap("Combobox").multiple.unwrap("some"), false));
        $(Assert.equal(combobox.unwrap().unwrap("Combobox").disabled.unwrap("some"), false));
        $(Assert.equal(combobox.unwrap().unwrap("Combobox").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
        $(Assert.equal(combobox.unwrap().unwrap("Combobox").allowCustomValue.unwrap("some"), false));
    });

    test("creates country search combobox", $ => {
        const combobox = $.let(Combobox.Root({ value: "", items: [
            Combobox.Item("us", "United States"),
            Combobox.Item("uk", "United Kingdom"),
            Combobox.Item("ca", "Canada"),
            Combobox.Item("au", "Australia"),
            Combobox.Item("de", "Germany"),
        ], 
            placeholder: "Search your country",
            size: "md",
        }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").placeholder.unwrap("some"), "Search your country"));
        $(Assert.equal(combobox.unwrap().unwrap("Combobox").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
    });

    test("creates combobox with disabled item", $ => {
        const disabledItem = $.let(Combobox.Item("enterprise", "Enterprise Plan", { disabled: true }));
        $(Assert.equal(disabledItem.disabled.unwrap("some"), true));

        const combobox = $.let(Combobox.Root({ value: "", items: [
            Combobox.Item("free", "Free Plan"),
            Combobox.Item("pro", "Pro Plan"),
            Combobox.Item("enterprise", "Enterprise Plan", { disabled: true }),
        ], 
            placeholder: "Search plans",
        }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").placeholder.unwrap("some"), "Search plans"));
    });

    test("creates disabled readonly combobox", $ => {
        const combobox = $.let(Combobox.Root({ value: "current", items: [
            Combobox.Item("current", "Current Selection"),
        ], 
            disabled: true,
            size: "sm",
        }));

        $(Assert.equal(combobox.unwrap().unwrap("Combobox").value.unwrap("some"), "current"));
        $(Assert.equal(combobox.unwrap().unwrap("Combobox").disabled.unwrap("some"), true));
    });
}, {   platformFns: TestImpl,});
