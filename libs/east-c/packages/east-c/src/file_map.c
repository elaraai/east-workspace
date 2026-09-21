/*
 * Read-only whole-file mappings — see include/east/file_map.h.
 */

#include <east/compat.h>
#include <east/file_map.h>

#include <stdlib.h>

#ifndef _WIN32
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

#ifdef _WIN32

/* The file and mapping handles a view keeps open, closed with it. */
typedef struct {
    HANDLE file;
    HANDLE mapping;
} WindowsFileMapping;

uint8_t *map_input_file(const char *path, size_t *len_out, void **ctx_out)
{
    *ctx_out = NULL;
    HANDLE file = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE, NULL,
                              OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return NULL;
    LARGE_INTEGER size;
    /* An empty file has no mapping: CreateFileMapping refuses a zero size. */
    if (!GetFileSizeEx(file, &size) || size.QuadPart <= 0 ||
        (uint64_t)size.QuadPart > (uint64_t)SIZE_MAX) {
        CloseHandle(file);
        return NULL;
    }
    HANDLE mapping = CreateFileMappingA(file, NULL, PAGE_READONLY, 0, 0, NULL);
    if (!mapping) {
        CloseHandle(file);
        return NULL;
    }
    void *view = MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0);
    WindowsFileMapping *handles = view ? malloc(sizeof(WindowsFileMapping)) : NULL;
    if (!handles) {
        if (view) UnmapViewOfFile(view);
        CloseHandle(mapping);
        CloseHandle(file);
        return NULL;
    }
    handles->file = file;
    handles->mapping = mapping;
    *ctx_out = handles;
    *len_out = (size_t)size.QuadPart;
    return (uint8_t *)view;
}

void input_release_mapping(void *ctx, uint8_t *data, size_t len)
{
    (void)len;
    if (data) UnmapViewOfFile(data);
    WindowsFileMapping *handles = ctx;
    if (handles) {
        CloseHandle(handles->mapping);
        CloseHandle(handles->file);
        free(handles);
    }
}

#else /* !_WIN32 */

uint8_t *map_input_file(const char *path, size_t *len_out, void **ctx_out)
{
    *ctx_out = NULL;
    int fd = open(path, O_RDONLY);
    if (fd < 0) return NULL;
    struct stat st;
    if (fstat(fd, &st) != 0 || S_ISDIR(st.st_mode) || st.st_size <= 0) {
        close(fd);
        return NULL;
    }
    size_t len = (size_t)st.st_size;
    void *map = mmap(NULL, len, PROT_READ, MAP_PRIVATE, fd, 0);
    close(fd);
    if (map == MAP_FAILED) return NULL;
    *len_out = len;
    return (uint8_t *)map;
}

void input_release_mapping(void *ctx, uint8_t *data, size_t len)
{
    (void)ctx;
    if (data) munmap(data, len);
}

#endif /* _WIN32 */
