/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { Avatar, Style, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./avatar.examples.js";

describeEast("Avatar", (test) => {
    Assert.examples(test, {
        avatarBasic: ex.avatarBasic,
        avatarVariants: ex.avatarVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#462).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("avatarVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the size / colour / variant /
        // density / opacity / radius tables — is declared inside the example
        // body, because the documentation capture only extracts `fn`. That puts
        // the tables inside the Reactive body, which TestImpl does not execute,
        // so they cannot be asserted from here; `Assert.examples` above still
        // compiles and evaluates the outer function. The per-axis coverage
        // lives in the Avatar.Root tests below, which construct each value
        // directly.
        const panel = $.const(ex.avatarVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    // =========================================================================
    // Basic Creation
    // =========================================================================

    test("creates empty avatar", $ => {
        const avatar = $.let(Avatar.Root());

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").src.hasTag("none"), true));
        $(Assert.equal(avatar.unwrap().unwrap("Avatar").name.hasTag("none"), true));
        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.hasTag("none"), true));
    });

    test("creates avatar with src", $ => {
        const avatar = $.let(Avatar.Root({
            src: "https://example.com/avatar.jpg",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").src.hasTag("some"), true));
        $(Assert.equal(avatar.unwrap().unwrap("Avatar").src.unwrap("some"), "https://example.com/avatar.jpg"));
    });

    test("creates avatar with name", $ => {
        const avatar = $.let(Avatar.Root({
            name: "John Doe",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").name.hasTag("some"), true));
        $(Assert.equal(avatar.unwrap().unwrap("Avatar").name.unwrap("some"), "John Doe"));
    });

    test("creates avatar with src and name", $ => {
        const avatar = $.let(Avatar.Root({
            src: "https://example.com/john.jpg",
            name: "John Doe",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").src.unwrap("some"), "https://example.com/john.jpg"));
        $(Assert.equal(avatar.unwrap().unwrap("Avatar").name.unwrap("some"), "John Doe"));
    });

    // =========================================================================
    // Size
    // =========================================================================

    test("creates extra small avatar", $ => {
        const avatar = $.let(Avatar.Root({
            size: "xs",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").size.hasTag("some"), true));
        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").size.unwrap("some").hasTag("xs"), true));
    });

    test("creates small avatar", $ => {
        const avatar = $.let(Avatar.Root({
            size: "sm",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates medium avatar", $ => {
        const avatar = $.let(Avatar.Root({
            size: "md",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
    });

    test("creates large avatar", $ => {
        const avatar = $.let(Avatar.Root({
            size: "lg",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").size.unwrap("some").hasTag("lg"), true));
    });

    test("creates avatar with Size helper", $ => {
        const avatar = $.let(Avatar.Root({
            size: "lg",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").size.unwrap("some").hasTag("lg"), true));
    });

    // =========================================================================
    // Variant
    // =========================================================================

    test("creates solid variant avatar", $ => {
        const avatar = $.let(Avatar.Root({
            variant: "solid",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").variant.hasTag("some"), true));
        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").variant.unwrap("some").hasTag("solid"), true));
    });

    test("creates subtle variant avatar", $ => {
        const avatar = $.let(Avatar.Root({
            variant: "subtle",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").variant.unwrap("some").hasTag("subtle"), true));
    });

    test("creates outline variant avatar", $ => {
        const avatar = $.let(Avatar.Root({
            variant: "outline",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").variant.unwrap("some").hasTag("outline"), true));
    });

    test("creates avatar with Style.StyleVariant helper", $ => {
        const avatar = $.let(Avatar.Root({
            variant: Style.StyleVariant("solid"),
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").variant.unwrap("some").hasTag("solid"), true));
    });

    // =========================================================================
    // Color Palette
    // =========================================================================

    test("creates avatar with brand color palette", $ => {
        const avatar = $.let(Avatar.Root({
            colorPalette: "brand",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").colorPalette.hasTag("some"), true));
        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").colorPalette.unwrap("some").hasTag("brand"), true));
    });

    test("creates avatar with brand color palette", $ => {
        const avatar = $.let(Avatar.Root({
            colorPalette: "brand",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").colorPalette.unwrap("some").hasTag("brand"), true));
    });

    test("creates avatar with Style.ColorScheme helper", $ => {
        const avatar = $.let(Avatar.Root({
            colorPalette: Style.ColorScheme("success"),
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").colorPalette.unwrap("some").hasTag("success"), true));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates avatar with all options", $ => {
        const avatar = $.let(Avatar.Root({
            src: "https://example.com/profile.jpg",
            name: "Alice Smith",
            size: "lg",
            variant: "solid",
            colorPalette: "brand",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").src.unwrap("some"), "https://example.com/profile.jpg"));
        $(Assert.equal(avatar.unwrap().unwrap("Avatar").name.unwrap("some"), "Alice Smith"));
        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").size.unwrap("some").hasTag("lg"), true));
        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").variant.unwrap("some").hasTag("solid"), true));
        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").colorPalette.unwrap("some").hasTag("brand"), true));
    });

    test("creates user profile avatar", $ => {
        const avatar = $.let(Avatar.Root({
            src: "https://api.example.com/users/123/avatar",
            name: "Jane Wilson",
            size: "md",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").name.unwrap("some"), "Jane Wilson"));
        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
    });

    test("creates initials avatar", $ => {
        const avatar = $.let(Avatar.Root({
            name: "Bob Johnson",
            colorPalette: "brand",
            variant: "solid",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").src.hasTag("none"), true));
        $(Assert.equal(avatar.unwrap().unwrap("Avatar").name.unwrap("some"), "Bob Johnson"));
    });

    test("creates small team member avatar", $ => {
        const avatar = $.let(Avatar.Root({
            name: "Team Member",
            size: "sm",
            colorPalette: "brand",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").colorPalette.unwrap("some").hasTag("brand"), true));
    });

    test("creates large profile header avatar", $ => {
        const avatar = $.let(Avatar.Root({
            src: "https://example.com/large-avatar.jpg",
            name: "Profile User",
            size: "lg",
        }));

        $(Assert.equal(avatar.unwrap().unwrap("Avatar").style.unwrap("some").size.unwrap("some").hasTag("lg"), true));
    });
}, {   platformFns: TestImpl,});
