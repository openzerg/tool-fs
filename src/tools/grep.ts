import type { ITool } from "@openzerg/common/tool-server-sdk"
import { z } from "zod"
import { ok, err, type Result, ResultAsync } from "neverthrow"
import { AppError } from "@openzerg/common"
import { RemoteFS } from "../remote-fs.js"
import { parseArgs, resolvePath, MAX_RESULTS, MAX_LINE_LENGTH } from "./shared.js"

const GrepSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  include: z.string().optional(),
})

export const grepTool: ITool = {
  name: "grep",
  description: "Search file contents using ripgrep. Structured output with file:line:content. Capped at 100.",
  group: "filesystem",
  priority: 10,
  dependencies: [],
  pkgs: ["ripgrep"],
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string" },
      include: { type: "string", description: "Glob filter e.g. '*.ts'" },
    },
    required: ["pattern"],
  },
  outputSchema: { type: "object", properties: { matches: { type: "array" } } },
  execute(argsJson, sessionToken, getContext): ResultAsync<unknown, AppError> {
    return new ResultAsync((async (): Promise<Result<unknown, AppError>> => {
      const argsR = parseArgs(GrepSchema, argsJson)
      if (argsR.isErr()) return err(argsR.error)
      const args = argsR.value
      const ctx = await getContext(sessionToken)
      const fs = new RemoteFS(ctx)
      const base = args.path ? resolvePath(ctx, args.path) : ctx.workspaceRoot

      let cmd = `rg --line-number --no-heading --hidden ${JSON.stringify(args.pattern)} ${JSON.stringify(base)} || true`
      if (args.include) cmd = `rg --line-number --no-heading --hidden --glob '${args.include}' ${JSON.stringify(args.pattern)} ${JSON.stringify(base)} || true`

      const outR = await fs.exec(cmd)
      if (outR.isErr()) return err(outR.error)
      const matches = outR.value.trim().split("\n").filter(Boolean).slice(0, MAX_RESULTS).map(line => {
        const colonIdx = line.indexOf(":")
        const numIdx = line.indexOf(":", colonIdx + 1)
        return {
          file: line.slice(0, colonIdx).slice(base.length + 1),
          line: parseInt(line.slice(colonIdx + 1, numIdx)),
          content: line.slice(numIdx + 1).slice(0, MAX_LINE_LENGTH),
        }
      })

      return ok({ matches })
    })())
  },
}
