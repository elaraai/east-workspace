/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, StringType, IntegerType, BooleanType, DictType, OptionType, VariantType, NullType, StructType, BlobType, type ValueTypeOf, SortedMap } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";

/**
 * HTTP method variant type.
 *
 * Represents the HTTP request method for fetch operations.
 * Supports standard HTTP methods: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS.
 */
export const FetchMethod = VariantType({
    GET: NullType,
    POST: NullType,
    PUT: NullType,
    DELETE: NullType,
    PATCH: NullType,
    HEAD: NullType,
    OPTIONS: NullType,
});

/**
 * HTTP request configuration structure.
 *
 * Complete configuration for making HTTP requests with custom methods,
 * headers, and optional body content.
 */
export const FetchRequestConfig = StructType({
    url: StringType,
    method: FetchMethod,
    headers: DictType(StringType, StringType),
    body: OptionType(StringType),
});

/**
 * HTTP response structure.
 *
 * Complete HTTP response including status code, headers, body, and success indicator.
 * The `ok` field is true for status codes in the 200-299 range.
 */
export const FetchResponse = StructType({
    status: IntegerType,
    statusText: StringType,
    headers: DictType(StringType, StringType),
    body: StringType,
    ok: BooleanType,
});

/**
 * Performs an HTTP GET request and returns the response body as a string.
 *
 * Makes a simple GET request to the specified URL and returns the response body text.
 * This is a convenience function for basic GET requests without custom headers.
 * Throws an error if the response status is not in the 200-299 range.
 *
 * This is a platform function for the East language, enabling HTTP GET requests
 * in East programs running on Node.js.
 *
 * @param url - The URL to fetch (must be a valid HTTP/HTTPS URL)
 * @returns The response body as a string
 *
 * @throws {EastError} When request fails:
 * - Invalid URL
 * - Network error
 * - Non-2xx HTTP status code
 *
 * @example
 * ```ts
 * const fetchData = East.function([], StringType, $ => {
 *     const data = $.let(Fetch.get("https://api.example.com/data"));
 *     return data;
 * });
 * ```
 */
export const fetch_get = East.asyncPlatform("fetch_get", [StringType], StringType);

/**
 * Performs an HTTP GET request and returns the response body as binary data.
 *
 * Makes a simple GET request to the specified URL and returns the response body
 * as raw bytes (Blob/Uint8Array). Useful for downloading binary files like images,
 * PDFs, or database files.
 * Throws an error if the response status is not in the 200-299 range.
 *
 * This is a platform function for the East language, enabling binary HTTP GET requests
 * in East programs running on Node.js.
 *
 * @param url - The URL to fetch (must be a valid HTTP/HTTPS URL)
 * @returns The response body as binary data (Blob)
 *
 * @throws {EastError} When request fails:
 * - Invalid URL
 * - Network error
 * - Non-2xx HTTP status code
 *
 * @example
 * ```ts
 * const downloadFile = East.function([], BlobType, $ => {
 *     const data = $.let(Fetch.getBytes("https://example.com/file.bin"));
 *     return data;
 * });
 * ```
 */
export const fetch_get_bytes = East.asyncPlatform("fetch_get_bytes", [StringType], BlobType);

/**
 * Performs an HTTP POST request with a string body.
 *
 * Makes a POST request to the specified URL with the provided string body.
 * Sets Content-Type header to "text/plain" by default. For more control over
 * headers and methods, use {@link fetch_request}.
 * Throws an error if the response status is not in the 200-299 range.
 *
 * This is a platform function for the East language, enabling HTTP POST requests
 * in East programs running on Node.js.
 *
 * @param url - The URL to post to (must be a valid HTTP/HTTPS URL)
 * @param body - The request body as a string
 * @returns The response body as a string
 *
 * @throws {EastError} When request fails:
 * - Invalid URL
 * - Network error
 * - Non-2xx HTTP status code
 *
 * @example
 * ```ts
 * const postData = East.function([], StringType, $ => {
 *     const response = $.let(Fetch.post("https://api.example.com/submit", "data"));
 *     return response;
 * });
 * ```
 */
