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

export function pathToFiletype(path: string): string | undefined {
  if (typeof path !== "string") return undefined
  const lastDot = path.lastIndexOf(".")
  if (lastDot === -1 || lastDot === path.length - 1) {
    return undefined
  }

  const extension = path.substring(lastDot + 1)
  return extToFiletype(extension)
}
