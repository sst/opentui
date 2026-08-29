import { createConnection } from "node:net"
import { join } from "node:path"

interface Window {
  address: string
  class: string
  initialClass: string
  pid: number
  floating: boolean
  xwayland: boolean
  size: [number, number]
}

// Restrict geometry changes to the runner's unique, newly created window class.
export async function sizeBenchmarkWindow(windowClass: string, dimensions: string) {
  if (!/^org\.opentui\.magick\.b[0-9a-f]+$/.test(windowClass)) throw new Error("Invalid benchmark window class")
  const size = dimensions.split("x").map(Number)
  if (size.length !== 2 || size.some((value) => !Number.isInteger(value) || value < 100 || value > 4096)) {
    throw new Error("--window-size must be WIDTHxHEIGHT in Hyprland logical pixels, between 100 and 4096")
  }
  const signature = process.env.HYPRLAND_INSTANCE_SIGNATURE
  const runtime = process.env.XDG_RUNTIME_DIR
  if (!signature || !runtime) throw new Error("--window-size requires Hyprland")
  const window = await new Promise<Window>((resolve, reject) => {
    const socket = createConnection(join(runtime, "hypr", signature, ".socket2.sock"))
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error("Benchmark window did not appear"))
    }, 5000)
    const inspect = () => {
      try {
        const command = Bun.spawnSync(["hyprctl", "-j", "clients"])
        if (command.exitCode !== 0) throw new Error(command.stderr.toString())
        const windows: Window[] = JSON.parse(command.stdout.toString())
        const match = windows.find((entry) => entry.class === windowClass || entry.initialClass === windowClass)
        if (!match) return
        clearTimeout(timer)
        socket.destroy()
        resolve(match)
      } catch (error) {
        clearTimeout(timer)
        socket.destroy()
        reject(error)
      }
    }
    socket.on("connect", inspect)
    socket.on("data", inspect)
    socket.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
  if (!/^0x[0-9a-f]+$/.test(window.address)) throw new Error("Invalid window address from Hyprland")
  const selector = `address:${window.address}`
  for (const dispatch of [
    `hl.dsp.window.set_prop({prop="no_anim",value="1",window="${selector}"})`,
    `hl.dsp.window.float({action="set",window="${selector}"})`,
    `hl.dsp.window.resize({x=${size[0]},y=${size[1]},relative=false,window="${selector}"})`,
  ]) {
    const command = Bun.spawnSync(["hyprctl", "dispatch", dispatch])
    if (command.exitCode !== 0 || command.stdout.toString().trim() !== "ok")
      throw new Error(`Cannot size benchmark window: ${command.stdout.toString()} ${command.stderr.toString()}`)
  }
  const current: Window[] = JSON.parse(Bun.spawnSync(["hyprctl", "-j", "clients"]).stdout.toString())
  const actual = current.find((entry) => entry.address === window.address)
  if (!actual?.floating || actual.size[0] !== size[0] || actual.size[1] !== size[1])
    throw new Error(`Window geometry was not applied: ${JSON.stringify(actual)}`)
  return { address: actual.address, class: actual.class, pid: actual.pid, size: actual.size, xwayland: actual.xwayland }
}
