/*
 * Snapshot writer/reader for east-c-cli.
 * See docs/snapshot-format.md for the cross-runtime contract.
 */
#include "snapshot.h"

#include <dirent.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include <east/serialization.h>
#include <east/types.h>
#include <east/values.h>

#include <microtar.h>

/* Manifest schema version — bump on breaking format changes */
#define SNAPSHOT_FORMAT_VERSION 1

/* ------------------------------------------------------------------ */
/*  Manifest type (matches docs/snapshot-format.md)                    */
/* ------------------------------------------------------------------ */

static EastType *s_manifest_type = NULL;

static EastType *manifest_type(void)
{
    if (s_manifest_type) return s_manifest_type;

    const char *runtime_names[] = {"impl", "cli"};
    EastType *runtime_types[] = {&east_string_type, &east_string_type};
    EastType *runtime_t = east_struct_type(runtime_names, runtime_types, 2);

    EastType *str_array = east_array_type(&east_string_type);

    const char *names[] = {"version", "created_at", "runtime", "ir", "inputs", "packages"};
    EastType *types[] = {&east_integer_type, &east_datetime_type, runtime_t,
                         &east_string_type,  str_array,           str_array};
    s_manifest_type = east_struct_type(names, types, 6);
    return s_manifest_type;
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

static const char *basename_of(const char *path)
{
    const char *slash = strrchr(path, '/');
    return slash ? slash + 1 : path;
}

static const char *ext_of(const char *path)
{
    const char *dot = strrchr(basename_of(path), '.');
    return dot ? dot + 1 : "";
}

static char *read_whole_file(const char *path, size_t *out_len)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
    long n = ftell(f);
    if (n < 0) { fclose(f); return NULL; }
    rewind(f);
    char *buf = malloc((size_t)n + 1);
    if (!buf) { fclose(f); return NULL; }
    size_t got = fread(buf, 1, (size_t)n, f);
    fclose(f);
    buf[got] = '\0';
    if (out_len) *out_len = got;
    return buf;
}

static int write_whole_file(const char *path, const void *data, size_t len)
{
    FILE *f = fopen(path, "wb");
    if (!f) return -1;
    size_t wrote = fwrite(data, 1, len, f);
    int rc = (wrote == len) ? 0 : -1;
    if (fclose(f) != 0) rc = -1;
    return rc;
}

/* Recursively remove a directory containing only regular files (no subdirs).
 * Snapshot temp dirs are flat, so this is sufficient. */
static void rmdir_flat(const char *dir)
{
    DIR *d = opendir(dir);
    if (!d) return;
    struct dirent *ent;
    while ((ent = readdir(d)) != NULL) {
        if (strcmp(ent->d_name, ".") == 0 || strcmp(ent->d_name, "..") == 0) continue;
        char path[4096];
        snprintf(path, sizeof(path), "%s/%s", dir, ent->d_name);
        unlink(path);
    }
    closedir(d);
    rmdir(dir);
}

/* ------------------------------------------------------------------ */
/*  Manifest construction / extraction                                 */
/* ------------------------------------------------------------------ */

static EastValue *build_manifest(const char *ir_archive_name,
                                 const char **input_archive_names, size_t num_inputs,
                                 const char **packages, size_t num_packages,
                                 const char *cli_version_str)
{
    /* runtime substruct */
    EastValue *impl_v = east_string("east-c");
    EastValue *cli_v = east_string(cli_version_str);
    const char *runtime_fields[] = {"impl", "cli"};
    EastValue *runtime_vals[] = {impl_v, cli_v};
    const char *runtime_names[] = {"impl", "cli"};
    EastType *runtime_types[] = {&east_string_type, &east_string_type};
    EastType *runtime_t = east_struct_type(runtime_names, runtime_types, 2);
    EastValue *runtime_v = east_struct_new(runtime_fields, runtime_vals, 2, runtime_t);
    east_value_release(impl_v);
    east_value_release(cli_v);

    /* inputs array */
    EastValue *inputs_v = east_array_new(&east_string_type);
    for (size_t i = 0; i < num_inputs; i++) {
        EastValue *s = east_string(input_archive_names[i]);
        east_array_push(inputs_v, s);
        east_value_release(s);
    }

    /* packages array */
    EastValue *packages_v = east_array_new(&east_string_type);
    for (size_t i = 0; i < num_packages; i++) {
        EastValue *s = east_string(packages[i]);
        east_array_push(packages_v, s);
        east_value_release(s);
    }

    EastValue *version_v = east_integer(SNAPSHOT_FORMAT_VERSION);

    /* created_at = now, in milliseconds */
    EastValue *created_at_v = east_datetime((int64_t)time(NULL) * 1000);

    EastValue *ir_v = east_string(ir_archive_name);

    const char *fields[] = {"version", "created_at", "runtime", "ir", "inputs", "packages"};
    EastValue *vals[] = {version_v, created_at_v, runtime_v, ir_v, inputs_v, packages_v};
    EastValue *manifest = east_struct_new(fields, vals, 6, manifest_type());

    east_value_release(version_v);
    east_value_release(created_at_v);
    east_value_release(runtime_v);
    east_value_release(ir_v);
    east_value_release(inputs_v);
    east_value_release(packages_v);

    return manifest;
}

