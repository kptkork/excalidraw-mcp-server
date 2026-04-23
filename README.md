# excalidraw-mcp-server

Local MCP server for [Excalidraw](https://excalidraw.com) with persistent board storage
and a live WebSocket bridge to the browser. Works with **Docker** and **local** Excalidraw installs.

## Quickstart (npx)

```bash
# 1. Inject bridge.js into Excalidraw & print your Claude config
npx excalidraw-mcp-setup

# 2. Restart Claude / Cowork — the server starts automatically via npx
```

The setup script auto-detects your Excalidraw installation (Docker container or local source),
patches `index.html`, and prints the exact config snippet you need.

---

## Manual setup

### 1. Install

```bash
npm install -g excalidraw-mcp-server
# or keep it local:
git clone <repo> && cd excalidraw-mcp-server && npm install && npm run build
```

### 2. Inject bridge.js

```bash
excalidraw-mcp-setup
# or without global install:
npx excalidraw-mcp-setup
```

The setup script:
- Detects a running **Docker** container (`excalidraw/excalidraw` image)
- Falls back to common **local** paths (`~/code/excalidraw/public/index.html`, etc.)
- Lets you enter a **custom path** if nothing is found
- For Docker: saves the patched `index.html` to `~/excalidraw-docker/` and recreates
  the container with a bind mount (survives restarts)
- Prints the exact `mcpServers` JSON block to paste into your Claude config

### 3. Register the MCP server

Add to **`~/.claude.json`** (global, all projects):

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "npx",
      "args": ["-y", "excalidraw-mcp-server"]
    }
  }
}
```

Or if you cloned locally, point directly at the built file:

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": ["/absolute/path/to/excalidraw-mcp-server/dist/index.js"]
    }
  }
}
```

For **Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
same `mcpServers` block inside the root object.

### 4. Verify

Restart Claude / Cowork, open `http://localhost:3000`, and check the browser console for:

```
[ExcalidrawMCP] Bridge connected
```

---

## Architecture

```
Claude / Cowork (stdio) ──► excalidraw-mcp-server
                                    │
                          HTTP + WS  (port 3001)
                                    │
                         Excalidraw (localhost:3000)
                         + bridge.js injected
```

---

## Tools

| Tool | Description |
|------|-------------|
| `excalidraw_status` | Check bridge connection & storage paths |
| `excalidraw_list_boards` | List all saved boards (filterable by tag) |
| `excalidraw_get_board` | Get full board content by name / slug / id |
| `excalidraw_create_board` | Create a new named board with elements |
| `excalidraw_save_board` | Upsert a board (create or overwrite) |
| `excalidraw_load_board` | Push a saved board to the browser live |
| `excalidraw_get_active` | Capture the current scene from the browser |
| `excalidraw_push_scene` | Push raw elements to the browser (no save) |
| `excalidraw_delete_board` | Delete a board permanently |
| `excalidraw_rename_board` | Rename a board (slug unchanged) |
| `excalidraw_tag_board` | Set tags on a board |

---

## Storage

Boards are stored in `~/.excalidraw-mcp/`:

```
~/.excalidraw-mcp/
├── index.json          ← metadata index
└── boards/
    ├── my-diagram.excalidraw
    └── architecture.excalidraw
```

Each `.excalidraw` file is standard Excalidraw JSON — open it directly via **File → Open**.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `3001` | Port for the HTTP + WS bridge |

---

## Development

```bash
npm run dev      # tsx watch (no build step)
npm run build    # compile TypeScript → dist/
npm run setup    # run the setup script from local build
npx @modelcontextprotocol/inspector node dist/index.js  # MCP Inspector
```
