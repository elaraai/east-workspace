/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The jq parser: jq 1.8's grammar (`src/parser.y`) into {@link JqType}
 * values, with a span for every node and `syntax` diagnostics.
 *
 * @packageDocumentation
 */

import { none, some, variant, type option } from "../../containers/variant.js";
import type { ValueTypeOf } from "../../types.js";
import type { QueryErrorType, QueryFixType } from "../types.js";
import { scanJq, type JqLexeme } from "./lex.js";
import {
  childPath, jqChildren, jqPatternChildren, toQuerySpan,
  type JqNode, type JqPattern, type JqRange, type JqSpans,
} from "./spans.js";

/** A diagnostic, as the query wire types hold it. */
type QueryError = ValueTypeOf<typeof QueryErrorType>;
type QueryFix = ValueTypeOf<typeof QueryFixType>;
/** A part of an interpolating string: the payload of {@link JqType}'s `string` case. */
type StringPart = Extract<JqNode, { type: "string" }>["value"][number];
/** An entry of an object construction: the payload of {@link JqType}'s `object` case. */
type ObjectEntry = Extract<JqNode, { type: "object" }>["value"][number];

/**
 * A parsed jq program.
 *
 * @remarks
 * `program` is `none` when any diagnostic was reported, and `spans` is then
 * empty. Otherwise `spans` holds the range of text of every node of
 * `program`, the root's (`""`) covering the whole text. A node's range leaves
 * out the parentheses around it and takes in those around its operands, so
 * `printJq` gives the same ranges for the text it prints.
 */
export interface ParsedJq {
  /** The text that was parsed. */
  text: string;
  /** The program, or `none` when the text has a syntax problem. */
  program: option<JqNode>;
  /** Where each node of the program is in the text, by its path. */
  spans: JqSpans;
  /** The syntax problems, each with its span and any fix. */
  diagnostics: QueryError[];
}

const INTEGER_MAX = 9223372036854775807n;

const UPDATE_OPS: ReadonlySet<string> = new Set(["=", "|=", "+=", "-=", "*=", "/=", "%=", "//="]);
const COMPARISON_OPS: ReadonlySet<string> = new Set(["==", "!=", "<", "<=", ">", ">="]);

/** Keywords that open a filter in a query position. */
const FILTER_KEYWORDS: ReadonlySet<string> = new Set([
  "def", "label", "reduce", "foreach", "if", "try", "break", "import", "include", "module",
]);

/** Keywords a query may not use: they load modules. */
const MODULE_KEYWORDS: ReadonlySet<string> = new Set(["import", "include", "module"]);

/** Thrown to abandon a parse with its diagnostic. */
class JqSyntaxError extends Error {
  constructor(readonly diagnostic: QueryError, readonly token: number) {
    super(diagnostic.message);
  }
}

/**
 * Builds a diagnostic.
 *
 * @param text - the parsed text
 * @param code - `syntax`, or `unsupported` for a module keyword
 * @param range - the text it is about, or `undefined` for none
 * @param message - its sentence
 * @param fixes - its one-click fixes
 * @returns the diagnostic
 */
function diagnostic(text: string, code: string, range: JqRange | undefined, message: string, fixes: QueryFix[] = []): QueryError {
  return {
    code,
    fixes,
    message,
    severity: variant("error", null),
    span: range === undefined ? none : some(toQuerySpan(text, range.from, range.to)),
    suggestions: [],
  };
}

/**
 * A one-click fix of one text edit.
 *
 * @param label - what the fix does
 * @param offset - where the edit starts
 * @param length - how many code units it replaces
 * @param insert - what it inserts
 * @returns the fix
 */
function fix(label: string, offset: number, length: number, insert: string): QueryFix {
  return { edits: [{ insert, length: BigInt(length), offset: BigInt(offset) }], label };
}

/** The bracket a punctuation opens or closes, paired. */
const CLOSER: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };

/**
 * Reports the brackets that do not pair: a closer with no opener, a closer of
 * the wrong kind, and an opener never closed.
 *
 * @param text - the text
 * @param lexemes - its lexemes
 * @returns one diagnostic per bracket problem
 */
