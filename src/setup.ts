#!/usr/bin/env node
// ─── Excalidraw MCP Server — Setup CLI ───────────────────────────────────────
// Run: npx excalidraw-mcp-setup
// Detects Docker / local Excalidraw, injects bridge.js, prints Claude config.

import { execSync, spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_SCRIPT = '<script src="http://127.0.0.1:3001/bridge.js"></script>';
const BRIDGE_JS_SRC = resolve(__dirname, "../public/bridge.js");

// ── helpers ──────────────────────────────────────────────────────────────────
function run(cmd: string): string {
  try { return execSync(cmd, { encoding: "utf8", stdio: ["pipe","pipe","pipe"] }).trim(); }
  catch { return ""; }
}

function banner(): void {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   excalidraw-mcp-server  —  Setup                ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
}

function ok(msg: string)   { console.log(`  ✅  ${msg}`); }
function info(msg: string) { console.log(`  ℹ️   ${msg}`); }
function warn(msg: string) { console.log(`  ⚠️   ${msg}`); }
function step(msg: string) { console.log(`\n──── ${msg}`); }

// ── Docker detection ──────────────────────────────────────────────────────────
interface DockerTarget {
  kind: "docker";
  containerName: string;
  htmlPathInContainer: string;
}

function detectDocker(): DockerTarget | null {
  const psOut = run("docker ps --format '{{.Names}}\\t{{.Image}}'");
  if (!psOut) return null;

  for (const line of psOut.split("\n")) {
    const [name, image] = line.split("\t");
    if (!name || !image) continue;
    if (image.toLowerCase().includes("excalidraw") || name.toLowerCase().includes("excalidraw")) {
      // Try to find index.html
      const find = run(`docker exec ${name} find /usr/share/nginx/html /app/build /app/public -name "index.html" 2>/dev/null | head -1`);
      const htmlPath = find.trim() || "/usr/share/nginx/html/index.html";
      return { kind: "docker", containerName: name, htmlPathInContainer: htmlPath };
    }
  }
  return null;
}

// ── Local install detection ───────────────────────────────────────────────────
const SEARCH_PATHS = [
  "~/excalidraw", "~/code/excalidraw", "~/projects/excalidraw",
  "~/dev/excalidraw", "~/src/excalidraw", "~/repos/excalidraw",
  "~/Documents/excalidraw", "~/Desktop/excalidraw",
];

function expandHome(p: string): string {
  return p.startsWith("~/") ? join(process.env.HOME ?? "~", p.slice(2)) : p;
}

function detectLocalInstall(): string | null {
  for (const raw of SEARCH_PATHS) {
    const p = expandHome(raw);
    const html = join(p, "public", "index.html");
    if (existsSync(html)) return html;
  }
  // Also try mdfind on macOS
  const mdf = run("mdfind -name index.html 2>/dev/null | xargs grep -l 'excalidraw' 2>/dev/null | grep 'public/index.html' | head -1");
  return mdf || null;
}

// ── Bridge injection ──────────────────────────────────────────────────────────
function alreadyInjected(html: string): boolean {
  return html.includes("3001/bridge.js");
}

function injectScript(html: string): string {
  if (alreadyInjected(html)) return html;
  return html.replace("</body>", `${BRIDGE_SCRIPT}</body>`);
}

async function injectDocker(target: DockerTarget, rl: readline.Interface): Promise<boolean> {
  const { containerName, htmlPathInContainer } = target;

  // Extract index.html from container
  const tmpPath = `/tmp/excalidraw-index-${Date.now()}.html`;
  const cpResult = spawnSync("docker", ["cp", `${containerName}:${htmlPathInContainer}`, tmpPath], { encoding: "utf8" });
  if (cpResult.status !== 0) {
    warn(`Could not copy index.html from container: ${cpResult.stderr}`);
    return false;
  }

  const original = readFileSync(tmpPath, "utf8");
  if (alreadyInjected(original)) {
    ok("bridge.js already injected in container — nothing to do.");
    return true;
  }

  const patched = injectScript(original);
  const persistPath = expandHome(`~/excalidraw-docker/index.html`);
  mkdirSync(dirname(persistPath), { recursive: true });
  writeFileSync(persistPath, patched, "utf8");

  // Inspect existing container config
  const imageOut = run(`docker inspect ${containerName} --format '{{.Config.Image}}'`);
  const portOut  = run(`docker inspect ${containerName} --format '{{range $k,$v := .NetworkSettings.Ports}}{{$k}}={{range $v}}{{.HostPort}}{{end}} {{end}}'`);
  const hostPort = portOut.match(/(\d+)=(\d+)/)?.[2] ?? "3000";
  const restartPolicy = run(`docker inspect ${containerName} --format '{{.HostConfig.RestartPolicy.Name}}'`) || "unless-stopped";
  const image = imageOut || "excalidraw/excalidraw";

  info(`Patched index.html saved to: ${persistPath}`);
  console.log(`\n  To apply, recreate the container with the bind mount:`);
  console.log(`\n  \x1b[33mdocker rm -f ${containerName} && docker run -d \\`);
  console.log(`    --name ${containerName} --restart ${restartPolicy} \\`);
  console.log(`    -p ${hostPort}:80 \\`);
  console.log(`    -v "${persistPath}:/usr/share/nginx/html/index.html:ro" \\`);
  console.log(`    ${image}\x1b[0m\n`);

  const ans = await rl.question("  Run this command now? [Y/n] ");
  if (ans.trim().toLowerCase() !== "n") {
    const rmRes  = spawnSync("docker", ["rm", "-f", containerName], { encoding: "utf8", stdio: "inherit" });
    const runRes = spawnSync("docker", [
      "run", "-d",
      "--name", containerName,
      "--restart", restartPolicy,
      "-p", `${hostPort}:80`,
      "-v", `${persistPath}:/usr/share/nginx/html/index.html:ro`,
      image,
    ], { encoding: "utf8", stdio: "inherit" });

    if (runRes.status === 0) {
      ok(`Container '${containerName}' recreated with bridge.js mounted.`);
      return true;
    } else {
      warn("docker run failed — please run the command above manually.");
      return false;
    }
  }
  return true;
}

function injectLocal(htmlPath: string): boolean {
  const original = readFileSync(htmlPath, "utf8");
  if (alreadyInjected(original)) {
    ok("bridge.js already injected — nothing to do.");
    return true;
  }
  writeFileSync(htmlPath, injectScript(original), "utf8");
  ok(`Injected bridge.js into ${htmlPath}`);
  return true;
}

// ── Claude config output ──────────────────────────────────────────────────────
function printClaudeConfig(serverPath: string): void {
  const isNpx = serverPath === "npx";

  const cfgClaudeCode = isNpx
    ? `{\n  "mcpServers": {\n    "excalidraw": {\n      "command": "npx",\n      "args": ["-y", "excalidraw-mcp-server"]\n    }\n  }\n}`
    : `{\n  "mcpServers": {\n    "excalidraw": {\n      "command": "node",\n      "args": ["${serverPath}"]\n    }\n  }\n}`;

  const cfgDesktop = isNpx
    ? `{\n  "mcpServers": {\n    "excalidraw": {\n      "command": "npx",\n      "args": ["-y", "excalidraw-mcp-server"]\n    }\n  }\n}`
    : `{\n  "mcpServers": {\n    "excalidraw": {\n      "command": "node",\n      "args": ["${serverPath}"]\n    }\n  }\n}`;

  step("Claude / Cowork config");
  console.log("\n  Add this to ~/.claude.json (global mcpServers):\n");
  console.log("  \x1b[32m" + cfgClaudeCode + "\x1b[0m");
  console.log("\n  Or for Claude Desktop (~/Library/Application Support/Claude/claude_desktop_config.json):\n");
  console.log("  \x1b[32m" + cfgDesktop + "\x1b[0m");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  banner();
  const rl = readline.createInterface({ input, output });

  try {
    // 1. Detect Excalidraw installation
    step("Detecting Excalidraw installation");

    const docker = detectDocker();
    const localHtml = detectLocalInstall();

    let injected = false;

    if (docker) {
      ok(`Found Docker container: '${docker.containerName}'`);
      info(`HTML path inside container: ${docker.htmlPathInContainer}`);
      injected = await injectDocker(docker, rl);

    } else if (localHtml) {
      ok(`Found local install: ${localHtml}`);
      injected = injectLocal(localHtml);

    } else {
      warn("Could not auto-detect Excalidraw installation.");
      const customPath = await rl.question(
        "  Enter path to your Excalidraw public/index.html (or press Enter to skip): "
      );
      if (customPath.trim()) {
        const p = resolve(customPath.trim());
        if (existsSync(p)) {
          injected = injectLocal(p);
        } else {
          warn(`File not found: ${p} — skipping injection.`);
        }
      } else {
        info("Skipping injection — add the bridge script manually:");
        console.log(`  ${BRIDGE_SCRIPT}`);
      }
    }

    if (injected) {
      ok("Bridge injection complete.");
    }

    // 2. Determine server path for config
    step("MCP server path");

    // If running via npx (no local dist), suggest npx; else use local dist
    const selfDir  = dirname(fileURLToPath(import.meta.url));
    const distPath = resolve(selfDir, "index.js");
    const isLocal  = existsSync(distPath);

    if (isLocal) {
      ok(`Local build found: ${distPath}`);
      printClaudeConfig(distPath);
    } else {
      info("No local build found — using npx config.");
      printClaudeConfig("npx");
    }

    // 3. Done
    step("All done!");
    console.log("\n  Restart Claude / Cowork to load the MCP server.");
    console.log("  Then open http://localhost:3000 — you should see:");
    console.log("  \x1b[36m  [ExcalidrawMCP] Bridge connected\x1b[0m  in the browser console.\n");

  } finally {
    rl.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
