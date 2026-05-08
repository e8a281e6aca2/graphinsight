from services.neo4j_service import get_neo4j_service


def main() -> None:
    svc = get_neo4j_service()
    with svc.driver.session() as session:
        print("Entity exact matches:")
        rows = session.run(
            """
            MATCH (e:Entity)
            WHERE e.name IN [
              '赤霉病','抽穗扬花期','扬花期','抽穗期',
              'Fhb1','苏麦3号','望水白','分子标记','分子标记辅助选择'
            ]
            RETURN e.name AS name
            """
        ).data()
        print([row["name"] for row in rows])

        print("\nEntity contains 生育期/扬花/抽穗:")
        rows = session.run(
            """
            MATCH (e:Entity)
            WHERE e.name CONTAINS '生育期'
               OR e.name CONTAINS '扬花'
               OR e.name CONTAINS '抽穗'
            RETURN e.name AS name
            LIMIT 20
            """
        ).data()
        print([row["name"] for row in rows])

        print("\nEdges from 赤霉病:")
        rows = session.run(
            """
            MATCH (a:Entity {name:'赤霉病'})-[r]->(b)
            RETURN type(r) AS type, r.label AS label, b.name AS target
            LIMIT 20
            """
        ).data()
        print(rows)


if __name__ == "__main__":
    main()
