import json
import os
import sys
import urllib.request
from pathlib import Path

try:
    from dotenv import load_dotenv
except Exception:
    load_dotenv = None

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / '.env'
if load_dotenv and ENV_PATH.exists():
    load_dotenv(dotenv_path=ENV_PATH, override=True)

sys.path.insert(0, str(ROOT))
from admin.database import SessionLocal  # noqa: E402
from admin.models import AdminUser  # noqa: E402
from admin.services.auth_service import auth_service  # noqa: E402
from runtime_env import resolve_base_url  # noqa: E402

SUPPORTED_EXTS = {
    '.txt', '.md', '.markdown', '.csv', '.json', '.log', '.docx', '.pdf'
}


def _resolve_doc_dir() -> Path:
    doc_dir = os.getenv('DOCUMENT_STORAGE_PATH', './documents')
    path = Path(doc_dir)
    if not path.is_absolute():
        path = (ROOT / path).resolve()
    return path


def _read_text(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in {'.txt', '.md', '.markdown', '.csv', '.log'}:
        return path.read_text(encoding='utf-8', errors='ignore')
    if ext == '.json':
        try:
            data = json.loads(path.read_text(encoding='utf-8', errors='ignore'))
            return json.dumps(data, ensure_ascii=False, indent=2)
        except Exception:
            return path.read_text(encoding='utf-8', errors='ignore')
    if ext == '.docx':
        try:
            import docx  # type: ignore
        except Exception:
            return ''
        doc = docx.Document(str(path))
        return '\n'.join([p.text for p in doc.paragraphs if p.text])
    if ext == '.pdf':
        try:
            from pypdf import PdfReader  # type: ignore
        except Exception:
            return ''
        reader = PdfReader(str(path))
        parts = []
        for page in reader.pages[:2]:
            parts.append(page.extract_text() or '')
        return '\n'.join(parts)
    return ''


def _print_doc_scan(doc_dir: Path) -> None:
    files = [p for p in doc_dir.rglob('*') if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS]
    print('Document dir:', doc_dir)
    if not files:
        print('No documents found.')
        return
    for path in files:
        text = _read_text(path)
        text = text or ''
        preview = text.replace('\n', ' ').strip()[:200]
        print(f'- {path.name} | ext={path.suffix.lower()} | size={path.stat().st_size} | text_len={len(text.strip())}')
        print(f'  preview: {preview}')


def _resolve_admin_token() -> str:
    explicit = (os.getenv('ADMIN_TOKEN') or '').strip()
    if explicit:
        return explicit
    admin_email = (os.getenv('ADMIN_EMAIL') or 'yh@qs.al').strip()
    if not admin_email:
        return ''
    db = SessionLocal()
    try:
        user = db.query(AdminUser).filter(AdminUser.email == admin_email).first()
        if user is None:
            return ''
        return auth_service.create_access_token({'sub': user.email or user.username})
    except Exception:
        return ''
    finally:
        db.close()


def _call_build_api() -> None:
    api_base = resolve_base_url('GO_BASE_URL', resolve_base_url('ADMIN_BASE_URL', 'http://127.0.0.1:8081'))
    build_path = '/api/graph/build'
    headers = {'Content-Type': 'application/json'}
    token = _resolve_admin_token()
    if token:
        headers['Authorization'] = f'Bearer {token}'
    print(f'Build diagnose mode: go | base={api_base}')
    payload = json.dumps({'force': True}).encode('utf-8')
    req = urllib.request.Request(
        f'{api_base.rstrip("/")}{build_path}',
        data=payload,
        headers=headers,
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode('utf-8', errors='ignore')
            print('Graph build response:', body)
    except Exception as exc:
        print('Graph build request failed:', exc)


if __name__ == '__main__':
    doc_dir = _resolve_doc_dir()
    _print_doc_scan(doc_dir)
    _call_build_api()
