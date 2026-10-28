/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's tag (#1368, `Builder Interfaces Spec.md` §5.1, §2): what it
 * refuses at build, each removed prop naming the form that replaces it (B4),
 * and the examples, compiled. A payload's build reads the app's records — the
 * duty kind's session, the people from their accessors — so what a payload
 * holds is checked on e3 itself, in e3-ui-components
 * (`test/roster-payload.spec.ts`); here, against a platform whose every
 * handle refuses, what is refused before anything is read.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, DictType, East, FloatType, StringType, StructType } from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import * as EastUI from "@elaraai/east-ui";
import { Slice } from "@elaraai/east-ui";
import e3 from "@elaraai/e3";
import { Data, Roster, Schedule } from "@elaraai/e3-ui";
import { Func, Record, RosterPayloadType, createRosterPayload, type RosterProps } from "@elaraai/e3-ui/internal";
import { WarehouseDuty } from "./warehouse.js";
import * as ex from "./roster.examples.js";

describeEast("Roster — inline bound examples", test => {
    Assert.examples(test, { rosterWarehouse: ex.rosterWarehouse, rosterMobile: ex.rosterMobile, rosterPeople: ex.rosterPeople,
        rosterPeopleMonth: ex.rosterPeopleMonth,
        rosterWeek: ex.rosterWeek, rosterWindowed: ex.rosterWindowed, rosterMinimal: ex.rosterMinimal, rosterPublished: ex.rosterPublished,
        rosterCustomInspector: ex.rosterCustomInspector });
}, { platformFns: TestImpl });

/** What the props over the warehouse's records hold before a test changes them: the duties, the staff and agencies, the shifts and the teams. */
interface Base {
    /** The props. */
    readonly props: RosterProps;
    /** The duties, bound with their patch door. */
    readonly rota: unknown;
}

/**
 * Builds a payload's East function over the warehouse's records, the props the
 * test gives beside or in place of the base's — refused, if it is, as it is built.
 */
function payload(change: (base: Base) => Partial<RosterProps> | Readonly<Record<string, unknown>> = () => ({})): void {
    East.function([], RosterPayloadType, ($) => {
        const rota = $.let(Record.bind(ex.rosterDuties, [ex.rosterDutiesPatch]));
        const staff = $.let(Data.bind(ex.rosterStaff));
        const firms = $.let(Data.bind(ex.rosterAgencies));
        const times = $.let(Data.bind(ex.rosterShiftTimes));
        const teams = $.let(Data.bind(ex.rosterTeams));
        const props: RosterProps = {
            events: { duty: Schedule.events(rota, {
                name: "Duty", icon: "user-clock", start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
                shift: "shift", group: "team", position: "role", activity: "task",
            }) },
            resources: {
                people: Schedule.resources(staff.read(), { name: "People", icon: "user", label: p => p.name, group: p => p.team }),
                agencies: Schedule.resources(firms.read(), { name: "Agencies", icon: "building", label: a => a.name }),
            },
            shifts: Roster.shifts(times.read(), { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours }),
            groups: Roster.groups(teams.read(), { label: t => t.label }),
        };
        return createRosterPayload({ ...props, ...change({ props, rota }) } as RosterProps);
    });
}

test("Roster is one tag; BuilderFrame, Builder and View are not part of its developer API, and east-ui has no Roster", () => {
    assert.equal("Builder" in Roster, false); assert.equal("View" in Roster, false);
    assert.equal("Board" in EastUI, false); assert.equal("Roster" in EastUI, false);
    assert.doesNotThrow(() => payload());
});

