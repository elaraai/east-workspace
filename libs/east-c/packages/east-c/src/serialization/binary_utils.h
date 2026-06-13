#ifndef EAST_BINARY_UTILS_H
#define EAST_BINARY_UTILS_H

#include "east/serialization.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

void write_varint(ByteBuffer *buf, uint64_t val);
void write_zigzag(ByteBuffer *buf, int64_t val);

/* Bounds-checked reads: decode at most up to `len`. On success, store the
 * decoded value in *out, advance *offset, and return true. On truncation
 * (buffer ends mid-varint) store 0, clamp *offset to len, and return false
 * so every subsequent read also fails. Input bytes are untrusted. */
bool read_varint_checked(const uint8_t *data, size_t len, size_t *offset, uint64_t *out);
bool read_zigzag_checked(const uint8_t *data, size_t len, size_t *offset, int64_t *out);

#endif
