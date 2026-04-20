import { ok, err } from "neverthrow"
import { ConflictError, type AppError } from "@openzerg/common"
import type { Result } from "neverthrow"

const store = new Map<string, bigint>()

export function record(path: string, mtimeMs: bigint): void {
  store.set(path, mtimeMs)
}

export function assert(path: string, currentMtimeMs: bigint): Result<void, AppError> {
  const expected = store.get(path)
  if (expected === undefined) return ok(undefined)
  const tolerance = 50n
  const diff = currentMtimeMs > expected ? currentMtimeMs - expected : expected - currentMtimeMs
  if (diff > tolerance) {
    return err(new ConflictError(
      `File "${path}" was modified externally since last read (expected mtime=${expected}, actual=${currentMtimeMs}). Re-read the file before editing.`,
    ))
  }
  return ok(undefined)
}

export function clear(path: string): void {
  store.delete(path)
}
