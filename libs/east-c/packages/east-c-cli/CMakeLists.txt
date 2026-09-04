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

# CLI lazy paged-input gate (#516): spawns the binary with
# EAST_LAZY_INPUT_BYTES=1 over checked-in fixtures and pins the lazy
# contract end to end — the iteration-lock error on a paged $.for, pager
# error propagation through keyed `has` on a corrupt blob, the
# mutable-nested shape gate falling back to the eager decode, and the
# residency of a mapped input (a wide fixture the gate writes itself, hence
# the east-c link).
add_executable(test_cli_paged tests/test_cli_paged.c)
target_link_libraries(test_cli_paged east-c)
add_test(NAME cli_paged COMMAND test_cli_paged $<TARGET_FILE:east-c-cli>
         ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures)
set_tests_properties(cli_paged PROPERTIES WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})

# CLI `ir` toolbox gate (#627): spawns the binary over checked-in IR fixtures
# and pins normalize (a fixed point, loc_ids zero, no map), diff (exit code +
# path, --raw) and convert (json <-> beast2 with the source map intact).
add_executable(test_cli_ir tests/test_cli_ir.c)
target_link_libraries(test_cli_ir east-c)
add_test(NAME cli_ir COMMAND test_cli_ir $<TARGET_FILE:east-c-cli>
         ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures)
set_tests_properties(cli_ir PROPERTIES WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
