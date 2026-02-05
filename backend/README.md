# GraphInsight Backend

多模态知识图谱可视化平台后端服务

## 技术栈

- **FastAPI**: 现代 Python Web 框架
- **Neo4j**: 图数据库
- **Pydantic**: 数据验证
- **Uvicorn**: ASGI 服务器

## 快速开始

### 1. 安装 Neo4j

使用 Docker 启动 Neo4j（推荐）：

```bash
docker run -d \
  --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password \
  neo4j:5.14
```

或者下载并安装 Neo4j Desktop：https://neo4j.com/download/

### 2. 安装 Python 依赖

```bash
# 创建虚拟环境
python -m venv venv

# 激活虚拟环境
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

### 3. 配置环境变量

```bash
# 复制环境变量配置
cp .env.example .env

# 编辑 .env 文件，配置 Neo4j 连接信息
# 默认配置：
# NEO4J_URI=bolt://localhost:7687
# NEO4J_USER=neo4j
# NEO4J_PASSWORD=password
```

### 4. 初始化测试数据

```bash
python init_test_data.py
```

这将创建以下测试数据：
- 4 个作物节点（水稻、小麦、玉米、番茄）
- 3 个病害节点（稻瘟病、小麦锈病、番茄晚疫病）
- 2 个虫害节点（玉米螟、蚜虫）
- 2 个技术节点（综合防治技术、滴灌技术）
- 2 个肥料节点（复合肥、有机肥）
- 以及它们之间的关系

### 5. 启动后端服务

```bash
# 方式 1: 使用启动脚本（Windows）
start.bat

# 方式 2: 直接运行
python main.py

# 方式 3: 使用 uvicorn
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

服务启动后，访问：
- API 根路径: http://localhost:8000
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### 6. 测试 API

```bash
python test_api.py
```

## API 端点

### 1. 健康检查

```bash
GET /health
```

### 2. 执行 Cypher 查询

```bash
POST /api/query
Content-Type: application/json

{
  "cypher": "MATCH (n:Crop) RETURN n LIMIT 10",
  "parameters": {}
}
```

### 3. 获取节点详情

```bash
GET /api/node/{node_id}
```

### 4. 展开节点（获取邻居）

```bash
POST /api/expand
Content-Type: application/json

{
  "nodeId": "123",
  "direction": "out",
  "relationshipTypes": ["AFFECTED_BY"],
  "limit": 20
}
```

### 5. 获取媒体文件

```bash
GET /api/media/{filename}
```

## 示例查询

### 查询所有作物

```cypher
MATCH (n:Crop) RETURN n LIMIT 10
```

### 查询作物及其病害

```cypher
MATCH (c:Crop)-[r:AFFECTED_BY]->(d:Disease)
RETURN c, r, d LIMIT 50
```

### 查询防治技术

```cypher
MATCH (t:Technology)-[r:PREVENTS]->(d)
RETURN t, r, d
```

### 查询完整的知识图谱

```cypher
MATCH (n)-[r]->(m)
RETURN n, r, m
LIMIT 100
```

## 项目结构

```
backend/
├── main.py                      # 应用入口
├── config.py                    # 配置管理
├── init_test_data.py           # 测试数据初始化脚本
├── test_api.py                 # API 测试脚本
├── start.bat                   # Windows 启动脚本
├── requirements.txt            # Python 依赖
├── .env                        # 环境变量配置
├── api/
│   └── routes/
│       ├── query.py            # 查询端点
│       ├── node.py             # 节点详情端点
│       └── expand.py           # 节点展开端点
├── services/
│   ├── neo4j_service.py        # Neo4j 服务
│   └── media_service.py        # 媒体服务
├── models/
│   └── graph.py                # 数据模型
├── utils/
│   └── neo4j_parser.py         # Neo4j 解析器
└── media/                      # 多媒体文件存储
    └── README.md
```

## 开发指南

### 添加新的 API 端点

1. 在 `api/routes/` 目录下创建新的路由文件
2. 在 `main.py` 中注册路由
3. 在 `models/` 中定义数据模型
4. 在 `services/` 中实现业务逻辑

### 添加新的节点类型

1. 在 Neo4j 中创建新的节点标签
2. 更新前端的颜色映射配置
3. 更新数据模型（如需要）

## 故障排除

### Neo4j 连接失败

- 检查 Neo4j 是否正在运行
- 验证 `.env` 文件中的连接信息
- 检查防火墙设置

### CORS 错误

- 确保前端 URL 在 `main.py` 的 CORS 配置中
- 检查前端的 API 基础 URL 配置

### 媒体文件 404

- 确保媒体文件存在于 `backend/media/` 目录
- 检查文件名是否正确
- 检查文件权限

## 性能优化

- 使用连接池（已配置）
- 添加查询结果缓存
- 限制查询结果数量
- 使用索引优化查询

## 安全建议

- 使用只读用户执行查询
- 实现查询白名单
- 添加速率限制
- 使用 HTTPS（生产环境）
- 实现身份验证和授权

## 参考资料

- [FastAPI 文档](https://fastapi.tiangolo.com/)
- [Neo4j Python 驱动](https://neo4j.com/docs/python-manual/current/)
- [Cypher 查询语言](https://neo4j.com/docs/cypher-manual/current/)
