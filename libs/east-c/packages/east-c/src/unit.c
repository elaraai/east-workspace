/*
 * The runner protocol — see include/east/unit.h for the contract. Shared by
 * the east-c CLI and east-py, so both read the same units and write the same
 * outputs and results.
 */

#include <east/compat.h>
#include <east/unit.h>

#include <east/builtins.h>
#include <east/merge.h>
#include <east/serialization.h>

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef _WIN32
#include <dirent.h>
#endif

/* ================================================================== */
/*  The types                                                          */
/* ================================================================== */

/* The fields of each struct in TypeScript's declaration order, the order a
 * struct encodes in; a variant's cases by name. */
static const char *location_fields[3] = {"filename", "line", "column"};
static const char *failed_fields[2] = {"message", "locations"};
static const char *timing_fields[4] = {"load", "compile", "execute", "output"};
static const char *result_fields[3] = {"outcome", "peakBytes", "timings"};

static EastType *option_of(EastType *type)
{
    const char *names[2] = {"none", "some"};
    EastType *types[2] = {&east_null_type, type};
    return east_variant_type(names, types, 2);
}

static EastType *unit_output_type(void)
{
    const char *dict_names[2] = {"dir", "merge"};
    EastType *dict_types[2] = {&east_string_type, option_of(&east_string_type)};
    const char *fold_names[3] = {"path", "zero", "combine"};
    EastType *fold_types[3] = {&east_string_type, &east_string_type, &east_string_type};
    const char *names[5] = {"array", "dict", "fold", "set", "value"};
    EastType *types[5] = {&east_string_type, east_struct_type(dict_names, dict_types, 2),
                          east_struct_type(fold_names, fold_types, 3), &east_string_type,
                          &east_string_type};
    return east_variant_type(names, types, 5);
}

EastType *east_unit_type(void)
{
    EastType *strings = east_array_type(&east_string_type);
    EastType *output = unit_output_type();
    const char *merge_names[3] = {"parts", "range", "output"};
    EastType *merge_types[3] = {strings, option_of(&east_string_type), output};
    const char *run_names[3] = {"program", "inputs", "output"};
    EastType *run_types[3] = {&east_string_type, strings, output};
    const char *work_names[2] = {"merge", "run"};
    EastType *work_types[2] = {east_struct_type(merge_names, merge_types, 3),
                               east_struct_type(run_names, run_types, 3)};
    const char *names[4] = {"work", "platforms", "threads", "result"};
    EastType *types[4] = {east_variant_type(work_names, work_types, 2), strings, &east_integer_type,
                          &east_string_type};
    return east_struct_type(names, types, 4);
}

EastType *east_unit_result_type(void)
{
    EastType *location_types[3] = {&east_string_type, &east_integer_type, &east_integer_type};
    EastType *failed_types[2] = {
        &east_string_type, east_array_type(east_struct_type(location_fields, location_types, 3))};
    const char *outcome_names[2] = {"failed", "ok"};
    EastType *outcome_types[2] = {east_struct_type(failed_fields, failed_types, 2),
                                  &east_null_type};
    EastType *timing_types[4] = {&east_float_type, &east_float_type, &east_float_type,
                                 &east_float_type};
    EastType *types[3] = {east_variant_type(outcome_names, outcome_types, 2), &east_integer_type,
                          east_struct_type(timing_fields, timing_types, 4)};
    return east_struct_type(result_fields, types, 3);
}

/* ================================================================== */
/*  Files                                                              */
/* ================================================================== */

/* The whole of the file at `path`, malloc'd, or NULL with the message
 * posted. */
