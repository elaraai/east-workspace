#ifndef EAST_SHA256_H
#define EAST_SHA256_H

/*
 * SHA-256 (FIPS 180-4), the name of every object a manifest directory holds.
 *
 * A store names an object by the SHA-256 of its bytes, and a manifest names
 * its segments and its header the same way, so a runtime that writes a
 * manifest directory writes the names the store would give its files. The
 * TypeScript runtime carries the same function (east's `sha256Hex`), east-py
 * binds this one, and east-c-std's crypto platform functions hash through it.
 */

#include <stddef.h>
#include <stdint.h>

#define EAST_SHA256_DIGEST_SIZE 32
/* Lowercase hex digits of a digest, plus the terminating NUL. */
#define EAST_SHA256_HEX_SIZE (EAST_SHA256_DIGEST_SIZE * 2 + 1)

/* A digest in progress, for bytes that arrive in pieces. */
typedef struct {
    uint32_t state[8];
    uint64_t bit_count;
    uint8_t buffer[64];
    size_t buffer_len;
} EastSha256;

void east_sha256_init(EastSha256 *ctx);
void east_sha256_update(EastSha256 *ctx, const uint8_t *data, size_t len);
/* Writes the digest; `ctx` is spent and must be initialised again for reuse. */
void east_sha256_final(EastSha256 *ctx, uint8_t digest[EAST_SHA256_DIGEST_SIZE]);

/* The digest of `len` bytes, in one call. */
void east_sha256(const uint8_t *data, size_t len, uint8_t digest[EAST_SHA256_DIGEST_SIZE]);

/* The digest of `len` bytes as lowercase hex — the name a store gives an
 * object — NUL-terminated in `hex`. */
void east_sha256_hex(const uint8_t *data, size_t len, char hex[EAST_SHA256_HEX_SIZE]);

#endif
