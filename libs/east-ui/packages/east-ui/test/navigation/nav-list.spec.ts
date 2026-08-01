/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { NavList } from "@elaraai/east-ui/internal";
import { East, NullType, StringType, type ExprType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./nav-list.examples.js";

describeEast("NavList", (test) => {
    Assert.examples(test, {
        navListBasic: ex.navListBasic,
        navListReactive: ex.navListReactive,
        navListVariants: ex.navListVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#463).
    // =========================================================================

    test("navListVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.navListVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 3n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "LIST GROUPED"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "LIST WITH ICONS"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "LIST SHELL SURFACE"));
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
