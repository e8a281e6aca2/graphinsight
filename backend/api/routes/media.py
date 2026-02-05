"""
媒体资源代理 API 路由
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
import httpx
import asyncio
from urllib.parse import urlparse

router = APIRouter()


@router.get("/proxy-media")
async def proxy_media(url: str):
    """
    代理媒体文件请求（图片、视频、音频），解决CORS问题
    
    Args:
        url: 媒体文件URL
    
    Returns:
        媒体文件内容
    """
    try:
        # 验证URL格式
        parsed_url = urlparse(url)
        if not parsed_url.scheme or not parsed_url.netloc:
            raise HTTPException(status_code=400, detail="Invalid URL format")
        
        # 只允许HTTP/HTTPS协议
        if parsed_url.scheme not in ['http', 'https']:
            raise HTTPException(status_code=400, detail="Only HTTP/HTTPS URLs are allowed")
        
        # 使用httpx异步获取图片
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            
            # 获取内容类型
            content_type = response.headers.get('content-type', 'application/octet-stream')
            
            # 如果没有明确的内容类型，根据URL推断
            if content_type == 'application/octet-stream':
                url_lower = url.lower()
                if any(ext in url_lower for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']):
                    content_type = 'image/jpeg'
                elif any(ext in url_lower for ext in ['.mp4', '.webm', '.ogg', '.avi']):
                    content_type = 'video/mp4'
                elif any(ext in url_lower for ext in ['.mp3', '.wav', '.ogg', '.m4a']):
                    content_type = 'audio/mpeg'
            
            return Response(
                content=response.content,
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=3600",  # 缓存1小时
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET",
                    "Access-Control-Allow-Headers": "*"
                }
            )
            
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=e.response.status_code,
            detail=f"Failed to fetch image: {e.response.status_code}"
        )
    except httpx.TimeoutException:
        raise HTTPException(status_code=408, detail="Request timeout")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/proxy-image")
async def proxy_image(url: str):
    """
    代理图片请求（向后兼容）
    """
    return await proxy_media(url)


@router.get("/video-thumbnail")
async def get_video_thumbnail(url: str):
    """
    生成视频缩略图
    
    Args:
        url: 视频URL
    
    Returns:
        视频第一帧的缩略图
    """
    try:
        # 验证URL格式
        parsed_url = urlparse(url)
        if not parsed_url.scheme or not parsed_url.netloc:
            raise HTTPException(status_code=400, detail="Invalid URL format")
        
        # 只允许HTTP/HTTPS协议
        if parsed_url.scheme not in ['http', 'https']:
            raise HTTPException(status_code=400, detail="Only HTTP/HTTPS URLs are allowed")
        
        # 尝试直接代理视频URL，让前端处理缩略图生成
        # 如果是视频文件，我们返回视频URL让前端的video元素处理
        
        # 检查是否是视频文件
        video_extensions = ['.mp4', '.webm', '.ogg', '.avi', '.mov', '.wmv', '.flv']
        if any(ext in url.lower() for ext in video_extensions):
            # 对于视频文件，我们返回代理的视频URL
            async with httpx.AsyncClient(timeout=30.0) as client:
                # 只获取视频的头部信息来验证可访问性
                try:
                    head_response = await client.head(url)
                    if head_response.status_code == 200:
                        # 视频可访问，返回代理URL
                        return Response(
                            content=f"VIDEO_PROXY:{url}",
                            media_type="text/plain",
                            headers={
                                "Cache-Control": "public, max-age=3600",
                                "Access-Control-Allow-Origin": "*",
                            }
                        )
                except:
                    pass  # 如果HEAD请求失败，继续使用SVG图标
        
        # 创建一个带视频预览的SVG图标
        # 尝试获取视频的实际内容来生成更真实的预览
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                # 尝试获取视频文件的前几个字节来检测格式
                response = await client.get(url, headers={"Range": "bytes=0-1024"})
                if response.status_code in [200, 206]:  # 200 或 206 (Partial Content)
                    # 如果能成功获取视频数据，生成一个更真实的预览
                    svg_content = f"""
                    <svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 90 90">
                        <!-- 视频帧背景 -->
                        <defs>
                            <linearGradient id="videoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" style="stop-color:#1976d2;stop-opacity:1" />
                                <stop offset="50%" style="stop-color:#1565c0;stop-opacity:1" />
                                <stop offset="100%" style="stop-color:#0d47a1;stop-opacity:1" />
                            </linearGradient>
                            <pattern id="scanlines" patternUnits="userSpaceOnUse" width="90" height="4">
                                <rect width="90" height="2" fill="rgba(255,255,255,0.1)"/>
                                <rect y="2" width="90" height="2" fill="rgba(0,0,0,0.1)"/>
                            </pattern>
                        </defs>
                        
                        <!-- 主背景 -->
                        <rect width="90" height="90" fill="url(#videoGrad)" rx="6"/>
                        
                        <!-- 扫描线效果 -->
                        <rect width="90" height="90" fill="url(#scanlines)" rx="6"/>
                        
                        <!-- 视频内容区域 -->
                        <rect x="8" y="8" width="74" height="54" fill="rgba(255,255,255,0.1)" rx="3"/>
                        
                        <!-- 播放按钮 -->
                        <circle cx="45" cy="45" r="18" fill="rgba(255,255,255,0.95)" stroke="rgba(0,0,0,0.1)" stroke-width="1"/>
                        <polygon points="38,35 38,55 58,45" fill="#1976d2"/>
                        
                        <!-- 视频标识 -->
                        <rect x="8" y="68" width="74" height="14" fill="rgba(0,0,0,0.7)" rx="2"/>
                        <text x="45" y="78" text-anchor="middle" fill="white" font-size="10" font-family="Arial, sans-serif" font-weight="bold">VIDEO</text>
                    </svg>
                    """
                else:
                    raise Exception("Cannot access video")
        except:
            # 如果无法访问视频，使用简化的图标
            svg_content = f"""
            <svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 90 90">
                <rect width="90" height="90" fill="#1976d2" rx="8"/>
                <circle cx="45" cy="45" r="18" fill="rgba(255,255,255,0.9)"/>
                <polygon points="38,35 38,55 58,45" fill="#1976d2"/>
                <text x="45" y="78" text-anchor="middle" fill="white" font-size="10" font-family="Arial">VIDEO</text>
            </svg>
            """
        
        # 返回SVG作为图片
        return Response(
            content=svg_content,
            media_type="image/svg+xml",
            headers={
                "Cache-Control": "public, max-age=3600",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET",
                "Access-Control-Allow-Headers": "*"
            }
        )
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")