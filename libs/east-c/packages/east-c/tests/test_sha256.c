/*
 * SHA-256, the name of every object a manifest directory holds: the FIPS 180-4
 * vectors, pinned in TypeScript's `east/src/serialization/beast2/v5/sha256.spec.ts`
 * as well, and a digest fed in pieces equal to one fed whole at every length
 * across the padding boundaries.
 */

#include <east/sha256.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

#define CHECK(cond, ...)                                                                           \
    do {                                                                                           \
        if (!(cond)) {                                                                             \
            fprintf(stderr, "FAIL %s:%d: ", __FILE__, __LINE__);                                   \
            fprintf(stderr, __VA_ARGS__);                                                          \
            fprintf(stderr, "\n");                                                                 \
            failures++;                                                                            \
        }                                                                                          \
    } while (0)

static void check_hex(const char *input, const char *expected)
{
    char hex[EAST_SHA256_HEX_SIZE];
    east_sha256_hex((const uint8_t *)input, strlen(input), hex);
    CHECK(strcmp(hex, expected) == 0, "sha256(\"%s\") = %s, expected %s", input, hex, expected);
}

static void test_vectors(void)
{
    check_hex("", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    check_hex("abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    check_hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
              "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");

    size_t n = 1000000;
    uint8_t *a = malloc(n);
    memset(a, 'a', n);
    char hex[EAST_SHA256_HEX_SIZE];
    east_sha256_hex(a, n, hex);
    CHECK(strcmp(hex, "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0") == 0,
          "sha256 of a million 'a's = %s", hex);
    free(a);
}

/* The digest of a piecewise update equals the one-shot digest, for every
 * length through 300 fed in pieces of 1, 24, 47 and 70 bytes — so the
 * whole-block fast path and the buffer agree wherever the input splits. */
static void test_pieces(void)
{
    uint8_t data[300];
    uint32_t seed = 0x9e3779b9u;
    for (size_t i = 0; i < sizeof(data); i++) {
        seed = seed * 1664525u + 1013904223u;
        data[i] = (uint8_t)(seed >> 24);
    }
    for (size_t len = 0; len <= sizeof(data); len++) {
        uint8_t whole[EAST_SHA256_DIGEST_SIZE];
        east_sha256(data, len, whole);
        for (size_t piece = 1; piece <= 70; piece += 23) {
            EastSha256 ctx;
            east_sha256_init(&ctx);
            for (size_t at = 0; at < len; at += piece)
                east_sha256_update(&ctx, data + at, len - at < piece ? len - at : piece);
            uint8_t pieces[EAST_SHA256_DIGEST_SIZE];
            east_sha256_final(&ctx, pieces);
            CHECK(memcmp(whole, pieces, sizeof(whole)) == 0,
                  "length %zu fed in pieces of %zu differs from the one-shot digest", len, piece);
        }
    }
}

int main(void)
{
    test_vectors();
    test_pieces();
    if (failures > 0) {
        fprintf(stderr, "%d check(s) failed\n", failures);
        return 1;
    }
    printf("sha256: all checks passed\n");
    return 0;
}
