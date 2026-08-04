import { BoxRenderable } from "../index.js"
import { StdinParser } from "../lib/stdin-parser.js"
import type { Renderable } from "../Renderable.js"
import { MouseEvent } from "../renderer.js"
import { createTestRenderer } from "../testing.js"
import type { BenchmarkCase } from "./js-benchmark-harness.js"

const WIDTH = 140
const HEIGHT = 44
const LEAF_COUNT = 96
const YOGA_NODE_COUNT = 100

export const defaultBenchmarkCases: readonly BenchmarkCase[] = [
  layoutLeafWidthCase(),
  yogaLayoutReadsCase(),
  mouseCase("direct-bubble-depth-8", false),
  mouseCase("stdin-sgr-bubble-depth-8", true),
]

function layoutLeafWidthCase(): BenchmarkCase {
  return {
    category: "JS Layout",
    name: "leaf-width-calculate",
    workload_version: 1,
    parameters: { width: WIDTH, height: HEIGHT, nodes: LEAF_COUNT },
    async setup() {
      const { renderer } = await createTestRenderer({ width: WIDTH, height: HEIGHT })
      const root = new BoxRenderable(renderer, { width: "100%", height: "100%", flexDirection: "column" })
      renderer.root.add(root)
      const leaves = Array.from({ length: LEAF_COUNT }, (_, index) => {
        const leaf = new BoxRenderable(renderer, { width: index % 2 === 0 ? 6 : 11, height: 1, flexShrink: 0 })
        root.add(leaf)
        return leaf
      })
      renderer.root.calculateLayout()
      let completed = 0
      let validated = 0
      let checksum = layoutChecksum(leaves)
      const expectedChecksumPrefix = expectedLeafChecksumPrefix()
      const narrow = new Array<boolean>(leaves.length).fill(false)

      return {
        run(iteration) {
          const target = iteration % leaves.length
          const leaf = leaves[target]!
          narrow[target] = !narrow[target]
          leaf.width = narrow[target] ? 13 : 7
          if (!renderer.root.getLayoutNode().isDirty()) throw new Error("leaf width mutation did not dirty layout")
          renderer.root.calculateLayout()
          if (renderer.root.getLayoutNode().isDirty()) throw new Error("layout remained dirty after calculation")
          checksum = (checksum + layoutChecksum(leaves)) | 0
          completed++
        },
        validateBatch(iterations) {
          const actual = completed - validated
          if (actual !== iterations) {
            throw new Error(`leaf-width-calculate: completed ${actual} operations, expected ${iterations}`)
          }
          const expected = expectedLeafChecksum(expectedChecksumPrefix, completed)
          if (checksum !== expected) {
            throw new Error(`leaf-width-calculate: batch checksum ${checksum}, expected ${expected}`)
          }
          validated = completed
        },
        teardown: () => renderer.destroy(),
      }
    },
  }
}

function yogaLayoutReadsCase(): BenchmarkCase {
  return {
    category: "JS Render",
    name: "yoga-layout-reads-100",
    workload_version: 1,
    parameters: { width: WIDTH, height: HEIGHT, nodes: YOGA_NODE_COUNT },
    async setup() {
      const { renderer, renderOnce } = await createTestRenderer({ width: WIDTH, height: HEIGHT })
      const root = new BoxRenderable(renderer, { width: "100%", flexDirection: "column" })
      renderer.root.add(root)
      const nodes = Array.from({ length: YOGA_NODE_COUNT }, (_, index) => {
        const node = new BoxRenderable(renderer, { width: "100%", height: 1, flexShrink: 0 })
        root.add(node)
        return node.getLayoutNode()
      })
      await renderOnce()
      try {
        validateYogaFixture(nodes)
      } catch (error) {
        renderer.destroy()
        throw error
      }
      const expectedChecksum = YOGA_NODE_COUNT * (WIDTH + 1) + YOGA_NODE_COUNT * (YOGA_NODE_COUNT - 1)
      let completed = 0
      let validated = 0
      let checksum = 0

      return {
        run() {
          for (let index = 0; index < nodes.length; index++) {
            const layout = nodes[index]!.getComputedLayout()
            checksum = (checksum + layout.left + layout.top + layout.width + layout.height + index) | 0
          }
          completed++
        },
        validateBatch(iterations) {
          validateYogaFixture(nodes)
          const actual = completed - validated
          if (actual !== iterations) {
            throw new Error(`yoga-layout-reads-100: completed ${actual} operations, expected ${iterations}`)
          }
          const expected = (expectedChecksum * completed) | 0
          if (checksum !== expected) {
            throw new Error(`yoga-layout-reads-100: batch checksum ${checksum}, expected ${expected}`)
          }
          validated = completed
        },
        teardown: () => renderer.destroy(),
      }
    },
  }
}

