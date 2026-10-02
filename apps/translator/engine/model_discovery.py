"""API 키로 실제 사용 가능한 모델 목록을 조회합니다 (Gemini / OpenAI / Claude).
조회 실패 시 빈 리스트를 반환하므로 호출하는 쪽에서 '실패'와 '기본 목록 사용'을 구분할 수 있습니다."""
import json
import re
import urllib.request

import lang_config

_OPENAI_SKIP = ("embedding", "tts", "whisper", "dall-e", "image", "audio", "realtime", "transcribe",
                "moderation", "search", "davinci", "babbage", "instruct", "codex")


def _get_json(url: str, headers: dict = None, timeout: int = 8) -> dict:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def discover_gemini(api_key: str) -> list[str]:
    key = (api_key or "").strip()
    if not key:
        return []
    try:
        data = _get_json(f"https://generativelanguage.googleapis.com/v1beta/models?key={key}", timeout=6)
        skip = lang_config.model_setting("gemini_exclude_keywords", [])
        names = []
        for m in data.get("models", []):
            name = m.get("name", "").replace("models/", "")
            if "generateContent" in m.get("supportedGenerationMethods", []) and "gemini" in name.lower() \
                    and not any(x in name.lower() for x in skip):
                names.append(name)

        def prio(m: str):
            ver = re.search(r"(\d+(?:\.\d+)?)", m)
            v = float(ver.group(1)) if ver else 1.0
            if "latest" in m.lower():
                v = 3.0
            return (1 if "flash" in m.lower() else 0, 0 if "preview" in m.lower() else 1, v)

        return sorted(names, key=prio, reverse=True)
    except Exception:
        return []


def discover_openai(api_key: str) -> list[str]:
    key = (api_key or "").strip()
    if not key:
        return []
    try:
        rows = []
        for m in _get_json("https://api.openai.com/v1/models", {"Authorization": f"Bearer {key}"}).get("data", []):
            mid = str(m.get("id", ""))
            low = mid.lower()
            if re.match(r"(gpt-|chatgpt-|o\d)", low) and not any(x in low for x in _OPENAI_SKIP):
                rows.append((int(m.get("created", 0) or 0), mid))
        return [mid for _, mid in sorted(rows, reverse=True)]
    except Exception:
        return []


def discover_claude(api_key: str) -> list[str]:
    key = (api_key or "").strip()
    if not key:
        return []
    try:
        data = _get_json("https://api.anthropic.com/v1/models?limit=100",
                         {"x-api-key": key, "anthropic-version": "2023-06-01"}).get("data", [])
        rows = [(str(m.get("created_at", "")), str(m.get("id", ""))) for m in data if m.get("id")]
        return [mid for _, mid in sorted(rows, reverse=True)]
    except Exception:
        return []


def discover(provider: str, api_key: str) -> list[str]:
    return {"gemini": discover_gemini, "openai": discover_openai, "claude": discover_claude}.get(provider, lambda k: [])(api_key)
