# 图神经网络集成方案

## 技术选型

### 推荐框架
1. **PyTorch Geometric (PyG)** - 最流行的图神经网络库
2. **DGL (Deep Graph Library)** - 灵活且高效
3. **Stellargraph** - 易用，适合快速原型

**推荐使用 PyTorch Geometric**，因为：
- 社区活跃，文档完善
- 支持多种 GNN 模型（GCN, GAT, GraphSAGE 等）
- 与 Neo4j 集成方便
- 性能优秀

## 架构设计

### 新增模块结构

```
backend/
├── gnn/                          # 新增 GNN 模块
│   ├── __init__.py
│   ├── models/                   # GNN 模型定义
│   │   ├── __init__.py
│   │   ├── gcn.py               # Graph Convolutional Network
│   │   ├── gat.py               # Graph Attention Network
│   │   ├── graphsage.py         # GraphSAGE
│   │   └── base.py              # 基础模型类
│   ├── data/                     # 数据处理
│   │   ├── __init__.py
│   │   ├── neo4j_loader.py      # 从 Neo4j 加载数据
│   │   ├── preprocessor.py      # 数据预处理
│   │   └── graph_builder.py     # 构建 PyG 图对象
│   ├── training/                 # 训练相关
│   │   ├── __init__.py
│   │   ├── trainer.py           # 训练器
│   │   └── evaluator.py         # 评估器
│   ├── inference/                # 推理服务
│   │   ├── __init__.py
│   │   ├── predictor.py         # 预测器
│   │   └── embedder.py          # 嵌入生成器
│   └── utils/                    # 工具函数
│       ├── __init__.py
│       ├── metrics.py           # 评估指标
│       └── visualization.py     # 可视化工具
│
├── api/routes/
│   └── gnn.py                    # 新增 GNN API 路由
│
└── services/
    └── gnn_service.py            # GNN 服务层
```

## 功能实现

### 1. 节点嵌入（Node Embedding）

**用途**: 将节点转换为向量，用于相似度计算和推荐

**API 端点**:
```python
POST /api/gnn/embed
{
  "node_ids": ["node1", "node2"],
  "model": "graphsage"  # 可选: gcn, gat, graphsage
}

Response:
{
  "embeddings": {
    "node1": [0.1, 0.2, ..., 0.5],  # 128维向量
    "node2": [0.3, 0.1, ..., 0.7]
  }
}
```

**前端集成**:
- 在节点详情面板显示相似节点
- 基于嵌入的节点搜索
- 可视化节点在嵌入空间的分布（t-SNE/UMAP）

### 2. 链接预测（Link Prediction）

**用途**: 预测节点之间可能存在的关系

**API 端点**:
```python
POST /api/gnn/predict-links
{
  "source_node": "node1",
  "top_k": 10,
  "relationship_type": "RELATED_TO"  # 可选
}

Response:
{
  "predictions": [
    {
      "target_node": "node2",
      "score": 0.95,
      "relationship_type": "RELATED_TO"
    }
  ]
}
```

**前端集成**:
- 在节点详情面板显示"可能的关系"
- 可视化预测的链接（虚线显示）
- 提供"添加关系"按钮

### 3. 节点分类（Node Classification）

**用途**: 预测节点的类型或属性

**API 端点**:
```python
POST /api/gnn/classify-node
{
  "node_id": "node1",
  "property": "category"  # 要预测的属性
}

Response:
{
  "predictions": [
    {"label": "作物", "confidence": 0.85},
    {"label": "病害", "confidence": 0.12}
  ]
}
```

### 4. 社区检测增强（Community Detection）

**用途**: 使用 GNN 改进社区发现

**API 端点**:
```python
POST /api/gnn/detect-communities
{
  "algorithm": "gnn",  # 或 "louvain", "label_propagation"
  "num_communities": 5  # 可选
}

Response:
{
  "communities": [
    {
      "id": "community_1",
      "nodes": ["node1", "node2"],
      "quality_score": 0.78
    }
  ]
}
```