/* ------------------------------------------------------------------ */
/*  Writer                                                             */
/* ------------------------------------------------------------------ */

static int tar_write_file_from_bytes(mtar_t *tar, const char *name, const void *data, size_t len)
{
    if (len > UINT_MAX) {
        fprintf(stderr, "Error: snapshot entry '%s' is too large (>4GB)\n", name);
        return -1;
    }
    if (mtar_write_file_header(tar, name, (unsigned)len) != MTAR_ESUCCESS) return -1;
    if (len > 0 && mtar_write_data(tar, data, (unsigned)len) != MTAR_ESUCCESS) return -1;
    return 0;
}

static int tar_write_file_from_path(mtar_t *tar, const char *name, const char *path)
{
    size_t len = 0;
    char *data = read_whole_file(path, &len);
    if (!data) {
        fprintf(stderr, "Error: cannot read snapshot source '%s': %s\n", path, strerror(errno));
        return -1;
    }
    int rc = tar_write_file_from_bytes(tar, name, data, len);
    free(data);
    return rc;
}

int snapshot_write(const char *out_path,
                   const char *ir_path,
                   const char **input_paths, size_t num_inputs,
                   const char **packages, size_t num_packages,
                   const char *cli_version_str)
{
    /* Derive archive names for IR + inputs, preserving the original extension. */
    char ir_archive_name[64];
    snprintf(ir_archive_name, sizeof(ir_archive_name), "ir.%s", ext_of(ir_path));

    char **input_archive_names = NULL;
    if (num_inputs > 0) {
        input_archive_names = calloc(num_inputs, sizeof(char *));
        for (size_t i = 0; i < num_inputs; i++) {
            char buf[64];
            snprintf(buf, sizeof(buf), "input-%zu.%s", i, ext_of(input_paths[i]));
            input_archive_names[i] = strdup(buf);
        }
    }

    /* Build manifest + encode as east-JSON */
    const char **in_names_const = (const char **)input_archive_names;
    EastValue *manifest = build_manifest(ir_archive_name, in_names_const, num_inputs, packages,
                                         num_packages, cli_version_str);
    char *manifest_json = east_json_encode(manifest, manifest_type());
    east_value_release(manifest);
    if (!manifest_json) {
        fprintf(stderr, "Error: failed to encode snapshot manifest\n");
        goto fail;
    }

    mtar_t tar;
    if (mtar_open(&tar, out_path, "w") != MTAR_ESUCCESS) {
        fprintf(stderr, "Error: cannot open snapshot '%s' for writing\n", out_path);
        free(manifest_json);
        goto fail;
    }

    int rc = 0;
    rc |= tar_write_file_from_bytes(&tar, "manifest.json", manifest_json, strlen(manifest_json));
    free(manifest_json);

    rc |= tar_write_file_from_path(&tar, ir_archive_name, ir_path);
    for (size_t i = 0; i < num_inputs && rc == 0; i++) {
        rc |= tar_write_file_from_path(&tar, input_archive_names[i], input_paths[i]);
    }

    if (mtar_finalize(&tar) != MTAR_ESUCCESS) rc = -1;
    if (mtar_close(&tar) != MTAR_ESUCCESS) rc = -1;

    if (input_archive_names) {
        for (size_t i = 0; i < num_inputs; i++) free(input_archive_names[i]);
        free(input_archive_names);
    }
    return rc;

fail:
    if (input_archive_names) {
        for (size_t i = 0; i < num_inputs; i++) free(input_archive_names[i]);
        free(input_archive_names);
    }
    return -1;
}

/* ------------------------------------------------------------------ */
/*  Reader                                                             */
/* ------------------------------------------------------------------ */

static char *extract_entry_to_dir(mtar_t *tar, const mtar_header_t *h, const char *dir)
{
    char *buf = malloc(h->size + 1);
    if (!buf) return NULL;
    if (mtar_read_data(tar, buf, h->size) != MTAR_ESUCCESS) {
        free(buf);
        return NULL;
    }
    buf[h->size] = '\0';

    char *out_path = malloc(strlen(dir) + 1 + strlen(h->name) + 1);
    if (!out_path) { free(buf); return NULL; }
    sprintf(out_path, "%s/%s", dir, h->name);

    if (write_whole_file(out_path, buf, h->size) != 0) {
        free(buf);
        free(out_path);
        return NULL;
    }
    free(buf);
    return out_path;
}

/* Read manifest.json from the tar and decode into a typed EastValue.
 * Rewinds tar on exit. Caller releases the returned EastValue. */
