/**
 * 管理系统登录页
 */
import React, { useState } from 'react';
import {
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  Link,
  Stack,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../../services/adminService';
import AdminAuthLayout from '../../components/Admin/AdminAuthLayout';

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
    <AdminAuthLayout title="GraphInsight 管理控制台" subtitle="企业级知识图谱运营中枢">
      <Card>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={2}>
            <Typography variant="h5">欢迎回来</Typography>
            <Typography variant="body2" color="text.secondary">
              请使用管理员邮箱登录继续管理
            </Typography>
          </Stack>

          {error && (
            <Alert severity="error" sx={{ mt: 3 }}>
              {error}
            </Alert>
          )}

          <form onSubmit={handleLogin}>
            <Stack spacing={2} sx={{ mt: 3 }}>
              <TextField
                fullWidth
                label="邮箱"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                required
              />
              <Button
                fullWidth
                type="submit"
                variant="contained"
                size="large"
                disabled={loading}
                sx={{ py: 1.2 }}
              >
                {loading ? '登录中...' : '登录控制台'}
              </Button>
              <Typography variant="body2" color="text.secondary" align="center">
                还没有账号？{' '}
                <Link component="button" variant="body2" onClick={() => navigate('/admin/register')}>
                  立即注册
                </Link>
              </Typography>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </AdminAuthLayout>
  );
};

export default LoginPage;