### 5. 知识推理（Knowledge Reasoning）

**用途**: 基于图结构推理新知识

**API 端点**:
```python
POST /api/gnn/reason
{
  "query": "哪些作物可能受到相似病害影响？",
  "context_nodes": ["水稻", "小麦"]
}

Response:
{
  "reasoning_results": [
    {
      "conclusion": "玉米可能也受到类似病害影响",
      "confidence": 0.82,
      "evidence": ["共享相似的生长环境", "历史病害数据相似"]
    }
  ]
}
```

## 实现步骤

### Phase 1: 基础设施（1-2周）

1. **环境配置**
   ```bash
   # 安装依赖
   pip install torch torch-geometric
   pip install torch-scatter torch-sparse -f https://data.pyg.org/whl/torch-2.0.0+cpu.html
   ```

2. **数据加载器**
   - 从 Neo4j 提取图数据
   - 转换为 PyG 格式
   - 特征工程（节点特征、边特征）

3. **基础模型**
   - 实现 GCN 模型
   - 训练管道
   - 模型保存/加载

### Phase 2: 核心功能（2-3周）

1. **节点嵌入服务**
   - 训练嵌入模型
   - 实现推理 API
   - 缓存机制

2. **链接预测**
   - 训练链接预测模型
   - 实现预测 API
   - 评估指标

3. **前端集成**
   - 新增 GNN 功能面板
   - 可视化嵌入空间
   - 交互式预测

### Phase 3: 高级功能（2-3周）

1. **多模型支持**
   - GAT, GraphSAGE
   - 模型选择 UI

2. **在线学习**
   - 增量训练
   - 模型更新机制

3. **性能优化**
   - 批处理
   - GPU 加速
   - 模型压缩

## 前端集成点

### 1. 新增"智能分析"面板

```typescript
// frontend/src/components/GNNPanel/GNNPanel.tsx
interface GNNPanelProps {
  selectedNode?: string;
}

const GNNPanel: React.FC<GNNPanelProps> = ({ selectedNode }) => {
  return (
    <Box>
      <Tabs>
        <Tab label="节点嵌入" />
        <Tab label="链接预测" />
        <Tab label="相似节点" />
        <Tab label="知识推理" />
      </Tabs>
      
      {/* 各个功能的实现 */}
    </Box>
  );
};
```

### 2. 增强现有功能

**节点详情面板**:
- 添加"相似节点"部分
- 显示预测的关系
- 节点分类置信度

**图谱画布**:
- 可视化预测的链接（虚线）
- 基于嵌入的节点布局
- 社区检测结果高亮

**查询面板**:
- 添加"智能查询"选项
- 自然语言转 Cypher（结合 GNN）

## 数据需求

### 训练数据

1. **节点特征**
   - 节点属性（文本、数值）
   - 节点类型
   - 节点度数

2. **边特征**
   - 关系类型
   - 关系权重
   - 时间戳

3. **标签数据**
   - 节点分类标签
   - 已知的链接
   - 社区标签

### 数据准备脚本

```python
# backend/gnn/data/prepare_training_data.py
from neo4j import GraphDatabase
import torch
from torch_geometric.data import Data

def extract_graph_from_neo4j():
    """从 Neo4j 提取图数据"""
    driver = GraphDatabase.driver(uri, auth=(user, password))
    
    with driver.session() as session:
        # 获取所有节点
        nodes = session.run("MATCH (n) RETURN id(n), labels(n), properties(n)")
        
        # 获取所有边
        edges = session.run("MATCH (a)-[r]->(b) RETURN id(a), id(b), type(r)")
        
    # 转换为 PyG 格式
    data = Data(
        x=node_features,      # [num_nodes, num_features]
        edge_index=edge_index, # [2, num_edges]
        y=labels              # [num_nodes]
    )
    
    return data
```

## 性能考虑

### 1. 模型大小
- 小型图（< 10K 节点）: 实时推理
- 中型图（10K-100K 节点）: 批处理 + 缓存
- 大型图（> 100K 节点）: 采样 + 分布式训练

