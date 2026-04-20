import { ok, err, type Result } from "neverthrow"
import { AppError, ValidationError } from "@openzerg/common"

export interface UpdateFileChunk {
  oldLines: string[]
  newLines: string[]
  changeContext?: string
  isEndOfFile?: boolean
}

export type Hunk =
  | { type: "add"; path: string; contents: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; movePath?: string; chunks: UpdateFileChunk[] }

function parsePatchHeader(
  lines: string[],
  startIdx: number,
): { filePath: string; movePath?: string; nextIdx: number } | null {
  const line = lines[startIdx]
  if (line.startsWith("*** Add File:")) {
    const filePath = line.slice("*** Add File:".length).trim()
    return filePath ? { filePath, nextIdx: startIdx + 1 } : null
  }
  if (line.startsWith("*** Delete File:")) {
    const filePath = line.slice("*** Delete File:".length).trim()
    return filePath ? { filePath, nextIdx: startIdx + 1 } : null
  }
  if (line.startsWith("*** Update File:")) {
    const filePath = line.slice("*** Update File:".length).trim()
    let movePath: string | undefined
    let nextIdx = startIdx + 1
    if (nextIdx < lines.length && lines[nextIdx].startsWith("*** Move to:")) {
      movePath = lines[nextIdx].slice("*** Move to:".length).trim()
      nextIdx++
    }
    return filePath ? { filePath, movePath, nextIdx } : null
  }
  return null
}

function parseAddFileContent(lines: string[], startIdx: number): { content: string; nextIdx: number } {
  let content = ""
  let i = startIdx
  while (i < lines.length && !lines[i].startsWith("***")) {
    if (lines[i].startsWith("+")) {
      content += lines[i].substring(1) + "\n"
    }
    i++
  }
  if (content.endsWith("\n")) content = content.slice(0, -1)
  return { content, nextIdx: i }
}

function parseUpdateFileChunks(lines: string[], startIdx: number): { chunks: UpdateFileChunk[]; nextIdx: number } {
  const chunks: UpdateFileChunk[] = []
  let i = startIdx
  while (i < lines.length && !lines[i].startsWith("***")) {
    if (lines[i].startsWith("@@")) {
      const contextLine = lines[i].substring(2).trim()
      i++
      const oldLines: string[] = []
      const newLines: string[] = []
      let isEndOfFile = false
      while (i < lines.length && !lines[i].startsWith("@@") && !(lines[i].startsWith("***") && lines[i] !== "*** End of File")) {
        const changeLine = lines[i]
        if (changeLine === "*** End of File") {
          isEndOfFile = true
          i++
          break
        }
        if (changeLine.startsWith(" ")) {
          oldLines.push(changeLine.substring(1))
          newLines.push(changeLine.substring(1))
        } else if (changeLine.startsWith("-")) {
          oldLines.push(changeLine.substring(1))
        } else if (changeLine.startsWith("+")) {
          newLines.push(changeLine.substring(1))
        }
        i++
      }
      chunks.push({
        oldLines,
        newLines,
        changeContext: contextLine || undefined,
        isEndOfFile: isEndOfFile || undefined,
      })
    } else {
      i++
    }
  }
  return { chunks, nextIdx: i }
}

export function parsePatch(patchText: string): Result<Hunk[], AppError> {
  const lines = patchText.split("\n")
  const hunks: Hunk[] = []

  const beginIdx = lines.findIndex(l => l.trim() === "*** Begin Patch")
  const endIdx = lines.findIndex(l => l.trim() === "*** End Patch")
  if (beginIdx === -1 || endIdx === -1 || beginIdx >= endIdx) {
    return err(new ValidationError("Invalid patch format: missing *** Begin Patch / *** End Patch markers"))
  }

  let i = beginIdx + 1
  while (i < endIdx) {
    const header = parsePatchHeader(lines, i)
    if (!header) { i++; continue }

    if (lines[i].startsWith("*** Add File:")) {
      const { content, nextIdx } = parseAddFileContent(lines, header.nextIdx)
      hunks.push({ type: "add", path: header.filePath, contents: content })
      i = nextIdx
    } else if (lines[i].startsWith("*** Delete File:")) {
      hunks.push({ type: "delete", path: header.filePath })
      i = header.nextIdx
    } else if (lines[i].startsWith("*** Update File:")) {
      const { chunks, nextIdx } = parseUpdateFileChunks(lines, header.nextIdx)
      hunks.push({ type: "update", path: header.filePath, movePath: header.movePath, chunks })
      i = nextIdx
    } else {
      i++
    }
  }
  return ok(hunks)
}

function tryMatch(
  lines: string[], pattern: string[], startIndex: number, eof: boolean,
): number {
  if (eof) {
    const fromEnd = lines.length - pattern.length
    if (fromEnd >= startIndex) {
      let matches = true
      for (let j = 0; j < pattern.length; j++) {
        if (lines[fromEnd + j] !== pattern[j]) { matches = false; break }
      }
      if (matches) return fromEnd
    }
  }
  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let matches = true
    for (let j = 0; j < pattern.length; j++) {
      if (lines[i + j] !== pattern[j]) { matches = false; break }
    }
    if (matches) return i
  }
  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let matches = true
    for (let j = 0; j < pattern.length; j++) {
      if (lines[i + j].trimEnd() !== pattern[j].trimEnd()) { matches = false; break }
    }
    if (matches) return i
  }
  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let matches = true
    for (let j = 0; j < pattern.length; j++) {
      if (lines[i + j].trim() !== pattern[j].trim()) { matches = false; break }
    }
    if (matches) return i
  }
  return -1
}

export function deriveNewContents(originalContent: string, chunks: UpdateFileChunk[], filePath: string): Result<string, AppError> {
  let fileLines = originalContent.split("\n")
  if (fileLines.length > 0 && fileLines[fileLines.length - 1] === "") {
    fileLines.pop()
  }

  const replacements: Array<[number, number, string[]]> = []
  let lineIdx = 0

  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const ci = tryMatch(fileLines, [chunk.changeContext], lineIdx, false)
      if (ci === -1) return err(new ValidationError(`Context not found in ${filePath}: ${chunk.changeContext}`))
      lineIdx = ci
    }

    if (chunk.oldLines.length === 0) {
      const ins = fileLines.length > 0 && fileLines[fileLines.length - 1] === ""
        ? fileLines.length - 1
        : fileLines.length
      replacements.push([ins, 0, chunk.newLines])
      continue
    }

    let pattern = chunk.oldLines
    let newSlice = chunk.newLines
    let found = tryMatch(fileLines, pattern, lineIdx, chunk.isEndOfFile ?? false)

    if (found === -1 && pattern.length > 0 && pattern[pattern.length - 1] === "") {
      pattern = pattern.slice(0, -1)
      if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
        newSlice = newSlice.slice(0, -1)
      }
      found = tryMatch(fileLines, pattern, lineIdx, chunk.isEndOfFile ?? false)
    }

    if (found !== -1) {
      replacements.push([found, pattern.length, newSlice])
      lineIdx = found + pattern.length
    } else {
      return err(new ValidationError(`Lines not found in ${filePath}:\n${chunk.oldLines.join("\n")}`))
    }
  }

  replacements.sort((a, b) => a[0] - b[0])

  const result = [...fileLines]
  for (let i = replacements.length - 1; i >= 0; i--) {
    const [start, oldLen, newSeg] = replacements[i]
    result.splice(start, oldLen, ...newSeg)
  }

  if (result.length === 0 || result[result.length - 1] !== "") {
    result.push("")
  }
  return ok(result.join("\n"))
}
