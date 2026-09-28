/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The jq printer: one canonical text for every {@link JqType} program, with
 * the span of every node in it.
 *
 * @packageDocumentation
 */

import { decodeBeast2 } from "../../serialization/beast2/index.js";
import { printFor } from "../../serialization/east.js";
import { BooleanType, FloatType, IntegerType, StringType } from "../../types.js";
import { isJqKeyword } from "./lex.js";
import { childPath, type JqNode, type JqPattern, type JqRange, type JqSpans } from "./spans.js";

/** Options for {@link printJq}. */
export interface PrintJqOptions {
  /**
   * `line` (the default) prints the program on one line. `pipeline` breaks the
   * top-level pipe chain, and the bodies of the `as`, `label` and `def` that
   * lead it, one segment per line, as the query editor shows a program.
   */
  layout?: "line" | "pipeline";
}

/** A printed jq program. */
export interface PrintedJq {
  /** The canonical text. */
  text: string;
  /** Where each node of the program is in the text, by its path, as
   *  {@link parseJq} gives them for the same text. */
  spans: JqSpans;
}

// How tightly a node binds, loosest first: one level per function of the
// parser's descent (`parse.ts`).
const PIPE = 0;
const COMMA = 1;
const BINDING = 2;
const ALTERNATIVE = 3;
const UPDATE = 4;
const OR = 5;
const AND = 6;
const COMPARISON = 7;
const ADDITIVE = 8;
const MULTIPLICATIVE = 9;
const TERM = 10;
const POSTFIX = 11;

/** Each binary operator's level, and the levels its operands need. */
const BINARY: Readonly<Record<string, readonly [level: number, left: number, right: number]>> = {
  "or": [OR, OR, AND],
  "and": [AND, AND, COMPARISON],
  "==": [COMPARISON, ADDITIVE, ADDITIVE],
  "!=": [COMPARISON, ADDITIVE, ADDITIVE],
  "<": [COMPARISON, ADDITIVE, ADDITIVE],
  "<=": [COMPARISON, ADDITIVE, ADDITIVE],
  ">": [COMPARISON, ADDITIVE, ADDITIVE],
  ">=": [COMPARISON, ADDITIVE, ADDITIVE],
  "+": [ADDITIVE, ADDITIVE, MULTIPLICATIVE],
  "-": [ADDITIVE, ADDITIVE, MULTIPLICATIVE],
  "*": [MULTIPLICATIVE, MULTIPLICATIVE, TERM],
  "/": [MULTIPLICATIVE, MULTIPLICATIVE, TERM],
  "%": [MULTIPLICATIVE, MULTIPLICATIVE, TERM],
};

const UPDATE_OPS: ReadonlySet<string> = new Set(["=", "|=", "+=", "-=", "*=", "/=", "%=", "//="]);

/** A name a field or a key is written with bare: `.name`, `{name: …}`. */
const SIMPLE_NAME = /^[a-zA-Z_][a-zA-Z_0-9]*$/;
/** A function's or a variable's name, as the lexer reads one. */
const NAME = /^[a-zA-Z_][a-zA-Z_0-9]*(?:::[a-zA-Z_][a-zA-Z_0-9]*)*$/;
/** A format's name, without its `@`. */
const FORMAT_NAME = /^[a-zA-Z0-9_]+$/;

const printBoolean = printFor(BooleanType);
const printInteger = printFor(IntegerType);
const printFloat = printFor(FloatType);
const printString = printFor(StringType);

/** A literal's text and how it prints. */
interface Literal {
  /** Its East type's name. */
  type: string;
  /** Its jq text. */
  text: string;
  /** Whether the text starts with `-`, so it binds as a negation. */
  negative: boolean;
  /** Whether it is an Integer's digits, which a `.name` after them would
   *  read as a Float's point. */
  digits: boolean;
}

/**
 * The jq text of a literal.
 *
 * @param blob - the literal's self-describing beast2 blob
 * @returns its text, as East prints the value
 * @throws {Error} When its type is not one a jq literal writes.
 */
