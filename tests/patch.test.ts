import { describe, test, expect } from "bun:test"
import { parsePatch, deriveNewContents } from "../src/patch.js"

describe("parsePatch", () => {
  test("parses add file hunk", () => {
    const patch = `*** Begin Patch
*** Add File: hello.txt
+line 1
+line 2
*** End Patch`
    const hunksR = parsePatch(patch)
    expect(hunksR.isOk()).toBe(true)
    const hunks = hunksR.value
    expect(hunks).toHaveLength(1)
    expect(hunks[0]).toEqual({ type: "add", path: "hello.txt", contents: "line 1\nline 2" })
  })

  test("parses delete file hunk", () => {
    const patch = `*** Begin Patch
*** Delete File: old.txt
*** End Patch`
    const hunksR = parsePatch(patch)
    expect(hunksR.isOk()).toBe(true)
    const hunks = hunksR.value
    expect(hunks).toHaveLength(1)
    expect(hunks[0]).toEqual({ type: "delete", path: "old.txt" })
  })

  test("parses update file hunk with chunks", () => {
    const patch = `*** Begin Patch
*** Update File: src/main.ts
@@ existing line
 existing line
-old code
+new code
*** End Patch`
    const hunksR = parsePatch(patch)
    expect(hunksR.isOk()).toBe(true)
    const hunks = hunksR.value
    expect(hunks).toHaveLength(1)
    expect(hunks[0].type).toBe("update")
    if (hunks[0].type === "update") {
      expect(hunks[0].path).toBe("src/main.ts")
      expect(hunks[0].chunks).toHaveLength(1)
      expect(hunks[0].chunks[0].oldLines).toEqual(["existing line", "old code"])
      expect(hunks[0].chunks[0].newLines).toEqual(["existing line", "new code"])
      expect(hunks[0].chunks[0].changeContext).toBe("existing line")
    }
  })

  test("parses update with move", () => {
    const patch = `*** Begin Patch
*** Update File: old/path.ts
*** Move to: new/path.ts
@@ ctx
-old
+new
*** End Patch`
    const hunksR = parsePatch(patch)
    expect(hunksR.isOk()).toBe(true)
    const hunks = hunksR.value
    expect(hunks).toHaveLength(1)
    expect(hunks[0].type).toBe("update")
    if (hunks[0].type === "update") {
      expect(hunks[0].movePath).toBe("new/path.ts")
    }
  })

  test("parses End of File marker", () => {
    const patch = `*** Begin Patch
*** Update File: file.ts
@@
-old last line
+new last line
*** End of File
*** End Patch`
    const hunksR = parsePatch(patch)
    expect(hunksR.isOk()).toBe(true)
    const hunks = hunksR.value
    expect(hunks).toHaveLength(1)
    if (hunks[0].type === "update") {
      expect(hunks[0].chunks[0].isEndOfFile).toBe(true)
    }
  })

  test("returns err on missing markers", () => {
    const hunksR = parsePatch("no markers here")
    expect(hunksR.isErr()).toBe(true)
  })

  test("parses multiple hunks", () => {
    const patch = `*** Begin Patch
*** Add File: a.txt
+content a
*** Delete File: b.txt
*** Update File: c.txt
@@ ctx
-old
+new
*** End Patch`
    const hunksR = parsePatch(patch)
    expect(hunksR.isOk()).toBe(true)
    const hunks = hunksR.value
    expect(hunks).toHaveLength(3)
    expect(hunks[0].type).toBe("add")
    expect(hunks[1].type).toBe("delete")
    expect(hunks[2].type).toBe("update")
  })
})

describe("deriveNewContents", () => {
  test("applies simple replacement", () => {
    const original = "line 1\nline 2\nline 3\n"
    const chunks = [{
      oldLines: ["line 2"],
      newLines: ["line TWO"],
    }]
    const resultR = deriveNewContents(original, chunks, "test.txt")
    expect(resultR.isOk()).toBe(true)
    expect(resultR.value).toBe("line 1\nline TWO\nline 3\n")
  })

  test("applies multiple chunks in order", () => {
    const original = "a\nb\nc\nd\ne\n"
    const chunks = [
      { oldLines: ["b"], newLines: ["B"] },
      { oldLines: ["d"], newLines: ["D"] },
    ]
    const resultR = deriveNewContents(original, chunks, "test.txt")
    expect(resultR.isOk()).toBe(true)
    expect(resultR.value).toBe("a\nB\nc\nD\ne\n")
  })

  test("uses context to locate chunk", () => {
    const original = "x\nfoo\nbar\nfoo\nbaz\n"
    const chunks = [
      { oldLines: ["foo"], newLines: ["FOO"], changeContext: "bar" },
    ]
    const resultR = deriveNewContents(original, chunks, "test.txt")
    expect(resultR.isOk()).toBe(true)
    expect(resultR.value).toBe("x\nfoo\nbar\nFOO\nbaz\n")
  })

  test("handles pure addition (no old lines)", () => {
    const original = "line 1\nline 2\n"
    const chunks = [{
      oldLines: [],
      newLines: ["inserted line"],
    }]
    const resultR = deriveNewContents(original, chunks, "test.txt")
    expect(resultR.isOk()).toBe(true)
    expect(resultR.value).toContain("inserted line")
  })

  test("handles multi-line old pattern", () => {
    const original = "a\nb\nc\nd\n"
    const chunks = [{
      oldLines: ["b", "c"],
      newLines: ["X"],
    }]
    const resultR = deriveNewContents(original, chunks, "test.txt")
    expect(resultR.isOk()).toBe(true)
    expect(resultR.value).toBe("a\nX\nd\n")
  })

  test("returns err when old lines not found", () => {
    const original = "line 1\nline 2\n"
    const chunks = [{
      oldLines: ["not found"],
      newLines: ["replacement"],
    }]
    const resultR = deriveNewContents(original, chunks, "test.txt")
    expect(resultR.isErr()).toBe(true)
  })

  test("fuzzy match with trimmed whitespace", () => {
    const original = "line 1  \nline 2\n"
    const chunks = [{
      oldLines: ["line 1"],
      newLines: ["LINE 1"],
    }]
    const resultR = deriveNewContents(original, chunks, "test.txt")
    expect(resultR.isOk()).toBe(true)
    expect(resultR.value).toBe("LINE 1\nline 2\n")
  })
})
