/**
 * 管理系统 API
 */
import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000/api';

// 创建 axios 实例
const adminApi = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器：添加 Token
adminApi.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('admin_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 响应拦截器：处理错误
adminApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token 过期，清除并跳转登录
      localStorage.removeItem('admin_token');
      window.location.href = '/admin/login';
    }
    return Promise.reject(error);
  }
);

// 认证 API
export const authApi = {
  login: (username: string, password: string) =>
    adminApi.post('/admin/auth/login', { username, password }),
  
  logout: () =>
    adminApi.post('/admin/auth/logout'),
  
  getCurrentUser: () =>
    adminApi.get('/admin/auth/me'),
};

// 配置 API
export const configApi = {
  getAll: () =>
    adminApi.get('/admin/config'),
  
  update: (category: string, key: string, value: string) =>
    adminApi.put('/admin/config', { category, key, value }),
  
  test: (type: 'neo4j' | 'openai') =>
    adminApi.post('/admin/config/test', { type }),
  
  init: () =>
    adminApi.post('/admin/config/init'),
  
  getModels: () =>
    adminApi.get('/admin/config/openai/models'),
};

// 监控 API
export const monitorApi = {
  getStatus: () =>
    adminApi.get('/admin/monitor/status'),
  
  getStats: () =>
    adminApi.get('/admin/monitor/stats'),
  
  health: () =>
    adminApi.get('/admin/monitor/health'),
};

// 日志 API
export const logsApi = {
  getList: (page: number = 1, limit: number = 20) =>
    adminApi.get('/admin/logs', { params: { page, limit } }),
  
  getDetail: (id: number) =>
    adminApi.get(`/admin/logs/${id}`),
};

export default adminApi;