export const fetch_post = East.asyncPlatform("fetch_post", [StringType, StringType], StringType);

/**
 * Performs a full HTTP request with custom configuration.
 *
 * Makes an HTTP request with complete control over method, headers, and body.
 * Returns the full response including status, headers, and body. Unlike {@link fetch_get}
 * and {@link fetch_post}, this does not throw on non-2xx status codes - check the `ok`
 * field in the response instead.
 *
 * This is a platform function for the East language, enabling full HTTP requests
 * in East programs running on Node.js.
 *
 * @param config - The request configuration (url, method, headers, optional body)
 * @returns The complete HTTP response with status, headers, and body
 *
 * @throws {EastError} When request fails at the network level (not for HTTP errors)
 *
 * @example
 * ```ts
 * const makeRequest = East.function([], FetchResponse, $ => {
 *     const config = East.value({
 *         url: "https://api.example.com/data",
 *         method: variant("GET", null),
 *         headers: new Map([["Authorization", "Bearer token"]]),
 *         body: variant("none", null),
 *     }, FetchRequestConfig);
 *     return Fetch.request(config);
 * });
 * ```
 */
export const fetch_request = East.asyncPlatform("fetch_request", [FetchRequestConfig], FetchResponse);

/**
 * Node.js implementation of fetch platform functions.
 *
 * Pass this array to {@link East.compileAsync} to enable fetch operations.
 */
