/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a UI writes and calls, read from its IR (#1226): the datasets its
 * `Data.bind` handles may write, by what it does with each and by the
 * binding's mode and patch dataset, and each record it binds, with the
 * mutations it binds and the indexes it reads through.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, DictType, East, FloatType, IRType, NullType, PatchType, StringType, StructType,
    decodeBeast2For, encodeBeast2For, equalFor, printFor, toEastTypeValue, variant, type IR,
} from "@elaraai/east";
import { type TreePath } from "@elaraai/e3-types";
import { input, mutation, record, recordIndex } from "@elaraai/e3";
import { Button, Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";
import {
    Data, DataBindHandleType, Decision, DecisionType, JudgementsType, Record, UiAccessType, deriveUiAccess, type UiAccess,
} from "@elaraai/e3-ui";

const accessEqual = equalFor(UiAccessType);
const printAccess = printFor(UiAccessType);

/** An input's dataset path, `.inputs.<name>`. */
const inputPath = (name: string): TreePath => [variant("field", "inputs"), variant("field", name)];

/** What a UI writes and calls, read from its function's IR. */
const accessOf = (ui: { toIR(): { ir: IR } }): UiAccess => deriveUiAccess(ui.toIR().ir);

/** Asserts what a UI writes and calls, printing what it was. */
const assertAccess = (actual: UiAccess, expected: UiAccess): void => {
    assert.ok(accessEqual(actual, expected), printAccess(actual));
};

const threshold = input("threshold", FloatType, variant("value", 0.5));
const notes = input("notes", StringType, variant("value", ""));
const notesPatch = input("notes_patch", PatchType(StringType));
const rows = input("rows", ArrayType(StringType), variant("value", []));

const Plan = StructType({ title: StringType, owner: StringType });
const PlansType = DictType(StringType, Plan);
const plans = record("plans", PlansType, new Map());
const reassign = mutation.reduce("reassign", plans,
    East.function([PlansType, StringType, StringType], PlansType, (_$, state, _id, _owner) => state));
const byOwner = recordIndex("by_owner", plans, {
    key: East.function([StringType, Plan], StringType, (_$, _id, plan) => plan.owner),
});

const decisions = input("decisions", ArrayType(DecisionType), variant("value", []));
const decisionsPatch = input("decisions_patch", PatchType(ArrayType(DecisionType)));
const judgements = input("judgements", JudgementsType, variant("value", new Map()));

describe("deriveUiAccess", () => {
    test("a UI that only reads what it binds writes nothing", () => {
        const ui = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const view = $.let(Data.bind(threshold));
            const paged = $.let(Data.bindPaged(rows));
            $(view.pending());
            $(view.binding.source);
            $(paged.page(0n, 10n));
            return Text.Root(East.print(view.read()));
        })));
        assertAccess(accessOf(ui), { writes: [], records: [] });
    });

    test("a UI that writes a dataset it binds writes it, from a callback holding the handle", () => {
        const ui = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const view = $.let(Data.bind(threshold));
            const raise = $.const(East.function([], NullType, ($) => {
                $(view.write(view.read().add(0.1)));
            }));
            return Button.Root("Raise", { onClick: raise });
        })));
        assertAccess(accessOf(ui), { writes: [inputPath("threshold")], records: [] });
    });

    test("a UI that calls a record's mutation and reads it through an index names both, and writes no dataset", () => {
        const ui = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const queue = $.let(Data.bindPaged(plans, { index: byOwner }));
            const bound = $.let(Record.bind(plans, [reassign]));
            const take = $.const(East.function([], NullType, ($) => {
                $(bound.mutate.reassign("p-1", "me"));
            }));
            const window = $.let(queue.page(0n, 50n));
            return Button.Root("Take", { onClick: take, loading: window.hasTag("none") });
        })));
        const string = toEastTypeValue(StringType);
        assertAccess(accessOf(ui), {
            writes: [],
            records: [{ name: "plans", mutations: [{ name: "reassign", argTypes: [string, string] }], indexes: ["by_owner"] }],
        });
    });

    test("a record paged through no index is named, with nothing it calls", () => {
        const ui = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const paged = $.let(Data.bindPaged(plans));
            return Text.Root(East.print(paged.page(0n, 10n).hasTag("some")));
        })));
        assertAccess(accessOf(ui), { writes: [], records: [{ name: "plans", mutations: [], indexes: [] }] });
    });
});

