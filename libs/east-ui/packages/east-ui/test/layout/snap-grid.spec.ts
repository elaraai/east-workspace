/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DictType, East, FunctionType, IntegerType, NullType, OptionType, StringType, StructType, isTypeEqual, none, some, variant,
    type ExprType,
} from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { SnapGrid, Paged, Text, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./snap-grid.examples.js";

const Tile = StructType({ id: StringType, row: StringType, span: IntegerType, height: OptionType(IntegerType) });
/** A page's rows as an editing canvas takes them — an Array, each with its identity. */
const Row = StructType({ id: StringType, row: StringType, span: IntegerType, height: OptionType(IntegerType), name: StringType });
const Rows = ArrayType(Row);
const Handle = StructType({ read: FunctionType([], Rows), write: FunctionType([Rows], NullType) });

describeEast("SnapGrid", (test) => {
    Assert.examples(test, {
        snapGridPage: ex.snapGridPage,
        snapGridWireframe: ex.snapGridWireframe,
        snapGridEditor: ex.snapGridEditor,
    });

    test("the arm is SnapGrid.Types.Root, its cells spelled with the recursion node", _ => {
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
        // align defaults to top, a cell is framed unless it says otherwise, and
        // it is named by its key and stops at its content's height.
        $(Assert.equal(value.cells.get(1n).align.getTag(), "top"));
        $(Assert.equal(value.cells.get(1n).frame, true));
        $(Assert.equal(value.cells.get(1n).label, none));
        $(Assert.equal(value.cells.get(1n).minHeight, none));
        $(Assert.equal(value.cells.get(1n).icon, none));
        $(Assert.equal(value.cells.get(1n).meta, none));
        $(Assert.equal(value.variant, none));
        $(Assert.equal(value.width, some("1440px")));
        // A view: no guides, no zoom, no editing, and no card lands.
        $(Assert.equal(value.guides, false));
        $(Assert.equal(value.zoom, none));
        $(Assert.equal(value.editing.hasTag("none"), true));
        $(Assert.equal(value.sources.size(), 0n));
        // Nor any of the editing canvas's chrome.
        $(Assert.equal(value.view, none));
        $(Assert.equal(value.apply, none));
        $(Assert.equal(value.widths.size(), 0n));
        $(Assert.equal(value.toolbar.start.size(), 0n));
        $(Assert.equal(value.toolbar.end.size(), 0n));
        $(Assert.equal(value.panes.start.hasTag("none"), true));
        $(Assert.equal(value.panes.end.hasTag("none"), true));
        $(Assert.equal(value.surface, none));
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

    test("an editing canvas hands the session its rows' identity field, the fields a gesture writes and its whole rows as the base", $ => {
        const rows = $.const([
            { id: "a", row: "top", span: 6n, height: none, name: "A" },
            { id: "b", row: "top", span: 6n, height: some(120n), name: "B" },
        ], Rows);
        const handle = $.const({
            read: East.function([], Rows, (_$) => rows),
            write: East.function([Rows], NullType, (_$) => null),
        }, Handle);
        const grid = $.let(SnapGrid.Root(handle, {
            cell: r => SnapGrid.cell({ key: r.id, row: r.row, span: r.span, height: r.height, label: some(r.name), content: Text.Root(r.name) }),
            edit: { key: "id", row: "row", span: "span", height: "height" },
            editing: { onUpdate: handle.write },
            sources: ["palette"], guides: true, zoom: 0.5,
        }));
        const value = $.let(grid.unwrap().unwrap("SnapGrid"));
        const editing = $.let(value.editing.unwrap("some"));
        $(Assert.equal(editing.idField, some("id")));
        $(Assert.equal(editing.fields.key, "id"));
        $(Assert.equal(editing.fields.row, "row"));
        $(Assert.equal(editing.fields.span, "span"));
        $(Assert.equal(editing.fields.height, some("height")));
        // No align request is taken, and no one hears the drawn rows.
        $(Assert.equal(editing.fields.align, none));
        $(Assert.equal(editing.onDrafted.hasTag("none"), true));
        $(Assert.equal(editing.keyType.hasTag("none"), true));
        $(Assert.equal(editing.snapshot.unwrap("some").decodeBeast(Rows, "v2"), rows));
        $(Assert.equal(editing.mode.getTag(), "batch"));
        // The inline adapter applies each batch; no card is taken without `create`.
        $(Assert.equal(editing.onApply.hasTag("some"), true));
        $(Assert.equal(editing.create.hasTag("none"), true));
        $(Assert.equal(value.guides, true));
        $(Assert.equal(value.zoom, some(0.5)));
        $(Assert.equal(value.sources, ["palette"]));
    });

    test("an editing canvas draws a drafted collection's cells, builds a dropped card's row and reads a row back by its identity", $ => {
        const rows = $.const([
            { id: "a", row: "top", span: 6n, height: none, name: "A" },
            { id: "b", row: "top", span: 6n, height: some(120n), name: "B" },
        ], Rows);
        const handle = $.const({
            read: East.function([], Rows, (_$) => rows),
            write: East.function([Rows], NullType, (_$) => null),
        }, Handle);
        const grid = $.let(SnapGrid.Root(handle, {
            cell: r => SnapGrid.cell({ key: r.id, row: r.row, span: r.span, height: r.height, label: some(r.name), content: Text.Root(r.name) }),
            edit: {
                key: "id", row: "row", span: "span", height: "height",
                create: ($2, card, at) => {
                    const name = $2.let(card.key.upperCase());
                    return { id: at.key, row: at.row, span: 4n, height: none, name };
                },
            },
            editing: { onUpdate: handle.write },
        }));
        const editing = $.let(grid.unwrap().unwrap("SnapGrid").editing.unwrap("some"));
        // The cells of a drafted collection, in its order — what the canvas draws a draft as.
        const drafted = $.const([
            { id: "b", row: "top", span: 6n, height: some(120n), name: "B" },
            { id: "a", row: "row-2", span: 12n, height: none, name: "A" },
        ], Rows);
        const cells = $.let(editing.derive(East.Blob.encodeBeast(drafted, "v2")));
        $(Assert.equal(cells.map((_$2, c) => c.key), ["b", "a"]));
        $(Assert.equal(cells.get(1n).row, "row-2"));
        $(Assert.equal(cells.get(0n).label, some("B")));
        // A dropped card's row, at the fresh key and the row it lands in.
        const create = $.let(editing.create.unwrap("some"));
        const made = $.let(create({ library: "palette", key: "trend" }, { key: "trend-1", row: "row-3" }));
        $(Assert.equal(made.decodeBeast(Row, "v2"), { id: "trend-1", row: "row-3", span: 4n, height: none, name: "TREND" }));
        // A row read back by its identity; an unknown one reads nothing.
        $(Assert.equal(editing.readEntry("b", 0n).unwrap("some").decodeBeast(Row, "v2").name, "B"));
        $(Assert.equal(editing.readEntry("z", 0n).hasTag("none"), true));
    });

    test("SnapGrid.uiState seeds a bound selection, and carries a change asked of the editing canvas (#996)", $ => {
        $(Assert.equal(SnapGrid.uiState(), { selected: none, request: none }));
        $(Assert.equal(SnapGrid.uiState({ selected: "a" }), { selected: some("a"), request: none }));
        $(Assert.equal(
            SnapGrid.uiState({ selected: "a", request: { key: "a", change: variant("span", 8n) } }),
            { selected: some("a"), request: some({ key: "a", change: variant("span", 8n) }) },
        ));
    });

    test("an editing canvas takes the field an align request writes, and hears the rows it draws through onDrafted (#996)", $ => {
        const Aligned = StructType({ id: StringType, row: StringType, span: IntegerType, align: SnapGrid.Types.Align, name: StringType });
        const rows = $.const([
            { id: "a", row: "top", span: 6n, align: variant("top", null), name: "A" },
            { id: "b", row: "top", span: 6n, align: variant("stretch", null), name: "B" },
        ], ArrayType(Aligned));
        const handle = $.const({
            read: East.function([], ArrayType(Aligned), (_$) => rows),
            write: East.function([ArrayType(Aligned)], NullType, (_$) => null),
        }, StructType({ read: FunctionType([], ArrayType(Aligned)), write: FunctionType([ArrayType(Aligned)], NullType) }));
        // The author hears the rows whole and in the canvas's order.
        const heard = $.const(East.function([ArrayType(Aligned)], NullType, ($2, drawn) => {
            $2(Assert.equal(drawn.map((_$3, r) => r.id), ["b", "a"]));
            $2(Assert.equal(drawn.get(1n).align.getTag(), "center"));
        }));
        const grid = $.let(SnapGrid.Root(handle, {
            cell: r => SnapGrid.cell({ key: r.id, row: r.row, span: r.span, align: r.align, content: Text.Root(r.name) }),
            edit: { key: "id", row: "row", span: "span", align: "align" },
            editing: { onUpdate: handle.write, onDrafted: heard },
        }));
        const editing = $.let(grid.unwrap().unwrap("SnapGrid").editing.unwrap("some"));
        $(Assert.equal(editing.fields.align, some("align")));
        $(Assert.equal(editing.fields.height, none));
        const drawn = $.const([
            { id: "b", row: "top", span: 6n, align: variant("stretch", null), name: "B" },
            { id: "a", row: "row-2", span: 12n, align: variant("center", null), name: "A" },
        ], ArrayType(Aligned));
        $(editing.onDrafted.unwrap("some")(East.Blob.encodeBeast(drawn, "v2")));
    });

    test("SnapGrid.viewState seeds a bound design width and zoom (#995)", $ => {
        $(Assert.equal(SnapGrid.viewState(), { width: none, zoom: none }));
        $(Assert.equal(SnapGrid.viewState({ width: "1024px", zoom: 0.8 }), { width: some("1024px"), zoom: some(0.8) }));
    });

    test("the editing canvas's chrome (#995): the design widths, the bound view, the host's toolbar items and panes, the surface, and each cell's icon and meta", $ => {
        const rows = $.const([{ id: "a", row: "top", span: 12n, height: none, name: "A" }], Rows);
        const handle = $.const({
            read: East.function([], Rows, (_$) => rows),
            write: East.function([Rows], NullType, (_$) => null),
        }, Handle);
        const view = $.const({
            read: East.function([], SnapGrid.Types.ViewState, (_$) => SnapGrid.viewState()),
            write: East.function([SnapGrid.Types.ViewState], NullType, (_$) => null),
            has: East.function([], BooleanType, (_$) => false),
        }, StructType({
            read: FunctionType([], SnapGrid.Types.ViewState),
            write: FunctionType([SnapGrid.Types.ViewState], NullType),
            has: FunctionType([], BooleanType),
        }));
        const grid = $.let(SnapGrid.Root(handle, {
            cell: r => SnapGrid.cell({
                key: r.id, row: r.row, span: r.span, label: some(r.name),
                icon: some("chart-area"), meta: some(East.str`${r.id} · sales_daily`), content: Text.Root(r.name),
            }),
            edit: { key: "id", row: "row", span: "span" },
            editing: { onUpdate: handle.write },
            view,
            widths: [{ label: "Desktop", icon: "desktop", width: "1440px" }, { label: "Tablet", width: "1024px" }],
            toolbar: { start: [Text.Root("Draft")], end: [Text.Root("Preview"), Text.Root("Publish")] },
            panes: { start: Text.Root("Palette") },
            surface: "shell",
        }));
        const value = $.let(grid.unwrap().unwrap("SnapGrid"));
        $(Assert.equal(value.cells.get(0n).icon, some("chart-area")));
        $(Assert.equal(value.cells.get(0n).meta, some("a · sales_daily")));
        $(Assert.equal(value.view.hasTag("some"), true));
        $(Assert.equal(value.widths, [
            { label: "Desktop", icon: some("desktop"), width: "1440px" },
            { label: "Tablet", icon: none, width: "1024px" },
        ]));
        $(Assert.equal(value.toolbar.start.size(), 1n));
        $(Assert.equal(value.toolbar.end.size(), 2n));
        $(Assert.equal(value.panes.start.hasTag("some"), true));
        $(Assert.equal(value.panes.end.hasTag("none"), true));
        $(Assert.equal(value.surface.unwrap("some").getTag(), "shell"));
    });

    test("an editing canvas takes a bound Apply request, which a screen asks it for through (#998)", $ => {
        const rows = $.const([{ id: "a", row: "top", span: 12n, height: none, name: "A" }], Rows);
        const handle = $.const({
            read: East.function([], Rows, (_$) => rows),
            write: East.function([Rows], NullType, (_$) => null),
        }, Handle);
        const apply = $.const({
            read: East.function([], SnapGrid.Types.ApplyState, (_$) => variant("asked", "publish-1")),
            write: East.function([SnapGrid.Types.ApplyState], NullType, (_$) => null),
            has: East.function([], BooleanType, (_$) => true),
        }, StructType({
            read: FunctionType([], SnapGrid.Types.ApplyState),
            write: FunctionType([SnapGrid.Types.ApplyState], NullType),
            has: FunctionType([], BooleanType),
        }));
        const grid = $.let(SnapGrid.Root(handle, {
            cell: r => SnapGrid.cell({ key: r.id, row: r.row, span: r.span, content: Text.Root(r.name) }),
            edit: { key: "id", row: "row", span: "span" },
            editing: { onUpdate: handle.write },
            apply,
        }));
        $(Assert.equal(grid.unwrap().unwrap("SnapGrid").apply.unwrap("some").read(), variant("asked", "publish-1")));
    });

    test("refuses the editing canvas's chrome on a page — it dresses the editing canvas", _ => {
        assert.throws(() => East.function([], UIComponentType, $ => {
            const tiles = $.const([{ id: "a", row: "top", span: 12n, height: none }], ArrayType(Tile));
            return SnapGrid.Root(tiles, {
                cell: t => SnapGrid.cell({ key: t.id, row: t.row, span: t.span, content: Text.Root(t.id) }),
                widths: [{ label: "Desktop", width: "1440px" }],
                panes: { start: Text.Root("Palette") },
            });
        }), /SnapGrid: `widths`, `panes` dress the editing canvas/);
        assert.throws(() => East.function([], UIComponentType, $ => {
            const tiles = $.const([{ id: "a", row: "top", span: 12n, height: none }], ArrayType(Tile));
            const apply = $.const({
                read: East.function([], SnapGrid.Types.ApplyState, (_$) => variant("idle", null)),
                write: East.function([SnapGrid.Types.ApplyState], NullType, (_$) => null),
                has: East.function([], BooleanType, (_$) => false),
            }, StructType({
                read: FunctionType([], SnapGrid.Types.ApplyState),
                write: FunctionType([SnapGrid.Types.ApplyState], NullType),
                has: FunctionType([], BooleanType),
            }));
            return SnapGrid.Root(tiles, {
                cell: t => SnapGrid.cell({ key: t.id, row: t.row, span: t.span, content: Text.Root(t.id) }),
                apply,
            });
        }), /SnapGrid: `apply` dress the editing canvas/);
    });

    test("refuses an editing declaration it cannot honour — a Dict, a field at another type, one half without the other, onUpdate without a handle", _ => {
        assert.throws(() => East.function([], UIComponentType, $ => {
            const rows = $.const(new Map(), DictType(StringType, Row));
            const write = $.const(East.function([DictType(StringType, Row)], NullType, (_$) => null));
            return SnapGrid.Root(rows, {
                cell: (r: ExprType<typeof Row>) => SnapGrid.cell({ key: r.id, row: r.row, span: r.span, content: Text.Root(r.name) }),
                edit: { key: "id", row: "row", span: "span" }, editing: { onApply: write },
            } as never);
        }), /editing places tiles by the order of `data`, so it takes an Array of rows/);
        assert.throws(() => East.function([], UIComponentType, $ => {
            const handle = $.const({ read: East.function([], Rows, (_$) => []), write: East.function([Rows], NullType, (_$) => null) }, Handle);
            return SnapGrid.Root(handle, {
                cell: r => SnapGrid.cell({ key: r.id, row: r.row, span: r.span, content: Text.Root(r.name) }),
                edit: { key: "span", row: "row", span: "span" } as never, editing: { onUpdate: handle.write },
            });
        }), /edit\.key names "span", which must be a String field of the rows/);
        assert.throws(() => East.function([], UIComponentType, $ => {
            const handle = $.const({ read: East.function([], Rows, (_$) => []), write: East.function([Rows], NullType, (_$) => null) }, Handle);
            return SnapGrid.Root(handle, {
                cell: r => SnapGrid.cell({ key: r.id, row: r.row, span: r.span, content: Text.Root(r.name) }),
                edit: { key: "id", row: "row", span: "span", align: "name" } as never, editing: { onUpdate: handle.write },
            });
        }), /edit\.align names "name", which must be a SnapGrid\.Types\.Align field of the rows/);
        assert.throws(() => East.function([], UIComponentType, $ => {
            const handle = $.const({ read: East.function([], Rows, (_$) => []), write: East.function([Rows], NullType, (_$) => null) }, Handle);
            const one = $.const(East.function([Row], NullType, (_$) => null));
            return SnapGrid.Root(handle, {
                cell: r => SnapGrid.cell({ key: r.id, row: r.row, span: r.span, content: Text.Root(r.name) }),
                edit: { key: "id", row: "row", span: "span" }, editing: { onUpdate: handle.write, onDrafted: one },
            });
        }), /editing\.onDrafted must be an East function over the whole Array<R> the canvas draws, returning Null/);
        assert.throws(() => East.function([], UIComponentType, $ => {
            const handle = $.const({ read: East.function([], Rows, (_$) => []), write: East.function([Rows], NullType, (_$) => null) }, Handle);
            return SnapGrid.Root(handle, {
                cell: r => SnapGrid.cell({ key: r.id, row: r.row, span: r.span, content: Text.Root(r.name) }),
                edit: { key: "id", row: "row", span: "span" },
            });
        }), /give both, or neither/);
        assert.throws(() => East.function([], UIComponentType, $ => {
            const rows = $.const([], Rows);
            const write = $.const(East.function([Rows], NullType, (_$) => null));
            return SnapGrid.Root(rows, {
                cell: r => SnapGrid.cell({ key: r.id, row: r.row, span: r.span, content: Text.Root(r.name) }),
                edit: { key: "id", row: "row", span: "span" }, editing: { onUpdate: write },
            });
        }), /editing\.onUpdate requires data=\{liveHandle\}/);
    });
}, { platformFns: TestImpl });
