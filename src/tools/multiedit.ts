import type { ITool } from "@openzerg/common/tool-server-sdk"
import { z } from "zod"
import { ok, err, type Result, ResultAsync } from "neverthrow"
import { AppError } from "@openzerg/common"
import { RemoteFS } from "../remote-fs.js"
import { record as filetimeRecord, assert as filetimeAssert } from "../filetime.js"
import { fuzzyReplace } from "../replacer.js"
import { parseArgs, resolvePath, generateDiff } from "./shared.js"

const MultiEditSchema = z.object({
  path: z.string(),
  edits: z.array(z.object({
    oldString: z.string(),
    newString: z.string(),
    replaceAll: z.boolean().optional(),
  })),
})

export const multiEditTool: ITool = {
  name: "multi-edit",
  description: "Apply multiple fuzzy string replacements to a single file in sequence. Shows cumulative diff.",
  group: "filesystem",
  priority: 10,
  dependencies: ["read"],
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path" },
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            oldString: { type: "string" },
            newString: { type: "string" },
            replaceAll: { type: "boolean" },
          },
          required: ["oldString", "newString"],
        },
      },
    },
    required: ["path", "edits"],
  },
  outputSchema: { type: "object", properties: { success: { type: "boolean" }, results: { type: "array" }, diff: { type: "string" } } },
  execute(argsJson, sessionToken, getContext): ResultAsync<unknown, AppError> {
    return new ResultAsync((async (): Promise<Result<unknown, AppError>> => {
      const argsR = parseArgs(MultiEditSchema, argsJson)
      if (argsR.isErr()) return err(argsR.error)
      const args = argsR.value
      const ctx = await getContext(sessionToken)
      const fs = new RemoteFS(ctx)
      const fp = resolvePath(ctx, args.path)

      const fileR = await fs.readFile(fp)
      if (fileR.isErr()) return err(fileR.error)
      const { text: originalContent, mtimeMs } = fileR.value
      filetimeRecord(fp, mtimeMs)

      const assertR = filetimeAssert(fp, mtimeMs)
      if (assertR.isErr()) return err(assertR.error)

      let content = originalContent
      const results: Array<{ success: boolean; replacements: number; error?: string }> = []

      for (const editOp of args.edits) {
        const replaceR = fuzzyReplace(content, editOp.oldString, editOp.newString, editOp.replaceAll)
        if (replaceR.isErr()) {
          results.push({ success: false, replacements: 0, error: replaceR.error.message })
        } else {
          content = replaceR.value
          results.push({ success: true, replacements: 1 })
        }
      }

      const writeR = await fs.writeFile(fp, content, mtimeMs)
      if (writeR.isErr()) return err(writeR.error)
      filetimeRecord(fp, writeR.value)

      const diff = generateDiff(originalContent, content, args.path)
      return ok({
        success: results.some(r => r.success),
        results,
        diff,
      })
    })())
  },
}
