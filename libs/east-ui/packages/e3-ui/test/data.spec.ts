/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, FloatType, NullType, variant } from "@elaraai/east";
import { Reactive, Stat, Button, UIComponentType } from "@elaraai/east-ui/internal";
import { Data } from "@elaraai/e3-ui";
import * as ex from "./data.examples.js";

describeEast("Data", (test) => {
    Assert.examples(test, {
        dataBindFloat: ex.dataBindFloat,
        dataBindSliderWriteback: ex.dataBindSliderWriteback,
        dataBindInteger: ex.dataBindInteger,
        dataBindStringReset: ex.dataBindStringReset,
        dataBindHasGuard: ex.dataBindHasGuard,
        dataBindStagedFloat: ex.dataBindStagedFloat,
        dataBindStagedSliderWrite: ex.dataBindStagedSliderWrite,
        dataBindStagedCommitDiscard: ex.dataBindStagedCommitDiscard,
        dataBindStagedOriginalVsRead: ex.dataBindStagedOriginalVsRead,
    });

    test("Data.bind exposes a read closure inside Reactive.Root", $ => {
        // Path is a JS-side literal — `Data.bind` requires this so
        // manifest derivation can preload it.
        const path = [variant("field", "inputs"), variant("field", "x")];
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const bound = $.let(Data.bind([FloatType], path));
            const value = $.let(bound.read());
            return Stat.Root({ label: "X", value: East.print(value) });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("Data.bind exposes a write closure inside Reactive.Root", $ => {
        const path = [variant("field", "inputs"), variant("field", "x")];
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const bound = $.let(Data.bind([FloatType], path));
            const reset = $.const(East.function([], NullType, $ => {
                $(bound.write(0.0));
            }));
            return Button.Root("Reset", { onClick: reset });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });
}, { platformFns: TestImpl });
