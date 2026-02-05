"""
GraphInsight Backend API
多模态知识图谱可视化平台后端服务
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from fastapi import Request, status
import os
from config import get_settings

# 导入核心模块
from core import (
    init_logger,
    LogConfig,
    RequestLoggingMiddleware,
    RateLimitMiddleware,
    ErrorHandlingMiddleware,
    DEFAULT_RATE_LIMITS,
    AppException,
    success_response,
    error_response,
)

# 获取配置
settings = get_settings()

# 初始化日志系统
init_logger(LogConfig(
    level="INFO",
    format_type="json",
    output="both",
    log_dir="logs",
    log_file="app.log"
))

# 创建 FastAPI 应用
app = FastAPI(
    title="GraphInsight API",
    description="多模态知识图谱可视化平台 API",
    version="2.0.0",  # 升级版本号
    docs_url="/docs",
    redoc_url="/redoc"
)

# 注册全局异常处理器
@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    """应用异常处理"""
    return JSONResponse(
        status_code=exc.status_code,
        content=error_response(
            message=exc.message,
            code=exc.status_code,
            error_code=exc.error_code,
            error_type=type(exc).__name__,
            details=exc.details
        )
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """通用异常处理"""
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=error_response(
            message="系统内部错误",
            code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            error_code="5000",
            error_type="InternalError"
        )
    )


# 配置中间件（顺序很重要：从下到上执行）
# 1. CORS（最先执行）
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite 默认端口
        "http://localhost:5174",  # Vite 备用端口
        "http://localhost:3000",  # 备用端口
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. 错误处理中间件
app.add_middleware(ErrorHandlingMiddleware, debug=False)

# 3. 限流中间件
app.add_middleware(
    RateLimitMiddleware,
    default_limit=60,
    path_limits=DEFAULT_RATE_LIMITS
)

# 4. 请求日志中间件（最后执行，记录所有请求）
app.add_middleware(RequestLoggingMiddleware)

# 创建 media 目录（如果不存在）
MEDIA_DIR = os.path.join(os.path.dirname(__file__), settings.media_storage_path)
os.makedirs(MEDIA_DIR, exist_ok=True)

# 挂载静态文件服务
app.mount("/api/media", StaticFiles(directory=MEDIA_DIR), name="media")


@app.on_event("startup")
async def startup_event():
    """应用启动事件"""
    print("GraphInsight API 启动中...")
    print(f"媒体文件目录: {MEDIA_DIR}")
    print(f"Neo4j URI: {settings.neo4j_uri}")
    print(f"API 文档: http://{settings.api_host}:{settings.api_port}/docs")
    
    # 初始化管理系统数据库
    try:
        from admin.database import init_db
        init_db()
        print("管理系统数据库初始化成功")
    except Exception as e:
        print(f"警告: 管理系统数据库初始化失败: {str(e)}")


@app.on_event("shutdown")
async def shutdown_event():
    """应用关闭事件"""
    print("GraphInsight API 关闭")


@app.get("/")
async def root():
    """根路径"""
    return success_response(
        data={
            "name": "GraphInsight API",
            "version": "2.0.0",
            "status": "running",
            "docs": "/docs",
            "features": [
                "多模态知识图谱可视化",
                "自然语言转 Cypher",
                "管理系统",
                "系统监控"
            ]
        },
        message="欢迎使用 GraphInsight API"
    )


@app.get("/health")
async def health_check():
    """健康检查（公开接口）"""
    return success_response(
        data={
            "status": "healthy",
            "neo4j_uri": settings.neo4j_uri,
            "media_dir": MEDIA_DIR
        },
        message="服务正常"
    )


# 导入并注册业务 API 路由
from api.routes import query, node, expand, media, nl2cypher
app.include_router(query.router, prefix="/api", tags=["图谱查询"])
app.include_router(node.router, prefix="/api", tags=["节点操作"])
app.include_router(expand.router, prefix="/api", tags=["图谱扩展"])
app.include_router(media.router, prefix="/api", tags=["媒体文件"])
app.include_router(nl2cypher.router, prefix="/api", tags=["AI 查询"])

# 导入并注册新的标准化管理 API
from admin.api.endpoints import auth as new_auth, config as new_config, monitor as new_monitor, logs as new_logs, profile
app.include_router(new_auth.router, prefix="/api/v1", tags=["认证"])
app.include_router(new_config.router, prefix="/api/v1", tags=["配置管理"])
app.include_router(new_monitor.router, prefix="/api/v1", tags=["系统监控"])
app.include_router(new_logs.router, prefix="/api/v1", tags=["日志管理"])
app.include_router(profile.router, prefix="/api/v1", tags=["个人设置"])

# 注意：旧的管理路由已被新的标准化 API 替代
# 如需使用旧路由，请手动导入并注册
# from admin.routes import auth, config, monitor, logs


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=settings.api_host,
        port=settings.api_port,
        log_level="info"
    )
