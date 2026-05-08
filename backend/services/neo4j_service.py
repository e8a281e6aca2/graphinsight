"""
Neo4j 数据库服务
"""
from neo4j import GraphDatabase, Driver
from typing import Optional, Dict, Any, List
import time
from config import get_settings

settings = get_settings()


class Neo4jService:
    """Neo4j 数据库服务类"""
    
    def __init__(self):
        self.driver: Optional[Driver] = None
        self._active_signature: Optional[tuple] = None
        self._active_database: str = "neo4j"
        self._last_config_check_at: float = 0.0
        self._config_check_interval_seconds: float = 5.0
        self._connect()

    @staticmethod
    def _resolve_connection_config() -> Dict[str, str]:
        """解析运行时连接配置。"""
        uri = settings.neo4j_uri
        user = settings.neo4j_user
        password = settings.neo4j_password
        database = getattr(settings, "neo4j_database", "neo4j")
        source = "env"
        mode = str(getattr(settings, "neo4j_config_source", "env") or "env").strip().lower()
        if mode not in {"env", "admin", "auto"}:
            mode = "env"

        if mode == "env":
            return {
                "uri": uri,
                "user": user,
                "password": password,
                "database": database,
                "source": source,
                "mode": mode,
            }

        try:
            from admin.database import SessionLocal
            from admin.crud.config import config_crud

            db = SessionLocal()
            try:
                cfg_uri = config_crud.get_by_key(db, "neo4j", "uri")
                cfg_user = config_crud.get_by_key(db, "neo4j", "user")
                cfg_username = config_crud.get_by_key(db, "neo4j", "username")
                cfg_pwd = config_crud.get_by_key(db, "neo4j", "password")
                cfg_db = config_crud.get_by_key(db, "neo4j", "database")

                has_admin_cfg = False
                if cfg_uri and cfg_uri.value:
                    uri = cfg_uri.value
                    has_admin_cfg = True
                if cfg_user and cfg_user.value:
                    user = cfg_user.value
                    has_admin_cfg = True
                elif cfg_username and cfg_username.value:
                    user = cfg_username.value
                    has_admin_cfg = True
                if cfg_pwd and cfg_pwd.value:
                    password = cfg_pwd.value
                    has_admin_cfg = True
                if cfg_db and cfg_db.value:
                    database = cfg_db.value
                    has_admin_cfg = True
                if has_admin_cfg:
                    source = "admin_config"
                elif mode == "auto":
                    source = "env"
                elif mode == "admin":
                    source = "admin_config_empty_fallback_env"
            finally:
                db.close()
        except Exception:
            # admin 模式下也允许回退，避免管理库不可用导致服务不可启动
            source = "admin_unavailable_fallback_env"

        return {
            "uri": uri,
            "user": user,
            "password": password,
            "database": database,
            "source": source,
            "mode": mode,
        }
    
    def _connect(self):
        """连接到 Neo4j 数据库"""
        try:
            cfg = self._resolve_connection_config()
            self.driver = GraphDatabase.driver(
                cfg["uri"],
                auth=(cfg["user"], cfg["password"]),
                max_connection_pool_size=50
            )
            # 验证连接
            self.driver.verify_connectivity()
            self._active_signature = (cfg["uri"], cfg["user"], cfg["password"], cfg["database"])
            self._active_database = cfg["database"] or "neo4j"
            print(f"成功连接到 Neo4j: {cfg['uri']} (mode={cfg.get('mode', 'env')}, source={cfg['source']})")
        except Exception as e:
            print(f"连接 Neo4j 失败: {e}")
            raise

    def _maybe_refresh_connection(self):
        """定期检查配置变化，自动重连。"""
        now = time.time()
        if now - self._last_config_check_at < self._config_check_interval_seconds:
            return
        self._last_config_check_at = now

        try:
            cfg = self._resolve_connection_config()
            new_sig = (cfg["uri"], cfg["user"], cfg["password"], cfg["database"])
            if self.driver is None or self._active_signature != new_sig:
                if self.driver:
                    self.driver.close()
                    self.driver = None
                self._connect()
        except Exception as e:
            print(f"Neo4j 配置刷新失败: {e}")

    def get_runtime_connection_info(self) -> Dict[str, Any]:
        cfg = self._resolve_connection_config()
        return {
            "uri": cfg.get("uri", ""),
            "database": cfg.get("database", "neo4j"),
            "source": cfg.get("source", "env"),
            "mode": cfg.get("mode", "env"),
            "connected": bool(self.driver),
        }
    
    def close(self):
        """关闭数据库连接"""
        if self.driver:
            self.driver.close()
            print("Neo4j 连接已关闭")
    
    def execute_query(self, cypher: str, parameters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        执行 Cypher 查询
        
        Args:
            cypher: Cypher 查询语句
            parameters: 查询参数
        
        Returns:
            包含节点和边的字典
        """
        if not self.driver:
            raise Exception("Neo4j 驱动未初始化")
        self._maybe_refresh_connection()
        
        with self.driver.session(database=self._active_database) as session:
            result = session.run(cypher, parameters or {})
            return self._parse_result(result)
    
    def _parse_result(self, result) -> Dict[str, Any]:
        """
        解析 Neo4j 查询结果
        
        Args:
            result: Neo4j 查询结果
        
        Returns:
            标准化的图数据格式
        """
        nodes = {}
        edges = []
        
        for record in result:
            for key in record.keys():
                value = record[key]
                
                # 处理节点
                if hasattr(value, 'labels'):  # Node
                    node_id = str(value.id)
                    if node_id not in nodes:
                        nodes[node_id] = {
                            "id": node_id,
                            "labels": list(value.labels),
                            "properties": dict(value)
                        }
                
                # 处理关系
                elif hasattr(value, 'type'):  # Relationship
                    props = dict(value)
                    edge_type = props.get("label") or value.type
                    edge = {
                        "id": str(value.id),
                        "source": str(value.start_node.id),
                        "target": str(value.end_node.id),
                        "type": edge_type,
                        "properties": props
                    }
                    edges.append(edge)
                    
                    # 确保关系的起始和结束节点也被包含
                    start_id = str(value.start_node.id)
                    if start_id not in nodes:
                        nodes[start_id] = {
                            "id": start_id,
                            "labels": list(value.start_node.labels),
                            "properties": dict(value.start_node)
                        }
                    
                    end_id = str(value.end_node.id)
                    if end_id not in nodes:
                        nodes[end_id] = {
                            "id": end_id,
                            "labels": list(value.end_node.labels),
                            "properties": dict(value.end_node)
                        }
                
                # 处理路径
                elif hasattr(value, 'nodes'):  # Path
                    for node in value.nodes:
                        node_id = str(node.id)
                        if node_id not in nodes:
                            nodes[node_id] = {
                                "id": node_id,
                                "labels": list(node.labels),
                                "properties": dict(node)
                            }
                    
                    for rel in value.relationships:
                        edge = {
                            "id": str(rel.id),
                            "source": str(rel.start_node.id),
                            "target": str(rel.end_node.id),
                            "type": rel.type,
                            "properties": dict(rel)
                        }
                        edges.append(edge)
        
        return {
            "nodes": list(nodes.values()),
            "edges": edges
        }
    
    def get_node_by_id(self, node_id: str) -> Optional[Dict[str, Any]]:
        """
        根据 ID 获取节点详情
        
        Args:
            node_id: 节点 ID
        
        Returns:
            节点详情
        """
        cypher = """
        MATCH (n)
        WHERE id(n) = $node_id
        RETURN n
        """
        
        self._maybe_refresh_connection()
        with self.driver.session(database=self._active_database) as session:
            result = session.run(cypher, {"node_id": int(node_id)})
            record = result.single()
            
            if record:
                node = record["n"]
                return {
                    "id": str(node.id),
                    "labels": list(node.labels),
                    "properties": dict(node)
                }
            return None
    
    def get_node_neighbors(
        self,
        node_id: str,
        direction: str = "both",
        relationship_types: Optional[List[str]] = None,
        limit: int = 20
    ) -> Dict[str, Any]:
        """
        获取节点的邻居节点
        
        Args:
            node_id: 节点 ID
            direction: 方向 ("in", "out", "both")
            relationship_types: 关系类型列表
            limit: 结果数量限制
        
        Returns:
            包含邻居节点和关系的图数据
        """
        self._maybe_refresh_connection()
        # 构建关系类型过滤
        rel_filter = ""
        if relationship_types:
            rel_types = "|".join([f":{rt}" for rt in relationship_types])
            rel_filter = rel_types
        
        # 根据方向构建查询
        if direction == "out":
            pattern = f"(n)-[r{rel_filter}]->(m)"
        elif direction == "in":
            pattern = f"(n)<-[r{rel_filter}]-(m)"
        else:  # both
            pattern = f"(n)-[r{rel_filter}]-(m)"
        
        cypher = f"""
        MATCH {pattern}
        WHERE id(n) = $node_id
        RETURN n, r, m
        LIMIT $limit
        """
        
        with self.driver.session(database=self._active_database) as session:
            result = session.run(cypher, {
                "node_id": int(node_id),
                "limit": limit
            })
            return self._parse_result(result)


# 全局 Neo4j 服务实例
_neo4j_service: Optional[Neo4jService] = None


def get_neo4j_service() -> Neo4jService:
    """获取 Neo4j 服务单例"""
    global _neo4j_service
    if _neo4j_service is None:
        _neo4j_service = Neo4jService()
    return _neo4j_service


def close_neo4j_service():
    """关闭 Neo4j 服务"""
    global _neo4j_service
    if _neo4j_service:
        _neo4j_service.close()
        _neo4j_service = None
