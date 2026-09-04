/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builtin spelling table: IR builtin → TypeScript builder source (#628).
 *
 * One row per builtin the TypeScript surface can spell. A row's `template`
 * is TypeScript source with `{0}`, `{1}`, ... for the builtin's arguments in
 * IR order and `{T0}`, `{T1}`, ... for its type parameters; `callbacks`
 * lists the argument slots that are callbacks (printed as `($, ...) => ...`
 * bodies when the IR holds a Function node, as the value they are
 * otherwise); `exprs` lists the slots the surface types `Expr`-only
 * (`merge<T2>(key, value: Expr<T2>, ...)`), where a literal prints through
 * `East.value`; `inferred` lists the slots whose East type the surface
 * infers from the argument itself — an unconstrained type parameter,
 * `reduce<T2>(fn, init: T2)` — where a construction prints bare only when
 * it types itself (`0n`, `{ a: x }`; not `[]` or `none`); every other slot
 * is typed by the surface (`SubtypeExprOrValue<T>`) and a construction
 * prints bare. `spellings.spec.ts` checks all three against the surface's
 * signatures with the TypeScript compiler. `floatOnly`
 * marks the stdlib constructors TypeScript declares for Float only
 * (`East.Vector.zeros(n)`), which print raw for any other element type;
 * `adapter` names the two argument shapes the surface takes
 * as host values rather than expressions — a `RegExp` (`{R}` stands for
 * the pattern and flags arguments) and a CSV options object (`{C}` stands
 * for the config struct argument, dropped with its comma when every
 * option is `none`) — which print from literal arguments only. A slot's
 * order is the surface's, not the IR's: `durationMilliseconds` emits its
 * receiver second.
 *
 * The rows are the python table's (`east/codegen/spellings.py`) under the
 * TypeScript names — the same builtins, the same argument orders — so the
 * two printers cannot drift apart on what they spell. Every builtin with no
 * row prints through `East.builtin(name, [T...], [args], out)` and is
 * listed in {@link RAW_ONLY}, a ratchet the printer's tests pin: it may
 * only shrink.
 */

/** One spelling row — see the module notes. */
export interface Spelling {
  /** TypeScript source with `{0}`.. argument and `{T0}`.. type-parameter slots. */
  template: string;
  /** The argument slots holding callbacks. */
  callbacks?: number[];
  /** The argument slots the surface types `Expr`-only (a literal prints through `East.value`). */
  exprs?: number[];
  /** The argument slots whose East type the surface infers from the argument (a construction prints bare only when it types itself). */
  inferred?: number[];
  /** The row applies only when the type parameter is Float. */
  floatOnly?: boolean;
  /** A host-value argument shape: a RegExp or a CSV options object. */
  adapter?: "regex" | "csv";
}

/** The spelling rows, by builtin name. */
export const SPELLINGS: Record<string, Spelling> = {
  ApplyPatch: { template: "East.applyPatch({0}, {1})", exprs: [1] },
  ArrayAppend: { template: "{0}.append({1})" },
  ArrayClear: { template: "{0}.clear()" },
  ArrayConcat: { template: "{0}.concat({1})" },
  ArrayCopy: { template: "{0}.copy()" },
  ArrayEncodeCsv: { template: "{0}.encodeCsv({C})", adapter: "csv" },
  ArrayFilter: { template: "{0}.filter({1})", callbacks: [1] },
  ArrayFilterMap: { template: "{0}.filterMap({1})", callbacks: [1] },
  ArrayFindFirst: { template: "{0}.findFirst({1}, {2})", callbacks: [2] },
  ArrayFindSortedFirst: { template: "{0}.findSortedFirst({1}, {2})", callbacks: [2], inferred: [1] },
  ArrayFindSortedLast: { template: "{0}.findSortedLast({1}, {2})", callbacks: [2], inferred: [1] },
  ArrayFindSortedRange: { template: "{0}.findSortedRange({1}, {2})", callbacks: [2], inferred: [1] },
  ArrayFirstMap: { template: "{0}.firstMap({1})", callbacks: [1] },
  ArrayFlattenToArray: { template: "{0}.flatMap({1})", callbacks: [1] },
  ArrayFlattenToDict: { template: "{0}.flattenToDict({1}, {2})", callbacks: [1, 2] },
  ArrayFlattenToSet: { template: "{0}.flattenToSet({1})", callbacks: [1] },
  ArrayFold: { template: "{0}.reduce({2}, {1})", callbacks: [2], inferred: [1] },
  ArrayForEach: { template: "{0}.forEach({1})", callbacks: [1] },
  ArrayGenerate: { template: "East.Array.generate({0}, {T0}, {1})", callbacks: [1] },
  ArrayGet: { template: "{0}.get({1})" },
  ArrayGetOrDefault: { template: "{0}.get({1}, {2})", callbacks: [2] },
  ArrayGroupFold: { template: "{0}.groupReduce({1}, {2}, {3})", callbacks: [1, 2, 3] },
  ArrayHas: { template: "{0}.has({1})" },
  ArrayIsSorted: { template: "{0}.isSorted({1})", callbacks: [1] },
  ArrayLinspace: { template: "East.Array.linspace({0}, {1}, {2})" },
  ArrayMap: { template: "{0}.map({1})", callbacks: [1] },
  ArrayMapReduce: { template: "{0}.mapReduce({1}, {2})", callbacks: [1, 2] },
  ArrayMerge: { template: "{0}.merge({1}, {2}, {3})", callbacks: [3], exprs: [2] },
  ArrayMergeAll: { template: "{0}.mergeAll({1}, {2})", callbacks: [2], exprs: [1] },
  ArrayPopFirst: { template: "{0}.popFirst()" },
  ArrayPopLast: { template: "{0}.popLast()" },
  ArrayPrepend: { template: "{0}.prepend({1})" },
  ArrayPushFirst: { template: "{0}.pushFirst({1})" },
  ArrayPushLast: { template: "{0}.pushLast({1})" },
  ArrayRange: { template: "East.Array.range({0}, {1}, {2})" },
  ArrayReverse: { template: "{0}.reverse()" },
  ArrayReverseInPlace: { template: "{0}.reverseInPlace()" },
  ArrayScan: { template: "{0}.scan({2}, {1})", callbacks: [2], inferred: [1] },
  ArraySize: { template: "{0}.size()" },
  ArraySlice: { template: "{0}.slice({1}, {2})" },
  ArraySort: { template: "{0}.sort({1})", callbacks: [1] },
  ArraySortInPlace: { template: "{0}.sortInPlace({1})", callbacks: [1] },
  ArrayStringJoin: { template: "{0}.stringJoin({1})" },
  ArrayToDict: { template: "{0}.toDict({1}, {2}, {3})", callbacks: [1, 2, 3] },
  ArrayToSet: { template: "{0}.toSet({1})", callbacks: [1] },
  ArrayTryGet: { template: "{0}.tryGet({1})" },
  ArrayUpdate: { template: "{0}.update({1}, {2})" },
  BlobDecodeBeast: { template: "{0}.decodeBeast({T0})" },
  BlobDecodeBeast2: { template: "{0}.decodeBeast({T0}, 'v2')" },
  BlobDecodeCsv: { template: "{0}.decodeCsv({T0}, {C})", adapter: "csv" },
  BlobDecodeUtf16: { template: "{0}.decodeUtf16()" },
  BlobDecodeUtf8: { template: "{0}.decodeUtf8()" },
  BlobEncodeBeast: { template: "East.Blob.encodeBeast({0})" },
  BlobEncodeBeast2: { template: "East.Blob.encodeBeast({0}, 'v2')" },
  BlobGetUint8: { template: "{0}.getUint8({1})" },
  BlobOpenBeast2: { template: "{0}.openBeast({T0})" },
  BlobSize: { template: "{0}.size()" },
  BooleanAnd: { template: "{0}.bitAnd({1})" },
  BooleanNot: { template: "{0}.not()" },
  BooleanOr: { template: "{0}.bitOr({1})" },
  BooleanXor: { template: "{0}.bitXor({1})" },
  ComposePatch: { template: "East.composePatch({0}, {1}, {T0})", exprs: [1] },
  DateTimeAddMilliseconds: { template: "{0}.addMilliseconds({1})" },
  DateTimeDurationMilliseconds: { template: "{1}.durationMilliseconds({0})" },
  DateTimeFromComponents: { template: "East.DateTime.fromComponents({0}, {1}, {2}, {3}, {4}, {5}, {6})" },
  DateTimeFromEpochMilliseconds: { template: "East.DateTime.fromEpochMilliseconds({0})" },
  DateTimeGetDayOfMonth: { template: "{0}.getDayOfMonth()" },
  DateTimeGetDayOfWeek: { template: "{0}.getDayOfWeek()" },
  DateTimeGetHour: { template: "{0}.getHour()" },
  DateTimeGetMillisecond: { template: "{0}.getMillisecond()" },
  DateTimeGetMinute: { template: "{0}.getMinute()" },
  DateTimeGetMonth: { template: "{0}.getMonth()" },
  DateTimeGetSecond: { template: "{0}.getSecond()" },
  DateTimeGetYear: { template: "{0}.getYear()" },
  DateTimeToEpochMilliseconds: { template: "{0}.toEpochMilliseconds()" },
  DictClear: { template: "{0}.clear()" },
  DictCopy: { template: "{0}.copy()" },
  DictDelete: { template: "{0}.delete({1})" },
  DictFilter: { template: "{0}.filter({1})", callbacks: [1] },
  DictFilterMap: { template: "{0}.filterMap({1})", callbacks: [1] },
  DictFirstMap: { template: "{0}.firstMap({1})", callbacks: [1] },
  DictFlattenToArray: { template: "{0}.flattenToArray({1})", callbacks: [1] },
  DictFlattenToDict: { template: "{0}.flattenToDict({1}, {2})", callbacks: [1, 2] },
  DictFlattenToSet: { template: "{0}.flattenToSet({1})", callbacks: [1] },
  DictForEach: { template: "{0}.forEach({1})", callbacks: [1] },
  DictGenerate: { template: "East.Dict.generate({0}, {T0}, {T1}, {1}, {2}, {3})", callbacks: [1, 2, 3] },
  DictGet: { template: "{0}.get({1})" },
  DictGetKeys: { template: "{0}.getKeys({1}, {2})", callbacks: [2] },
  DictGetOrDefault: { template: "{0}.get({1}, {2})", callbacks: [2] },
  DictGetOrInsert: { template: "{0}.getOrInsert({1}, {2})", callbacks: [2] },
  DictGroupFold: { template: "{0}.groupReduce({1}, {2}, {3})", callbacks: [1, 2, 3] },
  DictHas: { template: "{0}.has({1})" },
  DictInsert: { template: "{0}.insert({1}, {2})" },
  DictInsertOrUpdate: { template: "{0}.insertOrUpdate({1}, {2}, {3})", callbacks: [3] },
  DictKeys: { template: "{0}.keys()" },
  DictMap: { template: "{0}.map({1})", callbacks: [1] },
  DictMapReduce: { template: "{0}.mapReduce({1}, {2})", callbacks: [1, 2] },
  DictMerge: { template: "{0}.merge({1}, {2}, {3}, {4})", callbacks: [3, 4], inferred: [2] },
  DictMergeAll: { template: "{0}.mergeAll({1}, {2}, {3})", callbacks: [2, 3], exprs: [1] },
  DictPop: { template: "{0}.pop({1})" },
  DictReduce: { template: "{0}.reduce({1}, {2})", callbacks: [1], inferred: [2] },
  DictScan: { template: "{0}.scan({1}, {2})", callbacks: [1], inferred: [2] },
  DictSize: { template: "{0}.size()" },
  DictSwap: { template: "{0}.swap({1}, {2})" },
  DictToArray: { template: "{0}.toArray({1})", callbacks: [1] },
  DictToDict: { template: "{0}.toDict({1}, {2}, {3})", callbacks: [1, 2, 3] },
  DictToSet: { template: "{0}.toSet({1})", callbacks: [1] },
  DictTryDelete: { template: "{0}.tryDelete({1})" },
  DictTryGet: { template: "{0}.tryGet({1})" },
  DictUnionInPlace: { template: "{0}.unionInPlace({1}, {2})", callbacks: [2] },
  DictUpdate: { template: "{0}.update({1}, {2})" },
  Diff: { template: "East.diff({0}, {1})", exprs: [1] },
  Equal: { template: "East.equal({0}, {1})" },
  FloatAbs: { template: "{0}.abs()" },
  FloatAdd: { template: "{0}.add({1})" },
  FloatCos: { template: "{0}.cos()" },
  FloatDivide: { template: "{0}.divide({1})" },
  FloatExp: { template: "{0}.exp()" },
  FloatLog: { template: "{0}.log()" },
  FloatMultiply: { template: "{0}.multiply({1})" },
  FloatNegate: { template: "{0}.negate()" },
  FloatPow: { template: "{0}.pow({1})" },
  FloatRemainder: { template: "{0}.remainder({1})" },
  FloatSign: { template: "{0}.sign()" },
  FloatSin: { template: "{0}.sin()" },
  FloatSqrt: { template: "{0}.sqrt()" },
  FloatSubtract: { template: "{0}.subtract({1})" },
  FloatTan: { template: "{0}.tan()" },
  FloatToInteger: { template: "{0}.toInteger()" },
  Greater: { template: "East.greater({0}, {1})" },
  GreaterEqual: { template: "East.greaterEqual({0}, {1})" },
  IntegerAbs: { template: "{0}.abs()" },
  IntegerAdd: { template: "{0}.add({1})" },
  IntegerDivide: { template: "{0}.divide({1})" },
  IntegerLog: { template: "{0}.log({1})" },
  IntegerMultiply: { template: "{0}.multiply({1})" },
  IntegerNegate: { template: "{0}.negate()" },
  IntegerPow: { template: "{0}.pow({1})" },
  IntegerRemainder: { template: "{0}.remainder({1})" },
  IntegerSign: { template: "{0}.sign()" },
  IntegerSubtract: { template: "{0}.subtract({1})" },
  IntegerToFloat: { template: "{0}.toFloat()" },
  InvertPatch: { template: "East.invertPatch({0}, {T0})" },
  Is: { template: "East.is({0}, {1})" },
  Less: { template: "East.less({0}, {1})" },
  LessEqual: { template: "East.lessEqual({0}, {1})" },
  MatrixAddScaled: { template: "{0}.addScaled({1}, {2})" },
  MatrixColSums: { template: "{0}.colSums()" },
  MatrixCols: { template: "{0}.cols()" },
  MatrixFill: { template: "East.Matrix.fill({0}, {1}, {2})" },
  MatrixFromArray: { template: "East.Matrix.fromArray({0})" },
  MatrixFromRows: { template: "East.Matrix.fromRows({0})" },
  MatrixGet: { template: "{0}.get({1}, {2})" },
  MatrixGetCol: { template: "{0}.getCol({1})" },
  MatrixGetRow: { template: "{0}.getRow({1})" },
  MatrixMapRows: { template: "{0}.mapRows({1})", callbacks: [1] },
  MatrixMulElementwise: { template: "{0}.mulElementwise({1})" },
  MatrixOnes: { template: "East.Matrix.ones({0}, {1})", floatOnly: true },
  MatrixRowSums: { template: "{0}.rowSums()" },
  MatrixRows: { template: "{0}.rows()" },
  MatrixScale: { template: "{0}.scale({1})" },
  MatrixSet: { template: "{0}.set({1}, {2}, {3})" },
  MatrixToArray: { template: "{0}.toArray()" },
  MatrixToRows: { template: "{0}.toRows()" },
  MatrixToVector: { template: "{0}.toVector()" },
  MatrixTranspose: { template: "{0}.transpose()" },
  MatrixVecMul: { template: "{0}.vecMul({1})" },
  MatrixZeros: { template: "East.Matrix.zeros({0}, {1})", floatOnly: true },
  NotEqual: { template: "East.notEqual({0}, {1})" },
  Parse: { template: "{0}.parse({T0})" },
  Print: { template: "East.print({0})" },
  RefGet: { template: "{0}.get()" },
  RefMerge: { template: "{0}.merge({1}, {2})", callbacks: [2], exprs: [1] },
  RefUpdate: { template: "{0}.update({1})", exprs: [1] },
  RegexContains: { template: "{0}.contains({R})", adapter: "regex" },
  RegexIndexOf: { template: "{0}.indexOf({R})", adapter: "regex" },
  RegexReplace: { template: "{0}.replace({R}, {3})", adapter: "regex" },
  SetClear: { template: "{0}.clear()" },
  SetCopy: { template: "{0}.copy()" },
  SetDelete: { template: "{0}.delete({1})" },
  SetDiff: { template: "{0}.difference({1})" },
  SetFilter: { template: "{0}.filter({1})", callbacks: [1] },
  SetFilterMap: { template: "{0}.filterMap({1})", callbacks: [1] },
  SetFirstMap: { template: "{0}.firstMap({1})", callbacks: [1] },
  SetFlattenToArray: { template: "{0}.flattenToArray({1})", callbacks: [1] },
  SetFlattenToDict: { template: "{0}.flattenToDict({1}, {2})", callbacks: [1, 2] },
  SetFlattenToSet: { template: "{0}.flattenToSet({1})", callbacks: [1] },
  SetForEach: { template: "{0}.forEach({1})", callbacks: [1] },
  SetGenerate: { template: "East.Set.generate({0}, {T0}, {1}, {2})", callbacks: [1, 2] },
  SetGroupFold: { template: "{0}.groupReduce({1}, {2}, {3})", callbacks: [1, 2, 3] },
  SetHas: { template: "{0}.has({1})" },
  SetInsert: { template: "{0}.insert({1})" },
  SetIntersect: { template: "{0}.intersection({1})" },
  SetIsDisjoint: { template: "{0}.isDisjointFrom({1})" },
  SetIsSubset: { template: "{0}.isSubsetOf({1})" },
  SetMap: { template: "{0}.map({1})", callbacks: [1] },
  SetMapReduce: { template: "{0}.mapReduce({1}, {2})", callbacks: [1, 2] },
  SetReduce: { template: "{0}.reduce({1}, {2})", callbacks: [1], inferred: [2] },
  SetScan: { template: "{0}.scan({1}, {2})", callbacks: [1], inferred: [2] },
  SetSize: { template: "{0}.size()" },
  SetSymDiff: { template: "{0}.symmetricDifference({1})" },
  SetToArray: { template: "{0}.toArray({1})", callbacks: [1] },
  SetToDict: { template: "{0}.toDict({1}, {2}, {3})", callbacks: [1, 2, 3] },
  SetToSet: { template: "{0}.toSet({1})", callbacks: [1] },
  SetTryDelete: { template: "{0}.tryDelete({1})" },
  SetTryInsert: { template: "{0}.tryInsert({1})" },
  SetUnion: { template: "{0}.union({1})" },
  SetUnionInPlace: { template: "{0}.unionInPlace({1})" },
  SparseAxpy: { template: "East.Vector.sparseAxpy({0}, {1}, {2}, {3}, {4})" },
  SparseFilterGt: { template: "East.Vector.sparseFilterGt({0}, {1}, {2})" },
  SparseFromPairs: { template: "East.Vector.sparseFromPairs({0}, {1})" },
  StringConcat: { template: "{0}.concat({1})" },
  StringContains: { template: "{0}.contains({1})" },
  StringEncodeUtf16: { template: "{0}.encodeUtf16()" },
  StringEncodeUtf8: { template: "{0}.encodeUtf8()" },
  StringEndsWith: { template: "{0}.endsWith({1})" },
  StringIndexOf: { template: "{0}.indexOf({1})" },
  StringLength: { template: "{0}.length()" },
  StringLowerCase: { template: "{0}.lowerCase()" },
  StringParseJSON: { template: "{0}.parseJson({T0})" },
  StringPrintJSON: { template: "East.String.printJson({0})" },
  StringRepeat: { template: "{0}.repeat({1})" },
  StringReplace: { template: "{0}.replace({1}, {2})" },
  StringSplit: { template: "{0}.split({1})" },
  StringStartsWith: { template: "{0}.startsWith({1})" },
  StringSubstring: { template: "{0}.substring({1}, {2})" },
  StringTrim: { template: "{0}.trim()" },
  StringTrimEnd: { template: "{0}.trimEnd()" },
  StringTrimStart: { template: "{0}.trimStart()" },
  StringUpperCase: { template: "{0}.upperCase()" },
  VectorAbs: { template: "{0}.abs()" },
  VectorAddScalar: { template: "{0}.addScalar({1})" },
  VectorAddScaled: { template: "{0}.addScaled({1}, {2})" },
  VectorArgMax: { template: "{0}.argMax()" },
  VectorArgMin: { template: "{0}.argMin()" },
  VectorClamp: { template: "{0}.clamp({1}, {2})" },
  VectorCompress: { template: "{1}.compress({0})" },
  VectorConcat: { template: "{0}.concat({1})", exprs: [1] },
  VectorCountTrue: { template: "{0}.countTrue()" },
  VectorCumSum: { template: "{0}.cumSum()" },
  VectorDot: { template: "{0}.dot({1})" },
  VectorEq: { template: "{0}.eq({1})" },
  VectorFill: { template: "East.Vector.fill({0}, {1})" },
  VectorFold: { template: "{0}.reduce({2}, {1})", callbacks: [2], inferred: [1] },
  VectorFromArray: { template: "East.Vector.fromArray({0})" },
  VectorGather: { template: "{0}.gather({1})" },
  VectorGet: { template: "{0}.get({1})" },
  VectorGt: { template: "{0}.gt({1})" },
  VectorLength: { template: "{0}.length()" },
  VectorLt: { template: "{0}.lt({1})" },
  VectorMap: { template: "{0}.map({1})", callbacks: [1] },
  VectorMax: { template: "{0}.max()" },
  VectorMean: { template: "{0}.mean()" },
  VectorMin: { template: "{0}.min()" },
  VectorMul: { template: "{0}.mul({1})" },
  VectorOnes: { template: "East.Vector.ones({0})", floatOnly: true },
  VectorScale: { template: "{0}.scale({1})" },
  VectorScatterAdd: { template: "{0}.scatterAdd({1}, {2})" },
  VectorSearchSorted: { template: "{0}.searchSorted({1})" },
  VectorSelect: { template: "{0}.select({1}, {2})", exprs: [1] },
  VectorSet: { template: "{0}.set({1}, {2})" },
  VectorSlice: { template: "{0}.slice({1}, {2})" },
  VectorSum: { template: "{0}.sum()" },
  VectorToArray: { template: "{0}.toArray()" },
  VectorToMatrix: { template: "{0}.toMatrix({1}, {2})" },
  VectorZeros: { template: "East.Vector.zeros({0})", floatOnly: true },
};

/**
 * Builtins with no TypeScript spelling — printed through `East.builtin(...)`.
 *
 * `ArrayGetKeys` carries a hand-built getter callback the surface derives
 * from the receiver; the formatted-datetime pair takes a pre-tokenized token
 * array the surface builds from a format STRING; `ArraySortDefault` is the
 * python-only keyless sort (TypeScript's `sort()` is `ArraySort` over the
 * identity); `MatrixMapElements` has no method on either surface.
 */
export const RAW_ONLY: ReadonlySet<string> = new Set([
  "ArrayGetKeys",
  "ArraySortDefault",
  "DateTimeParseFormat",
  "DateTimePrintFormat",
  "MatrixMapElements",
]);

/**
 * Looks up the spelling row of a builtin.
 *
 * @param name - The builtin's IR name
 * @returns The row, or `undefined` when the builtin prints raw
 */
export function spellingFor(name: string): Spelling | undefined {
  return Object.prototype.hasOwnProperty.call(SPELLINGS, name) ? SPELLINGS[name] : undefined;
}