### 2. 推理延迟
- 嵌入查询: < 100ms
- 链接预测: < 500ms
- 社区检测: < 2s

### 3. 缓存策略
- 节点嵌入缓存（Redis）
- 预测结果缓存
- 模型缓存

## 评估指标

### 节点分类
- Accuracy
- F1-Score
- Confusion Matrix

### 链接预测
- AUC-ROC
- Precision@K
- Recall@K

### 社区检测
- Modularity
- NMI (Normalized Mutual Information)
- Silhouette Score

## 部署方案

### 开发环境
```bash
# 本地训练和测试
python backend/gnn/training/train.py --model gcn --epochs 100
```

### 生产环境
```yaml
# docker-compose.yml
services:
  gnn-service:
    build: ./backend/gnn
    ports:
      - "8002:8002"
    volumes:
      - ./models:/models
    environment:
      - MODEL_PATH=/models/gcn_model.pt
      - DEVICE=cuda  # 或 cpu
```

## 示例代码

### 1. 简单的 GCN 模型

```python
# backend/gnn/models/gcn.py
import torch
import torch.nn.functional as F
from torch_geometric.nn import GCNConv

class GCN(torch.nn.Module):
    def __init__(self, num_features, hidden_channels, num_classes):
        super().__init__()
        self.conv1 = GCNConv(num_features, hidden_channels)
        self.conv2 = GCNConv(hidden_channels, num_classes)

    def forward(self, x, edge_index):
        x = self.conv1(x, edge_index)
        x = F.relu(x)
        x = F.dropout(x, p=0.5, training=self.training)
        x = self.conv2(x, edge_index)
        return x
    
    def get_embeddings(self, x, edge_index):
        """获取节点嵌入"""
        x = self.conv1(x, edge_index)
        x = F.relu(x)
        return x
```

### 2. API 路由

```python
# backend/api/routes/gnn.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.gnn_service import GNNService

router = APIRouter(prefix="/api/gnn", tags=["gnn"])
gnn_service = GNNService()

class EmbedRequest(BaseModel):
    node_ids: list[str]
    model: str = "gcn"

@router.post("/embed")
async def get_embeddings(request: EmbedRequest):
    """获取节点嵌入"""
    try:
        embeddings = await gnn_service.get_embeddings(
            node_ids=request.node_ids,
            model=request.model
        )
        return {"embeddings": embeddings}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/predict-links")
async def predict_links(source_node: str, top_k: int = 10):
    """预测链接"""
    predictions = await gnn_service.predict_links(source_node, top_k)
    return {"predictions": predictions}
```

### 3. 前端服务

```typescript
// frontend/src/services/gnnService.ts
import api from './api';

export interface NodeEmbedding {
  [nodeId: string]: number[];
}

export interface LinkPrediction {
  target_node: string;
  score: number;
  relationship_type: string;
}

export const gnnService = {
  async getEmbeddings(nodeIds: string[], model: string = 'gcn'): Promise<NodeEmbedding> {
    const response = await api.post('/gnn/embed', { node_ids: nodeIds, model });
    return response.data.embeddings;
  },

  async predictLinks(sourceNode: string, topK: number = 10): Promise<LinkPrediction[]> {
    const response = await api.post('/gnn/predict-links', { 
      source_node: sourceNode, 
      top_k: topK 
    });
    return response.data.predictions;
  },

  async findSimilarNodes(nodeId: string, topK: number = 5): Promise<string[]> {
    const response = await api.post('/gnn/similar-nodes', { 
      node_id: nodeId, 
      top_k: topK 
    });
    return response.data.similar_nodes;
  }
};
```

## 总结

图神经网络的集成将显著增强 GraphInsight 的智能分析能力：

1. **节点嵌入** → 相似度计算、推荐系统
2. **链接预测** → 知识补全、关系发现
3. **节点分类** → 自动标注、数据清洗
4. **社区检测** → 更准确的聚类分析
5. **知识推理** → 智能问答、决策支持


