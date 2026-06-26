export interface ShadowCinemaArgs {
  videoPath: string
}

export function parseShadowCinemaArgs(args: readonly string[]): ShadowCinemaArgs {
  let videoPath: string | undefined
  let positionalOnly = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument === "--") {
      positionalOnly = true
      continue
    }
    if (!positionalOnly && argument === "--video") {
      const value = args[index + 1]
      if (!value || value === "--" || value === "--video") throw new Error("--video requires an MP4 path")
      if (videoPath) throw new Error("Specify exactly one video path")
      videoPath = value
      index += 1
      continue
    }
    if (!positionalOnly && argument.startsWith("-")) throw new Error(`Unknown argument: ${argument}`)
    if (videoPath) throw new Error("Specify exactly one video path")
    videoPath = argument
  }

  if (!videoPath) throw new Error("A local H.264/AAC MP4 path is required")
  return { videoPath }
}