const FetchImpl: PlatformFunction[] = [
    fetch_get.implement(async (url: string) => {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new EastError(`HTTP ${response.status}: ${response.statusText}`, {
                    location: [{ filename: "fetch_get", line: 0n, column: 0n }]
                });
            }
            return await response.text();
        } catch (err: any) {
            if (err instanceof EastError) throw err;
            throw new EastError(`Failed to fetch ${url}: ${err.message}`, {
                location: [{ filename: "fetch_get", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    fetch_get_bytes.implement(async (url: string) => {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new EastError(`HTTP ${response.status}: ${response.statusText}`, {
                    location: [{ filename: "fetch_get_bytes", line: 0n, column: 0n }]
                });
            }
            const arrayBuffer = await response.arrayBuffer();
            return new Uint8Array(arrayBuffer);
        } catch (err: any) {
            if (err instanceof EastError) throw err;
            throw new EastError(`Failed to fetch ${url}: ${err.message}`, {
                location: [{ filename: "fetch_get_bytes", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    fetch_post.implement(async (url: string, body: string) => {
        try {
            const response = await fetch(url, {
                method: 'POST',
                body: body,
                headers: {
                    'Content-Type': 'text/plain',
                },
            });
            if (!response.ok) {
                throw new EastError(`HTTP ${response.status}: ${response.statusText}`, {
                    location: [{ filename: "fetch_post", line: 0n, column: 0n }]
                });
            }
            return await response.text();
        } catch (err: any) {
            if (err instanceof EastError) throw err;
            throw new EastError(`Failed to post to ${url}: ${err.message}`, {
                location: [{ filename: "fetch_post", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    fetch_request.implement(async (config: ValueTypeOf<typeof FetchRequestConfig>) => {
        const url = config.url;
        const method = config.method.type.toUpperCase(); // Get the variant tag
        const headers: Record<string, string> = {};

        // Convert Map to plain object
        for (const [key, value] of config.headers) {
            headers[key] = value;
        }

        try {
            const response = await fetch(url, {
                method: method as string,
                headers,
                body: config.body.value,
            });

            const responseHeaders = new SortedMap<string, string>();
            response.headers.forEach((value, key) => {
                responseHeaders.set(key, value);
            });

            const body = await response.text();

            return {
                status: BigInt(response.status),
                statusText: response.statusText,
                headers: responseHeaders,
                body,
                ok: response.ok,
            };
        } catch (err: any) {
            throw new EastError(`Failed to fetch ${url}: ${err.message}`, {
                location: [{ filename: "fetch_request", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
];

/**
 * Grouped fetch platform functions.
 *
 * Provides HTTP client operations using the fetch API.
 *
 * @example
 * ```ts
 * import { East, StringType } from "@elaraai/east";
 * import { Fetch } from "@elaraai/east-node-std";
 *
 * const getData = East.function([], StringType, $ => {
 *     const response = $.let(Fetch.get("https://api.example.com/data"));
 *     return response;
 * });
 *
 * const compiled = await East.compileAsync(getData.toIR(), Fetch.Implementation);
 * await compiled();  // Returns response body as string
 * ```
 */
export const Fetch = {
    /**
     * Performs an HTTP GET request and returns the response body.
     *
     * Makes a simple GET request to the specified URL and returns the response body text.
     * Throws an error if the response status is not in the 200-299 range.
     *
     * @param url - The URL to fetch
     * @returns The response body as a string
     * @throws {EastError} When request fails or status is not 2xx
     *
     * @example
     * ```ts
     * const fetchData = East.function([], StringType, $ => {
     *     return Fetch.get("https://api.example.com/data");
     * });
     *
     * const compiled = await East.compileAsync(fetchData.toIR(), Fetch.Implementation);
     * await compiled();  // Returns: response body as string
     * ```
     */
    get: fetch_get,

    /**
     * Performs an HTTP GET request and returns the response body as binary data.
     *
     * Makes a simple GET request to the specified URL and returns the response body
     * as raw bytes (Blob/Uint8Array). Useful for downloading binary files.
     * Throws an error if the response status is not in the 200-299 range.
     *
     * @param url - The URL to fetch
     * @returns The response body as binary data (Blob)
     * @throws {EastError} When request fails or status is not 2xx
     *
     * @example
     * ```ts
     * const downloadFile = East.function([], BlobType, $ => {
     *     return Fetch.getBytes("https://example.com/file.bin");
     * });
     *
     * const compiled = await East.compileAsync(downloadFile.toIR(), Fetch.Implementation);
     * await compiled();  // Returns: binary data as Uint8Array
     * ```
     */
    getBytes: fetch_get_bytes,

    /**
     * Performs an HTTP POST request with a string body.
     *
     * Makes a POST request to the specified URL with the provided string body.
     * Sets Content-Type to "text/plain" by default.
     * Throws an error if the response status is not in the 200-299 range.
     *
     * @param url - The URL to post to
     * @param body - The request body as a string
     * @returns The response body as a string
     * @throws {EastError} When request fails or status is not 2xx
     *
     * @example
     * ```ts
     * const postData = East.function([], StringType, $ => {
     *     return Fetch.post("https://api.example.com/submit", "data");
     * });
     *
     * const compiled = await East.compileAsync(postData.toIR(), Fetch.Implementation);
     * await compiled();  // Returns: response body as string
     * ```
     */
    post: fetch_post,

    /**
     * Performs a full HTTP request with custom configuration.
     *
     * Makes an HTTP request with complete control over method, headers, and body.
     * Returns the full response including status, headers, and body.
     * Does not throw on non-2xx status - check the `ok` field instead.
     *
     * @param config - The request configuration
     * @returns The complete HTTP response
     * @throws {EastError} When request fails at the network level
     *
     * @example
     * ```ts
     * const makeRequest = East.function([], FetchResponse, $ => {
     *     const config = East.value({
     *         url: "https://api.example.com/data",
     *         method: variant("GET", null),
     *         headers: new Map(),
     *         body: variant("none", null),
     *     }, FetchRequestConfig);
     *     return Fetch.request(config);
     * });
     *
     * const compiled = await East.compileAsync(makeRequest.toIR(), Fetch.Implementation);
     * const response = await compiled();  // Returns: FetchResponse object
     * ```
     */
    request: fetch_request,

    /**
     * Node.js implementation of fetch platform functions.
     *
     * Pass this to {@link East.compileAsync} to enable fetch operations.
     */
    Implementation: FetchImpl,

    /**
     * Type definitions for fetch operations.
     */
    Types: {
        /**
         * HTTP method variant type (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS).
         */
        Method: FetchMethod,

        /**
         * HTTP request configuration structure.
         */
        RequestConfig: FetchRequestConfig,

        /**
         * HTTP response structure.
         */
        Response: FetchResponse,
    },
} as const;

// Export for backwards compatibility
export { FetchImpl };
