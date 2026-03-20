export function extToFiletype(extension: string): string | undefined {
  const extensionToFiletype: Map<string, string> = new Map([
    ["js", "javascript"],
    ["jsx", "javascriptreact"],
    ["ts", "typescript"],
    ["tsx", "typescriptreact"],
    ["md", "markdown"],
    ["json", "json"],
    ["py", "python"],
    ["rb", "ruby"],
    ["go", "go"],
    ["rs", "rust"],
    ["c", "c"],
    ["cpp", "cpp"],
    ["c++", "cpp"],
    ["cs", "csharp"],
    ["java", "java"],
    ["kt", "kotlin"],
    ["swift", "swift"],
    ["php", "php"],
    ["sql", "sql"],
    ["pl", "perl"],
    ["lua", "lua"],
    ["erl", "erlang"],
    ["exs", "elixir"],
    ["ex", "elixir"],
    ["elm", "elm"],
    ["fsharp", "fsharp"],
    ["fs", "fsharp"],
    ["fsx", "fsharp"],
    ["fsscript", "fsharp"],
    ["fsi", "fsharp"],
    ["h", "c"],
    ["hpp", "cpp"],
    ["html", "html"],
    ["css", "css"],
    ["scss", "scss"],
    ["less", "less"],
    ["sh", "shell"],
    ["bash", "shell"],
    ["zsh", "shell"],
    ["vim", "vim"],
    ["yaml", "yaml"],
    ["yml", "yaml"],
    ["toml", "toml"],
    ["xml", "xml"],
    ["zig", "zig"],
  ])

  return extensionToFiletype.get(extension)
}

function normalizeFiletypeToken(value: string): string | undefined {
  const normalizedValue = value.trim().replace(/^\./, "").toLowerCase()
  if (!normalizedValue) return undefined

  return pathToFiletype(normalizedValue) ?? extToFiletype(normalizedValue) ?? normalizedValue
}

export function pathToFiletype(path: string): string | undefined {
  if (typeof path !== "string") return undefined
  const lastDot = path.lastIndexOf(".")
  if (lastDot === -1 || lastDot === path.length - 1) {
    return undefined
  }

  const extension = path.substring(lastDot + 1)
  return extToFiletype(extension)
}

export function infoStringToFiletype(infoString: string): string | undefined {
  if (typeof infoString !== "string") return undefined

  const languageToken = infoString.trim().split(/\s+/, 1)[0]
  if (!languageToken) return undefined

  return normalizeFiletypeToken(languageToken)
}
