"""
中间件系统
包含请求日志、限流、错误处理等中间件
"""
import time
import uuid
import json
from typing import Callable, Dict, Optional
from collections import defaultdict
from datetime import datetime, timedelta
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from .logger import get_logger
from .response import ResponseBuilder
from .exceptions import RateLimitException
from .observability import get_api_observability


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """请求日志中间件"""
    
    def __init__(self, app, logger=None):
        super().__init__(app)
        self.logger = logger or get_logger()
        self.metrics = get_api_observability()
    
    async def _normalize_json_envelope(self, request: Request, response: Response, trace_id: str) -> Response:
        """
        标准化 JSON 响应：
        1) 统一补充 trace_id（便于排障）
        2) 若 body.code 与 HTTP status 不一致，以错误语义优先
        """
        content_type = response.headers.get("content-type", "").lower()
        if "application/json" not in content_type:
            return response

        # 读取原始 body（call_next 返回的响应通常是流式）
        body = b""
        try:
            async for chunk in response.body_iterator:
                body += chunk
        except Exception:
            return response

        if not body:
            return response

        try:
            payload = json.loads(body)
        except Exception:
            # 非 JSON 文本，按原样返回
            new_response = Response(
                content=body,
                status_code=response.status_code,
                media_type=response.media_type,
            )
            for key, value in response.headers.items():
                if key.lower() != "content-length":
                    new_response.headers[key] = value
            return new_response

        status_code = response.status_code
        if isinstance(payload, dict):
            payload.setdefault("trace_id", trace_id)

            payload_code = payload.get("code")
            if isinstance(payload_code, int):
                if status_code < 400 and payload_code >= 400:
                    status_code = payload_code
                elif status_code >= 400 and payload_code < 400:
                    payload["code"] = status_code
            elif status_code >= 400:
                payload["code"] = status_code

            if status_code >= 400 and "error" not in payload:
                payload["error"] = {
                    "error_code": str(status_code),
                    "error_type": "HTTPError",
                    "details": {
                        "path": request.url.path,
                        "method": request.method,
                    },
                }

        new_response = JSONResponse(content=payload, status_code=status_code)
        for key, value in response.headers.items():
            if key.lower() != "content-length":
                new_response.headers[key] = value
        return new_response

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """处理请求"""
        # 复用网关传入的 trace_id，缺失时才生成，确保 Go -> Python 链路可对账。
        trace_id = request.headers.get("x-trace-id") or request.headers.get("X-Trace-Id") or str(uuid.uuid4())
        request.state.trace_id = trace_id
        
        # 记录请求开始
        start_time = time.time()
        
        # 获取客户端 IP
        client_ip = request.client.host if request.client else "unknown"
        
        # 记录请求信息
        auth_context = {
            "auth_user_id": request.headers.get("x-auth-user-id"),
            "auth_user_name": request.headers.get("x-auth-user-name"),
            "auth_user_email": request.headers.get("x-auth-user-email"),
            "authz_permission": request.headers.get("x-authz-permission"),
            "authz_reason": request.headers.get("x-authz-reason"),
        }
        self.logger.info(
            f"请求开始: {request.method} {request.url.path}",
            context={
                "method": request.method,
                "path": request.url.path,
                "query_params": dict(request.query_params),
                "client_ip": client_ip,
                "user_agent": request.headers.get("user-agent", ""),
                **auth_context,
            },
            trace_id=trace_id
        )
        
        # 处理请求
        try:
            response = await call_next(request)
            response = await self._normalize_json_envelope(request, response, trace_id)
            
            # 计算响应时间
            duration = time.time() - start_time
            
            # 记录响应信息
            self.logger.info(
                f"请求完成: {request.method} {request.url.path}",
                context={
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": round(duration * 1000, 2),
                    "client_ip": client_ip,
                    **auth_context,
                },
                trace_id=trace_id
            )
            self.metrics.record_request(
                method=request.method,
                path=request.url.path,
                status_code=response.status_code,
                duration_ms=round(duration * 1000, 3),
                trace_id=trace_id,
            )
            
            # 添加响应头
            response.headers["X-Trace-ID"] = trace_id
            response.headers["X-Response-Time"] = f"{duration:.3f}s"
            
            return response
            
        except Exception as e:
            # 记录异常
            duration = time.time() - start_time
            self.logger.error(
                f"请求异常: {request.method} {request.url.path}",
                context={
                    "method": request.method,
                    "path": request.url.path,
                    "error": str(e),
                    "duration_ms": round(duration * 1000, 2),
                    "client_ip": client_ip,
                },
                trace_id=trace_id,
                exc_info=True
            )
            self.metrics.record_request(
                method=request.method,
                path=request.url.path,
                status_code=500,
                duration_ms=round(duration * 1000, 3),
                trace_id=trace_id,
            )
            raise


