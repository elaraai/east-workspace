#ifndef EAST_EMIT_WRITER_H
#define EAST_EMIT_WRITER_H

/*
 * The output side shared by the emit sink (emit_sink.c) and the blob merge
 * (merge.c): the library's canonical element writer on a file, deflating
 * frames on the writer's pool (#763). Entries go out one at a time and
 * segments fall wherever the content-defined cut rule places them, so the
 * file is byte-identical to the paged encode of the same value, on every
 * runtime (#770). Memory is one open segment whatever the output's size.
 *
 * The latest entry is held back until the next one arrives or the output
 * finishes, so an equal key's fold lands in it in place: the sink and the
 * merge replace `value`, which the writer owns, with the folded one.
 *
 * The output may instead be a manifest directory — the same segments, each a
 * file of its own named by its SHA-256, and a manifest naming them.
 *
 * Internal to the library; the public surfaces are east/emit_sink.h and
 * east/merge.h.
 */

#include <east/serialization.h>

#include <stdbool.h>
#include <stdio.h>

typedef struct {
    FILE *out;
    Beast2ElementWriter *writer;
    Beast2ManifestWriter *manifest; /* a manifest directory's writer, in place of both above */
    EastType *type;                 /* borrowed: the output collection type */
    EastValue *key;   /* owned: the held entry's element or Dict key; NULL when none */
    EastValue *value; /* owned: the held Dict entry's value */
} EmitWriter;

/* Opens `path` for writing and a writer of `type` on it. False with the
 * message posted (east_builtin_error); the struct is then closed. */
bool emit_writer_open(EmitWriter *w, EastType *type, const char *path);

/* Opens a manifest directory as the output: the manifest at `path`, its
 * objects in `<path>.segments/`. False with the message posted; the struct is
 * then closed. */
bool emit_writer_open_manifest(EmitWriter *w, EastType *type, const char *path);

/* Writes out the held entry and holds `key` (and, for a Dict, `value`) in its
 * place, retaining them. False with the message posted. */
bool emit_writer_push(EmitWriter *w, EastValue *key, EastValue *value);

/* The held entry, then the terminator and index, the last bytes to the file,
 * and the close. False with the message posted; the file is then
 * unfinalised. */
bool emit_writer_finish(EmitWriter *w);

/* Releases whatever is still open, finished or not. Safe on a zeroed struct
 * and after emit_writer_finish. */
void emit_writer_close(EmitWriter *w);

#endif
