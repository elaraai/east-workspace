/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, OptionType, StringType, some, type ExprType } from "@elaraai/east";
import { DataList, Text, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./data-list.examples.js";

describeEast("DataList", (test) => {
    Assert.examples(test, {
        dataListBasic: ex.dataListBasic,
        dataListRichValues: ex.dataListRichValues,
        dataListVariants: ex.dataListVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#461).
    // =========================================================================

    test("dataListVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the orientation / variant /
        // size / content / colour tables — is declared inside the example
        // body, because the documentation capture only extracts `fn`. That
        // puts the tables inside the Reactive body, which TestImpl does not
        // execute, so they cannot be asserted from here; `Assert.examples`
        // above still compiles and evaluates the outer function. The
        // per-option coverage lives in the DataList.Root tests below, which
        // construct each option directly.
        const panel = $.const(ex.dataListVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    // =========================================================================
    // DataList.Root - Basic Creation
    // =========================================================================

    test("creates data list with items", $ => {
        const list = $.let(DataList.Root([
            { label: "Name", value: Text.Root("Alice") },
            { label: "Email", value: Text.Root("alice@example.com") },
        ]), UIComponentType);

        $(Assert.equal(list.unwrap().unwrap("DataList").style.hasTag("none"), true));
    });

    test("creates data list with single item", $ => {
        const list = $.let(DataList.Root([
            { label: "Status", value: Text.Root("Active") },
        ]), UIComponentType);

        $(Assert.equal(list.unwrap().unwrap("DataList").style.hasTag("none"), true));
    });

    test("creates empty data list", $ => {
        const list = $.let(DataList.Root([]), UIComponentType);

        $(Assert.equal(list.unwrap().unwrap("DataList").style.hasTag("none"), true));
    });

    // =========================================================================
    // DataList.Root - Orientation
    // =========================================================================

    test("creates horizontal data list", $ => {
        const list = $.let(DataList.Root([
            { label: "Name", value: Text.Root("Bob") },
        ], {
            orientation: "horizontal",
        }), UIComponentType);

        $(Assert.equal(list.unwrap().unwrap("DataList").style.unwrap("some").orientation.hasTag("some"), true));
        $(Assert.equal(list.unwrap().unwrap("DataList").style.unwrap("some").orientation.unwrap("some").hasTag("horizontal"), true));
    });

    test("creates vertical data list", $ => {
        const list = $.let(DataList.Root([
            { label: "Status", value: Text.Root("Active") },
        ], {
            orientation: "vertical",
        }), UIComponentType);

        $(Assert.equal(list.unwrap().unwrap("DataList").style.unwrap("some").orientation.unwrap("some").hasTag("vertical"), true));
    });

    // =========================================================================
    // DataList.Root - Size
    // =========================================================================

    test("creates data list with sm size", $ => {
        const list = $.let(DataList.Root([
            { label: "Label", value: Text.Root("Value") },
        ], {
            size: "sm",
        }), UIComponentType);

        $(Assert.equal(list.unwrap().unwrap("DataList").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates data list with md size", $ => {
        const list = $.let(DataList.Root([
            { label: "Label", value: Text.Root("Value") },
        ], {
            size: "md",
        }), UIComponentType);

        $(Assert.equal(list.unwrap().unwrap("DataList").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
    });

    test("creates data list with lg size", $ => {
        const list = $.let(DataList.Root([
            { label: "Label", value: Text.Root("Value") },
        ], {
            size: "lg",
        }), UIComponentType);

        $(Assert.equal(list.unwrap().unwrap("DataList").style.unwrap("some").size.unwrap("some").hasTag("lg"), true));
    });

    // =========================================================================
    // DataList.Root - Variant
    // =========================================================================

    test("creates data list with subtle variant", $ => {
        const list = $.let(DataList.Root([
            { label: "Label", value: Text.Root("Value") },
        ], {
            variant: "subtle",
        }), UIComponentType);

        $(Assert.equal(list.unwrap().unwrap("DataList").style.unwrap("some").variant.hasTag("some"), true));
        $(Assert.equal(list.unwrap().unwrap("DataList").style.unwrap("some").variant.unwrap("some").hasTag("subtle"), true));
    });

    test("creates data list with bold variant", $ => {
        const list = $.let(DataList.Root([
            { label: "Label", value: Text.Root("Value") },
        ], {
            variant: "bold",
        }), UIComponentType);

        $(Assert.equal(list.unwrap().unwrap("DataList").style.unwrap("some").variant.unwrap("some").hasTag("bold"), true));
    });

    test("creates data list with DataListVariant helper", $ => {
        const list = $.let(DataList.Root([
            { label: "Label", value: Text.Root("Value") },
        ], {
            variant: "bold",
        }), UIComponentType);

        $(Assert.equal(list.unwrap().unwrap("DataList").style.unwrap("some").variant.unwrap("some").hasTag("bold"), true));
    });

    // =========================================================================
    // DataList.Root - Combined Options
    // =========================================================================

    test("creates data list with all options", $ => {
        const list = $.let(DataList.Root([
            { label: "Name", value: Text.Root("Alice") },
            { label: "Role", value: Text.Root("Admin") },
        ], {
            orientation: "horizontal",
            size: "md",
            variant: "bold",
        }), UIComponentType);

        const style = list.unwrap().unwrap("DataList").style.unwrap("some");
        $(Assert.equal(style.orientation.unwrap("some").hasTag("horizontal"), true));
        $(Assert.equal(style.size.unwrap("some").hasTag("md"), true));
        $(Assert.equal(style.variant.unwrap("some").hasTag("bold"), true));
    });

    test("creates user details data list", $ => {
        const list = $.let(DataList.Root([
            { label: "Username", value: Text.Root("alice_smith") },
            { label: "Email", value: Text.Root("alice@example.com") },
            { label: "Status", value: Text.Root("Active") },
            { label: "Role", value: Text.Root("Administrator") },
        ], {
            orientation: "vertical",
            variant: "subtle",
        }), UIComponentType);

        const style = list.unwrap().unwrap("DataList").style.unwrap("some");
        $(Assert.equal(style.orientation.unwrap("some").hasTag("vertical"), true));
        $(Assert.equal(style.variant.unwrap("some").hasTag("subtle"), true));
    });

    test("creates product info data list", $ => {
        const list = $.let(DataList.Root([
            { label: "SKU", value: Text.Root("PRD-12345") },
            { label: "Price", value: Text.Root("$99.99") },
            { label: "Stock", value: Text.Root("In Stock") },
        ], {
            size: "sm",
        }), UIComponentType);

        $(Assert.equal(list.unwrap().unwrap("DataList").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates order summary data list", $ => {
        const list = $.let(DataList.Root([
            { label: "Order ID", value: Text.Root("#ORD-2024-001") },
            { label: "Date", value: Text.Root("Dec 15, 2024") },
            { label: "Total", value: Text.Root("$245.00") },
            { label: "Status", value: Text.Root("Shipped") },
        ], {
            orientation: "horizontal",
            size: "lg",
            variant: "bold",
        }), UIComponentType);

        const style = list.unwrap().unwrap("DataList").style.unwrap("some");
        $(Assert.equal(style.orientation.unwrap("some").hasTag("horizontal"), true));
        $(Assert.equal(style.size.unwrap("some").hasTag("lg"), true));
        $(Assert.equal(style.variant.unwrap("some").hasTag("bold"), true));
    });

    test("creates metadata data list", $ => {
        const list = $.let(DataList.Root([
            { label: "Created", value: Text.Root("Jan 1, 2024") },
            { label: "Modified", value: Text.Root("Dec 20, 2024") },
            { label: "Version", value: Text.Root("1.2.3") },
        ]), UIComponentType);

        $(Assert.equal(list.unwrap().unwrap("DataList").style.hasTag("none"), true));
    });

    // =========================================================================
    // DataList.Root - Colour escape hatches
    // =========================================================================

    test("creates data list with colour escape hatches", $ => {
        const list = $.let(DataList.Root([
            { label: "Name", value: Text.Root("Alice") },
        ], {
            background: "bg.subtle",
            borderColor: "border.subtle",
            labelColor: "fg.muted",
            valueColor: "fg.default",
        }), UIComponentType);

        const style = list.unwrap().unwrap("DataList").style.unwrap("some");
        $(Assert.equal(style.background.unwrap("some"), "bg.subtle"));
        $(Assert.equal(style.borderColor.unwrap("some"), "border.subtle"));
        $(Assert.equal(style.labelColor.unwrap("some"), "fg.muted"));
        $(Assert.equal(style.valueColor.unwrap("some"), "fg.default"));
    });

    // =========================================================================
    // DataList.Root - Match with different item counts
    // =========================================================================

    test("handles match branches with different item counts as items arg", $ => {
        const opt = $.let(East.value(some("predicted"), OptionType(StringType)), OptionType(StringType));

        const list = $.let(DataList.Root(
            opt.match({
                some: ($, pred) => East.value([
                    { label: "Flag", value: Text.Root("A") },
                    { label: "Predicted", value: Text.Root(pred) },
                    { label: "Range", value: Text.Root("1-5") },
                ]),
                none: (_$) => East.value([
                    { label: "Flag", value: Text.Root("A") },
                ]),
            }),
            { size: "sm", orientation: "horizontal" }
        ), UIComponentType);

        $(Assert.equal(list.unwrap().unwrap("DataList").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("handles match branches returning whole DataList components", $ => {
        const opt = $.let(East.value(some("predicted"), OptionType(StringType)), OptionType(StringType));

        const list = $.let(
            opt.match({
                some: ($, pred) => DataList.Root([
                    { label: "Flag", value: Text.Root("A") },
                    { label: "Predicted", value: Text.Root(pred) },
                    { label: "Range", value: Text.Root("1-5") },
                ], { size: "sm", orientation: "horizontal" }),
                none: (_$) => DataList.Root([
                    { label: "Flag", value: Text.Root("A") },
                ], { size: "sm", orientation: "horizontal" }),
            }),
            UIComponentType
        );

        $(Assert.equal(list.unwrap().unwrap("DataList").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

}, { platformFns: TestImpl });
