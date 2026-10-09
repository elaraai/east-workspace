/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Icon } from "../../src/display/icon/index.js";
import { describeEast as describe, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, NullType, none, type ExprType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import {
    Banner, Button, CommandPalette, EditableChip, EmptyState, IconButton, List, MetricChip, NavList, Stat, Status, Text,
    Toggle, TreeView,
} from "@elaraai/east-ui/internal";
import * as ex from "./icon.examples.js";

/** What building throws — `""` when it builds. */
function refusal(build: () => unknown): string {
    try { build(); return ""; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

/** The words a factory refuses an icon of another set with (#1263). */
function refused(where: string, prefix: string, name: string): string {
    return `${where}: \`${prefix} ${name}\` is not a Font Awesome solid icon (#1263) — East UI draws solid icons only: ` +
        `use a solid one, as \`{ prefix: "fas", name: "${name}" }\``;
}

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

    // =========================================================================
    // Solid only (#1263): East UI draws Font Awesome's solid set alone
    // =========================================================================

    test("a regular or brands icon is refused at build, naming it and a solid one (#1263)", $ => {
        $(Assert.equal(East.value(refusal(() => Icon.Root({ prefix: "far", name: "heart" } as never))),
            "Icon: `far heart` is not a Font Awesome solid icon (#1263) — East UI draws solid icons only: " +
            "use a solid one, as `{ prefix: \"fas\", name: \"heart\" }`"));
        $(Assert.equal(East.value(refusal(() => Icon.Root({ prefix: "fab", name: "github" } as never))), refused("Icon", "fab", "github")));
    });

    test("an icon's style names its set by one case, solid — the regular, light, thin and brands cases are gone (#1263)", $ => {
        $(Assert.equal(East.value(Object.keys(Icon.Types.Variant.cases)), ["solid"]));
        const icon = $.let(Icon.Root({ prefix: "fas", name: "star", variant: "solid" }));
        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").variant.unwrap("some").hasTag("solid"), true));
    });

    test("every factory that takes an icon by value refuses another set, naming itself (#1263)", $ => {
        // An icon payload, which the types hold to `"fas"` — and an Icon value,
        // whose prefix the types leave a string: the refusal holds both.
        const payload = { prefix: "far", name: "bookmark" } as never;
        const value = { prefix: "far", name: "bookmark", label: none, style: none };
        const noop = East.function([], NullType, (_$) => { /* noop */ });
        const builds: Record<string, () => unknown> = {
            "IconButton": () => IconButton.Root({ prefix: "far", name: "bookmark", label: "Save" } as never),
            "IconButton loadingIcon": () => IconButton.Root({ prefix: "fas", name: "rotate", label: "Refresh", loadingIcon: value }),
            "Button startIcon": () => Button.Root("Save", { startIcon: value }),
            "Button endIcon": () => Button.Root("Next", { endIcon: payload }),
            "Button loadingIcon": () => Button.Root("Save", { loadingIcon: value }),
            "Toggle icon": () => Toggle.Root("Lock columns", { pressed: false, icon: payload }),
            "TreeView.Item": () => TreeView.Item("readme", "README.md", payload),
            "TreeView.Branch": () => TreeView.Branch("docs", "docs", [TreeView.Item("readme", "README.md")], payload),
            "NavList item icon": () => NavList.Root([{ items: [{ key: "x", label: "X", icon: payload }] }]),
            "Banner icon": () => Banner.Root({ status: "info", title: "Ship", icon: value }),
            "Status icon": () => Status.Root({ label: "Shipping", value: "info", icon: payload }),
            "EmptyState icon": () => EmptyState.Root({ title: "Nothing here", icon: value }),
            "Stat.Indicator icon": () => Stat.Indicator("up", { icon: value }),
            "Stat indicator icon": () => Stat.Root({ label: "Revenue", value: "$45,231", indicator: { direction: "up", icon: value } }),
            "List markerIcon": () => List.Root(["Item"], { markerIcon: value }),
            "MetricChip icon": () => MetricChip.Root(Text.Root("+12.5%"), { tone: "positive", icon: value }),
            "EditableChip trigger": () => EditableChip.Root(Text.Root("Scenario"), { trigger: value }),
            "CommandPalette command icon": () => CommandPalette.Root([{ id: "x", label: "X", action: noop, icon: value }]),
        };
        for (const [where, build] of Object.entries(builds)) {
            $(Assert.equal(East.value(refusal(build)), refused(where, "far", "bookmark")));
        }
    });

    test("each factory builds a solid icon it is given as it did (#1263)", $ => {
        const solid = { prefix: "fas", name: "bookmark", label: none, style: none };
        const noop = East.function([], NullType, (_$) => { /* noop */ });
        const builds: (() => unknown)[] = [
            () => IconButton.Root({ prefix: "fas", name: "bookmark", label: "Save", loadingIcon: solid }),
            () => Button.Root("Save", { startIcon: solid, endIcon: { prefix: "fas", name: "bookmark" }, loadingIcon: solid }),
            () => Toggle.Root("Lock columns", { pressed: false, icon: { prefix: "fas", name: "bookmark" } }),
            () => TreeView.Branch("docs", "docs", [TreeView.Item("readme", "README.md", { prefix: "fas", name: "file" })], { prefix: "fas", name: "folder" }),
            () => NavList.Root([{ items: [{ key: "x", label: "X", icon: { prefix: "fas", name: "gear" } }] }]),
            () => Banner.Root({ status: "info", title: "Ship", icon: solid }),
            () => Status.Root({ label: "Shipping", value: "info", icon: { prefix: "fas", name: "truck" } }),
            () => EmptyState.Root({ title: "Nothing here", icon: solid }),
            () => Stat.Indicator("up", { icon: solid }),
            () => Stat.Root({ label: "Revenue", value: "$45,231", indicator: { direction: "up", icon: solid } }),
            () => List.Root(["Item"], { markerIcon: solid }),
            () => MetricChip.Root(Text.Root("+12.5%"), { tone: "positive", icon: solid }),
            () => EditableChip.Root(Text.Root("Scenario"), { trigger: solid }),
            () => CommandPalette.Root([{ id: "x", label: "X", action: noop, icon: solid }]),
        ];
        $(Assert.equal(East.value(builds.map(refusal)), builds.map(() => "")));
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
        const icon = $.let(Icon.Root({ prefix: "fas", name: "folder-open" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").prefix, "fas"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").name, "folder-open"));
    });

    test("creates file icon for tree view", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "file", size: "sm" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").prefix, "fas"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").name, "file"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates code file icon for tree view", $ => {
        const icon = $.let(Icon.Root({ prefix: "fas", name: "file-code", color: "link" }));

        $(Assert.equal(icon.unwrap().unwrap("Icon").name, "file-code"));
        $(Assert.equal(icon.unwrap().unwrap("Icon").style.unwrap("some").color.unwrap("some"), "link"));
    });
}, {   platformFns: TestImpl,});
