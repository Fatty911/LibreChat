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

# --- 配置 ---
TOP_N = 30
ARENA_API_URL = "https://arena.ai/api/v1/leaderboard"
# 备用：HuggingFace 上的排行榜数据
HF_FALLBACK_URL = "https://huggingface.co/api/spaces/lmarena-ai/chatbot-arena-leaderboard"
MAPPING_FILE = Path(__file__).parent / "model_mapping.json"
YAML_FILE = Path(__file__).parent.parent / "librechat.yaml"

def fetch_leaderboard() -> list[str]:
    """获取排行榜前 TOP_N 名的模型名称列表"""
    #尝试直接从 lmarena.ai API 获取
    try:
        resp = requests.get(ARENA_API_URL, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        # API 返回格式可能是 [{"rank": 1, "model": "GPT-5.2 Pro", ...}, ...]
        # 根据实际返回结构调整解析逻辑
        if isinstance(data, list):
            models = [item.get("model") or item.get("name", "") for item in data[:TOP_N]]
            return [m for m in models if m]except Exception as e:
        print(f"[WARN] lmarena.ai API 请求失败: {e}，尝试备用方案...")

    # 备用：爬取网页
    try:
        resp = requests.get("https://lmarena.ai/leaderboard", timeout=30)
        resp.raise_for_status()
        #尝试从页面中提取 JSON数据（通常嵌在 script 标签或 __NEXT_DATA__ 中）
        match = re.search(r'__NEXT_DATA__.*?({.*?})\s*</script>', resp.text, re.DOTALL)
        if match:
            page_data = json.loads(match.group(1))
            # 根据实际页面结构解析，这里是示意
            # 你可能需要根据实际 HTML 结构调整
            print("[WARN] 网页解析需要根据实际结构调整，请检查输出")# 最简单的备用：用正则提取排行榜中的模型名
        # 这很脆弱，但作为 fallback 可以接受
        model_pattern = re.findall(r'"model_name":\s*"([^"]+)"', resp.text)
        if model_pattern:
            return model_pattern[:TOP_N]
    except Exception as e:
        print(f"[ERROR] 备用方案也失败: {e}")

    return []

def load_mapping() -> dict:
    with open(MAPPING_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    # 过滤掉注释字段
    return {k: v for k, v in data.items() if not k.startswith("_")}

def update_yaml(provider_models: dict[str, list[str]]):
    """更新 librechat.yaml 中各端点的模型列表"""
    with open(YAML_FILE, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    endpoints = config.get("endpoints", {})

    # 更新内置端点（openAI, anthropic）
    for builtin in ["openAI", "anthropic"]:
        if builtin in endpoints and builtin in provider_models:
            models = provider_models[builtin]
            if models:
                endpoints[builtin]["models"]["default"] = models# titleModel 用列表中最后一个（通常是较轻量的）
                if len(models) > 1:
                    endpoints[builtin]["titleModel"] = models[-1]

    # 更新自定义端点（Google, xAI等）
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
    print(f"正在获取 lmarena.ai 排行榜前 {TOP_N} 名...")
    arena_models = fetch_leaderboard()

    if not arena_models:
        print("[ERROR] 无法获取排行榜数据，跳过更新")
        sys.exit(1)

    print(f"获取到 {len(arena_models)} 个模型:")
    for i, m in enumerate(arena_models, 1):
        print(f"  {i}. {m}")

    mapping = load_mapping()

    # 按provider 分组：只保留在排行榜前 N 名中且有映射的模型
    provider_models: dict[str, list[str]] = {}
    matched = 0
    for arena_name in arena_models:
        if arena_name in mapping:
            info = mapping[arena_name]
            provider = info["provider"]
            model_id = info["model_id"]
            provider_models.setdefault(provider, []).append(model_id)
            matched += 1

    print(f"\n匹配到 {matched} 个模型（有映射关系的）:")
    for provider, models in provider_models.items():
        print(f"  {provider}: {models}")

    if matched == 0:
        print("[WARN] 没有匹配到任何模型，可能需要更新 model_mapping.json")sys.exit(0)

    # 读取当前 yaml 中的模型列表，对比是否有变化
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
