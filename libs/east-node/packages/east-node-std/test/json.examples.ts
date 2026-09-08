/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, OptionType, StringType, StructType, example } from "@elaraai/east";
import { FileSystem, Json } from "@elaraai/east-node-std";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The files the examples write, named once here: a path is host data.
const ROWS_PATH = join(tmpdir(), "ex-json-rows.json");
const ENVELOPE_PATH = join(tmpdir(), "ex-json-envelope.json");
const META_PATH = join(tmpdir(), "ex-json-meta.json");
const OBJECT_PATH = join(tmpdir(), "ex-json-object.json");

export const jsonReadArray = example({
    keywords: ["json", "Json", "open", "next", "more", "close", "stream", "array", "read", "file"],
    description: "Read a JSON array of rows one at a time, holding one row in memory",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const path = $.let(ROWS_PATH);
        $(FileSystem.writeFile(path, '[{"id":"1"},{"id":"2"},{"id":"3"}]'));
        const handle = $.let(Json.open(path, ""));
        const sum = $.let(0n);
        $.while(Json.more(handle), ($) => {
            $.assign(sum, sum.add(Json.next(StructType({ id: IntegerType }), handle).id));
        });
        $(Json.close(handle));
        return sum;
    }),
    inputs: [],
    returns: 6n,
});

export const jsonReadPointer = example({
    keywords: ["json", "Json", "open", "pointer", "JSON Pointer", "envelope", "data", "nested", "stream"],
    description: "Stream the huge array of an enveloped document by pointing at it",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const path = $.let(ENVELOPE_PATH);
        $(FileSystem.writeFile(path, '{"meta":{"count":"3"},"data":[{"id":"10"},{"id":"20"},{"id":"30"}]}'));
        const handle = $.let(Json.open(path, "/data"));
        const sum = $.let(0n);
        $.while(Json.more(handle), ($) => {
            $.assign(sum, sum.add(Json.next(StructType({ id: IntegerType }), handle).id));
        });
        $(Json.close(handle));
        return sum;
    }),
    inputs: [],
    returns: 60n,
});

export const jsonValueEnvelope = example({
    keywords: ["json", "Json", "value", "pointer", "envelope", "meta", "subtree", "skip"],
    description: "Read a small envelope member of a document whose other member is huge",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const path = $.let(META_PATH);
        $(FileSystem.writeFile(path, '{"data":[{"id":"1"},{"id":"2"}],"meta":{"count":"2"}}'));
        return Json.value(StructType({ count: IntegerType }), path, "/meta").count;
    }),
    inputs: [],
    returns: 2n,
});

export const jsonReadText = example({
    keywords: ["json", "Json", "openText", "payload", "body", "webhook", "memory", "string"],
    description: "Read an in-memory JSON payload under the same strict contract as a file",
    fn: East.asyncFunction([], StringType, ($) => {
        const handle = $.let(Json.openText('[{"name":"first"},{"name":"second"}]', ""));
        const first = $.let(Json.next(StructType({ name: StringType }), handle).name);
        $(Json.close(handle));
        return first;
    }),
    inputs: [],
    returns: "first",
});

export const jsonReadObjectAsEntries = example({
    keywords: ["json", "Json", "object", "dict", "DictType", "key", "value", "entries", "stream"],
    description: "Iterate a JSON object's members as key and value, for a Dict output",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const path = $.let(OBJECT_PATH);
        $(FileSystem.writeFile(path, '{"a":"1","b":"2","c":"3"}'));
        const handle = $.let(Json.open(path, ""));
        const sum = $.let(0n);
        $.while(Json.more(handle), ($) => {
            $.assign(sum, sum.add(Json.next(StructType({ key: StringType, value: IntegerType }), handle).value));
        });
        $(Json.close(handle));
        return sum;
    }),
    inputs: [],
    returns: 6n,
});

export const jsonReadOptional = example({
    keywords: ["json", "Json", "next", "Option", "OptionType", "optional", "nullable", "null", "none", "some", "missing"],
    description: "Read rows whose optional field is null or present: an Option is null for none and the value itself for some",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const handle = $.let(Json.openText('[{"id":"1","note":null},{"id":"2","note":"paid"},{"id":"3","note":null}]', ""));
        const noted = $.let(0n);
        $.while(Json.more(handle), ($) => {
            const row = $.let(Json.next(StructType({ id: IntegerType, note: OptionType(StringType) }), handle));
            $.if(row.note.hasTag("some"), ($) => {
                $.assign(noted, noted.add(1n));
            });
        });
        $(Json.close(handle));
        return noted;
    }),
    inputs: [],
    returns: 1n,
});
