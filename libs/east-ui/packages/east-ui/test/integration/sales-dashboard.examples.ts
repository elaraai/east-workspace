/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import {
    ArrayType, BooleanType, DictType, East, FloatType, IntegerType, NullType, StringType,
    StructType, VariantType, example, variant,
} from "@elaraai/east";
import {
    Badge, Box, Chart, Reactive, Select, Stack, State, Table, Tag, Text, UIComponentType,
} from "@elaraai/east-ui";

const StatusType = VariantType({
    pending: NullType,
    processing: NullType,
    shipped: NullType,
    delivered: NullType,
    cancelled: NullType,
});

const TierType = VariantType({
    bronze: NullType,
    silver: NullType,
    gold: NullType,
    platinum: NullType,
});

const SeverityType = VariantType({
    info: NullType,
    warn: NullType,
    error: NullType,
});

const AlertType = StructType({
    severity: SeverityType,
    message: StringType,
});

const CustomerType = StructType({
    name: StringType,
    tier: TierType,
});

const OrderType = StructType({
    id: StringType,
    customer: CustomerType,
    region: StringType,
    category: StringType,
    status: StatusType,
    revenue: FloatType,
    margin: FloatType,
    items: ArrayType(StringType),
    tags: ArrayType(StringType),
    alerts: ArrayType(AlertType),
    month: IntegerType,
});

const MonthAggType = StructType({
    month: IntegerType,
    revenue: FloatType,
    margin: FloatType,
    orders: IntegerType,
});

