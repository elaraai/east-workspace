/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import {
    compareFor,
    EAST_JSON_PATTERNS,
    SortedMap,
    SortedSet,
    matrix,
    ref,
    variant,
    type EastTypeValue,
} from "@elaraai/east";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** How many bytes each refill pulls from the source. */
const CHUNK_BYTES = 64 * 1024;

/**
 * How deeply a document may nest before it is refused.
 *
 * @remarks
 * JSON is an untrusted-input boundary, and skipping past a value recurses per
 * level, so a document of nothing but brackets would otherwise exhaust the
 * stack. The same limit east-c's reader applies (`JSON_MAX_DEPTH`), counted
 * the same way — every value, a scalar included, is one level — so every
 * runtime refuses the same documents.
 */
const MAX_DEPTH = 2048;

/**
 * How many code points of an offending value a message quotes before an
 * ellipsis.
 *
 * @remarks
 * The value under the cursor can be arbitrarily long; the message is for a
 * person. The same bound, counted in code points, applies on east-c, which is
 * what keeps the text identical across runtimes.
 */
const QUOTE_MAX = 200;

const INTEGER_RE = new RegExp(EAST_JSON_PATTERNS.integer);
const DATETIME_RE = new RegExp(EAST_JSON_PATTERNS.datetime);
const BLOB_RE = new RegExp(EAST_JSON_PATTERNS.blob);

const TAB = 0x09, LF = 0x0a, CR = 0x0d, SPACE = 0x20;
const QUOTE = 0x22, COMMA = 0x2c, MINUS = 0x2d, DOT = 0x2e, COLON = 0x3a;
const LBRACKET = 0x5b, BACKSLASH = 0x5c, RBRACKET = 0x5d, LBRACE = 0x7b, RBRACE = 0x7d;
const ZERO = 0x30, NINE = 0x39, PLUS = 0x2b;
const LOWER_E = 0x65, UPPER_E = 0x45;

/** End of input, where a byte would be. */
const EOF = -1;

/** A JSON document that does not satisfy the contract, located by pointer. */
export class JsonReadError extends Error {
    /** RFC 6901 pointer to the offending node. */
    readonly pointer: string;

    constructor(message: string, pointer: string) {
        super(pointer === "" ? message : `${pointer}: ${message}`);
        this.name = "JsonReadError";
        this.pointer = pointer;
    }
}

/** A source of document bytes, pulled a chunk at a time. */
interface Chunks {
    /** The next chunk, or null once the source is exhausted. */
    next(): Uint8Array | null;
    close(): void;
}

function stringChunks(text: string): Chunks {
    // A payload already in hand is encoded once, so the reader sees the bytes
    // a file would hold. A lone surrogate has no UTF-8 form and encodes as
    // U+FFFD, as it would on any write.
    let bytes: Uint8Array | null = new TextEncoder().encode(text);
    return {
        next: () => { const chunk = bytes; bytes = null; return chunk; },
        close: () => { /* nothing held */ },
    };
}

function fileChunks(path: string): Chunks {
    const fd = openSync(path, "r");
    let size: number;
    try {
        size = fstatSync(fd).size;
    } catch (err) {
        closeSync(fd);
        throw err;
    }
    if (size === 0) {
        closeSync(fd);
        throw new JsonReadError("the document is empty", "");
    }
    let done = false;
    return {
        next: () => {
            if (done) return null;
            // A fresh buffer per chunk: the reader keeps a reference to the
            // unconsumed tail, so a reused one would be overwritten under it.
            const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
            const read = readSync(fd, buffer, 0, CHUNK_BYTES, null);
            if (read === 0) { done = true; return null; }
            return buffer.subarray(0, read);
        },
        close: () => closeSync(fd),
    };
}

/**
 * Streaming UTF-8 validity, per RFC 3629.
 *
 * @remarks
 * Overlong forms, encoded surrogates and code points past U+10FFFF are
 * refused, byte by byte, so a document can be checked without being decoded —
 * which is what the skip path needs — and east-c runs the identical table.
 */
class Utf8 {
    private need = 0;
    private lo = 0x80;
    private hi = 0xbf;

    /** Feeds one byte; false when it cannot belong to well-formed UTF-8. */
    feed(b: number): boolean {
        if (this.need === 0) {
            if (b < 0x80) return true;
            if (b >= 0xc2 && b <= 0xdf) { this.need = 1; this.lo = 0x80; this.hi = 0xbf; return true; }
            if (b === 0xe0) { this.need = 2; this.lo = 0xa0; this.hi = 0xbf; return true; }
            if ((b >= 0xe1 && b <= 0xec) || b === 0xee || b === 0xef) { this.need = 2; this.lo = 0x80; this.hi = 0xbf; return true; }
            if (b === 0xed) { this.need = 2; this.lo = 0x80; this.hi = 0x9f; return true; }
            if (b === 0xf0) { this.need = 3; this.lo = 0x90; this.hi = 0xbf; return true; }
            if (b >= 0xf1 && b <= 0xf3) { this.need = 3; this.lo = 0x80; this.hi = 0xbf; return true; }
            if (b === 0xf4) { this.need = 3; this.lo = 0x80; this.hi = 0x8f; return true; }
            return false;
        }
        if (b < this.lo || b > this.hi) return false;
        this.need--;
        this.lo = 0x80;
        this.hi = 0xbf;
        return true;
    }

