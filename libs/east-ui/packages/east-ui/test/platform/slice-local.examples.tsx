/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, East, IntegerType, StringType, StructType, example } from "@elaraai/east";
import { Reactive, Slice, Table, UIComponentType, VStack } from "@elaraai/east-ui";

export const sliceLocalRows = example({
    keywords: ["Slice", "bind", "rows", "initial", "presets", "typed", "local"],
    description: "Typed local narrowing: fields and options inferred from the bound rows, with an initial choice and a named preset",
    fn: East.function([], UIComponentType, _$ => {
        const Order = StructType({ customer: StringType, status: StringType, quantity: IntegerType });
        return <Reactive>{$ => {
            const orders = $.const([
                { customer: "Alpha Press", status: "held", quantity: 20n },
                { customer: "Beta Books", status: "late", quantity: 8n },
                { customer: "Cedar Print", status: "open", quantity: 50n },
            ], ArrayType(Order));
            const slice = $.let(Slice.bind("ex.slice.local.orders", orders, {
                fields: { customer: { label: "Customer" }, status: { hints: ["held", "late", "open"] }, quantity: { label: "Quantity" } },
                search: "customer",
                initial: { status: ["held", "late"] },
                presets: [{ id: "bulk", name: "Bulk orders", where: { quantity: { gte: 10n } } }],
            }));
            return <VStack gap="3" align="stretch">
                <Slice.Rail slice={slice} affordances={["presets", "filter", "search"]} />
                <Table data={Slice.rows(slice)} columns={{ customer: { header: "Customer" }, status: { header: "Status" }, quantity: { header: "Quantity" } }} />
                <Slice.Summary slice={slice} />
            </VStack>;
        }}</Reactive>;
    }),
    inputs: [],
});
