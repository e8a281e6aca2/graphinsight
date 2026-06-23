import { chromium } from '@playwright/test';
import { createServer as createViteServer } from 'vite';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));

const testHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GraphInsight 3D Renderer Check</title>
    <style>
      html, body, #root {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: #f8fafc;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">
      const { createRenderer3D } = await import('/src/renderers/force3d/renderer.ts');
      const nodes = [];
      const edges = [];
      const byId = new Map();
      const addNode = (id, label, type, color, radius = 22) => {
        const node = {
          id,
          label,
          type,
          color,
          radius,
          properties: { name: label },
          neighbors: [],
          degree: 0,
          indegree: 0,
          outdegree: 0,
        };
        nodes.push(node);
        byId.set(id, node);
      };
      const addEdge = (id, source, target, type) => {
        edges.push({
          id,
          source,
          target,
          type,
          predicate: type,
          color: '#64748b',
          properties: { relation: type },
        });
        const s = byId.get(source);
        const t = byId.get(target);
        s.degree += 1;
        s.outdegree += 1;
        t.degree += 1;
        t.indegree += 1;
        if (!s.neighbors.includes(target)) s.neighbors.push(target);
        if (!t.neighbors.includes(source)) t.neighbors.push(source);
      };

      addNode('doc', '企业知识库', 'document', '#2563eb', 34);
      for (let c = 1; c <= 6; c += 1) addNode(\`chunk-\${c}\`, \`片段 \${c}\`, 'chunk', '#f59e0b', 28);
      for (let e = 1; e <= 42; e += 1) addNode(\`entity-\${e}\`, \`实体 \${e}\`, 'entity', '#06b6d4', 16);
      for (let f = 1; f <= 9; f += 1) addNode(\`fact-\${f}\`, \`事实 \${f}\`, 'fact', '#22c55e', 18);
      for (let c = 1; c <= 6; c += 1) addEdge(\`doc-c-\${c}\`, 'doc', \`chunk-\${c}\`, 'HAS_CHUNK');
      for (let e = 1; e <= 42; e += 1) addEdge(\`c-e-\${e}\`, \`chunk-\${(e % 6) + 1}\`, \`entity-\${e}\`, 'MENTIONS');
      for (let f = 1; f <= 9; f += 1) {
        addEdge(\`f-e-a-\${f}\`, \`fact-\${f}\`, \`entity-\${((f * 3) % 42) + 1}\`, 'SUPPORTS');
        addEdge(\`f-e-b-\${f}\`, \`fact-\${f}\`, \`entity-\${((f * 5) % 42) + 1}\`, 'SUPPORTS');
      }

      const renderer = createRenderer3D(document.getElementById('root'), {}, { styleName: 'kgVivid' });
      renderer.updateData({
        nodes,
        edges,
        clusters: [],
        topEntities: [],
        topRelations: [],
        stats: {
          entities: nodes.length,
          relations: edges.length,
          relationTypes: 3,
          entityClusters: 0,
          edgeClusters: 0,
          isolatedEntities: 0,
          components: 1,
          averageDegree: (edges.length * 2) / nodes.length,
        },
      });
      document.body.dataset.ready = 'true';
      document.body.dataset.nodes = String(renderer.getAllNodes().length);
      document.body.dataset.edges = String(renderer.getAllEdges().length);
    </script>
  </body>
</html>`;

const vite = await createViteServer({
  root: rootDir,
  appType: 'spa',
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false,
  },
  plugins: [
    {
      name: 'graphinsight-3d-renderer-check',
      configureServer(server) {
        server.middlewares.use('/__3d-renderer-check.html', (_req, res) => {
          res.statusCode = 200;
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end(testHtml);
        });
      },
    },
  ],
});

await vite.listen();
const address = vite.httpServer?.address();
const port = typeof address === 'object' && address ? address.port : 0;
if (!port) {
  await vite.close();
  throw new Error('Failed to start Vite verification server');
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const messages = [];
page.on('console', (msg) => {
  const type = msg.type();
  if (type === 'error' || type === 'warning') messages.push({ type, text: msg.text() });
});
page.on('pageerror', (error) => messages.push({ type: 'pageerror', text: error.message }));

try {
  await page.goto(`http://127.0.0.1:${port}/__3d-renderer-check.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const result = await page.evaluate(() => ({
    ready: document.body.dataset.ready,
    nodes: Number(document.body.dataset.nodes || 0),
    edges: Number(document.body.dataset.edges || 0),
    canvasCount: document.querySelectorAll('canvas').length,
    canvasSize: (() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      return { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight };
    })(),
  }));
  await page.screenshot({ path: '/tmp/graphinsight-3d-renderer-check.png', fullPage: false });

  if (result.ready !== 'true') throw new Error('3D renderer did not mark the page ready');
  if (result.nodes < 50 || result.edges < 50) throw new Error(`Unexpected graph size: ${result.nodes} nodes, ${result.edges} edges`);
  if (result.canvasCount !== 1) throw new Error(`Expected exactly one canvas, got ${result.canvasCount}`);
  if (!result.canvasSize || result.canvasSize.clientWidth < 900 || result.canvasSize.clientHeight < 500) {
    throw new Error(`Unexpected canvas size: ${JSON.stringify(result.canvasSize)}`);
  }
  const severeMessages = messages.filter((msg) => msg.type === 'error' || msg.type === 'pageerror');
  if (severeMessages.length > 0) {
    throw new Error(`Browser errors: ${JSON.stringify(severeMessages)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    result,
    screenshot: '/tmp/graphinsight-3d-renderer-check.png',
  }, null, 2));
} finally {
  await browser.close();
  await vite.close();
}
