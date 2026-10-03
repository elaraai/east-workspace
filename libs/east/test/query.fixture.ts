/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shared fixture of typed jq queries (#875): its types, and the values
 * the query editor's mock shows, generated from seed 875.
 *
 * The generator follows the mock's own (`qe-engine.js` inside
 * `libs/east-ui/docs/proposals/Query Editor Spec.html`) draw for draw, and
 * `Query Editor Spec.md` §6 lists its constants. The query corpus, the
 * examples, `devdocs/QUERY.md`'s examples, the benchmark and the query
 * builder's showcase read it. `test/fixtures/query-fixture.beast2` holds its
 * bytes, self-describing, for east-c and east-py, and `make query-corpus`
 * rewrites that file.
 */

import {
  ArrayType, DateTimeType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, RecursiveType,
  SortedMap, StringType, StructType, VariantType,
  compareFor, encodeBeast2For, none, setLocationCapture, some, variant,
  type ValueTypeOf,
} from "../src/index.js";

/** One line of an order: a SKU, its unit price and the quantity ordered. */
export const Line = StructType({ price: FloatType, qty: IntegerType, sku: StringType });

/** Where an order stands: cancelled for a reason, pending, or shipped on a date. */
export const Status = VariantType({
  cancelled: StructType({ reason: StringType }),
  pending: NullType,
  shipped: StructType({ date: DateTimeType }),
});

/**
 * An order. `discount` is the fraction taken off, when there is one, and
 * `total` is the lines' gross less the discount, to the cent.
 */
export const Order = StructType({
  customer_id: StringType,
  discount: OptionType(FloatType),
  id: IntegerType,
  lines: ArrayType(Line),
  status: Status,
  total: FloatType,
});

/** A customer's tier. */
export const Tier = VariantType({ gold: NullType, standard: NullType });

/** A customer. */
export const Customer = StructType({ name: StringType, region: StringType, tier: Tier });

/** Weekly demand by region: eight weeks, the first at index 0. */
export const Forecast = StructType({ regions: DictType(StringType, StructType({ weekly: ArrayType(FloatType) })) });

/** A part and the parts it is built from: a bill of materials. */
export const Part = RecursiveType(self => StructType({ children: ArrayType(self), cost: FloatType, sku: StringType }));

/** The input of the demand model: a unit price and a region. */
export const ModelInput = StructType({ price: FloatType, region: StringType });

/** The demand model: units sold at a price in a region. */
export const Model = FunctionType([ModelInput], FloatType);

/** A cell of the flattened forecast: a region and a week, numbered from 1. */
export const Cell = StructType({ region: StringType, week: IntegerType });

/**
 * The fixture's root: every dataset the mock shows, and two more for keys
 * that are not strings.
 *
 * @remarks
 * - `bom` — the bill of materials for PUMP-A.
 * - `byId` — `orders` keyed by id (Integer keys).
 * - `cells` — `forecast` flattened: `{region, week}` to that week's demand,
 *   so `cells[{region: "NSW", week: 1}]` is `forecast.regions["NSW"].weekly[0]`
 *   (Struct keys).
 * - `customers` — customers by id.
 * - `forecast` — weekly demand by region.
 * - `model` — the demand model, an East function every runtime can call.
 * - `orders` — the orders, in id order.
 */
export const FixtureRoot = StructType({
  bom: Part,
  byId: DictType(IntegerType, Order),
  cells: DictType(Cell, FloatType),
  customers: DictType(StringType, Customer),
  forecast: Forecast,
  model: Model,
  orders: ArrayType(Order),
});

/** The seed of the mock's generator. */
export const QUERY_FIXTURE_SEED = 875;

/** The eight SKUs and their unit prices. */
const SKUS: readonly (readonly [sku: string, price: number])[] = [
  ["BRK-100", 12.4], ["HNG-220", 8.9], ["PLT-310", 46.0], ["BLT-045", 0.85],
  ["SCR-012", 0.32], ["WSH-008", 0.18], ["RAL-900", 64.5], ["CLP-150", 3.75],
];

