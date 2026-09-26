/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { BuiltinEvaluators } from "../runtime.js";
import { EastError } from "../../error.js";
import type { Location, SourceMap } from "../../location.js";

/** The builtins for Booleans, Integers and Floats. @internal */
export const primitives_builtins = {
  BooleanNot: (_loc_id: bigint, _source_map: SourceMap | null) => (x: boolean) => !x,
  BooleanOr: (_loc_id: bigint, _source_map: SourceMap | null) => (x: boolean, y: boolean) => x || y,
  BooleanAnd: (_loc_id: bigint, _source_map: SourceMap | null) => (x: boolean, y: boolean) => x && y,
  BooleanXor: (_loc_id: bigint, _source_map: SourceMap | null) => (x: boolean, y: boolean) => x !== y,
  
  IntegerToFloat: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint) => Number(x),
  IntegerNegate: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint) => BigInt.asIntN(64, -x),
  IntegerAdd: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint, y: bigint) => BigInt.asIntN(64, x + y),
  IntegerSubtract: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint, y: bigint) => BigInt.asIntN(64, x - y),
  IntegerMultiply: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint, y: bigint) => BigInt.asIntN(64, x * y),
  IntegerDivide: (loc_id: bigint, source_map: SourceMap | null) => (x: bigint, y: bigint) => {
    if (y === 0n) throw new EastError("Division by zero", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    return BigInt.asIntN(64, x / y);
  },
  IntegerRemainder: (loc_id: bigint, source_map: SourceMap | null) => (x: bigint, y: bigint) => {
    if (y === 0n) throw new EastError("Division by zero", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    return x % y;
  },
  IntegerPow: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint, y: bigint) => y >= 0n ? BigInt.asIntN(64, x ** y) : 0n,
  IntegerAbs: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint) => BigInt.asIntN(64, x < 0n ? -x : x),
  IntegerSign: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint) => x > 0n ? 1n : x < 0n ? -1n : 0n,
  IntegerLog: (_loc_id: bigint, _source_map: SourceMap | null) => (value: bigint, base: bigint) => {
    if (value === 0n) return 0n;
    if (base <= 1n) return 0n; // Invalid base
    
    let abs_value = value < 0n ? -value : value;
    let result = 0n;
    
    while (abs_value >= base) {
      abs_value = abs_value / base;
      result = result + 1n;
    }
    
    return result;
  },
  
  FloatToInteger: (loc_id: bigint, source_map: SourceMap | null) => (x: number) => {
    if (Number.isNaN(x)) throw new EastError("Cannot convert NaN to integer", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    if (x >= 9223372036854775808) throw new EastError("Float too high to convert to integer", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    if (x < -9223372036854775808) throw new EastError("Float too low to convert to integer", { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    if (!Number.isInteger(x)) { throw new EastError("Cannot convert non-integer float to integer", { location: (source_map?.resolve(loc_id) ?? []) as Location[] }); }
    return BigInt(x);
  },
  FloatNegate: (_loc_id: bigint, _source_map: SourceMap | null) => (x: bigint) => -x,
  FloatAdd: (_loc_id: bigint, _source_map: SourceMap | null) => (x: number, y: number) => x + y,
  FloatSubtract: (_loc_id: bigint, _source_map: SourceMap | null) => (x: number, y: number) => x - y,
  FloatMultiply: (_loc_id: bigint, _source_map: SourceMap | null) => (x: number, y: number) => x * y,
  FloatDivide: (_loc_id: bigint, _source_map: SourceMap | null) => (x: number, y: number) => x / y,
  FloatRemainder: (_loc_id: bigint, _source_map: SourceMap | null) => (x: number, y: number) => x % y,
  FloatPow: (_loc_id: bigint, _source_map: SourceMap | null) => (x: number, y: number) => x ** y,
  FloatAbs: (_loc_id: bigint, _source_map: SourceMap | null) => (x: number) => x < 0 ? -x : x,
  FloatSign: (_loc_id: bigint, _source_map: SourceMap | null) => (x: number) => x > 0 ? 1 : x < 0 ? -1 : 0, // What sign is NaN?
  FloatSqrt: (_loc_id: bigint, _source_map: SourceMap | null) => (value: number) => Math.sqrt(value),
  FloatLog: (_loc_id: bigint, _source_map: SourceMap | null) => (value: number) => Math.log(value),
  FloatExp: (_loc_id: bigint, _source_map: SourceMap | null) => (value: number) => Math.exp(value),
  FloatSin: (_loc_id: bigint, _source_map: SourceMap | null) => (value: number) => Math.sin(value),
  FloatCos: (_loc_id: bigint, _source_map: SourceMap | null) => (value: number) => Math.cos(value),
  FloatTan: (_loc_id: bigint, _source_map: SourceMap | null) => (value: number) => Math.tan(value),
} satisfies BuiltinEvaluators;