static uint8_t *read_file(const char *path, size_t *len_out)
{
    char msg[1024];
    FILE *f = fopen(path, "rb");
    if (!f) {
        snprintf(msg, sizeof(msg), "cannot read %s: %s", path, strerror(errno));
        east_builtin_error(msg);
        return NULL;
    }
    size_t cap = 4096, len = 0;
    uint8_t *data = malloc(cap);
    while (data) {
        size_t got = fread(data + len, 1, cap - len, f);
        len += got;
        if (len < cap) break;
        uint8_t *grown = realloc(data, cap * 2);
        if (!grown) {
            free(data);
            data = NULL;
            break;
        }
        data = grown;
        cap *= 2;
    }
    bool failed = ferror(f) != 0;
    fclose(f);
    if (!data || failed) {
        free(data);
        snprintf(msg, sizeof(msg), "cannot read %s", path);
        east_builtin_error(msg);
        return NULL;
    }
    *len_out = len;
    return data;
}

static bool write_file(const char *path, const uint8_t *bytes, size_t len)
{
    char msg[1024];
    FILE *f = fopen(path, "wb");
    if (!f) {
        snprintf(msg, sizeof(msg), "cannot write %s: %s", path, strerror(errno));
        east_builtin_error(msg);
        return false;
    }
    bool ok = fwrite(bytes, 1, len, f) == len;
    ok = fclose(f) == 0 && ok;
    if (!ok) {
        snprintf(msg, sizeof(msg), "failed writing %s", path);
        east_builtin_error(msg);
    }
    return ok;
}

/* Whether `path` is absolute: a leading slash, and on Windows a leading
 * backslash or a drive. */
static bool path_is_absolute(const char *path, size_t len)
{
    if (len > 0 && path[0] == '/') return true;
#ifdef _WIN32
    if (len > 0 && path[0] == '\\') return true;
    if (len > 1 && path[1] == ':') return true;
#endif
    return false;
}

/* `path` (a String value) resolved against `base`, the unit file's
 * directory: itself when absolute. Allocated; NULL on OOM. */
static char *resolve_path(const char *base, const EastValue *path)
{
    const char *p = path->data.string.data;
    size_t len = path->data.string.len;
    if (path_is_absolute(p, len) || base[0] == '\0') return strdup(p);
    size_t need = strlen(base) + 1 + len + 1;
    char *out = malloc(need);
    if (out) snprintf(out, need, "%s/%s", base, p);
    return out;
}

/* The directory holding `path`: everything before its last separator, or ""
 * when it names a file in the working directory. Allocated; NULL on OOM. */
static char *directory_of(const char *path)
{
    const char *slash = strrchr(path, '/');
#ifdef _WIN32
    const char *backslash = strrchr(path, '\\');
    if (!slash || (backslash && backslash > slash)) slash = backslash;
#endif
    if (!slash) return strdup("");
    size_t len = slash == path ? 1 : (size_t)(slash - path);
    char *out = malloc(len + 1);
    if (out) {
        memcpy(out, path, len);
        out[len] = '\0';
    }
    return out;
}

/* ================================================================== */
/*  Reading a unit                                                     */
/* ================================================================== */

static char *resolve_option(const char *base, EastValue *option, bool *oom)
{
    if (strcmp(east_variant_case_name(option), "some") != 0) return NULL;
    char *path = resolve_path(base, option->data.variant.value);
    if (!path) *oom = true;
    return path;
}

void east_unit_free(EastUnit *unit)
{
    if (!unit) return;
    free(unit->program);
    for (size_t i = 0; i < unit->num_inputs; i++)
        free(unit->inputs[i]);
    free(unit->inputs);
    free(unit->range);
    free(unit->output.path);
    free(unit->output.merge);
    free(unit->output.zero);
    free(unit->output.combine);
    for (size_t i = 0; i < unit->num_platforms; i++)
        free(unit->platforms[i]);
    free(unit->platforms);
    free(unit->result);
    free(unit);
}

