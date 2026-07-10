/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { NavList } from "@elaraai/east-ui/internal";
import { East, NullType, StringType } from "@elaraai/east";
import * as ex from "./nav-list.examples.js";

describeEast("NavList", (test) => {
    Assert.examples(test, {
        navListBasic: ex.navListBasic,
        navListGrouped: ex.navListGrouped,
        navListWithIcons: ex.navListWithIcons,
        navListShellSurface: ex.navListShellSurface,
        navListReactive: ex.navListReactive,
    });

    test("sections array round-trips", $ => {
        const r = $.let(NavList.Root([
            { items: [{ key: "a", label: "Alpha" }] },
            { items: [{ key: "b", label: "Beta" }] },
        ]));
        const sections = $.let(r.unwrap().unwrap("NavList").sections);
        $(Assert.equal(sections.size(), 2n));
        $(Assert.equal(sections.get(0n).items.size(), 1n));
        $(Assert.equal(sections.get(0n).items.get(0n).key, "a"));
        $(Assert.equal(sections.get(0n).items.get(0n).label, "Alpha"));
    });

    test("section label round-trips", $ => {
        const r = $.let(NavList.Root([
            { label: "Account", items: [{ key: "x", label: "X" }] },
        ]));
        $(Assert.equal(r.unwrap().unwrap("NavList").sections.get(0n).label.unwrap("some"), "Account"));
    });

    test("item active flag round-trips", $ => {
        const r = $.let(NavList.Root([
            { items: [{ key: "x", label: "X", active: true }] },
        ]));
        $(Assert.equal(
            r.unwrap().unwrap("NavList").sections.get(0n).items.get(0n).active.unwrap("some"),
            true,
        ));
    });

    test("item badge round-trips", $ => {
        const r = $.let(NavList.Root([
            { items: [{ key: "x", label: "X", badge: "12" }] },
        ]));
        $(Assert.equal(
            r.unwrap().unwrap("NavList").sections.get(0n).items.get(0n).badge.unwrap("some"),
            "12",
        ));
    });

    test("item icon round-trips", $ => {
        const r = $.let(NavList.Root([
            { items: [{ key: "x", label: "X", icon: { prefix: "fas", name: "gear" } }] },
        ]));
        const icon = $.let(r.unwrap().unwrap("NavList").sections.get(0n).items.get(0n).icon.unwrap("some"));
        $(Assert.equal(icon.prefix, "fas"));
        $(Assert.equal(icon.name, "gear"));
    });

    test("onSelect callback round-trips on main", $ => {
        const onSelect = East.function([StringType], NullType, (_$, _key) => { /* noop */ });
        const r = $.let(NavList.Root([{ items: [{ key: "x", label: "X" }] }], { onSelect }));
        $(Assert.equal(r.unwrap().unwrap("NavList").onSelect.hasTag("some"), true));
    });

    test("onSelect absent when not provided", $ => {
        const r = $.let(NavList.Root([{ items: [{ key: "x", label: "X" }] }]));
        $(Assert.equal(r.unwrap().unwrap("NavList").onSelect.hasTag("none"), true));
    });

    test("surface round-trips", $ => {
        const r = $.let(NavList.Root([{ items: [{ key: "x", label: "X" }] }], { surface: "shell" }));
        $(Assert.equal(r.unwrap().unwrap("NavList").surface.unwrap("some").hasTag("shell"), true));
    });

    test("surface absent when not provided", $ => {
        const r = $.let(NavList.Root([{ items: [{ key: "x", label: "X" }] }]));
        $(Assert.equal(r.unwrap().unwrap("NavList").surface.hasTag("none"), true));
    });

    test("background round-trips", $ => {
        const r = $.let(NavList.Root([{ items: [{ key: "x", label: "X" }] }], { background: "bg.subtle" }));
        $(Assert.equal(r.unwrap().unwrap("NavList").background.unwrap("some"), "bg.subtle"));
    });
}, { platformFns: TestImpl });
