/**
 * TestForge LLM Connector
 * One `complete()` shape over multiple providers: Anthropic (Claude), OpenAI,
 * GitHub Copilot, and any other OpenAI-compatible chat-completions endpoint
 * (Azure OpenAI, local vLLM/Ollama servers, etc).
 *
 * Config (all optional, env vars are the fallback):
 *   { provider: "anthropic"|"openai"|"copilot"|"openai-compatible",
 *     apiKey, model, baseUrl }
 */

const Anthropic = require("@anthropic-ai/sdk");

const DEFAULT_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  copilot: "https://api.githubcopilot.com",
};

function createLLMClient(config = {}) {
  const provider = config.provider || process.env.LLM_PROVIDER || "anthropic";

  if (provider === "anthropic") {
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    const client = new Anthropic({ apiKey });
    const model = config.model || "claude-sonnet-4-6";
    return {
      provider,
      async complete({ messages, maxTokens = 4000 }) {
        const res = await client.messages.create({ model, max_tokens: maxTokens, messages });
        return res.content[0].text;
      },
    };
  }

  // openai / copilot / openai-compatible: same request shape everywhere.
  const baseUrl = (config.baseUrl || process.env.LLM_BASE_URL || DEFAULT_BASE_URLS[provider] || DEFAULT_BASE_URLS.openai)
    .replace(/\/$/, "");
  const apiKey = config.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.COPILOT_API_KEY;
  const model = config.model || process.env.LLM_MODEL || "gpt-4o";

  if (!apiKey) {
    throw new Error(`No API key for LLM provider "${provider}". Set config.apiKey or the matching env var.`);
  }

  return {
    provider,
    async complete({ messages, maxTokens = 4000 }) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
      });
      if (!res.ok) {
        throw new Error(`LLM request failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
      }
      const data = await res.json();
      return data.choices[0].message.content;
    },
  };
}

module.exports = { createLLMClient };
