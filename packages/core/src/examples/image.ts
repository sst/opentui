import { readFileSync } from "fs"
import { PNG } from "pngjs"

import { createCliRenderer, BoxRenderable, ImageRenderable, type KeyEvent } from "../index"

function loadImage(path: string): { data: Uint8Array, width: number, height: number } {
  const file = readFileSync(path)
  const { data: pngData, width, height } = PNG.sync.read(file)
  const buffer = Buffer.from(pngData)
  const data = new Uint8Array(buffer)
  return { data, width, height }
}

// load snake png
const { data: snake, width: snakeWidth, height: snakeHeight } = loadImage(`${__dirname}/assets/snake.png`)
const { data: blue, width: blueWidth, height: blueHeight } = loadImage(`${__dirname}/assets/blue.png`)

// copy original image
var newData = new Uint8Array(snake.length)
for (let i = 0; i < snake.length; i++) newData[i]   = snake[i]

// update image data in place
function shadeImage(data: Uint8Array, col: number): Uint8Array {
  if (newData.length != data.length) newData = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i += 4) {
    const z = 1 - Math.cos(Math.PI/2 * col)
    newData[i+3] = Math.round(data[i+3] * z)
  }
  return newData
}

// start renderer
const renderer = await createCliRenderer()

// ui state
var div = 50
var px = 0
var py = 0
var vx = 1
var vy = 1
var col = 1
var iter = 0

// run animations
renderer.setFrameCallback(async (deltaTime: number) => {
  if (iter == 0) {
    iter++
    return
  }

  px += vx * deltaTime / 100
  py += vy * deltaTime / 100

  if (iter > 10 && iter % 5 == 0) col = (col + deltaTime / 250) % 2
  const shade = col > 1 ? 2 - col : col
  const newData = shadeImage(snake, shade)

  if (px < 0) vx = 1
  if (py < 0) vy = 1
  if (px + image2.width > box2.width - 2) vx = -1
  if (py + image2.height > box2.height - 1) vy = -1

  image2.left = px
  image2.top = py
  image1.data = newData

  iter++
})

// set initial division
renderer.keyInput.on("keypress", (key: KeyEvent) => {
  if (key.name === "left") {
    div = Math.max(20, div - 1)
  } else if (key.name === "right") {
    div = Math.min(80, div + 1)
  }
  box1.width = `${div}%`
  box2.width = `${100-div}%`
})

// make image renderer
const image1 = new ImageRenderable(renderer, { data: snake, imageWidth: snakeWidth, imageHeight: snakeHeight })
const image2 = new ImageRenderable(renderer, { data: blue, imageWidth: blueWidth, imageHeight: blueHeight })

// left image box
const box1 = new BoxRenderable(renderer, { width: `${div}%`, border: true, justifyContent: "center", alignItems: "center" })
box1.add(image1)

// right image box
const box2 = new BoxRenderable(renderer, { width: `${100-div}%`, border: true })
box2.add(image2)

// outer box
const outer = new BoxRenderable(renderer, { height: "50%", width: "100%", flexDirection: "row" })
outer.add(box1)
outer.add(box2)

// add outer box to root
renderer.root.add(outer)
