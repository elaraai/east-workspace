/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, TestImpl } from "@elaraai/east-node-std";
import { East, FloatType, equalFor, variant } from "@elaraai/east";
import { TreePathType } from "@elaraai/e3-types";
import { input } from "@elaraai/e3";
import { Reactive, UIComponentType, Text } from "@elaraai/east-ui";

import { decodeManifest, DataManifestType, Data } from "@elaraai/e3-ui";
import { ui } from "@elaraai/e3-ui/ui";

const pathEqual = equalFor(TreePathType);
const manifestEqual = equalFor(DataManifestType);

const blankUI = East.function([], UIComponentType, (_$) => Text.Root("hello"));

describeEast("ui()", (test) => {
    test("returns a TaskDef with kind='task' and taskKind='ui'", _ => {
        const dashboard = ui("dashboard", [], blankUI);
        if (dashboard.kind !== "task") throw new Error(`kind=${dashboard.kind}`);
        if (dashboard.taskKind !== "ui") throw new Error(`taskKind=${dashboard.taskKind}`);
        if (dashboard.name !== "dashboard") throw new Error(`name=${dashboard.name}`);
    });

    test("custom runner flows through to the command IR", _ => {
        const def = ui("with_default_runner", [], blankUI);
        const custom = ui("with_custom_runner", [], blankUI, {
            runner: ["east-c", "run", "--debug"],
        });
        const replacer = (_: string, v: unknown) => typeof v === "bigint" ? `${v}n` : v;
        if (JSON.stringify(def.command, replacer) === JSON.stringify(custom.command, replacer)) {
            throw new Error("expected command IR to differ when runner changes");
        }
    });

    test("derives an empty manifest when fn does not call Data.bind and no inputs", _ => {
        const dashboard = ui("dashboard", [], blankUI);
        if (!dashboard.metadata) throw new Error("metadata should be set");
        if (!manifestEqual(decodeManifest(dashboard.metadata), { paths: [] })) {
            throw new Error("expected empty manifest");
        }
    });

    test("compute-time inputs land in manifest paths", _ => {
        const threshold = input("threshold", FloatType, 100.0);
        const dashboard = ui("dashboard", [threshold],
            East.function([FloatType], UIComponentType, (_$, _t) => Text.Root("hi"))
        );
        const manifest = decodeManifest(dashboard.metadata!);
        if (manifest.paths.length !== 1) throw new Error(`paths.length=${manifest.paths.length}`);
        if (!pathEqual(manifest.paths[0]!, [variant("field", "inputs"), variant("field", "threshold")])) {
            throw new Error("paths[0] mismatch");
        }
    });

    test("derives paths from Data.bind() usage", _ => {
        const threshold = input("threshold", FloatType, 100.0);
        const dashboard = ui("dashboard", [], East.function([], UIComponentType, (_$) =>
            Reactive.Root(East.function([], UIComponentType, $ => {
                const t = $.let(Data.bind([FloatType], threshold.path));
                const v = $.let(t.read());
                return Text.Root(East.print(v));
            }))
        ));
        const manifest = decodeManifest(dashboard.metadata!);
        if (manifest.paths.length !== 1) throw new Error(`paths.length=${manifest.paths.length}`);
        if (!pathEqual(manifest.paths[0]!, [variant("field", "inputs"), variant("field", "threshold")])) {
            throw new Error("paths[0] mismatch");
        }
    });

    test("compute-time inputs and reactive paths union without duplicates", _ => {
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
        if (manifest.paths.length !== 1) throw new Error(`paths.length=${manifest.paths.length} (expected dedupe)`);
    });

    test("exposes an output dataset typed as UIComponentType", _ => {
        const dashboard = ui("dashboard", [], blankUI);
        if (dashboard.output.kind !== "dataset") throw new Error(`output.kind=${dashboard.output.kind}`);
        if (!dashboard.output.type) throw new Error("output.type should be set");
    });
}, { platformFns: TestImpl });
