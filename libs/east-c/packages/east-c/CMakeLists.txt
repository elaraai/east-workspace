set(EAST_C_SOURCES
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

add_library(east-c ${EAST_C_SOURCES})

target_include_directories(east-c PUBLIC include)
target_link_libraries(east-c PRIVATE pcre2-8)
# values.c backs Set/Dict with tidwall/btree.c. Parents that add_subdirectory()
# this package (standalone east-c, east-py, and each downstream east-py package)
# may already provide the btreec target; declare it here when they haven't so
# every consumer resolves btree.h without re-stating the dependency. btreec
# carries btree.h's include dir + BTREE_NOATOMICS as PUBLIC usage requirements.
if(NOT TARGET btreec)
    include(FetchContent)
    FetchContent_Declare(
        btreec
        GIT_REPOSITORY https://github.com/tidwall/btree.c.git
        GIT_TAG v0.6.4
    )
    FetchContent_GetProperties(btreec)
    if(NOT btreec_POPULATED)
        FetchContent_Populate(btreec)
    endif()
    add_library(btreec STATIC ${btreec_SOURCE_DIR}/btree.c)
    target_include_directories(btreec PUBLIC ${btreec_SOURCE_DIR})
    target_compile_definitions(btreec PUBLIC BTREE_NOATOMICS)
    if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
        target_compile_options(btreec PRIVATE -w)
    endif()
endif()
target_link_libraries(east-c PRIVATE btreec)
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

# Opt-in OBJECT-library twin of east-c, requested by east-py via EAST_C_BUILD_OBJECT.
# east-py links east-c as ONE shared library so the whole process has a single
# value slab. On Windows that shared library is a DLL whose export table is
# auto-generated (WINDOWS_EXPORT_ALL_SYMBOLS) by scanning the target's OWN object
# files — it never scans a static-archive dependency's members, even one pulled in
# with /WHOLEARCHIVE. So the DLL must own east-c's objects directly: build them
# here as an OBJECT library and splice $<TARGET_OBJECTS:east-c-obj> into the SHARED
# target in east-py's CMakeLists. The STATIC east-c above is untouched (the
# standalone CLI + test/profile executables keep linking it). Opt-in so a plain CLI
# build doesn't compile every TU twice; the source list is shared so they can't drift.
if(EAST_C_BUILD_OBJECT)
    add_library(east-c-obj OBJECT ${EAST_C_SOURCES})
    target_include_directories(east-c-obj PUBLIC include)
    target_link_libraries(east-c-obj PRIVATE pcre2-8 btreec)
    # Mark east-c's extern DATA singletons (the type/value globals) dllexport so
    # they're in the DLL's export table; consumers see them as dllimport. Functions
    # auto-export via WINDOWS_EXPORT_ALL_SYMBOLS and need no marker. (EAST_DATA is a
    # no-op off Windows, so this define is harmless on the non-Windows object build.)
    target_compile_definitions(east-c-obj PRIVATE EAST_C_DLL_EXPORTS)
    target_compile_definitions(east-c-obj PRIVATE PCRE2_CODE_UNIT_WIDTH=8)
    if(WIN32)
        target_compile_definitions(east-c-obj PRIVATE _CRT_NONSTDC_NO_WARNINGS _CRT_SECURE_NO_WARNINGS)
        if(MSVC)
            target_compile_options(east-c-obj PRIVATE /FI "${CMAKE_CURRENT_SOURCE_DIR}/include/east/compat.h")
        else()
            target_compile_options(east-c-obj PRIVATE -include "${CMAKE_CURRENT_SOURCE_DIR}/include/east/compat.h")
        endif()
    endif()
    if(EAST_USE_MIMALLOC AND TARGET mimalloc-static)
        target_link_libraries(east-c-obj PUBLIC mimalloc-static)
        target_compile_definitions(east-c-obj PUBLIC EAST_USE_MIMALLOC=1)
    endif()
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

# B-tree leverage gate: proves tidwall/btree.c integrates with east-c's
# allocator, east_value_compare, and refcounted-value teardown before the
# Set/Dict representation is migrated onto it. Not part of the IR compliance
# suite — run directly (and under ASan) to validate the integration.
if(TARGET btreec)
    add_executable(test_btree_gate tests/test_btree_gate.c)
    target_link_libraries(test_btree_gate east-c btreec)
endif()

# Recursive-type lifecycle gate: proves EAST_TYPE_RECURSIVE wrappers follow
# the arena-immortal ownership model — build + intern + type_of_type and
# beast2 type-table decode of a self-referential type, then registry clear.
# Run under ASan/LSan (run_leak_check.sh's build-asan config): a leak or a
# free() of an arena-interior pointer fails the gate.
add_executable(test_recursive_type_lifecycle tests/test_recursive_type_lifecycle.c)
target_link_libraries(test_recursive_type_lifecycle east-c)
add_test(NAME recursive_type_lifecycle COMMAND test_recursive_type_lifecycle)

# type_of_type interning gate (issue #83): east_type_to_value must memoize the
# type->value conversion so two struct fields sharing one interned EastType*
# share one EastValue* sub-tree — otherwise the beast2 type-of-type encoding
# bloats (302 bytes vs the TS-canonical 293). Mirrors the TS
# toEastTypeValueCache. Run under ASan/LSan to validate the memo refcounting.
add_executable(test_type_to_value_interning tests/test_type_to_value_interning.c)
target_link_libraries(test_type_to_value_interning east-c)
add_test(NAME type_to_value_interning COMMAND test_type_to_value_interning)

# Beast2 decoder hardening gate (issue #34): truncation/corruption sweeps,
# crafted out-of-bounds type tables, and allocation-overflow guards. The
# beast2 decoders are an untrusted-input boundary — run under ASan
# (run_leak_check.sh's build-asan config) for the full OOB oracle.
add_executable(test_beast2_hardening tests/test_beast2_hardening.c)
target_link_libraries(test_beast2_hardening east-c)
add_test(NAME beast2_hardening COMMAND test_beast2_hardening)

# Beast2 encode/decode timing harnesses (dev profiling — build Release for real
# numbers). profile_collections builds large Dict/Set values in C and times
# encode + decode per call; profile_beast2_decode times a given .beast2 file.
add_executable(profile_collections scripts/profile_collections.c)
target_link_libraries(profile_collections east-c)
add_executable(profile_beast2_decode scripts/profile_beast2_decode.c)
target_link_libraries(profile_beast2_decode east-c)
