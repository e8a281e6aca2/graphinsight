/**
 * 管理系统注册页面
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
  InputAdornment,
  IconButton,
  Stack,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../../services/adminService';
import AdminAuthLayout from '../../components/Admin/AdminAuthLayout';
import { getErrorMessage } from '../../utils/errorMessage';

const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      setError('请填写邮箱和密码');
      return;
    }

    if (!email.includes('@') || !email.split('@')[1].includes('.')) {
      setError('请输入有效的邮箱地址');
      return;
    }

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    if (password.length < 8) {
      setError('密码长度至少为 8 位');
      return;
    }

    if (!/\d/.test(password)) {
      setError('密码必须包含数字');
      return;
    }

    if (!/[a-zA-Z]/.test(password)) {
      setError('密码必须包含字母');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await authApi.register({
        email,
        password,
      });

      const successMessage = response?.message || '注册成功！';
      setSuccess(successMessage);

      setTimeout(() => {
        navigate('/admin/login');
      }, 3000);
    } catch (err: unknown) {
      setError(getErrorMessage(err, '注册失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminAuthLayout title="创建管理员账号" subtitle="注册后自动成为超级管理员">
      <Card>
        <CardContent sx={{ p: 4 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {success}
              <br />
              <Typography variant="caption">3秒后自动跳转到登录页...</Typography>
            </Alert>
          )}

          <form onSubmit={handleRegister}>
            <Stack spacing={2}>
              <TextField
                fullWidth
                label="邮箱"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                disabled={loading || !!success}
                placeholder="your@email.com"
                helperText="使用邮箱作为登录账号"
              />

              <TextField
                fullWidth
                label="密码"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading || !!success}
                helperText="至少8位，必须包含字母和数字"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <TextField
                fullWidth
                label="确认密码"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading || !!success}
                helperText="请再次输入密码"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowConfirmPassword(!showConfirmPassword)} edge="end">
                        {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={loading || !!success}
                sx={{ py: 1.2 }}
              >
                {loading ? '注册中...' : '立即注册'}
              </Button>

              <Typography variant="body2" color="text.secondary" align="center">
                已有账号？{' '}
                <Link component="button" variant="body2" onClick={() => navigate('/admin/login')}>
                  立即登录
                </Link>
              </Typography>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </AdminAuthLayout>
  );
};

export default RegisterPage;
