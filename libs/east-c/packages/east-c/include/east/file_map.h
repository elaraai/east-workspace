#ifndef EAST_FILE_MAP_H
#define EAST_FILE_MAP_H

/*
 * Read-only whole-file mappings.
 *
 * A mapped file is read through the page cache: its residency is the kernel's
 * decision, not the heap's, so a reader that walks it a segment at a time
 * holds one decoded segment, however large the file. Used for lazily opened
 * task inputs (the release hook of a paged value) and for the blob merge's
 * inputs and key range. POSIX maps with mmap; Windows with a file mapping
 * view.
 */

#include <stddef.h>
#include <stdint.h>

/* Maps the whole file at `path` read-only. NULL, quietly, when the file
 * cannot be mapped (missing, empty, a directory, a file system without
 * mapping support) — a caller with an eager path takes it, and reports
 * failures exactly as it always did. *ctx_out receives what
 * input_release_mapping needs to release the mapping (the Windows handles;
 * NULL on POSIX). */
uint8_t *map_input_file(const char *path, size_t *len_out, void **ctx_out);

/* Releases a mapping made by map_input_file. The signature is a paged value's
 * host release hook (east_beast2_open_paged_external), so the mapping can be
 * handed to the value that reads it. */
void input_release_mapping(void *ctx, uint8_t *data, size_t len);

#endif
