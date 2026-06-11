/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { East, FloatType, equalFor, variant } from "@elaraai/east";
import { TreePathType } from "@elaraai/e3-types";
import { input } from "@elaraai/e3";
import { Reactive, UIComponentType, Text } from "@elaraai/east-ui/internal";

import { decodeManifest, DataManifestType, Data } from "@elaraai/e3-ui";
import { ui } from "@elaraai/e3-ui";

const pathEqual = equalFor(TreePathType);
const manifestEqual = equalFor(DataManifestType);

const blankUI = East.function([], UIComponentType, (_$) => Text.Root("hello"));

describe("ui()", () => {
    test("returns a TaskDef with kind='task' and taskKind='ui'", () => {
        const dashboard = ui("dashboard", [], blankUI);
        assert.equal(dashboard.kind, "task");
        assert.equal(dashboard.taskKind, "ui");
        assert.equal(dashboard.name, "dashboard");
    });

    test("custom runner flows through to the command IR", () => {
        const def = ui("with_default_runner", [], blankUI);
        const custom = ui("with_custom_runner", [], blankUI, {
            runner: { runtime: "custom", command: ["east-c", "run", "--debug"] },
        });
        const replacer = (_: string, v: unknown) => typeof v === "bigint" ? `${v}n` : v;
        assert.notEqual(
            JSON.stringify(def.command, replacer),
            JSON.stringify(custom.command, replacer),
            "expected command IR to differ when runner changes",
        );
    });

    test("derives an empty manifest when fn does not call Data.bind and no inputs", () => {
        const dashboard = ui("dashboard", [], blankUI);
        assert.ok(dashboard.metadata, "metadata should be set");
        assert.ok(manifestEqual(decodeManifest(dashboard.metadata), { paths: [] }),
            "expected empty manifest");
    });

    test("compute-time inputs land in manifest paths", () => {
        const threshold = input("threshold", FloatType, 100.0);
        const dashboard = ui("dashboard", [threshold],
            East.function([FloatType], UIComponentType, (_$, _t) => Text.Root("hi"))
        );
        const manifest = decodeManifest(dashboard.metadata!);
        assert.equal(manifest.paths.length, 1);
        assert.ok(pathEqual(manifest.paths[0]!,
            [variant("field", "inputs"), variant("field", "threshold")]));
    });

    test("derives paths from Data.bind() usage", () => {
        const threshold = input("threshold", FloatType, 100.0);
        const dashboard = ui("dashboard", [], East.function([], UIComponentType, (_$) =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const t = $.let(Data.bind([FloatType], threshold.path));
                const v = $.let(t.read());
                return Text.Root(East.print(v));
            }))
        ));
        const manifest = decodeManifest(dashboard.metadata!);
        assert.equal(manifest.paths.length, 1);
        assert.ok(pathEqual(manifest.paths[0]!,
            [variant("field", "inputs"), variant("field", "threshold")]));
    });

    test("compute-time inputs and reactive paths union without duplicates", () => {
        const threshold = input("threshold", FloatType, 100.0);
        const dashboard = ui("dashboard", [threshold],
            East.function([FloatType], UIComponentType, (_$, _t) =>
                Reactive.Root(East.function([], UIComponentType, $ => {
                    const t = $.let(Data.bind([FloatType], threshold.path));
                    return Text.Root(East.print($.let(t.read())));
                }))
            )
        );
        const manifest = decodeManifest(dashboard.metadata!);
        assert.equal(manifest.paths.length, 1, "expected dedupe");
    });

    test("exposes an output dataset typed as UIComponentType", () => {
        const dashboard = ui("dashboard", [], blankUI);
        assert.equal(dashboard.output.kind, "dataset");
        assert.ok(dashboard.output.type, "output.type should be set");
    });
});
