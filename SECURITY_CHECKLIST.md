# 上传前安全检查清单

## ✅ 已完成的安全措施

### 1. .gitignore 配置
- [x] .env 文件已被忽略
- [x] 数据库文件已被忽略
- [x] 日志文件已被忽略
- [x] node_modules 已被忽略
- [x] venv 已被忽略

### 2. 敏感信息检查
- [x] backend/.env - 包含真实密码，已被 .gitignore 忽略
- [x] backend/science/.env - 已被 .gitignore 忽略
- [x] frontend/.env - 已被 .gitignore 忽略
- [x] backend/.env.example - 仅包含示例值，安全
- [x] frontend/.env.example - 仅包含示例值，安全

### 3. 代码中的敏感信息
- [x] 无硬编码的真实密码
- [x] 无硬编码的 API Key
- [x] 使用环境变量管理敏感配置

## ⚠️ 重要提醒

### 已暴露的信息（需要更改）：
1. **PostgreSQL 数据库**
   - 地址: 182.92.111.65:5432
   - 用户: mkg
   - 密码: rdT4fXaRnJNJBC2s
   - **建议：上传后立即更改数据库密码**

2. **Secret Key**
   - 当前: xK7mP9nQ2wR5tY8uI1oL4aS6dF3gH0jK9mN2bV5cX8z
   - **建议：上传后立即更改 Secret Key**

3. **Neo4j Aura 密码（已注释）**
   - 虽然已注释，但仍在 .env 文件中
   - **已被 .gitignore 保护，不会上传**

## 📋 上传后必做事项

1. [ ] 更改 PostgreSQL 数据库密码
2. [ ] 更改 ADMIN_SECRET_KEY
3. [ ] 检查 GitHub 仓库的 .env 文件是否真的没有被上传
4. [ ] 在 GitHub 仓库设置中添加 Secrets（用于 CI/CD）

## 🔐 如何更改密码

### 更改数据库密码：
```bash
# 连接到 PostgreSQL
psql -h 182.92.111.65 -U mkg -d mkg

# 更改密码
ALTER USER mkg WITH PASSWORD 'new_secure_password';
```

### 更改 Secret Key：
```python
# 生成新的 Secret Key
import secrets
print(secrets.token_urlsafe(32))
```

然后更新 backend/.env 中的 ADMIN_SECRET_KEY