function checkBrackets(text: string, lexemes: readonly JqLexeme[]): QueryError[] {
  const problems: QueryError[] = [];
  const open: JqLexeme[] = [];
  for (const t of lexemes) {
    if ((t.role === "punct" && CLOSER[t.value] !== undefined) || t.role === "interp_start") {
      open.push(t);
    } else if (t.role === "punct" && (t.value === ")" || t.value === "]" || t.value === "}")) {
      const top = open[open.length - 1];
      if (top === undefined || top.role === "interp_start") {
        problems.push(diagnostic(text, "syntax", t, `syntax: unexpected "${t.value}".`));
      } else if (CLOSER[top.value] === t.value) {
        open.pop();
      } else {
        const { column } = toQuerySpan(text, top.from, top.to);
        problems.push(diagnostic(text, "syntax", t,
          `syntax: unexpected "${t.value}" — "${top.value}" at column ${column} is still open.`));
        open.pop();
      }
    } else if (t.role === "interp_end") {
      while (open.length > 0 && open[open.length - 1]!.role !== "interp_start") {
        const unclosed = open.pop()!;
        problems.push(neverClosed(text, unclosed));
      }
      open.pop();
    }
  }
  for (const unclosed of open) {
    if (unclosed.role !== "interp_start") problems.push(neverClosed(text, unclosed));
  }
  return problems;
}

/**
 * The diagnostic for an opening bracket never closed, with its fix.
 *
 * @param text - the text
 * @param opener - the bracket
 * @returns the diagnostic
 */
function neverClosed(text: string, opener: JqLexeme): QueryError {
  return diagnostic(text, "syntax", opener, `syntax: "${opener.value}" is never closed.`,
    [fix("Close it", text.length, 0, CLOSER[opener.value]!)]);
}

/**
 * Describes a token for a message.
 *
 * @param t - the token, or `undefined` for the end of the text
 * @returns `end of input`, `a string`, or the token's text in quotes
 */
function describe(t: JqLexeme | undefined): string {
  if (t === undefined) return "end of input";
  if (t.role === "string_start" || t.role === "unterminated") return "a string";
  return `"${t.text}"`;
}

/** A string term: a constant, or text with interpolations. */
type StringTerm = { constant: string; node: JqNode } | { constant: undefined; node: JqNode };

/**
 * A recursive-descent parser over the significant lexemes of a text, from a
 * starting lexeme.
 */
class Parser {
  /** Each node's and pattern's range, by the object. */
  readonly ranges = new Map<object, JqRange>();
  /** Where each parenthesised node's text starts: its outermost `(`. */
  private readonly opens = new Map<object, number>();
  private at: number;
  private lastEnd = 0;

  constructor(private readonly text: string, private readonly toks: readonly JqLexeme[], start: number) {
    this.at = start;
  }

  /** The index of the lexeme the parser is at. */
  get position(): number {
    return this.at;
  }

  private peek(ahead = 0): JqLexeme | undefined {
    return this.toks[this.at + ahead];
  }

  private next(): JqLexeme {
    const t = this.toks[this.at];
    if (t === undefined) throw this.unexpected("a filter");
    this.at += 1;
    this.lastEnd = t.to;
    return t;
  }

  private isOp(value: string, ahead = 0): boolean {
    const t = this.peek(ahead);
    return t?.role === "op" && t.value === value;
  }

  private isPunct(value: string, ahead = 0): boolean {
    const t = this.peek(ahead);
    return t?.role === "punct" && t.value === value;
  }

  private isKeyword(value: string, ahead = 0): boolean {
    const t = this.peek(ahead);
    return t?.role === "keyword" && t.value === value;
  }

  /** Records a node's range, from `from` to the last lexeme read. */
  private mk<T extends object>(node: T, from: number): T {
    this.ranges.set(node, { from, to: this.lastEnd });
    return node;
  }

  private from(node: object): number {
    return this.ranges.get(node)!.from;
  }

  /** Where a node's text starts with the parentheses around it: where a node
   *  built on it starts. */
  private start(node: object): number {
    return this.opens.get(node) ?? this.from(node);
  }

  /** A diagnostic for the lexeme the parser is at. */
  unexpected(expected: string): JqSyntaxError {
    const t = this.peek();
    const range = t ?? { from: this.text.length, to: this.text.length };
    return new JqSyntaxError(
      diagnostic(this.text, "syntax", range, `syntax: unexpected ${describe(t)}; expected ${expected}.`),
      this.at,
    );
  }

  private expectPunct(value: string, expected = `"${value}"`): JqLexeme {
    if (!this.isPunct(value)) throw this.unexpected(expected);
    return this.next();
  }

  private expectOp(value: string, expected = `"${value}"`): JqLexeme {
    if (!this.isOp(value)) throw this.unexpected(expected);
    return this.next();
  }

  private expectKeyword(value: string, expected = `"${value}"`): JqLexeme {
    if (!this.isKeyword(value)) throw this.unexpected(expected);
    return this.next();
  }

