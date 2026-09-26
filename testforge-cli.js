#!/usr/bin/env node

/**
 * TestForge CLI
 * Command-line interface for universal testing framework
 */

const fs = require("fs");
const path = require("path");
const TestForge = require("./testforge-core");

class TestForgeCLI {
  constructor() {
    this.framework = null;
  }

  /**
   * $ testforge init --app myapp --type full-stack
   */
  async init(args) {
    const appName = this.getArg(args, '--app') || 'test-app';
    const appType = this.getArg(args, '--type') || 'web';

    console.log(`✨ Initializing TestForge for: ${appName} (${appType})`);

    // Create config
    const config = {
      name: appName,
      type: appType,
      baseUrl: 'http://localhost:3000',
      apiBase: 'http://localhost:3000/api',
      modules: [
        {
          name: 'core',
          type: appType,
          description: 'Core application features'
        }
      ],
      tools: ['playwright', 'rest-assured'],
      workdir: './testforge-workspace'
    };

    fs.mkdirSync(`./testforge-workspace`, { recursive: true });
    fs.mkdirSync(`./testforge-workspace/configs`, { recursive: true });
    fs.mkdirSync(`./testforge-workspace/tests`, { recursive: true });
    fs.mkdirSync(`./testforge-workspace/generated`, { recursive: true });
    fs.mkdirSync(`./testforge-workspace/reports`, { recursive: true });

    // Save config
    fs.writeFileSync(
      './testforge-workspace/configs/app.config.json',
      JSON.stringify(config, null, 2)
    );

    // Create example test cases
    const exampleTestCases = {
      testCases: [
        {
          id: 'TC_001',
          title: 'User can access application',
          category: 'smoke',
          module: 'core',
          tool: 'playwright',
          automatable: true,
          priority: 'p0',
          steps: ['Navigate to base URL', 'Wait for page load'],
          expectedResult: 'Page loads successfully',
          tags: ['smoke', 'regression'],
          estimatedTime: 5
        }
      ]
    };

    fs.writeFileSync(
      './testforge-workspace/configs/test-cases.json',
      JSON.stringify(exampleTestCases, null, 2)
    );

    // Create package.json
    const packageJson = {
      name: `testforge-${appName}`,
      version: '1.0.0',
      description: `TestForge testing suite for ${appName}`,
      scripts: {
        'test:generate': 'node testforge.js generate',
        'test:run': 'node testforge.js run',
        'test:report': 'node testforge.js report'
      },
      dependencies: {
        '@anthropic-ai/sdk': '^0.9.0',
        '@playwright/test': '^1.40.0',
        'axios': '^1.6.0'
      }
    };

    fs.writeFileSync(
      './testforge-workspace/package.json',
      JSON.stringify(packageJson, null, 2)
    );

    console.log(`
✅ TestForge initialized!

📁 Structure created:
   testforge-workspace/
   ├── configs/
   │   ├── app.config.json
   │   └── test-cases.json
   ├── tests/
   ├── generated/
   ├── reports/
   └── package.json

🚀 Next steps:
   1. Update testforge-workspace/configs/app.config.json
   2. Run: npm install (in testforge-workspace)
   3. Run: testforge generate --from docs
   4. Run: testforge run
    `);
  }

  /**
   * $ testforge generate --from docs --count 50
   */
  async generate(args) {
    const from = this.getArg(args, '--from') || 'docs';
    const count = parseInt(this.getArg(args, '--count') || '100');

    // Load config
    const config = this.loadConfig();
    this.framework = new TestForge(config);

    // Load documentation
    let docs = '';
    if (from === 'docs' && fs.existsSync('./docs')) {
      console.log('📖 Reading documentation...');
      docs = fs.readdirSync('./docs')
        .filter(f => f.endsWith('.md'))
        .map(f => fs.readFileSync(path.join('./docs', f), 'utf-8'))
        .join('\n');
    } else if (from.startsWith('http')) {
      console.log('📥 Fetching documentation from URL...');
      // In real implementation, fetch from URL
      docs = `Documentation from ${from}`;
    } else {
      console.log('📄 Using provided content...');
      docs = from;
    }

    if (!docs) {
      console.error('❌ No documentation found. Provide docs in ./docs/ or use --from url');
      process.exit(1);
    }

    // Generate test cases
    const testCases = await this.framework.generateTestCases(docs, count);

    console.log(`
✅ Test cases generated!

📊 Summary:
${this.getTestCasesSummary(testCases)}

📂 Saved to: testforge-workspace/configs/test-cases-generated.json

🎬 Next: testforge run --generated
    `);
  }

