import sys
import os
import json
import re
import time
import csv
import io
import urllib.request
import urllib.error
import argparse
import concurrent.futures

# Windows 콘솔 유니코드 인코딩 안전화 (cp949 충돌 방지)
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

from config_manager import load_config, save_config, resolve_selected_service_account
import lang_config
from i2_sheet_registry import (
    OFFICIAL_I2_SHEETS, get_sheet_url, fetch_live_i2_sheets, fetch_i2_sheet_rows,
    parse_local_i2languages_asset, get_default_local_i2_asset_path, get_local_i2_categories,
    fetch_glossary_from_google_sheet, KNOWN_LANGUAGES, resolve_language_info,
    detect_available_target_languages, fetch_i2_sheet_tabs, save_i2_sheet_tab_rows,
    save_i2_sheet_tab_cells_direct
)

import paths  # 폴더 구조: config/, keys/, data/, output/
AUDIT_CACHE_FILE = os.path.join(paths.DATA_DIR, "audit_cache.json")

MAIN_REPORT_NAME = "audit_report_전수검사_결과.xlsx"
TEST_REPORT_NAME = "audit_report_테스트_결과.xlsx"

def is_test_mode_cfg(cfg: dict) -> bool:
    """테스트 모드(커스텀 시트 URL) 실행 여부 - 서버(handleStartJob)의 판정과 동일 기준"""
    if cfg.get("isTestMode") is not None:
        return bool(cfg.get("isTestMode"))  # 클라이언트가 명시한 모드가 최우선
    if cfg.get("mode") in ("main", "test"):
        return cfg.get("mode") == "test"
    return cfg.get("target_source_mode") == "custom_url"

def report_name_for_cfg(cfg: dict) -> str:
    return TEST_REPORT_NAME if is_test_mode_cfg(cfg) else MAIN_REPORT_NAME

def load_audit_cache() -> dict:
    """기존 감수 이력(제안 상태 및 번역문 텍스트) 캐시를 로드합니다."""
    if os.path.exists(AUDIT_CACHE_FILE):
        try:
            with open(AUDIT_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_audit_cache(cache: dict):
    """감수 이력 캐시를 JSON 파일로 안전하게 저장합니다."""
    try:
        with open(AUDIT_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 1. Gate A: 결정론적 즉시 검증기 (Runbook 기준)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class GateAValidator:
    # 문법상 정상적으로 연달아 나올 수 있는 기능어 (중복어 오탐 방지: 독일어 'die die Tags' 등)
    DUP_STOPWORDS = {
        "die", "der", "das", "den", "dem", "des", "sie", "wir", "und", "ist", "sind", "zu", "mit",
        "the", "that", "had", "is", "to", "de", "la", "el", "los", "las", "que", "se", "en", "un", "una", "del", "al",
    }

    # 번역 대신 거절·설명을 답한 meta reply (문장 시작 기준)
    REFUSAL_PAT = re.compile(
        r"^\s*(I\s+(cannot|can't|am unable|'m unable)|As an AI|Sorry,|I'm sorry|Here is the translation|Translation\s*:|"
        r"申し訳|すみません|抱歉|对不起|對不起|无法翻译|無法翻譯|Lo siento|No puedo|Es tut mir leid|Ich kann (nicht|keine))",
        re.IGNORECASE)
    # 대상 언어에 허용되지 않는 고유 문자는 languages.json (contamination) 에서 관리
    PLACEHOLDER_PAT = r"\{[0-9]+\}|\[\*?[A-Za-z0-9_]+\]|%[sd]"

    @staticmethod
    def normalize(source: str, translation: str) -> str:
        """규칙만으로 고칠 수 있는 형식 문제 정규화 (말줄임표, 잘못 escape된 따옴표, 불필요한 감싸기 따옴표)."""
        t = (translation or "").strip()
        if not t:
            return t
        if "…" in source and "..." not in source:
            t = t.replace("...", "…")
        if '\\"' in t and '\\"' not in source:
            t = t.replace('\\"', '"')
        for q in ('"', "'", "`"):
            if len(t) >= 2 and t.startswith(q) and t.endswith(q) and not source.strip().startswith(q):
                t = t[1:-1].strip()
        return t

    @staticmethod
    def validate(source: str, translation: str, target_lang: str) -> tuple[bool, str]:
        if not translation or not translation.strip():
            return False, "빈 번역 결과 (Empty)"

        s_clean = source.strip()
        t_clean = translation.strip()

        if GateAValidator.REFUSAL_PAT.search(t_clean) and not GateAValidator.REFUSAL_PAT.search(s_clean):
            return False, f"번역 대신 거절/설명 응답 감지: '{t_clean[:30]}'"

        if "\t" in t_clean and "\t" not in s_clean:
            return False, "원문에 없는 탭(tab) 문자 포함"

        _cont = lang_config.contamination(target_lang)
        if _cont:
            _hits = re.findall(_cont[0], t_clean)
            if _hits and not re.search(_cont[0], s_clean):
                return False, f"대상 언어({target_lang}) 내 {_cont[1]} 문자 혼입: '{''.join(_hits[:5])}'"

        # 원문이 아닌 모든 타겟 언어에서 한글 잔존 여부 동적 검증
        if target_lang not in ["KOR", "Korean", "한국어"]:
            korean_chars = re.findall(r"[\uAC00-\uD7A3]", t_clean)
            if korean_chars:
                sample = "".join(korean_chars[:5])
                return False, f"대상 언어({target_lang}) 내 원문 한글 잔존: '{sample}'"

            # 원문과 번역문이 완전히 동일한 경우 (미번역 원문 복사/동일어)
            if s_clean == t_clean:
                # 숫자나 특수기호만으로 이루어진 경우가 아니라면 오류 판정
                if not re.fullmatch(r"[\d\s\W]+", s_clean) and s_clean.upper() not in ["HP", "MP", "SP", "EXP", "LV", "LV.", "MAX", "OK", "NO"]:
                    return False, f"원문과 동일한 텍스트 잔존 (미번역 동일어 복사: '{s_clean[:15]}')"

        # 내부 식별자(snake_case)가 번역문으로 들어간 경우 (예: 'apex_striker')
        _id_pat = r"[a-z0-9]+(?:_[a-z0-9]+)+"
        if re.fullmatch(_id_pat, t_clean) and not re.fullmatch(_id_pat, s_clean):
            return False, f"내부 식별자(snake_case) 형태가 번역문으로 사용됨: '{t_clean[:30]}'"

        # 언어별 금지 문자 검사 (예: 번체 칸에 간체자 복붙 방지) - languages.json 의 script_check
        _sc = lang_config.script_check(target_lang)
        if _sc and _sc.get("forbidden_chars"):
            _forbid = set(_sc["forbidden_chars"])
            found_sc = [c for c in t_clean if c in _forbid]
            if found_sc:
                sample = "".join(list(dict.fromkeys(found_sc))[:5])
                return False, str(_sc.get("message") or "금지 문자 감지: '{sample}'").replace("{sample}", sample)

        # 동일 단어/어절 연속 중복 반복 감지 (예: "공격 공격", "Attack Attack")
        rep_match = re.search(r"\b([a-zA-Z가-힣]{2,})\s+\1\b", t_clean, re.IGNORECASE)
        if rep_match and rep_match.group(1).lower() not in GateAValidator.DUP_STOPWORDS:
            dup_word = rep_match.group(1)
            # 원문에 중복되어 있지 않은 경우에만 오류
            if not re.search(rf"\b{re.escape(dup_word)}\s+{re.escape(dup_word)}\b", s_clean, re.IGNORECASE):
                return False, f"동일어 연속 중복 감지: '{dup_word} {dup_word}'"

        src_tags = re.findall(r"</?[a-zA-Z0-9_=#]+>", source)
        trans_tags = re.findall(r"</?[a-zA-Z0-9_=#]+>", translation)
        if sorted(src_tags) != sorted(trans_tags):
            return False, f"태그 불일치 (원문: {src_tags} vs 번역: {trans_tags})"

        src_params = re.findall(GateAValidator.PLACEHOLDER_PAT, source)
        trans_params = re.findall(GateAValidator.PLACEHOLDER_PAT, translation)
        if sorted(src_params) != sorted(trans_params):
            return False, f"파라미터 불일치 (원문: {src_params} vs 번역: {trans_params})"

        if " / " in translation and " / " not in source:
            return False, "복수 번역안 병기 감지 (' / ' 대안 제시 금지)"

        ok_b, msg_b = GateAValidator.check_numeric_bound(source, translation, target_lang)
        if not ok_b:
            return False, msg_b

        return True, ""

    # 수치 경계 표현(이하/이상=포함, 미만/초과=미포함) 언어별 패턴은 languages.json (bound_patterns) 에서 관리

    @staticmethod
    def check_numeric_bound(source: str, translation: str, target_lang: str) -> tuple[bool, str]:
        """한글 원문의 '이하/이상(포함) · 미만/초과(미포함)'가 번역에서 뒤바뀌었는지 결정론적으로 검사."""
        pats = lang_config.bound_patterns(target_lang)
        if not pats or not re.search(r"\d", source):
            return True, ""

        def has(key, strip_key=None):
            text = translation
            if strip_key:  # 'or below' 안의 'below' 처럼 포함 표현에 겹친 미포함 패턴은 제외
                for sp in pats[strip_key]:
                    text = re.sub(sp, " ", text, flags=re.IGNORECASE)
            return any(re.search(p, text, re.IGNORECASE) for p in pats[key])

        found = set()
        for m in re.finditer(r"(이하|이상|미만|초과)(?:(?![가-힣])|(?=[의일인이로에]))", source):
            # '60도 이상 넓어지지 않는다'처럼 뒤에 부정이 이어지면 경계 의미가 반전되므로 검사 제외
            if re.search(r"않|없|못|안\s", source[m.end(): m.end() + 12]):
                continue
            found.add(m.group(1))
        for kw in ("이하", "이상"):
            if kw in found:
                low = (kw == "이하")
                excl, incl = ("excl_low", "incl_low") if low else ("excl_high", "incl_high")
                if has(excl, incl) and not has(incl):
                    return False, f"수치 조건 불일치: 원문 '{kw}'({'≤' if low else '≥'} 포함)인데 번역이 {'미만(<)' if low else '초과(>)'} 표현으로 되어 있음 (경계값 미포함 오역)"
        for kw in ("미만", "초과"):
            if kw in found:
                low = (kw == "미만")
                excl, incl = ("excl_low", "incl_low") if low else ("excl_high", "incl_high")
                if has(incl) and not has(excl, incl):
                    return False, f"수치 조건 불일치: 원문 '{kw}'({'<' if low else '>'} 미포함)인데 번역이 {'이하(≤)' if low else '이상(≥)'} 표현으로 되어 있음 (경계값 포함 오역)"
        return True, ""

    ISSUE_CODES = [
        ("빈 번역", "empty-translation"), ("한글 잔존", "source-script-leak"), ("동일한 텍스트", "language-mismatch"),
        ("문자 혼입", "contamination"), ("간체자", "contamination"), ("태그 불일치", "tag-mismatch"),
        ("파라미터 불일치", "placeholder-mismatch"), ("복수 번역안", "alternative-translations"),
        ("수치 조건", "numeric-bound"), ("식별자", "identifier"), ("중복", "duplicate-word"),
        ("거절", "refusal"), ("탭", "tab"),
    ]

    @staticmethod
    def issue_code(msg: str) -> str:
        for kw, code in GateAValidator.ISSUE_CODES:
            if kw in msg:
                return code
        return "other"

    @staticmethod
    def validate_layout(source: str, translation: str) -> tuple[bool, str]:
        """줄바꿈 개수 등 레이아웃 차이 검사 (경미 → 제안 등급용)"""
        sn, tn = source.count("\n"), translation.count("\n")
        if sn == tn:
            return True, ""
        # 원문 줄바꿈이 문장 중간(앞 줄이 종결 부호로 끝나지 않음)이면 번역에서 합치는 것이 자연스러움 → 오탐 제외
        if tn < sn:
            lines = [l.rstrip() for l in source.split("\n")[:-1]]
            if lines and not any(re.search(r"[.!?。！？…)\]>]$|다$|요$", l) for l in lines):
                return True, ""
        return False, f"줄바꿈 개수 불일치 (원문 {sn}개 vs 번역 {tn}개)"

    @staticmethod
    def collapse_extra_blank_lines(source: str, translation: str) -> str:
        """원문에 없는 빈 줄(번역에만 있는 공백 줄)을 제거. 원문에도 빈 줄이 있으면 그대로 둠."""
        if re.search(r"\n[ \t]*\n", source):
            return translation
        return re.sub(r"[ \t]*\n(?:[ \t]*\n)+", "\n", translation)

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# [신설] 프롬프트 템플릿 로더 및 문맥 메타데이터 추출기
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROMPTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts")

def load_prompt_template(filename: str, default_text: str = "") -> str:
    """prompts 디렉토리에서 마크다운 프롬프트 템플릿을 안전하게 로드합니다."""
    path = os.path.join(PROMPTS_DIR, filename)
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            print(f"[Prompt] 템플릿 로드 실패 ({filename}): {e}")
    return default_text

def load_additional_rules() -> str:
    """prompts 디렉토리 내의 메인 템플릿을 제외한 모든 추가 .md 규칙 파일들을 자동으로 스캔하여 취합합니다."""
    if not os.path.isdir(PROMPTS_DIR):
        return ""
    main_templates = {"translation_prompt.md", "mqm_review_prompt.md"}
    rules = []
    try:
        for fname in sorted(os.listdir(PROMPTS_DIR)):
            if fname.lower().endswith(".md") and fname not in main_templates:
                fpath = os.path.join(PROMPTS_DIR, fname)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        content = f.read().strip()
                        if content:
                            rules.append(f"### [USER RULE: {fname}]\n{content}")
                except Exception as e:
                    print(f"[Prompt] 추가 규칙 파일 로드 실패 ({fname}): {e}")
    except Exception as e:
        print(f"[Prompt] prompts 디렉토리 스캔 실패: {e}")
    return "\n\n".join(rules)

def load_excluded_keys() -> set[str]:
    """prompts 디렉토리 내의 추가 규칙 파일에서 [EXCLUDE_KEYS] 섹션에 등록된 키 목록을 파싱합니다."""
    excluded = set()
    if not os.path.isdir(PROMPTS_DIR):
        return excluded
    for fname in os.listdir(PROMPTS_DIR):
        if fname.lower().endswith(".md"):
            fpath = os.path.join(PROMPTS_DIR, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    in_exclude_section = False
                    for line in f:
                        stripped = line.strip()
                        if "[EXCLUDE_KEYS]" in stripped.upper():
                            in_exclude_section = True
                            continue
                        elif in_exclude_section and (stripped.startswith("###") or (stripped.startswith("[") and stripped.endswith("]"))):
                            in_exclude_section = False
                            continue
                        if in_exclude_section and stripped and not stripped.startswith("#"):
                            clean_key = stripped.lstrip("-*• ").strip()
                            if clean_key:
                                excluded.add(clean_key)
            except Exception:
                pass
    return excluded

def extract_key_context(key: str) -> str:
    """I2 Key 경로로부터 UI/스킬/아이템/대사 등 게임 내 카테고리 힌트를 추출합니다. (규칙: languages.json key_context_rules)"""
    return lang_config.key_context(key)

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# [모델 자동 조회·전환] 선택 모델이 없을 때만 다음 후보로 전환 (model_discovery 사용)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_DISCOVERED_MODELS = {}

_CONFIRMED_MODEL = {}

_MODEL_NOTED = set()

def _is_auto_model(model_name: str) -> bool:
    m = (model_name or "").strip()
    return (not m) or "auto" in m.lower() or "자동" in m or "감지" in m

def _note_model_used(provider: str, wanted: str, used: str):
    """선택한 모델과 실제 사용 모델이 다를 때만 1회 알림"""
    if _is_auto_model(wanted) or not used:
        return
    w = wanted.split()[0].strip()
    if w != used and (provider, w, used) not in _MODEL_NOTED:
        _MODEL_NOTED.add((provider, w, used))
        print(f"⚠️ [{provider}] 선택한 모델 '{w}' 을(를) 사용할 수 없어 '{used}' 로 대체했습니다. (모델 종료/접근 권한 확인)")

def _provider_model_candidates(provider: str, api_key: str, model_pref: str) -> list:
    default = lang_config.model_setting("openai_default" if provider == "openai" else "claude_default", "")
    if provider not in _DISCOVERED_MODELS:
        import model_discovery
        _DISCOVERED_MODELS[provider] = model_discovery.discover(provider, api_key)   # 실패 시 [] (재조회는 프로세스당 1회)
    disc = _DISCOVERED_MODELS[provider]
    out = []
    if not _is_auto_model(model_pref):
        out.append(model_pref.split()[0].strip())
    if _CONFIRMED_MODEL.get(provider):
        out.append(_CONFIRMED_MODEL[provider])
    out += disc[:5]
    if default:
        out.append(default)
    seen, res = set(), []
    for m in out:
        if m and m not in seen:
            seen.add(m)
            res.append(m)
    return res

def _is_model_unavailable(code: int, body: str) -> bool:
    low = (body or "").lower()
    return code == 404 or (code in (400, 403) and "model" in low and any(x in low for x in ("not found", "does not exist", "not exist", "no access", "not have access", "deprecated", "invalid model", "not supported", "decommission")))

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# [오류 가시화] LLM 호출 실패 원인 기록 (키 마스킹·중복 억제) 및 영구 오류 판별
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_SECRET_PAT = re.compile(r"((?:\bkey=|Bearer\s+|x-api-key[\"':=\s]+|api[_-]?key[\"':=\s]+))[A-Za-z0-9_\-.]{8,}", re.IGNORECASE)
_LLM_ERR_NOTED = set()

def _redact(text) -> str:
    """로그·화면에 나가는 오류 문구에서 API 키/토큰 값을 가립니다."""
    return _SECRET_PAT.sub(lambda m: m.group(1) + "***", str(text))

def _http_error_body(e) -> str:
    """HTTPError 본문을 한 번만 읽어 보관 (여러 곳에서 재사용)"""
    body = getattr(e, "_cw_body", None)
    if body is None:
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            body = ""
        try:
            e._cw_body = body
        except Exception:
            pass
    return body

def _is_permanent_llm_error(e) -> bool:
    """재시도·다른 모델 전환으로 해결되지 않는 오류 (키 인증 실패). 설정을 고치기 전에는 반복하지 않는다."""
    if not isinstance(e, urllib.error.HTTPError):
        return False
    low = _http_error_body(e).lower()
    if _is_model_unavailable(e.code, low):
        return False
    if e.code in (401, 403):
        return True
    return e.code == 400 and any(x in low for x in ("api key not valid", "invalid api key", "api_key_invalid", "invalid x-api-key", "authentication"))

def _log_llm_error(provider: str, model: str, err):
    """삼켜지던 LLM 호출 실패의 원인을 오류 종류별로 한 번만 남긴다 (반복 로그 폭주 방지)."""
    if isinstance(err, urllib.error.HTTPError):
        detail = f"HTTP {err.code}: {_http_error_body(err)[:200]}"
        kind = f"http{err.code}"
        if _is_permanent_llm_error(err):
            detail += " → API 키/권한 설정을 확인하세요 (재시도해도 해결되지 않는 오류)"
        elif err.code in (429, 503):
            detail += " → 할당량 초과 또는 일시 과부하"
    else:
        detail = f"{type(err).__name__}: {err}"
        kind = type(err).__name__
    detail = _redact(detail).replace("\n", " ")
    sig = (provider, model, kind, detail[:80])
    if sig in _LLM_ERR_NOTED:
        return
    _LLM_ERR_NOTED.add(sig)
    print(f"⚠️ [{provider}] '{model}' 호출 실패 — {detail}", flush=True)

def _llm_urlopen(req, timeout, provider: str, api_key: str, model_pref: str):
    """urlopen 대체: 요청 본문의 model 을 후보 순서대로 시도 (모델 불가 오류일 때만 다음 후보)."""
    body = json.loads(req.data.decode("utf-8"))
    last_err = None
    for cand in _provider_model_candidates(provider, api_key, model_pref):
        body["model"] = cand
        req.data = json.dumps(body).encode("utf-8")
        try:
            resp = urllib.request.urlopen(req, timeout=timeout)
            _CONFIRMED_MODEL[provider] = cand
            _note_model_used(provider, model_pref, cand)
            return resp
        except urllib.error.HTTPError as e:
            txt = ""
            try:
                txt = e.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            if _is_model_unavailable(e.code, txt):
                last_err = RuntimeError(f"모델 '{cand}' 사용 불가 ({e.code}): {txt[:120]}")
                continue
            raise RuntimeError(_redact(f"HTTP {e.code} ({cand}): {txt[:200]}"))
    raise last_err or RuntimeError("사용 가능한 모델 후보가 없습니다")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# [신설] 사용 가능한 최신 제미나이 모델 실시간 자동 감지 엔진
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_CACHED_ACTIVE_MODELS = []
_CONFIRMED_WORKING_GEMINI_MODEL = None

def get_active_gemini_models(api_key: str, preferred_model: str = "") -> list[str]:
    """
    현재 구글 API 키로 실제 사용 가능한 최신 모델들을 실시간 자동 감지하여 우선순위 순으로 반환합니다.
    - 사용자가 특정 모델을 명시한 경우 해당 모델을 최우선으로 배치
    - 그 외에는 최신 버전 순(3.8 -> 3.7 -> 3.6 -> 3.5 -> flash-latest 등)으로 자동 배치
    """
    global _CACHED_ACTIVE_MODELS, _CONFIRMED_WORKING_GEMINI_MODEL
    fallback = list(lang_config.model_setting("gemini_fallback", []) or ["gemini-flash-latest"])
    if _CACHED_ACTIVE_MODELS:
        models = list(_CACHED_ACTIVE_MODELS)
    else:
        clean_key = (api_key or "").strip()
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={clean_key}"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                raw_models = data.get("models", [])
                gen_models = []
                for m in raw_models:
                    name = m.get("name", "").replace("models/", "")
                    methods = m.get("supportedGenerationMethods", [])
                    if "generateContent" in methods and "gemini" in name.lower():
                        if any(x in name.lower() for x in lang_config.model_setting("gemini_exclude_keywords", [])):
                            continue
                        gen_models.append(name)
                
                if gen_models:
                    def model_priority(m: str):
                        is_flash = "flash" in m.lower()
                        is_preview = "preview" in m.lower()
                        ver_match = re.search(r"(\d+(?:\.\d+)?)", m)
                        ver = float(ver_match.group(1)) if ver_match else 1.0
                        if "latest" in m.lower():
                            ver = 3.0
                        return (1 if is_flash else 0, 0 if is_preview else 1, ver)

                    _CACHED_ACTIVE_MODELS = sorted(gen_models, key=model_priority, reverse=True)
                    models = list(_CACHED_ACTIVE_MODELS)
                else:
                    models = fallback
        except Exception:
            models = fallback

    # 최근 성공이 확인된 활성 모델을 1순위로 즉시 승격
    if _CONFIRMED_WORKING_GEMINI_MODEL and _CONFIRMED_WORKING_GEMINI_MODEL in models:
        models.remove(_CONFIRMED_WORKING_GEMINI_MODEL)
        models.insert(0, _CONFIRMED_WORKING_GEMINI_MODEL)

    # 특정 모델 지정 시 최우선 배치
    pref = (preferred_model or "").strip()
    if pref and "auto" not in pref.lower() and "자동" not in pref:
        clean_pref = pref.split()[0].strip()
        if clean_pref in models:
            models.remove(clean_pref)
            models.insert(0, clean_pref)
        else:
            models.insert(0, clean_pref)

    return models

def get_glossary_translation(trans_dict: dict, target_lang: str) -> str:
    """용어집 딕셔너리에서 대상 언어의 번역어를 동적으로 탐색합니다."""
    if not trans_dict:
        return ""
    # 1. 대상 언어 코드로 직접 조회
    if target_lang in trans_dict and trans_dict[target_lang]:
        return str(trans_dict[target_lang]).strip()
    # 2. 표준 코드/언어명 매칭
    for col_name, val in trans_dict.items():
        if not val or not str(val).strip():
            continue
        col_code, col_full = resolve_language_info(col_name)
        if col_code == target_lang or col_full.lower() == target_lang.lower():
            return str(val).strip()
    return ""

def glossary_prompt_rules(texts, glossary: dict, target_lang: str, review: bool = False) -> list:
    """프롬프트에 넣을 용어집 규칙 목록. 검증(glossary_missing)이 강제하는 용어는 조사가 붙은 짧은 용어까지
    반드시 포함해 프롬프트와 검증 기준이 어긋나지 않게 하고, 그 외 부분 일치 용어는 기존 방식대로 참고용으로 추가한다."""
    if not glossary:
        return []
    texts = [t for t in texts if t]
    joined = " ".join(texts)
    enforced = {}
    for t in texts:
        for ko, exp in glossary_terms_for(t, target_lang, glossary):
            enforced.setdefault(ko, exp)
    rules = []
    for kor_term, trans_dict in sorted(glossary.items(), key=lambda x: len(x[0]), reverse=True):
        if kor_term in enforced:
            target_trans = enforced[kor_term]
        else:
            if kor_term not in joined:
                continue
            # 번역(생성) 프롬프트의 기존 규칙: 2글자 이하 용어는 공백으로 구분된 경우만 참고용으로 포함 (오탐 방지)
            if not review and len(kor_term) <= 2 and f" {kor_term} " not in f" {joined} ":
                continue
            target_trans = get_glossary_translation(trans_dict, target_lang)
        if target_trans:
            rules.append(f"- '{kor_term}' (Preferred Glossary: '{target_trans}')" if review else f"- '{kor_term}' -> '{target_trans}'")
    return rules

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 2. 제미나이(Gemini) 고속 배치 번역 함수 (Batch JSON)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def translate_batch_with_gemini(items: dict[str, str], target_lang: str, api_key: str, glossary: dict[str, dict[str, str]] = None, preferred_model: str = "") -> dict[str, str]:
    _, lang_full = resolve_language_info(target_lang)

    # 1. 고유명사 매칭 (글자 수가 긴 복합어 우선 매칭 & 단어 경계 안전 처리)
    glossary_rules = glossary_prompt_rules(list(items.values()), glossary, target_lang)

    # 2. 언어별 특화 톤앤매너 규칙
    lang_guide_text = lang_config.tone_guide(target_lang, lang_full)

    # 3. 외부 마크다운 프롬프트 템플릿 로드 및 안전한 치환
    template = load_prompt_template("translation_prompt.md")
    additional_rules = load_additional_rules()
    glossary_section = "### OFFICIAL GAME GLOSSARY RULES:\n" + "\n".join(glossary_rules) if glossary_rules else "No specific glossary rules for this batch."
    
    if template:
        prompt_system = template.replace("{target_lang}", lang_full)
        prompt_system = prompt_system.replace("{language_style_guide}", lang_guide_text)
        prompt_system = prompt_system.replace("{glossary_section}", glossary_section)
        prompt_system = prompt_system.replace("{additional_rules}", additional_rules if additional_rules else "None.")
    else:
        # Fallback (템플릿 파일이 없을 때)
        prompt_system = (
            f"You are a professional game translator for an action RPG called 'Dungeon Slasher'.\n"
            f"Translate ALL values in the following JSON into {lang_full}.\n"
            f"CRITICAL RULES:\n"
            f"- Preserve all markup tags and placeholders exactly as-is.\n"
            f"- Output ONLY valid JSON mapping key to translated string.\n"
            f"{glossary_section}\n\n"
            f"{additional_rules}"
        )

    # Key 경로 기반 컨텍스트 힌트 결합
    items_payload = {
        k: {
            "text": text,
            "context": extract_key_context(k)
        }
        for k, text in items.items()
    }

    prompt = f"{prompt_system}\n\nJSON to translate (each item has 'text' and 'context'):\n{json.dumps(items_payload, ensure_ascii=False, indent=2)}\n\nReturn JSON in format: {{\"key\": \"translated text only\"}}"

    candidates = get_active_gemini_models(api_key, preferred_model)

    last_err = ""
    for model_candidate in candidates:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_candidate}:generateContent?key={api_key}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "response_mime_type": "application/json",
                "temperature": 0.1,
                "max_output_tokens": 8192
            }
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})

        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=20) as response:
                    res_data = json.loads(response.read().decode("utf-8"))
                    candidate = res_data.get("candidates", [{}])[0]
                    raw_text = candidate.get("content", {}).get("parts", [{}])[0].get("text", "").strip()
                    
                    if "```" in raw_text:
                        raw_text = re.sub(r"```json\s*", "", raw_text)
                        raw_text = re.sub(r"```\s*", "", raw_text)
                    parsed_json = json.loads(raw_text)
                    clean_res = {}
                    if isinstance(parsed_json, dict):
                        for item_k, item_v in parsed_json.items():
                            if isinstance(item_v, dict):
                                trans_val = (
                                    item_v.get("text")
                                    or item_v.get("translation")
                                    or item_v.get("translated")
                                    or item_v.get("result")
                                    or item_v.get("value")
                                    or item_v.get("target")
                                    )
                                if trans_val is None:
                                    str_cands = [str(v).strip() for v in item_v.values() if isinstance(v, str) and str(v).strip()]
                                    trans_val = str_cands[0] if str_cands else ""
                                clean_res[str(item_k)] = str(trans_val).strip()
                            elif isinstance(item_v, str):
                                clean_res[str(item_k)] = item_v.strip()
                            else:
                                clean_res[str(item_k)] = str(item_v).strip()
                    
                    # 성공 모델을 1순위 캐시에 등록 (다음 호출 시 실패 모델을 건너뛰고 직행!)
                    global _CONFIRMED_WORKING_GEMINI_MODEL
                    _CONFIRMED_WORKING_GEMINI_MODEL = model_candidate
                    _note_model_used("gemini", preferred_model, model_candidate)
                    return clean_res
            except urllib.error.HTTPError as e:
                err_body = _http_error_body(e)
                last_err = _redact(f"{model_candidate} ({e.code}): {err_body}")
                _log_llm_error("gemini", model_candidate, e)
                if _is_permanent_llm_error(e):
                    # 키가 모든 후보 모델에 공통이므로 다른 모델/재시도로 넘어가지 않고 즉시 중단
                    raise RuntimeError(f"Gemini 배치 번역 실패: {last_err}")
                if e.code in [503, 429]:
                    if model_candidate != candidates[-1]:
                        print(f"      ⚡ [{model_candidate}] 할당량(429) 도달 ➔ 대기 없이 다음 최적 모델로 0.1초 즉시 전환!", flush=True)
                        break
                    else:
                        time.sleep(2.0 * (2 ** attempt))
                        continue
                break
            except Exception as e:
                last_err = _redact(str(e))
                _log_llm_error("gemini", model_candidate, e)
                time.sleep(0.5)
                continue

    raise RuntimeError(f"Gemini 배치 번역 실패: {last_err}")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 3. 런북 섹션 04 기반 다면 품질 평가 (MQM 전수 검수기)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def review_mqm_batch(items: dict[str, dict], target_lang: str, api_key: str, glossary: dict[str, dict[str, str]] = None, preferred_model: str = "") -> dict[str, dict]:
    """
    한글 원문과 기존 번역문을 1:1 대조하여
    정확성, 게임 시스템 용어, 문맥, 자연스러움을 다면 평가합니다.
    """
    _, lang_full = resolve_language_info(target_lang)

    # 1. 고유명사 매칭 (글자 수가 긴 복합어 우선 매칭)
    glossary_rules = glossary_prompt_rules(
        [info.get("korean", "") or info.get("source", "") for info in items.values()], glossary, target_lang, review=True)

    # 2. 외부 마크다운 프롬프트 템플릿 로드 및 안전한 치환
    template = load_prompt_template("mqm_review_prompt.md")
    additional_rules = load_additional_rules()
    glossary_section = "### OFFICIAL GAME GLOSSARY GUIDELINES:\n" + "\n".join(glossary_rules) if glossary_rules else "No specific glossary rules for this batch."

    if template:
        prompt_system = template.replace("{target_lang}", lang_full)
        prompt_system = prompt_system.replace("{glossary_section}", glossary_section)
        prompt_system = prompt_system.replace("{additional_rules}", additional_rules if additional_rules else "None.")
    else:
        # Fallback (템플릿 파일이 없을 때)
        prompt_system = (
            f"You are a professional game localization QA reviewer for 'Dungeon Slasher'.\n"
            f"Evaluate the quality, context match, and accuracy of {lang_full} translations against Korean source texts.\n"
            f"{glossary_section}\n"
            f"Tier 1: 9.0~10.0 (PASS), Tier 2: 8.0~8.9 (SUGGESTION), Tier 3: Below 8.0 (CORRECTION).\n\n"
            f"{additional_rules}\n\n"
            f"Output ONLY valid raw JSON with schema: {{\"item_key\": {{\"score\": float, \"has_issue\": bool, \"reason\": str, \"suggested\": str}}}}"
        )

    # Key 경로 기반 컨텍스트 힌트 결합
    items_payload = {
        k: {
            "korean": info.get("korean", "") or info.get("source", ""),
            "current": info.get("current", "") or info.get("text", ""),
            "context": extract_key_context(k)
        }
        for k, info in items.items()
    }

    prompt = f"{prompt_system}\n\nItems to review (Korean vs {lang_full}):\n{json.dumps(items_payload, ensure_ascii=False, indent=2)}"

    candidates = get_active_gemini_models(api_key, preferred_model)
    for model_candidate in candidates:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_candidate}:generateContent?key={api_key}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "response_mime_type": "application/json",
                "temperature": 0.1,
                "max_output_tokens": 8192
            }
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})

        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=35) as response:
                    res_data = json.loads(response.read().decode("utf-8"))
                    raw_text = res_data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
                    if "```" in raw_text:
                        raw_text = re.sub(r"```json\s*", "", raw_text)
                        raw_text = re.sub(r"```\s*", "", raw_text)
                    parsed = json.loads(raw_text.strip())
                    if isinstance(parsed, dict) and parsed:
                        clean_mqm = {}
                        for item_k, item_v in parsed.items():
                            if isinstance(item_v, dict):
                                c_v = item_v.copy()
                                r_val = c_v.get("reason", "")
                                if isinstance(r_val, list):
                                    c_v["reason"] = " | ".join(str(x).strip() for x in r_val if str(x).strip())
                                elif isinstance(r_val, dict):
                                    c_v["reason"] = " | ".join(f"{rk}: {rv}" for rk, rv in r_val.items())
                                else:
                                    c_v["reason"] = str(r_val or "").strip()

                                s_val = c_v.get("suggested", "")
                                if isinstance(s_val, list):
                                    c_v["suggested"] = str(s_val[0]).strip() if s_val else ""
                                elif isinstance(s_val, dict):
                                    c_v["suggested"] = str(list(s_val.values())[0] if s_val else "").strip()
                                else:
                                    c_v["suggested"] = str(s_val or "").strip()
                                clean_mqm[item_k] = c_v
                            else:
                                clean_mqm[item_k] = item_v
                        global _CONFIRMED_WORKING_GEMINI_MODEL
                        _CONFIRMED_WORKING_GEMINI_MODEL = model_candidate
                        _note_model_used("gemini", preferred_model, model_candidate)
                        return clean_mqm
            except urllib.error.HTTPError as e:
                _log_llm_error("gemini", model_candidate, e)
                if _is_permanent_llm_error(e):
                    return {}
                if e.code in (429, 503):
                    if model_candidate != candidates[-1]:
                        print(f"      ⚡ [{model_candidate}] 할당량(429) 도달 ➔ 대기 없이 다음 후보 모델로 즉시 전환!", flush=True)
                        break
                    else:
                        time.sleep(2.0 * (2 ** attempt))
                        continue
                break
            except Exception as e:
                _log_llm_error("gemini", model_candidate, e)
                time.sleep(0.5)
                continue
    return {}

