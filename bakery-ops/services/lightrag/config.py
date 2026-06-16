import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the main project root (two levels up from services/lightrag/)
_project_root = Path(__file__).resolve().parent.parent.parent
_env_path = _project_root / ".env"
load_dotenv(_env_path)

# OpenRouter (OpenAI-compatible) for LLM + embeddings
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
LLM_MODEL = os.getenv("AI_CHAT_MODEL", "openai/gpt-4.1-mini")
EMBEDDING_MODEL = os.getenv("AI_EMBEDDING_MODEL", "openai/text-embedding-3-small")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# LightRAG storage — data lives inside services/lightrag/
WORKING_DIR = os.getenv("LIGHTRAG_WORKING_DIR", str(Path(__file__).resolve().parent / "lightrag_data"))

# Server — 默认仅监听本机回环，避免在未设置 LIGHTRAG_API_KEY 时把无鉴权服务暴露到网络。
# 如需跨主机访问，显式设置 LIGHTRAG_HOST=0.0.0.0（并务必同时设置 LIGHTRAG_API_KEY）。
HOST = os.getenv("LIGHTRAG_HOST", "127.0.0.1")
PORT = int(os.getenv("LIGHTRAG_PORT", "8020"))
