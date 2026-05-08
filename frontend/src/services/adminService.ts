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
  ConnectionTestResult,
  SystemStats,
  HealthStatus,
  PerformanceMetricsData,
  QAQualityMetrics,
  SloSnapshot,
  AlertCheckResult,
  LogItem,
  LogQueryParams,
  LogStats,
  ProfileInfo,
  ProfileUpdateRequest,
  PasswordChangeRequest,
  LoginHistory,
  RoleItem,
  PermissionItem,
  BindingItem,
  BindingCreateRequest,
  AdminUserItem,
  PaginatedData,
  AdminUserCreateRequest,
  AdminUserUpdateRequest,
  AdminUserResetPasswordRequest,
  AdminUserBatchStatusRequest,
  AdminUserBatchDeleteRequest,
  AdminUserBatchResetPasswordRequest,
  AdminUserBatchStatusResult,
  AdminUserBatchDeleteResult,
  AdminUserBatchResetPasswordResult,
  JobCreateRequest,
  JobItem,
  JobLogItem,
  JobQueryParams,
  QATraceDetail,
  QATraceItem,
  QATraceQueryParams,
} from '../types/admin';
import { API_BASE_URL } from '../utils/apiBase';

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

console.info('[AdminAPI] baseURL =', API_BASE_URL);

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
  trace_id?: string;
}

function extractApiData<T>(response: { data: ApiResponse<T> }): T {
  const payload = response.data;
  if (!payload) {
    throw { message: '响应为空' } as ApiError;
  }
  if (typeof payload.code === 'number' && payload.code >= 400) {
    throw {
      message: payload.trace_id
        ? `${payload.message || '请求失败'} [trace_id: ${payload.trace_id}]`
        : (payload.message || '请求失败'),
      code: payload.code,
      details: (payload as any).error,
      trace_id: payload.trace_id,
    } as ApiError;
  }
  if (typeof payload.data === 'undefined') {
    throw {
      message: payload.message || '响应缺少 data 字段',
      code: payload.code,
      details: payload,
      trace_id: payload.trace_id,
    } as ApiError;
  }
  return payload.data;
}