function mouseCase(name: string, stdin: boolean): BenchmarkCase {
  const depth = 8
  return {
    category: "JS Mouse",
    name,
    workload_version: 1,
    parameters: { width: 10, height: 10, depth, input: stdin ? "stdin-sgr" : "direct" },
    async setup() {
      const { renderer, renderOnce } = await createTestRenderer({ width: 10, height: 10 })
      let parent: Renderable = renderer.root
      let leaf: Renderable = renderer.root
      let handled = 0
      for (let index = 0; index < depth; index++) {
        const child = new BoxRenderable(renderer, { width: 10, height: 10 })
        child.onMouse = () => handled++
        parent.add(child)
        parent = child
        leaf = child
      }
      const event = new MouseEvent(leaf, {
        type: "move",
        button: 0,
        x: 1,
        y: 1,
        modifiers: { shift: false, alt: false, ctrl: false },
      })
      const sequence = Buffer.from("\x1b[<35;2;2M")
      let validationParser: StdinParser | undefined
      if (stdin) {
        await renderOnce()
        renderer.stdin.emit("data", sequence)
        validationParser = new StdinParser({ armTimeouts: false })
        try {
          validateSgrMove(validationParser, sequence)
        } catch (error) {
          validationParser.destroy()
          renderer.destroy()
          throw error
        }
      }
      let validated = handled

      return {
        run() {
          if (stdin) renderer.stdin.emit("data", sequence)
          else leaf.processMouseEvent(event)
        },
        validateBatch(iterations) {
          if (validationParser) validateSgrMove(validationParser, sequence)
          const actual = handled - validated
          const expected = iterations * depth
          if (actual !== expected) throw new Error(`${name}: dispatched ${actual} handlers, expected ${expected}`)
          validated = handled
        },
        teardown() {
          validationParser?.destroy()
          renderer.destroy()
        },
      }
    },
  }
}

function validateYogaFixture(nodes: readonly ReturnType<BoxRenderable["getLayoutNode"]>[]): void {
  for (let index = 0; index < nodes.length; index++) {
    const layout = nodes[index]!.getComputedLayout()
    if (
      layout.left !== 0 ||
      layout.top !== index ||
      layout.right !== 0 ||
      layout.bottom !== 0 ||
      layout.width !== WIDTH ||
      layout.height !== 1
    ) {
      throw new Error(
        `yoga-layout-reads-100: node ${index} fixture geometry ${JSON.stringify(layout)}, expected ` +
          `left=0 top=${index} right=0 bottom=0 width=${WIDTH} height=1`,
      )
    }
  }
}

function validateSgrMove(parser: StdinParser, sequence: Buffer): void {
  parser.push(sequence)
  const decoded = parser.read()
  const trailing = parser.read()
  const event = decoded?.type === "mouse" ? decoded.event : undefined
  if (
    decoded?.type !== "mouse" ||
    decoded.encoding !== "sgr" ||
    decoded.raw !== sequence.toString("latin1") ||
    event?.type !== "move" ||
    event.button !== 0 ||
    event.x !== 1 ||
    event.y !== 1 ||
    event.modifiers.shift ||
    event.modifiers.alt ||
    event.modifiers.ctrl ||
    event.scroll !== undefined ||
    trailing !== null
  ) {
    throw new Error(`stdin-sgr-bubble-depth-8: fixed SGR bytes decoded incorrectly: ${JSON.stringify(decoded)}`)
  }
}

function layoutChecksum(renderables: readonly BoxRenderable[]): number {
  let checksum = 0
  for (let index = 0; index < renderables.length; index++) {
    const layout = renderables[index]!.getLayoutNode().getComputedLayout()
    checksum = (checksum + layout.left * 3 + layout.top * 5 + layout.width * 7 + layout.height * 11 + index) | 0
  }
  return checksum
}

function expectedLeafChecksumPrefix(): number[] {
  const widths: number[] = Array.from({ length: LEAF_COUNT }, (_, index) => (index % 2 === 0 ? 6 : 11))
  let operationChecksum = widths.reduce((sum, width, index) => sum + index * 6 + width * 7 + 11, 0)
  const prefix = [operationChecksum]

  // The first two passes replace the fixture's alternating widths. Thereafter, two passes form a stable cycle.
  for (let iteration = 0; iteration < LEAF_COUNT * 4; iteration++) {
    const target = iteration % LEAF_COUNT
    const width = Math.floor(iteration / LEAF_COUNT) % 2 === 0 ? 13 : 7
    operationChecksum += (width - widths[target]!) * 7
    widths[target] = width
    prefix.push((prefix[prefix.length - 1]! + operationChecksum) | 0)
  }

  return prefix
}

function expectedLeafChecksum(prefix: readonly number[], operations: number): number {
  const cycleLength = LEAF_COUNT * 2
  if (operations <= cycleLength) return prefix[operations]!

  const periodicOperations = operations - cycleLength
  const completeCycles = Math.floor(periodicOperations / cycleLength)
  const remainder = periodicOperations % cycleLength
  const cycleChecksum = prefix[cycleLength * 2]! - prefix[cycleLength]!
  return (prefix[cycleLength + remainder]! + completeCycles * cycleChecksum) | 0
}
