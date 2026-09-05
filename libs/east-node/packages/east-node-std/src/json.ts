/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import {
    East, StringType, NullType, BooleanType,
    type EastType, type SubtypeExprOrValue, type ExprType,
    printType,
} from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";
import { randomUUID } from "node:crypto";
import { JsonReader } from "./json_reader.js";

/** Open readers, keyed by the opaque handle an East program carries. */
const readers = new Map<string, JsonReader>();

function hold(reader: JsonReader): string {
    const handle = randomUUID();
    readers.set(handle, reader);
    return handle;
}

function get(handle: string, fn: string): JsonReader {
    const reader = readers.get(handle);
    if (reader === undefined) {
        throw new EastError(`${fn}: no open JSON reader for this handle`, {
            location: [{ filename: fn, line: 0n, column: 0n }],
        });
    }
    return reader;
}

/** Wraps a reader failure as an East error, keeping its pointer in the message. */
function wrap<T>(fn: string, body: () => T): T {
    try {
        return body();
    } catch (err: any) {
        throw new EastError(`${fn}: ${err.message}`, {
            location: [{ filename: fn, line: 0n, column: 0n }],
            cause: err,
        });
    }
}

/**
 * Opens a JSON file and positions a reader on the array or object to iterate.
 *
 * @param path - The file to read
 * @param pointer - RFC 6901 pointer to the container, `""` for the whole document
 * @returns An opaque handle
 *
 * @throws {EastError} When the file cannot be opened, the pointer does not
 * resolve, or the node it names is not an array or object
 *
 * @remarks
 * The document is never held: the reader pulls one chunk of text at a time and
 * constructs one value per {@link json_next}. Reading past the container is
 * skipping, not parsing, so a pointer naming a small envelope member costs a
 * scan and nothing more.
 */
export const json_open = East.platform("json_open", [StringType, StringType], StringType);

/**
 * Opens an in-memory JSON payload, as {@link json_open} opens a file.
 *
 * @param text - The document
 * @param pointer - RFC 6901 pointer to the container, `""` for the whole document
 * @returns An opaque handle
 *
 * @remarks
 * The same reader over a string, so a request body and a multi-gigabyte file
 * are read by one implementation and held to one definition of strict.
 */
export const json_open_text = East.platform("json_open_text", [StringType, StringType], StringType);

/**
 * Whether the container being iterated has another element.
 *
 * @param handle - A handle from {@link json_open} or {@link json_open_text}
 * @returns True while elements remain
 *
 * @throws {EastError} When the handle is not open, or the document is malformed
 *
 * @remarks
 * A predicate, not an advance: {@link json_next} moves the cursor, so the two
 * need not alternate and asking twice is harmless.
 */
export const json_more = East.platform("json_more", [StringType], BooleanType);

/**
 * Reads the next element of the container as `T`.
 *
 * @param handle - A handle from {@link json_open} or {@link json_open_text}
 * @returns The decoded value
 *
 * @throws {EastError} When the element does not satisfy `T` under East JSON's
 * encoding, naming the RFC 6901 pointer of the offending node
 *
 * @remarks
 * Strict: it accepts exactly what `jsonSchemaFor(T)` describes, which is what
 * the ENCODER emits rather than what the historic decoder tolerated. An
 * integer must be a quoted decimal in i64 range — not `"0x10"`, not `" 7 "`,
 * not `"007"`; a timestamp must carry an explicit `+00:00`, not `Z` and not a
 * numeric offset; a blob's hex must be lowercase.
 *
 * When the container is a JSON object, `T` must be a `Struct` of exactly `key`
 * and `value`, and each member arrives as one of those — which is what a
 * `Dict` output needs.
 */
export const json_next = East.genericPlatform("json_next", ["T"], [StringType], "T");

/**
 * Reads one whole value from a file, without iterating.
 *
 * @param path - The file to read
 * @param pointer - RFC 6901 pointer to the value
 * @returns The decoded value
 *
 * @throws {EastError} When the file cannot be read, the pointer does not
 * resolve, or the value does not satisfy `T`
 *
 * @remarks
 * For the small parts of a document whose large parts are streamed — an
 * envelope's metadata beside a ten-million-row array. Everything outside the
 * pointer is skipped rather than constructed.
 */
export const json_value = East.genericPlatform("json_value", ["T"], [StringType, StringType], "T");

/**
 * Closes a reader and releases its file descriptor.
 *
 * @param handle - A handle from {@link json_open} or {@link json_open_text}
 * @returns Null
 *
 * @remarks
 * Handles are held until closed, as a database connection is. A body that can
 * fail mid-document should close in a `.catch` that re-raises, since a `$.try`
 * whose `.catch` is left implicit swallows the error.
 */
export const json_close = East.platform("json_close", [StringType], NullType);

