/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, some, none } from "@elaraai/east";
import { Library } from "@elaraai/east-ui/internal";
import * as ex from "./library.examples.js";

describeEast("Library", (test) => {
    Assert.examples(test, {
        libraryPeople: ex.libraryPeople,
        libraryAssets: ex.libraryAssets,
        libraryFlat: ex.libraryFlat,
    });

    test("creates a minimal flat library", $ => {
        const lib = $.let(Library.Root(
            [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }],
            {
                id: "rooms",
                item: r => ({ key: r.id, label: r.name }),
            },
        ));

        $(Assert.equal(lib.unwrap().getTag(), "Library"));
        $(Assert.equal(lib.unwrap().unwrap("Library").id, "rooms"));
        $(Assert.equal(lib.unwrap().unwrap("Library").items.size(), 2n));
        $(Assert.equal(lib.unwrap().unwrap("Library").searchable, false));
        $(Assert.equal(lib.unwrap().unwrap("Library").groupOptions.size(), 0n));
        $(Assert.equal(lib.unwrap().unwrap("Library").dimOptions.size(), 0n));
    });

    test("card defaults: draggable true, optional fields none", $ => {
        const lib = $.let(Library.Root(
            [{ id: "a", name: "Alpha" }],
            { id: "x", item: r => ({ key: r.id, label: r.name }) },
        ));
        const item = $.let(lib.unwrap().unwrap("Library").items.get(0n));

        $(Assert.equal(item.key, "a"));
        $(Assert.equal(item.label, "Alpha"));
        $(Assert.equal(item.draggable, true));
        $(Assert.equal(item.sublabel.hasTag("none"), true));
        $(Assert.equal(item.icon.hasTag("none"), true));
        $(Assert.equal(item.status.hasTag("none"), true));
        $(Assert.equal(item.search.hasTag("none"), true));
    });

    test("status pill and draggable carry through the card face", $ => {
        const lib = $.let(Library.Root(
            [{ id: "a", name: "Alpha", busy: true }],
            {
                id: "x",
                item: r => ({
                    key: r.id,
                    label: r.name,
                    status: r.busy.ifElse(() => some(Library.status("At cap", "neutral")), () => none),
                    draggable: r.busy.not(),
                }),
            },
        ));
        const item = $.let(lib.unwrap().unwrap("Library").items.get(0n));

        $(Assert.equal(item.draggable, false));
        $(Assert.equal(item.status.unwrap("some").label, "At cap"));
        $(Assert.equal(item.status.unwrap("some").tone.hasTag("neutral"), true));
    });

    test("dimensions resolve per kind and register toolbar metadata", $ => {
        const lib = $.let(Library.Root(
            [{ id: "a", name: "Alpha", hours: 30.0, skills: ["Go", "SQL"], site: "SE-1" }],
            {
                id: "x",
                item: r => ({ key: r.id, label: r.name }),
                dimensions: [
                    { kind: "meter", key: "hours", label: "Hours", value: r => r.hours, max: 40.0, format: h => East.str`${h}h` },
                    { kind: "chips", key: "skills", label: "Skills", values: r => r.skills },
                    { kind: "text", key: "location", label: "Location", value: r => r.site },
                ],
            },
        ));
        const root = $.let(lib.unwrap().unwrap("Library"));
        const dims = $.let(root.items.get(0n).dims);

        $(Assert.equal(root.dimOptions.size(), 3n));
        $(Assert.equal(root.dimOptions.get(0n).label, "Hours"));
        $(Assert.equal(root.defaultDimensions.size(), 2n));
        $(Assert.equal(dims.get("hours").unwrap("meter").value, 30.0));
        $(Assert.equal(dims.get("hours").unwrap("meter").max, 40.0));
        $(Assert.equal(dims.get("hours").unwrap("meter").text.unwrap("some"), "30.0h"));
        $(Assert.equal(dims.get("skills").unwrap("chips").size(), 2n));
        $(Assert.equal(dims.get("location").unwrap("text"), "SE-1"));
    });

    test("group placement carries the value and a members summary", $ => {
        const lib = $.let(Library.Root(
            [
                { id: "a", name: "Alpha", role: "Senior" },
                { id: "b", name: "Beta", role: "Senior" },
                { id: "c", name: "Gamma", role: "Mid" },
            ],
            {
                id: "x",
                item: r => ({ key: r.id, label: r.name }),
                groupBy: [
                    { key: "role", label: "Role", value: r => r.role, summary: members => East.str`${members.size()} people` },
                ],
            },
        ));
        const root = $.let(lib.unwrap().unwrap("Library"));

        $(Assert.equal(root.groupOptions.size(), 1n));
        $(Assert.equal(root.items.get(0n).groups.get("role").value, "Senior"));
        $(Assert.equal(root.items.get(0n).groups.get("role").summary.unwrap("some"), "2 people"));
        $(Assert.equal(root.items.get(2n).groups.get("role").summary.unwrap("some"), "1 people"));
    });

    test("search accessor sets searchable and per-item text", $ => {
        const lib = $.let(Library.Root(
            [{ id: "a", name: "Alpha" }],
            {
                id: "x",
                item: r => ({ key: r.id, label: r.name }),
                search: r => r.name,
            },
        ));
        const root = $.let(lib.unwrap().unwrap("Library"));

        $(Assert.equal(root.searchable, true));
        $(Assert.equal(root.items.get(0n).search.unwrap("some"), "Alpha"));
    });
}, { platformFns: TestImpl });
