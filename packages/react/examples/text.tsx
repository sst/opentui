import { createCliRenderer } from "@opentui/core"
import { createRoot } from "../src"

function App() {
  return (
    <text>
      Color Showcase{"\n"}
      <span fg="red">Red text</span> <span fg="green">Green text</span> <span fg="blue">Blue text</span>{" "}
      <span fg="yellow">Yellow text</span>
      {"\n"}
      <span fg="magenta">Magenta</span> <span fg="cyan">Cyan</span> <span fg="white">White</span>
      {"\n"}
      Background colors:{"\n"}
      <span fg="red" bg="yellow">
        Red on Yellow
      </span>{" "}
      <span fg="blue" bg="green">
        Blue on Green
      </span>{" "}
      <span fg="white" bg="magenta">
        White on Magenta
      </span>
      {"\n"}
      <span fg="yellow" bg="blue">
        Yellow on Blue
      </span>{" "}
      <span fg="green" bg="red">
        Green on Red
      </span>{" "}
      <span fg="cyan" bg="black">
        Cyan on Black
      </span>
      {"\n"}
      Bright colors:{"\n"}
      <span fg="brightRed">Bright Red</span> <span fg="brightGreen">Bright Green</span>{" "}
      <span fg="brightBlue">Bright Blue</span>
      {"\n"}
      <span fg="brightYellow">Bright Yellow</span> <span fg="brightMagenta">Bright Magenta</span>{" "}
      <span fg="brightCyan">Bright Cyan</span>
      {"\n"}
      Text Formatting:{"\n"}
      <strong>Strong/Bold text</strong> - <em>Emphasized/Italic text</em> - <u>Underlined text</u>
      {"\n"}
      <b fg="yellow">Bold yellow</b> - <i fg="green">Italic green</i> - <u fg="magenta">Underlined magenta</u>
      {"\n"}
      Complex nesting:{"\n"}
      <strong fg="red">
        Bold red with <em fg="blue">italic blue nested</em> inside
      </strong>
      {"\n"}
      <em>
        Italic with <u fg="cyan">underlined cyan</u> and <strong fg="yellow">bold yellow</strong>
      </em>
      {"\n"}
      <span bg="black" fg="white">
        Background with <strong fg="brightRed">bold bright red</strong> and{" "}
        <u fg="brightGreen">underlined bright green</u>
      </span>
      {"\n"}
    </text>
  )
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