/* Reads the unit's fields out of its decoded value. False on OOM. */
static bool unit_fields(EastUnit *unit, EastValue *value, const char *base)
{
    bool oom = false;
    EastValue *work = east_struct_get_field_idx(value, 0);
    EastValue *body = work->data.variant.value;
    unit->merge = strcmp(east_variant_case_name(work), "merge") == 0;
    if (unit->merge) {
        unit->range = resolve_option(base, east_struct_get_field_idx(body, 1), &oom);
    } else {
        unit->program = resolve_path(base, east_struct_get_field_idx(body, 0));
        oom = oom || !unit->program;
    }
    EastValue *inputs = east_struct_get_field_idx(body, unit->merge ? 0 : 1);
    unit->num_inputs = inputs->data.array.len;
    unit->inputs = calloc(unit->num_inputs ? unit->num_inputs : 1, sizeof(char *));
    oom = oom || !unit->inputs;
    for (size_t i = 0; !oom && i < unit->num_inputs; i++) {
        unit->inputs[i] = resolve_path(base, inputs->data.array.items[i]);
        oom = !unit->inputs[i];
    }

    EastValue *output = east_struct_get_field_idx(body, 2);
    const char *kind = east_variant_case_name(output);
    EastValue *payload = output->data.variant.value;
    if (strcmp(kind, "dict") == 0) {
        unit->output.kind = EAST_UNIT_DICT;
        unit->output.path = resolve_path(base, east_struct_get_field_idx(payload, 0));
        unit->output.merge = resolve_option(base, east_struct_get_field_idx(payload, 1), &oom);
    } else if (strcmp(kind, "fold") == 0) {
        unit->output.kind = EAST_UNIT_FOLD;
        unit->output.path = resolve_path(base, east_struct_get_field_idx(payload, 0));
        unit->output.zero = resolve_path(base, east_struct_get_field_idx(payload, 1));
        unit->output.combine = resolve_path(base, east_struct_get_field_idx(payload, 2));
        oom = oom || !unit->output.zero || !unit->output.combine;
    } else {
        unit->output.kind = strcmp(kind, "array") == 0 ? EAST_UNIT_ARRAY
                            : strcmp(kind, "set") == 0 ? EAST_UNIT_SET
                                                       : EAST_UNIT_VALUE;
        unit->output.path = resolve_path(base, payload);
    }
    oom = oom || !unit->output.path;

    EastValue *platforms = east_struct_get_field_idx(value, 1);
    unit->num_platforms = platforms->data.array.len;
    unit->platforms = calloc(unit->num_platforms ? unit->num_platforms : 1, sizeof(char *));
    oom = oom || !unit->platforms;
    for (size_t i = 0; !oom && i < unit->num_platforms; i++) {
        unit->platforms[i] = strdup(platforms->data.array.items[i]->data.string.data);
        oom = !unit->platforms[i];
    }
    unit->threads = east_struct_get_field_idx(value, 2)->data.integer;
    unit->result = resolve_path(base, east_struct_get_field_idx(value, 3));
    return !oom && unit->result;
}

EastUnit *east_unit_read(const char *path)
{
    size_t len = 0;
    uint8_t *data = read_file(path, &len);
    if (!data) return NULL;
    EastValue *value = east_beast2_decode_full(data, len, east_unit_type());
    free(data);
    if (!value) {
        char *specific = east_builtin_get_error();
        size_t need = strlen(path) + (specific ? strlen(specific) : 0) + 64;
        char *msg = malloc(need);
        if (msg) {
            snprintf(msg, need, "%s does not hold a unit: %s", path,
                     specific ? specific : "it does not decode");
            east_builtin_error(msg);
        } else {
            east_builtin_error("the unit does not decode");
        }
        free(msg);
        free(specific);
        return NULL;
    }
    EastUnit *unit = calloc(1, sizeof(*unit));
    char *base = directory_of(path);
    bool ok = unit && base && unit_fields(unit, value, base);
    free(base);
    east_value_release(value);
    if (!ok) {
        east_unit_free(unit);
        east_builtin_error("out of memory reading a unit");
        return NULL;
    }
    return unit;
}

/* ================================================================== */
/*  Writing a result                                                   */
/* ================================================================== */

