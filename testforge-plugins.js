/**
 * TestForge Plugins
 * Tool adapters — each shells out to the real CLI/runtime and parses its
 * actual output. No simulated results.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: true, ...opts });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: err.message }));
  });
}

function extractIdPrefix(title) {
  const m = /^\[(TC_[\w-]+)\]/.exec(title || "");
  return m ? m[1] : null;
}

/**
 * PLAYWRIGHT PLUGIN - Web & Mobile E2E Testing
 * Runs the generated spec with the real Playwright test runner and parses
 * its JSON reporter output. Requires @playwright/test installed and the
 * generated spec to exist (see TestForge.generateTestScripts).
 */
class PlaywrightPlugin {
  constructor(config) {
    this.config = config;
  }

  async execute(testCases) {
    console.log(`   🎭 Executing ${testCases.length} tests with Playwright...`);

    const specFile = this.config.specFile ||
      "./testforge-workspace/generated/playwright-tests-generated.js";
    if (!fs.existsSync(specFile)) {
      throw new Error(`Playwright spec not found: ${specFile}. Run generateTestScripts first.`);
    }

    const jsonOut = path.join(path.dirname(specFile), "playwright-results.json");
    // Playwright matches CLI file args against relative, forward-slash paths —
    // an absolute path (routine on Windows) silently matches nothing.
    const relSpec = path.relative(process.cwd(), specFile).split(path.sep).join("/");
    const { code, stderr } = await run(
      "npx",
      ["playwright", "test", relSpec, "--reporter=json"],
      { env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOut } }
    );

    if (!fs.existsSync(jsonOut)) {
      throw new Error(`Playwright produced no report (exit ${code}): ${stderr.slice(0, 500)}`);
    }

    const report = JSON.parse(fs.readFileSync(jsonOut, "utf-8"));
    const byId = new Map();
    const collect = (suite) => {
      (suite.specs || []).forEach((spec) => {
        const id = extractIdPrefix(spec.title);
        const result = spec.tests?.[0]?.results?.[0];
        if (id) {
          byId.set(id, {
            status: result?.status === "passed" ? "passed" : "failed",
            duration: result?.duration ?? 0,
            error: result?.error?.message || null,
          });
        }
      });
      (suite.suites || []).forEach(collect);
    };
    (report.suites || []).forEach(collect);

    return testCases.map((tc) => {
      const r = byId.get(tc.id);
      return {
        id: tc.id,
        title: tc.title,
        tool: "playwright",
        status: r ? r.status : "skipped",
        duration: r ? r.duration : 0,
        error: r ? r.error : "No matching result — spec title missing [ID] prefix",
      };
    });
  }

  generateScript(testCase) {
    return `
test('[${testCase.id}] ${testCase.title}', async ({ page }) => {
  await page.goto('${this.config.baseUrl}');
  ${testCase.steps.map((step) => `// ${step}`).join("\n  ")}
  // expected: ${testCase.expectedResult}
});
    `;
  }
}

/**
 * REST ASSURED PLUGIN - API Testing
 * Runs `mvn test` against a real Maven project and parses the Surefire XML
 * reports it produces. Requires config.restAssuredProjectDir to point at a
 * Maven project containing the generated JUnit classes.
 */
class RestAssuredPlugin {
  constructor(config) {
    this.config = config;
  }

  async execute(testCases) {
    console.log(`   🔌 Executing ${testCases.length} tests with Rest Assured...`);

    const projectDir = this.config.restAssuredProjectDir;
    if (!projectDir || !fs.existsSync(projectDir)) {
      throw new Error("config.restAssuredProjectDir must point at a Maven project with the generated tests");
    }

    const { code, stderr } = await run("mvn", ["-q", "test"], { cwd: projectDir });
    const reportsDir = path.join(projectDir, "target", "surefire-reports");
    if (!fs.existsSync(reportsDir)) {
      throw new Error(`No Surefire reports found (mvn exit ${code}): ${stderr.slice(0, 500)}`);
    }

    const byMethod = new Map();
    for (const file of fs.readdirSync(reportsDir).filter((f) => f.endsWith(".xml"))) {
      const xml = fs.readFileSync(path.join(reportsDir, file), "utf-8");
      const caseRe = /<testcase[^>]*name="([^"]+)"[^>]*time="([\d.]+)"[^>]*(\/>|>[\s\S]*?<\/testcase>)/g;
      let m;
      while ((m = caseRe.exec(xml))) {
        const [, name, time, body] = m;
        const failed = /<failure|<error/.test(body);
        byMethod.set(name, { status: failed ? "failed" : "passed", duration: Math.round(parseFloat(time) * 1000) });
      }
    }

    return testCases.map((tc) => {
      const method = this.camelCase(tc.title);
      const r = byMethod.get(method);
      return {
        id: tc.id,
        title: tc.title,
        tool: "rest-assured",
        status: r ? r.status : "skipped",
        duration: r ? r.duration : 0,
        error: r ? null : `No Surefire result for method ${method}`,
      };
    });
  }

  generateScript(testCase) {
    return `
