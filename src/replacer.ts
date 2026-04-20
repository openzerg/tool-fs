import { ok, err, type Result } from "neverthrow"
import { AppError, NotFoundError, ValidationError } from "@openzerg/common"

export type Replacer = (content: string, find: string) => Generator<string, void, unknown>

function levenshtein(a: string, b: string): number {
  if (a === "" || b === "") return Math.max(a.length, b.length)
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[i - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
    }
  }
  return matrix[a.length][b.length]
}

const SINGLE_THRESHOLD = 0.0
const MULTI_THRESHOLD = 0.3

export const SimpleReplacer: Replacer = function* (_content, find) {
  yield find
}

export const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")
  if (searchLines[searchLines.length - 1] === "") searchLines.pop()

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true
    for (let j = 0; j < searchLines.length; j++) {
      if (originalLines[i + j].trim() !== searchLines[j].trim()) { matches = false; break }
    }
    if (matches) {
      let start = 0
      for (let k = 0; k < i; k++) start += originalLines[k].length + 1
      let end = start
      for (let k = 0; k < searchLines.length; k++) {
        end += originalLines[i + k].length
        if (k < searchLines.length - 1) end += 1
      }
      yield content.substring(start, end)
    }
  }
}

export const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")
  if (searchLines.length < 3) return
  if (searchLines[searchLines.length - 1] === "") searchLines.pop()

  const firstLine = searchLines[0].trim()
  const lastLine = searchLines[searchLines.length - 1].trim()

  const candidates: Array<{ startLine: number; endLine: number }> = []
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLine) continue
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLine) {
        candidates.push({ startLine: i, endLine: j })
        break
      }
    }
  }
  if (candidates.length === 0) return

  const scoreCandidate = (c: { startLine: number; endLine: number }) => {
    const blockSize = c.endLine - c.startLine + 1
    const linesToCheck = Math.min(searchLines.length - 2, blockSize - 2)
    if (linesToCheck <= 0) return 1.0
    let sim = 0
    for (let j = 1; j < searchLines.length - 1 && j < blockSize - 1; j++) {
      const oLine = originalLines[c.startLine + j].trim()
      const sLine = searchLines[j].trim()
      const maxLen = Math.max(oLine.length, sLine.length)
      if (maxLen === 0) continue
      sim += (1 - levenshtein(oLine, sLine) / maxLen) / linesToCheck
    }
    return sim
  }

  if (candidates.length === 1) {
    if (scoreCandidate(candidates[0]) >= SINGLE_THRESHOLD) {
      const { startLine, endLine } = candidates[0]
      let start = 0
      for (let k = 0; k < startLine; k++) start += originalLines[k].length + 1
      let end = start
      for (let k = startLine; k <= endLine; k++) { end += originalLines[k].length; if (k < endLine) end += 1 }
      yield content.substring(start, end)
    }
    return
  }

  let best: typeof candidates[0] | null = null
  let maxSim = -1
  for (const c of candidates) {
    const sim = scoreCandidate(c)
    if (sim > maxSim) { maxSim = sim; best = c }
  }
  if (maxSim >= MULTI_THRESHOLD && best) {
    const { startLine, endLine } = best
    let start = 0
    for (let k = 0; k < startLine; k++) start += originalLines[k].length + 1
    let end = start
    for (let k = startLine; k <= endLine; k++) { end += originalLines[k].length; if (k < endLine) end += 1 }
    yield content.substring(start, end)
  }
}

export const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim()
  const normalizedFind = norm(find)
  const lines = content.split("\n")
  for (const line of lines) {
    if (norm(line) === normalizedFind) { yield line; continue }
    if (norm(line).includes(normalizedFind)) {
      const words = find.trim().split(/\s+/)
      if (words.length > 0) {
        const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")
        let match: RegExpMatchArray | null = null
        try { match = line.match(new RegExp(pattern)) } catch { /* skip bad regex */ }
        if (match?.[0]) yield match[0]
      }
    }
  }
  const findLines = find.split("\n")
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length)
      if (norm(block.join("\n")) === normalizedFind) yield block.join("\n")
    }
  }
}

