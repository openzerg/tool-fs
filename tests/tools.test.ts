import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { createServer, type Server } from "node:http"
import { connectNodeAdapter } from "@connectrpc/connect-node"
import { mkdirSync, rmSync } from "node:fs"

import { createWorkerRouter, authInterceptor } from "../../worker/src/router.js"
import type { ToolContext } from "../../tool-server-sdk/src/tool.js"
import { createFsTools } from "../src/tools/index.js"

const PORT = 25101
const SECRET = "fs-test-secret"
const WORKSPACE = "/tmp/tool-fs-test-workspace"

let server: Server

const mockGetContext = (_token: string): Promise<ToolContext> =>
  Promise.resolve({
    sessionId: "test-session",
    workerUrl: `http://localhost:${PORT}`,
    workerSecret: SECRET,
    workspaceRoot: WORKSPACE,
    serverConfigs: {},
  })

const fsTools = createFsTools()

function findTool(name: string) {
  const tool = fsTools.find(t => t.name === name)
  if (!tool) throw new Error(`Tool not found: ${name}`)
  return tool
}

async function exec(tool: ReturnType<typeof findTool>, args: Record<string, unknown>): Promise<any> {
  const result = await tool!.execute(JSON.stringify(args), "tok", mockGetContext)
  if (result.isErr()) throw result.error
  return result.value
}

beforeAll(async () => {
  process.env.WORKER_SECRET = SECRET

  const handler = connectNodeAdapter({
    routes: createWorkerRouter(),
    interceptors: [authInterceptor()],
  })
  server = createServer(handler)
  server.listen(PORT)
  await new Promise(r => setTimeout(r, 100))

  rmSync(WORKSPACE, { recursive: true, force: true })
  mkdirSync(WORKSPACE, { recursive: true })
})

afterAll(() => {
  server?.close()
  rmSync(WORKSPACE, { recursive: true, force: true })
})

describe("tool-fs tools (via file RPCs)", () => {
  test("write + read roundtrip with line numbers", async () => {
    const write = findTool("write")
    const read = findTool("read")

    await exec(write, { path: "test.txt", content: "line 1\nline 2\nline 3\n" })
    const result = await exec(read, { path: "test.txt" })
    expect(result.content).toContain("1: line 1")
    expect(result.content).toContain("2: line 2")
    expect(result.content).toContain("3: line 3")
  })

  test("write returns diff", async () => {
    const write = findTool("write")
    await exec(write, { path: "diff-test.txt", content: "original" })
    const result = await exec(write, { path: "diff-test.txt", content: "modified" })
    expect(result.success).toBe(true)
    expect(result.diff).toContain("-original")
    expect(result.diff).toContain("+modified")
  })

  test("edit with fuzzy matching", async () => {
    const write = findTool("write")
    const edit = findTool("edit")
    const read = findTool("read")

    await exec(write, { path: "edit-test.txt", content: "  foo bar baz  \n  hello world  \n" })
    const editResult = await exec(edit, {
      path: "edit-test.txt",
      oldString: "hello world",
      newString: "HELLO WORLD",
    })
    expect(editResult.success).toBe(true)
    expect(editResult.diff).toContain("-  hello world")
    expect(editResult.diff).toContain("+  HELLO WORLD")

    const readResult = await exec(read, { path: "edit-test.txt" })
    expect(readResult.content).toContain("HELLO WORLD")
  })

  test("multi-edit applies sequential edits with diff", async () => {
    const write = findTool("write")
    const multiedit = findTool("multi-edit")

    await exec(write, { path: "multi.txt", content: "aaa bbb ccc" })
    const result = await exec(multiedit, {
      path: "multi.txt",
      edits: [
        { oldString: "aaa", newString: "AAA" },
        { oldString: "ccc", newString: "CCC" },
      ],
    })

    expect(result.success).toBe(true)
    expect(result.results).toHaveLength(2)
    expect(result.diff).toContain("-aaa")
    expect(result.diff).toContain("+AAA")
  })

  test("apply-patch adds and updates files", async () => {
    const write = findTool("write")
    const applyPatch = findTool("apply-patch")
    const read = findTool("read")

    await exec(write, { path: "existing.txt", content: "line 1\nline 2\nline 3\n" })

    const patchText = `*** Begin Patch
*** Add File: new-file.txt
+new content here
*** Update File: existing.txt
@@ line 1
 line 1
-line 2
+LINE TWO
 line 3
*** End Patch`

    const result = await exec(applyPatch, { patchText })
    expect(result.success).toBe(true)

    const newFile = await exec(read, { path: "new-file.txt" })
    expect(newFile.content).toContain("new content here")

    const updated = await exec(read, { path: "existing.txt" })
    expect(updated.content).toContain("LINE TWO")
  })

  test("ls renders tree view", async () => {
    const write = findTool("write")
    const ls = findTool("ls")

    await exec(write, { path: "dir/a.txt", content: "a" })
    await exec(write, { path: "dir/b.txt", content: "b" })
    await exec(write, { path: "dir/sub/c.txt", content: "c" })

    const result = await exec(ls, { path: "dir" })
    expect(result.content).toContain("a.txt")
    expect(result.content).toContain("b.txt")
    expect(result.content).toContain("sub/")
    expect(result.content).toContain("c.txt")
    expect(result.content).toContain("├──")
    expect(result.content).toContain("└──")
  })
})
