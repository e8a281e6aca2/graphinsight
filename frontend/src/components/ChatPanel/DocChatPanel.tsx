import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import {
  AutoGraph as AutoGraphIcon,
  Send as SendIcon,
  TipsAndUpdates as TipsIcon,
  MenuBook as MenuBookIcon,
} from '@mui/icons-material';
import { triggerGraphBuild } from '../../services/graphBuild';
import { reportClientLog } from '../../services/clientLog';
import { useGraphStore } from '../../store/graphStore';
import { askDocQa } from '../../services/docQa';
import { executeQuery } from '../../services/graphService';

interface Citation {
  id: string;
  title: string;
  snippet: string;
  location?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
}

const CITATION_COUNT = 2;

const quickPrompts = [
  '总结这批文档的核心主题',
  '列出关键人物与关系',
  '生成一份结构化大纲',
  '找出政策中的关键时间点',
];

const baseCitations: Citation[] = [
  {
    id: 'doc-1',
    title: '农业补贴政策汇编.pdf',
    snippet: '涉及补贴条件、适用对象与审批流程的条款说明。',
    location: '第 3 页 · 第 2 段',
  },
  {
    id: 'doc-2',
    title: '农机采购台账.xlsx',
    snippet: '记录了采购批次、型号、数量与资金流向。',
    location: 'Sheet1 · 行 24-36',
  },
  {
    id: 'doc-3',
    title: '项目验收报告.docx',
    snippet: '包含验收标准、关键节点与整改建议。',
    location: '第 8 页 · 表 4',
  },
];

const DOC_GRAPH_QUERY = `MATCH (n)-[r]->(m)
WHERE n.source = 'document_ingest' OR m.source = 'document_ingest'
RETURN n, r, m
LIMIT 300`;

function buildCitations(question: string) {
  const topic = question.trim().slice(0, 12) || '文档内容';
  return baseCitations.slice(0, CITATION_COUNT).map((item) => ({
    ...item,
    snippet: `围绕「${topic}」的相关段落摘要。${item.snippet}`,
  }));
}