    /** Whether a multi-byte sequence is still open — true when the input ended mid-character. */
    get open(): boolean {
        return this.need > 0;
    }
}

/** The byte length a UTF-8 lead byte announces, or 1 when it announces nothing valid. */
function sequenceLength(lead: number): number {
    if (lead >= 0xc2 && lead <= 0xdf) return 2;
    if (lead >= 0xe0 && lead <= 0xef) return 3;
    if (lead >= 0xf0 && lead <= 0xf4) return 4;
    return 1;
}

/**
 * A value quoted for a message, as `JSON.stringify` would, clipped to
 * {@link QUOTE_MAX} code points with an ellipsis.
 */
function quote(text: string): string {
    let count = 0;
    let end = text.length;
    for (let i = 0; i < text.length; i++) {
        if (++count > QUOTE_MAX) { end = i; break; }
        const c = text.charCodeAt(i);
        // A surrogate pair is one code point.
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
            const d = text.charCodeAt(i + 1);
            if (d >= 0xdc00 && d <= 0xdfff) i++;
        }
    }
    return JSON.stringify(end === text.length ? text : text.slice(0, end) + "…");
}

/**
 * A pull reader over a JSON document.
 *
 * @remarks
 * Holds one chunk of bytes and the path it has descended, never the document
 * and never a batch. Values are constructed one at a time, directly against
 * the East type, so nothing intermediate is materialised either — a string is
 * decoded from its bytes in runs, never grown a character at a time, and a
 * skipped value is validated without being built at all.
 */
export class JsonReader {
    private chunks: Chunks;
    private buf: Uint8Array = new Uint8Array(0);
    private pos = 0;
    private eof = false;
    /** The path descended so far, for error pointers. */
    private path: string[] = [];
    /** Index within the array currently being iterated. */
    private index = 0;
    /** Whether iteration has begun, so a separator is expected next. */
    private started = false;
    /** The container kind at the cursor: `[` for an array, `{` for an object. */
    private container: "[" | "{" | null = null;
    /** Nesting depth of the value currently being read or skipped. */
    private depth = 0;
    private closed = false;
    private decoder = new TextDecoder("utf-8");

    private constructor(chunks: Chunks) {
        this.chunks = chunks;
    }

    /** Opens a document and descends to the container the pointer names. */
    static open(chunks: Chunks, pointer: string): JsonReader {
        const reader = new JsonReader(chunks);
        try {
            reader.descend(pointer, true);
            return reader;
        } catch (err) {
            reader.close();
            throw err;
        }
    }

    /**
     * Opens a document and positions on the value the pointer names, without
     * entering it — for reading one whole value rather than iterating.
     */
    static openValue(chunks: Chunks, pointer: string): JsonReader {
        const reader = new JsonReader(chunks);
        try {
            reader.descend(pointer, false);
            return reader;
        } catch (err) {
            reader.close();
            throw err;
        }
    }

    static openFile(path: string, pointer: string): JsonReader {
        return JsonReader.open(fileChunks(path), pointer);
    }

    static openText(text: string, pointer: string): JsonReader {
        return JsonReader.open(stringChunks(text), pointer);
    }

    static openValueFile(path: string, pointer: string): JsonReader {
        return JsonReader.openValue(fileChunks(path), pointer);
    }

    static openValueText(text: string, pointer: string): JsonReader {
        return JsonReader.openValue(stringChunks(text), pointer);
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.chunks.close();
    }

    // ── byte access ─────────────────────────────────────────────────────

    /** Ensures at least `n` bytes are buffered; false once the input cannot supply them. */
    private ensure(n: number): boolean {
        while (this.buf.length - this.pos < n) {
            if (this.eof) return false;
            const chunk = this.chunks.next();
            if (chunk === null) { this.eof = true; return false; }
            // Keep only the unconsumed tail, so the buffer stays bounded.
            const rest = this.buf.subarray(this.pos);
            const next = new Uint8Array(rest.length + chunk.length);
            next.set(rest);
            next.set(chunk, rest.length);
            this.buf = next;
            this.pos = 0;
        }
        return true;
    }

    /** The byte at the cursor, or {@link EOF}. */
    private peek(): number {
        return this.ensure(1) ? this.buf[this.pos]! : EOF;
    }

    private take(): number {
        if (!this.ensure(1)) this.fail("unexpected end of document");
        return this.buf[this.pos++]!;
    }

    private skipSpace(): void {
        for (;;) {
            const b = this.peek();
            if (b === SPACE || b === TAB || b === LF || b === CR) { this.pos++; continue; }
            return;
        }
    }

