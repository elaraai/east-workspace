/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A composite record's binding (east-workspace#1465, R73): the sources
 * `Record.bind` names, from the record's declaration and on the handle.
 *
 * e3-ui's specs read and write no e3: a handle's descriptor reaches none.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { East, PatchType, StringType, equalFor, type ValueTypeOf } from "@elaraai/east";
import { Record } from "@elaraai/e3-ui";
import { RecordBindingSourcesType, bindingSources } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { refusingPlatform } from "../../refusing-platform.js";
import * as ex from "./record.examples.js";

type Sources = ValueTypeOf<RecordBindingSourcesType>;
const sourcesEqual = equalFor(RecordBindingSourcesType);

/** The orders' sources, as their binding names them: the ERP's, which its load writes, and the planner's own. */
const SOURCES: Sources = [{ name: "erp", external: true }, { name: "own", external: false }];

describe("a composite record's binding names its sources (R73)", () => {
    test("from the record's declaration, in the order of its key's cases, whatever order they were declared in; a plain record's names none", () => {
        assert.ok(sourcesEqual(bindingSources(ex.orders), SOURCES));
        // Declared the other way round: the same list.
        const reversed = e3.recordComposite("orders_reversed", ex.OrderType, {
            sources: (source) => ({
                own: source.mutations(StringType),
                erp: source.load(StringType, ex.ErpOrdersType, East.function([ex.ErpOrdersType, ex.ErpOrdersType], PatchType(ex.ErpOrdersType),
                    (_$, delivery, current) => East.diff(current, delivery))),
            }),
            initial: { own: new Map() },
            mutations: (mutation) => ({ patch: mutation.patch() }),
        });
        assert.ok(sourcesEqual(bindingSources(reversed), SOURCES));
        assert.ok(sourcesEqual(bindingSources(ex.jobs), []));
    });

    test("the handle carries them as binding.sources: a composite record's, and none for a plain record", () => {
        // Compiled against a platform whose every read, write and call refuses: the binding's descriptor reaches none.
        const named = East.compile(East.function([], RecordBindingSourcesType, ($) => {
            const bound = $.let(Record.bind(ex.orders));
            return bound.binding.sources;
        }), refusingPlatform);
        assert.ok(sourcesEqual(named(), SOURCES));
        const plain = East.compile(East.function([], RecordBindingSourcesType, ($) => {
            const bound = $.let(Record.bind(ex.jobs));
            return bound.binding.sources;
        }), refusingPlatform);
        assert.ok(sourcesEqual(plain(), []));
    });
});
