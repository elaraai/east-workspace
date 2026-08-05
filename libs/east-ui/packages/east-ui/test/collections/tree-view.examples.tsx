/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, NullType, OptionType, StringType, StructType, example, none, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Badge, Configurator, HStack, Reactive, SegmentGroup, Select, Switch, Text, TreeView } from "@elaraai/east-ui";

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
    keywords: ["TreeView", "Root", "Branch", "Item", "icon", "prefix", "color", "organization", "hierarchy", "user", "icons", "size", "sm", "compact", "variant", "solid", "defaultExpandedValue", "settings", "colour", "override", "itemColor", "selectedBackground", "caretColor", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "Reactive", "State", "onSelectionChange", "selectionMode", "multiple", "onExpandedChange", "expand", "onFocusChange", "interactive"],
    description: "TreeView configurator — tree-preset, size, variant and colour axes plus a default-expanded switch driving one live tree; the aside logs selection, expand and focus events",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // A tree preset is its nodes PLUS the branch values the
                // expanded switch pre-opens, so the axis is a struct.
                const trees = $.const([
                    { label: "files",    nodes: TREE_VIEW_ICONS_DATA, expanded: ["src", "docs"] },
                    { label: "org",      nodes: TREE_VIEW_ORG_DATA,   expanded: ["ceo", "cto", "eng-lead"] },
                    { label: "docs",     nodes: TREE_VIEW_SMALL_DATA, expanded: ["docs", "support"] },
                    { label: "shopping", nodes: TREE_VIEW_SOLID_DATA, expanded: ["category1", "category2"] },
                ], ArrayType(StructType({ label: StringType, nodes: ArrayType(TreeView.Types.Node), expanded: ArrayType(StringType) })));

                // Enumerated axes are just their variants — `getTag()` gives the
                // segment key AND its label, so there is no parallel table to
                // keep in step.
                const sizes = $.const([
                    variant("xs", null), variant("sm", null), variant("md", null),
                ], ArrayType(TreeView.Types.Size));

                const variants = $.const([
                    variant("subtle", null), variant("solid", null),
                ], ArrayType(TreeView.Types.Variant));

                // Colour slots come as a set — the recipe row mirrors the slot
                // recipe's defaults, branded shows the escape hatches.
                const colors = $.const([
                    { label: "recipe",  item: "fg.default", hover: "bg.subtle",       selectedBg: "bg.brand.subtle", selected: "link", caret: "fg.muted", connector: "border.subtle" },
                    { label: "branded", item: "fg.default", hover: "bg.brand.subtle", selectedBg: "bg.brand.subtle", selected: "link", caret: "link",     connector: "fg.muted" },
                ], ArrayType(StructType({ label: StringType, item: StringType, hover: StringType, selectedBg: StringType, selected: StringType, caret: StringType, connector: StringType })));

                const treeBind     = $.let(State.bind([StringType], "treeview_tree", "files"));
                const sizeBind     = $.let(State.bind([StringType], "treeview_size", "md"));
                const variantBind  = $.let(State.bind([StringType], "treeview_variant", "subtle"));
                const colorBind    = $.let(State.bind([StringType], "treeview_color", "recipe"));
                const expandedBind = $.let(State.bind([BooleanType], "treeview_expanded", true));
                // The event log (folded from the old events panel — its State
                // keys are preserved): the live tree reports selection, expand
                // and focus into the aside.
                const eventSelectionBind = $.let(State.bind([ArrayType(StringType)], "tree_selected", []));
                const eventExpandBind    = $.let(State.bind([ArrayType(StringType)], "tree_expanded", []));
                const eventFocusBind     = $.let(State.bind([OptionType(StringType)], "tree_focus", none));

                const tKey = $.let(treeBind.read());
                const sKey = $.let(sizeBind.read());
                const vKey = $.let(variantBind.read());
                const cKey = $.let(colorBind.read());
                const expandedOn = $.let(expandedBind.read());
                const selectedLog = $.let(eventSelectionBind.read());
                const expandedLog = $.let(eventExpandBind.read());
                const focusedLog  = $.let(eventFocusBind.read());

                const onTree     = $.const(East.function([StringType], NullType, ($, next) => { $(treeBind.write(next)); }));
                const onSize     = $.const(East.function([StringType], NullType, ($, next) => { $(sizeBind.write(next)); }));
                const onVariant  = $.const(East.function([StringType], NullType, ($, next) => { $(variantBind.write(next)); }));
                const onColor    = $.const(East.function([StringType], NullType, ($, next) => { $(colorBind.write(next)); }));
                const onExpanded = $.const(East.function([BooleanType], NullType, ($, next) => { $(expandedBind.write(next)); }));
                const onSelectionChange = $.const(East.function([ArrayType(StringType)], NullType, ($, next) => { $(eventSelectionBind.write(next)); }));
                const onExpandedChange  = $.const(East.function([ArrayType(StringType)], NullType, ($, next) => { $(eventExpandBind.write(next)); }));
                const onFocusChange     = $.const(East.function([OptionType(StringType)], NullType, ($, next) => { $(eventFocusBind.write(next)); }));

                // Each selection is a lookup into the same array the control renders.
                const tree = $.let(trees.filter((_$, o) => o.label.equal(tKey)).get(0n));
                const size = $.let(sizes.filter((_$, v) => v.getTag().equal(sKey)).get(0n));
                const treeVariant = $.let(variants.filter((_$, v) => v.getTag().equal(vKey)).get(0n));
                const color = $.let(colors.filter((_$, o) => o.label.equal(cKey)).get(0n));

                const collapsed = $.const([], ArrayType(StringType));
                const expanded = $.let(expandedOn.ifElse(_$ => tree.expanded, _$ => collapsed));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Tree", tKey,
                                <Select value={tKey} onChange={onTree} size="sm"
                                    items={trees.map((_$, o) => Select.Item(o.label, o.label))} />),
                            Configurator.Control("Size", sKey,
                                <SegmentGroup value={sKey} onChange={onSize} size="sm"
                                    items={sizes.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Variant", vKey,
                                <SegmentGroup value={vKey} onChange={onVariant} size="sm"
                                    items={variants.map((_$, v) => SegmentGroup.Item(v.getTag(), <Text>{v.getTag().upperCase()}</Text>))} />),
                            Configurator.Control("Colour", cKey,
                                <SegmentGroup value={cKey} onChange={onColor} size="sm"
                                    items={colors.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            // A Slot, not a Control: the switch reports as the
                            // Expanded spec row below rather than as one value.
                            Configurator.Slot("State",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={expandedOn} label="Default expanded" onChange={onExpanded} />
                                </HStack>),
                        ]}
                        preview={
                            <TreeView
                                variant={treeVariant}
                                size={size}
                                itemColor={color.item}
                                itemHoverBackground={color.hover}
                                selectedBackground={color.selectedBg}
                                selectedColor={color.selected}
                                caretColor={color.caret}
                                connectorColor={color.connector}
                                defaultExpandedValue={expanded}
                                selectionMode="multiple"
                                onSelectionChange={onSelectionChange}
                                onExpandedChange={onExpandedChange}
                                onFocusChange={onFocusChange}
                                nodes={tree.nodes}
                            />
                        }
                        aside={{
                            label: "Events · Reactive",
                            body: (
                                <HStack gap="3" align="center">
                                    <Badge colorPalette="brand" variant="solid">{East.str`Selected: ${selectedLog.size()}`}</Badge>
                                    <Badge colorPalette="success" variant="solid">{East.str`Expanded: ${expandedLog.size()}`}</Badge>
                                    <Text>{East.str`Focused: ${focusedLog.match({ none: _$ => "(none)", some: ($, v) => v })}`}</Text>
                                </HStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Roots", East.print(tree.nodes.size())),
                            Configurator.Spec("Expanded", expandedOn.ifElse(_$ => East.print(tree.expanded.size()), _$ => "collapsed")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