    /** Whether the bytes at the cursor spell `word`, without consuming them. */
    private startsWith(word: string): boolean {
        if (!this.ensure(word.length)) return false;
        for (let i = 0; i < word.length; i++) {
            if (this.buf[this.pos + i] !== word.charCodeAt(i)) return false;
        }
        return true;
    }

    /**
     * The code point at the cursor, for a message — U+FFFD when the bytes
     * there are not a well-formed sequence.
     */
    private charAtCursor(): string {
        const lead = this.peek();
        if (lead === EOF) return "";
        const length = sequenceLength(lead);
        this.ensure(length);
        const available = Math.min(length, this.buf.length - this.pos);
        const check = new Utf8();
        for (let i = 0; i < available; i++) {
            if (!check.feed(this.buf[this.pos + i]!)) return "�";
        }
        if (check.open) return "�";
        return this.decoder.decode(this.buf.subarray(this.pos, this.pos + available));
    }

    /**
     * What sits at the cursor, for a message: `a string`, `a number`, `an
     * array`, `an object`, `a boolean`, `null`, `end of document`, or the
     * quoted character when it starts no JSON value.
     */
    private describe(): string {
        this.skipSpace();
        const b = this.peek();
        if (b === EOF) return "end of document";
        if (b === QUOTE) return "a string";
        if (b === LBRACKET) return "an array";
        if (b === LBRACE) return "an object";
        if (b === MINUS || isDigit(b)) return "a number";
        if (this.startsWith("true") || this.startsWith("false")) return "a boolean";
        if (this.startsWith("null")) return "null";
        return JSON.stringify(this.charAtCursor());
    }

    private fail(message: string): never {
        throw new JsonReadError(message, pointerOf(this.path));
    }

    // ── tokens ──────────────────────────────────────────────────────────

    /**
     * Reads the string whose opening quote is at the cursor.
     *
     * @remarks
     * The bytes between escapes are validated as UTF-8 and decoded in runs,
     * one chunk at a time, so a long string costs its own size and no more —
     * appending a character at a time would build a rope of thirty-odd bytes
     * per character.
     */
    private readString(): string {
        this.pos++; // the opening quote, checked by the caller
        const parts: string[] = [];
        const check = new Utf8();
        let pendingRun = false;
        for (;;) {
            if (!this.ensure(1)) this.fail("unexpected end of document");
            const buf = this.buf;
            const n = buf.length;
            let i = this.pos;
            while (i < n) {
                const b = buf[i]!;
                if (b === QUOTE || b === BACKSLASH || b < 0x20) break;
                if (b >= 0x80 && !check.feed(b)) this.fail("invalid UTF-8 in string");
                i++;
            }
            if (i > this.pos) {
                parts.push(this.decoder.decode(buf.subarray(this.pos, i), { stream: true }));
                pendingRun = true;
                this.pos = i;
            }
            if (i === n) continue; // the run continues in the next chunk
            const b = buf[i]!;
            if (b < 0x20) this.fail(`unescaped control character U+${b.toString(16).padStart(4, "0")} in string`);
            // A quote or an escape ends the run; a character cannot straddle it.
            if (check.open) this.fail("invalid UTF-8 in string");
            if (pendingRun) { parts.push(this.decoder.decode()); pendingRun = false; }
            if (b === QUOTE) {
                this.pos = i + 1;
                return parts.length === 1 ? parts[0]! : parts.join("");
            }
            this.pos = i + 1;
            parts.push(this.readEscape());
        }
    }

    /** One escape, the backslash already consumed. */
    private readEscape(): string {
        const esc = this.take();
        switch (esc) {
            case QUOTE: return "\"";
            case BACKSLASH: return "\\";
            case 0x2f: return "/";
            case 0x62: return "\b";
            case 0x66: return "\f";
            case 0x6e: return "\n";
            case 0x72: return "\r";
            case 0x74: return "\t";
            case 0x75: {
                let hex = "";
                for (let i = 0; i < 4; i++) hex += String.fromCharCode(this.take());
                if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail(`invalid \\u escape "\\u${hex}"`);
                // A surrogate pair written as two escapes joins into one code
                // point by concatenation; a lone surrogate stays one code unit,
                // as JSON.parse leaves it.
                return String.fromCharCode(parseInt(hex, 16));
            }
            default:
                this.fail(`invalid escape "\\${String.fromCharCode(esc)}"`);
        }
    }

    /** Validates the string at the cursor without building it. */
    private skipString(): void {
        this.pos++;
        const check = new Utf8();
        for (;;) {
            if (!this.ensure(1)) this.fail("unexpected end of document");
            const buf = this.buf;
            const n = buf.length;
            let i = this.pos;
            while (i < n) {
                const b = buf[i]!;
                if (b === QUOTE || b === BACKSLASH || b < 0x20) break;
                if (b >= 0x80 && !check.feed(b)) this.fail("invalid UTF-8 in string");
                i++;
            }
            this.pos = i;
            if (i === n) continue;
            const b = buf[i]!;
            if (b < 0x20) this.fail(`unescaped control character U+${b.toString(16).padStart(4, "0")} in string`);
            if (check.open) this.fail("invalid UTF-8 in string");
            this.pos = i + 1;
            if (b === QUOTE) return;
            this.readEscape();
        }
    }

