#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');

const PROVIDER_BASE_URLS = {
    OPENROUTER: 'https://openrouter.ai/api/v1',
    DEEPSEEK: 'https://api.deepseek.com/v1',
    ZEN: 'https://api.zen.my/v1',
    OPENCODE_ZEN: 'https://opencode.ai/zen/v1',
    MINIMAX: 'https://api.minimax.io/v1',
    MOONSHOT: 'https://api.moonshot.cn/v1',
    MODAL: 'https://modal-labs--llm-api-proxy.modal.run/v1',
    XAI: 'https://api.x.ai/v1',
    OPENAI: 'https://api.openai.com/v1',
    QIANFAN_CODING: 'https://qianfan.baidubce.com/v2',
    ZHIPU: 'https://open.bigmodel.cn/api/paas/v4',
    SILICONFLOW: 'https://api.siliconflow.cn/v1',
    MODELSCOPE: 'https://api.modelscope.cn/v1',
    NVIDIA_NIM: 'https://integrate.api.nvidia.com/v1',
    QINIU: 'https://api.qiniu.ai/v1',
    BLTCY: null
};

const PROVIDER_DEFAULT_MODELS = {
    OPENROUTER: [
        'nvidia/nemotron-3-super-120b-a12b:free',
        'google/gemma-4-26b-a4b-it:free',
        'minimax/minimax-m2.5:free',
        'qwen/qwen3-next-80b-a3b-instruct:free',
        'z-ai/glm-4.5-air:free',
        'openai/gpt-oss-120b:free'
    ],
    DEEPSEEK: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat'],
    ZEN: ['opencode/mimo-v2-pro-free'],
    OPENCODE_ZEN: ['minimax-m2.5-free'],
    MINIMAX: ['minimax-m2.7'],
    MOONSHOT: ['moonshot-v1-128k'],
    MODAL: ['claude-sonnet-4.6'],
    XAI: ['grok-4.3'],
    OPENAI: ['gpt-4o'],
    QIANFAN_CODING: ['ernie-4.5-turbo-128k'],
    ZHIPU: ['glm-5.1'],
    SILICONFLOW: ['deepseek-ai/DeepSeek-V4-Pro'],
    MODELSCOPE: ['qwen/qwen3.6-plus'],
    NVIDIA_NIM: ['nvidia/nemotron-3-super-120b-a12b'],
    QINIU: ['nvidia/nemotron-3-super-120b-a12b-free'],
    BLTCY: ['claude-sonnet-4-6-thinking']
};

class ProviderManager {
    constructor() {
        this.providers = [];
    }

    async init() {
        this.providers = await this._discoverProviders();
    }

    async _discoverProviders() {
        const providers = [];
        const env = process.env;

        for (const [key, value] of Object.entries(env)) {
            if (!key.endsWith('_API_KEY') || !value || value.trim().length < 10) continue;

            let prefix = key.replace('_API_KEY', '');
            let baseUrl = PROVIDER_BASE_URLS[prefix];

            if (!baseUrl && prefix !== 'BLTCY') continue;

            if (prefix === 'BLTCY') {
                if (!env.BLTCY_PROXY_URL) continue;
                baseUrl = env.BLTCY_PROXY_URL.replace(/\/$/, '');
            }

            providers.push({
                prefix,
                name: prefix,
                apiKey: value.trim(),
                baseUrl,
                models: await this._getModelsForProvider(prefix, env)
            });
        }

        providers.sort((a, b) => {
            const priority = {
                BLTCY: 0,
                OPENROUTER: 1,
                DEEPSEEK: 2,
                OPENCODE_ZEN: 3,
                ZEN: 4,
                NVIDIA_NIM: 5,
                QINIU: 5,
                XAI: 6,
                OPENAI: 7
            };
            return (priority[a.prefix] || 99) - (priority[b.prefix] || 99);
        });

        return providers;
    }

    async _getModelsForProvider(prefix, env) {
        const modelListStr = env[`${prefix}_MODEL_LIST`];
        if (modelListStr) {
            return modelListStr.split(',').map(m => m.trim()).filter(Boolean);
        }

        if (prefix === 'OPENROUTER') {
            const freeModels = await this._fetchOpenRouterFreeModels();
            if (freeModels.length > 0) return freeModels;
        }
        if (prefix === 'OPENCODE_ZEN') {
            const freeModels = await this._fetchOpenCodeZenFreeModels(env);
            if (freeModels.length > 0) return freeModels;
        }
        if (prefix === 'NVIDIA_NIM') {
            const freeModels = await this._fetchNvidiaNimFreeModels(env);
            if (freeModels.length > 0) return freeModels;
        }

        return PROVIDER_DEFAULT_MODELS[prefix] || [];
    }

    async _fetchOpenRouterFreeModels() {
        try {
            console.log('Fetching OpenRouter free models...');
            const r = await fetch('https://openrouter.ai/api/v1/models', {
                signal: AbortSignal.timeout(15000)
            });
            if (!r.ok) return [];
            const data = await r.json();
            const freeModels = data.data
                .filter(m => m.id && m.id.includes(':free'))
                .map(m => m.id);
            console.log(`Found ${freeModels.length} OpenRouter free models:`, freeModels.slice(0, 10));
            return freeModels;
        } catch (e) {
            console.log(`Failed to fetch OpenRouter models: ${e.message}`);
            return [];
        }
    }

