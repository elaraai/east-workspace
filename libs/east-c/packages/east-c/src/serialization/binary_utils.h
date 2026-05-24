#ifndef EAST_BINARY_UTILS_H
#define EAST_BINARY_UTILS_H

#include "east/serialization.h"
#include <stddef.h>
#include <stdint.h>

void write_varint(ByteBuffer *buf, uint64_t val);
uint64_t read_varint(const uint8_t *data, size_t *offset);
void write_zigzag(ByteBuffer *buf, int64_t val);
int64_t read_zigzag(const uint8_t *data, size_t *offset);

#endif
