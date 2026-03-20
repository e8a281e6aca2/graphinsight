"""
配置管理
"""
import os
from pathlib import Path
from dotenv import load_dotenv
from functools import lru_cache

# 强制重新加载 .env 文件
_env_path = Path(__file__).resolve().parent / ".env"
if _env_path.exists():
    load_dotenv(dotenv_path=_env_path, override=True)
else:
    load_dotenv(override=True)


class Settings:
    """应用配置"""
    
    def __init__(self):
        # Neo4j 配置
        self.neo4j_uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
        self.neo4j_user = os.getenv("NEO4J_USER", "neo4j")
        self.neo4j_password = os.getenv("NEO4J_PASSWORD", "password")
        
        # API 配置
        self.api_host = os.getenv("API_HOST", "0.0.0.0")
        self.api_port = int(os.getenv("API_PORT", "8000"))
        
        # 媒体存储路径
        self.media_storage_path = os.getenv("MEDIA_STORAGE_PATH", "./media")

        # 文档存储路径（用于建图与问答）
        self.document_storage_path = os.getenv("DOCUMENT_STORAGE_PATH", "./documents")
        
        # OpenAI 配置
        self.openai_api_key = os.getenv("OPENAI_API_KEY", "")
        self.openai_model = os.getenv("OPENAI_MODEL", "gpt-3.5-turbo")
        self.openai_max_tokens = int(os.getenv("OPENAI_MAX_TOKENS", "500"))
        self.openai_temperature = float(os.getenv("OPENAI_TEMPERATURE", "0.1"))

        # LLM 实体抽取配置（OpenAI 兼容）
        self.llm_enabled = os.getenv("LLM_ENABLED", "true").lower() == "true"
        self.llm_api_key = os.getenv("LLM_API_KEY") or self.openai_api_key
        self.llm_base_url = os.getenv("LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL", "")
        self.llm_model = os.getenv("LLM_MODEL") or self.openai_model
        self.llm_max_entities = int(os.getenv("LLM_MAX_ENTITIES", "12"))
        self.llm_temperature = float(os.getenv("LLM_TEMPERATURE", "0.1"))

        # LLM 问答配置（默认复用 LLM_MODEL）
        self.llm_qa_model = os.getenv("LLM_QA_MODEL") or self.llm_model
        self.llm_qa_temperature = float(os.getenv("LLM_QA_TEMPERATURE", "0.2"))
        self.llm_qa_max_tokens = int(os.getenv("LLM_QA_MAX_TOKENS", "600"))
        self.llm_qa_max_context = int(os.getenv("LLM_QA_MAX_CONTEXT", "4"))
        
        # NL2Cypher 配置
        self.nl2cypher_enabled = os.getenv("NL2CYPHER_ENABLED", "true").lower() == "true"
        self.nl2cypher_cache_size = int(os.getenv("NL2CYPHER_CACHE_SIZE", "100"))
        self.nl2cypher_max_limit = int(os.getenv("NL2CYPHER_MAX_LIMIT", "100"))


@lru_cache()
def get_settings() -> Settings:
    """获取配置单例"""
    return Settings()
