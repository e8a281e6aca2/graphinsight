import { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { Box, Button, Alert, CircularProgress, Paper } from '@mui/material';
import { PlayArrow as ExecuteIcon } from '@mui/icons-material';
import Editor from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { useGraphStore } from '../../store/graphStore';
import { useCypher } from '../../hooks/useCypher';

const DEFAULT_QUERY = `// 示例查询：优先查看文档建图产出的实体关系
MATCH (e1:Entity)-[r]->(e2:Entity)
WHERE r.source = 'document_ingest'
RETURN e1, r, e2
LIMIT 80`;

export interface CypherEditorRef {
  setValue: (value: string) => void;
  executeQuery: () => void;
}

export const CypherEditor = forwardRef<CypherEditorRef>((_props, ref) => {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  const isDarkMode = useGraphStore((state) => state.isDarkMode);
  const { execute, isExecuting, error, clearError } = useCypher();

  const handleExecute = async () => {
    await execute(query);
  };

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    setValue: (value: string) => {
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
          onChange={(value) => setQuery(value || '')}
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
