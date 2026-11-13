/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The `views` prop as a component's tag reads it: literal tags, or variants, or an expression; what the code spells
 * refused where it says nothing, names no view or leaves out the view it opens on.
 */

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { ArrayType, East, Expr, NullType, StringType, VariantType, equalFor, variant } from "@elaraai/east";
import { firstView, literalViews, viewsProp } from "../../src/utils/views.js";

const Layout = VariantType({ shifts: NullType, people: NullType });
const equal = equalFor(ArrayType(Layout));

/** What a `views` prop evaluates to. */
function evaluated(given: Parameters<typeof viewsProp<typeof Layout, "shifts" | "people">>[2]): ReadonlyArray<ReturnType<typeof variant>> {
    return East.compile(East.function([], ArrayType(Layout), _$ => viewsProp("Roster", Layout, given) as never), [])() as never;
}

describe("the views prop", () => {
    test("left out, it is empty: every view", () => {
        assert.ok(equal(evaluated(undefined) as never, [] as never));
    });
    test("literal tags and variants name the same views, and may stand side by side", () => {
        const people = [variant("people", null)];
        assert.ok(equal(evaluated(["people"]) as never, people as never));
        assert.ok(equal(evaluated([variant("people", null)] as never) as never, people as never));
        assert.ok(equal(evaluated(["shifts", variant("people", null)] as never) as never, [variant("shifts", null), variant("people", null)] as never));
    });
    test("an expression is read as the page runs, its tags chosen by what it holds", () => {
        const fn = East.function([ArrayType(StringType)], ArrayType(Layout), ($, tags) => {
            const every = $.const([variant("shifts", null), variant("people", null)], ArrayType(Layout));
            const views = every.filter(($2, view) => tags.toSet().has(view.getTag()));
            return viewsProp("Roster", Layout, views) as never;
        });
        const run = East.compile(fn, []);
        assert.ok(equal(run(["people"]) as never, [variant("people", null)] as never));
        assert.ok(equal(run([]) as never, [] as never));
    });
    test("an empty list in the code is refused, as saying nothing", () => {
        assert.throws(() => viewsProp("Roster", Layout, []), /Roster: `views` lists at least one of "(people|shifts)", "(people|shifts)" — leave it out/);
    });
    test("a literal tag that is no view is refused, naming the views", () => {
        assert.throws(() => viewsProp("Roster", Layout, ["month"] as never), /Roster: `views` holds "month", which is none of/);
    });
    test("a list in the code that leaves out the view it opens on is refused, naming both the prop that opens it and the list", () => {
        assert.throws(() => viewsProp<typeof Layout, "shifts" | "people">("Roster", Layout, ["people"], "shifts"),
            /Roster: `view\.layout` is "shifts", and `views` leaves it out — list it, or open on one of "people"/);
        assert.throws(() => viewsProp<typeof Layout, "shifts" | "people">("Roster", Layout, ["people"], "shifts", "viewPeriods"),
            /Roster: `view\.period` is "shifts", and `viewPeriods` leaves it out/);
        assert.throws(() => viewsProp<typeof Layout, "shifts" | "people">("Ontology", Layout, ["people"], "shifts", "views", "defaultView"),
            /Ontology: `defaultView` is "shifts", and `views` leaves it out/);
        assert.ok(viewsProp<typeof Layout, "shifts" | "people">("Roster", Layout, ["people"], "people") instanceof Expr);
    });
    test("with no view named, a component opens on the first of its own order the code lists", () => {
        assert.equal(firstView(["shifts", "people"], ["people"]), "people");
        assert.equal(firstView(["shifts", "people"], ["people", "shifts"]), "shifts");
        assert.equal(firstView(["shifts", "people"], undefined), "shifts");
        assert.equal(literalViews(undefined), undefined);
    });
});