bool east_unit_write_result(const char *path, const EastUnitResult *result)
{
    EastType *type = east_unit_result_type();
    EastType *outcome_type = type->data.struct_.fields[0].type;
    EastType *timings_type = type->data.struct_.fields[2].type;
    EastValue *outcome;
    if (result->ok) {
        outcome = east_variant_new("ok", east_null(), outcome_type);
    } else {
        /* "failed" sorts first among the cases. */
        EastType *failed_type = outcome_type->data.variant.cases[0].type;
        EastType *location_type = failed_type->data.struct_.fields[1].type->data.element;
        EastValue *locations = east_array_new(location_type);
        for (size_t i = 0; locations && i < result->num_locations; i++) {
            const EastUnitLocation *l = &result->locations[i];
            EastValue *fields[3] = {east_string(l->filename), east_integer(l->line),
                                    east_integer(l->column)};
            EastValue *location = east_struct_new_owned(location_fields, fields, 3, location_type);
            east_array_push(locations, location);
            east_value_release(location);
        }
        EastValue *fields[2] = {east_string(result->message ? result->message : ""), locations};
        EastValue *failed = east_struct_new_owned(failed_fields, fields, 2, failed_type);
        outcome = east_variant_new("failed", failed, outcome_type);
        east_value_release(failed);
    }
    EastValue *timings_values[4] = {east_float(result->load_ms), east_float(result->compile_ms),
                                    east_float(result->execute_ms), east_float(result->output_ms)};
    EastValue *timings = east_struct_new_owned(timing_fields, timings_values, 4, timings_type);
    EastValue *fields[3] = {outcome, east_integer((int64_t)result->peak_bytes), timings};
    EastValue *value = east_struct_new_owned(result_fields, fields, 3, type);
    ByteBuffer *bytes = value ? east_beast2_encode_full(value, type) : NULL;
    if (value) east_value_release(value);
    if (!bytes) {
        east_builtin_error("out of memory writing a result");
        return false;
    }
    bool ok = write_file(path, bytes->data, bytes->len);
    byte_buffer_free(bytes);
    return ok;
}

/* ================================================================== */
/*  Writing an output                                                  */
/* ================================================================== */

bool east_unit_write_value(const char *path, EastValue *value, EastType *type)
{
    if (value && value->kind == EAST_VAL_PAGED) {
        value = east_paged_hydrated(value);
        if (!value) return false;
    }
    if (type->kind == EAST_TYPE_ARRAY || type->kind == EAST_TYPE_SET ||
        type->kind == EAST_TYPE_DICT)
        return east_beast2_write_manifest_dir(value, type, EAST_BEAST2_CODEC_DEFLATE, path);
    ByteBuffer *bytes = east_beast2_encode_full(value, type);
    if (!bytes) return false;
    bool ok = write_file(path, bytes->data, bytes->len);
    byte_buffer_free(bytes);
    return ok;
}

/* Creates an output directory of runs, which must hold nothing yet: every
 * manifest in it is one of the unit's runs. False with the message posted. */
static bool output_directory(const char *dir)
{
    char msg[1024];
    if (east_mkdir(dir) != 0 && errno != EEXIST) {
        snprintf(msg, sizeof(msg), "exec: cannot create the output directory %s: %s", dir,
                 strerror(errno));
        east_builtin_error(msg);
        return false;
    }
    DIR *d = opendir(dir);
    if (!d) {
        snprintf(msg, sizeof(msg), "exec: cannot read the output directory %s", dir);
        east_builtin_error(msg);
        return false;
    }
    bool empty = true;
    struct dirent *entry;
    while (empty && (entry = readdir(d)) != NULL)
        empty = strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0;
    closedir(d);
    if (!empty) {
        snprintf(msg, sizeof(msg), "exec: the output directory %s is not empty", dir);
        east_builtin_error(msg);
    }
    return empty;
}