function literalOf(blob: Uint8Array): Literal {
  const { type, value } = decodeBeast2(blob);
  switch (type.type) {
    case "Null":
      return { type: "Null", text: "null", negative: false, digits: false };
    case "Boolean":
      return { type: "Boolean", text: printBoolean(value), negative: false, digits: false };
    case "Integer": {
      const text = printInteger(value);
      const negative = text.startsWith("-");
      return { type: "Integer", text, negative, digits: !negative };
    }
    case "Float": {
      // East prints an integral Float with its `.0`, so it reads back as a
      // Float; jq writes the values East prints as NaN and Infinity with its
      // builtins.
      const printed = printFloat(value);
      const text = printed === "NaN" ? "nan" : printed === "Infinity" ? "infinite" : printed === "-Infinity" ? "-infinite" : printed;
      return { type: "Float", text, negative: text.startsWith("-"), digits: false };
    }
    case "String":
      return { type: "String", text: printString(value), negative: false, digits: false };
    default:
      throw new Error(`printJq: a ${type.type} literal has no jq text`);
  }
}

/**
 * Checks a name before printing it, so a program never prints as text that
 * reads back as another program.
 *
 * @param ok - whether the name is valid where it is used
 * @param what - what the name is, for the message
 * @param name - the name
 * @throws {Error} When it is not.
 */
function checkName(ok: boolean, what: string, name: string): void {
  if (!ok) throw new Error(`printJq: ${printString(name)} is not a jq ${what}`);
}

/** Prints one program, recording each node's span as it goes. */
class Printer {
  text = "";
  readonly spans = new Map<string, JqRange>();
  private readonly literals = new Map<Uint8Array, Literal>();

  constructor(private readonly pipeline: boolean) {}

  private emit(s: string): void {
    this.text += s;
  }

  private literal(blob: Uint8Array): Literal {
    let literal = this.literals.get(blob);
    if (literal === undefined) {
      literal = literalOf(blob);
      this.literals.set(blob, literal);
    }
    return literal;
  }

  /** Whether a `try` without `catch` prints its body with a `?` after it:
   *  bodies whose last token no `?` would change the meaning of. */
  private postfixTry(body: JqNode): boolean {
    switch (body.type) {
      case "call": case "variable": case "string": case "format": case "array": case "object":
      case "reduce": case "foreach": case "if":
        return true;
      case "literal":
        return !this.literal(body.value).negative;
      default:
        return false;
    }
  }

  /** Whether a node prints as `try body` with no `catch`: it would take a
   *  `catch` that followed it. */
  private openTry(node: JqNode): boolean {
    return node.type === "try" && node.value.catch.type === "none" && !this.postfixTry(node.value.body);
  }

  private level(node: JqNode): number {
    switch (node.type) {
      case "pipe": return PIPE;
      case "comma": return COMMA;
      case "bind": case "def": case "label": return BINDING;
      case "alternative": return ALTERNATIVE;
      case "update": return UPDATE;
      case "binary": return this.binary(node.value.op)[0];
      case "negate": return TERM;
      case "try": return node.value.catch.type === "none" && this.postfixTry(node.value.body) ? POSTFIX : TERM;
      case "literal": return this.literal(node.value).negative ? TERM : POSTFIX;
      default: return POSTFIX;
    }
  }

  private binary(op: string): readonly [number, number, number] {
    const levels = BINARY[op];
    if (levels === undefined) throw new Error(`printJq: ${printString(op)} is not a jq binary operator`);
    return levels;
  }

  /** A JSON string: jq's string syntax, East's printer. */
  private string(value: string): string {
    return printString(value);
  }

  /** The whole program. */
  program(program: JqNode): void {
    if (this.pipeline) this.spine(program, "");
    else this.node(program, "", PIPE, true);
  }

