# Debugging optimized release binaries

Production npm packages contain small native libraries. Matching debug symbols
are separate GitHub Release downloads named
`opentui-symbols-v<VERSION>-<platform>-<arch>[-musl].zip`.
Download the archive for the exact release and target, not a newer build or a
locally compiled Debug library. Debug builds have different code and addresses.

Each archive contains `manifest.json` with the package version, target/ABI,
source commit, optimization mode, binary identity and symbol-file SHA-256 hashes.
The binary hash is explicitly **before signing**: Windows Authenticode changes
the file hash, but not the PDB GUID/age identifying its compiled code.

- Linux: extract `libopentui.so.debug` beside the matching `libopentui.so` (or in
  its `.debug` subdirectory). GDB uses `.gnu_debuglink` and its CRC; ELF build IDs
  also identify the pair. `gdb /path/to/executable /path/to/core` can then resolve
  the native library's addresses. `addr2line -e libopentui.so.debug <address>`
  expects a library-relative address, not an unadjusted ASLR process address.
- macOS: extract `libopentui.dylib.dSYM`. Its Mach-O UUID must match the loaded
  library. Use `dwarfdump --uuid` to check and LLDB's
  `target symbols add /path/to/libopentui.dylib.dSYM` to load it.
- Windows: extract `opentui.pdb`, add its directory to the debugger's symbol
  path and reload symbols. The DLL's CodeView GUID and age must match the PDB.

Symbols do not collect crashes. Include a core/minidump or native stack addresses
with module identity and load addresses. Optimized-out variables may remain
unavailable even with matching symbols.

## Build and retention

`build:native` compiles ReleaseFast once with symbols. Packaging detaches symbols
into `packages/native/symbols/` and strips **only the npm distribution copy**.
The original `packages/native/lib/` output remains available locally.

- Linux uses binutils (`objcopy`, `readelf`, `nm`); macOS cross-compilation uses
  LLVM equivalents through `LLVM_BIN=$(brew --prefix llvm)/bin`.
- macOS additionally uses Xcode command-line tools (`dsymutil`, `strip`,
  `dwarfdump`, `nm`). dSYMs are generated before the Zig object cache is removed.
- Windows GNU builds emit PDBs directly. Packaging checks them with LLVM's
  `llvm-readobj` and `llvm-pdbutil` (`LLVM_BIN` or PATH). The DLL keeps its CodeView
  matching record; it contains no embedded DWARF/static symbol table.

Local `build:native:dev`/Debug builds are unchanged and do not detach or strip
symbols. Repackaging a release uses the original unstripped build output, never
the already-stripped npm copy.

The native build job validates and archives all eight targets before Windows
signing and npm packaging. The release job attaches these exact archives to the
GitHub Release, where they remain with the release rather than expiring with
30-day CI artifacts. PR artifacts are short-lived test evidence; snapshot builds
retain the existing CI-artifact policy and do not create GitHub Releases.
