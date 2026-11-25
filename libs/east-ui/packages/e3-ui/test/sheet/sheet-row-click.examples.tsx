/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/e3-ui */

/**
 * A click on a grouped Sheet's row (east-workspace#1727): `onRowClick` hears
 * `Sheet.Types.RowClick(K)` — the group's key at the record's key type, the
 * clicked line's place among the group's lines (`none` on the group's own
 * band), and the column — and the page keeps it for a line over the sheet.
 */

import { ArrayType, DictType, East, FloatType, NullType, OptionType, StringType, StructType, example, none, some } from "@elaraai/east";
import { Box, Reactive, State, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Record, Sheet } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

/** One step of an order: its task and the hours it takes. */
export const RowClickStep = StructType({ task: StringType, hours: FloatType });

/** An order: its customer, and its steps — the lines of its group. */
export const RowClickOrder = StructType({ customer: StringType, steps: ArrayType(RowClickStep) });

/** The orders, keyed by their number. */
export const sheetRowClickOrders = e3.record("sheet_row_click_orders", DictType(StringType, RowClickOrder), {
    initial: new Map([
        ["SO-4401", { customer: "Harbour Joinery", steps: [
            { task: "Cut panels", hours: 3.5 },
            { task: "Edge band", hours: 1.5 },
            { task: "Drill", hours: 2.0 },
        ] }],
        ["SO-4402", { customer: "Fernside Fitouts", steps: [
            { task: "Cut panels", hours: 2.0 },
            { task: "Spray", hours: 4.0 },
        ] }],
    ]),
    mutations: (mutation) => ({
        // The orders' patch door — every Save commits through it.
        patch: mutation.patch(),
    }),
});

export const sheetRowClickGrouped = example({
    keywords: ["Sheet", "onRowClick", "row click", "click", "Sheet.Types.RowClick", "RowClick", "group", "Sheet.group", "line", "index", "band", "key", "State", "State.bind"],
    description: "A grouped Sheet whose row clicks the page hears: a click on an order's band gives the order's key; a click on one of its steps gives the order's key and the step's place among its steps, which the line over the sheet counts from one",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const orders = $.let(Record.bind(sheetRowClickOrders));
            const clicked = $.let(State.bind([OptionType(StringType)], "sheet_row_click_clicked", none));
            const shown = $.let(clicked.read());
            // The order clicked, by its key, and — on one of its steps — the step's place among them.
            const onRowClick = $.const(East.function([Sheet.Types.RowClick(StringType)], NullType, ($2, click) => {
                const where = $2.let(click.index.match({ some: (_$3, i) => East.str`step ${i.add(1n)}`, none: (_$3) => "the order" }));
                $2(clicked.write(some(East.str`${click.key} · ${where}`)));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Text>{shown.match({ some: (_$2, said) => East.str`Clicked ${said}`, none: (_$2) => "Click an order or a step" })}</Text>
                    <Box height="420px">
                        <Sheet
                            record={orders}
                            group={Sheet.group(RowClickOrder, "steps", { title: "customer", noun: { singular: "order", plural: "orders" } })}
                            onRowClick={onRowClick}
                            columns={{
                                task:  Sheet.column.text(RowClickStep, { header: "Step", width: "200px" }),
                                hours: Sheet.column.quantity(RowClickStep, { header: "Hours", width: "96px" }),
                            }}
                            name="sheetRowClickGrouped"
                        />
                    </Box>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
