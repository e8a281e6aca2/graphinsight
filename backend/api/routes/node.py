"""
节点 API 路由
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from models.graph import NodeDetail, MediaResource
from services.neo4j_service import get_neo4j_service, Neo4jService
from utils.neo4j_parser import extract_media_resources
from admin.api.deps import require_permission
from admin.models import AdminUser

router = APIRouter()


@router.get("/node/{node_id}", response_model=NodeDetail)
async def get_node_detail(
    node_id: str,
    current_user: Optional[AdminUser] = Depends(require_permission("graph:read", resource="graph")),
    neo4j: Neo4jService = Depends(get_neo4j_service)
):
    """
    获取节点详情
    
    Args:
        node_id: 节点 ID
        neo4j: Neo4j 服务实例
    
    Returns:
        节点详情（包含多媒体资源）
    
    Raises:
        HTTPException: 节点不存在或查询失败时抛出
    """
    try:
        # 获取节点
        node = neo4j.get_node_by_id(node_id)
        
        if not node:
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "Node not found",
                    "code": "NODE_NOT_FOUND",
                    "message": f"Node with ID {node_id} does not exist"
                }
            )
        
        # 提取多媒体资源
        media_files = extract_media_resources(node["properties"])
        
        # 辅助函数：判断是否为 URL
        def is_url(path: str) -> bool:
            return path.startswith(('http://', 'https://', 'ftp://'))
        
        # 构建多媒体资源 URL
        media = {
            "images": [
                MediaResource(
                    filename=img.split('/')[-1] if is_url(img) else img,
                    url=img if is_url(img) else f"/api/media/{img}",
                    thumbnail=img if is_url(img) else f"/api/media/{img}"
                )
                for img in media_files["images"]
            ],
            "videos": [
                MediaResource(
                    filename=vid.split('/')[-1] if is_url(vid) else vid,
                    url=vid if is_url(vid) else f"/api/media/{vid}",
                    thumbnail=vid if is_url(vid) else f"/api/media/{vid.rsplit('.', 1)[0]}_thumb.jpg"
                )
                for vid in media_files["videos"]
            ],
            "audios": [
                MediaResource(
                    filename=aud.split('/')[-1] if is_url(aud) else aud,
                    url=aud if is_url(aud) else f"/api/media/{aud}"
                )
                for aud in media_files["audios"]
            ]
        }
        
        return {
            **node,
            "media": media
        }
        
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
