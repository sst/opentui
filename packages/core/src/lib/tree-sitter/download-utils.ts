import { mkdir, writeFile } from "fs/promises"
import * as path from "path"

export interface DownloadResult {
  content?: ArrayBuffer
  filePath?: string
  error?: string
}

export class DownloadUtils {
  private static hashUrl(url: string): string {
    let hash = 0
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    return Math.abs(hash).toString(16)
  }

  /**
   * Download a file from URL or load from local path, with caching support
   */
  static async downloadOrLoad(
    source: string,
    cacheDir: string,
    cacheSubdir: string,
    fileExtension: string,
    useHashForCache: boolean = true,
    filetype?: string,
  ): Promise<DownloadResult> {
    const isUrl = source.startsWith("http://") || source.startsWith("https://")

    if (isUrl) {
      let cacheFileName: string
      if (useHashForCache) {
        const hash = this.hashUrl(source)
        cacheFileName = filetype ? `${filetype}-${hash}${fileExtension}` : `${hash}${fileExtension}`
      } else {
        cacheFileName = path.basename(source)
      }
      const cacheFile = path.join(cacheDir, cacheSubdir, cacheFileName)

      // Ensure cache directory exists
      await mkdir(path.dirname(cacheFile), { recursive: true })

      try {
        const cachedContent = await Bun.file(cacheFile).arrayBuffer()
        if (cachedContent.byteLength > 0) {
          console.log(`Loaded from cache: ${cacheFile} (${source})`)
          return { content: cachedContent, filePath: cacheFile }
        }
      } catch (error) {
        // Cache miss, continue to fetch
      }

      try {
        console.log(`Downloading from URL: ${source}`)
        const response = await fetch(source)
        if (!response.ok) {
          return { error: `Failed to fetch from ${source}: ${response.statusText}` }
        }
        const content = await response.arrayBuffer()

        try {
          await writeFile(cacheFile, Buffer.from(content))
          console.log(`Cached: ${source}`)
        } catch (cacheError) {
          console.warn(`Failed to cache: ${cacheError}`)
        }

        return { content, filePath: cacheFile }
      } catch (error) {
        return { error: `Error downloading from ${source}: ${error}` }
      }
    } else {
      try {
        console.log(`Loading from local path: ${source}`)
        const content = await Bun.file(source).arrayBuffer()
        return { content, filePath: source }
      } catch (error) {
        return { error: `Error loading from local path ${source}: ${error}` }
      }
    }
  }

  /**
   * Download and save a file to a specific target path
   */
  static async downloadToPath(source: string, targetPath: string): Promise<DownloadResult> {
    const isUrl = source.startsWith("http://") || source.startsWith("https://")

    await mkdir(path.dirname(targetPath), { recursive: true })

    if (isUrl) {
      try {
        console.log(`Downloading from URL: ${source}`)
        const response = await fetch(source)
        if (!response.ok) {
          return { error: `Failed to fetch from ${source}: ${response.statusText}` }
        }
        const content = await response.arrayBuffer()

        await writeFile(targetPath, Buffer.from(content))
        console.log(`Downloaded: ${source} -> ${targetPath}`)

        return { content, filePath: targetPath }
      } catch (error) {
        return { error: `Error downloading from ${source}: ${error}` }
      }
    } else {
      try {
        console.log(`Copying from local path: ${source}`)
        const content = await Bun.file(source).arrayBuffer()
        await writeFile(targetPath, Buffer.from(content))
        return { content, filePath: targetPath }
      } catch (error) {
        return { error: `Error copying from local path ${source}: ${error}` }
      }
    }
  }

  /**
   * Fetch multiple highlight queries and concatenate them
   */
  static async fetchHighlightQueries(sources: string[], cacheDir: string, filetype: string): Promise<string> {
    const queryPromises = sources.map((source) => this.fetchHighlightQuery(source, cacheDir, filetype))
    const queryResults = await Promise.all(queryPromises)

    const validQueries = queryResults.filter((query) => query.trim().length > 0)
    return validQueries.join("\n")
  }

  private static async fetchHighlightQuery(source: string, cacheDir: string, filetype: string): Promise<string> {
    const result = await this.downloadOrLoad(source, cacheDir, "queries", ".scm", true, filetype)

    if (result.error) {
      console.error(`Error fetching highlight query from ${source}:`, result.error)
      return ""
    }

    if (result.content) {
      return new TextDecoder().decode(result.content)
    }

    return ""
  }
}
