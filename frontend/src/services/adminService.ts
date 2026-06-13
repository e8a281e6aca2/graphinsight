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
  ModelCatalogResponse,
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
  QACostSummary,
  QATraceDetail,
  QATraceItem,
  QATraceQueryParams,
  QATraceStatus,
  QATraceType,
} from '../types/admin';
import { API_BASE_URL } from '../utils/apiBase';
import { clearAdminSession, setAdminToken, syncPreferredAdminHome } from '../utils/adminAuth';

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
      clearAdminSession();
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
  details?: unknown;
  trace_id?: string;
}

type ApiErrorEnvelope = ApiResponse<unknown> & {
  error?: unknown;
};

type ConfigValueMap = Record<string, unknown>;

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
      details: (payload as ApiErrorEnvelope).error,
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

function handleApiError(error: unknown): never {
  console.error('API 错误处理:', error);

  if (error && typeof error === 'object' && !axios.isAxiosError(error) && 'message' in error) {
    const businessError = error as Partial<ApiError>;
    const normalized = {
      message: String(businessError.message || '未知错误'),
      code: businessError.code,
      trace_id: businessError.trace_id,
      details: businessError.details,
    };
    console.error('标准化业务错误:', normalized);
    throw error as ApiError;
  }

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiErrorEnvelope>;
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
      const response = await apiClient.post<ApiResponse<{ user: UserInfo; message: string }>>(
        '/api/v1/admin/auth/register',
        data
      );

      if (typeof response.data?.code === 'number' && response.data.code >= 400) {
        throw {
          message: response.data.message || '注册失败',
          code: response.data.code,
          details: (response.data as ApiErrorEnvelope).error,
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
          details: (response.data as ApiErrorEnvelope).error,
        };
      }

      // 保存 token
      if (response.data.data?.token) {
        setAdminToken(response.data.data.token);
      }
      syncPreferredAdminHome(response.data.data?.user?.preferred_home_path);

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
      clearAdminSession();
    } catch (error) {
      // 即使失败也清除本地 token
      clearAdminSession();
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
      syncPreferredAdminHome(response.data.data?.preferred_home_path);
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
        apiClient.get<ApiResponse<ConfigValueMap>>('/api/v1/admin/config/neo4j/all'),
        apiClient.get<ApiResponse<ConfigValueMap>>('/api/v1/admin/config/ai-service/all'),
        apiClient.get<ApiResponse<ConfigValueMap>>('/api/v1/admin/config/nl2cypher/all'),
      ]);
      const neo4j = extractApiData(neo4jResp);
      const aiService = extractApiData(aiServiceResp);
      const nl2cypher = extractApiData(nl2cypherResp);

      // 转换为 ConfigItem 格式
      const convertToConfigItems = (data: ConfigValueMap, category: string): Record<string, ConfigItem> => {
        const result: Record<string, ConfigItem> = {};
        for (const [key, value] of Object.entries(data)) {
          const isSensitive = key.includes('password') || key.includes('key');
          result[key] = {
            id: 0, // 从 /all 端点获取的数据没有 id
            key,
            value: isSensitive ? '' : String(value ?? ''),
            category,
            description: '',
            is_sensitive: isSensitive,
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
  }): Promise<ModelCatalogResponse> {
    try {
      const response = await apiClient.get<ApiResponse<ModelCatalogResponse | { models: string[] }>>(
        '/api/v1/admin/config/openai/models',
        { params }
      );
      const data = extractApiData(response);
      const fallbackModels = Array.isArray(data)
        ? data.filter((item): item is string => typeof item === 'string')
        : [];
      if (data && typeof data === 'object' && 'models' in data && Array.isArray(data.models)) {
        return {
          models: data.models.filter((item): item is string => typeof item === 'string'),
          catalog: Array.isArray((data as ModelCatalogResponse).catalog)
            ? (data as ModelCatalogResponse).catalog
            : [],
          scenario_profiles:
            typeof (data as ModelCatalogResponse).scenario_profiles === 'object'
              ? (data as ModelCatalogResponse).scenario_profiles
              : undefined,
        };
      }
      return { models: fallbackModels, catalog: [] };
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

  async exportLogsCsv(params: LogQueryParams): Promise<Blob> {
    try {
      const response = await apiClient.get<Blob>('/api/v1/admin/logs', {
        params: {
          ...params,
          export: true,
        },
        responseType: 'blob',
      });
      return response.data;
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
      syncPreferredAdminHome(response.data.data?.preferred_home_path);
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
      syncPreferredAdminHome(response.data.data?.preferred_home_path);
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

  async getCostSummary(params?: {
    qa_type?: QATraceType;
    status?: QATraceStatus;
    window_hours?: number;
  }): Promise<QACostSummary> {
    try {
      const response = await apiClient.get<ApiResponse<QACostSummary>>(
        '/api/v1/admin/qa-traces/cost-summary',
        { params }
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
