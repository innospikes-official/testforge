#!/usr/bin/env node

/**
 * TestForge Dashboard
 * Serves run history (testforge-workspace/reports/history.json) as a live
 * trend view. No framework, no build step — stdlib http server + inline SVG.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

function loadHistory(workdir) {
  const file = path.join(workdir, "reports", "history.json");
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
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

function render(history) {
  const latest = history[history.length - 1];
  const stats = latest ? latest.stats : { passed: 0, failed: 0, skipped: 0, passRate: 0, avgDuration: 0 };
  const failures = latest ? latest.failures : [];

  const rows = history.slice().reverse().slice(0, 20).map(r => `
    <tr>
      <td>${new Date(r.timestamp).toLocaleString()}</td>
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
  <title>TestForge Dashboard</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { color: #333; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 20px 0; }
    .stat-box { background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-value { font-size: 28px; font-weight: bold; color: #0066cc; }
    .stat-label { color: #666; font-size: 12px; text-transform: uppercase; }
    .card { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #eee; font-size: 13px; }
    .empty { color: #999; padding: 40px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>TestForge Dashboard</h1>
    ${history.length === 0 ? `<div class="card empty">No runs yet. Run <code>testforge run</code> to populate this dashboard.</div>` : `
    <div class="stats">
      <div class="stat-box"><div class="stat-value">${stats.passed}</div><div class="stat-label">Passed</div></div>
      <div class="stat-box"><div class="stat-value">${stats.failed}</div><div class="stat-label">Failed</div></div>
      <div class="stat-box"><div class="stat-value">${stats.passRate}%</div><div class="stat-label">Pass Rate</div></div>
      <div class="stat-box"><div class="stat-value">${Math.round(stats.avgDuration)}ms</div><div class="stat-label">Avg Duration</div></div>
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
    <p style="color:#999;font-size:12px">Auto-refreshes every 30s · Source: testforge-workspace/reports/history.json</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function startDashboard({ workdir = "./testforge-workspace", port = 4000 } = {}) {
  const server = http.createServer((req, res) => {
    const history = loadHistory(workdir);
    if (req.url === "/api/history") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(history));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(render(history));
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