class RateLimitMiddleware(BaseHTTPMiddleware):
    """限流中间件"""
    
    def __init__(
        self,
        app,
        default_limit: int = 60,  # 默认每分钟 60 次
        window_seconds: int = 60,  # 时间窗口（秒）
        path_limits: Optional[Dict[str, int]] = None,
        logger=None
    ):
        super().__init__(app)
        self.default_limit = default_limit
        self.window_seconds = window_seconds
        self.path_limits = path_limits or {}
        self.logger = logger or get_logger()
        
        # 存储请求记录: {ip: {path: [(timestamp, count)]}}
        self.request_records: Dict[str, Dict[str, list]] = defaultdict(
            lambda: defaultdict(list)
        )
    
    def _get_limit(self, path: str) -> int:
        """获取路径的限流配置"""
        # 精确匹配
        if path in self.path_limits:
            return self.path_limits[path]
        
        # 前缀匹配
        for pattern, limit in self.path_limits.items():
            if path.startswith(pattern):
                return limit
        
        return self.default_limit
    
    def _clean_old_records(self, records: list, current_time: datetime):
        """清理过期记录"""
        cutoff_time = current_time - timedelta(seconds=self.window_seconds)
        return [
            (timestamp, count)
            for timestamp, count in records
            if timestamp > cutoff_time
        ]
    
    def _check_rate_limit(self, client_ip: str, path: str) -> tuple[bool, int, int]:
        """
        检查是否超过限流
        
        Returns:
            (是否允许, 当前请求数, 限制数)
        """
        current_time = datetime.now()
        limit = self._get_limit(path)
        
        # 获取该 IP 和路径的请求记录
        records = self.request_records[client_ip][path]
        
        # 清理过期记录
        records = self._clean_old_records(records, current_time)
        self.request_records[client_ip][path] = records
        
        # 计算当前窗口内的请求数
        current_count = sum(count for _, count in records)
        
        # 检查是否超限
        if current_count >= limit:
            return False, current_count, limit
        
        # 添加新记录
        records.append((current_time, 1))
        
        return True, current_count + 1, limit
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """处理请求"""
        # 获取客户端 IP
        client_ip = request.client.host if request.client else "unknown"
        path = request.url.path
        
        # 跳过健康检查等路径
        if path in ["/health", "/docs", "/redoc", "/openapi.json"]:
            return await call_next(request)
        
        # 检查限流
        allowed, current_count, limit = self._check_rate_limit(client_ip, path)
        
        if not allowed:
            # 记录限流日志
            self.logger.warning(
                f"请求被限流: {path}",
                context={
                    "client_ip": client_ip,
                    "path": path,
                    "current_count": current_count,
                    "limit": limit,
                }
            )
            
            # 返回 429 错误
            error_response = ResponseBuilder.error(
                message="请求过于频繁，请稍后再试",
                code=429,
                error_code="6001",
                error_type="RateLimitError",
                details={
                    "limit": limit,
                    "window_seconds": self.window_seconds,
                    "retry_after": self.window_seconds
                }
            )
            
            return JSONResponse(
                status_code=429,
                content=error_response,
                headers={
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(self.window_seconds),
                    "Retry-After": str(self.window_seconds)
                }
            )
        
        # 处理请求
        response = await call_next(request)
        
        # 添加限流信息到响应头
        remaining = limit - current_count
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(self.window_seconds)
        
        return response


class ErrorHandlingMiddleware(BaseHTTPMiddleware):
    """错误处理中间件"""
    
    def __init__(self, app, debug: bool = False, logger=None):
        super().__init__(app)
        self.debug = debug
        self.logger = logger or get_logger()
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """处理请求"""
        try:
            return await call_next(request)
        except Exception as e:
            # 记录错误
            trace_id = getattr(request.state, "trace_id", None)
            self.logger.error(
                f"未处理的异常: {str(e)}",
                context={
                    "path": request.url.path,
                    "method": request.method,
                    "error_type": type(e).__name__,
                },
                trace_id=trace_id,
                exc_info=True
            )
            
            # 构造错误响应
            error_details = None
            if self.debug:
                # 开发环境显示详细错误
                import traceback
                error_details = {
                    "error_type": type(e).__name__,
                    "traceback": traceback.format_exc()
                }
            
            error_response = ResponseBuilder.error(
                message="系统内部错误" if not self.debug else str(e),
                code=500,
                error_code="5000",
                error_type="InternalError",
                details=error_details
            )
            
            return JSONResponse(
                status_code=500,
                content=error_response
            )


# 限流配置
DEFAULT_RATE_LIMITS = {
    "/api/admin/auth/login": 5,  # 登录接口 5次/分钟
    "/api/admin/config": 10,  # 配置接口 10次/分钟
    "/api/admin": 30,  # 管理接口 30次/分钟
}
