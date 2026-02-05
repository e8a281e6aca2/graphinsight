"""
NL2Cypher 服务
将自然语言转换为 Cypher 查询
"""
from typing import Dict, List, Optional
import json
import re
from functools import lru_cache
from openai import AsyncOpenAI
from config import get_settings
from services.schema_service import SchemaService


class NL2CypherService:
    """将自然语言转换为 Cypher 查询的服务"""
    
    def __init__(self):
        self.settings = get_settings()
        self.schema_service = SchemaService()
        
    def _get_ai_client(self) -> AsyncOpenAI:
        """获取 AI 客户端（使用数据库配置）"""
        try:
            from admin.database import SessionLocal
            from admin.services.config_service import config_service
            
            db = SessionLocal()
            try:
                config = config_service.get_ai_service_config(db)
                
                client_kwargs = {"api_key": config["api_key"]}
                if config["base_url"]:
                    client_kwargs["base_url"] = config["base_url"]
                
                return AsyncOpenAI(**client_kwargs)
            finally:
                db.close()
        except:
            # 回退到环境变量配置
            return AsyncOpenAI(api_key=self.settings.openai_api_key)
    
    def _get_nl2cypher_config(self) -> dict:
        """获取 NL2Cypher 配置（使用数据库配置）"""
        try:
            from admin.database import SessionLocal
            from admin.services.config_service import config_service
            
            db = SessionLocal()
            try:
                return config_service.get_nl2cypher_config(db)
            finally:
                db.close()
        except:
            # 回退到环境变量配置
            return {
                "enabled": self.settings.nl2cypher_enabled,
                "max_limit": self.settings.nl2cypher_max_limit,
            }
    
    def _get_ai_params(self) -> dict:
        """获取 AI 参数（使用数据库配置）"""
        try:
            from admin.database import SessionLocal
            from admin.services.config_service import config_service
            
            db = SessionLocal()
            try:
                config = config_service.get_ai_service_config(db)
                return {
                    "model": config["model"],
                    "temperature": config["temperature"],
                    "max_tokens": config["max_tokens"],
                }
            finally:
                db.close()
        except:
            # 回退到环境变量配置
            return {
                "model": self.settings.openai_model,
                "temperature": self.settings.openai_temperature,
                "max_tokens": self.settings.openai_max_tokens,
            }
        
    async def convert(
        self,
        natural_language: str,
        context: Optional[Dict] = None
    ) -> Dict:
        """
        将自然语言转换为 Cypher 查询
        
        Args:
            natural_language: 用户输入的自然语言
            context: 上下文信息（可选）
            
        Returns:
            包含 Cypher 查询和解释的字典
        """
        # 检查配置（优先使用数据库配置）
        nl2cypher_config = self._get_nl2cypher_config()
        if not nl2cypher_config.get("enabled", True):
            return {
                "success": False,
                "error": "NL2Cypher 功能未启用"
            }
        
        # 验证 AI API Key
        try:
            from admin.database import SessionLocal
            from admin.services.config_service import config_service
            
            db = SessionLocal()
            try:
                ai_config = config_service.get_ai_service_config(db)
                api_key = ai_config.get("api_key", "")
                enabled = ai_config.get("enabled", True)
            finally:
                db.close()
        except:
            api_key = self.settings.openai_api_key
            enabled = True
        
        if not enabled:
            return {
                "success": False,
                "error": "AI 服务未启用"
            }
        
        if not api_key:
            return {
                "success": False,
                "error": "AI API Key 未配置"
            }
        
        try:
            # 构建 prompt
            prompt = await self._build_prompt(natural_language, context)
            
            # 调用 LLM
            response = await self._call_llm(prompt)
            
            # 解析响应
            result = self._parse_response(response)
            
            # 验证和优化 Cypher
            result['cypher'] = self._validate_and_fix_cypher(result['cypher'])
            
            result['success'] = True
            return result
            
        except Exception as e:
            import traceback
            print(f"[ERROR] NL2Cypher conversion failed: {e}")
            traceback.print_exc()
            return {
                "success": False,
                "error": f"生成失败: {str(e)}",
                "suggestions": [
                    "请更具体地描述你想查询的内容",
                    "尝试使用示例格式：'查找 [节点类型] 和它的 [关系]'",
                    "检查 OpenAI API Key 是否正确配置"
                ]
            }
    
    async def _build_prompt(
        self,
        natural_language: str,
        context: Optional[Dict]
    ) -> List[Dict]:
        """构建 LLM prompt"""
        
        # 获取 Schema 信息（同步调用）
        schema_summary = self.schema_service.get_schema_summary()
        
        # 获取最大限制配置
        nl2cypher_config = self._get_nl2cypher_config()
        max_limit = nl2cypher_config.get("max_limit", 100)
        
        # System Prompt
        system_prompt = f"""你是一个 Neo4j Cypher 查询生成器。根据用户的自然语言生成精确的 Cypher 查询。

数据库 Schema:
{schema_summary}

重要规则：
1. 必须根据用户提到的具体名称生成查询，如用户说"小麦"，则查询 {{name: '小麦'}}
2. 查询格式：MATCH (n {{name: '具体名称'}})-[r]-(m) RETURN n, r, m LIMIT {max_limit}
3. 中文属性值必须用单引号包围
4. 必须返回节点和关系：RETURN n, r, m

输出格式（严格JSON，不要添加任何其他文字）：
{{"cypher": "MATCH (n {{name: '用户提到的名称'}})-[r]-(m) RETURN n, r, m LIMIT {max_limit}", "explanation": "查询说明", "confidence": 0.9}}"""

        # User Prompt
        user_prompt = f"""用户查询：{natural_language}

请根据用户查询中提到的具体名称（如"小麦"、"郑麦136"等）生成精确的 Cypher 查询。"""
        
        # 添加上下文信息
        if context:
            if context.get("recent_queries"):
                user_prompt += f"\n\n最近查询历史：\n{context['recent_queries']}"
        
        # 构建消息列表
        messages = [
            {"role": "system", "content": system_prompt},
        ]
        
        # 添加 Few-shot 示例
        examples = self._get_examples()
        for example in examples:
            messages.append({"role": "user", "content": example["nl"]})
            messages.append({"role": "assistant", "content": json.dumps({
                "cypher": example["cypher"],
                "explanation": example["explanation"],
                "confidence": 0.95
            }, ensure_ascii=False)})
        
        # 添加用户查询
        messages.append({"role": "user", "content": user_prompt})
        
        return messages
    
    def _get_examples(self) -> List[Dict]:
        """获取 Few-shot 示例"""
        return [
            {
                "nl": "查找郑麦136的相关节点信息",
                "cypher": "MATCH (n {name: '郑麦136'})-[r]-(m) RETURN n, r, m LIMIT 50",
                "explanation": "查询名为'郑麦136'的节点及其所有相关联的节点和关系"
            },
            {
                "nl": "显示小麦和它的病害",
                "cypher": "MATCH (c {name: '小麦'})-[r]-(d) RETURN c, r, d LIMIT 50",
                "explanation": "查询小麦节点及其所有关联的节点和关系"
            },
            {
                "nl": "查找所有作物",
                "cypher": "MATCH (n:Crop)-[r]-(m) RETURN n, r, m LIMIT 50",
                "explanation": "查询所有Crop类型的节点及其关联的节点和关系"
            },
            {
                "nl": "找出影响玉米的害虫",
                "cypher": "MATCH (c {name: '玉米'})-[r]-(p) RETURN c, r, p LIMIT 50",
                "explanation": "查询玉米节点及其所有关联的节点"
            },
        ]
    
    async def _call_llm(self, messages: List[Dict]) -> str:
        """调用 LLM API"""
        # 获取 AI 客户端
        client = self._get_ai_client()
        
        # 获取 AI 参数
        params = self._get_ai_params()
        
        response = await client.chat.completions.create(
            model=params["model"],
            messages=messages,
            temperature=params["temperature"],
            max_tokens=params["max_tokens"]
        )
        return response.choices[0].message.content
    
    def _parse_response(self, response: str) -> Dict:
        """解析 LLM 响应"""
        print(f"[DEBUG] AI 原始响应: {response}")
        
        # 清理响应文本
        cleaned = response.strip()
        
        # 移除可能的 markdown 代码块
        cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
        cleaned = re.sub(r'\s*```$', '', cleaned)
        cleaned = cleaned.strip()
        
        try:
            # 尝试直接解析 JSON
            result = json.loads(cleaned)
            print(f"[DEBUG] JSON 解析成功: {result}")
            return result
        except json.JSONDecodeError as e:
            print(f"[DEBUG] JSON 解析失败: {e}, 清理后内容: {cleaned[:200]}")
            
            # 尝试从响应中提取 JSON（更宽松的匹配）
            json_match = re.search(r'\{.*?"cypher"\s*:\s*"([^"]+)".*?\}', cleaned, re.DOTALL)
            if json_match:
                try:
                    # 尝试解析整个 JSON
                    json_str = re.search(r'\{[^{}]*\}', cleaned, re.DOTALL)
                    if json_str:
                        result = json.loads(json_str.group())
                        print(f"[DEBUG] 从文本中提取 JSON 成功: {result}")
                        return result
                except Exception as ex:
                    print(f"[DEBUG] JSON 提取失败: {ex}")
                    # 直接提取 cypher 值
                    cypher_value = json_match.group(1)
                    print(f"[DEBUG] 直接提取 cypher 值: {cypher_value}")
                    return {
                        "cypher": cypher_value,
                        "explanation": "自动生成的查询",
                        "confidence": 0.7
                    }
            
            # 如果不是 JSON，尝试提取 Cypher
            cypher = self._extract_cypher(response)
            print(f"[DEBUG] 提取的 Cypher: {cypher}")
            return {
                "cypher": cypher,
                "explanation": "自动生成的查询",
                "confidence": 0.7
            }
    
    def _extract_cypher(self, text: str) -> str:
        """从文本中提取 Cypher 查询"""
        print(f"[DEBUG] _extract_cypher 输入: {text[:300]}")
        
        # 尝试提取代码块中的内容
        code_block_match = re.search(r'```(?:cypher)?\s*(.*?)\s*```', text, re.DOTALL)
        if code_block_match:
            extracted = code_block_match.group(1).strip()
            print(f"[DEBUG] 从代码块提取: {extracted}")
            return extracted
        
        # 尝试查找 MATCH 语句（宽松匹配）
        match_pattern = re.search(r'(MATCH\s*\(.+?RETURN\s+.+?)(?:LIMIT\s+\d+)?', text, re.IGNORECASE | re.DOTALL)
        if match_pattern:
            extracted = match_pattern.group(0).strip()
            print(f"[DEBUG] 提取 MATCH-RETURN 语句: {extracted}")
            return extracted
        
        # 更宽松：只找 MATCH 开头的内容
        match_only = re.search(r'(MATCH\s+.+)', text, re.IGNORECASE | re.DOTALL)
        if match_only:
            extracted = match_only.group(1).strip()
            # 清理尾部
            extracted = re.split(r'\n\n|\n(?=[^A-Z\s])', extracted)[0]
            print(f"[DEBUG] 提取 MATCH 语句: {extracted}")
            return extracted
        
        print(f"[DEBUG] 无法提取 Cypher，返回原文本")
        return text.strip()
    
    def _validate_and_fix_cypher(self, cypher: str) -> str:
        """验证和修复 Cypher 语法"""
        print(f"[DEBUG] _validate_and_fix_cypher 输入: {cypher}")
        
        # 移除末尾的分号
        cypher = cypher.rstrip(';').strip()
        
        # 移除可能的 markdown 代码块标记
        cypher = re.sub(r'^```(?:cypher)?\s*', '', cypher)
        cypher = re.sub(r'\s*```$', '', cypher)
        cypher = cypher.strip()
        
        # 检查是否包含危险操作
        dangerous_keywords = ['DELETE', 'DETACH', 'REMOVE', 'SET', 'CREATE', 'MERGE', 'DROP']
        for keyword in dangerous_keywords:
            if keyword in cypher.upper():
                raise ValueError(f"不允许的操作：{keyword}")
        
        # 基本语法验证
        if not cypher.upper().strip().startswith('MATCH'):
            print(f"[DEBUG] Cypher 不以 MATCH 开头，尝试提取...")
            # 尝试提取 MATCH 语句
            match = re.search(r'(MATCH\s+.+)', cypher, re.IGNORECASE | re.DOTALL)
            if match:
                cypher = match.group(1).strip()
                print(f"[DEBUG] 从响应中提取 MATCH 语句: {cypher}")
            else:
                print(f"[ERROR] 无法找到 MATCH 语句，原始内容: {cypher}")
                # 如果完全没有 MATCH，生成一个默认查询（包含关系）
                if not cypher or cypher.lower() in ['none', 'null', '']:
                    print(f"[DEBUG] 生成默认查询")
                    return "MATCH (n)-[r]-(m) RETURN n, r, m LIMIT 50"
                raise ValueError("无效的 Cypher 查询：必须以 MATCH 开头")
        
        # 确保有 RETURN 语句
        if 'RETURN' not in cypher.upper():
            # 尝试添加默认的 RETURN
            # 提取变量名
            var_match = re.search(r'MATCH\s*\((\w+)', cypher, re.IGNORECASE)
            if var_match:
                var_name = var_match.group(1)
                cypher += f' RETURN {var_name}'
            else:
                raise ValueError("无效的 Cypher 查询：缺少 RETURN 语句")
        
        # 获取最大限制配置
        nl2cypher_config = self._get_nl2cypher_config()
        max_limit = nl2cypher_config.get("max_limit", 100)
        
        # 确保有 LIMIT
        if 'LIMIT' not in cypher.upper():
            cypher += f' LIMIT {max_limit}'
        
        # 验证 LIMIT 不超过最大值
        limit_match = re.search(r'LIMIT\s+(\d+)', cypher, re.IGNORECASE)
        if limit_match:
            limit_value = int(limit_match.group(1))
            if limit_value > max_limit:
                cypher = re.sub(
                    r'LIMIT\s+\d+',
                    f'LIMIT {max_limit}',
                    cypher,
                    flags=re.IGNORECASE
                )
        
        # 验证括号匹配
        if cypher.count('(') != cypher.count(')'):
            raise ValueError("无效的 Cypher 查询：括号不匹配")
        if cypher.count('[') != cypher.count(']'):
            raise ValueError("无效的 Cypher 查询：方括号不匹配")
        if cypher.count('{') != cypher.count('}'):
            raise ValueError("无效的 Cypher 查询：花括号不匹配")
        
        return cypher
    
    @lru_cache(maxsize=100)
    def get_cached_conversion(self, natural_language: str) -> Optional[Dict]:
        """获取缓存的转换结果"""
        # 这个方法会被 lru_cache 装饰器自动缓存
        return None