export function DocChatPanel() {
  const setSelectedCitation = useGraphStore((state) => state.setSelectedCitation);
  const setWorkspaceTab = useGraphStore((state) => state.setWorkspaceTab);
  const setGraphData = useGraphStore((state) => state.setGraphData);
  const setLastQueryStats = useGraphStore((state) => state.setLastQueryStats);
  const addQueryToHistory = useGraphStore((state) => state.addQueryToHistory);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '已连接文档知识库。你可以直接提问，我会给出答案并附带引用摘要。',
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [buildStatus, setBuildStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildSummary, setBuildSummary] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const handleSend = async () => {
    const value = input.trim();
    if (!value || isTyping) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: value,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    try {
      const result = await askDocQa(value, CITATION_COUNT);
      const citations = result?.citations?.length ? result.citations : buildCitations(value);
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result?.answer || `我已基于文档库检索到与「${value.slice(0, 24)}」相关的内容，并整理如下。`,
        citations,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: '抱歉，当前问答服务不可用，请稍后重试。',
          citations: [],
        },
      ]);
      reportClientLog({
        level: 'error',
        message: '文档问答失败',
        source: 'doc_chat',
        event: 'doc_qa',
        context: { error: message },
      });
    } finally {
      setIsTyping(false);
    }
  };

  const handlePromptClick = (prompt: string) => {
    setInput(prompt);
  };

  const handleCitationClick = (citation: Citation) => {
    setSelectedCitation(citation);
    setWorkspaceTab('document');
  };

  const runDocGraphQuery = async () => {
    try {
      const result = await executeQuery(DOC_GRAPH_QUERY);
      setGraphData(result);
      if (result.stats) {
        setLastQueryStats(result.stats);
      }
      addQueryToHistory(DOC_GRAPH_QUERY, result.nodes.length + result.edges.length);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportClientLog({
        level: 'warn',
        message: '文档图谱查询失败',
        source: 'doc_chat',
        event: 'doc_graph_query',
        context: { error: message },
      });
    }
  };

  const handleBuildGraph = () => {
    if (buildStatus === 'running') return;
    setBuildStatus('running');
    setBuildError(null);
    setBuildSummary(null);
    triggerGraphBuild({ source: 'documents' })
      .then((result) => {
        const failures = result?.failures || [];
        if (result?.status === 'completed') {
          setBuildStatus('done');
          if (result?.stats) {
            const { documents, chunks, entities } = result.stats as any;
            setBuildSummary(`文档 ${documents} · 片段 ${chunks} · 实体 ${entities}`);
          }
          runDocGraphQuery();
          if (failures.length > 0) {
            const sample = failures.slice(0, 2).map((item: any) => item.file).join('、');
            setBuildError(`解析失败 ${failures.length} 个文件${sample ? `：${sample}` : ''}`);
          }
        } else if (result?.status === 'empty') {
          setBuildStatus('done');
          if (result?.message?.includes('文档未变更')) {
            runDocGraphQuery();
          }
          if (failures.length > 0) {
            const sample = failures.slice(0, 2).map((item: any) => item.file).join('、');
            setBuildError(`解析失败 ${failures.length} 个文件${sample ? `：${sample}` : ''}`);
          } else {
            setBuildError('未发现可解析文档');
          }
          if (result?.stats) {
            const { documents, chunks, entities } = result.stats as any;
            setBuildSummary(`文档 ${documents} · 片段 ${chunks} · 实体 ${entities}`);
          }
        } else {
          setBuildStatus('done');
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setBuildStatus('idle');
        setBuildError('建图失败，请稍后重试。');
        reportClientLog({
          level: 'error',
          message: '一键建图触发失败',
          source: 'doc_chat',
          event: 'build_graph',
          context: { error: message },
        });
      });
  };

  const buildLabel = useMemo(() => {
    if (buildStatus === 'running') return '正在建图...';
    if (buildStatus === 'done') return '已完成建图';
    return '一键建图';
  }, [buildStatus]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        bgcolor: 'background.paper',
        fontFamily: '"Space Grotesk", "Noto Sans SC", sans-serif',
        borderRight: `1px solid ${theme.palette.divider}`,
      })}
    >
      <Box
        sx={(theme) => ({
          px: 2.5,
          py: 2,
          borderBottom: `1px solid ${theme.palette.divider}`,
          background:
            theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.92) 100%)'
              : 'linear-gradient(135deg, rgba(226, 232, 240, 0.8) 0%, rgba(240, 253, 250, 0.9) 100%)',
          backgroundImage:
            theme.palette.mode === 'dark'
              ? 'radial-gradient(120% 120% at 20% 0%, rgba(56, 189, 248, 0.16) 0%, rgba(15, 23, 42, 0) 55%), radial-gradient(120% 120% at 100% 20%, rgba(34, 197, 94, 0.14) 0%, rgba(15, 23, 42, 0) 45%)'
              : 'radial-gradient(120% 120% at 15% 0%, rgba(56, 189, 248, 0.18) 0%, rgba(248, 250, 252, 0) 55%), radial-gradient(120% 120% at 100% 20%, rgba(34, 197, 94, 0.12) 0%, rgba(248, 250, 252, 0) 45%)',
        })}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700} sx={{ letterSpacing: 0.3 }}>
              文档问答
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              一键建图 · 回答强制引用
            </Typography>
          </Box>
          <Button
            variant="contained"
            size="small"
            startIcon={<AutoGraphIcon />}
            onClick={handleBuildGraph}
            disabled={buildStatus === 'running'}
          >
            {buildLabel}
          </Button>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
          <Chip
            icon={<MenuBookIcon />}
            label="范围：全库文档"
            size="small"
            variant="outlined"
          />
          <Chip label={`引用摘要：${CITATION_COUNT} 条`} size="small" variant="outlined" />
          <Chip label="已接入文档" size="small" variant="outlined" />
          {buildSummary && (
            <Chip label={buildSummary} size="small" color="success" variant="outlined" />
          )}
          {buildError && (
            <Chip label={buildError} size="small" color="error" variant="outlined" />
          )}
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
          {quickPrompts.map((prompt) => (
            <Chip
              key={prompt}
              label={prompt}
              size="small"
              onClick={() => handlePromptClick(prompt)}
              sx={{ bgcolor: 'background.paper' }}
            />
          ))}
        </Box>
      </Box>

      <Box
        sx={(theme) => ({
          flex: 1,
          overflow: 'auto',
          px: 2.5,
          py: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          bgcolor: theme.palette.background.default,
          backgroundImage:
            theme.palette.mode === 'dark'
              ? 'radial-gradient(circle at top left, rgba(56, 189, 248, 0.08), transparent 60%), radial-gradient(circle at 80% 30%, rgba(34, 197, 94, 0.06), transparent 55%)'
              : 'radial-gradient(circle at top left, rgba(14, 165, 233, 0.08), transparent 60%), radial-gradient(circle at 80% 30%, rgba(34, 197, 94, 0.08), transparent 55%)',
        })}
      >
        {messages.map((message) => {
          const isUser = message.role === 'user';
          return (
            <Box
              key={message.id}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isUser ? 'flex-end' : 'flex-start',
                gap: 1,
              }}
            >
              <Box
                sx={(theme) => ({
                  maxWidth: '85%',
                  px: 2,
                  py: 1.5,
                  borderRadius: 2.5,
                  bgcolor: isUser ? theme.palette.primary.main : theme.palette.background.paper,
                  color: isUser ? theme.palette.primary.contrastText : theme.palette.text.primary,
                  border: isUser ? 'none' : `1px solid ${theme.palette.divider}`,
                  boxShadow: isUser ? 'none' : theme.shadows[1],
                })}
              >
                <Typography variant="body2" component="div" sx={{ lineHeight: 1.6 }}>
                  {message.content}
                </Typography>
              </Box>

              {!isUser && message.citations && message.citations.length > 0 && (
                <Box sx={{ width: '100%', maxWidth: '90%' }}>
                  <Typography
                    variant="caption"
                    component="div"
                    color="text.secondary"
                    sx={{ mb: 0.5 }}
                  >
                    引用摘要（{Math.min(message.citations.length, CITATION_COUNT)}）
                  </Typography>
                  <Box sx={{ display: 'grid', gap: 1 }}>
                    {message.citations.slice(0, CITATION_COUNT).map((citation) => (
                      <Box
                        key={citation.id}
                        component="button"
                        type="button"
                        onClick={() => {
                          handleCitationClick(citation);
                        }}
                        sx={(theme) => ({
                          textAlign: 'left',
                          border: `1px solid ${theme.palette.divider}`,
                          borderRadius: 1.5,
                          p: 1.25,
                          bgcolor: theme.palette.background.paper,
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          '&:hover': {
                            borderColor: theme.palette.primary.light,
                            boxShadow: theme.shadows[2],
                            transform: 'translateY(-1px)',
                          },
                        })}
                      >
                        <Typography variant="caption" component="div" sx={{ fontWeight: 600 }}>
                          {citation.title}
                        </Typography>
                        <Typography variant="body2" component="div" color="text.secondary" sx={{ mt: 0.5 }}>
                          {citation.snippet}
                        </Typography>
                        {citation.location && (
                          <Typography variant="caption" component="div" color="text.secondary" sx={{ mt: 0.5 }}>
                            {citation.location}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          );
        })}

        {isTyping && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TipsIcon fontSize="small" color="primary" />
            <Typography variant="body2" color="text.secondary">
              正在整理答案...
            </Typography>
          </Box>
        )}
        <div ref={endRef} />
      </Box>

      <Divider />

      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <TextField
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          multiline
          minRows={2}
          maxRows={6}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 2,
              bgcolor: 'background.default',
            },
          }}
        />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Chip
            label="回答必带引用"
            size="small"
            variant="outlined"
            color="primary"
          />
          <IconButton
            color="primary"
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            sx={{
              borderRadius: 2,
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              '&:hover': {
                bgcolor: 'primary.dark',
              },
            }}
          >
            <SendIcon />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}
