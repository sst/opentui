/** Copy of bun:ffi#FFIType */
export enum FFIType {
  char = 0,
  /**
   * 8-bit signed integer
   *
   * Must be a value between -127 and 127
   *
   * When passing to a FFI function (C ABI), type coercion is not performed.
   *
   * In C:
   * ```c
   * signed char
   * char // on x64 & aarch64 macOS
   * ```
   *
   * In JavaScript:
   * ```js
   * var num = 0;
   * ```
   */
  int8_t = 1,
  /**
   * 8-bit signed integer
   *
   * Must be a value between -127 and 127
   *
   * When passing to a FFI function (C ABI), type coercion is not performed.
   *
   * In C:
   * ```c
   * signed char
   * char // on x64 & aarch64 macOS
   * ```
   *
   * In JavaScript:
   * ```js
   * var num = 0;
   * ```
   */
  i8 = 1,

  /**
   * 8-bit unsigned integer
   *
   * Must be a value between 0 and 255
   *
   * When passing to a FFI function (C ABI), type coercion is not performed.
   *
   * In C:
   * ```c
   * unsigned char
   * ```
   *
   * In JavaScript:
   * ```js
   * var num = 0;
   * ```
   */
  uint8_t = 2,
  /**
   * 8-bit unsigned integer
   *
   * Must be a value between 0 and 255
   *
   * When passing to a FFI function (C ABI), type coercion is not performed.
   *
   * In C:
   * ```c
   * unsigned char
   * ```
   *
   * In JavaScript:
   * ```js
   * var num = 0;
   * ```
   */
  u8 = 2,

  /**
   * 16-bit signed integer
   *
   * Must be a value between -32768 and 32767
   *
   * When passing to a FFI function (C ABI), type coercion is not performed.
   *
   * In C:
   * ```c
   * in16_t
   * short // on arm64 & x64
   * ```
   *
   * In JavaScript:
   * ```js
   * var num = 0;
   * ```
   */
  int16_t = 3,
  /**
   * 16-bit signed integer
   *
   * Must be a value between -32768 and 32767
   *
   * When passing to a FFI function (C ABI), type coercion is not performed.
   *
   * In C:
   * ```c
   * in16_t
   * short // on arm64 & x64
   * ```
   *
   * In JavaScript:
   * ```js
   * var num = 0;
   * ```
   */
  i16 = 3,

  /**
   * 16-bit unsigned integer
   *
   * Must be a value between 0 and 65535, inclusive.
   *
   * When passing to a FFI function (C ABI), type coercion is not performed.
   *
   * In C:
   * ```c
   * uint16_t
   * unsigned short // on arm64 & x64
   * ```
   *
   * In JavaScript:
   * ```js
   * var num = 0;
   * ```
   */
  uint16_t = 4,
  /**
   * 16-bit unsigned integer
   *
   * Must be a value between 0 and 65535, inclusive.
   *
   * When passing to a FFI function (C ABI), type coercion is not performed.
   *
   * In C:
   * ```c
   * uint16_t
   * unsigned short // on arm64 & x64
   * ```
   *
   * In JavaScript:
   * ```js
   * var num = 0;
   * ```
   */
  u16 = 4,

  /**
   * 32-bit signed integer
   */
  int32_t = 5,

  /**
   * 32-bit signed integer
   *
   * Alias of {@link FFIType.int32_t}
   */
  i32 = 5,
  /**
   * 32-bit signed integer
   *
   * The same as `int` in C
   *
   * ```c
   * int
   * ```
   */
  int = 5,

  /**
   * 32-bit unsigned integer
   *
   * The same as `unsigned int` in C (on x64 & arm64)
   *
   * C:
   * ```c
   * unsigned int
   * ```
   * JavaScript:
   * ```js
   * ptr(new Uint32Array(1))
   * ```
   */
  uint32_t = 6,
  /**
   * 32-bit unsigned integer
   *
   * Alias of {@link FFIType.uint32_t}
   */
  u32 = 6,

  /**
   * int64 is a 64-bit signed integer
   */
  int64_t = 7,
  /**
   * i64 is a 64-bit signed integer
   */
  i64 = 7,

  /**
   * 64-bit unsigned integer
   */
  uint64_t = 8,
  /**
   * 64-bit unsigned integer
   */
  u64 = 8,

  /**
   * IEEE-754 double precision float
   */
  double = 9,

  /**
   * Alias of {@link FFIType.double}
   */
  f64 = 9,

  /**
   * IEEE-754 single precision float
   */
  float = 10,

  /**
   * Alias of {@link FFIType.float}
   */
  f32 = 10,

  /**
   * Boolean value
   *
   * Must be `true` or `false`. `0` and `1` type coercion is not supported.
   *
   * In C, this corresponds to:
   * ```c
   * bool
   * _Bool
   * ```
   */
  bool = 11,

  /**
   * Pointer value
   *
   * See {@link Bun.FFI.ptr} for more information
   *
   * In C:
   * ```c
   * void*
   * ```
   *
   * In JavaScript:
   * ```js
   * ptr(new Uint8Array(1))
   * ```
   */
  ptr = 12,
  /**
   * Pointer value
   *
   * alias of {@link FFIType.ptr}
   */
  pointer = 12,

  /**
   * void value
   *
   * void arguments are not supported
   *
   * void return type is the default return type
   *
   * In C:
   * ```c
   * void
   * ```
   */
  void = 13,

  /**
   * When used as a `returns`, this will automatically become a {@link CString}.
   *
   * When used in `args` it is equivalent to {@link FFIType.pointer}
   */
  cstring = 14,

  /**
   * Attempt to coerce `BigInt` into a `Number` if it fits. This improves performance
   * but means you might get a `BigInt` or you might get a `number`.
   *
   * In C, this always becomes `int64_t`
   *
   * In JavaScript, this could be number or it could be BigInt, depending on what
   * value is passed in.
   */
  i64_fast = 15,

  /**
   * Attempt to coerce `BigInt` into a `Number` if it fits. This improves performance
   * but means you might get a `BigInt` or you might get a `number`.
   *
   * In C, this always becomes `uint64_t`
   *
   * In JavaScript, this could be number or it could be BigInt, depending on what
   * value is passed in.
   */
  u64_fast = 16,
  function = 17,

  napi_env = 18,
  napi_value = 19,
  buffer = 20,
}
