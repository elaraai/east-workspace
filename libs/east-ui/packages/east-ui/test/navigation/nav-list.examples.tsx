/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, NavList, SegmentGroup, Switch, VStack, Text, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Section-input fixtures — the NavList factory takes TS input arrays (it
// builds the IR itself), so the icon flip is a fixture pick, not a data map.
// ============================================================================

const NAV_LIST_FLAT_SECTIONS = [
    {
        items: [
            { key: "dashboard", label: "Dashboard", active: true },
            { key: "orders", label: "Orders", badge: "12" },
            { key: "settings", label: "Settings" },
        ],
    },
];
const NAV_LIST_FLAT_ICON_SECTIONS = [
    {
        items: [
            { key: "dashboard", label: "Dashboard", icon: { prefix: "fas", name: "gauge" }, active: true },
            { key: "orders", label: "Orders", icon: { prefix: "fas", name: "list" }, badge: "12" },
            { key: "settings", label: "Settings", icon: { prefix: "fas", name: "gear" } },
        ],
    },
];
const NAV_LIST_GROUPED_SECTIONS = [
    {
        label: "Account",
        items: [
            { key: "profile", label: "Profile", active: true },
            { key: "security", label: "Security" },
            { key: "billing", label: "Billing" },
        ],
    },
    {
        label: "Workspace",
        items: [
            { key: "members", label: "Members", badge: "3" },
            { key: "integrations", label: "Integrations" },
        ],
    },
    {
        label: "Help",
        items: [
            { key: "docs", label: "Documentation" },
            { key: "contact", label: "Contact support" },
        ],
    },
];
const NAV_LIST_GROUPED_ICON_SECTIONS = [
    {
        label: "Account",
        items: [
            { key: "profile", label: "Profile", icon: { prefix: "fas", name: "user" }, active: true },
            { key: "security", label: "Security", icon: { prefix: "fas", name: "shield-halved" } },
            { key: "billing", label: "Billing", icon: { prefix: "fas", name: "credit-card" } },
        ],
    },
    {
        label: "Workspace",
        items: [
            { key: "members", label: "Members", icon: { prefix: "fas", name: "users" }, badge: "3" },
            { key: "integrations", label: "Integrations", icon: { prefix: "fas", name: "plug" } },
        ],
    },
    {
        label: "Help",
        items: [
            { key: "docs", label: "Documentation", icon: { prefix: "fas", name: "book" } },
            { key: "contact", label: "Contact support", icon: { prefix: "fas", name: "headset" } },
        ],
    },
];

export const navListBasic = example({
    keywords: ["NavList", "Root", "navigation", "section"],
    description: "Basic single-section nav list — three items, no active item",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <NavList sections={[
                {
                    items: [
                        { key: "home", label: "Home" },
                        { key: "scenarios", label: "Scenarios" },
                        { key: "audit", label: "Audit trail" },
                    ],
                },
            ]} />
        );
    }),
    inputs: [],
});

// ============================================================================
// NavList — live configurator over the structure + surface axes
// ============================================================================

