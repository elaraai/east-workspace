/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, StringType, IntegerType, BlobType, sha256Hex } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";

/** The most bytes `crypto.getRandomValues` fills in one call. */
const GET_RANDOM_VALUES_MAX = 65536;

/** The most bytes one call may ask for: east-node-std's `randomBytes` gives
 *  no more than 2^31 - 1. */
const RANDOM_BYTES_MAX = 2147483647n;

/** Encodes a string as UTF-8, as east-node-std hashes it. */
const utf8 = new TextEncoder();

/**
 * The bytes of a SHA-256 digest, from the 64 lowercase hex digits
 * {@link sha256Hex} gives for it.
 */
function digestBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
    }
    return bytes;
}

/**
 * Generates cryptographically secure random bytes.
 *
 * Produces random bytes using a cryptographically secure pseudo-random number generator (CSPRNG).
 * Suitable for generating encryption keys, initialization vectors, tokens, and other security-sensitive
 * random data.
 *
 * This is a platform function for the East language, enabling secure random generation
 * in East programs running in a browser, from the web-standard `crypto.getRandomValues`.
 *
 * @param length - The number of random bytes to generate (from 0 to 2^31 - 1)
 * @returns Random bytes as a Blob (Uint8Array)
 *
 * @throws {EastError} When random generation fails:
 * - Negative length, or more than 2^31 - 1 bytes
 * - The host's entropy source is unavailable
 *
 * @example
 * ```ts
 * const generateToken = East.function([], BlobType, $ => {
 *     return Crypto.randomBytes(32n);  // 256-bit token
 * });
 * ```
 */
export const crypto_random_bytes = East.platform("crypto_random_bytes", [IntegerType], BlobType);

/**
 * Computes SHA-256 hash of a string.
 *
 * Calculates the SHA-256 cryptographic hash of a UTF-8 encoded string and returns
 * the result as a lowercase hexadecimal string (64 characters). SHA-256 is a one-way
 * hash function commonly used for data integrity verification.
 *
 * This is a platform function for the East language, enabling cryptographic hashing
 * in East programs running in a browser.
 *
 * @param data - The string to hash (will be UTF-8 encoded)
 * @returns The SHA-256 hash as a lowercase hexadecimal string (64 characters)
 *
 * @example
 * ```ts
 * const hashPassword = East.function([StringType], StringType, ($, password) => {
 *     return Crypto.hashSha256(password);
 *     // Returns: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
 * });
 * ```
 *
 * @remarks
 * The hash is East's own SHA-256 (`sha256Hex`), not the browser's
 * `crypto.subtle.digest`: this platform function is synchronous, as it is on
 * every runtime, and `crypto.subtle` answers only asynchronously.
 */
export const crypto_hash_sha256 = East.platform("crypto_hash_sha256", [StringType], StringType);

/**
 * Computes SHA-256 hash of binary data.
 *
 * Calculates the SHA-256 cryptographic hash of binary data and returns the result
 * as raw bytes (32 bytes / 256 bits). This is the binary variant of {@link crypto_hash_sha256},
 * useful when working with binary protocols or when you need the raw hash bytes.
 *
 * This is a platform function for the East language, enabling cryptographic hashing
 * in East programs running in a browser.
 *
 * @param data - The binary data to hash (Blob/Uint8Array)
 * @returns The SHA-256 hash as binary data (32 bytes)
 *
 * @example
 * ```ts
 * const hashFile = East.function([BlobType], BlobType, ($, fileData) => {
 *     return Crypto.hashSha256Bytes(fileData);
 *     // Returns: 32 bytes of hash data
 * });
 * ```
 *
 * @remarks
 * Synchronous, like {@link crypto_hash_sha256}, for the same reason.
 */
export const crypto_hash_sha256_bytes = East.platform("crypto_hash_sha256_bytes", [BlobType], BlobType);

/**
 * Generates a random UUID v4.
 *
 * Creates a version 4 UUID (Universally Unique Identifier) using cryptographically
 * secure random numbers. UUIDs are 128-bit identifiers formatted as 36-character
 * strings (e.g., "550e8400-e29b-41d4-a716-446655440000").
 *
 * This is a platform function for the East language, enabling UUID generation
 * in East programs running in a browser, from the web-standard `crypto.randomUUID`.
 *
 * @returns A UUID v4 string in standard format (8-4-4-4-12 hex digits)
 *
 * @example
 * ```ts
 * const createRecord = East.function([], StringType, $ => {
 *     const id = $.let(Crypto.uuid());
 *     return id;
 *     // Returns: "550e8400-e29b-41d4-a716-446655440000"
 * });
 * ```
 *
 * @remarks
 * A browser gives `crypto.randomUUID` only to a secure context (a page served
 * over HTTPS, or from localhost); elsewhere the call fails with an `EastError`.
 */
export const crypto_uuid = East.platform("crypto_uuid", [], StringType);

/**
 * Browser implementation of cryptographic platform functions.
 *
 * Pass this array to {@link East.compile} to enable crypto operations.
 */
