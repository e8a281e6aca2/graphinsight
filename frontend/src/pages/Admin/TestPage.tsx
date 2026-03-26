/**
 * 测试页面 - 用于诊断登录后的问题
 */
import React, { useEffect, useState } from 'react';
import { Box, Container, Card, CardContent, Typography, Button, Alert } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { monitorApi } from '../../services/adminService';

const TestPage: React.FC = () => {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [testResult, setTestResult] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const storedToken = localStorage.getItem('admin_token');
    setToken(storedToken || '无 Token');
    console.log('TestPage - Token:', storedToken);
  }, []);

  const testApi = async () => {
    try {
      setError('');
      console.log('测试 API 调用...');
      const result = await monitorApi.getHealth();
      console.log('API 调用成功:', result);
      setTestResult(result);
    } catch (err: any) {
      console.error('API 调用失败:', err);
      setError(err.message || 'API 调用失败');
    }
  };

  return (
    <Container maxWidth="md" sx={{ mt: 4 }}>
      <Card>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            登录测试页面
          </Typography>

          <Box sx={{ mt: 3 }}>
            <Typography variant="subtitle1" gutterBottom>
              Token 状态:
            </Typography>
            <Typography
              variant="body2"
              sx={{
                p: 2,
                bgcolor: 'grey.100',
                borderRadius: 1,
                wordBreak: 'break-all',
                fontFamily: 'monospace',
              }}
            >
              {token}
            </Typography>
          </Box>

          <Box sx={{ mt: 3 }}>
            <Button variant="contained" onClick={testApi} sx={{ mr: 2 }}>
              测试 API 调用
            </Button>
            <Button variant="outlined" onClick={() => navigate('/admin/dashboard')}>
              前往 Dashboard
            </Button>
            <Button variant="outlined" onClick={() => navigate('/admin/login')} sx={{ ml: 2 }}>
              返回登录
            </Button>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mt: 3 }}>
              {error}
            </Alert>
          )}

          {testResult && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle1" gutterBottom>
                API 调用结果:
              </Typography>
              <Typography
                variant="body2"
                component="pre"
                sx={{
                  p: 2,
                  bgcolor: 'grey.100',
                  borderRadius: 1,
                  overflow: 'auto',
                  fontFamily: 'monospace',
                }}
              >
                {JSON.stringify(testResult, null, 2)}
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>
    </Container>
  );
};

export default TestPage;
