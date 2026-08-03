/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Icon } from "../../src/display/icon/index.js";
import { describeEast as describe, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./icon.examples.js";

describe("Icon", (test) => {
    Assert.examples(test, {
        iconBasic: ex.iconBasic,
        iconStyles: ex.iconStyles,
    });

    // =========================================================================
    // Panels — the merged example is one live <Configurator> (#462).
    // =========================================================================

    test("iconStyles drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the glyph / size / tint / opacity
        // / tile / padding tables — is declared inside the example body, because
        // the documentation capture only extracts `fn`. That puts the tables
        // inside the Reactive body, which TestImpl does not execute, so they
        // cannot be asserted from here; `Assert.examples` above still compiles
        // and evaluates the outer function. The per-axis coverage lives in the
        // Icon.Root tests below, which construct each style directly.
        const panel = $.const(ex.iconStyles.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    // =========================================================================
    // Icon.Root - Basic with prefix
    // =========================================================================

    test("creates solid icon with name", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "user" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").prefix, "fas"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").name, "user"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").label.hasTag("none"), true));
        $(Assert.equal(icon.unwrap().unwrap("Icon").style.hasTag("none"), true));
    });

    // =========================================================================
    // Icon.Root - Label (a11y §0.2)
    // =========================================================================

    test("decorative icon — label absent", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "star" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").label.hasTag("none"), true));
    });

    test("meaningful icon — label present", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "user", label: "User profile" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").label.hasTag("some"), true));
        $(Assert.equal(icon.unwrap().unwrap("Icon").label.unwrap("some"), "User profile"));
    });

    test("icon with label plus style fields", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "heart", label: "Favourite", size: "lg", color: "fg.danger" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").label.unwrap("some"), "Favourite"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").size.unwrap("some").hasTag("lg"), true));
        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").color.unwrap("some"), "fg.danger"));
    });

    test("icon with background tile colour", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "user", background: "bg.brand.subtle", borderRadius: "full" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").background.unwrap("some"), "bg.brand.subtle"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").borderRadius.unwrap("some"), "full"));
    });

    test("creates regular icon", $ => {
        const icon = $.let(Icon.Root({ prefix: "far", name: "heart" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").prefix, "far"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").name, "heart"));
    });

    test("creates brands icon", $ => {
        const icon = $.let(Icon.Root({ prefix: "fab", name: "github" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").prefix, "fab"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").name, "github"));
    });

    test("creates folder icon", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "folder" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").name, "folder"));
    });

    test("creates chevron icon", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "chevron-right" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").name, "chevron-right"));
    });

    // =========================================================================
    // Icon.Root - Size
    // =========================================================================

    test("creates icon with xs size", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "user", size: "xs" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").size.unwrap("some").hasTag("xs"), true));
    });

    test("creates icon with sm size", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "user", size: "sm" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates icon with md size", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "user", size: "md" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
    });

    test("creates icon with lg size", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "user", size: "lg" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").size.unwrap("some").hasTag("lg"), true));
    });

    test("creates icon with xl size", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "user", size: "xl" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").size.unwrap("some").hasTag("xl"), true));
    });

    test("creates icon with 2xl size", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "user", size: "2xl" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").size.unwrap("some").hasTag("2xl"), true));
    });

    // =========================================================================
    // Icon.Root - Color
    // =========================================================================

    test("creates icon with color", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "heart", color: "fg.danger" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").color.unwrap("some"), "fg.danger"));
    });

    test("creates icon with CSS color", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "star", color: "fg.warning" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").color.unwrap("some"), "fg.warning"));
    });

    // =========================================================================
    // Icon.Root - Color Palette
    // =========================================================================

    test("creates icon with brand color palette", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "info", colorPalette: "brand" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").colorPalette.unwrap("some").hasTag("brand"), true));
    });

    test("creates icon with danger color palette", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "circle-exclamation", colorPalette: "danger" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").colorPalette.unwrap("some").hasTag("danger"), true));
    });

    // =========================================================================
    // Icon.Root - Combined Styles
    // =========================================================================

    test("creates icon with all style properties", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "check",
            size: "lg",
            color: "fg.success",
            colorPalette: "success",
        }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").prefix, "fas"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").name, "check"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").size.unwrap("some").hasTag("lg"), true));
        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").color.unwrap("some"), "fg.success"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").colorPalette.unwrap("some").hasTag("success"), true));
    });

    // =========================================================================
    // Icon.Root - Tree View Use Cases
    // =========================================================================

    test("creates folder-open icon for tree view", $ => {
        const icon = $.let(Icon.Root({ prefix: "far", name: "folder-open" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").prefix, "far"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").name, "folder-open"));
    });

    test("creates file icon for tree view", $ => {
        const icon = $.let(Icon.Root({ prefix: "far", name: "file", size: "sm" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").prefix, "far"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").name, "file"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates code file icon for tree view", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "file-code", color: "link" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").name, "file-code"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").color.unwrap("some"), "link"));
    });
}, {   platformFns: TestImpl,});
