"""
查询 API 路由
"""
from fastapi import APIRouter, HTTPException, Depends, Request
from models.graph import QueryRequest, QueryResponse, GraphStats
from services.neo4j_service import get_neo4j_service, Neo4jService
from neo4j.exceptions import CypherSyntaxError, ServiceUnavailable
from utils.logger import log_action
import time

router = APIRouter()


@router.post("/query", response_model=QueryResponse)
async def execute_query(
    query_request: QueryRequest,
    http_request: Request,
    neo4j: Neo4jService = Depends(get_neo4j_service)
):
    """
    执行 Cypher 查询
    
    Args:
        query_request: 查询请求（包含 cypher 和 parameters）
        http_request: HTTP 请求对象
        neo4j: Neo4j 服务实例
    
    Returns:
        图数据（节点和边）
    
    Raises:
        HTTPException: 查询失败时抛出
    """
    try:
        # 记录开始时间
        start_time = time.time()
        
        # 执行查询
        result = neo4j.execute_query(query_request.cypher, query_request.parameters)
        
        # 计算执行时间
        execution_time = time.time() - start_time
        
        # 添加统计信息
        result["stats"] = {
            "nodeCount": len(result["nodes"]),
            "edgeCount": len(result["edges"]),
            "executionTime": round(execution_time, 3)
        }
        
        # 记录日志
        log_action(
            action="query_execute",
            resource="cypher_query",
            details=f"Nodes: {len(result['nodes'])}, Edges: {len(result['edges'])}, Time: {execution_time:.3f}s",
            ip_address=http_request.client.host if http_request.client else None
        )
        
        return result
        
    except CypherSyntaxError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Invalid Cypher query",
                "code": "INVALID_QUERY",
                "message": str(e)
            }
        )
    
    except ServiceUnavailable as e:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "Database unavailable",
                "code": "DATABASE_UNAVAILABLE",
                "message": "Cannot connect to Neo4j database"
            }
        )
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Internal server error",
                "code": "INTERNAL_ERROR",
                "message": str(e)
            }
        )