  /**
   * $ testforge run [--generated] [--parallel]
   */
  async runTests(args) {
    const useGenerated = args.includes('--generated');
    const parallel = !args.includes('--serial');

    // Load config
    const config = this.loadConfig();
    this.framework = new TestForge(config);

    // Load test cases
    let testCases;
    if (useGenerated && fs.existsSync('./testforge-workspace/configs/test-cases-generated.json')) {
      testCases = JSON.parse(
        fs.readFileSync('./testforge-workspace/configs/test-cases-generated.json', 'utf-8')
      );
    } else {
      testCases = JSON.parse(
        fs.readFileSync('./testforge-workspace/configs/test-cases.json', 'utf-8')
      ).testCases;
    }

    console.log(`🚀 Running ${testCases.length} tests (${parallel ? 'parallel' : 'serial'})...`);

    // Register the real tool adapters — each shells out to its actual runner.
    const plugins = require('./testforge-plugins');
    const pluginConfig = { ...config, ...(config.pluginConfig || {}) };
    this.framework.registerPlugin('playwright', new plugins.PlaywrightPlugin(pluginConfig));
    this.framework.registerPlugin('rest-assured', new plugins.RestAssuredPlugin(pluginConfig));
    this.framework.registerPlugin('k6', new plugins.K6Plugin(pluginConfig));
    this.framework.registerPlugin('jmeter', new plugins.JMeterPlugin(pluginConfig));
    this.framework.registerPlugin('browserstack', new plugins.BrowserStackPlugin(pluginConfig));
    this.framework.registerPlugin('postman', new plugins.PostmanPlugin(pluginConfig));

    // Run tests
    const results = await this.framework.runTests(testCases, { parallel });

    // Analyze failures
    if (results.some(r => r.status === 'failed')) {
      await this.framework.analyzeFailures(results);
    }

    // Generate report
    await this.framework.generateReport(results);

    console.log(`
✅ Test execution complete!

📊 Results:
   Passed: ${results.filter(r => r.status === 'passed').length}
   Failed: ${results.filter(r => r.status === 'failed').length}

📈 Reports:
   HTML: ./testforge-workspace/reports/test-report.html
   Markdown: ./testforge-workspace/reports/test-report.md
    `);
  }

  /**
   * $ testforge report [--format html|json|csv]
   */
  async report(args) {
    const format = this.getArg(args, '--format') || 'html';

    if (!fs.existsSync('./testforge-workspace/reports/test-report.html')) {
      console.error('❌ No reports found. Run tests first: testforge run');
      process.exit(1);
    }

    const reportPath = `./testforge-workspace/reports/test-report.${format}`;
    console.log(`
📊 Test Report

View report: ${reportPath}
Generated: ${new Date().toISOString()}
    `);
  }

  /**
   * $ testforge dashboard [--port 4000]
   */
  async dashboard(args) {
    const port = parseInt(this.getArg(args, '--port') || '4000', 10);
    const { startDashboard } = require('./testforge-dashboard');
    startDashboard({ port });
  }

