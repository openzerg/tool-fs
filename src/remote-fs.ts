import type { ToolContext } from "@openzerg/common/tool-server-sdk"
import { WorkerClient, InternalError, type AppError } from "@openzerg/common"
import { ok, err, type ResultAsync } from "neverthrow"

export interface FileContent {
  text: string
  mtimeMs: bigint
}

export interface FileInfo {
  exists: boolean
  isFile: boolean
  isDir: boolean
  size: bigint
  mtimeMs: bigint
}

export class RemoteFS {
  private client: WorkerClient

  constructor(ctx: ToolContext) {
    this.client = new WorkerClient({ baseURL: ctx.workerUrl, token: ctx.workerSecret })
  }

  readFile(path: string): ResultAsync<FileContent, AppError> {
    return this.client.readFile(path).map(resp => ({
      text: new TextDecoder().decode(resp.content),
      mtimeMs: resp.mtimeMs,
    }))
  }

  readBinary(path: string): ResultAsync<{ data: Uint8Array; mtimeMs: bigint }, AppError> {
    return this.client.readFile(path).map(resp => ({ data: resp.content, mtimeMs: resp.mtimeMs }))
  }

  writeFile(path: string, content: string | Uint8Array, expectedMtimeMs?: bigint): ResultAsync<bigint, AppError> {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content
    return this.client.writeFile({
      path,
      content: bytes,
      expectedMtimeMs: expectedMtimeMs ?? 0n,
    }).map(resp => resp.actualMtimeMs)
  }

  stat(path: string): ResultAsync<FileInfo, AppError> {
    return this.client.stat(path).map(resp => ({
      exists: resp.exists,
      isFile: resp.isFile,
      isDir: resp.isDir,
      size: resp.size,
      mtimeMs: resp.mtimeMs,
    }))
  }

  exec(command: string, workdir?: string): ResultAsync<string, AppError> {
    return this.client.exec({ command, workdir }).andThen((resp) => {
      if (resp.exitCode !== 0) {
        const stderr = new TextDecoder().decode(resp.stderr)
        return err(new InternalError(stderr))
      }
      return ok(new TextDecoder().decode(resp.stdout))
    })
  }
}
