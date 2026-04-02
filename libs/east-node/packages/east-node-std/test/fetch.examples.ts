/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, IntegerType, variant, example } from "@elaraai/east";
import { Fetch, FetchRequestConfig } from "@elaraai/east-node-std";

export const fetchGet = example({
    keywords: ["fetch", "Fetch", "get", "HTTP", "GET", "request"],
    description: "Fetch data from a URL with HTTP GET",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const response = $.let(Fetch.get("http://localhost:8085/get"));
        return response.length().greater(0n);
    }),
    inputs: [],
    returns: true,
});

export const fetchGetBytes = example({
    keywords: ["fetch", "Fetch", "getBytes", "HTTP", "GET", "binary"],
    description: "Fetch binary data from a URL with HTTP GET",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const response = $.let(Fetch.getBytes("http://localhost:8085/bytes/100"));
        return response.size().greater(0n);
    }),
    inputs: [],
    returns: true,
});

export const fetchPost = example({
    keywords: ["fetch", "Fetch", "post", "HTTP", "POST", "send"],
    description: "Send data to a URL with HTTP POST",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const response = $.let(Fetch.post("http://localhost:8085/post", "test data"));
        return response.contains("test data");
    }),
    inputs: [],
    returns: true,
});

export const fetchRequest = example({
    keywords: ["fetch", "Fetch", "request", "HTTP", "config", "headers"],
    description: "Perform a configurable HTTP request with headers and method",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const config = $.let({
            url: "http://localhost:8085/get",
            method: variant("GET", null),
            headers: new Map<string, string>(),
            body: variant("none", null),
        }, FetchRequestConfig);
        const response = $.let(Fetch.request(config));
        return response.status;
    }),
    inputs: [],
    returns: 200n,
});