    /** The JSON number at the cursor, exactly as written, checked against the grammar. */
    private readNumber(): string {
        let out = "";
        if (this.peek() === MINUS) {
            this.pos++;
            out += "-";
            if (!isDigit(this.peek())) this.fail("expected a digit after \"-\"");
        }
        if (this.peek() === ZERO) {
            this.pos++;
            out += "0"; // a leading zero stands alone
        } else if (isDigit(this.peek())) {
            while (isDigit(this.peek())) out += String.fromCharCode(this.take());
        } else {
            this.fail(`expected a number, got ${this.describe()}`);
        }
        if (this.peek() === DOT) {
            this.pos++;
            out += ".";
            if (!isDigit(this.peek())) this.fail("expected a digit after the decimal point");
            while (isDigit(this.peek())) out += String.fromCharCode(this.take());
        }
        const e = this.peek();
        if (e === LOWER_E || e === UPPER_E) {
            this.pos++;
            out += "e";
            const sign = this.peek();
            if (sign === PLUS || sign === MINUS) out += String.fromCharCode(this.take());
            if (!isDigit(this.peek())) this.fail("expected a digit in the exponent");
            while (isDigit(this.peek())) out += String.fromCharCode(this.take());
        }
        return out;
    }

    private readLiteral(word: string): void {
        for (let i = 0; i < word.length; i++) {
            if (this.take() !== word.charCodeAt(i)) this.fail(`expected ${word}`);
        }
    }

    /** Consumes one value without constructing anything, checking it against the grammar. */
    private skipValue(): void {
        if (++this.depth > MAX_DEPTH) {
            this.depth--;
            this.fail(`document nests deeper than ${MAX_DEPTH}`);
        }
        try {
            this.skipValueInner();
        } finally {
            this.depth--;
        }
    }

    private skipValueInner(): void {
        this.skipSpace();
        const b = this.peek();
        if (b === EOF) this.fail("unexpected end of document");
        if (b === QUOTE) { this.skipString(); return; }
        if (b === MINUS || isDigit(b)) { this.readNumber(); return; }
        if (b === 0x74) { this.readLiteral("true"); return; }
        if (b === 0x66) { this.readLiteral("false"); return; }
        if (b === 0x6e) { this.readLiteral("null"); return; }
        if (b === LBRACKET) {
            this.pos++;
            this.skipSpace();
            if (this.peek() === RBRACKET) { this.pos++; return; }
            for (;;) {
                this.skipValue();
                this.skipSpace();
                const sep = this.take();
                if (sep === RBRACKET) return;
                if (sep !== COMMA) this.fail("expected \",\" or \"]\" in array");
            }
        }
        if (b === LBRACE) {
            this.pos++;
            this.skipSpace();
            if (this.peek() === RBRACE) { this.pos++; return; }
            for (;;) {
                this.readName("field");
                this.skipSpace();
                if (this.peek() !== COLON) this.fail(`expected ":" after a field name, got ${this.describe()}`);
                this.pos++;
                this.skipValue();
                this.skipSpace();
                const sep = this.take();
                if (sep === RBRACE) return;
                if (sep !== COMMA) this.fail("expected \",\" or \"}\" in object");
            }
        }
        this.fail(`unexpected character ${JSON.stringify(this.charAtCursor())}`);
    }

    /** A quoted name — a struct field, an object member, a variant case — at the cursor. */
    private readName(what: "field" | "member"): string {
        this.skipSpace();
        if (this.peek() !== QUOTE) this.fail(`expected a ${what} name, got ${this.describe()}`);
        return this.readString();
    }

    /** The `:` after a name. */
    private expectColon(what: "field" | "member"): void {
        this.skipSpace();
        if (this.peek() !== COLON) this.fail(`expected ":" after a ${what} name, got ${this.describe()}`);
        this.pos++;
    }

    // ── navigation ──────────────────────────────────────────────────────

    /**
     * Descends to the node the RFC 6901 pointer names.
     *
     * @param pointer - The pointer to follow
     * @param enter - Whether to step inside the node and iterate it, rather
     * than stop in front of it to read it whole
     */
    private descend(pointer: string, enter: boolean): void {
        for (const segment of parsePointer(pointer)) {
            this.skipSpace();
            const b = this.peek();
            if (b === LBRACE) {
                this.pos++;
                this.enterObjectMember(segment);
            } else if (b === LBRACKET) {
                this.pos++;
                this.enterArrayIndex(segment);
            } else {
                this.fail(`cannot descend into ${this.describe()} looking for ${JSON.stringify(segment)}`);
            }
            this.path.push(segment);
        }
        if (!enter) return;
        this.skipSpace();
        const b = this.peek();
        if (b !== LBRACKET && b !== LBRACE) {
            this.fail(`expected an array or object to iterate, got ${this.describe()}`);
        }
        this.pos++;
        this.container = b === LBRACKET ? "[" : "{";
    }