  private expectVariable(expected: string): string {
    const t = this.peek();
    if (t?.role !== "variable") throw this.unexpected(expected);
    this.next();
    return t.value;
  }

  /** Whether a lexeme can begin a filter. */
  private startsFilter(t: JqLexeme | undefined): boolean {
    if (t === undefined) return false;
    switch (t.role) {
      case "field": case "ident": case "loc": case "variable": case "format": case "number": case "string_start":
        return true;
      case "punct":
        return t.value === "." || t.value === ".." || t.value === "(" || t.value === "[" || t.value === "{";
      case "op":
        return t.value === "-";
      case "keyword":
        return FILTER_KEYWORDS.has(t.value);
      default:
        return false;
    }
  }

  /** Reads a `|` that must be followed by a filter. */
  private pipeThenFilter(): void {
    const bar = this.next();
    if (!this.startsFilter(this.peek())) {
      throw new JqSyntaxError(
        diagnostic(this.text, "syntax", bar, "syntax: expected a filter after \"|\".", [fix("Remove the |", bar.from, 1, "")]),
        this.at - 1,
      );
    }
  }

  /** Reads the whole program. */
  parseProgram(): JqNode {
    const node = this.parseQuery();
    if (this.peek() !== undefined) throw this.unexpected("\"|\", \",\" or end of input");
    return node;
  }

  /** Query: pipes, right-associative, over commas. */
  parseQuery(): JqNode {
    const left = this.parseComma();
    if (this.isOp("|")) {
      this.pipeThenFilter();
      const right = this.parseQuery();
      return this.mk(variant("pipe", { left, right }), this.start(left));
    }
    return left;
  }

  private parseComma(): JqNode {
    let left = this.parseBinding();
    while (this.isOp(",")) {
      this.next();
      const right = this.parseBinding();
      left = this.mk(variant("comma", { left, right }), this.start(left));
    }
    return left;
  }

  /** `def f: body; rest`, `label $name | body`, `source as $p | body`, or an expression. */
  private parseBinding(): JqNode {
    const t = this.peek();
    if (t?.role === "keyword" && t.value === "def") {
      this.next();
      const nameToken = this.peek();
      if (nameToken?.role !== "ident") throw this.unexpected("a function name");
      this.next();
      const params: string[] = [];
      if (this.isPunct("(")) {
        this.next();
        for (;;) {
          const param = this.peek();
          if (param?.role === "variable") params.push(`$${param.value}`);
          else if (param?.role === "ident") params.push(param.value);
          else throw this.unexpected("a parameter (name or $name)");
          this.next();
          if (this.isPunct(";")) { this.next(); continue; }
          this.expectPunct(")", "\";\" or \")\"");
          break;
        }
      }
      this.expectPunct(":");
      const body = this.parseQuery();
      this.expectPunct(";", "\";\" after the definition");
      const rest = this.parseQuery();
      return this.mk(variant("def", { body, name: nameToken.value, params, rest }), t.from);
    }
    if (t?.role === "keyword" && t.value === "label") {
      this.next();
      const name = this.expectVariable("a label ($name)");
      if (!this.isOp("|")) throw this.unexpected("\"|\"");
      this.pipeThenFilter();
      const body = this.parseQuery();
      return this.mk(variant("label", { body, name }), t.from);
    }
    const source = this.parseExpr();
    if (this.isKeyword("as")) {
      this.next();
      const patterns = [this.parsePattern()];
      while (this.isOp("?//")) {
        this.next();
        patterns.push(this.parsePattern());
      }
      if (!this.isOp("|")) throw this.unexpected("\"|\" or \"?//\"");
      this.pipeThenFilter();
      const body = this.parseQuery();
      return this.mk(variant("bind", { body, patterns, source }), this.start(source));
    }
    return source;
  }

  /** An expression: `//` and below. */
  private parseExpr(): JqNode {
    const left = this.parseUpdate();
    if (this.isOp("//")) {
      this.next();
      const right = this.parseExpr();
      return this.mk(variant("alternative", { left, right }), this.start(left));
    }
    return left;
  }

  /** Update-assignment, non-associative. */
  private parseUpdate(): JqNode {
    const path = this.parseOr();
    const t = this.peek();
    if (t?.role === "op" && UPDATE_OPS.has(t.value)) {
      this.next();
      const value = this.parseOr();
      const again = this.peek();
      if (again?.role === "op" && UPDATE_OPS.has(again.value)) {
        throw this.unexpected(`parentheses around one side of "${t.value}"`);
      }
      return this.mk(variant("update", { op: t.value, path, value }), this.start(path));
    }
    return path;
  }