function handleApiError(error: any): never {
  console.error('API 错误处理:', error);

  if (error && typeof error === 'object' && !axios.isAxiosError(error) && 'message' in error) {
    const normalized = {
      message: String((error as any).message || '未知错误'),
      code: (error as any).code,
      trace_id: (error as any).trace_id,
      details: (error as any).details,
    };
    console.error('标准化业务错误:', normalized);
    throw error as ApiError;
  }
  
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiResponse>;
    const traceId =
      axiosError.response?.data?.trace_id ||
      (axiosError.response?.headers?.['x-trace-id'] as string | undefined);
    const rawMessage = axiosError.response?.data?.message || axiosError.message || '请求失败';
    const message = traceId ? `${rawMessage} [trace_id: ${traceId}]` : rawMessage;
    const apiError: ApiError = {
      message,
      code: axiosError.response?.status,
      details: axiosError.response?.data,
      trace_id: traceId,
    };
    console.error('Axios 错误:', {
      ...apiError,
      request: {
        method: axiosError.config?.method,
        baseURL: axiosError.config?.baseURL,
        url: axiosError.config?.url,
      },
      response: {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
      },
    });
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

      if (typeof response.data?.code === 'number' && response.data.code >= 400) {
        throw {
          message: response.data.message || '注册失败',
          code: response.data.code,
          details: (response.data as any).error,
        };
      }
      
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

      if (typeof response.data?.code === 'number' && response.data.code >= 400) {
        throw {
          message: response.data.message || '登录失败',
          code: response.data.code,
          details: (response.data as any).error,
        };
      }
      
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
export type ConfigCategory = 'neo4j' | 'ai_service' | 'nl2cypher';

export const configApi = {
  /**
   * 获取所有配置
   */
  async getAll(): Promise<Record<ConfigCategory, Record<string, ConfigItem>>> {
    try {
      // 并行获取各个分类的配置
      const [neo4jResp, aiServiceResp, nl2cypherResp] = await Promise.all([
        apiClient.get<ApiResponse<Record<string, any>>>('/api/v1/admin/config/neo4j/all'),
        apiClient.get<ApiResponse<Record<string, any>>>('/api/v1/admin/config/ai-service/all'),
        apiClient.get<ApiResponse<Record<string, any>>>('/api/v1/admin/config/nl2cypher/all'),
      ]);
      const neo4j = extractApiData(neo4jResp);
      const aiService = extractApiData(aiServiceResp);
      const nl2cypher = extractApiData(nl2cypherResp);

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
        neo4j: convertToConfigItems(neo4j || {}, 'neo4j'),
        ai_service: convertToConfigItems(aiService || {}, 'ai_service'),
        nl2cypher: convertToConfigItems(nl2cypher || {}, 'nl2cypher'),
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
      return extractApiData(response);
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
      return extractApiData(response);
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
  async testConnection(type: 'neo4j' | 'openai' | 'ai_service' | 'model'): Promise<ConnectionTestResult> {
    try {
      const response = await apiClient.post<ApiResponse<ConnectionTestResult>>(
        `/api/v1/admin/config/test/${type}`
      );
      return extractApiData(response);
    } catch (error) {
      handleApiError(error);
    }
  },

  async getLatestModelConnectionTest(): Promise<ConnectionTestResult | null> {
    try {
      const response = await apiClient.get<ApiResponse<ConnectionTestResult | null>>(
        '/api/v1/admin/config/test/model/latest'
      );
      return extractApiData(response);
    } catch (error) {
      handleApiError(error);
    }
  },

  /**
   * 获取可用的 OpenAI 模型列表
   */
  async getAvailableModels(params?: {
    provider?: string;
    base_url?: string;
    model?: string;
  }): Promise<string[]> {
    try {
      console.log('调用 API: /api/v1/admin/config/openai/models');
      const response = await apiClient.get<ApiResponse<{ models: string[] }>>(
        '/api/v1/admin/config/openai/models',
        { params }
      );
      console.log('API 完整响应:', JSON.stringify(response.data, null, 2));
      console.log('response.data.data:', response.data.data);
      console.log('response.data.data?.models:', response.data.data?.models);
      
      // 尝试多种方式获取 models
      let models: string[] = [];
      const data = extractApiData(response);
      if ((data as any)?.models) {
        models = (data as any).models;
      } else if (Array.isArray(data)) {
        models = data as unknown as string[];
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
      return extractApiData(response);
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
      return extractApiData(response);
    } catch (error) {
      handleApiError(error);
    }
  },

  async getPerformance(params?: { window_seconds?: number }): Promise<PerformanceMetricsData> {
    try {
      const response = await apiClient.get<ApiResponse<PerformanceMetricsData>>(
        '/api/v1/admin/monitor/performance',
        { params }
      );
      return extractApiData(response);
    } catch (error) {
      handleApiError(error);
    }
  },

  async getQAQuality(params?: { window_seconds?: number }): Promise<QAQualityMetrics> {
    try {
      const response = await apiClient.get<ApiResponse<QAQualityMetrics>>(
        '/api/v1/admin/monitor/qa',
        { params }
      );
      return extractApiData(response);
    } catch (error) {
      handleApiError(error);
    }
  },

  async getSloSnapshot(params?: { api_window_seconds?: number; job_window_minutes?: number }): Promise<SloSnapshot> {
    try {
      const response = await apiClient.get<ApiResponse<SloSnapshot>>(
        '/api/v1/admin/monitor/slo',
        { params }
      );
      return extractApiData(response);
    } catch (error) {
      handleApiError(error);
    }
  },

  async checkAlerts(params?: {
    send_webhook?: boolean;
    api_window_seconds?: number;
    job_window_minutes?: number;
  }): Promise<AlertCheckResult> {
    try {
      const response = await apiClient.post<ApiResponse<AlertCheckResult>>(
        '/api/v1/admin/monitor/alerts/check',
        null,
        { params }
      );
      return extractApiData(response);
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
      const response = await apiClient.get<ApiResponse<PaginatedData<LogItem>>>(
        '/api/v1/admin/logs',
        { params }
      );
      const data = extractApiData(response);
      return {
        logs: Array.isArray(data.items) ? data.items : [],
        total: Number(data.total || 0),
      };
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
      return extractApiData(response);
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
      return extractApiData(response);
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
        '/api/v1/admin/logs/clean',
        { params: { days } }
      );
      return extractApiData(response);
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

// ============================================================
// RBAC API
// ============================================================

export const rbacApi = {
  async getRoles(): Promise<RoleItem[]> {
    try {
      const response = await apiClient.get<ApiResponse<RoleItem[]>>(
        '/api/v1/admin/rbac/roles'
      );
      return response.data.data || [];
    } catch (error) {
      handleApiError(error);
    }
  },

  async getPermissions(): Promise<PermissionItem[]> {
    try {
      const response = await apiClient.get<ApiResponse<PermissionItem[]>>(
        '/api/v1/admin/rbac/permissions'
      );
      return response.data.data || [];
    } catch (error) {
      handleApiError(error);
    }
  },

  async getBindings(params?: { user_id?: number }): Promise<BindingItem[]> {
    try {
      const response = await apiClient.get<ApiResponse<BindingItem[]>>(
        '/api/v1/admin/rbac/bindings',
        { params }
      );
      return response.data.data || [];
    } catch (error) {
      handleApiError(error);
    }
  },

  async createBinding(payload: BindingCreateRequest): Promise<BindingItem> {
    try {
      const response = await apiClient.post<ApiResponse<BindingItem>>(
        '/api/v1/admin/rbac/bindings',
        payload
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  async deleteBinding(bindingId: number): Promise<void> {
    try {
      await apiClient.delete(`/api/v1/admin/rbac/bindings/${bindingId}`);
    } catch (error) {
      handleApiError(error);
    }
  },
};

// ============================================================
// 用户 API
// ============================================================

export const usersApi = {
  async getUsers(params?: {
    page?: number;
    page_size?: number;
    search?: string;
    is_active?: boolean;
    department?: string;
  }): Promise<PaginatedData<AdminUserItem>> {
    try {
      const response = await apiClient.get<ApiResponse<PaginatedData<AdminUserItem>>>(
        '/api/v1/admin/users',
        { params }
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  async createUser(payload: AdminUserCreateRequest): Promise<AdminUserItem> {
    try {
      const response = await apiClient.post<ApiResponse<AdminUserItem>>('/api/v1/admin/users', payload);
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  async updateUser(userId: number, payload: AdminUserUpdateRequest): Promise<AdminUserItem> {
    try {
      const response = await apiClient.put<ApiResponse<AdminUserItem>>(`/api/v1/admin/users/${userId}`, payload);
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  async toggleUserStatus(userId: number): Promise<AdminUserItem> {
    try {
      const response = await apiClient.post<ApiResponse<AdminUserItem>>(`/api/v1/admin/users/${userId}/toggle-status`);
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  async resetUserPassword(userId: number, payload: AdminUserResetPasswordRequest): Promise<void> {
    try {
      await apiClient.post(`/api/v1/admin/users/${userId}/reset-password`, payload);
    } catch (error) {
      handleApiError(error);
    }
  },

  async deleteUser(userId: number, softDelete = true): Promise<void> {
    try {
      await apiClient.delete(`/api/v1/admin/users/${userId}`, {
        params: { soft_delete: softDelete },
      });
    } catch (error) {
      handleApiError(error);
    }
  },

  async batchUpdateStatus(payload: AdminUserBatchStatusRequest): Promise<AdminUserBatchStatusResult> {
    try {
      const response = await apiClient.post<ApiResponse<AdminUserBatchStatusResult>>(
        '/api/v1/admin/users/batch-status',
        payload
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  async batchDeleteUsers(payload: AdminUserBatchDeleteRequest): Promise<AdminUserBatchDeleteResult> {
    try {
      const response = await apiClient.post<ApiResponse<AdminUserBatchDeleteResult>>(
        '/api/v1/admin/users/batch-delete',
        payload
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  async batchResetPassword(payload: AdminUserBatchResetPasswordRequest): Promise<AdminUserBatchResetPasswordResult> {
    try {
      const response = await apiClient.post<ApiResponse<AdminUserBatchResetPasswordResult>>(
        '/api/v1/admin/users/batch-reset-password',
        payload
      );
      return response.data.data!;
    } catch (error) {
      handleApiError(error);
    }
  },

  async exportUsersCsv(params?: {
    search?: string;
    is_active?: boolean;
    department?: string;
    order_by?: string;
    order_desc?: boolean;
  }): Promise<Blob> {
    try {
      const response = await apiClient.get<Blob>('/api/v1/admin/users/export-csv', {
        params,
        responseType: 'blob',
      });
      return response.data;
    } catch (error) {
      handleApiError(error);
    }
  },
};

// ============================================================
// 任务中心 API
// ============================================================

export const jobsApi = {
  async createBuildGraph(payload: JobCreateRequest): Promise<JobItem> {
    try {
      const response = await apiClient.post<ApiResponse<JobItem>>('/api/v1/admin/jobs/build-graph', payload);
      return extractApiData(response);
    } catch (error) {
      handleApiError(error);
    }
  },

  async createClearKb(payload: JobCreateRequest): Promise<JobItem> {
    try {
      const response = await apiClient.post<ApiResponse<JobItem>>('/api/v1/admin/jobs/clear-kb', payload);
      return extractApiData(response);
    } catch (error) {
      handleApiError(error);
    }
  },

  async createReindex(payload: JobCreateRequest): Promise<JobItem> {
    try {
      const response = await apiClient.post<ApiResponse<JobItem>>('/api/v1/admin/jobs/reindex', payload);
      return extractApiData(response);
    } catch (error) {
      handleApiError(error);
    }
  },

  async getJobs(params?: JobQueryParams): Promise<PaginatedData<JobItem>> {
    try {
      const response = await apiClient.get<ApiResponse<PaginatedData<JobItem>>>('/api/v1/admin/jobs', { params });
      return extractApiData(response);
    } catch (error) {
      handleApiError(error);
    }
  },

  async getJobById(jobId: number): Promise<JobItem> {
    try {
      const response = await apiClient.get<ApiResponse<JobItem>>(`/api/v1/admin/jobs/${jobId}`);
      return extractApiData(response);
    } catch (error) {
      handleApiError(error);
    }
  },

  async getJobLogs(jobId: number, params?: { page?: number; page_size?: number }): Promise<PaginatedData<JobLogItem>> {
    try {
      const response = await apiClient.get<ApiResponse<PaginatedData<JobLogItem>>>(
        `/api/v1/admin/jobs/${jobId}/logs`,
        { params }
      );
      return extractApiData(response);
    } catch (error) {
      handleApiError(error);
    }
  },

  async retryJob(jobId: number): Promise<JobItem> {
    try {
      const response = await apiClient.post<ApiResponse<JobItem>>(`/api/v1/admin/jobs/${jobId}:retry`);
      return extractApiData(response);
    } catch (error) {
      handleApiError(error);
    }
  },

  async cancelJob(jobId: number): Promise<JobItem> {
    try {
      const response = await apiClient.post<ApiResponse<JobItem>>(`/api/v1/admin/jobs/${jobId}:cancel`);
      return extractApiData(response);
    } catch (error) {
      handleApiError(error);
    }
  },
};

// ============================================================
// 问答链路追踪 API
// ============================================================

export const qaTracesApi = {
  async getTraces(params?: QATraceQueryParams): Promise<PaginatedData<QATraceItem>> {
    try {
      const response = await apiClient.get<ApiResponse<PaginatedData<QATraceItem>>>(
        '/api/v1/admin/qa-traces',
        { params }
      );
      return extractApiData(response);
    } catch (error) {
      handleApiError(error);
    }
  },

  async getTrace(traceIdOrPk: string | number): Promise<QATraceDetail> {
    try {
      const response = await apiClient.get<ApiResponse<QATraceDetail>>(
        `/api/v1/admin/qa-traces/${traceIdOrPk}`
      );
      return extractApiData(response);
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
  rbac: rbacApi,
  users: usersApi,
  jobs: jobsApi,
  qaTraces: qaTracesApi,
};
