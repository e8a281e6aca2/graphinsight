/**
 * 管理系统 API 服务 v2.0
 * 使用标准化 API
 */
import axios, { AxiosError } from 'axios';
import type {
  ApiResponse,
  LoginRequest,
  LoginResponseData,
  UserInfo,
  ChangePasswordRequest,
  ConfigItem,
  SystemStats,
  HealthStatus,
  LogItem,
  LogQueryParams,
  LogStats,
  ProfileInfo,
  ProfileUpdateRequest,
  PasswordChangeRequest,
  LoginHistory,
} from '../types/admin';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// ============================================================
// Axios 实例配置
// ============================================================

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器 - 添加 token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('admin_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 响应拦截器 - 处理错误
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Token 过期或无效，清除并跳转到登录页
      localStorage.removeItem('admin_token');
      window.location.href = '/admin/login';
    }
    return Promise.reject(error);
  }
);

// ============================================================
// 错误处理
// ============================================================

interface ApiError {
  message: string;
  code?: number;
  details?: any;
}

function handleApiError(error: any): never {
  console.error('API 错误处理:', error);
  
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiResponse>;
    const message = axiosError.response?.data?.message || axiosError.message || '请求失败';
    const apiError: ApiError = {
      message,
      code: axiosError.response?.status,
      details: axiosError.response?.data,
    };
    console.error('Axios 错误:', apiError);
    throw apiError;
  }
  
  const unknownError = { message: '未知错误', details: error };
  console.error('未知错误:', unknownError);
  throw unknownError;
}

// ============================================================
// 认证 API
// ============================================================