    /** Positions the cursor on the value of `key`, skipping the members before it. */
    private enterObjectMember(key: string): void {
        this.skipSpace();
        if (this.peek() === RBRACE) this.fail(`no member ${JSON.stringify(key)}`);
        for (;;) {
            const name = this.readName("field");
            this.expectColon("field");
            if (name === key) return;
            this.skipValue();
            this.skipSpace();
            const sep = this.take();
            if (sep === RBRACE) this.fail(`no member ${JSON.stringify(key)}`);
            if (sep !== COMMA) this.fail("expected \",\" or \"}\" in object");
        }
    }

    /** Positions the cursor on element `index`, skipping the elements before it. */
    private enterArrayIndex(segment: string): void {
        if (!/^(?:0|[1-9][0-9]*)$/.test(segment)) {
            this.fail(`expected an array index, got ${JSON.stringify(segment)}`);
        }
        const target = Number(segment);
        this.skipSpace();
        if (this.peek() === RBRACKET) this.fail(`no element ${segment}`);
        for (let i = 0; ; i++) {
            if (i === target) return;
            this.skipValue();
            this.skipSpace();
            const sep = this.take();
            if (sep === RBRACKET) this.fail(`no element ${segment}`);
            if (sep !== COMMA) this.fail("expected \",\" or \"]\" in array");
        }
    }

    // ── iteration ───────────────────────────────────────────────────────

    /**
     * Whether another element remains in the container being iterated.
     *
     * @remarks
     * A predicate: it consumes the container's closing bracket once there is
     * nothing left, and otherwise leaves the cursor where it was. Advancing is
     * {@link next}'s job, so the two do not have to alternate.
     */
    more(): boolean {
        if (this.container === null) return false;
        const close = this.container === "[" ? RBRACKET : RBRACE;
        this.skipSpace();
        if (this.peek() === close) { this.pos++; this.container = null; return false; }
        return true;
    }

    /**
     * Reads the next element as `type`.
     *
     * @remarks
     * For an object container, `type` must be a two-field struct named `key`
     * and `value`, in either order, and each member arrives as one of those.
     * An error inside an element is located by its index in an array and by
     * its member name in an object, as RFC 6901 addresses them.
     */
    next(type: EastTypeValue): unknown {
        if (this.container === null) this.fail("the reader is exhausted");
        // An object's entry type is checked before anything is consumed, the
        // separator included, at the container's own pointer: no member has
        // been named yet, and a refused call leaves the reader where it was.
        const valueType = this.container === "{" ? this.entryValueType(type) : type;
        // The separator belongs to the advance, not to the predicate, so
        // reading two elements in a row does not need a `more` between them.
        if (this.started) {
            this.skipSpace();
            const b = this.peek();
            const close = this.container === "[" ? RBRACKET : RBRACE;
            if (b === close) { this.pos++; this.container = null; this.fail("the reader is exhausted"); }
            if (b !== COMMA) this.fail(`expected "," or ${JSON.stringify(String.fromCharCode(close))}`);
            this.pos++;
        }
        this.started = true;
        if (this.container === "{") return this.readMember(valueType);
        this.path.push(String(this.index));
        this.index++;
        try {
            return this.readValue(type);
        } finally {
            this.path.pop();
        }
    }

    /**
     * The value type of an object entry: `type` must be a struct of exactly
     * the fields `key` and `value`, in either order, with a String key.
     */
    private entryValueType(type: EastTypeValue): EastTypeValue {
        if (type.type !== "Struct") {
            this.fail("iterating an object needs a Struct with exactly the fields key and value");
        }
        const fields = type.value as { name: string; type: EastTypeValue }[];
        const keyField = fields.find(f => f.name === "key");
        const valueField = fields.find(f => f.name === "value");
        if (fields.length !== 2 || keyField === undefined || valueField === undefined) {
            this.fail("iterating an object needs a Struct with exactly the fields key and value");
        }
        if (keyField.type.type !== "String") {
            this.fail("iterating an object needs a String key");
        }
        return valueField.type;
    }

    /** One object member, as a `{ key, value }` struct. */
    private readMember(valueType: EastTypeValue): unknown {
        const name = this.readName("member");
        this.expectColon("member");
        this.index++;
        this.path.push(name);
        try {
            const value = this.readValue(valueType);
            return { key: name, value };
        } finally {
            this.path.pop();
        }
    }

