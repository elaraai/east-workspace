/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, ArrayType, NullType, OptionType, StringType, example, none } from "@elaraai/east";
import { Badge, Reactive, Stack, State, Text, TreeView, UIComponentType } from "@elaraai/east-ui";

export const treeViewFile = example({
    keywords: ["TreeView", "Root", "Branch", "Item", "file", "tree"],
    description: "Basic hierarchical file structure",
    fn: East.function([], UIComponentType, (_$) => {
        return TreeView.Root([
            TreeView.Branch("src", "src", [
                TreeView.Branch("src-components", "components", [
                    TreeView.Item("src-components-button", "Button.tsx"),
                    TreeView.Item("src-components-input", "Input.tsx"),
                ]),
                TreeView.Branch("src-pages", "pages", [
                    TreeView.Item("src-pages-home", "Home.tsx"),
                    TreeView.Item("src-pages-about", "About.tsx"),
                ]),
                TreeView.Item("src-index", "index.ts"),
            ]),
            TreeView.Branch("public", "public", [
                TreeView.Item("public-favicon", "favicon.ico"),
            ]),
            TreeView.Item("package-json", "package.json"),
        ]);
    }),
    inputs: [],
});

export const treeViewIcons = example({
    keywords: ["TreeView", "Root", "Branch", "Item", "icon", "prefix", "color"],
    description: "Tree nodes with indicator icons",
    fn: East.function([], UIComponentType, (_$) => {
        return TreeView.Root([
            TreeView.Branch("src", "src", [
                TreeView.Item("index", "index.ts", { prefix: "fas", name: "file-code", color: "blue.500" }),
                TreeView.Item("utils", "utils.ts", { prefix: "fas", name: "file-code", color: "blue.500" }),
            ], { prefix: "fas", name: "folder", color: "yellow.500" }),
            TreeView.Branch("docs", "docs", [
                TreeView.Item("readme", "README.md", { prefix: "far", name: "file" }),
            ], { prefix: "fas", name: "folder", color: "yellow.500" }),
            TreeView.Item("package", "package.json", { prefix: "far", name: "file" }),
        ]);
    }),
    inputs: [],
});

export const treeViewOrg = example({
    keywords: ["TreeView", "organization", "hierarchy", "user", "icons"],
    description: "Company hierarchy with user icons",
    fn: East.function([], UIComponentType, (_$) => {
        return TreeView.Root([
            TreeView.Branch("ceo", "CEO", [
                TreeView.Branch("cto", "CTO", [
                    TreeView.Branch("eng-lead", "Engineering Lead", [
                        TreeView.Item("dev1", "Senior Developer", { prefix: "fas", name: "user", color: "blue.500" }),
                        TreeView.Item("dev2", "Junior Developer", { prefix: "fas", name: "user", color: "blue.400" }),
                    ], { prefix: "fas", name: "users", color: "purple.500" }),
                    TreeView.Item("qa-lead", "QA Lead", { prefix: "fas", name: "user-check", color: "green.500" }),
                ], { prefix: "fas", name: "user-tie", color: "teal.500" }),
                TreeView.Branch("cfo", "CFO", [
                    TreeView.Item("finance", "Finance Manager", { prefix: "fas", name: "user", color: "green.500" }),
                ], { prefix: "fas", name: "user-tie", color: "teal.500" }),
                TreeView.Branch("cmo", "CMO", [
                    TreeView.Item("marketing", "Marketing Lead", { prefix: "fas", name: "user", color: "pink.500" }),
                ], { prefix: "fas", name: "user-tie", color: "teal.500" }),
            ], { prefix: "fas", name: "crown", color: "yellow.500" }),
        ]);
    }),
    inputs: [],
});

export const treeViewSmall = example({
    keywords: ["TreeView", "size", "sm", "compact"],
    description: "Compact tree with documentation icons",
    fn: East.function([], UIComponentType, (_$) => {
        return TreeView.Root([
            TreeView.Branch("docs", "Documentation", [
                TreeView.Item("docs-api", "API Reference", { prefix: "fas", name: "code" }),
                TreeView.Item("docs-guide", "User Guide", { prefix: "fas", name: "book-open" }),
                TreeView.Item("docs-faq", "FAQ", { prefix: "fas", name: "circle-question" }),
            ], { prefix: "fas", name: "book", color: "blue.500" }),
            TreeView.Branch("support", "Support", [
                TreeView.Item("support-tickets", "Tickets", { prefix: "fas", name: "ticket" }),
                TreeView.Item("support-chat", "Live Chat", { prefix: "fas", name: "comments" }),
            ], { prefix: "fas", name: "headset", color: "green.500" }),
        ], { size: "sm" });
    }),
    inputs: [],
});

export const treeViewSolid = example({
    keywords: ["TreeView", "variant", "solid"],
    description: "Shopping categories with icons",
    fn: East.function([], UIComponentType, (_$) => {
        return TreeView.Root([
            TreeView.Branch("category1", "Electronics", [
                TreeView.Item("cat1-phones", "Phones", { prefix: "fas", name: "mobile-screen" }),
                TreeView.Item("cat1-laptops", "Laptops", { prefix: "fas", name: "laptop" }),
                TreeView.Item("cat1-tablets", "Tablets", { prefix: "fas", name: "tablet-screen-button" }),
            ], { prefix: "fas", name: "microchip", color: "blue.500" }),
            TreeView.Branch("category2", "Clothing", [
                TreeView.Item("cat2-mens", "Men's", { prefix: "fas", name: "person" }),
                TreeView.Item("cat2-womens", "Women's", { prefix: "fas", name: "person-dress" }),
            ], { prefix: "fas", name: "shirt", color: "purple.500" }),
        ], { variant: "solid" });
    }),
    inputs: [],
});

