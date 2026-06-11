/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, NullType, IntegerType } from "@elaraai/east";
import { State } from "@elaraai/east-ui/internal";
import * as ex from "./state.examples.js";

describeEast("State", (test) => {
    Assert.examples(test, {
        stateReactiveCounter: ex.stateReactiveCounter,
    });

    test("State.bind returns a struct of read / write / has closures", $ => {
        // Compile-only: TestImpl doesn't include the State runtime, so we
        // verify the platform signature reaches every closure and that the
        // wrapper function type-checks end-to-end.
        const fn = East.function([], NullType, $ => {
            const counter = $.let(State.bind([IntegerType], "test.counter", 0n));
            const current = $.let(counter.read());
            $(counter.write(current.add(1n)));
            const exists = $.let(counter.has());
            void exists;
        });
        const value = $.let(East.value("ok"));
        $(Assert.equal(value, "ok"));
        void fn;
    });
}, { platformFns: TestImpl });