@Test
public void ${this.camelCase(testCase.title)}() {
  given()
    .baseUri("${this.config.apiBase}")
  .when()
    .get("/endpoint")
  .then()
    .statusCode(200);
}
    `;
  }

  camelCase(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+(.)/g, (g) => g[1].toUpperCase());
  }
}

/**
 * K6 PLUGIN - Performance & Load Testing
 * Runs the generated k6 script and parses its summary export.
 * ponytail: k6 measures a scenario, not discrete test cases — the same
 * aggregate verdict is applied to every case in this batch. Upgrade: tag
 * requests with `tc.id` via k6 groups/tags and parse per-group metrics if
 * per-case load results are ever needed.
 */
class K6Plugin {
  constructor(config) {
    this.config = config;
  }

  async execute(testCases) {
    console.log(`   ⚡ Executing load test with K6 for ${testCases.length} case(s)...`);

    const script = this.config.k6Script || "./testforge-workspace/generated/k6-tests-generated.js";
    if (!fs.existsSync(script)) {
      throw new Error(`k6 script not found: ${script}`);
    }

    const summaryPath = path.join(path.dirname(script), "k6-summary.json");
    const { code, stderr } = await run("k6", ["run", `--summary-export=${summaryPath}`, script]);

    if (!fs.existsSync(summaryPath)) {
      throw new Error(`k6 produced no summary (exit ${code}): ${stderr.slice(0, 500)}`);
    }

    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    const checksRate = summary.metrics?.checks?.values?.rate ?? 1;
    const status = checksRate >= 0.99 ? "passed" : "failed";
    const httpDuration = summary.metrics?.http_req_duration?.values || {};

    return testCases.map((tc) => ({
      id: tc.id,
      title: tc.title,
      tool: "k6",
      status,
      duration: Math.round(httpDuration.avg || 0),
      avgResponseTime: Math.round(httpDuration.avg || 0),
      p95ResponseTime: Math.round(httpDuration["p(95)"] || 0),
      throughput: Math.round(summary.metrics?.http_reqs?.values?.rate || 0),
      errorRate: 1 - checksRate,
    }));
  }

  generateScript() {
    return `
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = { vus: 10, duration: '30s' };

