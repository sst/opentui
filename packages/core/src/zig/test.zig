const std = @import("std");

// Import all test modules
const text_buffer_tests = @import("tests/text-buffer_test.zig");
const text_buffer_editing_tests = @import("tests/text-buffer-editing_test.zig");
const text_buffer_view_tests = @import("tests/text-buffer-view_test.zig");
const grapheme_tests = @import("tests/grapheme_test.zig");
const syntax_style_tests = @import("tests/syntax-style_test.zig");
// const example_tests = @import("example_test.zig");

// Re-export test declarations from individual test files
// This allows `zig test index.zig` to run all tests
comptime {
    _ = text_buffer_tests;
    _ = text_buffer_editing_tests;
    _ = text_buffer_view_tests;
    _ = grapheme_tests;
    _ = syntax_style_tests;
    // _ = example_tests;
}
