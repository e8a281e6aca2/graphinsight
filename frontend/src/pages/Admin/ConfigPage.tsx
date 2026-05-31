/**
 * 配置管理页面 v2.1
 * 使用标准化 API + 受控表单（避免刷新时重置输入）
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Box,
  Container,
  Card,
  Typography,
  TextField,
  Button,
  Alert,
  Snackbar,
  Tabs,
  Tab,
  IconButton,
  InputAdornment,
  CircularProgress,
  Chip,
  Stack,
  Autocomplete,
} from '@mui/material';
import { 
  Visibility, 
  VisibilityOff, 
  CheckCircle,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { useSearchParams } from 'react-router-dom';
import { configApi } from '../../services/adminService';
import type { ConfigItem, ConfigCategory, ConnectionTestResult } from '../../types/admin';
import AdminLayout from '../../components/Admin/AdminLayout';
import { getErrorMessage } from '../../utils/errorMessage';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div hidden={value !== index} {...other}>
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

// 表单值类型
interface FormValues {
  // Neo4j
  neo4j_uri: string;
  neo4j_user: string;
  neo4j_password: string;
  // AI Service
  ai_service_provider: string;
  ai_service_enabled: string;
  ai_service_base_url: string;
  ai_service_api_key: string;
  ai_service_model: string;
  ai_service_max_tokens: string;
  ai_service_temperature: string;
  // NL2Cypher
  nl2cypher_enabled: string;
  nl2cypher_cache_size: string;
  nl2cypher_max_limit: string;
}

const getErrorDebugInfo = (reason: unknown) => {
  if (!reason || typeof reason !== 'object') {
    return { message: getErrorMessage(reason, '未知错误') };
  }
  const error = reason as {
    message?: unknown;
    code?: unknown;
    trace_id?: unknown;
    details?: unknown;
  };
  return {
    message: typeof error.message === 'string' ? error.message : getErrorMessage(reason, '未知错误'),
    code: error.code,
    trace_id: error.trace_id,
    details: error.details,
  };
};

const ConfigPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialTab = parseInt(searchParams.get('tab') || '0', 10);
  const [tabValue, setTabValue] = useState(initialTab);
  const [configs, setConfigs] = useState<Record<ConfigCategory, Record<string, ConfigItem>> | null>(null);
  const [showPassword, setShowPassword] = useState<{ [key: string]: boolean }>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, boolean>>({});
  const [modelTestResult, setModelTestResult] = useState<ConnectionTestResult | null>(null);
  const [testingModel, setTestingModel] = useState(false);
  
  // 使用受控表单值，避免刷新时重置
  const [formValues, setFormValues] = useState<FormValues>({
    neo4j_uri: '',
    neo4j_user: '',
    neo4j_password: '',
    ai_service_provider: 'openai',
    ai_service_enabled: 'true',
    ai_service_base_url: '',
    ai_service_api_key: '',
    ai_service_model: '',
    ai_service_max_tokens: '',
    ai_service_temperature: '',
    nl2cypher_enabled: 'true',
    nl2cypher_cache_size: '',
    nl2cypher_max_limit: '',
  });
  
  // 跟踪哪些字段被修改过
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());
  const initialLoadDone = useRef(false);

  useEffect(() => {
    loadConfigs();
  }, []);

  // 当配置加载完成后，初始化表单值（仅首次加载）
  useEffect(() => {
    if (configs && !initialLoadDone.current) {
      initialLoadDone.current = true;
      setFormValues({
        neo4j_uri: configs.neo4j?.uri?.value || '',
        neo4j_user: configs.neo4j?.user?.value || '',
        neo4j_password: '',
        ai_service_provider: configs.ai_service?.provider?.value || 'openai',
        ai_service_enabled: configs.ai_service?.enabled?.value || 'true',
        ai_service_base_url: configs.ai_service?.base_url?.value || '',
        ai_service_api_key: '',
        ai_service_model: configs.ai_service?.model?.value || '',
        ai_service_max_tokens: configs.ai_service?.max_tokens?.value || '',
        ai_service_temperature: configs.ai_service?.temperature?.value || '',
        nl2cypher_enabled: configs.nl2cypher?.enabled?.value || 'true',
        nl2cypher_cache_size: configs.nl2cypher?.cache_size?.value || '',
        nl2cypher_max_limit: configs.nl2cypher?.max_limit?.value || '',
      });
    }
  }, [configs]);

  const loadConfigs = async () => {
    try {
      setLoading(true);
      const data = await configApi.getAll();
      setConfigs(data);
      try {
        const latestModelTest = await configApi.getLatestModelConnectionTest();
        setModelTestResult(latestModelTest);
      } catch (latestErr) {
        console.warn('Load latest model test skipped:', latestErr);
      }
      setError('');
    } catch (err: unknown) {
      console.error('Load configs error:', err);
      setError(getErrorMessage(err, '加载配置失败'));
    } finally {
      setLoading(false);
    }
  };

  // 更新表单值
  const handleFormChange = useCallback((field: keyof FormValues, value: string) => {
    setFormValues(prev => ({ ...prev, [field]: value }));
    setDirtyFields(prev => new Set(prev).add(field));
  }, []);

  // 保存单个配置（失焦时触发）
  const handleSaveField = useCallback(async (category: ConfigCategory, key: string, field: keyof FormValues) => {
    // 只有修改过的字段才保存
    if (!dirtyFields.has(field)) return;
    
    const value = formValues[field];
    try {
      setSaving(true);
      await configApi.update(category, key, value);
      setDirtyFields(prev => {
        const newSet = new Set(prev);
        newSet.delete(field);
        return newSet;
      });
      setMessage('配置已保存');
    } catch (err: unknown) {
      console.error('Save config error:', getErrorDebugInfo(err));
      setError(getErrorMessage(err, '保存失败'));
    } finally {
      setSaving(false);
    }
  }, [formValues, dirtyFields]);

  // 保存所有修改过的字段
  const handleSaveAll = async () => {
    if (dirtyFields.size === 0) {
      setMessage('没有需要保存的更改');
      return;
    }

    try {
      setSaving(true);
      const fieldToConfig: Record<string, { category: ConfigCategory; key: string }> = {
        neo4j_uri: { category: 'neo4j', key: 'uri' },
        neo4j_user: { category: 'neo4j', key: 'user' },
        neo4j_password: { category: 'neo4j', key: 'password' },
        ai_service_provider: { category: 'ai_service' as ConfigCategory, key: 'provider' },
        ai_service_enabled: { category: 'ai_service' as ConfigCategory, key: 'enabled' },
        ai_service_base_url: { category: 'ai_service' as ConfigCategory, key: 'base_url' },
        ai_service_api_key: { category: 'ai_service' as ConfigCategory, key: 'api_key' },
        ai_service_model: { category: 'ai_service' as ConfigCategory, key: 'model' },
        ai_service_max_tokens: { category: 'ai_service' as ConfigCategory, key: 'max_tokens' },
        ai_service_temperature: { category: 'ai_service' as ConfigCategory, key: 'temperature' },
        nl2cypher_enabled: { category: 'nl2cypher', key: 'enabled' },
        nl2cypher_cache_size: { category: 'nl2cypher', key: 'cache_size' },
        nl2cypher_max_limit: { category: 'nl2cypher', key: 'max_limit' },
      };

      let savedCount = 0;
      for (const field of dirtyFields) {
        const config = fieldToConfig[field];
        if (config) {
          await configApi.update(config.category, config.key, formValues[field as keyof FormValues]);
          savedCount++;
        }
      }
      
      setDirtyFields(new Set());
      setMessage(`成功保存 ${savedCount} 项配置`);
    } catch (err: unknown) {
      console.error('Save all error:', err);
      setError(getErrorMessage(err, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  // 重置表单到服务器值
  const handleReset = () => {
    if (configs) {
      setFormValues({
        neo4j_uri: configs.neo4j?.uri?.value || '',
        neo4j_user: configs.neo4j?.user?.value || '',
        neo4j_password: '',
        ai_service_provider: configs.ai_service?.provider?.value || 'openai',
        ai_service_enabled: configs.ai_service?.enabled?.value || 'true',
        ai_service_base_url: configs.ai_service?.base_url?.value || '',
        ai_service_api_key: '',
        ai_service_model: configs.ai_service?.model?.value || '',
        ai_service_max_tokens: configs.ai_service?.max_tokens?.value || '',
        ai_service_temperature: configs.ai_service?.temperature?.value || '',
        nl2cypher_enabled: configs.nl2cypher?.enabled?.value || 'true',
        nl2cypher_cache_size: configs.nl2cypher?.cache_size?.value || '',
        nl2cypher_max_limit: configs.nl2cypher?.max_limit?.value || '',
      });
    }
    setDirtyFields(new Set());
    setMessage('已重置所有未保存的更改');
  };

  const handleTest = async (type: 'neo4j' | 'ai_service') => {
    try {
      // 兼容旧的 openai 类型
      const testType = type === 'ai_service' ? 'openai' : type;
      const result = await configApi.testConnection(testType as 'neo4j' | 'openai');
      setTestResults(prev => ({ ...prev, [type]: result.success }));
      if (result.success) {
        setMessage(result.message || `${type === 'ai_service' ? 'AI 服务' : type} 连接测试成功`);
      } else {
        setError(result.message || `${type === 'ai_service' ? 'AI 服务' : type} 连接测试失败`);
      }
    } catch (err: unknown) {
      console.error('Test connection error:', err);
      setTestResults(prev => ({ ...prev, [type]: false }));
      setError(getErrorMessage(err, '测试失败'));
    }
  };

  const handleInit = async () => {
    try {
      await configApi.initFromEnv();
      setMessage('配置初始化成功');
      await loadConfigs();
    } catch (err: unknown) {
      console.error('Init config error:', err);
      setError(getErrorMessage(err, '初始化失败'));
    }
  };

  const togglePasswordVisibility = (key: string) => {
    setShowPassword((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const saveDirtyAiServiceFields = async () => {
    const aiDirtyMap: Array<{ field: keyof FormValues; key: string }> = [
      { field: 'ai_service_provider', key: 'provider' },
      { field: 'ai_service_enabled', key: 'enabled' },
      { field: 'ai_service_base_url', key: 'base_url' },
      { field: 'ai_service_api_key', key: 'api_key' },
      { field: 'ai_service_model', key: 'model' },
      { field: 'ai_service_max_tokens', key: 'max_tokens' },
      { field: 'ai_service_temperature', key: 'temperature' },
    ];
    const savedFields = new Set<string>();
    for (const item of aiDirtyMap) {
      if (!dirtyFields.has(item.field)) continue;
      await configApi.update('ai_service' as ConfigCategory, item.key, formValues[item.field]);
      savedFields.add(item.field);
    }
    if (savedFields.size > 0) {
      setDirtyFields(prev => {
        const next = new Set(prev);
        savedFields.forEach((field) => next.delete(field));
        return next;
      });
    }
  };

  const handleModelConnectionTest = async () => {
    setTestingModel(true);
    setError('');
    try {
      await saveDirtyAiServiceFields();
      const result = await configApi.testConnection('model');
      setModelTestResult(result);
      setTestResults(prev => ({ ...prev, model: result.success }));
      if (result.success) {
        setMessage(result.message || '模型连通性测试成功');
      } else {
        setError(result.message || '模型连通性测试失败');
      }
    } catch (err: unknown) {
      console.error('Model connection test error:', err);
      setTestResults(prev => ({ ...prev, model: false }));
      setError(getErrorMessage(err, '模型连通性测试失败'));
    } finally {
      setTestingModel(false);
    }
  };

  const handleFetchModels = async () => {
    setLoadingModels(true);
    try {
      // 先落库 AI 配置（尤其 API Key），避免 onBlur 未触发时读到旧值
      await saveDirtyAiServiceFields();

      const models = await configApi.getAvailableModels({
        provider: formValues.ai_service_provider,
        base_url: formValues.ai_service_base_url,
        model: formValues.ai_service_model,
      });
      setAvailableModels(models);
      if (models.length > 0) {
        setMessage(`成功获取 ${models.length} 个可用模型`);
        if (!formValues.ai_service_model) {
          handleFormChange('ai_service_model', models[0]);
        }
      } else {
        setError('未获取到模型列表，请检查 AI 服务配置');
      }
    } catch (err: unknown) {
      console.error('Fetch models error:', getErrorDebugInfo(err));
      setError(getErrorMessage(err, '获取模型列表失败'));
    } finally {
      setLoadingModels(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!configs) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">加载配置失败</Alert>
      </Box>
    );
  }

  const actionBar = (
    <Stack direction="row" spacing={1}>
      <Button variant="outlined" onClick={handleInit} disabled={saving}>
        从环境变量初始化
      </Button>
    </Stack>
  );

  return (
    <AdminLayout title="配置中心" subtitle="统一管理连接、模型与系统能力" actions={actionBar}>
      <Container maxWidth="lg" sx={{ px: 0 }}>
        <Card>
          <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
            <Tab label="Neo4j 配置" />
            <Tab label="AI 服务配置" />
            <Tab label="NL2Cypher 配置" />
          </Tabs>

          {/* Neo4j 配置 */}
          <TabPanel value={tabValue} index={0}>
            <Stack spacing={2}>
                <TextField
                  fullWidth
                  label="URI"
                  value={formValues.neo4j_uri}
                  onChange={(e) => handleFormChange('neo4j_uri', e.target.value)}
                  onBlur={() => handleSaveField('neo4j', 'uri', 'neo4j_uri')}
                  helperText="例如: bolt://localhost:7687"
                />
                <TextField
                  fullWidth
                  label="用户名"
                  value={formValues.neo4j_user}
                  onChange={(e) => handleFormChange('neo4j_user', e.target.value)}
                  onBlur={() => handleSaveField('neo4j', 'user', 'neo4j_user')}
                />
                <TextField
                  fullWidth
                  label="密码"
                  type={showPassword['neo4j_password'] ? 'text' : 'password'}
                  value={formValues.neo4j_password}
                  onChange={(e) => handleFormChange('neo4j_password', e.target.value)}
                  onBlur={() => handleSaveField('neo4j', 'password', 'neo4j_password')}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => togglePasswordVisibility('neo4j_password')}
                          edge="end"
                        >
                          {showPassword['neo4j_password'] ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  <Button variant="contained" onClick={() => handleTest('neo4j')}>
                    测试连接
                  </Button>
                  {testResults.neo4j !== undefined && (
                    <Chip
                      icon={testResults.neo4j ? <CheckCircle /> : <ErrorIcon />}
                      label={testResults.neo4j ? '连接成功' : '连接失败'}
                      color={testResults.neo4j ? 'success' : 'error'}
                      size="small"
                    />
                  )}
                </Box>
            </Stack>
          </TabPanel>

          {/* AI 服务配置 */}
          <TabPanel value={tabValue} index={1}>
            <Stack spacing={2}>
                <TextField
                  fullWidth
                  select
                  label="AI 服务提供商"
                  SelectProps={{ native: true }}
                  value={formValues.ai_service_provider}
                  onChange={(e) => handleFormChange('ai_service_provider', e.target.value)}
                  onBlur={() => handleSaveField('ai_service' as ConfigCategory, 'provider', 'ai_service_provider')}
                  helperText="选择 AI 服务提供商（OpenAI 兼容适用于智谱、通义千问等）"
                >
                  <option value="openai">OpenAI</option>
                  <option value="openai_compatible">OpenAI 兼容（智谱/通义千问等）</option>
                  <option value="claude">Claude (Anthropic)</option>
                </TextField>
                <TextField
                  fullWidth
                  select
                  label="启用状态"
                  SelectProps={{ native: true }}
                  value={formValues.ai_service_enabled}
                  onChange={(e) => handleFormChange('ai_service_enabled', e.target.value)}
                  onBlur={() => handleSaveField('ai_service' as ConfigCategory, 'enabled', 'ai_service_enabled')}
                  helperText="是否启用 AI 服务"
                >
                  <option value="true">启用</option>
                  <option value="false">禁用</option>
                </TextField>
                <TextField
                  fullWidth
                  label="API 地址（可选）"
                  value={formValues.ai_service_base_url}
                  onChange={(e) => handleFormChange('ai_service_base_url', e.target.value)}
                  onBlur={() => handleSaveField('ai_service' as ConfigCategory, 'base_url', 'ai_service_base_url')}
                  helperText="留空使用官方地址，或填入转发地址，例如: https://api.openai-proxy.com/v1"
                  placeholder="https://api.openai.com/v1"
                />
                <TextField
                  fullWidth
                  label="API Key"
                  type={showPassword['ai_service_key'] ? 'text' : 'password'}
                  value={formValues.ai_service_api_key}
                  onChange={(e) => handleFormChange('ai_service_api_key', e.target.value)}
                  onBlur={() => handleSaveField('ai_service' as ConfigCategory, 'api_key', 'ai_service_api_key')}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => togglePasswordVisibility('ai_service_key')}
                          edge="end"
                        >
                          {showPassword['ai_service_key'] ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  {availableModels.length > 0 ? (
                    <Autocomplete
                      fullWidth
                      freeSolo
                      options={availableModels}
                      value={formValues.ai_service_model}
                      onChange={(_, value) => {
                        handleFormChange('ai_service_model', typeof value === 'string' ? value : '');
                      }}
                      onInputChange={(_, value, reason) => {
                        if (reason === 'input') {
                          handleFormChange('ai_service_model', value || '');
                        }
                      }}
                      ListboxProps={{ style: { maxHeight: 420 } }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          fullWidth
                          label="模型"
                          onBlur={() => handleSaveField('ai_service' as ConfigCategory, 'model', 'ai_service_model')}
                          helperText={`从可用模型中选择（共 ${availableModels.length} 个，可搜索）`}
                        />
                      )}
                    />
                  ) : (
                    <TextField
                      fullWidth
                      label="模型"
                      value={formValues.ai_service_model}
                      onChange={(e) => handleFormChange('ai_service_model', e.target.value)}
                      onBlur={() => handleSaveField('ai_service' as ConfigCategory, 'model', 'ai_service_model')}
                      helperText="例如: gpt-3.5-turbo"
                    />
                  )}
                  <Button
                    variant="outlined"
                    onClick={handleFetchModels}
                    disabled={loadingModels}
                    sx={{ minWidth: '120px', height: '56px' }}
                  >
                    {loadingModels ? '加载中...' : '获取模型'}
                  </Button>
                </Box>
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 2 }}>
                  <TextField
                    fullWidth
                    label="Max Tokens"
                    type="number"
                    value={formValues.ai_service_max_tokens}
                    onChange={(e) => handleFormChange('ai_service_max_tokens', e.target.value)}
                    onBlur={() => handleSaveField('ai_service' as ConfigCategory, 'max_tokens', 'ai_service_max_tokens')}
                  />
                  <TextField
                    fullWidth
                    label="Temperature"
                    type="number"
                    inputProps={{ step: 0.1, min: 0, max: 2 }}
                    value={formValues.ai_service_temperature}
                    onChange={(e) => handleFormChange('ai_service_temperature', e.target.value)}
                    onBlur={() => handleSaveField('ai_service' as ConfigCategory, 'temperature', 'ai_service_temperature')}
                  />
                </Box>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  <Button variant="contained" onClick={() => handleTest('ai_service')}>
                    测试 API
                  </Button>
                  <Button variant="outlined" onClick={handleModelConnectionTest} disabled={testingModel}>
                    {testingModel ? '测试中...' : '测试当前模型'}
                  </Button>
                  {testResults.ai_service !== undefined && (
                    <Chip
                      icon={testResults.ai_service ? <CheckCircle /> : <ErrorIcon />}
                      label={testResults.ai_service ? 'API 可用' : 'API 不可用'}
                      color={testResults.ai_service ? 'success' : 'error'}
                      size="small"
                    />
                  )}
                  {testResults.model !== undefined && (
                    <Chip
                      icon={testResults.model ? <CheckCircle /> : <ErrorIcon />}
                      label={testResults.model ? '模型可用' : '模型不可用'}
                      color={testResults.model ? 'success' : 'error'}
                      size="small"
                    />
                  )}
                </Box>
                {modelTestResult && (
                  <Alert severity={modelTestResult.success ? 'success' : 'warning'}>
                    <Stack spacing={1}>
                      <Typography variant="subtitle2">{modelTestResult.message}</Typography>
                      <Typography variant="body2">
                        Provider: {modelTestResult.provider || '-'} · Model: {modelTestResult.model || '-'} · 延迟: {modelTestResult.latency_ms?.toFixed(1) || '0.0'} ms
                      </Typography>
                      {modelTestResult.endpoint && (
                        <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                          Endpoint: {modelTestResult.endpoint}
                        </Typography>
                      )}
                      {modelTestResult.checked_at && (
                        <Typography variant="body2" color="text.secondary">
                          最近测试: {new Date(modelTestResult.checked_at).toLocaleString()}
                        </Typography>
                      )}
                      {(modelTestResult.checks || []).map((item) => (
                        <Box key={item.name} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                          <Typography variant="body2">
                            {item.success ? '通过' : '失败'} · {item.name}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>
                            {item.message}{item.latency_ms ? ` · ${item.latency_ms.toFixed(1)} ms` : ''}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Alert>
                )}
            </Stack>
          </TabPanel>

          {/* NL2Cypher 配置 */}
          <TabPanel value={tabValue} index={2}>
            <Stack spacing={2}>
                <TextField
                  fullWidth
                  label="是否启用"
                  select
                  SelectProps={{ native: true }}
                  value={formValues.nl2cypher_enabled}
                  onChange={(e) => handleFormChange('nl2cypher_enabled', e.target.value)}
                  onBlur={() => handleSaveField('nl2cypher', 'enabled', 'nl2cypher_enabled')}
                >
                  <option value="true">启用</option>
                  <option value="false">禁用</option>
                </TextField>
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 2 }}>
                  <TextField
                    fullWidth
                    label="缓存大小"
                    type="number"
                    value={formValues.nl2cypher_cache_size}
                    onChange={(e) => handleFormChange('nl2cypher_cache_size', e.target.value)}
                    onBlur={() => handleSaveField('nl2cypher', 'cache_size', 'nl2cypher_cache_size')}
                  />
                  <TextField
                    fullWidth
                    label="最大限制"
                    type="number"
                    value={formValues.nl2cypher_max_limit}
                    onChange={(e) => handleFormChange('nl2cypher_max_limit', e.target.value)}
                    onBlur={() => handleSaveField('nl2cypher', 'max_limit', 'nl2cypher_max_limit')}
                  />
                </Box>
            </Stack>
          </TabPanel>

          {/* 底部操作按钮 */}
          <Box sx={{ p: 3, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 2, justifyContent: 'flex-end', alignItems: 'center', bgcolor: 'background.default' }}>
            {saving && <CircularProgress size={20} sx={{ mr: 1 }} />}
            {dirtyFields.size > 0 && (
              <Typography variant="body2" color="warning.main" sx={{ mr: 2 }}>
                {dirtyFields.size} 项未保存
              </Typography>
            )}
            <Button
              variant="outlined"
              onClick={handleReset}
              disabled={dirtyFields.size === 0 || saving}
            >
              重置更改
            </Button>
            <Button
              variant="contained"
              onClick={handleSaveAll}
              disabled={dirtyFields.size === 0 || saving}
              color={dirtyFields.size > 0 ? 'warning' : 'primary'}
            >
              {dirtyFields.size > 0 ? `保存所有更改 (${dirtyFields.size})` : '无更改'}
            </Button>
          </Box>
        </Card>
      </Container>

      <Snackbar
        open={!!message}
        autoHideDuration={3000}
        onClose={() => setMessage('')}
      >
        <Alert severity="success">{message}</Alert>
      </Snackbar>

      <Snackbar
        open={!!error}
        autoHideDuration={3000}
        onClose={() => setError('')}
      >
        <Alert severity="error">{error}</Alert>
      </Snackbar>
    </AdminLayout>
  );
};

export default ConfigPage;