def translate_single_corrective(text: str, target_lang: str, api_key: str, feedback: str, preferred_model: str = "") -> str:
    _, lang_full = resolve_language_info(target_lang)

    prompt = f"""You are a professional game translator for 'Dungeon Slasher'.
Translate the Korean text into {lang_full}.
CRITICAL: Previous attempt was REJECTED for: {feedback}
Produce a corrected translation that completely resolves this issue!
Preserve all tags (<color=#HEX>, <b>) and placeholders ({{0}}, {{1}}) exactly.
Translate every single Korean word into {lang_full}. Never leave Korean words.
Never output explanations, refusals, alternatives (A / B) or empty text.
Output ONLY the translation text.

Text: {text}"""

    candidates = get_active_gemini_models(api_key, preferred_model)
    for model_candidate in candidates:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_candidate}:generateContent?key={api_key}"
        data = json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                ans = res_data["candidates"][0]["content"]["parts"][0]["text"].strip()
                global _CONFIRMED_WORKING_GEMINI_MODEL
                _CONFIRMED_WORKING_GEMINI_MODEL = model_candidate
                _note_model_used("gemini", preferred_model, model_candidate)
                return ans.strip('"`\' \n')
        except urllib.error.HTTPError as e:
            _log_llm_error("gemini", model_candidate, e)
            if _is_permanent_llm_error(e):
                return ""
            if e.code in (429, 503):
                if model_candidate != candidates[-1]:
                    print(f"      ⚡ [{model_candidate}] 할당량(429) 도달 ➔ 대기 없이 다음 후보 모델로 즉시 전환!", flush=True)
                    break
                else:
                    time.sleep(2.0)
                    continue
            continue
        except Exception as e:
            _log_llm_error("gemini", model_candidate, e)
            continue
    return ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# [신설] 다중 제공자 (OpenAI GPT & Anthropic Claude) 엔진 및 통합 디스패처
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def detect_api_key_provider(api_key: str) -> str:
    """API 키 형식으로부터 제공자('gemini', 'openai', 'claude')를 자동 판별합니다."""
    key = (api_key or "").strip()
    if key.startswith("ENC:"):
        from config_manager import decrypt_api_key
        key = decrypt_api_key(key)
    if "AIzaSy" in key or key.startswith("AQ."):
        return "gemini"
    if "sk-ant-" in key:
        return "claude"
    if "sk-" in key:
        return "openai"
    return "gemini"

def _clean_model_name(model_name: str, default_model: str) -> str:
    m = (model_name or "").strip()
    if not m or "auto" in m.lower() or "자동" in m or "감지" in m:
        return default_model
    return m.split()[0].strip()

# --- OpenAI 번역 & MQM ---
def translate_batch_with_openai(items: dict[str, str], target_lang: str, api_key: str, model: str = "", glossary: dict = None) -> dict[str, str]:
    clean_model = _clean_model_name(model, lang_config.model_setting("openai_default", "gpt-4o-mini"))
    _, lang_full = resolve_language_info(target_lang)

    glossary_rules = glossary_prompt_rules(list(items.values()), glossary, target_lang)

    lang_guide_text = lang_config.tone_guide(target_lang, lang_full)

    template = load_prompt_template("translation_prompt.md")
    additional_rules = load_additional_rules()
    glossary_section = "### OFFICIAL GAME GLOSSARY RULES:\n" + "\n".join(glossary_rules) if glossary_rules else "No specific glossary rules for this batch."

    if template:
        prompt_system = template.replace("{target_lang}", lang_full)
        prompt_system = prompt_system.replace("{language_style_guide}", lang_guide_text)
        prompt_system = prompt_system.replace("{glossary_section}", glossary_section)
        prompt_system = prompt_system.replace("{additional_rules}", additional_rules if additional_rules else "None.")
    else:
        prompt_system = (
            f"You are a professional game translator for an action RPG called 'Dungeon Slasher'.\n"
            f"Translate ALL values in the following JSON into {lang_full}.\n"
            f"CRITICAL RULES:\n"
            f"- Preserve all markup tags and placeholders exactly as-is.\n"
            f"- Output ONLY valid JSON mapping key to translated string.\n"
            f"{glossary_section}\n\n"
            f"{additional_rules}"
        )

    items_payload = {
        k: {"text": text, "context": extract_key_context(k)}
        for k, text in items.items()
    }

    user_content = f"JSON to translate (each item has 'text' and 'context'):\n{json.dumps(items_payload, ensure_ascii=False, indent=2)}\n\nReturn JSON in format: {{\"key\": \"translated text only\"}}"

    url = "https://api.openai.com/v1/chat/completions"
    payload = {
        "model": clean_model,
        "messages": [
            {"role": "system", "content": prompt_system},
            {"role": "user", "content": user_content}
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.1
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    })

    try:
        with _llm_urlopen(req, 35, "openai", api_key, model) as resp:
            res_data = json.loads(resp.read().decode("utf-8"))
            raw_text = res_data["choices"][0]["message"]["content"].strip()
            parsed = json.loads(raw_text)
            clean_res = {}
            if isinstance(parsed, dict):
                for item_k, item_v in parsed.items():
                    if isinstance(item_v, dict):
                        trans_val = item_v.get("text") or item_v.get("translation") or item_v.get("translated") or (list(item_v.values())[0] if item_v else "")
                        clean_res[str(item_k)] = str(trans_val).strip()
                    else:
                        clean_res[str(item_k)] = str(item_v).strip()
            return clean_res
    except Exception as e:
        raise RuntimeError(_redact(f"OpenAI ({clean_model}) 배치 번역 실패: {e}"))

def review_mqm_batch_openai(items: dict[str, dict], target_lang: str, api_key: str, model: str = "", glossary: dict = None) -> dict[str, dict]:
    clean_model = _clean_model_name(model, lang_config.model_setting("openai_default", "gpt-4o-mini"))
    _, lang_full = resolve_language_info(target_lang)

    glossary_rules = glossary_prompt_rules(
        [info.get("korean", "") or info.get("source", "") for info in items.values()], glossary, target_lang, review=True)

    template = load_prompt_template("mqm_review_prompt.md")
    additional_rules = load_additional_rules()
    glossary_section = "### OFFICIAL GAME GLOSSARY GUIDELINES:\n" + "\n".join(glossary_rules) if glossary_rules else "No specific glossary rules for this batch."

    if template:
        prompt_system = template.replace("{target_lang}", lang_full)
        prompt_system = prompt_system.replace("{glossary_section}", glossary_section)
        prompt_system = prompt_system.replace("{additional_rules}", additional_rules if additional_rules else "None.")
    else:
        prompt_system = (
            f"You are a professional game localization QA reviewer for 'Dungeon Slasher'.\n"
            f"Evaluate the quality, context match, and accuracy of {lang_full} translations against Korean source texts.\n"
            f"{glossary_section}\n"
            f"Tier 1: 9.0~10.0 (PASS), Tier 2: 8.0~8.9 (SUGGESTION), Tier 3: Below 8.0 (CORRECTION).\n\n"
            f"{additional_rules}\n\n"
            f"Output ONLY valid raw JSON with schema: {{\"item_key\": {{\"score\": float, \"has_issue\": bool, \"reason\": str, \"suggested\": str}}}}"
        )

    items_payload = {
        k: {
            "korean": info.get("korean", "") or info.get("source", ""),
            "current": info.get("current", "") or info.get("text", ""),
            "context": extract_key_context(k)
        }
        for k, info in items.items()
    }

    url = "https://api.openai.com/v1/chat/completions"
    payload = {
        "model": clean_model,
        "messages": [
            {"role": "system", "content": prompt_system},
            {"role": "user", "content": f"Items to review (Korean vs {lang_full}):\n{json.dumps(items_payload, ensure_ascii=False, indent=2)}"}
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.1
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    })

    try:
        with _llm_urlopen(req, 40, "openai", api_key, model) as resp:
            res_data = json.loads(resp.read().decode("utf-8"))
            raw_text = res_data["choices"][0]["message"]["content"].strip()
            parsed = json.loads(raw_text)
            clean_mqm = {}
            if isinstance(parsed, dict):
                for item_k, item_v in parsed.items():
                    if isinstance(item_v, dict):
                        c_v = item_v.copy()
                        r_val = c_v.get("reason", "")
                        if isinstance(r_val, list):
                            c_v["reason"] = " | ".join(str(x).strip() for x in r_val if str(x).strip())
                        elif isinstance(r_val, dict):
                            c_v["reason"] = " | ".join(f"{rk}: {rv}" for rk, rv in r_val.items())
                        else:
                            c_v["reason"] = str(r_val or "").strip()

                        s_val = c_v.get("suggested", "")
                        if isinstance(s_val, list):
                            c_v["suggested"] = str(s_val[0]).strip() if s_val else ""
                        elif isinstance(s_val, dict):
                            c_v["suggested"] = str(list(s_val.values())[0] if s_val else "").strip()
                        else:
                            c_v["suggested"] = str(s_val or "").strip()
                        clean_mqm[item_k] = c_v
                    else:
                        clean_mqm[item_k] = item_v
            return clean_mqm
    except Exception as e:
        _log_llm_error("openai", clean_model, e)
        return {}

def translate_single_corrective_openai(text: str, target_lang: str, api_key: str, model: str = "", feedback: str = "") -> str:
    clean_model = _clean_model_name(model, lang_config.model_setting("openai_default", "gpt-4o-mini"))
    _, lang_full = resolve_language_info(target_lang)

    prompt = f"""You are a professional game translator for 'Dungeon Slasher'.
Translate the Korean text into {lang_full}.
CRITICAL: Previous attempt was REJECTED for: {feedback}
Produce a corrected translation that completely resolves this issue!
Preserve all tags (<color=#HEX>, <b>) and placeholders ({{0}}, {{1}}) exactly.
Translate every single Korean word into {lang_full}. Never leave Korean words.
Never output explanations, refusals, alternatives (A / B) or empty text.
Output ONLY the translation text.

Text: {text}"""

    url = "https://api.openai.com/v1/chat/completions"
    payload = {
        "model": clean_model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    })
    try:
        with _llm_urlopen(req, 20, "openai", api_key, model) as resp:
            res_data = json.loads(resp.read().decode("utf-8"))
            ans = res_data["choices"][0]["message"]["content"].strip()
            return ans.strip('"`\' \n')
    except Exception as e:
        _log_llm_error("openai", clean_model, e)
        return ""

# --- Anthropic Claude 번역 & MQM ---
def translate_batch_with_claude(items: dict[str, str], target_lang: str, api_key: str, model: str = "", glossary: dict = None) -> dict[str, str]:
    clean_model = _clean_model_name(model, lang_config.model_setting("claude_default", "claude-3-5-sonnet-20241022"))
    _, lang_full = resolve_language_info(target_lang)

    glossary_rules = glossary_prompt_rules(list(items.values()), glossary, target_lang)

    lang_guide_text = lang_config.tone_guide(target_lang, lang_full)

    template = load_prompt_template("translation_prompt.md")
    additional_rules = load_additional_rules()
    glossary_section = "### OFFICIAL GAME GLOSSARY RULES:\n" + "\n".join(glossary_rules) if glossary_rules else "No specific glossary rules for this batch."

    if template:
        prompt_system = template.replace("{target_lang}", lang_full)
        prompt_system = prompt_system.replace("{language_style_guide}", lang_guide_text)
        prompt_system = prompt_system.replace("{glossary_section}", glossary_section)
        prompt_system = prompt_system.replace("{additional_rules}", additional_rules if additional_rules else "None.")
    else:
        prompt_system = (
            f"You are a professional game translator for an action RPG called 'Dungeon Slasher'.\n"
            f"Translate ALL values in the following JSON into {lang_full}.\n"
            f"CRITICAL RULES:\n"
            f"- Preserve all markup tags and placeholders exactly as-is.\n"
            f"- Output ONLY valid JSON mapping key to translated string.\n"
            f"{glossary_section}\n\n"
            f"{additional_rules}"
        )

    items_payload = {
        k: {"text": text, "context": extract_key_context(k)}
        for k, text in items.items()
    }

    user_content = f"JSON to translate (each item has 'text' and 'context'):\n{json.dumps(items_payload, ensure_ascii=False, indent=2)}\n\nRespond ONLY with valid raw JSON mapping key to translated string (no explanation)."

    url = "https://api.anthropic.com/v1/messages"
    payload = {
        "model": clean_model,
        "system": prompt_system,
        "messages": [{"role": "user", "content": user_content}],
        "max_tokens": 8192,
        "temperature": 0.1
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01"
    })

    try:
        with _llm_urlopen(req, 35, "claude", api_key, model) as resp:
            res_data = json.loads(resp.read().decode("utf-8"))
            content_list = res_data.get("content", [])
            raw_text = content_list[0].get("text", "").strip() if content_list else ""
            if "```" in raw_text:
                raw_text = re.sub(r"```json\s*", "", raw_text)
                raw_text = re.sub(r"```\s*", "", raw_text)
            parsed = json.loads(raw_text.strip())
            clean_res = {}
            if isinstance(parsed, dict):
                for item_k, item_v in parsed.items():
                    if isinstance(item_v, dict):
                        trans_val = item_v.get("text") or item_v.get("translation") or item_v.get("translated") or (list(item_v.values())[0] if item_v else "")
                        clean_res[str(item_k)] = str(trans_val).strip()
                    else:
                        clean_res[str(item_k)] = str(item_v).strip()
            return clean_res
    except Exception as e:
        raise RuntimeError(_redact(f"Claude ({clean_model}) 배치 번역 실패: {e}"))

def review_mqm_batch_claude(items: dict[str, dict], target_lang: str, api_key: str, model: str = "", glossary: dict = None) -> dict[str, dict]:
    clean_model = _clean_model_name(model, lang_config.model_setting("claude_default", "claude-3-5-sonnet-20241022"))
    _, lang_full = resolve_language_info(target_lang)

    glossary_rules = glossary_prompt_rules(
        [info.get("korean", "") or info.get("source", "") for info in items.values()], glossary, target_lang, review=True)

    template = load_prompt_template("mqm_review_prompt.md")
    additional_rules = load_additional_rules()
    glossary_section = "### OFFICIAL GAME GLOSSARY GUIDELINES:\n" + "\n".join(glossary_rules) if glossary_rules else "No specific glossary rules for this batch."

    if template:
        prompt_system = template.replace("{target_lang}", lang_full)
        prompt_system = prompt_system.replace("{glossary_section}", glossary_section)
        prompt_system = prompt_system.replace("{additional_rules}", additional_rules if additional_rules else "None.")
    else:
        prompt_system = (
            f"You are a professional game localization QA reviewer for 'Dungeon Slasher'.\n"
            f"Evaluate the quality, context match, and accuracy of {lang_full} translations against Korean source texts.\n"
            f"{glossary_section}\n"
            f"Tier 1: 9.0~10.0 (PASS), Tier 2: 8.0~8.9 (SUGGESTION), Tier 3: Below 8.0 (CORRECTION).\n\n"
            f"{additional_rules}\n\n"
            f"Output ONLY valid raw JSON with schema: {{\"item_key\": {{\"score\": float, \"has_issue\": bool, \"reason\": str, \"suggested\": str}}}}"
        )

    items_payload = {
        k: {
            "korean": info.get("korean", "") or info.get("source", ""),
            "current": info.get("current", "") or info.get("text", ""),
            "context": extract_key_context(k)
        }
        for k, info in items.items()
    }

    url = "https://api.anthropic.com/v1/messages"
    payload = {
        "model": clean_model,
        "system": prompt_system,
        "messages": [
            {"role": "user", "content": f"Items to review (Korean vs {lang_full}):\n{json.dumps(items_payload, ensure_ascii=False, indent=2)}\n\nOutput ONLY raw JSON."}
        ],
        "max_tokens": 8192,
        "temperature": 0.1
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01"
    })

    try:
        with _llm_urlopen(req, 40, "claude", api_key, model) as resp:
            res_data = json.loads(resp.read().decode("utf-8"))
            content_list = res_data.get("content", [])
            raw_text = content_list[0].get("text", "").strip() if content_list else ""
            if "```" in raw_text:
                raw_text = re.sub(r"```json\s*", "", raw_text)
                raw_text = re.sub(r"```\s*", "", raw_text)
            parsed = json.loads(raw_text.strip())
            clean_mqm = {}
            if isinstance(parsed, dict):
                for item_k, item_v in parsed.items():
                    if isinstance(item_v, dict):
                        c_v = item_v.copy()
                        r_val = c_v.get("reason", "")
                        if isinstance(r_val, list):
                            c_v["reason"] = " | ".join(str(x).strip() for x in r_val if str(x).strip())
                        elif isinstance(r_val, dict):
                            c_v["reason"] = " | ".join(f"{rk}: {rv}" for rk, rv in r_val.items())
                        else:
                            c_v["reason"] = str(r_val or "").strip()

                        s_val = c_v.get("suggested", "")
                        if isinstance(s_val, list):
                            c_v["suggested"] = str(s_val[0]).strip() if s_val else ""
                        elif isinstance(s_val, dict):
                            c_v["suggested"] = str(list(s_val.values())[0] if s_val else "").strip()
                        else:
                            c_v["suggested"] = str(s_val or "").strip()
                        clean_mqm[item_k] = c_v
                    else:
                        clean_mqm[item_k] = item_v
            return clean_mqm
    except Exception as e:
        _log_llm_error("claude", clean_model, e)
        return {}

def translate_single_corrective_claude(text: str, target_lang: str, api_key: str, model: str = "", feedback: str = "") -> str:
    clean_model = _clean_model_name(model, lang_config.model_setting("claude_default", "claude-3-5-sonnet-20241022"))
    _, lang_full = resolve_language_info(target_lang)

    prompt = f"""You are a professional game translator for 'Dungeon Slasher'.
Translate the Korean text into {lang_full}.
CRITICAL: Previous attempt was REJECTED for: {feedback}
Produce a corrected translation that completely resolves this issue!
Preserve all tags (<color=#HEX>, <b>) and placeholders ({{0}}, {{1}}) exactly.
Translate every single Korean word into {lang_full}. Never leave Korean words.
Never output explanations, refusals, alternatives (A / B) or empty text.
Output ONLY the translation text.

Text: {text}"""

    url = "https://api.anthropic.com/v1/messages"
    payload = {
        "model": clean_model,
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": prompt}]
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01"
    })
    try:
        with _llm_urlopen(req, 20, "claude", api_key, model) as resp:
            res_data = json.loads(resp.read().decode("utf-8"))
            content_list = res_data.get("content", [])
            ans = content_list[0].get("text", "").strip() if content_list else ""
            return ans.strip('"`\' \n')
    except Exception as e:
        _log_llm_error("claude", clean_model, e)
        return ""

# --- 통합 디스패처 (Unified Dispatchers) ---
def translate_batch_unified(items: dict[str, str], target_lang: str, provider: str, api_key: str, model: str = "", glossary: dict = None) -> dict[str, str]:
    if provider == "openai":
        return translate_batch_with_openai(items, target_lang, api_key, model=model, glossary=glossary)
    elif provider == "claude":
        return translate_batch_with_claude(items, target_lang, api_key, model=model, glossary=glossary)
    else:
        return translate_batch_with_gemini(items, target_lang, api_key, preferred_model=model, glossary=glossary)

