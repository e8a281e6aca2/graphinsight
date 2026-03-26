/**
 * 管理系统注册页面
 */
import React, { useState } from 'react';
import {
  Box,
  Container,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  Link,
  InputAdornment,
  IconButton,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  PersonAdd as RegisterIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../../services/adminService';

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
    
    // 验证
    if (!email || !password) {
      setError('请填写邮箱和密码');
      return;
    }
    
    // 验证邮箱格式
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
      console.log('开始注册...', { email });
      const response = await authApi.register({
        email,
        password,
      });
      
      console.log('注册响应:', response);
      
      // 安全地获取 message
      const successMessage = response?.message || '注册成功！';
      setSuccess(successMessage);
      
      // 3秒后跳转到登录页
      setTimeout(() => {
        navigate('/admin/login');
      }, 3000);
      
    } catch (err: any) {
      console.error('注册失败:', err);
      // 更健壮的错误处理
      let errorMessage = '注册失败，请稍后重试';
      
      if (err && typeof err === 'object') {
        // 尝试多种可能的错误消息位置
        errorMessage = err.message || 
                      err.error?.message || 
                      err.response?.data?.message ||
                      err.details?.message ||
                      errorMessage;
      } else if (typeof err === 'string') {
        errorMessage = err;
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      <Container maxWidth="sm">
        <Card elevation={10}>
          <CardContent sx={{ p: 4 }}>
            <Box sx={{ textAlign: 'center', mb: 3 }}>
              <RegisterIcon sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
              <Typography variant="h4" component="h1" gutterBottom>
                注册管理账号
              </Typography>
              <Typography variant="body2" color="text.secondary">
                使用邮箱注册，注册后自动成为管理员
              </Typography>
            </Box>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            {success && (
              <Alert severity="success" sx={{ mb: 2 }}>
                {success}
                <br />
                <Typography variant="caption">
                  3秒后自动跳转到登录页...
                </Typography>
              </Alert>
            )}

            <form onSubmit={handleRegister}>
              <TextField
                fullWidth
                label="邮箱"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                margin="normal"
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
                margin="normal"
                required
                disabled={loading || !!success}
                helperText="至少8位，必须包含字母和数字"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword(!showPassword)}
                        edge="end"
                      >
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
                margin="normal"
                required
                disabled={loading || !!success}
                helperText="请再次输入密码"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        edge="end"
                      >
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
                sx={{ mt: 3, mb: 2 }}
              >
                {loading ? '注册中...' : '注册'}
              </Button>

              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  已有账号？{' '}
                  <Link
                    component="button"
                    variant="body2"
                    onClick={() => navigate('/admin/login')}
                    sx={{ cursor: 'pointer' }}
                  >
                    立即登录
                  </Link>
                </Typography>
              </Box>
            </form>
          </CardContent>
        </Card>

        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Typography variant="caption" sx={{ color: 'white' }}>
            GraphInsight 管理系统 v3.0
          </Typography>
        </Box>
      </Container>
    </Box>
  );
};

export default RegisterPage;