  private parseOr(): JqNode {
    let left = this.parseAnd();
    while (this.isKeyword("or")) {
      this.next();
      const right = this.parseAnd();
      left = this.mk(variant("binary", { left, op: "or", right }), this.start(left));
    }
    return left;
  }

  private parseAnd(): JqNode {
    let left = this.parseComparison();
    while (this.isKeyword("and")) {
      this.next();
      const right = this.parseComparison();
      left = this.mk(variant("binary", { left, op: "and", right }), this.start(left));
    }
    return left;
  }

  /** Comparisons, non-associative. */
  private parseComparison(): JqNode {
    const left = this.parseAdditive();
    const t = this.peek();
    if (t?.role === "op" && COMPARISON_OPS.has(t.value)) {
      this.next();
      const right = this.parseAdditive();
      const again = this.peek();
      if (again?.role === "op" && COMPARISON_OPS.has(again.value)) {
        throw this.unexpected(`parentheses around one side of "${t.value}"`);
      }
      return this.mk(variant("binary", { left, op: t.value, right }), this.start(left));
    }
    return left;
  }

  private parseAdditive(): JqNode {
    let left = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      if (t?.role !== "op" || (t.value !== "+" && t.value !== "-")) return left;
      this.next();
      const right = this.parseMultiplicative();
      left = this.mk(variant("binary", { left, op: t.value, right }), this.start(left));
    }
  }

  private parseMultiplicative(): JqNode {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t?.role !== "op" || (t.value !== "*" && t.value !== "/" && t.value !== "%")) return left;
      this.next();
      const right = this.parseTerm();
      left = this.mk(variant("binary", { left, op: t.value, right }), this.start(left));
    }
  }

  /** A term: `-` over a term, or a postfix term. */
  private parseTerm(): JqNode {
    const t = this.peek();
    if (t?.role === "op" && t.value === "-") {
      this.next();
      const operand = this.parseTerm();
      return this.mk(variant("negate", operand), t.from);
    }
    return this.parsePostfix();
  }

  /** A primary term and its postfix operators. */
  private parsePostfix(): JqNode {
    const start = this.peek();
    let node = this.parsePrimary();
    // `try` takes every postfix operator into its body or handler.
    if (start?.role === "keyword" && start.value === "try") return node;
    const from = this.start(node);
    for (;;) {
      const t = this.peek();
      if (t?.role === "field") {
        this.next();
        const optional = this.eatOptional();
        node = this.mk(variant("field", { name: t.value, optional, target: node }), from);
      } else if (this.isPunct(".") && (this.peek(1)?.role === "string_start" || this.peek(1)?.role === "format")) {
        this.next();
        node = this.fieldOrIndex(node, this.parseKeyString(), from);
      } else if (this.isPunct(".") && this.isPunct("[", 1)) {
        this.next();
        node = this.parseBracketSuffix(node, from);
      } else if (this.isPunct("[")) {
        node = this.parseBracketSuffix(node, from);
      } else if (this.isOp("?")) {
        this.next();
        node = this.mk(variant("try", { body: node, catch: none }), from);
      } else {
        return node;
      }
    }
  }

  private eatOptional(): boolean {
    if (!this.isOp("?")) return false;
    this.next();
    return true;
  }

  /** `t."name"` is a field; `t."a\(f)"` indexes by the string. */
  private fieldOrIndex(target: JqNode, key: StringTerm, from: number): JqNode {
    const optional = this.eatOptional();
    if (key.constant !== undefined) return this.mk(variant("field", { name: key.constant, optional, target }), from);
    return this.mk(variant("index", { index: key.node, optional, target }), from);
  }

  /** `t[]`, `t[e]`, `t[a:b]`, `t[a:]`, `t[:b]`, each with an optional `?`. */
  private parseBracketSuffix(target: JqNode, from: number): JqNode {
    this.expectPunct("[");
    if (this.isPunct("]")) {
      this.next();
      const optional = this.eatOptional();
      return this.mk(variant("iterate", { optional, target }), from);
    }
    if (this.isPunct(":")) {
      this.next();
      const to = this.parseQuery();
      this.expectPunct("]");
      const optional = this.eatOptional();
      return this.mk(variant("slice", { from: none, optional, target, to: some(to) }), from);
    }
    const index = this.parseQuery();
    if (this.isPunct(":")) {
      this.next();
      if (this.isPunct("]")) {
        this.next();
        const optional = this.eatOptional();
        return this.mk(variant("slice", { from: some(index), optional, target, to: none }), from);
      }
      const to = this.parseQuery();
      this.expectPunct("]");
      const optional = this.eatOptional();
      return this.mk(variant("slice", { from: some(index), optional, target, to: some(to) }), from);
    }
    this.expectPunct("]", "\"]\" or \":\"");
    const optional = this.eatOptional();
    return this.mk(variant("index", { index, optional, target }), from);
  }

  /** A primary term. */
  private parsePrimary(): JqNode {
    const t = this.peek();
    if (t === undefined) throw this.unexpected("a filter");
    switch (t.role) {
      case "field": {
        this.next();
        // `.name` reads the field of `.`, whose text is the dot.
        const identity = variant("identity", null);
        this.ranges.set(identity, { from: t.from, to: t.from + 1 });
        const optional = this.eatOptional();
        return this.mk(variant("field", { name: t.value, optional, target: identity }), t.from);
      }
      case "number":
        this.next();
        return this.mk(this.numberLiteral(t), t.from);
      case "string_start": case "format": {
        const term = this.parseStringTerm();
        return term.node;
      }
      case "variable":
        this.next();
        return this.mk(variant("variable", t.value), t.from);
      case "loc":
        this.next();
        return this.mk(variant("variable", "__loc__"), t.from);
      case "ident":
        return this.parseIdentifier(t);
      case "punct":
        return this.parsePunctuation(t);
      case "keyword":
        return this.parseKeywordTerm(t);
      default:
        throw this.unexpected("a filter");
    }
  }

  private parsePunctuation(t: JqLexeme): JqNode {
    switch (t.value) {
      case ".": {
        this.next();
        const identity = this.mk(variant("identity", null), t.from);
        const after = this.peek();
        if (after?.role === "string_start" || after?.role === "format") {
          return this.fieldOrIndex(identity, this.parseKeyString(), t.from);
        }
        return identity;
      }
      case "..":
        this.next();
        return this.mk(variant("descend", null), t.from);
      case "(": {
        this.next();
        const inner = this.parseQuery();
        this.expectPunct(")");
        // The node's own span leaves out its parentheses; a node built on it
        // starts at the outermost `(`.
        this.opens.set(inner, t.from);
        return inner;
      }
      case "[": {
        this.next();
        if (this.isPunct("]")) {
          this.next();
          return this.mk(variant("array", none), t.from);
        }
        const body = this.parseQuery();
        this.expectPunct("]");
        return this.mk(variant("array", some(body)), t.from);
      }
      case "{":
        return this.parseObject(t);
      default:
        throw this.unexpected("a filter");
    }
  }

  private parseIdentifier(t: JqLexeme): JqNode {
    this.next();
    if (!this.isPunct("(")) {
      if (t.value === "null") return this.mk(variant("literal", variant("null", null)), t.from);
      if (t.value === "true") return this.mk(variant("literal", variant("boolean", true)), t.from);
      if (t.value === "false") return this.mk(variant("literal", variant("boolean", false)), t.from);
      return this.mk(variant("call", { args: [], name: t.value }), t.from);
    }
    this.next();
    const args = [this.parseQuery()];
    while (this.isPunct(";")) {
      this.next();
      args.push(this.parseQuery());
    }
    this.expectPunct(")", "\";\" or \")\"");
    return this.mk(variant("call", { args, name: t.value }), t.from);
  }

  private parseKeywordTerm(t: JqLexeme): JqNode {
    switch (t.value) {
      case "reduce": {
        this.next();
        const source = this.parseExpr();
        this.expectKeyword("as");
        const pattern = this.parsePattern();
        this.expectPunct("(");
        const init = this.parseQuery();
        this.expectPunct(";");
        const update = this.parseQuery();
        this.expectPunct(")");
        return this.mk(variant("reduce", { init, pattern, source, update }), t.from);
      }
      case "foreach": {
        this.next();
        const source = this.parseExpr();
        this.expectKeyword("as");
        const pattern = this.parsePattern();
        this.expectPunct("(");
        const init = this.parseQuery();
        this.expectPunct(";");
        const update = this.parseQuery();
        let extract: option<JqNode> = none;
        if (this.isPunct(";")) {
          this.next();
          extract = some(this.parseQuery());
        }
        this.expectPunct(")", "\";\" or \")\"");
        return this.mk(variant("foreach", { extract, init, pattern, source, update }), t.from);
      }
      case "if": {
        this.next();
        const branches: { condition: JqNode; then: JqNode }[] = [];
        let condition = this.parseQuery();
        this.expectKeyword("then");
        branches.push({ condition, then: this.parseQuery() });
        let otherwise: option<JqNode> = none;
        for (;;) {
          if (this.isKeyword("elif")) {
            this.next();
            condition = this.parseQuery();
            this.expectKeyword("then");
            branches.push({ condition, then: this.parseQuery() });
          } else if (this.isKeyword("else")) {
            this.next();
            otherwise = some(this.parseQuery());
            this.expectKeyword("end");
            break;
          } else if (this.isKeyword("end")) {
            this.next();
            break;
          } else {
            throw this.unexpected("\"elif\", \"else\" or \"end\"");
          }
        }
        return this.mk(variant("if", { branches, otherwise }), t.from);
      }
      case "try": {
        this.next();
        const body = this.parseTerm();
        let handler: option<JqNode> = none;
        if (this.isKeyword("catch")) {
          this.next();
          handler = some(this.parseTerm());
        }
        return this.mk(variant("try", { body, catch: handler }), t.from);
      }
      case "break": {
        this.next();
        const name = this.expectVariable("a label ($name)");
        return this.mk(variant("break", name), t.from);
      }
      default:
        if (MODULE_KEYWORDS.has(t.value)) {
          throw new JqSyntaxError(
            diagnostic(this.text, "unsupported", t,
              `unsupported: ${t.value} is excluded — queries are deterministic and have no host access.`),
            this.at,
          );
        }
        throw this.unexpected("a filter");
    }
  }

  /** A number literal: an Integer when written without `.` or an exponent. */
  private numberLiteral(t: JqLexeme): JqNode {
    if (/^[0-9]+$/.test(t.value)) {
      const value = BigInt(t.value);
      if (value > INTEGER_MAX) {
        throw new JqSyntaxError(diagnostic(this.text, "syntax", t,
          `syntax: ${t.value} is too large for an Integer; write ${t.value}.0 for a Float.`), this.at - 1);
      }
      return variant("literal", variant("integer", value));
    }
    const value = Number(t.value);
    if (!Number.isFinite(value)) {
      throw new JqSyntaxError(diagnostic(this.text, "syntax", t, `syntax: ${t.value} is too large for a Float.`), this.at - 1);
    }
    return variant("literal", variant("float", value));
  }

  /** A string naming a field or a key: `@format` must be followed by its
   *  string there, as in jq. */
  private parseKeyString(): StringTerm {
    const t = this.peek()!;
    if (t.role === "format" && this.peek(1)?.role !== "string_start") {
      this.next();
      throw this.unexpected(`a string after @${t.value}`);
    }
    return this.parseStringTerm();
  }

  /** A string, with an optional `@format` before it, or a bare `@format`. */
  private parseStringTerm(): StringTerm {
    const t = this.peek()!;
    if (t.role === "format") {
      this.next();
      if (this.peek()?.role !== "string_start") {
        return { constant: undefined, node: this.mk(variant("format", { name: t.value, string: none }), t.from) };
      }
      const string = this.parseString();
      return { constant: undefined, node: this.mk(variant("format", { name: t.value, string: some(string.node) }), t.from) };
    }
    return this.parseString();
  }

  /** A string: a constant, or a `string` node when it interpolates. */
  private parseString(): StringTerm {
    const start = this.peek();
    if (start?.role !== "string_start") throw this.unexpected("a string");
    this.next();
    const parts: StringPart[] = [];
    let text = "";
    for (;;) {
      const t = this.next();
      if (t.role === "string_text") {
        text += t.value;
      } else if (t.role === "interp_start") {
        if (text !== "") parts.push(variant("text", text));
        text = "";
        const inner = this.parseQuery();
        if (this.peek()?.role !== "interp_end") throw this.unexpected("\")\" to close the interpolation");
        this.next();
        parts.push(variant("interpolate", inner));
      } else {
        break;   // string_end: the lexer and the bracket check guarantee it
      }
    }
    if (parts.length === 0) return { constant: text, node: this.mk(variant("literal", variant("string", text)), start.from) };
    if (text !== "") parts.push(variant("text", text));
    return { constant: undefined, node: this.mk(variant("string", parts), start.from) };
  }

  /** `{…}`: literal keys build Structs, computed keys Dicts. */
  private parseObject(open: JqLexeme): JqNode {
    this.next();
    const entries: ObjectEntry[] = [];
    if (this.isPunct("}")) {
      this.next();
      return this.mk(variant("object", entries), open.from);
    }
    for (;;) {
      entries.push(this.parseObjectEntry());
      if (this.isOp(",")) {
        this.next();
        if (this.isPunct("}")) { this.next(); break; }
        continue;
      }
      this.expectPunct("}", "\",\" or \"}\"");
      break;
    }
    return this.mk(variant("object", entries), open.from);
  }

  private parseObjectEntry(): ObjectEntry {
    const t = this.peek();
    let key: ObjectEntry["key"];
    let valueRequired = false;
    if (t?.role === "ident" || t?.role === "keyword") {
      this.next();
      key = variant("name", t.value);
    } else if (t?.role === "string_start" || t?.role === "format") {
      const term = this.parseKeyString();
      key = term.constant !== undefined ? variant("name", term.constant) : variant("computed", term.node);
    } else if (t?.role === "variable") {
      this.next();
      key = variant("variable", t.value);
    } else if (t?.role === "loc") {
      this.next();
      return { key: variant("variable", "__loc__"), value: none };
    } else if (t?.role === "punct" && t.value === "(") {
      this.next();
      const computed = this.parseQuery();
      this.expectPunct(")");
      key = variant("computed", computed);
      valueRequired = true;
    } else {
      throw this.unexpected("a key");
    }
    if (!this.isPunct(":")) {
      if (valueRequired) throw this.unexpected("\":\"");
      return { key, value: none };
    }
    this.next();
    return { key, value: some(this.parseObjectValue()) };
  }

  /** An object's value: an expression, or expressions piped. */
  private parseObjectValue(): JqNode {
    const left = this.parseExpr();
    if (this.isOp("|")) {
      this.pipeThenFilter();
      const right = this.parseObjectValue();
      return this.mk(variant("pipe", { left, right }), this.start(left));
    }
    return left;
  }

  /** A destructuring pattern. */
  private parsePattern(): JqPattern {
    const t = this.peek();
    if (t?.role === "variable") {
      this.next();
      return this.mk(variant("variable", t.value), t.from);
    }
    if (t?.role === "punct" && t.value === "[") {
      this.next();
      const items = [this.parsePattern()];
      while (this.isOp(",")) {
        this.next();
        items.push(this.parsePattern());
      }
      this.expectPunct("]", "\",\" or \"]\"");
      return this.mk(variant("array", items), t.from);
    }
    if (t?.role === "punct" && t.value === "{") {
      this.next();
      const entries = [this.parseObjectPatternEntry()];
      while (this.isOp(",")) {
        this.next();
        entries.push(this.parseObjectPatternEntry());
      }
      this.expectPunct("}", "\",\" or \"}\"");
      return this.mk(variant("object", entries), t.from);
    }
    throw this.unexpected("a pattern ($name, [...] or {...})");
  }

  private parseObjectPatternEntry(): { key: string; value: option<JqPattern> } {
    const t = this.peek();
    if (t?.role === "variable") {
      this.next();
      if (this.isPunct(":")) {
        throw new JqSyntaxError(diagnostic(this.text, "syntax", { from: t.from, to: this.peek()!.to },
          `syntax: "$${t.value}: pattern" is not supported; write "${t.value}: pattern" and bind $${t.value} separately.`), this.at);
      }
      return { key: t.value, value: none };
    }
    let key: string;
    if (t?.role === "ident" || t?.role === "keyword") {
      this.next();
      key = t.value;
    } else if (t?.role === "string_start" || t?.role === "format") {
      const term = this.parseKeyString();
      if (term.constant === undefined) throw this.computedPatternKey(this.from(term.node));
      key = term.constant;
    } else if (t?.role === "punct" && t.value === "(") {
      throw this.computedPatternKey(t.from);
    } else {
      throw this.unexpected("a key");
    }
    this.expectPunct(":");
    return { key, value: some(this.parsePattern()) };
  }

  private computedPatternKey(from: number): JqSyntaxError {
    return new JqSyntaxError(diagnostic(this.text, "syntax", { from, to: Math.max(from + 1, this.lastEnd) },
      "syntax: computed keys in patterns are not supported (#875 Defer)."), this.at);
  }
}

