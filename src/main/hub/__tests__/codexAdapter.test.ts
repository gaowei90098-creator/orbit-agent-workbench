import { describe, it, expect } from "vitest"
import path from "node:path"
import { CodexAdapter } from "../adapters/codex"

// Use a .cmd shim on Windows to avoid Node EFTYPE when spawning a .js directly.
const MOCK_BIN = process.platform === "win32"
 ? path.join(__dirname, "mock-codex.cmd")
 : path.join(__dirname, "mock-codex.js")

describe("CodexAdapter end-to-end (mock binary)", () => {
 it("does not trigger Node shell+args deprecation warnings", async () => {
 const a = new CodexAdapter()
 a.binary = MOCK_BIN
 const warnings: Error[] = []
 const onWarning = (warning: Error) => warnings.push(warning)
 process.on("warning", onWarning)

 try {
 await a.start()
 a.send("hello from vitest")

 await new Promise<void>((resolve) => {
 const start = Date.now()
 const tick = setInterval(() => {
 if (!(a as any).proc || (a as any).proc.exitCode !== null || Date.now() - start >8000) {
 clearInterval(tick)
 resolve()
 }
 },50)
 })
 } finally {
 process.off("warning", onWarning)
 await a.stop()
 }

 expect(warnings.map(w => (w as any).code)).not.toContain("DEP0190")
 },15000)

 it("spawns binary, sends prompt, captures echoed stdout", async () => {
 const a = new CodexAdapter()
 a.binary = MOCK_BIN
 const chunks: string[] = []
 const errors: Error[] = []
 a.onOutput = (c: string) => chunks.push(c)
 a.onError = (e: Error) => errors.push(e)

 await a.start()
 a.send("hello from vitest")

 await new Promise<void>((resolve) => {
 const start = Date.now()
 const tick = setInterval(() => {
 if (!(a as any).proc || (a as any).proc.exitCode !== null || Date.now() - start >8000) {
 clearInterval(tick)
 resolve()
 }
 },50)
 })

 expect(errors).toEqual([])
 expect(chunks.join("")).toContain("echo:hello from vitest")
 await a.stop()
 },15000)

 it("binary field can be overridden after construction", () => {
 const a = new CodexAdapter()
 a.binary = "/some/custom/path/codex"
 expect((a as any).binary).toBe("/some/custom/path/codex")
 })
})
