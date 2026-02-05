# GraphInsight Frontend

多模态知识图谱可视化平台前端应用

## 技术栈

- **React 18**: UI 框架
- **TypeScript**: 类型安全
- **Vite**: 构建工具
- **Material UI**: UI 组件库
- **Cytoscape.js**: 图谱可视化
- **Zustand**: 状态管理
- **Monaco Editor**: 代码编辑器

## 安装

```bash
# 安装依赖
npm install
```

## 运行

```bash
# 开发模式
npm run dev

# 构建生产版本
npm run build

# 预览生产版本
npm run preview
```

## 项目结构

```
frontend/
├── src/
│   ├── components/      # React 组件
│   │   ├── Layout/      # 布局组件
│   │   ├── QueryPanel/  # 查询面板
│   │   ├── GraphCanvas/ # 图谱画布
│   │   ├── DetailPanel/ # 详情面板
│   │   ├── FilterPanel/ # 过滤面板
│   │   └── ExportDialog/# 导出对话框
│   ├── hooks/           # 自定义 Hooks
│   ├── store/           # Zustand 状态管理
│   ├── services/        # API 服务
│   ├── types/           # TypeScript 类型定义
│   ├── utils/           # 工具函数
│   ├── theme/           # MUI 主题配置
│   ├── App.tsx          # 根组件
│   └── main.tsx         # 入口文件
└── public/              # 静态资源
```

## 开发

访问 http://localhost:5173 查看应用
