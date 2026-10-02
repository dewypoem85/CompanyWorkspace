"""languages.json 로더: 언어별 규칙 / 모델 기본값 / 키 문맥 규칙을 코드 밖(설정 파일)에서 관리합니다.
파일이 없거나 깨져도 아래 최소 기본값으로 동작하고, 미등록 언어를 만나면 조용히 넘어가지 않고 경고합니다."""
import json
import os

import paths
_PATH = os.path.join(paths.CONFIG_DIR, "languages.json")

_FALLBACK = {
    "default_tone_guide": "- Translate accurately and naturally into {lang_full}, maintaining action RPG gaming conventions.",
    "default_contamination": {"pattern": r"[぀-ヿ一-鿿㐀-䶿]", "label": "일본어/한자"},
    "languages": {},
    "models": {
        "gemini_fallback": ["gemini-flash-latest", "gemini-flash-lite-latest"],
        "gemini_exclude_keywords": ["tts", "image", "transcribe", "robotics", "computer-use"],
        "openai_default": "gpt-4o-mini",
        "claude_default": "claude-3-5-sonnet-20241022",
    },
    "key_context_rules": [],
    "default_key_context": "General in-game text",
}

_data = None
_warned = set()


def load(force: bool = False) -> dict:
    global _data
    if _data is not None and not force:
        return _data
    data = dict(_FALLBACK)
    try:
        with open(_PATH, "r", encoding="utf-8") as f:
            loaded = json.load(f)
        if isinstance(loaded, dict):
            data.update(loaded)
    except FileNotFoundError:
        print(f"[lang_config] languages.json 이 없어 내장 기본값으로 동작합니다: {_PATH}")
    except Exception as e:
        print(f"[lang_config] languages.json 로드 실패, 내장 기본값 사용: {e}")
    _data = data
    return _data


def language(code: str) -> dict:
    return (load().get("languages") or {}).get(code) or {}


def tone_guide(code: str, lang_full: str) -> str:
    g = language(code).get("tone_guide") or load().get("default_tone_guide") or _FALLBACK["default_tone_guide"]
    return g.replace("{lang_full}", lang_full)


def glossary_col(code: str) -> str:
    return language(code).get("glossary_col", "") or ""


def glossary_cols() -> dict:
    return {c: v["glossary_col"] for c, v in (load().get("languages") or {}).items() if v.get("glossary_col")}


def contamination(code: str):
    """(정규식, 라벨) 또는 None. 미등록 언어는 default_contamination 적용"""
    c = language(code).get("contamination") or (None if code in (load().get("languages") or {}) else load().get("default_contamination"))
    return (c["pattern"], c.get("label", "")) if c and c.get("pattern") else None


def script_check(code: str):
    return language(code).get("script_check") or None


def bound_patterns(code: str):
    return language(code).get("bound_patterns") or None


def model_setting(name: str, default=None):
    return (load().get("models") or {}).get(name, default)


def key_context(key: str) -> str:
    key_upper = (key or "").upper()
    for rule in load().get("key_context_rules") or []:
        if any(k.upper() in key_upper for k in rule.get("keywords", [])):
            return rule.get("context", "")
    return load().get("default_key_context") or _FALLBACK["default_key_context"]


def warn_unregistered(codes, logger=print):
    """대상 언어 중 languages.json 에 없거나 기능이 빠진 항목을 한 번씩 경고"""
    langs = load().get("languages") or {}
    for c in codes:
        if c in _warned:
            continue
        _warned.add(c)
        cfg = langs.get(c)
        if cfg is None:
            logger(f"⚠️ [Lang] '{c}' 은(는) languages.json 에 없습니다 → 톤 가이드·수치 경계(이하/미만)·문자 검사는 기본값/미적용입니다. languages.json 의 languages 에 '{c}' 를 추가하세요.")
            continue
        missing = [k for k, label in (("tone_guide", "톤 가이드"), ("bound_patterns", "수치 경계 검사"), ("glossary_col", "용어집 열 지정")) if not cfg.get(k)]
        if missing:
            logger(f"⚠️ [Lang] '{c}' 에 {', '.join(missing)} 설정이 없어 해당 기능은 기본값/미적용입니다. (languages.json)")


def default_targets() -> list:
    """시트에서 언어 열을 못 찾았을 때 쓰는 기본 대상 언어"""
    return list(load().get("default_target_languages") or ["ENG", "JPN", "CHS", "CHT", "SPA"])


def default_ui_languages() -> list:
    return list(load().get("default_ui_languages") or default_targets())


def normal_word(code: str) -> str:
    """'통상/일반' 원문 행 밀림 복구용 번역어 (미설정이면 빈 문자열)"""
    return language(code).get("normal_word", "") or ""


def register_languages(known: dict):
    """languages.json 에 name/aliases 가 있는 언어를 언어 레지스트리(KNOWN_LANGUAGES)에 병합 (신규 언어 헤더 인식용)"""
    for code, cfg in (load().get("languages") or {}).items():
        if not cfg.get("name"):
            continue
        cur = known.setdefault(code, {"name": cfg["name"], "code": code, "display_name": cfg.get("display_name", cfg["name"]), "aliases": []})
        cur["name"] = cfg["name"]
        if cfg.get("display_name"):
            cur["display_name"] = cfg["display_name"]
        for a in cfg.get("aliases", []):
            if a.lower() not in cur["aliases"]:
                cur["aliases"].append(a.lower())
