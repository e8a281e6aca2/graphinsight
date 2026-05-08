
## 🚀 项目简介

**GraphInsight** 是一个强大且直观的知识图谱可视化工具，旨在帮助用户深入理解和探索复杂互联的数据。我们致力于将抽象的图数据转化为具象的视觉呈现，从而揭示数据中隐藏的模式、关系和深层洞察。

本项目特别关注：
* **农业知识图谱**：为农业领域提供专业的知识可视化解决方案，助力农业数据分析与决策。
* **多模态大模型**：探索与多模态大模型结合的可能性，实现更智能、更丰富的知识表达。
* **图神经网络**：通过图神经网络技术，增强图数据的分析能力和可视化效果。

## ✨ 主要特性

* **直观的图谱可视化**：支持多种布局算法，清晰展现复杂的实体和关系网络。
* **交互式探索**：用户可轻松进行节点的展开/收缩、拖拽、缩放，以及关系路径的探索。
* **高级过滤与筛选**：支持按节点类型、关系类型和属性值进行灵活过滤，聚焦关键信息。
* **深度洞察挖掘**：通过路径查找、社群发现等功能，帮助用户从图谱中发现深层规律和潜在价值。
* **自定义配置**：提供灵活的配置选项，满足不同行业和数据的可视化需求。

## 当前开发入口

当前项目执行口径为：

1. Go 负责默认外部 API 入口与业务编排
2. Python 负责 AI 能力、文档解析与模型相关执行

本地联调默认地址：

1. Go 网关：`http://127.0.0.1:8081`
2. Python 能力层：`http://127.0.0.1:8001`
3. 前端开发服务：`http://127.0.0.1:5173`

建议启动顺序：

1. 先启动 Python `8001`
2. 再启动 Go `8081`
3. 最后启动前端 `5173`

说明：

1. 前端默认应通过 Go 访问 `/api/*`
2. Python 不再作为默认公共入口使用
3. 管理后台与业务链路会逐步继续向 Go 收口

## 开发环境模式

当前建议把开发环境分成两种模式理解：

1. 本机混合模式：Python / Go / 前端跑宿主机，Neo4j 可用 Desktop 或 Docker
2. Docker 联调模式：Neo4j 跑 Docker，Python / Go / 前端仍跑宿主机

说明：

1. 当前仓库已提供面向开发联调的 `docker-compose.dev.yml`，用于启动 Neo4j
2. 当前仓库内还没有现成的全栈 `docker-compose.yml`
3. 所以现在的 Docker 模式不是“前后端全容器化”
4. 详细说明见 [docs/DEVELOPMENT_ENVIRONMENT_MODES.md](/mnt/c/Users/AxTlz/projects/GraphInsight/docs/DEVELOPMENT_ENVIRONMENT_MODES.md)
5. Neo4j 实例切换能力说明见 [docs/NEO4J_RUNTIME_SWITCHING.md](/mnt/c/Users/AxTlz/projects/GraphInsight/docs/NEO4J_RUNTIME_SWITCHING.md)
6. Go/Python 后端迁移当前完成度见 [docs/GO_PYTHON_MIGRATION_STATUS.md](/mnt/c/Users/AxTlz/projects/GraphInsight/docs/GO_PYTHON_MIGRATION_STATUS.md)
7. 开发期与交付期运行策略见 [docs/DELIVERY_RUNTIME_STRATEGY.md](/mnt/c/Users/AxTlz/projects/GraphInsight/docs/DELIVERY_RUNTIME_STRATEGY.md)
8. 前端 E2E 推荐运行方式见 [docs/FRONTEND_E2E_RUNTIME_GUIDE.md](/mnt/c/Users/AxTlz/projects/GraphInsight/docs/FRONTEND_E2E_RUNTIME_GUIDE.md)

---


## 🤝 贡献指南

我们欢迎所有形式的贡献！如果您有任何 Bug 报告、功能建议或代码贡献，请随时提交 Issue 或 Pull Request。

---

## 📜 License

本项目采用 [GNU General Public License v3.0 (GPLv3)](LICENSE) 开源。这意味着您可以自由地使用、修改和分发本项目代码。**任何基于本项目修改或分发的作品，也必须以相同的 GPLv3 许可证开源。**

---



## 📞 联系方式

* **GitHub**: [@BinaryResearcher](https://github.com/BinaryResearcher)
* **邮箱**: yh@qs.al

---
