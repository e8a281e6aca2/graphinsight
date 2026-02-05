/**
 * 管理系统类型定义
 * 适配新的标准化 API
 */

// ============================================================
// 标准化响应类型
// ============================================================

/**
 * 标准化 API 响应
 */
export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data?: T;
  timestamp: string;
}

/**
 * 错误详情
 */
export interface ErrorDetail {
  error_code: string;
  error_type: string;
  details?: any;
}

/**
 * 错误响应
 */
export interface ApiErrorResponse {
  code: number;
  message: string;
  error: ErrorDetail;
  timestamp: string;
}

/**
 * 分页数据
 */
export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/**
 * 分页响应
 */
export type PaginatedResponse<T> = ApiResponse<PaginatedData<T>>;

// ============================================================
// 认证相关类型
// ============================================================

/**
 * 登录请求
 */
export interface LoginRequest {
  username: string;
  password: string;
}

/**
 * 用户信息
 */
export interface UserInfo {
  id: number;
  username: string;
  email?: string;
  is_active: boolean;
  created_at: string;
  last_login?: string;
  login_count: number;
}

/**
 * 登录响应数据
 */
export interface LoginResponseData {
  token: string;
  expires_in: number;
  user: UserInfo;
}

/**
 * 修改密码请求
 */
export interface ChangePasswordRequest {
  old_password: string;
  new_password: string;
}

// ============================================================
// 配置相关类型
// ============================================================

/**
 * 配置分类类型
 */
export type ConfigCategory = 'neo4j' | 'openai' | 'ai_service' | 'nl2cypher';

/**
 * 配置项
 */
export interface ConfigItem {
  id: number;
  category: string;
  key: string;
  value: string;
  description?: string;
  is_sensitive: boolean;
  is_encrypted: boolean;
  updated_by?: number;
  updated_at: string;
  version: number;
}

/**
 * 配置创建请求
 */
export interface ConfigCreateRequest {
  category: string;
  key: string;
  value: string;
  description?: string;
  is_sensitive: boolean;
}

/**
 * 配置更新请求
 */
export interface ConfigUpdateRequest {
  value: string;
  description?: string;
}

/**
 * 配置查询参数
 */
export interface ConfigQueryParams {
  category?: string;
  key?: string;
  is_sensitive?: boolean;
  page?: number;
  page_size?: number;
}

/**
 * 批量更新配置请求
 */
export interface ConfigBatchUpdateRequest {
  configs: Array<{
    category: string;
    key: string;
    value: string;
  }>;
}

/**
 * OpenAI 配置
 */
export interface OpenAIConfig {
  base_url: string;
  api_key: string;
  model: string;
  max_tokens: number;
  temperature: number;
}

/**
 * NL2Cypher 配置
 */
export interface NL2CypherConfig {
  enabled: boolean;
  cache_size: number;
  max_limit: number;
}

/**
 * Neo4j 配置
 */
export interface Neo4jConfig {
  uri: string;
  username: string;
  password: string;
  database: string;
}

// ============================================================
// 监控相关类型
// ============================================================

/**
 * 系统统计
 */
export interface SystemStats {
  cpu_percent: number;
  memory_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  disk_percent: number;
  disk_used_gb: number;
  disk_total_gb: number;
  uptime_seconds: number;
  timestamp: string;
}

/**
 * 数据库状态
 */
export interface DatabaseStatus {
  connected: boolean;
  database: string;
  tables_count?: number;
  message?: string;
  error?: string;
}

/**
 * Neo4j 状态
 */
export interface Neo4jStatus {
  connected: boolean;
  uri: string;
  database: string;
  nodes_count?: number;
  relationships_count?: number;
  message?: string;
  error?: string;
}

/**
 * 健康状态
 */
/**
 * OpenAI 状态
 */
export interface OpenAIStatus {
  configured: boolean;
  message: string;
  error?: string;
}

/**
 * AI服务状态
 */
export interface AIServiceStatus {
  connected: boolean;
  service_name: string;
  model?: string;
  api_key_configured: boolean;
  error?: string;
}

/**
 * 健康状态
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  database: DatabaseStatus;
  neo4j: Neo4jStatus;
  ai_service?: AIServiceStatus;
  openai?: OpenAIStatus;
  system?: SystemStats;
  checks: Record<string, boolean>;
}

// ============================================================
// 日志相关类型
// ============================================================

/**
 * 日志项
 */
export interface LogItem {
  id: number;
  user_id?: number;
  username?: string;
  action: string;
  resource?: string;
  resource_id?: string;
  details?: string;
  ip_address?: string;
  user_agent?: string;
  status: 'success' | 'failed';
  error_message?: string;
  created_at: string;
}

/**
 * 日志详情
 */
export interface LogDetail {
  id: number;
  user_id?: number;
  username?: string;
  action: string;
  resource?: string;
  resource_id?: string;
  details?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  status: 'success' | 'failed';
  error_message?: string;
  created_at: string;
}

/**
 * 日志查询参数
 */
export interface LogQueryParams {
  user_id?: number;
  action?: string;
  resource?: string;
  status?: 'success' | 'failed';
  start_date?: string;
  end_date?: string;
  ip_address?: string;
  page?: number;
  page_size?: number;
}

/**
 * 日志统计
 */
export interface LogStats {
  total_logs: number;
  success_count: number;
  failed_count: number;
  success_rate: number;
  action_stats: Record<string, number>;
  user_stats: Record<string, number>;
  hourly_stats: Record<string, number>;
}

// ============================================================
// 错误码常量
// ============================================================

export const ErrorCode = {
  // 通用错误 (1xxx)
  UNKNOWN_ERROR: '1000',
  INVALID_REQUEST: '1001',
  NOT_FOUND: '1002',
  
  // 认证错误 (2xxx)
  UNAUTHORIZED: '2001',
  TOKEN_EXPIRED: '2002',
  INVALID_TOKEN: '2003',
  INVALID_CREDENTIALS: '2004',
  USER_DISABLED: '2005',
  
  // 业务错误 (3xxx)
  BUSINESS_ERROR: '3000',
  RESOURCE_NOT_FOUND: '3001',
  RESOURCE_ALREADY_EXISTS: '3002',
  
  // 验证错误 (4xxx)
  VALIDATION_ERROR: '4001',
  MISSING_PARAMETER: '4002',
  INVALID_PARAMETER: '4003',
  
  // 系统错误 (5xxx)
  INTERNAL_ERROR: '5000',
  DATABASE_ERROR: '5001',
  SERVICE_UNAVAILABLE: '5003',
  
  // 限流错误 (6xxx)
  RATE_LIMIT_EXCEEDED: '6001',
} as const;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

// ============================================================
// 个人设置相关类型
// ============================================================

/**
 * 个人资料信息
 */
export interface ProfileInfo {
  id: number;
  username: string;
  email: string;
  full_name?: string;
  phone?: string;
  avatar?: string;
  is_active: boolean;
  created_at: string;
  last_login?: string;
  login_count: number;
  last_login_ip?: string;
}

/**
 * 个人资料更新请求
 */
export interface ProfileUpdateRequest {
  email?: string;
  full_name?: string;
  phone?: string;
}

/**
 * 修改密码请求（个人设置）
 */
export interface PasswordChangeRequest {
  old_password: string;
  new_password: string;
  confirm_password: string;
}

/**
 * 登录历史记录
 */
export interface LoginHistory {
  id: number;
  ip_address: string;
  user_agent: string;
  login_time: string;
  status: 'success' | 'failed';
}
