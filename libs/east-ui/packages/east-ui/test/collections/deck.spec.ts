/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, NullType, StringType, type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Chart, Deck, Text } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./deck.examples.js";

describeEast("Deck", (test) => {
    Assert.examples(test, {
        deckBasic: ex.deckBasic,
        deckCustomFace: ex.deckCustomFace,
        deckSlice: ex.deckSlice,
        deckDetail: ex.deckDetail,
        deckClickable: ex.deckClickable,
        deckVariants: ex.deckVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#461).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("deckVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.deckVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "GROUP BY"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "LIST LAYOUT"));
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

    test("facts round-trip on the face", $ => {
        const deck = $.let(Deck.Root(ROWS, {
            card: r => ({
                key: r.id, title: r.name,
                facts: [Deck.text("Team", r.team), Deck.chips("Tags", ["x", "y"]), Deck.meter("Load", 30.0, 100.0, "30%")],
            }),
        }));
        const first = $.let(deck.unwrap().unwrap("Deck").items.get(0n));
        $(Assert.equal(first.facts.size(), 3n));
        $(Assert.equal(first.facts.get(0n).value.unwrap("text"), "Alpha"));
        $(Assert.equal(first.facts.get(1n).value.unwrap("chips").size(), 2n));
        $(Assert.equal(first.facts.get(2n).value.unwrap("meter").max, 100.0));
    });

    test("the status registry resolves token and custom colours", $ => {
        const statuses = Deck.statuses({
            running: { label: "Running", color: "success", pulse: true, hint: "producing" },
            standby: { label: "Standby", color: "#3568c9" },
        });
        const deck = $.let(Deck.Root(ROWS, {
            card: r => ({ key: r.id, title: r.name, status: "running" }),
            statuses,
        }));
        const payload = $.let(deck.unwrap().unwrap("Deck"));
        $(Assert.equal(payload.items.get(0n).status.unwrap("some"), "running"));
        const running = $.let(payload.statuses.get("running"));
        $(Assert.equal(running.label, "Running"));
        $(Assert.equal(running.color.unwrap("token").hasTag("success"), true));
        $(Assert.equal(running.pulse, true));
        $(Assert.equal(running.hint.unwrap("some"), "producing"));
        const standby = $.let(payload.statuses.get("standby"));
        $(Assert.equal(standby.color.unwrap("custom"), "#3568c9"));
        $(Assert.equal(standby.pulse, false));
    });

    test("metrics carry raw values with shared formats or accessor text", $ => {
        const deck = $.let(Deck.Root(ROWS, {
            card: r => ({
                key: r.id, title: r.name,
                metrics: [
                    Deck.metric("Rate", 118.0, { format: Chart.format.compact() }),
                    Deck.metric("Temp", 44.1, { format: v => East.str`${East.print(v)}°`, warn: true }),
                ],
                fill: { value: 62.0, max: 100.0, format: (v, max) => East.str`${East.print(v)}/${East.print(max)}` },
            }),
        }));
        const item = $.let(deck.unwrap().unwrap("Deck").items.get(0n));
        const rate = $.let(item.metrics.get(0n));
        $(Assert.equal(rate.value.unwrap("some"), 118.0));
        $(Assert.equal(rate.format.unwrap("some").hasTag("compact"), true));
        $(Assert.equal(rate.text.hasTag("none"), true));
        const temp = $.let(item.metrics.get(1n));
        $(Assert.equal(temp.text.unwrap("some"), "44.1°"));
        $(Assert.equal(temp.warn, true));
        const fill = $.let(item.fill.unwrap("some"));
        $(Assert.equal(fill.value, 62.0));
        // East.print of a float keeps the decimal point.
        $(Assert.equal(fill.text.unwrap("some"), "62.0/100.0"));
    });

    test("footer and legend carry through the payload", $ => {
        const deck = $.let(Deck.Root(ROWS, {
            card: r => ({ key: r.id, title: r.name }),
            footer: [{ label: "Lines", value: "2" }],
            legend: true,
        }));
        const payload = $.let(deck.unwrap().unwrap("Deck"));
        $(Assert.equal(payload.footer.get(0n).label, "Lines"));
        $(Assert.equal(payload.footer.get(0n).value, "2"));
        $(Assert.equal(payload.legend, true));

        const plain = $.let(Deck.Root(ROWS, { card: r => ({ key: r.id, title: r.name }) }));
        $(Assert.equal(plain.unwrap().unwrap("Deck").statuses.size(), 0n));
        $(Assert.equal(plain.unwrap().unwrap("Deck").footer.size(), 0n));
        $(Assert.equal(plain.unwrap().unwrap("Deck").legend, false));
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
        $(Assert.equal(plainItem.status.hasTag("none"), true));
        $(Assert.equal(plainItem.detail.hasTag("none"), true));
        $(Assert.equal(plainItem.hover.hasTag("none"), true));
        $(Assert.equal(plain.unwrap().unwrap("Deck").onOpen.hasTag("none"), true));
        $(Assert.equal(plain.unwrap().unwrap("Deck").onClose.hasTag("none"), true));

        const rich = $.let(Deck.Root(ROWS, {
            card: r => ({ key: r.id, title: r.name, status: "running" }),
            onClick: r => Text.Root(r.name),
            onHover: r => Text.Root(r.team),
            onOpen: East.function([StringType], NullType, (_$h, _key) => null),
            onClose: East.function([], NullType, (_$h) => null),
        }));
        const payload = $.let(rich.unwrap().unwrap("Deck"));
        const item = $.let(payload.items.get(0n));
        $(Assert.equal(item.status.unwrap("some"), "running"));
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

