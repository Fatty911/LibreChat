#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');

// ==========================================
// 1. Multi-Provider Fallback Logic
// ==========================================
const PROVIDER_BASE_URLS = {
    OPENROUTER: 'https://openrouter.ai/api/v1',
    DEEPSEEK: 'https://api.deepseek.com/v1',
    ZEN: 'https://api.zen.my/v1',
    MINIMAX: 'https://api.minimax.io/v1',
    MOONSHOT: 'https://api.moonshot.cn/v1',
    MODAL: 'https://modal-labs--llm-api-proxy.modal.run/v1',
    XAI: 'https://api.x.ai/v1',
    OPENAI: 'https://api.openai.com/v1',
    QIANFAN_CODING: 'https://qianfan.baidubce.com/v2',
    ZHIPU: 'https://open.bigmodel.cn/api/paas/v4',
    SILICONFLOW: 'https://api.siliconflow.cn/v1',
    MODELSCOPE: 'https://api.modelscope.cn/v1'
};

// 2026 Default models
const PROVIDER_DEFAULT_MODELS = {
    OPENROUTER: ['anthropic/claude-opus-4.6', 'google/gemini-3.1-pro-preview', 'openai/gpt-5.4'],
    DEEPSEEK: ['deepseek-r1', 'deepseek-v3'],
    ZEN: ['opencode/mimo-v2-pro-free'],
    MINIMAX: ['m2.7', 'abab6.5s-chat'],
    MOONSHOT: ['moonshot-v1-128k'],
    MODAL: ['claude-opus-4.6'],
    XAI: ['grok-4.20-beta-0309'],
    OPENAI: ['gpt-5.4'],
    QIANFAN_CODING: ['ernie-4.5-turbo-128k'],
    ZHIPU: ['glm-5.1'],
    SILICONFLOW: ['deepseek-ai/DeepSeek-R1'],
    MODELSCOPE: ['qwen/qwen3.6-plus']
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
                
                if (!baseUrl) continue;

                if (prefix === 'BLTCY') {
                    continue;
                }

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
            const priority = {
                OPENROUTER: 1,
                DEEPSEEK: 2,
                XAI: 3,
                OPENAI: 4,
                ZEN: 5,
                QIANFAN_CODING: 6,
                ZHIPU: 7,
                SILICONFLOW: 8,
                MODELSCOPE: 9,
                MINIMAX: 10,
                MOONSHOT: 11,
                MODAL: 12
            };
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

function loadAgentsContext() {
    try {
        const agentsPath = 'AGENTS.md';
        if (fs.existsSync(agentsPath)) {
            return fs.readFileSync(agentsPath, 'utf-8');
        }
    } catch {
        return '';
    }
    return '';
}

async function resolveConflicts() {
    const manager = new ProviderManager();

    if (manager.providers.length === 0) {
        console.error('No valid API keys found in environment variables (e.g., OPENROUTER_API_KEY, BLTCY_API_KEY)');
        process.exit(1);
    }

    console.log(`Discovered ${manager.providers.length} providers:`, manager.providers.map((p) => p.name).join(', '));

    const conflictedFiles = execSync('git diff --name-only --diff-filter=U', { encoding: 'utf-8' })
        .trim()
        .split('\n')
        .filter(Boolean);

    if (conflictedFiles.length === 0) {
        console.log('No conflicts to resolve');
        return;
    }

    console.log(`Found ${conflictedFiles.length} conflicted files`);

    const agentsContext = loadAgentsContext();
    let resolvedCount = 0;
    let failedCount = 0;

    for (const file of conflictedFiles) {
        console.log(`\nResolving conflicts in ${file}...`);
        const content = fs.readFileSync(file, 'utf-8');

        if (!content.includes('<<<<<<<')) {
            console.log(`No conflict markers found in ${file}, skipping.`);
            continue;
        }

        const resolved = await tryProviders(manager, file, content, agentsContext);

        if (resolved) {
            const cleaned = resolved.replace(/^```[a-z]*\n/, '').replace(/\n```$/, '').trim() + '\n';
            if (cleaned.includes('<<<<<<<') || cleaned.includes('=======') || cleaned.includes('>>>>>>>')) {
                console.error(`✗ Resolved content still contains conflict markers in ${file}, rejecting.`);
                failedCount++;
                continue;
            }
            fs.writeFileSync(file, cleaned);
            execSync(`git add "${file}"`);
            console.log(`✓ Resolved and staged ${file}`);
            resolvedCount++;
        } else {
            console.error(`✗ Failed to resolve ${file} across all providers.`);
            failedCount++;
        }
    }

    console.log(`\n=== Resolution Summary: ${resolvedCount} resolved, ${failedCount} failed ===`);

    if (failedCount > 0) {
        process.exit(1);
    }
}

async function tryProviders(manager, file, content, agentsContext) {
    const agentsSection = agentsContext
        ? `\n\n=== Repository Context (MUST respect these rules) ===\n${agentsContext}\n=== End Repository Context ===`
        : '';

    const prompt = `You are an expert software engineer resolving git merge conflicts.

Task: Analyze the conflicts marked with \`<<<<<<< HEAD\`, \`=======\`, and \`>>>>>>> upstream/branch\` and produce a single, clean, merged version of the file.

Rules:
1. Preserve the best parts of BOTH versions. Do not simply choose one side over the other unless it is clearly obsolete.
2. Respect the repository context below if provided.
3. Maintain correct syntax, indentation, and imports.
4. Remove ALL conflict markers; the output must not contain \`<<<<<<<\`, \`=======\`, or \`>>>>>>>\`.
5. Return ONLY the complete resolved file content. Do NOT wrap it in markdown code blocks and do NOT add explanations.
6. If a conflict is in a config file (JSON/YAML), prefer upstream values for version/schema fields but preserve local customizations for personal settings.
7. For code files, analyze the semantic intent of each side and produce a coherent merge.${agentsSection}

File path: ${file}

Full file content with conflicts:
\`\`\`
${content}
\`\`\`

Resolved file content:`;

    for (const provider of manager.providers) {
        console.log(`\n--- Trying Provider: ${provider.name} ---`);
        const models = await manager.resolveModels(provider);
        
        for (const model of models) {
            console.log(`  -> Model: ${model}`);
            
            try {
                const url = `${provider.baseUrl}/chat/completions`;
                const headers = {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${provider.apiKey}`
                };

                if (provider.prefix === 'OPENROUTER') {
                    headers['HTTP-Referer'] = 'https://github.com/Fatty911/Repo';
                    headers['X-Title'] = 'AutoFix Resolver';
                }

                const body = {
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

                if (data.choices && data.choices[0] && data.choices[0].message) {
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

resolveConflicts().catch((err) => {
    console.error(err);
    process.exit(1);
});
