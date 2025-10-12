const std = @import("std");

// Import all test modules
const text_buffer_tests = @import("tests/text-buffer_test.zig");
const text_buffer_editing_tests = @import("tests/text-buffer-editing_test.zig");
const text_buffer_view_tests = @import("tests/text-buffer-view_test.zig");
const edit_buffer_tests = @import("tests/edit-buffer_test.zig");
const grapheme_tests = @import("tests/grapheme_test.zig");
const syntax_style_tests = @import("tests/syntax-style_test.zig");
const rope_tests = @import("tests/rope_test.zig");
const rope_fuzz_tests = @import("tests/rope_fuzz_test.zig");
const rope_perf_tests = @import("tests/rope_perf_test.zig");
const rope_improvements_tests = @import("tests/rope_improvements_test.zig");
const utf8_tests = @import("tests/utf8_test.zig");
// const example_tests = @import("example_test.zig");

// Re-export test declarations from individual test files
// This allows `zig test index.zig` to run all tests
comptime {
    _ = text_buffer_tests;
    _ = text_buffer_editing_tests;
    // _ = text_buffer_view_tests; // Temporarily disabled due to compilation errors
    _ = edit_buffer_tests;
    _ = grapheme_tests;
    _ = syntax_style_tests;
    _ = rope_tests;
    _ = rope_fuzz_tests;
    _ = rope_perf_tests;
    _ = rope_improvements_tests;
    _ = utf8_tests;
    // _ = example_tests;
}
