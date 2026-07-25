/*
 * BEAST2 v5 deflate codec bindings — raw DEFLATE (RFC 1951) via miniz.
 *
 * miniz is vendored through CMake FetchContent (see packages/east-c/
 * CMakeLists.txt); its raw streams interoperate with zlib (node:zlib on the
 * TS side, stdlib zlib on the Python side, DecompressionStream in browsers).
 */

#include "internal_v5.h"

#include "miniz.h"

bool b2v5_deflate_raw(const uint8_t *src, size_t src_len, uint8_t **out, size_t *out_len)
{
    if (!out || !out_len) return false;
    *out = NULL;
    *out_len = 0;
    size_t produced = 0;
    /* No TDEFL_WRITE_ZLIB_HEADER → raw DEFLATE. */
    void *buf = tdefl_compress_mem_to_heap(src, src_len, &produced, TDEFL_DEFAULT_MAX_PROBES);
    if (!buf) return false;
    *out = (uint8_t *)buf;
    *out_len = produced;
    return true;
}

bool b2v5_inflate_raw(const uint8_t *src, size_t src_len, uint8_t *dst, size_t dst_len)
{
    /* No TINFL_FLAG_PARSE_ZLIB_HEADER → raw DEFLATE. The frame header
     * declares the exact uncompressed size, so anything else is corruption. */
    size_t produced = tinfl_decompress_mem_to_mem(dst, dst_len, src, src_len, 0);
    return produced != TINFL_DECOMPRESS_MEM_TO_MEM_FAILED && produced == dst_len;
}
