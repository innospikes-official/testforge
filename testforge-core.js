/**
 * TestForge Core Framework
 * Universal testing framework with Claude AI integration
 */

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

class TestForge {
  constructor(config) {
    this.config = config;
    this.client = new Anthropic();
    this.plugins = {};
    this.testCases = [];
    this.testResults = [];
    this.setupDirectories();
  }

  setupDirectories() {
    const dirs = [
      this.config.workdir || "./testforge-workspace",
      "./testforge-workspace/tests",
      "./testforge-workspace/reports",
      "./testforge-workspace/configs",
      "./testforge-workspace/generated"
    ];
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
  }

  /**
   * PHASE 1: Generate test cases from documentation using Claude
   */
  async generateTestCases(docs, count = 100) {
    console.log(`🤖 Generating ${count} test cases from documentation...`);

    const message = await this.client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 8000,
      messages: [
        {
          role: "user",
          content: `Analyze this application documentation and generate ${count} comprehensive test cases.

DOCUMENTATION:
${docs}

Return ONLY valid JSON array with this structure:
[
  {
    "id": "TC_001",
    "title": "Test case title",
    "category": "functional|integration|security|performance|api|mobile",
    "module": "module name",
    "tool": "playwright|rest-assured|k6|jmeter|browserstack",
    "automatable": true|false,
    "priority": "p0|p1|p2",
    "steps": ["step 1", "step 2"],
    "expectedResult": "expected outcome",
    "tags": ["tag1", "tag2"],
    "estimatedTime": "in minutes"
  }
]

Generate exactly ${count} test cases covering all critical functionality.`
        }
      ]
    });

    try {
      const testCases = JSON.parse(message.content[0].text);
      this.testCases = testCases;

      // Save to file
      const filePath = "./testforge-workspace/configs/test-cases-generated.json";
      fs.writeFileSync(filePath, JSON.stringify(testCases, null, 2));

      console.log(`✅ Generated ${testCases.length} test cases`);
      console.log(`   Saved to: ${filePath}`);

      // Print summary
      this.printTestSummary(testCases);

      return testCases;
    } catch (error) {
      console.error("❌ Error parsing generated test cases:", error.message);
      throw error;
    }
  }

  /**
   * PHASE 2: Convert test cases to executable code for each tool
   */
  async generateTestScripts(testCases) {
    console.log(`📝 Generating executable test scripts...`);

    const byTool = this.groupBy(testCases, 'tool');
    const scripts = {};

    for (const [tool, cases] of Object.entries(byTool)) {
      console.log(`   Converting ${cases.length} tests for ${tool}...`);

      const message = await this.client.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 8000,
        messages: [
          {
            role: "user",
            content: `Generate ${tool.toUpperCase()} test code for these test cases:

${JSON.stringify(cases, null, 2)}

Generate production-ready ${tool} test code. Return only the code, no explanations.`
          }
        ]
      });

      const code = message.content[0].text;
      const fileName = `${tool}-tests-generated.${this.getFileExtension(tool)}`;
      const filePath = `./testforge-workspace/generated/${fileName}`;

      fs.writeFileSync(filePath, code);
      scripts[tool] = filePath;

      console.log(`   ✅ ${fileName}`);
    }

    console.log(`✅ Test scripts generated in ./testforge-workspace/generated/`);
    return scripts;
  }

  /**
   * PHASE 3: Execute tests using registered plugins
   */
  async runTests(testCases, options = {}) {
    console.log(`🚀 Executing tests...`);

    const parallel = options.parallel !== false;
    const byTool = this.groupBy(testCases, 'tool');

    for (const [tool, cases] of Object.entries(byTool)) {
      if (!this.plugins[tool]) {
        console.warn(`⚠️  No plugin registered for ${tool}, skipping...`);
        continue;
      }

      console.log(`   Running ${cases.length} tests with ${tool}...`);

      try {
        const results = await this.plugins[tool].execute(cases);
        this.testResults.push(...results);
      } catch (error) {
        console.error(`❌ Error running ${tool} tests:`, error.message);
      }
    }

    console.log(`✅ Test execution complete. ${this.testResults.length} tests run.`);
    return this.testResults;
  }

  /**
   * PHASE 4: Analyze failures with Claude AI
   */
  async analyzeFailures(results) {
    console.log(`🔍 Analyzing test failures with AI...`);

    const failures = results.filter(r => r.status === 'failed');
    if (failures.length === 0) {
      console.log(`✅ All tests passed!`);
      return [];
    }

    const message = await this.client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: `Analyze these test failures and provide root causes and fixes:

${JSON.stringify(failures, null, 2)}

For each failure:
1. Identify the root cause
2. Suggest a fix
3. Estimate fix effort

Format as JSON array of {testId, rootCause, suggestion, effortHours}.`
        }
      ]
    });

    try {
      const analysis = JSON.parse(message.content[0].text);

      // Save analysis
      const filePath = "./testforge-workspace/reports/failure-analysis.json";
      fs.writeFileSync(filePath, JSON.stringify(analysis, null, 2));

      console.log(`✅ Analysis saved to ${filePath}`);
      return analysis;
    } catch (error) {
      console.warn("Could not parse analysis response");
      return [];
    }
  }

  /**
   * PHASE 5: Generate comprehensive test report
   */
  async generateReport(results, options = {}) {
    console.log(`📊 Generating test report...`);

    const stats = this.calculateStats(results);

    const message = await this.client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 3000,
      messages: [
        {
          role: "user",
          content: `Generate an executive QA test report from these metrics:

Total Tests: ${results.length}
Passed: ${stats.passed}
Failed: ${stats.failed}
Skipped: ${stats.skipped}
Pass Rate: ${stats.passRate}%
Coverage: ${stats.coverage}%

Include:
1. Executive Summary
2. Key Metrics
3. Critical Issues
4. Recommendations
5. Next Steps

Format as professional markdown.`
        }
      ]
    });

    const reportContent = `# Test Execution Report
Generated: ${new Date().toISOString()}

## Summary Statistics
- Total Tests: ${results.length}
- Passed: ${stats.passed} (${stats.passRate}%)
- Failed: ${stats.failed}
- Skipped: ${stats.skipped}
- Avg Duration: ${stats.avgDuration}ms

## AI Analysis
${message.content[0].text}

## Detailed Results
${JSON.stringify(this.formatResultsTable(results), null, 2)}`;

    // Save report
    const htmlReport = this.generateHtmlReport(stats, message.content[0].text);
    const htmlPath = "./testforge-workspace/reports/test-report.html";
    fs.writeFileSync(htmlPath, htmlReport);

    const mdPath = "./testforge-workspace/reports/test-report.md";
    fs.writeFileSync(mdPath, reportContent);

    console.log(`✅ Reports generated:`);
    console.log(`   HTML: ${htmlPath}`);
    console.log(`   Markdown: ${mdPath}`);

    return { stats, analysis: message.content[0].text };
  }

  /**
   * Register a test tool plugin
   */
  registerPlugin(name, plugin) {
    this.plugins[name] = plugin;
    console.log(`✅ Plugin registered: ${name}`);
  }

  /**
   * Load test cases from file
   */
  loadTestCases(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    this.testCases = JSON.parse(content);
    return this.testCases;
  }

  /**
   * Save test cases to file
   */
  saveTestCases(filePath) {
    fs.writeFileSync(filePath, JSON.stringify(this.testCases, null, 2));
  }

  /**
   * Helper: Group array by property
   */
  groupBy(array, property) {
    return array.reduce((acc, obj) => {
      const key = obj[property];
      if (!acc[key]) acc[key] = [];
      acc[key].push(obj);
      return acc;
    }, {});
  }

  /**
   * Helper: Get file extension by tool
   */
  getFileExtension(tool) {
    const extensions = {
      'playwright': 'js',
      'rest-assured': 'java',
      'k6': 'js',
      'jmeter': 'jmx',
      'browserstack': 'js'
    };
    return extensions[tool] || 'txt';
  }

  /**
   * Helper: Print test summary
   */
  printTestSummary(testCases) {
    const byCategory = this.groupBy(testCases, 'category');
    const byTool = this.groupBy(testCases, 'tool');

    console.log('\n📋 Test Case Summary:');
    console.log('   By Category:');
    for (const [cat, cases] of Object.entries(byCategory)) {
      console.log(`     - ${cat}: ${cases.length}`);
    }
    console.log('   By Tool:');
    for (const [tool, cases] of Object.entries(byTool)) {
      console.log(`     - ${tool}: ${cases.length}`);
    }
  }

  /**
   * Helper: Calculate statistics
   */
  calculateStats(results) {
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const passRate = results.length > 0 ? Math.round((passed / results.length) * 100) : 0;
    const avgDuration = results.reduce((acc, r) => acc + (r.duration || 0), 0) / results.length;

    return {
      passed,
      failed,
      skipped,
      passRate,
      avgDuration,
      coverage: Math.round((passed / results.length) * 100)
    };
  }

  /**
   * Helper: Format results as table
   */
  formatResultsTable(results) {
    return results.map(r => ({
      testId: r.id,
      title: r.title,
      status: r.status,
      duration: r.duration,
      errorMessage: r.error
    }));
  }

  /**
   * Helper: Generate HTML report
   */
  generateHtmlReport(stats, analysis) {
    return `<!DOCTYPE html>
<html>
<head>
  <title>TestForge Report</title>
  <style>
    body { font-family: Arial; margin: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
    h1 { color: #333; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 20px 0; }
    .stat-box { background: #f9f9f9; padding: 15px; border-radius: 5px; text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; color: #0066cc; }
    .stat-label { color: #666; font-size: 12px; }
    .passed { border-left: 4px solid #4caf50; }
    .failed { border-left: 4px solid #f44336; }
    .analysis { background: #f0f8ff; padding: 15px; border-radius: 5px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>TestForge - Test Execution Report</h1>
    <div class="stats">
      <div class="stat-box passed">
        <div class="stat-value">${stats.passed}</div>
        <div class="stat-label">Passed Tests</div>
      </div>
      <div class="stat-box failed">
        <div class="stat-value">${stats.failed}</div>
        <div class="stat-label">Failed Tests</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${stats.passRate}%</div>
        <div class="stat-label">Pass Rate</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${Math.round(stats.avgDuration)}ms</div>
        <div class="stat-label">Avg Duration</div>
      </div>
    </div>
    <div class="analysis">
      <h2>AI Analysis</h2>
      <pre>${analysis}</pre>
    </div>
    <p style="color: #999; font-size: 12px; margin-top: 20px;">
      Generated: ${new Date().toISOString()}
    </p>
  </div>
</body>
</html>`;
  }
}

module.exports = TestForge;
