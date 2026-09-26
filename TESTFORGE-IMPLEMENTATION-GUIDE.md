# TestForge Implementation Guide

## Quick Start (5 minutes)

### 1. Initialize Project
```bash
# Create project directory
mkdir inno-travel-tests
cd inno-travel-tests

# Copy TestForge files
cp testforge-core.js .
cp testforge-cli.js .
cp testforge-plugins.js .
cp testforge-configs-example.json ./app.config.json

# Install dependencies
npm init -y
npm install @anthropic-ai/sdk @playwright/test axios
```

### 2. Run TestForge Commands
```bash
# Initialize project
node testforge-cli.js init --app inno-travel --type full-stack

# Generate test cases from documentation
node testforge-cli.js generate --from ./docs --count 100

# Run generated tests
node testforge-cli.js run --generated --parallel

# View report
node testforge-cli.js report --format html
```

---

## Detailed Setup Guide

### Step 1: Directory Structure Setup

```bash
mkdir -p inno-travel-qa-framework
cd inno-travel-qa-framework

# Create core directories
mkdir -p framework/{core,plugins,generators,cli,templates,configs}
mkdir -p project/{docs,tests,generated,reports,configs}
```

### Step 2: Install Dependencies

**Create `package.json`:**
```json
{
  "name": "testforge-inno-travel",
  "version": "1.0.0",
  "description": "TestForge testing framework for Inno Travel",
  "main": "framework/core/index.js",
  "scripts": {
    "test:init": "node framework/cli/testforge.js init",
    "test:generate": "node framework/cli/testforge.js generate",
    "test:run": "node framework/cli/testforge.js run",
    "test:report": "node framework/cli/testforge.js report"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.9.0",
    "@playwright/test": "^1.40.0",
    "axios": "^1.6.0"
  }
}
```

**Install:**
```bash
npm install
```

### Step 3: Framework File Placement

Place the TestForge files in your project:

```
inno-travel-qa-framework/
├── framework/
│   ├── core/
│   │   └── testforge-core.js          # Copy testforge-core.js here
│   ├── plugins/
│   │   └── testforge-plugins.js       # Copy testforge-plugins.js here
│   ├── cli/
│   │   └── testforge-cli.js           # Copy testforge-cli.js here
│   └── templates/
│       ├── app-config.json
│       └── test-cases.json
├── project/
│   ├── app.config.json                # Copy testforge-configs-example.json here
│   ├── docs/                          # Your documentation
│   ├── tests/                         # Manual test cases
│   ├── generated/                     # Auto-generated test scripts
│   └── reports/                       # Test reports
└── package.json
```

### Step 4: Configure Application

**Edit `project/app.config.json`:**
```json
{
  "name": "inno-travel",
  "baseUrl": "https://travels.innospikes.com",
  "apiBase": "https://api.innospikes.com",
  "modules": [
    {
      "name": "booking",
      "type": "web"
    },
    {
      "name": "payment",
      "type": "api"
    }
  ]
}
```

### Step 5: Create Documentation

**Create `project/docs/overview.md`:**
```markdown
# Inno Travel Platform

## Features
- User authentication
- Travel search
- Booking management
- Payment processing
- Email/SMS notifications
- GPS tracking

## Technology Stack
- Frontend: React
- Backend: Node.js/Express
- Database: PostgreSQL
- Payments: Razorpay
```

---

## Usage Examples

### Example 1: Generate Tests for New Module

```bash
# Generate tests for payment module
node framework/cli/testforge.js generate \
  --from project/docs/payment-api.md \
  --count 50
```

### Example 2: Run Specific Tool Tests

```javascript
// Create test-runner.js
const TestForge = require('./framework/core/testforge-core');
const { PlaywrightPlugin, RestAssuredPlugin } = require('./framework/plugins/testforge-plugins');

const config = {
  name: 'inno-travel',
  baseUrl: 'https://travels.innospikes.com',
  apiBase: 'https://api.innospikes.com'
};

const framework = new TestForge(config);

// Register plugins
framework.registerPlugin('playwright', new PlaywrightPlugin(config));
framework.registerPlugin('rest-assured', new RestAssuredPlugin(config));

// Run tests
(async () => {
  // Generate tests
  const testCases = await framework.generateTestCases(docs, 100);
  
  // Generate scripts for each tool
  const scripts = await framework.generateTestScripts(testCases);
  
  // Execute tests
  const results = await framework.runTests(testCases, { parallel: true });
  
  // Analyze failures
  const analysis = await framework.analyzeFailures(results);
  
  // Generate report
  const report = await framework.generateReport(results);
})();
```

