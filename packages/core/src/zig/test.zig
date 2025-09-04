const std = @import("std");

// Import all test modules
const text_buffer_tests = @import("tests/text-buffer_test.zig");
// const example_tests = @import("example_test.zig");

// Re-export test declarations from individual test files
// This allows `zig test index.zig` to run all tests
comptime {
    _ = text_buffer_tests;
    // _ = example_tests;
}