struct EastUnitSink {
    EastUnitOutputKind kind;
    EastType *type;              /* value and fold: the value's type; else the collection's */
    char *path;                  /* value and fold: the output file */
    Beast2ManifestWriter *array; /* array: <dir>/0.beast2 */
    Beast2RunSorter *runs;       /* set and dict: <dir>/<n>.beast2 */
    EastCompiledFn *combine;     /* fold: borrowed */
    EastValue *acc;              /* fold: owned */
};

void east_unit_sink_free(EastUnitSink *s)
{
    if (!s) return;
    free(s->path);
    east_beast2_manifest_writer_free(s->array);
    east_beast2_run_sorter_free(s->runs);
    if (s->acc) east_value_release(s->acc);
    free(s);
}

/* Posts the refusal of an emit parameter that does not fit the kind. */
static void emit_parameter_error(const char *kind, size_t arity, EastType *type)
{
    char *printed = type ? east_print_type(type) : NULL;
    char msg[1024];
    snprintf(msg, sizeof(msg),
             "exec: a %s output is emitted: the program's trailing parameter must be emit, a "
             "function of %zu argument%s, got %s",
             kind, arity, arity == 1 ? "" : "s", printed ? printed : "nothing");
    free(printed);
    east_builtin_error(msg);
}

/* `<dir>/<n>.beast2`, allocated; NULL on OOM. */
static char *run_path(const char *dir, size_t n)
{
    size_t need = strlen(dir) + 32;
    char *path = malloc(need);
    if (path) snprintf(path, need, "%s/%zu.beast2", dir, n);
    return path;
}

EastUnitSink *east_unit_sink_new(const EastUnitOutput *output, EastType *type,
                                 EastCompiledFn *merge_fn, EastCompiledFn *combine_fn,
                                 EastValue *zero)
{
    static const char *kinds[5] = {"value", "array", "set", "dict", "fold"};
    EastUnitSink *s = calloc(1, sizeof(*s));
    if (!s) {
        east_builtin_error("exec: out of memory opening the output");
        return NULL;
    }
    s->kind = output->kind;
    if (output->kind == EAST_UNIT_VALUE) {
        s->type = type;
        s->path = strdup(output->path);
        return s;
    }
    size_t arity = output->kind == EAST_UNIT_DICT ? 2 : 1;
    if (!type || type->kind != EAST_TYPE_FUNCTION || type->data.function.num_inputs != arity) {
        emit_parameter_error(kinds[output->kind], arity, type);
        east_unit_sink_free(s);
        return NULL;
    }
    EastType *element = type->data.function.inputs[0];
    switch (output->kind) {
    case EAST_UNIT_ARRAY: {
        char *path = output_directory(output->path) ? run_path(output->path, 0) : NULL;
        s->type = east_array_type(element);
        s->array =
            path ? east_beast2_manifest_writer_new_dir(s->type, EAST_BEAST2_CODEC_DEFLATE, path)
                 : NULL;
        free(path);
        if (!s->array) {
            east_unit_sink_free(s);
            return NULL;
        }
        /* Frames deflate on a pool the unit's grant sizes (east_set_thread_limit):
         * one thread frames inline. */
        east_beast2_manifest_writer_set_parallel(s->array, true);
        return s;
    }
    case EAST_UNIT_SET:
    case EAST_UNIT_DICT:
        s->type = output->kind == EAST_UNIT_SET
                      ? east_set_type(element)
                      : east_dict_type(element, type->data.function.inputs[1]);
        s->runs =
            output_directory(output->path)
                ? east_beast2_run_sorter_new_dir(s->type, EAST_BEAST2_CODEC_DEFLATE, output->path,
                                                 merge_fn, output->kind == EAST_UNIT_SET)
                : NULL;
        if (!s->runs) {
            east_unit_sink_free(s);
            return NULL;
        }
        east_beast2_run_sorter_set_parallel(s->runs, true);
        return s;
    default: {
        EastType *t = combine_fn ? combine_fn->fn_type : NULL;
        if (!t || t->kind != EAST_TYPE_FUNCTION || t->data.function.num_inputs != 2 ||
            !east_type_equal(t->data.function.inputs[0], element) ||
            !east_type_equal(t->data.function.inputs[1], element) ||
            !east_type_equal(t->data.function.output, element) || !zero) {
            char *printed_t = east_print_type(element);
            char *printed = t ? east_print_type(t) : NULL;
            char msg[1024];
            snprintf(msg, sizeof(msg),
                     "exec: combine: expected a function (T, T) -> T (T = %s), got %s",
                     printed_t ? printed_t : "?", printed ? printed : "nothing");
            free(printed_t);
            free(printed);
            east_builtin_error(msg);
            east_unit_sink_free(s);
            return NULL;
        }
        s->type = element;
        s->path = strdup(output->path);
        s->combine = combine_fn;
        east_value_retain(zero);
        s->acc = zero;
        return s;
    }
    }
}

