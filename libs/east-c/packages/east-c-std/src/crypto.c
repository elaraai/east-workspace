/*
 * Cryptographic platform functions for East.
 *
 * Provides cryptographic operations for East programs running in C. SHA-256
 * is east-c's own (east/sha256.h), the hash its manifests are named by.
 */

#include "east_std/east_std.h"
#include <east/values.h>
#include <east/eval_result.h>
#include <east/compat.h>
#include <east/sha256.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

/* ========================================================================
 * Utility: system RNG (see east_random_bytes — /dev/urandom on POSIX,
 * BCryptGenRandom on Windows)
 * ======================================================================== */

static int read_urandom(uint8_t *buf, size_t len)
{
    return east_random_bytes(buf, len);
}

/* ========================================================================
 * Platform Functions
 * ======================================================================== */

static EvalResult crypto_random_bytes(EastValue **args, size_t num_args, EastType **input_types,
                                      size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    int64_t length = args[0]->data.integer;

    if (length <= 0) {
        return eval_ok(east_blob(NULL, 0));
    }

    uint8_t *buf = malloc((size_t)length);
    if (!buf) {
        return eval_ok(east_blob(NULL, 0));
    }

    if (read_urandom(buf, (size_t)length) != 0) {
        free(buf);
        return eval_ok(east_blob(NULL, 0));
    }

    EastValue *result = east_blob(buf, (size_t)length);
    free(buf);
    return eval_ok(result);
}

static EvalResult crypto_hash_sha256(EastValue **args, size_t num_args, EastType **input_types,
                                     size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    char hex[EAST_SHA256_HEX_SIZE];
    east_sha256_hex((const uint8_t *)args[0]->data.string.data, args[0]->data.string.len, hex);
    return eval_ok(east_string(hex));
}

static EvalResult crypto_hash_sha256_bytes(EastValue **args, size_t num_args,
                                           EastType **input_types, size_t num_input_types,
                                           EastType *output_type)
{
    (void)num_args;
    uint8_t digest[EAST_SHA256_DIGEST_SIZE];
    east_sha256(args[0]->data.blob.data, args[0]->data.blob.len, digest);
    return eval_ok(east_blob(digest, EAST_SHA256_DIGEST_SIZE));
}

static EvalResult crypto_uuid(EastValue **args, size_t num_args, EastType **input_types,
                              size_t num_input_types, EastType *output_type)
{
    (void)args;
    (void)num_args;

    uint8_t bytes[16];
    if (read_urandom(bytes, 16) != 0) {
        return eval_ok(east_string("00000000-0000-0000-0000-000000000000"));
    }

    /* Set version 4 (bits 12-15 of time_hi_and_version) */
    bytes[6] = (bytes[6] & 0x0F) | 0x40;
    /* Set variant (bits 6-7 of clock_seq_hi_and_reserved) */
    bytes[8] = (bytes[8] & 0x3F) | 0x80;

    /* Format as UUID string: 8-4-4-4-12 */
    char uuid_str[37];
    snprintf(uuid_str, sizeof(uuid_str),
             "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x", bytes[0],
             bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7], bytes[8],
             bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]);

    return eval_ok(east_string(uuid_str));
}

void east_std_register_crypto(PlatformRegistry *reg)
{
    platform_registry_add(reg, "crypto_random_bytes", crypto_random_bytes, false);
    platform_registry_add(reg, "crypto_hash_sha256", crypto_hash_sha256, false);
    platform_registry_add(reg, "crypto_hash_sha256_bytes", crypto_hash_sha256_bytes, false);
    platform_registry_add(reg, "crypto_uuid", crypto_uuid, false);
}