def review_mqm_batch_unified(items: dict[str, dict], target_lang: str, provider: str, api_key: str, model: str = "", glossary: dict = None) -> dict[str, dict]:
    if provider == "openai":
        return review_mqm_batch_openai(items, target_lang, api_key, model=model, glossary=glossary)
    elif provider == "claude":
        return review_mqm_batch_claude(items, target_lang, api_key, model=model, glossary=glossary)
    else:
        return review_mqm_batch(items, target_lang, api_key, preferred_model=model, glossary=glossary)

def translate_single_corrective_unified(text: str, target_lang: str, provider: str, api_key: str, model: str = "", feedback: str = "") -> str:
    if provider == "openai":
        return translate_single_corrective_openai(text, target_lang, api_key, model=model, feedback=feedback)
    elif provider == "claude":
        return translate_single_corrective_claude(text, target_lang, api_key, model=model, feedback=feedback)
    else:
        return translate_single_corrective(text, target_lang, api_key, feedback=feedback, preferred_model=model)

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 4. 구글 스프레드시트 연동 함수
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def get_gspread_worksheet(sa_json_path: str, sheet_url: str, logger=None):
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ModuleNotFoundError:
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "gspread", "google-auth"])
        import gspread
        from google.oauth2.service_account import Credentials
    scopes = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]

    # 선택한 서비스 계정 키 파일 하나만 사용 (다른 .json 키로 자동 대체하지 않음)
    selected = resolve_selected_service_account(sa_json_path)
    candidates = [selected] if selected else []

    last_err = None
    for cand in candidates:
        cand_name = os.path.basename(cand)
        try:
            if logger:
                logger(f"   • 구글 서비스 계정 인증 시도: {cand_name}")
            creds = Credentials.from_service_account_file(cand, scopes=scopes)
            client = gspread.authorize(creds)
            sheet = client.open_by_url(sheet_url)

            gid_match = re.search(r"gid=([0-9]+)", sheet_url)
            ws = None
            if gid_match:
                target_gid = int(gid_match.group(1))
                for w in sheet.worksheets():
                    if w.id == target_gid:
                        ws = w
                        break
            if not ws:
                ws = sheet.get_worksheet(0)
            if logger:
                email = getattr(creds, 'service_account_email', '')
                logger(f"   ✅ 구글 서비스 계정 연결 성공: {cand_name} ({email})")
            return ws
        except Exception as ex:
            last_err = ex
            if logger:
                logger(f"   ⚠️ {cand_name} 인증/접근 실패: {ex}")
            continue

    if last_err:
        raise last_err
    raise FileNotFoundError(f"선택한 서비스 계정 키 파일을 찾을 수 없습니다: {sa_json_path or '(미선택)'}")

def fetch_google_sheet_rows_fallback(sheet_url: str) -> tuple[list[str], list[dict]]:
    id_match = re.search(r"/d/([a-zA-Z0-9-_]+)", sheet_url)
    if not id_match:
        raise ValueError(f"올바른 구글 스프레드시트 URL 형식이 아닙니다: {sheet_url}")
    
    sheet_id = id_match.group(1)
    gid_match = re.search(r"gid=([0-9]+)", sheet_url)
    gid = gid_match.group(1) if gid_match else "0"

    export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
    req = urllib.request.Request(export_url, headers={"User-Agent": "Mozilla/5.0"})

    with urllib.request.urlopen(req, timeout=15) as resp:
        content = resp.read().decode("utf-8", errors="replace")

    reader = csv.reader(io.StringIO(content))
    headers = next(reader, None)
    if not headers:
        raise ValueError("구글 시트가 비어 있습니다.")

    rows = []
    for row in reader:
        if not row or not any(row):
            continue
        row_dict = {}
        for idx, h in enumerate(headers):
            row_dict[h.strip()] = row[idx].strip() if idx < len(row) else ""
        rows.append(row_dict)

    return headers, rows

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 5. 전수검사 보고서 생성 (CSV 및 엑셀 빨간색 변경 스타일)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def save_audit_reports(headers: list[str], rows: list[dict], target_langs: list[str], lang_col_map: dict, audit_results: dict, dir_path: str, apply_changes: bool = False, sheet_label: str = "", report_filename: str = ""):
    """
    전수검사 결과를 CSV 및 엑셀(XLSX)로 저장합니다.
    - apply_changes=True: 검사 후 바로 교정 적용 모드
    - apply_changes=False: 확인 전용 모드 (원문 보존, 오류 및 권장 수정안만 빨간색 보고서로 표시)
    """
    # 점수/사유 컬럼이 이미 포함되어 있다면 제외하여 순수 데이터 헤더만 유지
    base_headers = [h for h in headers if not h.startswith("[점수/사유]") and not h.startswith("[Score]") and "점수/사유" not in h]
    has_category = any(bool(r.get("Category")) for r in rows)
    if has_category and "Category" not in base_headers:
        if "Keys" in base_headers:
            k_idx = base_headers.index("Keys")
            base_headers.insert(k_idx + 1, "Category")
        else:
            base_headers.insert(0, "Category")

    audit_headers = list(base_headers)
    headers = base_headers
    for lang in target_langs:
        col_name = lang_col_map.get(lang, lang)
        audit_headers.append(f"[점수/사유] {col_name}")

    clean_label = re.sub(r'[\\/*?:"<>| ]', '_', sheet_label) if sheet_label else ""
    rep_name = report_filename or "audit_report_전수검사_결과.xlsx"
    xlsx_path = os.path.join(dir_path, rep_name)
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter

        # 시트 탭 이름 정제 (엑셀 최대 31자 제한 및 특수문자 제거)
        raw_tab_name = sheet_label or ("전수검사_자동교정" if apply_changes else "전수검사_확인전용")
        # 'I2Languages_Skill' -> 'Skill', 'I2Loc 던전슬래셔 스킬 번역' -> '스킬 번역'
        if raw_tab_name.startswith("I2Languages_"):
            clean_tab = raw_tab_name.replace("I2Languages_", "")
        elif "던전슬래셔" in raw_tab_name:
            clean_tab = raw_tab_name.split("던전슬래셔")[-1].strip()
        elif raw_tab_name.startswith("I2Loc "):
            clean_tab = raw_tab_name.replace("I2Loc ", "").strip()
        else:
            clean_tab = raw_tab_name

        clean_tab = re.sub(r'[:\\/?*\[\]]', '_', clean_tab).strip()
        clean_tab = clean_tab[:30] if clean_tab else "전수검사"

        # 기존 엑셀 파일이 있으면 불러와서 탭 추가/갱신, 없으면 새로 생성
        if os.path.exists(xlsx_path):
            try:
                wb = openpyxl.load_workbook(xlsx_path)
            except Exception:
                wb = openpyxl.Workbook()
        else:
            wb = openpyxl.Workbook()

        # 불필요한 기본/임시 더미 탭 정리 목록
        dummy_names = ["Sheet", "전수검사(확인전용)", "전수검사(자동교정)", "전수검사_확인전용", "전수검사_자동교정", "전수검사"]

        # 탭 생성 또는 기존 동일 탭 초기화 (항상 맨 앞 index=0에 배치)
        if clean_tab in wb.sheetnames:
            del wb[clean_tab]
            ws = wb.create_sheet(title=clean_tab, index=0)
        else:
            if len(wb.sheetnames) == 1 and wb.sheetnames[0] in dummy_names:
                ws = wb.active
                ws.title = clean_tab
            else:
                ws = wb.create_sheet(title=clean_tab, index=0)

        # 방금 검수한 탭을 엑셀 첫 화면으로 활성화
        wb.active = ws

        # 남아 있는 이전 더미 탭 자동 정리
        for d in dummy_names:
            if d != clean_tab and d in wb.sheetnames and len(wb.sheetnames) > 1:
                try:
                    del wb[d]
                except Exception:
                    pass

        header_font = Font(name="Pretendard", size=11, bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
        thin_border = Border(
            left=Side(style='thin', color='CBD5E1'),
            right=Side(style='thin', color='CBD5E1'),
            top=Side(style='thin', color='CBD5E1'),
            bottom=Side(style='thin', color='CBD5E1')
        )

        ws.append(audit_headers)
        for col_num in range(1, len(audit_headers) + 1):
            cell = ws.cell(row=1, column=col_num)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = thin_border

        red_font = Font(name="Pretendard", size=10, color="D92D20", bold=True)
        red_fill = PatternFill(start_color="FEE4E2", end_color="FEE4E2", fill_type="solid")
        pass_font = Font(name="Pretendard", size=10, color="16A34A")
        normal_font = Font(name="Pretendard", size=10, color="0F172A")

        for row_idx, r in enumerate(rows, 2):
            k = r.get("Keys", "")
            kor = r.get("Korean", "").strip()
            row_values = []
            for h in headers:
                row_values.append(r.get(h, ""))

            for lang in target_langs:
                col_name = lang_col_map.get(lang, lang)
                # [규칙 1] 한글 내용 없으면 사유 및 권장안 미작성 (공란)
                if not kor:
                    row_values.append("")
                    continue

                meta = audit_results.get((k, lang), {})
                score = meta.get("score", 9.0)
                reason = meta.get("reason", "")
                changed = meta.get("changed", False)
                is_suggestion = meta.get("is_suggestion", False)
                is_new = meta.get("is_new", False)
                suggested = meta.get("new_val", "")
                old_val = meta.get("old_val", r.get(col_name, "").strip())

                is_excluded = meta.get("is_excluded", False)

                # [엄격한 3단계 등급 판정]
                # - 9.0 이상: ✅ 통과
                # - 8.0 이상 9.0 미만: 💡 제안 (자동 수정 절대 금지)
                # - 8.0 미만 (< 8.0): ✏️ 교정 (실제 오역/누락)
                if is_excluded:
                    row_values.append("🔒 번역 제외 (지침 준수)")
                elif meta.get("needs_manual"):
                    alt = f" ➔ 참고안: {suggested}" if suggested and suggested != old_val else ""
                    row_values.append(f"⛔ {score:.1f}점 | [수동 확인 필요] {reason}{alt}")
                elif "검수 미수행" in reason or "기존 번역 유지" in reason:
                    row_values.append("기존 번역 유지 (검수 미수행)")
                elif is_new or (not old_val and suggested):
                    if apply_changes:
                        row_values.append("✨ 신규 번역")
                    else:
                        row_values.append(f"⚠️ 번역 누락 ➔ 권장: {suggested}")
                elif changed or (score < 8.0 and suggested != old_val and suggested):
                    if apply_changes:
                        row_values.append(f"✏️ {score:.1f}점 | [교정 완료] {reason}")
                    else:
                        row_values.append(f"⚠️ {score:.1f}점 | [교정 필요] {reason} ➔ 권장: {suggested}")
                elif meta.get("glossary_diff"):
                    g_alt = f" ➔ 용어집안: {suggested}" if suggested and suggested != old_val else ""
                    row_values.append(f"💡 {score:.1f}점 | [제안] {reason}{g_alt}")
                elif is_suggestion or (8.0 <= score < 9.0):
                    row_values.append(f"💡 {score:.1f}점 | [제안] {reason} ➔ 참고: {suggested}")
                elif score < 8.0:
                    sug_txt = suggested if suggested else "(올바른 번역 생성 필요)"
                    row_values.append(f"⚠️ {score:.1f}점 | [교정 필요] {reason} ➔ 권장: {sug_txt}")
                else:
                    row_values.append("✅ 통과")

            ws.append(row_values)

            # 세련된 상태별 스타일 정의
            blue_font = Font(name="Pretendard", size=10, color="0369A1", bold=True)
            blue_fill = PatternFill(start_color="E0F2FE", end_color="E0F2FE", fill_type="solid")
            orange_font = Font(name="Pretendard", size=10, color="C2410C", bold=True)
            orange_fill = PatternFill(start_color="FFEDD5", end_color="FFEDD5", fill_type="solid")
            yellow_font = Font(name="Pretendard", size=10, color="854D0E", bold=True)
            yellow_fill = PatternFill(start_color="FEF9C3", end_color="FEF9C3", fill_type="solid")
            pass_font = Font(name="Pretendard", size=10, color="16A34A")
            normal_font = Font(name="Pretendard", size=10, color="0F172A")

            # 원본 데이터 스타일 적용
            for col_idx, h in enumerate(headers, 1):
                cell = ws.cell(row=row_idx, column=col_idx)
                cell.border = thin_border
                cell.font = normal_font
                if kor:
                    for lang in target_langs:
                        if h == lang_col_map.get(lang, lang):
                            meta = audit_results.get((k, lang), {})
                            m_score = meta.get("score", 9.0)
                            m_sug = meta.get("new_val", "")
                            m_old = meta.get("old_val", "")
                            if meta.get("is_new", False):
                                cell.font = blue_font
                                cell.fill = blue_fill
                            elif "검수 미수행" in meta.get("reason", ""):
                                pass
                            elif meta.get("changed", False) or (m_score < 8.0 and m_sug != m_old):
                                cell.font = orange_font if apply_changes else red_font
                                cell.fill = orange_fill if apply_changes else red_fill

            # 점수 및 사유 컬럼 스타일 적용
            for lang_i, lang in enumerate(target_langs):
                score_col_idx = len(headers) + lang_i + 1
                cell = ws.cell(row=row_idx, column=score_col_idx)
                cell.border = thin_border
                if not kor:
                    continue
                meta = audit_results.get((k, lang), {})
                m_score = meta.get("score", 9.0)
                m_sug = meta.get("new_val", "")
                m_old = meta.get("old_val", "")
                if meta.get("needs_manual", False):
                    cell.font = Font(name="Pretendard", size=10, color="B42318", bold=True)
                    cell.fill = PatternFill(start_color="FEE4E2", end_color="FEE4E2", fill_type="solid")
                elif meta.get("is_new", False):
                    cell.font = blue_font
                    cell.fill = blue_fill
                elif meta.get("changed", False) or (m_score < 8.0 and m_sug != m_old):
                    cell.font = orange_font if apply_changes else Font(name="Pretendard", size=10, color="B42318", bold=True)
                    cell.fill = orange_fill if apply_changes else PatternFill(start_color="FEE4E2", end_color="FEE4E2", fill_type="solid")
                elif meta.get("is_suggestion", False) or (8.0 <= m_score < 9.0) or (m_score < 8.0 and m_sug == m_old):
                    cell.font = yellow_font
                    cell.fill = yellow_fill
                else:
                    cell.font = pass_font

        # 열 너비 자동 조정
        for col in ws.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 48)

        ws.freeze_panes = "A2"

        # [용어집 차이 요약] 용어·언어별로 묶어 일괄 승인할 수 있는 시트
        try:
            g_sum = {}
            for (gk, glc), gm in audit_results.items():
                for ko, exp in (gm.get("glossary_diff") or []):
                    ent = g_sum.setdefault((ko, glc, exp), {"n": 0, "ex": []})
                    ent["n"] += 1
                    if len(ent["ex"]) < 3:
                        ent["ex"].append(f"{gk}: {str(gm.get('old_val', ''))[:40]}")
            g_tab = ("용어집차이_" + clean_tab)[:31]
            if g_tab in wb.sheetnames:
                del wb[g_tab]
            if g_sum:
                gws = wb.create_sheet(title=g_tab)
                gws.append(["승인(O 입력)", "용어(한글)", "언어", "용어집 번역", "차이 건수", "현재 사용 예시", "안내"])
                for c in range(1, 8):
                    gws.cell(row=1, column=c).font = header_font
                    gws.cell(row=1, column=c).fill = header_fill
                for (ko, glc, exp), ent in sorted(g_sum.items(), key=lambda x: (-x[1]["n"], x[0][0], x[0][1])):
                    gws.append(["", ko, glc, exp, ent["n"], " / ".join(ent["ex"]),
                                "승인(O) 후 '시트 즉시 반영' 시 이 용어의 '➔ 용어집안'을 일괄 적용 (문맥 검토 표시 항목은 제외)"])
                for col, w in zip("ABCDEFG", (12, 16, 8, 20, 10, 70, 60)):
                    gws.column_dimensions[col].width = w
                gws.freeze_panes = "A2"
        except Exception as e:
            print(f"[용어집 차이 요약 시트 생성 오류] {e}")

        try:
            wb.save(xlsx_path)
        except PermissionError:
            alt_path = os.path.join(dir_path, rep_name.replace(".xlsx", "_최신.xlsx"))
            wb.save(alt_path)
            xlsx_path = alt_path
            print(f"⚠️ [주의] 엑셀 파일이 열려 있어 '{alt_path}'로 대체 저장되었습니다. (기존 엑셀 창을 닫아주세요)")
    except Exception as e:
        print(f"[엑셀 보고서 생성 오류] {e}")

    return xlsx_path

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 5-2. 스마트 시트 저장기 (=IMPORTRANGE 수식 감지 시 원본 시트 자동 일괄 저장)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def save_translations_smart(
    worksheet,
    headers: list[str],
    rows: list[dict],
    sa_json_path: str,
    logger=print,
    audit_results: dict = None,
    target_langs: list = None,
    lang_col_map: dict = None,
    apply_changes: bool = False,
    write_scores_to_sheet: bool = True,
    write_cols: set = None
):
    """
    온라인 구글 시트에 번역 결과를 안전하게 저장합니다.
    - 대상 시트의 셀이 =IMPORTRANGE 수식인 경우:
      B 시트의 수식을 절대 파괴하지 않고, 수식에 적힌 원본 시트(A 시트)의 좌표를 자동으로 추적하여
      원본 시트에 단 1번의 Batch Update로 초고속 일괄 반영합니다!
    - 일반 텍스트 시트인 경우:
      기존처럼 해당 워크시트에 직접 일괄 저장합니다.
    - 전수 검사 결과(audit_results)가 있으면 워크시트 우측(H~L열)에 언어별 점수 및 사유를 함께 기록합니다.
    """
    import gspread.utils
    import re
    from google.oauth2.service_account import Credentials

    logger("[스마트 저장 분석] 대상 시트의 수식 구조(=IMPORTRANGE)를 검사 중...")
    try:
        formula_matrix = worksheet.get_all_values(value_render_option='FORMULA')
    except Exception as e:
        logger(f"[경고] 수식 조회 실패, 일반 모드로 진행합니다: {e}")
        formula_matrix = []

    def parse_importrange_target(formula_str: str, current_row_num: int = 1):
        formula_clean = str(formula_str).strip()
        if not formula_clean.upper().startswith("=IMPORTRANGE"):
            return None

        inner = formula_clean[len("=IMPORTRANGE("):].strip()
        if inner.endswith(")"):
            inner = inner[:-1].strip()

        m_url = re.match(r'^["\']([^"\']+)["\']\s*,\s*(.*)$', inner)
        if not m_url:
            return None

        url = m_url.group(1).strip()
        arg2 = m_url.group(2).strip()

        # 1. 단순 정적 패턴: "시트1!B120" 또는 "B120"
        m_simple = re.match(r'^["\'](?:([^!"\'\s]+)!)?([A-Za-z]+)(\d+)["\']$', arg2)
        if m_simple:
            tab = m_simple.group(1) or ""
            col = m_simple.group(2).upper()
            row = m_simple.group(3)
            return url, tab, f"{col}{row}"

        # 2. 문자열 결합 (&) 및 ROW() 수식 패턴: "시트1!H" & ROW() 또는 "시트1!B" & (119 + ROW(A1))
        m_concat = re.search(r'["\'](?:([^!"\'\s]+)!)?([A-Za-z]+)["\']\s*&\s*(.+)', arg2)
        if m_concat:
            tab = m_concat.group(1) or ""
            col = m_concat.group(2).upper()
            expr = m_concat.group(3).strip()

            def replace_row(match):
                arg = match.group(1).strip() if match.group(1) else ""
                if not arg:
                    return str(current_row_num)
                m_digit = re.search(r'\d+', arg)
                return m_digit.group(0) if m_digit else str(current_row_num)

            calc_expr = re.sub(r'ROW\s*\(\s*([^)]*)\s*\)', replace_row, expr, flags=re.IGNORECASE)
            clean_expr = re.sub(r'[^0-9\+\-\*\/\(\)\s]', '', calc_expr)
            try:
                row_num = int(eval(clean_expr, {"__builtins__": None}, {}))
                return url, tab, f"{col}{row_num}"
            except Exception:
                pass

        return None

    has_importrange = False
    for row in formula_matrix:
        for cell in row:
            if isinstance(cell, str) and cell.upper().startswith("=IMPORTRANGE"):
                has_importrange = True
                break
        if has_importrange:
            break

    try:
        rendered_matrix = worksheet.get_all_values()
    except Exception:
        rendered_matrix = []

    # [행/열 매핑] 행 순서(index)가 아니라 Keys 값으로 시트 행을 찾고, 열은 실제 시트 헤더 위치를 사용
    # (엑셀 보고서와 시트의 행 개수·순서·열 구성이 달라도 엉뚱한 셀에 쓰지 않도록)
    _sheet_hdr = [str(x).strip() for x in (rendered_matrix[0] if rendered_matrix else (formula_matrix[0] if formula_matrix else []))]
    _sheet_col = {}
    for _ci, _h in enumerate(_sheet_hdr):
        if _h and _h not in _sheet_col:
            _sheet_col[_h] = _ci
    if not _sheet_col:
        _sheet_col = {h: i for i, h in enumerate(headers) if h}
    _key_ci = _sheet_col.get("Keys")
    _row_by_key = {}
    _dup_keys = 0
    if _key_ci is not None:
        for _ri, _rr in enumerate(rendered_matrix[1:], 1):
            _kv = str(_rr[_key_ci]).strip() if _key_ci < len(_rr) else ""
            if not _kv:
                continue
            if _kv in _row_by_key:
                _dup_keys += 1
                continue
            _row_by_key[_kv] = _ri
    if _dup_keys:
        logger(f"[경고] 시트에 중복 Key {_dup_keys}건이 있어 첫 번째 행에만 반영합니다.")
    _missing_rows = [0]

    def _sheet_row_for(r, r_idx):
        if _row_by_key:
            _ri = _row_by_key.get(str(r.get("Keys", "") or "").strip())
            if _ri is None:
                _missing_rows[0] += 1
            return _ri
        return r_idx + 1

    def _col_allowed(h):
        return bool(h) and (write_cols is None or h in write_cols)

    base_dir = os.path.dirname(os.path.abspath(__file__))
    scopes = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]

    def _open_spreadsheet_auto(target_id: str):
        selected = resolve_selected_service_account(sa_json_path)
        cands = [selected] if selected else []
        for cand in cands:
            try:
                creds = Credentials.from_service_account_file(cand, scopes=scopes)
                gc = gspread.authorize(creds)
                sh = gc.open_by_key(target_id)
                return sh, cand
            except Exception:
                continue
        return None, None

    if not has_importrange:
        # [일반 시트 모드]: 수식이 없으므로 워크시트에 변경된 셀만 정밀 반영
        if apply_changes:
            direct_updates = []
            for r_idx, r in enumerate(rows):
                s_row = _sheet_row_for(r, r_idx)
                if s_row is None:
                    continue
                for h in headers:
                    if not _col_allowed(h):
                        continue
                    c_idx = _sheet_col.get(h)
                    if c_idx is None:
                        continue
                    old_c = ""
                    if s_row < len(formula_matrix) and c_idx < len(formula_matrix[s_row]):
                        old_c = str(formula_matrix[s_row][c_idx] or "").strip()
                    new_c = str(r.get(h, "") or "").strip()
                    if new_c and new_c != old_c:
                        direct_updates.append({
                            "range": gspread.utils.rowcol_to_a1(s_row + 1, c_idx + 1),
                            "values": [[new_c]]
                        })
            if direct_updates:
                try:
                    worksheet.batch_update(direct_updates, value_input_option="USER_ENTERED")
                    logger(f"✅ [구글 시트 직접 저장 완료] 일반 시트에 변경된 {len(direct_updates)}개 셀이 저장되었습니다! (버전 기록 무결성)")
                except Exception as ex_batch:
                    # batch_update 실패 시 전체 덮어쓰기 폴백
                    new_matrix = [headers]
                    for r in rows:
                        new_matrix.append([r.get(h, "") for h in headers])
                    end_cell = gspread.utils.rowcol_to_a1(len(new_matrix), len(headers))
                    worksheet.update(values=new_matrix, range_name=f"A1:{end_cell}")
                    logger(f"✅ [구글 시트 직접 저장 완료] 일반 시트에 번역이 직접 저장되었습니다!")
            else:
                logger("ℹ️ [시트 변경사항 없음] 일반 시트에 기존과 다른 번역 변경사항이 없습니다.")
        else:
            logger("📋 [확인 전용 모드] 일반 시트의 기존 번역은 1글자도 수정하지 않았습니다.")
    else:
        # [스마트 원본 추적 모드]: B 시트의 수식을 보존하고, 원본 시트(A 시트 등)에 일괄 업데이트
        if not apply_changes:
            logger("📋 [확인 전용 모드] 원본 시트의 기존 번역을 유지하며, 검수 점수 및 사유만 기록합니다.")
        else:
            logger("⚡ [수식 셀 감지] 대상 시트가 =IMPORTRANGE 수식으로 연결되어 있습니다.")
            logger("   -> B 시트의 수식을 파괴하지 않고, 수식이 가리키는 원본 시트의 셀을 찾아 일괄 반영합니다!")

            updates_by_target = {}
            opened_spreadsheets = {}
            total_traced_cells = 0
            direct_updates = []

            header_indices = dict(_sheet_col)

            for r_idx, r in enumerate(rows):
                sheet_row_idx = _sheet_row_for(r, r_idx)   # Keys 기준 시트 행
                if sheet_row_idx is None:
                    continue
                current_sheet_row = sheet_row_idx + 1
                if sheet_row_idx >= len(formula_matrix):
                    continue
                f_row = formula_matrix[sheet_row_idx]

                for h in headers:
                    if not _col_allowed(h):
                        continue
                    c_idx = header_indices.get(h)
                    if c_idx is None or c_idx >= len(f_row):
                        continue
                    formula_val = f_row[c_idx]
                    new_val = r.get(h, "")

                    # 현재 렌더링된 값 대조 (실제 번역이 변경된 경우만 수집!)
                    curr_rendered = ""
                    if sheet_row_idx < len(rendered_matrix) and c_idx < len(rendered_matrix[sheet_row_idx]):
                        curr_rendered = str(rendered_matrix[sheet_row_idx][c_idx] or "").strip()

                    # Case A: 수식이 =IMPORTRANGE인 경우 -> 원본 시트 셀로 역추적
                    if isinstance(formula_val, str) and formula_val.upper().startswith("=IMPORTRANGE"):
                        if new_val and str(new_val).strip() != curr_rendered:
                            parsed = parse_importrange_target(formula_val, current_row_num=current_sheet_row)
                            if parsed:
                                target_url, target_tab, target_cell = parsed

                                id_match = re.search(r'/d/([a-zA-Z0-9-_]+)', target_url)
                                target_sheet_id = id_match.group(1) if id_match else target_url

                                key = (target_sheet_id, target_tab)
                                if key not in updates_by_target:
                                    updates_by_target[key] = []
                                updates_by_target[key].append({
                                    "range": target_cell,
                                    "values": [[new_val]]
                                })
                                total_traced_cells += 1
                        continue

                    # Case B: 수식이 없는 일반 텍스트 셀인 경우 -> 현재 B 시트 해당 위치에 직접 쓰기
                    if new_val and str(new_val).strip() != curr_rendered:
                        direct_cell = gspread.utils.rowcol_to_a1(current_sheet_row, c_idx + 1)
                        direct_updates.append({
                            "range": direct_cell,
                            "values": [[new_val]]
                        })

            if _missing_rows[0]:
                logger(f"  ⚠️ 시트에서 Key를 찾지 못한 행 {_missing_rows[0]}개는 반영하지 않았습니다.")
            if direct_updates:
                try:
                    worksheet.batch_update(direct_updates, value_input_option="USER_ENTERED")
                    logger(f"  ✅ 현재 시트 직접 저장 완료 ({len(direct_updates)}개 셀)!")
                except Exception as ex_direct:
                    logger(f"  ❌ 현재 시트 직접 저장 실패: {ex_direct}")

            if updates_by_target:
                logger(f"🚀 총 {len(updates_by_target)}개 원본 탭, {total_traced_cells}개 셀에 대해 초고속 Batch Update 실행 중...")
                for (target_sheet_id, target_tab), update_list in updates_by_target.items():
                    try:
                        if target_sheet_id not in opened_spreadsheets:
                            target_sh, used_sa = _open_spreadsheet_auto(target_sheet_id)
                            if not target_sh:
                                logger(f"  ❌ 원본 시트 ({target_sheet_id}) 열기 실패: 서비스 계정 권한이 없습니다.")
                                continue
                            opened_spreadsheets[target_sheet_id] = target_sh

                        target_sh = opened_spreadsheets[target_sheet_id]

                        if target_tab:
                            target_ws = target_sh.worksheet(target_tab)
                        else:
                            target_ws = target_sh.sheet1

                        target_ws.batch_update(update_list, value_input_option="USER_ENTERED")
                        logger(f"  ✅ 원본 시트 '{target_sh.title}' -> '{target_ws.title}' ({len(update_list)}개 셀) 일괄 저장 완료!")
                    except Exception as e:
                        logger(f"  ❌ 원본 시트 ({target_sheet_id} / {target_tab}) 저장 실패: {e}")

                logger("🎉 [스마트 반영 완료] 원본 시트가 업데이트되어, B 시트에도 수식을 통해 실시간으로 100% 반영되었습니다!")
            elif not direct_updates:
                logger("ℹ️ 수식으로 연결된 변경 대상 셀이 없습니다.")

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # [검수 결과 점수 및 사유 컬럼 작성 (H~L열) 또는 기존 열 정리]
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if not write_scores_to_sheet:
        try:
            logger("🧹 [점수/사유 열 정리] 구글 시트 점수/사유 기록 옵션 OFF ➔ 시트에 남아있는 기존 [점수/사유] 열 검색 중...")
            sheet_first_row = worksheet.row_values(1)
            score_col_indices = [
                idx for idx, h in enumerate(sheet_first_row, 1)
                if any(x in str(h) for x in ["[점수/사유]", "[Score]", "점수/사유"])
            ]
            if score_col_indices:
                logger(f"   -> 기존 작성된 [점수/사유] {len(score_col_indices)}개 열을 발견했습니다. 제거를 시작합니다...")
                # 1. 셀 내용 및 헤더 일괄 삭제 (batch_clear)
                ranges_to_clear = [
                    f"{gspread.utils.rowcol_to_a1(1, col_idx)[:-1]}1:{gspread.utils.rowcol_to_a1(1, col_idx)[:-1]}{worksheet.row_count}"
                    for col_idx in score_col_indices
                ]
                worksheet.batch_clear(ranges_to_clear)
                logger(f"   -> {len(ranges_to_clear)}개 열의 데이터 및 헤더를 깨끗이 초기화했습니다.")

                # 2. 열 삭제 시도 (시트 우측 끝 컬럼 완전 삭제)
                try:
                    min_col = min(score_col_indices)
                    max_col = max(score_col_indices)
                    if max_col - min_col + 1 == len(score_col_indices):
                        worksheet.delete_columns(min_col, max_col)
                    else:
                        for col_idx in sorted(score_col_indices, reverse=True):
                            worksheet.delete_columns(col_idx)
                    logger(f"   -> 기존 [점수/사유] 열({len(score_col_indices)}개) 완전 삭제 완료!")
                except Exception as ex_del:
                    logger(f"   -> (열 삭제 API 대신 데이터 초기화 완료: {ex_del})")
            else:
                logger("   -> 시트에 제거할 기존 [점수/사유] 열이 없습니다.")
        except Exception as e:
            logger(f"⚠️ [점수/사유 열 정리 오류] {e}")
    elif audit_results and target_langs:
        try:
            logger("📝 [검수 점수/사유 기록] 워크시트에 언어별 점수 및 교정 사유 기록 중...")
            base_headers = [h for h in headers if not h.startswith("[점수/사유]") and not h.startswith("[Score]") and "점수/사유" not in h]
            start_col_idx = len(base_headers) + 1
            num_score_cols = len(target_langs)
            end_col_idx = start_col_idx + num_score_cols - 1

            # 워크시트 열 수가 부족하면 확장
            if worksheet.col_count < end_col_idx:
                worksheet.add_cols(end_col_idx - worksheet.col_count)

            start_col_letter = gspread.utils.rowcol_to_a1(1, start_col_idx)[:-1]
            end_col_letter = gspread.utils.rowcol_to_a1(1, end_col_idx)[:-1]

            score_headers = [f"[점수/사유] {lang_col_map.get(lang, lang) if lang_col_map else lang}" for lang in target_langs]
            matrix_to_write = [score_headers]

            for r in rows:
                k = r.get("Keys", "")
                kor = r.get("Korean", "").strip()
                row_scores = []
                for lang in target_langs:
                    col_name = lang_col_map.get(lang, lang) if lang_col_map else lang
                    if not kor:
                        row_scores.append("")
                        continue
                    meta = audit_results.get((k, lang), {})
                    score = meta.get("score", 9.0)
                    reason = meta.get("reason", "")
                    changed = meta.get("changed", False)
                    is_suggestion = meta.get("is_suggestion", False)
                    is_new = meta.get("is_new", False)
                    suggested = meta.get("new_val", "")
                    old_val = meta.get("old_val", r.get(col_name, ""))
                    is_excluded = meta.get("is_excluded", False)

                    if is_excluded:
                        row_scores.append("🔒 번역 제외 (지침 준수)")
                    elif is_new:
                        if apply_changes:
                            row_scores.append("✨ 신규 번역")
                        else:
                            row_scores.append(f"⚠️ 번역 누락 ➔ 권장: {suggested}")
                    elif changed or (score < 8.0 and suggested != old_val):
                        if apply_changes:
                            row_scores.append(f"✏️ {score:.1f}점 | [교정 완료] {reason}")
                        else:
                            row_scores.append(f"⚠️ {score:.1f}점 | [교정 필요] {reason} ➔ 권장: {suggested}")
                    elif is_suggestion or (8.0 <= score < 9.0) or (score < 8.0 and suggested == old_val):
                        row_scores.append(f"💡 {score:.1f}점 | [제안] {reason} ➔ 참고: {suggested}")
                    else:
                        row_scores.append("✅ 통과")
                matrix_to_write.append(row_scores)

            # 이전에 작성되었던 중복 추가 열(M열 이후 등)이 남아 있다면 일괄 초기화
            if worksheet.col_count > end_col_idx:
                extra_start_letter = gspread.utils.rowcol_to_a1(1, end_col_idx + 1)[:-1]
                extra_end_letter = gspread.utils.rowcol_to_a1(1, worksheet.col_count)[:-1]
                clear_range = f"{extra_start_letter}1:{extra_end_letter}{len(matrix_to_write)}"
                worksheet.batch_clear([clear_range])

            range_str = f"{start_col_letter}1:{end_col_letter}{len(matrix_to_write)}"
            worksheet.update(values=matrix_to_write, range_name=range_str)
            logger(f"  ✅ [점수/사유 반영 완료] '{worksheet.title}' 시트 {start_col_letter}열~{end_col_letter}열에 점수/사유가 일괄 기록되었습니다!")
        except Exception as e:
            logger(f"  ⚠️ [점수/사유 기록 오류] {e}")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 5-3. 엑셀 보고서 기반 즉시 시트 반영기 (AI 재호출 0회, 1초 반영)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def apply_excel_report_to_google_sheet(cfg: dict, logger=print) -> int:
    """
    audit_report_전수검사_결과.xlsx 또는 audit_report_테스트_결과.xlsx 파일의 내용을 파싱하여,
    AI 재호출 없이 구글 시트에 일괄 반영합니다.
    - 사용자가 엑셀에서 직접 수정한 텍스트 및 AI 권장안을 최우선 적용
    - A 시트 원본 셀에 번역문 일괄 저장
    - B 시트 점수/사유 열에 최신 상태 기록
    """
    import openpyxl
    dir_path = paths.OUTPUT_DIR
    explicit_path = cfg.get("excel_report_path")
    if explicit_path and os.path.exists(explicit_path):
        xlsx_path = explicit_path
        rep_filename = os.path.basename(xlsx_path)
    elif cfg.get("mode") in ("main", "test") or cfg.get("isTestMode") is not None:
        # 실행 모드가 명시된 경우 해당 모드의 보고서만 사용 (메인/테스트 결과 혼용 방지)
        rep_filename = report_name_for_cfg(cfg)
        xlsx_path = os.path.join(dir_path, rep_filename)
        _alt = xlsx_path.replace(".xlsx", "_최신.xlsx")  # 엑셀에서 열려 있어 대체 저장된 파일이 더 최신이면 사용
        if os.path.exists(_alt) and (not os.path.exists(xlsx_path) or os.path.getmtime(_alt) > os.path.getmtime(xlsx_path)):
            xlsx_path = _alt
            rep_filename = os.path.basename(_alt)
    else:
        cand_full = os.path.join(dir_path, "audit_report_전수검사_결과.xlsx")
        cand_test = os.path.join(dir_path, "audit_report_테스트_결과.xlsx")
        cand_alt = os.path.join(dir_path, "audit_report_전수검사_결과_최신.xlsx")  # 원본이 엑셀에서 열려 있을 때 대체 저장되는 파일
        candidates = [p for p in [cand_full, cand_test, cand_alt] if os.path.exists(p)]
        if candidates:
            xlsx_path = max(candidates, key=os.path.getmtime)
            rep_filename = os.path.basename(xlsx_path)
        else:
            xlsx_path = cand_full
            rep_filename = "audit_report_전수검사_결과.xlsx"

    if not os.path.exists(xlsx_path):
        logger(f"[오류] 반영할 엑셀 보고서 파일이 없습니다: {rep_filename}")
        return 0

    sa_json_path = cfg.get("service_account_json_path", "").strip()
    target_sheet_url = cfg.get("target_sheet_url", "").strip()
    if not target_sheet_url:
        logger("[오류] 대상 구글 시트 URL이 지정되지 않았습니다.")
        return 0

    try:
        wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    except Exception as e:
        logger(f"[오류] 엑셀 파일 열기 실패 (파일이 열려있다면 닫아주세요): {e}")
        return 0

    # 시트 매칭: 현재 설정된 target_sheet_url의 워크시트 로드
    try:
        worksheet = get_gspread_worksheet(sa_json_path, target_sheet_url, logger=logger)
    except Exception as e:
        logger(f"[오류] 구글 시트 연결 실패: {e}")
        return 0

    sheet_title = worksheet.spreadsheet.title
    ws_title = worksheet.title
    
    matched_sheetname = None
    for sname in wb.sheetnames:
        if sname.startswith("용어집차이_"):
            continue
        if sname in sheet_title or sheet_title in sname or sname in ws_title or ws_title in sname:
            matched_sheetname = sname
            break
    if not matched_sheetname:
        matched_sheetname = wb.sheetnames[0]

    excel_ws = wb[matched_sheetname]

    # 용어집 차이 일괄 승인 목록 {(한글 용어, 언어코드)}
    approved_terms = set()
    g_tab = ("용어집차이_" + matched_sheetname)[:31]
    if g_tab not in wb.sheetnames:
        g_tab = next((n for n in wb.sheetnames if n.startswith("용어집차이_")), None)
    if g_tab:
        for g_row in wb[g_tab].iter_rows(min_row=2, values_only=True):
            if g_row and str(g_row[0] or "").strip().upper() in ("O", "Y", "YES", "V", "✔", "승인"):
                approved_terms.add((str(g_row[1] or "").strip(), str(g_row[2] or "").strip()))
        if approved_terms:
            logger(f"📖 [용어집 일괄 승인] {len(approved_terms)}개 용어: " + ", ".join(f"{a}({b})" for a, b in sorted(approved_terms)))
    logger("=" * 65)
    logger(f"📋 [엑셀 보고서 분석] 탭: '{matched_sheetname}' (보고서: {rep_filename}) ➔ 대상 구글 시트: '{sheet_title}'")
    logger("=" * 65)

    header_row = [str(cell.value or '').strip() for cell in excel_ws[1]]
    base_headers = [h for h in header_row if not h.startswith("[점수/사유]") and not h.startswith("[Score]") and "점수/사유" not in h]
    target_langs = cfg.get("target_languages")
    if not target_langs:
        target_langs = []
        for h in base_headers:
            if h.strip().lower() not in ["keys", "type", "description", "korean", "kor", "한국어"]:
                c, _ = resolve_language_info(h.strip())
                if c not in target_langs:
                    target_langs.append(c)
        if not target_langs:
            target_langs = lang_config.default_targets()
    else:
        valid_langs = [l for l in target_langs if find_col_for_lang(base_headers, l)]
        if valid_langs:
            target_langs = valid_langs
    lang_col_map = {lang: find_col_for_lang(base_headers, lang) for lang in target_langs}

    score_col_indices = {}
    for idx, h in enumerate(header_row):
        for lang in target_langs:
            c_name = lang_col_map.get(lang, lang)
            # 정확 일치만 허용 ("[점수/사유] Chinese" 가 "[점수/사유] Chinese (Taiwan)" 에 부분일치되던 버그 수정)
            if h in (f"[점수/사유] {c_name}", f"[Score] {c_name}"):
                score_col_indices[lang] = idx

    # 구글 시트 현재 값 매핑 (사용자 직접 수정 여부 감지용)
    sheet_data = worksheet.get_all_values()
    sheet_header = [h.strip() for h in sheet_data[0]] if sheet_data else []
    sheet_key_idx = sheet_header.index("Keys") if "Keys" in sheet_header else 0
    current_sheet_map = {}
    if sheet_data and len(sheet_data) > 1:
        for s_row in sheet_data[1:]:
            if not s_row or len(s_row) <= sheet_key_idx:
                continue
            s_key = s_row[sheet_key_idx].strip()
            if not s_key:
                continue
            for h_idx, h_name in enumerate(sheet_header):
                if h_idx < len(s_row):
                    current_sheet_map[(s_key, h_name)] = s_row[h_idx].strip()

    rows = []
    audit_results = {}
    total_applied = 0
    applied_items = []

    apply_corrections = cfg.get("apply_corrections", True)
    apply_suggestions = cfg.get("apply_suggestions", False)
    apply_news = cfg.get("apply_news", True)

    for row_cells in excel_ws.iter_rows(min_row=2, values_only=True):
        if not any(row_cells):
            continue
        r = {}
        for idx, h in enumerate(base_headers):
            r[h] = str(row_cells[idx] or "").strip() if idx < len(row_cells) else ""
        
        k = r.get("Keys", "")
        kor = r.get("Korean", "").strip()
        if not (k and kor):
            continue

        for lang in target_langs:
            c_name = lang_col_map.get(lang, lang)
            val_in_excel = r.get(c_name, "").strip()

            score_idx = score_col_indices.get(lang, -1)
            score_text = str(row_cells[score_idx] or "").strip() if score_idx >= 0 and score_idx < len(row_cells) else ""

            orig_sheet_val = current_sheet_map.get((k, c_name), "")

            is_suggestion = ("제안" in score_text or "💡" in score_text or "➔ 참고:" in score_text)
            is_new = ("신규" in score_text or "번역 누락" in score_text or "✨" in score_text)
            is_correction = ("교정" in score_text or "✏️" in score_text or "➔ 권장:" in score_text)

            rec_part = ""
            if score_text.startswith("⛔") or "[수동 확인 필요]" in score_text:
                pass   # 자동 반영 금지 항목 (사용자가 번역 셀을 직접 고친 경우만 Case 1로 반영)
            elif "[용어집 차이]" in score_text:
                # 용어 단위 승인된 경우만 반영 (셀의 모든 차이 용어가 승인 + 문맥 검토 표시 없음)
                g_terms = re.findall(r"'([^']+)'→'[^']*'", score_text.split("(현재 번역 유지)")[0])
                if "➔ 용어집안:" in score_text and g_terms and all((t, lang) in approved_terms for t in g_terms) and "[문맥 검토]" not in score_text:
                    rec_part = score_text.split("➔ 용어집안:", 1)[1].strip()
                    is_suggestion, is_correction = False, True   # 승인된 용어집 교체는 교정으로 반영
            elif "➔ 권장:" in score_text:
                rec_part = score_text.split("➔ 권장:", 1)[1].strip()
            elif is_suggestion and "➔ 참고:" in score_text:
                rec_part = score_text.split("➔ 참고:", 1)[1].strip()
            if rec_part and rec_part == orig_sheet_val:
                rec_part = ""   # 이미 시트와 동일 (변경 없음)

            final_val = val_in_excel
            is_changed = False
            change_reason = ""
            item_type = "correction"

            # Case 1: 사용자가 엑셀에서 번역문 셀을 직접 수정한 경우 (항상 반영)
            if val_in_excel != orig_sheet_val:
                final_val = val_in_excel
                r[c_name] = final_val
                is_changed = True
                change_reason = "엑셀 보고서에서 사용자 직접 수정 반영"
                item_type = "manual"
                _m_ok, _m_msg = GateAValidator.validate(kor, val_in_excel, lang)
                if not _m_ok:
                    logger(f"   ⚠️ [직접 수정값 경고] '{k}' ({lang}): {_m_msg} (사용자 수정이므로 반영은 진행)")
            # Case 2: AI 교정/제안/신규 권장안이 존재하는 경우
            elif rec_part:
                should_apply = False
                if is_suggestion and apply_suggestions:
                    should_apply = True
                    change_reason = f"AI 제안안 반영 ({score_text.split('➔')[0].strip()})"
                    item_type = "suggestion"
                elif is_new and apply_news:
                    should_apply = True
                    change_reason = f"AI 신규 번역 반영 ({score_text.split('➔')[0].strip()})"
                    item_type = "new"
                elif (is_correction or not is_suggestion) and apply_corrections:
                    should_apply = True
                    change_reason = f"AI 교정안 반영 ({score_text.split('➔')[0].strip()})"
                    item_type = "correction"

                if should_apply:
                    _g_ok, _g_msg = GateAValidator.validate(kor, rec_part, lang)
                    if not _g_ok:
                        logger(f"   ⛔ [권장안 반영 건너뜀] '{k}' ({lang}): {_g_msg} ➔ 엑셀에서 직접 수정 후 다시 반영하세요.")
                        should_apply = False
                if should_apply:
                    final_val = rec_part
                    r[c_name] = final_val
                    is_changed = True
            # Case 3: 이미 교정 완료/신규 번역으로 표기된 경우
            elif (("교정" in score_text and apply_corrections) or ("신규" in score_text and apply_news)) and val_in_excel and val_in_excel != orig_sheet_val:
                final_val = val_in_excel
                r[c_name] = final_val
                is_changed = True
                change_reason = "엑셀 교정 내용 반영"
                item_type = "new" if "신규" in score_text else "correction"

            if is_changed:
                total_applied += 1
                applied_items.append({
                    "key": k,
                    "korean": kor,
                    "lang": lang,
                    "old_val": orig_sheet_val,
                    "new_val": final_val,
                    "reason": change_reason,
                    "type": item_type
                })

            m_sc = re.search(r'([0-9.]+)\s*점', score_text)
            sc = float(m_sc.group(1)) if m_sc else (10.0 if is_changed else 9.0)

            audit_results[(k, lang)] = {
                "score": 10.0 if is_changed else sc,
                "reason": change_reason if is_changed else score_text,
                "changed": is_changed,
                "new_val": final_val,
                "old_val": orig_sheet_val,
                "has_kor": True
            }

        rows.append(r)

    logger(f"🚀 [구글 시트 즉시 반영 시작] 총 {len(rows)}개 행 중 수정/교정/신규/제안 {total_applied}건을 온라인 시트에 반영합니다...")
    for it in applied_items:
        logger(f"   • [{it['type']}] {it['key']} ({it['lang']}): {str(it['old_val'])[:40]!r} ➔ {str(it['new_val'])[:40]!r}")
    if total_applied == 0:
        logger("ℹ️ 반영할 변경 항목이 없습니다. (확인 전용 보고서의 '➔ 권장:' 안이 없거나, 반영 옵션이 꺼져 있습니다)")
    save_translations_smart(
        worksheet,
        base_headers,
        rows,
        sa_json_path,
        logger,
        audit_results=audit_results,
        target_langs=target_langs,
        lang_col_map=lang_col_map,
        apply_changes=True,
        write_scores_to_sheet=cfg.get("write_scores_to_sheet", False),
        write_cols={c for c in lang_col_map.values() if c}
    )
    logger("=" * 65)
    logger(f"🎉 [반영 성공] 엑셀 보고서의 모든 수정/교정/제안 내용이 구글 시트에 즉시 반영되었습니다! (총 {total_applied}건 적용 완료)")
    logger("=" * 65)
    return {"total_applied": total_applied, "applied_items": applied_items}


