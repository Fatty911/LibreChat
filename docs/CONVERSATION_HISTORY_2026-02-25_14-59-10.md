# 对话历史

**日期**: 2026-02-25

---

## 1. 修复 update_models.py 语法错误

- 问题：脚本有多处语法错误（第34行、第76行、第124行缺少换行符）
- 修复：添加了必要的换行符

## 2. 修复 sync-upstream.yml

- 问题：workflow 会创建 PR，不符合自动同步的需求
- 修复：移除 PR 创建步骤，直接 merge 后 push 到 main

## 3. 爬取 lmarena.ai 排行榜

- 原 API 端点错误：`arena.ai` → 正确的 `lmarena.ai`
- 使用 HTML 解析代替失效的 API：`https://lmarena.ai/leaderboard/text`
- 添加了完整的 HTML 解析逻辑、机构前缀处理、模型去重等

## 4. model_mapping.json 更新

- 初始创建 mapping 文件
- 问题：arena 返回的模型名包含机构前缀（如 "Anthropic claude-opus-4-6"）
- 修复：更新 mapping 匹配实际格式

## 5. 模型映射调整

用户要求：
- 保留最新一代模型（GPT-5.2/5.3, Claude-4.6）
- 区分不同模型代际：
  - `gpt-5.2-chat-latest` → `gpt-5-2`
  - `gpt-5.2-high` → `gpt-5-2-pro`
  - `gpt-5.2` → `gpt-5-2`
  - `gpt-5.1-high` → `gpt-5-1-high`
  - `gpt-5.1` → `gpt-5-1`
  - `gpt-4.5-preview` → `gpt-4-5-preview`
  - `chatgpt-4o-latest` → `chatgpt-4o-latest`

## 6. librechat.yaml 格式修复

- 修复第9行缺少换行符的问题
- 修复第24行缩进问题

---

## 相关文件

- `scripts/update_models.py` - 爬取排行榜并更新模型列表
- `scripts/model_mapping.json` - arena 模型名到 LibreChat model_id 的映射
- `.github/workflows/sync-upstream.yml` - 自动同步上游
- `librechat.yaml` - LibreChat 配置文件
