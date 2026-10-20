/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A platform whose every binding refuses to read, write or call (#1379): what
 * e3-ui's specs compile a tag's East functions against. A check that builds a
 * payload, refuses a wrong prop or type, or reads a payload's types needs no
 * e3. One that reads or writes a record, a dataset, a page or a function runs
 * in e3-ui-components, on e3 itself, and here it throws, saying so.
 *
 * Each handle has the shape its binding declares and the data the runtimes
 * give it — a record's and a function's descriptor, a dataset's paths, a paged
 * source's identity and whether it searches, an indexed source's declarations
 * — and every function in it refuses.
 *
 * @packageDocumentation
 */

import { fromEastTypeValue, none, some, type EastType, type EastTypeValue } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import type { TreePath } from "@elaraai/e3-types";
import {
    bindIndexedPagedPlatformFn, bindPagedPinnedPlatformFn, bindPagedPlatformFn, bindPlatformFn, funcBindPlatformFn, recordBindPlatformFn,
} from "@elaraai/e3-ui/internal";

/**
 * A function that refuses, naming what it would have reached.
 *
 * @param what - The binding and the method called (`Record.bind("jobs").read`)
 * @returns The refusal, which throws when called
 */
function refusal(what: string): () => never {
    return () => {
        throw new Error(`${what}: e3-ui's specs read, write and call no e3 — a check that does runs in e3-ui-components, on e3-web`);
    };
}

/** A dataset's path, its fields joined by dots, as the runtimes name a source. */
const pathText = (path: TreePath): string => path.map((step) => step.value).join(".");

/**
 * Each function of a struct a refusal, and each struct in it so too.
 *
 * @param type - The struct's type
 * @param what - What the struct is, for the refusals' words
 * @returns The struct's fields, every function among them refusing
 */
function refusingFields(type: EastType, what: string): Record<string, unknown> {
    if (type.type !== "Struct") throw new Error(`${what} is no struct`);
    const fields: Record<string, unknown> = {};
    for (const [name, field] of Object.entries(type.fields as Record<string, EastType>)) {
        if (field.type === "Function" || field.type === "AsyncFunction") fields[name] = refusal(`${what}.${name}`);
        else if (field.type === "Struct") fields[name] = refusingFields(field, `${what}.${name}`);
    }
    return fields;
}

/** `Record.bind`: the handle its type declares, its descriptor naming the record and the mutations it commits through. */
const records = recordBindPlatformFn.implement((handleType: EastTypeValue) => (nameArg: unknown) => {
    const name = nameArg as string;
    const type = fromEastTypeValue(handleType);
    const commits = type.type === "Struct" ? type.fields["commit"] : undefined;
    const mutations = commits?.type === "Struct" ? Object.keys(commits.fields) : [];
    return { ...refusingFields(type, `Record.bind("${name}")`), binding: { name, mutations } };
});

/** `Data.bind`: the handle, its descriptor the dataset's paths and the mode. */
const datasets = bindPlatformFn.implement((_type: EastTypeValue) => (source: unknown, patch: unknown, mode: unknown) => {
    const what = `Data.bind(${pathText(source as TreePath)})`;
    const methods = ["read", "write", "writeAndStart", "start", "source", "pending", "commit", "discard", "has", "status"];
    return { ...Object.fromEntries(methods.map((method) => [method, refusal(`${what}.${method}`)])), binding: { source, patch, mode } };
});

/** Whether a paged source searches: an index's window, or a keyed collection's own entries. */
function searches(type: EastTypeValue, index: boolean): boolean {
    const collection = fromEastTypeValue(type);
    return index || collection.type === "Dict" || collection.type === "Set";
}

/** `Data.bindPaged` as UIs exported before pinned reads call it: a released source. */
const released = bindPagedPlatformFn.implement((type: EastTypeValue) => (pathArg: unknown) => {
    const id = pathText(pathArg as TreePath);
    const what = `Data.bindPaged(${id})`;
    return { id, page: refusal(`${what}.page`), total: refusal(`${what}.total`), seek: searches(type, false) ? some(refusal(`${what}.seek`)) : none };
});

/** `Data.bindPaged`: a pinned source over a dataset's entries or an index's, named as the runtime names it. */
const pinned = bindPagedPinnedPlatformFn.implement((type: EastTypeValue) => (pathArg: unknown, indexArg: unknown, joinArg: unknown) => {
    const index = indexArg as { type: "some"; value: string } | { type: "none" };
    const id = `${pathText(pathArg as TreePath)}${index.type === "some" ? `@${index.value}${joinArg === true ? "+join" : ""}` : ""}`;
    const what = `Data.bindPaged(${id})`;
    return {
        id, page: refusal(`${what}.page`), total: refusal(`${what}.total`),
        seek: searches(type, index.type === "some") ? some(refusal(`${what}.seek`)) : none,
        revision: refusal(`${what}.revision`), refresh: refusal(`${what}.refresh`),
    };
});

/**
 * `Data.bindPaged(record, { indexes })`: an indexed source, its declarations as
 * given. Its unfiltered view is the record's own rows when it joins them, and
 * otherwise the first index with one entry a row, as the runtime chooses it.
 */
const indexed = bindIndexedPagedPlatformFn.implement((...types: EastTypeValue[]) =>
    (pathArg: unknown, metadataArg: unknown, joinedArg: unknown, entryKeys: unknown, recordId: unknown) => {
        const metadata = metadataArg as Record<string, Record<string, unknown>>;
        const joined = joinedArg === true;
        const [, row, , indexes] = types.map(fromEastTypeValue);
        const pathKey = pathText(pathArg as TreePath);
        const id = `${pathKey}@indexes:${Object.keys(metadata).join(",")}${joined ? "+join" : ""}`;
        const oneEntryARow = (name: string): boolean => {
            const fields = indexes?.type === "Struct" ? indexes.fields[name] : undefined;
            return fields?.type === "Struct" && Object.entries(fields.fields as Record<string, EastType>).every(([field, marker]) =>
                marker.type === "Array" || (marker.type === "Null" && row?.type === "Struct" && row.fields[field]?.type !== "Set"));
        };
        const defaultIndex = joined ? "primary" : Object.keys(metadata).find(oneEntryARow);
        if (defaultIndex === undefined) throw new Error("A covering-only binding needs an index with one entry per record row");
        const what = `Data.bindPaged(${pathKey}, { indexes })`;
        return {
            id, recordId, indexes: metadata, joined, defaultIndex, entryKeys,
            page: refusal(`${what}.page`), seek: refusal(`${what}.seek`), total: refusal(`${what}.total`),
            revision: refusal(`${what}.revision`), refresh: refusal(`${what}.refresh`),
        };
    });

/** `Func.bind`: the handle, its descriptor naming the function. */
const functions = funcBindPlatformFn.implement((_handleType: EastTypeValue) => (nameArg: unknown) => {
    const name = nameArg as string;
    const what = `Func.bind("${name}")`;
    const methods = ["call", "read", "status", "error", "pending", "cancel"];
    return { ...Object.fromEntries(methods.map((method) => [method, refusal(`${what}.${method}`)])), binding: { name } };
});

/** Every binding e3-ui declares, each refusing to read, write or call: the platform its specs compile against. */
export const refusingPlatform: PlatformFunction[] = [records, datasets, released, pinned, indexed, functions];