  /**
   * Prints a node where the grammar needs at least `min`, in parentheses when
   * it binds more loosely.
   *
   * @param node - the node
   * @param path - its path
   * @param min - the level its place needs
   * @param open - nothing follows it before a closing bracket or the end, so
   *   an `as`, `label` or `def`, whose body runs to the end, may stand bare
   * @param beforeCatch - a `catch` follows it, which a `try` printed without
   *   one would take
   */
  private node(node: JqNode, path: string, min: number, open: boolean, beforeCatch = false): void {
    const level = this.level(node);
    if (level < min || (level === BINDING && !open) || (beforeCatch && this.openTry(node))) {
      this.emit("(");
      this.bare(node, path, true, false, false);
      this.emit(")");
    } else {
      this.bare(node, path, open, beforeCatch, false);
    }
  }

  /** A pipe chain's continuation: on the spine in the pipeline layout. */
  private chain(node: JqNode, path: string, open: boolean, spine: boolean): void {
    if (spine) this.spine(node, path);
    else this.node(node, path, PIPE, open);
  }

  /** A node on the pipeline layout's spine: the top-level chain. */
  private spine(node: JqNode, path: string): void {
    if (node.type === "pipe" || node.type === "bind" || node.type === "label" || node.type === "def") {
      this.bare(node, path, true, false, true);
    } else {
      this.node(node, path, PIPE, true);
    }
  }

  /** The target of a postfix operator, in parentheses when a postfix would
   *  not read as applying to it. */
  private target(node: JqNode, path: string, field: boolean): void {
    if (this.level(node) < POSTFIX || node.type === "descend" || (field && node.type === "literal" && this.literal(node.value).digits)) {
      this.emit("(");
      this.bare(node, path, true, false, false);
      this.emit(")");
    } else {
      this.bare(node, path, true, false, false);
    }
  }

  /** An object's value: pipes of expressions, as jq's object values are. */
  private objectValue(node: JqNode, path: string): void {
    if (node.type !== "pipe") {
      this.node(node, path, ALTERNATIVE, false);
      return;
    }
    const from = this.text.length;
    this.node(node.value.left, childPath(path, "pipe.left"), ALTERNATIVE, false);
    this.emit(" | ");
    this.objectValue(node.value.right, childPath(path, "pipe.right"));
    this.spans.set(path, { from, to: this.text.length });
  }

