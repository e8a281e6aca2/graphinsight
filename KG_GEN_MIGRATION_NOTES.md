# kg-gen 渲染迁移分析（只读支持）

> 说明：本文件用于后续会话继续实现渲染器替换。当前内容为分析与迁移清单，不包含任何代码改动。

## 1. kg-gen 渲染流程拆解（template.html）

### 核心状态
- `state`: activeElement / focusCluster / focusPredicate / searchTerm / sidebar 状态
- `nodes`, `edges`: 基于输入数据浅拷贝
- `transform`: d3 zoom transform（x/y/k）
- `simulation`: d3-force

### 渲染主流程
- `createNetwork()`
  - 获取 canvas 与 ctx
  - 设置 DPR 画布尺寸
  - 初始化 `transform = d3.zoomIdentity`
  - 复制 nodes/edges
  - 绑定 d3-force：
    - `forceLink(...).distance(120).strength(0.3)`
    - `forceManyBody().strength(-280)`
    - `forceCenter(width/2, height/2)`
    - `forceCollide().radius(d => d.radius + 12)`
  - 绑定 d3 zoom（0.25~3）并在 `zoom` 回调中 `render()`
  - 初始化 zoom 到 0.5
  - 注册交互事件（mousedown/move/up/click/contextmenu）
  - `simulation.on('tick', ...)` 仅拖拽时 render
  - 监听 resize
  - 初次 `render()`

### 命中测试
- `findNode(x,y)`: 逆序查，命中圆
- `findEdge(x,y)`: 线段投影 + 距离阈值（<5px）

### 交互
- 左键拖拽节点：mousemove 超过阈值才开始拖
- 左键点击：
  - 命中 node → setActiveElement(node)
  - 命中 edge → setActiveElement(edge)
  - 背景 → clearActiveElement()
- 右键菜单被阻止（`contextmenu` preventDefault）

### 高亮/过滤
- `updateHighlights()`：
  - activeElement：高亮自身+邻居/边
  - focusCluster：高亮 cluster 内部
  - focusPredicate：高亮关系类型
  - searchTerm：高亮匹配节点/边
- 通过 `highlightedNodes/Edges` + `isFiltering` 控制渲染透明度

### 渲染细节
- 先画边，再画节点
- 边：颜色、透明度，带箭头
- 标签显示阈值：边 >0.8，点 >0.5
- 节点：圆 + 黑色描边 + label（字体 Inter）

---

## 2. GraphCanvas 现有行为清单（Cytoscape）

**核心功能：**
- 数据转换：`convertToCytoscapeFormat(...)`
- 性能警告（节点数 > 500）
- 双击节点：
  - 分组节点：折叠/展开
  - 视频节点：播放
  - 其他：扩展节点（POST /api/expand）
- 点击背景：取消选择 / 关闭右键菜单
- 右键菜单：节点 / 边定位
- Hover：显示 Tooltip（分组节点显示聚合信息）
- 样式：动态节点样式 + 主题切换
- 过滤：按节点类型/关系类型隐藏
- 布局：COSE + fit

**关联组件：**
- GraphControls（zoom / center / fit）
- Minimap（视图同步）
- ContextMenu（隐藏/聚焦/选择同类型等）
- AnalysisPanel（节点重要性/路径分析：依赖 cytoscape）
- ExportDialog（PNG/SVG/JSON：依赖 cytoscape）

---

## 3. 适配层字段对齐核对（GraphData → RendererData）

已读 `frontend/src/utils/kgGenRenderer/adapter.ts` / `types.ts`：

**RendererNode**
- id, label, color, radius, type, properties
- neighbors, degree, indegree, outdegree
- media: image/video/audio/mediaType/isVideo/videoThumbnailUrl/originalVideoUrl

**RendererEdge**
- id, source, target, predicate, color, type, properties

**RendererData**
- nodes / edges / clusters / topEntities / topRelations / stats

**已完成能力**
- 关系数量统计（topRelations）
- 节点度数统计（topEntities）
- media 提取（含代理 URL）

**缺口与注意点**
- cluster 信息目前为空（右侧面板可能缺数据）
- Cytoscape 的“隐藏/过滤”需在 renderer 中重建
- 视频缩略图逻辑需在 renderer 里另行处理
- 选中/高亮逻辑需从 `cy` 迁到 renderer API

---

## 4. 依赖与性能风险清单

### 依赖缺口
- d3-force / d3-zoom（前端 package.json 暂无）

### 性能风险
- Canvas 全量重绘在大图上 CPU 压力显著
- 需要 requestAnimationFrame / 节流
- filter/highlight 会触发全量重绘

### 功能风险
- 右键菜单定位：需要自行换算视图坐标
- PathAnalysis/NodeImportance：依赖 cytoscape 的算法需迁移
- SVG 导出：Canvas 不直接支持，需要单独方案

---

## 5. 迁移步骤建议（不落地）

1. **渲染器模块化**：提取 template.html 中的 createNetwork/zoom/render/selection 逻辑
2. **GraphCanvas 改为 canvas**：负责事件转发、tooltip/contextmenu
3. **GraphControls/Minimap/ContextMenu**：改为调用 renderer API
4. **AnalysisPanel**：拆除 cytoscape 依赖，改为图算法实现
5. **Export**：
   - PNG：canvas.toBlob
   - SVG：需要单独生成方案
6. **性能**：引入 tick 渲染调度与缩放阈值判断

---

## 6. 下一次会话可执行的具体落地任务

- 新建 `frontend/src/utils/kgGenRenderer/renderer.ts` 并实现：
  - init/updateData/setActiveElement/setFilter/zoomTo/fitTo/exportPNG/exportSVG/destroy
- 替换 GraphCanvas 的 Cytoscape 容器为 `<canvas>`
- 迁移点击/双击/右键/hover 逻辑到 renderer 事件
- GraphControls / Minimap / ContextMenu 改为调用 renderer API
- AnalysisPanel 从 cytoscape 算法迁移
- ExportDialog 改为 canvas 导出