export default function () {
  let response = http.get('${this.config.baseUrl}');
  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  sleep(1);
}
    `;
  }
}

/**
 * JMETER PLUGIN - Load Testing
 * Runs the generated .jmx plan in non-GUI mode and parses the CSV (.jtl)
 * results it produces.
 * ponytail: same aggregate-verdict caveat as K6Plugin — JMeter samples map
 * to request labels, not TestForge test-case IDs, unless the .jmx names
 * each sampler after tc.id.
 */
class JMeterPlugin {
  constructor(config) {
    this.config = config;
  }

  async execute(testCases) {
    console.log(`   ⚙️  Executing JMeter plan for ${testCases.length} case(s)...`);

    const jmxFile = this.config.jmxFile;
    if (!jmxFile || !fs.existsSync(jmxFile)) {
      throw new Error("config.jmxFile must point at a JMeter test plan");
    }

    const jtl = path.join(path.dirname(jmxFile), "jmeter-results.jtl");
    if (fs.existsSync(jtl)) fs.unlinkSync(jtl);
    const { code, stderr } = await run("jmeter", ["-n", "-t", jmxFile, "-l", jtl]);

    if (!fs.existsSync(jtl)) {
      throw new Error(`JMeter produced no results (exit ${code}): ${stderr.slice(0, 500)}`);
    }

    const lines = fs.readFileSync(jtl, "utf-8").trim().split("\n");
    const header = lines[0].split(",");
    const successIdx = header.indexOf("success");
    const elapsedIdx = header.indexOf("elapsed");
    const rows = lines.slice(1).map((l) => l.split(","));
    const total = rows.length || 1;
    const successes = rows.filter((r) => r[successIdx] === "true").length;
    const avgElapsed = rows.reduce((sum, r) => sum + (parseInt(r[elapsedIdx], 10) || 0), 0) / total;
    const status = successes === total ? "passed" : "failed";

    return testCases.map((tc) => ({
      id: tc.id,
      title: tc.title,
      tool: "jmeter",
      status,
      samples: total,
      avgResponseTime: Math.round(avgElapsed),
      errorPercentage: Math.round(((total - successes) / total) * 100) / 100,
    }));
  }
}

/**
 * BROWSERSTACK PLUGIN - Real Device Testing
 * Connects Playwright to a live BrowserStack device over CDP for each test
 * case. Requires BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY env vars.
 */
class BrowserStackPlugin {
  constructor(config) {
    this.config = config;
    this.devices = config.devices || [
      { device: "iPhone 14", os_version: "16", browser: "safari" },
      { device: "Samsung Galaxy S22", os_version: "12.0", browser: "chrome" },
    ];
  }

  async execute(testCases) {
    console.log(`   📱 Executing ${testCases.length} tests on BrowserStack...`);

    const user = process.env.BROWSERSTACK_USERNAME;
    const key = process.env.BROWSERSTACK_ACCESS_KEY;
    if (!user || !key) {
      throw new Error("BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY not set");
    }

    const { chromium } = require("playwright");
    const results = [];

    for (const [i, tc] of testCases.entries()) {
      const device = this.devices[i % this.devices.length];
      const caps = {
        browser: device.browser,
        browser_version: "latest",
        os: "ios",
        os_version: device.os_version,
        device: device.device,
        name: tc.title,
        build: this.config.name || "testforge-run",
        "client.playwrightVersion": "1.40.0",
      };
      const cdpUrl = `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify(caps))}`;

      const start = Date.now();
      try {
        const browser = await chromium.connect(cdpUrl, { timeout: 60000 });
        const page = await browser.newPage();
        await page.goto(this.config.baseUrl);
        await browser.close();
        results.push({
          id: tc.id,
          title: tc.title,
          tool: "browserstack",
          status: "passed",
          device: device.device,
          duration: Date.now() - start,
          error: null,
        });
      } catch (err) {
        results.push({
          id: tc.id,
          title: tc.title,
          tool: "browserstack",
          status: "failed",
          device: device.device,
          duration: Date.now() - start,
          error: err.message,
        });
      }
    }

    return results;
  }
}

/**
 * POSTMAN PLUGIN - API Collection Testing
 * Runs the collection through Newman (Postman's CLI runner) and parses its
 * JSON report. Requires the `newman` package.
 */
class PostmanPlugin {
  constructor(config) {
    this.config = config;
  }

  async execute(testCases) {
    console.log(`   📬 Executing ${testCases.length} tests with Postman (Newman)...`);

    const collection = this.config.postmanCollection;
    if (!collection || !fs.existsSync(collection)) {
      throw new Error("config.postmanCollection must point at a Postman collection JSON file");
    }

    const reportFile = path.join(path.dirname(collection), "newman-report.json");
    const { code, stderr } = await run("npx", [
      "newman", "run", collection,
      "--reporters", "json",
      "--reporter-json-export", reportFile,
    ]);

    if (!fs.existsSync(reportFile)) {
      throw new Error(`Newman produced no report (exit ${code}): ${stderr.slice(0, 500)}`);
    }

    const report = JSON.parse(fs.readFileSync(reportFile, "utf-8"));
    const byName = new Map();
    for (const exec of report.run?.executions || []) {
      const name = exec.item?.name || "";
      const failed = (exec.assertions || []).some((a) => a.error);
      byName.set(name, {
        status: failed ? "failed" : "passed",
        duration: exec.response?.responseTime ?? 0,
      });
    }

    return testCases.map((tc) => {
      const r = byName.get(tc.title);
      return {
        id: tc.id,
        title: tc.title,
        tool: "postman",
        status: r ? r.status : "skipped",
        duration: r ? r.duration : 0,
        error: r ? null : `No Newman result for request named "${tc.title}"`,
      };
    });
  }
}

module.exports = {
  PlaywrightPlugin,
  RestAssuredPlugin,
  K6Plugin,
  JMeterPlugin,
  BrowserStackPlugin,
  PostmanPlugin,
};
