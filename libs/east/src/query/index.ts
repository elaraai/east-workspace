/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
export {
  JqPatternType, JqType,
  QueryMultiplicityType, QueryV1Type, QueryType,
  QuerySpanType, QueryEditType, QueryFixType, QueryErrorType, QueryResultType,
} from "./types.js";
export { lexJq, type JqToken, type JqTokenKind } from "./jq/lex.js";
export { parseJq, type ParsedJq } from "./jq/parse.js";
export { printJq, type PrintJqOptions, type PrintedJq } from "./jq/print.js";
export { pathAt, spanOf, toQuerySpan, type JqNode, type JqPattern, type JqRange, type JqSpans } from "./jq/spans.js";
export {
  checkJq, type CheckJqOptions, type CheckJqResult, type CheckedNode, type CheckedStage, type JqMultiplicity,
} from "./jq/check.js";
