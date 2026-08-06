add_executable(east-c-cli src/main.c src/snapshot.c)
set_target_properties(east-c-cli PROPERTIES OUTPUT_NAME east-c)
target_link_libraries(east-c-cli east-c-std microtar)
if(WIN32)
    target_link_libraries(east-c-cli psapi)
endif()
target_compile_definitions(east-c-cli PRIVATE
    EAST_CLI_VERSION="${EAST_VERSION}"
    EAST_RUNTIME_VERSION="${EAST_VERSION}"
)

# CLI --emit gate (issue #507): spawns the built east-c binary over the
# checked-in IR fixtures in tests/fixtures and byte-validates the emitted
# blobs (decode, index present, canonical error text on an out-of-order dict
# emit). Runs in the ASan tree too (leak-check's ctest pass), where the
# spawned CLI is instrumented — the harness fails on any sanitizer report in
# the child's stderr, covering the emit sink's error path (freed without
# finish).
add_executable(test_cli_emit tests/test_cli_emit.c)
target_link_libraries(test_cli_emit east-c)
add_test(NAME cli_emit COMMAND test_cli_emit $<TARGET_FILE:east-c-cli>
         ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures)
set_tests_properties(cli_emit PROPERTIES WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