export const salesDashboardComplex = example({
    keywords: [
        "Table", "Chart", "Composed", "Select", "Reactive", "State",
        "filter", "dashboard", "for", "loop", "complex", "business",
        "Badge", "Tag", "VStack", "rendered cells", "frozen columns",
    ],
    description:
        "Sales dashboard: 400 generated orders, region + category selects drive a composed chart and a rich table",
    fn: East.function([], UIComponentType, ($) => {
        const regionList = $.const(
            ["North", "South", "East", "West"],
            ArrayType(StringType),
        );
        const categoryList = $.const(
            ["Electronics", "Apparel", "Home", "Food", "Books"],
            ArrayType(StringType),
        );
        const tierList = $.const(
            [
                variant("bronze", null),
                variant("silver", null),
                variant("gold", null),
                variant("platinum", null),
            ],
            ArrayType(TierType),
        );
        const statusList = $.const(
            [
                variant("pending", null),
                variant("processing", null),
                variant("shipped", null),
                variant("delivered", null),
                variant("cancelled", null),
            ],
            ArrayType(StatusType),
        );

        const orders = $.let([], ArrayType(OrderType));
        $.for(East.Array.range(0n, 400n), ($, i) => {
            const region = $.let(regionList.get(i.remainder(4n)), StringType);
            const category = $.let(categoryList.get(i.remainder(5n)), StringType);
            const tier = $.let(tierList.get(i.remainder(4n)), TierType);
            const status = $.let(statusList.get(i.remainder(5n)), StatusType);
            const month = $.let(i.remainder(12n).add(1n), IntegerType);
            const revenue = $.let(
                i.toFloat().multiply(137.0).remainder(48500.0).add(750.0),
                FloatType,
            );
            const margin = $.let(
                revenue.multiply(0.18).subtract(i.toFloat().remainder(900.0)),
                FloatType,
            );

            const items = $.let([], ArrayType(StringType));
            const nItems = $.let(i.remainder(4n).add(1n), IntegerType);
            $.for(East.Array.range(0n, nItems), ($, j) => {
                $(items.pushLast(East.str`SKU-${i}-${j}`));
            });

            const tags = $.let([], ArrayType(StringType));
            $.if(i.remainder(3n).equals(0n), $ => { $(tags.pushLast("new")); });
            $.if(i.remainder(7n).equals(0n), $ => { $(tags.pushLast("priority")); });
            $.if(margin.greaterThan(3000.0), $ => { $(tags.pushLast("high-margin")); });
            $.if(tier.hasTag("platinum"), $ => { $(tags.pushLast("vip")); });
            $.if(i.remainder(13n).equals(0n), $ => { $(tags.pushLast("backorder")); });

            const alerts = $.let([], ArrayType(AlertType));
            $.if(status.hasTag("cancelled"), $ => {
                $(alerts.pushLast({
                    severity: East.value(variant("error", null), SeverityType),
                    message: "Order cancelled",
                }));
            });
            $.if(margin.lessThan(0.0), $ => {
                $(alerts.pushLast({
                    severity: East.value(variant("error", null), SeverityType),
                    message: "Negative margin",
                }));
            });
            $.if(i.remainder(11n).equals(0n), $ => {
                $(alerts.pushLast({
                    severity: East.value(variant("warn", null), SeverityType),
                    message: "Payment overdue",
                }));
            });
            $.if(i.remainder(17n).equals(0n), $ => {
                $(alerts.pushLast({
                    severity: East.value(variant("info", null), SeverityType),
                    message: "Follow-up due",
                }));
            });

            $(orders.pushLast({
                id: East.str`ORD-${i}`,
                customer: { name: East.str`Customer ${i}`, tier },
                region,
                category,
                status,
                revenue,
                margin,
                items,
                tags,
                alerts,
                month,
            }));
        });

        return Reactive.Root(East.function([], UIComponentType, $ => {
            const regionBind = $.let(State.bind([StringType], "sales_region", ""));
            const categoryBind = $.let(State.bind([StringType], "sales_category", ""));
            const region = $.let(regionBind.read(), StringType);
            const category = $.let(categoryBind.read(), StringType);

            // Filter orders via $.for (closure over outer `orders`)
            const filtered = $.let([], ArrayType(OrderType));
            $.for(orders, ($, o) => {
                const regionOk = $.let(region.length().equals(0n).ifElse(
                    _$ => true,
                    _$ => East.equal(o.region, region),
                ), BooleanType);
                const catOk = $.let(category.length().equals(0n).ifElse(
                    _$ => true,
                    _$ => East.equal(o.category, category),
                ), BooleanType);
                $.if(regionOk.and(_$ => catOk), $ => {
                    $(filtered.pushLast(o));
                });
            });

            // Aggregate by month (1..12) for the chart.
            const revenueByMonth = $.let(new Map(), DictType(IntegerType, FloatType));
            const marginByMonth = $.let(new Map(), DictType(IntegerType, FloatType));
            const countByMonth = $.let(new Map(), DictType(IntegerType, IntegerType));
            $.for(East.Array.range(1n, 13n), ($, m) => {
                $(revenueByMonth.insert(m, 0.0));
                $(marginByMonth.insert(m, 0.0));
                $(countByMonth.insert(m, 0n));
            });
            $.for(filtered, ($, o) => {
                $(revenueByMonth.update(o.month, revenueByMonth.get(o.month).add(o.revenue)));
                $(marginByMonth.update(o.month, marginByMonth.get(o.month).add(o.margin)));
                $(countByMonth.update(o.month, countByMonth.get(o.month).add(1n)));
            });
            const chartData = $.let([], ArrayType(MonthAggType));
            $.for(East.Array.range(1n, 13n), ($, m) => {
                $(chartData.pushLast({
                    month: m,
                    revenue: revenueByMonth.get(m),
                    margin: marginByMonth.get(m),
                    orders: countByMonth.get(m),
                }));
            });

            const onRegionChange = $.const(East.function(
                [StringType], NullType,
                ($, v) => { $(regionBind.write(v)); },
            ));
            const onCategoryChange = $.const(East.function(
                [StringType], NullType,
                ($, v) => { $(categoryBind.write(v)); },
            ));

            return Stack.VStack([
                // Filter bar
                Stack.HStack([
                    Select.Root(region, [
                        Select.Item("", "All regions"),
                        Select.Item("North", "North"),
                        Select.Item("South", "South"),
                        Select.Item("East", "East"),
                        Select.Item("West", "West"),
                    ], { placeholder: "Region", onChange: onRegionChange }),
                    Select.Root(category, [
                        Select.Item("", "All categories"),
                        Select.Item("Electronics", "Electronics"),
                        Select.Item("Apparel", "Apparel"),
                        Select.Item("Home", "Home"),
                        Select.Item("Food", "Food"),
                        Select.Item("Books", "Books"),
                    ], { placeholder: "Category", onChange: onCategoryChange }),
                    Badge.Root(
                        East.str`${East.print(filtered.length())} orders`,
                        { colorPalette: "blue", variant: "subtle" },
                    ),
                ], { gap: "3", align: "center" }),

                // Composed chart: revenue bars, margin line, order count on right axis
                Box.Root([
                    Chart.Composed(chartData, {
                        xAxis: { dataKey: "month", label: "Month" },
                        series: {
                            revenue: { type: "bar", color: "teal.solid" },
                            margin: { type: "line", color: "purple.solid", strokeWidth: 2n, showDots: true },
                            orders: {
                                type: "line",
                                color: "orange.solid",
                                strokeWidth: 1n,
                                strokeDasharray: "4 3",
                                yAxisId: "right",
                            },
                        },
                        yAxis: { label: "Revenue / Margin ($)" },
                        yAxis2: { label: "Orders" },
                        grid: { show: true },
                        tooltip: { show: true },
                        legend: { show: true },
                    }),
                ], { height: "280px", width: "100%" }),

                // Rich, 400-row virtualized table with per-cell renders
                Table.Root(
                    filtered,
                    {
                        id: {
                            header: "Order",
                            width: "110px",
                        },
                        customer: {
                            header: "Customer",
                            width: "240px",
                            value: v => v.name,
                            render: East.function(
                                [Table.Types.CellRenderContext],
                                UIComponentType,
                                ($, ctx) => {
                                    const row = $.let(filtered.get(ctx.rowIndex), OrderType);
                                    return Stack.HStack([
                                        Text.Root(row.customer.name, { fontWeight: "semibold" }),
                                        row.customer.tier.match({
                                            bronze: _$ => Badge.Root("Bronze", { colorPalette: "orange", variant: "subtle" }),
                                            silver: _$ => Badge.Root("Silver", { colorPalette: "gray", variant: "subtle" }),
                                            gold: _$ => Badge.Root("Gold", { colorPalette: "yellow", variant: "solid" }),
                                            platinum: _$ => Badge.Root("Platinum", { colorPalette: "purple", variant: "solid" }),
                                        }),
                                    ], { gap: "2", align: "center" });
                                },
                            ),
                        },
                        region: { header: "Region", width: "110px" },
                        category: { header: "Category", width: "130px" },
                        status: {
                            header: "Status",
                            width: "130px",
                            value: v => v.getTag(),
                            render: East.function(
                                [Table.Types.CellRenderContext],
                                UIComponentType,
                                ($, ctx) => {
                                    const row = $.let(filtered.get(ctx.rowIndex), OrderType);
                                    return row.status.match({
                                        pending: _$ => Badge.Root("Pending", { colorPalette: "gray", variant: "subtle" }),
                                        processing: _$ => Badge.Root("Processing", { colorPalette: "blue", variant: "subtle" }),
                                        shipped: _$ => Badge.Root("Shipped", { colorPalette: "purple", variant: "solid" }),
                                        delivered: _$ => Badge.Root("Delivered", { colorPalette: "green", variant: "solid" }),
                                        cancelled: _$ => Badge.Root("Cancelled", { colorPalette: "red", variant: "solid" }),
                                    });
                                },
                            ),
                        },
                        revenue: {
                            header: "Revenue",
                            width: "130px",
                            render: East.function(
                                [Table.Types.CellRenderContext],
                                UIComponentType,
                                ($, ctx) => {
                                    const row = $.let(filtered.get(ctx.rowIndex), OrderType);
                                    return Text.Root(
                                        East.str`$${East.Float.printCommaSeperated(row.revenue, 0n)}`,
                                        { textAlign: "right", fontWeight: "medium" },
                                    );
                                },
                            ),
                        },
                        margin: {
                            header: "Margin",
                            width: "140px",
                            render: East.function(
                                [Table.Types.CellRenderContext],
                                UIComponentType,
                                ($, ctx) => {
                                    const row = $.let(filtered.get(ctx.rowIndex), OrderType);
                                    return row.margin.greaterThan(0.0).ifElse(
                                        _$ => Badge.Root(
                                            East.str`$${East.Float.printCommaSeperated(row.margin, 0n)}`,
                                            { colorPalette: "green", variant: "subtle" },
                                        ),
                                        _$ => Badge.Root(
                                            East.str`$${East.Float.printCommaSeperated(row.margin, 0n)}`,
                                            { colorPalette: "red", variant: "solid" },
                                        ),
                                    );
                                },
                            ),
                        },
                        items: {
                            header: "Items",
                            width: "220px",
                            value: v => v.size(),
                            render: East.function(
                                [Table.Types.CellRenderContext],
                                UIComponentType,
                                ($, ctx) => {
                                    const row = $.let(filtered.get(ctx.rowIndex), OrderType);
                                    return Stack.HStack(
                                        row.items.map(($, s) => Tag.Root(s)),
                                        { gap: "1", wrap: "wrap" },
                                    );
                                },
                            ),
                        },
                        tags: {
                            header: "Tags",
                            width: "220px",
                            value: v => v.size(),
                            render: East.function(
                                [Table.Types.CellRenderContext],
                                UIComponentType,
                                ($, ctx) => {
                                    const row = $.let(filtered.get(ctx.rowIndex), OrderType);
                                    return Stack.HStack(
                                        row.tags.map(($, t) => Badge.Root(t, { colorPalette: "cyan", variant: "subtle" })),
                                        { gap: "1", wrap: "wrap" },
                                    );
                                },
                            ),
                        },
                        alerts: {
                            header: "Alerts",
                            width: "260px",
                            value: v => v.size(),
                            render: East.function(
                                [Table.Types.CellRenderContext],
                                UIComponentType,
                                ($, ctx) => {
                                    const row = $.let(filtered.get(ctx.rowIndex), OrderType);
                                    return Stack.HStack(
                                        row.alerts.map(($, a) => a.severity.match({
                                            info: _$ => Badge.Root(a.message, { colorPalette: "blue", variant: "subtle" }),
                                            warn: _$ => Badge.Root(a.message, { colorPalette: "orange", variant: "solid" }),
                                            error: _$ => Badge.Root(a.message, { colorPalette: "red", variant: "solid" }),
                                        })),
                                        { gap: "1", wrap: "wrap" },
                                    );
                                },
                            ),
                        },
                        month: { header: "Month", width: "90px" },
                    },
                    {
                        variant: "line",
                        striped: true,
                        interactive: true,
                        stickyHeader: true,
                        height: "300px",
                        frozen: ["id", "customer"],
                    },
                ),
            ], { gap: "4", align: "stretch" });
        }));
    }),
    inputs: [],
});
