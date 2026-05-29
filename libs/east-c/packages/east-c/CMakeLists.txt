add_library(east-c
    src/arena.c
    src/gc.c
    src/hashmap.c
    src/types.c
    src/values.c
    src/value_slab.c
    src/ir.c
    src/env.c
    src/compiler.c
    src/platform.c
    src/builtins/registry.c
    src/builtins/integer.c
    src/builtins/float_ops.c
    src/builtins/boolean.c
    src/builtins/string.c
    src/builtins/comparison.c
    src/builtins/datetime_ops.c
    src/builtins/blob.c
    src/builtins/array.c
    src/builtins/set_ops.c
    src/builtins/dict_ops.c
    src/builtins/ref_ops.c
    src/builtins/vector.c
    src/builtins/matrix.c
    src/builtins/patch.c
    src/serialization/json.c
    src/serialization/beast.c
    src/serialization/beast2/tags.c
    src/serialization/beast2/string_table.c
    src/serialization/beast2/type_table.c
    src/serialization/beast2/backref.c
    src/serialization/beast2/dedup.c
    src/serialization/beast2/value_encode.c
    src/serialization/beast2/value_decode.c
    src/serialization/beast2/full.c
    src/serialization/beast2/sourcemap_table.c
    src/serialization/beast2/value_table.c
    src/serialization/csv.c
    src/serialization/east_parser.c
    src/serialization/east_printer.c
    src/serialization/binary_utils.c
    src/type_of_type.c
)

target_include_directories(east-c PUBLIC include)
target_link_libraries(east-c PRIVATE pcre2-8)
# libm is part of the CRT on Windows/MSVC; only link the separate libm elsewhere.
if(NOT WIN32)
    target_link_libraries(east-c PRIVATE m)
endif()
target_compile_definitions(east-c PRIVATE PCRE2_CODE_UNIT_WIDTH=8)
# Build east-c with the POSIX CRT names (strdup, ...) without C4996 deprecation
# warnings. Set on the target so it also applies when east-py builds east-c via
# add_subdirectory (which bypasses the root CMakeLists force-include below).
if(WIN32)
    target_compile_definitions(east-c PRIVATE _CRT_NONSTDC_NO_WARNINGS _CRT_SECURE_NO_WARNINGS)
    # Force-include the compat shim so the POSIX / atomic / __thread mappings
    # reach every core TU even when east-py builds east-c via add_subdirectory
    # (which bypasses the root CMakeLists force-include). MSVC: /FI; else -include.
    if(MSVC)
        target_compile_options(east-c PRIVATE /FI "${CMAKE_CURRENT_SOURCE_DIR}/include/east/compat.h")
    else()
        target_compile_options(east-c PRIVATE -include "${CMAKE_CURRENT_SOURCE_DIR}/include/east/compat.h")
    endif()
endif()

if(EAST_USE_MIMALLOC AND TARGET mimalloc-static)
    target_link_libraries(east-c PUBLIC mimalloc-static)
    target_compile_definitions(east-c PUBLIC EAST_USE_MIMALLOC=1)
endif()

# Compliance test runner (run via: make test-east-c). Built when cross-compiling
# too, so the suite can run against the Windows binary; on Windows it needs
# winpthreads for clock_gettime (east-c alone doesn't pull it in).
add_executable(test_compliance tests/test_compliance.c)
target_link_libraries(test_compliance east-c)
if(WIN32)
    find_package(Threads REQUIRED)
    target_link_libraries(test_compliance Threads::Threads)
endif()
