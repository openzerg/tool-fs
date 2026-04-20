import type { ITool } from "@openzerg/common/tool-server-sdk"
import { readTool } from "./read.js"
import { writeTool } from "./write.js"
import { editTool } from "./edit.js"
import { lsTool } from "./ls.js"
import { globTool } from "./glob.js"
import { grepTool } from "./grep.js"
import { multiEditTool } from "./multiedit.js"
import { applyPatchTool } from "./apply-patch.js"

export function createFsTools(): ITool[] {
  return [readTool, writeTool, editTool, lsTool, globTool, grepTool, multiEditTool, applyPatchTool]
}