/**
 * The index after which parsing resumes following a problem at `failed`: the
 * next `|` outside every bracket, `if … end` and `def … ;`.
 *
 * @param toks - the significant lexemes
 * @param failed - the index the problem was found at
 * @returns the index of that `|`, or `undefined` when there is none
 */
function nextTopLevelPipe(toks: readonly JqLexeme[], failed: number): number | undefined {
  const open: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (i > failed && open.length === 0 && t.role === "op" && t.value === "|") return i;
    if ((t.role === "punct" && CLOSER[t.value] !== undefined) || t.role === "interp_start") open.push(t.value);
    else if ((t.role === "punct" && (t.value === ")" || t.value === "]" || t.value === "}")) || t.role === "interp_end") open.pop();
    else if (t.role === "keyword" && (t.value === "if" || t.value === "def")) open.push(t.value);
    else if (t.role === "keyword" && t.value === "end" && open[open.length - 1] === "if") open.pop();
    else if (t.role === "punct" && t.value === ";" && open[open.length - 1] === "def") open.pop();
  }
  return undefined;
}

/**
 * The spans of a program's nodes, by path, from the parser's ranges.
 *
 * @param root - the program
 * @param ranges - each node's and pattern's range
 * @param length - the text's length: the root covers it all
 * @returns the spans
 */
