#!/usr/bin/env python3
"""
检查郑麦136节点属性
"""
from services.neo4j_service import get_neo4j_service

def check_node():
    neo4j = get_neo4j_service()
    
    # 查询郑麦136节点
    result = neo4j.execute_query('MATCH (v:Variety {name:"郑麦136"}) RETURN v')
    
    print(f"节点数量: {len(result['nodes'])}")
    
    if result['nodes']:
        node = result['nodes'][0]
        print("\n节点属性:")
        for key, value in node['properties'].items():
            print(f"  {key}: {value}")
        
        # 检查是否有图片相关属性
        image_keys = ['images', 'image', '图片', '图像', '照片']
        has_image = False
        for key in image_keys:
            if key in node['properties']:
                print(f"\n找到图片属性: {key} = {node['properties'][key]}")
                has_image = True
        
        if not has_image:
            print("\n未找到图片属性")
            print("支持的图片属性名: images, image, 图片, 图像, 照片")
    else:
        print("未找到郑麦136节点")
        
        # 尝试查找所有Variety节点
        all_result = neo4j.execute_query('MATCH (v:Variety) RETURN v.name LIMIT 10')
        if all_result['nodes']:
            print("\n现有的Variety节点:")
            for node in all_result['nodes']:
                if 'name' in node['properties']:
                    print(f"  - {node['properties']['name']}")

if __name__ == "__main__":
    check_node()