def find_col_for_lang(sheet_headers: list[str], lang_code: str) -> str:
    """시트 헤더에서 언어 코드에 해당하는 컬럼명을 유연하게(Fuzzy) 찾아냅니다."""
    target_info = KNOWN_LANGUAGES.get(lang_code, {})
    aliases = [a.lower() for a in target_info.get("aliases", [])]
    if target_info.get("name"):
        aliases.append(target_info["name"].lower())
    aliases.append(lang_code.lower())

    # 1. 완전 일치
    for h in sheet_headers:
        if h.strip().lower() in aliases:
            return h.strip()
    # 2. 부분 일치
    for h in sheet_headers:
        clean_h = h.strip().lower()
        for a in aliases:
            if a in clean_h or clean_h in a:
                return h.strip()
    # 3. resolve_language_info 표준 코드 매칭
    for h in sheet_headers:
        c, _ = resolve_language_info(h.strip())
        if c == lang_code:
            return h.strip()
    # 4. 시트에 일치하는 컬럼이 없으면 빈 문자열 반환 (없는 언어 가상 컬럼 생성 방지)
    return ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 6. 스마트 통합 파이프라인 (평소: 빈칸만 초고속 / 전수검사: 전체 정밀대조)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_NEG_AFTER = re.compile(r"^\s*(?:은|는|이|가|도)?\s*(?:없|않|아니|아닌|아님|다르지)")

def _kw_hit(text: str, kws) -> bool:
    """키워드 포함 여부 (뒤에 '없이/않음' 같은 부정 표현이 붙은 경우는 제외: 예 '왜곡 없이')."""
    for kw in kws:
        start = 0
        while True:
            i = text.find(kw, start)
            if i < 0:
                break
            tail = text[i + len(kw): i + len(kw) + 8]
            if not _NEG_AFTER.match(tail):
                return True
            start = i + len(kw)
    return False

def _repair_suggestion(kor: str, lang_code: str, suggested: str, feedback: str, provider: str, api_key: str, model: str, tries: int = 2):
    """권장안이 Gate A(태그/한글잔존/식별자 등)를 통과할 때까지 재생성. 반환: (권장안, 통과여부, 실패사유)"""
    cur = suggested or ""
    ok, msg = GateAValidator.validate(kor, cur, lang_code) if cur else (False, "빈 권장안")
    n = 0
    while not ok and n < tries:
        n += 1
        try:
            cand = translate_single_corrective_unified(
                kor, lang_code, provider, api_key, model=model,
                feedback=f"{feedback} / 검증 실패: {msg}. 원문의 모든 태그(<color=...>, </color>)와 [*y], [N] 같은 표기를 위치·개수 그대로 유지할 것"
            )
        except Exception:
            break
        if cand:
            cur = cand
            ok, msg = GateAValidator.validate(kor, cur, lang_code)
    return cur, ok, msg

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# [Runbook] 검증·재시도·후처리·최종 Gate 공용 헬퍼
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
def call_gemini_raw(prompt: str, api_key: str, model: str = "", json_mode: bool = False, timeout: int = 40) -> str:
    """Gemini 단일 프롬프트 호출 (후보 모델 순차 시도). 실패 시 빈 문자열."""
    global _CONFIRMED_WORKING_GEMINI_MODEL
    for mc in get_active_gemini_models(api_key, model):
        gen = {"temperature": 0.1, "max_output_tokens": 8192}
        if json_mode:
            gen["response_mime_type"] = "application/json"
        req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{mc}:generateContent?key={api_key}",
                                     data=json.dumps({"contents": [{"parts": [{"text": prompt}]}], "generationConfig": gen}).encode("utf-8"),
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                d = json.loads(resp.read().decode("utf-8"))
                _CONFIRMED_WORKING_GEMINI_MODEL = mc
                _note_model_used("gemini", model, mc)
                return d["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception as e:
            _log_llm_error("gemini", mc, e)
            if _is_permanent_llm_error(e):
                break   # 키 인증 실패는 다른 모델로도 해결되지 않음
            continue

    return ""

def confirmed_gemini_model():
    """최근 성공이 확인된 Gemini 모델명 (다른 모듈에서 값 복사본이 아닌 최신 값을 읽기 위한 getter)"""
    return _CONFIRMED_WORKING_GEMINI_MODEL


def _llm_call_raw(prompt: str, provider: str, api_key: str, model: str = "", json_mode: bool = False, timeout: int = 40) -> str:
    """제공자 공통 단일 프롬프트 호출. 실패 시 빈 문자열."""
    try:
        if provider == "openai":
            payload = {"model": _clean_model_name(model, lang_config.model_setting("openai_default", "gpt-4o-mini")), "messages": [{"role": "user", "content": prompt}], "temperature": 0.1}
            if json_mode:
                payload["response_format"] = {"type": "json_object"}
            req = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=json.dumps(payload).encode("utf-8"),
                                         headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"})
            with _llm_urlopen(req, timeout, "openai", api_key, model) as resp:
                return json.loads(resp.read().decode("utf-8"))["choices"][0]["message"]["content"].strip()
        if provider == "claude":
            payload = {"model": _clean_model_name(model, lang_config.model_setting("claude_default", "claude-3-5-sonnet-20241022")), "max_tokens": 4096, "messages": [{"role": "user", "content": prompt}]}
            req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(payload).encode("utf-8"),
                                         headers={"Content-Type": "application/json", "x-api-key": api_key, "anthropic-version": "2023-06-01"})
            with _llm_urlopen(req, timeout, "claude", api_key, model) as resp:
                cl = json.loads(resp.read().decode("utf-8")).get("content", [])
                return cl[0].get("text", "").strip() if cl else ""
        return call_gemini_raw(prompt, api_key, model, json_mode, timeout)
    except Exception as e:
        _log_llm_error(provider or "gemini", model or "auto", e)
        return ""
    return ""

