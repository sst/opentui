interface AudioFileArgs {
  filePath?: string
}

export function parseAudioFileArgs(args: readonly string[]): AudioFileArgs {
  let filePath: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument === "--") continue
    if (argument !== "-f" && argument !== "--file") throw new Error(`Unknown argument: ${argument}`)

    const value = args[index + 1]
    if (!value || value === "--" || value === "-f" || value === "--file") {
      throw new Error(`${argument} requires an audio file path`)
    }
    filePath = value
    index += 1
  }
  return { filePath }
}
