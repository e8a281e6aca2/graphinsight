#!/usr/bin/env python3
"""
调试节点数据结构
"""
from services.neo4j_service import get_neo4j_service

def debug_nodes():
    neo4j = get_neo4j_service()
    
    # 查询所有节点，查看哪些有视频属性
    result = neo4j.execute_query("""
        MATCH (n) 
        WHERE n.videoUrl IS NOT NULL OR n.视频 IS NOT NULL OR n.video IS NOT NULL
        RETURN n
        LIMIT 5
    """)
    
    print(f"找到 {len(result['nodes'])} 个有视频的节点:")
    
    for i, node in enumerate(result['nodes']):
        print(f"\n--- 节点 {i+1} ---")
        print(f"ID: {node['id']}")
        print(f"标签: {node['labels']}")
        print("属性:")
        for key, value in node['properties'].items():
            if 'video' in key.lower() or '视频' in key:
                print(f"  [VIDEO] {key}: {value}")
            elif 'image' in key.lower() or '图片' in key:
                print(f"  [IMAGE] {key}: {value}")
            else:
                print(f"  {key}: {value}")

if __name__ == "__main__":
    debug_nodes()