/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import assert from "node:assert/strict";
import {
    ArrayType, DictType, East, FunctionType, IntegerType, OptionType, StringType, StructType, isTypeEqual, none, some,
    type ExprType,
} from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { SnapGrid, Paged, Text, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./snap-grid.examples.js";

const Tile = StructType({ id: StringType, row: StringType, span: IntegerType, height: OptionType(IntegerType) });

describeEast("SnapGrid", (test) => {
    Assert.examples(test, {
        snapGridPage: ex.snapGridPage,
        snapGridWireframe: ex.snapGridWireframe,
    });

    test("the arm's cells are SnapGrid.Types.Cell, spelled with the recursion node", _ => {
        const arm = (UIComponentType.node.cases as unknown as Record<string, StructType>)["SnapGrid"]!;
        assert.ok(isTypeEqual(arm, SnapGrid.Types.Root), "the inline SnapGrid arm and SnapGrid.Types.Root are one East type");
    });

    test("maps every row to its cell, in the order data holds them, with the defaults filled in", $ => {
        const tiles = $.const([
            { id: "a", row: "top", span: 8n, height: some(280n) },
            { id: "b", row: "top", span: 4n, height: none },
        ], ArrayType(Tile));
        const grid = $.let(SnapGrid.Root(tiles, {
            cell: t => SnapGrid.cell({ key: t.id, row: t.row, span: t.span, height: t.height, content: Text.Root(t.id) }),
            width: "1440px",
        }));
        const value = $.let(grid.unwrap().unwrap("SnapGrid"));
        $(Assert.equal(value.cells.size(), 2n));
        $(Assert.equal(value.cells.get(0n).key, "a"));
        $(Assert.equal(value.cells.get(0n).span, 8n));
        $(Assert.equal(value.cells.get(0n).height, some(280n)));
        $(Assert.equal(value.cells.get(1n).height, none));
        // align defaults to top, and a cell is framed unless it says otherwise.
        $(Assert.equal(value.cells.get(1n).align.getTag(), "top"));
        $(Assert.equal(value.cells.get(1n).frame, true));
        $(Assert.equal(value.variant, none));
        $(Assert.equal(value.width, some("1440px")));
    });

    test("a Dict's rows come in key order, and align, frame and the variant are taken as given", $ => {
        const tiles = $.const(new Map([
            ["b", { id: "b", row: "top", span: 6n, height: none }],
            ["a", { id: "a", row: "top", span: 6n, height: none }],
        ]), DictType(StringType, Tile));
        const grid = $.let(SnapGrid.Root(tiles, {
            cell: t => SnapGrid.cell({ key: t.id, row: t.row, span: t.span, align: "stretch", frame: false, content: Text.Root(t.id) }),
            variant: "wireframe",
        }));
        const value = $.let(grid.unwrap().unwrap("SnapGrid"));
        $(Assert.equal(value.cells.map((_$, c) => c.key), ["a", "b"]));
        $(Assert.equal(value.cells.get(0n).align.getTag(), "stretch"));
        $(Assert.equal(value.cells.get(0n).frame, false));
        $(Assert.equal(value.variant.unwrap("some").getTag(), "wireframe"));
    });

    test("reads a bound handle's rows where it renders", $ => {
        const handle = $.const({
            read: East.function([], ArrayType(Tile), (_$) => [{ id: "a", row: "top", span: 12n, height: none }]),
        }, StructType({ read: FunctionType([], ArrayType(Tile)) }));
        const grid = $.let(SnapGrid.Root(handle, {
            cell: t => SnapGrid.cell({ key: t.id, row: t.row, span: t.span, content: Text.Root(t.id) }),
        }));
        $(Assert.equal(grid.unwrap().unwrap("SnapGrid").cells.size(), 1n));
    });

    test("refuses a paged source — a page's tiles are held whole", _ => {
        assert.throws(() => East.function([], UIComponentType, $ => {
            const source = $.const(Paged.of("tiles", [{ id: "a", row: "top", span: 12n, height: none }] as never));
            return SnapGrid.Root(source as never, {
                cell: (t: ExprType<typeof Tile>) => SnapGrid.cell({ key: t.id, row: t.row, span: t.span, content: Text.Root(t.id) }),
            } as never);
        }), /SnapGrid: a page's tiles are held whole/);
    });
}, { platformFns: TestImpl });
