/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * TypeScript-authored functions the python cross-import test imports (#628):
 * `east-node export-functions test-fixtures/crosslang-functions.mjs -o …`
 * writes their manifest; python links and runs them with no TypeScript at
 * run time. Pure functions only — no platform calls to provide.
 */

import { East, ArrayType, FloatType, IntegerType, StringType, StructType } from "@elaraai/east";

const Row = StructType({ qty: IntegerType, price: FloatType });

export const score = East.function([Row], FloatType, ($, r) => r.qty.toFloat().multiply(r.price));

export const total = East.function([ArrayType(Row)], FloatType, ($, rows) =>
    rows.map(($, r) => score(r)).reduce(($, acc, x) => acc.add(x), 0.0));

export const greet = East.function([StringType, IntegerType], StringType, ($, name, times) =>
    name.concat("!").repeat(times));

export const eastFunctions = { score, total, greet };
