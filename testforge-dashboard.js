#!/usr/bin/env node

/**
 * TestForge Dashboard
 * Serves run history (testforge-workspace/reports/history.json) as a live
 * trend view, plus buttons to trigger more test generation / another run.
 * No framework, no build step — stdlib http server + inline SVG.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function loadHistory(workdir) {
  return loadJson(path.join(workdir, "reports", "history.json"), []);
}

function loadStatus(workdir) {
  return loadJson(path.join(workdir, "status.json"), { state: "idle" });
}

function projectName(workdir, history) {
  const fromHistory = history[history.length - 1]?.project;
  if (fromHistory) return fromHistory;
  const appConfig = loadJson(path.join(workdir, "configs", "app.config.json"), null);
  if (appConfig?.name || appConfig?.displayName) return appConfig.displayName || appConfig.name;
  const pkg = loadJson("./package.json", null);
  if (pkg?.name) return pkg.name;
  return path.basename(process.cwd());
}

function testCaseCount(workdir) {
  const generated = loadJson(path.join(workdir, "configs", "test-cases-generated.json"), null);
  if (Array.isArray(generated)) return { count: generated.length, source: "AI-generated" };
  const base = loadJson(path.join(workdir, "configs", "test-cases.json"), null);
  if (base?.testCases) return { count: base.testCases.length, source: "example/base set" };
  return { count: 0, source: null };
}

// Which commands this project actually supports — CLI-driven projects can
// generate + run through testforge-cli.js; adapter-only projects (e.g. one
// wrapping an existing hand-written suite) can only re-run.
function detectCommands() {
  if (fs.existsSync("./testforge-cli.js")) {
    return {
      generate: (count) => ["node", ["testforge-cli.js", "generate", "--count", String(count)]],
      run: () => ["node", ["testforge-cli.js", "run", "--generated"]],
    };
  }
  if (fs.existsSync("./testforge-run-e2e.js")) {
    return { generate: null, run: () => ["node", ["testforge-run-e2e.js"]] };
  }
  return { generate: null, run: null };
}

function trendSvg(history) {
  const w = 640, h = 160, pad = 20;
  if (history.length < 2) {
    return `<svg width="${w}" height="${h}"><text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="#999">Not enough runs yet — run tests at least twice to see a trend</text></svg>`;
  }
  const rates = history.map(r => r.stats.passRate);
  const stepX = (w - pad * 2) / (rates.length - 1);
  const points = rates.map((r, i) => `${pad + i * stepX},${h - pad - (r / 100) * (h - pad * 2)}`).join(" ");
  const dots = rates.map((r, i) => `<circle cx="${pad + i * stepX}" cy="${h - pad - (r / 100) * (h - pad * 2)}" r="3" fill="#0066cc" />`).join("");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline points="${points}" fill="none" stroke="#0066cc" stroke-width="2" />
    ${dots}
  </svg>`;
}

function statusBanner(status) {
  if (!status || status.state === "idle") return "";
  const label = status.state === "generating" ? "Generating test cases" : status.state === "running" ? "Running tests" : status.state;
  return `<div class="banner">⏳ ${escapeHtml(label)}${status.detail ? " — " + escapeHtml(status.detail) : ""} (started ${new Date(status.updatedAt).toLocaleTimeString()})</div>`;
}

function actionsCard(commands, status) {
  const busy = status && status.state !== "idle";
  const generateForm = commands.generate ? `
    <form method="POST" action="/api/generate" ${busy ? "onsubmit=\"return false\"" : ""}>
      <label>Generate <input type="number" name="count" value="50" min="1" max="1000" style="width:70px" ${busy ? "disabled" : ""}/> more test cases</label>
      <button type="submit" ${busy ? "disabled" : ""}>Generate</button>
    </form>` : `<p class="muted">This project has no AI generator wired up (no testforge-cli.js) — it runs an existing hand-written suite instead.</p>`;

  const runForm = commands.run ? `
    <form method="POST" action="/api/run">
      <button type="submit" ${busy ? "disabled" : ""}>${busy ? "Busy…" : "Run tests now"}</button>
    </form>` : "";

  return `<div class="card">
    <h2>Actions</h2>
    ${generateForm}
    ${runForm}
  </div>`;
}

function render(history, status, workdir) {
  const latest = history[history.length - 1];
  const stats = latest ? latest.stats : { passed: 0, failed: 0, skipped: 0, passRate: 0, avgDuration: 0 };
  const failures = latest ? latest.failures : [];
  const project = projectName(workdir, history);
  const { count: testCases, source: testCaseSource } = testCaseCount(workdir);
  const commands = detectCommands();

  const rows = history.slice().reverse().slice(0, 20).map(r => `
    <tr>
      <td>${escapeHtml(new Date(r.timestamp).toLocaleString())}</td>
      <td>${r.stats.passed}</td>
      <td>${r.stats.failed}</td>
      <td>${r.stats.passRate}%</td>
    </tr>`).join("");

  const failureRows = failures.map(f => `
    <tr><td>${escapeHtml(f.id)}</td><td>${escapeHtml(f.title)}</td><td>${escapeHtml(f.tool)}</td><td>${escapeHtml(f.error || "")}</td></tr>
  `).join("") || `<tr><td colspan="4" style="color:#4caf50">No failures in latest run</td></tr>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="30" />
  <title>TestForge Dashboard — ${escapeHtml(project)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { color: #333; margin-bottom: 4px; }
    .subtitle { color: #777; margin-top: 0; margin-bottom: 20px; }
    .banner { background: #fff3cd; border: 1px solid #ffe69c; color: #664d03; padding: 10px 16px; border-radius: 8px; margin-bottom: 16px; }
    .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 15px; margin: 20px 0; }
    .stat-box { background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-value { font-size: 28px; font-weight: bold; color: #0066cc; }
    .stat-label { color: #666; font-size: 12px; text-transform: uppercase; }
    .card { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #eee; font-size: 13px; }
    .empty { color: #999; padding: 40px; text-align: center; }
    .muted { color: #888; font-size: 13px; }
    form { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
    button { background: #0066cc; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
    button:disabled { background: #aaa; cursor: not-allowed; }
    label { font-size: 13px; color: #444; }
  </style>
</head>
<body>
  <div class="container">
    <h1>TestForge Dashboard</h1>
    <p class="subtitle">Project: <strong>${escapeHtml(project)}</strong>${testCaseSource ? ` &middot; ${testCases} test cases (${testCaseSource})` : ""}</p>
    ${statusBanner(status)}
    ${history.length === 0 ? `<div class="card empty">No runs yet. Use the action below, or run <code>testforge run</code>.</div>` : `
    <div class="stats">
      <div class="stat-box"><div class="stat-value">${stats.passed}</div><div class="stat-label">Passed</div></div>
      <div class="stat-box"><div class="stat-value">${stats.failed}</div><div class="stat-label">Failed</div></div>
      <div class="stat-box"><div class="stat-value">${stats.passRate}%</div><div class="stat-label">Pass Rate</div></div>
      <div class="stat-box"><div class="stat-value">${Math.round(stats.avgDuration)}ms</div><div class="stat-label">Avg Duration</div></div>
      <div class="stat-box"><div class="stat-value">${testCases}</div><div class="stat-label">Test Cases</div></div>
    </div>

    <div class="card">
      <h2>Pass Rate Trend</h2>
      ${trendSvg(history)}
    </div>

    <div class="card">
      <h2>Latest Failures</h2>
      <table><thead><tr><th>ID</th><th>Title</th><th>Tool</th><th>Error</th></tr></thead><tbody>${failureRows}</tbody></table>
    </div>

    <div class="card">
      <h2>Run History</h2>
      <table><thead><tr><th>When</th><th>Passed</th><th>Failed</th><th>Pass Rate</th></tr></thead><tbody>${rows}</tbody></table>
    </div>
    `}
    ${actionsCard(commands, status)}
    <p style="color:#999;font-size:12px">Auto-refreshes every 30s · Source: testforge-workspace/reports/history.json</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
}

function runDetached(cmd, args) {
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.unref();
}

// A page open in the same browser (any site, any tab) can still submit a
// cross-origin POST to this localhost port — the browser doesn't block that
// by default. Require the request to actually originate from this dashboard.
function isSameOrigin(req, port) {
  const header = req.headers.origin || req.headers.referer;
  if (!header) return false;
  try {
    const url = new URL(header);
    return (url.hostname === "localhost" || url.hostname === "127.0.0.1") && Number(url.port) === port;
  } catch {
    return false;
  }
}

function startDashboard({ workdir = "./testforge-workspace", port = 4000 } = {}) {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/api/history") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(loadHistory(workdir)));
      return;
    }

    if (req.method === "POST" && (req.url === "/api/generate" || req.url === "/api/run") && !isSameOrigin(req, port)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden: cross-origin request rejected");
      return;
    }

    if (req.method === "POST" && req.url === "/api/generate") {
      const commands = detectCommands();
      if (commands.generate) {
        const body = await readBody(req);
        const count = Math.max(1, parseInt(new URLSearchParams(body).get("count") || "50", 10));
        const status = loadStatus(workdir);
        if (status.state === "idle") {
          const [cmd, args] = commands.generate(count);
          runDetached(cmd, args);
        }
      }
      res.writeHead(302, { Location: "/" });
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/api/run") {
      const commands = detectCommands();
      if (commands.run) {
        const status = loadStatus(workdir);
        if (status.state === "idle") {
          const [cmd, args] = commands.run();
          runDetached(cmd, args);
        }
      }
      res.writeHead(302, { Location: "/" });
      res.end();
      return;
    }

    const history = loadHistory(workdir);
    const status = loadStatus(workdir);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(render(history, status, workdir));
  });
  server.listen(port, "127.0.0.1", () => console.log(`📊 TestForge dashboard: http://localhost:${port}`));
  return server;
}

module.exports = { startDashboard };

if (require.main === module) {
  const portArg = process.argv.find(a => a.startsWith("--port"));
  const port = portArg ? parseInt(portArg.split("=")[1] || process.argv[process.argv.indexOf(portArg) + 1], 10) : (process.env.PORT || 4000);
  startDashboard({ port: Number(port) });
}
