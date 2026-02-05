/**
 * 管理系统登录页
 */
import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  Container,
  Link,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../../services/adminService';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      console.log('开始登录...');
      // 使用邮箱登录,但字段名保持为 username 以兼容后端
      const result = await authApi.login({ username: email, password });
      console.log('登录成功:', result);
      
      // 确保 token 已保存
      const token = localStorage.getItem('admin_token');
      console.log('Token 已保存:', !!token);
      
      // 跳转到仪表盘
      console.log('跳转到仪表盘...');
      navigate('/admin/dashboard');
    } catch (err: any) {
      console.error('登录失败:', err);
      setError(err.message || '登录失败，请检查邮箱和密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Card sx={{ width: '100%' }}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h4" gutterBottom align="center">
              GraphInsight-后台管理
            </Typography>
            <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 3 }}>
              请登录以继续
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            <form onSubmit={handleLogin}>
              <TextField
                fullWidth
                label="邮箱"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                margin="normal"
                required
                autoFocus
                placeholder="your@email.com"
              />
              <TextField
                fullWidth
                label="密码"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                margin="normal"
                required
              />
              <Button
                fullWidth
                type="submit"
                variant="contained"
                size="large"
                disabled={loading}
                sx={{ mt: 3, mb: 2 }}
              >
                {loading ? '登录中...' : '登录'}
              </Button>

              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  还没有账号？{' '}
                  <Link
                    component="button"
                    variant="body2"
                    onClick={() => navigate('/admin/register')}
                    sx={{ cursor: 'pointer' }}
                  >
                    立即注册
                  </Link>
                </Typography>
              </Box>
            </form>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
};

export default LoginPage;
