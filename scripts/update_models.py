#!/usr/bin/env python3
"""
从 lmarena.ai 排行榜抓取前 N 名模型，
结合 model_mapping.json 更新 librechat.yaml 中的模型列表。
"""

import json
import re
import sys
from pathlib import Path

import requests
import yaml

TOP_N = 30
MAPPING_FILE = Path(__file__).parent / "model_mapping.json"
YAML_FILE = Path(__file__).parent.parent / "librechat.yaml"

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/json,application/xhtml+xml,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
}

KNOWN_ORG_PREFIXES = [
    'Anthropic', 'MoonshotAI', 'Bytedance', 'ByteDance', 'Tencent', 'Meta', 'Flux',
    'Stability', 'RWKV', 'HuggingFace', 'Azure', 'OpenChat', '01.AI',
    'Nvidia', 'NVIDIA', 'Snowflake', 'InternLM', 'Cohere', 'Stepfun', 'Minimax',
    'MiniMax', 'NexusFlow', 'Nous', 'DeepSeek', 'Xiaomi', 'Google', 'xAI', 'OpenAI',
    'Zhipu', 'Baidu', 'Alibaba', 'Mistral', 'IBM', 'Amazon', 'Databricks', 'Upstage',
    'Microsoft', 'Stability AI', 'Black Forest Labs',
]

ORG_TO_PROVIDER = {
    'Anthropic': 'Anthropic',
    'MoonshotAI': 'MoonshotAI',
    'Bytedance': 'Bytedance',
    'ByteDance': 'Bytedance',
    'Tencent': 'Tencent',
    'Meta': 'Meta',
    'Flux': 'Black Forest Labs',
    'Stability': 'Stability',
    'Stability AI': 'Stability',
    'Nvidia': 'Nvidia',
    'NVIDIA': 'Nvidia',
    'InternLM': 'InternLM',
    'Cohere': 'Cohere',
    'Stepfun': 'Stepfun',
    'Minimax': 'Minimax',
    'MiniMax': 'Minimax',
    'DeepSeek': 'DeepSeek',
    'Xiaomi': 'Xiaomi',
    'Google': 'Google',
    'xAI': 'xAI',
    'OpenAI': 'OpenAI',
    'Zhipu': 'Zhipu',
    'Baidu': 'Baidu',
    'Alibaba': 'Alibaba',
    'Mistral': 'Mistral',
    'IBM': 'IBM',
    'Amazon': 'Amazon',
    'Databricks': 'Databricks',
    'Microsoft': 'Microsoft',
    'Black Forest Labs': 'Black Forest Labs',
}

PROVIDER_PATTERNS = [
    (re.compile(r'^claude', re.I), 'Anthropic'),
    (re.compile(r'^gemini|^gemma|^veo-', re.I), 'Google'),
    (re.compile(r'^grok', re.I), 'xAI'),
    (re.compile(r'^gpt-|^o[1-9]-|^o[1-9]$|^chatgpt', re.I), 'OpenAI'),
    (re.compile(r'^glm-|^chatglm', re.I), 'Zhipu'),
    (re.compile(r'^deepseek', re.I), 'DeepSeek'),
    (re.compile(r'^mixtral|^mistral|^magistral', re.I), 'Mistral'),
    (re.compile(r'^llama|^codellama', re.I), 'Meta'),
    (re.compile(r'^qwen|^qwq|^wan', re.I), 'Alibaba'),
    (re.compile(r'^phi-', re.I), 'Microsoft'),
    (re.compile(r'^kimi', re.I), 'MoonshotAI'),
    (re.compile(r'^hunyuan', re.I), 'Tencent'),
    (re.compile(r'^step-', re.I), 'Stepfun'),
    (re.compile(r'^minimax', re.I), 'Minimax'),
    (re.compile(r'^flux', re.I), 'Black Forest Labs'),
    (re.compile(r'^ernie', re.I), 'Baidu'),
    (re.compile(r'^yi-|^yi-lightning', re.I), '01.AI'),
    (re.compile(r'^internlm', re.I), 'InternLM'),
    (re.compile(r'^command-r', re.I), 'Cohere'),
    (re.compile(r'^nova-', re.I), 'Amazon'),
    (re.compile(r'^dbrx', re.I), 'Databricks'),
]

def split_org_from_model(raw_name):
    if not raw_name:
        return {'org': '', 'model': raw_name}
    for prefix in KNOWN_ORG_PREFIXES:
        if raw_name.startswith(prefix) and len(raw_name) > len(prefix):
            rest = raw_name[len(prefix):]
            if rest and rest[0].islower():
                return {'org': prefix, 'model': rest}
    return {'org': '', 'model': raw_name}

def detect_provider(model_name, org):
    if org and org in ORG_TO_PROVIDER:
        return ORG_TO_PROVIDER[org]
    for pattern, provider in PROVIDER_PATTERNS:
        if pattern.match(model_name):
            return provider
    return 'Other'

def fetch_from_api():
    try:
        resp = requests.get(
            'https://lmarena.ai/api/v1/leaderboard?category=text',
            timeout=30,
            headers=HEADERS
        )
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list):
                return data
            if isinstance(data, dict) and 'data' in data:
                return data['data']
    except Exception as e:
        print(f"[WARN] API 请求失败: {e}")
    return None

