#!/usr/bin/env python3
"""
创建带视频的测试节点
"""
from services.neo4j_service import get_neo4j_service

def create_video_node():
    neo4j = get_neo4j_service()
    
    # 创建带视频的节点
    cypher = """
    CREATE (v:品种 {
        名称: '视频演示品种',
        imageUrl: 'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=400',
        videoUrl: 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4',
        描述: '这是一个带视频的演示节点，双击可播放视频'
    })
    RETURN v
    """
    
    result = neo4j.execute_query(cypher)
    
    if result['nodes']:
        node = result['nodes'][0]
        print("✅ 视频节点创建成功!")
        print(f"节点ID: {node['id']}")
        print(f"名称: {node['properties']['名称']}")
        print(f"图片: {node['properties']['imageUrl']}")
        print(f"视频: {node['properties']['videoUrl']}")
        print("\n💡 使用方法:")
        print("1. 在前端执行查询: MATCH (v:品种 {名称:'视频演示品种'}) RETURN v")
        print("2. 双击节点播放视频")
    else:
        print("❌ 节点创建失败")

if __name__ == "__main__":
    create_video_node()