function spansOf(root: JqNode, ranges: ReadonlyMap<object, JqRange>, length: number): Map<string, JqRange> {
  const spans = new Map<string, JqRange>();
  const visitPattern = (pattern: JqPattern, path: string): void => {
    spans.set(path, ranges.get(pattern)!);
    for (const child of jqPatternChildren(pattern)) visitPattern(child.pattern, childPath(path, child.step));
  };
  const visit = (node: JqNode, path: string): void => {
    spans.set(path, path === "" ? { from: 0, to: length } : ranges.get(node)!);
    for (const child of jqChildren(node)) {
      if (child.node !== undefined) visit(child.node, childPath(path, child.step));
      else visitPattern(child.pattern, childPath(path, child.step));
    }
  };
  visit(root, "");
  return spans;
}

/**
 * Parses jq text into a {@link JqType} program.
 *
 * @param text - jq 1.8 text
 * @returns the program with the span of every node, or `none` with the
 *   problems that stopped it
 *
 * @remarks
 * The parser keeps jq's sugar, so printing gives back what was written:
 * `.a.b` is two `field` nodes, `.a?` sets `optional`, and `f?` is a `try`
 * with no `catch`. A literal is the typed East value it writes
 * (`JqLiteralType`): a number written without `.` or an exponent is an
 * Integer (64-bit; larger is a problem), any other number a Float, and a
 * string without interpolation a String. `$__loc__` is the variable
 * `__loc__`; `import`, `include` and `module` are `unsupported`.
 *
 * A problem is a `syntax` diagnostic with its span, and a fix where one is
 * obvious: an unclosed bracket or string is closed, a trailing `|` removed.
 * After a problem the parser resumes at the next `|` outside every bracket,
 * so one typo reports one problem.
 *
 * @example
 * ```ts
 * const parsed = parseJq(".orders | length");
 * parsed.program.type;            // "some"
 * parsed.spans.get("pipe.left");  // { from: 0, to: 7 }
 *
 * parseJq(".orders |").diagnostics[0]!.message;
 * // 'syntax: expected a filter after "|".'
 * ```
 */