    /** Reads one whole value, strictly, as `type`. */
    readValue(type: EastTypeValue): unknown {
        if (++this.depth > MAX_DEPTH) {
            this.depth--;
            this.fail(`document nests deeper than ${MAX_DEPTH}`);
        }
        try {
            return this.readValueInner(type);
        } catch (e) {
            // V8's stack can give out before MAX_DEPTH on the typed read, so
            // the depth guard above never fires there. The document is still
            // refused for nesting, with the contract's error rather than a bare
            // RangeError escaping json_next.
            if (e instanceof RangeError) this.fail("document nests deeper than this runtime can read");
            throw e;
        } finally {
            this.depth--;
        }
    }

    private readValueInner(type: EastTypeValue): unknown {
        switch (type.type) {
            case "Null": {
                this.skipSpace();
                if (this.startsWith("null")) { this.pos += 4; return null; }
                this.fail(`expected null, got ${this.describe()}`);
                break;
            }

            case "Boolean": {
                this.skipSpace();
                if (this.startsWith("true")) { this.pos += 4; return true; }
                if (this.startsWith("false")) { this.pos += 5; return false; }
                this.fail(`expected a boolean, got ${this.describe()}`);
                break;
            }

            case "String": {
                this.skipSpace();
                if (this.peek() !== QUOTE) this.fail(`expected a String, got ${this.describe()}`);
                return this.readString();
            }

            case "Integer": {
                // East JSON writes Integer as a decimal string, so no value
                // ever passes through a double.
                this.skipSpace();
                if (this.peek() !== QUOTE) this.fail(`expected Integer as a quoted decimal string, got ${this.describe()}`);
                const text = this.readString();
                if (!INTEGER_RE.test(text)) {
                    this.fail(`${quote(text)} is not a 64-bit integer in East JSON's form`);
                }
                return BigInt(text);
            }

            case "Float": {
                this.skipSpace();
                const b = this.peek();
                if (b === QUOTE) {
                    const text = this.readString();
                    if (!EAST_JSON_PATTERNS.floatSpecials.includes(text)) {
                        this.fail(`${quote(text)} is not one of the non-finite float spellings`);
                    }
                    return text === "-0.0" ? -0 : Number(text);
                }
                if (b !== MINUS && !isDigit(b)) this.fail(`expected a Float, got ${this.describe()}`);
                return Number(this.readNumber());
            }

            case "DateTime": {
                this.skipSpace();
                if (this.peek() !== QUOTE) this.fail(`expected DateTime as a string, got ${this.describe()}`);
                const text = this.readString();
                if (!DATETIME_RE.test(text)) {
                    this.fail(`${quote(text)} is not East JSON's UTC date-time form`);
                }
                const date = parseUtcDateTime(text);
                // The pattern bounds each field independently but cannot rule
                // out a day the month does not have. `new Date` will not either
                // — it rolls 30 February into 2 March rather than failing — so
                // the fields are checked against what came back.
                if (date === null) this.fail(`${quote(text)} is not a real date`);
                return date;
            }

            case "Blob": {
                this.skipSpace();
                if (this.peek() !== QUOTE) this.fail(`expected Blob as a string, got ${this.describe()}`);
                const text = this.readString();
                if (!BLOB_RE.test(text)) {
                    this.fail(`${quote(text)} is not East JSON's 0x-prefixed lowercase hex form`);
                }
                const hex = text.slice(2);
                const bytes = new Uint8Array(hex.length / 2);
                for (let i = 0; i < bytes.length; i++) {
                    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
                }
                return bytes;
            }

            case "Array": {
                const out: unknown[] = [];
                this.eachElement(i => { this.path.push(String(i)); try { out.push(this.readValue(type.value as EastTypeValue)); } finally { this.path.pop(); } });
                return out;
            }

            case "Set": {
                const element = type.value as EastTypeValue;
                const set = new SortedSet<unknown>([], compareFor(element as any));
                this.eachElement(i => {
                    this.path.push(String(i));
                    try {
                        const v = this.readValue(element);
                        if (set.has(v)) this.fail("duplicate element in Set");
                        set.add(v);
                    } finally { this.path.pop(); }
                });
                return set;
            }

            case "Vector": {
                const element = type.value as EastTypeValue;
                const values: unknown[] = [];
                this.eachElement(i => { this.path.push(String(i)); try { values.push(this.readValue(element)); } finally { this.path.pop(); } });
                return typedArrayFor(element, values, (m) => this.fail(m));
            }

            case "Matrix": {
                const element = type.value as EastTypeValue;
                const rows: unknown[][] = [];
                this.eachElement(i => {
                    this.path.push(String(i));
                    try {
                        const row: unknown[] = [];
                        this.eachElement(j => { this.path.push(String(j)); try { row.push(this.readValue(element)); } finally { this.path.pop(); } });
                        rows.push(row);
                    } finally { this.path.pop(); }
                });
                const cols = rows.length === 0 ? 0 : rows[0]!.length;
                const flat: unknown[] = [];
                for (let r = 0; r < rows.length; r++) {
                    if (rows[r]!.length !== cols) {
                        this.fail(`Matrix row ${r} has ${rows[r]!.length} columns, expected ${cols}`);
                    }
                    for (const v of rows[r]!) flat.push(v);
                }
                return matrix(typedArrayFor(element, flat, (m) => this.fail(m)) as any, rows.length, cols);
            }

            case "Dict": {
                const d = type.value as { key: EastTypeValue; value: EastTypeValue };
                const map = new SortedMap<unknown, unknown>([], compareFor(d.key as any));
                this.eachElement(i => {
                    this.path.push(String(i));
                    try {
                        const entry = this.readEntry(d);
                        if (map.has(entry.key)) this.fail("duplicate key in Dict");
                        map.set(entry.key, entry.value);
                    } finally { this.path.pop(); }
                });
                return map;
            }

            case "Ref":
                return ref(this.readOneElementArray(type.value as EastTypeValue));

            case "Struct":
                return this.readStruct(type.value as { name: string; type: EastTypeValue }[]);

            case "Variant":
                return this.readVariant(type.value as { name: string; type: EastTypeValue }[]);

            case "Recursive": {
                const rec = type.value as { type: "wrapper" | "ref"; value: any };
                if (rec.type === "wrapper") {
                    const w = rec.value as { id: bigint; inner: EastTypeValue };
                    this.recursive.set(w.id, w.inner);
                    return this.readValue(w.inner);
                }
                const inner = this.recursive.get(rec.value as bigint);
                if (inner === undefined) this.fail("unresolved recursive type");
                return this.readValue(inner);
            }

            case "Never":
                this.fail("Never has no values, so no document satisfies it");
                break;

            default:
                this.fail("a function has no JSON form");
        }
    }