  /** A node's own text, without parentheses around it. */
  private bare(node: JqNode, path: string, open: boolean, beforeCatch: boolean, spine: boolean): void {
    const from = this.text.length;
    const at = (step: string): string => childPath(path, step);
    switch (node.type) {
      case "pipe":
        this.node(node.value.left, at("pipe.left"), COMMA, false);
        this.emit(spine ? "\n| " : " | ");
        this.chain(node.value.right, at("pipe.right"), open, spine);
        break;
      case "comma":
        this.node(node.value.left, at("comma.left"), COMMA, false);
        this.emit(", ");
        this.node(node.value.right, at("comma.right"), BINDING, open);
        break;
      case "bind": {
        const { body, patterns, source } = node.value;
        if (patterns.length === 0) throw new Error("printJq: an `as` with no pattern");
        this.node(source, at("bind.source"), ALTERNATIVE, false);
        this.emit(" as ");
        patterns.forEach((pattern: JqPattern, i: number) => {
          if (i > 0) this.emit(" ?// ");
          this.pattern(pattern, at(`bind.patterns[${i}]`));
        });
        this.emit(spine ? "\n| " : " | ");
        this.chain(body, at("bind.body"), open, spine);
        break;
      }
      case "label":
        checkName(NAME.test(node.value.name) && node.value.name !== "__loc__", "label", node.value.name);
        this.emit(`label $${node.value.name}`);
        this.emit(spine ? "\n| " : " | ");
        this.chain(node.value.body, at("label.body"), open, spine);
        break;
      case "def": {
        const { body, name, params, rest } = node.value;
        checkName(NAME.test(name) && !isJqKeyword(name), "function name", name);
        for (const param of params) {
          const bare = param.startsWith("$") ? param.slice(1) : param;
          checkName(NAME.test(bare) && (param.startsWith("$") ? bare !== "__loc__" : !isJqKeyword(bare)), "parameter", param);
        }
        this.emit(`def ${name}${params.length > 0 ? `(${params.join("; ")})` : ""}: `);
        this.node(body, at("def.body"), PIPE, true);
        this.emit(spine ? ";\n" : "; ");
        this.chain(rest, at("def.rest"), open, spine);
        break;
      }
      case "alternative":
        this.node(node.value.left, at("alternative.left"), UPDATE, false);
        this.emit(" // ");
        this.node(node.value.right, at("alternative.right"), ALTERNATIVE, false);
        break;
      case "update":
        if (!UPDATE_OPS.has(node.value.op)) throw new Error(`printJq: ${printString(node.value.op)} is not a jq update operator`);
        this.node(node.value.path, at("update.path"), OR, false);
        this.emit(` ${node.value.op} `);
        this.node(node.value.value, at("update.value"), OR, false);
        break;
      case "binary": {
        const [, left, right] = this.binary(node.value.op);
        this.node(node.value.left, at("binary.left"), left, false);
        this.emit(` ${node.value.op} `);
        this.node(node.value.right, at("binary.right"), right, false);
        break;
      }
      case "negate": {
        const operand = node.value;
        this.emit("-");
        // `- -1`, not `--1`: a minus the operand starts with stays apart.
        const unparenthesised = this.level(operand) >= TERM && !(beforeCatch && this.openTry(operand));
        if (unparenthesised && (operand.type === "negate" || (operand.type === "literal" && this.literal(operand.value).negative))) this.emit(" ");
        this.node(operand, at("negate"), TERM, true, beforeCatch);
        break;
      }
      case "try": {
        const { body, catch: handler } = node.value;
        if (handler.type === "some") {
          this.emit("try ");
          this.node(body, at("try.body"), TERM, true, true);
          this.emit(" catch ");
          this.node(handler.value, at("try.catch.some"), TERM, true, beforeCatch);
        } else if (this.postfixTry(body)) {
          this.node(body, at("try.body"), POSTFIX, true);
          this.emit("?");
        } else {
          this.emit("try ");
          this.node(body, at("try.body"), TERM, true);
        }
        break;
      }
      case "field": {
        const { name, optional, target } = node.value;
        if (target.type === "identity") {
          // `.name`: the target's text is the dot.
          this.spans.set(at("field.target"), { from: this.text.length, to: this.text.length + 1 });
        } else {
          this.target(target, at("field.target"), true);
        }
        this.emit(`.${SIMPLE_NAME.test(name) ? name : this.string(name)}${optional ? "?" : ""}`);
        break;
      }
      case "index":
        this.target(node.value.target, at("index.target"), false);
        this.emit("[");
        this.node(node.value.index, at("index.index"), PIPE, true);
        this.emit(node.value.optional ? "]?" : "]");
        break;
      case "iterate":
        this.target(node.value.target, at("iterate.target"), false);
        this.emit(node.value.optional ? "[]?" : "[]");
        break;
      case "slice": {
        const { from: start, optional, target, to: end } = node.value;
        this.target(target, at("slice.target"), false);
        this.emit("[");
        if (start.type === "some") this.node(start.value, at("slice.from.some"), PIPE, true);
        this.emit(":");
        if (end.type === "some") this.node(end.value, at("slice.to.some"), PIPE, true);
        this.emit(optional ? "]?" : "]");
        break;
      }
      case "call": {
        const { args, name } = node.value;
        checkName(NAME.test(name) && !isJqKeyword(name) && !(args.length === 0 && (name === "null" || name === "true" || name === "false")),
          "function name", name);
        this.emit(name);
        if (args.length > 0) {
          this.emit("(");
          args.forEach((arg: JqNode, i: number) => {
            if (i > 0) this.emit("; ");
            this.node(arg, at(`call.args[${i}]`), PIPE, true);
          });
          this.emit(")");
        }
        break;
      }
      case "literal":
        this.emit(this.literal(node.value).text);
        break;
      case "variable":
        checkName(NAME.test(node.value), "variable", node.value);
        this.emit(`$${node.value}`);
        break;
      case "break":
        checkName(NAME.test(node.value) && node.value !== "__loc__", "label", node.value);
        this.emit(`break $${node.value}`);
        break;
      case "identity":
        this.emit(".");
        break;
      case "descend":
        this.emit("..");
        break;
      case "array":
        this.emit("[");
        if (node.value.type === "some") this.node(node.value.value, at("array.some"), PIPE, true);
        this.emit("]");
        break;
      case "object":
        this.emit("{");
        node.value.forEach((entry: { key: { type: string; value: any }; value: { type: "none" | "some"; value: any } }, i: number) => {
          if (i > 0) this.emit(", ");
          const key = entry.key;
          if (key.type === "name") {
            this.emit(SIMPLE_NAME.test(key.value) ? key.value : this.string(key.value));
          } else if (key.type === "variable") {
            checkName(NAME.test(key.value) && (key.value !== "__loc__" || entry.value.type === "none"), "object key variable", key.value);
            this.emit(`$${key.value}`);
          } else {
            const computed = key.value as JqNode;
            if (computed.type === "string" || (computed.type === "format" && computed.value.string.type === "some")) {
              // A string with interpolations, or a format with its string, is
              // a key as it is: `{"a\(f)": v}`, `{@base64 "x"}`.
              this.bare(computed, at(`object[${i}].key.computed`), true, false, false);
            } else {
              if (entry.value.type === "none") throw new Error("printJq: a computed key `(k)` needs a value");
              this.emit("(");
              this.node(computed, at(`object[${i}].key.computed`), PIPE, true);
              this.emit(")");
            }
          }
          if (entry.value.type === "some") {
            this.emit(": ");
            this.objectValue(entry.value.value as JqNode, at(`object[${i}].value.some`));
          }
        });
        this.emit("}");
        break;
      case "string":
        this.emit("\"");
        node.value.forEach((part: { type: string; value: any }, i: number) => {
          if (part.type === "text") {
            this.emit(this.string(part.value as string).slice(1, -1));
          } else {
            this.emit("\\(");
            this.node(part.value as JqNode, at(`string[${i}].interpolate`), PIPE, true);
            this.emit(")");
          }
        });
        this.emit("\"");
        break;
      case "format": {
        const { name, string } = node.value;
        checkName(FORMAT_NAME.test(name), "format", name);
        this.emit(`@${name}`);
        if (string.type === "some") {
          const text = string.value;
          if (text.type !== "string" && !(text.type === "literal" && this.literal(text.value).type === "String")) {
            throw new Error(`printJq: @${name} applies to a string, not a ${text.type} node`);
          }
          this.emit(" ");
          this.bare(text, at("format.string.some"), true, false, false);
        }
        break;
      }
      case "reduce": case "foreach": {
        const { init, pattern, source, update } = node.value;
        this.emit(`${node.type} `);
        this.node(source, at(`${node.type}.source`), ALTERNATIVE, false);
        this.emit(" as ");
        this.pattern(pattern, at(`${node.type}.pattern`));
        this.emit(" (");
        this.node(init, at(`${node.type}.init`), PIPE, true);
        this.emit("; ");
        this.node(update, at(`${node.type}.update`), PIPE, true);
        if (node.type === "foreach" && node.value.extract.type === "some") {
          this.emit("; ");
          this.node(node.value.extract.value, at("foreach.extract.some"), PIPE, true);
        }
        this.emit(")");
        break;
      }
      case "if": {
        const { branches, otherwise } = node.value;
        if (branches.length === 0) throw new Error("printJq: an `if` with no branch");
        branches.forEach((branch: { condition: JqNode; then: JqNode }, i: number) => {
          this.emit(i === 0 ? "if " : " elif ");
          this.node(branch.condition, at(`if.branches[${i}].condition`), PIPE, true);
          this.emit(" then ");
          this.node(branch.then, at(`if.branches[${i}].then`), PIPE, true);
        });
        if (otherwise.type === "some") {
          this.emit(" else ");
          this.node(otherwise.value, at("if.otherwise.some"), PIPE, true);
        }
        this.emit(" end");
        break;
      }
    }
    this.spans.set(path, { from, to: this.text.length });
  }