export function parseJq(text: string): ParsedJq {
  const lexemes = scanJq(text);
  const diagnostics: QueryError[] = [];
  for (const t of lexemes) {
    if (t.role === "unterminated") {
      diagnostics.push(diagnostic(text, "syntax", t, "syntax: this string is never closed.", [fix("Close it", t.to, 0, "\"")]));
    } else if (t.error !== undefined) {
      diagnostics.push(diagnostic(text, "syntax", t, `syntax: ${t.error}.`));
    }
  }
  diagnostics.push(...checkBrackets(text, lexemes));
  const significant = lexemes.filter(t => t.role !== "ws" && t.role !== "comment");
  if (diagnostics.length === 0 && significant.length === 0) {
    diagnostics.push(diagnostic(text, "syntax", undefined, "syntax: empty program."));
  }
  if (diagnostics.length > 0) return { text, program: none, spans: new Map(), diagnostics };

  let start = 0;
  for (;;) {
    const parser = new Parser(text, significant, start);
    try {
      const program = parser.parseProgram();
      if (start === 0) return { text, program: some(program), spans: spansOf(program, parser.ranges, text.length), diagnostics };
      break;
    } catch (e) {
      if (!(e instanceof JqSyntaxError)) throw e;
      diagnostics.push(e.diagnostic);
      const resume = nextTopLevelPipe(significant, Math.max(e.token, parser.position) - 1);
      if (resume === undefined || resume + 1 >= significant.length) break;
      start = resume + 1;
    }
  }
  return { text, program: none, spans: new Map(), diagnostics };
}
