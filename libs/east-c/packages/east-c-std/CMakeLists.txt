add_library(east-c-std
    src/console.c
    src/fs.c
    src/path.c
    src/crypto.c
    src/time_ops.c
    src/tzfile.c
    src/random.c
    src/fetch.c
    src/test.c
    src/register_all.c
)

target_include_directories(east-c-std PUBLIC include)
find_package(Threads REQUIRED)
target_link_libraries(east-c-std PUBLIC east-c PRIVATE Threads::Threads)
# libm is part of the CRT on Windows/MSVC; link the separate libm elsewhere.
if(NOT WIN32)
    target_link_libraries(east-c-std PRIVATE m)
endif()

# On Windows there is no system tz database and the CRT can't resolve IANA zone
# names, so embed the vendored zoneinfo (tzdata.blob) into the binary as a
# generated C byte array and read it directly (see tzfile.c). Linux/macOS use
# their system tz. (A generated C array is portable across MSVC/GCC/Clang; it
# replaced a GNU-assembler .incbin that MSVC's MASM cannot consume.)
if(WIN32)
    set(_tzdata_blob "${CMAKE_CURRENT_SOURCE_DIR}/src/tzdata.blob")
    set(_tzdata_c "${CMAKE_CURRENT_BINARY_DIR}/tzdata_embed.c")
    add_custom_command(
        OUTPUT "${_tzdata_c}"
        COMMAND ${CMAKE_COMMAND}
                -DBLOB=${_tzdata_blob} -DOUT=${_tzdata_c}
                -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/embed_tzdata.cmake"
        DEPENDS "${_tzdata_blob}" "${CMAKE_CURRENT_SOURCE_DIR}/cmake/embed_tzdata.cmake"
        COMMENT "Embedding tzdata.blob -> tzdata_embed.c"
        VERBATIM)
    target_sources(east-c-std PRIVATE "${_tzdata_c}")
    target_compile_definitions(east-c-std PRIVATE EAST_TZDATA_EMBEDDED=1)
    # bcrypt for BCryptGenRandom (the Windows system RNG; no /dev/urandom).
    target_link_libraries(east-c-std PRIVATE bcrypt)
endif()

# libcurl for fetch. On Windows it's vendored statically (Schannel) via the
# top-level CMakeLists FetchContent; elsewhere use the system libcurl.
if(WIN32 AND TARGET CURL::libcurl)
    target_link_libraries(east-c-std PRIVATE CURL::libcurl)
    target_compile_definitions(east-c-std PRIVATE EAST_HAS_CURL=1)
else()
    find_package(CURL QUIET)
    if(CURL_FOUND)
        target_link_libraries(east-c-std PRIVATE CURL::libcurl)
        target_compile_definitions(east-c-std PRIVATE EAST_HAS_CURL=1)
    endif()
endif()

# Compliance test runner (run via: make test-east-c-std). Built for the
# cross-compile target too, so the Windows std binary can be validated under
# Wine locally; it runs natively on the Windows CI leg.
add_executable(test_std_compliance tests/test_compliance.c)
target_link_libraries(test_std_compliance east-c-std)
