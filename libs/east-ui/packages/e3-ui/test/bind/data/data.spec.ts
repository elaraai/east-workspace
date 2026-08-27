/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { ArrayType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType, type ExprType } from "@elaraai/east";
import { Reactive, Stat, Button, UIComponentType } from "@elaraai/east-ui/internal";
import { Data } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";
import * as ex from "./data.examples.js";

describeEast("Data", (test) => {
    Assert.examples(test, {
        dataBindFloat: ex.dataBindFloat,
        dataBindVariants: ex.dataBindVariants,
        dataBindStagedFloat: ex.dataBindStagedFloat,
        dataBindStagedVariants: ex.dataBindStagedVariants,
        dataBindPagedPlan: ex.dataBindPagedPlan,
    });

    // Panels — every merged example stays mounted as a captioned row (#464).
    // The mono-uppercase Text captions are the stable per-mini anchors.

    test("dataBindVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.dataBindVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 8n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "SLIDER WRITEBACK"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "INTEGER"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STRING RESET"));
        $(Assert.equal(rows.get(6n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "HAS GUARD"));
    });

    test("dataBindStagedVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.dataBindStagedVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 6n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STAGED SLIDER WRITE"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STAGED COMMIT DISCARD"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STAGED ORIGINAL VS READ"));
    });

    test("Data.bind exposes a read closure inside Reactive.Root", $ => {
        // The def carries the (statically-known) path and type — manifest
        // derivation preloads the path from the bind's literal IR node.
        const x = e3.input("x", FloatType, 0.0);
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const bound = $.let(Data.bind(x));
            const value = $.let(bound.read());
            return Stat.Root({ label: "X", value: East.print(value) });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("Data.bind exposes a write closure inside Reactive.Root", $ => {
        const x = e3.input("x", FloatType, 0.0);
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const bound = $.let(Data.bind(x));
            const reset = $.const(East.function([], NullType, $ => {
                $(bound.write(0.0));
            }));
            return Button.Root("Reset", { onClick: reset });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("Data.bindPaged exposes page + total closures typed from the DatasetDef", $ => {
        const Row = StructType({ id: StringType, v: FloatType });
        const rows = e3.input("paged_rows", ArrayType(Row), []);
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const paged = $.let(Data.bindPaged(rows));
            // page(offset, limit) is Option<Array<Row>>; total() is Option<Integer>.
            const window = $.let(paged.page(0n, 100n), OptionType(ArrayType(Row)));
            const count = $.let(paged.total(), OptionType(IntegerType));
            const shown = $.let(window.match({
                some: (_$, w) => East.print(w.length()),
                none: _$ => East.str`loading`,
            }), StringType);
            void count;
            return Stat.Root({ label: "Rows", value: shown });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });

    test("Data.bind(def) takes path and type from the DatasetDef", $ => {
        const threshold = e3.input("threshold", FloatType, 38.0);
        const root = $.let(Reactive.Root(East.function([], UIComponentType, $ => {
            const bound = $.let(Data.bind(threshold));
            // read() is Float (from the def's type); write type-checks too.
            const value = $.let(bound.read());
            const reset = $.const(East.function([], NullType, $ => {
                $(bound.write(0.0));
            }));
            void reset;
            return Stat.Root({ label: "T", value: East.print(value) });
        })));
        $(Assert.equal(root.unwrap().getTag(), "ReactiveComponent"));
    });
}, { platformFns: TestImpl });
