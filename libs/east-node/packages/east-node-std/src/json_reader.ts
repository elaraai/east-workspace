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
import { closeSync, openSync, readSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

/** How many bytes each refill pulls from the source. */
const CHUNK_BYTES = 64 * 1024;

/**
 * How deeply a document may nest before it is refused.
 *
 * @remarks
 * JSON is an untrusted-input boundary, and skipping past a value recurses per
 * level, so a document of nothing but brackets would otherwise exhaust the
 * stack. The same limit east-c's parser applies (`JSON_MAX_DEPTH`), so every
 * runtime refuses the same documents.
 */
const MAX_DEPTH = 2048;

const INTEGER_RE = new RegExp(EAST_JSON_PATTERNS.integer);
const DATETIME_RE = new RegExp(EAST_JSON_PATTERNS.datetime);
const BLOB_RE = new RegExp(EAST_JSON_PATTERNS.blob);

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

/** A source of document text, pulled a chunk at a time. */
interface Chunks {
    /** The next chunk, or null once the source is exhausted. */
    next(): string | null;
    close(): void;
}

function stringChunks(text: string): Chunks {
    let sent = false;
    return {
        next: () => (sent ? null : ((sent = true), text)),
        close: () => { /* nothing held */ },
    };
}

function fileChunks(path: string): Chunks {
    const fd = openSync(path, "r");
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    const decoder = new StringDecoder("utf8");
    let done = false;
    return {
        next: () => {
            if (done) return null;
            const read = readSync(fd, buffer, 0, CHUNK_BYTES, null);
            if (read === 0) {
                done = true;
                // Flush any bytes the decoder is holding for a split code point.
                const tail = decoder.end();
                return tail.length > 0 ? tail : null;
            }
            return decoder.write(buffer.subarray(0, read));
        },
        close: () => closeSync(fd),
    };
}

/**
 * A pull reader over a JSON document.
 *
 * @remarks
 * Holds one chunk of text and the path it has descended, never the document
 * and never a batch. Values are constructed one at a time, directly against
 * the East type, so nothing intermediate is materialised either.
 */
export class JsonReader {
    private chunks: Chunks;
    private buf = "";
    private pos = 0;
    private eof = false;
    /** The path descended so far, for error pointers. */
    private path: string[] = [];
    /** Index within the container currently being iterated. */
    private index = 0;
    /** Whether iteration has begun, so a separator is expected next. */
    private started = false;
    /** The container kind at the cursor: `[` for an array, `{` for an object. */
    private container: "[" | "{" | null = null;
    /** Nesting depth of the value currently being read or skipped. */
    private depth = 0;
    private closed = false;

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

    // ── character access ────────────────────────────────────────────────

    /** Ensures at least one character is buffered; false at end of input. */
    private fill(): boolean {
        while (this.pos >= this.buf.length) {
            if (this.eof) return false;
            const chunk = this.chunks.next();
            if (chunk === null) { this.eof = true; return false; }
            // Drop the consumed prefix so the buffer stays bounded.
            this.buf = this.buf.slice(this.pos) + chunk;
            this.pos = 0;
        }
        return true;
    }

    private peek(): string | null {
        return this.fill() ? this.buf[this.pos]! : null;
    }

    private take(): string {
        if (!this.fill()) this.fail("unexpected end of document");
        return this.buf[this.pos++]!;
    }

    private skipSpace(): void {
        for (;;) {
            const c = this.peek();
            if (c === " " || c === "\t" || c === "\n" || c === "\r") { this.pos++; continue; }
            return;
        }
    }

    private expect(ch: string): void {
        this.skipSpace();
        const c = this.peek();
        if (c !== ch) {
            this.fail(`expected ${JSON.stringify(ch)}, got ${c === null ? "end of document" : JSON.stringify(c)}`);
        }
        this.pos++;
    }

    private fail(message: string): never {
        throw new JsonReadError(message, pointerOf(this.path));
    }

    // ── tokens ──────────────────────────────────────────────────────────

    private readString(): string {
        this.skipSpace();
        this.expect('"');
        let out = "";
        for (;;) {
            const c = this.take();
            if (c === '"') return out;
            if (c !== "\\") {
                // JSON forbids raw control characters inside a string.
                if (c < " ") this.fail(`unescaped control character U+${c.charCodeAt(0).toString(16).padStart(4, "0")} in string`);
                out += c;
                continue;
            }
            const esc = this.take();
            switch (esc) {
                case '"': out += '"'; break;
                case "\\": out += "\\"; break;
                case "/": out += "/"; break;
                case "b": out += "\b"; break;
                case "f": out += "\f"; break;
                case "n": out += "\n"; break;
                case "r": out += "\r"; break;
                case "t": out += "\t"; break;
                case "u": {
                    let hex = "";
                    for (let i = 0; i < 4; i++) hex += this.take();
                    if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail(`invalid \\u escape "\\u${hex}"`);
                    out += String.fromCharCode(parseInt(hex, 16));
                    break;
                }
                default: this.fail(`invalid escape "\\${esc}"`);
            }
        }
    }

    /** The raw text of a JSON number, exactly as written. */
    private readNumber(): string {
        this.skipSpace();
        let out = "";
        if (this.peek() === "-") out += this.take();
        const first = this.peek();
        if (first === null || first < "0" || first > "9") this.fail("expected a number");
        if (first === "0") {
            out += this.take();
        } else {
            while (isDigit(this.peek())) out += this.take();
        }
        if (this.peek() === ".") {
            out += this.take();
            if (!isDigit(this.peek())) this.fail("expected a digit after the decimal point");
            while (isDigit(this.peek())) out += this.take();
        }
        const e = this.peek();
        if (e === "e" || e === "E") {
            out += this.take();
            const sign = this.peek();
            if (sign === "+" || sign === "-") out += this.take();
            if (!isDigit(this.peek())) this.fail("expected a digit in the exponent");
            while (isDigit(this.peek())) out += this.take();
        }
        return out;
    }

    private readLiteral(word: string): void {
        this.skipSpace();
        for (const ch of word) {
            const c = this.take();
            if (c !== ch) this.fail(`expected ${word}`);
        }
    }

    /** Consumes one value without constructing anything. */
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
        const c = this.peek();
        if (c === null) this.fail("unexpected end of document");
        if (c === '"') { this.readString(); return; }
        if (c === "-" || isDigit(c)) { this.readNumber(); return; }
        if (c === "t") { this.readLiteral("true"); return; }
        if (c === "f") { this.readLiteral("false"); return; }
        if (c === "n") { this.readLiteral("null"); return; }
        if (c === "[") {
            this.pos++;
            this.skipSpace();
            if (this.peek() === "]") { this.pos++; return; }
            for (;;) {
                this.skipValue();
                this.skipSpace();
                const sep = this.take();
                if (sep === "]") return;
                if (sep !== ",") this.fail(`expected "," or "]" in array`);
            }
        }
        if (c === "{") {
            this.pos++;
            this.skipSpace();
            if (this.peek() === "}") { this.pos++; return; }
            for (;;) {
                this.readString();
                this.expect(":");
                this.skipValue();
                this.skipSpace();
                const sep = this.take();
                if (sep === "}") return;
                if (sep !== ",") this.fail(`expected "," or "}" in object`);
            }
        }
        this.fail(`unexpected character ${JSON.stringify(c)}`);
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
            const c = this.peek();
            if (c === "{") {
                this.pos++;
                this.enterObjectMember(segment);
            } else if (c === "[") {
                this.pos++;
                this.enterArrayIndex(segment);
            } else {
                this.fail(`cannot descend into ${c === null ? "end of document" : JSON.stringify(c)} looking for ${JSON.stringify(segment)}`);
            }
            this.path.push(segment);
        }
        if (!enter) return;
        this.skipSpace();
        const c = this.peek();
        if (c !== "[" && c !== "{") {
            this.fail(`expected an array or object to iterate, got ${c === null ? "end of document" : JSON.stringify(c)}`);
        }
        this.pos++;
        this.container = c;
    }

    /** Positions the cursor on the value of `key`, skipping the members before it. */
    private enterObjectMember(key: string): void {
        this.skipSpace();
        if (this.peek() === "}") this.fail(`no member ${JSON.stringify(key)}`);
        for (;;) {
            const name = this.readString();
            this.expect(":");
            if (name === key) return;
            this.skipValue();
            this.skipSpace();
            const sep = this.take();
            if (sep === "}") this.fail(`no member ${JSON.stringify(key)}`);
            if (sep !== ",") this.fail(`expected "," or "}" in object`);
        }
    }

    /** Positions the cursor on element `index`, skipping the elements before it. */
    private enterArrayIndex(segment: string): void {
        if (!/^(?:0|[1-9][0-9]*)$/.test(segment)) {
            this.fail(`expected an array index, got ${JSON.stringify(segment)}`);
        }
        const target = Number(segment);
        this.skipSpace();
        if (this.peek() === "]") this.fail(`no element ${target}`);
        for (let i = 0; ; i++) {
            if (i === target) return;
            this.skipValue();
            this.skipSpace();
            const sep = this.take();
            if (sep === "]") this.fail(`no element ${target}`);
            if (sep !== ",") this.fail(`expected "," or "]" in array`);
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
        const close = this.container === "[" ? "]" : "}";
        this.skipSpace();
        const c = this.peek();
        if (c === close) { this.pos++; this.container = null; return false; }
        return true;
    }

    /**
     * Reads the next element as `type`.
     *
     * @remarks
     * For an object container, `type` must be a two-field struct named `key`
     * and `value`, and each member arrives as one of those.
     */
    next(type: EastTypeValue): unknown {
        if (this.container === null) this.fail("the reader is exhausted");
        // The separator belongs to the advance, not to the predicate, so
        // reading two elements in a row does not need a `more` between them.
        if (this.started) {
            this.skipSpace();
            const c = this.peek();
            const close = this.container === "[" ? "]" : "}";
            if (c === close) { this.pos++; this.container = null; this.fail("the reader is exhausted"); }
            if (c !== ",") this.fail(`expected "," or ${JSON.stringify(close)}`);
            this.pos++;
        }
        this.started = true;
        this.path.push(String(this.index));
        this.index++;
        try {
            if (this.container === "{") return this.readMember(type);
            return this.readValue(type);
        } finally {
            this.path.pop();
        }
    }

    /** One object member, as a `{ key, value }` struct. */
    private readMember(type: EastTypeValue): unknown {
        if (type.type !== "Struct") {
            this.fail("iterating an object needs a Struct of key and value");
        }
        const fields = type.value as { name: string; type: EastTypeValue }[];
        const keyField = fields.find(f => f.name === "key");
        const valueField = fields.find(f => f.name === "value");
        if (fields.length !== 2 || keyField === undefined || valueField === undefined) {
            this.fail("iterating an object needs a Struct with exactly the fields key and value");
        }
        const name = this.readString();
        this.expect(":");
        if (keyField.type.type !== "String") {
            this.fail("iterating an object needs a String key");
        }
        const value = this.readValue(valueField.type);
        return { key: name, value };
    }

    /** Reads one whole value, strictly, as `type`. */
    readValue(type: EastTypeValue): unknown {
        if (++this.depth > MAX_DEPTH) {
            this.depth--;
            this.fail(`document nests deeper than ${MAX_DEPTH}`);
        }
        try {
            return this.readValueInner(type);
        } finally {
            this.depth--;
        }
    }

    private readValueInner(type: EastTypeValue): unknown {
        switch (type.type) {
            case "Null":
                this.readLiteral("null");
                return null;

            case "Boolean": {
                this.skipSpace();
                const c = this.peek();
                if (c === "t") { this.readLiteral("true"); return true; }
                if (c === "f") { this.readLiteral("false"); return false; }
                this.fail("expected a boolean");
                break;
            }

            case "String":
                return this.readString();

            case "Integer": {
                // East JSON writes Integer as a decimal string, so no value
                // ever passes through a double.
                this.skipSpace();
                if (this.peek() !== '"') this.fail("expected Integer as a quoted decimal string");
                const text = this.readString();
                if (!INTEGER_RE.test(text)) {
                    this.fail(`${JSON.stringify(text)} is not a 64-bit integer in East JSON's form`);
                }
                return BigInt(text);
            }

            case "Float": {
                this.skipSpace();
                const c = this.peek();
                if (c === '"') {
                    const text = this.readString();
                    if (!EAST_JSON_PATTERNS.floatSpecials.includes(text)) {
                        this.fail(`${JSON.stringify(text)} is not one of the non-finite float spellings`);
                    }
                    return text === "-0.0" ? -0 : Number(text);
                }
                return Number(this.readNumber());
            }

            case "DateTime": {
                this.skipSpace();
                if (this.peek() !== '"') this.fail("expected DateTime as a string");
                const text = this.readString();
                if (!DATETIME_RE.test(text)) {
                    this.fail(`${JSON.stringify(text)} is not East JSON's UTC date-time form`);
                }
                const date = parseUtcDateTime(text);
                // The pattern bounds each field independently but cannot rule
                // out a day the month does not have. `new Date` will not either
                // — it rolls 30 February into 2 March rather than failing — so
                // the fields are checked against what came back.
                if (date === null) this.fail(`${JSON.stringify(text)} is not a real date`);
                return date;
            }

            case "Blob": {
                this.skipSpace();
                if (this.peek() !== '"') this.fail("expected Blob as a string");
                const text = this.readString();
                if (!BLOB_RE.test(text)) {
                    this.fail(`${JSON.stringify(text)} is not East JSON's 0x-prefixed lowercase hex form`);
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
                this.fail(`${type.type} has no JSON form`);
        }
    }

    /** Recursive type bodies, keyed by the id their wrapper carries. */
    private recursive = new Map<bigint, EastTypeValue>();

    /** Runs `body` for each element of a JSON array. */
    private eachElement(body: (index: number) => void): void {
        this.expect("[");
        this.skipSpace();
        if (this.peek() === "]") { this.pos++; return; }
        for (let i = 0; ; i++) {
            body(i);
            this.skipSpace();
            const sep = this.take();
            if (sep === "]") return;
            if (sep !== ",") this.fail(`expected "," or "]" in array`);
        }
    }

    private readOneElementArray(inner: EastTypeValue): unknown {
        this.expect("[");
        const value = this.readValue(inner);
        this.skipSpace();
        const sep = this.take();
        if (sep !== "]") this.fail("expected a Ref to hold exactly one element");
        return value;
    }

    private readEntry(d: { key: EastTypeValue; value: EastTypeValue }): { key: unknown; value: unknown } {
        this.expect("{");
        let key: unknown; let value: unknown;
        let haveKey = false; let haveValue = false;
        this.skipSpace();
        if (this.peek() === "}") this.fail("a Dict entry needs key and value");
        for (;;) {
            const name = this.readString();
            this.expect(":");
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
                this.fail(`unexpected field ${JSON.stringify(name)} in Dict entry`);
            }
            this.skipSpace();
            const sep = this.take();
            if (sep === "}") break;
            if (sep !== ",") this.fail(`expected "," or "}" in Dict entry`);
        }
        if (!haveKey || !haveValue) this.fail("a Dict entry needs both key and value");
        return { key, value };
    }

    private readStruct(fields: { name: string; type: EastTypeValue }[]): unknown {
        this.expect("{");
        const seen = new Map<string, unknown>();
        this.skipSpace();
        if (this.peek() !== "}") {
            for (;;) {
                const name = this.readString();
                this.expect(":");
                const field = fields.find(f => f.name === name);
                if (field === undefined) this.fail(`unexpected field ${JSON.stringify(name)}`);
                if (seen.has(name)) this.fail(`duplicate field ${JSON.stringify(name)}`);
                this.path.push(name);
                try { seen.set(name, this.readValue(field.type)); } finally { this.path.pop(); }
                this.skipSpace();
                const sep = this.take();
                if (sep === "}") break;
                if (sep !== ",") this.fail(`expected "," or "}" in object`);
            }
        } else {
            this.pos++;
        }
        // Field order is the type's, not the document's — JSON objects are
        // unordered, so the encoder's order is not something to require.
        const out: Record<string, unknown> = {};
        for (const f of fields) {
            if (!seen.has(f.name)) this.fail(`missing field ${JSON.stringify(f.name)}`);
            out[f.name] = seen.get(f.name);
        }
        return out;
    }

    private readVariant(cases: { name: string; type: EastTypeValue }[]): unknown {
        this.expect("{");
        let tag: string | null = null;
        let value: unknown;
        let haveValue = false;
        this.skipSpace();
        if (this.peek() === "}") this.fail("a Variant needs type and value");
        for (;;) {
            const name = this.readString();
            this.expect(":");
            if (name === "type") {
                if (tag !== null) this.fail("duplicate \"type\" in Variant");
                tag = this.readString();
                if (!cases.some(c => c.name === tag)) this.fail(`unknown variant case ${JSON.stringify(tag)}`);
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
                this.fail(`unexpected field ${JSON.stringify(name)} in Variant`);
            }
            this.skipSpace();
            const sep = this.take();
            if (sep === "}") break;
            if (sep !== ",") this.fail(`expected "," or "}" in Variant`);
        }
        if (tag === null || !haveValue) this.fail("a Variant needs both type and value");
        return variant(tag, value);
    }
}

function isDigit(c: string | null): boolean {
    return c !== null && c >= "0" && c <= "9";
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
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millis));
    // Date.UTC maps years 0-99 into the 1900s, so the year is checked too.
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
    return fail(`a Vector or Matrix element must be Float, Integer or Boolean, got ${element.type}`);
}
