/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, NullType, StringType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { NavList, VStack, Text, Reactive } from "@elaraai/east-ui/jsx";

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

export const navListGrouped = example({
    keywords: ["NavList", "section", "label", "grouped"],
    description: "Grouped sections — Account / Workspace / Help",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <NavList sections={[
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
            ]} />
        );
    }),
    inputs: [],
});

export const navListWithIcons = example({
    keywords: ["NavList", "icon", "FontAwesome"],
    description: "Items with leading icons",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <NavList sections={[
                {
                    items: [
                        { key: "dashboard", label: "Dashboard", icon: { prefix: "fas", name: "gauge" }, active: true },
                        { key: "orders", label: "Orders", icon: { prefix: "fas", name: "list" }, badge: "12" },
                        { key: "settings", label: "Settings", icon: { prefix: "fas", name: "gear" } },
                    ],
                },
            ]} />
        );
    }),
    inputs: [],
});

export const navListReactive = example({
    keywords: ["NavList", "Reactive", "State", "onSelect", "interactive"],
    description: "Reactive nav list — clicking an item updates State and re-renders the active highlight + selected-key display",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const activeBind = $.let(State.bind([StringType], "navlist.example.active", "profile"));
            const active = $.let(activeBind.read(), StringType);
            const onSelect = $.const(East.function([StringType], NullType, ($, key) => {
                $(activeBind.write(key));
            }));
            return (
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
            );
        }}</Reactive>
    )),
    inputs: [],
});