static EvalResult unit_sink_invoke(EastCompiledFn *self, EastValue **args, size_t n_args)
{
    EastUnitSink *s = (EastUnitSink *)self->invoke_userdata;
    size_t expected = s->kind == EAST_UNIT_DICT ? 2 : 1;
    if (n_args != expected || !args[0] || (expected == 2 && !args[1]))
        return eval_error("emit called with the wrong number of arguments");
    bool ok;
    switch (s->kind) {
    case EAST_UNIT_ARRAY:
        ok = east_beast2_manifest_writer_add(s->array, args[0]);
        break;
    case EAST_UNIT_SET:
        ok = east_beast2_run_sorter_add(s->runs, args[0]);
        break;
    case EAST_UNIT_DICT:
        ok = east_beast2_run_sorter_add_pair(s->runs, args[0], args[1]);
        break;
    default: {
        EastValue *fold_args[2] = {s->acc, args[0]};
        EvalResult r = east_call(s->combine, fold_args, 2);
        if (r.status == EVAL_ERROR) return r;
        east_value_release(s->acc);
        s->acc = r.value; /* the result's reference */
        eval_result_free(&r);
        return eval_ok(east_null());
    }
    }
    if (!ok) {
        char *specific = east_builtin_get_error();
        EvalResult r = eval_error(specific ? specific : "emit: failed to write the output");
        free(specific);
        return r;
    }
    return eval_ok(east_null());
}

EastValue *east_unit_sink_function(EastUnitSink *s, EastType *fn_type)
{
    if (!s || s->kind == EAST_UNIT_VALUE) return NULL;
    return east_foreign_function(unit_sink_invoke, s, NULL, fn_type);
}

bool east_unit_sink_finish(EastUnitSink *s, EastValue *result)
{
    switch (s->kind) {
    case EAST_UNIT_VALUE:
        return east_unit_write_value(s->path, result, s->type);
    case EAST_UNIT_ARRAY:
        return east_beast2_manifest_writer_finish(s->array);
    case EAST_UNIT_SET:
    case EAST_UNIT_DICT:
        return east_beast2_run_sorter_finish(s->runs);
    default:
        return east_unit_write_value(s->path, s->acc, s->type);
    }
}

/* ================================================================== */
/*  Merging runs                                                       */
/* ================================================================== */

bool east_unit_merge_runs(const EastUnit *unit, EastCompiledFn *merge_fn)
{
    if (!output_directory(unit->output.path)) return false;
    char *path = run_path(unit->output.path, 0);
    if (!path) {
        east_builtin_error("exec: out of memory merging runs");
        return false;
    }
    EastMergeConfig cfg = {
        .input_paths = (const char *const *)unit->inputs,
        .num_inputs = unit->num_inputs,
        .output_path = path,
        .output_manifest = true,
        .merge_fn = merge_fn,
        .union_mode = unit->output.kind == EAST_UNIT_SET,
        .range_path = unit->range,
    };
    EastMergeStats stats;
    bool ok = east_merge_blobs(&cfg, &stats);
    free(path);
    return ok;
}
