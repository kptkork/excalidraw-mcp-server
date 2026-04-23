// ─── Excalidraw MCP Server — Types ───────────────────────────────────────────

export interface ExcalidrawElement {
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface AppState {
  viewBackgroundColor?: string;
  zoom?: { value: number };
  scrollX?: number;
  scrollY?: number;
  [key: string]: unknown;
}

export interface BoardMeta {
  id: string;
  name: string;
  slug: string;
  description?: string;
  tags: string[];
  created: string;
  updated: string;
  elementCount: number;
}

export interface Board extends BoardMeta {
  elements: ExcalidrawElement[];
  appState?: Partial<AppState>;
}

export interface BoardIndex {
  version: string;
  boards: BoardMeta[];
}

export interface BridgeMessage {
  type: "load_scene" | "get_scene" | "scene_response" | "ping" | "pong";
  elements?: ExcalidrawElement[];
  appState?: Partial<AppState>;
  requestId?: string;
}

export interface BridgeStatus {
  connected: boolean;
  port: number;
  clientCount: number;
}
