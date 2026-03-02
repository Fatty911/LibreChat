# 对话历史 - 2026-03-02 12:42:25

## 问题描述
用户遇到 GitHub Actions 推送代码时报错：
```
! [remote rejected] main -> main (refusing to allow a GitHub App to create or update workflow `.github/workflows/backend-review.yml` without `workflows` permission)
error: failed to push some refs to https://github.com/Fatty911/LibreChat
```

## 原因分析
GitHub Actions 中使用 GitHub App 认证推送代码时，该 App 缺少 `workflows` 权限，无法修改 workflow 文件。

## 解决方案
1. 修改 `.github/workflows/sync-upstream.yml`，添加 `workflows: write` 权限
2. 在 GitHub 仓库设置中确保 Workflow permissions 设为 "Read and write"

## 代码修改
- 文件：`.github/workflows/sync-upstream.yml`
- 修改：添加 `workflows: write` 到 permissions

## 后续操作
- 同步本地与远程仓库
- 确认无冲突
- 提交并推送到 fork 仓库

## 总结
成功解决 GitHub App 缺少 workflows 权限的问题，代码已推送到远程仓库。
