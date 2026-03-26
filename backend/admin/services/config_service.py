"""
配置服务
处理配置管理、缓存等业务逻辑
"""
import os
from typing import Optional, Dict, List, Tuple
from functools import lru_cache
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from ..models import AdminUser
from ..crud import config_crud, log_crud
from ..schemas.config import (
    ConfigItem,
    ConfigCreate,
    ConfigUpdate,
    ConfigQuery,
    ConfigBatchUpdate,
)
from ..schemas.logs import LogCreate
from core import (
    BusinessException,
    NotFoundException,
    ValidationException,
    get_logger,
)

logger = get_logger()


class ConfigService:
    """配置服务类"""
    
    def __init__(self):
        self._cache: Dict[str, Tuple[str, datetime]] = {}
        self._cache_ttl = timedelta(minutes=5)  # 缓存5分钟
    
    def _get_cache_key(self, category: str, key: str) -> str:
        """生成缓存键"""
        return f"{category}:{key}"
    
    def _get_from_cache(self, category: str, key: str) -> Optional[str]:
        """从缓存获取配置"""
        cache_key = self._get_cache_key(category, key)
        if cache_key in self._cache:
            value, timestamp = self._cache[cache_key]
            if datetime.utcnow() - timestamp < self._cache_ttl:
                logger.debug(f"从缓存获取配置: {cache_key}")
                return value
            else:
                # 缓存过期，删除
                del self._cache[cache_key]
        return None
    
    def _set_to_cache(self, category: str, key: str, value: str):
        """设置缓存"""
        cache_key = self._get_cache_key(category, key)
        self._cache[cache_key] = (value, datetime.utcnow())
        logger.debug(f"设置缓存: {cache_key}")
    
    def _clear_cache(self, category: Optional[str] = None, key: Optional[str] = None):
        """清除缓存"""
        if category and key:
            cache_key = self._get_cache_key(category, key)
            if cache_key in self._cache:
                del self._cache[cache_key]
                logger.debug(f"清除缓存: {cache_key}")
        elif category:
            # 清除整个分类的缓存
            keys_to_delete = [
                k for k in self._cache.keys()
                if k.startswith(f"{category}:")
            ]
            for k in keys_to_delete:
                del self._cache[k]
            logger.debug(f"清除分类缓存: {category}")
        else:
            # 清除所有缓存
            self._cache.clear()
            logger.debug("清除所有缓存")
    
    def get_config(
        self,
        db: Session,
        category: str,
        key: str,
        default: Optional[str] = None,
        use_cache: bool = True
    ) -> Optional[str]:
        """
        获取配置值
        
        优先级: 缓存 > 数据库 > 环境变量 > 默认值
        """
        try:
            # 1. 尝试从缓存获取
            if use_cache:
                cached_value = self._get_from_cache(category, key)
                if cached_value is not None:
                    return cached_value
            
            # 2. 从数据库获取
            config = config_crud.get_by_key(db, category, key)
            if config:
                value = config.value
                if use_cache:
                    self._set_to_cache(category, key, value)
                return value
            
            # 3. 从环境变量获取
            env_key = f"{category.upper()}_{key.upper()}"
            env_value = os.getenv(env_key)
            if env_value:
                logger.debug(f"从环境变量获取配置: {env_key}")
                return env_value
            
            # 4. 返回默认值
            return default
            
        except Exception as e:
            logger.error(f"获取配置失败: {category}.{key}, {str(e)}")
            return default
    
    def get_config_item(
        self,
        db: Session,
        category: str,
        key: str
    ) -> ConfigItem:
        """获取配置项（完整信息）"""
        try:
            config = config_crud.get_by_key(db, category, key)
            if not config:
                raise NotFoundException(f"配置不存在: {category}.{key}")
            
            return ConfigItem.model_validate(config)
        except NotFoundException:
            raise
        except Exception as e:
            logger.error(f"获取配置项失败: {str(e)}", exc_info=True)
            raise BusinessException("获取配置失败")
    
    def get_config_list(
        self,
        db: Session,
        query: ConfigQuery
    ) -> Tuple[List[ConfigItem], int]:
        """获取配置列表"""
        try:
            items, total = config_crud.get_list(db, query)
            
            # 转换为 Pydantic 模型
            config_items = [ConfigItem.model_validate(item) for item in items]
            
            return config_items, total
        except Exception as e:
            logger.error(f"获取配置列表失败: {str(e)}", exc_info=True)
            raise BusinessException("获取配置列表失败")
    
    def create_config(
        self,
        db: Session,
        config_create: ConfigCreate,
        user: AdminUser,
        ip_address: Optional[str] = None
    ) -> ConfigItem:
        """创建配置"""
        try:
            # 创建配置
            config = config_crud.create(db, config_create, user.id)
            
            # 记录日志
            log_crud.create(db, LogCreate(
                user_id=user.id,
                action="create",
                resource="config",
                resource_id=str(config.id),
                details={
                    "category": config.category,
                    "key": config.key,
                    "is_sensitive": config.is_sensitive
                },
                ip_address=ip_address,
                status="success"
            ))
            
            logger.info(
                f"创建配置: {config.category}.{config.key}",
                context={"user_id": user.id, "config_id": config.id}
            )
            
            return ConfigItem.model_validate(config)
        except Exception as e:
            logger.error(f"创建配置失败: {str(e)}", exc_info=True)
            raise BusinessException("创建配置失败")
    
    def update_config(
        self,
        db: Session,
        category: str,
        key: str,
        config_update: ConfigUpdate,
        user: AdminUser,
        ip_address: Optional[str] = None
    ) -> ConfigItem:
        """更新配置"""
        try:
            # 更新配置
            config = config_crud.update(db, category, key, config_update, user.id)
            if not config:
                raise NotFoundException(f"配置不存在: {category}.{key}")
            
            # 清除缓存
            self._clear_cache(category, key)
            
            # 记录日志
            log_crud.create(db, LogCreate(
                user_id=user.id,
                action="update",
                resource="config",
                resource_id=str(config.id),
                details={
                    "category": category,
                    "key": key,
                    "old_version": config.version - 1,
                    "new_version": config.version
                },
                ip_address=ip_address,
                status="success"
            ))
            
            logger.info(
                f"更新配置: {category}.{key}",
                context={"user_id": user.id, "config_id": config.id}
            )
            
            return ConfigItem.model_validate(config)
        except NotFoundException:
            raise
        except Exception as e:
            logger.error(f"更新配置失败: {str(e)}", exc_info=True)
            raise BusinessException("更新配置失败")
    
    def batch_update_configs(
        self,
        db: Session,
        batch_update: ConfigBatchUpdate,
        user: AdminUser,
        ip_address: Optional[str] = None
    ) -> int:
        """批量更新配置"""
        try:
            # 批量更新
            updated_count = config_crud.batch_update(
                db,
                batch_update.configs,
                user.id
            )
            
            # 清除所有缓存
            self._clear_cache()
            
            # 记录日志
            log_crud.create(db, LogCreate(
                user_id=user.id,
                action="batch_update",
                resource="config",
                details={
                    "count": updated_count,
                    "total": len(batch_update.configs)
                },
                ip_address=ip_address,
                status="success"
            ))
            
            logger.info(
                f"批量更新配置: {updated_count}/{len(batch_update.configs)}",
                context={"user_id": user.id}
            )
            
            return updated_count
        except Exception as e:
            logger.error(f"批量更新配置失败: {str(e)}", exc_info=True)
            raise BusinessException("批量更新配置失败")
    
    def delete_config(
        self,
        db: Session,
        category: str,
        key: str,
        user: AdminUser,
        ip_address: Optional[str] = None
    ) -> bool:
        """删除配置"""
        try:
            # 删除配置
            success = config_crud.delete(db, category, key)
            if not success:
                raise NotFoundException(f"配置不存在: {category}.{key}")
            
            # 清除缓存
            self._clear_cache(category, key)
            
            # 记录日志
            log_crud.create(db, LogCreate(
                user_id=user.id,
                action="delete",
                resource="config",
                details={"category": category, "key": key},
                ip_address=ip_address,
                status="success"
            ))
            
            logger.info(
                f"删除配置: {category}.{key}",
                context={"user_id": user.id}
            )
            
            return True
        except NotFoundException:
            raise
        except Exception as e:
            logger.error(f"删除配置失败: {str(e)}", exc_info=True)
            raise BusinessException("删除配置失败")
    
    # 便捷方法：获取特定分类的配置
    
    def get_ai_service_config(self, db: Session) -> Dict[str, any]:
        """获取 AI 服务配置"""
        return {
            "provider": self.get_config(db, "ai_service", "provider", "openai"),
            "enabled": self.get_config(db, "ai_service", "enabled", "true").lower() == "true",
            "base_url": self.get_config(db, "ai_service", "base_url", ""),
            "api_key": self.get_config(db, "ai_service", "api_key", ""),
            "model": self.get_config(db, "ai_service", "model", "gpt-3.5-turbo"),
            "max_tokens": int(self.get_config(db, "ai_service", "max_tokens", "2000")),
            "temperature": float(self.get_config(db, "ai_service", "temperature", "0.7")),
        }
    
    def get_openai_config(self, db: Session) -> Dict[str, any]:
        """获取 OpenAI 配置（兼容旧代码）"""
        # 为了兼容性，保留这个方法，但实际使用 ai_service 配置
        return self.get_ai_service_config(db)
    
    def get_nl2cypher_config(self, db: Session) -> Dict[str, any]:
        """获取 NL2Cypher 配置"""
        return {
            "enabled": self.get_config(db, "nl2cypher", "enabled", "true").lower() == "true",
            "cache_size": int(self.get_config(db, "nl2cypher", "cache_size", "100")),
            "max_limit": int(self.get_config(db, "nl2cypher", "max_limit", "100")),
        }
    
    def get_neo4j_config(self, db: Session) -> Dict[str, str]:
        """获取 Neo4j 配置"""
        return {
            "uri": self.get_config(db, "neo4j", "uri", "bolt://localhost:7687"),
            "username": self.get_config(db, "neo4j", "username", "neo4j"),
            "password": self.get_config(db, "neo4j", "password", "password"),
            "database": self.get_config(db, "neo4j", "database", "neo4j"),
        }
    
    def init_from_env(
        self,
        db: Session,
        user: AdminUser,
        ip_address: Optional[str] = None
    ) -> int:
        """从环境变量初始化配置"""
        try:
            count = 0
            
            # Neo4j 配置
            neo4j_configs = {
                "uri": os.getenv("NEO4J_URI", "bolt://localhost:7687"),
                "username": os.getenv("NEO4J_USERNAME", "neo4j"),
                "password": os.getenv("NEO4J_PASSWORD", "password"),
                "database": os.getenv("NEO4J_DATABASE", "neo4j"),
            }
            
            for key, value in neo4j_configs.items():
                try:
                    self.set_config(db, "neo4j", key, value)
                    count += 1
                except:
                    pass
            
            # OpenAI 配置
            openai_configs = {
                "api_key": os.getenv("OPENAI_API_KEY", ""),
                "base_url": os.getenv("OPENAI_BASE_URL", ""),
                "model": os.getenv("OPENAI_MODEL", "gpt-3.5-turbo"),
                "max_tokens": os.getenv("OPENAI_MAX_TOKENS", "2000"),
                "temperature": os.getenv("OPENAI_TEMPERATURE", "0.7"),
            }
            
            for key, value in openai_configs.items():
                try:
                    self.set_config(db, "openai", key, value)
                    count += 1
                except:
                    pass
            
            # 记录日志
            log_crud.create(db, LogCreate(
                user_id=user.id,
                action="init_config",
                resource="config",
                details={"count": count},
                ip_address=ip_address,
                status="success"
            ))
            
            logger.info(f"从环境变量初始化配置: {count} 项")
            return count
            
        except Exception as e:
            logger.error(f"初始化配置失败: {str(e)}", exc_info=True)
            raise BusinessException("初始化配置失败")
    
    def test_neo4j_connection(self, db: Session) -> Dict[str, any]:
        """测试 Neo4j 连接"""
        try:
            from services.neo4j_service import get_neo4j_service
            
            # 获取配置
            config = self.get_neo4j_config(db)
            
            # 尝试执行简单查询
            neo4j_service = get_neo4j_service()
            
            # 直接使用driver测试连接
            with neo4j_service.driver.session() as session:
                result = session.run("RETURN 1 as test")
                record = result.single()
                
                if record and record["test"] == 1:
                    return {
                        "success": True,
                        "message": "Neo4j 连接成功"
                    }
                else:
                    return {
                        "success": False,
                        "message": "Neo4j 连接失败: 查询无结果"
                    }
                
        except Exception as e:
            logger.error(f"测试 Neo4j 连接失败: {str(e)}")
            return {
                "success": False,
                "message": f"Neo4j 连接失败: {str(e)}"
            }
    
    def test_ai_service_connection(self, db: Session) -> Dict[str, any]:
        """测试 AI 服务连接"""
        try:
            # 获取配置
            config = self.get_ai_service_config(db)
            provider = config.get("provider", "openai")
            enabled = config.get("enabled", True)
            api_key = config.get("api_key", "")
            
            if not enabled:
                return {
                    "success": False,
                    "message": "AI服务未启用"
                }
            
            if not api_key or not api_key.strip() or api_key == "your-api-key-here":
                return {
                    "success": False,
                    "message": f"{provider.upper()} API Key 未配置"
                }
            
            # 根据不同的 provider 检查格式
            if provider == "openai":
                if not api_key.startswith("sk-"):
                    return {
                        "success": False,
                        "message": "OpenAI API Key 格式不正确（应以 sk- 开头）"
                    }
                return {
                    "success": True,
                    "message": "OpenAI API Key 格式正确"
                }
            elif provider == "claude":
                if not api_key.startswith("sk-ant-"):
                    return {
                        "success": False,
                        "message": "Claude API Key 格式不正确（应以 sk-ant- 开头）"
                    }
                return {
                    "success": True,
                    "message": "Claude API Key 格式正确"
                }
            elif provider == "openai_compatible":
                # OpenAI 兼容接口（智谱、通义千问等），只检查是否配置
                base_url = config.get("base_url", "")
                if not base_url:
                    return {
                        "success": False,
                        "message": "OpenAI 兼容接口需要配置 API 地址"
                    }
                return {
                    "success": True,
                    "message": f"OpenAI 兼容接口已配置 (API: {base_url})"
                }
            else:
                # 其他 provider，只检查是否配置
                return {
                    "success": True,
                    "message": f"{provider.upper()} API Key 已配置"
                }
                
        except Exception as e:
            logger.error(f"测试 AI 服务连接失败: {str(e)}")
            return {
                "success": False,
                "message": f"测试失败: {str(e)}"
            }
    
    def test_openai_connection(self, db: Session) -> Dict[str, any]:
        """测试 OpenAI 连接（兼容旧代码）"""
        return self.test_ai_service_connection(db)
    
    def get_available_models(self, db: Session) -> List[str]:
        """获取可用的 AI 模型列表"""
        # 默认模型列表
        openai_models = [
            "gpt-4o",
            "gpt-4o-mini", 
            "gpt-4-turbo",
            "gpt-4-turbo-preview",
            "gpt-4",
            "gpt-3.5-turbo",
            "gpt-3.5-turbo-16k",
        ]
        
        claude_models = [
            "claude-3-5-sonnet-20241022",
            "claude-3-opus-20240229",
            "claude-3-sonnet-20240229",
            "claude-3-haiku-20240307",
            "claude-2.1",
        ]
        
        # 智谱 GLM 模型列表
        zhipu_models = [
            "glm-4-plus",
            "glm-4-0520",
            "glm-4",
            "glm-4-air",
            "glm-4-airx",
            "glm-4-long",
            "glm-4-flash",
            "glm-4v-plus",
            "glm-4v",
        ]
        
        try:
            config = self.get_ai_service_config(db)
            provider = config.get("provider", "openai")
            api_key = config.get("api_key", "")
            base_url = config.get("base_url", "")
            
            logger.info(f"获取模型列表 - provider: {provider}, has_api_key: {bool(api_key and len(api_key) > 5)}, base_url: {base_url}")
            
            # 对于 OpenAI 兼容接口或配置了自定义 base_url 的情况，尝试动态获取模型
            if api_key and len(api_key) > 10 and (provider in ["openai", "openai_compatible"] or base_url):
                try:
                    import httpx
                    
                    # 使用配置的 base_url 或默认 OpenAI API
                    api_base = base_url.rstrip('/') if base_url else "https://api.openai.com/v1"
                    url = f"{api_base}/models"
                    
                    headers = {
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json"
                    }
                    
                    logger.info(f"尝试从 API 获取模型列表: {url}")
                    
                    with httpx.Client(timeout=15.0) as client:
                        response = client.get(url, headers=headers)
                        
                        if response.status_code == 200:
                            data = response.json()
                            models = [m["id"] for m in data.get("data", [])]
                            
                            if models:
                                # 按名称排序
                                models.sort(reverse=True)
                                logger.info(f"从 API 获取到 {len(models)} 个模型: {models[:5]}...")
                                return models[:30]  # 最多返回 30 个
                        else:
                            logger.warning(f"获取模型列表失败: HTTP {response.status_code} - {response.text[:200]}")
                except Exception as e:
                    logger.warning(f"从 API 获取模型列表失败: {str(e)}")
            
            # 返回静态列表作为后备
            if provider == "claude":
                logger.info(f"返回 Claude 静态模型列表: {len(claude_models)} 个")
                return claude_models
            elif provider == "openai_compatible":
                # 对于 OpenAI 兼容接口，返回智谱模型列表作为示例
                logger.info(f"返回智谱 GLM 静态模型列表: {len(zhipu_models)} 个")
                return zhipu_models
            else:
                logger.info(f"返回 OpenAI 静态模型列表: {len(openai_models)} 个")
                return openai_models
                
        except Exception as e:
            logger.error(f"获取模型列表异常: {str(e)}", exc_info=True)
            # 返回默认列表
            return openai_models
    
    def get_available_openai_models(self, db: Session) -> List[str]:
        """获取可用的 OpenAI 模型列表（兼容旧代码）"""
        return self.get_available_models(db)


# 创建全局实例
config_service = ConfigService()
