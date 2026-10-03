/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's benchmark (#941, #1093): its data and its questions,
 * which the benchmark (`query-scale.spec.ts`) runs at scale and the
 * equivalence suite (`query-equivalence.spec.ts`) runs at a small size, one
 * unit against forced pieces. Test-only: the tarball leaves `dist/testing/`
 * out.
 *
 * The data has the shared fixture's types (`libs/east/test/query.fixture.ts`):
 * `orders`, an `Array<Order>`, and 100,000 `customers`, generated from fixed
 * seeds — the same orders at every size, the larger ones going on — and
 * `shipments`, one for each shipped order, by its id (#942): a dict that grows
 * with the orders, so a join of the two is a join of two large sides, which
 * the planner re-keys.
 *
 * @packageDocumentation
 */

import {
    ArrayType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
    none, some, toEastTypeValue, variant,
    type ValueTypeOf,
} from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import { queryRoot } from '@elaraai/e3-ui-components/query';

// ─── The data: the shared fixture's types ────────────────────────────────────

const LineType = StructType({ price: FloatType, qty: IntegerType, sku: StringType });
const StatusType = VariantType({
    cancelled: StructType({ reason: StringType }),
    pending: NullType,
    shipped: StructType({ date: DateTimeType }),
});
const OrderType = StructType({
    customer_id: StringType,
    discount: OptionType(FloatType),
    id: IntegerType,
    lines: ArrayType(LineType),
    status: StatusType,
    total: FloatType,
});
/** The orders' type. */
export const OrdersType = ArrayType(OrderType);
const CustomerType = StructType({ name: StringType, region: StringType, tier: VariantType({ gold: NullType, standard: NullType }) });
/** The customers' type, by id. */
export const CustomersType = DictType(StringType, CustomerType);
const ShipmentType = StructType({ carrier: StringType, days: IntegerType });
/** The shipments' type, by the order's id. */
export const ShipmentsType = DictType(IntegerType, ShipmentType);
/** An order. */
export type Order = ValueTypeOf<typeof OrderType>;
/** A customer. */
export type Customer = ValueTypeOf<typeof CustomerType>;
/** A shipment. */
export type Shipment = ValueTypeOf<typeof ShipmentType>;

/** The orders' path in a workspace. */
export const ORDERS: TreePath = [variant('field', 'inputs'), variant('field', 'orders')];
/** The customers' path in a workspace. */
export const CUSTOMERS: TreePath = [variant('field', 'inputs'), variant('field', 'customers')];
/** The shipments' path in a workspace. */
export const SHIPMENTS: TreePath = [variant('field', 'inputs'), variant('field', 'shipments')];
/** The root the questions are asked of: the orders, the customers and the shipments. */
export const ROOT = queryRoot([
    { name: 'orders', path: ORDERS, type: toEastTypeValue(OrdersType) },
    { name: 'customers', path: CUSTOMERS, type: toEastTypeValue(CustomersType) },
    { name: 'shipments', path: SHIPMENTS, type: toEastTypeValue(ShipmentsType) },
]);

/** The customers, and the share of them in each region. */
export const CUSTOMER_COUNT = 100_000;
export const REGIONS: readonly (readonly [region: string, share: number])[] = [
    ['NSW', 0.32], ['VIC', 0.26], ['QLD', 0.20], ['WA', 0.10], ['SA', 0.07], ['TAS', 0.02], ['ACT', 0.02], ['NT', 0.01],
];
const FIRST = ['Harbour', 'Coastline', 'Ridge', 'Southbank', 'Sunfield', 'Northgate', 'Westend', 'Ironbark', 'Riverbend', 'Granite', 'Bluegum', 'Saltbush'];
const SECOND = ['Foods', 'Retail', 'Grocers', 'Market', 'Traders', 'Supply', 'Provisions', 'Stores', 'Wholesale', 'Pantry'];
const REASONS = ['Customer request', 'Out of stock', 'Payment failed'];
const DISCOUNTS = [0.05, 0.1, 0.15];
const FIRST_SHIP_DAY_MS = Date.UTC(2025, 9, 1);
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** The total the selective queries keep above: about the 99.9th percentile, so about 0.1% of orders pass. */
export const THRESHOLD = 7850;

/** mulberry32: a 32-bit seeded generator, each draw in [0, 1). */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The catalog: 200 SKUs, cheap fasteners to dear assemblies. */
function catalog(): (readonly [sku: string, price: number])[] {
    const draw = mulberry32(941);
    return Array.from({ length: 200 }, (_, i) => {
        const cheap = draw() < 0.45;
        const price = cheap ? Math.round((0.1 + draw() * 4.8) * 100) / 100 : Math.round((5 + draw() * 120) * 100) / 100;
        return [`SKU-${String(i).padStart(4, '0')}`, price] as const;
    });
}

/** A customer's id: its index, zero-padded, so ids sort as their indexes do. */
export const customerId = (i: number): string => `C${String(i).padStart(6, '0')}`;

/**
 * The orders, ids from 1001, each with the index of its customer: a customer
 * drawn skewed (a few buy often), one to five lines, a status and a discount.
 * The first `n` of any count are the same orders.
 */
export function* orders(count: number): Generator<{ order: Order; customer: number }> {
    const draw = mulberry32(875941);
    const skus = catalog();
    for (let i = 0; i < count; i++) {
        const customer = Math.floor(CUSTOMER_COUNT * draw() ** 1.8);
        const roll = draw();
        const lineCount = roll < 0.35 ? 1 : roll < 0.65 ? 2 : roll < 0.85 ? 3 : roll < 0.95 ? 4 : 5;
        const lines: ValueTypeOf<typeof LineType>[] = [];
        let gross = 0;
        for (let j = 0; j < lineCount; j++) {
            const [sku, price] = skus[Math.floor(draw() * skus.length)]!;
            const qty = 1 + Math.floor(draw() * (price < 5 ? 400 : 30));
            gross += qty * price;
            lines.push({ price, qty: BigInt(qty), sku });
        }
        const s = draw();
        let status: ValueTypeOf<typeof StatusType>;
        if (s < 0.62) {
            const days = Math.floor(draw() * 354);
            const hours = 8 + Math.floor(draw() * 9);
            status = variant('shipped', { date: new Date(FIRST_SHIP_DAY_MS + days * DAY_MS + hours * HOUR_MS) });
        } else if (s < 0.86) {
            status = variant('pending', null);
        } else {
            status = variant('cancelled', { reason: REASONS[Math.floor(draw() * REASONS.length)]! });
        }
        const discount = draw() < 0.35 ? DISCOUNTS[Math.floor(draw() * DISCOUNTS.length)]! : undefined;
        yield {
            order: {
                customer_id: customerId(customer),
                discount: discount === undefined ? none : some(discount),
                id: BigInt(1001 + i),
                lines,
                status,
                total: Math.round(gross * (1 - (discount ?? 0)) * 100) / 100,
            },
            customer,
        };
    }
}

/** The carriers a shipment goes by. */
export const CARRIERS: readonly string[] = ['Coastal Freight', 'Inland Express', 'Northern Haulage', 'Parcel Direct', 'Southern Logistics'];

/**
 * An order's shipment, when it shipped: its carrier and the days it took,
 * from the order's id alone — so a size's shipments are the larger sizes'
 * first, as its orders are.
 *
 * @param order - The order
 * @returns Its shipment; `undefined` for an order not shipped
 */
export function shipmentOf(order: Order): Shipment | undefined {
    if (order.status.type !== 'shipped') return undefined;
    return { carrier: CARRIERS[Number(order.id % BigInt(CARRIERS.length))]!, days: 1n + (order.id * 7n) % 10n };
}

/** The customers, in id order, each with the index of its region. */
export function* customers(): Generator<{ id: string; customer: Customer; region: number }> {
    const draw = mulberry32(100);
    for (let i = 0; i < CUSTOMER_COUNT; i++) {
        let r = draw();
        let region = REGIONS.length - 1;
        for (let k = 0; k < REGIONS.length; k++) {
            if (r < REGIONS[k]![1]) {
                region = k;
                break;
            }
            r -= REGIONS[k]![1];
        }
        const name = `${FIRST[Math.floor(draw() * FIRST.length)]} ${SECOND[Math.floor(draw() * SECOND.length)]} ${i}`;
        yield { id: customerId(i), customer: { name, region: REGIONS[region]![0], tier: variant(draw() < 0.15 ? 'gold' : 'standard', null) }, region };
    }
}

// ─── The questions ───────────────────────────────────────────────────────────

/** The benchmark's queries, each of which splits, and what it splits as. */
export const QUERIES: readonly { readonly id: string; readonly label: string; readonly program: string }[] = [
    { id: 'q1', label: 'the sum', program: '.orders | map(.total) | add' },
    { id: 'q2', label: 'four totals', program: '.orders | {n: length, total: (map(.total) | add), any_big: any(.total > 2000), all_lines: all(.lines | length > 0)}' },
    {
        id: 'q3', label: 'revenue by region',
        program: '.customers as $c | .orders | map(. + {region: $c[.customer_id].region}) | group_by(.region) | map({region: .[0].region, revenue: map(.total) | add, n: length})',
    },
    { id: 'q4', label: 'the distinct ids', program: '.orders | map(.customer_id) | unique' },
    { id: 'q5', label: 'the reduce', program: 'reduce .orders[] as $o ({}; .[$o.customer_id] += $o.total)' },
    { id: 'q6', label: 'the ids of the largest 0.1%', program: `.orders | map(select(.total > ${THRESHOLD})) | map(.id)` },
    { id: 'q6t', label: 'the same, sorted, top 100', program: `.orders | map(select(.total > ${THRESHOLD})) | sort_by(-.total) | .[:100] | map(.id)` },
    // A join of two large sides: re-keyed by the order's id (#942).
    {
        id: 'q7', label: 'revenue by carrier, the shipments joined',
        program: '.shipments as $s | .orders | map({carrier: $s[.id].carrier, total}) | group_by(.carrier) | map({carrier: .[0].carrier, revenue: map(.total) | add, n: length})',
    },
];
