# GraphInsight Frontend

GraphInsight 前端应用。当前执行口径下，前端默认把 Go 网关作为唯一外部 API 入口。

## 本地环境

前端必须通过 `nvm` 使用项目约定的 Node 版本。

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install
nvm use
node -v
npm -v
```

当前期望版本：

```text
node v22.22.2
npm 10.x
```

## 启动顺序

本地联调建议按下面顺序启动：

1. 启动 Python 能力层：`http://127.0.0.1:8001`
2. 启动 Go 外部网关：`http://127.0.0.1:8081`
3. 启动前端开发服务：`http://127.0.0.1:5173`

说明：

1. Python 仍负责文档解析、问答、抽取等 AI 能力。
2. 前端默认不直接把 Python 当公共 API 入口。
3. 前端通过开发代理或反向代理优先访问 Go。

## 环境变量

`frontend/.env.example` 默认使用：

```text
VITE_API_BASE_URL=same-origin
```

含义：

1. 浏览器环境优先使用当前页面域名。
2. Vite 开发模式下，`/api` 会默认代理到 `http://localhost:8081`。
3. 如果需要临时绕过 Go 调试，可手动把 `VITE_API_BASE_URL` 改成显式地址。

## 常用命令

```bash
npm install
npm run dev
npm run build
npm run lint
```

## 目录结构

```bash
frontend/
├── src/
│   ├── components/
│   ├── hooks/
│   ├── pages/
│   ├── services/
│   ├── store/
│   ├── theme/
│   ├── types/
│   └── utils/
├── tests/
├── playwright.config.ts
└── public/
```

## 验证

访问 `http://localhost:5173` 后，默认应满足：

1. 浏览器请求 `/api/*` 时先进入 Go 网关。
2. 管理后台和业务页面共用统一 `API_BASE_URL` 解析逻辑。
3. 不改本地 `.env` 时，不会默认直连 Python `8001`。

## E2E 运行建议

前端 E2E 推荐说明见：

1. [FRONTEND_E2E_RUNTIME_GUIDE.md](/mnt/c/Users/AxTlz/projects/GraphInsight/docs/FRONTEND_E2E_RUNTIME_GUIDE.md)

当前建议：

1. 前端测试进程尽量与 Go / Python 运行在同一侧
2. 优先使用 `./frontend/tests/run_admin_e2e.sh`
3. 避免长期依赖 `WSL 前端 -> Windows Go` 这种跨环境代理方式
4. 若前端与 Go / Python 同在 Windows 侧，优先使用 `frontend/tests/run_admin_e2e.ps1`