    async _fetchOpenCodeZenFreeModels(env) {
        try {
            const apiKey = env.OPENCODE_ZEN_API_KEY;
            if (!apiKey) return [];
            console.log('Fetching OpenCode-Zen models...');
            const r = await fetch('https://opencode.ai/zen/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` },
                signal: AbortSignal.timeout(15000)
            });
            if (!r.ok) return [];
            const data = await r.json();
            const freeModels = data.data
                .filter(m => m.id && (m.id.includes('free') || m.id.includes('mimo') || m.id.includes('minimax')))
                .map(m => m.id);
            console.log(`Found ${freeModels.length} OpenCode-Zen models:`, freeModels);
            return freeModels;
        } catch (e) {
            console.log(`Failed to fetch OpenCode-Zen models: ${e.message}`);
            return [];
        }
    }

    async _fetchNvidiaNimFreeModels(env) {
        try {
            const apiKey = env.NVIDIA_NIM_API_KEY;
            if (!apiKey) return [];
            console.log('Fetching NVIDIA NIM models...');
            const r = await fetch('https://integrate.api.nvidia.com/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` },
                signal: AbortSignal.timeout(15000)
            });
            if (!r.ok) return [];
            const data = await r.json();
            const freeModels = data.data
                .filter(m => m.id && (m.id.includes('free') || m.id.includes('nemotron')))
                .map(m => m.id);
            console.log(`Found ${freeModels.length} NVIDIA NIM models:`, freeModels);
            return freeModels;
        } catch (e) {
            console.log(`Failed to fetch NVIDIA NIM models: ${e.message}`);
            return [];
        }
    }
}

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
    await manager.init();

    if (manager.providers.length === 0) {
        console.error('No valid API keys found');
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
                console.warn(`AI returned content with remaining conflict markers in ${file}. Falling back to upstream version.`);
                execSync(`git checkout --theirs "${file}"`);
                execSync(`git add "${file}"`);
                console.log(`Accepted upstream version for ${file}`);
                resolvedCount++;
                continue;
            }
            fs.writeFileSync(file, cleaned);
            execSync(`git add "${file}"`);
            console.log(`Resolved and staged ${file}`);
            resolvedCount++;
        } else {
            console.error(`Failed to resolve ${file} across all providers.`);
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
        ? `\n\n=== Repository Context ===\n${agentsContext}\n=== End Repository Context ===`
        : '';

    const prompt = `You are an expert software engineer resolving git merge conflicts. This is CRITICAL.

Task: Analyze the conflicts marked with \`<<<<<<< HEAD\`, \`=======\`, and \`>>>>>>> upstream/branch\` and produce a single, clean, merged version of the file.

CRITICAL RULES:
1. You MUST remove ALL conflict markers. The output MUST NOT contain \`<<<<<<<\`, \`=======\`, or \`>>>>>>>\` anywhere.
2. Preserve the best parts of BOTH versions - do not simply delete one side.
3. Respect the repository context below if provided.
4. Maintain correct syntax, indentation, and imports.
5. Return ONLY the complete resolved file content. Do NOT wrap it in markdown code blocks and do NOT add explanations.
6. If a conflict is in a config file, prefer upstream values for version/schema fields but preserve local customizations for personal settings.

FAILURE IS NOT AN OPTION: If you leave any \`<<<<<<<\`, \`=======\`, or \`>>>>>>>\` in the output, the code will break.${agentsSection}

File path: ${file}

Full file content with conflicts:
\`\`\`
${content}
\`\`\`

Resolved file content (MUST NOT contain any conflict markers):`;

    for (const provider of manager.providers) {
        console.log(`\n--- Trying Provider: ${provider.name} ---`);
        const models = provider.models;

        for (const model of models) {
            console.log(`  -> Model: ${model}`);

            try {
                let url, headers, body;

                if (provider.prefix === 'BLTCY') {
                    url = `${provider.baseUrl}/v1/messages`;
                    headers = {
                        'Content-Type': 'application/json',
                        'x-api-key': provider.apiKey,
                        'anthropic-version': '2023-06-01'
                    };
                    body = {
                        model: model,
                        max_tokens: 4096,
                        messages: [{ role: 'user', content: prompt }]
                    };
                } else {
                    url = `${provider.baseUrl}/chat/completions`;
                    headers = {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${provider.apiKey}`
                    };

                    if (provider.prefix === 'OPENROUTER') {
                        headers['HTTP-Referer'] = 'https://github.com/Fatty911/LibreChat';
                        headers['X-Title'] = 'LibreChat Sync';
                    }

                    body = {
                        model: model,
                        temperature: 0.1,
                        max_tokens: 4096,
                        messages: [{ role: 'user', content: prompt }]
                    };
                }

                const timeout = provider.prefix === 'DEEPSEEK' || provider.prefix === 'BLTCY' || provider.prefix === 'OPENROUTER' ? 300000 : 60000;

                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(timeout)
                });

                if (!response.ok) {
                    const err = await response.text();
                    console.log(`     HTTP ${response.status}: ${err.substring(0, 150)}`);
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
                    console.log(`     Success!`);
                    return resultText.replace(/^```[a-z]*\n/, '').replace(/\n```$/, '').trim() + '\n';
                }

            } catch (error) {
                console.log(`     Request failed: ${error.message}`);
            }
        }
    }
    return null;
}

resolveConflicts().catch((err) => {
    console.error(err);
    process.exit(1);
});
