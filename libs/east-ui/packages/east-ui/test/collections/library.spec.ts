/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, some, none, ArrayType, IntegerType, StringType, StructType, type ExprType } from "@elaraai/east";
import { Library } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./library.examples.js";

describeEast("Library", (test) => {
    Assert.examples(test, {
        libraryPeople: ex.libraryPeople,
        libraryVariants: ex.libraryVariants,
        libraryLarge: ex.libraryLarge,
        libraryFill: ex.libraryFill,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#461).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("libraryLarge drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the mode axis and the three
        // 400-card branch palettes — is declared inside the example body,
        // because the documentation capture only extracts `fn`. That puts the
        // tables inside the Reactive body, which TestImpl does not execute, so
        // they cannot be asserted from here; `Assert.examples` above still
        // compiles and evaluates the outer function. The 400-card generation
        // coverage lives in the generator test below, which constructs the
        // same fixture shape directly.
        const panel = $.const(ex.libraryLarge.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    test("libraryVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.libraryVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "ASSETS"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "FLAT"));
    });

    test("libraryFill panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.libraryFill.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "SCROLL"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "FILL"));
    });

    test("400 generated cards resolve with hoisted per-group summaries", $ => {
        const RowType = StructType({ id: StringType, depot: StringType });
        const rows = $.const(East.Array.generate(400n, RowType, East.function([IntegerType], RowType, ($, i) => {
            const depots = $.const(["North", "South", "East", "West", "Central", "Airport", "Harbor", "Rail"], ArrayType(StringType));
            const row = $.let({
                id: East.str`crew-${i}`,
                depot: depots.get(i.remainder(8n)),
            }, RowType);
            return row;
        })));
        const lib = $.let(Library.Root(rows, {
            id: "crew",
            item: r => ({ key: r.id, label: r.id }),
            groupBy: [
                { key: "depot", label: "Depot", value: r => r.depot, summary: members => East.str`${members.size()} crew` },
            ],
            style: { height: "480px" },
        }));
        const root = $.let(lib.unwrap().unwrap("Library"));

        $(Assert.equal(root.items.size(), 400n));
        $(Assert.equal(root.style.unwrap("some").height.unwrap("some"), "480px"));
        // 400 crew round-robin 8 depots → 50 per depot, summary computed once per group.
        $(Assert.equal(root.groupSummaries.get("depot").size(), 8n));
        $(Assert.equal(root.groupSummaries.get("depot").get("North"), "50 crew"));
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

    test("groups carry the value per item; summaries hoist to the root", $ => {
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
        $(Assert.equal(root.items.get(0n).groups.get("role"), "Senior"));
        $(Assert.equal(root.groupSummaries.get("role").get("Senior"), "2 people"));
        $(Assert.equal(root.groupSummaries.get("role").get("Mid"), "1 people"));
    });

    test("card defaults filtered false; filtered accessor carries through", $ => {
        const lib = $.let(Library.Root(
            [{ id: "a", name: "Alpha", excluded: true }, { id: "b", name: "Beta", excluded: false }],
            {
                id: "x",
                item: r => ({ key: r.id, label: r.name, filtered: r.excluded }),
            },
        ));
        const root = $.let(lib.unwrap().unwrap("Library"));

        $(Assert.equal(root.items.get(0n).filtered, true));
        $(Assert.equal(root.items.get(1n).filtered, false));
    });

    test("style carries height and virtualization; slice defaults to none", $ => {
        const lib = $.let(Library.Root(
            [{ id: "a", name: "Alpha" }],
            {
                id: "x",
                item: r => ({ key: r.id, label: r.name }),
                style: { height: "480px", virtualization: false },
            },
        ));
        const root = $.let(lib.unwrap().unwrap("Library"));

        $(Assert.equal(root.style.unwrap("some").height.unwrap("some"), "480px"));
        $(Assert.equal(root.style.unwrap("some").maxHeight.hasTag("none"), true));
        $(Assert.equal(root.style.unwrap("some").virtualization.unwrap("some"), false));
        $(Assert.equal(root.slice.hasTag("none"), true));
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
