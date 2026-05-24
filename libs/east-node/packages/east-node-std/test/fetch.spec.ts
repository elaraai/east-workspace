/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { variant, some, none } from "@elaraai/east";
import { describeEast, Assert, Fetch, FetchRequestConfig, NodePlatform } from "@elaraai/east-node-std";
import * as ex from "./fetch.examples.js";

describeEast("Fetch platform functions", (test) => {
    Assert.examples(test, { fetchGet: ex.fetchGet, fetchGetBytes: ex.fetchGetBytes, fetchPost: ex.fetchPost, fetchRequest: ex.fetchRequest });

    // Note: These tests require network access

    test("get fetches data from URL", $ => {
        const response = $.let(Fetch.get("http://localhost:8085/get"));
        const len = $.let(response.length());

        // Response should not be empty
        $(Assert.greater(len, 0n));
    });

    test("getBytes fetches binary data from URL", $ => {
        // Fetch bytes from the /bytes endpoint which returns binary data
        const response = $.let(Fetch.getBytes("http://localhost:8085/bytes/100"));

        // Response should not be empty (httpbin /bytes/100 returns exactly 100 bytes)
        const emptyBlob = $.let(new Uint8Array([]));
        $(Assert.notEqual(response, emptyBlob));
    });

    test("post sends data to URL", $ => {
        const response = $.let(Fetch.post("http://localhost:8085/post", "test data"));
        const len = $.let(response.length());

        // Response should not be empty
        $(Assert.greater(len, 0n));

        // Response should contain our data
        $(Assert.equal(response.contains("test data"), true));
    });

    test("request performs GET request", $ => {
        const config = $.let({
            url: "http://localhost:8085/get",
            method: variant("GET", null),
            headers: new Map<string, string>(),
            body: none,
        }, FetchRequestConfig);

        const response = $.let(Fetch.request(config));

        $(Assert.equal(response.ok, true));
        $(Assert.equal(response.status, 200n));

        const bodyLen = $.let(response.body.length());
        $(Assert.greater(bodyLen, 0n));
    });

    test("request handles POST with body", $ => {
        const headers = $.let(new Map([["Content-Type", "application/json"]]));
        const config = $.let({
            url: "http://localhost:8085/post",
            method: variant("POST", null),
            headers,
            body: some('{"test": "data"}'),
        }, FetchRequestConfig);

        const response = $.let(Fetch.request(config));

        $(Assert.equal(response.ok, true));
        $(Assert.equal(response.status, 200n));
    });

    test("request returns response headers", $ => {
        const config = $.let({
            url: "http://localhost:8085/get",
            method: variant("GET", null),
            headers: new Map<string, string>(),
            body: none,
        }, FetchRequestConfig);

        const response = $.let(Fetch.request(config));

        // Check that headers map is not empty
        const headersSize = $.let(response.headers.size());
        $(Assert.greater(headersSize, 0n));

        // Check that content-type header exists (httpbin always returns this)
        const hasContentType = $.let(response.headers.has("content-type"));
        $(Assert.equal(hasContentType, true));
    });
}, { platformFns: NodePlatform });