def parse_html(html):
    models = []
    row_regex = re.compile(r'<tr[^>]*>([\s\S]*?)</tr>', re.IGNORECASE)
    cell_regex = re.compile(r'<t[dh][^>]*>([\s\S]*?)</t[dh]>', re.IGNORECASE)
    
    for row_match in row_regex.finditer(html):
        cells = []
        for cell_match in cell_regex.finditer(row_match.group(1)):
            cell_text = re.sub(r'<[^>]+>', ' ', cell_match.group(1))
            cell_text = re.sub(r'\s+', ' ', cell_text).strip()
            cells.append(cell_text)
        
        if len(cells) >= 4:
            try:
                rank = int(cells[0])
            except ValueError:
                continue
            
            model_info = cells[2]
            score_info = cells[3]
            
            score_match = re.search(r'(\d{3,4})', score_info)
            if not score_match:
                continue
            rating = int(score_match.group(1))
            
            if rating <= 0:
                continue
            
            result = split_org_from_model(model_info)
            model = result['model']
            org = result['org']
            
            if not org:
                for pattern, provider in PROVIDER_PATTERNS:
                    if pattern.search(model_info):
                        org = provider
                        break
            
            model = re.sub(r'\s*·.*$', '', model)
            model = re.sub(r'\s+[A-Z][a-z]+$', '', model).strip()
            
            if org and org in ORG_TO_PROVIDER:
                provider = ORG_TO_PROVIDER[org]
            else:
                provider = detect_provider(model, org)
            
            models.append({
                'model': model,
                'rating': rating,
                'provider': provider,
                'rank': rank,
            })
    
    return models

def fetch_from_html():
    try:
        resp = requests.get(
            'https://lmarena.ai/leaderboard/text',
            timeout=30,
            headers=HEADERS
        )
        if resp.status_code == 200:
            return parse_html(resp.text)
    except Exception as e:
        print(f"[WARN] HTML 爬取失败: {e}")
    return None

def fetch_leaderboard():
    print("正在获取 lmarena.ai 排行榜...")
    
    data = fetch_from_api()
    if data:
        print(f"API 获取到 {len(data)} 条数据")
        models = normalize_and_dedup(data)
        if models:
            return [m['model'] for m in models[:TOP_N]]
    
    data = fetch_from_html()
    if data:
        print(f"HTML 爬取到 {len(data)} 条数据")
        return [m['model'] for m in data[:TOP_N]]
    
    print("[ERROR] 无法获取排行榜数据")
    return []

def normalize_and_dedup(data):
    if not data:
        return []
    
    seen = {}
    for item in data:
        model = item.get('model') or item.get('name') or ''
        rating = item.get('rating') or item.get('arena_score') or item.get('score') or item.get('elo') or 0
        if not model or not rating:
            continue
        rating = int(rating)
        if model not in seen or rating > seen[model]['rating']:
            seen[model] = {'model': model, 'rating': rating}
    
    models = list(seen.values())
    models.sort(key=lambda x: x['rating'], reverse=True)
    
    return [m for m in models[:TOP_N]]

def load_mapping():
    with open(MAPPING_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {k: v for k, v in data.items() if not k.startswith("_")}

def update_yaml(provider_models):
    with open(YAML_FILE, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    endpoints = config.get("endpoints", {})

    for builtin in ["openAI", "anthropic"]:
        if builtin in endpoints and builtin in provider_models:
            models = provider_models[builtin]
            if models:
                endpoints[builtin]["models"]["default"] = models
                if len(models) > 1:
                    endpoints[builtin]["titleModel"] = models[-1]

    if "custom" in endpoints:
        for endpoint in endpoints["custom"]:
            name = endpoint.get("name", "")
            if name in provider_models and provider_models[name]:
                endpoint["models"]["default"] = provider_models[name]
                if len(provider_models[name]) > 1:
                    endpoint["titleModel"] = provider_models[name][-1]

    config["endpoints"] = endpoints

    with open(YAML_FILE, "w", encoding="utf-8") as f:
        yaml.dump(config, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

def main():
    arena_models = fetch_leaderboard()

    if not arena_models:
        print("[ERROR] 无法获取排行榜数据，跳过更新")
        sys.exit(1)

    print(f"获取到 {len(arena_models)} 个模型:")
    for i, m in enumerate(arena_models, 1):
        print(f"  {i}. {m}")

    mapping = load_mapping()

    provider_models = {}
    matched = 0
    for arena_name in arena_models:
        if arena_name in mapping:
            info = mapping[arena_name]
            provider = info["provider"]
            model_id = info["model_id"]
            provider_models.setdefault(provider, []).append(model_id)
            matched += 1

    print(f"\n匹配到 {matched} 个模型:")
    for provider, models in provider_models.items():
        print(f"  {provider}: {models}")

    if matched == 0:
        print("[WARN] 没有匹配到任何模型")
        sys.exit(0)

    with open(YAML_FILE, "r", encoding="utf-8") as f:
        old_content = f.read()

    update_yaml(provider_models)

    with open(YAML_FILE, "r", encoding="utf-8") as f:
        new_content = f.read()

    if old_content == new_content:
        print("\n模型列表无变化，无需更新。")
    else:
        print("\n✅ librechat.yaml 已更新！")

if __name__ == "__main__":
    main()
