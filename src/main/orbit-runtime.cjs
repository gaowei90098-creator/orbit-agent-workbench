"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const events = require("events");
const crypto = require("crypto");
const node_events = require("node:events");
const child_process = require("child_process");
const node_fs = require("node:fs");
const node_child_process = require("node:child_process");
const node_path = require("node:path");
const node_os = require("node:os");
const node_crypto = require("node:crypto");
const http = require("http");
const url = require("url");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const http__namespace = /* @__PURE__ */ _interopNamespaceDefault(http);
const ENC_PREFIX = "enc:v1:";
function encryptSecret(plain) {
  if (!plain) return "";
  if (plain.startsWith(ENC_PREFIX)) return plain;
  try {
    if (electron.safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + electron.safeStorage.encryptString(plain).toString("base64");
    }
  } catch {
  }
  return plain;
}
function decryptSecret(stored) {
  if (!stored) return "";
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  try {
    return electron.safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), "base64"));
  } catch {
    return "";
  }
}
class AppStore {
  data = {};
  filePath = "";
  initialized = false;
  init() {
    if (this.initialized) return;
    try {
      const userDataPath = electron.app.getPath("userData");
      this.filePath = path.join(userDataPath, "config.json");
      this.load();
      this.initialized = true;
    } catch (e) {
      console.error("[Store] Init failed:", e);
    }
  }
  load() {
    try {
      if (fs__namespace.existsSync(this.filePath)) {
        this.data = JSON.parse(fs__namespace.readFileSync(this.filePath, "utf-8"));
      }
    } catch {
    }
  }
  save() {
    try {
      fs__namespace.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch {
    }
  }
  get(key, defaultValue) {
    this.init();
    return this.data[key] !== void 0 ? this.data[key] : defaultValue;
  }
  set(key, value) {
    this.init();
    this.data[key] = value;
    this.save();
  }
  getAll() {
    this.init();
    return { ...this.data };
  }
}
const appStore = new AppStore();
const TOKEN_KEY = "local.token";
function getLocalToken() {
  let t = appStore.get(TOKEN_KEY);
  if (!t || typeof t !== "string") {
    t = crypto.randomBytes(24).toString("hex");
    appStore.set(TOKEN_KEY, t);
  }
  return t;
}
const EVOMAP_MCP_ENDPOINT = "https://evomap.ai/mcp";
const EVOMAP_AUTHORIZATION_ENDPOINT = "https://evomap.ai/oauth/authorize";
const EVOMAP_TOKEN_ENDPOINT = "https://evomap.ai/oauth/token";
const EVOMAP_CLIENT_ID = "evm_client_454b1138bc56d2fad745797952b1a332e7fbbcda70edd00764f806531b5120d4";
const EVOMAP_REDIRECT_URI = "http://127.0.0.1:9527/oauth/evomap/callback";
const EVOMAP_SCOPES = ["gene:read", "recipe:read", "reuse:query"];
const EVOMAP_OAUTH_KEY = "evomap.oauth";
const EVOMAP_PENDING_KEY = "evomap.oauth.pending";
const EVOMAP_ERROR_KEY = "evomap.oauth.lastError";
const EVOMAP_CACHE_KEY = "evomap.mcp.cache";
const EVOMAP_CACHE_TTL_MS = 10 * 60 * 1e3;
const EVOMAP_PENDING_TTL_MS = 15 * 60 * 1e3;
function evomapClean(value, limit = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}
function evomapHtmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch] || ch);
}
function evomapReadOAuth() {
  const raw = appStore.get(EVOMAP_OAUTH_KEY);
  if (!raw || typeof raw !== "object") return {};
  return raw;
}
function evomapWriteOAuth(state) {
  const next = { ...state, updatedAt: Date.now() };
  appStore.set(EVOMAP_OAUTH_KEY, next);
  return next;
}
function decryptSecretWithStatus(stored) {
  if (!stored) return { ok: true, value: "", encrypted: false };
  const text = String(stored || "");
  if (!text.startsWith(ENC_PREFIX)) return { ok: true, value: text, encrypted: false };
  try {
    return {
      ok: true,
      value: electron.safeStorage.decryptString(Buffer.from(text.slice(ENC_PREFIX.length), "base64")),
      encrypted: true
    };
  } catch (e) {
    return { ok: false, value: "", encrypted: true, error: e?.message || String(e) };
  }
}
function evomapPendingStore() {
  const raw = appStore.get(EVOMAP_PENDING_KEY);
  if (!raw || typeof raw !== "object") return { states: {}, latestState: "" };
  if (raw.states && typeof raw.states === "object") return { states: { ...raw.states }, latestState: String(raw.latestState || "") };
  if (raw.state && raw.verifier) {
    return {
      states: {
        [raw.state]: {
          state: raw.state,
          verifier: raw.verifier,
          createdAt: raw.createdAt || Date.now()
        }
      },
      latestState: raw.state
    };
  }
  return { states: {}, latestState: "" };
}
function evomapWritePendingStore(store) {
  const now = Date.now();
  const entries = Object.entries(store?.states || {})
    .filter(([, item]) => item?.state && item?.verifier && (!item.createdAt || now - item.createdAt < EVOMAP_PENDING_TTL_MS))
    .slice(-8);
  appStore.set(EVOMAP_PENDING_KEY, {
    latestState: entries.some(([state]) => state === store?.latestState) ? store.latestState : entries.at(-1)?.[0] || "",
    states: Object.fromEntries(entries)
  });
}
function evomapGetPending(state) {
  const store = evomapPendingStore();
  const pending = store.states?.[state];
  evomapWritePendingStore(store);
  if (!pending?.state || pending.state !== state || !pending.verifier) return null;
  if (pending.createdAt && Date.now() - pending.createdAt > EVOMAP_PENDING_TTL_MS) return null;
  return pending;
}
function evomapFinishPending(state) {
  const store = evomapPendingStore();
  if (store.states?.[state]) delete store.states[state];
  evomapWritePendingStore(store);
}
function evomapPendingCount() {
  const store = evomapPendingStore();
  evomapWritePendingStore(store);
  return Object.keys(store.states || {}).length;
}
function evomapRecordOAuthError(stage, error, extra = {}) {
  const value = {
    stage,
    message: evomapClean(error?.message || error || "Unknown EvoMap OAuth error", 600),
    at: Date.now(),
    ...extra
  };
  appStore.set(EVOMAP_ERROR_KEY, value);
  return value;
}
function evomapClearOAuthError() {
  appStore.set(EVOMAP_ERROR_KEY, null);
}
function evomapReadOAuthError() {
  const raw = appStore.get(EVOMAP_ERROR_KEY);
  return raw && typeof raw === "object" ? raw : null;
}
function evomapTokenHealth() {
  const envToken = String(process.env.EVOMAP_MCP_TOKEN || process.env.EVOMAP_ACCESS_TOKEN || "").trim();
  if (envToken) return { connected: true, accessToken: envToken, tokenSource: "env", reason: "" };
  const oauth = evomapReadOAuth();
  if (!oauth.accessToken) return { connected: false, accessToken: "", tokenSource: "none", reason: "not_authorized" };
  if (oauth.expiresAt && oauth.expiresAt < Date.now() + 3e4) {
    return { connected: false, accessToken: "", tokenSource: "stored", reason: "expired" };
  }
  const decrypted = decryptSecretWithStatus(oauth.accessToken);
  if (!decrypted.ok) {
    return {
      connected: false,
      accessToken: "",
      tokenSource: "stored",
      reason: "token_unreadable",
      error: evomapClean(decrypted.error || "Stored token cannot be decrypted.", 500)
    };
  }
  const accessToken = String(decrypted.value || "").trim();
  return accessToken
    ? { connected: true, accessToken, tokenSource: decrypted.encrypted ? "stored-encrypted" : "stored-plain", reason: "" }
    : { connected: false, accessToken: "", tokenSource: "stored", reason: "empty_token" };
}
function evomapAccessToken() {
  return evomapTokenHealth().accessToken || "";
}
function evomapShouldUse(goal) {
  const text = String(goal || "").trim();
  if (text.length < 8) return false;
  if (/^(ok|hi|hello|你好|测试|回复\s*ok)$/i.test(text)) return false;
  return /(agent|mcp|evomap|workflow|memory|协作|编排|自进化|经验|提示|规划|实现|修复|设计|代码|插件|工具|集成|质量|准确|效率|build|implement|fix|debug|integrat|orchestrat|memory|recipe|prompt)/i.test(text);
}
function evomapCanQueryKg(goal, token) {
  if (!/(架构|集成|协作|编排|自进化|知识图谱|复用|workflow|architecture|integrat|orchestrat|reuse|memory|agent|mcp)/i.test(goal)) return false;
  if (String(process.env.EVOMAP_ENABLE_KG_QUERY || "") === "1") return true;
  return String(token || "").startsWith("ek_");
}
function evomapCacheKey(goal) {
  return crypto.createHash("sha256").update(String(goal || "").trim().toLowerCase()).digest("hex").slice(0, 20);
}
function evomapReadCache(goal) {
  try {
    const raw = appStore.get(EVOMAP_CACHE_KEY);
    if (!raw || typeof raw !== "object") return null;
    const hit = raw[evomapCacheKey(goal)];
    if (hit && Date.now() - hit.at < EVOMAP_CACHE_TTL_MS) return hit.value;
  } catch {
  }
  return null;
}
function evomapWriteCache(goal, value) {
  if (!value || value.status !== "ready") return;
  try {
    const raw = appStore.get(EVOMAP_CACHE_KEY) || {};
    raw[evomapCacheKey(goal)] = { at: Date.now(), value };
    const entries = Object.entries(raw).sort((a, b) => b[1].at - a[1].at).slice(0, 30);
    appStore.set(EVOMAP_CACHE_KEY, Object.fromEntries(entries));
  } catch {
  }
}
function evomapPkcePair() {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
function evomapStartUrl() {
  const state = crypto.randomBytes(24).toString("base64url");
  const pkce = evomapPkcePair();
  const store = evomapPendingStore();
  store.states[state] = { state, verifier: pkce.verifier, createdAt: Date.now() };
  store.latestState = state;
  evomapWritePendingStore(store);
  evomapClearOAuthError();
  const u = new URL(EVOMAP_AUTHORIZATION_ENDPOINT);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", EVOMAP_CLIENT_ID);
  u.searchParams.set("redirect_uri", EVOMAP_REDIRECT_URI);
  u.searchParams.set("scope", EVOMAP_SCOPES.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", pkce.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}
async function evomapTokenRequest(form) {
  const res = await proxyFetch(EVOMAP_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString(),
    connectTimeoutMs: 15e3
  });
  const text = await res.text();
  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch {
  }
  return { res, text, parsed };
}
async function evomapExchangeCode(code, state) {
  const pending = evomapGetPending(state);
  if (!pending) throw new Error("OAuth state 不匹配或已过期。请回到 Orbit 点击「连接 EvoMap」重新授权，避免同时打开多个旧授权页。");
  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("client_id", EVOMAP_CLIENT_ID);
  form.set("redirect_uri", EVOMAP_REDIRECT_URI);
  form.set("code", code);
  form.set("code_verifier", pending.verifier);
  const { res, text, parsed } = await evomapTokenRequest(form);
  if (!res.ok || parsed.error) {
    const reason = parsed.error_description || parsed.error || text.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(`Token exchange failed: ${reason}`);
  }
  if (!parsed.access_token) throw new Error("Token exchange succeeded but no access_token was returned.");
  const expiresIn = Number(parsed.expires_in || 0);
  evomapWriteOAuth({
    accessToken: encryptSecret(String(parsed.access_token || "")),
    refreshToken: parsed.refresh_token ? encryptSecret(String(parsed.refresh_token)) : "",
    tokenType: parsed.token_type || "Bearer",
    scope: parsed.scope || EVOMAP_SCOPES.join(" "),
    expiresAt: expiresIn ? Date.now() + expiresIn * 1e3 : 0
  });
  evomapFinishPending(state);
  evomapClearOAuthError();
  return { ok: true, scope: parsed.scope || EVOMAP_SCOPES.join(" "), expiresIn };
}
function evomapHtml(title, body, options = {}) {
  const retry = options.retry !== false;
  const safeTitle = evomapHtmlEscape(title);
  const safeBody = evomapHtmlEscape(body || "");
  return `<!doctype html><meta charset="utf-8"><title>${safeTitle}</title><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#0b0f14;color:#e7edf5;padding:32px;line-height:1.55"><main style="max-width:760px"><h1>${safeTitle}</h1><p style="font-size:16px;color:#b8c3cf;white-space:pre-wrap">${safeBody || "没有收到详细错误。请回到 Orbit 的 EvoMap 卡片查看状态。"}</p><p style="color:#8b98a8">可以关闭这个页面，回到 Orbit。</p>${retry ? `<p><a href="/oauth/evomap/start" style="display:inline-block;color:#081018;background:#65e09b;text-decoration:none;border-radius:8px;padding:9px 13px;font-weight:700">重新连接 EvoMap</a></p>` : ""}</main></body>`;
}
function evomapCandidateArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["items", "results", "assets", "recipes", "data", "nodes"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (Array.isArray(payload.edges)) return payload.edges;
  return [];
}
function evomapSummarizeTool(name, payload, limit) {
  const title = name === "evomap_search_recipes" ? "Recipes" : name === "evomap_search_assets" ? "Genes/Capsules" : name === "evomap_kg_query" ? "Knowledge graph" : name;
  const arr = evomapCandidateArray(payload);
  if (arr.length === 0 && typeof payload === "string" && payload.trim()) {
    return { title, lines: [`- ${evomapClean(payload, 300)}`], count: 1 };
  }
  const lines = arr.slice(0, limit).map((raw, index) => {
    if (!raw || typeof raw !== "object") return `- ${evomapClean(raw, 220)}`;
    const id = evomapClean(raw.id || raw.asset_id || raw.recipe_id || raw.node_id || "", 70);
    const score = raw.score ?? raw.similarity ?? raw.rank;
    const suffix = [id ? `id=${id}` : "", score !== void 0 ? `score=${evomapClean(score, 30)}` : ""].filter(Boolean).join(", ");
    const title2 = evomapClean(raw.title || raw.name || raw.id || raw.asset_id || raw.recipe_id || `${title} ${index + 1}`, 90);
    const summary = evomapClean(raw.summary || raw.description || raw.content || raw.text || raw.reason || raw.signal || "", 220);
    return `- ${title2}${suffix ? ` (${suffix})` : ""}${summary ? `: ${summary}` : ""}`;
  });
  return { title, lines, count: arr.length };
}
async function evomapCallTool(name, args, token, timeoutMs) {
  try {
    const res = await proxyFetch(EVOMAP_MCP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        method: "tools/call",
        params: { name, arguments: args }
      }),
      connectTimeoutMs: timeoutMs
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { name, ok: false, error: text.slice(0, 300), httpStatus: res.status };
    }
    if (!res.ok || parsed.error) return { name, ok: false, error: evomapClean(parsed.error?.message || text, 300), httpStatus: res.status };
    if (parsed.result?.isError) return { name, ok: false, error: evomapClean(parsed.result?.content?.[0]?.text || "tool returned error", 300), httpStatus: parsed.result?._meta?.httpStatus };
    const textPart = parsed.result?.content?.find?.((item) => item?.type === "text")?.text;
    if (typeof textPart === "string") {
      try {
        return { name, ok: true, payload: JSON.parse(textPart), httpStatus: res.status };
      } catch {
        return { name, ok: true, payload: textPart, httpStatus: res.status };
      }
    }
    return { name, ok: true, payload: parsed.result, httpStatus: res.status };
  } catch (e) {
    return { name, ok: false, error: e?.message || String(e) };
  }
}
async function buildEvoMapPlannerContext(goal, onActivity = () => void 0) {
  if (!evomapShouldUse(goal)) return { status: "skipped", context: "", summary: "EvoMap MCP skipped for trivial/local-only request.", toolCount: 0, itemCount: 0, reason: "not_relevant" };
  const cached = evomapReadCache(goal);
  if (cached) {
    onActivity({ id: "evomap-cache", kind: "memory", label: "EvoMap MCP 命中缓存", detail: cached.summary, status: "done" });
    return cached;
  }
  const token = evomapAccessToken();
  if (!token) {
    const reason = "需要先完成 EvoMap OAuth 授权，打开 http://127.0.0.1:9527/oauth/evomap/start";
    onActivity({ id: "evomap-auth", kind: "auth", label: "EvoMap MCP 需要授权", detail: reason, status: "error" });
    return { status: "auth_required", context: "", summary: reason, toolCount: 0, itemCount: 0, reason: "missing_token" };
  }
  onActivity({ id: "evomap-mcp", kind: "mcp", label: "EvoMap MCP 检索经验池", detail: "搜索可复用 Gene、Capsule、Recipe；结果只作为规划候选，不直接执行。", status: "running" });
  const limit = 3;
  const calls = [
    evomapCallTool("evomap_search_recipes", { q: goal, limit }, token, 5500),
    evomapCallTool("evomap_search_assets", { q: goal, limit }, token, 5500)
  ];
  if (evomapCanQueryKg(goal, token)) {
    calls.push(evomapCallTool("evomap_kg_query", { query: goal, type: "semantic" }, token, 5500));
  }
  let results = await Promise.all(calls);
  let ok = results.filter((r) => r.ok);
  let failed = results.filter((r) => !r.ok);
  if (ok.length === 0) {
    const reason = failed.map((r) => `${r.name}: ${r.error || r.httpStatus || "failed"}`).join("; ") || "no MCP result";
    onActivity({ id: "evomap-mcp", kind: "mcp", label: "EvoMap MCP 未取得可用结果", detail: reason, status: "error" });
    return { status: "error", context: "", summary: reason, toolCount: results.length, itemCount: 0, reason };
  }
  let sections = ok.map((r) => evomapSummarizeTool(r.name, r.payload, limit));
  let itemCount = sections.reduce((sum, section) => sum + section.count, 0);
  if (itemCount === 0) {
    onActivity({ id: "evomap-trending", kind: "mcp", label: "EvoMap MCP 补充热门经验", detail: "搜索结果为空，改取热门 Gene/Capsule 作为弱相关规划候选。", status: "running" });
    const trending = await evomapCallTool("evomap_trending", { limit }, token, 5500);
    results = [...results, trending];
    ok = results.filter((r) => r.ok);
    failed = results.filter((r) => !r.ok);
    sections = ok.map((r) => evomapSummarizeTool(r.name, r.payload, limit));
    itemCount = sections.reduce((sum, section) => sum + section.count, 0);
  }
  const context = [
    "EvoMap MCP pre-planning context:",
    "Use these as candidate reusable patterns only. Prefer matches that fit the local repo and verify everything with worker outputs.",
    ...sections.flatMap((section) => section.lines.length ? [`${section.title}:`, ...section.lines] : []),
    failed.length ? `Skipped/failed tools: ${failed.map((r) => `${r.name}(${r.httpStatus || r.error || "failed"})`).join(", ")}` : ""
  ].filter(Boolean).join("\n");
  const summary = `EvoMap MCP ready: ${ok.length}/${results.length} tools returned, ${itemCount} candidate item(s).`;
  onActivity({ id: "evomap-mcp", kind: "mcp", label: "EvoMap MCP 已注入规划上下文", detail: summary, output: context.slice(0, 1200), status: "done" });
  const value = { status: "ready", context, summary, toolCount: results.length, itemCount };
  evomapWriteCache(goal, value);
  return value;
}
const WebSocket = require("ws");
class HubServer extends events.EventEmitter {
  constructor(registry2, port = 9527) {
    super();
    this.registry = registry2;
    this.port = port;
  }
  wss = null;
  httpServer = null;
  clients = /* @__PURE__ */ new Map();
  port;
  start() {
    this.httpServer = http__namespace.createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocket.WebSocketServer({ noServer: true });
    this.httpServer.on("upgrade", (req, socket, head) => {
      try {
        const u = new URL(req.url || "/", "http://127.0.0.1:" + this.port);
        if (u.searchParams.get("token") !== getLocalToken()) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        this.wss?.handleUpgrade(req, socket, head, (ws) => this.handleConnection(ws));
      } catch {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
      }
    });
    this.wss.on("connection", (ws) => this.handleConnection(ws));
    this.httpServer.on("error", (e) => {
      console.error("[Hub] Failed to start:", e);
    });
    this.httpServer.listen(this.port, "127.0.0.1", () => {
      console.log("[Hub] WebSocket server started on ws://127.0.0.1:" + this.port);
      console.log("[EvoMap] OAuth callback listening on http://127.0.0.1:" + this.port + "/oauth/evomap/callback");
    });
  }
  stop() {
    if (this.wss) {
      this.wss.close();
      this.clients.clear();
    }
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }
  async handleHttp(req, res) {
    const u = new URL(req.url || "/", "http://127.0.0.1:" + this.port);
    try {
      if (u.pathname === "/preview" || u.pathname.startsWith("/preview/")) {
        serveWorkspacePreview(u, res);
        return;
      }
      if (u.pathname === "/orbit/evolution/status") {
        const evolution = missions().listEvolution(Number(u.searchParams.get("limit") || 20) || 20);
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ ok: true, evolution }));
        return;
      }
      if (u.pathname === "/oauth/evomap/start") {
        res.writeHead(302, { location: evomapStartUrl(), "cache-control": "no-store" });
        res.end();
        return;
      }
      if (u.pathname === "/oauth/evomap/reset") {
        appStore.set(EVOMAP_OAUTH_KEY, null);
        appStore.set(EVOMAP_PENDING_KEY, null);
        appStore.set(EVOMAP_ERROR_KEY, null);
        appStore.set(EVOMAP_CACHE_KEY, null);
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (u.pathname === "/oauth/evomap/status") {
        const oauth = evomapReadOAuth();
        const token = evomapTokenHealth();
        const lastError = evomapReadOAuthError();
        if (token.connected && lastError) evomapClearOAuthError();
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({
          connected: token.connected,
          reason: token.reason,
          tokenSource: token.tokenSource,
          tokenError: token.error || "",
          lastError: token.connected ? null : lastError,
          pendingCount: evomapPendingCount(),
          clientId: EVOMAP_CLIENT_ID,
          mcpEndpoint: EVOMAP_MCP_ENDPOINT,
          authorizationEndpoint: EVOMAP_AUTHORIZATION_ENDPOINT,
          scopes: oauth.scope || EVOMAP_SCOPES.join(" "),
          expiresAt: oauth.expiresAt || 0,
          authorizeUrl: "http://127.0.0.1:" + this.port + "/oauth/evomap/start"
        }));
        return;
      }
      if (u.pathname === "/oauth/evomap/probe") {
        const goal = evomapClean(u.searchParams.get("q") || "设计一个自进化提示经验生成器", 500);
        const activity = [];
        const result = await buildEvoMapPlannerContext(goal, (step) => {
          activity.push({
            id: step.id,
            kind: step.kind,
            label: step.label,
            detail: step.detail,
            status: step.status
          });
        });
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({
          ok: result.status === "ready",
          status: result.status,
          summary: result.summary,
          toolCount: result.toolCount,
          itemCount: result.itemCount,
          reason: result.reason || "",
          activity
        }));
        return;
      }
      if (u.pathname === "/oauth/evomap/callback") {
        const error = u.searchParams.get("error");
        if (error) throw new Error(u.searchParams.get("error_description") || error);
        const code = u.searchParams.get("code") || "";
        const state = u.searchParams.get("state") || "";
        if (!code || !state) throw new Error("OAuth callback 缺少 code/state。");
        const result = await evomapExchangeCode(code, state);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(evomapHtml("EvoMap 已连接 Orbit", `授权成功，scope：${evomapClean(result.scope, 300)}。主 Agent 现在可以在规划前调用 EvoMap MCP。`));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found", path: u.pathname }));
    } catch (e) {
      if (u.pathname.startsWith("/oauth/evomap/")) evomapRecordOAuthError(u.pathname.replace("/oauth/evomap/", "") || "oauth", e);
      res.writeHead(500, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(evomapHtml("EvoMap 授权失败", evomapClean(e?.message || String(e), 500)));
    }
  }
  handleConnection(ws) {
    const clientId = "client-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    const client = { ws, id: clientId, connectedAt: /* @__PURE__ */ new Date() };
    this.clients.set(clientId, client);
    this.send(ws, {
      type: "hub:connected",
      clientId,
      agents: this.registry.getAll().map((a) => ({ id: a.id, name: a.name, status: a.status, capabilities: a.capabilities }))
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.emit("client:message", { clientId, message: msg });
      } catch {
      }
    });
    ws.on("close", () => this.clients.delete(clientId));
    this.emit("client:connected", client);
  }
  broadcast(type, payload) {
    const message = JSON.stringify({ type, payload, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    for (const [, client] of this.clients) {
      if (client.ws.readyState === WebSocket.WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }
  send(ws, data) {
    if (ws.readyState === WebSocket.WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }
  getClientCount() {
    return this.clients.size;
  }
  getUrl() {
    return "ws://localhost:" + this.port;
  }
}
class BaseAgentAdapter extends node_events.EventEmitter {
  status = "idle";
  onOutput = null;
  onError = null;
  process = null;
  buffer = "";
  startCount = 0;
  handleOutput(chunk) {
    if (this.onOutput) this.onOutput(chunk);
  }
  handleError(err) {
    this.status = "error";
    if (this.onError) this.onError(err);
  }
}
function quoteForCommandShell(value) {
  if (/^[A-Za-z0-9_./:\\=@%+-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}
function resolvePromptArg(prompt, needsCommandShell) {
  return needsCommandShell ? prompt.replace(/\r?\n/g, " ") : prompt;
}
class StdioAgentAdapter extends BaseAgentAdapter {
  id;
  name;
  binary = "";
  protocol = "stdio-plain";
  mode = "oneshot";
  /** oneshot 参数；可被路由绑定的 args 覆盖 */
  execArgs;
  /** 活动解析器（如 claude stream-json）。set 则按行缓冲 stdout、逐行解析为活动步骤/最终内容；
      null（默认）= 原样把 stdout 透传给 onOutput，行为与历史完全一致（零回归）。 */
  activityParser = null;
  /** 解析出的活动步骤回调（dispatcher 透传成 {kind:'activity'} 流事件） */
  onActivity = null;
  proc = null;
  errChunks = [];
  errBytes = 0;
  outDecoder = null;
  lineBuf = "";
  constructor(id, name, defaultBinary, defaultArgs) {
    super();
    this.id = id;
    this.name = name;
    this.binary = defaultBinary;
    this.execArgs = defaultArgs;
  }
  /** oneshot：start 仅做预检（fail fast），真正 spawn 发生在 send() */
  async start() {
    if (this.binary && /[\\/]/.test(this.binary)) {
      if (!fs.existsSync(this.binary)) {
        this.status = "error";
        throw new Error(this.name + " 二进制不存在: " + this.binary + "（请在 设置→路由→StdIO 修改路径或留空自动探测）");
      }
    } else if (this.binary) {
      try {
        child_process.execSync(
          (process.platform === "win32" ? "where " : "which ") + this.binary,
          { timeout: 2e3, encoding: "utf-8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
        );
      } catch {
        this.status = "error";
        throw new Error("未检测到 " + this.name + " CLI（PATH 中没有 “" + this.binary + "”）。请先安装该 CLI，或在 设置→路由→StdIO 填写完整二进制路径。");
      }
    }
    this.status = "idle";
    this.startCount++;
  }
  send(prompt, opts) {
    this.buffer = "";
    this.errChunks = [];
    this.errBytes = 0;
    this.lineBuf = "";
    this.outDecoder = new TextDecoder("utf-8");
    const viaArg = this.execArgs.some((a) => a.includes("{prompt}"));
    const needsCommandShell = process.platform === "win32" && !/\.exe$/i.test(this.binary);
    const promptArg = resolvePromptArg(prompt, needsCommandShell);
    const args = viaArg ? this.execArgs.map((a) => a.replace("{prompt}", promptArg)) : this.execArgs;
    const cmd = needsCommandShell ? process.env.ComSpec || "cmd.exe" : this.binary;
    const spawnArgs = needsCommandShell ? ["/d", "/s", "/c", [this.binary, ...args].map(quoteForCommandShell).join(" ")] : args;
    const requested = typeof opts?.cwd === "string" ? opts.cwd.trim() : "";
    let cwd = os.homedir();
    if (requested) {
      try {
        const st = fs.statSync(requested);
        if (st.isDirectory()) cwd = requested;
        else console.warn("[StdioAgentAdapter] cwd 存在但不是目录，已回退 home:", requested);
      } catch {
        console.warn("[StdioAgentAdapter] cwd 不可访问，已回退 home:", requested);
      }
    }
    this.proc = child_process.spawn(cmd, spawnArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsVerbatimArguments: needsCommandShell,
      cwd,
      // 本地 CLI 以管道方式 spawn（非真实终端）。显式声明”非交互纯文本管道”：
      // - TERM=dumb / NO_COLOR：让基于 prompt_toolkit / rich / curses 的 CLI 退化为纯文本，
      //   而不是去查询 Windows 控制台屏幕缓冲区导致 NoConsoleScreenBufferError 崩溃
      //   （Hermes 等 Python TUI 继承到 TERM=xterm-256color 时正是这样崩的），同时避免 ANSI
      //   颜色码污染聊天气泡；
      // - PYTHONUNBUFFERED：Python CLI 实时回流输出（更好的流式体验）；
      // - PYTHONIOENCODING=utf-8：修正 Windows 下 Python 输出的 GBK 乱码。
      env: { ...process.env, TERM: "dumb", NO_COLOR: "1", PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
      windowsHide: true
    });
    this.status = "busy";
    this.proc.stdout?.on("data", (d) => {
      const text = this.outDecoder ? this.outDecoder.decode(d, { stream: true }) : d.toString();
      if (!text) return;
      this.buffer += text;
      if (this.activityParser) this.handleActivityChunk(text);
      else this.handleOutput(text);
    });
    this.proc.stderr?.on("data", (d) => {
      this.errChunks.push(d);
      this.errBytes += d.length;
      while (this.errBytes > 16384 && this.errChunks.length > 1) {
        this.errBytes -= this.errChunks[0].length;
        this.errChunks.shift();
      }
    });
    this.proc.on("error", (e) => {
      this.proc = null;
      this.handleError(e);
    });
    this.proc.on("exit", (code) => {
      if (this.activityParser && this.lineBuf.trim()) {
        this.consumeActivityLine(this.lineBuf);
        this.lineBuf = "";
      }
      const failed = code !== 0 && code !== null;
      this.proc = null;
      this.status = "idle";
      if (failed) {
        const detail = this.decodeStderr().trim().slice(-500);
        this.handleError(new Error(this.name + " 退出码 " + code + (detail ? "：" + detail : "")));
      }
    });
    try {
      if (!viaArg) this.proc.stdin?.write(prompt);
      this.proc.stdin?.end();
    } catch (e) {
      this.handleError(e);
    }
  }
  /** 活动模式：按行缓冲 stdout，逐完整行交给 activityParser。 */
  handleActivityChunk(text) {
    this.lineBuf += text;
    let nl;
    while ((nl = this.lineBuf.indexOf("\n")) >= 0) {
      const line = this.lineBuf.slice(0, nl);
      this.lineBuf = this.lineBuf.slice(nl + 1);
      this.consumeActivityLine(line);
    }
  }
  /** 单行 → 活动步骤（onActivity）/ 最终内容（handleOutput）。解析器抛错则回退把原行当内容透传。 */
  consumeActivityLine(line) {
    const parser = this.activityParser;
    if (!parser) return;
    let parsed;
    try {
      parsed = parser(line);
    } catch {
      parsed = { content: line.endsWith("\n") ? line : line + "\n" };
    }
    if (!parsed) return;
    if (parsed.steps) {
      for (const s of parsed.steps) {
        if (this.onActivity) this.onActivity(s);
      }
    }
    if (parsed.content) this.handleOutput(parsed.content);
  }
  /** stderr 解码：先 UTF-8，出现替换符则按 GBK 重解（Windows 中文 cmd 错误信息） */
  decodeStderr() {
    if (this.errChunks.length === 0) return "";
    const raw = Buffer.concat(this.errChunks);
    let text = raw.toString("utf8");
    if (text.includes("�")) {
      try {
        text = new TextDecoder("gbk").decode(raw);
      } catch {
      }
    }
    return text;
  }
  async stop() {
    const p = this.proc;
    this.proc = null;
    if (p?.pid) {
      if (process.platform === "win32") {
        try {
          child_process.exec(`taskkill /pid ${p.pid} /t /f`, { windowsHide: true });
        } catch {
        }
      } else {
        try {
          p.kill("SIGKILL");
        } catch {
        }
      }
    }
    this.status = "idle";
  }
}
function fromPath(cmd) {
  try {
    const out = child_process.execSync(
      (process.platform === "win32" ? "where " : "which ") + cmd,
      { timeout: 2e3, encoding: "utf-8", windowsHide: true }
    );
    const first = out.trim().split(/\r?\n/)[0]?.trim();
    return first || null;
  } catch {
    return null;
  }
}
function dedupe(cands) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const c of cands) {
    if (!c || !c.path) continue;
    const key = c.path.toLowerCase();
    if (seen.has(key)) continue;
    if (!fs.existsSync(c.path)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
function envCandidate(envVar) {
  const p = process.env[envVar];
  return p ? { source: "terminal", label: "环境变量 " + envVar, path: p } : null;
}
function npmCandidate(name) {
  const p = process.env.APPDATA ? path.join(process.env.APPDATA, "npm", name + ".cmd") : "";
  return p ? { source: "terminal", label: "终端版 (npm)", path: p } : null;
}
function pathCandidate(name) {
  const p = fromPath(name);
  return p ? { source: "terminal", label: "终端版 (PATH)", path: p } : null;
}
function codexCandidates() {
  const cands = [envCandidate("CODEX_PATH")];
  try {
    const toml = fs.readFileSync(path.join(os.homedir(), ".codex", "config.toml"), "utf-8");
    const m = toml.match(/CODEX_CLI_PATH\s*=\s*['"]([^'"]+)['"]/);
    if (m) cands.push({ source: "desktop", label: "桌面版 (OpenAI Codex)", path: m[1] });
  } catch {
  }
  try {
    const bin = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "OpenAI", "Codex", "bin");
    if (fs.existsSync(bin)) {
      const newest = fs.readdirSync(bin).map((d) => path.join(bin, d, "codex.exe")).filter((p) => fs.existsSync(p)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
      if (newest) cands.push({ source: "desktop", label: "桌面版 (安装目录)", path: newest });
    }
  } catch {
  }
  cands.push({ source: "desktop", label: "桌面版 (Codex.app)", path: "/Applications/Codex.app/Contents/Resources/codex" });
  cands.push({ source: "terminal", label: "终端版 (cargo)", path: path.join(os.homedir(), ".cargo", "bin", "codex.exe") });
  cands.push({ source: "terminal", label: "终端版 (cargo)", path: path.join(os.homedir(), ".cargo", "bin", "codex") });
  cands.push(npmCandidate("codex"));
  cands.push(pathCandidate("codex"));
  return dedupe(cands);
}
function locateCodexBinary() {
  return codexCandidates()[0]?.path ?? null;
}
function scanClaudeHome() {
  const home = path.join(os.homedir(), ".claude");
  if (!fs.existsSync(home)) return null;
  const hits = [];
  const isClaudeExe = (f) => /^claude[\w.-]*\.(exe|cmd)$/i.test(f);
  for (const sub of ["local", "bin", "downloads", "versions", "dist", "app", "cli"]) {
    const lvl1 = path.join(home, sub);
    if (!fs.existsSync(lvl1)) continue;
    try {
      for (const e of fs.readdirSync(lvl1, { withFileTypes: true })) {
        const p = path.join(lvl1, e.name);
        if (e.isFile() && isClaudeExe(e.name)) hits.push(p);
        else if (e.isDirectory()) {
          try {
            for (const f of fs.readdirSync(p)) {
              if (isClaudeExe(f)) hits.push(path.join(p, f));
            }
          } catch {
          }
        }
      }
    } catch {
    }
  }
  if (hits.length === 0) return null;
  return hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}
function scanClaudeCodeApp() {
  const roots = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "Claude", "claude-code") : "",
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Claude-3p", "claude-code")
  ].filter(Boolean);
  const hits = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    try {
      for (const ver of fs.readdirSync(root)) {
        const exe = path.join(root, ver, "claude.exe");
        if (fs.existsSync(exe)) hits.push(exe);
      }
    } catch {
    }
  }
  return hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).map((p) => ({ source: "desktop", label: "桌面版 (Claude Code)", path: p }));
}
function claudeCandidates() {
  const local = scanClaudeHome();
  return dedupe([
    envCandidate("CLAUDE_PATH"),
    ...scanClaudeCodeApp(),
    npmCandidate("claude"),
    { source: "terminal", label: "终端版 (本地安装器)", path: path.join(os.homedir(), ".local", "bin", "claude.exe") },
    { source: "terminal", label: "终端版 (本地安装器)", path: path.join(os.homedir(), ".local", "bin", "claude") },
    local ? { source: "desktop", label: "本地安装版 (~/.claude)", path: local } : null,
    pathCandidate("claude")
  ]);
}
function locateClaudeBinary() {
  return claudeCandidates()[0]?.path ?? null;
}
function genericCandidates(envVar, names, programDirs) {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const cands = [envCandidate(envVar)];
  for (const d of programDirs) {
    for (const n of names) {
      cands.push({ source: "desktop", label: "桌面版 (" + d + ")", path: path.join(local, "Programs", d, n + ".exe") });
      cands.push({ source: "desktop", label: "桌面版 (" + d + ")", path: path.join(local, d, n + ".exe") });
      cands.push({ source: "desktop", label: "桌面版 (" + d + ")", path: path.join(local, d, "bin", n + ".exe") });
    }
  }
  for (const n of names) {
    cands.push(npmCandidate(n));
    cands.push({ source: "terminal", label: "终端版", path: path.join(os.homedir(), ".local", "bin", n + ".exe") });
    cands.push({ source: "terminal", label: "终端版", path: path.join(os.homedir(), ".local", "bin", n) });
    cands.push({ source: "terminal", label: "终端版 (cargo)", path: path.join(os.homedir(), ".cargo", "bin", n + ".exe") });
  }
  for (const n of names) {
    cands.push(pathCandidate(n));
  }
  return dedupe(cands);
}
function hermesCandidates() {
  return genericCandidates("HERMES_PATH", ["hermes"], ["Hermes"]);
}
function locateHermesBinary() {
  return hermesCandidates()[0]?.path ?? null;
}
function openclawCandidates() {
  return genericCandidates("OPENCLAW_PATH", ["openclaw", "clawd"], ["OpenClaw", "Clawd on Desk", "Clawd"]);
}
function locateOpenclawBinary() {
  return openclawCandidates()[0]?.path ?? null;
}
function minimaxCodeCandidates() {
  return dedupe([
    envCandidate("MINIMAX_CODE_PATH"),
    { source: "desktop", label: "桌面版内置 (opencode)", path: "D:\\minimax\\MiniMax Code\\resources\\resources\\opencode\\opencode.exe" },
    {
      source: "desktop",
      label: "桌面版内置 (opencode)",
      path: path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "MiniMax Code", "resources", "resources", "opencode", "opencode.exe")
    },
    pathCandidate("opencode")
  ]);
}
function locateMinimaxCodeBinary() {
  return minimaxCodeCandidates()[0]?.path ?? null;
}
function marvisCandidates() {
  return dedupe([envCandidate("MARVIS_PATH")]);
}
function locateMarvisBinary() {
  return marvisCandidates()[0]?.path ?? null;
}
function locateAgentCandidates() {
  return {
    codex: codexCandidates(),
    claude: claudeCandidates(),
    hermes: hermesCandidates(),
    openclaw: openclawCandidates(),
    marvis: marvisCandidates(),
    "minimax-code": minimaxCodeCandidates()
  };
}
function basename$1(path2) {
  if (!path2) return "";
  const parts = String(path2).split(/[\\/]/);
  return parts[parts.length - 1] || String(path2);
}
function oneLine$1(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
function truncate$1(value, max) {
  const text = String(value ?? "");
  return text.length > max ? text.slice(0, max) + "…" : text;
}
function firstText$1(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map((part) => firstText$1(part)).filter((part) => typeof part === "string" && part.length > 0);
    return parts.length ? parts.join("") : null;
  }
  if (value && typeof value === "object") {
    return firstText$1(value.text ?? value.content ?? value.message ?? value.output ?? value.final);
  }
  return null;
}
function codexCommandLabel(command) {
  const raw = String(command ?? "").replace(/\s+/g, " ").trim();
  const quotedExe = raw.match(/^"([^"]+)"\s*(.*)$/);
  if (quotedExe) {
    const exe = basename$1(quotedExe[1]);
    const rest = quotedExe[2]?.trim();
    return `$ ${oneLine$1(rest ? `${exe} ${rest}` : exe, 72)}`;
  }
  return `$ ${oneLine$1(raw, 72)}`;
}
function parseCodexStreamJsonLine(line) {
  const trimmed = (line ?? "").trim();
  if (!trimmed) return null;
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { content: line.endsWith("\n") ? line : line + "\n" };
  }
  if (!obj || typeof obj !== "object") return { content: line + "\n" };
  const item = obj.item;
  if (!item || typeof item !== "object") return null;
  if (item.type === "command_execution") {
    if (obj.type === "item.started") {
      return {
        steps: [{
          id: String(item.id || item.command || "command"),
          kind: "tool",
          tool: "command_execution",
          label: codexCommandLabel(item.command),
          detail: truncate$1(item.command, 400) || void 0,
          status: "running"
        }]
      };
    }
    if (obj.type === "item.completed") {
      const exitCode = typeof item.exit_code === "number" ? item.exit_code : 0;
      return {
        steps: [{
          id: String(item.id || item.command || "command"),
          status: exitCode === 0 ? "done" : "error",
          output: truncate$1(item.aggregated_output, 800).trim() || void 0
        }]
      };
    }
  }
  if (obj.type === "item.completed" && item.type === "agent_message") {
    const content = firstText$1(item.text ?? item.message ?? item.content ?? item.output ?? item.final);
    return typeof content === "string" ? { content } : null;
  }
  return null;
}
class CodexAdapter extends StdioAgentAdapter {
  constructor() {
    super("codex", "Codex CLI", locateCodexBinary() || "codex", ["exec", "--json", "--sandbox", "danger-full-access", "--skip-git-repo-check", "-C", ".", "-"]);
    this.activityParser = parseCodexStreamJsonLine;
  }
}
function basename(p) {
  if (!p) return "";
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || String(p);
}
function oneLine(s, max) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}
function truncate(s, max) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) + "…" : t;
}
function stringifyToolResult(c) {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((x) => typeof x === "string" ? x : x?.text ?? "").join("\n").trim();
  if (c == null) return "";
  try {
    return JSON.stringify(c);
  } catch {
    return String(c);
  }
}
function claudeToolLabel(name, input) {
  const n = name || "tool";
  const i = input && typeof input === "object" ? input : {};
  switch (n) {
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return `${n} · ${basename(i.file_path || i.path || i.notebook_path || "")}`.trim();
    case "Read":
      return `Read · ${basename(i.file_path || i.path || "")}`.trim();
    case "Bash":
      return `$ ${oneLine(i.command, 64)}`;
    case "Grep":
      return `Grep · ${oneLine(i.pattern, 44)}`;
    case "Glob":
      return `Glob · ${oneLine(i.pattern, 44)}`;
    case "WebFetch":
      return `WebFetch · ${oneLine(i.url, 52)}`;
    case "WebSearch":
      return `WebSearch · ${oneLine(i.query, 52)}`;
    case "Task":
      return `Task · ${oneLine(i.description || i.subagent_type, 44)}`;
    default: {
      const firstStr = Object.values(i).find((v) => typeof v === "string");
      return firstStr ? `${n} · ${oneLine(firstStr, 52)}` : n;
    }
  }
}
function claudeToolDetail(name, input) {
  const i = input && typeof input === "object" ? input : {};
  switch (name) {
    case "Bash":
      return i.command ? truncate(i.command, 400) : void 0;
    case "Write":
      return typeof i.content === "string" ? truncate(i.content, 360) : void 0;
    case "Edit":
    case "MultiEdit":
      return i.old_string || i.new_string ? truncate(`- ${i.old_string ?? ""}
+ ${i.new_string ?? ""}`, 360) : void 0;
    default: {
      const v = i.file_path || i.path || i.pattern || i.url || i.query;
      return v ? String(v) : void 0;
    }
  }
}
function parseClaudeStreamJsonLine(line) {
  const trimmed = (line ?? "").trim();
  if (!trimmed) return null;
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { content: line.endsWith("\n") ? line : line + "\n" };
  }
  if (!obj || typeof obj !== "object") return { content: line + "\n" };
  switch (obj.type) {
    case "system":
      return null;
    case "assistant": {
      const blocks = obj.message?.content;
      if (!Array.isArray(blocks)) return null;
      const steps = [];
      for (const b of blocks) {
        if (b?.type === "tool_use" && b.id) {
          steps.push({
            id: String(b.id),
            kind: "tool",
            tool: b.name,
            label: claudeToolLabel(b.name, b.input),
            detail: claudeToolDetail(b.name, b.input),
            status: "running"
          });
        }
      }
      return steps.length ? { steps } : null;
    }
    case "user": {
      const blocks = obj.message?.content;
      if (!Array.isArray(blocks)) return null;
      const steps = [];
      for (const b of blocks) {
        if (b?.type === "tool_result" && b.tool_use_id) {
          steps.push({
            id: String(b.tool_use_id),
            status: b.is_error ? "error" : "done",
            output: truncate(stringifyToolResult(b.content), 800) || void 0
          });
        }
      }
      return steps.length ? { steps } : null;
    }
    case "result": {
      const text = typeof obj.result === "string" ? obj.result : typeof obj.error === "string" ? obj.error : "";
      return { content: text };
    }
    default:
      return null;
  }
}
class ClaudeAdapter extends StdioAgentAdapter {
  constructor() {
    super(
      "claude",
      "Claude Code",
      locateClaudeBinary() || "claude",
      ["--print", "--verbose", "--output-format", "stream-json", "--permission-mode", "acceptEdits"]
    );
    this.activityParser = parseClaudeStreamJsonLine;
  }
}
class HermesAdapter extends StdioAgentAdapter {
  constructor() {
    super("hermes", "Hermes", locateHermesBinary() || "hermes", ["-z", "{prompt}"]);
  }
}
class OpenClawAdapter extends StdioAgentAdapter {
  constructor() {
    super("openclaw", "OpenClaw", locateOpenclawBinary() || "openclaw", ["crestodian", "--message", "{prompt}"]);
  }
}
class MarvisAdapter extends StdioAgentAdapter {
  constructor() {
    super("marvis", "Marvis", locateMarvisBinary() || "marvis", []);
  }
}
class MinimaxCodeAdapter extends StdioAgentAdapter {
  constructor() {
    super("minimax-code", "MiniMax Code", locateMinimaxCodeBinary() || "opencode", ["run", "{prompt}"]);
  }
}
const STATUS_MAP = {
  pending: "running",
  in_progress: "running",
  completed: "done",
  failed: "error"
};
function clip$1(s, n) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function acpBlockText(c) {
  if (!c) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(acpBlockText).join("");
  if (c.type === "text") return c.text || "";
  return "";
}
function acpToolContent(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const item of content) {
    if (!item) continue;
    if (item.type === "content") parts.push(acpBlockText(item.content));
    else if (item.type === "diff") parts.push(`--- ${item.path}
${clip$1(item.newText ?? "", 300)}`);
  }
  return clip$1(parts.filter(Boolean).join("\n"), 800);
}
function mapAcpUpdate(update) {
  if (!update || typeof update !== "object") return null;
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const t = acpBlockText(update.content);
      return t ? { content: t } : null;
    }
    case "agent_thought_chunk": {
      const t = acpBlockText(update.content);
      return t ? { thinking: t } : null;
    }
    case "tool_call": {
      if (!update.toolCallId) return null;
      const loc = Array.isArray(update.locations) && update.locations[0]?.path;
      const detail = update.rawInput ? clip$1(safeJson(update.rawInput), 400) : loc || "";
      return {
        steps: [{
          id: String(update.toolCallId),
          kind: "tool",
          tool: update.kind || "tool",
          label: update.title || update.kind || "tool",
          detail: detail || void 0,
          status: STATUS_MAP[update.status] || "running"
        }]
      };
    }
    case "tool_call_update": {
      if (!update.toolCallId) return null;
      const out = acpToolContent(update.content);
      return {
        steps: [{
          id: String(update.toolCallId),
          status: STATUS_MAP[update.status] || "running",
          output: out || void 0
        }]
      };
    }
    default:
      return null;
  }
}
function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
function hasAnyKey(obj, keys) {
  if (!obj || typeof obj !== "object") return false;
  return keys.some((k) => Object.prototype.hasOwnProperty.call(obj, k));
}
function isWithin(root, target) {
  const rel = node_path.relative(root, target);
  return rel === "" || rel !== ".." && !rel.startsWith(".." + node_path.sep) && !rel.startsWith("../") && !node_path.isAbsolute(rel);
}
function firstExistingAncestor(path2) {
  let cur = path2;
  for (let i = 0; i < 64; i++) {
    try {
      node_fs.statSync(cur);
      return cur;
    } catch {
      const parent = node_path.dirname(cur);
      if (parent === cur) return null;
      cur = parent;
    }
  }
  return null;
}
function acpResolveWorkspacePath(root, requested) {
  if (typeof requested !== "string" || !requested.trim()) return { ok: false, error: "path must be a non-empty string" };
  const rootAbs = node_path.resolve(root);
  let rootReal;
  try {
    rootReal = node_fs.realpathSync(rootAbs);
  } catch {
    return { ok: false, error: "workspace root is not accessible" };
  }
  const raw = requested.trim();
  const abs = node_path.isAbsolute(raw) ? node_path.resolve(raw) : node_path.resolve(rootReal, raw);
  if (!isWithin(rootAbs, abs) && !isWithin(rootReal, abs)) return { ok: false, error: "path escapes the workspace" };
  const ancestor = firstExistingAncestor(abs);
  if (!ancestor) return { ok: false, error: "path has no existing ancestor" };
  let ancestorReal;
  try {
    ancestorReal = node_fs.realpathSync(ancestor);
  } catch {
    return { ok: false, error: "path ancestor is not accessible" };
  }
  if (!isWithin(rootReal, ancestorReal)) return { ok: false, error: "path escapes the workspace through a symlink" };
  return { ok: true, path: abs };
}
function acpReadTextFile(root, params) {
  const resolved = acpResolveWorkspacePath(root, params?.path);
  if (!resolved.ok || !resolved.path) return resolved;
  let content;
  try {
    const st = node_fs.statSync(resolved.path);
    if (!st.isFile()) return { ok: false, error: "not a file" };
    content = node_fs.readFileSync(resolved.path, "utf-8");
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const line = Number(params?.line);
  const limit = Number(params?.limit);
  if (Number.isFinite(line) || Number.isFinite(limit)) {
    const lines = content.split(/\r?\n/);
    const start = Number.isFinite(line) ? Math.max(0, Math.floor(line) - 1) : 0;
    const end = Number.isFinite(limit) ? start + Math.max(0, Math.floor(limit)) : void 0;
    content = lines.slice(start, end).join("\n");
  }
  return { ok: true, path: resolved.path, content };
}
function acpWriteTextFile(root, params) {
  const resolved = acpResolveWorkspacePath(root, params?.path);
  if (!resolved.ok || !resolved.path) return resolved;
  if (typeof params?.content !== "string") return { ok: false, error: "content must be a string" };
  try {
    node_fs.mkdirSync(node_path.dirname(resolved.path), { recursive: true });
    node_fs.writeFileSync(resolved.path, params.content, "utf-8");
    return { ok: true, path: resolved.path };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
function acpPermissionRequest(params) {
  const toolCall = params?.toolCall || params?.tool_call || params?.tool || params?.call || {};
  const input = toolCall.rawInput || toolCall.input || params?.rawInput || params?.input || {};
  const toolName = firstString(
    toolCall.kind,
    toolCall.name,
    toolCall.tool,
    params?.kind,
    params?.toolName,
    params?.permission,
    params?.action
  ) || "tool";
  const label = firstString(toolCall.title, params?.title, params?.description, toolName);
  const haystack = [
    toolName,
    label,
    params?.description,
    params?.action,
    params?.permission,
    input?.command,
    input?.cmd,
    input?.shell
  ].filter(Boolean).join(" ").toLowerCase();
  let tool = null;
  if (/\b(exec|bash|shell|terminal|command|run_command|run)\b/.test(haystack) || typeof input?.command === "string") {
    tool = "exec";
  } else if (/\b(write|edit|modify|delete|create|save|patch|apply_patch|move|rename)\b/.test(haystack) || hasAnyKey(input, ["content", "newText", "oldText", "edits", "patch", "diff"])) {
    tool = "write";
  } else if (/\b(read|list|grep|glob|search|view)\b/.test(haystack)) {
    tool = null;
  }
  const detail = clip$1(
    firstString(input?.command, input?.path, input?.file_path, input?.filepath) || (Object.keys(input || {}).length ? safeJson(input) : safeJson(params)),
    800
  );
  return { tool, toolName, label, detail, raw: params };
}
class AcpClient {
  constructor(binary, args, env) {
    this.binary = binary;
    this.args = args;
    this.env = env;
  }
  proc = null;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  buf = "";
  decoder = new TextDecoder("utf-8");
  initResult = null;
  /** 当前活跃 prompt 的 update 处理器（按 sessionId） */
  promptHandlers = /* @__PURE__ */ new Map();
  /** ACP sessionId → workspace root，用于 client fs handler 的沙箱边界。 */
  sessionRoots = /* @__PURE__ */ new Map();
  /** server 崩溃 / 退出回调（adapter 用于把错误外显） */
  onCrash = null;
  get running() {
    return !!this.proc;
  }
  get agentCapabilities() {
    return this.initResult?.agentCapabilities ?? null;
  }
  /** spawn server 并完成 initialize 握手。幂等：已启动则直接返回。 */
  async start(cwd) {
    if (this.proc) return;
    const proc = node_child_process.spawn(this.binary, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: cwd || void 0,
      env: { ...process.env, ...this.env || {} },
      windowsHide: true
    });
    this.proc = proc;
    proc.stdout?.on("data", (d) => this.onStdout(d));
    proc.stderr?.on("data", () => {
    });
    proc.on("error", (e) => this.handleExit(e));
    proc.on("exit", (code) => this.handleExit(new Error(`ACP server '${this.binary}' 退出（code ${code}）`)));
    this.initResult = await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      clientInfo: { name: "Orbit Hub", version: "0.5.2" }
    });
  }
  /** 新建会话，返回 sessionId。 */
  async newSession(cwd) {
    const res = await this.request("session/new", { cwd, mcpServers: [] });
    const sid = res?.sessionId;
    if (!sid) throw new Error("ACP session/new 未返回 sessionId");
    const sessionId = String(sid);
    this.sessionRoots.set(sessionId, cwd);
    return sessionId;
  }
  /** 发一轮 prompt，消费 session/update 直到 prompt 响应返回 stopReason。 */
  async prompt(sessionId, text, handlers) {
    this.promptHandlers.set(sessionId, handlers);
    try {
      const res = await this.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text }]
      });
      return res?.stopReason || "end_turn";
    } finally {
      this.promptHandlers.delete(sessionId);
    }
  }
  /** 中断当前轮（通知，无响应）。 */
  cancel(sessionId) {
    this.notify("session/cancel", { sessionId });
  }
  stop() {
    const p = this.proc;
    this.proc = null;
    if (p?.pid) {
      try {
        p.kill();
      } catch {
      }
    }
  }
  /* ---------------- JSON-RPC 收发 ---------------- */
  request(method, params) {
    if (!this.proc) return Promise.reject(new Error("ACP server 未启动"));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve2, reject) => {
      this.pending.set(id, { resolve: resolve2, reject });
      try {
        this.proc.stdin?.write(payload);
      } catch (e) {
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  notify(method, params) {
    if (!this.proc) return;
    try {
      this.proc.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    } catch {
    }
  }
  respond(id, result) {
    if (!this.proc) return;
    try {
      this.proc.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
    } catch {
    }
  }
  respondError(id, code, message) {
    if (!this.proc) return;
    try {
      this.proc.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
    } catch {
    }
  }
  onStdout(d) {
    this.buf += this.decoder.decode(d, { stream: true });
    let nl;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line) this.handleMessage(line);
    }
  }
  /** 处理一条 JSON-RPC 消息（response / agent→client request / notification）。 */
  handleMessage(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    if (msg.id !== void 0 && msg.method === void 0) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error?.message || "ACP error " + safeJson(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    if (msg.id !== void 0 && typeof msg.method === "string") {
      this.handleServerRequest(msg);
      return;
    }
    if (typeof msg.method === "string") {
      this.handleNotification(msg);
    }
  }
  handleServerRequest(msg) {
    if (msg.method === "session/request_permission") {
      void this.handlePermissionRequest(msg);
      return;
    }
    if (msg.method === "fs/read_text_file") {
      const root = this.sessionRoots.get(String(msg.params?.sessionId || ""));
      if (!root) return this.respondError(msg.id, -32e3, "unknown ACP session");
      const res = acpReadTextFile(root, msg.params);
      if (res.ok) this.respond(msg.id, { content: res.content ?? "" });
      else this.respondError(msg.id, -32e3, res.error || "read_text_file failed");
      return;
    }
    if (msg.method === "fs/write_text_file") {
      void this.handleWriteTextFileRequest(msg);
      return;
    }
    this.respondError(msg.id, -32601, "method not supported by client");
  }
  async handleWriteTextFileRequest(msg) {
    const sid = String(msg.params?.sessionId || "");
    const root = this.sessionRoots.get(sid);
    if (!root) return this.respondError(msg.id, -32e3, "unknown ACP session");
    const handler = this.promptHandlers.get(sid)?.onRequestPermission;
    if (!handler) return this.respondError(msg.id, -32e3, "write_text_file requires an active prompt approval context");
    let approved = false;
    try {
      approved = await handler({
        tool: "write",
        toolName: "fs/write_text_file",
        label: "Write file",
        detail: firstString(msg.params?.path) || safeJson(msg.params),
        raw: msg.params
      });
    } catch {
      approved = false;
    }
    if (!approved) return this.respondError(msg.id, -32e3, "write_text_file denied by approval policy");
    const res = acpWriteTextFile(root, msg.params);
    if (res.ok) this.respond(msg.id, null);
    else this.respondError(msg.id, -32e3, res.error || "write_text_file failed");
  }
  async handlePermissionRequest(msg) {
    const opts = Array.isArray(msg.params?.options) ? msg.params.options : [];
    const pick = opts.find((o) => o.kind === "allow_once") || opts.find((o) => o.kind === "allow_always") || opts[0];
    const deny = opts.find((o) => /deny|reject/i.test(String(o.kind || o.optionId || o.name || "")));
    const req = acpPermissionRequest(msg.params);
    let approved = true;
    const sid = msg.params?.sessionId;
    const handler = sid ? this.promptHandlers.get(sid)?.onRequestPermission : void 0;
    if (handler && req.tool) {
      try {
        approved = await handler(req);
      } catch {
        approved = false;
      }
    }
    if (approved && pick) {
      this.respond(msg.id, { outcome: { outcome: "selected", optionId: pick.optionId } });
    } else if (!approved && deny) {
      this.respond(msg.id, { outcome: { outcome: "selected", optionId: deny.optionId } });
    } else {
      this.respond(msg.id, { outcome: { outcome: "cancelled" } });
    }
  }
  handleNotification(msg) {
    if (msg.method !== "session/update") return;
    const sid = msg.params?.sessionId;
    const handlers = sid ? this.promptHandlers.get(sid) : void 0;
    if (!handlers) return;
    const mapped = mapAcpUpdate(msg.params?.update);
    if (!mapped) return;
    if (mapped.content && handlers.onChunk) handlers.onChunk(mapped.content);
    if (mapped.thinking && handlers.onThought) handlers.onThought(mapped.thinking);
    if (mapped.steps && handlers.onActivity) for (const s of mapped.steps) handlers.onActivity(s);
  }
  handleExit(err) {
    this.proc = null;
    this.initResult = null;
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
    this.promptHandlers.clear();
    this.sessionRoots.clear();
    if (this.onCrash) this.onCrash(err);
  }
}
function acpDefaults(agentId) {
  switch (agentId) {
    case "minimax-code":
      return { binary: locateMinimaxCodeBinary() || "opencode", args: ["acp"] };
    case "hermes":
      return { binary: locateHermesBinary() || "hermes", args: ["acp", "--accept-hooks"] };
    case "openclaw":
      return { binary: locateOpenclawBinary() || "openclaw", args: ["acp"] };
    default:
      return null;
  }
}
const ACP_ENV = { PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", NO_COLOR: "1" };
class AcpAgentAdapter {
  id;
  name;
  binary;
  protocol = "acp";
  mode = "interactive";
  status = "idle";
  onOutput = null;
  onError = null;
  acpArgs;
  client = null;
  currentSession = null;
  constructor(id, name, binary, acpArgs) {
    this.id = id;
    this.name = name;
    this.binary = binary;
    this.acpArgs = acpArgs;
  }
  /** 预检：完整路径二进制需存在（裸命令交给 spawn 时再报错）。 */
  async start() {
    if (this.binary && /[\\/]/.test(this.binary) && !node_fs.existsSync(this.binary)) {
      this.status = "error";
      throw new Error(this.name + " ACP 二进制不存在: " + this.binary + "（设置→路由→填写完整路径或留空自动探测）");
    }
    this.status = "idle";
  }
  async stop() {
    if (this.client) {
      this.client.stop();
      this.client = null;
    }
    this.currentSession = null;
    this.status = "idle";
  }
  /** AgentAdapter 接口要求；ACP 不走 oneshot send，dispatcher 用 runPrompt。 */
  send(_prompt) {
  }
  /** 中断当前轮（发 session/cancel）。 */
  cancel() {
    if (this.client && this.currentSession) this.client.cancel(this.currentSession);
  }
  /** 一轮 ACP 对话：确保 server 起 + initialize → session/new(cwd) → session/prompt → stopReason。 */
  async runPrompt(text, cwd, handlers) {
    await this.ensureStarted(cwd);
    const client = this.client;
    const sid = await client.newSession(cwd);
    this.currentSession = sid;
    this.status = "busy";
    try {
      return await client.prompt(sid, text, handlers);
    } finally {
      this.currentSession = null;
      this.status = "idle";
    }
  }
  async ensureStarted(cwd) {
    if (this.client?.running) return;
    this.client = new AcpClient(this.binary, this.acpArgs, ACP_ENV);
    this.client.onCrash = (e) => {
      this.status = "error";
      if (this.onError) this.onError(e);
    };
    await this.client.start(cwd);
  }
}
class HttpAgentAdapter {
  id;
  name;
  binary = "provider";
  protocol = "http";
  mode = "oneshot";
  status = "idle";
  onOutput = null;
  onError = null;
  constructor(id, name) {
    this.id = id;
    this.name = name;
  }
  async start() {
    this.status = "idle";
  }
  async stop() {
    this.status = "idle";
  }
  send(_prompt, _opts) {
  }
}
const STDIO_FACTORIES = {
  codex: () => new CodexAdapter(),
  claude: () => new ClaudeAdapter(),
  hermes: () => new HermesAdapter(),
  openclaw: () => new OpenClawAdapter(),
  marvis: () => new MarvisAdapter(),
  "minimax-code": () => new MinimaxCodeAdapter()
};
function createAdapter(agentId, agentName2, protocol, binary, args) {
  if (protocol === "acp") {
    const d = acpDefaults(agentId);
    const bin = binary && binary.trim() || d?.binary || agentId;
    const acpArgs = args && args.length > 0 ? args : d?.args || ["acp"];
    return new AcpAgentAdapter(agentId, agentName2, bin, acpArgs);
  }
  if (protocol === "stdio-plain") {
    const make = STDIO_FACTORIES[agentId];
    if (make) {
      const a = make();
      if (binary && binary.trim()) a.binary = binary.trim();
      if (args && args.length > 0) a.execArgs = args;
      return a;
    }
    console.warn("[createAdapter] stdio-plain not implemented for agent " + agentId + ", falling back to http");
  }
  return new HttpAgentAdapter(agentId, agentName2);
}
class AgentRegistry extends events.EventEmitter {
  agents = /* @__PURE__ */ new Map();
  register(adapter, capabilities = [], providerId, modelId) {
    const info = {
      id: adapter.id,
      name: adapter.name,
      status: "idle",
      mode: adapter.mode,
      protocol: adapter.protocol,
      adapter,
      capabilities,
      lastActive: /* @__PURE__ */ new Date(),
      errorCount: 0,
      providerId,
      modelId
    };
    this.agents.set(adapter.id, info);
    this.emit("agent:registered", info);
    return info;
  }
  /** Register an HTTP-backed agent from a provider binding */
  registerHttpAgent(agentId, agentName2, capabilities, providerId, modelId) {
    const adapter = new HttpAgentAdapter(agentId, agentName2);
    return this.register(adapter, capabilities, providerId, modelId);
  }
  unregister(id) {
    const info = this.agents.get(id);
    if (info) {
      this.agents.delete(id);
      this.emit("agent:unregistered", id);
    }
  }
  get(id) {
    return this.agents.get(id);
  }
  getAll() {
    return Array.from(this.agents.values());
  }
  setStatus(id, status) {
    const info = this.agents.get(id);
    if (info) {
      info.status = status;
      if (status === "busy") info.lastActive = /* @__PURE__ */ new Date();
      this.emit("agent:status", { id, status });
    }
  }
  incrementError(id) {
    const info = this.agents.get(id);
    if (info) {
      info.errorCount++;
      this.emit("agent:status", { id, status: "error" });
    }
  }
  getByCapability(capability) {
    return this.getAll().filter((a) => a.capabilities.includes(capability));
  }
  async startAll() {
    for (const [, info] of this.agents) {
      try {
        await info.adapter.start();
        info.status = "idle";
      } catch {
        info.status = "error";
        info.errorCount++;
      }
    }
  }
  async stopAll() {
    for (const [, info] of this.agents) {
      try {
        await info.adapter.stop();
      } catch {
      }
      info.status = "offline";
    }
  }
}
class EventPipeline {
  mods = [];
  register(mod) {
    this.mods.push(mod);
  }
  async process(payload, sourceAgent) {
    let event = {
      id: "evt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      type: "message",
      source: sourceAgent,
      target: "hub",
      payload,
      metadata: {},
      timestamp: /* @__PURE__ */ new Date()
    };
    for (const mod of this.mods.filter((m) => m.type === "guard")) {
      const result = await mod.handle(event);
      if (result === null) {
        console.log("[Pipeline] Guard mod " + mod.name + " blocked event");
        return;
      }
      event = result;
    }
    for (const mod of this.mods.filter((m) => m.type === "transform")) {
      const result = await mod.handle(event);
      if (result) event = result;
    }
    for (const mod of this.mods.filter((m) => m.type === "observe")) {
      mod.handle(event).catch(() => {
      });
    }
  }
  getMods() {
    return [...this.mods];
  }
}
const MAIN_AGENT_ID = "orbit";
const AGENTS = [
  {
    id: MAIN_AGENT_ID,
    name: "Orbit",
    nameZh: "Orbit 主 Agent",
    caps: ["planning", "routing", "supervision", "synthesis"],
    routeKeywords: [],
    systemPrompt: [
      "You are Orbit, the main orchestrator agent.",
      "You do not act as a normal worker.",
      "You read the project goal and memory, create a bounded task DAG, assign contracts to sub-agents, supervise progress, verify results, and synthesize the final answer.",
      "Keep task granularity aligned and call out coordination risks early."
    ].join(" "),
    defaultProtocol: "http",
    takeoverSupported: false
  },
  {
    id: "codex",
    name: "Codex CLI",
    nameZh: "Codex",
    caps: ["coding", "debug", "refactor", "api", "deploy"],
    routeKeywords: ["写代码", "debug", "修复", "重构", "实现", "函数", "api", "bug", "coding", "implement", "fix", "部署", "脚本", "pipeline", "deploy", "script"],
    systemPrompt: "You are Codex, an expert software engineer focused on coding, debugging and refactoring. Be precise and produce working code.",
    defaultProtocol: "http",
    takeoverSupported: true,
    probeBinary: "codex"
  },
  {
    id: "claude",
    name: "Claude Code",
    nameZh: "Claude Code",
    caps: ["analysis", "writing", "translation", "research"],
    routeKeywords: ["分析", "总结", "解释", "文档", "写作", "翻译", "报告", "analyze", "summary", "explain", "document"],
    systemPrompt: "You are Claude Code, an analytical assistant focused on writing, research and clear explanations.",
    defaultProtocol: "http",
    takeoverSupported: true,
    probeBinary: "claude"
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    nameZh: "OpenClaw",
    caps: ["notify", "remote-control", "progress", "approval"],
    routeKeywords: ["通知", "通报", "进度", "远程", "手机", "提醒", "确认", "审批", "notify", "progress", "remote", "approval"],
    systemPrompt: [
      "You are OpenClaw, a user communication bridge for Orbit.",
      "Your role is to notify the user about mission progress and relay remote user instructions back to Orbit.",
      "Do not act as a coding, deployment, database, or file-writing worker unless the user explicitly redefines your role."
    ].join(" "),
    defaultProtocol: "http",
    takeoverSupported: true,
    probeBinary: "openclaw"
  },
  {
    id: "hermes",
    name: "Hermes",
    nameZh: "Hermes",
    caps: ["notify", "remote-control", "progress", "approval"],
    routeKeywords: ["通知", "通报", "进度", "远程", "手机", "提醒", "确认", "审批", "notify", "progress", "remote", "approval"],
    systemPrompt: [
      "You are Hermes, a user communication bridge for Orbit.",
      "Your role is to notify the user about mission progress and relay remote user instructions back to Orbit.",
      "Do not act as a coding, deployment, database, or file-writing worker unless the user explicitly redefines your role."
    ].join(" "),
    defaultProtocol: "http",
    takeoverSupported: true,
    probeBinary: "hermes"
  },
  {
    id: "marvis",
    name: "Marvis",
    nameZh: "腾讯 Marvis",
    caps: ["knowledge", "browser", "android", "office"],
    routeKeywords: ["知识", "浏览器", "安卓", "办公", "knowledge", "browser", "android", "office"],
    systemPrompt: "You are Marvis, Tencent's intelligent assistant specialised in knowledge management, browser automation, office workflows and Android device control.",
    defaultProtocol: "http",
    takeoverSupported: false
  },
  {
    id: "minimax-code",
    name: "MiniMax Code",
    nameZh: "MiniMax Code",
    caps: ["coding", "agentic", "tools", "review", "automation"],
    routeKeywords: ["minimax", "opencode", "agentic", "代码审查", "review", "自动化", "流水线", "pipeline", "脚本", "script"],
    systemPrompt: "You are MiniMax Code, an agentic coding assistant built on OpenCode. Be precise, write working code and explain briefly.",
    defaultProtocol: "stdio-plain",
    takeoverSupported: false,
    probeBinary: "opencode"
  }
];
const WORKER_AGENTS = AGENTS.filter((agent) => agent.id !== MAIN_AGENT_ID);
WORKER_AGENTS.map((agent) => agent.id);
const DISABLED_AGENT_IDS = ["openclaw", "marvis", "minimax-code"];
const DISABLED_AGENT_ID_SET = new Set(DISABLED_AGENT_IDS);
const USER_BRIDGE_AGENT_IDS = ["hermes"];
const NOTIFICATION_BRIDGE_STORAGE_KEY = "orbit.notificationBridge";
const DEFAULT_NOTIFICATION_BRIDGE_AGENT_ID = "hermes";
const USER_BRIDGE_ID_SET = new Set(USER_BRIDGE_AGENT_IDS);
const EXECUTION_WORKER_AGENTS = WORKER_AGENTS.filter((agent) => !USER_BRIDGE_ID_SET.has(agent.id) && !DISABLED_AGENT_ID_SET.has(agent.id));
const EXECUTION_WORKER_AGENT_IDS = EXECUTION_WORKER_AGENTS.map((agent) => agent.id);
const AGENTS_BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
function agentName(id) {
  return AGENTS_BY_ID[id]?.name ?? id;
}
function agentCaps(id) {
  return AGENTS_BY_ID[id]?.caps ?? [];
}
function agentSystemPrompt(id) {
  return AGENTS_BY_ID[id]?.systemPrompt ?? "You are Orbit Hub agent " + id + ". Be concise and helpful.";
}
class KeywordRouter {
  rules = [];
  constructor() {
    this.initDefaultRules();
  }
  initDefaultRules() {
    for (const a of AGENTS) {
      if (a.routeKeywords.length) {
        this.addRule({ patterns: a.routeKeywords, targetId: a.id, priority: 10 });
      }
    }
  }
  addRule(rule) {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }
  /**
   * 智能路由：按任务类型给每个可用 agent 打分，选最高分者（而非首个关键词命中）。
   * 评分 = 命中关键词数（每个 +1）+ 关键词长度微权重（越具体越高，仅用于同分微调）。
   * 同分时保留 rules 中更靠前者（更高 priority / manifest 顺序），结果确定。
   */
  route(text, availableAgents, context) {
    const best = this.routeScores(text, availableAgents, context)[0];
    return best ? best.id : availableAgents[0]?.id || null;
  }
  /** 返回各可用 agent 的得分（降序，仅含命中者）；供路由决策与调试/可视化。 */
  routeScores(text, availableAgents, context) {
    const lowerText = text.toLowerCase();
    const lowerContext = routerContextText(context).toLowerCase();
    const availableIds = new Set(availableAgents.map((a) => a.id));
    const scored = [];
    this.rules.forEach((rule, order) => {
      if (!availableIds.has(rule.targetId)) return;
      let score = 0;
      for (const pattern of rule.patterns) {
        const p = pattern.toLowerCase();
        if (p && lowerText.includes(p)) score += 1 + Math.min(p.length, 12) / 100;
        if (p && lowerContext.includes(p)) score += 0.38 + Math.min(p.length, 12) / 250;
      }
      if (score > 0) scored.push({ id: rule.targetId, score, order });
    });
    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    return scored.map(({ id, score }) => ({ id, score }));
  }
  routeWithMention(text) {
    const mentionMatch = text.match(/@(\w+)/);
    return mentionMatch ? mentionMatch[1].toLowerCase() : null;
  }
}
function routerContextText(context) {
  if (!context) return "";
  return [
    context.goal,
    context.routeContext,
    ...context.recentDecisions || [],
    ...(context.pendingContracts || []).map((item) => `${item.title || ""} ${item.detail || ""} ${item.agentId || ""} ${item.status || ""}`)
  ].filter(Boolean).join("\n").slice(0, 6e3);
}
const THINKING_BUDGET_TOKENS = {
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16384,
  xhigh: 32768
};
const OAI_DEFAULT_THINKING = {
  mode: "auto",
  level: "medium",
  budgetTokens: THINKING_BUDGET_TOKENS.medium,
  collapseInUI: true
};
const OAI_OFF_THINKING = {
  mode: "off",
  level: "medium",
  collapseInUI: true
};
const ANTHROPIC_DEFAULT_THINKING = {
  mode: "auto",
  level: "medium",
  budgetTokens: THINKING_BUDGET_TOKENS.medium,
  collapseInUI: true
};
function oaiModel(id, label, opts = {}) {
  return {
    id,
    label,
    contextWindow: 4e5,
    supportsTools: true,
    supportsVision: true,
    supportsThinking: /^gpt-5|^o[134]/i.test(id),
    maxThinkingLevel: /^gpt-5|^o[134]/i.test(id) ? "xhigh" : void 0,
    defaultThinkingLevel: /^gpt-5|^o[134]/i.test(id) ? "medium" : void 0,
    description: opts.description,
    ...opts
  };
}
function anthropicModel(id, label, opts = {}) {
  return {
    id,
    label,
    contextWindow: 2e5,
    supportsTools: true,
    supportsVision: true,
    supportsThinking: true,
    maxThinkingLevel: "xhigh",
    defaultThinkingLevel: "medium",
    description: opts.description,
    ...opts
  };
}
function geminiModel(id, label, opts = {}) {
  return {
    id,
    label,
    contextWindow: 1e6,
    supportsTools: true,
    supportsVision: true,
    supportsThinking: true,
    maxThinkingLevel: "high",
    defaultThinkingLevel: "medium",
    description: opts.description,
    ...opts
  };
}
const BUILTIN_PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: "chat_completions",
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: OAI_DEFAULT_THINKING,
    models: [
      oaiModel("gpt-5.5", "GPT-5.5", { contextWindow: 1e6, description: "OpenAI 最新旗舰，适合复杂编码、Agent、长上下文工作流" }),
      oaiModel("gpt-5.5-pro", "GPT-5.5 Pro", { contextWindow: 1e6, description: "GPT-5.5 高精度版本，成本更高" }),
      oaiModel("gpt-5.4", "GPT-5.4", { contextWindow: 4e5, description: "更经济的专业工作与编码模型" }),
      oaiModel("gpt-5.4-pro", "GPT-5.4 Pro", { contextWindow: 4e5, description: "GPT-5.4 高精度版本" }),
      oaiModel("gpt-5.4-mini", "GPT-5.4 mini", { contextWindow: 4e5, description: "强小模型，适合子 Agent、编码和计算机使用" }),
      oaiModel("gpt-5.4-nano", "GPT-5.4 nano", { contextWindow: 4e5, description: "低成本高吞吐任务" }),
      oaiModel("gpt-5.3-codex", "GPT-5.3 Codex", { contextWindow: 4e5, description: "Agentic coding 专用模型，需 Responses API/API 权限" }),
      oaiModel("gpt-5.2", "GPT-5.2", { contextWindow: 4e5, description: "上一代专业工作模型" }),
      oaiModel("gpt-4o", "GPT-4o", { contextWindow: 128e3, supportsThinking: false, maxThinkingLevel: void 0, defaultThinkingLevel: void 0, description: "旧版多模态模型（已非最新）" }),
      oaiModel("gpt-4o-mini", "GPT-4o mini", { contextWindow: 128e3, supportsThinking: false, maxThinkingLevel: void 0, defaultThinkingLevel: void 0, description: "旧版轻量高速版本" }),
      oaiModel("gpt-4.1", "GPT-4.1", { description: "OpenAI 4.1 长上下文" }),
      oaiModel("gpt-4.1-mini", "GPT-4.1 mini", { description: "4.1 轻量版本" }),
      oaiModel("o3-mini", "o3-mini", { supportsThinking: true, maxThinkingLevel: "high", description: "OpenAI 推理模型" }),
      oaiModel("o4-mini", "o4-mini", { supportsThinking: true, maxThinkingLevel: "high", description: "OpenAI 新一代推理" })
    ]
  },
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "",
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: "messages",
      stream: true,
      nativeThinking: true,
      budgetTokens: true,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: ANTHROPIC_DEFAULT_THINKING,
    models: [
      anthropicModel("claude-fable-5", "Claude Fable 5", { contextWindow: 1e6, supportsThinking: false, maxThinkingLevel: void 0, defaultThinkingLevel: void 0, description: "Anthropic 最强广泛发布模型，适合高难度推理和长程 Agent" }),
      anthropicModel("claude-opus-4-8", "Claude Opus 4.8", { contextWindow: 1e6, supportsThinking: false, maxThinkingLevel: void 0, defaultThinkingLevel: void 0, description: "最新 Opus，复杂推理与高自治编码" }),
      anthropicModel("claude-sonnet-4-6", "Claude Sonnet 4.6", { contextWindow: 1e6, description: "速度与智能平衡，适合 Claude Code / 子 Agent" }),
      anthropicModel("claude-haiku-4-5-20251001", "Claude Haiku 4.5", { maxThinkingLevel: "medium", description: "高速低延迟版本" }),
      anthropicModel("claude-sonnet-4-5", "Claude Sonnet 4.5", { description: "上一代 Sonnet" }),
      anthropicModel("claude-opus-4-5", "Claude Opus 4.5", { maxThinkingLevel: "xhigh", description: "上一代 Opus" }),
      anthropicModel("claude-3-7-sonnet-latest", "Claude 3.7 Sonnet", { description: "稳定版 3.7" })
    ]
  },
  {
    id: "gemini",
    name: "Google Gemini",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: "",
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: "generate_content",
      stream: true,
      nativeThinking: true,
      budgetTokens: true,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: "auto", level: "medium", budgetTokens: THINKING_BUDGET_TOKENS.medium, collapseInUI: true },
    models: [
      geminiModel("gemini-2.5-pro", "Gemini 2.5 Pro", { description: "Gemini 旗舰多模态" }),
      geminiModel("gemini-2.5-flash", "Gemini 2.5 Flash", { description: "高速版本" }),
      geminiModel("gemini-2.0-flash", "Gemini 2.0 Flash", { description: "上一代 Flash" })
    ]
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: "chat_completions",
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: "auto", level: "medium", collapseInUI: true },
    models: [
      oaiModel("deepseek-chat", "DeepSeek-V3", { contextWindow: 64e3, supportsThinking: false, description: "DeepSeek 通用对话" }),
      oaiModel("deepseek-reasoner", "DeepSeek-R1", { contextWindow: 64e3, supportsThinking: true, maxThinkingLevel: "xhigh", description: "DeepSeek 推理模型" })
    ]
  },
  {
    id: "minimax",
    name: "MiniMax",
    kind: "openai-compatible",
    baseUrl: "https://api.minimaxi.com/v1",
    apiKey: "",
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: "chat_completions",
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: "auto", level: "medium", collapseInUI: true },
    models: [
      oaiModel("MiniMax-M2.7", "MiniMax M2.7", { contextWindow: 2e5, supportsThinking: true, maxThinkingLevel: "high", description: "MiniMax 旗舰 Agent/编码模型" }),
      oaiModel("MiniMax-M2", "MiniMax M2", { contextWindow: 2e5, supportsThinking: true, maxThinkingLevel: "high", description: "上一代旗舰" }),
      oaiModel("MiniMax-Text-01", "MiniMax Text-01", { contextWindow: 1e6, description: "超长上下文通用模型" })
    ],
    note: "国际版用 https://api.minimax.io/v1；配好 Key 后点「获取模型」拉取最新列表"
  },
  {
    id: "moonshot",
    name: "Kimi (Moonshot)",
    kind: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKey: "",
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: "chat_completions",
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: "auto", level: "medium", collapseInUI: true },
    models: [
      oaiModel("kimi-k2.6", "Kimi K2.6", { contextWindow: 256e3, supportsThinking: true, maxThinkingLevel: "high", description: "月之暗面旗舰" }),
      oaiModel("kimi-k2-0905-preview", "Kimi K2 Preview", { contextWindow: 256e3, description: "K2 预览版" }),
      oaiModel("moonshot-v1-128k", "Moonshot v1 128K", { description: "经典长上下文" })
    ]
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    kind: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKey: "",
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: "chat_completions",
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: "auto", level: "medium", collapseInUI: true },
    models: [
      oaiModel("glm-4.7", "GLM-4.7", { contextWindow: 2e5, supportsThinking: true, maxThinkingLevel: "high", description: "智谱旗舰编码/推理" }),
      oaiModel("glm-4.6", "GLM-4.6", { contextWindow: 2e5, supportsThinking: true, maxThinkingLevel: "high", description: "上一代旗舰" }),
      oaiModel("glm-4-flash", "GLM-4 Flash", { description: "高速免费档" })
    ]
  },
  {
    id: "qwen",
    name: "通义千问",
    kind: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "",
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: "chat_completions",
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: "auto", level: "medium", collapseInUI: true },
    models: [
      oaiModel("qwen3-max", "Qwen3 Max", { contextWindow: 256e3, supportsThinking: true, maxThinkingLevel: "high", description: "阿里旗舰" }),
      oaiModel("qwen-plus", "Qwen Plus", { contextWindow: 131072, description: "均衡档" }),
      oaiModel("qwen-turbo", "Qwen Turbo", { description: "高速低成本" })
    ]
  },
  {
    id: "doubao",
    name: "豆包 (火山方舟)",
    kind: "openai-compatible",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: "",
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: "chat_completions",
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: "auto", level: "medium", collapseInUI: true },
    models: [
      oaiModel("doubao-seed-2-0", "Doubao Seed 2.0", { contextWindow: 256e3, supportsThinking: true, maxThinkingLevel: "high", description: "字节旗舰全模态" }),
      oaiModel("doubao-1-5-pro-256k", "Doubao 1.5 Pro 256K", { contextWindow: 256e3, description: "长上下文" })
    ],
    note: "方舟也支持推理接入点 ID（ep-xxx）作为模型名；点「获取模型」可拉取你账号下可用列表"
  },
  {
    id: "hunyuan",
    name: "腾讯混元",
    kind: "openai-compatible",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    apiKey: "",
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: "chat_completions",
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: "auto", level: "medium", collapseInUI: true },
    models: [
      oaiModel("hunyuan-turbos-latest", "Hunyuan TurboS", { contextWindow: 256e3, description: "混元旗舰快思考" }),
      oaiModel("hunyuan-t1-latest", "Hunyuan T1", { contextWindow: 256e3, supportsThinking: true, maxThinkingLevel: "high", description: "混元深度推理" }),
      oaiModel("hunyuan-lite", "Hunyuan Lite", { description: "轻量免费档" })
    ]
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    kind: "openai-compatible",
    baseUrl: "https://api.siliconflow.cn/v1",
    apiKey: "",
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: "chat_completions",
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: { mode: "auto", level: "medium", collapseInUI: true },
    models: [
      oaiModel("deepseek-ai/DeepSeek-V3.2", "DeepSeek V3.2 (SiliconFlow)", { contextWindow: 131072, description: "聚合平台直供" }),
      oaiModel("Qwen/Qwen3-32B", "Qwen3 32B (SiliconFlow)", { description: "开源模型托管" })
    ]
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
    enabled: false,
    builtIn: true,
    capabilities: {
      protocol: "chat_completions",
      stream: true,
      nativeThinking: true,
      budgetTokens: false,
      toolCalls: true,
      systemPrompt: true
    },
    defaultThinking: OAI_OFF_THINKING,
    models: [
      oaiModel("anthropic/claude-sonnet-4-5", "Claude Sonnet 4.5 (via OpenRouter)", { supportsThinking: true, maxThinkingLevel: "high" }),
      oaiModel("openai/gpt-4o", "GPT-4o (via OpenRouter)"),
      oaiModel("google/gemini-2.5-pro", "Gemini 2.5 Pro (via OpenRouter)", { supportsThinking: true, maxThinkingLevel: "high" }),
      oaiModel("deepseek/deepseek-r1", "DeepSeek R1 (via OpenRouter)", { supportsThinking: true, maxThinkingLevel: "xhigh" })
    ]
  }
];
const OPENAI_ENDPOINTS = ["chat/completions", "responses", "models"];
const ANTHROPIC_ENDPOINTS = ["messages", "models"];
function cleanEndpoint(endpoint) {
  return endpoint.replace(/^\/+|\/+$/g, "");
}
function cleanBaseUrl(baseUrl) {
  return baseUrl.trim().replace(/\/+$/g, "");
}
function endsWithEndpoint(url2, endpoint) {
  return url2.toLowerCase().endsWith("/" + cleanEndpoint(endpoint).toLowerCase());
}
function stripEndpoint(url2, endpoint) {
  const clean2 = cleanEndpoint(endpoint);
  return endsWithEndpoint(url2, clean2) ? url2.slice(0, -(clean2.length + 1)).replace(/\/+$/g, "") : url2;
}
function endpointUrl(baseUrl, endpoint, knownSiblings = []) {
  const base = cleanBaseUrl(baseUrl);
  const target = cleanEndpoint(endpoint);
  const known = [target, ...knownSiblings.map(cleanEndpoint)];
  for (const candidate of known) {
    if (endsWithEndpoint(base, candidate)) {
      const parent = stripEndpoint(base, candidate);
      return candidate === target ? base : `${parent}/${target}`;
    }
  }
  return `${base}/${target}`;
}
function openAIChatCompletionsUrl(baseUrl) {
  return endpointUrl(baseUrl, "chat/completions", OPENAI_ENDPOINTS);
}
function openAIResponsesUrl(baseUrl) {
  return endpointUrl(baseUrl, "responses", OPENAI_ENDPOINTS);
}
function openAIModelsUrl(baseUrl) {
  return endpointUrl(baseUrl, "models", OPENAI_ENDPOINTS);
}
function anthropicMessagesUrl(baseUrl) {
  return endpointUrl(baseUrl, "messages", ANTHROPIC_ENDPOINTS);
}
function anthropicModelsUrl(baseUrl) {
  return endpointUrl(baseUrl, "models", ANTHROPIC_ENDPOINTS);
}
let currentProxyUrl = "";
function getOutboundProxy() {
  return currentProxyUrl;
}
function setOutboundProxy(url2) {
  currentProxyUrl = (url2 || "").trim();
  try {
    const ses = electron.session.defaultSession;
    if (!ses) return;
    if (currentProxyUrl) {
      void ses.setProxy({ mode: "fixed_servers", proxyRules: toProxyRules(currentProxyUrl) });
    } else {
      void ses.setProxy({ mode: "direct" });
    }
  } catch {
  }
}
function toProxyRules(url2) {
  const v = url2.trim();
  if (/^socks/i.test(v)) return v;
  const hostPort = v.replace(/^https?:\/\//i, "");
  return `http=${hostPort};https=${hostPort}`;
}
const DEFAULT_CONNECT_TIMEOUT_MS = 3e4;
async function proxyFetch(url2, init = {}) {
  const { connectTimeoutMs, signal: callerSignal, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new Error("上游连接/响应超时（请检查网络或代理设置）")),
    connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
  );
  const signal = callerSignal ? AbortSignal.any([callerSignal, ctrl.signal]) : ctrl.signal;
  try {
    const res = await electron.net.fetch(url2, { ...rest, signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}
const STORAGE_KEY$4 = "providers.config.v1";
const CONFIG_VERSION = 2;
function defaultConfig() {
  return {
    providers: BUILTIN_PROVIDERS.map((p) => ({ ...p, models: p.models.map((m) => ({ ...m })) })),
    routing: {
      bindings: defaultBindings(),
      fallbackChain: [],
      strategy: "single"
    },
    activeBindingId: null,
    version: CONFIG_VERSION
  };
}
const LEGACY_CODEX_PROVIDER_ID = "anthropic";
const LEGACY_CODEX_MODEL_ID = "claude-sonnet-4-5";
const LEGACY_CLAUDE_PROVIDER_ID = "openai";
const LEGACY_CLAUDE_MODEL_ID = "gpt-4o";
const DEFAULT_CODEX_PROVIDER_ID = "openai";
const DEFAULT_CODEX_MODEL_ID = "gpt-5.5";
const DEFAULT_CLAUDE_PROVIDER_ID = "anthropic";
const DEFAULT_CLAUDE_MODEL_ID = "claude-sonnet-4-6";
function defaultBindings() {
  return [
    {
      agentId: "orbit",
      providerId: DEFAULT_CODEX_PROVIDER_ID,
      modelId: DEFAULT_CODEX_MODEL_ID,
      protocol: "http",
      thinkingAllow: ["off", "auto", "enabled"],
      thinking: { mode: "auto", level: "medium", budgetTokens: THINKING_BUDGET_TOKENS.medium, collapseInUI: true },
      temperature: 0.2,
      maxOutputTokens: 8192
    },
    {
      agentId: "codex",
      providerId: DEFAULT_CODEX_PROVIDER_ID,
      modelId: DEFAULT_CODEX_MODEL_ID,
      protocol: "stdio-plain",
      binary: "",
      args: "",
      thinkingAllow: ["off", "auto", "enabled"],
      thinking: { mode: "auto", level: "medium", budgetTokens: THINKING_BUDGET_TOKENS.medium, collapseInUI: true },
      temperature: 0.2,
      maxOutputTokens: 8192
    },
    {
      agentId: "claude",
      providerId: DEFAULT_CLAUDE_PROVIDER_ID,
      modelId: DEFAULT_CLAUDE_MODEL_ID,
      protocol: "stdio-plain",
      binary: "",
      args: "",
      thinkingAllow: ["off", "auto", "enabled"],
      thinking: { mode: "auto", level: "medium", budgetTokens: THINKING_BUDGET_TOKENS.medium, collapseInUI: true },
      temperature: 0.4,
      maxOutputTokens: 8192
    },
    {
      agentId: "openclaw",
      providerId: "deepseek",
      modelId: "deepseek-chat",
      thinkingAllow: ["off", "auto", "enabled"],
      thinking: { mode: "off", level: "low", collapseInUI: true },
      temperature: 0.1,
      maxOutputTokens: 4096
    },
    {
      agentId: "hermes",
      providerId: "gemini",
      modelId: "gemini-2.5-flash",
      thinkingAllow: ["off", "auto", "enabled"],
      thinking: { mode: "auto", level: "low", budgetTokens: THINKING_BUDGET_TOKENS.low, collapseInUI: true },
      temperature: 0.3,
      maxOutputTokens: 8192
    },
    {
      agentId: "marvis",
      providerId: "hunyuan",
      modelId: "hunyuan-turbos-latest",
      thinkingAllow: ["off", "auto", "enabled"],
      thinking: { mode: "auto", level: "low", collapseInUI: true },
      temperature: 0.3,
      maxOutputTokens: 8192
    },
    {
      agentId: "minimax-code",
      providerId: "minimax",
      modelId: "MiniMax-M2.7",
      // 默认 StdIO 直连桌面版内置 opencode（吃桌面版登录态，无需 API Key）
      protocol: "stdio-plain",
      thinkingAllow: ["off", "auto", "enabled"],
      thinking: { mode: "auto", level: "medium", collapseInUI: true },
      temperature: 0.2,
      maxOutputTokens: 8192
    }
  ];
}
function migrateDefaultHttpBindingsToLocalCli(bindings) {
  return bindings.map((binding) => {
    const defaultCodexHttp = binding.agentId === "codex" && (!binding.protocol || binding.protocol === "http") && binding.providerId === DEFAULT_CODEX_PROVIDER_ID && binding.modelId === DEFAULT_CODEX_MODEL_ID;
    const defaultClaudeHttp = binding.agentId === "claude" && (!binding.protocol || binding.protocol === "http") && binding.providerId === DEFAULT_CLAUDE_PROVIDER_ID && binding.modelId === DEFAULT_CLAUDE_MODEL_ID;
    if (!defaultCodexHttp && !defaultClaudeHttp) return binding;
    return {
      ...binding,
      protocol: "stdio-plain",
      binary: binding.binary || "",
      args: binding.args || ""
    };
  });
}
function migrateLegacySwappedOfficialBindings(bindings) {
  const codex = bindings.find((b) => b.agentId === "codex");
  const claude = bindings.find((b) => b.agentId === "claude");
  const codexLooksLegacy = codex?.providerId === LEGACY_CODEX_PROVIDER_ID && codex?.modelId === LEGACY_CODEX_MODEL_ID;
  const claudeLooksLegacy = claude?.providerId === LEGACY_CLAUDE_PROVIDER_ID && claude?.modelId === LEGACY_CLAUDE_MODEL_ID;
  if (!codexLooksLegacy || !claudeLooksLegacy) return bindings;
  return bindings.map((binding) => {
    if (binding.agentId === "codex") {
      return {
        ...binding,
        providerId: DEFAULT_CODEX_PROVIDER_ID,
        modelId: DEFAULT_CODEX_MODEL_ID
      };
    }
    if (binding.agentId === "claude") {
      return {
        ...binding,
        providerId: DEFAULT_CLAUDE_PROVIDER_ID,
        modelId: DEFAULT_CLAUDE_MODEL_ID,
        thinking: {
          ...binding.thinking,
          budgetTokens: binding.thinking.budgetTokens ?? THINKING_BUDGET_TOKENS.medium
        }
      };
    }
    return binding;
  });
}
function migrateStaleOfficialModelDefaults(bindings) {
  return bindings.map((binding) => {
    if ((binding.agentId === "orbit" || binding.agentId === "codex") && binding.providerId === DEFAULT_CODEX_PROVIDER_ID && binding.modelId === "gpt-4o") {
      return { ...binding, modelId: DEFAULT_CODEX_MODEL_ID };
    }
    if (binding.agentId === "claude" && binding.providerId === DEFAULT_CLAUDE_PROVIDER_ID && binding.modelId === "claude-sonnet-4-5") {
      return { ...binding, modelId: DEFAULT_CLAUDE_MODEL_ID };
    }
    return binding;
  });
}
function mergeBuiltinModels(defaultModels, savedModels) {
  if (!savedModels || savedModels.length === 0) return defaultModels;
  const byId = /* @__PURE__ */ new Map();
  for (const model of defaultModels) byId.set(model.id, model);
  for (const model of savedModels) {
    const builtin = byId.get(model.id);
    byId.set(model.id, builtin ? { ...builtin, ...model, label: model.label || builtin.label } : model);
  }
  return defaultModels.map((model) => byId.get(model.id)).concat(savedModels.filter((model) => !defaultModels.find((def) => def.id === model.id)));
}
class ProviderManager extends events.EventEmitter {
  cfg;
  secretsUnlocked = false;
  constructor() {
    super();
    this.cfg = this.load();
  }
  load() {
    try {
      const raw = appStore.get(STORAGE_KEY$4);
      if (raw) {
        const sane = this.sanitize(raw);
        return this.mergeWithBuiltins(sane);
      }
    } catch (e) {
      console.warn("[Providers] load failed, fallback to defaults:", e);
    }
    return defaultConfig();
  }
  /** 防御性修复存储配置结构：非数组/缺失字段回退默认，保留可用部分（不因局部损坏整体重置） */
  sanitize(raw) {
    const d = defaultConfig();
    if (!raw || typeof raw !== "object") return d;
    const r = raw.routing && typeof raw.routing === "object" ? raw.routing : {};
    return {
      providers: Array.isArray(raw.providers) ? raw.providers.filter((p) => p && typeof p.id === "string") : d.providers,
      routing: {
        bindings: Array.isArray(r.bindings) ? r.bindings.filter((b) => b && typeof b.agentId === "string") : d.routing.bindings,
        fallbackChain: Array.isArray(r.fallbackChain) ? r.fallbackChain : d.routing.fallbackChain,
        strategy: r.strategy || d.routing.strategy
      },
      activeBindingId: typeof raw.activeBindingId === "string" ? raw.activeBindingId : null,
      version: typeof raw.version === "number" ? raw.version : void 0
    };
  }
  /**
   * 解密内存中的 apiKey（须在 app ready 后调用一次）。
   * 旧明文配置（无加密前缀）原样保留并在下次 save() 时自动加密（隐式迁移）。
   */
  unlockSecrets() {
    if (this.secretsUnlocked) return;
    for (const p of this.cfg.providers) p.apiKey = decryptSecret(p.apiKey || "");
    this.secretsUnlocked = true;
  }
  /** 把存储的 config 与最新的内置 Provider 合并（新增内置不丢、删除的清理） */
  mergeWithBuiltins(stored) {
    const defaults = defaultConfig();
    const storedProviders = new Map(stored.providers.map((p) => [p.id, p]));
    const providers = defaults.providers.map((def) => {
      const saved = storedProviders.get(def.id);
      if (!saved) return def;
      return {
        ...def,
        apiKey: saved.apiKey || "",
        enabled: saved.enabled ?? def.enabled,
        baseUrl: saved.baseUrl || def.baseUrl,
        customHeaders: saved.customHeaders || def.customHeaders,
        note: saved.note || def.note,
        defaultThinking: saved.defaultThinking || def.defaultThinking,
        models: mergeBuiltinModels(def.models, saved.models)
      };
    });
    for (const sp of stored.providers) {
      if (!sp.builtIn && !providers.find((p) => p.id === sp.id)) {
        providers.push(sp);
      }
    }
    let storedBindings = migrateStaleOfficialModelDefaults(migrateLegacySwappedOfficialBindings(
      stored.routing?.bindings?.length ? [...stored.routing.bindings] : defaults.routing.bindings
    ));
    if ((stored.version ?? 1) < 2) {
      storedBindings = migrateDefaultHttpBindingsToLocalCli(storedBindings);
    }
    for (const db of defaults.routing.bindings) {
      if (!storedBindings.find((b) => b.agentId === db.agentId)) storedBindings.push(db);
    }
    return {
      providers,
      routing: {
        bindings: storedBindings,
        fallbackChain: stored.routing?.fallbackChain || defaults.routing.fallbackChain,
        strategy: stored.routing?.strategy || defaults.routing.strategy
      },
      activeBindingId: stored.activeBindingId ?? defaults.activeBindingId
    };
  }
  save() {
    const persisted = JSON.parse(JSON.stringify(this.cfg));
    persisted.providers = persisted.providers.map((p) => ({ ...p, apiKey: encryptSecret(p.apiKey || "") }));
    persisted.version = CONFIG_VERSION;
    appStore.set(STORAGE_KEY$4, persisted);
    this.emit("config:changed", this.cfg);
  }
  // ---- 查询 ----
  getConfig() {
    return JSON.parse(JSON.stringify(this.cfg));
  }
  getProviders() {
    return this.cfg.providers;
  }
  getEnabledProviders() {
    return this.cfg.providers.filter((p) => p.enabled && p.apiKey);
  }
  getProvider(id) {
    return this.cfg.providers.find((p) => p.id === id);
  }
  getBindings() {
    return this.cfg.routing.bindings;
  }
  getBinding(agentId) {
    return this.cfg.routing.bindings.find((b) => b.agentId === agentId);
  }
  /**解析 Agent → (Provider, Model, Thinking)完整配置；目标 Provider不可用时按 fallbackChain 回退 */
  resolveBinding(agentId) {
    const binding = this.getBinding(agentId);
    if (!binding) return null;
    const isUsable = (p) => !!p && p.enabled && !!p.apiKey;
    let provider = this.getProvider(binding.providerId);
    if (!isUsable(provider)) {
      for (const id of this.cfg.routing.fallbackChain) {
        const p = this.getProvider(id);
        if (isUsable(p)) {
          provider = p;
          break;
        }
      }
    }
    if (!provider) return null;
    const model = provider.models.find((m) => m.id === binding.modelId) ?? provider.models[0];
    if (!model) return null;
    return { provider, model, binding, thinking: binding.thinking };
  }
  // ---- 修改 ----
  upsertProvider(p) {
    const idx = this.cfg.providers.findIndex((x) => x.id === p.id);
    if (idx >= 0) this.cfg.providers[idx] = p;
    else this.cfg.providers.push(p);
    this.save();
  }
  deleteProvider(id) {
    const target = this.getProvider(id);
    if (!target || target.builtIn) return false;
    this.cfg.providers = this.cfg.providers.filter((p) => p.id !== id);
    this.cfg.routing.bindings = this.cfg.routing.bindings.filter((b) => b.providerId !== id);
    this.cfg.routing.fallbackChain = this.cfg.routing.fallbackChain.filter((x) => x !== id);
    this.save();
    return true;
  }
  setProviderEnabled(id, enabled) {
    const p = this.getProvider(id);
    if (!p) return;
    p.enabled = enabled;
    this.save();
  }
  setProviderApiKey(id, key) {
    const p = this.getProvider(id);
    if (!p) return;
    p.apiKey = key;
    if (key && !p.enabled) p.enabled = true;
    this.save();
  }
  upsertBinding(b) {
    const idx = this.cfg.routing.bindings.findIndex((x) => x.agentId === b.agentId);
    if (idx >= 0) this.cfg.routing.bindings[idx] = b;
    else this.cfg.routing.bindings.push(b);
    this.save();
  }
  removeBinding(agentId) {
    this.cfg.routing.bindings = this.cfg.routing.bindings.filter((b) => b.agentId !== agentId);
    this.save();
  }
  setFallbackChain(chain) {
    this.cfg.routing.fallbackChain = chain;
    this.save();
  }
  setStrategy(s) {
    this.cfg.routing.strategy = s;
    this.save();
  }
  setActiveBinding(agentId) {
    this.cfg.activeBindingId = agentId;
    this.save();
  }
  setProviderThinking(providerId, t) {
    const p = this.getProvider(providerId);
    if (!p) return;
    p.defaultThinking = t;
    this.save();
  }
  setBindingThinking(agentId, t) {
    const b = this.getBinding(agentId);
    if (!b) return;
    b.thinking = t;
    this.save();
  }
  // ---- 健康检查 ----
  async checkProviderHealth(id) {
    const p = this.getProvider(id);
    if (!p) return { reachable: false, status: "error", lastCheck: Date.now(), error: "Provider not found" };
    if (!p.apiKey) {
      const h = { reachable: false, status: "unauthorized", lastCheck: Date.now(), error: "未配置 API Key" };
      p.health = h;
      this.save();
      return h;
    }
    const start = Date.now();
    try {
      if (p.kind === "openai" || p.kind === "openai-compatible" || p.kind === "custom") {
        const h2 = await this.checkOpenAICompatibleHealth(p, start);
        p.health = h2;
        this.save();
        return h2;
      }
      const url2 = this.healthUrl(p);
      const headers = this.buildHeaders(p);
      const res = await proxyFetch(url2, { method: "GET", headers, signal: AbortSignal.timeout(8e3) });
      const latencyMs = Date.now() - start;
      const unauthorized = res.status === 401 || res.status === 403;
      const h = {
        reachable: !unauthorized && res.status < 400,
        status: unauthorized ? "unauthorized" : res.status < 400 ? "ok" : "error",
        lastCheck: Date.now(),
        latencyMs,
        error: unauthorized ? `鉴权失败 (HTTP ${res.status})` : res.status >= 400 ? `HTTP ${res.status}` : void 0
      };
      p.health = h;
      this.save();
      return h;
    } catch (e) {
      const h = { reachable: false, status: "unreachable", lastCheck: Date.now(), latencyMs: Date.now() - start, error: e?.message || String(e) };
      p.health = h;
      this.save();
      return h;
    }
  }
  async checkOpenAICompatibleHealth(p, start) {
    const headers = this.buildHeaders(p);
    const chatUrl = openAIChatCompletionsUrl(p.baseUrl);
    const fullChatEndpoint = chatUrl === p.baseUrl.trim().replace(/\/+$/g, "");
    if (fullChatEndpoint && p.models[0]?.id) {
      return this.checkOpenAIChatHealth(p, start);
    }
    const modelsUrl = openAIModelsUrl(p.baseUrl);
    let res;
    try {
      res = await proxyFetch(modelsUrl, { method: "GET", headers, signal: AbortSignal.timeout(3500) });
    } catch (e) {
      if (p.models[0]?.id) return this.checkOpenAIChatHealth(p, start);
      throw e;
    }
    const latencyMs = Date.now() - start;
    if (res.status < 400) {
      return { reachable: true, status: "ok", lastCheck: Date.now(), latencyMs };
    }
    if (res.status === 401 || res.status === 403) {
      return { reachable: false, status: "unauthorized", lastCheck: Date.now(), latencyMs, error: `鉴权失败 (HTTP ${res.status})` };
    }
    if ((res.status === 404 || res.status === 405) && p.models[0]?.id) {
      return this.checkOpenAIChatHealth(p, start);
    }
    return {
      reachable: false,
      status: "error",
      lastCheck: Date.now(),
      latencyMs,
      error: `HTTP ${res.status}`
    };
  }
  async checkOpenAIChatHealth(p, start) {
    const model = p.models[0]?.id;
    if (!model) {
      return {
        reachable: false,
        status: "error",
        lastCheck: Date.now(),
        latencyMs: Date.now() - start,
        error: "未设置模型名"
      };
    }
    const body = {
      model,
      messages: [{ role: "user", content: "ping" }],
      stream: false
    };
    const res = await proxyFetch(openAIChatCompletionsUrl(p.baseUrl), {
      method: "POST",
      headers: this.buildHeaders(p),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12e3)
    });
    const latencyMs = Date.now() - start;
    if (res.status < 400) {
      return { reachable: true, status: "ok", lastCheck: Date.now(), latencyMs };
    }
    if (res.status === 401 || res.status === 403) {
      return { reachable: false, status: "unauthorized", lastCheck: Date.now(), latencyMs, error: `鉴权失败 (HTTP ${res.status})` };
    }
    const txt = await res.text().catch(() => "");
    const detail = txt ? `: ${txt.slice(0, 160)}` : "";
    return {
      reachable: false,
      status: "error",
      lastCheck: Date.now(),
      latencyMs,
      error: `Chat Completions HTTP ${res.status}${detail}`
    };
  }
  /**
   * 从厂商 API 拉取模型列表（自动/手动）。
   * openai 兼容: GET /models → data[].id
   * anthropic:  GET /models?limit=200 → data[].{id,display_name}
   * gemini:     GET /models?pageSize=200 → models[].{name,displayName,inputTokenLimit}
   * 与现有列表按 id 合并（保留人工配置的能力标记），其余字段用启发式默认。
   */
  async fetchModels(id) {
    const p = this.getProvider(id);
    if (!p) return { ok: false, error: "Provider not found" };
    if (!p.apiKey) return { ok: false, error: "未配置 API Key" };
    try {
      const base = p.baseUrl.replace(/\/$/, "");
      const url2 = p.kind === "gemini" ? `${base}/models?key=${encodeURIComponent(p.apiKey)}&pageSize=200` : p.kind === "anthropic" ? `${anthropicModelsUrl(p.baseUrl)}?limit=200` : openAIModelsUrl(p.baseUrl);
      const res = await proxyFetch(url2, { method: "GET", headers: this.buildHeaders(p), signal: AbortSignal.timeout(1e4) });
      if (res.status >= 400) {
        if ((p.kind === "openai" || p.kind === "openai-compatible" || p.kind === "custom") && (res.status === 404 || res.status === 405) && p.models.length > 0) {
          return { ok: true, count: p.models.length };
        }
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const j = await res.json();
      let raw = [];
      if (p.kind === "gemini") {
        raw = (j.models || []).filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent")).map((m) => ({
          id: String(m.name || "").replace(/^models\//, ""),
          label: m.displayName,
          contextWindow: m.inputTokenLimit
        }));
      } else {
        raw = (j.data || []).map((m) => ({ id: m.id, label: m.display_name }));
      }
      raw = raw.filter((m) => m.id).slice(0, 300);
      if (raw.length === 0) return { ok: false, error: "接口未返回模型" };
      const old = new Map(p.models.map((m) => [m.id, m]));
      const thinkRe = /think|reason|r1|o[134](-|$)|gpt-5|claude-(opus|sonnet)-4|gemini-2\.5/i;
      p.models = raw.map((m) => {
        const prev = old.get(m.id);
        if (prev) return { ...prev, label: prev.label || m.label || m.id, contextWindow: m.contextWindow || prev.contextWindow };
        return {
          id: m.id,
          label: m.label || m.id,
          contextWindow: m.contextWindow || 128e3,
          supportsTools: true,
          supportsVision: /vision|4o|omni|gemini|claude/i.test(m.id),
          supportsThinking: thinkRe.test(m.id)
        };
      });
      this.save();
      return { ok: true, count: p.models.length };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
  healthUrl(p) {
    switch (p.kind) {
      case "openai":
      case "openai-compatible":
      case "custom":
        return openAIModelsUrl(p.baseUrl);
      case "anthropic":
        return anthropicModelsUrl(p.baseUrl);
      case "gemini":
        return `${p.baseUrl.replace(/\/$/, "")}/models?key=${encodeURIComponent(p.apiKey)}`;
    }
  }
  buildHeaders(p) {
    const headers = { "content-type": "application/json", ...p.customHeaders || {} };
    switch (p.kind) {
      case "openai":
      case "openai-compatible":
      case "custom":
        headers["authorization"] = `Bearer ${p.apiKey}`;
        break;
      case "anthropic":
        headers["x-api-key"] = p.apiKey;
        headers["anthropic-version"] = "2023-06-01";
        break;
    }
    return headers;
  }
}
let _instance$2 = null;
function getProviderManager() {
  if (!_instance$2) _instance$2 = new ProviderManager();
  return _instance$2;
}
function usesDefaultOnlyTemperature(provider, model) {
  const target = `${provider?.id ?? ""} ${provider?.name ?? ""} ${provider?.baseUrl ?? ""} ${model?.id ?? ""} ${model?.label ?? ""}`.toLowerCase();
  return target.includes("evomap") || /\bgpt-5[\w.-]*/.test(target) || /\bo\d[\w.-]*/.test(target);
}
function shouldSendTemperature(provider, model, temperature) {
  return temperature !== void 0 && temperature !== 1 && !usesDefaultOnlyTemperature(provider, model);
}
class ProviderClient {
  constructor(provider, model, binding, thinking) {
    this.provider = provider;
    this.model = model;
    this.binding = binding;
    this.thinking = thinking;
  }
  /** 组装 Chat Completions 风格请求（统一抽象） */
  buildRequest(messages, systemPrompt, thinking = this.thinking) {
    const sys = systemPrompt ? [{ role: "system", content: systemPrompt }] : [];
    const req = {
      model: this.model.id,
      messages: [...sys, ...messages],
      max_tokens: this.binding.maxOutputTokens,
      stream: true,
      metadata: { agentId: this.binding.agentId, providerId: this.provider.id }
    };
    if (shouldSendTemperature(this.provider, this.model, this.binding.temperature)) req.temperature = this.binding.temperature;
    if (thinking.mode !== "off" && this.model.supportsThinking) {
      req.reasoning_effort = thinking.level;
    }
    return req;
  }
  async stream(opts, cb) {
    try {
      const provider = opts.providerOverride || this.provider;
      const thinking = opts.thinkingOverride || this.thinking;
      const model = this.model;
      const messages = opts.messages;
      if (provider.kind === "anthropic") {
        await this.streamAnthropic(provider, model, messages, opts, thinking, cb, opts.signal);
      } else if (provider.kind === "gemini") {
        await this.streamGemini(provider, model, messages, opts, thinking, cb, opts.signal);
      } else if (provider.kind === "openai" && usesOpenAIResponses(model.id)) {
        await this.streamOpenAIResponses(provider, model, messages, opts, thinking, cb, opts.signal);
      } else {
        await this.streamOpenAICompat(provider, model, messages, opts, thinking, cb, opts.signal);
      }
    } catch (e) {
      cb.onError?.(e);
    }
  }
  // ---- OpenAI Responses API（GPT-5 系列） ----
  async streamOpenAIResponses(provider, model, messages, opts, thinking, cb, signal) {
    const url2 = openAIResponsesUrl(provider.baseUrl);
    const body = {
      model: model.id,
      input: openaiMessagesToResponsesInput(messages),
      stream: true,
      metadata: { agentId: this.binding.agentId, providerId: provider.id }
    };
    if (opts.systemPrompt) body.instructions = opts.systemPrompt;
    if (this.binding.maxOutputTokens) body.max_output_tokens = this.binding.maxOutputTokens;
    if (thinking.mode !== "off" && model.supportsThinking) {
      body.reasoning = { effort: normalizeOpenAIReasoningEffort(thinking.level) };
    } else if (shouldSendTemperature(provider, model, this.binding.temperature)) {
      body.temperature = this.binding.temperature;
    }
    if (opts.tools && opts.tools.length) {
      body.tools = opts.tools.map(openaiChatToolToResponsesTool).filter(Boolean);
      if (opts.toolChoice !== void 0) body.tool_choice = opts.toolChoice;
    }
    const res = await proxyFetch(url2, { method: "POST", headers: this.headersFor(provider), body: JSON.stringify(body), signal });
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      throw new Error(`OpenAI Responses HTTP ${res.status}: ${txt.slice(0, 300)}`);
    }
    let content = "";
    let usage = void 0;
    let finishReason;
    const toolAcc = /* @__PURE__ */ new Map();
    let toolSeq = 0;
    await this.readSse(res.body, (evt) => {
      if (!evt || evt === "[DONE]") return;
      try {
        const obj = JSON.parse(evt);
        const type = obj.type || obj.event;
        if ((type === "response.output_text.delta" || type === "response.text.delta") && typeof obj.delta === "string") {
          content += obj.delta;
          cb.onContent?.(obj.delta);
        }
        if ((type === "response.reasoning_text.delta" || type === "response.reasoning_summary_text.delta") && typeof obj.delta === "string") {
          cb.onThinking?.(obj.delta);
        }
        if (type === "response.output_item.added" && obj.item?.type === "function_call") {
          const key = String(obj.item.call_id || obj.item.id || obj.output_index || toolSeq);
          toolAcc.set(key, {
            index: toolSeq++,
            id: String(obj.item.call_id || obj.item.id || key),
            type: "function",
            function: { name: String(obj.item.name || "unknown"), arguments: String(obj.item.arguments || "") }
          });
        }
        if (type === "response.function_call_arguments.delta") {
          const key = String(obj.call_id || obj.item_id || obj.output_index || "");
          const existing = toolAcc.get(key) || {
            index: toolSeq++,
            id: key || `call-${toolSeq}`,
            type: "function",
            function: { name: String(obj.name || "unknown"), arguments: "" }
          };
          existing.function.arguments += obj.delta || "";
          toolAcc.set(key || existing.id, existing);
        }
        if (type === "response.output_item.done" && obj.item?.type === "function_call") {
          const key = String(obj.item.call_id || obj.item.id || obj.output_index || "");
          const existing = toolAcc.get(key) || {
            index: toolSeq++,
            id: String(obj.item.call_id || obj.item.id || key || `call-${toolSeq}`),
            type: "function",
            function: { name: String(obj.item.name || "unknown"), arguments: "" }
          };
          existing.function.name = String(obj.item.name || existing.function.name);
          existing.function.arguments = String(obj.item.arguments || existing.function.arguments || "");
          toolAcc.set(key || existing.id, existing);
        }
        if (type === "response.completed" && obj.response) {
          usage = normalizeUsage(obj.response.usage);
          finishReason = responseFinishReason(obj.response);
          const fromOutput = responsesToolCalls(obj.response.output || []);
          for (const tc of fromOutput) if (!toolAcc.has(tc.id)) toolAcc.set(tc.id, tc);
        }
      } catch {
      }
    });
    const toolCalls = Array.from(toolAcc.values()).sort((a, b) => a.index - b.index);
    cb.onDone?.({
      content,
      usage,
      finishReason: toolCalls.length ? "tool_calls" : finishReason,
      toolCalls: toolCalls.length ? toolCalls : void 0
    });
  }
  // ---- OpenAI 兼容（含 OpenAI / DeepSeek / OpenRouter / 自定义） ----
  async streamOpenAICompat(provider, model, messages, opts, thinking, cb, signal) {
    const url2 = openAIChatCompletionsUrl(provider.baseUrl);
    const body = this.buildRequest(messages, opts.systemPrompt, thinking);
    body.stream_options = { include_usage: true };
    if (opts.tools && opts.tools.length) {
      body.tools = opts.tools;
      if (opts.toolChoice !== void 0) body.tool_choice = opts.toolChoice;
    }
    const headers = this.headersFor(provider);
    const res = await proxyFetch(url2, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} from ${provider.name}: ${txt.slice(0, 200)}`);
    }
    let content = "";
    let usage = void 0;
    let finishReason;
    const toolAcc = [];
    await this.readSse(res.body, (evt) => {
      if (!evt || evt === "[DONE]") return;
      try {
        const chunk = JSON.parse(evt);
        const u = chunk.usage;
        if (u) usage = normalizeUsage(u);
        const fr = chunk.choices?.[0]?.finish_reason;
        if (fr) finishReason = normFinish(fr);
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
          cb.onContent?.(delta.content);
        }
        if (delta?.reasoning_content) cb.onThinking?.(delta.reasoning_content);
        if (delta?.tool_calls && delta.tool_calls.length) {
          accumulateToolCalls(toolAcc, delta.tool_calls);
          cb.onToolCallDelta?.(delta.tool_calls);
        }
      } catch {
      }
    });
    cb.onDone?.({ content, usage, finishReason, toolCalls: toolAcc.length ? toolAcc : void 0 });
  }
  // ---- Anthropic Messages ----
  async streamAnthropic(provider, model, messages, opts, thinking, cb, signal) {
    const url2 = anthropicMessagesUrl(provider.baseUrl);
    const headers = this.headersFor(provider);
    const sysText = opts.systemPrompt || "";
    const supportsThinking = model.supportsThinking && provider.capabilities.nativeThinking;
    const wantThink = thinking.mode !== "off" && supportsThinking;
    const budget = thinking.budgetTokens ?? THINKING_BUDGET_TOKENS[thinking.level] ?? THINKING_BUDGET_TOKENS.medium;
    const body = {
      model: model.id,
      max_tokens: this.binding.maxOutputTokens ?? 8192,
      stream: true,
      messages: openaiMessagesToAnthropic(messages)
    };
    if (sysText) body.system = sysText;
    if (wantThink) body.thinking = { type: "enabled", budget_tokens: budget };
    if (this.binding.temperature !== void 0 && !wantThink) body.temperature = this.binding.temperature;
    if (opts.tools && opts.tools.length) body.tools = openaiToolsToAnthropic(opts.tools);
    const res = await proxyFetch(url2, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Anthropic HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    let content = "";
    let thinkingTxt = "";
    let thinkingStartedAt = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason;
    const toolAcc = [];
    await this.readSse(res.body, (evt) => {
      if (!evt) return;
      const payload = evt.startsWith("data: ") ? evt.slice(6).trim() : evt.trim();
      if (!payload) return;
      try {
        const obj = JSON.parse(payload);
        if (obj.type === "content_block_start") {
          if (obj.content_block?.type === "thinking") thinkingStartedAt = Date.now();
          if (obj.content_block?.type === "tool_use") {
            toolAcc[obj.index] = { index: obj.index, id: obj.content_block.id, type: "function", function: { name: obj.content_block.name, arguments: "" } };
          }
        }
        if (obj.type === "content_block_delta") {
          if (obj.delta?.type === "thinking_delta" && obj.delta?.thinking) {
            thinkingTxt += obj.delta.thinking;
            cb.onThinking?.(obj.delta.thinking);
          }
          if (obj.delta?.type === "text_delta" && obj.delta?.text) {
            content += obj.delta.text;
            cb.onContent?.(obj.delta.text);
          }
          if (obj.delta?.type === "input_json_delta" && toolAcc[obj.index]) {
            toolAcc[obj.index].function.arguments += obj.delta.partial_json || "";
          }
        }
        if (obj.type === "message_start" && obj.message?.usage) {
          inputTokens = obj.message.usage.input_tokens ?? inputTokens;
          outputTokens = obj.message.usage.output_tokens ?? outputTokens;
        }
        if (obj.type === "message_delta") {
          if (obj.usage) outputTokens = obj.usage.output_tokens ?? outputTokens;
          if (obj.delta?.stop_reason) stopReason = obj.delta.stop_reason;
        }
      } catch {
      }
    });
    const toolCalls = toolAcc.filter(Boolean);
    cb.onDone?.({
      content,
      usage: normalizeUsage({ input_tokens: inputTokens, output_tokens: outputTokens }),
      finishReason: normFinish(stopReason),
      toolCalls: toolCalls.length ? toolCalls : void 0,
      thinking: thinkingTxt ? {
        enabled: true,
        level: thinking.level,
        budget,
        preview: thinkingTxt.slice(0, 280),
        durationMs: thinkingStartedAt ? Date.now() - thinkingStartedAt : void 0
      } : void 0
    });
  }
  // ---- Gemini generateContent (stream via SSE) ----
  async streamGemini(provider, model, messages, opts, thinking, cb, signal) {
    const url2 = `${provider.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(provider.apiKey)}`;
    const headers = this.headersFor(provider);
    const sysText = opts.systemPrompt;
    const contents = openaiMessagesToGemini(messages);
    const body = { contents };
    if (sysText) body.systemInstruction = { role: "system", parts: [{ text: sysText }] };
    if (opts.tools && opts.tools.length) body.tools = [{ functionDeclarations: openaiToolsToGemini(opts.tools) }];
    if (model.supportsThinking && thinking.mode !== "off") {
      const budget = thinking.budgetTokens ?? THINKING_BUDGET_TOKENS[thinking.level] ?? THINKING_BUDGET_TOKENS.medium;
      body.generationConfig = { thinkingConfig: { thinkingBudget: budget }, maxOutputTokens: this.binding.maxOutputTokens ?? 8192 };
    } else if (this.binding.maxOutputTokens) {
      body.generationConfig = { maxOutputTokens: this.binding.maxOutputTokens };
    }
    const res = await proxyFetch(url2, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Gemini HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }
    let content = "";
    let thinkingTxt = "";
    let usageMeta = void 0;
    let geminiFinish;
    const toolAcc = [];
    await this.readSse(res.body, (evt) => {
      if (!evt) return;
      const payload = evt.startsWith("data: ") ? evt.slice(6).trim() : evt.trim();
      if (!payload) return;
      try {
        const obj = JSON.parse(payload);
        if (obj.usageMetadata) usageMeta = obj.usageMetadata;
        const fr = obj.candidates?.[0]?.finishReason;
        if (fr) geminiFinish = normFinish(fr);
        const parts = obj.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.functionCall) {
            toolAcc.push({ index: toolAcc.length, id: "gcall-" + toolAcc.length, type: "function", function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) } });
          } else if (part.text && part.thought) {
            thinkingTxt += part.text;
            cb.onThinking?.(part.text);
          } else if (part.text) {
            content += part.text;
            cb.onContent?.(part.text);
          }
        }
      } catch {
      }
    });
    cb.onDone?.({
      content,
      usage: normalizeUsage(usageMeta),
      finishReason: toolAcc.length ? "tool_calls" : geminiFinish,
      toolCalls: toolAcc.length ? toolAcc : void 0,
      thinking: thinkingTxt ? {
        enabled: true,
        level: thinking.level,
        preview: thinkingTxt.slice(0, 280)
      } : void 0
    });
  }
  headersFor(p) {
    const h = { "content-type": "application/json", ...p.customHeaders || {} };
    if (p.kind === "openai" || p.kind === "openai-compatible" || p.kind === "custom") {
      if (p.apiKey) {
        h["authorization"] = "Bearer " + p.apiKey;
      } else {
        delete h["authorization"];
      }
    } else if (p.kind === "anthropic") {
      if (p.apiKey) {
        h["x-api-key"] = p.apiKey;
      } else {
        delete h["x-api-key"];
      }
      h["anthropic-version"] = "2023-06-01";
    }
    return h;
  }
  async readSse(body, onEvent) {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const evt = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = evt.split("\n").filter((l) => l.startsWith("data: ")).join("\n");
        const cleaned = dataLine.replace(/^data: /gm, "").trim();
        onEvent(cleaned);
      }
    }
  }
}
function accumulateToolCalls(acc, deltas) {
  for (const d of deltas) {
    const i = typeof d.index === "number" ? d.index : acc.length;
    if (!acc[i]) acc[i] = { index: i, id: d.id, type: d.type || "function", function: { name: "", arguments: "" } };
    if (d.id) acc[i].id = d.id;
    if (d.type) acc[i].type = d.type;
    if (d.function?.name) acc[i].function.name = d.function.name;
    if (typeof d.function?.arguments === "string") acc[i].function.arguments += d.function.arguments;
  }
}
function openaiToolsToAnthropic(tools) {
  return (tools || []).filter((t) => t?.function).map((t) => ({
    name: t.function.name,
    description: t.function.description || "",
    input_schema: t.function.parameters || { type: "object", properties: {} }
  }));
}
function openaiToolsToGemini(tools) {
  return (tools || []).filter((t) => t?.function).map((t) => ({
    name: t.function.name,
    description: t.function.description || "",
    parameters: t.function.parameters || { type: "object", properties: {} }
  }));
}
function usesOpenAIResponses(modelId) {
  return /^gpt-5/i.test(modelId);
}
function normalizeOpenAIReasoningEffort(level) {
  if (level === "minimal") return "minimal";
  if (level === "xhigh") return "high";
  return level;
}
function openaiChatToolToResponsesTool(tool) {
  if (!tool?.function?.name) return null;
  return {
    type: "function",
    name: tool.function.name,
    description: tool.function.description || "",
    parameters: tool.function.parameters || { type: "object", properties: {} }
  };
}
function openaiMessagesToResponsesInput(messages) {
  const input = [];
  for (const m of messages) {
    if (m.role === "system") {
      input.push({ role: "system", content: [{ type: "input_text", text: m.content || "" }] });
      continue;
    }
    if (m.role === "tool") {
      input.push({ type: "function_call_output", call_id: m.tool_call_id, output: m.content || "" });
      continue;
    }
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      if (m.content) input.push({ role: "assistant", content: [{ type: "output_text", text: m.content }] });
      for (const tc of m.tool_calls) {
        input.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function?.name || "unknown",
          arguments: tc.function?.arguments || "{}"
        });
      }
      continue;
    }
    input.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: [{
        type: m.role === "assistant" ? "output_text" : "input_text",
        text: m.content || ""
      }]
    });
  }
  return input;
}
function responsesToolCalls(output) {
  return (output || []).map((item, index) => item?.type === "function_call" ? {
    index,
    id: String(item.call_id || item.id || `call-${index}`),
    type: "function",
    function: { name: String(item.name || "unknown"), arguments: String(item.arguments || "{}") }
  } : null).filter(Boolean);
}
function responseFinishReason(response) {
  if (!response) return void 0;
  if ((response.output || []).some((item) => item?.type === "function_call")) return "tool_calls";
  return normFinish(response.status === "completed" ? "stop" : response.status);
}
function toolNameById(messages) {
  const map = {};
  for (const m of messages) {
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) if (tc.id && tc.function?.name) map[tc.id] = tc.function.name;
    }
  }
  return map;
}
function openaiMessagesToAnthropic(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.tool_call_id, content: m.content || "" };
      const last = out[out.length - 1];
      if (last && last.role === "user" && last._toolGroup) last.content.push(block);
      else out.push({ role: "user", content: [block], _toolGroup: true });
      continue;
    }
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const blocks = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls) {
        let input = {};
        try {
          input = JSON.parse(tc.function?.arguments || "{}");
        } catch {
          input = {};
        }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function?.name, input });
      }
      out.push({ role: "assistant", content: blocks });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out.map(({ _toolGroup, ...rest }) => rest);
}
function openaiMessagesToGemini(messages) {
  const nameById = toolNameById(messages);
  const out = [];
  for (const m of messages) {
    if (m.role === "tool") {
      const name = m.tool_call_id && nameById[m.tool_call_id] || "tool";
      const part = { functionResponse: { name, response: { result: m.content || "" } } };
      const last = out[out.length - 1];
      if (last && last._fnGroup) last.parts.push(part);
      else out.push({ role: "user", parts: [part], _fnGroup: true });
      continue;
    }
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(tc.function?.arguments || "{}");
        } catch {
          args = {};
        }
        parts.push({ functionCall: { name: tc.function?.name, args } });
      }
      out.push({ role: "model", parts });
      continue;
    }
    out.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] });
  }
  return out.map(({ _fnGroup, ...rest }) => rest);
}
function normFinish(raw) {
  if (!raw) return void 0;
  const s = String(raw).toLowerCase();
  if (s === "max_tokens" || s === "length") return "length";
  if (s === "tool_use" || s === "tool_calls" || s === "function_call") return "tool_calls";
  if (s === "content_filter" || s === "safety" || s === "recitation") return "content_filter";
  return "stop";
}
function normalizeUsage(u) {
  if (!u) return void 0;
  const prompt = u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount;
  const completion = u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount;
  const total = u.total_tokens ?? u.totalTokenCount ?? (prompt !== void 0 || completion !== void 0 ? (prompt ?? 0) + (completion ?? 0) : void 0);
  if (prompt === void 0 && completion === void 0 && total === void 0) return void 0;
  return { prompt_tokens: prompt ?? 0, completion_tokens: completion ?? 0, total_tokens: total ?? 0 };
}
function buildProviderClient(resolved) {
  return new ProviderClient(resolved.provider, resolved.model, resolved.binding, resolved.thinking);
}
function buildAgentRuntimeSystemPrompt(agentId, basePrompt = agentSystemPrompt(agentId), memories = [], taskText = "", skillsBlock = "") {
  const name = agentName(agentId);
  const caps = agentCaps(agentId);
  const memoryBlock = formatMemories(selectRelevantMemories(memories, taskText, 6));
  return [
    basePrompt.trim(),
    "",
    "Orbit Hub agent runtime:",
    `- Agent: ${name} (${agentId})`,
    `- Capabilities: ${caps.length ? caps.join(", ") : "general assistance"}`,
    "- Work as an autonomous agent, not a passive chatbot.",
    "- Plan: infer the concrete goal, constraints, missing context, and the next useful action.",
    "- Act: produce the best actionable result for this agent capability. If execution is impossible, explain the exact blocker and the next fix.",
    "- Check: verify your own answer for correctness, edge cases, and whether it satisfies the user request.",
    "- Report: keep the final response concise. Lead with completed work, findings, decisions, or what the user must handle.",
    "- Do not reveal hidden reasoning. Do not include startup banners, tool chatter, or generic capability disclaimers.",
    memoryBlock,
    skillsBlock
  ].filter(Boolean).join("\n");
}
function buildAgentTaskPrompt(agentId, userTask, memories = [], skillsBlock = "") {
  return [
    buildAgentRuntimeSystemPrompt(agentId, agentSystemPrompt(agentId), memories, userTask, skillsBlock),
    "",
    "User task:",
    userTask
  ].join("\n");
}
function selectRelevantMemories(memories, taskText = "", limit = 6) {
  const terms = tokenize(taskText);
  return memories.map((memory2, index) => ({ memory: memory2, index, score: scoreMemory(memory2, terms) })).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, Math.max(0, limit)).map((item) => item.memory);
}
function formatMemories(memories) {
  if (memories.length === 0) return "";
  return [
    "Relevant Orbit Hub memory:",
    ...memories.map((memory2, index) => {
      const category = memory2.category || "memory";
      const title = clean(memory2.title || memory2.source || "Untitled");
      const summary = clean(memory2.summary || "");
      return `${index + 1}. [${category}] ${title}${summary ? " - " + summary : ""}`;
    })
  ].join("\n");
}
function scoreMemory(memory2, terms) {
  const haystack = [
    memory2.category,
    memory2.title,
    memory2.summary,
    memory2.source,
    ...memory2.tags || []
  ].join(" ").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (term && haystack.includes(term)) score += term.length > 1 ? 2 : 1;
  }
  if (memory2.category === "semantic" || memory2.category === "procedure") score += 2;
  if (memory2.category === "episodic" || memory2.category === "decision") score += 1.8;
  if (memory2.category === "conversation") score += 1.5;
  if (memory2.category === "task") score += 1;
  if (memory2.category === "skill") score += 0.8;
  return score;
}
function tokenize(text) {
  const ascii = text.toLowerCase().match(/[a-z0-9_-]{2,}/g) || [];
  const cjk = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
  return Array.from(/* @__PURE__ */ new Set([...ascii, ...cjk]));
}
function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 220);
}
function createPlanArtifact(input) {
  const now = input.now || (/* @__PURE__ */ new Date()).toISOString();
  const nodes = input.subtasks.map((item, index) => normalizeTaskContract(item, index, now, input.knownAgents)).filter((item) => !!item);
  const safeNodes = nodes.length ? nodes : [
    normalizeTaskContract({ id: "1", title: input.goal.slice(0, 80), detail: input.goal }, 0, now, input.knownAgents)
  ];
  return {
    version: 1,
    missionId: input.missionId,
    goal: input.goal,
    leadAgentId: input.leadAgentId,
    status: "draft",
    source: input.source || "llm",
    taskDag: {
      nodes: safeNodes,
      edges: buildDagEdges(safeNodes)
    },
    createdAt: now,
    updatedAt: now,
    summary: summarizeContracts(safeNodes),
    planText: input.planText
  };
}
function parsePlanArtifact(raw, input) {
  const obj = extractJsonObject(raw);
  if (!obj) return null;
  const candidates = Array.isArray(obj?.subtasks) ? obj.subtasks : Array.isArray(obj?.contracts) ? obj.contracts : Array.isArray(obj?.taskDag?.nodes) ? obj.taskDag.nodes : null;
  if (!candidates || candidates.length === 0) return null;
  return createPlanArtifact({
    missionId: input.missionId,
    goal: String(obj.goal || input.goal),
    leadAgentId: String(obj.leadAgentId || input.leadAgentId || "") || void 0,
    subtasks: candidates,
    source: "llm",
    planText: raw,
    knownAgents: input.knownAgents
  });
}
function normalizeTaskContract(item, index, now = (/* @__PURE__ */ new Date()).toISOString(), knownAgents) {
  if (!item || typeof item !== "object") return null;
  const detail = stringValue(item.detail) || stringValue(item.description) || stringValue(item.task) || stringValue(item.title);
  const title = (stringValue(item.title) || detail || `Task ${index + 1}`).slice(0, 100);
  if (!title && !detail) return null;
  const rawAgent = stringValue(item.agentId) || stringValue(item.agent);
  const agentId = rawAgent && (!knownAgents || knownAgents.includes(rawAgent)) ? rawAgent : void 0;
  return {
    id: stringValue(item.id) || String(index + 1),
    title,
    detail: detail || title,
    agentId,
    fileScope: stringArray(item.fileScope ?? item.files ?? item.scope).slice(0, 20),
    dependsOn: stringArray(item.dependsOn ?? item.dependencies ?? item.after).slice(0, 20),
    doneWhen: stringValue(item.doneWhen) || stringValue(item.acceptanceCriteria) || "the assigned work is observably complete",
    verifyCommand: stringValue(item.verifyCommand) || stringValue(item.verify) || "",
    interfaceRef: stringValue(item.interfaceRef) || stringValue(item.contractRef) || stringValue(item.sharedContract) || "",
    status: normalizeStatus(item.status),
    createdAt: stringValue(item.createdAt) || now,
    updatedAt: stringValue(item.updatedAt) || now
  };
}
function setPlanStatus(artifact, status, now = (/* @__PURE__ */ new Date()).toISOString()) {
  return { ...artifact, status, updatedAt: now };
}
function setContractStatus(artifact, contractId, status, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const nodes = artifact.taskDag.nodes.map((node) => node.id === contractId ? { ...node, status, updatedAt: now } : node);
  return {
    ...artifact,
    status: rollupPlanStatus(artifact.status, nodes),
    taskDag: { nodes, edges: artifact.taskDag.edges },
    updatedAt: now
  };
}
function contractPromptBlock(contract) {
  return [
    "- Title: " + contract.title,
    "- Detail: " + contract.detail,
    "- File scope: " + (contract.fileScope?.length ? contract.fileScope.join(", ") : "not specified; keep changes tightly scoped"),
    "- Depends on: " + (contract.dependsOn?.length ? contract.dependsOn.join(", ") : "none"),
    "- Done when: " + (contract.doneWhen || "the requested task is observably complete"),
    "- Verify command: " + (contract.verifyCommand || "not specified; choose the smallest relevant check if available"),
    "- Interface/contract reference: " + (contract.interfaceRef || "none declared")
  ].join("\n");
}
function contextLine(value, limit = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
function linkHintsFromContent(content) {
  const text = String(content || "");
  const matches = text.match(/(?:https?:\/\/127\.0\.0\.1:\d+\/[^\s`"'<>)]*|file:\/\/\/[^\s`"'<>)]*)/g) || [];
  return Array.from(new Set(matches)).slice(0, 5);
}
function buildHandoffCapsule(input = {}) {
  const contract = input.contract || {};
  const fileScope = Array.isArray(contract.fileScope) && contract.fileScope.length ? contract.fileScope.join(", ") : "not specified";
  const previousOutput = contextLine(input.previousContent || "", 900);
  const previousError = contextLine(input.previousError || input.error || "", 500);
  const verifierNote = contextLine(input.verifierNote || "", 500);
  const activity = Array.isArray(input.activityLog) && input.activityLog.length ? input.activityLog.slice(-12).map((item) => `- ${contextLine(item, 220)}`).join("\n") : "- No activity trace captured.";
  const links = Array.from(new Set([...(input.links || []), ...linkHintsFromContent(input.previousContent)])).slice(0, 6);
  const failedDeps = Array.isArray(input.failedDeps) && input.failedDeps.length ? input.failedDeps.join(", ") : "";
  const peerResults = Array.isArray(input.peerResults) && input.peerResults.length ? input.peerResults.map((p) => {
    const label = [p.id, p.agentId ? `[${p.agentId}]` : ""].filter(Boolean).join(" ");
    return `- ${label}: ${p.error ? "failed: " + contextLine(p.error, 180) : contextLine(p.summary || p.content || "", 220)}`;
  }).join("\n") : "- No peer result snapshot supplied.";
  const lines = [
    "## ORBIT HANDOFF CAPSULE",
    `Mission: ${input.missionId || "unknown"}`,
    `Contract: ${contract.id || "unknown"} — ${contract.title || contract.detail || "untitled"}`,
    `From: ${input.fromAgent || "unknown"}${input.toAgent ? ` -> To: ${input.toAgent}` : ""}`,
    `Reason: ${input.reason || "handoff / retry"}`,
    "",
    "### Shared State Boundary",
    "- The filesystem/workspace, contract DAG, mission timeline and this capsule are shared.",
    "- The previous agent's private model context, hidden reasoning and live CLI memory are not shared.",
    "",
    "### Contract To Continue",
    `- File scope: ${fileScope}`,
    `- Done when: ${contract.doneWhen || "the assigned work is observably complete"}`,
    `- Verify command: ${contract.verifyCommand || "not specified"}`,
    failedDeps ? `- Failed dependencies to rescue: ${failedDeps}` : "",
    "",
    "### Previous Attempt Evidence",
    previousOutput ? `- Output preview: ${previousOutput}` : "- Output preview: none captured.",
    previousError ? `- Error/blocker: ${previousError}` : "",
    verifierNote ? `- Verifier note: ${verifierNote}` : "",
    links.length ? `- Known links/artifacts: ${links.join(" | ")}` : "- Known links/artifacts: none detected yet.",
    "",
    "### Captured Activity Before Interruption",
    activity,
    "",
    "### Peer Snapshot",
    peerResults,
    "",
    "### Next Action",
    input.nextAction || "Inspect the declared file scope and previous output first, then repair or complete the concrete artifact. Do not only summarize the failure.",
    "",
    "### Required Handoff Back",
    "- End your response with HANDOFF CAPSULE: changed files/artifacts, commands actually run, current status, blockers/risks, and next concrete action."
  ].filter((line) => line !== "");
  return lines.slice(0, 60).join("\n");
}
function buildOpenAgentsWorkspaceContext(input) {
  const peers = Array.isArray(input.peers) ? input.peers : [];
  const peerLines = peers.length ? peers.map((peer) => {
    const title = contextLine(peer.title || peer.detail || peer.id, 140);
    return `- ${peer.id}${peer.agentId ? " [" + peer.agentId + "]" : ""}${peer.status ? " " + peer.status : ""}: ${title}`;
  }).join("\n") : "- No peer contracts declared.";
  const current = input.currentContract ? contractPromptBlock(input.currentContract) : "- Mission-level planning or synthesis.";
  const previous = Array.isArray(input.previousWork) && input.previousWork.length ? input.previousWork.map((item) => `- ${item.id}${item.agentId ? " [" + item.agentId + "]" : ""}${item.error ? " failed: " + contextLine(item.error, 140) : ": " + contextLine(item.summary, 180)}`).join("\n") : "- No prior worker result in this mission yet.";
  const history = contextLine(input.recentHistory || "", 3500);
  const handoff = String(input.handoffNote || input.handoffCapsule || "").trim();
  const reactorState = String(input.reactorState || "").trim();
  const sharedLedger = input.sharedLedger && input.sharedLedger.path ? input.sharedLedger : null;
  const sharedLedgerLines = sharedLedger ? [
    `- Path: ${sharedLedger.path}`,
    sharedLedger.absolutePath && sharedLedger.absolutePath !== sharedLedger.path ? `- Absolute path: ${sharedLedger.absolutePath}` : "",
    `- Updated: ${sharedLedger.updatedAt || "unknown"}`,
    "- Read this ledger before acting. Treat it as the mission's shared channel snapshot: contracts, peer outputs, artifacts, verifier notes and handoff capsules.",
    "- If your lane changes assumptions or produces artifacts, include them in HANDOFF CAPSULE so Orbit can write them back to this ledger for the next worker."
  ].filter(Boolean).join("\n") : "- No on-disk ledger is available; use this prompt context and final handoff capsules as the shared channel.";
  const mode = input.mode === "PLAN" ? "PLAN" : "EXECUTE";
  const modeRules = mode === "PLAN" ? [
    "- Align on shared assumptions, risks, dependencies and handoff boundaries before acting.",
    "- Prefer a small, explicit next action over speculative implementation.",
    "- If information is missing, state the blocking question and the safest assumption."
  ] : [
    "- Execute only the assigned contract and keep changes inside the declared scope.",
    "- Use peer outputs and channel history as shared context; do not assume private context was seen by other agents.",
    "- End with changed files, verification performed, blockers, and any handoff note."
  ];
  return [
    "## OpenAgents Workspace Context",
    `Agent: ${input.agentName || input.agentId || "unknown"} (${input.agentId || "unknown"})`,
    `Workspace: ${input.workspaceId || "local"}`,
    `Channel: ${input.channelId || input.missionId || "mission"}`,
    `Mission: ${input.missionGoal || ""}`,
    `Mode: ${mode}`,
    "",
    "### Collaboration Protocol",
    "- Treat this prompt as a persistent shared workspace channel, not an isolated one-off chat.",
    "- The channel history, contract DAG and previous worker results are the source of truth for coordination.",
    "- Publish concise handoff notes in your final answer so the next Codex/Claude worker can continue without guessing.",
    "- Do not overwrite another worker's scope unless the contract explicitly requires it.",
    "",
    "### Mission Shared Ledger",
    sharedLedgerLines,
    "",
    "### Mode Rules",
    ...modeRules,
    "",
    "### Current Contract",
    current,
    "",
    "### Peer Contracts",
    peerLines,
    "",
    "### Previous Worker Results",
    previous,
    "",
    "### Reactor Runtime",
    reactorState || "- Plan-Solve loop has not recorded a wave yet.",
    "",
    "### Recent Channel History",
    history || "- No recorded channel events yet.",
    "",
    "### Active Handoff Capsule",
    handoff || "- No active handoff capsule.",
    "",
    "### Attribution",
    "- Local prompt/channel structure adapted from OpenAgents agent-connector workspace semantics (Apache-2.0)."
  ].join("\n");
}
function extractJsonObject(raw) {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}
function buildDagEdges(nodes) {
  const ids = new Set(nodes.map((node) => node.id));
  const edges = [];
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (ids.has(dep)) edges.push({ from: dep, to: node.id, type: "blocks" });
    }
  }
  return edges;
}
function summarizeContracts(nodes) {
  return nodes.map((node) => `${node.id}. ${node.title}${node.agentId ? ` [${node.agentId}]` : ""}`).join(" | ");
}
function normalizeStatus(status) {
  const s = typeof status === "string" ? status : "";
  return ["planned", "awaiting-approval", "ready", "running", "waiting", "blocked", "done", "failed", "cancelled"].includes(s) ? s : "planned";
}
function rollupPlanStatus(current, nodes) {
  if (current === "cancelled") return current;
  if (nodes.some((node) => node.status === "running")) return "running";
  if (nodes.every((node) => node.status === "done")) return "completed";
  if (nodes.some((node) => node.status === "failed" || node.status === "blocked")) return "failed";
  return current === "awaiting-approval" ? current : "approved";
}
function stringArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean);
  }
  return [];
}
function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}
const KNOWN_AGENTS = EXECUTION_WORKER_AGENT_IDS;
const ORCHESTRATOR_LEAD_SYSTEM = "You are Orbit, the evolving lead agent and Reactor controller. You are not an execution worker: never claim to have edited files, run checks, or completed the user deliverable yourself. Use Orbit's own Gene/Capsule/EvolutionEvent memory plus EvoMap candidate patterns to improve planning before you assign work. Run multi-agent work as Plan -> Execute -> Observe -> Replan -> Solve: create one shared acceptance contract, assign bounded same-wave work to Codex CLI and/or Claude Code, observe artifacts/failures, dynamically add takeover or repair contracts when useful, supervise handoffs, verify real outputs, and synthesize one answer with artifact paths or links. Be concise and practical.";
function unifiedAcceptanceForGoal(goal) {
  const text = String(goal || "").trim();
  const webLike = /(网站|网页|页面|个人网站|portfolio|site|html|canvas|动画|visual|frontend|ui)/i.test(text);
  if (webLike) {
    return [
      "Shared Definition of Done:",
      "- A concrete user-visible artifact exists, usually an editable file such as index.html or an app route.",
      "- The result directly satisfies the user's visible request, not merely a plan or checklist.",
      "- The final answer must include exact file paths and a clickable local HTTP preview URL when the artifact is a page/visual deliverable.",
      "- Prefer Orbit's built-in preview URL format: http://127.0.0.1:9527/preview/<workspace-id>/<file>.",
      "- Verification must be real: static file existence/content checks, syntax checks, smoke checks, or visual/manual review that was actually performed.",
      "- If a check cannot run because of approval/sandbox limits, the worker must still inspect files and either produce a fix or clearly name the blocked command."
    ].join(" ");
  }
  return [
    "Shared Definition of Done:",
    "- A concrete artifact, patch, answer, or decision exists for the user's request.",
    "- All workers use the same acceptance criteria and do not invent incompatible standards.",
    "- The final answer lists exact outputs, real verification, unresolved risks, and any follow-up work.",
    "- If a command cannot run because of approval/sandbox limits, continue with the best available inspection and report the blocked command."
  ].join(" ");
}
function decompositionPrompt(userText, agents = KNOWN_AGENTS, episodicContext = "") {
  const acceptance = unifiedAcceptanceForGoal(userText);
  return [
    "You are Orbit, the main orchestrator. Build a collaboration plan that improves speed and quality, not a queue of disconnected chores.",
    "You are the evolving main Agent: if the context contains ORBIT MAIN AGENT EVOLUTION MEMORY, treat it as your own learned policy and apply it before routing workers.",
    "Use a managed-agent lifecycle: plan bounded contracts, execute same-wave lanes, observe artifacts and failures, replan takeover/repair contracts only when evidence shows they are needed, then let Orbit synthesize.",
    "Available agents: " + agents.join(", ") + ".",
    episodicContext ? "Use this project memory before planning:\n" + episodicContext : "",
    "All workers must share this acceptance contract:\n" + acceptance,
    "Keep task granularity aligned: every worker must receive a bounded contract with the same Definition of Done, not a vague chat request.",
    "Reply with ONLY a JSON object (no prose, no markdown fences) of the form:",
    '{"goal":"original goal","taskDag":{"nodes":[{"id":"1","title":"short title","detail":"what to do","agent":"<one of the agents, or omit>","fileScope":["relative/path/**"],"dependsOn":[],"doneWhen":"observable acceptance criteria","verifyCommand":"npm test or empty","interfaceRef":"API/design contract touched, or empty"}]}}',
    'Legacy {"subtasks":[...]} is accepted, but taskDag.nodes is preferred.',
    "Rules:",
    "- For small or single-artifact requests, do NOT create 3+ linear tasks. Use one owner implementation contract and, if both workers are available, one companion quality contract in the same ready wave.",
    "- The companion quality contract may create tests/checklists or inspect the repo, but it must not fail merely because the owner artifact is not ready yet; if the artifact is missing, it should produce a concrete repair recommendation or take over a minimal implementation in a non-conflicting file.",
    "- Default to side-by-side development: if Codex and Claude are both available, put independent worker contracts in the same ready wave with empty dependsOn. Use a dependency only for a real artifact dependency.",
    "- Do not create separate worker tasks named final verification, final delivery, handoff notes, summary, or delivery instructions. Orbit itself handles final synthesis and acceptance.",
    "- Keep parallel file scopes as non-colliding as possible. If two agents must touch the same artifact, make one the owner and the other a reviewer/tester or fallback repairer.",
    "- Put shared API, data shape, UI contract, or naming decisions in interfaceRef.",
    "- Put the smallest useful verification command in verifyCommand only when the worker can reasonably run it. Do not make a task fail solely because a sandbox approval was unavailable.",
    "- Every executable task MUST be assigned to one available worker agent. Orbit is the planner/supervisor only.",
    "- For file/web/visual deliverables, include a primary implementation/delivery lane and, when useful, a same-wave companion lane for acceptance assets, review, or fallback repair. Both lanes must cite the same Definition of Done.",
    "- The plan should help workers coordinate without sharing full private histories.",
    "",
    "TASK:",
    userText
  ].join("\n");
}
function parsePlan(raw, knownAgents = KNOWN_AGENTS) {
  const artifact = parsePlanArtifact(raw, {
    missionId: "parsed-plan",
    goal: "parsed goal",
    knownAgents
  });
  if (!artifact || artifact.taskDag.nodes.length === 0) return null;
  return { subtasks: artifact.taskDag.nodes, artifact };
}
function subtaskContractPrompt(st, workspaceContext = "") {
  return [
    "You are a sub-agent working under the Orbit main orchestrator.",
    "Execute ONLY this assigned task. Stay inside the task contract and coordinate through explicit notes when assumptions change.",
    "All workers on this mission share the same Definition of Done. Do not invent a separate acceptance standard for your lane.",
    "If a peer lane is missing, failed, or unavailable, do not stop at 'blocked' when you can inspect the workspace and make progress. Produce a concrete repair, fallback artifact, or exact next command.",
    workspaceContext ? "\n" + workspaceContext : "",
    "",
    "TASK:",
    st.detail || st.title,
    "",
    "TASK CONTRACT:",
    contractPromptBlock(st),
    "",
    "DELIVERY RULES:",
    "- If you create or modify files, include the exact changed file paths.",
    "- If the output is viewable, include a file:// URL, localhost URL, or exact command to open it.",
    "- Report only commands/checks you actually ran. Do not invent smoke checks.",
    "- If you cannot produce the artifact, say what blocked it instead of claiming completion, and include the smallest concrete repair path.",
    "- A checklist, plan, or explanation is not complete unless the contract explicitly asked for only that.",
    "- Always finish with a section named HANDOFF CAPSULE containing: changed files/artifacts, commands actually run, current status, blockers/risks, and the next concrete action for another agent.",
    "",
    "Before finishing, report what changed, what was verified, and any contract/coordination risk."
  ].join("\n");
}
function fallbackPlanArtifact(missionId, goal, leadAgentId) {
  return createPlanArtifact({
    missionId,
    goal,
    leadAgentId,
    source: "fallback",
    subtasks: [{ id: "1", title: goal.slice(0, 80), detail: goal }]
  });
}
function uniqueContractId(nodes, preferred) {
  const ids = new Set(nodes.map((node) => String(node.id)));
  if (!ids.has(preferred)) return preferred;
  let i = 2;
  while (ids.has(`${preferred}-${i}`)) i += 1;
  return `${preferred}-${i}`;
}
function implementationLikeText(text) {
  return /(做|创建|生成|实现|写|修改|改|修|代码|文件|页面|网页|动画|视觉|canvas|html|css|js|app|工具|网站|component|build|implement|create|generate|write|fix|make|edit|page|animation|visual)/i.test(String(text || ""));
}
function verificationLikeText(text) {
  return /(验收|校验|验证|检查|审查|总结|解释|文档|分析|review|verify|validate|check|summar|explain|document|analy)/i.test(String(text || ""));
}
function finalOnlyContractText(st) {
  return [st.title, st.detail, st.doneWhen, st.interfaceRef].filter(Boolean).join("\n");
}
function isFinalOnlyContract(st) {
  const text = finalOnlyContractText(st);
  if (!/(最终|交付说明|交付|汇总|总结|handoff|final|delivery|synthesis|summary)/i.test(text)) return false;
  if (implementationLikeText(text) && (st.fileScope || []).some((scope) => !/^docs?\//i.test(scope))) return false;
  return true;
}
function isPureVerificationContract(st) {
  const text = finalOnlyContractText(st);
  if (!verificationLikeText(text)) return false;
  if (implementationLikeText(text) && (st.fileScope || []).some((scope) => !/^docs?\//i.test(scope))) return false;
  return /(不要修改|不直接改|只做|仅|only|review|verify|validate|check|验收|校验|审查)/i.test(text);
}
function withSharedAcceptance(st, goal) {
  const acceptance = unifiedAcceptanceForGoal(goal);
  const doneWhen = st.doneWhen && st.doneWhen.includes("Shared Definition of Done") ? st.doneWhen : [st.doneWhen || "the assigned work is observably complete", acceptance].filter(Boolean).join("\n");
  const interfaceRef = st.interfaceRef && st.interfaceRef.includes("Shared Definition of Done") ? st.interfaceRef : [st.interfaceRef || "", acceptance].filter(Boolean).join("\n");
  return { ...st, doneWhen, interfaceRef };
}
function selectWorkerAgentForContract(st, workerIds, router2, available, context) {
  const ids = workerIds.filter(Boolean);
  if (ids.length === 0) return st.agentId;
  const text = [st.title, st.detail, st.doneWhen, st.verifyCommand, st.interfaceRef].filter(Boolean).join("\n");
  const scored = router2.routeScores(text, available, context).filter((s) => ids.includes(s.id));
  if (scored[0]?.id) return scored[0].id;
  if (verificationLikeText(text) && ids.includes("claude")) return "claude";
  if (implementationLikeText(text) && ids.includes("codex")) return "codex";
  if (ids.includes("codex")) return "codex";
  return ids[0];
}
function enforceWorkerPlan(plan, workerBindings, available, router2, context, goal) {
  const workerIds = Array.from(new Set(workerBindings.map((b) => b.agentId).filter((id) => isExecutionWorkerAgent(id))));
  const bound = new Set(workerIds);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const originalCount = plan.subtasks.length;
  plan.subtasks = plan.subtasks.filter((st) => {
    if (originalCount <= 1) return true;
    return !isFinalOnlyContract(st);
  }).map((st) => {
    const agentId = bound.has(st.agentId) ? st.agentId : selectWorkerAgentForContract(st, workerIds, router2, available, context);
    const normalized = withSharedAcceptance(st, goal);
    if (isPureVerificationContract(normalized)) {
      return {
        ...normalized,
        agentId,
        dependsOn: [],
        verifyCommand: "",
        detail: normalized.detail + "\n\n质量伴随规则：与实现 worker 同一批次启动；先制定验收清单、检查可见风险和可运行验证。若目标产物尚不存在，不要直接失败；记录缺口，并在不覆盖实现 lane 的前提下给出最小修复建议或可执行检查资产。",
        doneWhen: normalized.doneWhen + "\n如果因为产物未就绪或审批限制无法运行检查，输出可执行的修复/验证建议，而不是把 mission 卡死。"
      };
    }
    return { ...normalized, agentId };
  });
  if (plan.subtasks.length === 0) {
    plan.subtasks = [withSharedAcceptance({
      id: "1",
      title: goal.slice(0, 80),
      detail: goal,
      agentId: workerIds.includes("codex") ? "codex" : workerIds[0],
      fileScope: [],
      dependsOn: [],
      doneWhen: "完成用户可见目标，并给出真实产物路径/链接和验证结果。",
      verifyCommand: "",
      interfaceRef: "",
      status: "planned",
      createdAt: now,
      updatedAt: now
    }, goal)];
  }
  const used = new Set(plan.subtasks.map((st) => st.agentId).filter((id) => bound.has(id)));
  const bothNativeWorkers = workerIds.includes("codex") && workerIds.includes("claude");
  const needsParallelCompanion = bothNativeWorkers && implementationLikeText(goal) && !(used.has("codex") && used.has("claude"));
  if (needsParallelCompanion) {
    const companionAgent = used.has("codex") ? "claude" : "codex";
    const companionName = companionAgent === "claude" ? "Claude Code" : "Codex CLI";
    const peerName = companionAgent === "claude" ? "Codex CLI" : "Claude Code";
    plan.subtasks.push(withSharedAcceptance({
      id: uniqueContractId(plan.subtasks, `parallel-${companionAgent}`),
      title: companionAgent === "claude" ? "并行方案与交叉验收" : "并行实现与交付",
      detail: `${companionName} 与 ${peerName} 同一波次启动，不等待对方完成。围绕同一个目标独立推进一个非冲突 lane：可以产出替代/补充实现、验收说明或交付索引；如需写文件，选择不覆盖对方的文件名。最终必须列出真实产物路径/链接或明确没有产物。`,
      agentId: companionAgent,
      fileScope: [],
      dependsOn: [],
      doneWhen: "给出并行 lane 的真实产物或验收结论，并列出路径/链接、实际验证命令和需要合并的建议。",
      verifyCommand: "",
      interfaceRef: "并排开发：同一 ready wave 启动，避免非必要串行依赖。",
      status: "planned",
      createdAt: now,
      updatedAt: now
    }, goal));
  }
  return plan;
}
function synthesisPrompt(userText, parts, workspaceContext = "") {
  const blocks = parts.map(
    (p, i) => `### 子任务 ${i + 1}: ${p.title}${p.agentId ? " [" + p.agentId + "]" : ""}
` + (p.error ? "(执行失败: " + p.error + ")" : p.content || "(无输出)")
  ).join("\n\n");
  return [
    "You orchestrated the subtasks below for the user request. Synthesize their outputs into one coherent final answer. Resolve overlaps and note any failures briefly. Answer in the user's language.",
    "The final answer MUST contain a clear deliverables section. If files were created/changed, list exact paths and any file:// URL, localhost URL, or command to open/run them. If Orbit 自动交付检测 provides a local preview URL, put that http://127.0.0.1 link near the top as the primary clickable preview. If there is no artifact or no link, say that explicitly and do not claim the deliverable is complete.",
    "Do not invent verification. Only mention checks that workers actually reported.",
    workspaceContext ? "WORKSPACE CONTEXT:\n" + workspaceContext : "",
    "",
    "USER REQUEST:",
    userText,
    "",
    "SUBTASK RESULTS:",
    blocks
  ].join("\n");
}
function compactCollabLine(value, limit = 1800) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
function formatCollabTurn(turn, index) {
  return `### Turn ${index + 1} · Round ${turn.round} · ${turn.agentId}
${turn.text || "(empty)"}`;
}
function compactCollabTranscript(topic, transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) return "No prior turns yet.";
  const recent = transcript.slice(-6);
  const older = transcript.slice(0, -6);
  const olderSummary = older.length ? [
    "Earlier turns compressed for token control:",
    buildHandoffCapsule({
      missionId: "collaborate",
      contract: {
        id: "collaboration-transcript",
        title: "Compressed collaboration transcript",
        doneWhen: "future turns can respond to the shared record"
      },
      reason: "token-controlled transcript compaction",
      previousContent: older.map(formatCollabTurn).join("\n\n"),
      nextAction: "Use this capsule only as context. Directly answer the most recent full peer turn."
    }),
    ""
  ].join("\n") : "";
  return [
    olderSummary,
    "Recent full turns:",
    recent.map((turn, index) => formatCollabTurn(turn, transcript.length - recent.length + index)).join("\n\n"),
    "",
    "Original topic:",
    topic
  ].filter(Boolean).join("\n");
}
function collabTurnPrompt(topic, agentId, transcript, round, totalRounds, participants = []) {
  const lastPeer = [...(transcript || [])].reverse().find((turn) => turn.agentId !== agentId);
  const roleHint = participants.length > 1 && participants[0] === agentId ? "You open or defend a concrete proposal, implementation path, or thesis." : "You stress-test, refine, challenge assumptions, and converge toward a better shared answer.";
  return [
    "You are participating in an Orbit multi-agent collaboration round.",
    `Your agent id: ${agentId}. Round ${round} of ${totalRounds}.`,
    roleHint,
    "",
    "TOPIC / USER REQUEST:",
    topic,
    "",
    lastPeer ? "MOST RECENT PEER TURN TO ANSWER DIRECTLY:\n" + lastPeer.text : "There is no peer turn yet. Start with a concrete position and useful framing.",
    "",
    "SHARED TRANSCRIPT:",
    compactCollabTranscript(topic, transcript || []),
    "",
    "RESPONSE RULES:",
    "- Respond to specific points from the peer transcript instead of writing an isolated essay.",
    "- Add new evidence, constraints, implementation detail, or a sharper objection.",
    "- Move toward convergence: state what you agree with, what you dispute, and what should happen next.",
    "- Be concise but substantive. Avoid generic praise and repeated summaries."
  ].join("\n");
}
function collabSynthesisPrompt(topic, transcript) {
  return [
    "You are Orbit, the lead Agent synthesizing a multi-agent collaboration transcript.",
    "Read the full shared record below and produce one final answer in the user's language.",
    "Do not claim that files were edited or commands were run unless the transcript proves it.",
    "",
    "USER REQUEST:",
    topic,
    "",
    "COLLABORATION TRANSCRIPT:",
    compactCollabTranscript(topic, transcript || []),
    "",
    "FINAL ANSWER REQUIREMENTS:",
    "- Name the strongest useful points from each agent.",
    "- Resolve disagreements into a clear recommendation or conclusion.",
    "- If this was a debate, state which side was more convincing and why.",
    "- Include concrete next steps, risks, or acceptance checks when relevant."
  ].join("\n");
}
function verifyPrompt(title, detail, result) {
  return [
    "You are a strict reviewer. Decide whether the RESULT adequately accomplishes the SUBTASK.",
    "If RESULT contains an 'Orbit 自动交付检测' section with an existing file path and local preview URL, treat that as valid artifact evidence for web/HTML/visual deliverables.",
    "If RESULT contains an 'Orbit 执行事实' section with scoped files, file previews, or activity evidence, review those facts; do not fail solely because the worker final text was empty.",
    'Reply with ONLY one line: "PASS" if it does, or "FAIL: <short reason>" if it does not.',
    "",
    "SUBTASK: " + title + (detail ? " — " + detail : ""),
    "",
    "RESULT:",
    result || "(empty)"
  ].join("\n");
}
function parseVerdict(raw) {
  const s = (raw || "").trim();
  if (/^\s*PASS\b/i.test(s)) return { pass: true };
  const fm = s.match(/FAIL\s*[:：]?\s*(.{0,200})/i);
  if (fm) return { pass: false, note: (fm[1] || "").trim() || void 0 };
  return { pass: true };
}
function buildReactorStateSummary(input = {}) {
  const waves = Array.isArray(input.waves) && input.waves.length ? input.waves.slice(-5).map((wave) => {
    const items = (wave.results || []).map((r) => `${r.id || r.title}${r.agentId ? "[" + r.agentId + "]" : ""}:${r.error ? "failed" : "done"}`).join(", ");
    return `- Wave ${wave.round}: ${items || "no results"}${wave.note ? " | " + contextLine(wave.note, 180) : ""}`;
  }).join("\n") : "- No completed execution wave yet.";
  const artifacts = Array.isArray(input.artifacts) && input.artifacts.length ? input.artifacts.slice(-8).map((item) => {
    const links = Array.isArray(item.links) && item.links.length ? " | " + item.links.slice(0, 3).join(" ") : "";
    return `- ${item.contractId || item.title}${item.agentId ? " [" + item.agentId + "]" : ""}: ${item.status || "observed"}${links}`;
  }).join("\n") : "- No concrete artifact registered yet.";
  return [
    `Pattern: Orbit Reactor Plan-Solve loop`,
    `Round: ${input.round || 0}`,
    `Finished: ${input.finishedCount || 0}; Failed: ${input.failedCount || 0}; Remaining: ${input.remainingCount || 0}`,
    "",
    "Recent waves:",
    waves,
    "",
    "Artifact registry:",
    artifacts
  ].join("\n");
}
function reactorReplanPrompt(userText, artifact, stateSummary) {
  const contracts = artifact.taskDag.nodes.map((node) => {
    return `- ${node.id} [${node.agentId || "unassigned"}] ${node.status || "planned"}: ${node.title}; dependsOn=${(node.dependsOn || []).join(",") || "none"}; doneWhen=${contextLine(node.doneWhen, 180)}`;
  }).join("\n");
  return [
    "You are Orbit's Plan-Solve controller. You are observing a multi-agent execution wave and may adjust the plan.",
    "Use a Reactor style loop: Plan -> Execute -> Observe -> Replan -> Solve. Do not create ceremonial summary tasks; Orbit synthesizes final delivery itself.",
    "Return ONLY a JSON object, no markdown, with this shape:",
    '{"status":"continue|done","summary":"short observation","addContracts":[{"id":"repair-1","title":"short","detail":"concrete work","agent":"codex or claude","fileScope":["path/**"],"dependsOn":[],"doneWhen":"observable acceptance","verifyCommand":"","interfaceRef":"shared contract"}],"reviseContracts":[{"id":"existing-id","detail":"optional replacement detail","doneWhen":"optional","agent":"optional"}]}',
    "Rules:",
    "- Add at most 2 contracts. Add only if it improves quality, rescues failure, merges parallel output, or fills a concrete missing artifact.",
    "- If all user-visible deliverables are already produced and verified enough, status may be done and addContracts must be empty.",
    "- If a worker failed because of quota, sandbox, timeout, or missing context, add a takeover/repair contract for another available worker instead of blocking.",
    "- Keep new contracts in the same shared Definition of Done. Prefer same-wave parallel contracts unless a real artifact dependency exists.",
    "- Do not ask the user for clarification unless the task is impossible without it.",
    "",
    "USER GOAL:",
    userText,
    "",
    "CURRENT CONTRACT GRAPH:",
    contracts,
    "",
    "OBSERVED REACTOR STATE:",
    stateSummary
  ].join("\n");
}
function parseReactorDecision(raw) {
  const obj = extractJsonObject(raw);
  if (!obj || typeof obj !== "object") return { status: "continue", summary: "No structured replan decision.", addContracts: [], reviseContracts: [] };
  return {
    status: String(obj.status || "continue").toLowerCase() === "done" ? "done" : "continue",
    summary: stringValue(obj.summary) || stringValue(obj.observation) || "",
    addContracts: Array.isArray(obj.addContracts) ? obj.addContracts.slice(0, 2) : [],
    reviseContracts: Array.isArray(obj.reviseContracts) ? obj.reviseContracts.slice(0, 4) : []
  };
}
function retryPrompt(detail, note) {
  return [
    "A previous attempt at this subtask was judged inadequate" + (note ? ": " + note : "") + ".",
    "Redo it, fixing that problem.",
    "",
    detail
  ].join("\n");
}
const BOOTSTRAP_CONTEXT_MAX_CHARS = 16e3;
const STORAGE_KEY$3 = "workspaces.v1";
class WorkspaceNotFoundError extends Error {
  code = "WORKSPACE_NOT_FOUND";
  constructor(id) {
    super(`Workspace not found: ${id}`);
    this.name = "WorkspaceNotFoundError";
  }
}
class WorkspacePathInvalidError extends Error {
  code = "WORKSPACE_PATH_INVALID";
  constructor(rootPath, reason) {
    super(`Invalid workspace path "${rootPath}": ${reason}`);
    this.name = "WorkspacePathInvalidError";
  }
}
function load() {
  try {
    const raw = appStore.get(STORAGE_KEY$3);
    if (raw && typeof raw === "object" && Array.isArray(raw.workspaces)) {
      return {
        version: 1,
        workspaces: raw.workspaces.filter((w) => w && typeof w.id === "string" && typeof w.rootPath === "string"),
        activeId: typeof raw.activeId === "string" ? raw.activeId : null
      };
    }
  } catch {
  }
  return { version: 1, workspaces: [], activeId: null };
}
function validateRootPath(rawPath) {
  if (!rawPath || typeof rawPath !== "string") throw new WorkspacePathInvalidError(String(rawPath), "路径为空");
  const abs = path.resolve(rawPath);
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    throw new WorkspacePathInvalidError(abs, "路径不存在或不可访问");
  }
  if (!st.isDirectory()) throw new WorkspacePathInvalidError(abs, "不是目录");
  return abs;
}
class WorkspaceManager {
  // 懒加载：模块 import 时不读 store；首次访问才读。
  // 避免 `import getWorkspaceManager` 触发 `store.init()` 早于 `app.whenReady`。
  _state = null;
  get state() {
    if (!this._state) this._state = load();
    return this._state;
  }
  save() {
    try {
      appStore.set(STORAGE_KEY$3, this._state);
    } catch (e) {
      console.warn("[WorkspaceManager] save failed:", e);
    }
  }
  list() {
    return [...this.state.workspaces].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  getById(id) {
    return this.state.workspaces.find((w) => w.id === id);
  }
  create(input) {
    const name = (input.name || "").trim();
    if (!name) throw new Error("工作区名称不能为空");
    const rootPath = validateRootPath(input.rootPath);
    const now = Date.now();
    const ws = { id: "ws-" + now.toString(36) + "-" + Math.random().toString(36).slice(2, 6), name, rootPath, bootstrapFiles: [], createdAt: now, updatedAt: now };
    this.state.workspaces.push(ws);
    if (!this.state.activeId) this.state.activeId = ws.id;
    this.save();
    return ws;
  }
  update(id, patch) {
    const ws = this.state.workspaces.find((w) => w.id === id);
    if (!ws) throw new WorkspaceNotFoundError(id);
    if (patch.name !== void 0) {
      const n = (patch.name || "").trim();
      if (!n) throw new Error("工作区名称不能为空");
      ws.name = n;
    }
    if (patch.rootPath !== void 0) ws.rootPath = validateRootPath(patch.rootPath);
    if (patch.bootstrapFiles !== void 0) ws.bootstrapFiles = patch.bootstrapFiles;
    ws.updatedAt = Date.now();
    this.save();
    return ws;
  }
  remove(id) {
    const before = this.state.workspaces.length;
    this.state.workspaces = this.state.workspaces.filter((w) => w.id !== id);
    if (before === this.state.workspaces.length) return false;
    if (this.state.activeId === id) {
      this.state.activeId = this.state.workspaces.length > 0 ? this.state.workspaces[0].id : null;
    }
    this.save();
    return true;
  }
  /**
   * 读取工作区的 bootstrapFiles，拼成可注入 prompt 的「项目上下文」块。
   * - 路径限定在 rootPath 内（拒绝绝对路径 / `..` 逃逸），逐个 readFileSync(utf-8)；
   * - 总字符超 maxChars 即停止并标注省略数；缺失/不可读的文件跳过并标注。
   * - 无工作区 / 无 bootstrapFiles / 全部读取失败 → 返回空串（不注入，零回归）。
   */
  bootstrapContext(id, maxChars = BOOTSTRAP_CONTEXT_MAX_CHARS) {
    if (!id) return "";
    const ws = this.getById(id);
    if (!ws || !Array.isArray(ws.bootstrapFiles) || ws.bootstrapFiles.length === 0) return "";
    const root = path.resolve(ws.rootPath);
    const blocks = [];
    let used = 0;
    let omitted = 0;
    for (const rel of ws.bootstrapFiles) {
      if (typeof rel !== "string" || !rel.trim()) continue;
      if (path.isAbsolute(rel)) {
        omitted++;
        continue;
      }
      const abs = path.resolve(path.join(root, rel));
      const within = abs === root || abs.startsWith(root + (process.platform === "win32" ? "\\" : "/"));
      if (!within) {
        omitted++;
        continue;
      }
      let text;
      try {
        text = fs.readFileSync(abs, "utf-8");
      } catch {
        omitted++;
        continue;
      }
      const relLabel = path.relative(root, abs).replace(/\\/g, "/");
      const body = `## ${relLabel}
${text.trim()}`;
      if (used + body.length > maxChars && blocks.length > 0) {
        omitted++;
        continue;
      }
      blocks.push(body);
      used += body.length;
    }
    if (blocks.length === 0) return "";
    if (omitted > 0) blocks.push(`(${omitted} more bootstrap file(s) omitted: missing, out-of-root, or over length limit.)`);
    return [
      "# Project context (workspace bootstrap files)",
      "These files come from the active workspace. Follow their conventions and instructions.",
      "",
      blocks.join("\n\n")
    ].join("\n").trim();
  }
  getActive() {
    return this.state.activeId;
  }
  setActive(id) {
    if (id !== null && !this.state.workspaces.find((w) => w.id === id)) throw new WorkspaceNotFoundError(id);
    this.state.activeId = id;
    this.save();
  }
}
let _instance$1 = null;
function getWorkspaceManager() {
  if (!_instance$1) _instance$1 = new WorkspaceManager();
  return _instance$1;
}
function safeDecodeUriPart(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return "";
  }
}
function isPathInside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}
function workspaceForPreview(workspaceId) {
  try {
    const manager = getWorkspaceManager();
    const id = workspaceId && workspaceId !== "local" ? workspaceId : manager.getActive();
    const ws = id ? manager.getById(id) : null;
    if (!ws || !ws.rootPath) return null;
    const root = path.resolve(ws.rootPath);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null;
    return { id: ws.id, root };
  } catch {
    return null;
  }
}
function safeMissionFileName(value) {
  const text = String(value || "mission").trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (text || "mission").slice(0, 96);
}
function missionSharedContextTarget(workspaceId, missionId) {
  const safe = safeMissionFileName(missionId);
  const ws = workspaceForPreview(workspaceId);
  if (ws) {
    const relPath = path.join(".orbit", "missions", safe, "shared-context.md");
    return {
      workspaceId: ws.id,
      root: ws.root,
      relPath,
      absPath: path.join(ws.root, relPath),
      location: "workspace"
    };
  }
  try {
    const userDataRoot = electron.app?.getPath?.("userData");
    if (userDataRoot) {
      const relPath = path.join("missions", safe, "shared-context.md");
      return {
        workspaceId: workspaceId || "local",
        root: userDataRoot,
        relPath,
        absPath: path.join(userDataRoot, relPath),
        location: "userData"
      };
    }
  } catch {
  }
  return null;
}
function ledgerStatus(node) {
  return normalizeStatus(node?.status || "planned");
}
function ledgerContractLine(node) {
  const bits = [
    `agent=${node.agentId || "unassigned"}`,
    `status=${ledgerStatus(node)}`,
    node.dependsOn?.length ? `deps=${node.dependsOn.join(",")}` : "",
    node.fileScope?.length ? `scope=${node.fileScope.slice(0, 5).join(",")}` : "",
    node.verifyCommand ? `verify=${node.verifyCommand}` : ""
  ].filter(Boolean);
  return `- ${node.id}. ${node.title || "Untitled contract"} (${bits.join("; ")})`;
}
function writeMissionSharedContextLedger(input) {
  const target = missionSharedContextTarget(input.workspaceId, input.missionId);
  if (!target) return null;
  const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const nodes = input.artifact?.taskDag?.nodes || [];
  const previousWork = Array.isArray(input.previousWork) ? input.previousWork : [];
  const artifacts = Array.isArray(input.artifacts) ? input.artifacts : [];
  const waves = Array.isArray(input.waves) ? input.waves : [];
  const handoffs = nodes.map((node) => node.__handoffCapsule ? `- ${node.id}: ${contextLine(node.__handoffCapsule, 700)}` : "").filter(Boolean);
  const lines = [
    "# Orbit Mission Shared Context",
    "",
    `Mission: ${input.missionId || "unknown"}`,
    `Workspace: ${target.workspaceId || input.workspaceId || "local"}`,
    `Location: ${target.location}`,
    `Updated: ${updatedAt}`,
    `Phase: ${input.phase || "running"}`,
    "",
    "## Purpose",
    "This file is Orbit's local shared workspace channel for the mission. It mirrors the OpenAgents idea of one workspace where agents read the same history, files, browser state and task contracts.",
    "Workers must read this before changing files, stay inside their assigned contract, and report new facts in HANDOFF CAPSULE so Orbit can refresh the ledger.",
    "",
    "## Mission Goal",
    contextLine(input.goal || "", 1200) || "-",
    "",
    "## Shared Definition Of Done",
    unifiedAcceptanceForGoal(input.goal || ""),
    "",
    "## Task DAG",
    nodes.length ? nodes.map(ledgerContractLine).join("\n") : "- No contracts declared.",
    "",
    "## Contract Details",
    nodes.length ? nodes.map((node) => [
      `### ${node.id}. ${node.title || "Untitled contract"}`,
      `- Agent: ${node.agentId || "unassigned"}`,
      `- Status: ${ledgerStatus(node)}`,
      node.detail ? `- Detail: ${contextLine(node.detail, 900)}` : "",
      node.doneWhen ? `- Done when: ${contextLine(node.doneWhen, 500)}` : "",
      node.interfaceRef ? `- Interface/shared contract: ${contextLine(node.interfaceRef, 600)}` : "",
      node.verifyCommand ? `- Verify command: ${node.verifyCommand}` : "",
      node.fileScope?.length ? `- File scope: ${node.fileScope.join(", ")}` : ""
    ].filter(Boolean).join("\n")).join("\n\n") : "-",
    "",
    "## Previous Worker Results",
    previousWork.length ? previousWork.map((item) => {
      const body = item.error ? `FAILED: ${item.error}\n${item.summary || ""}` : item.summary || "";
      return `### ${item.id}${item.agentId ? " [" + item.agentId + "]" : ""}\n${contextLine(body, 1200) || "-"}`;
    }).join("\n\n") : "- No worker result has been recorded yet.",
    "",
    "## Artifact Registry",
    artifacts.length ? artifacts.map((item) => {
      const links = Array.isArray(item.links) && item.links.length ? item.links.join(" | ") : "none";
      return `- ${item.contractId || "unknown"} [${item.agentId || "unknown"}] ${item.status || "unknown"}: ${links}${item.error ? " | error=" + contextLine(item.error, 200) : ""}`;
    }).join("\n") : "- No artifacts detected yet.",
    "",
    "## Reactor Waves",
    waves.length ? waves.slice(-8).map((wave) => {
      const results = (wave.results || []).map((r) => `${r.id || r.title}:${r.status || (r.error ? "failed" : "done")}${r.error ? "(" + contextLine(r.error, 120) + ")" : ""}`).join(", ");
      return `- Wave ${wave.round}: ${results || "no results"}${wave.note ? " | " + contextLine(wave.note, 180) : ""}`;
    }).join("\n") : "- No completed wave yet.",
    "",
    "## Handoff Capsules",
    handoffs.length ? handoffs.join("\n") : "- No active handoff capsule.",
    "",
    "## Recent Mission Timeline",
    contextLine(input.timeline || "", 3600) || "- No recorded channel events yet."
  ];
  try {
    fs.mkdirSync(path.dirname(target.absPath), { recursive: true });
    const tmp = target.absPath + ".tmp";
    fs.writeFileSync(tmp, lines.join("\n") + "\n", "utf-8");
    fs.renameSync(tmp, target.absPath);
    return {
      path: target.location === "workspace" ? target.relPath : target.absPath,
      absolutePath: target.absPath,
      relPath: target.relPath,
      workspaceId: target.workspaceId,
      location: target.location,
      updatedAt
    };
  } catch (error) {
    return {
      path: target.absPath,
      absolutePath: target.absPath,
      relPath: target.relPath,
      workspaceId: target.workspaceId,
      location: target.location,
      updatedAt,
      error: error?.message || String(error)
    };
  }
}
function previewMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html" || ext === ".htm") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}
function previewUrlFor(workspaceId, relPath, port = 9527) {
  const ws = workspaceForPreview(workspaceId);
  if (!ws) return "";
  const cleaned = String(relPath || "index.html").replace(/^[/\\]+/, "");
  return `http://127.0.0.1:${port}/preview/${encodeURIComponent(ws.id)}/${cleaned.split(/[\\/]+/).map(encodeURIComponent).join("/")}`;
}
function serveWorkspacePreview(u, res) {
  const parts = u.pathname.split("/").filter(Boolean);
  const workspaceId = safeDecodeUriPart(parts[1] || u.searchParams.get("workspaceId") || u.searchParams.get("ws") || "");
  const ws = workspaceForPreview(workspaceId);
  if (!ws) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("Workspace not found for preview.");
    return;
  }
  let rel = parts.slice(2).map(safeDecodeUriPart).join("/");
  if (!rel) rel = u.searchParams.get("file") || "index.html";
  rel = String(rel || "index.html").replace(/^[/\\]+/, "");
  let target = path.resolve(ws.root, rel);
  if (!isPathInside(ws.root, target)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("Preview path escapes workspace.");
    return;
  }
  try {
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end("Preview file not found.");
      return;
    }
    res.writeHead(200, { "content-type": previewMime(target), "cache-control": "no-store" });
    fs.createReadStream(target).pipe(res);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(e?.message || String(e));
  }
}
function webArtifactRequested(...texts) {
  return /(网站|网页|页面|个人网站|作品集|portfolio|site|html|canvas|动画|visual|frontend|ui|preview|预览)/i.test(texts.filter(Boolean).join("\n"));
}
function extractPreviewMentions(text) {
  const out = [];
  const re = /(?:^|[\s'"`([{：:])([A-Za-z0-9_.\-\/\\\u4e00-\u9fa5]+\.html?)\b/gi;
  let match;
  while ((match = re.exec(String(text || "")))) {
    const rel = (match[1] || "").replace(/\\/g, "/").replace(/^[/]+/, "");
    if (rel && !rel.includes("..") && rel.length < 240) out.push(rel);
  }
  return out;
}
function findPreviewCandidates(workspaceId, ...texts) {
  const ws = workspaceForPreview(workspaceId);
  if (!ws) return [];
  const seen = /* @__PURE__ */ new Set();
  const mentioned = texts.flatMap(extractPreviewMentions);
  const candidates = [
    ...mentioned,
    "index.html",
    "dist/index.html",
    "public/index.html",
    "build/index.html",
    "out/index.html",
    "dashboard/dist/index.html"
  ];
  const found = [];
  for (const relRaw of candidates) {
    const rel = String(relRaw || "").replace(/^[/\\]+/, "");
    if (!rel || seen.has(rel) || rel.includes("..")) continue;
    seen.add(rel);
    const abs = path.resolve(ws.root, rel);
    if (!isPathInside(ws.root, abs)) continue;
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        found.push({ workspaceId: ws.id, root: ws.root, rel, abs, url: previewUrlFor(ws.id, rel) });
      }
    } catch {
    }
  }
  return found;
}
function buildDeliveryEvidence(workspaceId, goal, contract, content) {
  if (!webArtifactRequested(goal, contract?.title, contract?.detail, content)) return { block: "", previews: [] };
  const previews = findPreviewCandidates(workspaceId, goal, contract?.title, contract?.detail, content);
  if (previews.length === 0) return { block: "", previews: [] };
  const lines = [
    "## Orbit 自动交付检测",
    "Orbit 在工作区检测到可预览的网页产物，并已由 Hub 提供本地 HTTP 预览服务：",
    ...previews.slice(0, 3).flatMap((item, index) => [
      `${index + 1}. 本地预览: ${item.url}`,
      `   文件路径: ${item.abs}`,
      `   工作区相对路径: ${item.rel}`
    ]),
    "请把本地预览链接作为交付物的一部分；不要只给 file:// 或启动命令。"
  ];
  return { block: lines.join("\n"), previews };
}
function appendDeliveryEvidence(content, evidence) {
  if (!evidence?.block) return content || "";
  const base = String(content || "").trim();
  return [base, evidence.block].filter(Boolean).join("\n\n");
}
const WORKER_EVIDENCE_TEXT_EXTS = /* @__PURE__ */ new Set([
  ".md",
  ".markdown",
  ".txt",
  ".json",
  ".jsonl",
  ".yml",
  ".yaml",
  ".toml",
  ".csv",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".sh",
  ".sql",
  ".xml"
]);
function cleanWorkerEvidenceRel(value) {
  const rel = String(value || "").replace(/\\/g, "/").replace(/^[/]+/, "").trim();
  if (!rel || rel.includes("..") || path.isAbsolute(rel)) return "";
  return rel;
}
function readWorkerEvidencePreview(abs) {
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return "";
    const ext = path.extname(abs).toLowerCase();
    if (stat.size > 512 * 1024 || ext && !WORKER_EVIDENCE_TEXT_EXTS.has(ext)) return "";
    return fs.readFileSync(abs, "utf-8").replace(/\r\n/g, "\n").slice(0, 1600).trim();
  } catch {
    return "";
  }
}
function addWorkerEvidenceFile(ws, relRaw, out, seen, limit) {
  if (out.length >= limit) return;
  const rel = cleanWorkerEvidenceRel(relRaw);
  if (!rel || seen.has(rel)) return;
  const abs = path.resolve(ws.root, rel);
  if (!isPathInside(ws.root, abs)) return;
  try {
    if (!fs.existsSync(abs)) return;
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return;
    seen.add(rel);
    out.push({
      rel,
      abs,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      url: previewUrlFor(ws.id, rel),
      preview: readWorkerEvidencePreview(abs)
    });
  } catch {
  }
}
function collectWorkerEvidenceFiles(ws, relDirRaw, out, seen, limit, depth = 0) {
  if (out.length >= limit || depth > 3) return;
  const relDir = cleanWorkerEvidenceRel(relDirRaw || ".");
  const absDir = path.resolve(ws.root, relDir || ".");
  if (!isPathInside(ws.root, absDir)) return;
  try {
    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) return;
    const entries = fs.readdirSync(absDir, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("."))
      .sort((a, b) => Number(b.isFile()) - Number(a.isFile()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= limit) break;
      const childRel = cleanWorkerEvidenceRel(path.posix.join(relDir === "." ? "" : relDir, entry.name));
      if (!childRel) continue;
      if (entry.isFile()) addWorkerEvidenceFile(ws, childRel, out, seen, limit);
      else if (entry.isDirectory()) collectWorkerEvidenceFiles(ws, childRel, out, seen, limit, depth + 1);
    }
  } catch {
  }
}
function workerEvidenceScopePrefix(scope) {
  const rel = cleanWorkerEvidenceRel(scope);
  if (!rel) return "";
  const wildcardIndex = rel.search(/[*?\[\]{}]/);
  if (wildcardIndex >= 0) return rel.slice(0, wildcardIndex).replace(/[^/]*$/, "");
  return rel;
}
function findWorkerEvidenceFiles(workspaceId, contract, limit = 8) {
  const ws = workspaceForPreview(workspaceId);
  if (!ws) return [];
  const scopes = Array.isArray(contract?.fileScope) ? contract.fileScope : [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const scope of scopes) {
    if (out.length >= limit) break;
    const rel = cleanWorkerEvidenceRel(scope);
    if (!rel) continue;
    const prefix = workerEvidenceScopePrefix(rel);
    const directAbs = path.resolve(ws.root, rel);
    try {
      if (!rel.match(/[*?\[\]{}]/) && isPathInside(ws.root, directAbs) && fs.existsSync(directAbs)) {
        if (fs.statSync(directAbs).isFile()) addWorkerEvidenceFile(ws, rel, out, seen, limit);
        else collectWorkerEvidenceFiles(ws, rel, out, seen, limit);
        continue;
      }
    } catch {
    }
    if (prefix) collectWorkerEvidenceFiles(ws, prefix, out, seen, limit);
  }
  return out;
}
function buildWorkerEvidence(workspaceId, contract, content, streamedContent, activityLog) {
  const finalText = String(content || "").trim();
  const streamedText = String(streamedContent || "").trim();
  const files = findWorkerEvidenceFiles(workspaceId, contract);
  const activity = Array.isArray(activityLog) ? activityLog.slice(-12).map((item) => contextLine(item, 260)).filter(Boolean) : [];
  if (finalText && files.length === 0 && activity.length === 0) {
    return { block: "", files, activityCount: 0, hasFinalText: true };
  }
  if (!finalText && !streamedText && files.length === 0 && activity.length === 0) {
    return { block: "", files, activityCount: 0, hasFinalText: false };
  }
  const lines = [
    "## Orbit 执行事实",
    finalText ? "- Worker final text was captured." : "- Worker final text was empty; Orbit captured workspace/activity evidence for verification.",
    streamedText && !finalText ? `- Stream tail: ${contextLine(streamedText, 500)}` : ""
  ].filter(Boolean);
  if (files.length > 0) {
    lines.push("- Scoped artifacts detected:");
    files.slice(0, 8).forEach((file, index) => {
      lines.push(`  ${index + 1}. ${file.rel} (${file.size} bytes, modified ${new Date(file.mtimeMs).toISOString()})`);
      lines.push(`     absolute: ${file.abs}`);
      if (file.url) lines.push(`     local preview: ${file.url}`);
      if (file.preview) lines.push(`     preview:\n${file.preview.split("\n").slice(0, 24).map((line) => `       ${line}`).join("\n")}`);
    });
  }
  if (activity.length > 0) {
    lines.push("- Activity tail:");
    for (const item of activity) lines.push(`  - ${item}`);
  }
  return { block: lines.join("\n"), files, activityCount: activity.length, hasFinalText: !!finalText };
}
function appendWorkerEvidence(content, evidence) {
  if (!evidence?.block) return content || "";
  const base = String(content || "").trim();
  return [base, evidence.block].filter(Boolean).join("\n\n");
}
class Supervisor {
  constructor(thresholds = { stallAfterMs: 9e4 }) {
    this.thresholds = thresholds;
  }
  async assess(signal, llmJudge) {
    const rule = this.assessByRules(signal);
    if (!needsLlm(signal, rule) || !llmJudge) return rule;
    try {
      const raw = await llmJudge(supervisorPrompt(signal, rule));
      const parsed = parseSupervisorDecision(raw || "");
      return parsed || rule;
    } catch {
      return rule;
    }
  }
  assessByRules(signal) {
    if (signal.kind === "dependency_wait") {
      return {
        state: "waiting",
        action: "wait",
        reason: "Task is waiting for upstream contracts to finish.",
        source: "rule",
        confidence: 0.95
      };
    }
    if (signal.kind === "verification_failed") {
      return {
        state: "needs-rework",
        action: "retry",
        reason: signal.verifierNote || "Verification failed; ask the same worker to repair within the contract.",
        source: "rule",
        confidence: 0.86
      };
    }
    if (signal.kind === "worker_error") {
      const text = (signal.error || "").toLowerCase();
      const stallLike = /timeout|timed out|无任何输出|卡死|stalled|idle|no output/.test(text);
      const approvalLike = /approval|requires approval|not granted|permission|denied|sandbox|operation not permitted|eacces|eperm|需要批准|未授权|审批|权限/.test(text);
      return {
        state: stallLike || approvalLike ? "stalled" : "failed",
        action: stallLike || approvalLike ? "handoff" : "fail",
        reason: signal.error || "Worker returned an error.",
        source: "rule",
        confidence: stallLike || approvalLike ? 0.72 : 0.78
      };
    }
    if (signal.kind === "stall" || signal.idleMs && signal.idleMs > this.thresholds.stallAfterMs) {
      return {
        state: "stalled",
        action: "handoff",
        reason: `No meaningful progress for ${Math.round((signal.idleMs || this.thresholds.stallAfterMs) / 1e3)}s.`,
        source: "rule",
        confidence: 0.55
      };
    }
    return {
      state: "healthy",
      action: "continue",
      reason: "No intervention needed.",
      source: "rule",
      confidence: 0.9
    };
  }
}
function supervisorPrompt(signal, rule) {
  return [
    "You are the lightweight Supervisor for a multi-agent coding mission.",
    "Decide whether the worker is truly stuck, waiting for teammates, or needs rework.",
    "Rules already produced this provisional decision:",
    JSON.stringify(rule),
    "",
    "Mission signal:",
    JSON.stringify({
      missionId: signal.missionId,
      kind: signal.kind,
      contract: signal.contract,
      elapsedMs: signal.elapsedMs,
      idleMs: signal.idleMs,
      error: signal.error,
      verifierNote: signal.verifierNote,
      dependencyStatuses: signal.dependencyStatuses,
      outputPreview: signal.outputPreview
    }, null, 2),
    "",
    "Reply with ONLY JSON:",
    '{"state":"healthy|waiting|stalled|needs-rework|failed","action":"continue|wait|retry|handoff|fail","reason":"short reason","confidence":0.0}'
  ].join("\n");
}
function parseSupervisorDecision(raw) {
  if (!raw) return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    if (!["healthy", "waiting", "stalled", "needs-rework", "failed"].includes(obj.state)) return null;
    if (!["continue", "wait", "retry", "handoff", "fail"].includes(obj.action)) return null;
    return {
      state: obj.state,
      action: obj.action,
      reason: typeof obj.reason === "string" ? obj.reason : "Supervisor decision",
      source: "llm",
      confidence: typeof obj.confidence === "number" ? Math.max(0, Math.min(1, obj.confidence)) : 0.5,
      suggestedAgentId: typeof obj.suggestedAgentId === "string" ? obj.suggestedAgentId : void 0
    };
  } catch {
    return null;
  }
}
function needsLlm(signal, rule) {
  if (signal.kind === "stall") return true;
  if (rule.state === "stalled" && rule.confidence < 0.7) return true;
  if (signal.kind === "worker_error" && rule.action === "handoff") return true;
  return false;
}
const COLON_PREFIXES = ["agent:", "openagents:", "human:"];
const SLASH_PREFIXES = ["channel/", "mod/", "group/", "resource/"];
const CollaborationEventTypes = {
  MissionStarted: "mission.started",
  MissionPlanProposed: "mission.plan.proposed",
  MissionPlanRevised: "mission.plan.revised",
  MissionPlanApprovalRequested: "mission.plan.approval_requested",
  MissionPlanApproved: "mission.plan.approved",
  MissionPlanRejected: "mission.plan.rejected",
  MissionStatusChanged: "mission.status.changed",
  ContractCreated: "mission.contract.created",
  ContractClaimed: "mission.contract.claimed",
  ContractStatusChanged: "mission.contract.status_changed",
  ContractCompleted: "mission.contract.completed",
  ContractFailed: "mission.contract.failed",
  VerificationResult: "mission.contract.verification_result",
  SupervisorDecision: "mission.supervisor.decision",
  SynthesisStarted: "mission.synthesis.started",
  SynthesisCompleted: "mission.synthesis.completed",
  OutcomeRecorded: "mission.outcome.recorded",
  MemoryUpdated: "memory.updated",
  UserNotificationRequested: "user.notification.requested"
};
function parseCollaborationAddress(raw) {
  if (!raw || !raw.trim()) throw new Error("Address cannot be empty");
  const scoped = raw.includes("::");
  const [network, entity] = scoped ? splitNetwork(raw) : ["local", raw];
  if (!network) throw new Error(`Invalid address: empty network in '${raw}'`);
  if (entity === "core") return decorateAddress({ raw, network, entityType: "core", name: "" });
  for (const prefix of SLASH_PREFIXES) {
    if (entity.startsWith(prefix)) {
      return decorateAddress({
        raw,
        network,
        entityType: prefix.slice(0, -1),
        name: entity.slice(prefix.length)
      });
    }
  }
  for (const prefix of COLON_PREFIXES) {
    if (entity.startsWith(prefix)) {
      return decorateAddress({
        raw,
        network,
        entityType: prefix.slice(0, -1),
        name: entity.slice(prefix.length)
      });
    }
  }
  return decorateAddress({ raw, network, entityType: "agent", name: entity });
}
function agentAddress(name, globalAgent = false) {
  return `${globalAgent ? "openagents" : "agent"}:${name}`;
}
function humanAddress(identifier) {
  return `human:${identifier}`;
}
function channelAddress(name) {
  return `channel/${name}`;
}
function createCollaborationEvent(input) {
  validateEventInput(input);
  return {
    id: input.id || node_crypto.randomUUID(),
    type: input.type,
    source: input.source,
    target: input.target,
    payload: input.payload,
    metadata: input.metadata || {},
    timestamp: input.timestamp || Date.now(),
    network: input.network || "local",
    visibility: input.visibility || "channel",
    missionId: input.missionId,
    channel: input.channel
  };
}
function splitNetwork(raw) {
  const idx = raw.indexOf("::");
  return [raw.slice(0, idx), raw.slice(idx + 2)];
}
function decorateAddress(input) {
  return {
    ...input,
    isLocal: input.network === "local",
    isBroadcast: input.entityType === "agent" && input.name === "broadcast",
    isCore: input.entityType === "core",
    isChannel: input.entityType === "channel",
    isAgent: input.entityType === "agent" || input.entityType === "openagents",
    isHuman: input.entityType === "human",
    isResource: input.entityType === "resource"
  };
}
function validateEventInput(input) {
  if (!input.type || !input.type.trim()) throw new Error("Event type cannot be empty");
  parseCollaborationAddress(input.source);
  parseCollaborationAddress(input.target);
}
const STORAGE_KEY$2 = "skills.v1";
function emptyState() {
  return { version: 1, skills: [], installs: {} };
}
let counter = 0;
function genId() {
  counter += 1;
  return "skill-" + Date.now().toString(36) + "-" + counter.toString(36);
}
function clampStr(v, max) {
  return typeof v === "string" ? v.slice(0, max) : "";
}
class SkillManager {
  read() {
    const raw = appStore.get(STORAGE_KEY$2);
    if (!raw || typeof raw !== "object") return emptyState();
    const skills = Array.isArray(raw.skills) ? raw.skills.filter((s) => s && typeof s.id === "string") : [];
    const installs = raw.installs && typeof raw.installs === "object" ? raw.installs : {};
    return { version: 1, skills, installs };
  }
  write(s) {
    appStore.set(STORAGE_KEY$2, s);
  }
  list() {
    return this.read().skills;
  }
  get(id) {
    return this.read().skills.find((s) => s.id === id);
  }
  add(input) {
    const s = this.read();
    const now = Date.now();
    const skill = {
      id: genId(),
      name: clampStr(input.name, 120).trim() || "Untitled skill",
      description: clampStr(input.description, 400).trim(),
      instructions: clampStr(input.instructions, 4e4),
      tags: Array.isArray(input.tags) ? input.tags.map((t) => clampStr(t, 40)).filter(Boolean).slice(0, 12) : [],
      source: clampStr(input.source, 400) || "paste",
      createdAt: now,
      updatedAt: now
    };
    s.skills.push(skill);
    this.write(s);
    return skill;
  }
  update(id, patch) {
    const s = this.read();
    const skill = s.skills.find((x) => x.id === id);
    if (!skill) return void 0;
    if (patch.name !== void 0) skill.name = clampStr(patch.name, 120).trim() || skill.name;
    if (patch.description !== void 0) skill.description = clampStr(patch.description, 400).trim();
    if (patch.instructions !== void 0) skill.instructions = clampStr(patch.instructions, 4e4);
    if (patch.tags !== void 0) skill.tags = patch.tags.map((t) => clampStr(t, 40)).filter(Boolean).slice(0, 12);
    if (patch.source !== void 0) skill.source = clampStr(patch.source, 400);
    skill.updatedAt = Date.now();
    this.write(s);
    return skill;
  }
  remove(id) {
    const s = this.read();
    const before = s.skills.length;
    s.skills = s.skills.filter((x) => x.id !== id);
    if (s.skills.length === before) return false;
    for (const agentId of Object.keys(s.installs)) {
      s.installs[agentId] = (s.installs[agentId] || []).filter((sid) => sid !== id);
    }
    this.write(s);
    return true;
  }
  getInstalls() {
    return this.read().installs;
  }
  isInstalled(agentId, skillId) {
    return (this.read().installs[agentId] || []).includes(skillId);
  }
  /** agentId 传 '*' = 对所有 manifest 已知 agent 安装（集体安装）。 */
  install(agentId, skillId) {
    const s = this.read();
    if (!s.skills.some((x) => x.id === skillId)) return s.installs;
    const targets = agentId === "*" ? AGENTS.map((a) => a.id).filter((id) => !DISABLED_AGENT_ID_SET.has(id)) : [agentId].filter((id) => !DISABLED_AGENT_ID_SET.has(id));
    for (const t of targets) {
      const cur = s.installs[t] || [];
      if (!cur.includes(skillId)) cur.push(skillId);
      s.installs[t] = cur;
    }
    this.write(s);
    return s.installs;
  }
  /** agentId 传 '*' = 对所有 agent 卸载（集体卸载）。 */
  uninstall(agentId, skillId) {
    const s = this.read();
    const targets = agentId === "*" ? Object.keys(s.installs) : [agentId];
    for (const t of targets) {
      s.installs[t] = (s.installs[t] || []).filter((sid) => sid !== skillId);
    }
    this.write(s);
    return s.installs;
  }
  /** 目标 agent 已安装的技能（按注册顺序）。 */
  installedFor(agentId) {
    const s = this.read();
    const ids = new Set(s.installs[agentId] || []);
    return s.skills.filter((x) => ids.has(x.id));
  }
}
let instance$2 = null;
function getSkillManager() {
  if (!instance$2) instance$2 = new SkillManager();
  return instance$2;
}
const SKILL_BLOCK_MAX_CHARS = 16e3;
function buildSkillBlock(skills) {
  if (!skills || skills.length === 0) return "";
  const header = [
    "# Installed Skills",
    "You have the following skills installed. Apply the relevant ones to the current task; ignore the rest."
  ];
  const blocks = [];
  let used = 0;
  let omitted = 0;
  for (const s of skills) {
    const body = [
      `## ${s.name}`,
      s.description ? `> ${s.description}` : "",
      s.instructions.trim()
    ].filter(Boolean).join("\n");
    if (used + body.length > SKILL_BLOCK_MAX_CHARS && blocks.length > 0) {
      omitted += 1;
      continue;
    }
    blocks.push(body);
    used += body.length;
  }
  if (omitted > 0) blocks.push(`(${omitted} more skill(s) omitted due to length limit.)`);
  return [...header, "", blocks.join("\n\n")].join("\n").trim();
}
const MAX_READ_CHARS = 64e3;
const MAX_OUTPUT_CHARS = 16e3;
const EXEC_TIMEOUT_MS = 6e4;
const AGENTIC_TOOLS = [
  {
    type: "function",
    function: {
      name: "fs_read",
      description: "Read a UTF-8 text file inside the workspace. Returns file content (truncated if large).",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Path relative to the workspace root." } },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fs_list",
      description: "List entries of a directory inside the workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Directory path relative to workspace root. Empty = root." } }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fs_write",
      description: "Create or overwrite a UTF-8 text file inside the workspace. Parent dirs are created.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to workspace root." },
          content: { type: "string", description: "Full file content to write." }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "exec",
      description: "Run a shell command in the workspace root. Use for builds, tests, git, etc.",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "The shell command line to run." } },
        required: ["command"]
      }
    }
  }
];
function resolveWithin(root, rel) {
  if (rel === void 0 || rel === null) return root;
  if (typeof rel !== "string") return null;
  const trimmed = rel.trim();
  if (!trimmed) return root;
  if (node_path.isAbsolute(trimmed)) return null;
  const abs = node_path.resolve(root, trimmed);
  const r = node_path.relative(root, abs);
  if (r === ".." || r.startsWith(".." + node_path.sep) || r.startsWith("../") || node_path.isAbsolute(r)) return null;
  return abs;
}
function isRealPathWithin(root, target) {
  let rootReal;
  try {
    rootReal = node_fs.realpathSync(root);
  } catch {
    return false;
  }
  let cur = target;
  for (let i = 0; i < 64; i++) {
    try {
      const real = node_fs.realpathSync(cur);
      const r = node_path.relative(rootReal, real);
      return r === "" || r !== ".." && !r.startsWith(".." + node_path.sep) && !r.startsWith("../") && !node_path.isAbsolute(r);
    } catch {
      const parent = node_path.dirname(cur);
      if (parent === cur) return false;
      cur = parent;
    }
  }
  return false;
}
function clip(s, max) {
  return s.length > max ? s.slice(0, max) + `
…(truncated, ${s.length - max} more chars)` : s;
}
function runCommand(command, cwd) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (ok, text) => {
      if (!done) {
        done = true;
        resolve({ ok, output: clip(text, MAX_OUTPUT_CHARS) });
      }
    };
    try {
      const child = node_child_process.spawn(command, { cwd, shell: true, windowsHide: true });
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
        }
        finish(false, out + `
[timed out after ${EXEC_TIMEOUT_MS / 1e3}s]`);
      }, EXEC_TIMEOUT_MS);
      child.stdout?.on("data", (d) => {
        out += d.toString();
      });
      child.stderr?.on("data", (d) => {
        out += d.toString();
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        finish(false, out + "\n[spawn error] " + e.message);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        finish(code === 0, (out || "(no output)") + `
[exit code ${code}]`);
      });
    } catch (e) {
      finish(false, "[exec failed] " + e.message);
    }
  });
}
async function executeTool(name, args, ctx) {
  const a = args && typeof args === "object" ? args : {};
  try {
    if (name === "fs_read") {
      const abs = resolveWithin(ctx.root, a.path);
      if (!abs || !isRealPathWithin(ctx.root, abs)) return { ok: false, output: "Rejected: path escapes the workspace." };
      const st = node_fs.statSync(abs);
      if (!st.isFile()) return { ok: false, output: "Not a file: " + a.path };
      return { ok: true, output: clip(node_fs.readFileSync(abs, "utf-8"), MAX_READ_CHARS) };
    }
    if (name === "fs_list") {
      const abs = resolveWithin(ctx.root, a.path);
      if (!abs || !isRealPathWithin(ctx.root, abs)) return { ok: false, output: "Rejected: path escapes the workspace." };
      const entries = node_fs.readdirSync(abs, { withFileTypes: true }).map((e) => e.isDirectory() ? e.name + "/" : e.name);
      return { ok: true, output: entries.length ? entries.join("\n") : "(empty)" };
    }
    if (name === "fs_write") {
      if (ctx.readOnly) return { ok: false, output: "Rejected: read-only (no workspace set). Set a workspace to allow writes." };
      const abs = resolveWithin(ctx.root, a.path);
      if (!abs || !isRealPathWithin(ctx.root, abs)) return { ok: false, output: "Rejected: path escapes the workspace." };
      if (typeof a.content !== "string") return { ok: false, output: "Rejected: content must be a string." };
      node_fs.mkdirSync(node_path.dirname(abs), { recursive: true });
      node_fs.writeFileSync(abs, a.content, "utf-8");
      return { ok: true, output: `Wrote ${a.content.length} chars to ${a.path}` };
    }
    if (name === "exec") {
      if (ctx.readOnly) return { ok: false, output: "Rejected: read-only (no workspace set). Set a workspace to allow command execution." };
      if (typeof a.command !== "string" || !a.command.trim()) return { ok: false, output: "Rejected: empty command." };
      return await runCommand(a.command, ctx.root);
    }
    return { ok: false, output: "Unknown tool: " + name };
  } catch (e) {
    return { ok: false, output: "[tool error] " + e.message };
  }
}
const STORAGE_KEY$1 = "agentic.approval.v1";
function guardedToolFor(name) {
  if (name === "fs_write") return "write";
  if (name === "exec") return "exec";
  return null;
}
const DEFAULT$1 = {
  default: { write: "allow", exec: "allow" }
};
function normPolicy(v, fallback) {
  return v === "allow" || v === "ask" || v === "deny" ? v : fallback;
}
class ApprovalConfig {
  read() {
    const raw = appStore.get(STORAGE_KEY$1);
    if (!raw || typeof raw !== "object") return cloneDefault();
    const def = {
      write: normPolicy(raw.default?.write, "allow"),
      exec: normPolicy(raw.default?.exec, "allow")
    };
    const overrides = {};
    if (raw.overrides && typeof raw.overrides === "object") {
      for (const [agentId, o] of Object.entries(raw.overrides)) {
        if (!o || typeof o !== "object") continue;
        const entry = {};
        if (o.write !== void 0) entry.write = normPolicy(o.write, def.write);
        if (o.exec !== void 0) entry.exec = normPolicy(o.exec, def.exec);
        if (Object.keys(entry).length) overrides[agentId] = entry;
      }
    }
    return { version: 1, default: def, overrides };
  }
  write(s) {
    appStore.set(STORAGE_KEY$1, s);
  }
  getConfig() {
    return this.read();
  }
  /** per-agent 覆盖优先，否则回落全局默认。 */
  policyFor(agentId, tool) {
    const s = this.read();
    return s.overrides[agentId]?.[tool] ?? s.default[tool];
  }
  setDefault(tool, policy) {
    const s = this.read();
    s.default[tool] = normPolicy(policy, s.default[tool]);
    this.write(s);
    return s;
  }
  /** policy=null → 清除该 agent 在该工具上的覆盖（回落默认）。 */
  setOverride(agentId, tool, policy) {
    const s = this.read();
    const entry = s.overrides[agentId] || {};
    if (policy === null) delete entry[tool];
    else entry[tool] = normPolicy(policy, s.default[tool]);
    if (Object.keys(entry).length) s.overrides[agentId] = entry;
    else delete s.overrides[agentId];
    this.write(s);
    return s;
  }
}
function cloneDefault() {
  return { version: 1, default: { ...DEFAULT$1.default }, overrides: {} };
}
let instance$1 = null;
function getApprovalConfig() {
  if (!instance$1) instance$1 = new ApprovalConfig();
  return instance$1;
}
const DEFAULT_MAX_ROUNDS = 8;
function labelFor(name, args) {
  if (name === "fs_read") return "Read · " + (args.path ?? "");
  if (name === "fs_write") return "Write · " + (args.path ?? "");
  if (name === "fs_list") return "List · " + (args.path ?? ".");
  if (name === "exec") return "Bash · " + String(args.command ?? "").slice(0, 60);
  return name;
}
function summarizeArgs(name, args) {
  if (name === "fs_write") return (args.path ?? "") + " (" + (typeof args.content === "string" ? args.content.length : 0) + " chars)";
  if (name === "exec") return args.command ?? "";
  return args.path ?? "";
}
async function runAgenticHttp(p) {
  const client = buildProviderClient(p.resolved);
  const ctx = { root: p.root || process.cwd(), readOnly: !p.root };
  const messages = [{ role: "user", content: p.userText }];
  const maxRounds = p.maxRounds ?? DEFAULT_MAX_ROUNDS;
  let fullContent = "";
  let lastUsage = void 0;
  let stepSeq = 0;
  for (let round = 0; round < maxRounds; round++) {
    if (p.isCancelled()) break;
    let roundContent = "";
    let toolCalls;
    let finishReason;
    try {
      await new Promise((resolve, reject) => {
        client.stream(
          { messages, systemPrompt: p.systemPrompt, thinkingOverride: p.thinking, tools: AGENTIC_TOOLS, toolChoice: "auto" },
          {
            onContent: (delta) => {
              roundContent += delta;
              p.emit.delta("content", delta);
            },
            onThinking: (delta) => {
              p.emit.delta("thinking", delta);
            },
            onDone: (final) => {
              finishReason = final.finishReason;
              toolCalls = final.toolCalls;
              if (final.usage) lastUsage = final.usage;
              resolve();
            },
            onError: (err) => reject(err)
          }
        );
      });
    } catch (e) {
      return { content: fullContent, usage: lastUsage, error: e?.message || String(e) };
    }
    fullContent += roundContent;
    if (p.isCancelled()) break;
    if (finishReason === "tool_calls" && toolCalls && toolCalls.length) {
      messages.push({
        role: "assistant",
        content: roundContent,
        tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.function?.name, arguments: tc.function?.arguments || "{}" } }))
      });
      for (const tc of toolCalls) {
        if (p.isCancelled()) break;
        const name = tc.function?.name || "unknown";
        let parsed = {};
        try {
          parsed = JSON.parse(tc.function?.arguments || "{}");
        } catch {
          parsed = {};
        }
        const stepId = "tool-" + ++stepSeq;
        const label = labelFor(name, parsed);
        const detail = summarizeArgs(name, parsed);
        const guarded = guardedToolFor(name);
        if (guarded) {
          const policy = p.policyFor ? p.policyFor(guarded) : "allow";
          if (policy === "deny") {
            const out = `Rejected by approval policy: '${guarded}' is denied for this agent.`;
            p.emit.activity({ id: stepId, kind: "tool", tool: name, label, detail, output: out, status: "error" });
            messages.push({ role: "tool", tool_call_id: tc.id, content: out });
            continue;
          }
          if (policy === "ask") {
            p.emit.activity({ id: stepId, kind: "tool", tool: name, label, detail, status: "awaiting" });
            const approved = p.requestApproval ? await p.requestApproval({ stepId, agentId: p.agentId || "agent", tool: guarded, toolName: name, label, detail }) : false;
            if (p.isCancelled()) break;
            if (!approved) {
              const out = "Rejected by user (approval denied).";
              p.emit.activity({ id: stepId, kind: "tool", tool: name, label, detail, output: out, status: "error" });
              messages.push({ role: "tool", tool_call_id: tc.id, content: out });
              continue;
            }
          }
        }
        p.emit.activity({ id: stepId, kind: "tool", tool: name, label, detail, status: "running" });
        const result = await executeTool(name, parsed, ctx);
        p.emit.activity({ id: stepId, kind: "tool", tool: name, label, detail, output: result.output, status: result.ok ? "done" : "error" });
        messages.push({ role: "tool", tool_call_id: tc.id, content: result.output });
      }
      continue;
    }
    break;
  }
  return { content: fullContent, usage: lastUsage };
}
const STORAGE_KEY = "agentic.v1";
const DEFAULT = { version: 2, mode: "all", selected: [], disabled: [] };
function asStringArray(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}
class AgenticConfig {
  read() {
    const raw = appStore.get(STORAGE_KEY);
    if (!raw || typeof raw !== "object") return { ...DEFAULT };
    if (raw.version === 1 || Array.isArray(raw.httpEnabled)) {
      return { version: 2, mode: "selected", selected: asStringArray(raw.httpEnabled), disabled: [] };
    }
    const mode = raw.mode === "selected" ? "selected" : "all";
    return { version: 2, mode, selected: asStringArray(raw.selected), disabled: asStringArray(raw.disabled) };
  }
  write(s) {
    appStore.set(STORAGE_KEY, s);
  }
  getMode() {
    return this.read().mode;
  }
  setMode(mode) {
    const s = this.read();
    s.mode = mode === "selected" ? "selected" : "all";
    this.write(s);
    return s.mode;
  }
  /** 当前实际启用 agentic 的 agentId 列表（按 manifest 已知 agent 推导）。 */
  getEnabled() {
    const s = this.read();
    if (s.mode === "selected") return [...s.selected].filter((id) => !DISABLED_AGENT_ID_SET.has(id));
    return AGENTS.map((a) => a.id).filter((id) => !s.disabled.includes(id) && !DISABLED_AGENT_ID_SET.has(id));
  }
  isEnabled(agentId) {
    const s = this.read();
    if (DISABLED_AGENT_ID_SET.has(agentId)) return false;
    return s.mode === "selected" ? s.selected.includes(agentId) : !s.disabled.includes(agentId);
  }
  setEnabled(agentId, on) {
    if (DISABLED_AGENT_ID_SET.has(agentId)) return this.getEnabled();
    const s = this.read();
    if (s.mode === "selected") {
      const has = s.selected.includes(agentId);
      if (on && !has) s.selected.push(agentId);
      else if (!on && has) s.selected = s.selected.filter((x) => x !== agentId);
    } else {
      const blocked = s.disabled.includes(agentId);
      if (on && blocked) s.disabled = s.disabled.filter((x) => x !== agentId);
      else if (!on && !blocked) s.disabled.push(agentId);
    }
    this.write(s);
    return this.getEnabled();
  }
}
let instance = null;
function getAgenticConfig() {
  if (!instance) instance = new AgenticConfig();
  return instance;
}
const NATIVE_CLI_AGENTS = /* @__PURE__ */ new Set(["codex", "claude"]);
function capabilitiesFor(protocol, httpAgentic) {
  const caps = ["skills"];
  if (protocol === "stdio-plain" || protocol === "acp" || httpAgentic) {
    caps.push("fs-read", "fs-write", "exec", "agentic-loop");
  }
  return caps;
}
function isHttpAgenticEnabled(agentId) {
  return getAgenticConfig().isEnabled(agentId);
}
function getCapabilityMatrix() {
  const mgr = getProviderManager();
  const bindings = mgr.getBindings();
  const cfg = getAgenticConfig();
  const byId = /* @__PURE__ */ new Map();
  const put = (agentId, protocol) => {
    const httpAgentic = protocol === "http" && cfg.isEnabled(agentId);
    byId.set(agentId, {
      agentId,
      name: agentName(agentId),
      protocol,
      // acp = 结构化原生 agentic；stdio 的 codex/claude 为原生 CLI agentic
      nativeCli: protocol === "acp" || protocol === "stdio-plain" && NATIVE_CLI_AGENTS.has(agentId),
      httpAgentic,
      capabilities: capabilitiesFor(protocol, httpAgentic)
    });
  };
  for (const a of AGENTS) put(a.id, "http");
  for (const b of bindings) put(b.agentId, b.protocol === "stdio-plain" ? "stdio-plain" : b.protocol === "acp" ? "acp" : "http");
  return Array.from(byId.values());
}
const STDIO_THINKING_DIRECTIVE = "[Reasoning mode] Think through the problem step by step and weigh edge cases before answering. Do not print raw chain-of-thought; provide the well-reasoned final result.";
const APPROVAL_TIMEOUT_MS = 2 * 60 * 1e3;
function thinkingRequested(th) {
  if (!th || typeof th !== "object") return false;
  if (th.enabled === false) return false;
  return th.enabled === true || typeof th.level === "string" && th.level !== "off" && th.level !== "none" || !!th.budgetTokens || !!th.budget;
}
function isExecutionWorkerAgent(agentId) {
  return EXECUTION_WORKER_AGENT_IDS.includes(agentId);
}
function isBridgeRequest(text) {
  return /通知|通报|进度|远程|手机|提醒|确认|审批|notify|progress|remote|approval/i.test(text);
}
class Dispatcher extends events.EventEmitter {
  constructor(registry2, pipeline2, memoryProvider = () => [], missionStore2, supervisor = new Supervisor(), collaborationBus2) {
    super();
    this.registry = registry2;
    this.pipeline = pipeline2;
    this.memoryProvider = memoryProvider;
    this.missionStore = missionStore2;
    this.supervisor = supervisor;
    this.collaborationBus = collaborationBus2;
  }
  tasks = /* @__PURE__ */ new Map();
  taskCounter = 0;
  /** 'ask' 审批待决池：requestId → {resolve,timer}。requestId 以 `appr-<taskId>-` 前缀便于按任务清理。 */
  pendingApprovals = /* @__PURE__ */ new Map();
  pendingPlanApprovals = /* @__PURE__ */ new Map();
  approvalSeq = 0;
  emit(event, ...args) {
    return super.emit(event, ...args);
  }
  on(event, listener) {
    return super.on(event, listener);
  }
  off(event, listener) {
    return super.off(event, listener);
  }
  async recordCollaboration(input) {
    if (!this.collaborationBus) return;
    try {
      await this.collaborationBus.append({
        type: input.type,
        source: input.source || agentAddress("agenthub"),
        target: input.target || (input.missionId ? channelAddress(input.missionId) : "core"),
        missionId: input.missionId,
        channel: input.missionId,
        visibility: input.missionId ? "channel" : "public",
        payload: input.payload,
        metadata: input.metadata || {}
      });
    } catch (e) {
      console.warn("[Collaboration] failed to record event:", e);
    }
  }
  getUserBridgeAgentId() {
    const configured = appStore.get(NOTIFICATION_BRIDGE_STORAGE_KEY, DEFAULT_NOTIFICATION_BRIDGE_AGENT_ID);
    return configured === "openclaw" || configured === "hermes" ? configured : DEFAULT_NOTIFICATION_BRIDGE_AGENT_ID;
  }
  async recordUserNotification(missionId, phase, payload = {}, source = agentAddress(MAIN_AGENT_ID)) {
    if (!missionId) return;
    const bridgeAgentId = this.getUserBridgeAgentId();
    await this.recordCollaboration({
      type: CollaborationEventTypes.UserNotificationRequested,
      missionId,
      source,
      target: agentAddress(bridgeAgentId),
      payload: {
        bridgeAgentId,
        phase,
        ...payload
      },
      metadata: { role: "user-bridge" }
    });
  }
  /**
   * Dispatch a prompt. Returns the task object; results stream via "stream" events.
   * No demo / mock fallback: if no provider is bound the call fails immediately.
   */
  async dispatch(text, mode = "auto", targetAgent, opts = {}) {
    const taskId = "task-" + ++this.taskCounter;
    const task = {
      id: taskId,
      text,
      mode,
      targetAgent,
      status: "pending",
      results: /* @__PURE__ */ new Map(),
      thinking: /* @__PURE__ */ new Map(),
      errors: /* @__PURE__ */ new Map(),
      usage: /* @__PURE__ */ new Map(),
      thinkingSummary: /* @__PURE__ */ new Map(),
      createdAt: /* @__PURE__ */ new Date()
    };
    this.tasks.set(task.id, task);
    task.status = "running";
    try {
      if (mode === "orchestrate") {
        await this.runOrchestrate(task, text, opts);
      } else if (mode === "collaborate") {
        await this.runCollaborate(task, text, opts);
      } else {
        const targets = this.resolveTargets(task, mode, targetAgent);
        if (targets.length === 0) throw new Error("No available provider for the requested routing. Open Settings -> Providers to configure API keys.");
        if (mode === "chain") {
          let currentText = text;
          for (const t of targets) {
            const res = await this.sendToAgent(task, t.agentId, currentText, opts);
            if (task.status === "cancelled") break;
            if (res.error) break;
            currentText = res.content;
          }
        } else {
          await Promise.all(targets.map((t) => this.sendToAgent(task, t.agentId, text, opts)));
        }
        if (task.status !== "cancelled") task.status = task.errors.size === targets.length && targets.length > 0 ? "failed" : "completed";
      }
    } catch (e) {
      if (task.status !== "cancelled") task.status = "failed";
      task.error = e.message;
    }
    return task;
  }
  resolveTargets(task, mode, targetAgent) {
    const mgr = getProviderManager();
    const bindings = mgr.getBindings().filter((binding) => binding.agentId !== MAIN_AGENT_ID);
    const executionBindings = bindings.filter((binding) => isExecutionWorkerAgent(binding.agentId));
    if (targetAgent) {
      const normalizedTarget = targetAgent === "claude-code" ? "claude" : targetAgent;
      const b = bindings.find((x) => x.agentId === normalizedTarget);
      return b ? [{ agentId: normalizedTarget }] : [];
    }
    if (mode === "broadcast") {
      return executionBindings.map((b) => ({ agentId: b.agentId }));
    }
    if (mode === "chain") {
      const codex = executionBindings.find((b) => b.agentId === "codex");
      if (codex) return [{ agentId: "codex" }];
      const claude = executionBindings.find((b) => b.agentId === "claude");
      if (claude) return [{ agentId: "claude" }];
      return executionBindings.length > 0 ? [{ agentId: executionBindings[0].agentId }] : [];
    }
    if (isBridgeRequest(task.text)) {
      const bridgeAgentId = this.getUserBridgeAgentId();
      if (bindings.find((b) => b.agentId === bridgeAgentId)) return [{ agentId: bridgeAgentId }];
    }
    const router2 = new KeywordRouter();
    const routed = router2.route(task.text, this.registry.getAll().filter((a) => isExecutionWorkerAgent(a.id)).map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      mode: a.mode,
      protocol: a.protocol,
      adapter: a.adapter,
      capabilities: a.capabilities,
      lastActive: a.lastActive,
      errorCount: a.errorCount
    })), this.missionStore?.getRouterContext());
    if (routed && executionBindings.find((b) => b.agentId === routed)) return [{ agentId: routed }];
    return executionBindings.length > 0 ? [{ agentId: executionBindings[0].agentId }] : [];
  }
  selectCollaborators(opts, workerIds) {
    const requested = Array.isArray(opts.participants) ? opts.participants : [];
    const priority = [...requested, "codex", "claude", ...workerIds];
    const seen = /* @__PURE__ */ new Set();
    const selected = [];
    for (const raw of priority) {
      const id = raw === "claude-code" ? "claude" : raw;
      if (!id || seen.has(id) || !workerIds.includes(id)) continue;
      seen.add(id);
      selected.push(id);
      if (selected.length >= 3) break;
    }
    return selected;
  }
  collaborationRounds(opts) {
    const raw = Number(opts.rounds ?? 3);
    if (!Number.isFinite(raw)) return 3;
    return Math.max(1, Math.min(6, Math.round(raw)));
  }
  async runCollaborate(task, text, opts) {
    const missionId = `mission-${task.id}`;
    task.missionId = missionId;
    try {
      const mgr = getProviderManager();
      const bindings = mgr.getBindings();
      const workerIds = Array.from(new Set(bindings.map((binding) => binding.agentId).filter((id) => isExecutionWorkerAgent(id))));
      const participants = this.selectCollaborators(opts, workerIds);
      if (participants.length < 2) {
        throw new Error("协作模式至少需要两个可执行子 Agent。请在 设置 -> 路由 绑定 Codex CLI 和 Claude Code。");
      }
      if (!bindings.find((binding) => binding.agentId === MAIN_AGENT_ID)) {
        throw new Error("Orbit 主 Agent 尚未绑定。协作模式需要 Orbit 负责最终评判与合成。");
      }
      if (!mgr.resolveBinding(MAIN_AGENT_ID)) {
        throw new Error("Orbit 主 Agent 尚未配置可用模型/API Key。请到 设置 -> 路由 配置 Orbit。");
      }
      const rounds = this.collaborationRounds(opts);
      const transcript = [];
      this.emit("stream", { kind: "collaborate:start", taskId: task.id, missionId, participants, rounds, topic: text });
      await this.recordCollaboration({
        type: CollaborationEventTypes.MissionStarted,
        missionId,
        payload: { missionId, taskId: task.id, mode: "collaborate", topic: text, participants, rounds }
      });
      await this.recordCollaboration({
        type: CollaborationEventTypes.MissionStatusChanged,
        missionId,
        payload: { missionId, taskId: task.id, status: "running", mode: "collaborate" }
      });
      await this.recordUserNotification(missionId, "collaboration_started", { taskId: task.id, participants, rounds });
      for (let round = 1; round <= rounds; round++) {
        for (const agentId of participants) {
          if (task.status === "cancelled") return;
          this.emit("stream", { kind: "collaborate:turn", taskId: task.id, missionId, round, agentId, status: "running" });
          await this.recordCollaboration({
            type: CollaborationEventTypes.ContractStatusChanged,
            missionId,
            source: agentAddress(agentId),
            payload: { contractId: `collab-r${round}-${agentId}`, status: "running", round, agentId, title: `Collaboration turn ${round}` }
          });
          const prompt = collabTurnPrompt(text, agentId, transcript, round, rounds, participants);
          const result = await this.sendToAgent(task, agentId, prompt, opts);
          const content = String(result.content || "").trim();
          if (result.error || !content) {
            const error = result.error || `${agentId} returned an empty collaboration turn`;
            task.errors.set(agentId, error);
            this.emit("stream", { kind: "collaborate:turn", taskId: task.id, missionId, round, agentId, status: "error", error });
            await this.recordCollaboration({
              type: CollaborationEventTypes.ContractStatusChanged,
              missionId,
              source: agentAddress(agentId),
              payload: { contractId: `collab-r${round}-${agentId}`, status: "failed", round, agentId, error }
            });
            throw new Error(error);
          }
          transcript.push({ agentId, round, text: content });
          this.emit("stream", { kind: "collaborate:turn", taskId: task.id, missionId, round, agentId, status: "done", content });
          await this.recordCollaboration({
            type: CollaborationEventTypes.ContractStatusChanged,
            missionId,
            source: agentAddress(agentId),
            payload: { contractId: `collab-r${round}-${agentId}`, status: "done", round, agentId, title: `Collaboration turn ${round}`, contentPreview: content.slice(0, 1200) }
          });
        }
      }
      if (task.status === "cancelled") return;
      this.emit("stream", { kind: "collaborate:synthesizing", taskId: task.id, missionId, leadAgentId: MAIN_AGENT_ID });
      await this.recordCollaboration({
        type: CollaborationEventTypes.SynthesisStarted,
        missionId,
        source: agentAddress(MAIN_AGENT_ID),
        payload: { missionId, taskId: task.id, leadAgentId: MAIN_AGENT_ID, turnCount: transcript.length }
      });
      const synth = await this.sendToAgent(task, MAIN_AGENT_ID, collabSynthesisPrompt(text, transcript), { ...opts, systemPrompt: ORCHESTRATOR_LEAD_SYSTEM });
      if (synth.error || !String(synth.content || "").trim()) throw new Error("协作合成阶段失败: " + (synth.error || "empty synthesis"));
      this.emit("stream", { kind: "collaborate:final", taskId: task.id, missionId, content: synth.content });
      task.results.set("collaborate", synth.content);
      await this.recordCollaboration({
        type: CollaborationEventTypes.SynthesisCompleted,
        missionId,
        source: agentAddress(MAIN_AGENT_ID),
        payload: { missionId, taskId: task.id, leadAgentId: MAIN_AGENT_ID, summary: synth.content.slice(0, 1e3) }
      });
      const outcome = this.missionStore?.recordOutcome({
        missionId,
        goal: text,
        status: "completed",
        summary: synth.content.slice(0, 600),
        lessons: extractLessons(synth.content),
        blockers: [],
        verified: true,
        taskCount: transcript.length,
        failedTaskIds: [],
        resultPreview: synth.content.slice(0, 1200)
      });
      await this.recordCollaboration({
        type: CollaborationEventTypes.OutcomeRecorded,
        missionId,
        payload: outcome || { missionId, status: "completed", summary: synth.content.slice(0, 600), turnCount: transcript.length }
      });
      await this.recordUserNotification(missionId, "collaboration_completed", {
        taskId: task.id,
        status: "completed",
        participants,
        rounds,
        summary: synth.content.slice(0, 800)
      });
      task.status = "completed";
    } catch (e) {
      if (task.status !== "cancelled") {
        task.status = "failed";
        await this.recordCollaboration({
          type: CollaborationEventTypes.OutcomeRecorded,
          missionId,
          payload: { missionId, status: "failed", summary: e?.message || String(e) }
        });
        await this.recordUserNotification(missionId, "collaboration_failed", {
          taskId: task.id,
          status: "failed",
          error: e?.message || String(e)
        });
      }
      this.emit("stream", { kind: "collaborate:error", taskId: task.id, missionId, error: e?.message || String(e) });
      throw e;
    }
  }
  /**
   * 编排模式：lead agent 分解任务 → 各 agent 并行执行子任务 → lead 汇总。
   * 复用 sendToAgent 执行；额外发 orchestrate:* 事件供 UI 渲染（其内部 start/delta/done 事件
   * 渲染层在编排消息上忽略，只用 orchestrate:* 驱动 OrchestrateView）。
   */
  async runOrchestrate(task, text, opts) {
    try {
      const mgr = getProviderManager();
      const bindings = mgr.getBindings();
      const workerBindings = bindings.filter((binding) => isExecutionWorkerAgent(binding.agentId));
      if (workerBindings.length === 0) throw new Error("没有可执行子 Agent。请到 设置 -> 路由 绑定 Codex 或 Claude。Hermes 只作为用户通知与远程指令通道。");
      const router2 = new KeywordRouter();
      const available = this.registry.getAll().filter((agent) => isExecutionWorkerAgent(agent.id)).map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        mode: a.mode,
        protocol: a.protocol,
        adapter: a.adapter,
        capabilities: a.capabilities,
        lastActive: a.lastActive,
        errorCount: a.errorCount
      }));
      const bound = new Set(workerBindings.map((b) => b.agentId));
      const hasOrbitBinding = !!bindings.find((binding) => binding.agentId === MAIN_AGENT_ID);
      if (!hasOrbitBinding) {
        throw new Error("Orbit 主 Agent 尚未绑定。编排模式必须先配置 Orbit，由它负责拆分、派发、校验和汇总。");
      }
      const leadId = MAIN_AGENT_ID;
      const leadInfo = this.registry.get(leadId);
      const leadIsLocal = !!leadInfo && leadInfo.adapter.protocol && leadInfo.adapter.protocol !== "http";
      if (!leadIsLocal && !mgr.resolveBinding(leadId)) {
        throw new Error("Orbit 主 Agent 尚未配置可用模型/API Key。请到 设置 -> 路由 配置 Orbit，或到 设置 -> 提供商 填写 Provider Key。");
      }
      const missionId = `mission-${task.id}`;
      task.missionId = missionId;
      await this.recordCollaboration({
        type: CollaborationEventTypes.MissionStarted,
        missionId,
        source: humanAddress("user"),
        payload: {
          missionId,
          taskId: task.id,
          goal: text,
          leadAgentId: leadId,
          availableAgents: available.map((agent) => agent.id)
        }
      });
      this.emit("stream", { kind: "orchestrate:plan", taskId: task.id, missionId, leadAgentId: leadId, subtasks: [] });
      const leadActivity = (step) => this.emit("stream", { kind: "orchestrate:leadActivity", taskId: task.id, missionId, leadAgentId: leadId, step });
      const localPlannerContext = this.missionStore?.buildPlannerContext(6, text) || "";
      const evomapPlannerContext = await buildEvoMapPlannerContext(text, leadActivity);
      if (evomapPlannerContext.status === "ready") {
        await this.recordCollaboration({
          type: CollaborationEventTypes.MemoryUpdated,
          missionId,
          source: agentAddress(MAIN_AGENT_ID),
          payload: {
            source: "evomap-mcp",
            summary: evomapPlannerContext.summary,
            toolCount: evomapPlannerContext.toolCount,
            itemCount: evomapPlannerContext.itemCount
          },
          metadata: { role: "planning-context" }
        });
      }
      const plannerContext = [
        localPlannerContext,
        evomapPlannerContext.context ? "External EvoMap MCP candidate context:\n" + evomapPlannerContext.context : "",
        evomapPlannerContext.status === "auth_required" ? "EvoMap MCP note: OAuth is not connected yet; continue with local planning and do not block the mission." : "",
        evomapPlannerContext.status === "error" ? "EvoMap MCP note: lookup failed; continue with local planning and do not block the mission. Reason: " + evomapPlannerContext.summary : ""
      ].filter(Boolean).join("\n\n");
      const leadPlanContext = buildOpenAgentsWorkspaceContext({
        agentId: leadId,
        agentName: agentName(leadId),
        workspaceId: opts.workspaceId || "local",
        channelId: missionId,
        missionId,
        missionGoal: text,
        mode: "PLAN",
        peers: available.map((agent) => ({
          id: agent.id,
          agentId: agent.id,
          title: agent.name,
          detail: (agent.capabilities || []).join(", "),
          status: agent.status
        })),
        currentContract: null,
        previousWork: [],
        recentHistory: ""
      });
      const planRes = await this.sendToAgent(task, leadId, leadPlanContext + "\n\n" + decompositionPrompt(text, available.map((a) => a.id), plannerContext), { ...opts, systemPrompt: ORCHESTRATOR_LEAD_SYSTEM });
      if (planRes.error) throw new Error("分解阶段失败: " + planRes.error);
      let plan = parsePlan(planRes.content);
      let artifact = plan?.artifact && plan.artifact.taskDag.nodes.length ? { ...plan.artifact, missionId, goal: text, leadAgentId: leadId } : null;
      if (!plan || plan.subtasks.length === 0) {
        artifact = fallbackPlanArtifact(missionId, text, leadId);
        plan = { subtasks: artifact.taskDag.nodes, artifact };
      }
      plan = enforceWorkerPlan(plan, workerBindings, available, router2, this.missionStore?.getRouterContext(), text);
      for (const st of plan.subtasks) {
        if (!st.agentId || !bound.has(st.agentId)) {
          st.agentId = selectWorkerAgentForContract(st, Array.from(bound), router2, available, this.missionStore?.getRouterContext());
        }
      }
      artifact = artifact ? { ...artifact, taskDag: { nodes: plan.subtasks, edges: buildDagEdges(plan.subtasks) }, updatedAt: (/* @__PURE__ */ new Date()).toISOString() } : fallbackPlanArtifact(missionId, text, leadId);
      artifact = setPlanStatus(artifact, opts.requirePlanApproval ? "awaiting-approval" : "approved");
      task.planArtifact = artifact;
      this.missionStore?.upsertPlan(artifact);
      await this.recordCollaboration({
        type: CollaborationEventTypes.MissionPlanProposed,
        missionId,
        payload: {
          missionId,
          taskId: task.id,
          goal: text,
          leadAgentId: leadId,
          status: artifact.status,
          contractCount: artifact.taskDag.nodes.length,
          contracts: artifact.taskDag.nodes.map(contractSnapshot)
        }
      });
      await this.recordUserNotification(missionId, "plan_proposed", {
        taskId: task.id,
        goal: text,
        contractCount: artifact.taskDag.nodes.length,
        status: artifact.status
      });
      for (const contract of artifact.taskDag.nodes) {
        await this.recordCollaboration({
          type: CollaborationEventTypes.ContractCreated,
          missionId,
          payload: contractSnapshot(contract)
        });
      }
      this.emit("stream", {
        kind: "orchestrate:plan",
        taskId: task.id,
        missionId,
        leadAgentId: leadId,
        planArtifact: artifact,
        subtasks: artifact.taskDag.nodes.map((s) => ({
          id: s.id,
          title: s.title,
          detail: s.detail,
          agentId: s.agentId,
          fileScope: s.fileScope,
          dependsOn: s.dependsOn,
          doneWhen: s.doneWhen,
          verifyCommand: s.verifyCommand,
          interfaceRef: s.interfaceRef
        }))
      });
      if (opts.requirePlanApproval) {
        this.emit("stream", { kind: "orchestrate:approval", taskId: task.id, missionId, status: "awaiting", planArtifact: artifact });
        await this.recordCollaboration({
          type: CollaborationEventTypes.MissionPlanApprovalRequested,
          missionId,
          payload: { missionId, taskId: task.id, status: artifact.status, contractCount: artifact.taskDag.nodes.length }
        });
        const approved = await this.waitForPlanApproval(task.id);
        if (!approved) {
          this.missionStore?.setPlanStatus(missionId, "cancelled");
          this.emit("stream", { kind: "orchestrate:approval", taskId: task.id, missionId, status: "rejected" });
          await this.recordCollaboration({
            type: CollaborationEventTypes.MissionPlanRejected,
            missionId,
            source: humanAddress("user"),
            payload: { missionId, taskId: task.id, status: "cancelled" }
          });
          await this.recordUserNotification(missionId, "plan_rejected", { taskId: task.id, status: "cancelled" });
          task.status = "cancelled";
          throw new Error("用户取消了协作计划");
        }
        artifact = setPlanStatus(artifact, "approved");
        task.planArtifact = artifact;
        this.missionStore?.upsertPlan(artifact);
        this.emit("stream", { kind: "orchestrate:approval", taskId: task.id, missionId, status: "approved", planArtifact: artifact });
        await this.recordCollaboration({
          type: CollaborationEventTypes.MissionPlanApproved,
          missionId,
          source: humanAddress("user"),
          payload: { missionId, taskId: task.id, status: artifact.status }
        });
      }
      artifact = setPlanStatus(artifact, "running");
      task.planArtifact = artifact;
      this.missionStore?.upsertPlan(artifact);
      await this.recordCollaboration({
        type: CollaborationEventTypes.MissionStatusChanged,
        missionId,
        payload: { missionId, taskId: task.id, status: artifact.status }
      });
      await this.recordUserNotification(missionId, "mission_running", {
        taskId: task.id,
        status: artifact.status,
        contractCount: artifact.taskDag.nodes.length
      });
      const MAX_ATTEMPTS = 3;
      const partsById = /* @__PURE__ */ new Map();
      const finished = /* @__PURE__ */ new Set();
      const failed = /* @__PURE__ */ new Set();
      const remaining = new Map(artifact.taskDag.nodes.map((st) => [st.id, st]));
      const reactorWaves = [];
      const artifactRegistry = [];
      let reactorRound = 0;
      let replanRounds = 0;
      const maxReplanRounds = Math.max(0, Number(process.env.ORBIT_REACTOR_REPLAN_ROUNDS || "3") || 3);
      const workerIds = Array.from(bound).filter((id) => isExecutionWorkerAgent(id));
      const alternateWorker = (agentId) => workerIds.find((id) => id && id !== agentId) || "";
      const maxReadyConcurrency = Math.max(1, Number(process.env.ORBIT_ORCHESTRATE_CONCURRENCY || "2") || 2);
      let sharedContextLedger = null;
      let sharedContextLedgerAnnounced = false;
      const pickReadyWave = (ready2) => {
        const selected = [];
        const usedAgents = /* @__PURE__ */ new Set();
        for (const st of ready2) {
          if (selected.length >= maxReadyConcurrency) break;
          if (!usedAgents.has(st.agentId)) {
            selected.push(st);
            usedAgents.add(st.agentId);
          }
        }
        for (const st of ready2) {
          if (selected.length >= maxReadyConcurrency) break;
          if (!selected.includes(st)) selected.push(st);
        }
        return selected;
      };
      const previousWorkSnapshot = () => artifact.taskDag.nodes.map((node) => {
        const part = partsById.get(node.id);
        if (!part) return null;
        return {
          id: node.id,
          agentId: part.agentId || node.agentId,
          summary: part.content || "",
          error: part.error || ""
        };
      }).filter(Boolean);
      const refreshSharedContextLedger = async (phase) => {
        sharedContextLedger = writeMissionSharedContextLedger({
          workspaceId: opts.workspaceId || "local",
          missionId,
          goal: text,
          phase,
          artifact,
          previousWork: previousWorkSnapshot(),
          artifacts: artifactRegistry,
          waves: reactorWaves,
          timeline: this.collaborationBus?.buildMissionTimeline(missionId, 60) || ""
        });
        if (sharedContextLedger && !sharedContextLedgerAnnounced) {
          sharedContextLedgerAnnounced = true;
          await this.recordCollaboration({
            type: CollaborationEventTypes.MemoryUpdated,
            missionId,
            source: agentAddress(MAIN_AGENT_ID),
            payload: {
              kind: "mission_shared_context_ledger",
              missionId,
              path: sharedContextLedger.path,
              absolutePath: sharedContextLedger.absolutePath,
              location: sharedContextLedger.location,
              error: sharedContextLedger.error || ""
            },
            metadata: { role: "shared-context" }
          });
        }
        return sharedContextLedger;
      };
      const buildMissionContext = (currentContract, agentId, mode = "EXECUTE") => buildOpenAgentsWorkspaceContext({
        agentId: agentId || currentContract?.agentId || leadId,
        agentName: agentName(agentId || currentContract?.agentId || leadId),
        workspaceId: opts.workspaceId || "local",
        channelId: missionId,
        missionId,
        missionGoal: text,
        mode,
        currentContract,
        peers: artifact.taskDag.nodes.map((node) => ({
          id: node.id,
          agentId: node.agentId,
          title: node.title,
          detail: node.detail,
          status: node.status
        })),
        previousWork: previousWorkSnapshot(),
        recentHistory: this.collaborationBus?.buildMissionTimeline(missionId, 40) || "",
        reactorState: buildReactorStateSummary({
          round: reactorRound,
          waves: reactorWaves,
          artifacts: artifactRegistry,
          finishedCount: finished.size,
          failedCount: failed.size,
          remainingCount: remaining.size
        }),
        handoffNote: currentContract?.__handoffCapsule || "",
        sharedLedger: sharedContextLedger
      });
      const peerSnapshot = () => artifact.taskDag.nodes.map((node) => {
        const part = partsById.get(node.id);
        if (!part) return null;
        return {
          id: node.id,
          agentId: part.agentId || node.agentId,
          summary: part.content || "",
          error: part.error || ""
        };
      }).filter(Boolean);
      const setHandoffCapsule = async (st, capsuleInput) => {
        const capsule = buildHandoffCapsule({
          missionId,
          workspaceId: opts.workspaceId || "local",
          contract: st,
          peerResults: peerSnapshot(),
          ...capsuleInput
        });
        st.__handoffCapsule = capsule;
        await this.recordCollaboration({
          type: CollaborationEventTypes.MemoryUpdated,
          missionId,
          source: agentAddress(MAIN_AGENT_ID),
          payload: {
            kind: "handoff_capsule",
            missionId,
            contractId: st.id,
            from: capsuleInput?.fromAgent,
            to: capsuleInput?.toAgent,
            reason: capsuleInput?.reason,
            preview: capsule.slice(0, 1200)
          }
        });
        await refreshSharedContextLedger(`handoff:${st.id}`);
        return capsule;
      };
      const emitPlanSnapshot = (extra = {}) => {
        this.emit("stream", {
          kind: "orchestrate:plan",
          taskId: task.id,
          missionId,
          leadAgentId: leadId,
          planArtifact: artifact,
          sharedContextPath: sharedContextLedger?.path,
          subtasks: artifact.taskDag.nodes.map((s) => ({
            id: s.id,
            title: s.title,
            detail: s.detail,
            agentId: s.agentId,
            fileScope: s.fileScope,
            dependsOn: s.dependsOn,
            doneWhen: s.doneWhen,
            verifyCommand: s.verifyCommand,
            interfaceRef: s.interfaceRef,
            status: s.status
          })),
          ...extra
        });
      };
      await refreshSharedContextLedger("running");
      emitPlanSnapshot({ sharedContextPath: sharedContextLedger?.path });
      const applyReactorDecision = async (decision, stateSummary) => {
        const added = [];
        const revised = [];
        const now = (/* @__PURE__ */ new Date()).toISOString();
        let nodes = artifact.taskDag.nodes.map((node) => ({ ...node }));
        if (Array.isArray(decision.reviseContracts)) {
          for (const rev of decision.reviseContracts) {
            const id = stringValue(rev?.id);
            if (!id || finished.has(id)) continue;
            const idx = nodes.findIndex((node) => node.id === id);
            if (idx < 0) continue;
            const current = nodes[idx];
            const nextAgent = stringValue(rev.agentId) || stringValue(rev.agent) || current.agentId;
            const patched = {
              ...current,
              title: stringValue(rev.title) || current.title,
              detail: stringValue(rev.detail) || stringValue(rev.description) || current.detail,
              fileScope: stringArray(rev.fileScope ?? rev.files ?? rev.scope).length ? stringArray(rev.fileScope ?? rev.files ?? rev.scope).slice(0, 20) : current.fileScope,
              doneWhen: stringValue(rev.doneWhen) || stringValue(rev.acceptanceCriteria) || current.doneWhen,
              verifyCommand: stringValue(rev.verifyCommand) || stringValue(rev.verify) || current.verifyCommand,
              interfaceRef: [current.interfaceRef, stringValue(rev.interfaceRef) || stringValue(rev.contractRef) || stringValue(rev.sharedContract)].filter(Boolean).join("\n"),
              agentId: bound.has(nextAgent) ? nextAgent : selectWorkerAgentForContract(current, workerIds, router2, available, this.missionStore?.getRouterContext()),
              updatedAt: now
            };
            nodes[idx] = patched;
            if (remaining.has(id)) remaining.set(id, patched);
            revised.push(patched);
          }
        }
        if (Array.isArray(decision.addContracts)) {
          const knownAgents = available.map((a) => a.id);
          for (const raw of decision.addContracts.slice(0, 2)) {
            const normalized = normalizeTaskContract(raw, nodes.length + added.length, now, knownAgents);
            if (!normalized) continue;
            const preferredId = stringValue(raw?.id) || normalized.id || `reactor-${reactorRound + 1}-${added.length + 1}`;
            let node = withSharedAcceptance({
              ...normalized,
              id: uniqueContractId(nodes.concat(added), preferredId),
              status: "planned",
              agentId: bound.has(normalized.agentId) ? normalized.agentId : selectWorkerAgentForContract(normalized, workerIds, router2, available, this.missionStore?.getRouterContext())
            }, text);
            const knownIds = new Set(nodes.concat(added).map((item) => item.id));
            node.dependsOn = (node.dependsOn || []).filter((dep) => knownIds.has(dep) && !failed.has(dep));
            if ((normalized.dependsOn || []).some((dep) => failed.has(dep))) {
              node.detail = [
                node.detail,
                "",
                "Reactor rescue: original dependency already failed, so continue from shared artifacts and handoff capsules instead of waiting on that dependency."
              ].join("\n");
            }
            nodes.push(node);
            remaining.set(node.id, node);
            added.push(node);
          }
        }
        if (added.length === 0 && revised.length === 0) return false;
        artifact = {
          ...artifact,
          status: rollupPlanStatus(artifact.status, nodes),
          summary: summarizeContracts(nodes),
          taskDag: { nodes, edges: buildDagEdges(nodes) },
          updatedAt: now
        };
        task.planArtifact = artifact;
        this.missionStore?.upsertPlan(artifact);
        for (const contract of added) {
          await this.recordCollaboration({
            type: CollaborationEventTypes.ContractCreated,
            missionId,
            payload: contractSnapshot(contract, { source: "reactor-replan" })
          });
        }
        await this.recordCollaboration({
          type: CollaborationEventTypes.MissionPlanRevised,
          missionId,
          source: agentAddress(leadId),
          payload: {
            missionId,
            taskId: task.id,
            summary: decision.summary || "",
            reactorRound,
            addedContractIds: added.map((node) => node.id),
            revisedContractIds: revised.map((node) => node.id),
            statePreview: contextLine(stateSummary, 1200)
          }
        });
        await refreshSharedContextLedger("replanned");
        emitPlanSnapshot({ reactorDecision: decision, reactorRound });
        return true;
      };
      const runContract = async (st) => {
        if (task.status === "cancelled") return { title: st.title, agentId: st.agentId, content: "", error: "cancelled" };
        let content = "";
        let lastNote;
        let streamedContent = "";
        const activityLog = [];
        const originalAgentId = st.agentId;
        this.missionStore?.updateTaskStatus(missionId, st.id, "ready");
        await this.recordCollaboration({
          type: CollaborationEventTypes.ContractStatusChanged,
          missionId,
          payload: contractSnapshot(st, { status: "ready" })
        });
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          if (task.status === "cancelled") break;
          this.missionStore?.updateTaskStatus(missionId, st.id, "running");
          this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "running" });
          await this.recordCollaboration({
            type: CollaborationEventTypes.ContractClaimed,
            missionId,
            source: agentAddress(st.agentId || "unassigned"),
            payload: contractSnapshot(st, { status: "running", attempt })
          });
          await this.recordCollaboration({
            type: CollaborationEventTypes.ContractStatusChanged,
            missionId,
            source: agentAddress(st.agentId || "unassigned"),
            payload: contractSnapshot(st, { status: "running", attempt })
          });
          try {
            await refreshSharedContextLedger(`contract:${st.id}:attempt-${attempt}`);
            const contractContext = buildMissionContext(st, st.agentId || "unassigned", attempt === 1 ? "EXECUTE" : "PLAN");
            const contractPrompt = subtaskContractPrompt(st, contractContext);
            const prompt = attempt === 1 ? contractPrompt : retryPrompt(contractPrompt, lastNote);
            const forwardContractStream = (ev) => {
              if (!ev || ev.taskId !== task.id || ev.agentId !== st.agentId) return;
              if (ev.kind === "delta" && ev.channel === "content" && typeof ev.text === "string" && ev.text) {
                streamedContent = (streamedContent + ev.text).slice(-4e3);
                this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "running", contentDelta: ev.text });
              } else if (ev.kind === "activity" && ev.step) {
                activityLog.push([ev.step.kind, ev.step.label, ev.step.detail, ev.step.status].filter(Boolean).join(" | "));
                if (activityLog.length > 40) activityLog.shift();
                this.emit("stream", { kind: "orchestrate:activity", taskId: task.id, missionId, subtaskId: st.id, agentId: st.agentId, step: ev.step });
              } else if (ev.kind === "delta" && ev.channel === "thinking" && typeof ev.text === "string" && ev.text) {
                this.emit("stream", { kind: "orchestrate:activity", taskId: task.id, missionId, subtaskId: st.id, agentId: st.agentId, step: { id: `thinking-${st.id}`, kind: "thinking", label: "模型正在推理", detail: "收到推理流；为避免暴露私密推理链，仅显示状态。", status: "running" } });
              }
            };
            this.on("stream", forwardContractStream);
            let r;
            try {
              r = await this.sendToAgent(task, st.agentId, prompt, opts);
            } finally {
              this.off("stream", forwardContractStream);
            }
            if (r.error) {
              const decision2 = await this.assessSupervision(task, missionId, st, errorKind(r.error), {
                error: r.error,
                outputPreview: content.slice(0, 600)
              }, leadId, opts);
              this.emit("stream", { kind: "orchestrate:supervisor", taskId: task.id, missionId, subtaskId: st.id, decision: decision2 });
              await this.recordCollaboration({
                type: CollaborationEventTypes.SupervisorDecision,
                missionId,
                payload: { missionId, contractId: st.id, kind: errorKind(r.error), decision: decision2, error: r.error }
              });
              const takeoverAgent = alternateWorker(st.agentId);
              if (attempt < MAX_ATTEMPTS && takeoverAgent) {
                const previousAgent = st.agentId;
                st.agentId = takeoverAgent;
                lastNote = await setHandoffCapsule(st, {
                  fromAgent: previousAgent,
                  toAgent: takeoverAgent,
                  reason: `Previous worker failed or stalled: ${r.error}`,
                  previousContent: r.content || streamedContent || content,
                  previousError: r.error,
                  activityLog,
                  nextAction: "First inspect any partial files already present in the declared scope, then repair or complete the concrete deliverable. Do not only summarize the failure."
                });
                this.emit("stream", { kind: "orchestrate:supervisor", taskId: task.id, missionId, subtaskId: st.id, decision: { state: "stalled", action: "handoff", reason: `交给 ${agentName(takeoverAgent)} 接管修复`, confidence: 0.82, source: "rule" } });
                await this.recordCollaboration({
                  type: CollaborationEventTypes.SupervisorDecision,
                  missionId,
                  payload: { missionId, contractId: st.id, kind: "handoff_repair", from: previousAgent, to: takeoverAgent, reason: r.error }
                });
                continue;
              }
              if (attempt < MAX_ATTEMPTS && decision2.action !== "fail") {
                lastNote = await setHandoffCapsule(st, {
                  fromAgent: st.agentId,
                  toAgent: st.agentId,
                  reason: `Retry after worker failure: ${r.error}`,
                  previousContent: r.content || streamedContent || content,
                  previousError: r.error,
                  activityLog,
                  nextAction: "Retry the same contract using the existing workspace state. Produce a concrete artifact or verified result, not only a failure summary."
                });
                continue;
              }
              this.missionStore?.updateTaskStatus(missionId, st.id, decision2.action === "wait" ? "waiting" : "failed");
              await this.recordCollaboration({
                type: CollaborationEventTypes.ContractStatusChanged,
                missionId,
                source: agentAddress(st.agentId || "unassigned"),
                payload: contractSnapshot(st, { status: decision2.action === "wait" ? "waiting" : "failed", attempt, error: r.error })
              });
              await this.recordCollaboration({
                type: CollaborationEventTypes.ContractFailed,
                missionId,
                source: agentAddress(st.agentId || "unassigned"),
                payload: contractSnapshot(st, { status: "failed", attempt, error: r.error })
              });
              await this.recordUserNotification(missionId, "contract_failed", {
                taskId: task.id,
                contractId: st.id,
                title: st.title,
                agentId: st.agentId,
                attempt,
                error: r.error
              }, agentAddress(st.agentId || MAIN_AGENT_ID));
              this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "error", content: r.error });
              return { title: st.title, agentId: st.agentId, content: st.__handoffCapsule || "", error: r.error };
            }
            const rawWorkerContent = r.content || streamedContent || "";
            const workerEvidence = buildWorkerEvidence(opts.workspaceId, st, rawWorkerContent, streamedContent, activityLog);
            const deliveryEvidence = buildDeliveryEvidence(opts.workspaceId, text, st, rawWorkerContent);
            content = appendDeliveryEvidence(appendWorkerEvidence(rawWorkerContent, workerEvidence), deliveryEvidence);
            this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "done", content });
            const verifyContext = buildMissionContext(st, leadId, "PLAN");
            const verifyRaw = (await this.sendToAgent(task, leadId, verifyContext + "\n\n" + verifyPrompt(st.title, st.detail, content), { ...opts, systemPrompt: ORCHESTRATOR_LEAD_SYSTEM })).content;
            let v = parseVerdict(verifyRaw);
            if (!v.pass && deliveryEvidence.previews.length > 0 && /no result|artifact|empty|没有.*结果|没有.*产物|未提供.*结果|未提供.*产物/i.test(v.note || "")) {
              v = { pass: true, note: "Orbit detected a concrete workspace artifact and local preview URL." };
            }
            if (!v.pass && workerEvidence.files.length > 0 && /no result|artifact|empty|没有.*结果|没有.*产物|未提供.*结果|未提供.*产物|RESULT为空/i.test(v.note || "")) {
              v = { pass: true, note: "Orbit detected scoped workspace artifacts for this contract." };
            }
            this.emit("stream", { kind: "orchestrate:verdict", taskId: task.id, subtaskId: st.id, pass: v.pass, note: v.note, attempt });
            await this.recordCollaboration({
              type: CollaborationEventTypes.VerificationResult,
              missionId,
              payload: {
                missionId,
                contractId: st.id,
                agentId: st.agentId,
                pass: v.pass,
                note: v.note,
                attempt,
                outputPreview: content.slice(0, 600)
              }
            });
            if (v.pass) {
              this.missionStore?.updateTaskStatus(missionId, st.id, "done");
              await this.recordCollaboration({
                type: CollaborationEventTypes.ContractCompleted,
                missionId,
                source: agentAddress(st.agentId || "unassigned"),
                payload: contractSnapshot(st, { status: "done", attempt, outputPreview: content.slice(0, 800) })
              });
              await this.recordUserNotification(missionId, "contract_completed", {
                taskId: task.id,
                contractId: st.id,
                title: st.title,
                agentId: st.agentId,
                attempt
              }, agentAddress(st.agentId || MAIN_AGENT_ID));
              return { title: st.title, agentId: st.agentId, content };
            }
            const decision = await this.assessSupervision(task, missionId, st, "verification_failed", {
              verifierNote: v.note,
              outputPreview: content.slice(0, 800)
            }, leadId, opts);
            this.emit("stream", { kind: "orchestrate:supervisor", taskId: task.id, missionId, subtaskId: st.id, decision });
            await this.recordCollaboration({
              type: CollaborationEventTypes.SupervisorDecision,
              missionId,
              payload: { missionId, contractId: st.id, kind: "verification_failed", decision, verifierNote: v.note }
            });
            lastNote = v.note;
            if (attempt < MAX_ATTEMPTS) {
              const takeoverAgent = attempt >= 2 ? alternateWorker(st.agentId) : "";
              if (takeoverAgent) {
                const previousAgent = st.agentId;
                st.agentId = takeoverAgent;
                lastNote = await setHandoffCapsule(st, {
                  fromAgent: previousAgent,
                  toAgent: takeoverAgent,
                  reason: `Verification failed: ${v.note || "result did not meet the contract"}`,
                  previousContent: content,
                  verifierNote: v.note,
                  activityLog,
                  nextAction: "Inspect the existing partial output, repair it against the verifier note, and report exact files/commands."
                });
                this.emit("stream", { kind: "orchestrate:supervisor", taskId: task.id, missionId, subtaskId: st.id, decision: { state: "needs-rework", action: "handoff", reason: `校验未过，交给 ${agentName(takeoverAgent)} 接管修复`, confidence: 0.84, source: "rule" } });
                await this.recordCollaboration({
                  type: CollaborationEventTypes.SupervisorDecision,
                  missionId,
                  payload: { missionId, contractId: st.id, kind: "verification_handoff", from: previousAgent, to: takeoverAgent, verifierNote: v.note }
                });
              } else {
                lastNote = await setHandoffCapsule(st, {
                  fromAgent: st.agentId,
                  toAgent: st.agentId,
                  reason: `Retry after verification failed: ${v.note || "result did not meet the contract"}`,
                  previousContent: content,
                  verifierNote: v.note,
                  activityLog,
                  nextAction: "Retry the same contract. Fix the verifier note directly and report exact files/commands."
                });
              }
              continue;
            }
            if (decision.action === "fail" || attempt >= MAX_ATTEMPTS) {
              this.missionStore?.updateTaskStatus(missionId, st.id, "failed");
              await this.recordCollaboration({
                type: CollaborationEventTypes.ContractFailed,
                missionId,
                source: agentAddress(st.agentId || "unassigned"),
                payload: contractSnapshot(st, { status: "failed", attempt, error: "verification failed", verifierNote: v.note })
              });
              await this.recordUserNotification(missionId, "contract_failed", {
                taskId: task.id,
                contractId: st.id,
                title: st.title,
                agentId: st.agentId,
                attempt,
                error: "verification failed",
                verifierNote: v.note
              }, agentAddress(st.agentId || MAIN_AGENT_ID));
              return { title: st.title, agentId: st.agentId, content, error: "校验未通过: " + (v.note || "结果不达标") };
            }
          } catch (e) {
            const err = e?.message || String(e);
            const decision = await this.assessSupervision(task, missionId, st, errorKind(err), { error: err, outputPreview: content.slice(0, 600) }, leadId, opts);
            this.emit("stream", { kind: "orchestrate:supervisor", taskId: task.id, missionId, subtaskId: st.id, decision });
            await this.recordCollaboration({
              type: CollaborationEventTypes.SupervisorDecision,
              missionId,
              payload: { missionId, contractId: st.id, kind: errorKind(err), decision, error: err }
            });
            const takeoverAgent = alternateWorker(st.agentId);
            if (attempt < MAX_ATTEMPTS && takeoverAgent) {
              const previousAgent = st.agentId;
              st.agentId = takeoverAgent;
              lastNote = await setHandoffCapsule(st, {
                fromAgent: previousAgent,
                toAgent: takeoverAgent,
                reason: `Previous worker raised an exception: ${err}`,
                previousContent: streamedContent || content,
                previousError: err,
                activityLog,
                nextAction: "Take over and complete or repair the contract. Inspect partial work first, then produce a concrete artifact or exact blocker."
              });
              this.emit("stream", { kind: "orchestrate:supervisor", taskId: task.id, missionId, subtaskId: st.id, decision: { state: "stalled", action: "handoff", reason: `异常后交给 ${agentName(takeoverAgent)} 接管`, confidence: 0.8, source: "rule" } });
              continue;
            }
            this.missionStore?.updateTaskStatus(missionId, st.id, "failed");
            await this.recordCollaboration({
              type: CollaborationEventTypes.ContractFailed,
              missionId,
              source: agentAddress(st.agentId || "unassigned"),
              payload: contractSnapshot(st, { status: "failed", attempt, error: err })
            });
            await this.recordUserNotification(missionId, "contract_failed", {
              taskId: task.id,
              contractId: st.id,
              title: st.title,
              agentId: st.agentId,
              attempt,
              error: err
            }, agentAddress(st.agentId || MAIN_AGENT_ID));
            this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "error", content: err });
            return { title: st.title, agentId: st.agentId, content: st.__handoffCapsule || "", error: err };
          }
        }
        return { title: st.title, agentId: st.agentId || originalAgentId, content };
      };
      while (remaining.size > 0) {
        if (task.status === "cancelled") break;
        const blockedByFailed = Array.from(remaining.values()).filter((st) => st.dependsOn.some((dep) => failed.has(dep)));
        for (const st of blockedByFailed) {
          const failedDeps = st.dependsOn.filter((dep) => failed.has(dep));
          if (!st.__rescueAfterFailedDeps && !isFinalOnlyContract(st)) {
            st.__rescueAfterFailedDeps = true;
            const previousAgent = st.agentId;
            const rescueAgent = alternateWorker(st.agentId) || st.agentId || workerIds[0] || previousAgent;
            st.agentId = rescueAgent;
            st.dependsOn = st.dependsOn.filter((dep) => !failed.has(dep));
            st.detail = [
              st.detail,
              "",
              `Rescue mode: upstream contract(s) failed (${failedDeps.join(", ")}). Inspect available partial outputs and complete or repair the user-visible deliverable directly when possible. Do not only report that the dependency failed.`
            ].join("\n");
            st.interfaceRef = [
              st.interfaceRef || "",
              `Rescue takeover from failed dependency/dependencies: ${failedDeps.join(", ")}. Keep the shared Definition of Done.`
            ].filter(Boolean).join("\n");
            await setHandoffCapsule(st, {
              fromAgent: previousAgent,
              toAgent: rescueAgent,
              reason: `Dependency rescue after failed upstream contract(s): ${failedDeps.join(", ")}`,
              failedDeps,
              previousError: "upstream dependency failed",
              nextAction: "Inspect peer snapshots and existing workspace files from the failed dependency. Complete or repair the user-visible deliverable directly when possible; do not only report that the dependency failed."
            });
            this.missionStore?.updateTaskStatus(missionId, st.id, "ready");
            const rescueDecision = { state: "stalled", action: "handoff", reason: `上游失败，交给 ${agentName(rescueAgent)} 尝试接管修复`, confidence: 0.8, source: "rule" };
            this.emit("stream", { kind: "orchestrate:supervisor", taskId: task.id, missionId, subtaskId: st.id, decision: rescueDecision });
            await this.recordCollaboration({
              type: CollaborationEventTypes.SupervisorDecision,
              missionId,
              payload: { missionId, contractId: st.id, kind: "dependency_rescue", decision: rescueDecision, failedDeps, from: previousAgent, to: rescueAgent }
            });
            await this.recordCollaboration({
              type: CollaborationEventTypes.ContractStatusChanged,
              missionId,
              payload: contractSnapshot(st, { status: "ready", note: "rescue after failed dependency", failedDeps })
            });
            continue;
          }
          this.missionStore?.updateTaskStatus(missionId, st.id, "blocked");
          await this.recordCollaboration({
            type: CollaborationEventTypes.ContractStatusChanged,
            missionId,
            payload: contractSnapshot(st, { status: "blocked", error: "blocked by failed dependency" })
          });
          await this.recordCollaboration({
            type: CollaborationEventTypes.ContractFailed,
            missionId,
            payload: contractSnapshot(st, { status: "blocked", error: "blocked by failed dependency" })
          });
          await this.recordUserNotification(missionId, "contract_blocked", {
            taskId: task.id,
            contractId: st.id,
            title: st.title,
            agentId: st.agentId,
            error: "blocked by failed dependency"
          });
          this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "error", content: "上游依赖失败，任务被阻塞" });
          partsById.set(st.id, { title: st.title, agentId: st.agentId, content: st.__handoffCapsule || "", error: "blocked by failed dependency" });
          failed.add(st.id);
          remaining.delete(st.id);
        }
        const ready = Array.from(remaining.values()).filter((st) => st.dependsOn.every((dep) => finished.has(dep)));
        if (ready.length === 0) {
          for (const st of remaining.values()) {
            const decision = await this.assessSupervision(task, missionId, st, "dependency_wait", {
              dependencyStatuses: dependencyStatuses(st, finished, failed)
            }, leadId, opts);
            this.emit("stream", { kind: "orchestrate:supervisor", taskId: task.id, missionId, subtaskId: st.id, decision });
            await this.recordCollaboration({
              type: CollaborationEventTypes.SupervisorDecision,
              missionId,
              payload: { missionId, contractId: st.id, kind: "dependency_wait", decision, dependencyStatuses: dependencyStatuses(st, finished, failed) }
            });
            this.missionStore?.updateTaskStatus(missionId, st.id, "blocked");
            await this.recordCollaboration({
              type: CollaborationEventTypes.ContractStatusChanged,
              missionId,
              payload: contractSnapshot(st, { status: "blocked", error: "dependency cycle or unresolved dependency" })
            });
            partsById.set(st.id, { title: st.title, agentId: st.agentId, content: "", error: "dependency cycle or unresolved dependency" });
            failed.add(st.id);
            remaining.delete(st.id);
          }
          break;
        }
        const readyWave = pickReadyWave(ready);
        const wave = await Promise.all(readyWave.map(runContract));
        reactorRound += 1;
        const waveResults = [];
        for (let i = 0; i < readyWave.length; i++) {
          const st = readyWave[i];
          const part = wave[i];
          partsById.set(st.id, part);
          const status = part.error ? "failed" : "done";
          st.status = status;
          artifact.taskDag.nodes = artifact.taskDag.nodes.map((node) => node.id === st.id ? { ...node, status, updatedAt: (/* @__PURE__ */ new Date()).toISOString() } : node);
          const evidence = buildDeliveryEvidence(opts.workspaceId, text, st, part.content || "");
          const scopedEvidence = buildWorkerEvidence(opts.workspaceId, st, part.content || "", "", []);
          const artifactLinks = Array.from(/* @__PURE__ */ new Set([
            ...evidence.previews.map((item) => item.url),
            ...scopedEvidence.files.map((item) => item.url).filter(Boolean)
          ]));
          artifactRegistry.push({
            contractId: st.id,
            title: st.title,
            agentId: part.agentId || st.agentId,
            status,
            links: artifactLinks,
            error: part.error || ""
          });
          waveResults.push({
            id: st.id,
            title: st.title,
            agentId: part.agentId || st.agentId,
            status,
            error: part.error || "",
            summary: contextLine(part.content || "", 260)
          });
          if (part.error) failed.add(st.id);
          else finished.add(st.id);
          remaining.delete(st.id);
        }
        artifact = {
          ...artifact,
          status: rollupPlanStatus(artifact.status, artifact.taskDag.nodes),
          summary: summarizeContracts(artifact.taskDag.nodes),
          taskDag: { nodes: artifact.taskDag.nodes, edges: buildDagEdges(artifact.taskDag.nodes) },
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        task.planArtifact = artifact;
        this.missionStore?.upsertPlan(artifact);
        reactorWaves.push({ round: reactorRound, results: waveResults });
        if (reactorWaves.length > 10) reactorWaves.shift();
        await refreshSharedContextLedger(`wave:${reactorRound}:complete`);
        emitPlanSnapshot({ reactorRound, sharedContextPath: sharedContextLedger?.path });
        if (remaining.size > 0 && task.status !== "cancelled" && replanRounds < maxReplanRounds) {
          replanRounds += 1;
          const stateSummary = buildReactorStateSummary({
            round: reactorRound,
            waves: reactorWaves,
            artifacts: artifactRegistry,
            finishedCount: finished.size,
            failedCount: failed.size,
            remainingCount: remaining.size
          });
          leadActivity({
            id: `reactor-observe-${reactorRound}`,
            kind: "observe",
            label: "主 Agent 观察执行波次",
            detail: `第 ${reactorRound} 轮完成 ${waveResults.length} 个合同，正在判断是否需要动态重规划。`,
            status: "running"
          });
          const replanContext = buildMissionContext(null, leadId, "PLAN");
          const raw = await this.sendToAgent(task, leadId, replanContext + "\n\n" + reactorReplanPrompt(text, artifact, stateSummary), { ...opts, systemPrompt: ORCHESTRATOR_LEAD_SYSTEM });
          if (raw.error) {
            await this.recordCollaboration({
              type: CollaborationEventTypes.SupervisorDecision,
              missionId,
              source: agentAddress(leadId),
              payload: { missionId, kind: "reactor_replan_failed", error: raw.error, reactorRound }
            });
          } else {
            const decision = parseReactorDecision(raw.content);
            const changed = await applyReactorDecision(decision, stateSummary);
            reactorWaves[reactorWaves.length - 1].note = decision.summary || (changed ? "Plan revised." : "Plan unchanged.");
            leadActivity({
              id: `reactor-replan-${reactorRound}`,
              kind: "plan",
              label: changed ? "主 Agent 已动态修订计划" : "主 Agent 保持当前计划",
              detail: decision.summary || (changed ? "已添加或修订后续合同。" : "当前合同继续执行。"),
              status: "done"
            });
          }
        }
      }
      if (task.status === "cancelled") return;
      const parts = artifact.taskDag.nodes.map((st) => partsById.get(st.id) || { title: st.title, agentId: st.agentId, content: "", error: "not executed" });
      const missionDeliveryEvidence = buildDeliveryEvidence(opts.workspaceId, text, { title: "Mission deliverable", detail: text }, parts.map((p) => [p.title, p.content, p.error].filter(Boolean).join("\n")).join("\n\n"));
      const synthesisParts = missionDeliveryEvidence.block ? parts.concat([{ title: "Orbit 自动交付检测", agentId: leadId, content: missionDeliveryEvidence.block }]) : parts;
      this.emit("stream", { kind: "orchestrate:synthesizing", taskId: task.id });
      await this.recordCollaboration({
        type: CollaborationEventTypes.SynthesisStarted,
        missionId,
        source: agentAddress(leadId),
        payload: { missionId, taskId: task.id, leadAgentId: leadId, failedTaskIds: Array.from(failed) }
      });
      const synthesisContract = {
        id: "synthesis",
        title: "Synthesize mission result",
        detail: "Merge worker outputs, channel history, verification results and blockers into the final answer.",
        agentId: leadId,
        fileScope: [],
        dependsOn: artifact.taskDag.nodes.map((node) => node.id),
        doneWhen: "final answer is coherent and names failures or follow-up work",
        verifyCommand: "",
        interfaceRef: "mission final response",
        status: "running"
      };
      await refreshSharedContextLedger("synthesizing");
      const synthesisContext = buildMissionContext(synthesisContract, leadId, "PLAN");
      const synth = await this.sendToAgent(task, leadId, synthesisContext + "\n\n" + synthesisPrompt(text, synthesisParts, this.workspaceContextFor(opts.workspaceId)), { ...opts, systemPrompt: ORCHESTRATOR_LEAD_SYSTEM });
      if (synth.error) throw new Error("汇总阶段失败: " + synth.error);
      this.emit("stream", { kind: "orchestrate:final", taskId: task.id, content: synth.content });
      task.results.set("orchestrate", synth.content);
      this.missionStore?.setPlanStatus(missionId, failed.size ? "failed" : "completed");
      artifact = setPlanStatus(artifact, failed.size ? "failed" : "completed");
      task.planArtifact = artifact;
      await refreshSharedContextLedger(failed.size ? "failed" : "completed");
      await this.recordCollaboration({
        type: CollaborationEventTypes.SynthesisCompleted,
        missionId,
        source: agentAddress(leadId),
        payload: { missionId, taskId: task.id, leadAgentId: leadId, summary: synth.content.slice(0, 1e3) }
      });
      const outcome = this.missionStore?.recordOutcome({
        missionId,
        goal: text,
        status: failed.size ? "failed" : "completed",
        summary: synth.content.slice(0, 600) || (failed.size ? "Mission completed with failed contracts." : "Mission completed."),
        lessons: extractLessons(synth.content),
        blockers: parts.filter((p) => p.error).map((p) => `${p.title}: ${p.error}`).slice(0, 8),
        verified: failed.size === 0,
        taskCount: artifact.taskDag.nodes.length,
        failedTaskIds: Array.from(failed),
        resultPreview: synth.content.slice(0, 1200)
      });
      const evolution = this.missionStore?.recordMainAgentEvolution({
        missionId,
        goal: text,
        status: failed.size ? "failed" : "completed",
        summary: synth.content.slice(0, 600),
        lessons: extractLessons(synth.content),
        blockers: parts.filter((p) => p.error).map((p) => `${p.title}: ${p.error}`).slice(0, 8),
        verified: failed.size === 0,
        resultPreview: synth.content.slice(0, 1200),
        artifacts: missionDeliveryEvidence.previews.map((item) => `${item.rel} -> ${item.url}`)
      });
      if (evolution) {
        await this.recordCollaboration({
          type: CollaborationEventTypes.MemoryUpdated,
          missionId,
          source: agentAddress(leadId),
          payload: {
            source: "orbit-main-agent-evolution",
            geneId: evolution.gene.id,
            capsuleId: evolution.capsule.id,
            eventId: evolution.event.id,
            policyVersion: evolution.policy.version,
            strategy: evolution.gene.strategy
          },
          metadata: { role: "main-agent-evolution" }
        });
      }
      await this.recordCollaboration({
        type: CollaborationEventTypes.OutcomeRecorded,
        missionId,
        payload: outcome || {
          missionId,
          status: failed.size ? "failed" : "completed",
          summary: synth.content.slice(0, 600),
          failedTaskIds: Array.from(failed)
        }
      });
      await this.recordUserNotification(missionId, failed.size ? "mission_failed" : "mission_completed", {
        taskId: task.id,
        status: failed.size ? "failed" : "completed",
        failedTaskIds: Array.from(failed),
        summary: synth.content.slice(0, 800)
      });
      task.status = "completed";
    } catch (e) {
      if (task.missionId && task.status !== "cancelled") {
        this.missionStore?.setPlanStatus(task.missionId, "failed");
        const outcome = this.missionStore?.recordOutcome({
          missionId: task.missionId,
          goal: text,
          status: "failed",
          summary: e?.message || String(e),
          blockers: [e?.message || String(e)],
          verified: false,
          taskCount: task.planArtifact?.taskDag.nodes.length || 0,
          failedTaskIds: task.planArtifact?.taskDag.nodes.filter((node) => node.status === "failed" || node.status === "blocked").map((node) => node.id) || []
        });
        const evolution = this.missionStore?.recordMainAgentEvolution({
          missionId: task.missionId,
          goal: text,
          status: "failed",
          summary: e?.message || String(e),
          lessons: [`失败经验：${e?.message || String(e)}`],
          blockers: [e?.message || String(e)],
          verified: false,
          resultPreview: e?.message || String(e),
          artifacts: []
        });
        if (evolution) {
          await this.recordCollaboration({
            type: CollaborationEventTypes.MemoryUpdated,
            missionId: task.missionId,
            source: agentAddress(MAIN_AGENT_ID),
            payload: {
              source: "orbit-main-agent-evolution",
              geneId: evolution.gene.id,
              capsuleId: evolution.capsule.id,
              eventId: evolution.event.id,
              policyVersion: evolution.policy.version,
              strategy: evolution.gene.strategy
            },
            metadata: { role: "main-agent-evolution" }
          });
        }
        await this.recordCollaboration({
          type: CollaborationEventTypes.OutcomeRecorded,
          missionId: task.missionId,
          payload: outcome || { missionId: task.missionId, status: "failed", summary: e?.message || String(e) }
        });
        await this.recordUserNotification(task.missionId, "mission_failed", {
          taskId: task.id,
          status: "failed",
          error: e?.message || String(e)
        });
      }
      this.emit("stream", { kind: "orchestrate:error", taskId: task.id, error: e?.message || String(e) });
      throw e;
    }
  }
  async sendToAgent(task, agentId, text, opts) {
    const mgr = getProviderManager();
    const resolved = mgr.resolveBinding(agentId);
    const agentInfo = this.registry.get(agentId);
    if (agentInfo && agentInfo.adapter.protocol === "acp") {
      return this.sendToAgentAcp(task, agentId, text, opts, agentInfo.adapter);
    }
    if (agentInfo && agentInfo.adapter.protocol && agentInfo.adapter.protocol !== "http") {
      const binding = mgr.getBinding(agentId);
      return this.sendToAgentStdio(task, agentId, text, opts, resolved, agentInfo.adapter, binding);
    }
    if (!resolved) {
      const err = "No available provider for agent " + agentId;
      task.errors.set(agentId, err);
      this.emit("stream", { kind: "error", taskId: task.id, agentId, error: err });
      return { content: "", error: err };
    }
    this.registry.setStatus(agentId, "busy");
    const messages = [{ role: "user", content: text }];
    const client = buildProviderClient(resolved);
    const systemPrompt = this.systemPromptFor(agentId, opts.systemPrompt, text, opts.workspaceId);
    const thinking = opts.thinking || resolved.thinking;
    if (isHttpAgenticEnabled(agentId)) {
      return this.runAgenticHttpBranch(task, agentId, text, systemPrompt, thinking, resolved, opts);
    }
    let content = "";
    let thinkingTxt = "";
    let summary = void 0;
    let usage = void 0;
    const start = Date.now();
    this.emit("stream", {
      kind: "start",
      taskId: task.id,
      agentId,
      providerId: resolved.provider.id,
      modelId: resolved.model.id,
      mode: "content"
    });
    try {
      await this.pipeline.process(text, agentId);
      await new Promise((resolve, reject) => {
        client.stream(
          { messages, systemPrompt, thinkingOverride: thinking },
          {
            onContent: (delta) => {
              content += delta;
              this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId: resolved.provider.id, modelId: resolved.model.id, channel: "content", text: delta });
            },
            onThinking: (delta) => {
              thinkingTxt += delta;
              this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId: resolved.provider.id, modelId: resolved.model.id, channel: "thinking", text: delta });
            },
            onDone: (final) => {
              summary = final.thinking;
              usage = final.usage;
              resolve();
            },
            onError: (err) => reject(err)
          }
        );
      });
      task.results.set(agentId, content);
      task.thinking.set(agentId, thinkingTxt);
      if (summary) task.thinkingSummary.set(agentId, summary);
      this.emit("stream", {
        kind: "done",
        taskId: task.id,
        agentId,
        providerId: resolved.provider.id,
        modelId: resolved.model.id,
        content,
        thinking: thinkingTxt,
        summary,
        usage,
        durationMs: Date.now() - start
      });
      task.usage.set(agentId, usage);
      return { content };
    } catch (e) {
      task.errors.set(agentId, e.message);
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId: resolved.provider.id, modelId: resolved.model.id, error: e.message });
      return { content, error: e.message };
    } finally {
      this.registry.setStatus(agentId, "idle");
    }
  }
  systemPromptFor(agentId, overridePrompt, taskText = "", workspaceId) {
    if (overridePrompt) return overridePrompt;
    const base = buildAgentRuntimeSystemPrompt(agentId, agentSystemPrompt(agentId), this.memoryContext(), taskText, this.skillsBlockFor(agentId));
    const ws = this.workspaceContextFor(workspaceId);
    return ws ? base + "\n\n" + ws : base;
  }
  promptForAgent(agentId, text, workspaceId) {
    const base = buildAgentTaskPrompt(agentId, text, this.memoryContext(), this.skillsBlockFor(agentId));
    const ws = this.workspaceContextFor(workspaceId);
    return ws ? ws + "\n\n" + base : base;
  }
  // --- AgentHub workspace bootstrap：把工作区 bootstrapFiles 作为项目级上下文拼入 prompt（全 agent 通用） ---
  workspaceContextFor(workspaceId) {
    try {
      return getWorkspaceManager().bootstrapContext(workspaceId ?? null);
    } catch {
      return "";
    }
  }
  // --- /AgentHub workspace bootstrap ---
  // --- AgentHub skills (Claude-B 新增): 取目标 agent 已装技能拼成注入块 ---
  skillsBlockFor(agentId) {
    try {
      return buildSkillBlock(getSkillManager().installedFor(agentId));
    } catch {
      return "";
    }
  }
  // --- /AgentHub skills ---
  async assessSupervision(task, missionId, contract, kind, patch, leadAgentId, opts) {
    return this.supervisor.assess({
      missionId,
      contract,
      kind,
      elapsedMs: Date.now() - task.createdAt.getTime(),
      ...patch
    }, (prompt) => this.callSupervisorLLM(leadAgentId, prompt, opts));
  }
  async callSupervisorLLM(agentId, prompt, opts) {
    try {
      const agentInfo = this.registry.get(agentId);
      if (agentInfo && agentInfo.adapter.protocol && agentInfo.adapter.protocol !== "http") return void 0;
      const resolved = getProviderManager().resolveBinding(agentId);
      if (!resolved) return void 0;
      const client = buildProviderClient(resolved);
      let content = "";
      await new Promise((resolve, reject) => {
        client.stream(
          {
            messages: [{ role: "user", content: prompt }],
            systemPrompt: "You are a lightweight supervisor. Return only the requested JSON.",
            thinkingOverride: { mode: "off", level: "minimal" },
            signal: AbortSignal.timeout(2e4)
          },
          {
            onContent: (delta) => {
              content += delta;
            },
            onDone: () => resolve(),
            onError: (err) => reject(err)
          }
        );
      });
      return content;
    } catch {
      return void 0;
    }
  }
  // --- AgentHub native agentic 工具回环（Claude-B 新增） ---
  // HTTP agent 开启 agentic 后：用 AgentHub 自带工具回环替代纯聊天流，让模型真在工作区
  // 读写文件、跑命令；每步发 activity 事件复用既有步骤卡。自管 start/done/error 与 registry。
  async runAgenticHttpBranch(task, agentId, userText, systemPrompt, thinking, resolved, opts) {
    const providerId = resolved.provider.id;
    const modelId = resolved.model.id;
    let root = null;
    const wsId = opts.workspaceId ?? null;
    if (wsId) {
      try {
        root = getWorkspaceManager().getById(wsId)?.rootPath ?? null;
      } catch {
        root = null;
      }
    }
    const start = Date.now();
    this.emit("stream", { kind: "start", taskId: task.id, agentId, providerId, modelId, mode: "content" });
    try {
      const res = await runAgenticHttp({
        userText,
        systemPrompt,
        resolved,
        thinking,
        root,
        agentId,
        policyFor: (tool) => getApprovalConfig().policyFor(agentId, tool),
        requestApproval: (req) => this.requestApprovalFor(task, agentId, req),
        isCancelled: () => task.status === "cancelled",
        emit: {
          delta: (channel, textDelta) => this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId, modelId, channel, text: textDelta }),
          activity: (step) => this.emit("stream", { kind: "activity", taskId: task.id, agentId, step })
        }
      });
      if (res.error) {
        task.errors.set(agentId, res.error);
        this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: res.error });
        return { content: res.content || "", error: res.error };
      }
      task.results.set(agentId, res.content);
      if (res.usage) task.usage.set(agentId, res.usage);
      this.emit("stream", { kind: "done", taskId: task.id, agentId, providerId, modelId, content: res.content, usage: res.usage, durationMs: Date.now() - start });
      return { content: res.content };
    } catch (e) {
      task.errors.set(agentId, e.message);
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: e.message });
      return { content: "", error: e.message };
    } finally {
      this.registry.setStatus(agentId, "idle");
    }
  }
  // --- /AgentHub native agentic ---
  memoryContext() {
    try {
      return this.memoryProvider() || [];
    } catch {
      return [];
    }
  }
  cancel(taskId) {
    const task = this.tasks.get(taskId);
    if (task && task.status === "running") {
      task.status = "cancelled";
      const planApproval = this.pendingPlanApprovals.get(taskId);
      if (planApproval) {
        this.pendingPlanApprovals.delete(taskId);
        planApproval.resolve(false);
      }
      for (const [id, p] of this.pendingApprovals) {
        if (id.startsWith(`appr-${taskId}-`)) {
          clearTimeout(p.timer);
          this.pendingApprovals.delete(id);
          p.resolve(false);
        }
      }
      return true;
    }
    return false;
  }
  resolvePlanApproval(taskId, approved) {
    const pending = this.pendingPlanApprovals.get(taskId);
    if (!pending) return false;
    this.pendingPlanApprovals.delete(taskId);
    pending.resolve(approved);
    return true;
  }
  waitForPlanApproval(taskId) {
    return new Promise((resolve) => {
      this.pendingPlanApprovals.set(taskId, { resolve });
    });
  }
  /** 渲染层审批决策回传：true=放行，false=拒绝。返回是否命中一个待决请求（用于 IPC 反馈）。 */
  resolveApproval(requestId, approved) {
    const p = this.pendingApprovals.get(requestId);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pendingApprovals.delete(requestId);
    p.resolve(approved);
    return true;
  }
  /** 发起一次写/执行审批：emit approval 事件 + 注册待决 Promise（超时自动拒绝）。 */
  requestApprovalFor(task, agentId, req) {
    const requestId = `appr-${task.id}-${++this.approvalSeq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingApprovals.delete(requestId)) resolve(false);
      }, APPROVAL_TIMEOUT_MS);
      this.pendingApprovals.set(requestId, { resolve, timer });
      this.emit("stream", {
        kind: "approval",
        taskId: task.id,
        agentId,
        request: { id: requestId, tool: req.tool, toolName: req.toolName, label: req.label, detail: req.detail }
      });
    });
  }
  getTask(taskId) {
    return this.tasks.get(taskId);
  }
  getRecentTasks(limit = 20) {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }
  /** Stdio路径: 通过本地 CLI 子进程向 agent 发 prompt, 收集 stdout 作为 stream 内容.
   * oneshot 适配器（codex exec / claude --print）以进程退出为完成信号;
   * interactive 适配器保留输出静默判定; 任务被取消时 kill 子进程.
   * 注意: stdio 不依赖 HTTP provider, resolved 可为 null.
   */
  async sendToAgentStdio(task, agentId, text, opts, resolved, adapter, binding) {
    this.registry.setStatus(agentId, "busy");
    let content = "";
    const providerId = binding?.providerId ?? resolved?.provider?.id ?? "local-cli";
    const modelId = binding?.modelId ?? resolved?.model?.id ?? "stdio";
    this.emit("stream", { kind: "start", taskId: task.id, agentId, providerId, modelId, mode: "content" });
    const start = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1e3;
    const POLL_MS = 200;
    const STARTUP_SILENCE_MS = 60 * 1e3;
    const IDLE_AFTER_OUTPUT_MS = 45 * 1e3;
    const procField = "proc";
    const self = this;
    let settled = false;
    let spawnedOnce = false;
    let sawActivity = false;
    const cleanup = () => {
      adapter.onOutput = null;
      adapter.onError = null;
      adapter.onActivity = null;
    };
    try {
      let agentPrompt = this.promptForAgent(agentId, text, opts.workspaceId);
      if (thinkingRequested(opts.thinking)) agentPrompt = STDIO_THINKING_DIRECTIVE + "\n\n" + agentPrompt;
      let cwd = null;
      const wsId = opts.workspaceId ?? null;
      if (wsId) {
        const ws = getWorkspaceManager().getById(wsId);
        if (ws?.rootPath) cwd = ws.rootPath;
        else agentPrompt = "[AgentHub 提示] 指定的工作区不存在或已被删除；本次派发将在 home 目录运行（agent 看不到项目文件）。\n\n" + agentPrompt;
      }
      await this.pipeline.process(agentPrompt, agentId);
      await new Promise((resolveP, rejectP) => {
        let lastOutputAt = Date.now();
        const onChunk = (chunk) => {
          content += chunk;
          lastOutputAt = Date.now();
          self.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId, modelId, channel: "content", text: chunk });
        };
        const onErr = (err) => {
          if (settled) return;
          settled = true;
          clearInterval(poll);
          cleanup();
          rejectP(err);
        };
        const onAct = (step) => {
          if (settled || !step) return;
          lastOutputAt = Date.now();
          sawActivity = true;
          self.emit("stream", { kind: "activity", taskId: task.id, agentId, step });
        };
        adapter.onOutput = onChunk;
        adapter.onError = onErr;
        adapter.onActivity = onAct;
        adapter.start().then(() => {
          try {
            adapter.send(agentPrompt, { cwd });
            spawnedOnce = true;
          } catch (e) {
            onErr(e);
          }
        }).catch(onErr);
        const poll = setInterval(() => {
          if (settled) return;
          const proc = adapter[procField];
          const idle = Date.now() - lastOutputAt;
          const elapsed = Date.now() - start;
          const hasOutput = content.length > 0 || sawActivity;
          const procGone = spawnedOnce && !proc;
          const quietDone = hasOutput && idle > IDLE_AFTER_OUTPUT_MS;
          const stalledNoOutput = spawnedOnce && !hasOutput && elapsed > STARTUP_SILENCE_MS;
          const timedOut = elapsed > TIMEOUT_MS;
          const cancelled = task.status === "cancelled";
          if (procGone || quietDone || stalledNoOutput || timedOut || cancelled) {
            settled = true;
            clearInterval(poll);
            cleanup();
            if (cancelled || timedOut || stalledNoOutput) {
              try {
                adapter.stop();
              } catch {
              }
            }
            if (stalledNoOutput) {
              rejectP(new Error(`本地 CLI 启动 ${Math.round(STARTUP_SILENCE_MS / 1e3)}s 无任何输出，疑似无法用于非交互直连（GUI/REPL）。建议改用 HTTP 绑定。`));
              return;
            }
            if (timedOut) {
              rejectP(new Error("本地 CLI 执行超时（5 分钟）" + (hasOutput ? "，仅收到部分输出" : "")));
              return;
            }
            resolveP();
          }
        }, POLL_MS);
      });
      task.results.set(agentId, content);
      this.emit("stream", { kind: "done", taskId: task.id, agentId, providerId, modelId, content, durationMs: Date.now() - start });
      return { content };
    } catch (e) {
      task.errors.set(agentId, e.message);
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: e.message });
      return { content, error: e.message };
    } finally {
      try {
        await adapter.stop();
      } catch {
      }
      this.registry.setStatus(agentId, "idle");
    }
  }
  /**
   * ACP 路径：常驻 server，靠 session/prompt 的 stopReason 判完成（不像 stdio oneshot 靠进程退出）。
   * session/update 通知经 adapter.runPrompt 的 handlers 透传为 delta(content/thinking) + activity 步骤。
   * 取消：轮询 task.status，cancelled 时发 session/cancel。每轮结束 stop() 杀掉 server（第一阶段不复用）。
   */
  async sendToAgentAcp(task, agentId, text, opts, adapter) {
    this.registry.setStatus(agentId, "busy");
    const providerId = "local-acp";
    const modelId = "acp";
    this.emit("stream", { kind: "start", taskId: task.id, agentId, providerId, modelId, mode: "content" });
    const start = Date.now();
    let content = "";
    let agentPrompt = this.promptForAgent(agentId, text, opts.workspaceId);
    if (thinkingRequested(opts.thinking)) agentPrompt = STDIO_THINKING_DIRECTIVE + "\n\n" + agentPrompt;
    let cwd = node_os.homedir();
    const wsId = opts.workspaceId ?? null;
    if (wsId) {
      const ws = getWorkspaceManager().getById(wsId);
      if (ws?.rootPath) cwd = ws.rootPath;
      else agentPrompt = "[AgentHub 提示] 指定的工作区不存在或已被删除；本次派发将在 home 目录运行（agent 看不到项目文件）。\n\n" + agentPrompt;
    }
    const cancelPoll = setInterval(() => {
      if (task.status === "cancelled") {
        try {
          adapter.cancel();
        } catch {
        }
      }
    }, 300);
    try {
      await this.pipeline.process(agentPrompt, agentId);
      const stopReason = await adapter.runPrompt(agentPrompt, cwd, {
        onChunk: (t) => {
          content += t;
          this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId, modelId, channel: "content", text: t });
        },
        onThought: (t) => this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId, modelId, channel: "thinking", text: t }),
        onActivity: (step) => this.emit("stream", { kind: "activity", taskId: task.id, agentId, step }),
        onRequestPermission: (req) => this.requestAcpPermission(task, agentId, req)
      });
      if (task.status === "cancelled") return { content };
      if (stopReason === "refusal" && !content) {
        const err = "ACP agent 拒绝了本次请求（refusal）";
        task.errors.set(agentId, err);
        this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: err });
        return { content: "", error: err };
      }
      task.results.set(agentId, content);
      this.emit("stream", { kind: "done", taskId: task.id, agentId, providerId, modelId, content, durationMs: Date.now() - start });
      return { content };
    } catch (e) {
      const err = e?.message || String(e);
      task.errors.set(agentId, err);
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: err });
      return { content, error: err };
    } finally {
      clearInterval(cancelPoll);
      try {
        await adapter.stop();
      } catch {
      }
      this.registry.setStatus(agentId, "idle");
    }
  }
  async requestAcpPermission(task, agentId, req) {
    if (!req?.tool) return true;
    const stepId = String(
      req.raw?.toolCall?.toolCallId || req.raw?.toolCall?.id || req.raw?.toolCallId || `acp-perm-${task.id}-${++this.approvalSeq}`
    );
    const tool = req.tool;
    const toolName = req.toolName || (tool === "exec" ? "exec" : "fs_write");
    const label = req.label || toolName;
    const detail = req.detail || "";
    const policy = getApprovalConfig().policyFor(agentId, tool);
    if (policy === "allow") return true;
    if (policy === "deny") {
      this.emit("stream", {
        kind: "activity",
        taskId: task.id,
        agentId,
        step: {
          id: stepId,
          kind: "tool",
          tool: toolName,
          label,
          detail,
          output: `Rejected by approval policy: '${tool}' is denied for this agent.`,
          status: "error"
        }
      });
      return false;
    }
    this.emit("stream", {
      kind: "activity",
      taskId: task.id,
      agentId,
      step: { id: stepId, kind: "tool", tool: toolName, label, detail, status: "awaiting" }
    });
    const approved = await this.requestApprovalFor(task, agentId, { stepId, agentId, tool, toolName, label, detail });
    if (!approved) {
      this.emit("stream", {
        kind: "activity",
        taskId: task.id,
        agentId,
        step: {
          id: stepId,
          kind: "tool",
          tool: toolName,
          label,
          detail,
          output: "Rejected by user (approval denied).",
          status: "error"
        }
      });
    }
    return approved;
  }
}
function errorKind(error) {
  return /timeout|timed out|无任何输出|卡死|stalled|idle|no output/i.test(error || "") ? "stall" : "worker_error";
}
function dependencyStatuses(st, finished, failed) {
  const out = {};
  for (const dep of st.dependsOn) out[dep] = failed.has(dep) ? "failed" : finished.has(dep) ? "done" : "pending";
  return out;
}
function contractSnapshot(contract, patch = {}) {
  return {
    contractId: contract.id,
    title: contract.title,
    agentId: contract.agentId,
    status: contract.status,
    fileScope: contract.fileScope,
    dependsOn: contract.dependsOn,
    doneWhen: contract.doneWhen,
    verifyCommand: contract.verifyCommand,
    interfaceRef: contract.interfaceRef,
    ...patch
  };
}
function extractLessons(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.replace(/^[-*]\s*/, "").trim()).filter((line) => /lesson|经验|教训|注意|下次|风险|risk/i.test(line)).slice(0, 8);
}
const EXTRA_PROBES = [
  { id: "aider", name: "Aider", binary: "aider", caps: ["coding", "pair-programming"] },
  { id: "goose", name: "Goose", binary: "goose", caps: ["automation", "coding"] },
  { id: "gemini", name: "Gemini CLI", binary: "gemini", caps: ["analysis", "coding"] },
  { id: "copilot", name: "Copilot CLI", binary: "copilot", caps: ["coding", "cli"] }
];
const CLI_PROBES = [
  ...AGENTS.filter((a) => a.probeBinary && !DISABLED_AGENT_ID_SET.has(a.id)).map((a) => ({ id: a.id, name: a.name, binary: a.probeBinary, caps: a.caps })),
  ...EXTRA_PROBES
];
function probe(probe2) {
  try {
    const out = child_process.execFileSync(probe2.binary, ["--version"], {
      timeout: 3e3,
      encoding: "utf-8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const version = out.trim().split(/\r?\n/)[0];
    let binaryPath = probe2.binary;
    try {
      const locator = process.platform === "win32" ? "where" : "which";
      binaryPath = child_process.execFileSync(locator, [probe2.binary], {
        timeout: 2e3,
        encoding: "utf-8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"]
      }).trim().split(/\r?\n/)[0].trim();
    } catch {
    }
    return { id: probe2.id, name: probe2.name, found: true, version, path: binaryPath, capabilities: probe2.caps };
  } catch {
    return { id: probe2.id, name: probe2.name, found: false, capabilities: probe2.caps };
  }
}
function detectAgents() {
  const mgr = getProviderManager();
  const bindings = mgr.getBindings();
  const agents = bindings.map((b) => {
    const resolved = mgr.resolveBinding(b.agentId);
    const provider = resolved && resolved.provider;
    const health = provider && provider.health;
    return {
      id: b.agentId,
      name: agentName(b.agentId),
      found: !!provider && provider.enabled && !!provider.apiKey,
      capabilities: agentCaps(b.agentId),
      providerId: provider && provider.id,
      modelId: resolved && resolved.model.id,
      baseUrl: provider && provider.baseUrl,
      reachable: health && health.reachable,
      latencyMs: health && health.latencyMs,
      error: health && health.error
    };
  });
  return agents.concat(CLI_PROBES.map(probe));
}
async function detectAgentsAsync() {
  const mgr = getProviderManager();
  for (const p of mgr.getEnabledProviders()) {
    await mgr.checkProviderHealth(p.id);
  }
  return detectAgents();
}
const BREAK_AFTER_FAILS = 3;
const BREAK_FOR_MS = 6e4;
class LocalProxy extends events.EventEmitter {
  server = null;
  port;
  /** 熔断状态：providerId → 连续失败次数/恢复时间 */
  breaker = /* @__PURE__ */ new Map();
  constructor(port = 9528) {
    super();
    this.port = port;
  }
  start() {
    return new Promise((resolve, reject) => {
      this.server = http__namespace.createServer((req, res) => this.handle(req, res));
      this.server.on("error", reject);
      this.server.listen(this.port, "127.0.0.1", () => {
        console.log("[Proxy] OpenAI 兼容: http://127.0.0.1:" + this.port + "/v1 · Anthropic 兼容: http://127.0.0.1:" + this.port);
        resolve();
      });
    });
  }
  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
  getUrl() {
    return "http://127.0.0.1:" + this.port + "/v1";
  }
  /** Anthropic SDK 会自行拼 /v1/messages，所以 base 是源站地址 */
  getOrigin() {
    return "http://127.0.0.1:" + this.port;
  }
  async handle(req, res) {
    const url$1 = new url.URL(req.url || "/", "http://127.0.0.1:" + this.port);
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    const isLocalOrigin = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    const cors = {
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,x-api-key,anthropic-version,anthropic-beta",
      "access-control-max-age": "86400",
      "vary": "Origin"
    };
    if (origin && isLocalOrigin) cors["access-control-allow-origin"] = origin;
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (!isLocalOrigin) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "forbidden: cross-site origin not allowed" } }));
      return;
    }
    for (const k of Object.keys(cors)) res.setHeader(k, cors[k]);
    try {
      if (url$1.pathname === "/v1/models" && req.method === "GET") return this.listModels(res);
      if (url$1.pathname === "/v1/providers" && req.method === "GET") return this.listProviders(res);
      if (url$1.pathname === "/v1/chat/completions" && req.method === "POST") return this.chatCompletions(req, res, false);
      if (url$1.pathname === "/v1/chat/completions/no-stream" && req.method === "POST") return this.chatCompletions(req, res, true);
      if (url$1.pathname === "/v1/messages" && req.method === "POST") return this.anthropicMessages(req, res);
      if (url$1.pathname === "/v1/messages/count_tokens" && req.method === "POST") return this.countTokens(req, res);
      if (url$1.pathname === "/v1/route" && req.method === "POST") return this.route(req, res);
      if (url$1.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, ts: Date.now() }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found", path: url$1.pathname } }));
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: e?.message || String(e) } }));
      } else {
        try {
          res.end();
        } catch {
        }
      }
    }
  }
  /* ---------------- 熔断 ---------------- */
  breakerOpen(providerId) {
    const s = this.breaker.get(providerId);
    return !!s && s.fails >= BREAK_AFTER_FAILS && Date.now() < s.untilTs;
  }
  breakerFail(providerId) {
    const s = this.breaker.get(providerId) || { fails: 0, untilTs: 0 };
    s.fails++;
    if (s.fails >= BREAK_AFTER_FAILS) s.untilTs = Date.now() + BREAK_FOR_MS;
    this.breaker.set(providerId, s);
  }
  breakerSuccess(providerId) {
    this.breaker.delete(providerId);
  }
  /* ---------------- 路由解析 ---------------- */
  usable(p) {
    return !!p && p.enabled && !!p.apiKey && p.models.length > 0;
  }
  /**
   * 组装候选链：首选 → fallbackChain → （仍为空时）任意可用厂商。
   * fallback 厂商若有同名模型用同名，否则用其第一个模型。
   */
  buildCandidates(primary, modelIdHint) {
    const mgr = getProviderManager();
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const push = (c) => {
      if (!c || seen.has(c.provider.id)) return;
      seen.add(c.provider.id);
      out.push(c);
    };
    push(primary);
    const chain = mgr.getConfig().routing.fallbackChain || [];
    for (const id of chain) {
      const p = mgr.getProvider(id);
      if (!this.usable(p)) continue;
      const model = modelIdHint && p.models.find((m) => m.id === modelIdHint) || p.models[0];
      push({ provider: p, model, agentId: "proxy-fallback", thinking: p.defaultThinking });
    }
    if (out.length === 0) {
      for (const p of mgr.getProviders()) {
        if (this.usable(p)) {
          push({ provider: p, model: p.models[0], agentId: "proxy-any", thinking: p.defaultThinking });
          break;
        }
      }
    }
    return out;
  }
  /** "provider/model" 精确引用 / 全局模型名匹配 / agent 绑定默认路由
   *  也接受 "provider:model" 别名（OpenClaw 等模型 id 不允许斜杠的场景） */
  resolvePrimary(modelRef, preferAgent) {
    const mgr = getProviderManager();
    if (modelRef && !modelRef.includes("/") && modelRef.includes(":")) {
      modelRef = modelRef.replace(":", "/");
    }
    if (modelRef) {
      if (modelRef.startsWith("agent/")) {
        const r2 = mgr.resolveBinding(modelRef.slice(6));
        if (r2) return { provider: r2.provider, model: r2.model, agentId: r2.binding.agentId, thinking: r2.thinking, temperature: r2.binding.temperature, maxOutputTokens: r2.binding.maxOutputTokens };
      }
      if (modelRef.includes("/")) {
        const i = modelRef.indexOf("/");
        const p = mgr.getProvider(modelRef.slice(0, i));
        if (this.usable(p)) {
          const m = p.models.find((mm) => mm.id === modelRef.slice(i + 1));
          if (m) return { provider: p, model: m, agentId: "proxy-" + p.id, thinking: p.defaultThinking };
        }
      }
      for (const p of mgr.getProviders()) {
        if (!this.usable(p)) continue;
        const m = p.models.find((mm) => mm.id === modelRef);
        if (m) return { provider: p, model: m, agentId: "proxy-" + p.id, thinking: p.defaultThinking };
      }
    }
    const r = mgr.resolveBinding(preferAgent);
    if (r) return { provider: r.provider, model: r.model, agentId: r.binding.agentId, thinking: r.thinking, temperature: r.binding.temperature, maxOutputTokens: r.binding.maxOutputTokens };
    return null;
  }
  /* ---------------- OpenAI 兼容入站 ---------------- */
  async chatCompletions(req, res, forceNoStream) {
    const body = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid json" } }));
      return;
    }
    if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "messages required" } }));
      return;
    }
    const noStream = forceNoStream || parsed.stream === false;
    const sysParts = [];
    const rest = [];
    for (const m of parsed.messages) {
      if (m.role === "system") sysParts.push(typeof m.content === "string" ? m.content : JSON.stringify(m.content));
      else rest.push({ ...m, content: flattenContent(m.content) });
    }
    const primary = this.resolvePrimary(parsed.model, "codex");
    const candidates = this.buildCandidates(primary, primary?.model.id);
    if (candidates.length === 0) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "no usable provider. Configure API keys in Orbit Hub → 设置 → 提供商" } }));
      return;
    }
    const tools = Array.isArray(parsed.tools) && parsed.tools.length ? parsed.tools : void 0;
    await this.streamWithFailover(
      res,
      "openai",
      noStream,
      parsed.model || candidates[0].model.id,
      candidates,
      rest,
      sysParts.length ? sysParts.join("\n\n") : void 0,
      { temperature: parsed.temperature, maxTokens: parsed.max_tokens, tools, toolChoice: parsed.tool_choice }
    );
  }
  /* ---------------- Anthropic 原生入站（Claude Code 接管） ---------------- */
  async anthropicMessages(req, res) {
    const body = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "invalid json" } }));
      return;
    }
    if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "messages required" } }));
      return;
    }
    const systemPrompt = flattenAnthropicSystem(parsed.system);
    const messages = anthropicMessagesToOpenai(parsed.messages);
    const noStream = parsed.stream !== true;
    const primary = this.resolvePrimary(parsed.model, "claude");
    const candidates = this.buildCandidates(primary, primary?.model.id);
    if (candidates.length === 0) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "no usable provider. Configure API keys in Orbit Hub → 设置 → 提供商" } }));
      return;
    }
    const tools = anthropicToolsToOpenai(parsed.tools);
    const toolChoice = anthropicToolChoiceToOpenai(parsed.tool_choice);
    await this.streamWithFailover(
      res,
      "anthropic",
      noStream,
      parsed.model || candidates[0].model.id,
      candidates,
      messages,
      systemPrompt,
      { temperature: parsed.temperature, maxTokens: parsed.max_tokens, tools, toolChoice }
    );
  }
  async countTokens(req, res) {
    const body = await readBody(req);
    let chars = body.length;
    try {
      const parsed = JSON.parse(body);
      chars = JSON.stringify(parsed.messages || "").length + JSON.stringify(parsed.system || "").length;
    } catch {
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ input_tokens: Math.max(1, Math.ceil(chars / 4)) }));
  }
  /* ---------------- Agent 路由入站（AgentHub 自用） ---------------- */
  async route(req, res) {
    const body = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = {};
    }
    if (!parsed.agentId) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "agentId required" } }));
      return;
    }
    const primary = this.resolvePrimary("agent/" + parsed.agentId, parsed.agentId);
    const candidates = this.buildCandidates(primary, primary?.model.id);
    if (candidates.length === 0 || !Array.isArray(parsed.messages) || parsed.messages.length === 0) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: candidates.length === 0 ? "no available provider for agent " + parsed.agentId : "messages required" } }));
      return;
    }
    await this.streamWithFailover(
      res,
      "openai",
      !!parsed.noStream,
      candidates[0].model.id,
      candidates,
      parsed.messages,
      parsed.systemPrompt,
      {}
    );
  }
  /* ---------------- 流式引擎：lazy 首字节 + 故障转移 ---------------- */
  async streamWithFailover(res, wire, noStream, inboundModel, candidates, messages, systemPrompt, overrides) {
    let lastErr = null;
    for (const cand of candidates) {
      if (this.breakerOpen(cand.provider.id)) continue;
      const start = Date.now();
      this.emit("request", { model: cand.model.id, provider: cand.provider.id });
      try {
        await this.tryOne(res, wire, noStream, inboundModel, cand, messages, systemPrompt, overrides);
        this.breakerSuccess(cand.provider.id);
        this.emit("response", { model: cand.model.id, provider: cand.provider.id, durationMs: Date.now() - start });
        return;
      } catch (e) {
        lastErr = e;
        this.breakerFail(cand.provider.id);
        this.emit("error", { model: cand.model.id, provider: cand.provider.id, error: e?.message });
        if (e?.afterOutput) {
          try {
            res.end();
          } catch {
          }
          return;
        }
      }
    }
    if (!res.headersSent) {
      const msg = lastErr?.message || "all providers failed";
      res.writeHead(502, { "content-type": "application/json" });
      res.end(wire === "anthropic" ? JSON.stringify({ type: "error", error: { type: "api_error", message: msg } }) : JSON.stringify({ error: { message: msg } }));
    } else {
      try {
        res.end();
      } catch {
      }
    }
  }
  tryOne(res, wire, noStream, inboundModel, cand, messages, systemPrompt, overrides) {
    const temperature = shouldSendTemperature(cand.provider, cand.model, overrides.temperature ?? cand.temperature) ? overrides.temperature ?? cand.temperature : void 0;
    const binding = {
      agentId: cand.agentId,
      providerId: cand.provider.id,
      modelId: cand.model.id,
      thinkingAllow: ["off", "auto", "enabled"],
      thinking: cand.thinking,
      temperature,
      maxOutputTokens: overrides.maxTokens ?? cand.maxOutputTokens
    };
    const client = buildProviderClient({
      provider: cand.provider,
      model: cand.model,
      binding,
      thinking: cand.thinking
    });
    const emitter = wire === "anthropic" ? new AnthropicWire(res, inboundModel) : new OpenAIWire(res, inboundModel);
    let content = "";
    let thinkingTxt = "";
    let started = false;
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      let settled = false;
      const FIRST_BYTE_MS = 45e3;
      const IDLE_MS = 9e4;
      let timer = null;
      const arm = (ms) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (!settled) controller.abort();
        }, ms);
      };
      const onClose = () => {
        if (!settled) controller.abort();
      };
      res.on("close", onClose);
      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        res.off("close", onClose);
      };
      arm(FIRST_BYTE_MS);
      client.stream(
        { messages, systemPrompt, thinkingOverride: cand.thinking, signal: controller.signal, tools: overrides.tools, toolChoice: overrides.toolChoice },
        {
          onContent: (delta) => {
            content += delta;
            arm(IDLE_MS);
            if (noStream) return;
            if (!started) {
              started = true;
              emitter.begin();
            }
            emitter.content(delta);
          },
          onThinking: (delta) => {
            thinkingTxt += delta;
            arm(IDLE_MS);
            if (noStream) return;
            if (!started) {
              started = true;
              emitter.begin();
            }
            emitter.thinking(delta);
          },
          onToolCallDelta: (tc) => {
            arm(IDLE_MS);
            if (noStream) return;
            if (!started) {
              started = true;
              emitter.begin();
            }
            emitter.toolCallDelta(tc);
          },
          onDone: (final) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (noStream) {
              emitter.json(content, thinkingTxt, final.usage, final.finishReason, final.toolCalls);
            } else {
              if (!started) {
                started = true;
                emitter.begin();
              }
              emitter.done(final.usage, final.finishReason, final.toolCalls);
            }
            resolve();
          },
          onError: (err) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(Object.assign(err instanceof Error ? err : new Error(String(err)), { afterOutput: started }));
          }
        }
      ).catch((e) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(Object.assign(e instanceof Error ? e : new Error(String(e)), { afterOutput: started }));
      });
    });
  }
  /* ---------------- 元数据端点 ---------------- */
  listModels(res) {
    const mgr = getProviderManager();
    const data = [];
    for (const p of mgr.getProviders()) {
      for (const m of p.models) {
        data.push({
          id: p.id + "/" + m.id,
          object: "model",
          created: Date.now(),
          owned_by: p.id,
          display_name: p.name + " · " + m.label,
          root: m.id,
          capabilities: {
            provider: p.id,
            providerKind: p.kind,
            thinking: m.supportsThinking,
            tools: m.supportsTools,
            vision: m.supportsVision,
            contextWindow: m.contextWindow,
            agentBinding: (mgr.getBindings().find((b) => b.providerId === p.id && b.modelId === m.id) || {}).agentId || null
          }
        });
      }
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data, has_more: false }));
  }
  listProviders(res) {
    const mgr = getProviderManager();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      object: "list",
      data: mgr.getProviders().map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        baseUrl: p.baseUrl,
        enabled: p.enabled,
        hasKey: !!p.apiKey,
        health: p.health || null,
        breakerOpen: this.breakerOpen(p.id),
        modelCount: p.models.length,
        capabilities: p.capabilities,
        defaultThinking: p.defaultThinking
      }))
    }));
  }
}
class OpenAIWire {
  constructor(res, model) {
    this.res = res;
    this.model = model;
  }
  id = "cmpl-" + Date.now();
  begin() {
    this.res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive"
    });
  }
  chunk(delta, finish = null) {
    this.res.write("data: " + JSON.stringify({
      id: this.id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1e3),
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: finish }]
    }) + "\n\n");
  }
  content(d) {
    this.chunk({ content: d });
  }
  thinking(d) {
    this.chunk({ reasoning_content: d });
  }
  toolCallDelta(tc) {
    this.chunk({ tool_calls: tc });
  }
  // 1:1 透传 OpenAI 工具流增量
  // 第三参数 _toolCalls 仅为与 AnthropicWire.done 同签名；OpenAI 流式工具已经过 toolCallDelta 发出
  done(usage, finishReason, _toolCalls) {
    this.chunk({}, finishReason || "stop");
    if (usage) {
      this.res.write("data: " + JSON.stringify({
        id: this.id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1e3),
        model: this.model,
        choices: [],
        usage
      }) + "\n\n");
    }
    this.res.write("data: [DONE]\n\n");
    this.res.end();
  }
  json(content, thinking, usage, finishReason, toolCalls) {
    this.res.writeHead(200, { "content-type": "application/json" });
    this.res.end(JSON.stringify({
      id: this.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1e3),
      model: this.model,
      choices: [{ index: 0, message: { role: "assistant", content, ...thinking ? { reasoning_content: thinking } : {}, ...toolCalls && toolCalls.length ? { tool_calls: toolCalls } : {} }, finish_reason: finishReason || "stop" }],
      usage
    }));
  }
}
class AnthropicWire {
  constructor(res, model) {
    this.res = res;
    this.model = model;
  }
  id = "msg_agenthub_" + Date.now();
  blockIndex = -1;
  blockType = null;
  /** OpenAI 工具 index → 已分配的 anthropic content block index（流式去重 + arguments 续写定位） */
  toolIdxMap = /* @__PURE__ */ new Map();
  ev(event, data) {
    this.res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
  }
  begin() {
    this.res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive"
    });
    this.ev("message_start", {
      type: "message_start",
      message: {
        id: this.id,
        type: "message",
        role: "assistant",
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    });
  }
  openBlock(type) {
    if (this.blockType === type) return;
    this.closeBlock();
    this.blockIndex++;
    this.blockType = type;
    this.ev("content_block_start", {
      type: "content_block_start",
      index: this.blockIndex,
      content_block: type === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "" }
    });
  }
  closeBlock() {
    if (this.blockType === null) return;
    this.ev("content_block_stop", { type: "content_block_stop", index: this.blockIndex });
    this.blockType = null;
  }
  thinking(d) {
    this.openBlock("thinking");
    this.ev("content_block_delta", { type: "content_block_delta", index: this.blockIndex, delta: { type: "thinking_delta", thinking: d } });
  }
  content(d) {
    this.openBlock("text");
    this.ev("content_block_delta", { type: "content_block_delta", index: this.blockIndex, delta: { type: "text_delta", text: d } });
  }
  /** 上游 OpenAI 工具流增量 → anthropic tool_use content block（首帧 start + 后续 input_json_delta）。 */
  toolCallDelta(deltas) {
    for (const d of deltas || []) {
      const oi = typeof d.index === "number" ? d.index : 0;
      if (!this.toolIdxMap.has(oi)) {
        this.closeBlock();
        this.blockIndex++;
        this.blockType = "tool";
        this.toolIdxMap.set(oi, this.blockIndex);
        this.ev("content_block_start", {
          type: "content_block_start",
          index: this.blockIndex,
          content_block: { type: "tool_use", id: d.id || "call_" + this.blockIndex, name: d.function?.name || "", input: {} }
        });
      }
      const bi = this.toolIdxMap.get(oi);
      const args = d.function?.arguments;
      if (typeof args === "string" && args) {
        this.ev("content_block_delta", { type: "content_block_delta", index: bi, delta: { type: "input_json_delta", partial_json: args } });
      }
    }
  }
  done(usage, finishReason, toolCalls) {
    if (toolCalls && toolCalls.length && this.toolIdxMap.size === 0) {
      for (const tc of toolCalls) {
        this.closeBlock();
        this.blockIndex++;
        this.blockType = "tool";
        this.ev("content_block_start", {
          type: "content_block_start",
          index: this.blockIndex,
          content_block: { type: "tool_use", id: tc.id || "call_" + this.blockIndex, name: tc.function?.name || "", input: {} }
        });
        const args = typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? {});
        if (args) this.ev("content_block_delta", { type: "content_block_delta", index: this.blockIndex, delta: { type: "input_json_delta", partial_json: args } });
      }
    }
    this.closeBlock();
    this.ev("message_delta", {
      type: "message_delta",
      delta: { stop_reason: anthropicStop(finishReason), stop_sequence: null },
      usage: { output_tokens: usage?.completion_tokens ?? usage?.output_tokens ?? 0 }
    });
    this.ev("message_stop", { type: "message_stop" });
    this.res.end();
  }
  json(content, thinking, usage, finishReason, toolCalls) {
    this.res.writeHead(200, { "content-type": "application/json" });
    const blocks = [];
    if (thinking) blocks.push({ type: "thinking", thinking });
    if (content) blocks.push({ type: "text", text: content });
    for (const tc of toolCalls || []) {
      let input = {};
      try {
        input = JSON.parse(tc.function?.arguments || "{}");
      } catch {
        input = {};
      }
      blocks.push({ type: "tool_use", id: tc.id || "call_" + blocks.length, name: tc.function?.name || "", input });
    }
    if (blocks.length === 0) blocks.push({ type: "text", text: "" });
    this.res.end(JSON.stringify({
      id: this.id,
      type: "message",
      role: "assistant",
      model: this.model,
      content: blocks,
      stop_reason: anthropicStop(finishReason),
      stop_sequence: null,
      usage: {
        input_tokens: usage?.prompt_tokens ?? usage?.input_tokens ?? 0,
        output_tokens: usage?.completion_tokens ?? usage?.output_tokens ?? 0
      }
    }));
  }
}
function anthropicStop(fr) {
  if (fr === "length") return "max_tokens";
  if (fr === "tool_calls") return "tool_use";
  return "end_turn";
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
function flattenAnthropicSystem(system) {
  if (!system) return void 0;
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system.map((b) => typeof b === "string" ? b : b?.text ?? "").filter(Boolean).join("\n\n") || void 0;
  }
  return void 0;
}
function flattenContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => {
      if (typeof b === "string") return b;
      if (b?.type === "text") return b.text ?? "";
      if (b?.type === "tool_result") return "[tool_result] " + flattenContent(b.content);
      if (b?.type === "tool_use") return "[tool_use:" + (b.name ?? "") + "] " + JSON.stringify(b.input ?? {});
      if (b?.type === "image" || b?.type === "image_url") return "[image]";
      return "";
    }).filter(Boolean).join("\n");
  }
  if (content == null) return "";
  return JSON.stringify(content);
}
function anthropicToolsToOpenai(tools) {
  if (!Array.isArray(tools)) return void 0;
  const out = tools.filter((t) => t && typeof t.name === "string" && t.name).map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description || "", parameters: t.input_schema || { type: "object", properties: {} } }
  }));
  return out.length ? out : void 0;
}
function anthropicToolChoiceToOpenai(tc) {
  if (!tc || typeof tc !== "object") return void 0;
  if (tc.type === "auto") return "auto";
  if (tc.type === "any") return "required";
  if (tc.type === "tool" && tc.name) return { type: "function", function: { name: tc.name } };
  return void 0;
}
function anthropicToolResultContent(c) {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((b) => typeof b === "string" ? b : b?.text ?? "").filter(Boolean).join("\n");
  if (c == null) return "";
  try {
    return JSON.stringify(c);
  } catch {
    return String(c);
  }
}
function anthropicMessagesToOpenai(messages) {
  const out = [];
  for (const m of messages || []) {
    const role = m?.role === "assistant" ? "assistant" : "user";
    const c = m?.content;
    if (typeof c === "string") {
      out.push({ role, content: c });
      continue;
    }
    if (!Array.isArray(c)) {
      out.push({ role, content: flattenContent(c) });
      continue;
    }
    if (role === "assistant") {
      let text = "";
      const toolCalls = [];
      for (const b of c) {
        if (b?.type === "text") text += b.text || "";
        else if (b?.type === "tool_use") toolCalls.push({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } });
      }
      const msg = { role: "assistant", content: text };
      if (toolCalls.length) msg.tool_calls = toolCalls;
      out.push(msg);
    } else {
      const texts = [];
      const toolResults = [];
      for (const b of c) {
        if (b?.type === "tool_result") toolResults.push({ id: b.tool_use_id, content: anthropicToolResultContent(b.content) });
        else if (b?.type === "text") texts.push(b.text || "");
        else if (typeof b === "string") texts.push(b);
      }
      for (const tr of toolResults) out.push({ role: "tool", tool_call_id: tr.id, content: tr.content });
      if (texts.length) out.push({ role: "user", content: texts.join("\n") });
      if (!toolResults.length && !texts.length) out.push({ role: "user", content: flattenContent(c) });
    }
  }
  return out;
}
let _instance = null;
function getLocalProxy() {
  if (!_instance) _instance = new LocalProxy();
  return _instance;
}
const SECTION = "[model_providers.agenthub]";
function codexConfigPath() {
  return path.join(os.homedir(), ".codex", "config.toml");
}
function claudeSettingsPath() {
  return path.join(os.homedir(), ".claude", "settings.json");
}
function hermesConfigPath() {
  return path.join(os.homedir(), ".hermes", "config.yaml");
}
function openclawConfigPath() {
  return path.join(os.homedir(), ".openclaw", "openclaw.json");
}
function atomicWrite(path$1, content) {
  fs.mkdirSync(path.dirname(path$1), { recursive: true });
  const tmp = path$1 + ".agenthub-tmp";
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, path$1);
}
function backupOnce(path2) {
  if (fs.existsSync(path2) && !fs.existsSync(path2 + ".agenthub-bak")) {
    try {
      fs.copyFileSync(path2, path2 + ".agenthub-bak");
    } catch {
    }
  }
}
function splitPrelude(toml) {
  const m = toml.match(/^\s*\[/m);
  if (!m || m.index === void 0) return [toml, ""];
  return [toml.slice(0, m.index), toml.slice(m.index)];
}
function getTopKey(toml, key) {
  const [prelude] = splitPrelude(toml);
  const m = prelude.match(new RegExp("^\\s*" + key + "\\s*=\\s*(.+)$", "m"));
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, "");
}
function setTopKey(toml, key, value) {
  let [prelude, rest] = splitPrelude(toml);
  const re = new RegExp("^\\s*" + key + "\\s*=.*\\r?\\n?", "m");
  if (value === null) {
    prelude = prelude.replace(re, "");
  } else {
    const line = key + ' = "' + value + '"';
    if (re.test(prelude)) prelude = prelude.replace(re, line + "\n");
    else prelude = line + "\n" + prelude;
  }
  return prelude + rest;
}
function removeAgenthubSection(toml) {
  const lines = toml.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === SECTION);
  if (start < 0) return toml;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  lines.splice(start, end - start);
  return lines.join("\n");
}
function agenthubSection(proxyOpenAIUrl) {
  return [
    SECTION,
    'name = "Orbit Hub Proxy"',
    'base_url = "' + proxyOpenAIUrl + '"',
    'wire_api = "chat"',
    ""
  ].join("\n");
}
function codexStatus() {
  const path2 = codexConfigPath();
  const exists = fs.existsSync(path2);
  let takenOver = false;
  let model = null;
  let current = null;
  if (exists) {
    try {
      const toml = fs.readFileSync(path2, "utf-8");
      const mp = getTopKey(toml, "model_provider");
      model = getTopKey(toml, "model");
      takenOver = mp === "agenthub";
      current = mp;
    } catch {
    }
  }
  return { supported: true, configPath: path2, configExists: exists, takenOver, model, current };
}
function codexApply(modelRef, proxyOpenAIUrl) {
  const path2 = codexConfigPath();
  let toml = fs.existsSync(path2) ? fs.readFileSync(path2, "utf-8") : "";
  backupOnce(path2);
  if (getTopKey(toml, "model_provider") !== "agenthub" && !appStore.get("takeover.codex.stash")) {
    appStore.set("takeover.codex.stash", {
      model_provider: getTopKey(toml, "model_provider"),
      model: getTopKey(toml, "model")
    });
  }
  toml = removeAgenthubSection(toml);
  toml = setTopKey(toml, "model_provider", "agenthub");
  toml = setTopKey(toml, "model", modelRef);
  if (!toml.endsWith("\n")) toml += "\n";
  toml += "\n" + agenthubSection(proxyOpenAIUrl);
  atomicWrite(path2, toml);
  return codexStatus();
}
function codexRestore() {
  const path2 = codexConfigPath();
  if (fs.existsSync(path2)) {
    let toml = fs.readFileSync(path2, "utf-8");
    const stash = appStore.get("takeover.codex.stash") || {};
    toml = removeAgenthubSection(toml);
    toml = setTopKey(toml, "model_provider", stash.model_provider ?? null);
    toml = setTopKey(toml, "model", stash.model ?? null);
    atomicWrite(path2, toml);
  }
  appStore.set("takeover.codex.stash", null);
  return codexStatus();
}
const CLAUDE_KEYS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL", "ANTHROPIC_SMALL_FAST_MODEL"];
function claudeStatus() {
  const path2 = claudeSettingsPath();
  const exists = fs.existsSync(path2);
  let takenOver = false;
  let model = null;
  let current = null;
  if (exists) {
    try {
      const j = JSON.parse(fs.readFileSync(path2, "utf-8"));
      const env = j?.env || {};
      takenOver = typeof env.ANTHROPIC_BASE_URL === "string" && env.ANTHROPIC_BASE_URL.includes("127.0.0.1");
      model = env.ANTHROPIC_MODEL || null;
      current = env.ANTHROPIC_BASE_URL || "官方登录";
    } catch {
    }
  } else {
    current = "官方登录";
  }
  return { supported: true, configPath: path2, configExists: exists, takenOver, model, current };
}
function claudeApply(modelRef, proxyOrigin) {
  const path2 = claudeSettingsPath();
  let j = {};
  if (fs.existsSync(path2)) {
    try {
      j = JSON.parse(fs.readFileSync(path2, "utf-8"));
    } catch {
      j = {};
    }
  }
  backupOnce(path2);
  const env = j.env || {};
  if (env.ANTHROPIC_BASE_URL !== proxyOrigin && !appStore.get("takeover.claude.stash")) {
    const stash = {};
    for (const k of CLAUDE_KEYS) stash[k] = typeof env[k] === "string" ? env[k] : null;
    if (typeof stash.ANTHROPIC_AUTH_TOKEN === "string") stash.ANTHROPIC_AUTH_TOKEN = encryptSecret(stash.ANTHROPIC_AUTH_TOKEN);
    appStore.set("takeover.claude.stash", stash);
  }
  j.env = {
    ...env,
    ANTHROPIC_BASE_URL: proxyOrigin,
    ANTHROPIC_AUTH_TOKEN: "agenthub",
    ANTHROPIC_MODEL: modelRef,
    ANTHROPIC_SMALL_FAST_MODEL: modelRef
  };
  atomicWrite(path2, JSON.stringify(j, null, 2) + "\n");
  return claudeStatus();
}
function claudeRestore() {
  const path2 = claudeSettingsPath();
  if (fs.existsSync(path2)) {
    let j = {};
    try {
      j = JSON.parse(fs.readFileSync(path2, "utf-8"));
    } catch {
      j = {};
    }
    const env = j.env || {};
    const stash = appStore.get("takeover.claude.stash") || {};
    for (const k of CLAUDE_KEYS) {
      let orig = stash[k];
      if (k === "ANTHROPIC_AUTH_TOKEN" && typeof orig === "string") orig = decryptSecret(orig);
      if (orig == null) delete env[k];
      else env[k] = orig;
    }
    if (Object.keys(env).length === 0) delete j.env;
    else j.env = env;
    atomicWrite(path2, JSON.stringify(j, null, 2) + "\n");
  }
  appStore.set("takeover.claude.stash", null);
  return claudeStatus();
}
function openclawStatus() {
  const path2 = openclawConfigPath();
  const exists = fs.existsSync(path2);
  let takenOver = false;
  let model = null;
  let current = null;
  if (exists) {
    try {
      const j = JSON.parse(fs.readFileSync(path2, "utf-8"));
      const primary = j?.agents?.defaults?.model?.primary;
      current = primary || null;
      if (typeof primary === "string" && primary.startsWith("agenthub/")) {
        takenOver = true;
        model = primary.slice("agenthub/".length).replace(":", "/");
      }
    } catch {
    }
  }
  return { supported: true, configPath: path2, configExists: exists, takenOver, model, current };
}
function openclawApply(modelRef, proxyOpenAIUrl) {
  const path2 = openclawConfigPath();
  let j = {};
  if (fs.existsSync(path2)) {
    try {
      j = JSON.parse(fs.readFileSync(path2, "utf-8"));
    } catch {
      j = {};
    }
  }
  backupOnce(path2);
  const aliasId = modelRef.replace("/", ":");
  j.models = j.models || {};
  j.models.providers = j.models.providers || {};
  j.models.providers.agenthub = {
    baseUrl: proxyOpenAIUrl,
    apiKey: "agenthub",
    api: "openai-completions",
    models: [{ id: aliasId, name: "AgentHub " + modelRef }]
  };
  j.agents = j.agents || {};
  j.agents.defaults = j.agents.defaults || {};
  j.agents.defaults.model = j.agents.defaults.model || {};
  const primary = j.agents.defaults.model.primary;
  if ((typeof primary !== "string" || !primary.startsWith("agenthub/")) && !appStore.get("takeover.openclaw.stash")) {
    appStore.set("takeover.openclaw.stash", { primary: typeof primary === "string" ? primary : null });
  }
  j.agents.defaults.model.primary = "agenthub/" + aliasId;
  atomicWrite(path2, JSON.stringify(j, null, 2) + "\n");
  return openclawStatus();
}
function openclawRestore() {
  const path2 = openclawConfigPath();
  if (fs.existsSync(path2)) {
    let j = {};
    try {
      j = JSON.parse(fs.readFileSync(path2, "utf-8"));
    } catch {
      j = {};
    }
    if (j?.models?.providers?.agenthub) delete j.models.providers.agenthub;
    const stash = appStore.get("takeover.openclaw.stash") || {};
    if (j?.agents?.defaults?.model) {
      if (stash.primary) j.agents.defaults.model.primary = stash.primary;
      else delete j.agents.defaults.model.primary;
    }
    atomicWrite(path2, JSON.stringify(j, null, 2) + "\n");
  }
  appStore.set("takeover.openclaw.stash", null);
  return openclawStatus();
}
function hermesFindBlockEnd(lines, startIdx) {
  for (let i = startIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() !== "" && !/^[ \t-]/.test(l)) return i;
  }
  return lines.length;
}
function hermesRemoveAgenthub(text) {
  const lines = text.split(/\r?\n/);
  const cp = lines.findIndex((l) => /^custom_providers:\s*$/.test(l));
  if (cp < 0) return text;
  const end = hermesFindBlockEnd(lines, cp);
  let s = -1;
  for (let i = cp + 1; i < end; i++) {
    if (/^-\s+name:\s*['"]?agenthub['"]?\s*$/.test(lines[i])) {
      s = i;
      break;
    }
  }
  if (s < 0) return text;
  let e = end;
  for (let i = s + 1; i < end; i++) {
    if (/^-\s/.test(lines[i])) {
      e = i;
      break;
    }
  }
  lines.splice(s, e - s);
  return lines.join("\n");
}
function hermesModelSpan(lines) {
  const m = lines.findIndex((l) => /^model:(\s|$)/.test(l));
  if (m < 0) return null;
  const inline = /^model:\s*\S/.test(lines[m]);
  return { start: m, end: inline ? m + 1 : hermesFindBlockEnd(lines, m) };
}
function hermesGetModelBlock(text) {
  const lines = text.split(/\r?\n/);
  const span = hermesModelSpan(lines);
  if (!span) return null;
  return lines.slice(span.start, span.end).join("\n");
}
function hermesSetModelBlock(text, block) {
  const lines = text.split(/\r?\n/);
  const span = hermesModelSpan(lines);
  const blockLines = block ? block.split("\n") : [];
  if (span) {
    lines.splice(span.start, span.end - span.start, ...blockLines);
  } else if (block) {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push(...blockLines);
  }
  let out = lines.join("\n");
  if (!out.endsWith("\n")) out += "\n";
  return out;
}
function hermesProviderItem(modelRef, proxyOpenAIUrl) {
  return [
    "- name: agenthub",
    "  base_url: " + proxyOpenAIUrl,
    "  api_key: agenthub",
    "  api_mode: chat_completions",
    "  models:",
    "    " + modelRef + ":",
    '      name: "AgentHub ' + modelRef + '"',
    "  model: " + modelRef
  ].join("\n");
}
function hermesStatus() {
  const path2 = hermesConfigPath();
  const exists = fs.existsSync(path2);
  let takenOver = false;
  let model = null;
  let current = null;
  if (exists) {
    try {
      const block = hermesGetModelBlock(fs.readFileSync(path2, "utf-8"));
      if (block) {
        const prov = block.match(/^\s+provider:\s*['"]?([^'"\s]+)['"]?\s*$/m)?.[1] ?? null;
        model = block.match(/^\s+default:\s*['"]?(\S+)['"]?\s*$/m)?.[1] ?? null;
        takenOver = prov === "agenthub";
        current = prov;
      }
    } catch {
    }
  }
  return { supported: true, configPath: path2, configExists: exists, takenOver, model, current };
}
function hermesApply(modelRef, proxyOpenAIUrl) {
  const path2 = hermesConfigPath();
  let text = fs.existsSync(path2) ? fs.readFileSync(path2, "utf-8") : "";
  backupOnce(path2);
  const st = hermesStatus();
  if (!st.takenOver && !appStore.get("takeover.hermes.stash")) {
    appStore.set("takeover.hermes.stash", { modelBlock: hermesGetModelBlock(text) });
  }
  text = hermesRemoveAgenthub(text);
  const lines = text.split(/\r?\n/);
  const cp = lines.findIndex((l) => /^custom_providers:\s*$/.test(l));
  const item = hermesProviderItem(modelRef, proxyOpenAIUrl);
  if (cp >= 0) {
    lines.splice(cp + 1, 0, ...item.split("\n"));
  } else {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("custom_providers:", ...item.split("\n"));
  }
  text = hermesSetModelBlock(lines.join("\n"), "model:\n  default: " + modelRef + "\n  provider: agenthub");
  atomicWrite(path2, text);
  return hermesStatus();
}
function hermesRestore() {
  const path2 = hermesConfigPath();
  if (fs.existsSync(path2)) {
    let text = fs.readFileSync(path2, "utf-8");
    text = hermesRemoveAgenthub(text);
    const stash = appStore.get("takeover.hermes.stash") || {};
    text = hermesSetModelBlock(text, stash.modelBlock ?? null);
    atomicWrite(path2, text);
  }
  appStore.set("takeover.hermes.stash", null);
  return hermesStatus();
}
function takeoverStatus() {
  return { codex: codexStatus(), claude: claudeStatus(), hermes: hermesStatus(), openclaw: openclawStatus() };
}
function takeoverApply(app, modelRef, proxyOpenAIUrl, proxyOrigin) {
  if (app === "codex") return codexApply(modelRef, proxyOpenAIUrl);
  if (app === "claude") return claudeApply(modelRef, proxyOrigin);
  if (app === "hermes") return hermesApply(modelRef, proxyOpenAIUrl);
  if (app === "openclaw") return openclawApply(modelRef, proxyOpenAIUrl);
  throw new Error("takeover not supported for " + app);
}
function takeoverRestore(app) {
  if (app === "codex") return codexRestore();
  if (app === "claude") return claudeRestore();
  if (app === "hermes") return hermesRestore();
  if (app === "openclaw") return openclawRestore();
  throw new Error("takeover not supported for " + app);
}
const ROUTING_MANAGED = "__agentHubRoutingManaged";
const ROUTING_SIG = "__agentHubRoutingSig";
function parseStdioArgs(argsStr) {
  const input = (argsStr || "").trim();
  if (!input) return void 0;
  const args = [];
  let current = "";
  let quote = null;
  let escaping = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\" && quote === '"') {
      const next = input[i + 1];
      if (next === '"' || next === "\\") {
        escaping = true;
        continue;
      }
    }
    if ((ch === "'" || ch === '"') && !quote) {
      quote = ch;
      continue;
    }
    if (quote === ch) {
      quote = null;
      continue;
    }
    if (!quote && /\s/.test(ch)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (escaping) current += "\\";
  if (current) args.push(current);
  return args;
}
function signature(binding) {
  return [
    binding.protocol || "http",
    (binding.binary || "").trim(),
    (binding.args || "").trim()
  ].join("|");
}
function syncRegistryFromBindings(registry2, bindings) {
  const desired = new Set(bindings.map((b) => b.agentId));
  for (const info of registry2.getAll()) {
    if (info.adapter[ROUTING_MANAGED] && !desired.has(info.id)) {
      info.adapter.stop().catch(() => {
      });
      registry2.unregister(info.id);
    }
  }
  for (const binding of bindings) {
    const existing = registry2.get(binding.agentId);
    const sig = signature(binding);
    if (existing && (existing.adapter.protocol !== (binding.protocol || "http") || existing.adapter[ROUTING_SIG] !== sig)) {
      existing.adapter.stop().catch(() => {
      });
      registry2.unregister(binding.agentId);
    }
    const fresh = registry2.get(binding.agentId);
    if (!fresh) {
      const adapter = createAdapter(
        binding.agentId,
        agentName(binding.agentId),
        binding.protocol,
        binding.binary,
        parseStdioArgs(binding.args)
      );
      adapter[ROUTING_MANAGED] = true;
      adapter[ROUTING_SIG] = sig;
      registry2.register(adapter, agentCaps(binding.agentId), binding.providerId, binding.modelId);
    } else {
      fresh.providerId = binding.providerId;
      fresh.modelId = binding.modelId;
    }
  }
}
function routePreview(text, registry2, router2 = new KeywordRouter(), context) {
  return router2.routeScores(text || "", registry2.getAll(), context);
}
const CATEGORIES = [
  "conversation",
  "task",
  "skill",
  "file",
  "system",
  "episodic",
  "semantic",
  "procedure",
  "decision"
];
const DEFAULT_INDEX = { version: 1, entries: [] };
class MemoryLibrary {
  root;
  indexPath;
  historyDir;
  latestPath;
  constructor(root) {
    this.root = node_path.basename(node_path.normalize(root)) === "memory" ? root : node_path.join(root, "memory");
    this.indexPath = node_path.join(this.root, "index.json");
    this.historyDir = node_path.join(this.root, "history");
    this.latestPath = node_path.join(this.historyDir, "session-latest.json");
    this.ensureDirs();
  }
  getCatalog() {
    const index = this.readIndex();
    return {
      version: 1,
      root: this.root,
      entries: index.entries.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      counts: countEntries(index.entries),
      runtimeUpdatedAt: index.runtimeUpdatedAt
    };
  }
  listEntries(category) {
    const entries = this.getCatalog().entries;
    return category ? entries.filter((entry) => entry.category === category) : entries;
  }
  upsertEntry(input) {
    const index = this.readIndex();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const id = input.id || makeEntryId(input.category, input.source || input.title);
    const existing = index.entries.find((entry2) => entry2.id === id);
    const entry = {
      id,
      category: input.category,
      title: cleanTitle(input.title),
      summary: input.summary || "",
      content: input.content,
      source: input.source,
      tags: input.tags || [],
      metadata: input.metadata || {},
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    index.entries = [entry, ...index.entries.filter((item) => item.id !== id)];
    this.writeIndex(index);
    return entry;
  }
  saveRuntimeState(state) {
    const normalized = normalizeRuntimeState(state);
    this.writeJson(this.latestPath, normalized);
    this.writeJson(node_path.join(this.historyDir, todayName()), normalized);
    const index = this.readIndex();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const dailyHistory = todayName();
    const tasksForEntries = normalized.conversations.length > 0 ? normalized.conversations.flatMap((conv) => conv.tasks.map((task) => ({ ...task, conversationId: conv.id, workspaceId: conv.workspaceId }))) : normalized.tasks;
    const runtimeEntries = [
      ...normalized.conversations.length > 0 ? normalized.conversations.map(conversationToEntry) : normalized.messages.map(messageToEntry),
      ...tasksForEntries.map(taskToEntry),
      historyFileToEntry("history/session-latest.json", "Latest session snapshot"),
      historyFileToEntry(`history/${dailyHistory}`, "Daily session snapshot")
    ].map((entry) => ({
      ...entry,
      createdAt: index.entries.find((old) => old.id === entry.id)?.createdAt || now,
      updatedAt: now
    }));
    const runtimeIds = new Set(runtimeEntries.map((entry) => entry.id));
    index.entries = [
      ...runtimeEntries,
      ...index.entries.filter((entry) => !runtimeIds.has(entry.id))
    ];
    index.runtimeUpdatedAt = now;
    this.writeIndex(index);
    return normalized;
  }
  loadRuntimeState() {
    if (!node_fs.existsSync(this.latestPath)) return normalizeRuntimeState({});
    try {
      return normalizeRuntimeState(JSON.parse(node_fs.readFileSync(this.latestPath, "utf-8")));
    } catch {
      return normalizeRuntimeState({});
    }
  }
  ensureDirs() {
    node_fs.mkdirSync(this.historyDir, { recursive: true });
  }
  readIndex() {
    if (!node_fs.existsSync(this.indexPath)) return { ...DEFAULT_INDEX, entries: [] };
    try {
      const parsed = JSON.parse(node_fs.readFileSync(this.indexPath, "utf-8"));
      return {
        version: 1,
        entries: Array.isArray(parsed.entries) ? parsed.entries.filter(isMemoryEntry) : [],
        runtimeUpdatedAt: typeof parsed.runtimeUpdatedAt === "string" ? parsed.runtimeUpdatedAt : void 0
      };
    } catch {
      return { ...DEFAULT_INDEX, entries: [] };
    }
  }
  writeIndex(index) {
    this.writeJson(this.indexPath, index);
  }
  writeJson(path2, value) {
    this.ensureDirs();
    node_fs.writeFileSync(path2, JSON.stringify(value, null, 2), "utf-8");
  }
}
function normalizeRuntimeState(input) {
  const activeWorkspaceId = typeof input?.activeWorkspaceId === "string" ? input.activeWorkspaceId : null;
  let conversations = Array.isArray(input?.conversations) ? input.conversations.filter((conv) => conv && typeof conv.id === "string").map(normalizeConversation) : [];
  const legacyMessages = Array.isArray(input?.messages) ? input.messages.map(normalizeMessage) : [];
  const legacyTasks = Array.isArray(input?.tasks) ? input.tasks.map(normalizeTask) : [];
  if (conversations.length === 0 && (legacyMessages.length > 0 || legacyTasks.length > 0)) {
    const now = Date.now();
    conversations = [{
      id: `conv-${now.toString(36)}-legacy`,
      workspaceId: activeWorkspaceId,
      title: cleanTitle(legacyMessages[0]?.text || "Migrated conversation"),
      createdAt: now,
      updatedAt: now,
      messages: legacyMessages,
      tasks: legacyTasks
    }];
  }
  conversations = conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  const activeConversationId = typeof input?.activeConversationId === "string" && conversations.some((conv) => conv.id === input.activeConversationId) ? input.activeConversationId : conversations[0]?.id ?? null;
  const active = conversations.find((conv) => conv.id === activeConversationId);
  const messages = active ? active.messages : legacyMessages;
  const tasks = active ? active.tasks : legacyTasks;
  return { messages, tasks, conversations, activeConversationId, activeWorkspaceId };
}
function normalizeConversation(conv) {
  const now = Date.now();
  return {
    id: conv.id,
    workspaceId: typeof conv.workspaceId === "string" ? conv.workspaceId : null,
    title: cleanTitle(conv.title || conv.messages?.[0]?.text || "New conversation"),
    createdAt: typeof conv.createdAt === "number" ? conv.createdAt : now,
    updatedAt: typeof conv.updatedAt === "number" ? conv.updatedAt : now,
    messages: Array.isArray(conv.messages) ? conv.messages.map(normalizeMessage) : [],
    tasks: Array.isArray(conv.tasks) ? conv.tasks.map(normalizeTask) : []
  };
}
function normalizeMessage(message) {
  const replies = Array.isArray(message?.replies) ? message.replies.map((reply) => {
    if (reply?.done) return reply;
    return { ...reply, done: true, cancelled: true };
  }) : [];
  return { ...message, replies };
}
function normalizeTask(task) {
  return task?.status === "running" ? { ...task, status: "cancelled" } : task;
}
function messageToEntry(message) {
  const agentIds = Array.isArray(message.replies) ? message.replies.map((reply) => reply.agentId).filter(Boolean) : [];
  const errors = Array.isArray(message.replies) ? message.replies.map((reply) => reply.error).filter(Boolean) : [];
  const resultCount = Array.isArray(message.replies) ? message.replies.filter((reply) => reply.text).length : 0;
  return {
    id: makeEntryId("conversation", message.id || message.taskId || message.text),
    category: "conversation",
    title: cleanTitle(message.text || "Conversation"),
    summary: errors.length ? `包含 ${errors.length} 条错误` : `包含 ${resultCount} 条 Agent 回复`,
    content: JSON.stringify(message, null, 2),
    tags: ["chat", message.mode].filter(Boolean),
    metadata: {
      messageId: message.id,
      taskId: message.taskId,
      mode: message.mode,
      agentIds
    },
    createdAt: "",
    updatedAt: ""
  };
}
function taskToEntry(task) {
  return {
    id: makeEntryId("task", task.id || task.text),
    category: "task",
    title: cleanTitle(task.text || "Task"),
    summary: `${task.status || "unknown"} · ${(task.agents || []).join(", ") || "no agent"}`,
    content: JSON.stringify(task, null, 2),
    tags: ["task", task.mode, task.status].filter(Boolean),
    metadata: {
      taskId: task.id,
      mode: task.mode,
      status: task.status,
      agents: task.agents || [],
      durationMs: task.durationMs
    },
    createdAt: "",
    updatedAt: ""
  };
}
function conversationToEntry(conversation) {
  const failedTasks = conversation.tasks.filter((task) => task?.status === "failed").length;
  const doneTasks = conversation.tasks.filter((task) => task?.status === "completed").length;
  return {
    id: makeEntryId("conversation", conversation.id),
    category: "conversation",
    title: cleanTitle(conversation.title || "Conversation"),
    summary: `${conversation.messages.length} message(s) · ${doneTasks} completed · ${failedTasks} failed`,
    content: JSON.stringify(conversation, null, 2),
    tags: ["conversation", conversation.workspaceId ? "workspace" : "no-workspace"].filter(Boolean),
    metadata: {
      conversationId: conversation.id,
      workspaceId: conversation.workspaceId,
      messageCount: conversation.messages.length,
      taskCount: conversation.tasks.length
    },
    createdAt: "",
    updatedAt: ""
  };
}
function historyFileToEntry(source, title) {
  return {
    id: makeEntryId("file", source),
    category: "file",
    title,
    summary: "Orbit Hub runtime memory snapshot",
    source,
    tags: ["history", "snapshot"],
    metadata: { kind: "runtime-snapshot" },
    createdAt: "",
    updatedAt: ""
  };
}
function countEntries(entries) {
  return CATEGORIES.reduce((counts, category) => {
    counts[category] = entries.filter((entry) => entry.category === category).length;
    return counts;
  }, {});
}
function cleanTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 96) || "Untitled";
}
function makeEntryId(category, seed) {
  return `${category}:${encodeURIComponent(String(seed || "untitled")).slice(0, 120)}`;
}
function todayName() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".json";
}
function isMemoryEntry(value) {
  return !!value && CATEGORIES.includes(value.category) && typeof value.id === "string" && typeof value.title === "string";
}
const DEFAULT_STATE$1 = {
  plans: [],
  outcomes: [],
  stm: { recentDecisions: [] },
  evolution: { genes: [], capsules: [], events: [], policy: { version: 1, notes: [], updatedAt: "" } }
};
function evolutionClean(value, limit = 220) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}
function evolutionTags(goal, summary = "") {
  const text = `${goal}\n${summary}`.toLowerCase();
  const tags = [];
  if (/(网站|网页|页面|html|canvas|frontend|ui|visual|preview|预览)/i.test(text)) tags.push("web-preview");
  if (/(协作|编排|agent|codex|claude|handoff|parallel|并行)/i.test(text)) tags.push("multi-agent");
  if (/(reactor|replan|动态重规划|重规划|接管|takeover|multica|生命周期|plan-solve)/i.test(text)) tags.push("reactor");
  if (/(evomap|mcp|gene|capsule|recipe|自进化|经验)/i.test(text)) tags.push("evomap");
  if (/(校验|验证|验收|verify|validation|smoke|test)/i.test(text)) tags.push("verification");
  if (/(阻塞|失败|failed|blocked|error|timeout|sandbox|approval)/i.test(text)) tags.push("repair");
  if (tags.length === 0) tags.push("general");
  return Array.from(new Set(tags));
}
function evolutionKey(tags, status, blockers = []) {
  if (tags.includes("web-preview")) return "gene:web-preview-delivery";
  if (tags.includes("repair") || blockers.length) return "gene:failure-rescue";
  if (tags.includes("reactor")) return "gene:reactor-orchestration";
  if (tags.includes("multi-agent")) return "gene:parallel-contracts";
  if (tags.includes("evomap")) return "gene:evomap-preplanning";
  if (tags.includes("verification")) return "gene:verification-evidence";
  return "gene:general-delivery";
}
function evolutionStrategyFor(tags, status, blockers = []) {
  if (tags.includes("web-preview")) {
    return "For page/visual deliverables, Orbit must auto-detect concrete files, expose a local HTTP preview URL, inject that evidence into verification, and put the preview link near the top of the final answer.";
  }
  if (tags.includes("repair") || blockers.length || status !== "completed") {
    return "When a worker fails or verification complains about missing artifacts, the main agent must inspect shared evidence, trigger handoff/rescue, and avoid declaring failure before a concrete repair path or artifact check is attempted.";
  }
  if (tags.includes("reactor")) {
    return "Run multi-agent work as a Reactor Plan-Solve loop: plan bounded contracts, execute same-wave worker lanes, observe artifacts and failures, dynamically replan takeover/repair contracts, then synthesize with evidence.";
  }
  if (tags.includes("multi-agent")) {
    return "Use one shared Definition of Done, same-wave worker contracts, explicit handoff rules, and Orbit-owned synthesis; do not create disconnected final-summary worker tasks.";
  }
  if (tags.includes("evomap")) {
    return "Before planning, retrieve EvoMap Gene/Capsule/Recipe candidates as external priors, adapt them locally, then record the verified outcome as Orbit main-agent evolution memory.";
  }
  if (tags.includes("verification")) {
    return "Verification must combine worker text with concrete workspace evidence, commands actually run, produced files, and preview links; do not judge only the last assistant paragraph.";
  }
  return "Prefer concrete deliverables, bounded worker contracts, real verification evidence, and concise Orbit synthesis.";
}
function defaultEvolutionGenes() {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const seeds = [
    {
      id: "gene:web-preview-delivery",
      title: "web preview delivery",
      trigger: "web-preview",
      strategy: evolutionStrategyFor(["web-preview"], "completed"),
      tags: ["web-preview", "verification"],
      score: 3
    },
    {
      id: "gene:parallel-contracts",
      title: "parallel contracts",
      trigger: "multi-agent",
      strategy: evolutionStrategyFor(["multi-agent"], "completed"),
      tags: ["multi-agent"],
      score: 2
    },
    {
      id: "gene:reactor-orchestration",
      title: "reactor orchestration",
      trigger: "reactor",
      strategy: evolutionStrategyFor(["reactor"], "completed"),
      tags: ["reactor", "multi-agent", "repair"],
      score: 3
    },
    {
      id: "gene:verification-evidence",
      title: "verification evidence",
      trigger: "verification",
      strategy: evolutionStrategyFor(["verification"], "completed"),
      tags: ["verification"],
      score: 2
    },
    {
      id: "gene:failure-rescue",
      title: "failure rescue",
      trigger: "repair",
      strategy: evolutionStrategyFor(["repair"], "failed", ["seed"]),
      tags: ["repair", "multi-agent"],
      score: 2
    },
    {
      id: "gene:evomap-preplanning",
      title: "evomap preplanning",
      trigger: "evomap",
      strategy: evolutionStrategyFor(["evomap"], "completed"),
      tags: ["evomap", "multi-agent"],
      score: 2
    }
  ];
  return seeds.map((gene) => ({
    ...gene,
    kind: "Gene",
    evidence: "Seeded Orbit main-agent policy.",
    successCount: 0,
    failureCount: 0,
    createdAt: now,
    updatedAt: now
  }));
}
function normalizeEvolution(input) {
  const raw = input && typeof input === "object" ? input : {};
  const parsedGenes = Array.isArray(raw.genes) ? raw.genes.filter((item) => item && typeof item.id === "string").slice(0, 120) : [];
  return {
    genes: parsedGenes.length ? parsedGenes : defaultEvolutionGenes(),
    capsules: Array.isArray(raw.capsules) ? raw.capsules.filter((item) => item && typeof item.id === "string").slice(0, 200) : [],
    events: Array.isArray(raw.events) ? raw.events.filter((item) => item && typeof item.id === "string").slice(0, 300) : [],
    policy: raw.policy && typeof raw.policy === "object" ? {
      version: Number(raw.policy.version || 1),
      notes: Array.isArray(raw.policy.notes) ? raw.policy.notes.filter((item) => typeof item === "string").slice(0, 12) : [],
      updatedAt: typeof raw.policy.updatedAt === "string" ? raw.policy.updatedAt : ""
    } : { version: 1, notes: [], updatedAt: "" }
  };
}
class MissionStore {
  root;
  statePath;
  constructor(root) {
    this.root = node_path.basename(node_path.normalize(root)) === "missions" ? root : node_path.join(root, "missions");
    this.statePath = node_path.join(this.root, "mission-state.json");
    node_fs.mkdirSync(this.root, { recursive: true });
  }
  listPlans() {
    return this.read().plans.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  listOutcomes(limit = 50) {
    return this.read().outcomes.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }
  listEvolution(limit = 50) {
    const evolution = this.read().evolution;
    return {
      genes: evolution.genes.slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit),
      capsules: evolution.capsules.slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))).slice(0, limit),
      events: evolution.events.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, limit),
      policy: evolution.policy
    };
  }
  getActivePlan() {
    const state = this.read();
    const id = state.stm.activeMissionId;
    return id ? state.plans.find((plan) => plan.missionId === id) || null : null;
  }
  getSTM() {
    return { ...this.read().stm, recentDecisions: this.read().stm.recentDecisions.slice() };
  }
  upsertPlan(plan) {
    const state = this.read();
    state.plans = [plan, ...state.plans.filter((item) => item.missionId !== plan.missionId)].slice(0, 100);
    state.stm.activeMissionId = plan.missionId;
    state.stm.routeContext = missionRouteText(plan);
    state.stm.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.write(state);
    return plan;
  }
  setPlanStatus(missionId, status) {
    const state = this.read();
    const idx = state.plans.findIndex((plan) => plan.missionId === missionId);
    if (idx < 0) return null;
    state.plans[idx] = setPlanStatus(state.plans[idx], status);
    state.stm.activeMissionId = missionId;
    state.stm.routeContext = missionRouteText(state.plans[idx]);
    state.stm.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.write(state);
    return state.plans[idx];
  }
  updateTaskStatus(missionId, taskId, status) {
    const state = this.read();
    const idx = state.plans.findIndex((plan) => plan.missionId === missionId);
    if (idx < 0) return null;
    state.plans[idx] = setContractStatus(state.plans[idx], taskId, status);
    state.stm.activeMissionId = missionId;
    state.stm.routeContext = missionRouteText(state.plans[idx]);
    state.stm.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.write(state);
    return state.plans[idx];
  }
  addDecision(note) {
    const clean2 = note.trim();
    if (!clean2) return;
    const state = this.read();
    state.stm.recentDecisions = [clean2, ...state.stm.recentDecisions.filter((item) => item !== clean2)].slice(0, 20);
    state.stm.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.write(state);
  }
  recordOutcome(input) {
    const state = this.read();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const existing = state.outcomes.find((item) => item.missionId === input.missionId);
    const outcome = {
      id: existing?.id || `outcome-${input.missionId}`,
      missionId: input.missionId,
      goal: input.goal,
      status: input.status,
      summary: input.summary,
      lessons: input.lessons || [],
      blockers: input.blockers || [],
      verified: !!input.verified,
      taskCount: input.taskCount || 0,
      failedTaskIds: input.failedTaskIds || [],
      resultPreview: input.resultPreview,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    state.outcomes = [outcome, ...state.outcomes.filter((item) => item.missionId !== input.missionId)].slice(0, 200);
    state.stm.updatedAt = now;
    this.write(state);
    return outcome;
  }
  recordMainAgentEvolution(input) {
    const state = this.read();
    const evolution = normalizeEvolution(state.evolution);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const tags = evolutionTags(input.goal, `${input.summary || ""}\n${(input.lessons || []).join("\n")}\n${(input.blockers || []).join("\n")}`);
    const geneId = evolutionKey(tags, input.status, input.blockers || []);
    const strategy = evolutionStrategyFor(tags, input.status, input.blockers || []);
    const scoreDelta = input.status === "completed" && input.verified ? 2 : input.status === "completed" ? 1 : -1;
    const existingGene = evolution.genes.find((gene) => gene.id === geneId);
    const gene = {
      id: geneId,
      kind: "Gene",
      title: geneId.replace(/^gene:/, "").replace(/-/g, " "),
      trigger: tags.join(", "),
      strategy,
      evidence: evolutionClean(input.summary || input.resultPreview || input.goal, 360),
      tags,
      score: Math.max(0, (existingGene?.score || 0) + scoreDelta),
      successCount: (existingGene?.successCount || 0) + (input.status === "completed" ? 1 : 0),
      failureCount: (existingGene?.failureCount || 0) + (input.status === "completed" ? 0 : 1),
      updatedAt: now,
      createdAt: existingGene?.createdAt || now
    };
    const capsule = {
      id: `capsule-${input.missionId}`,
      kind: "Capsule",
      geneId,
      missionId: input.missionId,
      goal: input.goal,
      outcome: input.status,
      verified: !!input.verified,
      summary: evolutionClean(input.summary || input.resultPreview || "", 600),
      reusablePrompt: strategy,
      lessons: (input.lessons || []).slice(0, 8),
      blockers: (input.blockers || []).slice(0, 8),
      artifacts: (input.artifacts || []).slice(0, 8),
      updatedAt: now,
      createdAt: now
    };
    const event = {
      id: `evolution-${input.missionId}-${Date.now()}`,
      kind: "EvolutionEvent",
      missionId: input.missionId,
      geneId,
      goal: input.goal,
      status: input.status,
      signal: evolutionClean(input.summary || input.resultPreview || "", 360),
      mutation: strategy,
      scoreDelta,
      createdAt: now
    };
    evolution.genes = [gene, ...evolution.genes.filter((item) => item.id !== geneId)].slice(0, 120);
    evolution.capsules = [capsule, ...evolution.capsules.filter((item) => item.id !== capsule.id)].slice(0, 200);
    evolution.events = [event, ...evolution.events].slice(0, 300);
    evolution.policy = {
      version: (evolution.policy.version || 1) + 1,
      notes: [strategy, ...(evolution.policy.notes || []).filter((note) => note !== strategy)].slice(0, 12),
      updatedAt: now
    };
    state.evolution = evolution;
    state.stm.updatedAt = now;
    this.write(state);
    return { gene, capsule, event, policy: evolution.policy };
  }
  buildEvolutionContext(goal, limit = 6) {
    const state = this.read();
    const evolution = normalizeEvolution(state.evolution);
    const goalTags = evolutionTags(goal);
    const relevant = evolution.genes.filter((gene) => {
      const tags = Array.isArray(gene.tags) ? gene.tags : [];
      return tags.length === 0 || tags.some((tag) => goalTags.includes(tag));
    }).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit);
    const fallback = relevant.length ? relevant : evolution.genes.slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit);
    const capsules = evolution.capsules.filter((capsule) => fallback.some((gene) => gene.id === capsule.geneId)).slice(0, Math.max(2, Math.floor(limit / 2)));
    const lines = [];
    if (fallback.length) {
      lines.push("ORBIT MAIN AGENT EVOLUTION MEMORY (local Gene/Capsule/Event):");
      lines.push("- Use these as Orbit's own evolved policy. They should guide task decomposition, worker instructions, verification, and final synthesis.");
      for (const gene of fallback) {
        lines.push(`- Gene ${gene.id} score=${gene.score || 0} success=${gene.successCount || 0} failure=${gene.failureCount || 0}: ${gene.strategy}`);
        if (gene.evidence) lines.push(`  evidence: ${gene.evidence}`);
      }
    }
    if (capsules.length) {
      lines.push("Relevant Capsules:");
      for (const capsule of capsules) {
        lines.push(`- ${capsule.outcome} ${capsule.goal}: ${capsule.summary}`);
        if (capsule.artifacts?.length) lines.push(`  artifacts: ${capsule.artifacts.join(" | ")}`);
      }
    }
    if (evolution.policy?.notes?.length) {
      lines.push("Current Orbit policy notes:");
      for (const note of evolution.policy.notes.slice(0, 4)) lines.push(`- ${note}`);
    }
    return lines.join("\n").slice(0, 6e3);
  }
  buildPlannerContext(limit = 6, goal = "") {
    const state = this.read();
    const lines = [];
    const active = state.stm.activeMissionId ? state.plans.find((plan) => plan.missionId === state.stm.activeMissionId) : null;
    if (active) {
      lines.push("ACTIVE MISSION STM:");
      lines.push(`- ${active.goal}`);
      const pending = active.taskDag.nodes.filter((node) => !["done", "failed", "cancelled"].includes(node.status)).slice(0, 8).map((node) => `${node.id}:${node.title}${node.agentId ? `[${node.agentId}]` : ""}`);
      if (pending.length) lines.push("- Pending contracts: " + pending.join(", "));
    }
    const evolutionContext = this.buildEvolutionContext(goal || active?.goal || "", 5);
    if (evolutionContext) lines.push(evolutionContext);
    const outcomes = state.outcomes.slice(0, limit);
    if (outcomes.length) {
      lines.push("RECENT EPISODIC OUTCOMES:");
      for (const outcome of outcomes) {
        lines.push(`- ${outcome.status.toUpperCase()} ${outcome.goal}: ${outcome.summary}`);
        if (outcome.lessons.length) lines.push("  lessons: " + outcome.lessons.slice(0, 3).join(" | "));
        if (outcome.blockers.length) lines.push("  blockers: " + outcome.blockers.slice(0, 3).join(" | "));
      }
    }
    return lines.join("\n").slice(0, 8e3);
  }
  getRouterContext() {
    const state = this.read();
    const active = state.stm.activeMissionId ? state.plans.find((plan) => plan.missionId === state.stm.activeMissionId) : null;
    if (!active && !state.stm.routeContext && state.stm.recentDecisions.length === 0) return void 0;
    return {
      activeMissionId: state.stm.activeMissionId,
      goal: active?.goal,
      routeContext: state.stm.routeContext,
      recentDecisions: state.stm.recentDecisions.slice(0, 6),
      pendingContracts: active?.taskDag.nodes.filter((node) => !["done", "failed", "cancelled"].includes(node.status)).slice(0, 10).map((node) => ({
        id: node.id,
        title: node.title,
        detail: node.detail,
        agentId: node.agentId,
        status: node.status
      }))
    };
  }
  read() {
    if (!node_fs.existsSync(this.statePath)) return cloneState$1(DEFAULT_STATE$1);
    try {
      const parsed = JSON.parse(node_fs.readFileSync(this.statePath, "utf-8"));
      return {
        version: 1,
        plans: Array.isArray(parsed.plans) ? parsed.plans.filter(isPlanArtifact) : [],
        outcomes: Array.isArray(parsed.outcomes) ? parsed.outcomes.filter(isMissionOutcome) : [],
        stm: normalizeSTM(parsed.stm),
        evolution: normalizeEvolution(parsed.evolution)
      };
    } catch {
      return cloneState$1(DEFAULT_STATE$1);
    }
  }
  write(state) {
    node_fs.mkdirSync(this.root, { recursive: true });
    node_fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2), "utf-8");
  }
}
function missionRouteText(plan) {
  const contracts = plan.taskDag.nodes.map((node) => `${node.title} ${node.detail} ${node.agentId || ""} ${node.fileScope.join(" ")} ${node.interfaceRef}`);
  return [plan.goal, ...contracts].join("\n").slice(0, 6e3);
}
function normalizeSTM(input) {
  return {
    activeMissionId: typeof input?.activeMissionId === "string" ? input.activeMissionId : void 0,
    routeContext: typeof input?.routeContext === "string" ? input.routeContext : void 0,
    recentDecisions: Array.isArray(input?.recentDecisions) ? input.recentDecisions.filter((x) => typeof x === "string") : [],
    updatedAt: typeof input?.updatedAt === "string" ? input.updatedAt : void 0
  };
}
function isPlanArtifact(input) {
  return input?.version === 1 && typeof input?.missionId === "string" && input?.taskDag && Array.isArray(input.taskDag.nodes);
}
function isMissionOutcome(input) {
  return typeof input?.missionId === "string" && typeof input?.goal === "string" && typeof input?.summary === "string";
}
function cloneState$1(state) {
  return {
    version: 1,
    plans: state.plans.slice(),
    outcomes: state.outcomes.slice(),
    stm: { ...state.stm, recentDecisions: state.stm.recentDecisions.slice() },
    evolution: normalizeEvolution(state.evolution)
  };
}
const DEFAULT_STATE = {
  events: []
};
const MODE_ORDER = {
  guard: 0,
  transform: 1,
  observe: 2
};
const MAX_EVENTS = 2e3;
const MAX_SIDE_EFFECT_DEPTH = 4;
class CollaborationEventRejected extends Error {
  constructor(modName, reason) {
    super(`Event rejected by mod/${modName}: ${reason}`);
    this.modName = modName;
    this.reason = reason;
  }
}
class CollaborationPipeline {
  mods = [];
  constructor(mods = []) {
    for (const mod of mods) this.add(mod);
  }
  add(mod) {
    this.mods.push(mod);
    this.sort();
  }
  remove(name) {
    this.mods = this.mods.filter((mod) => mod.name !== name);
  }
  list() {
    return this.mods.slice();
  }
  async process(event, context) {
    let current = event;
    for (const mod of this.mods) {
      if (!matchesAny(current.type, mod.intercepts || [])) continue;
      if (mod.mode === "guard") {
        const result = await mod.process(current, context);
        if (result === null) throw new CollaborationEventRejected(mod.name, "rejected by guard");
        if (result) current = result;
      } else if (mod.mode === "transform") {
        const result = await mod.process(current, context);
        if (result) current = result;
      } else {
        await mod.process(current, context);
      }
    }
    return current;
  }
  sort() {
    this.mods.sort((a, b) => MODE_ORDER[a.mode] - MODE_ORDER[b.mode] || (a.priority || 50) - (b.priority || 50));
  }
}
class CollaborationBus {
  root;
  eventsPath;
  pipeline;
  constructor(root, pipeline2 = new CollaborationPipeline()) {
    this.root = node_path.basename(node_path.normalize(root)) === "collaboration" ? root : node_path.join(root, "collaboration");
    this.eventsPath = node_path.join(this.root, "events.json");
    this.pipeline = pipeline2;
    node_fs.mkdirSync(this.root, { recursive: true });
  }
  register(mod) {
    this.pipeline.add(mod);
  }
  async append(input) {
    const event = isCollaborationEvent(input) ? input : createCollaborationEvent(input);
    return this.appendEvent(event, 0);
  }
  list(filter = {}) {
    let events2 = this.read().events.slice();
    if (filter.missionId) events2 = events2.filter((event) => event.missionId === filter.missionId);
    if (filter.channel) events2 = events2.filter((event) => event.channel === filter.channel);
    if (filter.source) events2 = events2.filter((event) => event.source === filter.source);
    if (filter.target) events2 = events2.filter((event) => event.target === filter.target);
    if (filter.type) events2 = events2.filter((event) => event.type === filter.type);
    if (filter.typePrefix) events2 = events2.filter((event) => event.type.startsWith(filter.typePrefix));
    events2 = events2.sort((a, b) => b.timestamp - a.timestamp);
    return typeof filter.limit === "number" ? events2.slice(0, Math.max(0, filter.limit)) : events2;
  }
  buildMissionTimeline(missionId, limit = 50) {
    return this.list({ missionId, limit }).slice().reverse().map((event) => {
      const payload = event.payload && typeof event.payload === "object" ? summarizePayload(event.payload) : String(event.payload || "");
      return `${new Date(event.timestamp).toISOString()} ${event.type} ${event.source} -> ${event.target}${payload ? ` | ${payload}` : ""}`;
    }).join("\n").slice(0, 6e3);
  }
  async appendEvent(event, depth) {
    if (depth > MAX_SIDE_EFFECT_DEPTH) throw new Error("Collaboration side-effect depth exceeded");
    parseCollaborationAddress(event.source);
    parseCollaborationAddress(event.target);
    const context = makeContext(event.network, event.source);
    const processed = await this.pipeline.process(event, context);
    this.persist(processed);
    for (const sideEffect of context.sideEffects) {
      await this.appendEvent(sideEffect, depth + 1);
    }
    return processed;
  }
  persist(event) {
    const state = this.read();
    state.events = [event, ...state.events.filter((item) => item.id !== event.id)].slice(0, MAX_EVENTS);
    this.write(state);
  }
  read() {
    if (!node_fs.existsSync(this.eventsPath)) return cloneState(DEFAULT_STATE);
    try {
      const parsed = JSON.parse(node_fs.readFileSync(this.eventsPath, "utf-8"));
      return {
        version: 1,
        events: Array.isArray(parsed.events) ? parsed.events.filter(isCollaborationEvent) : []
      };
    } catch {
      return cloneState(DEFAULT_STATE);
    }
  }
  write(state) {
    node_fs.mkdirSync(this.root, { recursive: true });
    node_fs.writeFileSync(this.eventsPath, JSON.stringify(state, null, 2), "utf-8");
  }
}
function makeContext(networkId, agentAddress2) {
  const context = {
    networkId,
    agentAddress: agentAddress2,
    sideEffects: [],
    extra: {},
    emit(event) {
      context.sideEffects.push(event);
    }
  };
  return context;
}
function matchesAny(eventType, patterns) {
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => wildcardMatch(eventType, pattern));
}
function wildcardMatch(value, pattern) {
  if (pattern === "*") return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}
function isCollaborationEvent(input) {
  return !!input && typeof input.id === "string" && typeof input.type === "string" && typeof input.source === "string" && typeof input.target === "string" && typeof input.timestamp === "number" && typeof input.network === "string" && typeof input.visibility === "string" && input.metadata && typeof input.metadata === "object";
}
function cloneState(state) {
  return {
    version: 1,
    events: state.events.slice()
  };
}
function summarizePayload(payload) {
  const pieces = [];
  for (const key of ["missionId", "contractId", "status", "agentId", "decision", "summary", "error", "title"]) {
    const value = payload[key];
    if (typeof value === "string" && value) pieces.push(`${key}=${value.slice(0, 120)}`);
  }
  return pieces.join(" ");
}
const REFERENCE_LAUNCHER_RELATIVE = node_path.join(
  "reference_repos",
  "collaboration-frameworks",
  "openagents",
  "packages",
  "agent-connector",
  "bin",
  "agent-connector.js"
);
const SUPPORTED_COMMANDS = [
  "help",
  "version",
  "status",
  "list",
  "runtimes",
  "search",
  "workspace",
  "create",
  "remove",
  "start",
  "stop",
  "up",
  "down",
  "connect",
  "disconnect",
  "env",
  "skills",
  "tool-mode",
  "logs",
  "mcp-server"
];
function defaultOpenAgentsConfigDir(userDataRoot) {
  return node_path.join(userDataRoot, "openagents");
}
function discoverOpenAgentsLaunchers(options = {}) {
  const env = options.env || process.env;
  const nodeBin = options.nodeBin || env.OPENAGENTS_NODE_BIN || "node";
  const candidates = [];
  const configured = options.launcherBin || env.OPENAGENTS_LAUNCHER_BIN;
  if (configured) {
    const resolved = node_path.resolve(configured);
    if (configured.endsWith(".js")) {
      candidates.push({
        kind: "configured-js",
        command: nodeBin,
        argsPrefix: [resolved],
        label: `configured js launcher (${resolved})`,
        packagePath: findNearestPackageJson(resolved),
        packageVersion: packageVersion(findNearestPackageJson(resolved)),
        cwd: node_path.dirname(resolved)
      });
    } else {
      candidates.push({
        kind: "configured-command",
        command: node_fs.existsSync(resolved) ? resolved : configured,
        argsPrefix: [],
        label: `configured command (${configured})`
      });
    }
  }
  const reference = findReferenceLauncher(options.projectRoot, env);
  if (reference) {
    candidates.push({
      kind: "local-reference",
      command: nodeBin,
      argsPrefix: [reference],
      label: `local reference (${reference})`,
      packagePath: findNearestPackageJson(reference),
      packageVersion: packageVersion(findNearestPackageJson(reference)),
      cwd: node_path.dirname(reference)
    });
  }
  candidates.push({
    kind: "path-command",
    command: "agn",
    argsPrefix: [],
    label: "agn from PATH"
  });
  return dedupeCandidates(candidates);
}
function selectOpenAgentsLauncher(options = {}) {
  return discoverOpenAgentsLaunchers(options)[0] || null;
}
async function runOpenAgentsLauncher(args, options = {}) {
  const selected = selectOpenAgentsLauncher(options);
  if (!selected) throw new Error("No OpenAgents launcher candidate found");
  const configDir = options.configDir || defaultOpenAgentsConfigDir(node_path.join(node_os.homedir(), "Library", "Application Support", "agenthub"));
  const fullArgs = [...selected.argsPrefix, ...args];
  if (!hasFlag(fullArgs, "--config")) fullArgs.push("--config", configDir);
  const env = {
    ...process.env,
    ...options.env || {},
    OPENAGENTS_SKIP_UPDATE_CHECK: "1"
  };
  if (options.endpoint) env.OPENAGENTS_ENDPOINT = options.endpoint;
  const result = await execFileText(selected.command, fullArgs, {
    cwd: selected.cwd,
    env,
    timeout: options.timeoutMs || 1e4
  });
  return {
    command: selected.command,
    args: fullArgs,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr
  };
}
async function checkOpenAgentsCompatibility(options = {}) {
  const env = options.env || process.env;
  const configDir = options.configDir || defaultOpenAgentsConfigDir(node_path.join(node_os.homedir(), "Library", "Application Support", "agenthub"));
  const endpoint = options.endpoint || env.OPENAGENTS_ENDPOINT || "https://workspace-endpoint.openagents.org";
  const candidates = discoverOpenAgentsLaunchers({ ...options, env });
  const selected = candidates[0];
  const checks = [];
  const warnings = [];
  const nodeCheck = await checkNode(options.nodeBin || env.OPENAGENTS_NODE_BIN || "node", env);
  checks.push(nodeCheck);
  checks.push({
    name: "launcher.discovered",
    ok: !!selected,
    detail: selected ? selected.label : "No OpenAgents launcher was found"
  });
  checks.push({
    name: "config.isolated",
    ok: normalizePath(configDir) !== normalizePath(node_path.join(node_os.homedir(), ".openagents")),
    detail: configDir
  });
  if (selected?.kind === "path-command") {
    warnings.push("Using agn from PATH. This is compatible, but not pinned to the cloned OpenAgents commit.");
  }
  if (selected?.packageVersion) {
    checks.push({
      name: "launcher.version.package",
      ok: true,
      detail: selected.packageVersion
    });
  }
  let commandCheck = { ok: false, detail: "not run" };
  if (selected) {
    try {
      const version = await runOpenAgentsLauncher(["version"], {
        ...options,
        env,
        configDir,
        endpoint,
        timeoutMs: options.timeoutMs || 1e4
      });
      commandCheck = {
        ok: version.exitCode === 0 && /openagents|agent-launcher|@openagents-org/i.test(version.stdout),
        detail: (version.stdout || version.stderr).trim() || `exit ${version.exitCode}`
      };
    } catch (e) {
      commandCheck = { ok: false, detail: e?.message || String(e) };
    }
  }
  checks.push({ name: "launcher.responds", ...commandCheck });
  const compatible = checks.every((check) => check.ok);
  return {
    compatible,
    selected: compatible ? selected : selected,
    candidates,
    checks,
    warnings,
    configDir,
    endpoint,
    supportedCommands: SUPPORTED_COMMANDS.slice()
  };
}
function findReferenceLauncher(projectRoot, env = process.env) {
  const starts = [
    projectRoot,
    env.AGENTFORGE_PROJECT_ROOT,
    process.cwd(),
    __dirname
  ].filter((value) => !!value);
  for (const start of starts) {
    for (const root of walkUp(node_path.resolve(start), 8)) {
      const candidate = node_path.join(root, REFERENCE_LAUNCHER_RELATIVE);
      if (node_fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}
function walkUp(start, limit) {
  const out = [];
  let current = start;
  for (let i = 0; i < limit; i++) {
    out.push(current);
    const next = node_path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return out;
}
function findNearestPackageJson(filePath) {
  for (const root of walkUp(node_path.dirname(filePath), 8)) {
    const candidate = node_path.join(root, "package.json");
    if (node_fs.existsSync(candidate)) return candidate;
  }
  return void 0;
}
function packageVersion(packagePath) {
  if (!packagePath) return void 0;
  try {
    const parsed = JSON.parse(node_fs.readFileSync(packagePath, "utf-8"));
    return typeof parsed.version === "string" ? parsed.version : void 0;
  } catch {
    return void 0;
  }
}
function dedupeCandidates(candidates) {
  const seen = /* @__PURE__ */ new Set();
  return candidates.filter((candidate) => {
    const key = [candidate.command, ...candidate.argsPrefix].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function hasFlag(args, flag) {
  return args.includes(flag) || args.some((arg) => arg.startsWith(flag + "="));
}
function normalizePath(input) {
  return node_path.resolve(input).replace(/\/+$/, "");
}
async function checkNode(command, env) {
  try {
    const result = await execFileText(command, ["--version"], { env, timeout: 5e3 });
    const version = (result.stdout || result.stderr).trim().replace(/^v/, "");
    const major = Number(version.split(".")[0]);
    return {
      name: "node.version",
      ok: Number.isFinite(major) && major >= 18,
      detail: version || `exit ${result.exitCode}`
    };
  } catch (e) {
    return { name: "node.version", ok: false, detail: e?.message || String(e) };
  }
}
function execFileText(command, args, options) {
  return new Promise((resolve2) => {
    node_child_process.execFile(command, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
      windowsHide: true
    }, (error, stdout, stderr) => {
      resolve2({
        exitCode: typeof error?.code === "number" ? error.code : 0,
        stdout: String(stdout || ""),
        stderr: String(stderr || error?.message || "")
      });
    });
  });
}
const BUILTIN_SKILLS = [
  {
    name: "Code Reviewer",
    description: "审查代码改动：找正确性 bug 与可简化/复用点",
    tags: ["builtin", "review", "coding"],
    source: "builtin",
    instructions: [
      "When reviewing code, focus on:",
      "1. Correctness bugs: off-by-one, null/undefined, race conditions, error handling, edge cases.",
      "2. Reuse & simplification: duplicated logic, existing utilities that should be used, dead code.",
      "3. Security: injection, path traversal, secret leakage, unsafe deserialization.",
      "Report findings as a short prioritized list. Cite file:line. Be concrete, no vague praise."
    ].join("\n")
  },
  {
    name: "Test Writer",
    description: "为改动补单元测试，覆盖正常/边界/失败路径",
    tags: ["builtin", "testing", "coding"],
    source: "builtin",
    instructions: [
      "When asked to add tests:",
      "1. Match the project's existing test framework and file conventions.",
      "2. Cover the happy path, boundary values, and at least one failure/error path.",
      "3. Keep each test focused and independent; avoid shared mutable state.",
      "4. Prefer asserting behavior/outputs over implementation details."
    ].join("\n")
  },
  {
    name: "Concise Writer",
    description: "中英技术写作：信息密度高、无套话",
    tags: ["builtin", "writing"],
    source: "builtin",
    instructions: [
      "When writing prose or docs:",
      "- Lead with the conclusion, then support it.",
      "- Cut filler, hedging, and generic disclaimers.",
      "- Prefer concrete nouns/verbs and short sentences.",
      "- Keep the user's language (zh/en) consistent with their request."
    ].join("\n")
  }
];
let mainWindow = null;
let tray = null;
let hub = null;
const registry = new AgentRegistry();
const pipeline = new EventPipeline();
const router = new KeywordRouter();
electron.app.setName("Orbit");
try {
  electron.app.setPath("userData", path.join(electron.app.getPath("appData"), "agenthub"));
} catch {
}
const providerMgr = getProviderManager();
let dispatcher = null;
const proxy = getLocalProxy();
let memoryLibrary = null;
let missionStore = null;
let collaborationBus = null;
function prepareLocalCliEnvironment() {
  const home = os.homedir();
  const extraPaths = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".volta", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".local", "bin"),
    path.join(home, ".cargo", "bin")
  ];
  const currentPath = process.env.PATH || "";
  process.env.PATH = [...extraPaths, currentPath].filter(Boolean).join(":");
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    for (const fileName of [".agenthub-oauth-token", ".orbit-oauth-token"]) {
      const filePath = path.join(home, fileName);
      try {
        if (!fs.existsSync(filePath)) continue;
        const token = fs.readFileSync(filePath, "utf-8").trim();
        if (token) {
          process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
          break;
        }
      } catch {
      }
    }
  }
}
function memory() {
  if (!memoryLibrary) memoryLibrary = new MemoryLibrary(electron.app.getPath("userData"));
  return memoryLibrary;
}
function missions() {
  if (!missionStore) missionStore = new MissionStore(electron.app.getPath("userData"));
  return missionStore;
}
function collaboration() {
  if (!collaborationBus) collaborationBus = new CollaborationBus(electron.app.getPath("userData"));
  return collaborationBus;
}
function seedCoreMemories() {
  const entries = [
    {
      id: "system:agenthub-main-agent-principle",
      category: "system",
      title: "Orbit Hub is the main orchestrator agent",
      summary: "User intent: accept a project goal, decompose it, coordinate sub-agents, then verify and synthesize.",
      content: [
        "Orbit Hub is not primarily a multi-model chat shell.",
        "It is the main Agent / Orchestrator for project collaboration.",
        "The main Agent reads the project, uses memory, creates a task DAG, assigns bounded task contracts to sub-agents, supervises progress, resolves coordination issues, and produces a final acceptance summary."
      ].join("\n"),
      tags: ["architecture", "main-agent", "orchestrator"]
    },
    {
      id: "procedure:sub-agent-task-contract",
      category: "procedure",
      title: "Sub-agent task contract",
      summary: "Every worker task should carry file scope, done criteria, verify command, and interface reference.",
      content: [
        "Each sub-agent receives a bounded contract:",
        "- title and concrete detail",
        "- fileScope / ownership boundary",
        "- dependsOn / task DAG ordering when work cannot safely run in parallel",
        "- doneWhen acceptance criteria",
        "- verifyCommand where available",
        "- interfaceRef for shared API, data shape, UI, naming, or design decisions",
        "This keeps task granularity aligned and prevents workers from implementing mismatched specs."
      ].join("\n"),
      tags: ["task-contract", "coordination", "granularity"]
    },
    {
      id: "semantic:memory-layering",
      category: "semantic",
      title: "Three-layer memory model",
      summary: "STM for active mission, episodic LTM for outcomes, semantic/procedure LTM for project rules and reusable skills.",
      content: [
        "STM: active mission context, current task DAG, worker state, recent decisions, and message routing context.",
        "Episodic LTM: past mission outcomes, failures, repairs, verification results, and lessons.",
        "Semantic/procedure LTM: project conventions, Agent capabilities, reusable commands, operating rules, and architecture decisions.",
        "Planner startup must read recent mission outcomes before proposing a new PlanArtifact.",
        "Workers keep private execution history; only results, contract changes, blockers, and lessons are promoted to shared memory."
      ].join("\n"),
      tags: ["memory", "stm", "ltm", "episodic", "semantic"]
    },
    {
      id: "semantic:user-bridge-agent-boundary",
      category: "semantic",
      title: "Hermes is a user bridge, not an execution worker",
      summary: "Hermes notifies the user, receives remote instructions, and relays approvals; it should not receive coding, deployment, database, or file-writing contracts.",
      content: [
        "Orbit can let the user choose Hermes as the user progress bridge.",
        "The selected bridge receives notification events such as plan proposed, contract completed/failed, and mission completed/failed.",
        "Remote user requirements arriving through the bridge should be recorded into STM or decisions before Orbit replans.",
        "Do not route coding, deployment, database, or workspace mutation tasks to Hermes by default.",
        "Execution workers are Codex CLI and Claude Code."
      ].join("\n"),
      tags: ["agent-roles", "user-bridge", "hermes", "routing"]
    }
  ];
  for (const entry of entries) memory().upsertEntry(entry);
}
function recordDispatchOutcome(task) {
  try {
    const results = task?.results instanceof Map ? Object.fromEntries(task.results) : task?.results || {};
    const errors = task?.errors instanceof Map ? Object.fromEntries(task.errors) : task?.errors || {};
    const agentIds = Array.from(/* @__PURE__ */ new Set([...Object.keys(results), ...Object.keys(errors)]));
    memory().upsertEntry({
      id: `episodic:dispatch:${task.id}`,
      category: "episodic",
      title: `Dispatch outcome: ${String(task.text || task.id).slice(0, 80)}`,
      summary: `${task.status || "unknown"} · ${agentIds.join(", ") || "no agents"} · ${Object.keys(errors).length} error(s)`,
      content: JSON.stringify({
        taskId: task.id,
        missionId: task.missionId,
        text: task.text,
        mode: task.mode,
        status: task.status,
        targetAgent: task.targetAgent,
        planArtifact: task.planArtifact,
        agents: agentIds,
        resultPreview: Object.fromEntries(Object.entries(results).map(([agentId, value]) => [agentId, String(value).slice(0, 1200)])),
        errors
      }, null, 2),
      tags: ["dispatch", "outcome", task.mode, task.status].filter(Boolean),
      metadata: { taskId: task.id, missionId: task.missionId, mode: task.mode, status: task.status, agentIds }
    });
  } catch (e) {
    console.warn("[Memory] failed to record dispatch outcome:", e);
  }
}
function appAssetPath(fileName) {
  const packaged = path.join(process.resourcesPath, "build", fileName);
  if (electron.app.isPackaged && fs.existsSync(packaged)) return packaged;
  const fromAppPath = path.join(electron.app.getAppPath(), "build", fileName);
  if (fs.existsSync(fromAppPath)) return fromAppPath;
  return path.join(process.cwd(), "build", fileName);
}
function createWindow() {
  const iconPath = appAssetPath(process.platform === "win32" ? "icon.ico" : "icon.png");
  mainWindow = new electron.BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Orbit",
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false,
    frame: false,
    backgroundColor: "#101319"
  });
  mainWindow.on("ready-to-show", () => mainWindow?.show());
  mainWindow.on("maximize", () => mainWindow?.webContents.send("win:maximized", true));
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send("win:maximized", false));
  mainWindow.on("close", (event) => {
    if (appStore.get("minimizeToTray") !== false) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
function createTray() {
  const trayIcon = electron.nativeImage.createFromPath(appAssetPath("icon.png"));
  tray = new electron.Tray(trayIcon);
  const contextMenu = electron.Menu.buildFromTemplate([
    { label: "Open Orbit", click: () => mainWindow?.show() },
    { type: "separator" },
    { label: "Status: Running", enabled: false },
    { type: "separator" },
    { label: "Quit", click: () => {
      electron.app.isQuitting = true;
      electron.app.quit();
    } }
  ]);
  tray.setToolTip("Orbit - Multi-Agent Workspace");
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => mainWindow?.show());
}
function registerAgentsFromBindings() {
  syncRegistryFromBindings(registry, providerMgr.getBindings());
}
async function initHub() {
  registerAgentsFromBindings();
  pipeline.register({
    name: "rate-limiter",
    type: "guard",
    handle: async (event) => event
  });
  pipeline.register({
    name: "logger",
    type: "observe",
    handle: async (event) => {
      console.log("[Pipeline] " + event.source + " -> " + event.target);
      return event;
    }
  });
  dispatcher = new Dispatcher(
    registry,
    pipeline,
    () => memory().getCatalog().entries.slice(0, 12),
    missions(),
    new Supervisor(),
    collaboration()
  );
  hub = new HubServer(registry);
  hub.on("client:message", async ({ clientId: _clientId, message }) => {
    if (message.type === "chat:message") {
      const task = await dispatcher.dispatch(
        message.payload.text,
        message.payload.mode || "auto",
        message.payload.targetAgent,
        {
          thinking: message.payload.thinking,
          workspaceId: message.payload.workspaceId ?? null,
          requirePlanApproval: !!message.payload.requirePlanApproval,
          rounds: message.payload.rounds,
          participants: message.payload.participants
        }
      );
      recordDispatchOutcome(task);
      hub?.broadcast("chat:response", {
        taskId: task.id,
        status: task.status,
        results: Array.from(task.results.entries()).map(([agentId, content]) => ({
          agentId,
          content,
          thinking: task.thinking.get(agentId) || ""
        })),
        errors: Array.from(task.errors.entries()),
        thinkingSummary: Array.from(task.thinkingSummary.entries()),
        error: task.error
      });
      if (task.status === "completed") {
        const agents = Array.from(task.results.keys()).join(", ");
        if (agents) {
          new electron.Notification({ title: "Orbit Hub", body: "Task done by " + agents, silent: true }).show();
        }
      }
    }
  });
  dispatcher.on("stream", (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("dispatch:stream", event);
    }
  });
  hub.start();
  try {
    await proxy.start();
    console.log("[Proxy] Local Chat Completions:", proxy.getUrl());
  } catch (e) {
    console.error("[Proxy] Failed to start:", e);
  }
  detectAgentsAsync().then(() => console.log("[Hub] Initial agent detection complete")).catch((e) => console.error("[Hub] Initial detection failed:", e));
}
electron.ipcMain.handle("hub:status", () => ({
  running: hub !== null,
  url: hub?.getUrl() || "",
  proxyUrl: proxy.getUrl(),
  clientCount: hub?.getClientCount() || 0,
  agents: registry.getAll().map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    capabilities: a.capabilities,
    providerId: a.providerId,
    modelId: a.modelId,
    errorCount: a.errorCount
  })),
  tasks: dispatcher?.getRecentTasks(10).map((t) => ({
    id: t.id,
    text: t.text.slice(0, 50),
    mode: t.mode,
    status: t.status,
    createdAt: t.createdAt
  })) || []
}));
electron.ipcMain.handle("hub:dispatch", async (_event, payload) => {
  const task = await dispatcher?.dispatch(payload.text, payload.mode || "auto", payload.targetAgent, {
    thinking: payload.thinking,
    workspaceId: payload.workspaceId ?? null,
    requirePlanApproval: !!payload.requirePlanApproval,
    rounds: payload.rounds,
    participants: payload.participants
  });
  if (task) recordDispatchOutcome(task);
  return task;
});
electron.ipcMain.handle("hub:approvePlan", async (_event, taskId, approved) => dispatcher?.resolvePlanApproval(taskId, approved) ?? false);
electron.ipcMain.handle("hub:routePreview", async (_event, text) => routePreview(text, registry, router, missions().getRouterContext()));
electron.ipcMain.handle("hub:rescan", async () => {
  const agents = await detectAgentsAsync();
  return agents.map((d) => ({
    id: d.id,
    name: d.name,
    found: d.found,
    capabilities: d.capabilities,
    providerId: d.providerId,
    modelId: d.modelId,
    baseUrl: d.baseUrl,
    reachable: d.reachable,
    error: d.error
  }));
});
electron.ipcMain.handle("hub:cancel", async (_event, taskId) => dispatcher?.cancel(taskId));
electron.ipcMain.handle("store:get", async (_event, key) => appStore.get(key));
electron.ipcMain.handle("store:set", async (_event, key, value) => {
  appStore.set(key, value);
  return true;
});
electron.ipcMain.handle("network:getProxy", () => getOutboundProxy());
electron.ipcMain.handle("network:setProxy", (_e, url2) => {
  const v = typeof url2 === "string" ? url2.trim() : "";
  appStore.set("network.proxyUrl", v);
  setOutboundProxy(v);
  return getOutboundProxy();
});
electron.ipcMain.handle("memory:catalog", async () => memory().getCatalog());
electron.ipcMain.handle("memory:list", async (_event, category) => memory().listEntries(category));
electron.ipcMain.handle("memory:addEntry", async (_event, entry) => memory().upsertEntry(entry));
electron.ipcMain.handle("memory:loadState", async () => memory().loadRuntimeState());
electron.ipcMain.handle("memory:saveState", async (_event, state) => memory().saveRuntimeState(state));
electron.ipcMain.handle("missions:plans", async () => missions().listPlans());
electron.ipcMain.handle("missions:outcomes", async (_event, limit) => missions().listOutcomes(limit || 50));
electron.ipcMain.handle("missions:active", async () => missions().getActivePlan());
electron.ipcMain.handle("missions:stm", async () => missions().getSTM());
electron.ipcMain.handle("collaboration:events", async (_event, filter) => collaboration().list(filter || {}));
electron.ipcMain.handle("collaboration:timeline", async (_event, missionId, limit) => collaboration().buildMissionTimeline(missionId, limit || 50));
electron.ipcMain.handle("openagents:compatibility", async () => checkOpenAgentsCompatibility({
  configDir: defaultOpenAgentsConfigDir(electron.app.getPath("userData")),
  endpoint: process.env.OPENAGENTS_ENDPOINT,
  projectRoot: process.env.AGENTFORGE_PROJECT_ROOT || process.cwd()
}));
electron.ipcMain.handle("providers:get", async () => providerMgr.getConfig());
electron.ipcMain.handle("providers:upsert", async (_e, p) => {
  providerMgr.upsertProvider(p);
  registerAgentsFromBindings();
  return providerMgr.getConfig();
});
electron.ipcMain.handle("providers:delete", async (_e, id) => {
  const ok = providerMgr.deleteProvider(id);
  if (ok) registerAgentsFromBindings();
  return ok;
});
electron.ipcMain.handle("providers:setEnabled", async (_e, id, enabled) => {
  providerMgr.setProviderEnabled(id, enabled);
  return providerMgr.getConfig();
});
electron.ipcMain.handle("providers:setKey", async (_e, id, key) => {
  providerMgr.setProviderApiKey(id, key);
  registerAgentsFromBindings();
  if (key) providerMgr.fetchModels(id).catch(() => {
  });
  return providerMgr.getConfig();
});
electron.ipcMain.handle("providers:fetchModels", async (_e, id) => {
  const r = await providerMgr.fetchModels(id);
  return { ...r, config: providerMgr.getConfig() };
});
electron.ipcMain.handle("providers:health", async (_e, id) => providerMgr.checkProviderHealth(id));
electron.ipcMain.handle("providers:healthAll", async () => {
  const results = {};
  for (const p of providerMgr.getProviders()) {
    results[p.id] = await providerMgr.checkProviderHealth(p.id);
  }
  return results;
});
electron.ipcMain.handle("routing:setBinding", async (_e, b) => {
  providerMgr.upsertBinding(b);
  registerAgentsFromBindings();
  return providerMgr.getBindings();
});
electron.ipcMain.handle("routing:removeBinding", async (_e, agentId) => {
  providerMgr.removeBinding(agentId);
  registerAgentsFromBindings();
  return providerMgr.getBindings();
});
electron.ipcMain.handle("routing:setFallback", async (_e, chain) => {
  providerMgr.setFallbackChain(chain);
  return providerMgr.getConfig().routing;
});
electron.ipcMain.handle("routing:setStrategy", async (_e, s) => {
  providerMgr.setStrategy(s);
  return providerMgr.getConfig().routing;
});
electron.ipcMain.handle("routing:setBindingThinking", async (_e, agentId, t) => {
  providerMgr.setBindingThinking(agentId, t);
  return providerMgr.getBindings();
});
electron.ipcMain.handle("routing:setProviderThinking", async (_e, id, t) => {
  providerMgr.setProviderThinking(id, t);
  return providerMgr.getConfig();
});
electron.ipcMain.handle("routing:activeBinding", async (_e, agentId) => {
  providerMgr.setActiveBinding(agentId);
  return providerMgr.getConfig().activeBindingId;
});
electron.ipcMain.handle("proxy:info", async () => ({
  url: proxy.getUrl(),
  openaiUrl: proxy.getUrl(),
  anthropicUrl: proxy.getOrigin(),
  running: true
}));
electron.ipcMain.handle("takeover:status", async () => takeoverStatus());
electron.ipcMain.handle("takeover:apply", async (_e, app2, modelRef) => takeoverApply(app2, modelRef, proxy.getUrl(), proxy.getOrigin()));
electron.ipcMain.handle("takeover:restore", async (_e, app2) => takeoverRestore(app2));
electron.ipcMain.handle("agents:locate", async () => locateAgentCandidates());
electron.ipcMain.handle("app:openExternal", async (_e, url2) => {
  if (/^https?:\/\//.test(url2) || /^mailto:/.test(url2)) await electron.shell.openExternal(url2);
});
electron.ipcMain.handle("app:pickFolder", async () => {
  if (!mainWindow) return null;
  const r = await electron.dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
});
electron.ipcMain.handle("workspaces:list", () => getWorkspaceManager().list());
electron.ipcMain.handle("workspaces:create", (_e, input) => {
  try {
    return getWorkspaceManager().create(input);
  } catch (e) {
    throw serialiseWsError(e);
  }
});
electron.ipcMain.handle("workspaces:update", (_e, id, patch) => {
  try {
    return getWorkspaceManager().update(id, patch);
  } catch (e) {
    throw serialiseWsError(e);
  }
});
electron.ipcMain.handle("workspaces:remove", (_e, id) => {
  try {
    return getWorkspaceManager().remove(id);
  } catch (e) {
    throw serialiseWsError(e);
  }
});
electron.ipcMain.handle("workspaces:getActive", () => getWorkspaceManager().getActive());
electron.ipcMain.handle("workspaces:setActive", (_e, id) => {
  try {
    getWorkspaceManager().setActive(id);
    return getWorkspaceManager().getActive();
  } catch (e) {
    throw serialiseWsError(e);
  }
});
function serialiseWsError(e) {
  if (e instanceof WorkspaceNotFoundError || e instanceof WorkspacePathInvalidError) {
    const err = new Error(e.message);
    err.code = e.code;
    return err;
  }
  return e;
}
electron.ipcMain.handle("skills:list", () => getSkillManager().list());
electron.ipcMain.handle("skills:builtins", () => BUILTIN_SKILLS);
electron.ipcMain.handle("skills:add", (_e, input) => getSkillManager().add(input));
electron.ipcMain.handle("skills:update", (_e, id, patch) => getSkillManager().update(id, patch));
electron.ipcMain.handle("skills:remove", (_e, id) => getSkillManager().remove(id));
electron.ipcMain.handle("skills:getInstalls", () => getSkillManager().getInstalls());
electron.ipcMain.handle("skills:install", (_e, agentId, skillId) => getSkillManager().install(agentId, skillId));
electron.ipcMain.handle("skills:uninstall", (_e, agentId, skillId) => getSkillManager().uninstall(agentId, skillId));
electron.ipcMain.handle("agentic:capabilities", () => getCapabilityMatrix());
electron.ipcMain.handle("agentic:getEnabled", () => getAgenticConfig().getEnabled());
electron.ipcMain.handle("agentic:setEnabled", (_e, agentId, on) => getAgenticConfig().setEnabled(agentId, on));
electron.ipcMain.handle("agentic:getMode", () => getAgenticConfig().getMode());
electron.ipcMain.handle("agentic:setMode", (_e, mode) => getAgenticConfig().setMode(mode));
electron.ipcMain.handle("agentic:getApprovalConfig", () => getApprovalConfig().getConfig());
electron.ipcMain.handle("agentic:setApprovalDefault", (_e, tool, policy) => getApprovalConfig().setDefault(tool, policy));
electron.ipcMain.handle("agentic:setApprovalOverride", (_e, agentId, tool, policy) => getApprovalConfig().setOverride(agentId, tool, policy));
electron.ipcMain.handle("agentic:resolveApproval", (_e, requestId, approved) => dispatcher?.resolveApproval(requestId, approved) ?? false);
electron.ipcMain.handle("win:minimize", () => {
  mainWindow?.minimize();
});
electron.ipcMain.handle("win:maximizeToggle", () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
electron.ipcMain.handle("win:isMaximized", () => mainWindow?.isMaximized() ?? false);
electron.ipcMain.handle("win:close", () => {
  mainWindow?.close();
});
function parseDeepLink(url2) {
  if (!url2 || !url2.startsWith("agenthub://")) return null;
  try {
    const stripped = url2.startsWith("agenthub://") ? url2.slice("agenthub://".length).replace(/^[/]+/, "") : url2;
    const [actionPath, query] = stripped.split("?");
    const action = actionPath.split("/")[0] || "open";
    const params = {};
    if (query) {
      for (const part of query.split("&")) {
        const [k, v] = part.split("=");
        if (k) params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : "";
      }
    }
    return { action, params };
  } catch {
    return null;
  }
}
function handleDeepLink(url2) {
  const link = parseDeepLink(url2);
  if (!link) return;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("app:deep-link", link);
  } else {
    pendingDeepLink = link;
  }
}
let pendingDeepLink = null;
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    electron.app.setAsDefaultProtocolClient("agenthub", process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  electron.app.setAsDefaultProtocolClient("agenthub");
}
const gotLock = electron.app.requestSingleInstanceLock();
if (!gotLock) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", (_event, argv) => {
    const url2 = argv.find((a) => a.startsWith("agenthub://"));
    if (url2) handleDeepLink(url2);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
electron.app.on("open-url", (event, url2) => {
  event.preventDefault();
  handleDeepLink(url2);
});
const initialDeepLink = process.argv.find((a) => a.startsWith("agenthub://"));
if (initialDeepLink) pendingDeepLink = parseDeepLink(initialDeepLink);
electron.app.whenReady().then(async () => {
  if (process.platform === "win32") electron.app.setAppUserModelId("dev.agenthub.desktop");
  prepareLocalCliEnvironment();
  setOutboundProxy(String(appStore.get("network.proxyUrl") || ""));
  providerMgr.unlockSecrets();
  seedCoreMemories();
  createWindow();
  createTray();
  await initHub();
  if (pendingDeepLink) {
    mainWindow?.webContents.once("did-finish-load", () => {
      mainWindow?.webContents.send("app:deep-link", pendingDeepLink);
      pendingDeepLink = null;
    });
  }
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("activate", () => {
  if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  else mainWindow?.show();
});
electron.app.on("before-quit", async () => {
  electron.app.isQuitting = true;
  await registry.stopAll();
  hub?.stop();
  proxy.stop();
});