  /**
   * $ testforge config --list
   */
  async config(args) {
    if (args.includes('--list')) {
      const config = this.loadConfig();
      console.log('📋 Current Configuration:');
      console.log(JSON.stringify(config, null, 2));
    } else if (args.includes('--add-plugin')) {
      const plugin = this.getArg(args, '--add-plugin');
      const config = this.loadConfig();
      if (!config.plugins) config.plugins = [];
      if (!config.plugins.includes(plugin)) {
        config.plugins.push(plugin);
        this.saveConfig(config);
        console.log(`✅ Plugin added: ${plugin}`);
      }
    }
  }

  /**
   * $ testforge help
   */
  help() {
    console.log(`
╔══════════════════════════════════════════════════════╗
║         TestForge - Universal Testing Framework      ║
╚══════════════════════════════════════════════════════╝

COMMANDS:

  testforge init --app NAME --type TYPE
    Initialize new TestForge project
    Types: web, mobile, api, full-stack

  testforge generate --from SOURCE --count N
    Generate test cases using Claude AI
    Source: docs, url, or path

  testforge run [--generated] [--parallel]
    Execute test suite
    --generated: Use AI-generated test cases
    --parallel: Run tests in parallel

  testforge report [--format FORMAT]
    View test reports
    Format: html, json, csv (default: html)

  testforge dashboard [--port PORT]
    Launch live trend dashboard (default port 4000)
    Reads testforge-workspace/reports/history.json, built up as 'run' executes

  testforge config [--list] [--add-plugin PLUGIN]
    Manage configuration
    Plugins: playwright, rest-assured, k6, jmeter, browserstack

  testforge help
    Show this help message

WORKFLOW:

  1. testforge init --app myapp --type web
  2. Update testforge-workspace/configs/app.config.json
  3. testforge generate --count 100
  4. testforge run --generated --parallel
  5. testforge report

SUPPORTED TOOLS:

  ✓ Playwright (Web & Mobile E2E)
  ✓ Rest Assured (API Testing)
  ✓ K6 (Performance/Load Testing)
  ✓ JMeter (Load Testing)
  ✓ BrowserStack (Real Devices)

For more info: https://github.com/testforge
    `);
  }

  /**
   * Helper: Get argument value
   */
  getArg(args, flag) {
    const index = args.indexOf(flag);
    return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
  }

  /**
   * Helper: Load config
   */
  loadConfig() {
    const configPath = './testforge-workspace/configs/app.config.json';
    if (!fs.existsSync(configPath)) {
      console.error('❌ Config not found. Run: testforge init');
      process.exit(1);
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }

  /**
   * Helper: Save config
   */
  saveConfig(config) {
    fs.writeFileSync(
      './testforge-workspace/configs/app.config.json',
      JSON.stringify(config, null, 2)
    );
  }

  /**
   * Helper: Get test cases summary
   */
  getTestCasesSummary(testCases) {
    const byCategory = {};
    const byTool = {};

    testCases.forEach(tc => {
      byCategory[tc.category] = (byCategory[tc.category] || 0) + 1;
      byTool[tc.tool] = (byTool[tc.tool] || 0) + 1;
    });

    let summary = '';
    summary += '\n   By Category:\n';
    for (const [cat, count] of Object.entries(byCategory)) {
      summary += `     • ${cat}: ${count}\n`;
    }
    summary += '\n   By Tool:\n';
    for (const [tool, count] of Object.entries(byTool)) {
      summary += `     • ${tool}: ${count}\n`;
    }

    return summary;
  }

  /**
   * Main entry point
   */
  async run() {
    const args = process.argv.slice(2);
    const command = args[0];

    try {
      switch (command) {
        case 'init':
          await this.init(args.slice(1));
          break;
        case 'generate':
          await this.generate(args.slice(1));
          break;
        case 'run':
          await this.runTests(args.slice(1));
          break;
        case 'report':
          await this.report(args.slice(1));
          break;
        case 'dashboard':
          await this.dashboard(args.slice(1));
          break;
        case 'config':
          await this.config(args.slice(1));
          break;
        case 'help':
          this.help();
          break;
        default:
          this.help();
      }
    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  }
}

// Run CLI
const cli = new TestForgeCLI();
cli.run();
