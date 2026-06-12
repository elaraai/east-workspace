/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, FloatType, IntegerType, NullType, StringType } from "@elaraai/east";
import { Reactive, Stat, Button, UIComponentType } from "@elaraai/east-ui/internal";
import { Func, Data, deriveManifest, decodeManifest, ui } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";
import * as ex from "./func.examples.js";

// `Func.bind(def)` takes name and signature from the e3.function def, so the
// tests declare the package-side functions once and bind them everywhere.
const forecastDef = e3.function("forecast",
    East.function([IntegerType, FloatType], FloatType, (_$, _periods, growth) => growth));
const rebalanceDef = e3.function("rebalance",
    East.function([FloatType], FloatType, (_$, target) => target));
const describeDef = e3.function("describe",
    East.function([IntegerType], StringType, (_$, n) => East.print(n)));

describeEast("Func", (test) => {
    Assert.examples(test, {
        funcBindCall: ex.funcBindCall,
        funcBindStatus: ex.funcBindStatus,
        funcBindCancel: ex.funcBindCancel,
        funcBindSharedChannel: ex.funcBindSharedChannel,
    });

    test("Func.bind exposes a call closure inside Reactive.Root", $ => {
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const forecast = $.let(Func.bind(forecastDef));
            const run = $.const(East.function([], NullType, $ => {
                $(forecast.call(12n, 1.05));
            }));
            return Button.Root("Run", { onClick: run });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("Func.bind exposes read/status/error/pending/cancel closures", $ => {
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const describe = $.let(Func.bind(describeDef));
            const _status = $.let(describe.status());
            const _pending = $.let(describe.pending());
            const _error = $.let(describe.error());
            const _value = $.let(describe.read());
            const _cancel = $.const(describe.cancel);
            return Stat.Root({ label: "Status", value: East.print(_status) });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("binding descriptor carries the def's name", $ => {
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const forecast = $.let(Func.bind(forecastDef));
            $(Assert.equal(forecast.binding.name, "forecast"));
            return Stat.Root({ label: "Name", value: forecast.binding.name });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("Func.bind infers the signature from the FunctionDef", $ => {
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const forecast = $.let(Func.bind(forecastDef));
            const run = $.const(East.function([], NullType, $ => {
                // Positional args type-check against the def's inputTypes.
                $(forecast.call(12n, 1.05));
            }));
            void run;
            // read() is Option<Float>, from the def's outputType.
            return Stat.Root({ label: "F", value: East.print(forecast.read()) });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });
}, { platformFns: TestImpl });

describeEast("Func — manifest derivation", (test) => {
    test("deriveManifest collects bound function names", _ => {
        const fn = East.function([], UIComponentType, _$ =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const forecast = $.let(Func.bind(forecastDef));
                return Stat.Root({ label: "F", value: East.print(forecast.read()) });
            })));
        const manifest = deriveManifest(fn);
        assert.deepEqual(manifest.functions, ["forecast"]);
        assert.deepEqual(manifest.paths, []);
    });

    test("deriveManifest dedupes repeated bindings of the same name", _ => {
        const fn = East.function([], UIComponentType, _$ =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const a = $.let(Func.bind(forecastDef));
                const b = $.let(Func.bind(forecastDef));
                const c = $.let(Func.bind(rebalanceDef));
                void a; void b; void c;
                return Stat.Root({ label: "F", value: "x" });
            })));
        const manifest = deriveManifest(fn);
        assert.deepEqual([...manifest.functions].sort(), ["forecast", "rebalance"]);
    });

    test("deriveManifest collects Data.bind paths and Func.bind names together", _ => {
        const x = e3.input("x", FloatType, 0.0);
        const fn = East.function([], UIComponentType, _$ =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const bound = $.let(Data.bind(x));
                const forecast = $.let(Func.bind(forecastDef));
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
                const forecast = $.let(Func.bind(forecastDef));
                return Stat.Root({ label: "F", value: East.print(forecast.read()) });
            }))));
        assert.ok(dashboard.metadata, "metadata should be set");
        const manifest = decodeManifest(dashboard.metadata);
        assert.deepEqual(manifest.functions, ["forecast"]);
    });
}, { platformFns: TestImpl });
