# 3D Graph Renderer Redesign

更新日期：2026-06-24

## 当前状态

GraphInsight 的 3D 图谱渲染器已从旧的 `3d-force-graph` 包装层改为直接 Three.js 实现，继续保持 `RendererAPI` 外部契约不变：

1. WebGL/Three.js 负责节点球体、关系线、光照、相机和命中检测。
2. 节点名称使用场景内 `three-spritetext`，不再使用 DOM overlay，也不再依赖 `graph2ScreenCoords`。
3. 相机交互使用 `OrbitControls`，支持旋转、缩放、平移、聚焦和自适应视图。
4. 默认不常驻所有标签，大图只展示少量 overview 锚点、选中节点、搜索命中、路径和邻居焦点。
5. 节点颜色继续使用后端/adapter 传入的 `node.color`；3D 边颜色使用 3D 预设统一低噪声色，避免关系线抢占视觉。
6. 3D 渲染器必须等容器具备真实尺寸和有效图谱数据后才初始化，避免隐藏容器下创建 WebGL 场景。
7. 查询结果不再自动设置全量搜索高亮；全量高亮在 3D 中只作为视图范围信号，不触发所有节点和边标签展开。

## 设计取舍

旧实现同时混用了 `3d-force-graph` 生命周期、默认球体、`SpriteText`、自定义 three group、边标签、星空背景、PMREM、手工相机补丁和层级引导，导致底层 force tick、标签距离、颜色、布局和聚焦行为互相影响。

新实现保留 `RendererAPI` 外部契约，但重写了 3D 内部实现：

- 默认节点：直接创建 Three.js `Mesh` 球体和透明 halo。
- 标签层：使用场景内 `SpriteText`，避免 DOM 标签闪烁和投影坐标错位。
- 布局层：使用确定性球壳初始分布、类型深度偏置和一次性关系松弛，不再依赖持续 force 模拟收敛。
- 相机层：按当前可见节点边界自适应首屏，并保持稳定斜视角以呈现 z 轴深度。
- 交互层：节点 raycast 支持 hover、点击、双击、右键菜单、选中和邻域高亮。
- 生命周期：GraphCanvas 在无数据或 3D 容器不可见时不初始化 3D renderer；renderer 内部对容器尺寸做延迟重试，避免隐藏容器下创建黑屏 canvas。

## 验收记录

已完成以下验证：

- `npm run lint`
- `npm run build`
- `node scripts/check-3d-renderer.mjs`
- Playwright 运行时验证：直接挂载 `createRenderer3D`，确认 58 节点 / 66 关系、canvas 尺寸正确、WebGL 渲染成功。
- 真实工作台验证：`/workspace?graph_demo=1` 注入开发态图谱数据，确认 45 节点 / 52 关系、2D canvas 隐藏、3D WebGL canvas 可见。
- 回归验证：没有 `Cannot read properties of undefined (reading 'tick')`、没有 `THREE.Color` rgba 警告。

## 后续边界

后续优化不应回到 `3d-force-graph` 生命周期包装路线。若需要增强：

1. 优先优化确定性布局、相机 framing 和场景内标签优先级。
2. 边标签继续保持聚焦态显示，不默认铺满。
3. 类型层次应保持确定性，不加入随机抖动。
4. 更复杂的业务详情应放到侧边详情面板，不塞进 3D 画布。
