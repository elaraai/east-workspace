/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { TreeView } from "../../src/collections/tree-view/index.js";
import { describeEast as describe, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./tree-view.examples.js";

describe("TreeView", (test) => {
    Assert.examples(test, {
        treeViewBasic: ex.treeViewBasic,
        treeViewVariants: ex.treeViewVariants,
        treeViewEvents: ex.treeViewEvents,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#461).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("treeViewVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the tree-preset / size /
        // variant / colour tables plus the default-expanded switch — is
        // declared inside the example body, because the documentation capture
        // only extracts `fn`. That puts the tables inside the Reactive body,
        // which TestImpl does not execute, so they cannot be asserted from
        // here; `Assert.examples` above still compiles and evaluates the
        // outer function. The per-option coverage lives in the TreeView.Root
        // tests below, which construct each option directly.
        const panel = $.const(ex.treeViewVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    test("treeViewEvents panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.treeViewEvents.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 6n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "VIEW INTERACTIVE SELECTION"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "VIEW INTERACTIVE EXPAND"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "VIEW ON FOCUS CHANGE"));
    });

    // =========================================================================
    // TreeView.Item - Basic
    // =========================================================================

    test("creates item without indicator", $ => {
        const item = $.let(TreeView.Item("file1", "index.ts"));

        $(Assert.equal(item.unwrap().unwrap("Item").value, "file1"));
        $(Assert.equal(item.unwrap().unwrap("Item").label, "index.ts"));
        $(Assert.equal(item.unwrap().unwrap("Item").indicator.hasTag("none"), true));
    });

    test("creates item with indicator", $ => {
        const item = $.let(TreeView.Item("readme", "README.md", { prefix: "far", name: "file" }));

        $(Assert.equal(item.unwrap().unwrap("Item").value, "readme"));
        $(Assert.equal(item.unwrap().unwrap("Item").indicator.hasTag("some"), true));
        $(Assert.equal(item.unwrap().unwrap("Item").indicator.unwrap("some").name, "file"));
        $(Assert.equal(item.unwrap().unwrap("Item").indicator.unwrap("some").prefix, "far"));
    });

    test("creates item with colored indicator", $ => {
        const item = $.let(TreeView.Item("index", "index.ts", { prefix: "fas", name: "file-code", color: "link" }));

        $(Assert.equal(item.unwrap().unwrap("Item").indicator.unwrap("some").name, "file-code"));
        $(Assert.equal(item.unwrap().unwrap("Item").indicator.unwrap("some").style.unwrap("some").color.unwrap("some"), "link"));
    });

    // =========================================================================
    // TreeView.Branch - Basic
    // =========================================================================

    test("creates branch with children", $ => {
        const branch = $.let(TreeView.Branch("src", "src", [
            TreeView.Item("file1", "index.ts"),
            TreeView.Item("file2", "utils.ts"),
        ]));

        $(Assert.equal(branch.unwrap().unwrap("Branch").value, "src"));
        $(Assert.equal(branch.unwrap().unwrap("Branch").label, "src"));
        $(Assert.equal(branch.unwrap().unwrap("Branch").indicator.hasTag("none"), true));
    });

    test("creates branch with indicator", $ => {
        const branch = $.let(TreeView.Branch("src", "src", [
            TreeView.Item("file1", "index.ts"),
        ], { prefix: "fas", name: "folder" }));

        $(Assert.equal(branch.unwrap().unwrap("Branch").indicator.hasTag("some"), true));
        $(Assert.equal(branch.unwrap().unwrap("Branch").indicator.unwrap("some").name, "folder"));
        $(Assert.equal(branch.unwrap().unwrap("Branch").indicator.unwrap("some").prefix, "fas"));
    });

    test("creates branch with colored indicator", $ => {
        const branch = $.let(TreeView.Branch("src", "src", [
            TreeView.Item("file1", "index.ts"),
        ], { prefix: "fas", name: "folder", color: "fg.warning" }));

        $(Assert.equal(branch.unwrap().unwrap("Branch").indicator.unwrap("some").style.unwrap("some").color.unwrap("some"), "fg.warning"));
    });

    test("creates disabled branch", $ => {
        const branch = $.let(TreeView.Branch("src", "src", [
            TreeView.Item("file1", "index.ts"),
        ], undefined, true));

        $(Assert.equal(branch.unwrap().unwrap("Branch").disabled.unwrap("some"), true));
    });

    // =========================================================================
    // TreeView.Branch - Nested
    // =========================================================================

    test("creates nested branches", $ => {
        const tree = $.let(TreeView.Branch("src", "src", [
            TreeView.Branch("components", "components", [
                TreeView.Item("button", "Button.tsx"),
            ]),
            TreeView.Item("index", "index.ts"),
        ]));

        $(Assert.equal(tree.unwrap().unwrap("Branch").value, "src"));
    });

    // =========================================================================
    // TreeView.Root - Basic
    // =========================================================================

    test("creates tree view with items", $ => {
        const tree = $.let(TreeView.Root([
            TreeView.Item("file1", "index.ts"),
            TreeView.Item("file2", "utils.ts"),
        ]));

        $(Assert.equal(tree.unwrap().unwrap("TreeView").label.hasTag("none"), true));
    });

    test("creates tree view with branches and items", $ => {
        const tree = $.let(TreeView.Root([
            TreeView.Branch("src", "src", [
                TreeView.Item("index", "index.ts"),
            ]),
            TreeView.Item("package", "package.json"),
        ]));

        $(Assert.equal(tree.unwrap().unwrap("TreeView").label.hasTag("none"), true));
    });

    test("creates tree view with label", $ => {
        const tree = $.let(TreeView.Root([
            TreeView.Item("file1", "index.ts"),
        ], {
            label: "Project Files",
        }));

        $(Assert.equal(tree.unwrap().unwrap("TreeView").label.unwrap("some"), "Project Files"));
    });

    // =========================================================================
    // TreeView.Root - Styling
    // =========================================================================

    test("creates tree view with subtle variant", $ => {
        const tree = $.let(TreeView.Root([
            TreeView.Item("file1", "index.ts"),
        ], {
            variant: "subtle",
        }));

        $(Assert.equal(tree.unwrap().unwrap("TreeView").style.unwrap("some").variant.unwrap("some").hasTag("subtle"), true));
    });

    test("creates tree view with solid variant", $ => {
        const tree = $.let(TreeView.Root([
            TreeView.Item("file1", "index.ts"),
        ], {
            variant: "solid",
        }));

        $(Assert.equal(tree.unwrap().unwrap("TreeView").style.unwrap("some").variant.unwrap("some").hasTag("solid"), true));
    });

    test("creates tree view with sm size", $ => {
        const tree = $.let(TreeView.Root([
            TreeView.Item("file1", "index.ts"),
        ], {
            size: "sm",
        }));

        $(Assert.equal(tree.unwrap().unwrap("TreeView").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates tree view with single selection mode", $ => {
        const tree = $.let(TreeView.Root([
            TreeView.Item("file1", "index.ts"),
        ], {
            selectionMode: "single",
        }));

        $(Assert.equal(tree.unwrap().unwrap("TreeView").selectionMode.unwrap("some").hasTag("single"), true));
    });

    test("creates tree view with multiple selection mode", $ => {
        const tree = $.let(TreeView.Root([
            TreeView.Item("file1", "index.ts"),
        ], {
            selectionMode: "multiple",
        }));

        $(Assert.equal(tree.unwrap().unwrap("TreeView").selectionMode.unwrap("some").hasTag("multiple"), true));
    });

    // =========================================================================
    // TreeView.Root - Colour escape hatches
    // =========================================================================

    test("creates tree view with colour escape hatches", $ => {
        const tree = $.let(TreeView.Root([
            TreeView.Item("file1", "index.ts"),
        ], {
            itemColor: "fg.default",
            itemHoverBackground: "bg.subtle",
            selectedBackground: "bg.brand.subtle",
            selectedColor: "link",
            caretColor: "fg.muted",
            connectorColor: "fg.muted",
        }));

        const style = tree.unwrap().unwrap("TreeView").style.unwrap("some");
        $(Assert.equal(style.itemColor.unwrap("some"), "fg.default"));
        $(Assert.equal(style.itemHoverBackground.unwrap("some"), "bg.subtle"));
        $(Assert.equal(style.selectedBackground.unwrap("some"), "bg.brand.subtle"));
        $(Assert.equal(style.selectedColor.unwrap("some"), "link"));
        $(Assert.equal(style.caretColor.unwrap("some"), "fg.muted"));
        $(Assert.equal(style.connectorColor.unwrap("some"), "fg.muted"));
    });

    // =========================================================================
    // TreeView.Root - Default Values
    // =========================================================================

    test("creates tree view with default expanded values", $ => {
        const tree = $.let(TreeView.Root([
            TreeView.Branch("src", "src", [
                TreeView.Item("file1", "index.ts"),
            ]),
        ], {
            defaultExpandedValue: ["src"],
        }));

        $(Assert.equal(tree.unwrap().unwrap("TreeView").defaultExpandedValue.hasTag("some"), true));
    });

    test("creates tree view with default selected values", $ => {
        const tree = $.let(TreeView.Root([
            TreeView.Item("file1", "index.ts"),
            TreeView.Item("file2", "utils.ts"),
        ], {
            defaultSelectedValue: ["file1"],
        }));

        $(Assert.equal(tree.unwrap().unwrap("TreeView").defaultSelectedValue.hasTag("some"), true));
    });

    // =========================================================================
    // TreeView - Complete File Explorer Example
    // =========================================================================

    test("creates complete file explorer with indicators", $ => {
        const tree = $.let(TreeView.Root([
            TreeView.Branch("src", "src", [
                TreeView.Branch("components", "components", [
                    TreeView.Item("button", "Button.tsx", { prefix: "fas", name: "file-code", color: "link" }),
                    TreeView.Item("input", "Input.tsx", { prefix: "fas", name: "file-code", color: "link" }),
                ], { prefix: "fas", name: "folder", color: "fg.warning" }),
                TreeView.Item("index", "index.ts", { prefix: "fas", name: "file-code", color: "link" }),
            ], { prefix: "fas", name: "folder", color: "fg.warning" }),
            TreeView.Item("package", "package.json", { prefix: "far", name: "file" }),
            TreeView.Item("readme", "README.md", { prefix: "far", name: "file" }),
        ], {
            label: "Project",
            variant: "subtle",
            size: "sm",
            defaultExpandedValue: ["src", "components"],
        }));

        $(Assert.equal(tree.unwrap().unwrap("TreeView").label.unwrap("some"), "Project"));
        $(Assert.equal(tree.unwrap().unwrap("TreeView").style.unwrap("some").variant.unwrap("some").hasTag("subtle"), true));
        $(Assert.equal(tree.unwrap().unwrap("TreeView").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });
}, {   platformFns: TestImpl,});