  /** A destructuring pattern. */
  private pattern(pattern: JqPattern, path: string): void {
    const from = this.text.length;
    switch (pattern.type) {
      case "variable":
        checkName(NAME.test(pattern.value) && pattern.value !== "__loc__", "variable", pattern.value);
        this.emit(`$${pattern.value}`);
        break;
      case "array":
        if (pattern.value.length === 0) throw new Error("printJq: an array pattern with no element");
        this.emit("[");
        pattern.value.forEach((item: JqPattern, i: number) => {
          if (i > 0) this.emit(", ");
          this.pattern(item, childPath(path, `array[${i}]`));
        });
        this.emit("]");
        break;
      case "object":
        if (pattern.value.length === 0) throw new Error("printJq: an object pattern with no entry");
        this.emit("{");
        pattern.value.forEach((entry: { key: string; value: { type: "none" | "some"; value: any } }, i: number) => {
          if (i > 0) this.emit(", ");
          if (entry.value.type === "none") {
            // `$name` binds the field of its name.
            checkName(NAME.test(entry.key) && entry.key !== "__loc__", "variable", entry.key);
            this.emit(`$${entry.key}`);
          } else {
            this.emit(`${SIMPLE_NAME.test(entry.key) ? entry.key : this.string(entry.key)}: `);
            this.pattern(entry.value.value as JqPattern, childPath(path, `object[${i}].value.some`));
          }
        });
        this.emit("}");
        break;
    }
    this.spans.set(path, { from, to: this.text.length });
  }
}

