/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, NullType, OptionType, StringType, example, none } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Badge, Reactive, Separator, Text, TreeView, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const TREE_VIEW_ICONS_DATA = [
    TreeView.Branch("src", "src", [
        TreeView.Item("index", "index.ts", { prefix: "fas", name: "file-code", color: "link" }),
        TreeView.Item("utils", "utils.ts", { prefix: "fas", name: "file-code", color: "link" }),
    ], { prefix: "fas", name: "folder", color: "fg.warning" }),
    TreeView.Branch("docs", "docs", [
        TreeView.Item("readme", "README.md", { prefix: "far", name: "file" }),
    ], { prefix: "fas", name: "folder", color: "fg.warning" }),
    TreeView.Item("package", "package.json", { prefix: "far", name: "file" }),
];
const TREE_VIEW_ORG_DATA = [
    TreeView.Branch("ceo", "CEO", [
        TreeView.Branch("cto", "CTO", [
            TreeView.Branch("eng-lead", "Engineering Lead", [
                TreeView.Item("dev1", "Senior Developer", { prefix: "fas", name: "user", color: "link" }),
                TreeView.Item("dev2", "Junior Developer", { prefix: "fas", name: "user", color: "link" }),
            ], { prefix: "fas", name: "users", color: "accent.purple" }),
            TreeView.Item("qa-lead", "QA Lead", { prefix: "fas", name: "user-check", color: "fg.success" }),
        ], { prefix: "fas", name: "user-tie", color: "brand.600" }),
        TreeView.Branch("cfo", "CFO", [
            TreeView.Item("finance", "Finance Manager", { prefix: "fas", name: "user", color: "fg.success" }),
        ], { prefix: "fas", name: "user-tie", color: "brand.600" }),
        TreeView.Branch("cmo", "CMO", [
            TreeView.Item("marketing", "Marketing Lead", { prefix: "fas", name: "user", color: "accent.pink" }),
        ], { prefix: "fas", name: "user-tie", color: "brand.600" }),
    ], { prefix: "fas", name: "crown", color: "fg.warning" }),
];
const TREE_VIEW_SMALL_DATA = [
    TreeView.Branch("docs", "Documentation", [
        TreeView.Item("docs-api", "API Reference", { prefix: "fas", name: "code" }),
        TreeView.Item("docs-guide", "User Guide", { prefix: "fas", name: "book-open" }),
        TreeView.Item("docs-faq", "FAQ", { prefix: "fas", name: "circle-question" }),
    ], { prefix: "fas", name: "book", color: "link" }),
    TreeView.Branch("support", "Support", [
        TreeView.Item("support-tickets", "Tickets", { prefix: "fas", name: "ticket" }),
        TreeView.Item("support-chat", "Live Chat", { prefix: "fas", name: "comments" }),
    ], { prefix: "fas", name: "headset", color: "fg.success" }),
];
const TREE_VIEW_SOLID_DATA = [
    TreeView.Branch("category1", "Electronics", [
        TreeView.Item("cat1-phones", "Phones", { prefix: "fas", name: "mobile-screen" }),
        TreeView.Item("cat1-laptops", "Laptops", { prefix: "fas", name: "laptop" }),
        TreeView.Item("cat1-tablets", "Tablets", { prefix: "fas", name: "tablet-screen-button" }),
    ], { prefix: "fas", name: "microchip", color: "link" }),
    TreeView.Branch("category2", "Clothing", [
        TreeView.Item("cat2-mens", "Men's", { prefix: "fas", name: "person" }),
        TreeView.Item("cat2-womens", "Women's", { prefix: "fas", name: "person-dress" }),
    ], { prefix: "fas", name: "shirt", color: "accent.purple" }),
];
const TREE_VIEW_EXPANDED_DATA = [
    TreeView.Branch("settings", "Settings", [
        TreeView.Branch("settings-general", "General", [
            TreeView.Item("settings-general-profile", "Profile", { prefix: "fas", name: "id-card" }),
            TreeView.Item("settings-general-prefs", "Preferences", { prefix: "fas", name: "sliders" }),
        ], { prefix: "fas", name: "gear" }),
        TreeView.Branch("settings-security", "Security", [
            TreeView.Item("settings-security-password", "Password", { prefix: "fas", name: "key" }),
            TreeView.Item("settings-security-2fa", "Two-Factor Auth", { prefix: "fas", name: "shield-halved" }),
        ], { prefix: "fas", name: "lock", color: "fg.danger" }),
    ], { prefix: "fas", name: "cog", color: "fg.muted" }),
];
const TREE_VIEW_COLOUR_OVERRIDES_DATA = [
    TreeView.Branch("src", "src", [
        TreeView.Item("index", "index.ts"),
        TreeView.Item("utils", "utils.ts"),
    ]),
    TreeView.Item("package", "package.json"),
];
const TREE_VIEW_INTERACTIVE_SELECTION_DATA = [
    TreeView.Branch("fruits", "Fruits", [
        TreeView.Item("apple", "Apple"),
        TreeView.Item("banana", "Banana"),
        TreeView.Item("cherry", "Cherry"),
    ]),
    TreeView.Branch("vegetables", "Vegetables", [
        TreeView.Item("carrot", "Carrot"),
        TreeView.Item("broccoli", "Broccoli"),
    ]),
];
const TREE_VIEW_INTERACTIVE_EXPAND_DATA = [
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
];
const TREE_VIEW_ON_FOCUS_CHANGE_DATA = [
    TreeView.Branch("group", "Group", [
        TreeView.Item("a", "Item A"),
        TreeView.Item("b", "Item B"),
        TreeView.Item("c", "Item C"),
    ]),
];

