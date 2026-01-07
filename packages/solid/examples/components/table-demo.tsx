import { SyntaxStyle, RGBA } from "@opentui/core"

export function TableDemo() {
  const syntaxStyle = SyntaxStyle.fromStyles({
    "markup.heading": { fg: RGBA.fromHex("#61afef"), bold: true },
    "punctuation.special": { fg: RGBA.fromHex("#5c6370"), dim: true },
    default: { fg: RGBA.fromHex("#abb2bf") },
  })

  const markdownWithTable = `# Table Rendering Demo

Here's a simple table:

| Name | Age | City |
|:-----|:---:|-----:|
| Alice | 30 | NYC |
| Bob | 25 | LA |
| 田中太郎 | 28 | 東京 |

And another with more columns:

| Feature | Status | Notes |
|---------|--------|-------|
| Unicode borders | ✅ | Box-drawing chars |
| CJK support | ✅ | Proper width calc |
| Alignment | ✅ | Left/Center/Right |
`

  return (
    <box flexDirection="column" gap={2} padding={1}>
      <text bold>Table Rendering Test (table.enabled = true)</text>
      <box border={["all"]} padding={1}>
        <code
          content={markdownWithTable}
          filetype="markdown"
          syntaxStyle={syntaxStyle}
          table={{ enabled: true, style: "unicode" }}
        />
      </box>

      <text bold>Without Table Rendering (table.enabled = false)</text>
      <box border={["all"]} padding={1}>
        <code content={markdownWithTable} filetype="markdown" syntaxStyle={syntaxStyle} table={{ enabled: false }} />
      </box>
    </box>
  )
}
