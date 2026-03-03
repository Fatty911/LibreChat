# 端点可用性验证功能

## 功能说明

在Zeabur部署LibreChat时，可以在启动时自动验证配置的模型端点是否可用。不可用的端点将自动从配置中移除，不会在前端显示。

## 工作原理

1. 启动时读取 `librechat.yaml` 中的自定义端点配置
2. 对每个端点发送 GET `/models` 请求验证可用性
3. 验证成功（HTTP 200-299）的端点保留
4. 验证失败的端点自动移除，不会在LibreChat中显示

## 环境变量配置

在Zeabur环境变量中添加：

```bash
# 启用端点验证（必需）
VALIDATE_ENDPOINTS=true

# 验证超时时间（可选，默认5000毫秒）
ENDPOINT_VALIDATION_TIMEOUT=5000
```

## 验证逻辑

### 成功条件
- HTTP 状态码 200-299
- 或 API Key 为 `user_provided`（跳过验证）

### 失败条件
- HTTP 401/403（认证失败）
- 连接超时/拒绝
- HTTP 500+（服务器错误）
- 其他网络错误

## 日志输出

启用验证后，启动日志会显示：

```
[INFO] Validating custom endpoints...
[INFO] [GLM] Validating endpoint: https://api.us-west-2.modal.direct/v1/models
[INFO] [GLM] Validation successful
[WARN] [OpenRouter] Authentication failed (401)
[WARN] Endpoint "OpenRouter" failed validation: Authentication failed: 401. Removing from config.
[INFO] Validated 8/9 custom endpoints
```

## 示例配置

### librechat.yaml

```yaml
version: 1.2.1
cache: true

endpoints:
  custom:
    - name: "GLM"
      apiKey: "${MODAL_API_KEY}"
      baseURL: "https://api.us-west-2.modal.direct/v1"
      models:
        default:
          - "zai-org/GLM-5-FP8"
        fetch: false
      
    - name: "DeepSeek"
      apiKey: "${DEEPSEEK_API_KEY}"
      baseURL: "https://api.deepseek.com"
      models:
        default:
          - "deepseek-chat"
        fetch: false
```

### Zeabur环境变量

```bash
# 验证开关
VALIDATE_ENDPOINTS=true
ENDPOINT_VALIDATION_TIMEOUT=5000

# API Keys
MODAL_API_KEY=your_modal_key
DEEPSEEK_API_KEY=your_deepseek_key
OPENROUTER_API_KEY=invalid_key  # 这个会验证失败并被移除
```

## 注意事项

1. **user_provided 跳过验证**：如果 API Key 设置为 `user_provided`，验证会自动跳过（用户在前端提供密钥）

2. **并行验证**：所有端点并行验证，不会阻塞启动流程

3. **失败不中断**：即使所有端点验证失败，应用仍会正常启动（只是没有自定义端点）

4. **验证端点**：默认请求 `{baseURL}/models`，适用于OpenAI兼容API

5. **超时设置**：建议设置 5-10 秒超时，避免启动时间过长

## 禁用验证

如果不需要验证功能，只需：

```bash
# 不设置 VALIDATE_ENDPOINTS 或设置为 false
VALIDATE_ENDPOINTS=false
```

或直接删除该环境变量，所有配置的端点都会显示。

## 故障排查

### 端点被错误移除

检查日志中的错误信息：
- 401/403：检查 API Key 是否正确
- 连接超时：检查 baseURL 是否正确，网络是否可达
- 增加 `ENDPOINT_VALIDATION_TIMEOUT` 值

### 验证不生效

确认：
1. `VALIDATE_ENDPOINTS=true` 已设置
2. 端点配置在 `endpoints.custom` 下
3. 查看启动日志是否有 "Validating custom endpoints..." 信息
