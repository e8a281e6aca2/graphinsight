import { useState, useRef, forwardRef, useImperativeHandle, useEffect } from 'react';
import { Box, Button, Alert, CircularProgress, Paper, Chip, Typography } from '@mui/material';
import { PlayArrow as ExecuteIcon } from '@mui/icons-material';
import Editor from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useGraphStore } from '../../store/graphStore';
import { useCypher } from '../../hooks/useCypher';
import { getGraphSchema } from '../../services/graphService';
import type { GraphSchemaSummary } from '../../types/api';
import { getErrorMessage } from '../../utils/errorMessage';

const DEFAULT_QUERY = `// 示例查询：查看当前图谱中的论文事实视图
MATCH p=(a)-[:FACT_SOURCE|FACT_TARGET]-(f)-[:FACT_SOURCE|FACT_TARGET]-(b)
WHERE f.view_scope = 'paper_wheat_four_type_fact_view'
RETURN p
LIMIT 200`;

export interface CypherEditorRef {
  setValue: (value: string) => void;
  executeQuery: () => void;
}

export const CypherEditor = forwardRef<CypherEditorRef>((_props, ref) => {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [schema, setSchema] = useState<GraphSchemaSummary | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const userEditedRef = useRef(false);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  const isDarkMode = useGraphStore((state) => state.isDarkMode);
  const { execute, isExecuting, error, clearError } = useCypher();

  const handleExecute = async () => {
    await execute(query);
  };

  useEffect(() => {
    let cancelled = false;

    const loadSchema = async () => {
      setSchemaLoading(true);
      setSchemaError(null);
      try {
        const discovered = await getGraphSchema();
        if (cancelled) {
          return;
        }
        setSchema(discovered);
        if (!userEditedRef.current && discovered.sampleQuery) {
          setQuery(discovered.sampleQuery);
          editorRef.current?.setValue(discovered.sampleQuery);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setSchemaError(formatGraphError(err, '图数据库结构探测失败'));
        }
      } finally {
        if (!cancelled) {
          setSchemaLoading(false);
        }
      }
    };

    loadSchema();

    return () => {
      cancelled = true;
    };
  }, []);

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    setValue: (value: string) => {
      userEditedRef.current = true;
      setQuery(value);
      if (editorRef.current) {
        editorRef.current.setValue(value);
      }
    },
    executeQuery: () => {
      handleExecute();
    },
  }));

  const handleEditorDidMount = (editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) => {
    editorRef.current = editor;

    // 添加 Ctrl+Enter 快捷键
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => {
        handleExecute();
      }
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <SchemaSummary schema={schema} loading={schemaLoading} error={schemaError} />

      {/* 编辑器 */}
      <Paper
        elevation={0}
        sx={{
          height: 180,
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
        }}
      >
        <Editor
          height="180px"
          defaultLanguage="sql" // 使用 SQL 作为 Cypher 的基础语法高亮
          value={query}
          onChange={(value) => {
            userEditedRef.current = true;
            setQuery(value || '');
          }}
          onMount={handleEditorDidMount}
          theme={isDarkMode ? 'vs-dark' : 'light'}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontWeight: 'normal',
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
            wrappingIndent: 'indent',
            padding: { top: 8, bottom: 8 },
          }}
        />
      </Paper>

      {/* 执行按钮 */}
      <Button
        variant="contained"
        color="primary"
        size="large"
        startIcon={isExecuting ? <CircularProgress size={20} /> : <ExecuteIcon />}
        onClick={handleExecute}
        disabled={isExecuting}
        fullWidth
      >
        {isExecuting ? '执行中...' : '执行查询 (Ctrl+Enter)'}
      </Button>

      {/* 错误消息 */}
      {error && (
        <Alert
          severity="error"
          onClose={clearError}
        >
          {error}
        </Alert>
      )}
    </Box>
  );
});

function SchemaSummary({
  schema,
  loading,
  error,
}: {
  schema: GraphSchemaSummary | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <Paper
        elevation={0}
        sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 1 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">
            正在探测图数据库结构...
          </Typography>
        </Box>
      </Paper>
    );
  }

  if (error) {
    return (
      <Alert severity="warning" sx={{ py: 0.5 }}>
        {error}
      </Alert>
    );
  }

  if (!schema) {
    return null;
  }

  const topLabels = schema.labels.slice(0, 4);
  const topRelationships = schema.relationships.slice(0, 4);
  const topPattern = schema.patterns[0];

  return (
    <Paper
      elevation={0}
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        px: 1.5,
        py: 1.25,
        bgcolor: 'background.default',
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            当前图谱结构
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {schema.stats.nodeCount} 节点 / {schema.stats.edgeCount} 关系
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {topLabels.map((item) => (
            <Chip key={item.label} label={formatSchemaChip(item.label, item.count)} size="small" variant="outlined" />
          ))}
          {topRelationships.map((item) => (
            <Chip key={item.type} label={formatSchemaChip(item.type, item.count)} size="small" color="primary" variant="outlined" />
          ))}
        </Box>

        {topPattern && (
          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
            最常见模式：({topPattern.sourceLabels.join(':') || 'Node'})-[:{topPattern.relationship}]-&gt;(
            {topPattern.targetLabels.join(':') || 'Node'})，{topPattern.count} 条
          </Typography>
        )}
      </Box>
    </Paper>
  );
}

function formatSchemaChip(name: string, count: number) {
  return count > 0 ? `${name} ${count}` : name;
}

function formatGraphError(err: unknown, fallback: string) {
  const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: unknown }).code : undefined;
  if (code === 'DATABASE_UNAVAILABLE') {
    return 'Neo4j 当前不可用：请先检查 /health，确认 Neo4j 已启动且 Bolt 可连接。';
  }
  if (code === 'DATABASE_MEMORY_EXHAUSTED') {
    return 'Neo4j 事务内存已耗尽：请重启 Neo4j 或终止重查询后再试。';
  }
  if (code === 'QUERY_TIMEOUT') {
    return '图数据库结构探测超时：请使用更窄的标签、关系类型或属性条件查询。';
  }
  return getErrorMessage(err, fallback);
}
