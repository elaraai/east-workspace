/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, StringType, variant, example } from "@elaraai/east";
import { Compression } from "@elaraai/east-node-io";

export const gzipCompress = example({
    keywords: ["gzip", "Gzip", "compress", "compression"],
    description: "Compress repetitive data with gzip produces smaller output",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const data = $.let(East.value("Hello, World! ".repeat(100)).encodeUtf8());
        const options = $.let({ level: variant('some', 6n) });
        const compressed = $.let(Compression.Gzip.compress(data, options));
        return compressed.size().less(data.size());
    }),
    inputs: [],
    returns: true,
});

export const gzipDecompress = example({
    keywords: ["gzip", "Gzip", "decompress", "decompression", "roundtrip"],
    description: "Compress and decompress data with gzip roundtrip",
    fn: East.asyncFunction([], StringType, ($) => {
        const data = $.let(East.value("Hello, World!").encodeUtf8());
        const options = $.let({ level: variant('some', 6n) });
        const compressed = $.let(Compression.Gzip.compress(data, options));
        const decompressed = $.let(Compression.Gzip.decompress(compressed));
        return decompressed.decodeUtf8();
    }),
    inputs: [],
    returns: "Hello, World!",
});
