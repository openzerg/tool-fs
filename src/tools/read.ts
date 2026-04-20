import type { ITool } from "@openzerg/common/tool-server-sdk"
import { z } from "zod"
import { ok, err, type Result, ResultAsync } from "neverthrow"
import { AppError, NotFoundError, ValidationError } from "@openzerg/common"
import { RemoteFS } from "../remote-fs.js"
import { record as filetimeRecord } from "../filetime.js"
import { parseArgs, resolvePath, isBinaryPath, isBinaryContent, formatWithLineNumbers } from "./shared.js"

const ReadSchema = z.object({ path: z.string(), offset: z.number().optional(), limit: z.number().optional() })

export const readTool: ITool = {
  name: "read",
  description: "Read file content with line numbers. Supports offset/limit, binary detection, image/PDF as base64.",
  group: "filesystem",
  priority: 10,
  dependencies: [],
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to workspace" },
      offset: { type: "number", description: "Start line (1-indexed)" },
      limit: { type: "number", description: "Max lines to read" },
    },
    required: ["path"],
  },
  outputSchema: { type: "object", properties: { content: { type: "string" } } },
  execute(argsJson, sessionToken, getContext): ResultAsync<unknown, AppError> {
    return new ResultAsync((async (): Promise<Result<unknown, AppError>> => {
      const argsR = parseArgs(ReadSchema, argsJson)
      if (argsR.isErr()) return err(argsR.error)
      const args = argsR.value
      const ctx = await getContext(sessionToken)
      const fs = new RemoteFS(ctx)
      const fp = resolvePath(ctx, args.path)

      const infoR = await fs.stat(fp)
      if (infoR.isErr()) return err(infoR.error)
      const info = infoR.value

      if (!info.exists) return err(new NotFoundError(`File not found: ${args.path}`))
      if (info.isDir) {
        const outR = await fs.exec(`ls -1 ${JSON.stringify(fp)}`)
        if (outR.isErr()) return err(outR.error)
        const entries = outR.value.trim().split("\n").filter(Boolean)
        return ok({ content: entries.map(e => info.isFile ? e : e + "/").join("\n") })
      }
      if (info.size > 5 * 1024 * 1024) return err(new ValidationError(`File too large (${Number(info.size)} bytes): ${args.path}`))

      const dataR = await fs.readBinary(fp)
      if (dataR.isErr()) return err(dataR.error)
      const { data, mtimeMs } = dataR.value
      filetimeRecord(fp, mtimeMs)

      if (isBinaryPath(args.path) || isBinaryContent(data)) {
        const ext = args.path.split(".").pop()?.toLowerCase() ?? ""
        const imageExts = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"])
        const pdfExts = new Set(["pdf"])

        if (imageExts.has(ext)) {
          const b64 = btoa(String.fromCharCode(...data))
          const mime = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`
          return ok({ content: `[Binary: ${ext} image, ${data.length} bytes]\ndata:${mime};base64,${b64}` })
        }
        if (pdfExts.has(ext)) {
          const b64 = btoa(String.fromCharCode(...data))
          return ok({ content: `[Binary: PDF, ${data.length} bytes]\ndata:application/pdf;base64,${b64}` })
        }
        return ok({ content: `[Binary file: ${ext || "unknown"}, ${data.length} bytes. Cannot display as text.]` })
      }

      const text = new TextDecoder().decode(data)
      return ok({ content: formatWithLineNumbers(text, args.offset, args.limit) })
    })())
  },
}
