# Environment Variables

## XDG_CONFIG_HOME

Base directory for user-specific configuration files

**Type:** `string`  
**Default:** _Required_

## XDG_DATA_HOME

Base directory for user-specific data files

**Type:** `string`  
**Default:** _Required_

## OTUI_DEBUG_FFI

Enable debug logging for the FFI bindings.

**Type:** `boolean`  
**Default:** `false`

## OTUI_TRACE_FFI

Enable tracing for the FFI bindings.

**Type:** `boolean`  
**Default:** `false`

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

---

_generated via packages/core/dev/print-env-vars.ts_
