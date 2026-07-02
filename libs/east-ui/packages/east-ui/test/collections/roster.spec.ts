/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { variant } from "@elaraai/east";
import { Roster } from "@elaraai/east-ui/internal";
import * as ex from "./roster.examples.js";

describeEast("Roster", (test) => {
    Assert.examples(test, {
        rosterEdit: ex.rosterEdit,
        rosterPublished: ex.rosterPublished,
        rosterInteractive: ex.rosterInteractive,
        rosterWithLibrary: ex.rosterWithLibrary,
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
}, { platformFns: TestImpl });
