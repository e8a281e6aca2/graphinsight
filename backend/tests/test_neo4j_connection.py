from neo4j import GraphDatabase
import os
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'), override=True)

uri = os.getenv('NEO4J_URI')
user = os.getenv('NEO4J_USER')
pwd = os.getenv('NEO4J_PASSWORD')

print('NEO4J_URI =', uri)
print('NEO4J_USER =', user)
print('NEO4J_PASSWORD =', '***' if pwd else None)

if not uri or not user or not pwd:
    raise SystemExit('Missing NEO4J_* env vars in backend/.env')

driver = GraphDatabase.driver(
    uri,
    auth=(user, pwd),
    connection_timeout=5,
    connection_acquisition_timeout=5,
)
try:
    with driver.session() as s:
        result = s.run('RETURN 1').single()
        print('Test query result:', result)
finally:
    driver.close()
