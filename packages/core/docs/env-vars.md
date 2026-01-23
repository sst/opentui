# Environment Variables

# Environment Variables

## OTUI_TS_STYLE_WARN

Enable warnings for missing syntax styles

**Type:** `string`  
**Default:** `false`

## OTUI_TREE_SITTER_WORKER_PATH

Path to the TreeSitter worker

**Type:** `string`  
**Default:** `""`

## XDG_CONFIG_HOME

Base directory for user-specific configuration files

**Type:** `string`  
**Default:** `""`

## XDG_DATA_HOME

Base directory for user-specific data files

**Type:** `string`  
**Default:** `""`

## OTUI_DEBUG_FFI

Enable debug logging for the FFI bindings.

**Type:** `boolean`  
**Default:** `false`

## OTUI_SHOW_STATS

Show the debug overlay at startup.

**Type:** `boolean`  
**Default:** `false`

## OTUI_TRACE_FFI

Enable tracing for the FFI bindings.

**Type:** `boolean`  
**Default:** `false`

## OPENTUI_FORCE_WCWIDTH

Use wcwidth for character width calculations

**Type:** `boolean`  
**Default:** `false`

## OPENTUI_FORCE_UNICODE

Force Mode 2026 Unicode support in terminal capabilities

**Type:** `boolean`  
**Default:** `false`

## OPENTUI_NO_GRAPHICS

Disable Kitty graphics protocol detection

**Type:** `boolean`  
**Default:** `false`

## OPENTUI_FORCE_NOZWJ

Use no_zwj width method (Unicode without ZWJ joining)

**Type:** `boolean`  
**Default:** `false`

## OPENTUI_FORCE_EXPLICIT_WIDTH

Force explicit width capability in terminal to true or false. Set to "true" or "1" to enable, "false" or "0" to disable.

**Type:** `string`  
**Values:** `"true"`, `"1"`, `"false"`, `"0"`

## OTUI_USE_CONSOLE

Whether to use the console. Will not capture console output if set to false.

**Type:** `boolean`  
**Default:** `true`

## SHOW_CONSOLE

Show the console at startup if set to true.

**Type:** `boolean`  
**Default:** `false`

## OTUI_DUMP_CAPTURES

Dump captured output when the renderer exits.

**Type:** `boolean`  
**Default:** `false`

## OTUI_NO_NATIVE_RENDER

Disable native rendering. This will not actually output ansi and is useful for debugging.

**Type:** `boolean`  
**Default:** `false`

## OTUI_USE_ALTERNATE_SCREEN

Whether to use the console. Will not capture console output if set to false.

**Type:** `boolean`  
**Default:** `true`

## OTUI_OVERRIDE_STDOUT

Override the stdout stream. This is useful for debugging.

**Type:** `boolean`  
**Default:** `true`

## OTUI_DEBUG

Enable debug mode to capture all raw input for debugging purposes.

**Type:** `boolean`  
**Default:** `false`

---

_generated via packages/core/dev/print-env-vars.ts_
