// ─── Excalidraw MCP Server — Board Storage ───────────────────────────────────
import {
  readFileSync, writeFileSync, mkdirSync,
  existsSync, unlinkSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Board, BoardIndex, BoardMeta, ExcalidrawElement, AppState } from "./types.js";

const STORAGE_DIR = join(homedir(), ".excalidraw-mcp");
const BOARDS_DIR  = join(STORAGE_DIR, "boards");
const INDEX_FILE  = join(STORAGE_DIR, "index.json");

export function ensureStorage(): void {
  if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true });
  if (!existsSync(BOARDS_DIR))  mkdirSync(BOARDS_DIR,  { recursive: true });
  if (!existsSync(INDEX_FILE)) {
    writeFileSync(INDEX_FILE, JSON.stringify({ version: "1.0", boards: [] }, null, 2));
  }
}

function readIndex(): BoardIndex {
  ensureStorage();
  return JSON.parse(readFileSync(INDEX_FILE, "utf8")) as BoardIndex;
}
function writeIndex(index: BoardIndex): void {
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 64);
}
function uniqueSlug(slug: string, index: BoardIndex): string {
  const existing = index.boards.map((b) => b.slug);
  if (!existing.includes(slug)) return slug;
  let i = 2;
  while (existing.includes(`${slug}-${i}`)) i++;
  return `${slug}-${i}`;
}
function findMeta(key: string, index: BoardIndex): { meta: BoardMeta; idx: number } | null {
  const lower = key.toLowerCase();
  const idx = index.boards.findIndex(
    (b) => b.id === key || b.slug === key || b.name.toLowerCase() === lower
  );
  return idx < 0 ? null : { meta: index.boards[idx], idx };
}

export function listBoards(): BoardMeta[] {
  return readIndex().boards.sort((a, b) => b.updated.localeCompare(a.updated));
}

export function getBoard(key: string): Board | null {
  const index = readIndex();
  const found = findMeta(key, index);
  if (!found) return null;
  const filePath = join(BOARDS_DIR, `${found.meta.slug}.excalidraw`);
  if (!existsSync(filePath)) return null;
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as { elements: ExcalidrawElement[]; appState?: Partial<AppState> };
  return { ...found.meta, elements: raw.elements ?? [], appState: raw.appState };
}

export function saveBoard(
  name: string,
  elements: ExcalidrawElement[],
  appState?: Partial<AppState>,
  opts?: { description?: string; tags?: string[]; id?: string }
): Board {
  ensureStorage();
  const index = readIndex();
  const now   = new Date().toISOString();
  const existing = index.boards.findIndex(
    (b) => (opts?.id && b.id === opts.id) || b.name.toLowerCase() === name.toLowerCase()
  );
  let meta: BoardMeta;
  if (existing >= 0) {
    meta = { ...index.boards[existing], name,
      description: opts?.description ?? index.boards[existing].description,
      tags: opts?.tags ?? index.boards[existing].tags,
      updated: now, elementCount: elements.length };
    index.boards[existing] = meta;
  } else {
    meta = { id: opts?.id ?? generateId(), name, slug: uniqueSlug(slugify(name), index),
      description: opts?.description, tags: opts?.tags ?? [],
      created: now, updated: now, elementCount: elements.length };
    index.boards.push(meta);
  }
  writeIndex(index);
  writeFileSync(join(BOARDS_DIR, `${meta.slug}.excalidraw`), JSON.stringify(
    { type: "excalidraw", version: 2, source: "excalidraw-mcp-server",
      elements, appState: appState ?? { viewBackgroundColor: "#ffffff" }, files: {} }, null, 2));
  return { ...meta, elements, appState };
}

export function deleteBoard(key: string): boolean {
  const index = readIndex();
  const found = findMeta(key, index);
  if (!found) return false;
  const fp = join(BOARDS_DIR, `${found.meta.slug}.excalidraw`);
  if (existsSync(fp)) unlinkSync(fp);
  index.boards.splice(found.idx, 1);
  writeIndex(index);
  return true;
}

export function renameBoard(key: string, newName: string): BoardMeta | null {
  const index = readIndex();
  const found = findMeta(key, index);
  if (!found) return null;
  index.boards[found.idx] = { ...found.meta, name: newName, updated: new Date().toISOString() };
  writeIndex(index);
  return index.boards[found.idx];
}

export function tagBoard(key: string, tags: string[]): BoardMeta | null {
  const index = readIndex();
  const found = findMeta(key, index);
  if (!found) return null;
  index.boards[found.idx] = { ...found.meta, tags, updated: new Date().toISOString() };
  writeIndex(index);
  return index.boards[found.idx];
}

export const storageDirPath = () => STORAGE_DIR;
export const boardsDirPath  = () => BOARDS_DIR;
