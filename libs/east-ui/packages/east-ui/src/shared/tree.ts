/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Nested rows (#954, #955) — a collection's own tree, walked in pre-order.
 *
 * A Table's and a Matrix's rows nest the way the Plan's do (#822): a row
 * carries its children, to any depth, through `tree={{ children, collapsed }}`.
 * The walk is ONE reified East function over the data — an explicit stack,
 * since depth is data (the Plan's walk, e3-ui's `plan/series.ts`) — that
 * turns the author's elements into the component's own rows, each parent
 * followed by its subtree, each with its depth.
 *
 * Not exported from the package barrel — factory-internal; the components
 * re-export the input types under their own names.
 *
 * @packageDocumentation
 */

import {
    type BlockBuilder,
    type EastType,
    type ExpandOnce,
    type ExprType,
    type FunctionType,
    type RecursiveExpr,
    type RecursiveType,
    type SubtypeExprOrValue,
    ArrayType,
    BooleanType,
    East,
    EastTypeType,
    Expr,
    IntegerType,
    StructType,
    isTypeEqual,
    printFor,
    toEastTypeValue,
} from "@elaraai/east";
import { reifyAccessor } from "./reify.js";

/**
 * A data element as a tree's accessors receive it — a recursive element as
 * its NODE, so an accessor reads its fields directly at every depth
 * (`(r) => r.lines`), as the Plan's series do.
 *
 * @typeParam S - The data's element type
 */
export type TreeNode<S> = S extends RecursiveType<infer U> ? ExpandOnce<U, S> : S;

/**
 * How a collection's rows nest — the data's own tree, to any depth.
 *
 * @remarks
 * `children` returns a row's child rows: more of the SAME row type (an `Array`
 * of the data's element type), so every row fills the same columns — a
 * `RecursiveType` row's own field (`r => r.lines`), or a lookup over flat data
 * (`r => all.filter((_$, c) => c.parent.equal(r.id))`), the data holding only
 * the top-level rows. `collapsed` says which parents start closed.
 *
 * @typeParam RowType - The row an accessor receives — a struct, or a recursive row's node
 */
export interface TreeInput<RowType extends StructType = StructType> {
    /** A row's child rows — an `Array` of the data's element type (a recursive row's own field, say). */
    children: (row: ExprType<RowType>) => Expr;
    /** Whether a parent starts collapsed — `true` for every parent, or per row. Default open. */
    collapsed?: boolean | ((row: ExprType<RowType>) => SubtypeExprOrValue<BooleanType>);
}

/** A collection's element type, resolved for its accessors. */
export interface TreeElement {
    /** The data's element type — a struct, or a recursive type whose node is one. */
    elementType: EastType;
    /** The struct every accessor receives — the element, or its node. */
    rowType: StructType;
    /** An element as the accessors receive it — its node, when recursive. */
    nodeOf: (element: ExprType<EastType>) => ExprType<StructType>;
}

/**
 * Resolves a collection's element type for its accessors: a struct as it is,
 * a recursive element through its node.
 *
 * @param component - The component, for the message (`"Table"`)
 * @param elementType - The data's element type
 * @returns The element, its row struct and the node accessor
 * @throws {Error} When the element is neither a struct nor a recursive type whose node is one
 */
export function treeElement(component: string, elementType: EastType): TreeElement {
    const recursive = (elementType as { type: string }).type === "Recursive";
    const rowType = (recursive ? (elementType as RecursiveType<StructType>).node : elementType) as StructType;
    if ((rowType as { type: string }).type !== "Struct") {
        throw new Error(
            `${component}: rows must be structs, or recursive rows whose node is a struct — got ` +
            `${(rowType as { type: string }).type}. Map the collection to a struct per row before passing it.`,
        );
    }
    const nodeOf = (element: ExprType<EastType>): ExprType<StructType> => (recursive
        ? (element as unknown as RecursiveExpr<StructType>).unwrap()
        : element) as ExprType<StructType>;
    return { elementType, rowType, nodeOf };
}

/** East's own printer over a type value — the types a build-time message names. */
const printType = printFor(EastTypeType);

/**
 * A `tree.children` accessor as a real East function: from a row to its child
 * rows, which must be more of the collection's own rows — an `Array` of its
 * element type — because every row fills the same columns.
 *
 * @param component - The component, for the message (`"Table"`)
 * @param element - The collection's element
 * @param children - The author's accessor
 * @returns The accessor, reified once
 * @throws {Error} When the accessor returns anything but an Array of the element type
 */
function childRowsOf(
    component: string,
    element: TreeElement,
    children: (row: ExprType<StructType>) => Expr,
): ExprType<FunctionType<[EastType], ArrayType<EastType>>> {
    const fn = reifyAccessor([element.elementType], (e) => children(element.nodeOf(e as ExprType<EastType>)));
    const output = (Expr.type(fn as unknown as Expr) as unknown as { output: EastType }).output;
    const want = ArrayType(element.elementType);
    if (!isTypeEqual(output, want)) {
        throw new Error(
            `${component}: \`tree.children\` returns a row's child rows — more of the ${component.toLowerCase()}'s own rows, ` +
            `${printType(toEastTypeValue(want))} — but it returned ${printType(toEastTypeValue(output))}. ` +
            "Every row fills the same columns: return a recursive row's own children, or look them up among the rows.");
    }
    return fn as unknown as ExprType<FunctionType<[EastType], ArrayType<EastType>>>;
}

/**
 * The collection's rows IN PRE-ORDER, as one East function over the data: a
 * parent, then its subtree, each row built by `rowOf` with its depth and
 * whether it starts collapsed (only a row with children ever does). Without a
 * `tree`, every element is a row at depth 0, in data order.
 *
 * @remarks
 * The tree's depth is data, so the walk is an explicit stack: a level's rows
 * go on REVERSED, so the stack pops the first of them first. Every function
 * the walk calls is reified once and bound once — a captured function
 * referenced in a loop would be re-inlined per use.
 *
 * @typeParam Row - The component's row type
 * @param component - The component, for the build-time messages (`"Table"`)
 * @param element - The collection's element ({@link treeElement})
 * @param rowType - The component's row type
 * @param rowOf - One element's row, given its depth and whether it starts collapsed
 * @param tree - How the rows nest; absent, the collection is flat
 * @returns A function from the collection to its rows
 * @throws {Error} When `tree.children` returns anything but more of the collection's rows
 */
export function preOrderRows<Row extends EastType>(
    component: string,
    element: TreeElement,
    rowType: Row,
    rowOf: ($: BlockBuilder<Row>, element: ExprType<EastType>, depth: ExprType<IntegerType>, collapsed: ExprType<BooleanType>) => SubtypeExprOrValue<Row>,
    tree: TreeInput | undefined,
): ExprType<FunctionType<[ArrayType<EastType>], ArrayType<Row>>> {
    const { elementType, nodeOf } = element;
    const rowFn = East.function(
        [elementType, IntegerType, BooleanType],
        rowType as EastType,
        ($, e, depth, collapsed) => rowOf($ as unknown as BlockBuilder<Row>, e as ExprType<EastType>, depth, collapsed) as never,
    );
    const collapsedInput = tree?.collapsed;
    const nesting = tree === undefined ? undefined : {
        children: childRowsOf(component, element, tree.children),
        collapsed: East.function([elementType], BooleanType, (_$, e) => (typeof collapsedInput === "function"
            ? East.value(collapsedInput(nodeOf(e as ExprType<EastType>)), BooleanType)
            : East.value(collapsedInput ?? false, BooleanType))),
    };
    const rowsType = ArrayType(rowType as EastType);
    const Frame = StructType({ value: elementType, depth: IntegerType });
    const Frames = ArrayType(Frame);
    const walk = East.function([ArrayType(elementType)], rowsType, ($, collection) => {
        const row = $.const(rowFn);
        const out = $.let([], rowsType);
        if (nesting === undefined) {
            $.for(collection, ($2, e) => {
                $2(out.pushLast(row(e, 0n, false)));
            });
            return out;
        }
        const kids = $.const(nesting.children);
        const fold = $.const(nesting.collapsed);
        const stack = $.let([], Frames);
        $.for(collection, ($2, e) => {
            $2(stack.pushLast(East.value({ value: e, depth: 0n }, Frame)));
        });
        $(stack.reverseInPlace());
        $.while(stack.size().greater(0n), ($2) => {
            const frame = $2.let(stack.popLast(), Frame);
            const below = $2.let(kids(frame.value), ArrayType(elementType));
            // Only a row with children folds.
            const closed = $2.let(below.size().greater(0n).and(() => fold(frame.value)), BooleanType);
            $2(out.pushLast(row(frame.value, frame.depth, closed)));
            const next = $2.let([], Frames);
            $2.for(below, ($3, e) => {
                $3(next.pushLast(East.value({ value: e, depth: frame.depth.add(1n) }, Frame)));
            });
            $2(next.reverseInPlace());
            $2(stack.append(next));
        });
        return out;
    });
    return walk as unknown as ExprType<FunctionType<[ArrayType<EastType>], ArrayType<Row>>>;
}