### Example 3: CI/CD Integration (GitHub Actions)

**Create `.github/workflows/testforge.yml`:**
```yaml
name: TestForge Tests

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]
  schedule:
    - cron: '0 2 * * *'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Generate tests
        run: npm run test:generate
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      
      - name: Run tests
        run: npm run test:run
      
      - name: Generate report
        run: npm run test:report
      
      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-reports
          path: project/reports/
      
      - name: Notify Slack
        if: failure()
        uses: 8398a7/action-slack@v3
        with:
          status: ${{ job.status }}
          text: 'TestForge tests failed!'
          webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

---

## Advanced Configuration

### Multi-Project Setup

**testforge-monorepo.config.json:**
```json
{
  "projects": [
    {
      "name": "inno-travel",
      "path": "./projects/inno-travel",
      "tools": ["playwright", "rest-assured"]
    },
    {
      "name": "booking-api",
      "path": "./projects/booking-api",
      "tools": ["rest-assured", "k6"]
    }
  ],
  "parallelProjects": 2,
  "aggregateReports": true
}
```

### Plugin Development

**Create Custom Plugin:**
```javascript
// plugins/my-custom-plugin.js
class MyCustomPlugin {
  constructor(config) {
    this.config = config;
  }

  async execute(testCases) {
    // Your test execution logic
    return testCases.map(tc => ({
      id: tc.id,
      status: 'passed',
      duration: 100
    }));
  }

  async supports(testType) {
    return testType === 'custom';
  }
}

module.exports = MyCustomPlugin;
```

**Register in Framework:**
```javascript
const MyCustomPlugin = require('./plugins/my-custom-plugin');
framework.registerPlugin('custom', new MyCustomPlugin(config));
```

---

## Test Case Breakdown for Inno Travel

Based on the framework configuration:

### Total: 610 Test Cases

| Category | Count | Tool | Automatable |
|----------|-------|------|-------------|
| Functional (Web) | 160 | Playwright | ✅ Yes |
| API Tests | 120 | Rest Assured | ✅ Yes |
| Mobile E2E | 80 | Playwright + BrowserStack | ✅ Yes |
| Performance | 50 | K6 | ✅ Yes |
| Integration | 60 | Rest Assured | ✅ Yes |
| Security | 30 | OWASP ZAP | ❌ No (Manual) |
| Exploratory | 20 | Manual | ❌ No |
| Load Testing | 20 | JMeter | ✅ Yes |
| Real Services | 50 | Manual + Dashboard | ❌ No |
| Regression | 20 | Playwright | ✅ Yes |

---

## Expected Outcomes

### Week 1
- ✅ Framework initialized and configured
- ✅ 610 test cases generated
- ✅ 220+ automated test scripts created
- ✅ Baseline report established

### Month 1
- ✅ 90% automation coverage
- ✅ CI/CD pipeline operational
- ✅ Team trained on framework
- ✅ First regression test suite running

### Ongoing
- ✅ Daily automated tests (30 minutes)
- ✅ Weekly comprehensive suite (2 hours)
- ✅ Monthly load testing (1 hour)
- ✅ Continuous test expansion

---

## Troubleshooting

### Issue: Claude API timeout
```bash
# Solution: Increase timeout and batch size
export ANTHROPIC_TIMEOUT=60000
node testforge-cli.js generate --count 50
```

### Issue: Test script generation fails
```bash
# Solution: Check documentation format
node -e "const fs = require('fs'); console.log(fs.readFileSync('./docs/overview.md', 'utf-8').length);"
```

### Issue: Plugin not executing
```bash
# Solution: Verify plugin registration
framework.registerPlugin('playwright', new PlaywrightPlugin(config));
console.log(Object.keys(framework.plugins)); // Should show 'playwright'
```

---

## Next Steps

1. **Copy all framework files** to your project
2. **Configure app.config.json** with your application details
3. **Set ANTHROPIC_API_KEY** environment variable
4. **Run initial test generation**: `npm run test:generate`
5. **Execute tests**: `npm run test:run`
6. **Review reports**: `npm run test:report`

---

## Support

- Framework Repository: [GitHub](https://github.com/innospikes/testforge)
- Documentation: [Docs](./TestForge-Framework.md)
- Issues: Report via GitHub Issues
