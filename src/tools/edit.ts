import type { ITool } from "@openzerg/common/tool-server-sdk"
import { z } from "zod"
import { ok, err, type Result, ResultAsync } from "neverthrow"
import { AppError } from "@openzerg/common"
import { RemoteFS } from "../remote-fs.js"
import { record as filetimeRecord, assert as filetimeAssert } from "../filetime.js"
import { fuzzyReplace } from "../replacer.js"
import { parseArgs, resolvePath, generateDiff } from "./shared.js"

const EditSchema = z.object({
  path: z.string(),
  oldString: z.string(),
  newString: z.string(),
  replaceAll: z.boolean().optional(),
})

export const editTool: ITool = {
  name: "edit",
  description: "Replace oldString with newString using 9-layer fuzzy matching. FileTime conflict detection. Shows diff.",
  group: "filesystem",
  priority: 10,
  dependencies: ["read"],
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      oldString: { type: "string" },
      newString: { type: "string" },
      replaceAll: { type: "boolean" },
    },
    required: ["path", "oldString", "newString"],
  },
  outputSchema: { type: "object", properties: { success: { type: "boolean" }, replacements: { type: "number" }, diff: { type: "string" } } },
  execute(argsJson, sessionToken, getContext): ResultAsync<unknown, AppError> {
    return new ResultAsync((async (): Promise<Result<unknown, AppError>> => {
      const argsR = parseArgs(EditSchema, argsJson)
      if (argsR.isErr()) return err(argsR.error)
      const args = argsR.value
      const ctx = await getContext(sessionToken)
      const fs = new RemoteFS(ctx)
      const fp = resolvePath(ctx, args.path)

      const fileR = await fs.readFile(fp)
      if (fileR.isErr()) return err(fileR.error)
      const { text: content, mtimeMs } = fileR.value
      filetimeRecord(fp, mtimeMs)

      const assertR = filetimeAssert(fp, mtimeMs)
      if (assertR.isErr()) return err(assertR.error)

      const replaceR = fuzzyReplace(content, args.oldString, args.newString, args.replaceAll)
      if (replaceR.isErr()) return err(replaceR.error)
      const newContent = replaceR.value

      const writeR = await fs.writeFile(fp, newContent, mtimeMs)
      if (writeR.isErr()) return err(writeR.error)
      filetimeRecord(fp, writeR.value)

      const diff = generateDiff(content, newContent, args.path)
      return ok({ success: true, replacements: 1, diff })
    })())
  },
}
