"""
节点展开 API 路由
"""
from fastapi import APIRouter, HTTPException, Depends
from models.graph import ExpandRequest, QueryResponse
from services.neo4j_service import get_neo4j_service, Neo4jService

router = APIRouter()


@router.post("/expand", response_model=QueryResponse)
async def expand_node(
    request: ExpandRequest,
    neo4j: Neo4jService = Depends(get_neo4j_service)
):
    """
    展开节点，获取其邻居节点
    
    Args:
        request: 展开请求（包含节点 ID、方向、关系类型等）
        neo4j: Neo4j 服务实例
    
    Returns:
        图数据（邻居节点和关系）
    
    Raises:
        HTTPException: 查询失败时抛出
    """
    try:
        # 验证方向参数
        if request.direction not in ["in", "out", "both"]:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "Invalid direction",
                    "code": "INVALID_DIRECTION",
                    "message": "Direction must be 'in', 'out', or 'both'"
                }
            )
        
        # 获取邻居节点
        result = neo4j.get_node_neighbors(
            node_id=request.nodeId,
            direction=request.direction,
            relationship_types=request.relationshipTypes,
            limit=request.limit
        )
        
        # 添加统计信息
        result["stats"] = {
            "nodeCount": len(result["nodes"]),
            "edgeCount": len(result["edges"]),
            "executionTime": 0  # 简化版，实际应该计时
        }
        
        return result
        
    except HTTPException:
        raise
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Internal server error",
                "code": "INTERNAL_ERROR",
                "message": str(e)
            }
        )