    /** Recursive type bodies, keyed by the id their wrapper carries. */
    private recursive = new Map<bigint, EastTypeValue>();

    /** Runs `body` for each element of a JSON array. */
    private eachElement(body: (index: number) => void): void {
        this.skipSpace();
        if (this.peek() !== LBRACKET) this.fail(`expected an array, got ${this.describe()}`);
        this.pos++;
        this.skipSpace();
        if (this.peek() === RBRACKET) { this.pos++; return; }
        for (let i = 0; ; i++) {
            body(i);
            this.skipSpace();
            const sep = this.take();
            if (sep === RBRACKET) return;
            if (sep !== COMMA) this.fail("expected \",\" or \"]\" in array");
        }
    }

    private readOneElementArray(inner: EastTypeValue): unknown {
        this.skipSpace();
        if (this.peek() !== LBRACKET) this.fail(`expected a Ref as a one-element array, got ${this.describe()}`);
        this.pos++;
        this.skipSpace();
        if (this.peek() === RBRACKET) this.fail("expected a Ref to hold exactly one element");
        const value = this.readValue(inner);
        this.skipSpace();
        if (this.take() !== RBRACKET) this.fail("expected a Ref to hold exactly one element");
        return value;
    }

    private readEntry(d: { key: EastTypeValue; value: EastTypeValue }): { key: unknown; value: unknown } {
        this.skipSpace();
        if (this.peek() !== LBRACE) this.fail(`expected an object, got ${this.describe()}`);
        this.pos++;
        let key: unknown; let value: unknown;
        let haveKey = false; let haveValue = false;
        this.skipSpace();
        if (this.peek() === RBRACE) this.fail("a Dict entry needs key and value");
        for (;;) {
            const name = this.readName("field");
            this.expectColon("field");
            if (name === "key") {
                if (haveKey) this.fail("duplicate \"key\" in Dict entry");
                this.path.push("key");
                try { key = this.readValue(d.key); } finally { this.path.pop(); }
                haveKey = true;
            } else if (name === "value") {
                if (haveValue) this.fail("duplicate \"value\" in Dict entry");
                this.path.push("value");
                try { value = this.readValue(d.value); } finally { this.path.pop(); }
                haveValue = true;
            } else {
                this.fail(`unexpected field ${quote(name)} in Dict entry`);
            }
            this.skipSpace();
            const sep = this.take();
            if (sep === RBRACE) break;
            if (sep !== COMMA) this.fail("expected \",\" or \"}\" in Dict entry");
        }
        if (!haveKey || !haveValue) this.fail("a Dict entry needs both key and value");
        return { key, value };
    }

    private readStruct(fields: { name: string; type: EastTypeValue }[]): unknown {
        this.skipSpace();
        if (this.peek() !== LBRACE) this.fail(`expected an object, got ${this.describe()}`);
        this.pos++;
        const seen = new Map<string, unknown>();
        this.skipSpace();
        if (this.peek() !== RBRACE) {
            for (;;) {
                const name = this.readName("field");
                this.expectColon("field");
                const field = fields.find(f => f.name === name);
                if (field === undefined) this.fail(`unexpected field ${quote(name)}`);
                if (seen.has(name)) this.fail(`duplicate field ${quote(name)}`);
                this.path.push(name);
                try { seen.set(name, this.readValue(field.type)); } finally { this.path.pop(); }
                this.skipSpace();
                const sep = this.take();
                if (sep === RBRACE) break;
                if (sep !== COMMA) this.fail("expected \",\" or \"}\" in object");
            }
        } else {
            this.pos++;
        }
        // Field order is the type's, not the document's — JSON objects are
        // unordered, so the encoder's order is not something to require.
        const out: Record<string, unknown> = {};
        for (const f of fields) {
            if (!seen.has(f.name)) this.fail(`missing field ${quote(f.name)}`);
            out[f.name] = seen.get(f.name);
        }
        return out;
    }

