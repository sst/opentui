# Contributing to OpenTUI

Bug fixes and feature suggestions are always welcome. For bug fixes, open a PR for review.
Feature suggestions are subject to discussion via issues.

## Prerequisites

- [.NET 9](https://dotnet.microsoft.com/download/dotnet/9.0) or later

## Build

```bash
cd csharp
dotnet restore
dotnet build
```

## Test

```bash
cd csharp
dotnet test
```

## Run Samples

```bash
cd csharp
dotnet run --project samples/OpenTui.Samples -- layout
dotnet run --project samples/OpenTui.Samples -- editor
```

## Project Structure

| Path | Purpose |
|---|---|
| `csharp/src/OpenTui.Core/` | Core library — all public API |
| `csharp/tests/OpenTui.Tests/` | xUnit tests — cover every public API |
| `csharp/samples/OpenTui.Samples/` | Console app samples demonstrating features |

## Code Style

- Follow standard C# conventions (PascalCase for types/members, camelCase for locals/fields)
- Use `readonly struct` for value types where appropriate
- Use `IDisposable` for types that own resources
- XML doc comments (`/// <summary>`) for public APIs where the intent is non-obvious
- No JSDoc-style block comments

## Code of Conduct

- Treat everyone with respect and empathy.
- Be kind, constructive, and assume good intent.
- Critique code, not people.
- Follow project guidelines and maintainers' decisions.