/** Node.js implementation of the JSON reader platform functions. */
const JsonImpl: PlatformFunction[] = [
    json_open.implement((path: string, pointer: string) =>
        wrap("json_open", () => hold(JsonReader.openFile(path, pointer)))),

    json_open_text.implement((text: string, pointer: string) =>
        wrap("json_open_text", () => hold(JsonReader.openText(text, pointer)))),

    json_more.implement((handle: string) =>
        wrap("json_more", () => get(handle, "json_more").more())),

    json_next.implement((T) => (handle: unknown) =>
        wrap("json_next", () => get(handle as string, "json_next").next(T))),

    json_value.implement((T) => (path: unknown, pointer: unknown) =>
        wrap("json_value", () => {
            // A pointer to a scalar cannot be "entered", so the value is read
            // from a reader opened on the parent and positioned by the last
            // segment — openValue does that in one step.
            const reader = JsonReader.openValueFile(path as string, pointer as string);
            try {
                return reader.readValue(T);
            } finally {
                reader.close();
            }
        })),

    json_close.implement((handle: string) => {
        const reader = readers.get(handle);
        if (reader === undefined) {
            throw new EastError("json_close: no open JSON reader for this handle", {
                location: [{ filename: "json_close", line: 0n, column: 0n }],
            });
        }
        readers.delete(handle);
        reader.close();
        return null;
    }),
];

/** The element type a container's rows decode as must have a JSON form. */
function checkRowType(type: EastType, fn: string): void {
    if (type.type === "Function" || type.type === "AsyncFunction" || type.type === "Never") {
        throw new Error(`${fn} cannot read ${printType(type)} — it has no JSON form`);
    }
}

/**
 * Reading JSON documents that do not fit in memory.
 *
 * @remarks
 * The ingest half of the contract boundary: `jsonSchemaFor(T)` publishes what a
 * producer must send, and these read it back under exactly that contract. One
 * element is in flight at a time, whatever the document's size, so the natural
 * home is an `e3.streamTask` producer that emits as it reads.
 *
 * @example
 * ```ts
 * const rows = e3.streamTask('rows', {
 *     inputs: [path],
 *     output: ArrayType(RowType),
 * }, ($, p, emit) => {
 *     const handle = $.let(Json.open(p, "/data"));
 *     $.while(Json.more(handle), $ => {
 *         $(emit(Json.next(RowType, handle)));
 *     });
 *     $(Json.close(handle));
 * });
 * ```
 */
export const Json = {
    /**
     * Opens a JSON file and positions a reader on the container to iterate.
     *
     * @param path - The file to read
     * @param pointer - RFC 6901 pointer to the container, `""` for the whole document
     * @returns An opaque handle
     * @throws {EastError} When the file cannot be opened or the pointer does not resolve
     */
    open: json_open,

    /**
     * Opens an in-memory payload, as {@link Json.open} opens a file.
     *
     * @param text - The document
     * @param pointer - RFC 6901 pointer to the container, `""` for the whole document
     * @returns An opaque handle
     * @throws {EastError} When the pointer does not resolve
     */
    openText: json_open_text,

    /**
     * Whether the container has another element.
     *
     * @param handle - A handle from {@link Json.open} or {@link Json.openText}
     * @returns True while elements remain
     */
    more: json_more,

    /**
     * Reads the next element as `type`.
     *
     * @typeParam T - The element's East type
     * @param type - The type to decode the element as
     * @param handle - A handle from {@link Json.open} or {@link Json.openText}
     * @returns The decoded element
     * @throws {Error} When `type` has no JSON form (at build time)
     * @throws {EastError} When the element does not satisfy `type`, naming the
     * RFC 6901 pointer of the offending node
     */
    next<T extends EastType>(type: T, handle: SubtypeExprOrValue<StringType>): ExprType<T> {
        checkRowType(type, "Json.next");
        return json_next([type], handle) as ExprType<T>;
    },

    /**
     * Reads one whole value from a file without iterating.
     *
     * @typeParam T - The value's East type
     * @param type - The type to decode the value as
     * @param path - The file to read
     * @param pointer - RFC 6901 pointer to the value
     * @returns The decoded value
     * @throws {Error} When `type` has no JSON form (at build time)
     * @throws {EastError} When the value does not satisfy `type`
     */
    value<T extends EastType>(
        type: T,
        path: SubtypeExprOrValue<StringType>,
        pointer: SubtypeExprOrValue<StringType>,
    ): ExprType<T> {
        checkRowType(type, "Json.value");
        return json_value([type], path, pointer) as ExprType<T>;
    },

    /**
     * Closes a reader and releases its file descriptor.
     *
     * @param handle - A handle from {@link Json.open} or {@link Json.openText}
     * @returns Null
     */
    close: json_close,

    /**
     * Node.js implementation of the JSON reader platform functions.
     *
     * Pass this to {@link East.compile} to enable them.
     */
    Implementation: JsonImpl,
} as const;

export { JsonImpl };
export { JsonReadError } from "./json_reader.js";