export const navListVariants = example({
    keywords: ["NavList", "section", "label", "grouped", "icon", "FontAwesome", "surface", "shell", "background", "app-shell", "sidebar", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator", "Reactive", "State", "onSelect", "interactive"],
    description: "NavList configurator — a structure-preset axis plus icons and shell-surface switches driving one live nav list; the aside routes onSelect through State and reads it back",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // The NavList factory takes TS section-input arrays, so each
                // structure preset carries its four pre-built lists — plain /
                // icons × card / shell — and the switches pick among them (the
                // chip-rail labeled-mode precedent).
                const structures = $.const([
                    {
                        label: "flat", sections: 1n,
                        plain: <NavList sections={NAV_LIST_FLAT_SECTIONS} />,
                        icons: <NavList sections={NAV_LIST_FLAT_ICON_SECTIONS} />,
                        shellPlain: <NavList surface="shell" background="bg.subtle" sections={NAV_LIST_FLAT_SECTIONS} />,
                        shellIcons: <NavList surface="shell" background="bg.subtle" sections={NAV_LIST_FLAT_ICON_SECTIONS} />,
                    },
                    {
                        label: "grouped", sections: 3n,
                        plain: <NavList sections={NAV_LIST_GROUPED_SECTIONS} />,
                        icons: <NavList sections={NAV_LIST_GROUPED_ICON_SECTIONS} />,
                        shellPlain: <NavList surface="shell" background="bg.subtle" sections={NAV_LIST_GROUPED_SECTIONS} />,
                        shellIcons: <NavList surface="shell" background="bg.subtle" sections={NAV_LIST_GROUPED_ICON_SECTIONS} />,
                    },
                ], ArrayType(StructType({ label: StringType, sections: IntegerType, plain: UIComponentType, icons: UIComponentType, shellPlain: UIComponentType, shellIcons: UIComponentType })));

                const structureBind = $.let(State.bind([StringType], "navlist_structure", "grouped"));
                const iconsBind     = $.let(State.bind([BooleanType], "navlist_icons", false));
                const shellBind     = $.let(State.bind([BooleanType], "navlist_shell", false));
                // The aside is the reactive row — clicking an item writes its
                // key to State, which re-renders the active highlight and the
                // readout (the old reactive example's key).
                const activeBind    = $.let(State.bind([StringType], "navlist.example.active", "profile"));

                const sKey    = $.let(structureBind.read());
                const iconsOn = $.let(iconsBind.read());
                const shell   = $.let(shellBind.read());
                const active  = $.let(activeBind.read(), StringType);

                const onStructure = $.const(East.function([StringType], NullType, ($, next) => { $(structureBind.write(next)); }));
                const onIcons     = $.const(East.function([BooleanType], NullType, ($, next) => { $(iconsBind.write(next)); }));
                const onShell     = $.const(East.function([BooleanType], NullType, ($, next) => { $(shellBind.write(next)); }));
                const onSelect    = $.const(East.function([StringType], NullType, ($, key) => { $(activeBind.write(key)); }));

                // Each selection is a lookup into the same array the control renders.
                const structure = $.let(structures.filter((_$, o) => o.label.equal(sKey)).get(0n));
                const list = $.let(shell.ifElse(
                    _$ => iconsOn.ifElse(_$ => structure.shellIcons, _$ => structure.shellPlain),
                    _$ => iconsOn.ifElse(_$ => structure.icons, _$ => structure.plain),
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Structure", sKey,
                                <SegmentGroup value={sKey} onChange={onStructure} size="sm"
                                    items={structures.map((_$, o) => SegmentGroup.Item(o.label, <Text>{o.label.upperCase()}</Text>))} />),
                            // A Slot, not a Control: the two switches report as the
                            // Icons / Surface spec rows below rather than as one
                            // value.
                            Configurator.Slot("Treatment",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={iconsOn} label="Icons" onChange={onIcons} />
                                    <Switch checked={shell} label="Shell surface" onChange={onShell} />
                                </HStack>),
                        ]}
                        preview={list}
                        aside={{
                            label: "Selection · Reactive",
                            body: (
                                <VStack gap="3" align="flex-start">
                                    <NavList
                                        sections={[
                                            {
                                                label: "Settings",
                                                items: [
                                                    { key: "profile", label: "Profile", active: active.equals("profile") },
                                                    { key: "security", label: "Security", active: active.equals("security") },
                                                    { key: "billing", label: "Billing", active: active.equals("billing"), badge: "Trial" },
                                                ],
                                            },
                                        ]}
                                        onSelect={onSelect}
                                    />
                                    <Text textStyle="body-sm" color="fg.muted">{East.str`Selected: ${active}`}</Text>
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Sections", East.print(structure.sections)),
                            Configurator.Spec("Icons", iconsOn.ifElse(_$ => "leading", _$ => "none")),
                            Configurator.Spec("Surface", shell.ifElse(_$ => "shell · bg.subtle", _$ => "card")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