export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const removeIndent = (text: string) => {
    const lines = text.split("\n")
    const nonEmpty = lines.filter(l => l.trim().length > 0)
    if (nonEmpty.length === 0) return text
    const minIndent = Math.min(...nonEmpty.map(l => { const m = l.match(/^(\s*)/); return m ? m[1].length : 0 }))
    return lines.map(l => (l.trim().length === 0 ? l : l.slice(minIndent))).join("\n")
  }
  const normalizedFind = removeIndent(find)
  const contentLines = content.split("\n")
  const findLines = find.split("\n")
  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join("\n")
    if (removeIndent(block) === normalizedFind) yield block
  }
}

export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  const unescape = (s: string): string =>
    s.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (_m, c: string) => {
      const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", "'": "'", '"': '"', "`": "`", "\\": "\\", "\n": "\n", $: "$" }
      return map[c] ?? c
    })
  const unescapedFind = unescape(find)
  if (content.includes(unescapedFind)) yield unescapedFind
  const lines = content.split("\n")
  const findLines = unescapedFind.split("\n")
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    if (unescape(block) === unescapedFind) yield block
  }
}

export const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmedFind = find.trim()
  if (trimmedFind === find) return
  if (content.includes(trimmedFind)) yield trimmedFind
  const lines = content.split("\n")
  const findLines = find.split("\n")
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    if (block.trim() === trimmedFind) yield block
  }
}

export const ContextAwareReplacer: Replacer = function* (content, find) {
  const findLines = find.split("\n")
  if (findLines.length < 3) return
  if (findLines[findLines.length - 1] === "") findLines.pop()
  const contentLines = content.split("\n")
  const firstLine = findLines[0].trim()
  const lastLine = findLines[findLines.length - 1].trim()

  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue
    for (let j = i + 2; j < contentLines.length; j++) {
      if (contentLines[j].trim() === lastLine) {
        const blockLines = contentLines.slice(i, j + 1)
        if (blockLines.length === findLines.length) {
          let matching = 0
          let total = 0
          for (let k = 1; k < blockLines.length - 1; k++) {
            const bLine = blockLines[k].trim()
            const fLine = findLines[k].trim()
            if (bLine.length > 0 || fLine.length > 0) {
              total++
              if (bLine === fLine) matching++
            }
          }
          if (total === 0 || matching / total >= 0.5) {
            yield blockLines.join("\n")
            return
          }
        }
        break
      }
    }
  }
}

export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  let start = 0
  while (true) {
    const idx = content.indexOf(find, start)
    if (idx === -1) break
    yield find
    start = idx + find.length
  }
}

const REPLACERS: Replacer[] = [
  SimpleReplacer,
  LineTrimmedReplacer,
  BlockAnchorReplacer,
  WhitespaceNormalizedReplacer,
  IndentationFlexibleReplacer,
  EscapeNormalizedReplacer,
  TrimmedBoundaryReplacer,
  ContextAwareReplacer,
  MultiOccurrenceReplacer,
]

export function fuzzyReplace(content: string, oldString: string, newString: string, replaceAll = false): Result<string, AppError> {
  if (oldString === newString) {
    return err(new ValidationError("No changes to apply: oldString and newString are identical."))
  }

  let notFound = true
  for (const replacer of REPLACERS) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search)
      if (index === -1) continue
      notFound = false
      if (replaceAll) return ok(content.replaceAll(search, newString))
      const lastIndex = content.lastIndexOf(search)
      if (index !== lastIndex) continue
      return ok(content.substring(0, index) + newString + content.substring(index + search.length))
    }
  }

  if (notFound) {
    return err(new NotFoundError("Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings."))
  }
  return err(new ValidationError("Found multiple matches for oldString. Provide more surrounding context to make the match unique."))
}
