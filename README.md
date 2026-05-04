# OpenTUI

<div align="center">
    <a href="https://www.nuget.org/packages/OpenTui.Core"><img alt="NuGet" src="https://img.shields.io/nuget/v/OpenTui.Core?style=flat-square" /></a>
    <a href="https://github.com/evilz/opentui/actions/workflows/build-dotnet.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/evilz/opentui/build-dotnet.yml?style=flat-square&branch=main" /></a>
</div>

OpenTUI is a terminal UI core library for **.NET 9**. It provides a cell-based rendering engine with ANSI escape sequence support, styled text, a rope-backed edit buffer with full undo/redo, a plugin architecture, and sample console applications.

## Requirements

- [.NET 9](https://dotnet.microsoft.com/download/dotnet/9.0) or later

## Quick Start

```bash
dotnet add package OpenTui.Core
```

```csharp
using OpenTui.Core.Ansi;
using OpenTui.Core.Buffer;

using var buf = CellBuffer.Create(60, 20);
var bg     = Rgba.FromInts(0,   0,   0);
var fg     = Rgba.FromInts(255, 255, 255);
var accent = Rgba.FromInts(0,   200, 255);

buf.Clear(bg);
buf.DrawBox(0, 0, 60, 20, accent, bg, BorderStyle.Rounded, BorderSides.All,
            fill: true, title: " My App ");
buf.DrawText("Hello from OpenTUI!", 4, 3, fg, bg);
```

## Solution Layout

```
csharp/
  src/OpenTui.Core/          # Core library (NuGet package)
    Ansi/                    # Rgba, AnsiCodes, TextAttributes, ColorIntent
    Buffer/                  # CellBuffer, Cell, BorderStyle
    Text/                    # TextBuffer, EditBuffer, Rope, StyledText
    Rendering/               # Renderer (diff-based, alternate screen)
    Syntax/                  # SyntaxStyle, StyleDefinition
    Events/                  # EventEmitter
    Plugins/                 # IPlugin, PluginRegistry
  tests/OpenTui.Tests/       # xUnit test project (115 tests)
  samples/OpenTui.Samples/   # Sample console applications
```

## Build & Test

```bash
cd csharp
dotnet restore
dotnet build
dotnet test
```

## Run Samples

```bash
cd csharp
dotnet run --project samples/OpenTui.Samples -- layout   # simple box layout
dotnet run --project samples/OpenTui.Samples -- styled   # text attributes
dotnet run --project samples/OpenTui.Samples -- editor   # edit buffer demo
dotnet run --project samples/OpenTui.Samples -- scroll   # scrolling content
dotnet run --project samples/OpenTui.Samples -- input    # keyboard input
```

## Key Types

| Type | Description |
|---|---|
| `Rgba` | Packed color: RGB, ANSI-256 indexed, or terminal-default intent |
| `CellBuffer` | 2D terminal cell grid with text, borders, blitting, alpha blend |
| `TextBuffer` | Styled text storage (read-only display) |
| `EditBuffer` | Rope-backed editor: cursor, insert/delete, undo/redo |
| `Renderer` | Diff-based ANSI terminal renderer with alternate-screen support |
| `SyntaxStyle` | Named style definitions with priority-aware merging |
| `EventEmitter` | Simple on/off/once/emit event bus |
| `PluginRegistry` | `IPlugin` registration and lifecycle |