/** The eight customers: id, name, region and tier. */
const CUSTOMERS: readonly (readonly [id: string, name: string, region: string, tier: "gold" | "standard"])[] = [
  ["C01", "Harbour Foods", "NSW", "gold"],
  ["C02", "Coastline Retail", "NSW", "standard"],
  ["C03", "Ridge Grocers", "VIC", "gold"],
  ["C04", "Southbank Market", "VIC", "standard"],
  ["C05", "Sunfield Traders", "QLD", "standard"],
  ["C06", "Northgate Supply", "QLD", "gold"],
  ["C07", "Westend Provisions", "WA", "standard"],
  ["C08", "Ironbark Stores", "SA", "standard"],
];

/** Why an order was cancelled. */
const REASONS: readonly string[] = ["Customer request", "Out of stock", "Payment failed"];

/** The fractions an order can be discounted by. */
const DISCOUNTS: readonly number[] = [0.05, 0.1, 0.15];

/** Each region's base weekly demand, in the order the mock indexes them. */
const BASE_DEMAND: readonly (readonly [region: string, base: number])[] = [
  ["NSW", 1200], ["VIC", 1050], ["QLD", 860], ["WA", 540], ["SA", 410],
];

/** The demand model's base for a region it does not know. */
const UNKNOWN_REGION_BASE = 300;

/** The first day a shipped order can ship: 2025-10-01, midnight UTC. */
const FIRST_SHIP_DAY_MS = Date.UTC(2025, 9, 1);

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Park–Miller's minimal standard generator, as the mock draws from it: each
 * draw advances `s = s × 16807 mod (2³¹ − 1)` and gives `s / (2³¹ − 1)`.
 *
 * @param seed - the starting state
 * @returns the next draw, in (0, 1), on each call
 */
function parkMiller(seed: number): () => number {
  let state = seed;
  return () => (state = (state * 16807) % 2147483647) / 2147483647;
}

/**
 * Generates the orders, ids from 1001, exactly as the mock does: its 40, or
 * the fixture scaled, the draws going on from the same seed, so the first 40
 * of any count are the mock's.
 *
 * @param count - how many orders; the mock's 40 when omitted
 * @returns the orders, in id order
 */
export function makeOrders(count = 40): ValueTypeOf<typeof Order>[] {
  const draw = parkMiller(QUERY_FIXTURE_SEED);
  const orders: ValueTypeOf<typeof Order>[] = [];
  for (let i = 0; i < count; i++) {
    const customerId = CUSTOMERS[Math.floor(draw() * CUSTOMERS.length)]![0];
    const lineCount = 1 + Math.floor(draw() * 4);
    const used = new Set<number>();
    const lines: ValueTypeOf<typeof Line>[] = [];
    const quantities: number[] = [];
    for (let j = 0; j < lineCount; j++) {
      let k: number;
      do { k = Math.floor(draw() * SKUS.length); } while (used.has(k));
      used.add(k);
      const [sku, price] = SKUS[k]!;
      const qty = 1 + Math.floor(draw() * (price < 5 ? 400 : 30));
      quantities.push(qty);
      lines.push({ price, qty: BigInt(qty), sku });
    }
    const roll = draw();
    let status: ValueTypeOf<typeof Status>;
    if (roll < 0.62) {
      const days = Math.floor(draw() * 354);
      const hours = 8 + Math.floor(draw() * 9);
      status = variant("shipped", { date: new Date(FIRST_SHIP_DAY_MS + days * DAY_MS + hours * HOUR_MS) });
    } else if (roll < 0.86) {
      status = variant("pending", null);
    } else {
      status = variant("cancelled", { reason: REASONS[Math.floor(draw() * REASONS.length)]! });
    }
    const discount = draw() < 0.35 ? DISCOUNTS[Math.floor(draw() * DISCOUNTS.length)]! : undefined;
    const gross = lines.reduce((sum, line, j) => sum + quantities[j]! * line.price, 0);
    orders.push({
      customer_id: customerId,
      discount: discount === undefined ? none : some(discount),
      id: BigInt(1001 + i),
      lines,
      status,
      total: Math.round(gross * (1 - (discount ?? 0)) * 100) / 100,
    });
  }
  return orders;
}

/**
 * Builds a part of the bill of materials.
 *
 * @param sku - the part's SKU
 * @param cost - its own cost
 * @param children - the parts it is built from
 * @returns the part
 */
