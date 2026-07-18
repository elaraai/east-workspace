/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, NullType, StringType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Deck, Text } from "@elaraai/east-ui/internal";
import * as ex from "./deck.examples.js";

describeEast("Deck", (test) => {
    Assert.examples(test, {
        deckBasic: ex.deckBasic,
        deckGroupBy: ex.deckGroupBy,
        deckListLayout: ex.deckListLayout,
        deckCustomFace: ex.deckCustomFace,
        deckSlice: ex.deckSlice,
        deckDetail: ex.deckDetail,
        deckClickable: ex.deckClickable,
    });

    const ROWS = [
        { id: "a", name: "Line A", state: "RUNNING", team: "Alpha" },
        { id: "b", name: "Line B", state: "DOWN", team: "Beta" },
    ];

    // =========================================================================
    // Item resolution
    // =========================================================================

    test("resolves rows into items with groups per option key", $ => {
        const deck = $.let(Deck.Root(ROWS, {
            card: r => ({ key: r.id, title: r.name, sublabel: r.team }),
            groupBy: [
                { key: "state", label: "Status", value: r => r.state },
                { key: "team", label: "Team", value: r => r.team },
            ],
        }));
        const payload = $.let(deck.unwrap().unwrap("Deck"));
        $(Assert.equal(payload.items.size(), 2n));
        const first = $.let(payload.items.get(0n));
        $(Assert.equal(first.key, "a"));
        $(Assert.equal(first.title, "Line A"));
        $(Assert.equal(first.sublabel.unwrap("some"), "Alpha"));
        $(Assert.equal(first.groups.get("state"), "RUNNING"));
        $(Assert.equal(first.groups.get("team"), "Alpha"));
        $(Assert.equal(payload.groupOptions.size(), 2n));
        $(Assert.equal(payload.groupOptions.get(0n).label, "Status"));
    });

    test("status and facts round-trip on the face", $ => {
        const deck = $.let(Deck.Root(ROWS, {
            card: r => ({
                key: r.id, title: r.name,
                status: Deck.status(r.state, "warning"),
                facts: [Deck.text("Team", r.team), Deck.chips("Tags", ["x", "y"]), Deck.meter("Load", 30.0, 100.0, "30%")],
            }),
        }));
        const first = $.let(deck.unwrap().unwrap("Deck").items.get(0n));
        $(Assert.equal(first.status.unwrap("some").label, "RUNNING"));
        $(Assert.equal(first.status.unwrap("some").tone.hasTag("warning"), true));
        $(Assert.equal(first.facts.size(), 3n));
        $(Assert.equal(first.facts.get(0n).value.unwrap("text"), "Alpha"));
        $(Assert.equal(first.facts.get(1n).value.unwrap("chips").size(), 2n));
        $(Assert.equal(first.facts.get(2n).value.unwrap("meter").max, 100.0));
    });

    // =========================================================================
    // Layout / defaults
    // =========================================================================

    test("layout defaults to none and list is carried when set", $ => {
        const plain = $.let(Deck.Root(ROWS, { card: r => ({ key: r.id, title: r.name }) }));
        $(Assert.equal(plain.unwrap().unwrap("Deck").layout.hasTag("none"), true));

        const list = $.let(Deck.Root(ROWS, { card: r => ({ key: r.id, title: r.name }), layout: "list" }));
        $(Assert.equal(list.unwrap().unwrap("Deck").layout.unwrap("some").hasTag("list"), true));
    });

    test("tone, view and hover carry per item; open callbacks fill their slots", $ => {
        const plain = $.let(Deck.Root(ROWS, { card: r => ({ key: r.id, title: r.name }) }));
        const plainItem = $.let(plain.unwrap().unwrap("Deck").items.get(0n));
        $(Assert.equal(plainItem.face.hasTag("none"), true));
        $(Assert.equal(plainItem.tone.hasTag("none"), true));
        $(Assert.equal(plainItem.detail.hasTag("none"), true));
        $(Assert.equal(plainItem.hover.hasTag("none"), true));
        $(Assert.equal(plain.unwrap().unwrap("Deck").onOpen.hasTag("none"), true));
        $(Assert.equal(plain.unwrap().unwrap("Deck").onClose.hasTag("none"), true));

        const rich = $.let(Deck.Root(ROWS, {
            card: r => ({ key: r.id, title: r.name, tone: "danger" }),
            view: r => Text.Root(r.name),
            hover: r => Text.Root(r.team),
            onOpen: East.function([StringType], NullType, (_$h, _key) => null),
            onClose: East.function([], NullType, (_$h) => null),
        }));
        const payload = $.let(rich.unwrap().unwrap("Deck"));
        const item = $.let(payload.items.get(0n));
        $(Assert.equal(item.tone.unwrap("some").hasTag("danger"), true));
        $(Assert.equal(item.detail.hasTag("some"), true));
        $(Assert.equal(item.hover.hasTag("some"), true));
        $(Assert.equal(item.detail.unwrap("some").unwrap().unwrap("Text").value, "Line A"));
        $(Assert.equal(payload.onOpen.hasTag("some"), true));
        $(Assert.equal(payload.onClose.hasTag("some"), true));
    });

    // =========================================================================
    // Group summaries
    // =========================================================================

    test("group summaries bucket once per option", $ => {
        const deck = $.let(Deck.Root(ROWS, {
            card: r => ({ key: r.id, title: r.name }),
            groupBy: [{
                key: "team", label: "Team", value: r => r.team,
                summary: rows => East.str`${East.print(rows.size())} lines`,
            }],
        }));
        const summaries = $.let(deck.unwrap().unwrap("Deck").groupSummaries);
        $(Assert.equal(summaries.get("team").get("Alpha"), "1 lines"));
        $(Assert.equal(summaries.get("team").get("Beta"), "1 lines"));
    });
}, { platformFns: TestImpl });