export const authApi = {
  /**
   * 注册 - 使用邮箱注册
   */
  async register(data: { email: string; password: string }): Promise<{ user: UserInfo; message: string }> {
    try {
      console.log('发送注册请求:', data);
      const response = await apiClient.post<ApiResponse<{ user: UserInfo; message: string }>>(
        '/api/v1/admin/auth/register',
        data
      );
      console.log('注册响应:', response.data);
      
      // 确保返回有效数据
      if (!response.data.data) {
        throw new Error('注册响应数据格式错误');
      }
      
      return response.data.data;
    } catch (error) {
      console.error('注册 API 错误:', error);
      handleApiError(error);
    }
  },

  /**
   * 登录
   */
  async login(data: LoginRequest): Promise<LoginResponseData> {
    try {
      const response = await apiClient.post<ApiResponse<LoginResponseData>>(
        '/api/v1/admin/auth/login',
        data
      );
      
      // 保存 token
      if (response.data.data?.token) {
        localStorage.setItem('admin_token', response.data.data.token);
      }
      
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  /**
   * 登出
   */
  async logout(): Promise<void> {
    try {
      await apiClient.post('/api/v1/admin/auth/logout');
      localStorage.removeItem('admin_token');
    } catch (error) {
      // 即使失败也清除本地 token
      localStorage.removeItem('admin_token');
      handleApiError(error);
    }
  },

  /**
   * 获取当前用户信息
   */
  async getCurrentUser(): Promise<UserInfo> {
    try {
      const response = await apiClient.get<ApiResponse<UserInfo>>(
        '/api/v1/admin/auth/me'
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  /**
   * 修改密码
   */
  async changePassword(data: ChangePasswordRequest): Promise<void> {
    try {
      await apiClient.post('/api/v1/admin/auth/change-password', data);
    } catch (error) {
      handleApiError(error);
    }
  },
};

// ============================================================
// 配置 API
// ============================================================

// 配置分类类型
export type ConfigCategory = 'neo4j' | 'openai' | 'ai_service' | 'nl2cypher';

export const configApi = {
  /**
   * 获取所有配置
   */
  async getAll(): Promise<Record<ConfigCategory, Record<string, ConfigItem>>> {
    try {
      // 并行获取各个分类的配置
      const [neo4j, aiService, nl2cypher] = await Promise.all([
        apiClient.get<ApiResponse<Record<string, any>>>('/api/v1/admin/config/neo4j/all'),
        apiClient.get<ApiResponse<Record<string, any>>>('/api/v1/admin/config/ai-service/all'),
        apiClient.get<ApiResponse<Record<string, any>>>('/api/v1/admin/config/nl2cypher/all'),
      ]);

      // 转换为 ConfigItem 格式
      const convertToConfigItems = (data: Record<string, any>, category: string): Record<string, ConfigItem> => {
        const result: Record<string, ConfigItem> = {};
        for (const [key, value] of Object.entries(data)) {
          result[key] = {
            id: 0, // 从 /all 端点获取的数据没有 id
            key,
            value: String(value ?? ''),
            category,
            description: '',
            is_sensitive: key.includes('password') || key.includes('key'),
            is_encrypted: false,
            updated_at: new Date().toISOString(),
            version: 1,
          };
        }
        return result;
      };

      return {
        neo4j: convertToConfigItems(neo4j.data.data || {}, 'neo4j'),
        ai_service: convertToConfigItems(aiService.data.data || {}, 'ai_service'),
        openai: convertToConfigItems(aiService.data.data || {}, 'openai'), // 兼容旧代码
        nl2cypher: convertToConfigItems(nl2cypher.data.data || {}, 'nl2cypher'),
      };
    } catch (error) {
      handleApiError(error);
    }
  },

  /**
   * 获取指定分类的配置
   */
  async getByCategory(category: ConfigCategory): Promise<Record<string, ConfigItem>> {
    try {
      const response = await apiClient.get<ApiResponse<Record<string, ConfigItem>>>(
        `/api/v1/admin/config/${category}`
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  /**
   * 更新配置
   */
  async update(category: ConfigCategory, key: string, value: string): Promise<ConfigItem> {
    try {
      const response = await apiClient.put<ApiResponse<ConfigItem>>(
        `/api/v1/admin/config/${category}/${key}`,
        { value }
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  /**
   * 从环境变量初始化配置
   */
  async initFromEnv(): Promise<void> {
    try {
      await apiClient.post('/api/v1/admin/config/init');
    } catch (error) {
      handleApiError(error);
    }
  },

  /**
   * 测试连接
   */
  async testConnection(type: 'neo4j' | 'openai'): Promise<{ success: boolean; message: string }> {
    try {
      const response = await apiClient.post<ApiResponse<{ success: boolean; message: string }>>(
        `/api/v1/admin/config/test/${type}`
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  /**
   * 获取可用的 OpenAI 模型列表
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      console.log('调用 API: /api/v1/admin/config/openai/models');
      const response = await apiClient.get<ApiResponse<{ models: string[] }>>(
        '/api/v1/admin/config/openai/models'
      );
      console.log('API 完整响应:', JSON.stringify(response.data, null, 2));
      console.log('response.data.data:', response.data.data);
      console.log('response.data.data?.models:', response.data.data?.models);
      
      // 尝试多种方式获取 models
      let models: string[] = [];
      if (response.data.data?.models) {
        models = response.data.data.models;
      } else if (Array.isArray(response.data.data)) {
        models = response.data.data;
      } else if ((response.data as any).models) {
        models = (response.data as any).models;
      }
      
      console.log('最终解析出的模型列表:', models);
      return models;
    } catch (error) {
      console.error('获取模型列表 API 错误:', error);
      handleApiError(error);
    }
  },
};

// ============================================================
// 监控 API
// ============================================================

export const monitorApi = {
  /**
   * 获取系统统计信息
   */
  async getStats(): Promise<SystemStats> {
    try {
      const response = await apiClient.get<ApiResponse<SystemStats>>(
        '/api/v1/admin/monitor/stats'
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  /**
   * 获取健康状态
   */
  async getHealth(): Promise<HealthStatus> {
    try {
      const response = await apiClient.get<ApiResponse<HealthStatus>>(
        '/api/v1/admin/monitor/health'
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },
};

// ============================================================
// 日志 API
// ============================================================

export const logApi = {
  /**
   * 获取日志列表
   */
  async getLogs(params: LogQueryParams): Promise<{ logs: LogItem[]; total: number }> {
    try {
      const response = await apiClient.get<ApiResponse<{ logs: LogItem[]; total: number }>>(
        '/api/v1/admin/logs',
        { params }
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  /**
   * 获取日志详情
   */
  async getLogDetail(id: number): Promise<LogItem> {
    try {
      const response = await apiClient.get<ApiResponse<LogItem>>(
        `/api/v1/admin/logs/${id}`
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  /**
   * 获取日志统计
   */
  async getStats(): Promise<LogStats> {
    try {
      const response = await apiClient.get<ApiResponse<LogStats>>(
        '/api/v1/admin/logs/stats/summary'
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  /**
   * 清理旧日志
   */
  async cleanup(days: number): Promise<{ deleted_count: number }> {
    try {
      const response = await apiClient.delete<ApiResponse<{ deleted_count: number }>>(
        '/api/v1/admin/logs/cleanup',
        { params: { days } }
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },
};


// ============================================================
// 个人设置 API
// ============================================================

export const profileApi = {
  /**
   * 获取个人资料
   */
  async getProfile(): Promise<ProfileInfo> {
    try {
      const response = await apiClient.get<ApiResponse<ProfileInfo>>(
        '/api/v1/admin/profile'
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  /**
   * 更新个人资料
   */
  async updateProfile(data: ProfileUpdateRequest): Promise<ProfileInfo> {
    try {
      const response = await apiClient.put<ApiResponse<ProfileInfo>>(
        '/api/v1/admin/profile',
        data
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  /**
   * 修改密码
   */
  async changePassword(data: PasswordChangeRequest): Promise<void> {
    try {
      await apiClient.put('/api/v1/admin/profile/password', {
        old_password: data.old_password,
        new_password: data.new_password,
      });
    } catch (error) {
      handleApiError(error);
    }
  },

  /**
   * 上传头像
   */
  async uploadAvatar(file: File): Promise<{ avatar_url: string }> {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await apiClient.post<ApiResponse<{ avatar_url: string }>>(
        '/api/v1/admin/profile/avatar',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  /**
   * 获取登录历史
   */
  async getLoginHistory(params?: { page?: number; page_size?: number }): Promise<{ logs: LoginHistory[]; total: number }> {
    try {
      const response = await apiClient.get<ApiResponse<{ logs: LoginHistory[]; total: number }>>(
        '/api/v1/admin/profile/login-history',
        { params }
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },
};

// 默认导出
export default {
  auth: authApi,
  config: configApi,
  monitor: monitorApi,
  log: logApi,
  profile: profileApi,
};