function part(sku: string, cost: number, children: ValueTypeOf<typeof Part>[] = []): ValueTypeOf<typeof Part> {
  return { children, cost, sku };
}

/**
 * The weekly demand of the region at `index` in {@link BASE_DEMAND}: eight
 * weeks of `base × (0.9 + 0.03w + 0.01i)`, to one place.
 *
 * @param base - the region's base demand
 * @param index - its index in the mock's order
 * @returns the eight weeks' demand
 */
function weeklyDemand(base: number, index: number): number[] {
  return Array.from({ length: 8 }, (_, week) => Math.round(base * (0.9 + 0.03 * week + 0.01 * index) * 10) / 10);
}

/**
 * Builds the demand model, `round₂(base[region] × (price / 10)^−1.4)`, as an
 * East function with only builtins in its body.
 *
 * @returns the compiled model, carrying its IR
 *
 * @remarks
 * It is built without source locations, so its bytes do not depend on where
 * or how the fixture is generated: a checked-in file holds them.
 */
function buildModel(): ValueTypeOf<typeof Model> {
  setLocationCapture(false);
  try {
    const model = East.function([ModelInput], FloatType, ($, input) => {
      const base = $.const(
        new SortedMap(BASE_DEMAND.map(([region, demand]): [string, number] => [region, demand]), compareFor(StringType)),
        DictType(StringType, FloatType),
      );
      const demand = base.get(input.region, () => UNKNOWN_REGION_BASE).multiply(input.price.divide(10.0).pow(-1.4));
      // Math.round(demand × 100) / 100 for a positive demand, as the mock rounds it.
      const cents = $.const(demand.multiply(100.0).add(0.5));
      return cents.subtract(cents.remainder(1.0)).divide(100.0);
    });
    return East.compile(model, []);
  } finally {
    setLocationCapture(true);
  }
}

/**
 * Generates the shared fixture: the mock's data, seed 875.
 *
 * @returns a fresh fixture value; no two fields share a container
 *
 * @example
 * ```ts
 * const fixture = queryFixture();
 * fixture.orders.length;                              // 40
 * fixture.model({ price: 10.0, region: "NSW" });      // 1200.0
 * ```
 */
export function queryFixture(): ValueTypeOf<typeof FixtureRoot> {
  const orders = makeOrders();
  const regions = new SortedMap(
    BASE_DEMAND.map(([region, base], index) => [region, { weekly: weeklyDemand(base, index) }] as const),
    compareFor(StringType),
  );
  const cells = new SortedMap<ValueTypeOf<typeof Cell>, number>([], compareFor(Cell));
  BASE_DEMAND.forEach(([region, base], index) => {
    weeklyDemand(base, index).forEach((demand, week) => cells.set({ region, week: BigInt(week + 1) }, demand));
  });
  return {
    bom: part("PUMP-A", 42.0, [
      part("MOTOR-1", 120.0, [part("ROTOR-1", 18.5), part("STATOR-1", 22.0), part("BRG-6203", 3.2)]),
      part("HOUSING-2", 35.0, [part("GASKET-9", 1.1), part("BOLT-M8", 0.4)]),
      part("IMPELLER-3", 27.5),
      part("SEAL-KIT", 6.8, [part("ORING-12", 0.3), part("ORING-18", 0.35)]),
    ]),
    // A second draw of the same orders, so `byId` and `orders` share no line list.
    byId: new SortedMap(makeOrders().map(order => [order.id, order] as const), compareFor(IntegerType)),
    cells,
    customers: new SortedMap(
      CUSTOMERS.map(([id, name, region, tier]) => [id, { name, region, tier: variant(tier, null) }] as const),
      compareFor(StringType),
    ),
    forecast: { regions },
    model: buildModel(),
    orders,
  };
}

/**
 * Encodes the shared fixture as `test/fixtures/query-fixture.beast2` holds
 * it: self-describing beast2, so a reader needs no type of its own.
 *
 * @returns the fixture's bytes
 */
export function queryFixtureBytes(): Uint8Array {
  return encodeBeast2For(FixtureRoot)(queryFixture());
}