    private readVariant(cases: { name: string; type: EastTypeValue }[]): unknown {
        this.skipSpace();
        if (this.peek() !== LBRACE) this.fail(`expected an object, got ${this.describe()}`);
        this.pos++;
        let tag: string | null = null;
        let value: unknown;
        let haveValue = false;
        this.skipSpace();
        if (this.peek() === RBRACE) this.fail("a Variant needs type and value");
        for (;;) {
            const name = this.readName("field");
            this.expectColon("field");
            if (name === "type") {
                if (tag !== null) this.fail("duplicate \"type\" in Variant");
                this.skipSpace();
                if (this.peek() !== QUOTE) this.fail(`expected a variant case name, got ${this.describe()}`);
                tag = this.readString();
                if (!cases.some(c => c.name === tag)) this.fail(`unknown variant case ${quote(tag)}`);
                if (haveValue) {
                    // The payload arrived first; it could not be typed then.
                    this.fail("a Variant must carry \"type\" before \"value\"");
                }
            } else if (name === "value") {
                if (haveValue) this.fail("duplicate \"value\" in Variant");
                if (tag === null) this.fail("a Variant must carry \"type\" before \"value\"");
                const chosen = cases.find(c => c.name === tag)!;
                this.path.push(tag);
                try { value = this.readValue(chosen.type); } finally { this.path.pop(); }
                haveValue = true;
            } else {
                this.fail(`unexpected field ${quote(name)} in Variant`);
            }
            this.skipSpace();
            const sep = this.take();
            if (sep === RBRACE) break;
            if (sep !== COMMA) this.fail("expected \",\" or \"}\" in Variant");
        }
        if (tag === null || !haveValue) this.fail("a Variant needs both type and value");
        return variant(tag, value);
    }
}

function isDigit(b: number): boolean {
    return b >= ZERO && b <= NINE;
}

/**
 * East JSON's UTC date-time text as a `Date`, or null when the calendar has no
 * such day.
 *
 * @param text - Text already known to match the date-time pattern
 * @returns The date, or null for a day the month does not have
 *
 * @remarks
 * `new Date` cannot be trusted to reject an impossible date: it rolls
 * `2026-02-30` into `2026-03-02` and `2025-02-29` into `2025-03-01`, so a
 * NaN check lets a payload through and stores a different day than it sent.
 * The fields are read back off the constructed date instead.
 */
function parseUtcDateTime(text: string): Date | null {
    const year = Number(text.slice(0, 4));
    const month = Number(text.slice(5, 7));
    const day = Number(text.slice(8, 10));
    const hour = Number(text.slice(11, 13));
    const minute = Number(text.slice(14, 16));
    const second = Number(text.slice(17, 19));
    const millis = Number(text.slice(20, 23));
    // The pattern already pins the year to 0001..9999, the range every runtime
    // shares (python's datetime starts at year 1); this guards the arithmetic.
    if (year < 1) return null;
    // Date.UTC maps years 0-99 into the 1900s, so a one- or two-digit year has
    // to be set explicitly. The base year is a leap year so that 02-29 always
    // constructs, and the read-back below is what then rejects it in a common
    // year — `new Date` rolls 2025-02-29 into 2025-03-01 rather than failing.
    const date = new Date(Date.UTC(2000, month - 1, day, hour, minute, second, millis));
    date.setUTCFullYear(year);
    if (date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day) {
        return null;
    }
    return date;
}

function pointerOf(path: string[]): string {
    if (path.length === 0) return "";
    return "/" + path.map(s => s.replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
}

/** RFC 6901: `""` is the whole document; every other pointer starts with `/`. */
function parsePointer(pointer: string): string[] {
    if (pointer === "") return [];
    if (!pointer.startsWith("/")) {
        throw new JsonReadError(`a JSON Pointer must be empty or start with "/", got ${JSON.stringify(pointer)}`, "");
    }
    return pointer.slice(1).split("/").map(s => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function typedArrayFor(
    element: EastTypeValue,
    values: unknown[],
    fail: (message: string) => never,
): Float64Array | BigInt64Array | Uint8ClampedArray {
    if (element.type === "Float") return new Float64Array(values as number[]);
    if (element.type === "Integer") return new BigInt64Array(values as bigint[]);
    if (element.type === "Boolean") return new Uint8ClampedArray((values as boolean[]).map(v => (v ? 1 : 0)));
    return fail("a Vector or Matrix element must be Float, Integer or Boolean");
}
