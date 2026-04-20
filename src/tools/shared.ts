import type { ToolContext } from "@openzerg/common/tool-server-sdk"
export { parseArgs } from "@openzerg/common/tool-server-sdk"

export const MAX_BYTES = 50_000
export const MAX_LINE_LENGTH = 2000
export const MAX_RESULTS = 100

export const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svg",
  "mp3", "mp4", "wav", "avi", "mov", "mkv", "flac",
  "zip", "gz", "tar", "bz2", "xz", "7z", "rar",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "woff", "woff2", "ttf", "otf", "eot",
  "so", "dll", "exe", "bin", "dat", "db", "sqlite",
])

export function resolvePath(ctx: ToolContext, p: string): string {
  if (p.startsWith("/")) return p
  return `${ctx.workspaceRoot}/${p}`.replace(/\/+/g, "/")
}

export function isBinaryPath(p: string): boolean {
  const ext = p.split(".").pop()?.toLowerCase() ?? ""
  return BINARY_EXTENSIONS.has(ext)
}

export function isBinaryContent(data: Uint8Array): boolean {
  const sample = data.slice(0, 4096)
  let nonPrintable = 0
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i]
    if (b === 0) return true
    if (b < 32 && b !== 9 && b !== 10 && b !== 13) nonPrintable++
  }
  return sample.length > 0 && nonPrintable / sample.length > 0.3
}

export function formatWithLineNumbers(text: string, offset?: number, limit?: number): string {
  let lines = text.split("\n")
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()

  const startLine = offset ?? 1
  const effectiveLimit = limit ?? 2000
  const sliced = lines.slice(startLine - 1, startLine - 1 + effectiveLimit)

  let truncated = 0
  const formatted = sliced.map((line, i) => {
    const lineNum = startLine + i
    if (line.length > MAX_LINE_LENGTH) {
      truncated++
      return `${lineNum}: ${line.substring(0, MAX_LINE_LENGTH)}... [truncated]`
    }
    return `${lineNum}: ${line}`
  })

  const totalBytes = formatted.join("\n").length
  if (totalBytes > MAX_BYTES) {
    const cutoff = formatted.length - Math.ceil((totalBytes - MAX_BYTES) / 100)
    return formatted.slice(0, Math.max(0, cutoff)).join("\n") + `\n... [output truncated at ${MAX_BYTES} bytes]`
  }

  const header = truncated > 0 ? `[${truncated} lines truncated to ${MAX_LINE_LENGTH} chars]\n` : ""
  return header + formatted.join("\n")
}

export function generateDiff(oldContent: string, newContent: string, path: string): string {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")
  const result: string[] = [`--- a/${path}`, `+++ b/${path}`]

  let i = 0
  while (i < oldLines.length || i < newLines.length) {
    if (i < oldLines.length && i < newLines.length && oldLines[i] === newLines[i]) {
      i++
      continue
    }
    const start = Math.max(0, i - 3)
    const end = Math.min(Math.max(oldLines.length, newLines.length), i + 10)
    result.push(`@@ -${start + 1},${end - start} +${start + 1},${end - start} @@`)
    for (let j = start; j < end; j++) {
      const oldMatch = j < oldLines.length
      const newMatch = j < newLines.length
      if (oldMatch && newMatch && oldLines[j] === newLines[j]) {
        result.push(` ${oldLines[j]}`)
      } else {
        if (oldMatch) result.push(`-${oldLines[j]}`)
        if (newMatch) result.push(`+${newLines[j]}`)
      }
    }
    i = end
  }
  return result.join("\n")
}
