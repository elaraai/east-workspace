/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, FloatType, IntegerType, NullType, StringType } from "@elaraai/east";
import { Reactive, Stat, Button, UIComponentType } from "@elaraai/east-ui/internal";
import { Func, Data, deriveManifest, decodeManifest, ui } from "@elaraai/e3-ui";
import { variant } from "@elaraai/east";
import * as ex from "./func.examples.js";

describeEast("Func", (test) => {
    Assert.examples(test, {
        funcBindCall: ex.funcBindCall,
        funcBindStatus: ex.funcBindStatus,
        funcBindCancel: ex.funcBindCancel,
        funcBindSharedChannel: ex.funcBindSharedChannel,
    });

    test("Func.bind exposes a call closure inside Reactive.Root", $ => {
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const forecast = $.let(Func.bind([[IntegerType, FloatType], FloatType], "forecast"));
            const run = $.const(East.function([], NullType, $ => {
                $(forecast.call(12n, 1.05));
            }));
            return Button.Root("Run", { onClick: run });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("Func.bind exposes read/status/error/pending/cancel closures", $ => {
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const forecast = $.let(Func.bind([[IntegerType], StringType], "describe"));
            const _status = $.let(forecast.status());
            const _pending = $.let(forecast.pending());
            const _error = $.let(forecast.error());
            const _value = $.let(forecast.read());
            const _cancel = $.const(forecast.cancel);
            return Stat.Root({ label: "Status", value: East.print(_status) });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("binding descriptor carries the bound name", $ => {
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const forecast = $.let(Func.bind([[IntegerType], FloatType], "forecast"));
            return Stat.Root({ label: "Name", value: forecast.binding.name });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });
}, { platformFns: TestImpl });

describeEast("Func — JS-side validation", (test) => {
    test("Func.bind throws on an empty name", _ => {
        assert.throws(
            () => Func.bind([[IntegerType], FloatType], ""),
            /non-empty function name/,
        );
    });
}, { platformFns: TestImpl });

describeEast("Func — manifest derivation", (test) => {
    test("deriveManifest collects bound function names", _ => {
        const fn = East.function([], UIComponentType, _$ =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const forecast = $.let(Func.bind([[IntegerType, FloatType], FloatType], "forecast"));
                return Stat.Root({ label: "F", value: East.print(forecast.read()) });
            })));
        const manifest = deriveManifest(fn);
        assert.deepEqual(manifest.functions, ["forecast"]);
        assert.deepEqual(manifest.paths, []);
    });

    test("deriveManifest dedupes repeated bindings of the same name", _ => {
        const fn = East.function([], UIComponentType, _$ =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const a = $.let(Func.bind([[IntegerType], FloatType], "forecast"));
                const b = $.let(Func.bind([[IntegerType], FloatType], "forecast"));
                const c = $.let(Func.bind([[FloatType], FloatType], "rebalance"));
                void a; void b; void c;
                return Stat.Root({ label: "F", value: "x" });
            })));
        const manifest = deriveManifest(fn);
        assert.deepEqual([...manifest.functions].sort(), ["forecast", "rebalance"]);
    });

    test("deriveManifest collects Data.bind paths and Func.bind names together", _ => {
        const path = [variant("field", "inputs"), variant("field", "x")];
        const fn = East.function([], UIComponentType, _$ =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const bound = $.let(Data.bind([FloatType], path));
                const forecast = $.let(Func.bind([[IntegerType], FloatType], "forecast"));
                void forecast;
                return Stat.Root({ label: "X", value: East.print(bound.read()) });
            })));
        const manifest = deriveManifest(fn);
        assert.equal(manifest.paths.length, 1);
        assert.deepEqual(manifest.functions, ["forecast"]);
    });

    test("ui() records bound function names in the task manifest", _ => {
        const dashboard = ui("dashboard", [], East.function([], UIComponentType, _$ =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const forecast = $.let(Func.bind([[IntegerType, FloatType], FloatType], "forecast"));
                return Stat.Root({ label: "F", value: East.print(forecast.read()) });
            }))));
        assert.ok(dashboard.metadata, "metadata should be set");
        const manifest = decodeManifest(dashboard.metadata);
        assert.deepEqual(manifest.functions, ["forecast"]);
    });
}, { platformFns: TestImpl });
