#!/usr/bin/env node
// ─── Excalidraw MCP Server — Main Entry Point ────────────────────────────────
// Runs stdio MCP server + HTTP/WS bridge (port 3001) concurrently.

import { McpServer }            from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z }                    from "zod";
import { startBridge, getBridgeStatus, pushScene, getActiveScene, BRIDGE_PORT } from "./bridge.js";
import { listBoards, getBoard, saveBoard, deleteBoard, renameBoard, tagBoard, storageDirPath, boardsDirPath } from "./storage.js";

const server = new McpServer({ name: "excalidraw-mcp-server", version: "1.0.0" });

const ok  = (text: string) => ({ content: [{ type: "text" as const, text }] });
const err = (text: string) => ({ content: [{ type: "text" as const, text: `Error: ${text}` }], isError: true as const });

// ── excalidraw_status ─────────────────────────────────────────────────────────
server.registerTool("excalidraw_status", {
  title: "Bridge & Storage Status",
  description: "Check bridge connection and show where boards are stored.",
  inputSchema: z.object({}).strict(),
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async () => ok(JSON.stringify({
  ...getBridgeStatus(),
  storageDir: storageDirPath(),
  boardsDir:  boardsDirPath(),
  injectSnippet: `<script src="http://127.0.0.1:${BRIDGE_PORT}/bridge.js"></script>`,
}, null, 2)));

// ── excalidraw_list_boards ────────────────────────────────────────────────────
server.registerTool("excalidraw_list_boards", {
  title: "List Boards",
  description: "List all saved boards (newest first). Optional tag filter.",
  inputSchema: z.object({ tag: z.string().optional().describe("Filter by tag") }).strict(),
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async ({ tag }) => {
  let boards = listBoards();
  if (tag) { const l = tag.toLowerCase(); boards = boards.filter((b) => b.tags.some((t) => t.toLowerCase().includes(l))); }
  return boards.length === 0 ? ok("No boards saved yet.") : ok(JSON.stringify(boards, null, 2));
});

// ── excalidraw_get_board ──────────────────────────────────────────────────────
server.registerTool("excalidraw_get_board", {
  title: "Get Board",
  description: "Retrieve full board content (elements + appState) by name, slug, or id.",
  inputSchema: z.object({ board: z.string().min(1).describe("Board name, slug, or id") }).strict(),
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async ({ board }) => {
  const b = getBoard(board);
  return b ? ok(JSON.stringify(b, null, 2)) : err(`Board "${board}" not found.`);
});

// ── excalidraw_create_board ───────────────────────────────────────────────────
server.registerTool("excalidraw_create_board", {
  title: "Create Board",
  description: "Create a new named board. Fails if name already exists (use save_board to upsert).",
  inputSchema: z.object({
    name:        z.string().min(1).max(128),
    elements:    z.array(z.record(z.unknown())).describe("Excalidraw elements"),
    appState:    z.record(z.unknown()).optional(),
    description: z.string().max(512).optional(),
    tags:        z.array(z.string()).optional(),
  }).strict(),
  annotations: { readOnlyHint: false, destructiveHint: false },
}, async ({ name, elements, appState, description, tags }) => {
  const existing = listBoards().find((b) => b.name.toLowerCase() === name.toLowerCase());
  if (existing) return err(`Board "${name}" already exists (id: ${existing.id}). Use excalidraw_save_board to overwrite.`);
  const saved = saveBoard(name, elements as never[], appState as never, { description, tags });
  return ok(`Board "${saved.name}" created (id: ${saved.id}, ${saved.elementCount} elements).`);
});

// ── excalidraw_save_board ─────────────────────────────────────────────────────
server.registerTool("excalidraw_save_board", {
  title: "Save / Update Board",
  description: "Upsert a board. If from_browser=true, captures live scene from connected browser.",
  inputSchema: z.object({
    name:         z.string().min(1).max(128),
    elements:     z.array(z.record(z.unknown())).optional(),
    appState:     z.record(z.unknown()).optional(),
    description:  z.string().max(512).optional(),
    tags:         z.array(z.string()).optional(),
    from_browser: z.boolean().default(false).describe("Capture scene from connected browser"),
  }).strict(),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
}, async ({ name, elements, appState, description, tags, from_browser }) => {
  let finalElements = elements as never[] | undefined;
  if (from_browser) {
    try { finalElements = (await getActiveScene()) as never[]; }
    catch (e: unknown) { return err((e as Error).message); }
  }
  if (!finalElements?.length) return err("No elements provided. Pass elements[] or set from_browser=true.");
  const saved = saveBoard(name, finalElements, appState as never, { description, tags });
  return ok(`Board "${saved.name}" saved — ${saved.elementCount} elements, id: ${saved.id}`);
});

// ── excalidraw_load_board ─────────────────────────────────────────────────────
server.registerTool("excalidraw_load_board", {
  title: "Load Board into Browser",
  description: "Push a saved board to the connected Excalidraw browser instance (live, no reload).",
  inputSchema: z.object({ board: z.string().min(1).describe("Board name, slug, or id") }).strict(),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
}, async ({ board }) => {
  const b = getBoard(board);
  if (!b) return err(`Board "${board}" not found.`);
  const { connected } = getBridgeStatus();
  if (!connected) return err(`No browser connected. Add to Excalidraw's index.html:\n<script src="http://127.0.0.1:${BRIDGE_PORT}/bridge.js"></script>`);
  const count = pushScene(b.elements, b.appState);
  return ok(`Board "${b.name}" pushed to ${count} browser(s) live (${b.elementCount} elements).`);
});

// ── excalidraw_get_active ─────────────────────────────────────────────────────
server.registerTool("excalidraw_get_active", {
  title: "Get Active Scene from Browser",
  description: "Capture the current Excalidraw scene from the connected browser.",
  inputSchema: z.object({}).strict(),
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async () => {
  try {
    const elements = await getActiveScene();
    return ok(`${elements.length} elements in active scene.\n\n${JSON.stringify(elements, null, 2)}`);
  } catch (e: unknown) { return err((e as Error).message); }
});

// ── excalidraw_push_scene ─────────────────────────────────────────────────────
server.registerTool("excalidraw_push_scene", {
  title: "Push Scene to Browser",
  description: "Push raw elements to browser for live preview (without saving to disk).",
  inputSchema: z.object({
    elements: z.array(z.record(z.unknown())).describe("Excalidraw elements"),
    appState: z.record(z.unknown()).optional(),
  }).strict(),
  annotations: { readOnlyHint: false, destructiveHint: false },
}, async ({ elements, appState }) => {
  const { connected } = getBridgeStatus();
  if (!connected) return err(`No browser connected. Add bridge.js to Excalidraw's index.html.`);
  const count = pushScene(elements as never[], appState as never);
  return ok(`${elements.length} elements pushed to ${count} browser(s).`);
});

// ── excalidraw_delete_board ───────────────────────────────────────────────────
server.registerTool("excalidraw_delete_board", {
  title: "Delete Board",
  description: "Permanently delete a board and its .excalidraw file.",
  inputSchema: z.object({ board: z.string().min(1) }).strict(),
  annotations: { readOnlyHint: false, destructiveHint: true },
}, async ({ board }) => {
  return deleteBoard(board) ? ok(`Board "${board}" deleted.`) : err(`Board "${board}" not found.`);
});

// ── excalidraw_rename_board ───────────────────────────────────────────────────
server.registerTool("excalidraw_rename_board", {
  title: "Rename Board",
  description: "Rename a board (slug/file path stays stable).",
  inputSchema: z.object({
    board:    z.string().min(1),
    new_name: z.string().min(1).max(128),
  }).strict(),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
}, async ({ board, new_name }) => {
  const meta = renameBoard(board, new_name);
  return meta ? ok(`Renamed to "${meta.name}".\n${JSON.stringify(meta, null, 2)}`) : err(`Board "${board}" not found.`);
});

// ── excalidraw_tag_board ──────────────────────────────────────────────────────
server.registerTool("excalidraw_tag_board", {
  title: "Tag Board",
  description: "Set (replace) tags on a board. Pass [] to clear.",
  inputSchema: z.object({
    board: z.string().min(1),
    tags:  z.array(z.string()),
  }).strict(),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
}, async ({ board, tags }) => {
  const meta = tagBoard(board, tags);
  return meta ? ok(`Tags updated for "${meta.name}": [${meta.tags.join(", ")}]`) : err(`Board "${board}" not found.`);
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  startBridge();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] excalidraw-mcp-server running via stdio");
}

main().catch((e: unknown) => {
  console.error("[MCP] Fatal:", e);
  process.exit(1);
});
