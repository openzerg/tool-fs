import type { ITool } from "@openzerg/common/tool-server-sdk"
import { z } from "zod"
import { ok, err, type Result, ResultAsync } from "neverthrow"
import { AppError } from "@openzerg/common"
import { RemoteFS } from "../remote-fs.js"
import { parseArgs, resolvePath, MAX_RESULTS } from "./shared.js"

const GlobSchema = z.object({ pattern: z.string(), path: z.string().optional() })

export const globTool: ITool = {
  name: "glob",
  description: "Find files matching a glob pattern using ripgrep. Sorted by mtime, capped at 100.",
  group: "filesystem",
  priority: 10,
  dependencies: [],
  pkgs: ["ripgrep"],
  inputSchema: {
    type: "object",
    properties: { pattern: { type: "string" }, path: { type: "string" } },
    required: ["pattern"],
  },
  outputSchema: { type: "object", properties: { files: { type: "array", items: { type: "object" } } } },
  execute(argsJson, sessionToken, getContext): ResultAsync<unknown, AppError> {
    return new ResultAsync((async (): Promise<Result<unknown, AppError>> => {
      const argsR = parseArgs(GlobSchema, argsJson)
      if (argsR.isErr()) return err(argsR.error)
      const args = argsR.value
      const ctx = await getContext(sessionToken)
      const fs = new RemoteFS(ctx)
      const base = args.path ? resolvePath(ctx, args.path) : ctx.workspaceRoot

      const outR = await fs.exec(`rg --files --glob '${args.pattern}' ${JSON.stringify(base)} || true`)
      if (outR.isErr()) return err(outR.error)
      const rawFiles = outR.value.trim().split("\n").filter(Boolean)

      const files = []
      for (const f of rawFiles) {
        if (files.length >= MAX_RESULTS) break
        const rel = f.slice(base.length + 1)
        const infoR = await fs.stat(f)
        if (infoR.isErr()) return err(infoR.error)
        files.push({ path: rel, size: Number(infoR.value.size), mtimeMs: Number(infoR.value.mtimeMs) })
      }

      files.sort((a, b) => b.mtimeMs - a.mtimeMs)

      const truncated = rawFiles.length > MAX_RESULTS
      return ok({
        files,
        ...(truncated ? { warning: `Results truncated to ${MAX_RESULTS} files (${rawFiles.length} total matches)` } : {}),
      })
    })())
  },
}
