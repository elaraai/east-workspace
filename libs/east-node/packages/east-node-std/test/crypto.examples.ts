/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, example } from "@elaraai/east";
import { Crypto } from "@elaraai/east-node-std";

export const cryptoRandomBytes = example({
    keywords: ["crypto", "Crypto", "randomBytes", "random", "bytes"],
    description: "Generate random bytes of a specific length",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const bytes = $.let(Crypto.randomBytes(16n));
        return bytes.size();
    }),
    inputs: [],
    returns: 16n,
});

export const cryptoHashSha256 = example({
    keywords: ["crypto", "Crypto", "hashSha256", "hash", "SHA-256"],
    description: "Hash a string with SHA-256 producing a 64-character hex string",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const hash = $.let(Crypto.hashSha256("test data"));
        return hash.length();
    }),
    inputs: [],
    returns: 64n,
});

export const cryptoHashSha256Bytes = example({
    keywords: ["crypto", "Crypto", "hashSha256Bytes", "hash", "SHA-256", "binary"],
    description: "Hash binary data with SHA-256 producing 32 bytes",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const data = $.let(new Uint8Array([1, 2, 3]));
        const hash = $.let(Crypto.hashSha256Bytes(data));
        return hash.size();
    }),
    inputs: [],
    returns: 32n,
});

export const cryptoUuid = example({
    keywords: ["crypto", "Crypto", "uuid", "unique", "identifier"],
    description: "Generate a UUID string with 36 characters",
    fn: East.asyncFunction([], IntegerType, ($) => {
        const uuid = $.let(Crypto.uuid());
        return uuid.length();
    }),
    inputs: [],
    returns: 36n,
});
