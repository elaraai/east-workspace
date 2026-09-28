/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The jq lexer: jq 1.8's tokens (`src/lexer.l`), with the spans the query
 * editor highlights by and the parser reads.
 *
 * @packageDocumentation
 */

import { isJqBuiltin } from "./catalog.js";

/**
 * The kind of a jq token, as the jq view highlights it.
 *
 * @remarks
 * - `ws` — spaces, tabs and line breaks.
 * - `comment` — `#` to the end of its line; a backslash before the line break
 *   continues it.
 * - `string` — a string's text, its quotes, and the `\(` and `)` around an
 *   interpolation; the interpolated query's tokens have their own kinds.
 * - `variable` — `$name`.
 * - `field` — `.name`.
 * - `format` — `@name`.
 * - `number` — a number literal.
 * - `keyword` — `as def if then elif else end reduce foreach try catch label
 *   break import include module and or not` and `$__loc__`.
 * - `builtin` — an identifier naming a builtin ({@link isJqBuiltin}).
 * - `identifier` — any other identifier: a `def`'s name, a parameter, `true`,
 *   `false`, `null`.
 * - `pipe` — `|`.
 * - `operator` — `|= //= += -= *= /= %= == != <= >= // ?// , + - * / % < > = ?`.
 * - `punctuation` — `( ) [ ] { } : ; . ..`.
 * - `other` — a character the lexer cannot read.
 */
export type JqTokenKind =
  | "ws" | "comment" | "string" | "variable" | "field" | "format" | "number"
  | "keyword" | "builtin" | "identifier" | "pipe" | "operator" | "punctuation" | "other";

/**
 * A token of jq text.
 *
 * @remarks
 * `from` and `to` are offsets in UTF-16 code units, `to` exclusive, and
 * `text` is `text.slice(from, to)` of the lexed text.
 */
export interface JqToken {
  /** What the token is, for highlighting. */
  kind: JqTokenKind;
  /** Its first offset. */
  from: number;
  /** The offset after its last. */
  to: number;
  /** Its text. */
  text: string;
}

/**
 * The role a token plays in the grammar: what the parser reads.
 *
 * @internal
 */
export type JqRole =
  | "ws" | "comment"
  | "field" | "ident" | "keyword" | "loc" | "variable" | "format" | "number" | "op" | "punct"
  | "string_start" | "string_text" | "interp_start" | "interp_end" | "string_end"
  | "unterminated" | "other";

/**
 * A token with its grammatical role and its decoded value.
 *
 * @remarks
 * `value` is the field, identifier or variable name (without `.` or `$`), the
 * format's name (without `@`), a keyword, operator or punctuation's text, a
 * number's text, or a string piece's decoded text. `error` says why a string
 * piece's escapes cannot be read.
 *
 * @internal
 */
export interface JqLexeme extends JqToken {
  /** The token's role in the grammar. */
  role: JqRole;
  /** The token's value, as the role reads it. */
  value: string;
  /** Why the token's text is not valid, when it is not. */
  error?: string;
}

/** The words jq reserves. */
const KEYWORDS: ReadonlySet<string> = new Set([
  "as", "def", "if", "then", "elif", "else", "end", "reduce", "foreach", "try", "catch",
  "label", "break", "import", "include", "module", "and", "or",
]);

/**
 * Whether a word is one jq reserves, so no function or parameter can take it
 * as a name.
 *
 * @param word - the word
 * @returns `true` for a keyword; `not` is a builtin, so `false` for it
 *
 * @internal
 */
export function isJqKeyword(word: string): boolean {
  return KEYWORDS.has(word);
}

/** A surrogate without its other half. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Replaces each lone surrogate with U+FFFD, so a string's value is
 * well-formed UTF-16 whether its text wrote the surrogate raw or escaped.
 *
 * @param text - decoded string text
 * @returns the text, well-formed
 */
function wellFormed(text: string): string {
  return text.replace(LONE_SURROGATE, "�");
}

/** Operators, longest first so a scan takes the longest match. */
const OPERATORS: readonly string[] = [
  "?//", "//=", "|=", "+=", "-=", "*=", "/=", "%=", "==", "!=", "<=", ">=", "//",
  "|", ",", "+", "-", "*", "/", "%", "<", ">", "=", "?",
];

