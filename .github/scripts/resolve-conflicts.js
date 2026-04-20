#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');

// ==========================================
// 1. Multi-Provider Fallback Logic
// ==========================================
const PROVIDER_BASE_URLS = {
    OPENROUTER: "https://openrouter.ai/api/v1",
    DEEPSEEK: "https://api.deepseek.com/v1",
    ZEN: "https://api.zen.my/v1",
    MINIMAX: "https://api.minimax.io/v1",
    MOONSHOT: "https://api.moonshot.cn/v1",
    MODAL: "https://modal-labs--llm-api-proxy.modal.run/v1",
    XAI: "https://api.x.ai/v1"
};

// 2026 Default models
const PROVIDER_DEFAULT_MODELS = {
    OPENROUTER: ['anthropic/claude-opus-4.6', 'google/gemini-3.1-pro-preview', 'openai/gpt-5.4'],
    BLTCY: ['claude-sonnet-4-6-thinking'], 
    DEEPSEEK: ['deepseek-r1', 'deepseek-v3'],
    ZEN: ['opencode/mimo-v2-pro-free'],
    MINIMAX: ['m2.7', 'abab6.5s-chat'],
    MOONSHOT: ['moonshot-v1-128k'],
    MODAL: ['claude-opus-4.6'],
    XAI: ['grok-4.20-beta-0309']
};

class ProviderManager {
    constructor() {
        this.providers = this._discoverProviders();
    }

    _discoverProviders() {
        const providers = [];
        const env = process.env;

        for (const [key, value] of Object.entries(env)) {
            if (key.endsWith('_API_KEY') && value && value.trim().length > 10) {
                const prefix = key.replace('_API_KEY', '');
                let baseUrl = PROVIDER_BASE_URLS[prefix];
                
                if (prefix === 'BLTCY' && env.BLTCY_PROXY_URL) {
                    baseUrl = env.BLTCY_PROXY_URL.replace(/\/$/, '');
                }

                if (!baseUrl) continue;

                providers.push({
                    prefix,
                    name: prefix.replace('_', ' '),
                    apiKey: value.trim(),
                    baseUrl,
                    models: this._getModelsForProvider(prefix, env)
                });
            }
        }

        providers.sort((a, b) => {
            const priority = { 'OPENROUTER': 1, 'BLTCY': 2, 'DEEPSEEK': 3, 'XAI': 4, 'ZEN': 5 };
            const pA = priority[a.prefix] || 99;
            const pB = priority[b.prefix] || 99;
            return pA - pB;
        });

        return providers;
    }

    _getModelsForProvider(prefix, env) {
        const modelListStr = env[`${prefix}_MODEL_LIST`];
        if (modelListStr) {
            return modelListStr.split(',').map(m => m.trim()).filter(Boolean);
        }
        return PROVIDER_DEFAULT_MODELS[prefix] || [];
    }

    async fetchTopModels() {
        try {
            console.log("\n=== Scraping top models from artificialanalysis.ai ===");
            const r = await fetch('https://artificialanalysis.ai/leaderboards/models', {
                headers: { "User-Agent": "AutoFix-Action/2.0" },
                signal: AbortSignal.timeout(10000)
            });
            if (!r.ok) return null;
            
            const text = (await r.text()).toLowerCase();
            const keywords = ["gemini", "gpt", "claude", "glm", "minimax", "grok", "kimi", "mimo", "qwen", "deepseek"];
            const found = keywords.filter(kw => text.includes(kw));
            
            const mapping = {
                "claude": "anthropic/claude-opus-4.6",
                "gemini": "google/gemini-3.1-pro-preview",
                "gpt": "openai/gpt-5.4",
                "grok": "xai/grok-4.20-beta-0309",
                "deepseek": "deepseek/deepseek-r1",
                "qwen": "qwen/qwen3.5-397b-a17b",
                "minimax": "minimax/minimax-m2.7",
                "mimo": "xiaomi/mimo-v2-pro"
            };
            
            const result = found.map(kw => mapping[kw]).filter(Boolean);
            console.log("Dynamically scraped top models (2026 specs):", result);
            return result.length > 0 ? result : null;
        } catch (e) {
            console.log(`Failed to scrape leaderboard: ${e.message}`);
            return null;
        }
    }

