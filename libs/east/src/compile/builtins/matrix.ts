/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { type BuiltinEvaluators, call_function } from "../runtime.js";
import { allocateTypedArray, createTypedArray, requireNumericElem, requireSameDims, wrapI64 } from "../typed_arrays.js";
import { matrix } from "../../containers/matrix.js";
import { EastError } from "../../error.js";
import type { Location, SourceMap } from "../../location.js";
import type { PlatformFunction } from "../../platform.js";
import type { EastTypeValue } from "../../type_of_type.js";

/** The builtins for Matrices. @internal */
export const matrix_builtins = {
  // Matrix builtins
  MatrixRows: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (m: any) => BigInt(m.rows),

  MatrixCols: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (m: any) => BigInt(m.cols),

  MatrixGet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (m: any, row: bigint, col: bigint) => {
    const r = Number(row);
    const c = Number(col);
    if (r < 0 || r >= m.rows || c < 0 || c >= m.cols) {
      throw new EastError(`Matrix index (${row}, ${col}) out of bounds (${m.rows}×${m.cols})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const val = m.data[r * m.cols + c];
    if (m.data instanceof Uint8ClampedArray) return val !== 0;
    return val;
  },

  MatrixSet: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (m: any, row: bigint, col: bigint, value: any) => {
    const r = Number(row);
    const c = Number(col);
    if (r < 0 || r >= m.rows || c < 0 || c >= m.cols) {
      throw new EastError(`Matrix index (${row}, ${col}) out of bounds (${m.rows}×${m.cols})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const data = m.data.slice() as typeof m.data;
    if (data instanceof Uint8ClampedArray) {
      data[r * m.cols + c] = value ? 1 : 0;
    } else {
      data[r * m.cols + c] = value;
    }
    return matrix(data, m.rows, m.cols);
  },

  MatrixGetRow: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (m: any, row: bigint) => {
    const r = Number(row);
    if (r < 0 || r >= m.rows) {
      throw new EastError(`Matrix row ${row} out of bounds (${m.rows} rows)`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const start = r * m.cols;
    return m.data.slice(start, start + m.cols);
  },

  MatrixGetCol: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (m: any, col: bigint) => {
    const c = Number(col);
    if (c < 0 || c >= m.cols) {
      throw new EastError(`Matrix column ${col} out of bounds (${m.cols} cols)`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
    }
    const result = allocateTypedArray(T, m.rows);
    for (let r = 0; r < m.rows; r++) result[r] = m.data[r * m.cols + c] as never;
    return result;
  },

  MatrixToVector: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (m: any) => {
    return m.data.slice();
  },

  MatrixFromArray: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (arr: any[][]) => {
    if (arr.length === 0) {
      return matrix(createTypedArray(T, []), 0, 0);
    }
    const rows = arr.length;
    const cols = arr[0]!.length;
    for (let i = 1; i < rows; i++) {
      if (arr[i]!.length !== cols) {
        throw new EastError(`Jagged array: row 0 has ${cols} columns but row ${i} has ${arr[i]!.length}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
    const flat: any[] = [];
    for (const row of arr) {
      flat.push(...row);
    }
    return matrix(createTypedArray(T, flat), rows, cols);
  },

  MatrixToArray: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (m: any) => {
    const result: any[][] = [];
    for (let r = 0; r < m.rows; r++) {
      const row: any[] = [];
      for (let c = 0; c < m.cols; c++) {
        const val = m.data[r * m.cols + c];
        row.push(m.data instanceof Uint8ClampedArray ? val !== 0 : val);
      }
      result.push(row);
    }
    return result;
  },

  MatrixTranspose: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (m: any) => {
    const result = allocateTypedArray(T, m.rows * m.cols);
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        result[c * m.rows + r] = m.data[r * m.cols + c] as never;
      }
    }
    return matrix(result, m.cols, m.rows);
  },

  MatrixZeros: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (rows: bigint, cols: bigint) => {
    return matrix(allocateTypedArray(T, Number(rows) * Number(cols)), Number(rows), Number(cols));
  },

  MatrixOnes: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (rows: bigint, cols: bigint) => {
    const data = allocateTypedArray(T, Number(rows) * Number(cols));
    data.fill((data instanceof BigInt64Array ? 1n : 1) as never);
    return matrix(data, Number(rows), Number(cols));
  },

  MatrixFill: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (rows: bigint, cols: bigint, value: any) => {
    const r = Number(rows);
    const c = Number(cols);
    const n = r * c;
    if (T.type === "Float") {
      const data = new Float64Array(n);
      data.fill(value);
      return matrix(data, r, c);
    } else if (T.type === "Integer") {
      const data = new BigInt64Array(n);
      data.fill(value);
      return matrix(data, r, c);
    } else {
      const data = new Uint8ClampedArray(n);
      data.fill(value ? 1 : 0);
      return matrix(data, r, c);
    }
  },

  MatrixMapElements: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, U: EastTypeValue) => (m: any, f: (elem: any, row: bigint, col: bigint) => any) => {
    const results: any[] = [];
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        const val = m.data[r * m.cols + c];
        const elem = m.data instanceof Uint8ClampedArray ? val !== 0 : val;
        results.push(call_function(loc_id, source_map,f, elem, BigInt(r), BigInt(c)));
      }
    }
    return matrix(createTypedArray(U, results), m.rows, m.cols);
  },

  MatrixMapRows: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue, U: EastTypeValue) => (m: any, f: (row: any, idx: bigint) => any) => {
    const resultRows: any[] = [];
    for (let r = 0; r < m.rows; r++) {
      const start = r * m.cols;
      const rowVec = m.data.slice(start, start + m.cols);
      const resultRow = call_function(loc_id, source_map,f, rowVec, BigInt(r));
      resultRows.push(resultRow);
    }
    if (resultRows.length === 0) {
      return matrix(allocateTypedArray(U, 0), 0, 0);
    }
    const newCols = resultRows[0].length;
    const data = allocateTypedArray(U, m.rows * newCols);
    for (let r = 0; r < m.rows; r++) {
      data.set(resultRows[r] as any, r * newCols);
    }
    return matrix(data, m.rows, newCols);
  },

  MatrixToRows: (_loc_id: bigint, _source_map: SourceMap | null, _platformDef: PlatformFunction[], _T: EastTypeValue) => (m: any): (Float64Array | BigInt64Array | Uint8ClampedArray)[] => {
    const rows: (Float64Array | BigInt64Array | Uint8ClampedArray)[] = [];
    for (let r = 0; r < m.rows; r++) {
      rows.push(m.data.slice(r * m.cols, (r + 1) * m.cols));
    }
    return rows;
  },

  MatrixFromRows: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => (arr: any[]) => {
    if (arr.length === 0) {
      return matrix(allocateTypedArray(T, 0), 0, 0);
    }
    const cols = arr[0].length;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].length !== cols) {
        throw new EastError(`Jagged rows: row 0 has ${cols} columns but row ${i} has ${arr[i].length}`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
    }
    const data = allocateTypedArray(T, arr.length * cols);
    for (let r = 0; r < arr.length; r++) data.set(arr[r] as any, r * cols);
    return matrix(data, arr.length, cols);
  },

  // Matrix elementwise arithmetic + reductions. Sums accumulate in ascending
  // index order (row-major for whole-matrix walks, ascending row for column
  // sums, ascending column within each row for row sums and vec-mul) — the
  // same left-to-right contract as the Vector reductions.
  MatrixScale: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("MatrixScale", T, loc_id, source_map);
    return (m: matrix, alpha: any) => {
      const src = m.data;
      if (elem === "Float") {
        const data = new Float64Array(src.length);
        for (let i = 0; i < src.length; i++) data[i] = (src[i] as number) * alpha;
        return matrix(data, m.rows, m.cols);
      }
      const data = new BigInt64Array(src.length);
      for (let i = 0; i < src.length; i++) data[i] = wrapI64((src[i] as bigint) * alpha);
      return matrix(data, m.rows, m.cols);
    };
  },
  MatrixAddScaled: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("MatrixAddScaled", T, loc_id, source_map);
    return (a: matrix, b: matrix, alpha: any) => {
      requireSameDims(a, b, loc_id, source_map);
      const ad = a.data;
      const bd = b.data;
      if (elem === "Float") {
        const data = new Float64Array(ad.length);
        for (let i = 0; i < ad.length; i++) data[i] = (ad[i] as number) + alpha * (bd[i] as number);
        return matrix(data, a.rows, a.cols);
      }
      const data = new BigInt64Array(ad.length);
      for (let i = 0; i < ad.length; i++) data[i] = wrapI64((ad[i] as bigint) + wrapI64(alpha * (bd[i] as bigint)));
      return matrix(data, a.rows, a.cols);
    };
  },
  MatrixMulElementwise: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("MatrixMulElementwise", T, loc_id, source_map);
    return (a: matrix, b: matrix) => {
      requireSameDims(a, b, loc_id, source_map);
      const ad = a.data;
      const bd = b.data;
      if (elem === "Float") {
        const data = new Float64Array(ad.length);
        for (let i = 0; i < ad.length; i++) data[i] = (ad[i] as number) * (bd[i] as number);
        return matrix(data, a.rows, a.cols);
      }
      const data = new BigInt64Array(ad.length);
      for (let i = 0; i < ad.length; i++) data[i] = wrapI64((ad[i] as bigint) * (bd[i] as bigint));
      return matrix(data, a.rows, a.cols);
    };
  },
  MatrixRowSums: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("MatrixRowSums", T, loc_id, source_map);
    return (m: matrix) => {
      const src = m.data;
      if (elem === "Float") {
        const result = new Float64Array(m.rows);
        for (let r = 0; r < m.rows; r++) {
          let acc = 0;
          for (let c = 0; c < m.cols; c++) acc += src[r * m.cols + c] as number;
          result[r] = acc;
        }
        return result;
      }
      const result = new BigInt64Array(m.rows);
      for (let r = 0; r < m.rows; r++) {
        let acc = 0n;
        for (let c = 0; c < m.cols; c++) acc = wrapI64(acc + (src[r * m.cols + c] as bigint));
        result[r] = acc;
      }
      return result;
    };
  },
  MatrixColSums: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("MatrixColSums", T, loc_id, source_map);
    return (m: matrix) => {
      const src = m.data;
      if (elem === "Float") {
        const result = new Float64Array(m.cols);
        for (let c = 0; c < m.cols; c++) {
          let acc = 0;
          for (let r = 0; r < m.rows; r++) acc += src[r * m.cols + c] as number;
          result[c] = acc;
        }
        return result;
      }
      const result = new BigInt64Array(m.cols);
      for (let c = 0; c < m.cols; c++) {
        let acc = 0n;
        for (let r = 0; r < m.rows; r++) acc = wrapI64(acc + (src[r * m.cols + c] as bigint));
        result[c] = acc;
      }
      return result;
    };
  },
  MatrixVecMul: (loc_id: bigint, source_map: SourceMap | null, _platformDef: PlatformFunction[], T: EastTypeValue) => {
    const elem = requireNumericElem("MatrixVecMul", T, loc_id, source_map);
    return (m: matrix, v: Float64Array | BigInt64Array) => {
      if (v.length !== m.cols) {
        throw new EastError(`MatrixVecMul dimension mismatch (${m.rows}x${m.cols} vs length ${v.length})`, { location: (source_map?.resolve(loc_id) ?? []) as Location[] });
      }
      const src = m.data;
      if (elem === "Float") {
        const result = new Float64Array(m.rows);
        for (let r = 0; r < m.rows; r++) {
          let acc = 0;
          for (let c = 0; c < m.cols; c++) acc += (src[r * m.cols + c] as number) * (v[c] as number);
          result[r] = acc;
        }
        return result;
      }
      const result = new BigInt64Array(m.rows);
      for (let r = 0; r < m.rows; r++) {
        let acc = 0n;
        for (let c = 0; c < m.cols; c++) acc = wrapI64(acc + wrapI64((src[r * m.cols + c] as bigint) * (v[c] as bigint)));
        result[r] = acc;
      }
      return result;
    };
  },
} satisfies BuiltinEvaluators;
