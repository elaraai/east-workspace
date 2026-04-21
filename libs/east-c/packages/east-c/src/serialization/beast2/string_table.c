/*
 * BEAST2 v2 String Table
 *
 * Encode side: open-addressing hash map from string content → index
 * with deduplication.  Decode side: simple array of (string, length).
 */

#include "internal.h"

/* ================================================================== */
/*  Beast2 v2 String Table                                             */
/* ================================================================== */

void string_table_enc_init(Beast2StringTableEnc *t)
{
    t->mask = 255;
    t->count = 0;
    t->slots = calloc(256, sizeof(Beast2StrEncSlot));
    t->ordered_count = 0;
    t->ordered_cap = 64;
    t->strings = malloc(64 * sizeof(char *));
    t->lens = malloc(64 * sizeof(size_t));
}

void string_table_enc_free(Beast2StringTableEnc *t)
{
    free(t->slots);
    for (size_t i = 0; i < t->ordered_count; i++)
        free(t->strings[i]);
    free(t->strings);
    free(t->lens);
}

static uint32_t hash_string_bytes(const char *str, size_t len)
{
    uint32_t h = 0x811c9dc5;
    for (size_t i = 0; i < len; i++) {
        h ^= (uint8_t)str[i];
        h *= 0x01000193;
    }
    return h ? h : 1; /* 0 reserved for empty slot */
}

static void string_table_enc_grow(Beast2StringTableEnc *t)
{
    int old_cap = t->mask + 1;
    int new_cap = old_cap * 2;
    int new_mask = new_cap - 1;
    Beast2StrEncSlot *new_slots = calloc(new_cap, sizeof(Beast2StrEncSlot));
    for (int i = 0; i < old_cap; i++) {
        if (t->slots[i].hash != 0) {
            uint32_t h = t->slots[i].hash & (uint32_t)new_mask;
            while (new_slots[h].hash != 0)
                h = (h + 1) & (uint32_t)new_mask;
            new_slots[h] = t->slots[i];
        }
    }
    free(t->slots);
    t->slots = new_slots;
    t->mask = new_mask;
}

/* Add a string, returns its index. Deduplicates by content. */
size_t string_table_enc_add(Beast2StringTableEnc *t, const char *str, size_t len)
{
    uint32_t hash = hash_string_bytes(str, len);
    uint32_t h = hash & (uint32_t)t->mask;
    for (;;) {
        if (t->slots[h].hash == 0) break; /* not found */
        if (t->slots[h].hash == hash) {
            size_t idx = t->slots[h].idx;
            if (t->lens[idx] == len && memcmp(t->strings[idx], str, len) == 0)
                return idx; /* already in table */
        }
        h = (h + 1) & (uint32_t)t->mask;
    }
    /* Add new entry */
    if (t->count * 10 >= (t->mask + 1) * 7) {
        string_table_enc_grow(t);
        /* Re-find empty slot after grow */
        h = hash & (uint32_t)t->mask;
        while (t->slots[h].hash != 0)
            h = (h + 1) & (uint32_t)t->mask;
    }
    size_t idx = t->ordered_count;
    if (idx >= t->ordered_cap) {
        t->ordered_cap *= 2;
        t->strings = realloc(t->strings, t->ordered_cap * sizeof(char *));
        t->lens = realloc(t->lens, t->ordered_cap * sizeof(size_t));
    }
    t->strings[idx] = malloc(len + 1);
    memcpy(t->strings[idx], str, len);
    t->strings[idx][len] = '\0';
    t->lens[idx] = len;
    t->ordered_count++;
    t->slots[h].hash = hash;
    t->slots[h].idx = idx;
    t->count++;
    return idx;
}

/* Write string table section: [varint header_len] [varint count] [entries...] */
void write_string_table_section(Beast2StringTableEnc *t, ByteBuffer *buf)
{
    ByteBuffer *hdr = byte_buffer_new(256);
    write_varint(hdr, t->ordered_count);
    for (size_t i = 0; i < t->ordered_count; i++) {
        write_varint(hdr, t->lens[i]);
        byte_buffer_write_bytes(hdr, (const uint8_t *)t->strings[i], t->lens[i]);
    }
    write_varint(buf, hdr->len);
    byte_buffer_write_bytes(buf, hdr->data, hdr->len);
    byte_buffer_free(hdr);
}

/* Read string table section from data. Caller must call string_table_dec_free. */
Beast2StringTableDec read_string_table_section(const uint8_t *data, size_t len, size_t *offset)
{
    Beast2StringTableDec t = {NULL, NULL, 0};
    uint64_t header_byte_length = read_varint(data, offset);
    size_t header_end = *offset + (size_t)header_byte_length;
    uint64_t count = read_varint(data, offset);
    if (count > 0) {
        t.strings = malloc((size_t)count * sizeof(char *));
        t.lens = malloc((size_t)count * sizeof(size_t));
        t.count = (size_t)count;
        for (size_t i = 0; i < t.count; i++) {
            size_t slen;
            t.strings[i] = b2_read_string_varint(data, len, offset, &slen);
            t.lens[i] = slen;
        }
    }
    *offset = header_end; /* skip to end of section */
    return t;
}

void string_table_dec_free(Beast2StringTableDec *t)
{
    for (size_t i = 0; i < t->count; i++)
        free(t->strings[i]);
    free(t->strings);
    free(t->lens);
}
