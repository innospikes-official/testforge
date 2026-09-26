# TestForge - Universal Testing Framework

**Drop-in testing solution for ANY application**

## 📦 Files Included

### Core Framework
- `testforge-core.js` - Main framework engine
- `testforge-cli.js` - Command-line interface
- `testforge-plugins.js` - Tool adapters (Playwright, Rest Assured, K6, JMeter, BrowserStack, Postman) — each runs the real tool and parses its actual output
- `testforge-llm.js` - LLM connector (Claude, OpenAI, GitHub Copilot, or any OpenAI-compatible endpoint)

### Configuration
- `testforge-configs-example.json` - Complete configuration template

### Documentation
- `TestForge-Framework.md` - Architecture & design
- `TESTFORGE-IMPLEMENTATION-GUIDE.md` - Step-by-step setup
- `TESTFORGE-USE-CASES.md` - Real-world examples (6 use cases)
- `TESTFORGE-README.md` - Quick reference

## 🚀 Quick Start

```bash
# 1. Copy files to your project
cp testforge-*.js testforge-*.json .
npm init -y
npm install @anthropic-ai/sdk @playwright/test axios

# 2. Initialize
node testforge-cli.js init --app myapp --type full-stack

# 3. Generate 100+ tests
node testforge-cli.js generate --count 100

# 4. Run tests
node testforge-cli.js run --generated --parallel

# 5. View report
open testforge-workspace/reports/test-report.html
```

## 🔌 LLM Provider

Set via `config.llm` (in `app.config.json`) or env vars. Default provider is Anthropic.

```json
"llm": { "provider": "openai", "model": "gpt-4o" }
```

| Provider | Env vars |
|---|---|
| `anthropic` (default) | `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` (or `LLM_API_KEY`) |
| `copilot` | `COPILOT_API_KEY` (or `LLM_API_KEY`) |
| `openai-compatible` | `LLM_API_KEY`, `LLM_BASE_URL` (Azure OpenAI, local vLLM/Ollama, etc.) |

## 📖 Documentation Order

1. **Start here:** `TESTFORGE-README.md` (5 min overview)
2. **Setup:** `TESTFORGE-IMPLEMENTATION-GUIDE.md` (step-by-step)
3. **Examples:** `TESTFORGE-USE-CASES.md` (find your app type)
4. **Architecture:** `TestForge-Framework.md` (deep dive)

## ✨ Supports

- **6 Testing Tools:** Playwright, Rest Assured, K6, JMeter, BrowserStack, Postman
- **Any App Type:** Web, Mobile, API, Full-Stack, Microservices, IoT
- **AI-Powered:** Claude AI generates tests from docs & analyzes failures
- **Production Ready:** CI/CD templates, parallel execution, professional reports

## 💡 For Innospikes Clients

Ready-to-use configuration for Inno Travel in `testforge-configs-example.json`

```bash
# Inno Travel - 610 test cases in 30 minutes
cp testforge-configs-example.json app.config.json
node testforge-cli.js generate --count 610
node testforge-cli.js run --parallel
```

## 📞 Support

All documentation included. Start with `TESTFORGE-README.md`

---

**TestForge** - Making testing smarter, faster, and more cost-effective.
