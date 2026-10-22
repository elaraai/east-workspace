/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * What a group's assignment may hold (#1342): its skills, then the duties —
 * those the slice's `activities` source shows, and the assignment's own always.
 */
import { describe, expect, test } from "vitest";
import { SortedSet, StringType, compareFor, none, some, type option } from "@elaraai/east";
import { activityChoices, duties, groupSkills, type RosterValue } from "./model.js";

const activities: RosterValue["activities"] = [
    { key: "general", label: "General duties", code: "GD", group: none },
    { key: "pick", label: "Order picking", code: "OP", group: some("picking") },
    { key: "putaway", label: "Put-away", code: "PA", group: some("inbound") },
    { key: "unload", label: "Unloading", code: "UL", group: some("inbound") },
];
const shown = (...keys: string[]): option<Set<string>> => some(new SortedSet(keys, compareFor(StringType)));
/** What the activity helpers read of the renderer's value: every activity, and which the slice shows. */
const value = (visibleActivities: option<Set<string>>): Pick<RosterValue, "activities" | "visibleActivities"> => ({ activities, visibleActivities });
const keys = (rows: readonly { key: string }[]) => rows.map(row => row.key);

describe("a group's activities", () => {
    test("its skills are the activities of that group, in their order; the duties are the activities of none", () => {
        expect(keys(groupSkills(value(none), "inbound"))).toEqual(["putaway", "unload"]);
        expect(keys(duties(value(none)))).toEqual(["general"]);
    });

    test("an assignment's choices: the group's skills, then the duties, those the source shows, and its own always", () => {
        expect(keys(activityChoices(value(none), "inbound"))).toEqual(["putaway", "unload", "general"]);
        expect(keys(activityChoices(value(shown("unload", "pick")), "inbound"))).toEqual(["unload"]);
        expect(keys(activityChoices(value(shown("unload")), "inbound", ["putaway"]))).toEqual(["putaway", "unload"]);
        expect(keys(activityChoices(value(shown()), "picking", ["general"]))).toEqual(["general"]);
    });

    test("an edit keeps both its own activity and the stored one, so a stored activity the rail hides can be picked again", () => {
        // Stored Put-away, hidden by the rail; the edit has picked Unloading.
        expect(keys(activityChoices(value(shown("unload")), "inbound", ["unload", "putaway"]))).toEqual(["putaway", "unload"]);
    });
});
