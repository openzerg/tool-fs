import type { ITool } from "@openzerg/common/tool-server-sdk"
import { z } from "zod"
import { ok, err, type Result, ResultAsync } from "neverthrow"
import { AppError } from "@openzerg/common"
import { RemoteFS } from "../remote-fs.js"
import { record as filetimeRecord, assert as filetimeAssert } from "../filetime.js"
import { parseArgs, resolvePath, generateDiff } from "./shared.js"

const WriteSchema = z.object({ path: z.string(), content: z.string() })

export const writeTool: ITool = {
  name: "write",
  description: "Write content to file. Creates parent directories. Shows diff. FileTime conflict detection.",
  group: "filesystem",
  priority: 10,
  dependencies: ["read"],
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  outputSchema: { type: "object", properties: { success: { type: "boolean" }, diff: { type: "string" } } },
  execute(argsJson, sessionToken, getContext): ResultAsync<unknown, AppError> {
    return new ResultAsync((async (): Promise<Result<unknown, AppError>> => {
      const argsR = parseArgs(WriteSchema, argsJson)
      if (argsR.isErr()) return err(argsR.error)
      const args = argsR.value
      const ctx = await getContext(sessionToken)
      const fs = new RemoteFS(ctx)
      const fp = resolvePath(ctx, args.path)

      let oldContent = ""
      let expectedMtime = 0n
      const infoR = await fs.stat(fp)
      if (infoR.isErr()) return err(infoR.error)
      const info = infoR.value
      if (info.exists && info.isFile) {
        const assertR = filetimeAssert(fp, info.mtimeMs)
        if (assertR.isErr()) return err(assertR.error)
        const fileR = await fs.readFile(fp)
        if (fileR.isErr()) return err(fileR.error)
        oldContent = fileR.value.text
        expectedMtime = fileR.value.mtimeMs
      }

      const writeR = await fs.writeFile(fp, args.content, expectedMtime)
      if (writeR.isErr()) return err(writeR.error)
      filetimeRecord(fp, writeR.value)

      const diff = oldContent ? generateDiff(oldContent, args.content, args.path) : `[New file: ${args.path}]`
      return ok({ success: true, diff })
    })())
  },
}
