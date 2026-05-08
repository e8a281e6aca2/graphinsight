#!/usr/bin/env python3
"""
初始化默认配置
"""
import sys
import os

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from admin.database import SessionLocal
from admin.models import AdminConfig
from sqlalchemy import text

def init_default_configs():
    """初始化默认配置"""
    db = SessionLocal()
    
    try:
        print("开始初始化默认配置...")
        
        # 默认配置列表
        default_configs = [
            # Neo4j 配置
            {
                "category": "neo4j",
                "key": "uri",
                "value": os.getenv("NEO4J_URI", "bolt://localhost:7687"),
                "description": "Neo4j 连接地址",
                "is_sensitive": False
            },
            {
                "category": "neo4j",
                "key": "user",
                "value": os.getenv("NEO4J_USER", os.getenv("NEO4J_USERNAME", "neo4j")),
                "description": "Neo4j 用户名",
                "is_sensitive": False
            },
            {
                "category": "neo4j",
                "key": "password",
                "value": os.getenv("NEO4J_PASSWORD", "password"),
                "description": "Neo4j 密码",
                "is_sensitive": True
            },
            {
                "category": "neo4j",
                "key": "database",
                "value": os.getenv("NEO4J_DATABASE", "neo4j"),
                "description": "Neo4j 数据库名称",
                "is_sensitive": False
            },
            
            # AI 服务配置
            {
                "category": "ai_service",
                "key": "provider",
                "value": os.getenv("AI_PROVIDER", "openai"),
                "description": "AI 服务提供商 (openai/claude)",
                "is_sensitive": False
            },
            {
                "category": "ai_service",
                "key": "enabled",
                "value": os.getenv("AI_ENABLED", "true"),
                "description": "是否启用 AI 服务",
                "is_sensitive": False
            },
            {
                "category": "ai_service",
                "key": "api_key",
                "value": os.getenv("OPENAI_API_KEY", ""),
                "description": "AI 服务 API Key",
                "is_sensitive": True
            },
            {
                "category": "ai_service",
                "key": "base_url",
                "value": os.getenv("OPENAI_BASE_URL", ""),
                "description": "AI 服务 API 地址(可选)",
                "is_sensitive": False
            },
            {
                "category": "ai_service",
                "key": "model",
                "value": os.getenv("OPENAI_MODEL", "gpt-3.5-turbo"),
                "description": "AI 模型名称",
                "is_sensitive": False
            },
            {
                "category": "ai_service",
                "key": "max_tokens",
                "value": os.getenv("OPENAI_MAX_TOKENS", "2000"),
                "description": "最大 Token 数",
                "is_sensitive": False
            },
            {
                "category": "ai_service",
                "key": "temperature",
                "value": os.getenv("OPENAI_TEMPERATURE", "0.7"),
                "description": "温度参数",
                "is_sensitive": False
            },
            
            # NL2Cypher 配置
            {
                "category": "nl2cypher",
                "key": "enabled",
                "value": "true",
                "description": "是否启用 NL2Cypher",
                "is_sensitive": False
            },
            {
                "category": "nl2cypher",
                "key": "cache_size",
                "value": "100",
                "description": "缓存大小",
                "is_sensitive": False
            },
            {
                "category": "nl2cypher",
                "key": "max_limit",
                "value": "1000",
                "description": "最大查询限制",
                "is_sensitive": False
            },
        ]
        
        count = 0
        for config_data in default_configs:
            # 检查是否已存在
            existing = db.query(AdminConfig).filter(
                AdminConfig.category == config_data["category"],
                AdminConfig.key == config_data["key"]
            ).first()
            
            if not existing:
                config = AdminConfig(**config_data)
                db.add(config)
                count += 1
                print(f"  添加配置: {config_data['category']}.{config_data['key']}")
            else:
                print(f"  跳过已存在: {config_data['category']}.{config_data['key']}")
        
        db.commit()
        print(f"\n初始化完成! 添加了 {count} 个配置项")
        
        # 显示当前配置
        print("\n当前配置:")
        configs = db.query(AdminConfig).all()
        for config in configs:
            value = config.value if not config.is_sensitive else "***"
            print(f"  {config.category}.{config.key} = {value}")
        
    except Exception as e:
        print(f"初始化失败: {e}")
        db.rollback()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    init_default_configs()