export const treeViewExpanded = example({
    keywords: ["TreeView", "defaultExpandedValue", "settings"],
    description: "Settings tree with pre-expanded nodes",
    fn: East.function([], UIComponentType, (_$) => {
        return TreeView.Root([
            TreeView.Branch("settings", "Settings", [
                TreeView.Branch("settings-general", "General", [
                    TreeView.Item("settings-general-profile", "Profile", { prefix: "fas", name: "id-card" }),
                    TreeView.Item("settings-general-prefs", "Preferences", { prefix: "fas", name: "sliders" }),
                ], { prefix: "fas", name: "gear" }),
                TreeView.Branch("settings-security", "Security", [
                    TreeView.Item("settings-security-password", "Password", { prefix: "fas", name: "key" }),
                    TreeView.Item("settings-security-2fa", "Two-Factor Auth", { prefix: "fas", name: "shield-halved" }),
                ], { prefix: "fas", name: "lock", color: "red.500" }),
            ], { prefix: "fas", name: "cog", color: "gray.600" }),
        ], { defaultExpandedValue: ["settings", "settings-general"] });
    }),
    inputs: [],
});

export const treeViewInteractiveSelection = example({
    keywords: ["TreeView", "Reactive", "State", "onSelectionChange", "selectionMode", "multiple"],
    description: "Click items to see onSelectionChange callback",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const selectedBind = $.let(State.bind([ArrayType(StringType)], "tree_selected", []));
            const selected = $.let(selectedBind.read());

            const onSelectionChange = $.const(East.function(
                [ArrayType(StringType)],
                NullType,
                ($, newSelection) => {
                    $(selectedBind.write(newSelection));
                }
            ));

            return Stack.VStack([
                TreeView.Root([
                    TreeView.Branch("fruits", "Fruits", [
                        TreeView.Item("apple", "Apple"),
                        TreeView.Item("banana", "Banana"),
                        TreeView.Item("cherry", "Cherry"),
                    ]),
                    TreeView.Branch("vegetables", "Vegetables", [
                        TreeView.Item("carrot", "Carrot"),
                        TreeView.Item("broccoli", "Broccoli"),
                    ]),
                ], {
                    selectionMode: "multiple",
                    defaultExpandedValue: ["fruits", "vegetables"],
                    onSelectionChange,
                }),
                Badge.Root(
                    East.str`Selected: ${selected.size()}`,
                    { colorPalette: "blue", variant: "solid" }
                ),
                Text.Root(East.str`Items selected: ${selected.size()}`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const treeViewInteractiveExpand = example({
    keywords: ["TreeView", "Reactive", "State", "onExpandedChange", "expand"],
    description: "Expand/collapse to see onExpandedChange callback",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const expandedBind = $.let(State.bind([ArrayType(StringType)], "tree_expanded", []));
            const expanded = $.let(expandedBind.read());

            const onExpandedChange = $.const(East.function(
                [ArrayType(StringType)],
                NullType,
                ($, newExpanded) => {
                    $(expandedBind.write(newExpanded));
                }
            ));

            return Stack.VStack([
                TreeView.Root([
                    TreeView.Branch("level1", "Level 1", [
                        TreeView.Branch("level1a", "Level 1.A", [
                            TreeView.Item("item1", "Item 1"),
                            TreeView.Item("item2", "Item 2"),
                        ]),
                        TreeView.Branch("level1b", "Level 1.B", [
                            TreeView.Item("item3", "Item 3"),
                        ]),
                    ]),
                    TreeView.Branch("level2", "Level 2", [
                        TreeView.Item("item4", "Item 4"),
                    ]),
                ], { onExpandedChange }),
                Badge.Root(
                    East.str`Expanded: ${expanded.size()}`,
                    { colorPalette: "green", variant: "solid" }
                ),
                Text.Root(East.str`Nodes expanded: ${expanded.size()}`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const treeViewOnFocusChange = example({
    keywords: ["TreeView", "Reactive", "State", "onFocusChange", "interactive"],
    description: "TreeView whose onFocusChange records the currently focused id",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const focusBind = $.let(State.bind([OptionType(StringType)], "tree_focus", none));
            const focused = $.let(focusBind.read());
            const onFocusChange = $.const(East.function([OptionType(StringType)], NullType, ($, val) => {
                $(focusBind.write(val));
            }));
            return Stack.VStack([
                TreeView.Root([
                    TreeView.Branch("group", "Group", [
                        TreeView.Item("a", "Item A"),
                        TreeView.Item("b", "Item B"),
                        TreeView.Item("c", "Item C"),
                    ]),
                ], { onFocusChange }),
                Text.Root(East.str`Focused: ${focused.match({
                    none: _$ => "(none)",
                    some: ($, v) => v,
                })}`),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});

export const treeViewColourOverrides = example({
    keywords: ["TreeView", "colour", "override", "itemColor", "selectedBackground", "caretColor"],
    description: "Colour escape hatches — item / hover / selection / caret / connector colour overrides for brand alignment",
    fn: East.function([], UIComponentType, (_$) => {
        return TreeView.Root([
            TreeView.Branch("src", "src", [
                TreeView.Item("index", "index.ts"),
                TreeView.Item("utils", "utils.ts"),
            ]),
            TreeView.Item("package", "package.json"),
        ], {
            variant: "subtle",
            size: "sm",
            itemColor: "gray.800",
            itemHoverBackground: "blue.50",
            selectedBackground: "blue.100",
            selectedColor: "blue.900",
            caretColor: "blue.500",
            connectorColor: "gray.300",
            defaultExpandedValue: ["src"],
        });
    }),
    inputs: [],
});
