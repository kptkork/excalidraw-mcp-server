/**
 * Excalidraw MCP Bridge — browser-side
 *
 * Add ONE line to your Excalidraw's public/index.html before </body>:
 *   <script src="http://127.0.0.1:3001/bridge.js"></script>
 *
 * Features:
 *  - Unregisters the Excalidraw Service Worker on load (prevents SW cache
 *    from stripping this script tag on subsequent page loads)
 *  - Connects via WebSocket to the MCP bridge (ws://127.0.0.1:3001)
 *  - Discovers the Excalidraw React API via fiber traversal
 *  - "load_scene"  → calls api.updateScene() live (no reload!)
 *  - "get_scene"   → returns current elements to MCP
 *  - Falls back to localStorage + reload if API not yet found
 *  - Auto-reconnects on disconnect with exponential back-off
 */

// ── Step 1: Kill the Service Worker so index.html is served fresh every time ──
// The Excalidraw Docker image registers a SW that caches index.html. Without
// this, the injected <script> tag is stripped by the SW cache on every reload.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (registrations) {
    if (registrations.length > 0) {
      registrations.forEach(function (r) { r.unregister(); });
      console.log("[ExcalidrawMCP] Service Worker unregistered — bridge.js will survive page reloads.");
    }
  });
}

(function () {
  "use strict";

  var WS_URL      = "ws://127.0.0.1:3001";
  var BASE_RETRY  = 2000;
  var MAX_RETRY   = 30000;
  var API_POLL_MS = 800;

  var ws           = null;
  var retryDelay   = BASE_RETRY;
  var retryTimer   = null;
  var apiPollTimer = null;
  var excalidrawAPI = null;

  // ── Find Excalidraw API via React fiber ──────────────────────────────────────
  function searchFiber(fiber, depth) {
    if (!fiber || depth > 80) return null;
    try {
      var p = fiber.memoizedProps;
      if (p && typeof p.updateScene === "function" && typeof p.getSceneElements === "function") return p;
      var s = fiber.stateNode;
      if (s && typeof s.updateScene === "function" && typeof s.getSceneElements === "function") return s;
    } catch (_) {}
    return searchFiber(fiber.child, depth + 1) || searchFiber(fiber.sibling, depth + 1);
  }

  function findAPI() {
    var roots = [
      document.querySelector(".excalidraw"),
      document.querySelector('[class*="excalidraw"]'),
      document.getElementById("root"),
    ];
    for (var i = 0; i < roots.length; i++) {
      var el = roots[i];
      if (!el) continue;
      var fk = Object.keys(el).find(function(k) { return k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"); });
      if (!fk) continue;
      var api = searchFiber(el[fk], 0);
      if (api) return api;
    }
    return null;
  }

  // ── Apply scene ──────────────────────────────────────────────────────────────
  function applyScene(elements, appState) {
    if (excalidrawAPI) {
      try {
        excalidrawAPI.updateScene(Object.assign({ elements: elements }, appState ? { appState: appState } : {}));
        console.log("[ExcalidrawMCP] Live update — " + elements.length + " elements");
        return;
      } catch (e) { console.warn("[ExcalidrawMCP] Live update failed, falling back:", e); }
    }
    // Fallback: localStorage + reload
    localStorage.setItem("excalidraw", JSON.stringify(elements));
    if (appState) {
      var cur = {}; try { cur = JSON.parse(localStorage.getItem("excalidraw-state") || "{}"); } catch (_) {}
      localStorage.setItem("excalidraw-state", JSON.stringify(Object.assign(cur, appState)));
    }
    console.log("[ExcalidrawMCP] localStorage fallback — reloading");
    location.reload();
  }

  // ── Get current elements ─────────────────────────────────────────────────────
  function getElements() {
    if (excalidrawAPI) { try { return excalidrawAPI.getSceneElements() || []; } catch (_) {} }
    try { return JSON.parse(localStorage.getItem("excalidraw") || "[]"); } catch (_) { return []; }
  }

  // ── WebSocket ────────────────────────────────────────────────────────────────
  function connect() {
    clearTimeout(retryTimer);
    try { if (ws) ws.close(); } catch (_) {}
    ws = new WebSocket(WS_URL);

    ws.onopen = function () {
      retryDelay = BASE_RETRY;
      console.log("[ExcalidrawMCP] Connected to bridge ✓");
    };

    ws.onmessage = function (event) {
      var msg; try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.type === "load_scene") {
        applyScene(msg.elements || [], msg.appState);
      } else if (msg.type === "get_scene") {
        ws.send(JSON.stringify({ type: "scene_response", elements: getElements(), requestId: msg.requestId }));
      } else if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    };

    ws.onclose = function () {
      console.log("[ExcalidrawMCP] Disconnected — retry in " + (retryDelay / 1000) + "s");
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 1.5, MAX_RETRY);
    };
    ws.onerror = function () { /* onclose handles retry */ };
  }

  // ── Poll for API & boot ──────────────────────────────────────────────────────
  apiPollTimer = setInterval(function () {
    if (excalidrawAPI) { clearInterval(apiPollTimer); return; }
    var api = findAPI();
    if (api) {
      excalidrawAPI = api;
      window.__excalidrawMCPAPI = api;
      clearInterval(apiPollTimer);
      console.log("[ExcalidrawMCP] Excalidraw API found — live updates active ✓");
    }
  }, API_POLL_MS);

  connect();
  console.log("[ExcalidrawMCP] Bridge initialising… (" + WS_URL + ")");
})();
