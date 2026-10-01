/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Fetch makes its requests through the global `fetch`, as a browser page
 * does, and answers as east-node-std's does: a body, the bytes of one, or the
 * whole response. A local server answers, so the specs need no network.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { BlobType, East, EastError, StringType, compareFor, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Fetch, FetchRequestConfig, FetchResponse } from "@elaraai/east-web-std";

/** Every byte value, in order: what `/bytes` answers. */
const ALL_BYTES = Uint8Array.from({ length: 256 }, (_, i) => i);

let server: Server;
let origin: string;

before(async () => {
    server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            if (request.url === "/text") {
                response.writeHead(200, { "content-type": "text/plain", "x-custom": "yes" });
                response.end("hello from the server");
            } else if (request.url === "/bytes") {
                response.writeHead(200, { "content-type": "application/octet-stream" });
                response.end(Buffer.from(ALL_BYTES));
            } else if (request.url === "/echo") {
                response.writeHead(200, { "content-type": "text/plain" });
                response.end(`${request.method} ${request.headers["content-type"] ?? "-"} ${request.headers["x-token"] ?? "-"} ${body}`);
            } else {
                response.writeHead(404, "Not Found", { "content-type": "text/plain" });
                response.end("missing");
            }
        });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
});

const get = East.asyncFunction([StringType], StringType, ($, url) => Fetch.get(url)).toIR().compile(Fetch.Implementation);
const getBytes = East.asyncFunction([StringType], BlobType, ($, url) => Fetch.getBytes(url)).toIR().compile(Fetch.Implementation);
const post = East.asyncFunction([StringType, StringType], StringType, ($, url, body) => Fetch.post(url, body)).toIR().compile(Fetch.Implementation);
const request = East.asyncFunction([FetchRequestConfig], FetchResponse, ($, config) => Fetch.request(config)).toIR().compile(Fetch.Implementation);

/** A request's configuration, typed as East's. */
function config(url: string, method: ValueTypeOf<typeof FetchRequestConfig>["method"], body: ValueTypeOf<typeof FetchRequestConfig>["body"], headers: Map<string, string> = new Map()): ValueTypeOf<typeof FetchRequestConfig> {
    return { url, method, headers, body };
}

/** An EastError whose message matches. */
const eastError = (message: RegExp) => (error: unknown): boolean => error instanceof EastError && message.test(error.message);

describe("Fetch.get and Fetch.getBytes", () => {
    it("gives the body of a 2xx response", async () => {
        assert.equal(await get(`${origin}/text`), "hello from the server");
    });

    it("gives the bytes of a 2xx response, exactly", async () => {
        assert.ok(equalFor(BlobType)(await getBytes(`${origin}/bytes`), ALL_BYTES));
    });

    it("fails a non-2xx response with its status", async () => {
        await assert.rejects(get(`${origin}/nowhere`), eastError(/^HTTP 404: Not Found$/));
        await assert.rejects(getBytes(`${origin}/nowhere`), eastError(/^HTTP 404: Not Found$/));
    });

    it("fails a request that reaches no server, naming its URL", async () => {
        const closed = createServer();
        await new Promise<void>(resolve => closed.listen(0, "127.0.0.1", resolve));
        const url = `http://127.0.0.1:${(closed.address() as AddressInfo).port}/text`;
        await new Promise<void>(resolve => closed.close(() => resolve()));
        await assert.rejects(get(url), eastError(new RegExp(`^Failed to fetch ${url.replace(/[.]/g, "\\.")}: `)));
    });
});

describe("Fetch.post", () => {
    it("posts its body as text/plain and gives the response's body", async () => {
        assert.equal(await post(`${origin}/echo`, "test data"), "POST text/plain - test data");
    });

    it("fails a non-2xx response with its status", async () => {
        await assert.rejects(post(`${origin}/nowhere`, "x"), eastError(/^HTTP 404: Not Found$/));
    });
});

describe("Fetch.request", () => {
    it("sends the method, headers and body it is given", async () => {
        const response = await request(config(
            `${origin}/echo`,
            variant("PUT", null),
            some('{"test": "data"}'),
            new Map([["Content-Type", "application/json"], ["X-Token", "t0k3n"]]),
        ));
        assert.equal(response.body, 'PUT application/json t0k3n {"test": "data"}');
        assert.equal(response.status, 200n);
        assert.equal(response.ok, true);
    });

    it("gives a non-2xx response whole, without failing", async () => {
        const response = await request(config(`${origin}/nowhere`, variant("GET", null), none));
        assert.equal(response.status, 404n);
        assert.equal(response.statusText, "Not Found");
        assert.equal(response.ok, false);
        assert.equal(response.body, "missing");
    });

    it("gives the response's headers, in East's order", async () => {
        const response = await request(config(`${origin}/text`, variant("GET", null), none));
        assert.equal(response.headers.get("x-custom"), "yes");
        assert.equal(response.headers.get("content-type"), "text/plain");
        const keys = [...response.headers.keys()];
        assert.ok(keys.length >= 2);
        assert.deepEqual(keys, [...keys].sort(compareFor(StringType)));
    });

    it("fails a request that cannot be sent, naming its URL", async () => {
        // fetch refuses a GET with a body
        await assert.rejects(
            request(config(`${origin}/echo`, variant("GET", null), some("a body"))),
            eastError(new RegExp(`^Failed to fetch ${origin.replace(/[.]/g, "\\.")}/echo: `)),
        );
    });
});
