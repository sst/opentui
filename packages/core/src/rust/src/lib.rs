//! OpenTUI native core - Rust implementation with C ABI for FFI.
//!
//! This library exposes a C-compatible API matching the original Zig interface,
//! making it easy to integrate with Deno (via `Deno.dlopen`), Bun, or any other
//! runtime that supports loading dynamic libraries through a C FFI.

pub mod ansi;
pub mod buffer;
pub mod edit_buffer;
pub mod editor_view;
pub mod event_bus;
pub mod grapheme;
pub mod link;
pub mod logger;
pub mod renderer;
pub mod rope;
pub mod syntax_style;
pub mod terminal;
pub mod text_buffer;
pub mod text_buffer_view;
pub mod utf8;
pub mod utils;

mod ffi;
