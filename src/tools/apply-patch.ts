import type { ITool } from "@openzerg/common/tool-server-sdk"
import { z } from "zod"
import { ok, err, type Result, ResultAsync } from "neverthrow"
import { AppError, ValidationError } from "@openzerg/common"
import { RemoteFS } from "../remote-fs.js"
import { record as filetimeRecord, assert as filetimeAssert } from "../filetime.js"
import { parsePatch, deriveNewContents } from "../patch.js"
import { parseArgs, resolvePath } from "./shared.js"

const ApplyPatchSchema = z.object({ patchText: z.string() })

export const applyPatchTool: ITool = {
  name: "apply-patch",
  description: "Apply a unified diff patch. Supports add/update/delete/move. Format: *** Begin Patch / *** End Patch.",
  group: "filesystem",
  priority: 10,
  dependencies: ["read"],
  inputSchema: {
    type: "object",
    properties: {
      patchText: { type: "string", description: "The full patch text" },
    },
    required: ["patchText"],
  },
  outputSchema: { type: "object", properties: { success: { type: "boolean" }, summary: { type: "string" } } },
  execute(argsJson, sessionToken, getContext): ResultAsync<unknown, AppError> {
    return new ResultAsync((async (): Promise<Result<unknown, AppError>> => {
      const argsR = parseArgs(ApplyPatchSchema, argsJson)
      if (argsR.isErr()) return err(argsR.error)
      const args = argsR.value
      const ctx = await getContext(sessionToken)
      const fs = new RemoteFS(ctx)

      const hunksR = parsePatch(args.patchText)
      if (hunksR.isErr()) return err(hunksR.error)
      const hunks = hunksR.value
      if (hunks.length === 0) return err(new ValidationError("No hunks found in patch"))

      const summary: string[] = []

      for (const hunk of hunks) {
        const fp = resolvePath(ctx, hunk.path)

        switch (hunk.type) {
          case "add": {
            const writeR = await fs.writeFile(fp, hunk.contents)
            if (writeR.isErr()) return err(writeR.error)
            filetimeRecord(fp, writeR.value)
            summary.push(`A ${hunk.path}`)
            break
          }
          case "delete": {
            const execR = await fs.exec(`rm -f ${JSON.stringify(fp)}`)
            if (execR.isErr()) return err(execR.error)
            summary.push(`D ${hunk.path}`)
            break
          }
          case "update": {
            const fileR = await fs.readFile(fp)
            if (fileR.isErr()) return err(fileR.error)
            const { text: original, mtimeMs } = fileR.value
            filetimeRecord(fp, mtimeMs)

            const assertR = filetimeAssert(fp, mtimeMs)
            if (assertR.isErr()) return err(assertR.error)

            const newContentR = deriveNewContents(original, hunk.chunks, hunk.path)
            if (newContentR.isErr()) return err(newContentR.error)

            if (hunk.movePath) {
              const targetFp = resolvePath(ctx, hunk.movePath)
              const writeR = await fs.writeFile(targetFp, newContentR.value)
              if (writeR.isErr()) return err(writeR.error)
              filetimeRecord(targetFp, writeR.value)
              const execR = await fs.exec(`rm -f ${JSON.stringify(fp)}`)
              if (execR.isErr()) return err(execR.error)
              summary.push(`R ${hunk.path} -> ${hunk.movePath}`)
            } else {
              const writeR = await fs.writeFile(fp, newContentR.value, mtimeMs)
              if (writeR.isErr()) return err(writeR.error)
              filetimeRecord(fp, writeR.value)
              summary.push(`M ${hunk.path}`)
            }
            break
          }
        }
      }

      return ok({ success: true, summary: summary.join("\n") })
    })())
  },
}