const CryptoImpl: PlatformFunction[] = [
    crypto_random_bytes.implement((length: bigint) => {
        try {
            if (length < 0n || length > RANDOM_BYTES_MAX) {
                throw new RangeError(`the length must be from 0 to ${RANDOM_BYTES_MAX}, got ${length}`);
            }
            const bytes = new Uint8Array(Number(length));
            for (let offset = 0; offset < bytes.length; offset += GET_RANDOM_VALUES_MAX) {
                globalThis.crypto.getRandomValues(bytes.subarray(offset, offset + GET_RANDOM_VALUES_MAX));
            }
            return bytes;
        } catch (err: any) {
            throw new EastError(`Failed to generate random bytes: ${err.message}`, {
                location: [{ filename: "crypto_random_bytes", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    crypto_hash_sha256.implement((data: string) => {
        try {
            return sha256Hex(utf8.encode(data));
        } catch (err: any) {
            throw new EastError(`Failed to compute SHA-256 hash: ${err.message}`, {
                location: [{ filename: "crypto_hash_sha256", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    crypto_hash_sha256_bytes.implement((data: Uint8Array) => {
        try {
            return digestBytes(sha256Hex(data));
        } catch (err: any) {
            throw new EastError(`Failed to compute SHA-256 hash: ${err.message}`, {
                location: [{ filename: "crypto_hash_sha256_bytes", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
    crypto_uuid.implement(() => {
        try {
            return globalThis.crypto.randomUUID();
        } catch (err: any) {
            throw new EastError(`Failed to generate UUID: ${err.message}`, {
                location: [{ filename: "crypto_uuid", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),
];

/**
 * Grouped cryptographic platform functions.
 *
 * Provides cryptographic operations for East programs.
 *
 * @example
 * ```ts
 * import { East, StringType } from "@elaraai/east";
 * import { Crypto } from "@elaraai/east-web-std";
 *
 * const generateId = East.function([], StringType, $ => {
 *     return Crypto.uuid();
 * });
 *
 * const compiled = East.compile(generateId, Crypto.Implementation);
 * compiled();  // "550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export const Crypto = {
    /**
     * Generates cryptographically secure random bytes.
     *
     * Produces random bytes using a CSPRNG, suitable for generating encryption keys,
     * tokens, and other security-sensitive random data.
     *
     * @param length - The number of random bytes to generate (from 0 to 2^31 - 1)
     * @returns Random bytes as a Blob (Uint8Array)
     * @throws {EastError} When random generation fails
     *
     * @example
     * ```ts
     * const generateToken = East.function([], BlobType, $ => {
     *     return Crypto.randomBytes(32n);
     * });
     *
     * const compiled = East.compile(generateToken, Crypto.Implementation);
     * compiled();  // Uint8Array(32) [...]
     * ```
     */
    randomBytes: crypto_random_bytes,

    /**
     * Computes SHA-256 hash of a string.
     *
     * Calculates the SHA-256 cryptographic hash of a UTF-8 encoded string and returns
     * the result as a lowercase hexadecimal string (64 characters).
     *
     * @param data - The string to hash (will be UTF-8 encoded)
     * @returns The SHA-256 hash as a lowercase hexadecimal string (64 characters)
     *
     * @example
     * ```ts
     * const hashPassword = East.function([StringType], StringType, ($, password) => {
     *     return Crypto.hashSha256(password);
     * });
     *
     * const compiled = East.compile(hashPassword, Crypto.Implementation);
     * compiled("password");  // "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
     * ```
     */
    hashSha256: crypto_hash_sha256,

    /**
     * Computes SHA-256 hash of binary data.
     *
     * Calculates the SHA-256 cryptographic hash of binary data and returns the result
     * as raw bytes (32 bytes).
     *
     * @param data - The binary data to hash (Blob/Uint8Array)
     * @returns The SHA-256 hash as binary data (32 bytes)
     *
     * @example
     * ```ts
     * const hashFile = East.function([BlobType], BlobType, ($, fileData) => {
     *     return Crypto.hashSha256Bytes(fileData);
     * });
     *
     * const compiled = East.compile(hashFile, Crypto.Implementation);
     * const fileData = new Uint8Array([1, 2, 3]);
     * compiled(fileData);  // Uint8Array(32) [...]
     * ```
     */
    hashSha256Bytes: crypto_hash_sha256_bytes,

    /**
     * Generates a random UUID v4.
     *
     * Creates a version 4 UUID using cryptographically secure random numbers.
     * Returns a 36-character string in standard format.
     *
     * @returns A UUID v4 string in standard format (8-4-4-4-12 hex digits)
     *
     * @example
     * ```ts
     * const createRecord = East.function([], StringType, $ => {
     *     return Crypto.uuid();
     * });
     *
     * const compiled = East.compile(createRecord, Crypto.Implementation);
     * compiled();  // "550e8400-e29b-41d4-a716-446655440000"
     * ```
     */
    uuid: crypto_uuid,

    /**
     * Browser implementation of cryptographic platform functions.
     *
     * Pass this to {@link East.compile} to enable crypto operations.
     */
    Implementation: CryptoImpl,
} as const;

// Exported beside `Crypto.Implementation`, as east-node-std exports it
export { CryptoImpl };
