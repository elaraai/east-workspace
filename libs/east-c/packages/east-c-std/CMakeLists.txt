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
target_link_libraries(east-c-std PUBLIC east-c PRIVATE m Threads::Threads)

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