static EastValue *read_manifest_from_tar(mtar_t *tar)
{
    mtar_header_t h;
    if (mtar_find(tar, "manifest.json", &h) != MTAR_ESUCCESS) {
        fprintf(stderr, "Error: snapshot is missing manifest.json\n");
        return NULL;
    }
    char *json = malloc(h.size + 1);
    if (!json) return NULL;
    if (mtar_read_data(tar, json, h.size) != MTAR_ESUCCESS) {
        free(json);
        return NULL;
    }
    json[h.size] = '\0';
    char *err = NULL;
    EastValue *mv = east_json_decode_with_error(json, manifest_type(), &err);
    free(json);
    if (!mv) {
        fprintf(stderr, "Error: invalid snapshot manifest: %s\n", err ? err : "(no detail)");
        free(err);
        return NULL;
    }
    mtar_rewind(tar);
    return mv;
}

int snapshot_read(const char *in_path, SnapshotExtract *out)
{
    memset(out, 0, sizeof(*out));

    mtar_t tar;
    if (mtar_open(&tar, in_path, "r") != MTAR_ESUCCESS) {
        fprintf(stderr, "Error: cannot open snapshot '%s' for reading\n", in_path);
        return -1;
    }

    /* Decode manifest first so we know what to extract and in what order. */
    EastValue *manifest = read_manifest_from_tar(&tar);
    if (!manifest) {
        mtar_close(&tar);
        return -1;
    }

    /* Version check */
    EastValue *version_v = east_struct_get_field(manifest, "version");
    if (version_v && version_v->data.integer != SNAPSHOT_FORMAT_VERSION) {
        fprintf(stderr, "Error: snapshot format version %lld is not supported (expected %d)\n",
                (long long)version_v->data.integer, SNAPSHOT_FORMAT_VERSION);
        east_value_release(manifest);
        mtar_close(&tar);
        return -1;
    }

    /* Create a temp extraction dir. */
    char tmpl[] = "/tmp/east-snapshot-XXXXXX";
    char *dir = mkdtemp(tmpl);
    if (!dir) {
        fprintf(stderr, "Error: cannot create temp dir for snapshot\n");
        east_value_release(manifest);
        mtar_close(&tar);
        return -1;
    }
    out->_extract_dir = strdup(dir);

    /* Walk tar and extract every non-manifest entry to the temp dir. */
    mtar_header_t h;
    while (mtar_read_header(&tar, &h) == MTAR_ESUCCESS) {
        if (h.type == MTAR_TREG && strcmp(h.name, "manifest.json") != 0) {
            char *p = extract_entry_to_dir(&tar, &h, out->_extract_dir);
            if (!p) {
                fprintf(stderr, "Error: failed to extract '%s' from snapshot\n", h.name);
                mtar_close(&tar);
                east_value_release(manifest);
                snapshot_extract_free(out);
                return -1;
            }
            free(p); /* We'll resolve paths from the manifest below. */
        }
        mtar_next(&tar);
    }
    mtar_close(&tar);

    /* Resolve paths from manifest fields. */
    EastValue *ir_v = east_struct_get_field(manifest, "ir");
    EastValue *inputs_v = east_struct_get_field(manifest, "inputs");
    EastValue *packages_v = east_struct_get_field(manifest, "packages");

    size_t dl = strlen(out->_extract_dir);
    {
        const char *s = ir_v->data.string.data;
        out->ir_path = malloc(dl + 1 + strlen(s) + 1);
        sprintf(out->ir_path, "%s/%s", out->_extract_dir, s);
    }

    out->num_inputs = east_array_len(inputs_v);
    if (out->num_inputs > 0) {
        out->input_paths = calloc(out->num_inputs, sizeof(char *));
        for (size_t i = 0; i < out->num_inputs; i++) {
            EastValue *s = east_array_get(inputs_v, i);
            const char *n = s->data.string.data;
            out->input_paths[i] = malloc(dl + 1 + strlen(n) + 1);
            sprintf(out->input_paths[i], "%s/%s", out->_extract_dir, n);
        }
    }

    out->num_packages = east_array_len(packages_v);
    if (out->num_packages > 0) {
        out->packages = calloc(out->num_packages, sizeof(char *));
        for (size_t i = 0; i < out->num_packages; i++) {
            EastValue *s = east_array_get(packages_v, i);
            out->packages[i] = strdup(s->data.string.data);
        }
    }

    east_value_release(manifest);
    return 0;
}

void snapshot_extract_free(SnapshotExtract *ex)
{
    if (!ex) return;
    free(ex->ir_path);
    if (ex->input_paths) {
        for (size_t i = 0; i < ex->num_inputs; i++) free(ex->input_paths[i]);
        free(ex->input_paths);
    }
    if (ex->packages) {
        for (size_t i = 0; i < ex->num_packages; i++) free(ex->packages[i]);
        free(ex->packages);
    }
    if (ex->_extract_dir) {
        rmdir_flat(ex->_extract_dir);
        free(ex->_extract_dir);
    }
    memset(ex, 0, sizeof(*ex));
}