def _parse_json_obj(raw: str) -> dict:
    if not raw:
        return {}
    raw = re.sub(r"```(?:json)?\s*", "", raw).replace("```", "").strip()
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        m = re.search(r"\{.*\}", raw, re.S)
        if m:
            try:
                v = json.loads(m.group(0))
                return v if isinstance(v, dict) else {}
            except Exception:
                return {}
    return {}

def _is_punct_only(text: str) -> bool:
    return bool(text.strip()) and bool(re.fullmatch(r"[\d\s\W_]+", text.strip())) and not re.search(r"[가-힣]", text)

def _sanity_check(kor: str, cand: str) -> tuple[bool, str]:
    """재번역 결과가 원문 대비 비정상적으로 짧은지 등 (Runbook 6: 거절·과소 응답 미적용)"""
    k = re.sub(r"<[^>]+>|\[[^\]]*\]|\s", "", kor)
    c = re.sub(r"<[^>]+>|\[[^\]]*\]|\s", "", cand)
    if len(k) >= 12 and len(c) < len(k) * 0.25:
        return False, f"원문 대비 비정상적으로 짧은 번역 ({len(c)}자 / 원문 {len(k)}자)"
    return True, ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# [용어집 우선] 문장 내 용어집 단어(부분 일치) 검사 및 용어집 강제 재번역
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_GLOSS_COL = lang_config.glossary_cols()   # languages.json 의 glossary_col (미등록 언어는 열 이름 자동 매칭으로 폴백)
_GLOSS_SKIP_KO = re.compile(r"[.!?。！？]$|다\.?$")
_GLOSS_SORT_CACHE = {}
# 용어 바로 뒤에 붙으면 용어가 아니라 형용사/동사로 쓰인 것으로 보는 글자 (예: 신성한, 보유한, 강화된, 신성하게)
_GLOSS_INFLECT_NEXT = set("한하해했된되돼적스롭히")
# 용어집 단어를 '부분 문자열'로 포함하지만 전혀 다른 단어인 합성어 (예: 초신성 ⊅ 신성 → supernova). 매칭 전에 마스킹
_GLOSS_COMPOUND_EXCLUDE = ["초신성"]
# 일반 동사/고유명사라 용어로 강제하면 문법이 깨지거나 음차가 오염되는 항목 (용어집 강제 검수 제외, 용어집 정비 전까지 임시)
_GLOSS_IGNORE_TERMS = {"보유", "사낙"}

def check_glossary_conflicts(glossary: dict, logger=print):
    """공백만 다른 용어 항목이 서로 다른 번역을 가지면 경고 (예: '서브 스킬' vs '서브스킬')"""
    by_norm = {}
    for ko in glossary or {}:
        by_norm.setdefault(re.sub(r"\s+", "", ko), []).append(ko)
    for norm, kos in by_norm.items():
        if len(kos) < 2:
            continue
        for lc, col in _GLOSS_COL.items():
            vals = {str((glossary[k] or {}).get(col, "") or "").strip() for k in kos}
            vals.discard("")
            if len(vals) > 1:
                logger(f"⚠️ [Glossary] 공백만 다른 용어가 서로 다른 번역을 가짐 ({' / '.join(repr(k) for k in kos)}, {col}): {' vs '.join(sorted(vals))} → 용어집 정비 필요")

def _find_term(masked: str, ko: str) -> int:
    """용어가 명사로 쓰인 첫 위치 (활용형은 제외), 없으면 -1"""
    start = 0
    while True:
        i = masked.find(ko, start)
        if i < 0:
            return -1
        nxt = masked[i + len(ko): i + len(ko) + 1]
        if not nxt or nxt not in _GLOSS_INFLECT_NEXT:
            return i
        start = i + 1

def glossary_terms_for(kor: str, lang_code: str, glossary: dict) -> list:
    """원문에 포함된 용어집 단어 → [(한글, 지정 번역)]. 긴 용어 우선 매칭(겹치는 짧은 용어 제외), 문장형 항목은 제외."""
    if not glossary or not kor:
        return []
    gid = id(glossary)
    if gid not in _GLOSS_SORT_CACHE:
        _GLOSS_SORT_CACHE.clear()
        _GLOSS_SORT_CACHE[gid] = sorted(glossary.keys(), key=len, reverse=True)
    masked = kor
    for comp in _GLOSS_COMPOUND_EXCLUDE:
        masked = masked.replace(comp, "\x00" * len(comp))
    out = []
    for ko in _GLOSS_SORT_CACHE[gid]:
        if ko in _GLOSS_IGNORE_TERMS:
            continue
        if len(ko) < 2 or _GLOSS_SKIP_KO.search(ko) or ko not in masked or _find_term(masked, ko) < 0:
            continue
        entry = glossary.get(ko) or {}
        exp = str(entry.get(_GLOSS_COL.get(lang_code, ""), "") or "").strip() or get_glossary_translation(entry, lang_code)
        masked = masked.replace(ko, "\x00" * len(ko))
        if not exp or exp.endswith((".", "。")) or "/" in exp:
            continue
        out.append((ko, exp))
    return out

_GLOSS_STEM_MIN = 5   # 이 글자 수 이상인 단어만 어간 비교 (짧은 단어는 정확히 일치해야 함)

def glossary_term_present(exp: str, translation: str, lang_code: str) -> bool:
    """번역문에 용어집 지정 번역이 적용됐는지. 기본은 부분 문자열 일치(exact).
    languages.json 의 glossary_match=stem 언어(스페인어·독일어 등)는 성·수·격 변화를 허용하도록
    단어 끝 2글자를 뗀 어간이 단어 시작 위치에서 일치하면 적용된 것으로 본다."""
    t = re.sub(r"<[^>]+>", "", translation or "").lower()
    e = (exp or "").strip().lower()
    if not e or e in t:
        return bool(e)
    if lang_config.glossary_match(lang_code) != "stem":
        return False
    for w in re.findall(r"\w+", e):
        if w in t:
            continue
        if len(w) < _GLOSS_STEM_MIN:
            return False
        stem = w[:max(4, len(w) - 2)]
        if not re.search(r"(?<!\w)" + re.escape(stem), t):
            return False
    return True

def glossary_missing(kor: str, translation: str, lang_code: str, glossary: dict) -> list:
    """번역문에 빠진 용어집 지정 번역 목록 [(한글, 지정 번역)]"""
    return [(ko, exp) for ko, exp in glossary_terms_for(kor, lang_code, glossary) if not glossary_term_present(exp, translation, lang_code)]

def _gloss_txt(terms) -> str:
    return ", ".join(f"'{ko}'→'{exp}'" for ko, exp in terms)

def glossary_fix_batch(items: dict, lang_code: str, provider: str, api_key: str, model: str = "", logger=None) -> dict:
    """용어집 우선 재번역 + 문맥 검토.
    items = {key: {"korean", "current", "terms": [(ko, exp)], "issue": 추가 교정 사유}}
    반환 {key: {"translation", "ok", "fail", "context_ok", "note", "alternative"}}"""
    _, lang_full = resolve_language_info(lang_code)
    out = {}
    keys = list(items.keys())

    def _ask(sub: dict, extra_fb: dict) -> dict:
        payload = {k: {"korean": it["korean"], "current": it["current"],
                       "required_terms": [{"ko": ko, "target": exp} for ko, exp in it["terms"]],
                       "other_issue": (it.get("issue") or "") + (f" / 이전 시도 거부: {extra_fb[k]}" if k in extra_fb else "")}
                   for k, it in sub.items()}
        prompt = (
            f"You are a game localization editor for the dark fantasy action RPG 'Dungeon Slasher'. Target language: {lang_full}.\n"
            "For each item, produce a corrected translation of the Korean source that uses EVERY 'required_terms' target EXACTLY as written "
            "(the official glossary has TOP PRIORITY over style). Also resolve 'other_issue' if given.\n"
            "Keep the meaning, and keep every markup tag (<color=...>, </color>) and placeholder ([*y], [N], {0}) of the Korean source in the same count.\n"
            "Change as little of 'current' as possible besides the required fixes.\n"
            "Replace ONLY the term itself: keep the surrounding words, grammatical number (plural stays plural), articles, and the casing of the "
            "current text (do NOT capitalize common nouns mid-sentence just because the glossary entry is capitalized), never duplicate a phrase, "
            "and make the sentence grammatical (if a noun term must act as an adjective, rephrase minimally, e.g. 'Shock enemy' -> 'enemy under Shock').\n"
            "Then judge the glossary-applied sentence: if the glossary term reads unnatural, is grammatically awkward, or does not fit this context "
            "(e.g. a proper noun / skill name / different sense), set \"context_ok\": false, write \"note\" in Korean explaining why, and give "
            "\"alternative\": the most natural translation you would recommend instead. Otherwise context_ok=true, note=\"\", alternative=\"\".\n"
            "Return ONLY JSON: {\"key\": {\"translation\": \"...\", \"context_ok\": true, \"note\": \"\", \"alternative\": \"\"}}\n\n"
            + json.dumps(payload, ensure_ascii=False, indent=2))
        return _parse_json_obj(_llm_call_raw(prompt, provider, api_key, model, json_mode=True, timeout=90))

    for ci in range(0, len(keys), 25):
        sub = {k: items[k] for k in keys[ci:ci + 25]}
        fb = {}
        for attempt in range(3):
            if not sub:
                break
            res = _ask(sub, fb)
            nxt = {}
            for k, it in sub.items():
                v = res.get(k) if isinstance(res.get(k), dict) else {}
                cand = GateAValidator.normalize(it["korean"], str(v.get("translation", "") or ""))
                why = ""
                if not cand:
                    why = "빈 응답"
                else:
                    ok, msg = GateAValidator.validate(it["korean"], cand, lang_code)
                    if not ok:
                        why = msg
                    else:
                        miss = [(ko, exp) for ko, exp in it["terms"] if not glossary_term_present(exp, cand, lang_code)]
                        if miss:
                            why = f"용어집 미적용: {_gloss_txt(miss)}"
                if why:
                    fb[k] = why
                    nxt[k] = it
                    out[k] = {"translation": "", "ok": False, "fail": why}
                    continue
                alt = GateAValidator.normalize(it["korean"], str(v.get("alternative", "") or ""))
                ctx_ok = v.get("context_ok", True) not in (False, "false", "False", 0)
                out[k] = {"translation": cand, "ok": True, "fail": "",
                          "context_ok": ctx_ok or not (v.get("note") or alt),
                          "note": str(v.get("note", "") or "").strip(),
                          "alternative": alt if alt and alt != cand and GateAValidator.validate(it["korean"], alt, lang_code)[0] else ""}
            sub = nxt
            if sub and attempt < 2:
                time.sleep(1.0 * (2 ** attempt))
    return out

def translate_with_gate(kor: str, lang_code: str, provider: str, api_key: str, model: str = "", feedback: str = "", max_attempts: int = 3, logger=None, glossary: dict = None) -> tuple[str, bool, str, int]:
    """단건 교정 번역 + Gate A 재검증 반복. 실패 사유를 다음 시도 feedback으로 주입, 빈 응답은 2→4→8초 backoff.
    반환: (번역, 통과여부, 마지막 실패 사유, 시도 횟수)"""
    if _is_punct_only(kor):
        return kor.strip(), True, "", 0
    fb = feedback or "원문에 정확히 부합하는 번역 필요"
    _terms = glossary_terms_for(kor, lang_code, glossary) if glossary else []
    if _terms:
        fb = f"{fb} / MANDATORY glossary terms (use exactly): {_gloss_txt(_terms)}"
    last = ""
    for attempt in range(1, max(1, max_attempts) + 1):
        try:
            cand = translate_single_corrective_unified(kor, lang_code, provider, api_key, model=model, feedback=fb)
        except Exception as e:
            cand = ""
            last = f"API 오류: {e}"
        cand = GateAValidator.normalize(kor, cand)
        if not cand:
            last = last or "빈 응답 (API 미응답)"
            if attempt < max_attempts:
                time.sleep(2.0 * (2 ** (attempt - 1)))
            continue
        ok, msg = GateAValidator.validate(kor, cand, lang_code)
        if ok:
            ok, msg = _sanity_check(kor, cand)
        if ok and _terms:
            _miss = glossary_missing(kor, cand, lang_code, glossary)
            if _miss:
                ok, msg = False, f"용어집 미적용: {_gloss_txt(_miss)}"
        if ok:
            return cand, True, "", attempt
        last = msg
        fb = f"{feedback} / 이전 시도 거부 사유: {msg}" if feedback else f"이전 시도 거부 사유: {msg}"
    return "", False, last, max_attempts

def translate_batch_gated(items: dict, lang_code: str, provider: str, api_key: str, model: str = "", glossary: dict = None, logger=None, max_attempts: int = 3) -> tuple[dict, dict]:
    """배치 번역 → key 무결성 확인 → 정규화 → Gate A → 실패 항목만 사유를 feedback으로 단건 재시도.
    반환: (검증 통과 결과 {key: text}, 실패 {key: reason})"""
    log = logger or (lambda m: None)
    results, failures = {}, {}
    todo = {}
    for k, kor in items.items():
        if _is_punct_only(kor):
            results[k] = kor.strip()   # 구두점/숫자 전용 원문은 그대로 복사
        else:
            todo[k] = kor
    if not todo:
        return results, failures
    raw = {}
    for b_try in range(2):
        try:
            raw = translate_batch_unified(todo, lang_code, provider, api_key, model=model, glossary=glossary) or {}
        except Exception as e:
            log(f"      ⚠️ [{lang_code}] 배치 번역 호출 실패: {e}")
            raw = {}
        if raw:
            break
        time.sleep(2.0)
    extra = [k for k in raw if k not in todo]
    missing = [k for k in todo if k not in raw]
    if extra or missing:
        log(f"      [BatchKeyIntegrity] {lang_code}: 요청 {len(todo)} / 응답 {len(raw)} | 누락 {len(missing)} {missing[:5]} | 추가(폐기) {len(extra)} {extra[:5]}")
    retry = {}
    for k, kor in todo.items():
        v = raw.get(k, "")
        if isinstance(v, dict):
            v = v.get("text") or v.get("translation") or v.get("translated") or (list(v.values())[0] if v else "")
        cand = GateAValidator.normalize(kor, str(v or ""))
        if not cand:
            retry[k] = "배치 응답에서 누락된 항목"
            continue
        ok, msg = GateAValidator.validate(kor, cand, lang_code)
        if ok and glossary:
            _miss = glossary_missing(kor, cand, lang_code, glossary)
            if _miss:
                ok, msg = False, f"용어집 미적용: {_gloss_txt(_miss)}"
        if ok:
            results[k] = cand
        else:
            retry[k] = msg
    if retry:
        log(f"      🔁 [{lang_code}] Gate A 미통과/누락 {len(retry)}건 → 사유 feedback 단건 재번역 (최대 {max_attempts}회)")
    for k, why in retry.items():
        cand, ok, msg, n = translate_with_gate(todo[k], lang_code, provider, api_key, model, feedback=why, max_attempts=max_attempts, glossary=glossary)
        if ok:
            results[k] = cand
            log(f"        ✔ '{k}' 재번역 통과 (시도 {n}회, 최초 사유: {why[:60]})")
        else:
            failures[k] = msg or why
            log(f"        ✖ '{k}' 재번역 실패 ({max_attempts}회 소진): {msg or why}")
    return results, failures

def fix_tags_llm(items: dict, provider: str, api_key: str, model: str = "") -> dict:
    """TagMismatchFixer: 번역 의미는 그대로 두고 태그만 원문과 일치하도록 교정. items={key: (korean, translation)}"""
    if not items:
        return {}
    payload = {k: {"original": o, "translation": t} for k, (o, t) in items.items()}
    prompt = ("You are a markup tag fixer for game translations. Your ONLY job is to ensure the translation has exactly the same markup tags "
              "and placeholders as the Korean original. Count every <b>, </b>, <color=...>, </color> tag and every [*y], [N], {0} placeholder.\n"
              "Rules:\n- The fixed translation MUST have the same tags in the same nesting order.\n"
              "- Do NOT change the translation text itself, only add/fix/reorder tags and placeholders.\n"
              "- Respond in JSON only: { \"id1\": \"fixed translation\", ... }\n\n" + json.dumps(payload, ensure_ascii=False, indent=2))
    res = _parse_json_obj(_llm_call_raw(prompt, provider, api_key, model, json_mode=True))
    return {k: str(v).strip() for k, v in res.items() if k in items and isinstance(v, (str, int, float))}

def _parse_review_score(res) -> tuple[float, bool]:
    """Fail-closed: 점수 누락·형식 오류는 통과가 아닌 '미검수'. 반환 (score, 유효여부)"""
    if not isinstance(res, dict) or "score" not in res:
        return 0.0, False
    try:
        sc = float(res.get("score"))
    except (TypeError, ValueError):
        return 0.0, False
    if not (0.0 <= sc <= 10.0):
        return 0.0, False
    return sc, True