describe("deriveUiAccess: a binding's mode and patch dataset say what its handle writes", () => {
    test("a staged binding's write only stages, and its commit writes the source", () => {
        const staging = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const view = $.let(Data.bind(notes, { mode: "staged" }));
            const onClick = $.const(East.function([], NullType, ($) => { $(view.write("draft")); }));
            return Button.Root("Stage", { onClick });
        })));
        assertAccess(accessOf(staging), { writes: [], records: [] });

        const committing = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const view = $.let(Data.bind(notes, { mode: "staged" }));
            const onClick = $.const(East.function([], NullType, ($) => {
                $(view.write("draft"));
                $(view.commit());
            }));
            return Button.Root("Save", { onClick });
        })));
        assertAccess(accessOf(committing), { writes: [inputPath("notes")], records: [] });
    });

    test("a direct binding with a patch dataset writes the patch, and its commit the source as well", () => {
        const writing = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const view = $.let(Data.bind(notes, { patch: notesPatch }));
            const onClick = $.const(East.function([], NullType, ($) => { $(view.write("draft")); }));
            return Button.Root("Edit", { onClick });
        })));
        assertAccess(accessOf(writing), { writes: [inputPath("notes_patch")], records: [] });

        const committing = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const view = $.let(Data.bind(notes, { patch: notesPatch }));
            const onClick = $.const(East.function([], NullType, ($) => { $(view.commit()); }));
            return Button.Root("Apply", { onClick });
        })));
        assertAccess(accessOf(committing), { writes: [inputPath("notes_patch"), inputPath("notes")], records: [] });
    });

    test("a staged binding with a patch dataset commits to the patch alone", () => {
        const ui = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const view = $.let(Data.bind(notes, { mode: "staged", patch: notesPatch }));
            const onClick = $.const(East.function([], NullType, ($) => {
                $(view.write("draft"));
                $(view.commit());
            }));
            return Button.Root("Save", { onClick });
        })));
        assertAccess(accessOf(ui), { writes: [inputPath("notes_patch")], records: [] });
    });
});

describe("deriveUiAccess: a handle handed on", () => {
    test("a handle passed to a function, or its binding handed on, may write all it allows", () => {
        const passed = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const view = $.let(Data.bind(notes));
            const clear = $.const(East.function([DataBindHandleType(StringType)], NullType, ($, handle) => {
                $(handle.write(""));
            }));
            const onClick = $.const(East.function([], NullType, ($) => { $(clear(view)); }));
            return Button.Root("Clear", { onClick });
        })));
        assertAccess(accessOf(passed), { writes: [inputPath("notes")], records: [] });

        const handedOn = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const view = $.let(Data.bind(notes, { patch: notesPatch }));
            $(view.binding);
            return Text.Root("Review");
        })));
        assertAccess(accessOf(handedOn), { writes: [inputPath("notes_patch"), inputPath("notes")], records: [] });
    });

    test("Decision.bind writes its views through their patch datasets, and its staged judgements only once committed", () => {
        const deciding = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const views = $.let(Data.bind(decisions, { patch: decisionsPatch }));
            const staged = $.let(Data.bind(judgements, { mode: "staged" }));
            $(Decision.bind({ decisions: [views], judgements: staged }));
            return Text.Root("Decide");
        })));
        assertAccess(accessOf(deciding), { writes: [inputPath("decisions_patch")], records: [] });

        const applying = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const views = $.let(Data.bind(decisions, { patch: decisionsPatch }));
            const staged = $.let(Data.bind(judgements, { mode: "staged" }));
            $(Decision.bind({ decisions: [views], judgements: staged }));
            const apply = $.const(East.function([], NullType, ($) => { $(staged.commit()); }));
            return Button.Root("Apply", { onClick: apply });
        })));
        assertAccess(accessOf(applying), { writes: [inputPath("decisions_patch"), inputPath("judgements")], records: [] });
    });
});

describe("deriveUiAccess: the IR it reads", () => {
    test("follows each handle by name in its own scope: two callbacks each holding a `view` of their own", () => {
        const ui = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const show = $.const(East.function([], StringType, ($) => {
                const view = $.let(Data.bind(notes));
                return view.read();
            }));
            const reset = $.const(East.function([], NullType, ($) => {
                const view = $.let(Data.bind(threshold));
                $(view.write(0.0));
            }));
            $(show());
            return Button.Root("Reset", { onClick: reset });
        })));
        assertAccess(accessOf(ui), { writes: [inputPath("threshold")], records: [] });
    });

    test("reads a UI decoded off the wire as it reads the one built here", () => {
        const ui = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const view = $.let(Data.bind(threshold));
            const bound = $.let(Record.bind(plans, [reassign]));
            const queue = $.let(Data.bindPaged(plans, { index: byOwner }));
            const act = $.const(East.function([], NullType, ($) => {
                $(view.write(1.0));
                $(bound.mutate.reassign("p-1", "me"));
            }));
            return Button.Root("Act", { onClick: act, loading: queue.page(0n, 10n).hasTag("none") });
        })));
        const ir = ui.toIR().ir;
        const decoded = decodeBeast2For(IRType)(encodeBeast2For(IRType)(ir)) as IR;
        const built = deriveUiAccess(ir);
        assert.equal(built.writes.length, 1, printAccess(built));
        assert.equal(built.records.length, 1, printAccess(built));
        assertAccess(deriveUiAccess(decoded), built);
    });
});
