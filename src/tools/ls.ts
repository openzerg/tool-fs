import type { ITool } from "@openzerg/common/tool-server-sdk"
import { z } from "zod"
import { ok, err, type Result, ResultAsync } from "neverthrow"
import { AppError, ValidationError } from "@openzerg/common"
import { RemoteFS } from "../remote-fs.js"
import { parseArgs, resolvePath, MAX_RESULTS } from "./shared.js"

const IGNORE_PATTERNS = [
  "node_modules/",
  "__pycache__/",
  ".git/",
  "dist/",
  "build/",
  "target/",
  "vendor/",
  "bin/",
  "obj/",
  ".idea/",
  ".vscode/",
  ".zig-cache/",
  "zig-out",
  ".coverage",
  "coverage/",
  "vendor/",
  "tmp/",
  "temp/",
  ".cache/",
  "cache/",
  "logs/",
  ".venv/",
  "venv/",
  "env/",
]

const LsSchema = z.object({ path: z.string(), ignore: z.array(z.string()).optional() })

export const lsTool: ITool = {
  name: "ls",
  description: "List directory as tree view using ripgrep. Ignores common dirs like node_modules/.git.",
  group: "filesystem",
  priority: 10,
  dependencies: [],
  pkgs: ["ripgrep"],
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      ignore: { type: "array", items: { type: "string" }, description: "Additional glob patterns to ignore" },
    },
    required: ["path"],
  },
  outputSchema: { type: "object", properties: { content: { type: "string" } } },
  execute(argsJson, sessionToken, getContext): ResultAsync<unknown, AppError> {
    return new ResultAsync((async (): Promise<Result<unknown, AppError>> => {
      const argsR = parseArgs(LsSchema, argsJson)
      if (argsR.isErr()) return err(argsR.error)
      const args = argsR.value
      const ctx = await getContext(sessionToken)
      const fs = new RemoteFS(ctx)
      const fp = resolvePath(ctx, args.path)

      const infoR = await fs.stat(fp)
      if (infoR.isErr()) return err(infoR.error)
      if (!infoR.value.isDir) return err(new ValidationError(`Not a directory: ${args.path}`))

      const allIgnores = IGNORE_PATTERNS.map(p => `!${p}*`).concat((args.ignore ?? []).map(p => `!${p}`))
      const globArgs = allIgnores.map(i => `--glob '${i}'`).join(" ")
      const outR = await fs.exec(`rg --files ${globArgs} ${JSON.stringify(fp)} || true`)
      if (outR.isErr()) return err(outR.error)
      const rawFiles = outR.value.trim().split("\n").filter(Boolean).slice(0, MAX_RESULTS)

      const tree = new Map<string, Set<string>>()
      for (const f of rawFiles) {
        const rel = f.slice(fp.length + 1)
        const parts = rel.split("/")
        let current = ""
        for (let i = 0; i < parts.length - 1; i++) {
          const parent = current
          current = current ? `${current}/${parts[i]}` : parts[i]
          if (!tree.has(parent)) tree.set(parent, new Set())
          tree.get(parent)!.add(parts[i])
        }
        const dir = parts.slice(0, -1).join("/")
        if (!tree.has(dir)) tree.set(dir, new Set())
        tree.get(dir)!.add(parts[parts.length - 1])
      }

      const renderDir = (dir: string, prefix: string): string[] => {
        const entries = tree.get(dir)
        if (!entries) return []
        const sorted = [...entries].sort()
        const lines: string[] = []
        sorted.forEach((entry, i) => {
          const isLast = i === sorted.length - 1
          const connector = isLast ? "└── " : "├── "
          const childPath = dir ? `${dir}/${entry}` : entry
          const childInfo = tree.has(childPath)
          lines.push(`${prefix}${connector}${entry}${childInfo ? "/" : ""}`)
          if (childInfo) {
            const childPrefix = prefix + (isLast ? "    " : "│   ")
            lines.push(...renderDir(childPath, childPrefix))
          }
        })
        return lines
      }

      const header = `${args.path}/`
      const treeLines = renderDir("", "")
      const truncated = rawFiles.length >= MAX_RESULTS
      const content = [header, ...treeLines, ...(truncated ? [`[truncated to ${MAX_RESULTS} files]`] : [])].join("\n")

      return ok({ content })
    })())
  },
}
