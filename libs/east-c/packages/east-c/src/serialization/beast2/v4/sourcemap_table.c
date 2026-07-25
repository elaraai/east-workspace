/*
 * BEAST2 v4 Source Map Section.
 *
 * Wire format:
 *   varint(section_byte_length)
 *   varint(stack_count)          -- excludes entry 0 (the empty sentinel)
 *   repeated stack_count times:
 *     varint(frame_count)
 *     repeated frame_count times:
 *       varint(filename_string_idx)
 *       varint(line)
 *       varint(column)
 *
 * Filenames reference the string table for dedup.
 * Entry 0 (empty stack sentinel) is implicit — not written.
 */

#include "../internal.h"

/* ================================================================== */
/*  Write source map section                                           */
/* ================================================================== */

void write_source_map_section(EastSourceMap *sm, Beast2StringTableEnc *st, ByteBuffer *buf)
{
    ByteBuffer *hdr = byte_buffer_new(256);

    if (!sm || sm->num_stacks <= 1) {
        /* Empty or only sentinel — write stack_count = 0 */
        write_varint(hdr, 0);
    } else {
        /* Skip entry 0 (empty sentinel) */
        write_varint(hdr, sm->num_stacks - 1);
        for (size_t i = 1; i < sm->num_stacks; i++) {
            size_t count = sm->stack_counts[i];
            write_varint(hdr, count);
            for (size_t j = 0; j < count; j++) {
                EastLocation *loc = &sm->stacks[i][j];
                const char *fn = loc->filename ? loc->filename : "";
                size_t fn_len = strlen(fn);
                size_t str_idx = string_table_enc_add(st, fn, fn_len);
                write_varint(hdr, str_idx);
                write_varint(hdr, (uint64_t)loc->line);
                write_varint(hdr, (uint64_t)loc->column);
            }
        }
    }

    write_varint(buf, hdr->len);
    byte_buffer_write_bytes(buf, hdr->data, hdr->len);
    byte_buffer_free(hdr);
}

/* ================================================================== */
/*  Read source map section                                            */
/* ================================================================== */

EastSourceMap read_source_map_section(const uint8_t *data, size_t len, size_t *offset,
                                      Beast2StringTableDec *st)
{
    /* Input bytes are untrusted: all reads are bounds-checked, and declared
     * stack/frame counts are bounded by the bytes remaining in the section
     * so they cannot drive oversized allocations. On malformed input,
     * returns an empty map and clamps *offset to len. */
    EastSourceMap sm = {0};

    uint64_t section_byte_length;
    if (!read_varint_checked(data, len, offset, &section_byte_length)) goto fail;
    if (section_byte_length > len - *offset) goto fail;
    size_t section_end = *offset + (size_t)section_byte_length;
    uint64_t stack_count;
    if (!read_varint_checked(data, section_end, offset, &stack_count)) goto fail;

    /* Each stack needs at least its 1-byte frame-count varint */
    if (stack_count > section_end - *offset) goto fail;

    /* Total entries = stack_count + 1 (for the implicit empty sentinel at 0) */
    sm.num_stacks = (size_t)stack_count + 1;
    sm.stacks = calloc(sm.num_stacks, sizeof(EastLocation *));
    sm.stack_counts = calloc(sm.num_stacks, sizeof(size_t));
    if (!sm.stacks || !sm.stack_counts) goto fail;
    /* Entry 0 is the empty sentinel: stacks[0] = NULL, stack_counts[0] = 0 */

    for (uint64_t i = 0; i < stack_count; i++) {
        uint64_t frame_count;
        if (!read_varint_checked(data, section_end, offset, &frame_count)) goto fail;
        size_t idx = (size_t)i + 1;
        /* Each frame needs >= 3 bytes (three varints) */
        if (frame_count > (section_end - *offset) / 3) goto fail;
        sm.stack_counts[idx] = (size_t)frame_count;
        if (frame_count > 0) {
            sm.stacks[idx] = calloc((size_t)frame_count, sizeof(EastLocation));
            if (!sm.stacks[idx]) goto fail;
            for (uint64_t j = 0; j < frame_count; j++) {
                uint64_t fn_idx, line, col;
                if (!read_varint_checked(data, section_end, offset, &fn_idx)) goto fail;
                if (!read_varint_checked(data, section_end, offset, &line)) goto fail;
                if (!read_varint_checked(data, section_end, offset, &col)) goto fail;
                if (st && fn_idx < st->count && st->strings[fn_idx]) {
                    sm.stacks[idx][j].filename = strdup(st->strings[fn_idx]);
                }
                sm.stacks[idx][j].line = (int64_t)line;
                sm.stacks[idx][j].column = (int64_t)col;
            }
        }
    }

    *offset = section_end;
    return sm;

fail:
    beast2_source_map_free(&sm);
    *offset = len;
    return (EastSourceMap){0};
}

/* ================================================================== */
/*  Free source map                                                    */
/* ================================================================== */

void beast2_source_map_free(EastSourceMap *sm)
{
    if (!sm) return;
    for (size_t i = 0; sm->stacks && sm->stack_counts && i < sm->num_stacks; i++) {
        if (sm->stacks[i]) {
            for (size_t j = 0; j < sm->stack_counts[i]; j++) {
                free(sm->stacks[i][j].filename);
            }
            free(sm->stacks[i]);
        }
    }
    free(sm->stacks);
    free(sm->stack_counts);
    sm->stacks = NULL;
    sm->stack_counts = NULL;
    sm->num_stacks = 0;
}