def _write_evidence(dir_path: str, sheet_name: str, summary: dict, change_rows: list, violations: list, logger=print):
    """Runbook 7/8: 실행 증적 (요약 JSON, 변경 리포트 xlsx, 위반 TSV) 저장"""
    import datetime
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    ev_dir = os.path.join(dir_path, "evidence")
    os.makedirs(ev_dir, exist_ok=True)
    base = os.path.join(ev_dir, f"{ts}_{re.sub(r'[^0-9A-Za-z가-힣_-]+', '_', sheet_name or 'sheet')}")
    paths = {}
    try:
        with open(base + "_summary.json", "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        paths["summary"] = base + "_summary.json"
    except Exception as e:
        logger(f"   ⚠️ 증적 요약 저장 실패: {e}")
    try:
        with open(base + "_violations.tsv", "w", encoding="utf-8", newline="") as f:
            f.write("key\tlang\tcode\tscope\tmessage\ttranslation\n")
            for v in violations:
                f.write("\t".join(str(v.get(c, "")).replace("\t", " ").replace("\r", " ").replace("\n", "\\n")
                                  for c in ("key", "lang", "code", "scope", "message", "translation")) + "\n")
        paths["violations"] = base + "_violations.tsv"
    except Exception as e:
        logger(f"   ⚠️ 위반 TSV 저장 실패: {e}")
    try:
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "changes"
        cols = ["key", "lang", "korean", "old", "new", "status", "score", "attempts", "applied", "reason"]
        ws.append(cols)
        for c in change_rows:
            ws.append([c.get(x, "") for x in cols])
        wb.save(base + "_changes.xlsx")
        paths["changes"] = base + "_changes.xlsx"
    except Exception as e:
        logger(f"   ⚠️ 변경 리포트 저장 실패: {e}")
    return paths

# 한 번의 실행(여러 시트/탭 포함)에서 나온 결과 건수 집계 - 웹 실행기가 완료 이벤트/스케줄 이력에 사용
_RUN_SUMMARY = {"new": 0, "corrected": 0, "suggested": 0, "passed": 0}


def _classify_audit_meta(meta: dict) -> str:
    """보고서에 기록되는 등급과 같은 기준으로 한 셀의 결과를 분류 (new / corrected / suggested / passed / skipped)"""
    if meta.get("is_excluded"):
        return "skipped"
    if meta.get("needs_manual"):
        return "corrected"
    reason = meta.get("reason", "") or ""
    if "검수 미수행" in reason or "기존 번역 유지" in reason:
        return "skipped"
    score = meta.get("score", 9.0)
    sug = meta.get("new_val", "")
    old = meta.get("old_val", "")
    if meta.get("is_new") or (not old and sug):
        return "new"
    if meta.get("changed") or (score < 8.0 and sug != old and sug):
        return "corrected"
    if meta.get("glossary_diff") or meta.get("is_suggestion") or (8.0 <= score < 9.0):
        return "suggested"
    if score < 8.0:
        return "corrected"
    return "passed"


def _accumulate_run_summary(audit_results: dict):
    for meta in (audit_results or {}).values():
        kind = _classify_audit_meta(meta)
        if kind in _RUN_SUMMARY:
            _RUN_SUMMARY[kind] += 1


def execute_single_sheet_pipeline(cfg: dict, logger=print) -> int:
    sheet_start_time = time.time()
    is_full_audit = cfg.get("full_audit_mode", False)
    apply_changes = cfg.get("audit_apply_changes", False)
    sheet_name = cfg.get("current_sheet_name", "")

    active_provider = cfg.get("active_llm_provider", "").strip()
    if not active_provider:
        active_provider = detect_api_key_provider(cfg.get("api_key", ""))

    if active_provider == "openai":
        api_key = cfg.get("openai_api_key", "").strip() or cfg.get("api_key", "").strip()
        selected_model = cfg.get("openai_model", "") or cfg.get("model", "") or lang_config.model_setting("openai_default", "gpt-4o-mini")
    elif active_provider == "claude":
        api_key = cfg.get("claude_api_key", "").strip() or cfg.get("api_key", "").strip()
        selected_model = cfg.get("claude_model", "") or cfg.get("model", "") or lang_config.model_setting("claude_default", "claude-3-5-sonnet-20241022")
    else:
        active_provider = "gemini"
        api_key = cfg.get("gemini_api_key", "").strip() or cfg.get("api_key", "").strip()
        selected_model = cfg.get("gemini_model", "") or cfg.get("model", "")

    if not api_key:
        logger(f"[오류] {active_provider.upper()} API Key가 설정되어 있지 않습니다.")
        return 0

    sa_json_path = cfg.get("service_account_json_path", "").strip()

    target_source_mode = cfg.get("target_source_mode", "custom_url")
    is_local_asset = (target_source_mode == "local_asset")

    if "_preloaded_rows" in cfg:
        headers = cfg["_preloaded_headers"]
        rows = cfg["_preloaded_rows"]
        # 번역 처리 전 원본 상태 보존 → 저장 시 변경된 항목만 추려서 전송
        import copy
        cfg["_original_rows"] = copy.deepcopy(rows)
        worksheet = None
        use_service_account = False
        logger(f"[1/3] 📋 시트 데이터 로드 완료: '{sheet_name}' (총 {len(rows)}개 항목)")
    elif is_local_asset:
        local_asset_path = cfg.get("local_i2_asset_path") or get_default_local_i2_asset_path()
        category_filter = cfg.get("local_i2_category", "Skill")
        if not sheet_name:
            sheet_name = f"I2Languages_{category_filter}"

        logger(f"[1/3] 🎮 로컬 유니티 에셋 로드 중: {local_asset_path}")
        logger(f"      선택 카테고리: '{category_filter}' (오프라인 고속 파싱)")
        try:
            headers, rows = parse_local_i2languages_asset(local_asset_path, category_filter)
            logger(f"      성공! 로컬 에셋에서 총 {len(rows)}개 항목을 로드했습니다. (네트워크/권한 불필요)")
        except Exception as e:
            logger(f"[오류] 로컬 I2Languages.asset 로드 실패: {e}")
            return 0
        worksheet = None
        use_service_account = False
    else:
        target_sheet_url = cfg.get("target_sheet_url", "").strip()
        if not target_sheet_url:
            logger("[오류] 번역할 대상 구글 시트 URL이 비어 있습니다.")
            return 0

        sa_json_path = cfg.get("service_account_json_path", "").strip()
        worksheet = None
        use_service_account = False

        # 1. 구글 시트 연결
        try:
            logger(f"[1/3] 구글 서비스 계정 인증 진행 중...")
            worksheet = get_gspread_worksheet(sa_json_path, target_sheet_url, logger=logger)
            use_service_account = True
            sheet_title = worksheet.spreadsheet.title
            logger(f"      시트 '{sheet_title}' (탭: {worksheet.title}) 연결 완료!")
            if not sheet_name:
                sheet_name = sheet_title
            
            all_values = worksheet.get_all_values()
            raw_headers = [h.strip() for h in all_values[0]]
            # [중복 방지] 이전 실행 시 작성된 점수/사유 컬럼은 원본 데이터 헤더에서 제외
            headers = [h for h in raw_headers if not h.startswith("[점수/사유]") and not h.startswith("[Score]") and "점수/사유" not in h]
            
            # 기존 시트의 [점수/사유] 열 정보를 파싱하여 row_dict에 보존
            score_header_map = {}
            for idx, h in enumerate(raw_headers):
                if "[점수/사유]" in h or "[Score]" in h or "점수/사유" in h:
                    score_header_map[h] = idx

            rows = []
            for r in all_values[1:]:
                if not any(r): continue
                row_dict = {h: r[idx].strip() if idx < len(r) else "" for idx, h in enumerate(headers)}
                for sh_name, c_idx in score_header_map.items():
                    row_dict[sh_name] = r[c_idx].strip() if c_idx < len(r) else ""
                rows.append(row_dict)
        except Exception as e:
            logger(f"      [서비스 계정 연결 실패] {e}")
            worksheet = None
            use_service_account = False

        if not use_service_account:
            csv_success = False
            try:
                logger(f"[1/3] 구글 시트 공개 데이터(CSV) 읽는 중...")
                headers, rows = fetch_google_sheet_rows_fallback(target_sheet_url)
                logger(f"      성공! 총 {len(rows)}개 항목을 가져왔습니다.")
                csv_success = True
            except Exception as e:
                logger(f"      [공개 CSV 읽기 실패] {e}")

            if not csv_success:
                sheet_key_match = re.search(r"/d/([a-zA-Z0-9-_]+)", target_sheet_url)
                if sheet_key_match:
                    sheet_key = sheet_key_match.group(1)
                    logger(f"      -> I2 Web Service를 통해 직접 비공개 시트 동기화 시도 중...")
                    try:
                        headers, rows = fetch_i2_sheet_rows(sheet_key)
                        logger(f"      성공! I2 Web Service에서 총 {len(rows)}개 항목을 가져왔습니다!")
                    except Exception as ex:
                        logger(f"[오류] I2 Web Service 읽기 실패: {ex}")
                        return 0
                else:
                    logger("[오류] 올바른 구글 시트 키를 찾을 수 없습니다.")
                    return 0

    # 시트에서 읽은 데이터가 비어 있으면 빈 보고서로 기존 결과를 덮어쓰지 않도록 즉시 중단
    if not rows:
        logger(f"[오류] 시트에서 가져온 데이터가 없습니다. (시트 주소/권한/탭을 확인해 주세요: '{sheet_name or cfg.get('target_sheet_url', '')}')")
        return 0

    # 헤더 기반 동적 컬럼 매핑 (Spanish, Spain, Traditional Chinese 등 유연 자동 감지)
    configured_target_langs = cfg.get("target_languages")
    
    # 시트 헤더에 실제 존재하는 언어 컬럼들 파악
    sheet_lang_codes = []
    for h in headers:
        if h.strip().lower() not in ["keys", "type", "description", "korean", "kor", "한국어"]:
            c, _ = resolve_language_info(h.strip())
            if c and c not in sheet_lang_codes:
                sheet_lang_codes.append(c)

    if not configured_target_langs:
        target_langs = sheet_lang_codes if sheet_lang_codes else lang_config.default_targets()
    else:
        # 사용자가 선택한 언어 중, '해당 시트에 실제로 컬럼이 존재하는 언어'만 엄격 필터링!
        valid_langs = [l for l in configured_target_langs if find_col_for_lang(headers, l)]
        if valid_langs:
            target_langs = valid_langs
        else:
            target_langs = sheet_lang_codes if sheet_lang_codes else lang_config.default_targets()

    lang_col_map = {lang: find_col_for_lang(headers, lang) for lang in target_langs}

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # [Glossary 동기화] 구글 시트에서 공식 고유명사 용어집 실시간 로드
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    glossary_url = cfg.get("glossary_sheet_url", "")
    glossary = {}
    try:
        glossary = fetch_glossary_from_google_sheet(glossary_url, sa_json_path)
        if glossary:
            logger(f"📖 [Glossary] 총 {len(glossary)}개 공식 고유명사 용어집 적용 완료!")
        else:
            logger("📖 [Glossary] 용어집이 비어 있거나 로드되지 않았습니다. (일반 번역 규칙 적용)")
    except Exception as e:
        logger(f"⚠️ [Glossary 동기화 오류] {e} (로컬 폴백 진행)")

    lang_config.warn_unregistered(target_langs, logger)
    if glossary:
        check_glossary_conflicts(glossary, logger)
        _g_map = _GLOSS_COL
        for _lc in target_langs:
            _gn = _g_map.get(_lc, resolve_language_info(_lc)[1])
            if not any((_v or {}).get(_gn) for _v in glossary.values()):
                logger(f"⚠️ [Glossary] 용어집에 '{_gn}' 열(또는 값)이 없어 {_lc} 는 용어집 강제 검수가 적용되지 않습니다.")
    logger(f"[2/3] 총 {len(rows)}개 행 로드 완료 | 대상 언어: {', '.join(target_langs)}")

    # [Runbook] 입력 스냅샷·해시 (증적 및 원본 복원용), 게이트 번역 래퍼
    import copy as _copy, hashlib as _hashlib
    input_snapshot = {(r.get("Keys", ""), lc): (r.get(lang_col_map.get(lc, lc), "") or "").strip() for r in rows for lc in target_langs}
    input_hash = _hashlib.sha256(json.dumps([[r.get("Keys", ""), r.get("Korean", "")] + [r.get(lang_col_map.get(lc, lc), "") for lc in target_langs] for r in rows], ensure_ascii=False).encode("utf-8")).hexdigest()
    max_attempts = int(cfg.get("max_retry_attempts", 3) or 3)
    enable_rescore = cfg.get("enable_rescore", True)
    gate_failures = {}
    run_stats = {"rescore_rounds": 0, "rescore_retranslations": 0, "postprocess_rounds": 0, "postprocess_fixed": 0, "reverted": 0}

    def _gated_batch(c_dict, lc):
        res, fails = translate_batch_gated(c_dict, lc, active_provider, api_key, model=selected_model, glossary=glossary, logger=logger, max_attempts=max_attempts)
        for fk, fv in fails.items():
            gate_failures[(fk, lc)] = fv
        return res

    total_changes_count = 0
    audit_results = {}
    CHUNK_SIZE = 70

    valid_rows_count = sum(1 for r in rows if r.get("Keys") and r.get("Korean", "").strip())
    total_items_to_process = valid_rows_count * len(target_langs)
    completed_items_count = 0

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # [전체 진행도 사전 계산] 언어별 청크 작업 단위 산출
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    import math
    total_work_units = 0
    if is_full_audit:
        for lc in target_langs:
            c_col = lang_col_map.get(lc, lc)
            c_missing = 0
            c_audit = 0
            for r in rows:
                k = r.get("Keys", "")
                kor = r.get("Korean", "").strip()
                if not (k and kor): continue
                c_val = r.get(c_col, "").strip()
                if not c_val: c_missing += 1
                else: c_audit += 1
            u_m = math.ceil(c_missing / CHUNK_SIZE) if c_missing > 0 else 0
            u_a = math.ceil(c_audit / CHUNK_SIZE) if c_audit > 0 else 0
            total_work_units += max(1, u_m + u_a)
    else:
        for lc in target_langs:
            c_col = lang_col_map.get(lc, lc)
            c_empty = sum(1 for r in rows if r.get("Keys") and r.get("Korean", "").strip() and not r.get(c_col, "").strip())
            total_work_units += max(1, math.ceil(c_empty / CHUNK_SIZE))

    total_work_units = max(1, total_work_units)
    completed_work_units = 0

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # [모드 A] 전수 검사 모드 (Full Audit): 기존 번역 1:1 대조
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if is_full_audit:
        audit_cache = load_audit_cache()
        excluded_keys = load_excluded_keys()
        audit_start_time = time.time()
        if excluded_keys:
            logger(f"   🔒 [지침 적용] 총 {len(excluded_keys)}개의 Key가 번역/검수 제외 목록으로 등록되어 원문이 보호됩니다.")
        if active_provider == "gemini":
            detected_models = get_active_gemini_models(api_key, selected_model)
            logger(f"🤖 [Google Gemini] 1순위: {detected_models[0]} (자동 승계 후보: {', '.join(detected_models[1:4])})")
        elif active_provider == "claude":
            logger(f"🤖 [Anthropic Claude] 모델: {selected_model or 'claude-3-5-sonnet-20241022'}")
        else:
            logger(f"🤖 [OpenAI GPT] 모델: {selected_model or 'gpt-4o-mini'}")
        logger(f"\n[3/3] 🔍 [전수 검사 실행] 한글 원문 vs 기존 번역 문맥 대조 시작... ({'자동 교정 모드' if apply_changes else '확인 전용 모드'})")
        
        for lang_idx, lang_code in enumerate(target_langs, 1):
            col_name = lang_col_map.get(lang_code, lang_code)
            logger("-" * 55)
            logger(f"🌐 [{lang_code}] 전수 품질 검수 준비 중...")

            items_to_audit = {}
            items_missing = {}
            preserved_suggestions = {}

            score_col_header = f"[점수/사유] {col_name}"

            for r in rows:
                k = r.get("Keys", "")
                kor = r.get("Korean", "").strip()
                curr_trans = r.get(col_name, "").strip()
                if not (k and kor):
                    continue

                # [지침] 번역 제외 키로 지정된 경우: AI 호출 없이 원본 번역 유지 및 즉시 보호
                if k in excluded_keys:
                    audit_results[(k, lang_code)] = {
                        "score": 10.0,
                        "reason": "사용자 지정 번역 제외 키 (원문 보존)",
                        "status": "excluded",
                        "changed": False,
                        "is_excluded": True,
                        "old_val": curr_trans,
                        "new_val": curr_trans,
                        "has_kor": True
                    }
                    continue

                if not curr_trans:
                    items_missing[k] = kor
                    continue

                # [제안 상태 영속성 체크]
                cache_key = f"{sheet_name}_{k}_{lang_code}"
                cached = audit_cache.get(cache_key) or audit_cache.get(f"{k}_{lang_code}")

                # [완전 불일치 오류 사전 감지]
                # 원문은 짧은 명칭('통상', '일반')인데 번역문에 숫자/스킬 효과가 들어갔거나, 원문과 번역문의 숫자가 서로 다른 경우
                kor_nums = set(re.findall(r'\d+', kor))
                trans_nums = set(re.findall(r'\d+', curr_trans))
                is_blatant_mismatch = (
                    (kor.strip() in ["통상", "일반", "기본"] and ("200" in curr_trans or "护盾" in curr_trans or len(curr_trans) > 8))
                    or (kor_nums and trans_nums and kor_nums != trans_nums)
                    or (len(kor.strip()) <= 4 and len(curr_trans.strip()) >= 14)
                )

                # 시트의 기존 [점수/사유] 열에서도 제안 상태 확인 (캐시 미존재 시 자동 시딩)
                # 전수 검사(is_full_audit) 모드이거나, 완전 불일치가 감지된 경우에는 시트의 기존 제안을 복원하지 않음!
                prev_score_str = r.get(score_col_header, "")
                if not is_full_audit and not is_blatant_mismatch and (not cached or not cached.get("is_suggestion")) and ("💡" in prev_score_str or "[제안]" in prev_score_str):
                    m_score = re.search(r'([0-9.]+)\s*점', prev_score_str)
                    p_score = float(m_score.group(1)) if m_score else 8.0
                    p_body = prev_score_str.split("|", 1)[1].strip() if "|" in prev_score_str else prev_score_str
                    p_reason = p_body.replace("[제안]", "").strip()
                    p_sug = curr_trans
                    if "➔ 참고:" in p_reason:
                        p_r_parts = p_reason.split("➔ 참고:", 1)
                        p_reason = p_r_parts[0].strip()
                        p_sug = p_r_parts[1].strip()
                    cached = {
                        "source": kor,
                        "text": curr_trans,
                        "score": p_score,
                        "reason": p_reason,
                        "suggested": p_sug,
                        "is_suggestion": True,
                        "status": "suggestion"
                    }
                    audit_cache[cache_key] = cached
                    audit_cache[f"{k}_{lang_code}"] = cached

                # 한글 원문(kor)과 번역문(curr_trans) 둘 다 수정되지 않은 경우에만 제안 상태 유지!
                cached_source = cached.get("source", "").strip() if cached else ""
                cached_text = cached.get("text", "").strip() if cached else ""
                cached_score = float(cached.get("score", 0)) if cached else 0.0

                # [중요] 전수 검사(is_full_audit) 모드이거나, 완전 불일치가 감지되었거나, 텍스트가 수정된 경우 AI 재검수!
                if not is_full_audit and not is_blatant_mismatch and cached and cached.get("is_suggestion") and (8.0 <= cached_score < 9.0) and (cached_source == kor) and (cached_text == curr_trans):
                    preserved_suggestions[k] = cached
                else:
                    # 텍스트가 새로 수정되었거나 신규 검수 대상인 경우: AI 검수 목록에 포함
                    items_to_audit[k] = {"korean": kor, "current": curr_trans}

            # [규칙 2] 한글은 있는데 번역이 없는 항목: 신규 번역 일괄 생성 (3스레드 병렬 초고속 처리)
            missing_translations = {}
            if items_missing:
                keys_missing = list(items_missing.keys())
                m_chunks = [keys_missing[i : i + CHUNK_SIZE] for i in range(0, len(keys_missing), CHUNK_SIZE)]
                num_m_chunks = len(m_chunks)
                logger(f"      -> 번역 없는 항목 {len(items_missing)}건 신규 번역 생성 중 (총 {num_m_chunks}개 배치, 3스레드 병렬 처리)...")

                def _trans_worker(chunk_info):
                    c_idx, c_keys = chunk_info
                    c_dict = {k: items_missing[k] for k in c_keys}
                    t_chunk = time.time()
                    try:
                        res = _gated_batch(c_dict, lang_code)
                        return c_idx, c_keys, res, time.time() - t_chunk, None
                    except Exception as e:
                        return c_idx, c_keys, {}, time.time() - t_chunk, e

                with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
                    futures = [executor.submit(_trans_worker, (i, ch)) for i, ch in enumerate(m_chunks)]
                    for future in concurrent.futures.as_completed(futures):
                        c_idx, c_keys, c_res, chunk_dur, err = future.result()
                        if err:
                            logger(f"      ⚠️ 신규 번역 배치 ({c_idx+1}/{num_m_chunks}) 오류: {err}")
                        elif not c_res:
                            logger(f"      ⚠️ 신규 번역 배치 ({c_idx+1}/{num_m_chunks}) 응답 지연 (보충 생성으로 이관)")
                        else:
                            missing_translations.update(c_res)
                        completed_work_units += 1
                        completed_items_count += len(c_keys)
                        pct = int(min(100, completed_items_count / max(1, total_items_to_process) * 100))
                        tot_dur = time.time() - audit_start_time
                        tm, ts = divmod(int(tot_dur), 60)
                        eta_s = int((tot_dur / max(1, completed_items_count)) * max(0, total_items_to_process - completed_items_count))
                        em, es = divmod(eta_s, 60)
                        logger(f"[PROGRESS {completed_items_count}/{total_items_to_process} {pct}%] [{lang_code} {lang_idx}/{len(target_langs)}] 누적 {completed_items_count}/{total_items_to_process}항목 완료 ({pct}%) | 1회당 {chunk_dur:.1f}초 | 경과: {tm:02d}:{ts:02d} | 잔여: 약 {em:02d}:{es:02d}")

                # [누락 방지 Gap-Fill: 신규 번역 100% 무결성 보장]
                missing_keys_left = [k for k in keys_missing if k not in missing_translations and (k, lang_code) not in gate_failures]
                if missing_keys_left:
                    logger(f"      🔄 누락된 {len(missing_keys_left)}개 신규 번역 보충 생성 중...")
                    for g_i in range(0, len(missing_keys_left), CHUNK_SIZE):
                        gap_keys = missing_keys_left[g_i : g_i + CHUNK_SIZE]
                        gap_dict = {k: items_missing[k] for k in gap_keys}
                        batch_num = g_i // CHUNK_SIZE + 1
                        tot_batches = (len(missing_keys_left) + CHUNK_SIZE - 1) // CHUNK_SIZE
                        logger(f"        [신규 번역 보충 {batch_num}/{tot_batches}] {len(gap_keys)}건 처리 중...")
                        try:
                            gap_res = _gated_batch(gap_dict, lang_code)
                            if gap_res:
                                missing_translations.update(gap_res)
                                logger(f"        [신규 번역 보충 {batch_num}/{tot_batches}] ✅ {len(gap_res)}건 생성 완료")
                        except Exception as ex:
                            logger(f"      ⚠️ 신규 번역 보충 오류: {ex}")
                        time.sleep(0.5)

            # 기존 번역이 있는 항목: MQM 전수 품질 검수 (3스레드 병렬 안전 처리 & 실시간 진행도 갱신 & 누락 방지 Gap-Fill)
            mqm_results = {}
            if items_to_audit:
                t0 = time.time()
                keys_audit = list(items_to_audit.keys())
                a_chunks = [keys_audit[i : i + CHUNK_SIZE] for i in range(0, len(keys_audit), CHUNK_SIZE)]
                num_a_chunks = len(a_chunks)
                logger(f"      -> MQM 검수 대상 {len(keys_audit)}건 (총 {num_a_chunks}개 배치, 3스레드 병렬 검수 중)...")

                def _audit_worker(chunk_info):
                    c_idx, c_keys = chunk_info
                    c_dict = {k: items_to_audit[k] for k in c_keys}
                    t_chunk = time.time()
                    try:
                        res = review_mqm_batch_unified(c_dict, lang_code, active_provider, api_key, model=selected_model, glossary=glossary)
                        return c_idx, c_keys, res, time.time() - t_chunk, None
                    except Exception as e:
                        return c_idx, c_keys, {}, time.time() - t_chunk, e

                with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
                    futures = [executor.submit(_audit_worker, (i, ch)) for i, ch in enumerate(a_chunks)]
                    for future in concurrent.futures.as_completed(futures):
                        c_idx, c_keys, c_res, chunk_dur, err = future.result()
                        if err:
                            logger(f"      ⚠️ MQM 검수 배치 ({c_idx+1}/{num_a_chunks}) 오류: {err}")
                        elif not c_res:
                            logger(f"      ⚠️ MQM 검수 배치 ({c_idx+1}/{num_a_chunks}) 응답 지연 (보충 검수로 이관)")
                        else:
                            mqm_results.update(c_res)
                        completed_work_units += 1
                        completed_items_count += len(c_keys)
                        pct = int(min(100, completed_items_count / max(1, total_items_to_process) * 100))
                        tot_dur = time.time() - audit_start_time
                        tm, ts = divmod(int(tot_dur), 60)
                        eta_s = int((tot_dur / max(1, completed_items_count)) * max(0, total_items_to_process - completed_items_count))
                        em, es = divmod(eta_s, 60)
                        logger(f"[PROGRESS {completed_items_count}/{total_items_to_process} {pct}%] [{lang_code} {lang_idx}/{len(target_langs)}] 누적 {completed_items_count}/{total_items_to_process}항목 완료 ({pct}%) | 1회당 {chunk_dur:.1f}초 | 경과: {tm:02d}:{ts:02d} | 잔여: 약 {em:02d}:{es:02d}")

                # [누락 방지 2중 안전장치 Gap-Fill] 반환 결과에서 누락된 키가 있으면 100% 채워질 때까지 보충 재요청
                for retry_round in range(2):
                    missing_audit_keys = [k for k in keys_audit if k not in mqm_results]
                    if not missing_audit_keys:
                        break
                    logger(f"      🔄 누락된 {len(missing_audit_keys)}개 항목 보충 재검수 진행 중 (라운드 {retry_round+1})...")
                    for g_i in range(0, len(missing_audit_keys), CHUNK_SIZE):
                        gap_keys = missing_audit_keys[g_i : g_i + CHUNK_SIZE]
                        gap_dict = {k: items_to_audit[k] for k in gap_keys}
                        batch_num = g_i // CHUNK_SIZE + 1
                        tot_batches = (len(missing_audit_keys) + CHUNK_SIZE - 1) // CHUNK_SIZE
                        logger(f"        [보충 재검수 {batch_num}/{tot_batches}] {len(gap_keys)}건 처리 중...")
                        try:
                            gap_res = review_mqm_batch_unified(gap_dict, lang_code, active_provider, api_key, model=selected_model, glossary=glossary)
                            if gap_res:
                                mqm_results.update(gap_res)
                                logger(f"        [보충 재검수 {batch_num}/{tot_batches}] ✅ {len(gap_res)}건 회수 완료 (누적 {len(mqm_results)}/{len(keys_audit)})")
                            else:
                                logger(f"        [보충 재검수 {batch_num}/{tot_batches}] ⚠️ 응답 지연 (다음 후보 모델 전환 대기)")
                        except Exception as ex:
                            logger(f"      ⚠️ 보충 검수 오류: {ex}")
                        time.sleep(0.5)

                # 최종 안전망: 만약 극단적 예외로 여전히 누락된 키가 있다면 안전 기본값(통과)으로 무결성 보장
                final_missing = [k for k in keys_audit if k not in mqm_results]
                if final_missing:
                    logger(f"      ⚠️ 미응답 {len(final_missing)}개 항목은 [미검수] 제안(8.5점)으로 표기됩니다. 번역은 변경되지 않으니 재실행해 주세요.")
                    for k in final_missing:
                        mqm_results[k] = {
                            "score": 8.5,
                            "has_issue": False,
                            "reason": "[미검수] API 미응답으로 AI 검수가 수행되지 않았습니다 (재실행 필요)",
                            "suggested": items_to_audit[k].get("current", "")
                        }

                logger(f"      -> [{lang_code}] 전체 검수 완료 ({len(mqm_results)}/{len(keys_audit)}건 확인, 소요 시간: {time.time()-t0:.2f}초)")
            elif not items_missing:
                completed_work_units += 1
                completed_items_count += len(preserved_suggestions)
                pct = int(min(100, completed_items_count / max(1, total_items_to_process) * 100))
                logger(f"[PROGRESS {completed_items_count}/{total_items_to_process} {pct}%] [{lang_code}] 처리 완료 (100% 제안 보존/스킵) - {pct}%")

            # [용어집 우선] 기존 번역에 용어집 지정 번역이 빠진 항목 → 용어집 강제 재번역 + 문맥 검토 (일괄)
            gfix = {}
            if glossary and items_to_audit:
                g_items = {}
                for gk, gv in items_to_audit.items():
                    if gv["korean"].strip() in glossary:
                        continue   # 원문 전체가 용어집 단어 → 기존 '용어 불일치' 규칙이 지정 번역 그대로 권장
                    g_miss = glossary_missing(gv["korean"], gv["current"], lang_code, glossary)
                    if not g_miss:
                        continue
                    g_issue = []
                    _ga_ok, _ga_msg = GateAValidator.validate(gv["korean"], gv["current"], lang_code)
                    if not _ga_ok:
                        g_issue.append(_ga_msg)
                    _mr = mqm_results.get(gk)
                    _msc, _mok = _parse_review_score(_mr)
                    if _mok and _msc < 8.0:
                        g_issue.append(str(_mr.get("reason", ""))[:300])
                    g_items[gk] = {"korean": gv["korean"], "current": gv["current"],
                                   "terms": glossary_terms_for(gv["korean"], lang_code, glossary), "missing": g_miss,
                                   "issue": " / ".join(g_issue)}
                if g_items:
                    logger(f"      📖 [{lang_code}] 용어집 미준수 {len(g_items)}건 → 용어집 우선 재번역 + 문맥 검토 중...")
                    gfix = glossary_fix_batch(g_items, lang_code, active_provider, api_key, selected_model, logger)
                    for gk, gv in g_items.items():
                        gfix.setdefault(gk, {"ok": False, "fail": "응답 없음"})
                        gfix[gk]["missing"] = gv["missing"]
                    _g_ok = sum(1 for v in gfix.values() if v.get("ok"))
                    _g_ctx = sum(1 for v in gfix.values() if v.get("ok") and not v.get("context_ok", True))
                    logger(f"      📖 [{lang_code}] 용어집 적용 {_g_ok}건 (문맥 검토 필요 {_g_ctx}건) / 실패 {len(gfix) - _g_ok}건")

            for r in rows:
                k = r.get("Keys", "")
                kor = r.get("Korean", "").strip()
                # [규칙 1] 한글 원문 내용 없으면 사유 및 권장안 작성 안 함
                if not kor:
                    continue

                old_val = r.get(col_name, "").strip()
                if not old_val:
                    # [규칙 2] 한글은 있는데 번역이 없으면 신규 생성 번역 및 사유 기록
                    val_obj = missing_translations.get(k, "")
                    if isinstance(val_obj, dict):
                        suggested = str(val_obj.get("text") or val_obj.get("translation") or val_obj.get("translated") or (list(val_obj.values())[0] if val_obj else "")).strip()
                    else:
                        suggested = str(val_obj).strip()
                    score = 10.0 if apply_changes else 0.0
                    reason = "기존 번역 누락 (AI 신규 생성 완료)" if apply_changes else "기존 번역 없음"
                    is_changed = True
                    if not suggested:
                        g_why = gate_failures.get((k, lang_code), "API 미응답")
                        audit_results[(k, lang_code)] = {
                            "score": 0.0, "reason": f"[신규 번역 실패] Gate A/재시도 {max_attempts}회 미통과: {g_why} - 수동 번역 필요",
                            "changed": False, "is_new": False, "needs_manual": True,
                            "old_val": "", "new_val": "", "has_kor": True
                        }
                        logger(f"  ⛔ [신규 번역 실패] '{k}' ({lang_code}): {g_why}")
                        continue
                    audit_results[(k, lang_code)] = {
                        "score": score,
                        "reason": reason,
                        "changed": True,
                        "is_new": True,
                        "old_val": "",
                        "new_val": suggested,
                        "has_kor": True
                    }
                    total_changes_count += 1
                    if apply_changes:
                        r[col_name] = suggested
                        logger(f"  ✨ [신규 번역] '{k}'")
                        logger(f"     • 원문 (한글): {kor}")
                        logger(f"     • 적용 사유 : 기존 번역 누락 ➔ AI 신규 생성 완료")
                        logger(f"     • 생성 번역 : {suggested}")
                    else:
                        logger(f"  ⚠️ [번역 누락] '{k}'")
                        logger(f"     • 원문 (한글): {kor}")
                        logger(f"     • 지적 사유 : 기존 번역 없음")
                        logger(f"     • 권장 번역 : {suggested} (시트 미반영)")
                elif k in preserved_suggestions:
                    # [제안 상태 유지] 번역문이 아직 수정되지 않았으므로 이전 제안 내용 및 점수 100% 보존!
                    prev = preserved_suggestions[k]
                    score = prev.get("score", 8.0)
                    reason = prev.get("reason", "")
                    suggested = prev.get("suggested", old_val)
                    is_suggestion = True
                    is_correction = False
                    status = "suggestion"

                    audit_results[(k, lang_code)] = {
                        "score": score,
                        "reason": reason,
                        "status": status,
                        "changed": False,
                        "is_suggestion": True,
                        "old_val": old_val,
                        "new_val": suggested,
                        "has_kor": True
                    }
                    logger(f"  💡 [제안 유지] '{k}' ({score:.1f}점 - 번역문 미수정으로 기존 제안 유지)")
                    logger(f"     • 원문 (한글): {kor}")
                    logger(f"     • 현재 번역 : {old_val}")
                    logger(f"     • 참고 사유 : {reason}")
                    if suggested and suggested != old_val:
                        logger(f"     • 추천안    : {suggested}")
                else:
                    res = mqm_results.get(k, {})
                    score, _score_ok = _parse_review_score(res)
                    if not _score_ok:
                        # [Fail-closed] 점수 누락/형식 오류 응답은 합격 처리하지 않음
                        res = {"score": 8.5, "has_issue": False, "suggested": old_val,
                               "reason": "[미검수] 검수 응답에 점수가 없거나 형식이 잘못되어 판정 불가 - 재실행 필요"}
                        score = 8.5

                    has_issue = bool(res.get("has_issue", False))
                    raw_reason = res.get("reason", "")
                    if isinstance(raw_reason, list):
                        reason = " | ".join(str(x).strip() for x in raw_reason if str(x).strip())
                    elif isinstance(raw_reason, dict):
                        reason = " | ".join(f"{rk}: {rv}" for rk, rv in raw_reason.items())
                    else:
                        reason = str(raw_reason or "").strip()

                    raw_sug = res.get("suggested", old_val)
                    if isinstance(raw_sug, list):
                        sug_cands = [str(x).strip() for x in raw_sug if str(x).strip()]
                        suggested = sug_cands[0] if sug_cands else old_val
                    elif isinstance(raw_sug, dict):
                        suggested = str(raw_sug.get("text") or raw_sug.get("translation") or raw_sug.get("value") or (list(raw_sug.values())[0] if raw_sug else old_val)).strip()
                    else:
                        suggested = str(raw_sug or old_val).strip()

                    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    # [결정론적 후처리 1] 행 복사 오역 감지 (정밀 필터)
                    # 짧은 원문에 전혀 다른 긴 툴팁/줄바꿈/스킬 태그가 복사된 오류만 정확히 타겟팅
                    # (Core Enhancement 같은 정상적인 2~3단어 번역 오탐 방지)
                    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    src_clean = kor.strip()
                    tgt_clean = old_val.strip()
                    src_len = len(src_clean)
                    tgt_len = len(tgt_clean)

                    is_row_copy = False
                    # 번역문이 최소 30자 이상일 때만 행 복사 오류 후보 (단어 번역 오탐 방지)
                    if tgt_len >= 30:
                        has_newlines = ('\n' not in src_clean) and ('\n' in tgt_clean)
                        has_skill_tags = ('<color' not in src_clean and '[*' not in src_clean) and ('<color' in tgt_clean or '[*' in tgt_clean or '</color>' in tgt_clean)
                        # 원문은 10자 이하 단어인데 번역문에 줄바꿈 또는 툴팁 태그가 삽입된 경우
                        if src_len <= 10 and (has_newlines or has_skill_tags):
                            is_row_copy = True
                        # 원문 5자 이하 초단문인데 번역문이 35자 이상이고 10배 이상 긴 경우
                        elif src_len <= 5 and tgt_len >= 35 and (tgt_len / max(1, src_len)) >= 10.0:
                            is_row_copy = True

                    if is_row_copy:
                        score = 2.0
                        has_issue = True
                        reason = f"[행 복사 오류] 원문({src_len}자)에 비해 번역문({tgt_len}자)에 이전 행의 툴팁/태그 데이터가 잘못 복사되어 들어간 치명적 오류입니다."
                        # 만약 AI가 기존 긴 텍스트와 다른 정상적인 짧은 제안을 주지 못했다면 AI 재요청으로 올바른 번역 생성
                        if not suggested or suggested == old_val or len(suggested) >= 30:
                            try:
                                corrected_val = translate_single_corrective_unified(kor, lang_code, active_provider, api_key, model=selected_model, feedback="원문 단어에 정확히 일치하는 1~3단어의 간결한 명칭 번역 필요")
                                if corrected_val and corrected_val != old_val:
                                    suggested = corrected_val
                            except Exception:
                                pass

                    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    # [결정론적 후처리 2] 용어집 강제 대조 (Glossary Enforcement)
                    # 원문 전체가 용어집 등록 단어와 정확히 일치하는데
                    # 번역문이 용어집 권장 번역과 다르면 강제 교정 판정
                    # (행 복사 오류로 suggested가 비어있을 때도 용어집에서 올바른 값을 최우선 보충)
                    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    GLOSSARY_COL_MAP = lang_config.glossary_cols()
                    if glossary:
                        g_col = GLOSSARY_COL_MAP.get(lang_code, resolve_language_info(lang_code)[1])
                        g_entry = glossary.get(src_clean)
                        if g_entry:
                            expected_trans = g_entry.get(g_col, "").strip()
                            if expected_trans and tgt_clean != expected_trans:
                                if score >= 8.0:
                                    score = 7.0
                                reason = f"[용어 불일치] 공식 용어집 '{src_clean}' → '{expected_trans}' 미준수. 현재: '{tgt_clean}'."
                                has_issue = True
                                suggested = expected_trans
                            elif expected_trans and (not suggested or suggested == old_val):
                                # 행 복사 오류 등으로 suggested가 비어있거나 부정확할 때 용어집에서 최우선 보충
                                suggested = expected_trans

                    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    # [결정론적 후처리 3] 사유-점수 정합성 자동 검사 (Consistency Enforcement)
                    # 1. 언어 불일치, 완전 왜곡, 엉뚱한 언어/의미, 숫자/조건 전도 -> 0~2점 강제
                    # 2. 사유에 "완전히", "전혀 다른", "누락", "왜곡" 포함 시 -> 최대 5.0점 제한 강제
                    # 3. 사유에 "이미 일치", "문제없음", "지장 없" 등 통과 지표 포함 시 -> 9.0점(통과) 자동 조정
                    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    reason_check = str(reason or "")
                    severe_0_2_kws = ["[완전 불일치 오류]", "[완전 불일치]", "[언어 불일치]", "완전히 다른", "전혀 다른", "완전히 무관", "정반대", "뒤바뀌", "행 복사 오류", "행 밀림", "심각하게", "반드시 수정", "심각한 오역", "완전히 잘못"]
                    severe_5_kws = ["전혀 다른", "누락", "왜곡", "치명적", "오역되었습니다", "반드시 교정"]
                    pass_kws = ["이미 일치", "문제없", "문제 없", "지장이 없", "지장 없", "통과 처리", "완벽합니다", "수정 불필요"]

                    # 원문 '통상' / '일반'인데 번역문에 숫자나 완전히 다른 스킬 효과가 포함된 경우
                    if kor.strip() in ["통상", "일반"] and ("200" in old_val or "护盾" in old_val or len(old_val) > 8):
                        score = 2.0
                        has_issue = True
                        reason = "[완전 불일치 오류] 한국어 원문 '통상'과 번역문은 완전히 다른 내용(행 밀림 오역)입니다."
                        _nw = lang_config.normal_word(lang_code)
                        if _nw:
                            suggested = _nw
                    elif score >= 8.0 and _kw_hit(reason_check, pass_kws) and not _kw_hit(reason_check, ["[완전 불일치", "[언어 불일치]", "행 복사 오류", "왜곡", "오역", "심각"]):
                        score = max(score, 9.0)
                        has_issue = False
                    elif _kw_hit(reason_check, severe_0_2_kws):
                        score = min(score, 2.0)
                        has_issue = True
                    elif _kw_hit(reason_check, severe_5_kws):
                        score = min(score, 5.0)
                        has_issue = True

                    # [결정론적 후처리 4] Gate A 전수 적용 (기존 번역: 한글 잔존/태그·파라미터 불일치/식별자 등)
                    sug_needs_manual = False
                    ga_ok, ga_msg = GateAValidator.validate(kor, old_val, lang_code)
                    if not ga_ok:
                        ga_cap = 3.0 if any(t in ga_msg for t in ("한글 잔존", "식별자", "빈 번역")) else 6.0
                        score = min(score, ga_cap)
                        has_issue = True
                        ai_note = "" if str(reason).startswith("[Gate A]") else str(reason or "").strip()
                        reason = f"[Gate A] {ga_msg}" + (f" | AI 의견: {ai_note}" if ai_note else "")
                        if (gfix.get(k) or {}).get("ok"):
                            pass   # 용어집 우선 재번역본이 Gate A 문제까지 해결함 (아래 용어집 블록에서 적용)
                        elif (not suggested) or suggested == old_val or not GateAValidator.validate(kor, suggested, lang_code)[0]:
                            suggested, _rep_ok, _rep_msg = _repair_suggestion(kor, lang_code, "", ga_msg, active_provider, api_key, selected_model)
                            if not _rep_ok:
                                sug_needs_manual = True
                                reason += f" | ⚠️ 권장안 자동검증 실패({_rep_msg}) - 수동 확인 필요"
                    elif score >= 9.0:
                        lay_ok, lay_msg = GateAValidator.validate_layout(kor, old_val)
                        if not lay_ok:
                            _collapsed = GateAValidator.collapse_extra_blank_lines(kor, old_val)
                            if _collapsed != old_val and GateAValidator.validate_layout(kor, _collapsed)[0] \
                                    and GateAValidator.validate(kor, _collapsed, lang_code)[0]:
                                # 번역에만 있는 불필요한 빈 줄 → 결정론적 교정 (UI 간격 깨짐)
                                score = 7.5
                                has_issue = True
                                reason = f"[레이아웃] 원문에 없는 빈 줄 포함 ({lay_msg}) - 빈 줄 제거"
                                suggested = _collapsed
                            else:
                                score = 8.5
                                reason = f"[레이아웃] {lay_msg}"
                                suggested = old_val

                    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    # [용어집 우선 적용] 문장 속 용어집 단어가 지정 번역으로 쓰이지 않았으면 교정 대상.
                    # 용어집 적용본을 권장안으로 쓰고, 문맥이 어색하면 사유 + 대안 제안을 함께 기록
                    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    gloss_fixed = False
                    gf = gfix.get(k)
                    glossary_diff = []
                    if gf and score >= 8.0:
                        # [용어집 차이 - 기존 번역 유지] 번역 자체에 다른 오류가 없으면 기존 번역을 유지하고 제안만 기록
                        # (용어 단위 일괄 승인 시에만 반영: 리포트 '용어집차이' 시트에서 승인)
                        miss_txt = _gloss_txt(gf.get("missing", []))
                        glossary_diff = list(gf.get("missing", []))
                        base_reason = str(reason or "").strip() if score < 9.0 else ""
                        score = min(max(score, 8.0), 8.5)
                        has_issue = False
                        reason = f"[용어집 차이] {miss_txt} (현재 번역 유지)"
                        if gf.get("ok"):
                            suggested = gf["translation"]
                            if not gf.get("context_ok", True):
                                reason += f" | 📝 [문맥 검토] {gf.get('note') or '용어집 적용 시 문맥이 어색함'} → 현재 번역 유지 권장"
                                if gf.get("alternative"):
                                    reason += f" (문맥 대안: {gf['alternative']})"
                        else:
                            suggested = old_val
                            reason += f" | 용어집 적용안 생성 실패({gf.get('fail', '')})"
                        if base_reason:
                            reason += f" | {base_reason}"
                    elif gf:
                        miss_txt = _gloss_txt(gf.get("missing", []))
                        pre_score = score
                        score = min(score, 7.0)
                        has_issue = True
                        # AI가 통과(9점 이상)로 본 사유는 '용어 준수' 등 모순되는 문구가 되므로 제외, 문제 지적 사유만 유지
                        base_reason = str(reason or "").strip().split(" | ⚠️ 권장안")[0] if pre_score < 9.0 else ""
                        if gf.get("ok"):
                            suggested = gf["translation"]
                            sug_needs_manual = False
                            reason = f"[용어집 우선] {miss_txt} 미사용 → 용어집 적용" + (f" | {base_reason}" if base_reason else "")
                            if not gf.get("context_ok", True):
                                # 문맥이 어색 → 자동 반영하지 않고 두 선택지를 제시 (사람이 선택)
                                sug_needs_manual = True
                                reason += (f" | 📝 [문맥 검토] {gf.get('note') or '용어집 적용 시 문맥이 어색함'}"
                                           f" | 선택지 ① 용어집 적용: {suggested}"
                                           + (f" ② 문맥 대안: {gf['alternative']}" if gf.get("alternative") else "")
                                           + " - 수동 확인 필요 (원하는 번역을 엑셀 번역 칸에 직접 입력 후 반영)")
                            gloss_fixed = True
                        else:
                            reason = f"[용어집 우선] {miss_txt} 미사용 | ⚠️ 용어집 적용 재번역 실패({gf.get('fail', '')}) - 수동 확인 필요" + (f" | {base_reason}" if base_reason else "")
                            sug_needs_manual = True
                            suggested = suggested if suggested and suggested != old_val else old_val
                    elif glossary and suggested and suggested != old_val and score < 8.0:
                        # 기존 번역은 용어집을 지켰는데 AI 교정안이 용어집을 벗어난 경우 → 교정안만 용어집 기준으로 재작성
                        s_miss = glossary_missing(kor, suggested, lang_code, glossary)
                        if s_miss:
                            one = glossary_fix_batch({k: {"korean": kor, "current": suggested, "terms": glossary_terms_for(kor, lang_code, glossary), "issue": str(reason)[:300]}},
                                                     lang_code, active_provider, api_key, selected_model).get(k, {})
                            if one.get("ok"):
                                suggested = one["translation"]
                                reason = f"{reason} | [용어집 우선] 교정안에 {_gloss_txt(s_miss)} 적용"
                                if not one.get("context_ok", True):
                                    sug_needs_manual = True
                                    reason += (f" | 📝 [문맥 검토] {one.get('note') or '용어집 적용 시 문맥이 어색함'}"
                                               f" | 선택지 ① 용어집 적용: {suggested}"
                                               + (f" ② 문맥 대안: {one['alternative']}" if one.get("alternative") else "")
                                               + " - 수동 확인 필요 (원하는 번역을 엑셀 번역 칸에 직접 입력 후 반영)")
                                gloss_fixed = True
                            else:
                                sug_needs_manual = True
                                reason = f"{reason} | ⚠️ 교정안 용어집 미적용({_gloss_txt(s_miss)}) - 수동 확인 필요"

                    # [권장 번역 누락 방지 안전망]
                    # 교정 대상(8.0점 미만)인데 권장안이 비어있거나 기존과 같다면 신규 교정 번역 생성
                    if score < 8.0 and (not suggested or suggested == old_val):
                        try:
                            corrected_val = translate_single_corrective_unified(kor, lang_code, active_provider, api_key, model=selected_model, feedback=f"원문 '{kor}'에 정확히 부합하는 올바른 번역 생성 필요")
                            if corrected_val:
                                suggested = corrected_val
                        except Exception:
                            pass
                        if not suggested:
                            suggested = old_val

                    # [권장안 생성 실패 처리] 교정 대상인데 쓸 만한 권장안이 없으면 '통과'로 둔갑하지 않도록 수동 확인 표기
                    if score < 8.0 and (not suggested or suggested == old_val) and not sug_needs_manual:
                        sug_needs_manual = True
                        suggested = suggested or old_val
                        reason = f"{reason} | ⚠️ 권장안 생성 실패 - 수동 확인 필요"

                    # [권장안 검증] 교정 권장안도 Gate A(태그 유지 등) 통과 필수. 실패 시 재생성, 그래도 실패하면 수동 확인 표기 + 자동 반영 차단
                    if score < 8.0 and suggested and suggested != old_val and not sug_needs_manual:
                        _s_ok, _s_msg = GateAValidator.validate(kor, suggested, lang_code)
                        if not _s_ok:
                            suggested, _s_ok, _s_msg = _repair_suggestion(kor, lang_code, suggested, str(reason), active_provider, api_key, selected_model)
                            if not _s_ok:
                                sug_needs_manual = True
                                reason = f"{reason} | ⚠️ 권장안 자동검증 실패({_s_msg}) - 수동 확인 필요"

                    # [엄격한 3단계 등급 판정 로직]
                    # 1. 9.0점 이상: ✅ 통과 -> 번역 변경 없음
                    # 2. 8.0 ~ 8.9점: 💡 제안 -> 번역 변경 없음 (자동 수정 절대 금지!)
                    # 3. 8.0점 미만 (< 8.0): ✏️ 교정 -> 실제 오역/누락으로 텍스트 변경 시에만 자동 수정 적용
                    is_pass = (score >= 9.0)
                    is_suggestion = (8.0 <= score < 9.0)
                    is_correction = (score < 8.0)

                    status = "correction" if is_correction else ("suggestion" if is_suggestion else "pass")

                    audit_results[(k, lang_code)] = {
                        "score": score,
                        "reason": reason,
                        "status": status,
                        "needs_manual": bool(is_correction and sug_needs_manual),
                        "glossary_fix": gloss_fixed,
                        "glossary_diff": glossary_diff,
                        "changed": is_correction and not (apply_changes and sug_needs_manual),
                        "is_suggestion": is_suggestion,
                        "old_val": old_val,
                        "new_val": suggested,
                        "has_kor": True
                    }

                    # 캐시 갱신 (수정되었거나 새로 판정된 내역 저장)
                    cache_data = {
                        "source": kor,
                        "text": suggested if (is_correction and apply_changes and not sug_needs_manual) else old_val,
                        "score": score,
                        "reason": reason,
                        "suggested": suggested,
                        "is_suggestion": is_suggestion,
                        "status": status
                    }
                    if not str(reason).startswith("[미검수]"):
                        audit_cache[f"{sheet_name}_{k}_{lang_code}"] = cache_data
                        audit_cache[f"{k}_{lang_code}"] = cache_data

                    if is_correction:
                        total_changes_count += 1
                        if apply_changes and not sug_needs_manual:
                            r[col_name] = suggested
                            logger(f"  ✏️ [교정 완료] '{k}' ({score:.1f}점)")
                            logger(f"     • 원문 (한글): {kor}")
                            logger(f"     • 기존 번역 : {old_val}")
                            logger(f"     • 지적 사유 : {reason}")
                            logger(f"     • 교정 번역 : {suggested}")
                        else:
                            logger(f"  ⚠️ [교정 필요] '{k}' ({score:.1f}점)")
                            logger(f"     • 원문 (한글): {kor}")
                            logger(f"     • 현재 번역 : {old_val}")
                            logger(f"     • 지적 사유 : {reason}")
                            logger(f"     • 권장 수정 : {suggested} (시트 미반영)")
                    elif is_suggestion:
                        logger(f"  💡 [권장 제안] '{k}' ({score:.1f}점 - 시트 원문 유지)")
                        logger(f"     • 원문 (한글): {kor}")
                        logger(f"     • 현재 번역 : {old_val}")
                        logger(f"     • 참고 사유 : {reason}")
                        if suggested and suggested != old_val:
                            logger(f"     • 추천안    : {suggested}")
                    else:
                        logger(f"  ✅ [통과] '{k}': {old_val}")

            # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            # [Runbook 6] 점수 → 실패 사유 → 재번역 수렴 루프
            # 교정안/신규 번역을 다시 채점하고, 8.0 미만이면 사유를 feedback으로 재번역 (최대 max_attempts회).
            # 소진 시 원본 번역을 복원하고 '수동 확인 필요'로 표기 (데이터 손실 방지)
            # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            if enable_rescore:
                row_by_key = {r.get("Keys", ""): r for r in rows}
                pending = {}
                for (ak, alc), meta in audit_results.items():
                    if alc != lang_code or meta.get("needs_manual") or meta.get("is_excluded"):
                        continue
                    nv = (meta.get("new_val") or "").strip()
                    if not nv or nv == (meta.get("old_val") or "").strip():
                        continue
                    if meta.get("glossary_fix"):
                        continue   # 용어집 우선 교정본은 규칙 기반 확정 (문맥 검토 의견은 사유에 기록됨)
                    if meta.get("is_new") or meta.get("status") == "correction":
                        pending[ak] = nv
                attempts_used = {k2: 1 for k2 in pending}
                last_fb = {}
                if pending:
                    logger(f"      🔄 [{lang_code}] 재채점 수렴 루프 시작: 교정/신규 {len(pending)}건 (최대 {max_attempts}회)")
                for rnd in range(1, max_attempts + 1):
                    if not pending:
                        break
                    run_stats["rescore_rounds"] += 1
                    rev_all = {}
                    pk = list(pending.keys())
                    for ci in range(0, len(pk), CHUNK_SIZE):
                        chunk = {k2: {"korean": row_by_key[k2].get("Korean", "").strip(), "current": pending[k2]} for k2 in pk[ci:ci + CHUNK_SIZE]}
                        try:
                            rev_all.update(review_mqm_batch_unified(chunk, lang_code, active_provider, api_key, model=selected_model, glossary=glossary) or {})
                        except Exception as e:
                            logger(f"      ⚠️ 재채점 호출 오류: {e}")
                    next_pending = {}
                    for k2, cand in pending.items():
                        meta = audit_results[(k2, lang_code)]
                        kor2 = row_by_key[k2].get("Korean", "").strip()
                        sc2, ok2 = _parse_review_score(rev_all.get(k2))
                        rsn2 = str((rev_all.get(k2) or {}).get("reason", "") if isinstance(rev_all.get(k2), dict) else "")
                        if ok2:
                            g_ok, g_msg = GateAValidator.validate(kor2, cand, lang_code)
                            if not g_ok:
                                sc2, rsn2 = min(sc2, 6.0), f"[Gate A] {g_msg}"
                        if ok2 and sc2 >= 8.0:
                            meta["new_val"] = cand
                            meta["verify_score"] = sc2
                            meta["attempts"] = attempts_used[k2]
                            meta["reason"] = f"{meta.get('reason', '')} | ✔ 재채점 {sc2:.1f}점 통과 (시도 {attempts_used[k2]}회)"
                            if apply_changes and meta.get("changed"):
                                row_by_key[k2][col_name] = cand
                            logger(f"        ✔ [재채점 통과] '{k2}' {sc2:.1f}점 (시도 {attempts_used[k2]}회)")
                            continue
                        if not ok2:
                            rsn2 = "재채점 응답 없음/형식 오류"
                        last_fb[k2] = (sc2 if ok2 else None, rsn2)
                        if rnd < max_attempts and ok2:
                            run_stats["rescore_retranslations"] += 1
                            fb2 = f"Review score {sc2:.1f}/10 (below 8.0). Reason: {rsn2}"
                            new_c, t_ok, t_msg, _n = translate_with_gate(kor2, lang_code, active_provider, api_key, selected_model, feedback=fb2, max_attempts=2, glossary=glossary)
                            if t_ok and new_c:
                                next_pending[k2] = new_c
                                attempts_used[k2] += 1
                                continue
                            last_fb[k2] = (sc2, f"{rsn2} / 재번역 실패: {t_msg}")
                        elif rnd < max_attempts and not ok2:
                            next_pending[k2] = cand   # 응답 누락은 같은 후보로 재채점만 재시도
                            attempts_used[k2] += 1
                            continue
                        # 소진 → 원본 복원 + 수동 확인
                        lsc, lrs = last_fb.get(k2, (None, rsn2))
                        meta["needs_manual"] = True
                        meta["attempts"] = attempts_used[k2]
                        meta["new_val"] = cand
                        meta["reason"] = (f"{meta.get('reason', '')} | ⚠️ 재채점 {attempts_used[k2]}회 미통과"
                                          f"({'최종 ' + format(lsc, '.1f') + '점' if lsc is not None else '채점 불가'}: {lrs}) - 원본 유지·수동 확인 필요")
                        if apply_changes and (meta.get("changed") or meta.get("is_new")):
                            row_by_key[k2][col_name] = meta.get("old_val", "")
                            run_stats["reverted"] += 1
                        meta["changed"] = False
                        meta["is_new"] = False
                        logger(f"        ✖ [재채점 소진] '{k2}' ➔ 원본 유지, 수동 확인 필요 ({lrs[:80]})")
                    pending = next_pending
                # 캐시 텍스트 동기화 (복원된 항목은 원본 기준으로 저장)
                for (ak, alc), meta in audit_results.items():
                    if alc == lang_code and meta.get("needs_manual"):
                        for ck in (f"{sheet_name}_{ak}_{lang_code}", f"{ak}_{lang_code}"):
                            if ck in audit_cache:
                                audit_cache[ck]["text"] = meta.get("old_val", "")

            time.sleep(0.5)

        # 감수 이력 캐시 파일 디스크 저장
        save_audit_cache(audit_cache)

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # [모드 B] 평소 모드: 빈칸만 초고속 번역 (비용 0원 최적화!)
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    else:
        logger("\n[3/3] ⚡ [고속 번역] 비어 있는 칸만 골라 번역을 진행합니다...")
        excluded_keys = load_excluded_keys()
        for lang_idx, lang_code in enumerate(target_langs, 1):
            col_name = lang_col_map.get(lang_code, lang_code)
            
            empty_items = {}
            for r in rows:
                k = r.get("Keys", "")
                kor = r.get("Korean", "").strip()
                val = r.get(col_name, "").strip()
                if k and kor and not val and (k not in excluded_keys):
                    empty_items[k] = kor

            if not empty_items:
                logger(f"  ⚡ [{lang_code}] 모든 행이 이미 채워져 있습니다! (호출 스킵 ➔ 비용 0원)")
                completed_work_units += 1
                pct = int(completed_work_units / total_work_units * 100)
                logger(f"[PROGRESS {completed_work_units}/{total_work_units} {pct}%] [{lang_code}] 번역 스킵 (이미 완료) - {pct}%")
                continue

            keys_empty = list(empty_items.keys())
            num_e_chunks = math.ceil(len(keys_empty) / CHUNK_SIZE)
            logger(f"  ⚡ [{lang_code}] 비어 있는 {len(empty_items)}개 항목 번역 중 (총 {num_e_chunks}개 배치)...")
            batch_res = {}
            for c_i in range(num_e_chunks):
                c_keys = keys_empty[c_i * CHUNK_SIZE : (c_i + 1) * CHUNK_SIZE]
                c_dict = {k: empty_items[k] for k in c_keys}
                t0 = time.time()
                try:
                    res = _gated_batch(c_dict, lang_code)
                    batch_res.update(res)
                except Exception as e:
                    logger(f"      [오류] [{lang_code}] 배치 {c_i+1}: {e}")
                elapsed_chunk = time.time() - t0
                logger(f"     ✅ [{lang_code}] 배치 {c_i+1}/{num_e_chunks} AI 번역 완료 ({elapsed_chunk:.2f}초)")
                completed_work_units += 1
                pct = int(completed_work_units / total_work_units * 100)
                logger(f"[PROGRESS {completed_work_units}/{total_work_units} {pct}%] [{lang_code}] 고속 번역 ({c_i+1}/{num_e_chunks} 청크) 완료 - {pct}%")

            for r in rows:
                k = r.get("Keys", "")
                if k in batch_res:
                    raw_val = batch_res[k]
                    if isinstance(raw_val, dict):
                        trans_text = str(raw_val.get("text") or raw_val.get("translation") or raw_val.get("translated") or (list(raw_val.values())[0] if raw_val else "")).strip()
                    else:
                        trans_text = str(raw_val).strip()
                    is_valid, reason = GateAValidator.validate(r.get("Korean", ""), trans_text, lang_code)
                    if not is_valid:   # _gated_batch 결과는 이미 검증됨 (방어적 재확인)
                        logger(f"  ⛔ {k}: [Gate A 미통과 - 미반영] {reason}")
                        continue
                    r[col_name] = trans_text
                    logger(f"  • {k}: [통과] {trans_text}")
                    total_changes_count += 1

                    final_trans = r[col_name]
                    audit_results[(k, lang_code)] = {
                        "score": 10.0 if is_valid else 9.0,
                        "reason": "신규 번역 완료" if is_valid else f"Gate A 교정: {reason}",
                        "old_val": "",
                        "new_val": final_trans,
                        "changed": True,
                        "is_new": True,
                        "is_suggestion": False,
                        "is_excluded": False
                    }

            for r in rows:
                k = r.get("Keys", "")
                if (k, lang_code) in gate_failures and (k, lang_code) not in audit_results:
                    audit_results[(k, lang_code)] = {
                        "score": 0.0, "reason": f"[신규 번역 실패] Gate A/재시도 {max_attempts}회 미통과: {gate_failures[(k, lang_code)]} - 수동 번역 필요",
                        "old_val": "", "new_val": "", "changed": False, "is_new": False, "needs_manual": True,
                        "is_suggestion": False, "is_excluded": False
                    }
                    logger(f"  ⛔ {k}: [신규 번역 실패 - 빈칸 유지] {gate_failures[(k, lang_code)]}")

            time.sleep(0.3)

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # [Runbook 5] Postprocess 수렴 루프 (이번 실행에서 실제로 바뀐 셀 대상, 최대 5회)
    #  1) 규칙 정규화 → 2) 태그/placeholder 전용 LLM 교정 → 3) 그 외 오류는 재번역 → 4) 재검사
    #  해결 불가 항목은 원본으로 복원 (오류가 있는 번역을 시트에 쓰지 않음)
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    _row_by_key = {r.get("Keys", ""): r for r in rows}
    changed_cells = []
    for r in rows:
        k = r.get("Keys", "")
        kor = (r.get("Korean", "") or "").strip()
        if not (k and kor):
            continue
        for lc in target_langs:
            cn = lang_col_map.get(lc, lc)
            if (r.get(cn, "") or "").strip() != input_snapshot.get((k, lc), ""):
                changed_cells.append((k, lc))
    if changed_cells:
        logger(f"\n🧹 [Postprocess] 이번 실행 변경 셀 {len(changed_cells)}건 재검사 (최대 5회 수렴)")
    for pp_round in range(1, 6):
        issues = {}
        for (k, lc) in changed_cells:
            r = _row_by_key[k]
            cn = lang_col_map.get(lc, lc)
            kor = r.get("Korean", "").strip()
            cur = (r.get(cn, "") or "").strip()
            if not cur:
                continue
            fixed = GateAValidator.normalize(kor, cur)
            if fixed != cur:
                r[cn] = fixed
                cur = fixed
                run_stats["postprocess_fixed"] += 1
            ok, msg = GateAValidator.validate(kor, cur, lc)
            if not ok:
                issues[(k, lc)] = msg
        if not issues:
            break
        run_stats["postprocess_rounds"] += 1
        round_changes = 0
        tag_items = {}
        for (k, lc), msg in issues.items():
            if GateAValidator.issue_code(msg) in ("tag-mismatch", "placeholder-mismatch"):
                tag_items.setdefault(lc, {})[k] = (_row_by_key[k].get("Korean", "").strip(), (_row_by_key[k].get(lang_col_map.get(lc, lc), "") or "").strip())
        for lc, its in tag_items.items():
            for k, v in fix_tags_llm(its, active_provider, api_key, selected_model).items():
                v = GateAValidator.normalize(its[k][0], v)
                if GateAValidator.validate(its[k][0], v, lc)[0]:
                    _row_by_key[k][lang_col_map.get(lc, lc)] = v
                    issues.pop((k, lc), None)
                    round_changes += 1
                    run_stats["postprocess_fixed"] += 1
                    logger(f"   🏷️ [태그 교정] '{k}' ({lc})")
        for (k, lc), msg in list(issues.items()):
            kor = _row_by_key[k].get("Korean", "").strip()
            cand, ok, m2, _n = translate_with_gate(kor, lc, active_provider, api_key, selected_model, feedback=msg, max_attempts=2, glossary=glossary)
            if ok:
                _row_by_key[k][lang_col_map.get(lc, lc)] = cand
                round_changes += 1
                run_stats["postprocess_fixed"] += 1
                logger(f"   🔁 [재번역 교정] '{k}' ({lc}): {msg[:60]}")
        if round_changes == 0:
            break
    # 해결 불가 → 원본 복원
    for (k, lc) in changed_cells:
        r = _row_by_key[k]
        cn = lang_col_map.get(lc, lc)
        cur = (r.get(cn, "") or "").strip()
        if cur and not GateAValidator.validate(r.get("Korean", "").strip(), cur, lc)[0]:
            orig = input_snapshot.get((k, lc), "")
            r[cn] = orig
            run_stats["reverted"] += 1
            meta = audit_results.setdefault((k, lc), {"old_val": orig, "has_kor": True})
            meta.update({"changed": False, "is_new": False, "needs_manual": True, "new_val": cur,
                         "reason": f"{meta.get('reason', '')} | ⛔ 후처리 5회 후에도 검증 실패 - 원본 복원·수동 확인 필요"})
            logger(f"   ⛔ [원본 복원] '{k}' ({lc}) 후처리로 해결 불가")
        elif cur and (k, lc) in audit_results and audit_results[(k, lc)].get("changed"):
            audit_results[(k, lc)]["new_val"] = cur

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # [Runbook 7] 최종 Hard Gate (Gate B): 전체 결과 재검사
    #  checks: empty, source-leak, tag, placeholder, language, contamination, alternatives, numeric
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    violations = []
    changed_set = set(changed_cells)
    for r in rows:
        k = r.get("Keys", "")
        kor = (r.get("Korean", "") or "").strip()
        if not (k and kor):
            continue
        for lc in target_langs:
            cn = lang_col_map.get(lc, lc)
            cur = (r.get(cn, "") or "").strip()
            meta = audit_results.get((k, lc), {})
            if meta.get("is_excluded"):
                continue
            if not cur:
                if not is_full_audit or apply_changes:
                    violations.append({"key": k, "lang": lc, "code": "empty-translation", "scope": "changed" if (k, lc) in changed_set else "existing", "message": "번역 없음", "translation": ""})
                continue
            ok, msg = GateAValidator.validate(kor, cur, lc)
            if ok and glossary:
                _gm = glossary_missing(kor, cur, lc, glossary)
                if _gm:
                    ok, msg = False, f"용어집 미적용: {_gloss_txt(_gm)}"
            if not ok:
                violations.append({"key": k, "lang": lc, "code": "glossary" if msg.startswith("용어집") else GateAValidator.issue_code(msg),
                                   "scope": "changed" if (k, lc) in changed_set else "existing", "message": msg, "translation": cur})
    v_changed = [v for v in violations if v["scope"] == "changed"]
    by_code = {}
    for v in violations:
        by_code[v["code"]] = by_code.get(v["code"], 0) + 1
    logger("\n" + "=" * 65)
    logger(f"🚦 [Gate B 최종 검사] 위반 {len(violations)}건 (이번 실행 변경분 {len(v_changed)}건 / 기존 번역 {len(violations) - len(v_changed)}건)"
           + (f" | {', '.join(f'{c}:{n}' for c, n in sorted(by_code.items()))}" if by_code else ""))
    gate_passed = (len(v_changed) == 0)
    if not gate_passed:
        # 방어: 변경분 위반이 남아 있으면 해당 셀은 저장하지 않도록 원본 복원
        for v in v_changed:
            r = _row_by_key[v["key"]]
            r[lang_col_map.get(v["lang"], v["lang"])] = input_snapshot.get((v["key"], v["lang"]), "")
            run_stats["reverted"] += 1
        logger(f"   ⛔ 변경분 위반 {len(v_changed)}건은 저장 대상에서 제외(원본 복원)했습니다.")
    else:
        logger("   ✅ 이번 실행에서 변경된 번역은 모두 최종 검사를 통과했습니다.")

    # 4. 결과 저장 (구글 시트 직접 반영)
    should_apply = apply_changes or (not is_full_audit)
    target_sheet_url = cfg.get("target_sheet_url", "").strip()
    i2_key = cfg.get("_i2_sheet_key")
    if not i2_key and target_sheet_url:
        m_k = re.search(r'/d/([a-zA-Z0-9-_]+)', target_sheet_url)
        if m_k and m_k.group(1) in OFFICIAL_I2_SHEETS.values():
            i2_key = m_k.group(1)

    if is_local_asset:
        logger("\n" + "=" * 65)
        logger("🎮 [로컬 I2Languages.asset 검수 완료] Unity 원본 에셋 보호를 위해 파일은 변경하지 않았습니다.")
        logger("   (지적된 오역 및 AI 권장 수정안은 아래 엑셀/CSV 보고서에서 바로 확인 가능합니다.)")
    elif i2_key:
        logger("\n" + "=" * 65)
        if should_apply:
            cat_name = sheet_name or cfg.get("current_sheet_name") or "기본"
            logger(f"🚀 [I2 공식 시트 저장] '{cat_name}' 탭의 변경된 번역 내용을 구글 시트에 정밀 반영 중...")
            try:
                sa_path = cfg.get("service_account_json_path", "")
                saved_count, total_attempted = save_i2_sheet_tab_cells_direct(
                    i2_key, cat_name, headers, rows,
                    sa_json_path=sa_path,
                    logger=logger
                )
                if saved_count is not None:
                    if saved_count > 0:
                        logger(f"✅ [구글 시트 정밀 반영 완료] '{cat_name}' 탭의 실제 변경된 {saved_count}개 셀만 정확히 업데이트되었습니다! (버전 기록 무결성 유지)")
                    else:
                        logger(f"ℹ️ [시트 변경사항 없음] '{cat_name}' 탭에 기존과 다른 번역 변경 내용이 없어 시트 수정을 건너뛰었습니다.")
                else:
                    # gspread 권한 실패 시 I2 Apps Script 웹서비스 폴백
                    logger(f"⚠️ [gspread 미지원/권한 오류] I2 웹서비스(SetLanguageSource) 방식으로 대체 저장합니다.")
                    original_rows_snapshot = cfg.get("_original_rows")
                    ok = save_i2_sheet_tab_rows(i2_key, cat_name, headers, rows,
                                                original_rows=original_rows_snapshot)
                    if ok:
                        logger(f"✅ [구글 시트 반영 완료] '{cat_name}' 탭의 번역 {len(rows)}개 항목이 I2 공식 구글 시트에 동기화되었습니다!")
                    else:
                        logger(f"⚠️ [I2 저장 응답] 서버에서 실패 응답을 반환했습니다.")
            except Exception as e:
                logger(f"❌ [구글 시트 저장 오류] {e}")
        else:
            logger("📋 [확인 전용 모드] I2 공식 시트 번역은 수정하지 않았습니다. (엑셀 보고서 생성)")
    elif use_service_account and worksheet:
        write_scores = cfg.get("write_scores_to_sheet", False)
        logger("\n" + "=" * 65)
        if is_full_audit and not apply_changes:
            if write_scores:
                logger("📋 [확인 전용 모드] 온라인 원본 시트의 번역은 수정하지 않고, 검수 시트에 점수/사유만 기록합니다.")
            else:
                logger("📋 [확인 전용 모드] 구글 시트 점수/사유 기록 옵션 OFF ➔ 시트 번역은 유지하고 기존 [점수/사유] 열을 정리합니다.")
        else:
            logger(f"[구글 시트 스마트 저장] 변경된 번역 내용을 온라인 시트에 기록 중... (점수/사유 기록: {'ON' if write_scores else 'OFF'})")

        try:
            save_translations_smart(
                worksheet,
                headers,
                rows,
                sa_json_path,
                logger,
                audit_results=audit_results if is_full_audit else None,
                target_langs=target_langs,
                lang_col_map=lang_col_map,
                apply_changes=should_apply,
                write_scores_to_sheet=write_scores,
                write_cols={c for c in lang_col_map.values() if c}
            )
        except Exception as e:
            logger(f"❌ [구글 시트 저장 오류] {e}")

    # 5. 전수검사 및 번역 결과 엑셀 보고서 생성 (색상 및 서식 자동 적용)
    dir_path = paths.OUTPUT_DIR

    # fill_empty 모드에서 이미 기존 번역이 채워져 있던 행들도 audit_results에 정상 등록하여 엑셀에 깔끔하게 표기
    if not is_full_audit:
        for r in rows:
            k = r.get("Keys", "")
            kor = r.get("Korean", "").strip()
            if not (k and kor):
                continue
            for lang_code in target_langs:
                if (k, lang_code) not in audit_results:
                    c_name = lang_col_map.get(lang_code, lang_code)
                    curr_val = r.get(c_name, "").strip()
                    if curr_val:
                        audit_results[(k, lang_code)] = {
                            "score": 10.0,
                            "reason": "기존 번역 유지 (검수 미수행)",
                            "old_val": curr_val,
                            "new_val": curr_val,
                            "changed": False,
                            "is_new": False,
                            "is_suggestion": False,
                            "is_excluded": False
                        }

    rep_fname = report_name_for_cfg(cfg)
    xlsx_rep = save_audit_reports(headers, rows, target_langs, lang_col_map, audit_results, dir_path, should_apply, sheet_name, report_filename=rep_fname)

    # [Runbook 7/8] 실행 증적: 요약 JSON / 변경 리포트 / Gate B 위반 TSV
    try:
        status_count = {}
        change_rows = []
        for (ek, elc), meta in audit_results.items():
            st = ("manual" if meta.get("needs_manual") else "excluded" if meta.get("is_excluded") else "new" if meta.get("is_new")
                  else "correction" if meta.get("changed") or meta.get("status") == "correction" else "suggestion" if meta.get("is_suggestion")
                  else "unreviewed" if "[미검수]" in str(meta.get("reason", "")) else "pass")
            status_count[st] = status_count.get(st, 0) + 1
            if st in ("manual", "new", "correction", "suggestion", "unreviewed"):
                row = _row_by_key.get(ek, {})
                change_rows.append({"key": ek, "lang": elc, "korean": row.get("Korean", ""), "old": meta.get("old_val", ""),
                                    "new": meta.get("new_val", ""), "status": st, "score": meta.get("verify_score", meta.get("score", "")),
                                    "attempts": meta.get("attempts", ""), "applied": bool(should_apply and (row.get(lang_col_map.get(elc, elc), "") or "").strip() != input_snapshot.get((ek, elc), "")),
                                    "reason": meta.get("reason", "")})
        summary = {
            "sheet": sheet_name, "mode": ("audit_apply" if (is_full_audit and apply_changes) else "audit_inspect" if is_full_audit else "fill_empty"),
            "input_sha256": input_hash, "rows": len(rows), "languages": target_langs,
            "provider": active_provider, "model_selected": selected_model,
            "model_responded": _CONFIRMED_WORKING_GEMINI_MODEL if active_provider == "gemini" else selected_model,
            "thresholds": {"pass": 9.0, "suggestion": 8.0, "max_retry_attempts": max_attempts, "rescore": bool(enable_rescore)},
            "status_count": status_count, "stats": run_stats,
            "gate_b": {"passed": gate_passed, "violations_total": len(violations), "violations_changed": len(v_changed), "by_code": by_code,
                       "checks": ["empty", "source-leak", "tag", "placeholder", "language", "contamination", "alternatives", "numeric", "glossary"]},
            "report": xlsx_rep,
        }
        ev = _write_evidence(dir_path, sheet_name, summary, change_rows, violations, logger)
        logger(f"   • 증적 폴더: {os.path.join(dir_path, 'evidence')} ({', '.join(os.path.basename(v) for v in ev.values())})")
    except Exception as e:
        logger(f"   ⚠️ 증적 저장 오류: {e}")
    logger(f"\n📊 [검수 및 번역 결과 엑셀 보고서 생성 완료 (빨간색 변경 표시)]")
    logger(f"   • 엑셀 파일: {xlsx_rep}")

    elapsed_total = time.time() - sheet_start_time
    m, s = divmod(int(elapsed_total), 60)
    action_str = "교정됨" if apply_changes else "발견/검수됨"
    logger("\n" + "=" * 65)
    _accumulate_run_summary(audit_results)
    logger(f"📋 [탭 처리 완료] '{sheet_name or '시트'}' (총 {total_changes_count}개 오역/개선 항목 {action_str})")
    logger(f"⏱️ [탭 소요 시간] {m}분 {s}초 ({elapsed_total:.2f}초)")
    logger("=" * 65)
    return total_changes_count

def execute_translation_pipeline(cfg: dict, logger=print) -> dict:
    """번역/검수 파이프라인 실행. 이번 실행의 결과 건수 {new, corrected, suggested, passed, total}를 돌려준다."""
    for k in _RUN_SUMMARY:
        _RUN_SUMMARY[k] = 0
    _execute_translation_pipeline_impl(cfg, logger)
    out = dict(_RUN_SUMMARY)
    out["total"] = out["new"] + out["corrected"] + out["suggested"]
    return out


def _execute_translation_pipeline_impl(cfg: dict, logger=print):
    is_full_audit = cfg.get("full_audit_mode", False)
    apply_changes = cfg.get("audit_apply_changes", False)

    if is_full_audit:
        mode_name = "🔍 기존 번역 전수 검사 & [자동 교정 반영]" if apply_changes else "📋 기존 번역 전수 검사 [확인 전용 - 시트 수정 안 함]"
    else:
        mode_name = "⚡ 빈칸 및 신규 항목 고속 번역"

    target_source_mode = cfg.get("target_source_mode", "custom_url")
    local_cat = cfg.get("local_i2_category", "전체")

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # [모드 1] 로컬 I2Languages.asset 전체 카테고리 일괄 검수 (시트별 분리)
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if target_source_mode == "local_asset" and local_cat in ("전체", "[전체]", "ALL", "all", ""):
        logger("=" * 65)
        logger(f"🚀 [SmartTranslator] 로컬 I2Languages.asset 전체 카테고리 일괄 {mode_name} 가동")
        logger(f"   (각 카테고리별로 엑셀 워크시트 탭이 개별 생성되어 결과가 저장됩니다)")
        logger("=" * 65)

        asset_path = cfg.get("local_i2_asset_path") or get_default_local_i2_asset_path()
        all_cats = get_local_i2_categories(asset_path)
        # 주석('#') 제외한 모든 카테고리 100% 전수 검수 (Test 카테고리 및 소규모 카테고리 포함)
        target_categories = [c for c, cnt in all_cats if cnt > 0 and not c.startswith("#")]

        total_cats = len(target_categories)
        grand_total_issues = 0
        for cat_idx, cat_name in enumerate(target_categories, 1):
            sub_cfg = dict(cfg)
            sub_cfg["local_i2_category"] = cat_name
            sub_cfg["current_sheet_name"] = cat_name
            pct = int(cat_idx / total_cats * 100)
            logger("\n" + "=" * 65)
            logger(f"[PROGRESS {cat_idx}/{total_cats} {pct}%] 🎮 로컬 카테고리 시트 검수 중: '{cat_name}'")
            logger("=" * 65)
            issues_count = execute_single_sheet_pipeline(sub_cfg, logger)
            grand_total_issues += issues_count

        logger("\n" + "=" * 65)
        action_str = "교정 완료" if apply_changes else "발견/검수 완료"
        logger(f"🎉 [전체 일괄 처리 완료] 총 {total_cats}개 로컬 카테고리 처리 완료! (총 {grand_total_issues}건 {action_str})")
        logger(f"   👉 엑셀 보고서: 'audit_report_전수검사_결과.xlsx' (각 카테고리별 시트 탭 분리 완료!)")
        logger("=" * 65)
        return

    target_sheet_url = cfg.get("target_sheet_url", "").strip()

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # [모드 2] I2 공식 구글 시트 모드
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if target_source_mode == "i2_official" or target_sheet_url == "ALL_OFFICIAL_I2_SHEETS":
        selected_sheet = cfg.get("i2_selected_sheet", "")
        if "전체" in selected_sheet or target_sheet_url == "ALL_OFFICIAL_I2_SHEETS":
            multi_start_time = time.time()
            logger("=" * 65)
            logger(f"🚀 [SmartTranslator] I2 공식 구글 시트 전체({len(OFFICIAL_I2_SHEETS)}개) 일괄 {mode_name} 가동")
            logger(f"   (각 구글 시트별로 엑셀 워크시트 탭이 개별 생성되어 결과가 저장됩니다)")
            logger("=" * 65)
            total_sheets = len(OFFICIAL_I2_SHEETS)
            grand_total_issues = 0
            for sheet_idx, (sheet_name, sheet_key) in enumerate(OFFICIAL_I2_SHEETS.items(), 1):
                sheet_url = get_sheet_url(sheet_key)
                try:
                    tabs = fetch_i2_sheet_tabs(sheet_key)
                except Exception:
                    tabs = {}

                if len(tabs) > 1:
                    logger("\n" + "=" * 65)
                    logger(f"📋 I2 시트 '{sheet_name}' 내 총 {len(tabs)}개 탭 감지: {', '.join(tabs.keys())}")
                    logger("=" * 65)
                    for tab_name, (tab_headers, tab_rows) in tabs.items():
                        sub_cfg = dict(cfg)
                        sub_cfg["target_sheet_url"] = sheet_url
                        sub_cfg["current_sheet_name"] = tab_name
                        sub_cfg["_i2_sheet_key"] = sheet_key
                        sub_cfg["_preloaded_headers"] = tab_headers
                        sub_cfg["_preloaded_rows"] = tab_rows
                        issues_count = execute_single_sheet_pipeline(sub_cfg, logger)
                        grand_total_issues += issues_count
                else:
                    sub_cfg = dict(cfg)
                    sub_cfg["target_sheet_url"] = sheet_url
                    sub_cfg["current_sheet_name"] = sheet_name
                    sub_cfg["_i2_sheet_key"] = sheet_key
                    if tabs:
                        t_name, (t_headers, t_rows) = next(iter(tabs.items()))
                        sub_cfg["_preloaded_headers"] = t_headers
                        sub_cfg["_preloaded_rows"] = t_rows
                    pct = int(sheet_idx / total_sheets * 100)
                    logger("\n" + "=" * 65)
                    logger(f"[PROGRESS {sheet_idx}/{total_sheets} {pct}%] 📋 I2 시트 처리 중: '{sheet_name}'")
                    logger(f"   • 시트 URL: {sheet_url}")
                    logger("=" * 65)
                    issues_count = execute_single_sheet_pipeline(sub_cfg, logger)
                    grand_total_issues += issues_count

            elapsed_multi = time.time() - multi_start_time
            m, s = divmod(int(elapsed_multi), 60)
            logger("\n" + "=" * 65)
            action_str = "교정 완료" if apply_changes else "발견/검수 완료"
            logger(f"🎉 [전체 일괄 처리 완료] 총 {total_sheets}개 I2 공식 시트 처리 완료! (총 {grand_total_issues}건 {action_str})")
            logger(f"⏱️ [전체 일괄 처리 총 소요 시간] {m}분 {s}초 ({elapsed_multi:.2f}초)")
            logger(f"   👉 엑셀 보고서: 'audit_report_전수검사_결과.xlsx' (각 구글 시트 및 탭별 분리 완료!)")
            logger("=" * 65)
            return
        else:
            sheet_key = OFFICIAL_I2_SHEETS.get(selected_sheet)
            if not sheet_key:
                logger(f"[오류] 선택된 I2 시트 '{selected_sheet}'에 해당하는 키를 찾을 수 없습니다.")
                return

            try:
                tabs = fetch_i2_sheet_tabs(sheet_key)
            except Exception as e:
                logger(f"⚠️ [I2 탭 조회 경고] {e}")
                tabs = {}

            if len(tabs) > 1:
                multi_start_time = time.time()
                logger("=" * 65)
                logger(f"📋 [{selected_sheet}] 총 {len(tabs)}개 내부 시트(탭) 감지: {', '.join(tabs.keys())}")
                logger(f"🚀 {len(tabs)}개 시트 탭을 각각 개별적으로 순차 검수 및 엑셀 탭 분리 저장을 진행합니다!")
                logger("=" * 65)
                grand_total_issues = 0
                for tab_idx, (tab_name, (tab_headers, tab_rows)) in enumerate(tabs.items(), 1):
                    pct = int(tab_idx / len(tabs) * 100)
                    logger("\n" + "=" * 65)
                    logger(f"[PROGRESS {tab_idx}/{len(tabs)} {pct}%] 📋 시트 탭 처리 중: '{tab_name}' (총 {len(tab_rows)}개 항목)")
                    logger("=" * 65)
                    sub_cfg = dict(cfg)
                    sub_cfg["target_sheet_url"] = get_sheet_url(sheet_key)
                    sub_cfg["current_sheet_name"] = tab_name
                    sub_cfg["_i2_sheet_key"] = sheet_key
                    sub_cfg["_preloaded_headers"] = tab_headers
                    sub_cfg["_preloaded_rows"] = tab_rows
                    issues = execute_single_sheet_pipeline(sub_cfg, logger)
                    grand_total_issues += issues

                elapsed = time.time() - multi_start_time
                m, s = divmod(int(elapsed), 60)
                action_str = "교정 완료" if apply_changes else "발견/검수 완료"
                logger("\n" + "=" * 65)
                logger(f"🎉 [전체 일괄 처리 완료] [{selected_sheet}] 전체 {len(tabs)}개 시트 탭 처리 완료! (총 {grand_total_issues}건 {action_str})")
                logger(f"⏱️ [전체 일괄 처리 총 소요 시간] {m}분 {s}초 ({elapsed:.2f}초)")
                logger(f"   👉 엑셀 보고서: 'audit_report_전수검사_결과.xlsx' ({', '.join(tabs.keys())} 개별 탭 생성 완료!)")
                logger("=" * 65)
                return
            else:
                sub_cfg = dict(cfg)
                sub_cfg["target_sheet_url"] = get_sheet_url(sheet_key)
                sub_cfg["current_sheet_name"] = selected_sheet
                sub_cfg["_i2_sheet_key"] = sheet_key
                if tabs:
                    t_name, (t_headers, t_rows) = next(iter(tabs.items()))
                    sub_cfg["_preloaded_headers"] = t_headers
                    sub_cfg["_preloaded_rows"] = t_rows
                single_issues = execute_single_sheet_pipeline(sub_cfg, logger)
                logger("\n" + "=" * 65)
                action_str = "교정 완료" if apply_changes else "발견/검수 완료"
                logger(f"🎉 [전체 일괄 처리 완료] '{selected_sheet}' 시트 작업 완료! (총 {single_issues}건 {action_str})")
                logger("=" * 65)
                return

    # 단일 시트 처리 모드 (사용자 지정 시트 URL)
    logger("=" * 65)
    logger(f"🚀 [SmartTranslator] {mode_name} 모드 가동")
    logger("=" * 65)
    single_issues = execute_single_sheet_pipeline(cfg, logger)
    logger("\n" + "=" * 65)
    action_str = "교정 완료" if apply_changes else "발견/검수 완료"
    logger(f"🎉 [전체 일괄 처리 완료] 단일 시트 작업 완료! (총 {single_issues}건 {action_str})")
    logger("=" * 65)

def main():
    parser = argparse.ArgumentParser(description="DungeonSlasher SmartTranslator Runner")
    parser.add_argument("--cli", action="store_true", help="헤드리스 CLI 모드 실행")
    parser.add_argument("--target-sheet-url", type=str, help="대상 시트 URL")
    parser.add_argument("--sheet", type=str, help="I2 공식 시트 이름 키워드 (예: '스킬', '유물', 'all')")
    parser.add_argument("--service-account", type=str, help="구글 서비스 계정 JSON 키 경로")
    parser.add_argument("--languages", type=str, help="언어 목록 (ENG,JPN,CHS)")
    parser.add_argument("--audit", action="store_true", help="전수 검사 모드 활성화")
    parser.add_argument("--audit-apply", action="store_true", help="전수 검사 후 시트 바로 수정 (미지정 시 확인 전용)")
    parser.add_argument("--apply-excel", action="store_true", help="생성된 엑셀 검수 보고서(audit_report_전수검사_결과.xlsx) 내용을 구글 시트에 즉시 일괄 반영 (AI 재호출 없음)")
    parser.add_argument("--no-corrections", action="store_true", help="시트 반영 시 교정 필요(8.0점 미만) 제외")
    parser.add_argument("--apply-suggestions", action="store_true", help="시트 반영 시 제안(8.0~8.9점) 포함")
    parser.add_argument("--no-news", action="store_true", help="시트 반영 시 신규 번역(누락분) 제외")
    parser.add_argument("--local-asset", nargs="?", const="Skill", type=str, help="로컬 I2Languages.asset 검수 실행 (카테고리 지정 가능, 예: --local-asset Skill, --local-asset 전체)")
    parser.add_argument("--asset-path", type=str, help="로컬 I2Languages.asset 파일 절대/상대 경로")

    args = parser.parse_args()

    if not args.cli and len(sys.argv) == 1:
        from ui_window import launch_gui
        launch_gui()
    else:
        cfg = load_config()
        if args.target_sheet_url: cfg["target_sheet_url"] = args.target_sheet_url
        if args.service_account: cfg["service_account_json_path"] = args.service_account
        if args.languages: cfg["target_languages"] = [l.strip() for l in args.languages.split(",")]
        if args.audit: cfg["full_audit_mode"] = True
        if args.audit_apply: cfg["audit_apply_changes"] = True
        if args.asset_path: cfg["local_i2_asset_path"] = args.asset_path

        if args.apply_excel:
            if getattr(args, "no_corrections", False):
                cfg["apply_corrections"] = False
            elif "apply_corrections" not in cfg:
                cfg["apply_corrections"] = True

            if getattr(args, "apply_suggestions", False):
                cfg["apply_suggestions"] = True
            elif "apply_suggestions" not in cfg:
                cfg["apply_suggestions"] = False

            if getattr(args, "no_news", False):
                cfg["apply_news"] = False
            elif "apply_news" not in cfg:
                cfg["apply_news"] = True

            print("[CLI 모드] 엑셀 검수 보고서(audit_report_전수검사_결과.xlsx)의 내용을 구글 시트에 즉시 일괄 반영합니다.")
            apply_excel_report_to_google_sheet(cfg, print)
            return

        if args.local_asset is not None:
            cfg["target_source_mode"] = "local_asset"
            cfg["local_i2_category"] = args.local_asset.strip() or "Skill"
            print(f"[로컬 에셋 모드] 카테고리: '{cfg['local_i2_category']}'")
        elif args.sheet:
            sheet_query = args.sheet.strip()
            if sheet_query.lower() == "all":
                cfg["target_sheet_url"] = "ALL_OFFICIAL_I2_SHEETS"
            else:
                matched_key = None
                matched_name = ""
                for name, key in OFFICIAL_I2_SHEETS.items():
                    if sheet_query.lower() in name.lower():
                        matched_key = key
                        matched_name = name
                        break
                if matched_key:
                    cfg["target_sheet_url"] = get_sheet_url(matched_key)
                    cfg["current_sheet_name"] = matched_name
                    print(f"[I2 공식 시트 매칭] '{matched_name}' -> {cfg['target_sheet_url']}")
                else:
                    print(f"[경고] '{sheet_query}'와 일치하는 I2 공식 시트를 찾지 못했습니다.")

        print("[CLI 모드] 터미널 모드로 실행합니다.")
        execute_translation_pipeline(cfg, print)

if __name__ == "__main__":
    main()
