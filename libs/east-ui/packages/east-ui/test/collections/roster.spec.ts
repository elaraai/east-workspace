/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { BooleanType, East, NullType, OptionType, none, some, variant, type ExprType } from "@elaraai/east";
import { DragEventType, Roster, Status } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./roster.examples.js";

describeEast("Roster", (test) => {
    Assert.examples(test, {
        rosterModes: ex.rosterModes,
        rosterInteractive: ex.rosterInteractive,
        rosterReview: ex.rosterReview,
        rosterLibraryDnd: ex.rosterLibraryDnd,
        rosterFill: ex.rosterFill,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#461).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("rosterModes drives its preview from inline option tables", $ => {
        // The mode-preset axis is declared inside the example body, because
        // the documentation capture only extracts `fn`. That puts it inside
        // the Reactive body, which TestImpl does not execute, so it cannot be
        // asserted from here; `Assert.examples` above still compiles and
        // evaluates the outer function. Per-mode prop coverage lives in the
        // Roster.Root tests below.
        const panel = $.const(ex.rosterModes.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    test("rosterFill panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.rosterFill.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "SCROLL"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "FILL"));
    });

    test("creates a roster with target declaration and default week", $ => {
        const roster = $.let(Roster.Root(
            [{ id: "patel", name: "Patel" }],
            [{ id: "p1", person: "patel", day: "Mon", hours: 8n, state: variant("committed", null) }],
            {
                id: "roster-se",
                sources: ["people"],
                person: p => ({ key: p.id, label: p.name }),
                shift: s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state }),
            },
        ));
        const root = $.let(roster.unwrap().unwrap("Roster"));

        $(Assert.equal(root.id, "roster-se"));
        $(Assert.equal(root.sources.get(0n), "people"));
        $(Assert.equal(root.mode.hasTag("published"), true));
        $(Assert.equal(root.days.size(), 7n));
        $(Assert.equal(root.days.get(0n), "Mon"));
        $(Assert.equal(root.personHeader, "Operator"));
        $(Assert.equal(root.personWidth.hasTag("none"), true));
        $(Assert.equal(root.people.get(0n).key, "patel"));
        $(Assert.equal(root.people.get(0n).sublabel.hasTag("none"), true));
        $(Assert.equal(root.canDrop.hasTag("none"), true));
    });

    test("canDrop encodes and vetoes candidate events (#261)", $ => {
        const canDrop = $.const(East.function([DragEventType], BooleanType, ($, event) =>
            event.match({
                add: (_$, add) => add.into.slot.notEqual("Sun"),
                move: (_$, mv) => mv.to.slot.notEqual("Sun"),
                remove: (_$) => East.value(true),
                resize: (_$) => East.value(true),
            })));
        const roster = $.let(Roster.Root(
            [{ id: "patel", name: "Patel" }],
            [{ id: "p1", person: "patel", day: "Mon", hours: 8n, state: variant("committed", null) }],
            {
                id: "r",
                mode: "edit",
                person: p => ({ key: p.id, label: p.name }),
                shift: s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state }),
                canDrop,
            },
        ));
        const root = $.let(roster.unwrap().unwrap("Roster"));

        $(Assert.equal(root.canDrop.hasTag("some"), true));
        const veto = $.let(root.canDrop.unwrap("some"));
        $(Assert.equal(veto(variant("add", {
            from: { library: "people", key: "kim" },
            into: { surface: "r", row: "patel", slot: "Mon", event: none },
            duplicate: false,
        })), true));
        $(Assert.equal(veto(variant("add", {
            from: { library: "people", key: "kim" },
            into: { surface: "r", row: "patel", slot: "Sun", event: none },
            duplicate: false,
        })), false));
        $(Assert.equal(veto(variant("move", {
            from: { surface: "r", row: "patel", slot: "Mon", event: some("p1") },
            to: { surface: "r", row: "patel", slot: "Sun", event: none },
        })), false));
    });

    test("shifts resolve hours to the chip label and keep typed state", $ => {
        const roster = $.let(Roster.Root(
            [{ id: "cho", name: "Cho" }],
            [
                { id: "c1", person: "cho", day: "Tue", hours: 6n, state: variant("committed", null) },
                { id: "c2", person: "cho", day: "Sun", hours: 4n, state: variant("proposed", variant("model", null)) },
            ],
            {
                id: "r",
                mode: "edit",
                summary: "1 ghost",
                person: p => ({ key: p.id, label: p.name }),
                personHeader: "Crew",
                personWidth: "180px",
                shift: s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state }),
            },
        ));
        const root = $.let(roster.unwrap().unwrap("Roster"));

        $(Assert.equal(root.mode.hasTag("edit"), true));
        $(Assert.equal(root.personHeader, "Crew"));
        $(Assert.equal(root.personWidth.unwrap("some"), "180px"));
        $(Assert.equal(root.summary.unwrap("some"), "1 ghost"));
        $(Assert.equal(root.shifts.get(0n).label, "6h"));
        $(Assert.equal(root.shifts.get(0n).state.hasTag("committed"), true));
        $(Assert.equal(root.shifts.get(1n).state.unwrap("proposed").hasTag("model"), true));
    });

    test("explicit label encoding overrides hours", $ => {
        const roster = $.let(Roster.Root(
            [{ id: "p", name: "P" }],
            [{ id: "s1", person: "p", day: "Mon", text: "on call", state: variant("committed", null) }],
            {
                id: "r",
                person: p => ({ key: p.id, label: p.name }),
                shift: s => ({ key: s.id, person: s.person, day: s.day, label: s.text, state: s.state }),
            },
        ));

        $(Assert.equal(roster.unwrap().unwrap("Roster").shifts.get(0n).label, "on call"));
    });

    test("custom days override the default week", $ => {
        const roster = $.let(Roster.Root(
            [{ id: "p", name: "P" }],
            [{ id: "s1", person: "p", day: "Mon", hours: 8n, state: variant("committed", null) }],
            {
                id: "r",
                days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
                person: p => ({ key: p.id, label: p.name }),
                shift: s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state }),
            },
        ));

        $(Assert.equal(roster.unwrap().unwrap("Roster").days.size(), 5n));
    });

    test("review chrome + person accessors encode via the shared contract (#265)", $ => {
        const roster = $.let(Roster.Root(
            [
                { id: "patel", name: "Patel", flagged: false },
                { id: "cho", name: "Cho", flagged: true },
            ],
            [{ id: "p1", person: "patel", day: "Mon", hours: 8n, state: variant("committed", null) }],
            {
                id: "r",
                mode: "edit",
                person: p => ({
                    key: p.id,
                    label: p.name,
                    status: p.flagged.ifElse(
                        _$ => East.value(some(variant("warning", null)), OptionType(Status.Types.Value)),
                        _$ => East.value(none, OptionType(Status.Types.Value)),
                    ),
                    approval: p.flagged.ifElse(
                        _$ => East.value(some(variant("pending", null)), OptionType(Roster.Types.Approval)),
                        _$ => East.value(some(variant("approved", null)), OptionType(Roster.Types.Approval)),
                    ),
                }),
                shift: s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: s.state }),
                review: {
                    onApprove: East.function([Roster.Types.ApproveEvent], NullType, _$ => null),
                    onApproveAll: East.function([], NullType, _$ => null),
                },
            },
        ));
        const root = $.let(roster.unwrap().unwrap("Roster"));

        const review = $.let(root.review.unwrap("some"));
        $(Assert.equal(review.columnLabel, "Decision"));
        $(Assert.equal(review.onApprove.hasTag("some"), true));
        $(Assert.equal(root.people.get(0n).status.hasTag("none"), true));
        $(Assert.equal(root.people.get(0n).approval.unwrap("some").hasTag("approved"), true));
        $(Assert.equal(root.people.get(1n).status.unwrap("some").hasTag("warning"), true));
        $(Assert.equal(root.people.get(1n).approval.unwrap("some").hasTag("pending"), true));
    });
}, { platformFns: TestImpl });
