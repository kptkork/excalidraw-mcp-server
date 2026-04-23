// ─── Excalidraw MCP Server — WebSocket + HTTP Bridge ─────────────────────────
import { WebSocketServer, WebSocket } from "ws";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { BridgeMessage, BridgeStatus, ExcalidrawElement, AppState } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT ?? "3001", 10);

const connectedClients = new Set<WebSocket>();

type PendingReq = {
  resolve: (el: ExcalidrawElement[]) => void;
  reject:  (e: Error) => void;
  timer:   ReturnType<typeof setTimeout>;
};
const pendingRequests = new Map<string, PendingReq>();

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // POST /push  { elements, appState? }  → push scene to all connected browsers
  if (req.method === "POST" && req.url === "/push") {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const { elements, appState } = JSON.parse(body) as { elements: ExcalidrawElement[]; appState?: Partial<AppState> };
        const sent = pushScene(elements ?? [], appState);
        res.setHeader("Content-Type", "application/json");
        res.writeHead(sent > 0 ? 200 : 202);
        res.end(JSON.stringify({ ok: true, clientsReached: sent }));
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  if (req.url === "/bridge.js") {
    const candidates = [
      join(__dirname, "..", "public", "bridge.js"),
      join(__dirname, "../../public", "bridge.js"),
    ];
    const p = candidates.find(existsSync);
    if (!p) { res.writeHead(404); res.end("bridge.js not found"); return; }
    res.setHeader("Content-Type",  "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.writeHead(200);
    res.end(readFileSync(p, "utf8"));
    return;
  }

  if (req.url === "/status") {
    const s: BridgeStatus = { connected: connectedClients.size > 0, port: BRIDGE_PORT, clientCount: connectedClients.size };
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(JSON.stringify(s));
    return;
  }
  res.writeHead(404); res.end("Not found");
}

export function startBridge(): void {
  const http = createServer(handleHttp);
  const wss  = new WebSocketServer({ server: http });

  wss.on("connection", (ws: WebSocket) => {
    connectedClients.add(ws);
    console.error(`[Bridge] Browser connected (${connectedClients.size} total)`);

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as BridgeMessage;
        if (msg.type === "scene_response" && msg.requestId) {
          const p = pendingRequests.get(msg.requestId);
          if (p) { clearTimeout(p.timer); pendingRequests.delete(msg.requestId); p.resolve(msg.elements ?? []); }
        }
      } catch (e) { console.error("[Bridge] parse error:", e); }
    });

    ws.on("close", () => { connectedClients.delete(ws); console.error(`[Bridge] Browser disconnected (${connectedClients.size} left)`); });
    ws.on("error", () => connectedClients.delete(ws));
  });

  // Keep-alive ping every 20s
  setInterval(() => {
    for (const ws of connectedClients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      else connectedClients.delete(ws);
    }
  }, 20_000);

  http.listen(BRIDGE_PORT, "127.0.0.1", () => {
    console.error(`[Bridge] http://127.0.0.1:${BRIDGE_PORT}  (bridge.js + /status + /push + WS)`);
  });
}

export function getBridgeStatus(): BridgeStatus {
  return { connected: connectedClients.size > 0, port: BRIDGE_PORT, clientCount: connectedClients.size };
}

/** Push a scene to ALL connected browsers. Returns count of browsers reached. */
export function pushScene(elements: ExcalidrawElement[], appState?: Partial<AppState>): number {
  let sent = 0;
  const msg = JSON.stringify({ type: "load_scene", elements, appState } satisfies BridgeMessage);
  for (const ws of connectedClients) {
    if (ws.readyState === WebSocket.OPEN) { ws.send(msg); sent++; }
  }
  return sent;
}

/** Request the active scene from the first connected browser (5 s timeout). */
export function getActiveScene(): Promise<ExcalidrawElement[]> {
  return new Promise<ExcalidrawElement[]>((resolve, reject) => {
    const open = [...connectedClients].filter((ws) => ws.readyState === WebSocket.OPEN);
    if (open.length === 0) {
      reject(new Error(`No browser connected. Open Excalidraw and add bridge.js, then check http://127.0.0.1:${BRIDGE_PORT}/status`));
      return;
    }
    const requestId = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("Timeout: browser did not respond within 5 s"));
    }, 5_000);
    pendingRequests.set(requestId, { resolve, reject, timer });
    open[0].send(JSON.stringify({ type: "get_scene", requestId } satisfies BridgeMessage));
  });
}