describe("the props §2 removed, each refused naming its replacement (B4)", () => {
    test("`weeks` and `window`: the app's duties, its weeks, and the duty kind's source of the slice", () => {
        assert.throws(() => payload(() => ({ weeks: {} })), /Roster: `weeks` is gone — the Roster writes the app's own duties, events=\{\{ duty: Schedule\.events\(.*periods=\{Schedule\.periods/);
        assert.throws(() => payload(() => ({ window: {} })), /Roster: `window` is gone — the Roster reads a week's duties through the duty kind's source of its slice/);
    });

    test("`people` and `agencies` as values: the `resources` kinds", () => {
        assert.throws(() => payload(() => ({ people: [] })), /Roster: `people` moves to `resources`: resources=\{\{ people: Schedule\.resources\(staff\.read\(\)/);
        assert.throws(() => payload(() => ({ agencies: [] })), /Roster: `agencies` moves to `resources`: resources=\{\{ people, agencies: Schedule\.resources/);
    });

    test("`forecast` and `costs`: the app's targets record, and its pay", () => {
        assert.throws(() => payload(() => ({ forecast: new Map() })), /Roster: `forecast` is gone — the targets are the app's own record, which its forecast fills: targets=\{Roster\.targets\(/);
        assert.throws(() => payload(() => ({ costs: {} })), /Roster: `costs` is gone — pay is the app's own, in its own pay codes: pay=\{…\} currency="…"/);
    });

    test("groups, shifts, positions and proposals as Roster values: their declarations over the app's rows", () => {
        assert.throws(() => payload(() => ({ groups: [{ key: "inbound", label: "Inbound" }] })),
            /Roster: `groups` is Roster\.groups\(rows, \{ label, order\? \}\) over the app's group rows — Roster\.Types\.Group values are gone/);
        assert.throws(() => payload(() => ({ shifts: [] })), /Roster: `shifts` is Roster\.shifts\(rows, \{ label, code, start, hours, order\?, color\? \}\) .* Roster\.Types\.Shift values are gone/);
        assert.throws(() => payload(() => ({ patterns: [] })), /Roster: `patterns` is Roster\.patterns\(rows, \{ name, icon\?, label, days, order\? \}\) over the app's week pattern rows — Roster\.Types\.Pattern values are gone/);
        assert.throws(() => payload(() => ({ positions: [] })), /Roster: `positions` is Roster\.positions\(rows, \{ label, code, lead, order\? \}\)/);
        assert.throws(() => payload(() => ({ proposals: [] })), /Roster: `proposals` is Roster\.proposals\(rows, \{ person, day, group, shift, reason \}\)/);
        assert.throws(() => payload((base) => ({ ...base.props, groups: undefined } as never)), /Roster: `groups` is Roster\.groups\(rows, \{ label, order\? \}\) over the app's group rows$/);
    });

    test("`inspector={{ assignment, requirement }}` and `rules.agree`: the duty kind's own inspector, and the app's own fields and check", () => {
        assert.throws(() => payload(() => ({ inspector: { assignment: undefined, requirement: undefined } })),
            /Roster: `inspector` is true or false — a duty's own form is the duty kind's `inspector` \(Schedule\.events\(record, \{ …, inspector \}\)\), a target's `Roster\.targets`' `inspector`/);
        assert.throws(() => payload(() => ({ rules: { agree: true } })), /Roster: `rules\.agree` is gone — a duty's own fields say what is agreed, and the app's `check` reads them/);
        assert.throws(() => payload(() => ({ rules: East.value({ rest: 10, lead: true, trainer: true, skill: true }) })), /Roster: `rules` are plain values/);
        assert.throws(() => payload(() => ({ rules: { rest: -1 } })), /Roster: `rules\.rest` is the hours of rest between duties, zero or more — and it is -1/);
    });

    test("the props #1342 retired: `visiblePeople` and `duties`", () => {
        assert.throws(() => payload(() => ({ visiblePeople: new Set(["aalder"]) })), /Roster: `visiblePeople` is gone — the Roster reads its people from `slice`'s `people` source/);
        assert.throws(() => payload(() => ({ duties: [] })), /Roster: `duties` is gone — a duty is an activity of no group in `activities`/);
    });

    test("Roster.people and Roster.patch are gone, naming their replacements", () => {
        assert.throws(() => (Roster.people as () => never)(), /Roster\.people is gone — the people are resources=\{\{ people: Schedule\.resources/);
        assert.throws(() => (Roster.patch as () => never)(), /Roster\.patch is gone — a card's drop returns Schedule\.patch\(DutyRowType, \{ … \}\)/);
    });
});

describe("the duties, the people and what they take", () => {
    test("`events` holds one kind, the duties", () => {
        assert.throws(() => payload((base) => ({ events: { duty: base.props.events.duty!, other: base.props.events.duty! } })),
            /Roster: `events` holds one kind, the duties — and it holds 2 \(duty, other\)/);
        assert.throws(() => payload(() => ({ events: {} })), /Roster: `events` holds the duties — events=\{\{ duty: Schedule\.events/);
    });

    test("`resources` holds `people`, and optionally `agencies`, each read whole; a person's home group is given", () => {
        assert.throws(() => payload((base) => ({ resources: { ...base.props.resources, presses: base.props.resources.people } })),
            /Roster: `resources` holds `people`, and optionally `agencies` — and it holds `presses`/);
        assert.throws(() => payload((base) => ({ resources: { agencies: base.props.resources.agencies } } as never)), /Roster: `resources` holds `people`, every person rostered/);
        // A duty kind naming the agencies needs their kind.
        assert.throws(() => payload((base) => ({ resources: { people: base.props.resources.people } })),
            /Roster: events\.duty's resource names the slot "agencies", and `resources` has no slot of that name \(people\)/);
        assert.throws(() => payload((base) => ({ resources: { ...base.props.resources,
            people: Schedule.resources(Data.bindPaged(ex.rosterStaff), { name: "People", icon: "user", label: p => p.name }) } })),
        /Roster: resources\.people is read whole — coverage, pay and checks read every one/);
        assert.throws(() => payload(() => ({ resources: { people: Schedule.resources(Data.bind(ex.rosterStaff).read(), { name: "People", icon: "user", label: p => p.name }),
            agencies: Schedule.resources(Data.bind(ex.rosterAgencies).read(), { name: "Agencies", icon: "building", label: a => a.name }) } })),
        /Roster: resources\.people gives each person's home group — Schedule\.resources\(staff\.read\(\), \{ …, group: \(p\) => p\.team \}\)/);
    });

    test("a duty kind whose resource names no people is refused", () => {
        // The smallest roster's duties, each a person's by a key — here named a key of the agencies.
        assert.throws(() => payload(() => ({ events: { duty: Schedule.events(Record.bind(ex.minimalDuties, [ex.minimalDutiesPatch]), {
            name: "Duty", icon: "user-clock", start: "start", end: "end", resource: { field: "person", of: "agencies" }, shift: "shift", group: "team",
        }) } })), /Roster: events\.duty's resource names no `people` — a duty is rostered to one of the people, resource: \{ field, of: "people" \}/);
    });

    test("`positions` beside a duty kind with no `position` role is refused", () => {
        assert.throws(() => payload((base) => ({
            events: { duty: Schedule.events(base.rota as never, {
                name: "Duty", icon: "user-clock", start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
                shift: "shift", group: "team",
            } as never) },
            positions: Roster.positions(Data.bind(ex.rosterPositions).read(), { label: p => p.label, code: p => p.code, lead: p => p.lead }),
        })), /Roster: `positions` are the positions a duty holds — and events\.duty maps no `position`/);
    });
});

describe("the app's pay, check and fit, over the duties' row type", () => {
    const PayRequest = Roster.Types.PayRequest(WarehouseDuty);
    const nothing = East.function([PayRequest], Roster.Types.Pay, () => new Map());

    test("`pay` takes `currency` with it, and is an East function from PayRequest(R) to Pay", () => {
        assert.throws(() => payload(() => ({ pay: nothing })), /Roster: `pay` gives each duty's cost — give `currency` with it/);
        assert.doesNotThrow(() => payload(() => ({ pay: nothing, currency: "AUD" })));
        const overText = East.function([StringType], Roster.Types.Pay, () => new Map());
        assert.throws(() => payload(() => ({ pay: overText as never, currency: "AUD" })), /Roster: `pay` is an East function from Roster\.Types\.PayRequest\(\.Struct/);
        const answersText = East.function([PayRequest], DictType(StringType, StringType), () => new Map());
        assert.throws(() => payload(() => ({ pay: answersText as never, currency: "AUD" })), /Roster: `pay` is an East function from Roster\.Types\.PayRequest/);
    });

    test("`check` is an East function from CheckContext(R) to Array<Issue>", () => {
        const fine = East.function([Roster.Types.CheckContext(WarehouseDuty)], ArrayType(Roster.Types.Issue), () => []);
        assert.doesNotThrow(() => payload(() => ({ check: fine })));
        const otherRow = East.function([Roster.Types.CheckContext(FloatType)], ArrayType(Roster.Types.Issue), () => []);
        assert.throws(() => payload(() => ({ check: otherRow as never })), /Roster: `check` is an East function from Roster\.Types\.CheckContext\(\.Struct/);
    });

    test("`fit` is Func.bind of an e3.function from FitRequest(R) to FitResult, refused naming the row it is bound over", () => {
        assert.doesNotThrow(() => payload(() => ({ fit: Func.bind(ex.rosterStaffFit) })));
        const Other = StructType({ person: StringType, start: Schedule.Types.Clock });
        const otherRow = e3.function("spec_other_row", East.function([Roster.Types.FitRequest(Other)], Roster.Types.FitResult, (_$, req) => ({
            need: req.need, slot: req.slot, people: new Map(),
        })));
        assert.throws(() => payload(() => ({ fit: Func.bind(otherRow) as never })),
            /Roster: `fit` is bound over duty rows \.Struct.*and the duty kind's rows are \.Struct.* — bind a fit over Roster\.Types\.FitRequest of the duties' row type/);
        const answersText = e3.function("spec_answers_text", East.function([Roster.Types.FitRequest(WarehouseDuty)], StringType, () => "nobody"));
        assert.throws(() => payload(() => ({ fit: Func.bind(answersText) as never })), /Roster: `fit` answers \.String, not Roster\.Types\.FitResult/);
        assert.throws(() => payload(() => ({ fit: East.value("roster_staff_fit") as never })),
            /Roster: `fit` is Func\.bind of the app's e3\.function from Roster\.Types\.FitRequest\(R\) to Roster\.Types\.FitResult/);
    });
});

describe("the narrowing and the library", () => {
    const staffSource = () => Data.bindPaged(ex.rosterStaff, { indexes: [ex.rosterStaffByTeamName, ex.rosterStaffByName] });
    const dutySource = () => Data.bindPaged(ex.rosterDuties, { indexes: [ex.rosterDutiesByTime] });

    test("the narrowing is Slice.bindRecords over the duties, the targets, the people and the activities: Slice.bind and a source of another name are refused", () => {
        assert.throws(() => payload(() => ({ slice: { slice: Slice.bind("spec.local", [{ name: "A. Alder" }], { fields: { name: { label: "Name" } } }) } as never })),
            /Roster: `slice` is Slice\.bindRecords\(key, \{ duty, people, activities.* — name each source after what it narrows/);
        assert.throws(() => payload(() => ({ slice: { slice: Slice.bindRecords("spec.staff", { staff: { source: staffSource() } }) } })),
            /Roster: `slice` narrows its duties \(duty\), its targets, its people and its activities, and the tabs that name a source — its source 'staff' is none of them/);
        // The duties' source reads them through their interval index; without `entries` beside it, a duty is never read by its key.
        assert.throws(() => payload(() => ({ slice: { slice: Slice.bindRecords("spec.duty", { duty: { source: dutySource(), range: "start" } }) } })),
            /the builder's source "duty" reads only its narrowing — and one event, the inspector's or its editing's, is read by its key: give `entries` beside it/);
    });

    test("an app's tab drops Schedule.patch over the duty row type, its cards following the source it names; a tab listed twice is refused", () => {
        const Role = StructType({ label: StringType });
        const roles = East.value(new Map([["lead", { label: "Supervisor" }]]), DictType(StringType, Role));
        const tab = (source?: string) => Roster.library.tab(roles, { name: "Positions", label: p => p.label,
            drop: (_p, key) => Schedule.patch(WarehouseDuty, { role: key }), ...(source === undefined ? {} : { source }) });
        assert.doesNotThrow(() => payload(() => ({ library: [Roster.library.people(), tab()] })));
        assert.throws(() => payload(() => ({ library: [tab(), tab()] })), /Roster: library tab tab:Positions is listed twice/);
        assert.throws(() => payload(() => ({ library: [tab("people")] })), /Roster: the Positions tab's source 'people' is not one of the slice's sources \(it has no slice\)/);
        assert.throws(() => payload(() => ({ library: [Roster.library.tab(roles, { name: "Positions", label: p => p.label,
            drop: () => Schedule.patch(StructType({ label: StringType }), { label: "x" }) })] })),
        /Roster: the "Positions" tab's `drop` returns a patch over no event kind's row type — build it with Schedule\.patch\(RowType, \{ … \}\)/);
    });
});

describe("the People layout's periods, its patterns and its display props (#1406)", () => {
    const patterns = () => Roster.patterns(Data.bind(ex.rosterPatterns).read(), { name: "Patterns", label: w => w.label, days: w => w.days, order: w => w.order });

    test("`view.period` is one its layout takes: Shifts a day or a week, People a week or a month, each refused otherwise naming both layouts' periods", () => {
        assert.doesNotThrow(() => payload(() => ({ view: { layout: "people", period: "month" } })));
        assert.doesNotThrow(() => payload(() => ({ view: { layout: "people", period: "week" } })));
        assert.doesNotThrow(() => payload(() => ({ view: { layout: "people" } })));
        assert.doesNotThrow(() => payload(() => ({ view: { layout: "shifts", period: "week" } })));
        assert.throws(() => payload(() => ({ view: { layout: "people", period: "day" } })),
            /Roster: `view\.period` "day" is not a period of the People layout — Shifts takes "day" or "week", People takes "week" or "month"/);
        assert.throws(() => payload(() => ({ view: { layout: "shifts", period: "month" } })),
            /Roster: `view\.period` "month" is not a period of the Shifts layout — Shifts takes "day" or "week", People takes "week" or "month"/);
        assert.throws(() => payload(() => ({ view: { period: "month" } })), /Roster: `view\.period` "month" is not a period of the Shifts layout/);
    });

    test("Roster.library.patterns() lists the app's patterns: refused without `patterns`, naming it; with them, a tab under their name; listed twice, refused", () => {
        assert.throws(() => payload(() => ({ library: [Roster.library.people(), Roster.library.patterns()] })),
            /Roster: Roster\.library\.patterns\(\) lists the app's week patterns — give `patterns`: patterns=\{Roster\.patterns\(rows, \{ name, icon\?, label, days, order\? \}\)\}/);
        assert.doesNotThrow(() => payload(() => ({ patterns: patterns(), library: [Roster.library.people(), Roster.library.patterns()] })));
        assert.doesNotThrow(() => payload(() => ({ patterns: patterns() })));
        assert.throws(() => payload(() => ({ patterns: patterns(), library: [Roster.library.patterns(), Roster.library.patterns()] })), /Roster: library tab patterns is listed twice/);
    });

    test("`tileTimes` is \"always\" or \"different\", and `letters` a boolean", () => {
        assert.doesNotThrow(() => payload(() => ({ tileTimes: "different", letters: false })));
        assert.throws(() => payload(() => ({ tileTimes: "sometimes" } as never)), /Roster: `tileTimes` is "always" or "different" — .* — and it is sometimes/);
        assert.throws(() => payload(() => ({ letters: "yes" } as never)), /Roster: `letters` is true or false — .* — and it is yes/);
    });
});

describe("Roster.targets", () => {
    const Cover = StructType({ day: Schedule.Types.Clock, team: StringType });
    test("refuses a role naming a field of another type, two roles naming one field, and a record not keyed by String", () => {
        const targets = (config: object, record: unknown = ex.rosterCover) => payload(() => {
            const def = record as typeof ex.rosterCover;
            return { targets: Roster.targets(Record.bind(def, [e3.mutation.patch(def)]) as never, config as never) };
        });
        const roles = { day: "day", group: "team", shift: "shift", positions: "heads", hours: "hours" };
        assert.doesNotThrow(() => targets(roles));
        assert.throws(() => targets({ ...roles, positions: "team" }), /Roster\.targets: `positions` names an Integer field, the positions to fill — "team" holds \.String/);
        assert.throws(() => targets({ ...roles, day: "nope" }), /Roster\.targets: `day` names "nope", a field the row does not have/);
        assert.throws(() => targets({ ...roles, group: "shift" }), /Roster\.targets: `group` and `shift` both name "shift" — the Roster writes each of its roles into a field of its own/);
        const byClock = e3.record("roster_spec_cover_by_day", DictType(Schedule.Types.Clock, Cover), new Map());
        assert.throws(() => targets(roles, byClock), /Roster\.targets: a target is keyed by a String/);
        // Read by key beside the slice's `targets` source alone.
        assert.throws(() => targets({ ...roles, entries: Data.bindPaged(ex.rosterCover) }),
            /Roster\.targets: `entries` reads one target by its key beside the Roster's slice's `targets` source/);
    });
});