const IDENT = /[a-zA-Z_][a-zA-Z_0-9]*(?:::[a-zA-Z_][a-zA-Z_0-9]*)*/y;
const FIELD = /\.[a-zA-Z_][a-zA-Z_0-9]*/y;
const VARIABLE = /\$[a-zA-Z_][a-zA-Z_0-9]*(?:::[a-zA-Z_][a-zA-Z_0-9]*)*/y;
const FORMAT = /@[a-zA-Z0-9_]+/y;
const NUMBER = /(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/y;
const WHITESPACE = /[ \t\r\n]+/y;
const STRING_RUN = /[^\\"]+/y;

/**
 * Matches a sticky pattern at an offset.
 *
 * @param pattern - a sticky (`y`) pattern
 * @param text - the text
 * @param at - the offset
 * @returns the matched text, or `undefined`
 */
function matchAt(pattern: RegExp, text: string, at: number): string | undefined {
  pattern.lastIndex = at;
  return pattern.exec(text)?.[0];
}

/**
 * The offset of the end of the line holding an offset: its line break, or the
 * end of the text.
 *
 * @param text - the text
 * @param at - an offset on the line
 * @returns the offset of the line's `\r` or `\n`, or the text's length
 */
function endOfLine(text: string, at: number): number {
  for (let i = at; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || c === 13) return i;
  }
  return text.length;
}

/**
 * Decodes the escapes of a jq string, as JSON reads them.
 *
 * @param escapes - one or more escapes: `\"`, `\\`, `\/`, `\b`, `\f`, `\n`,
 *   `\r`, `\t` or `\u` and four hex digits
 * @returns the decoded text, or the first escape that cannot be read
 */
function decodeEscapes(escapes: string): { text: string } | { invalid: string } {
  let text = "";
  let i = 0;
  while (i < escapes.length) {
    const c = escapes[i + 1];
    switch (c) {
      case "\"": text += "\""; i += 2; continue;
      case "\\": text += "\\"; i += 2; continue;
      case "/": text += "/"; i += 2; continue;
      case "b": text += "\b"; i += 2; continue;
      case "f": text += "\f"; i += 2; continue;
      case "n": text += "\n"; i += 2; continue;
      case "r": text += "\r"; i += 2; continue;
      case "t": text += "\t"; i += 2; continue;
      case "u": {
        const hex = escapes.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          const bad = /^\\u[a-zA-Z0-9]{0,4}/.exec(escapes.slice(i))![0];
          return { invalid: bad };
        }
        text += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      default:
        return { invalid: escapes.slice(i, i + 2) };
    }
  }
  return { text: wellFormed(text) };
}

/**
 * Scans jq text into lexemes: every character of the text in exactly one, in
 * order.
 *
 * @param text - the text
 * @returns its lexemes
 *
 * @remarks
 * Strings keep jq's lexer states: a `\(` opens an interpolation that the
 * matching `)` closes, with the brackets opened inside it balanced first. A
 * string still open at the end of the text becomes one `unterminated` lexeme
 * running to the end of its first line, and scanning resumes after it as if
 * the string had not begun, so the rest of the text still reads as code.
 *
 * @internal
 */
export function scanJq(text: string): JqLexeme[] {
  const out: JqLexeme[] = [];
  /** Open brackets, interpolations and strings, innermost last. */
  const stack: { kind: "(" | "[" | "{" | "interp" | "string"; token: number; at: number }[] = [];
  const push = (role: JqRole, kind: JqTokenKind, from: number, to: number, value: string, error?: string): void => {
    const lexeme: JqLexeme = { kind, from, to, text: text.slice(from, to), role, value };
    if (error !== undefined) lexeme.error = error;
    out.push(lexeme);
  };
  let at = 0;
  for (;;) {
    if (at >= text.length) {
      const open = stack.findIndex(s => s.kind === "string");
      if (open === -1) break;
      // A string never closed: its first line is one lexeme, and what follows
      // reads as it would have without the string.
      const { token, at: start } = stack[open]!;
      out.length = token;
      stack.length = open;
      const end = endOfLine(text, start);
      push("unterminated", "string", start, end, text.slice(start + 1, end));
      at = end;
      continue;
    }
    const top = stack[stack.length - 1];
    if (top?.kind === "string") {
      const c = text[at]!;
      if (c === "\"") {
        stack.pop();
        push("string_end", "string", at, at + 1, "\"");
        at += 1;
      } else if (c === "\\" && text[at + 1] === "(") {
        stack.push({ kind: "interp", token: out.length, at });
        push("interp_start", "string", at, at + 2, "\\(");
        at += 2;
      } else if (c === "\\") {
        let end = at;
        while (text[end] === "\\" && text[end + 1] !== "(" && end + 1 < text.length) {
          end += text[end + 1] === "u" ? 2 + (/^[a-zA-Z0-9]{0,4}/.exec(text.slice(end + 2, end + 6))![0].length) : 2;
        }
        if (end === at) end = at + 1;   // a backslash at the very end of the text
        const decoded = decodeEscapes(text.slice(at, end));
        if ("invalid" in decoded) push("string_text", "string", at, end, "", `invalid escape "${decoded.invalid}" in a string`);
        else push("string_text", "string", at, end, decoded.text);
        at = end;
      } else {
        const run = matchAt(STRING_RUN, text, at)!;
        push("string_text", "string", at, at + run.length, wellFormed(run));
        at += run.length;
      }
      continue;
    }

    const c = text[at]!;
    const ws = matchAt(WHITESPACE, text, at);
    if (ws !== undefined) {
      push("ws", "ws", at, at + ws.length, ws);
      at += ws.length;
      continue;
    }
    if (c === "#") {
      let end = at + 1;
      while (end < text.length) {
        const d = text[end]!;
        if (d === "\\" && (text[end + 1] === "\\" || text[end + 1] === "\n")) { end += 2; continue; }
        if (d === "\\" && text[end + 1] === "\r" && text[end + 2] === "\n") { end += 3; continue; }
        if (d === "\n" || (d === "\r" && text[end + 1] === "\n")) break;
        end += 1;
      }
      push("comment", "comment", at, end, text.slice(at, end));
      at = end;
      continue;
    }
    if (c === "\"") {
      stack.push({ kind: "string", token: out.length, at });
      push("string_start", "string", at, at + 1, "\"");
      at += 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      stack.push({ kind: c, token: out.length, at });
      push("punct", "punctuation", at, at + 1, c);
      at += 1;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      const opener = c === ")" ? "(" : c === "]" ? "[" : "{";
      if (top?.kind === opener) {
        stack.pop();
        push("punct", "punctuation", at, at + 1, c);
      } else if (top?.kind === "interp" && c === ")") {
        stack.pop();
        push("interp_end", "string", at, at + 1, ")");
      } else {
        push("punct", "punctuation", at, at + 1, c);
      }
      at += 1;
      continue;
    }
    if (c === "$" && text.startsWith("$__loc__", at) && matchAt(VARIABLE, text, at)!.length === 8) {
      push("loc", "keyword", at, at + 8, "$__loc__");
      at += 8;
      continue;
    }
    const variable = matchAt(VARIABLE, text, at);
    if (variable !== undefined) {
      push("variable", "variable", at, at + variable.length, variable.slice(1));
      at += variable.length;
      continue;
    }
    const number = matchAt(NUMBER, text, at);
    if (number !== undefined) {
      push("number", "number", at, at + number.length, number);
      at += number.length;
      continue;
    }
    const field = matchAt(FIELD, text, at);
    if (field !== undefined) {
      push("field", "field", at, at + field.length, field.slice(1));
      at += field.length;
      continue;
    }
    if (text.startsWith("..", at)) {
      push("punct", "punctuation", at, at + 2, "..");
      at += 2;
      continue;
    }
    if (c === "." || c === ":" || c === ";") {
      push("punct", "punctuation", at, at + 1, c);
      at += 1;
      continue;
    }
    const format = matchAt(FORMAT, text, at);
    if (format !== undefined) {
      push("format", "format", at, at + format.length, format.slice(1));
      at += format.length;
      continue;
    }
    const ident = matchAt(IDENT, text, at);
    if (ident !== undefined) {
      if (KEYWORDS.has(ident)) push("keyword", "keyword", at, at + ident.length, ident);
      else if (ident === "not") push("ident", "keyword", at, at + ident.length, ident);
      else push("ident", isJqBuiltin(ident) ? "builtin" : "identifier", at, at + ident.length, ident);
      at += ident.length;
      continue;
    }
    const op = OPERATORS.find(o => text.startsWith(o, at));
    if (op !== undefined) {
      push("op", op === "|" ? "pipe" : "operator", at, at + op.length, op);
      at += op.length;
      continue;
    }
    // One UTF-16 code unit at a time, except a surrogate pair, which is one
    // character.
    const next = text[at + 1];
    const width = c >= "\uD800" && c <= "\uDBFF" && next !== undefined && next >= "\uDC00" && next <= "\uDFFF" ? 2 : 1;
    push("other", "other", at, at + width, text.slice(at, at + width));
    at += width;
  }
  return out;
}

/**
 * Splits jq text into tokens for highlighting.
 *
 * @param text - the text
 * @returns its tokens: every character of the text in exactly one, in order
 *
 * @remarks
 * A string's text, its quotes and the `\(` / `)` of its interpolations are
 * `string` tokens, merged where they touch; the tokens of an interpolated
 * query keep their own kinds. A string that is never closed runs to the end of
 * its first line, and the rest of the text lexes as code, so highlighting
 * keeps going.
 *
 * @example
 * ```ts
 * lexJq(".orders | length").map(t => t.kind);
 * // ["field", "ws", "pipe", "ws", "builtin"]
 * ```
 */
export function lexJq(text: string): JqToken[] {
  const tokens: JqToken[] = [];
  for (const { kind, from, to } of scanJq(text)) {
    const last = tokens[tokens.length - 1];
    if (kind === "string" && last?.kind === "string" && last.to === from) {
      last.to = to;
      last.text = text.slice(last.from, to);
    } else {
      tokens.push({ kind, from, to, text: text.slice(from, to) });
    }
  }
  return tokens;
}