    async resolveModels(provider) {
        if (provider.prefix === 'OPENROUTER') {
            const scraped = await this.fetchTopModels();
            if (scraped) {
                return [...new Set([...scraped, ...provider.models])];
            }
        }
        return provider.models;
    }
}

// ==========================================
// 2. Conflict Resolution Core
// ==========================================

async function resolveConflicts() {
  const manager = new ProviderManager();
  
  if (manager.providers.length === 0) {
      console.error('No valid API keys found in environment variables (e.g., OPENROUTER_API_KEY, BLTCY_API_KEY)');
      process.exit(1);
  }

  console.log(`Discovered ${manager.providers.length} providers:`, manager.providers.map(p => p.name).join(', '));

  const conflictedFiles = execSync('git diff --name-only --diff-filter=U', { encoding: 'utf-8' })
    .trim()
    .split('\n')
    .filter(Boolean);

  if (conflictedFiles.length === 0) {
    console.log('No conflicts to resolve');
    return;
  }

  console.log(`Found ${conflictedFiles.length} conflicted files`);

  for (const file of conflictedFiles) {
    console.log(`\nResolving conflicts in ${file}...`);
    const content = fs.readFileSync(file, 'utf-8');
    
    if (!content.includes('<<<<<<<')) {
        console.log(`No conflict markers found in ${file}, skipping.`);
        continue;
    }

    const resolved = await tryProviders(manager, file, content);
    
    if (resolved) {
      fs.writeFileSync(file, resolved);
      execSync(`git add "${file}"`);
      console.log(`✓ Resolved and staged ${file}`);
    } else {
      console.error(`✗ Failed to resolve ${file} across all providers.`);
    }
  }
}

async function tryProviders(manager, file, content) {
    const prompt = `You are an expert software engineer resolving git merge conflicts. Analyze the conflicts (marked with <<<<<<<, =======, >>>>>>>) and merge the code intelligently. Preserve the best parts of both versions.

File path: ${file}

Full file content with conflicts:
\`\`\`
${content}
\`\`\`

Return ONLY the complete resolved file content. Do not include markdown code block backticks around your output, and do not provide any explanations.`;

    for (const provider of manager.providers) {
        console.log(`\n--- Trying Provider: ${provider.name} ---`);
        const models = await manager.resolveModels(provider);
        
        for (const model of models) {
            console.log(`  -> Model: ${model}`);
            
            try {
                const url = provider.prefix === 'BLTCY' ? `${provider.baseUrl}/v1/messages` : `${provider.baseUrl}/chat/completions`;
                const headers = { 'Content-Type': 'application/json' };
                
                if (provider.prefix === 'BLTCY') {
                    headers['x-api-key'] = provider.apiKey;
                    headers['anthropic-version'] = '2023-06-01';
                } else {
                    headers['Authorization'] = `Bearer ${provider.apiKey}`;
                }

                if (provider.prefix === 'OPENROUTER') {
                    headers['HTTP-Referer'] = 'https://github.com/Fatty911/Repo';
                    headers['X-Title'] = 'AutoFix Resolver';
                }

                const body = provider.prefix === 'BLTCY' ? {
                    model: model,
                    max_tokens: 8000,
                    messages: [{ role: 'user', content: prompt }]
                } : {
                    model: model,
                    temperature: 0.1,
                    messages: [{ role: 'user', content: prompt }]
                };

                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(60000)
                });

                if (!response.ok) {
                    const err = await response.text();
                    console.log(`     ✗ HTTP ${response.status}: ${err.substring(0, 100)}`);
                    continue;
                }

                const data = await response.json();
                let resultText = '';

                if (provider.prefix === 'BLTCY' && data.content) {
                    resultText = data.content[0].text;
                } else if (data.choices && data.choices[0] && data.choices[0].message) {
                    resultText = data.choices[0].message.content;
                }

                if (resultText) {
                    console.log(`     ✓ Success!`);
                    return resultText.replace(/^```[a-z]*\n/, '').replace(/\n```$/, '').trim() + '\n';
                }
                
            } catch (error) {
                console.log(`     ✗ Request failed: ${error.message}`);
            }
        }
    }
    return null;
}

resolveConflicts().catch(console.error);
