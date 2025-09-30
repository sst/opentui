import { SyntaxStyle, RGBA } from "@opentui/core"

export function CodeDemo() {
  const syntaxStyle = new SyntaxStyle({
    keyword: { fg: RGBA.fromHex("#ff6b6b"), bold: true }, // red, bold
    string: { fg: RGBA.fromHex("#51cf66") }, // green
    comment: { fg: RGBA.fromHex("#868e96"), italic: true }, // gray, italic
    number: { fg: RGBA.fromHex("#ffd43b") }, // yellow
    default: { fg: RGBA.fromHex("#ffffff") }, // white
  })

  const codeExample = `function hello() {
  // This is a comment
  const message = "Hello, world!"
  const count = 42
  return message + " " + count
}`

  return (
    <box title="Code Syntax Highlighting Demo" width={60} height={15}>
      <code content={codeExample} filetype="javascript" syntaxStyle={syntaxStyle} />
    </box>
  )
}