/**
 * Prints a jq program as its canonical text.
 *
 * @param program - the program, as {@link parseJq} or a builder makes it
 * @param options - the layout
 * @returns the text, and the span of every node in it
 * @throws {Error} When the program holds something no jq text reads back as:
 *   a literal of a type jq has no literal for, a name the lexer would not
 *   read as one (a keyword as a function's name, `true` called with no
 *   arguments), an operator jq lacks, or an empty `if` or pattern.
 *
 * @remarks
 * Every program has one canonical text: one space around binary operators
 * and `|`, none inside brackets; `, ` and `; ` between items; a field or key
 * bare when it is an identifier and a JSON string otherwise; literals as East
 * prints them (an integral Float with its `.0`, so it reads back as a Float);
 * strings with JSON's minimal escapes; parentheses only where the grammar
 * needs them; no comments. A `try` with no `catch` prints as `f?` when its
 * body is a call, a variable, a constructor or a literal, and as `try f`
 * otherwise.
 *
 * For every program the parser accepts, `parseJq(printJq(p).text)` gives `p`
 * back, and the same spans.
 *
 * @example
 * ```ts
 * const parsed = parseJq(".customers as $c|.orders|length # count");
 * if (parsed.program.type === "some") {
 *   printJq(parsed.program.value).text;
 *   // ".customers as $c | .orders | length"
 *   printJq(parsed.program.value, { layout: "pipeline" }).text;
 *   // ".customers as $c\n| .orders\n| length"
 * }
 * ```
 */
export function printJq(program: JqNode, options: PrintJqOptions = {}): PrintedJq {
  const printer = new Printer(options.layout === "pipeline");
  printer.program(program);
  return { text: printer.text, spans: printer.spans };
}