export const treeViewBasic = example({
    keywords: ["TreeView", "Root", "Branch", "Item", "file", "tree", "basic"],
    description: "Basic hierarchical file structure",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <TreeView nodes={[
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
            ]} />
        );
    }),
    inputs: [],
});

export const treeViewVariants = example({
    keywords: ["TreeView", "Root", "Branch", "Item", "icon", "prefix", "color", "organization", "hierarchy", "user", "icons", "size", "sm", "compact", "variant", "solid", "defaultExpandedValue", "settings", "colour", "override", "itemColor", "selectedBackground", "caretColor"],
    description: "TreeView variant panel — view icons (tree nodes with indicator icons), view org (company hierarchy with user icons), view small (compact tree with documentation icons), view solid (shopping categories with icons), view expanded (settings tree with pre-expanded nodes), view colour overrides (item / hover / selection / caret / connector colour overrides for brand alignment)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="VIEW ICONS" align="start" />
                <TreeView nodes={TREE_VIEW_ICONS_DATA} />
                <Separator label="VIEW ORG" align="start" />
                <TreeView nodes={TREE_VIEW_ORG_DATA} />
                <Separator label="VIEW SMALL" align="start" />
                <TreeView size="sm" nodes={TREE_VIEW_SMALL_DATA} />
                <Separator label="VIEW SOLID" align="start" />
                <TreeView variant="solid" nodes={TREE_VIEW_SOLID_DATA} />
                <Separator label="VIEW EXPANDED" align="start" />
                <TreeView defaultExpandedValue={["settings", "settings-general"]} nodes={TREE_VIEW_EXPANDED_DATA} />
                <Separator label="VIEW COLOUR OVERRIDES" align="start" />
                <TreeView
                    variant="subtle"
                    size="sm"
                    itemColor="fg.default"
                    itemHoverBackground="bg.brand.subtle"
                    selectedBackground="bg.brand.subtle"
                    selectedColor="link"
                    caretColor="link"
                    connectorColor="fg.muted"
                    defaultExpandedValue={["src"]}
                    nodes={TREE_VIEW_COLOUR_OVERRIDES_DATA}
                />
            </VStack>
        );
    }),
    inputs: [],
});

export const treeViewEvents = example({
    keywords: ["TreeView", "Reactive", "State", "onSelectionChange", "selectionMode", "multiple", "onExpandedChange", "expand", "onFocusChange", "interactive"],
    description: "TreeView event panel — view interactive selection (click items to see the onSelectionChange callback), view interactive expand (expand/collapse to see the onExpandedChange callback), view on focus change (onFocusChange records the currently focused id)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="VIEW INTERACTIVE SELECTION" align="start" />
                <Reactive>{$ => {
                    const selectedBind = $.let(State.bind([ArrayType(StringType)], "tree_selected", []));
                    const selected = $.let(selectedBind.read());
                    const onSelectionChange = $.const(East.function([ArrayType(StringType)], NullType, ($, newSelection) => {
                        $(selectedBind.write(newSelection));
                    }));
                    return (
                        <VStack gap="3" align="stretch">
                            <TreeView
                                selectionMode="multiple"
                                defaultExpandedValue={["fruits", "vegetables"]}
                                onSelectionChange={onSelectionChange}
                                nodes={TREE_VIEW_INTERACTIVE_SELECTION_DATA}
                            />
                            <Badge colorPalette="brand" variant="solid">{East.str`Selected: ${selected.size()}`}</Badge>
                            <Text>{East.str`Items selected: ${selected.size()}`}</Text>
                        </VStack>
                    );
                }}</Reactive>
                <Separator label="VIEW INTERACTIVE EXPAND" align="start" />
                <Reactive>{$ => {
                    const expandedBind = $.let(State.bind([ArrayType(StringType)], "tree_expanded", []));
                    const expanded = $.let(expandedBind.read());
                    const onExpandedChange = $.const(East.function([ArrayType(StringType)], NullType, ($, newExpanded) => {
                        $(expandedBind.write(newExpanded));
                    }));
                    return (
                        <VStack gap="3" align="stretch">
                            <TreeView onExpandedChange={onExpandedChange} nodes={TREE_VIEW_INTERACTIVE_EXPAND_DATA} />
                            <Badge colorPalette="success" variant="solid">{East.str`Expanded: ${expanded.size()}`}</Badge>
                            <Text>{East.str`Nodes expanded: ${expanded.size()}`}</Text>
                        </VStack>
                    );
                }}</Reactive>
                <Separator label="VIEW ON FOCUS CHANGE" align="start" />
                <Reactive>{$ => {
                    const focusBind = $.let(State.bind([OptionType(StringType)], "tree_focus", none));
                    const focused = $.let(focusBind.read());
                    const onFocusChange = $.const(East.function([OptionType(StringType)], NullType, ($, val) => {
                        $(focusBind.write(val));
                    }));
                    return (
                        <VStack gap="3" align="stretch">
                            <TreeView onFocusChange={onFocusChange} nodes={TREE_VIEW_ON_FOCUS_CHANGE_DATA} />
                            <Text>{East.str`Focused: ${focused.match({ none: _$ => "(none)", some: ($, v) => v })}`}</Text>
                        </VStack>
                    );
                }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});
