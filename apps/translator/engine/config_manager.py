import json
import os
import ctypes
from ctypes import wintypes
import base64

import paths  # noqa: E402  (폴더 구조: config/, keys/, data/, output/)
CONFIG_FILE = os.path.join(paths.CONFIG_DIR, "config.json")

class DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ('cbData', wintypes.DWORD),
        ('pbData', ctypes.POINTER(ctypes.c_char))
    ]

def encrypt_api_key(plain_text: str) -> str:
    """Windows DPAPI를 사용하여 API 키를 현재 Windows 사용자 계정 마스터 키로 암호화합니다."""
    plain_text = (plain_text or "").strip()
    if not plain_text:
        return ""
    if plain_text.startswith("ENC:"):
        return plain_text

    try:
        data = plain_text.encode('utf-8')
        bin_buf = ctypes.create_string_buffer(data, len(data))
        blob_in = DATA_BLOB(len(data), ctypes.cast(bin_buf, ctypes.POINTER(ctypes.c_char)))
        blob_out = DATA_BLOB()
        # dwFlags = 0x1 (CRYPTPROTECT_UI_FORBIDDEN)
        res = ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(blob_in),
            None,
            None,
            None,
            None,
            0x1,
            ctypes.byref(blob_out)
        )
        if not res:
            raise ctypes.WinError()
        enc_bytes = ctypes.string_at(blob_out.pbData, blob_out.cbData)
        ctypes.windll.kernel32.LocalFree(blob_out.pbData)
        return "ENC:" + base64.b64encode(enc_bytes).decode('ascii')
    except Exception as e:
        print(f"[보안 경고] API 키 DPAPI 암호화 실패: {e}")
        return plain_text

def decrypt_api_key(encrypted_text: str) -> str:
    """Windows DPAPI로 암호화된 API 키를 복호화합니다. 평문인 경우 그대로 반환합니다."""
    encrypted_text = (encrypted_text or "").strip()
    if not encrypted_text:
        return ""
    if not encrypted_text.startswith("ENC:"):
        return encrypted_text

    try:
        raw_b64 = encrypted_text[4:]
        data = base64.b64decode(raw_b64)
        bin_buf = ctypes.create_string_buffer(data, len(data))
        blob_in = DATA_BLOB(len(data), ctypes.cast(bin_buf, ctypes.POINTER(ctypes.c_char)))
        blob_out = DATA_BLOB()
        # dwFlags = 0x1 (CRYPTPROTECT_UI_FORBIDDEN)
        res = ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(blob_in),
            None,
            None,
            None,
            None,
            0x1,
            ctypes.byref(blob_out)
        )
        if not res:
            raise ctypes.WinError()
        dec_bytes = ctypes.string_at(blob_out.pbData, blob_out.cbData)
        ctypes.windll.kernel32.LocalFree(blob_out.pbData)
        return dec_bytes.decode('utf-8')
    except Exception as e:
        print(f"[보안 경고] API 키 DPAPI 복호화 실패: {e}")
        return ""

DEFAULT_CONFIG = {
    "selected_script_path": "main.py",
    "script_args": "",
    "active_llm_provider": "gemini",
    "api_key": "",
    "gemini_api_key": "",
    "openai_api_key": "",
    "claude_api_key": "",
    "gemini_model": "⚡ [Auto] 최신 최적 모델 자동 감지 (추천)",
    "openai_model": "gpt-4o-mini (가성비 추천)",
    "claude_model": "claude-3-5-sonnet-20241022 (최고 품질 추천)",
    "model": "⚡ [Auto] 최신 최적 모델 자동 감지 (추천)",
    "verified_providers": {
        "gemini": False,
        "openai": False,
        "claude": False
    },
    "glossary_sheet_url": "",
    "character_sheet_url": "",
    "target_sheet_url": "",
    "target_source_mode": "custom_url",
    "local_i2_asset_path": "Assets/Resources/I2Languages.asset",
    "local_i2_category": "Skill",
    "i2_selected_sheet": "I2Loc 던전슬래셔 스킬 번역",
    "i2_web_service_url": "https://script.google.com/macros/s/AKfycbxx7BnE6LTPzvP3GDIPEKgh365ceglr4wJ_cLYYOTBGnkslw88E18K5dhhrqmxhtjtE/exec",
    "i2_password": "ds_i2_pass_wd",
    "target_languages": ["ENG", "JPN", "CHS", "CHT", "SPA"],
    "service_account_json_path": "service_account.json",
    "enable_gate_a": True,
    "enable_mqm": True,
    "full_audit_mode": False,
    "audit_apply_changes": False,
    "write_scores_to_sheet": False,
    "mqm_threshold": 9.0,
    "max_retry_attempts": 3
}

def load_config() -> dict:
    """config.json에서 설정을 로드합니다. 파일에 저장된 암호화 키를 투명하게 자동 복호화합니다."""
    if not os.path.exists(CONFIG_FILE):
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            config = DEFAULT_CONFIG.copy()
            config.update(data)
            
            # 다중 제공자 API 키 복호화
            for k in ["api_key", "gemini_api_key", "openai_api_key", "claude_api_key"]:
                raw = config.get(k, "")
                if raw and raw.startswith("ENC:"):
                    config[k] = decrypt_api_key(raw)

            # 각 제공자별 교차 오염 방지 (타사 키가 들어간 경우만 정리)
            c_key = config.get("claude_api_key", "").strip()
            g_key = config.get("gemini_api_key", "").strip()
            o_key = config.get("openai_api_key", "").strip()

            # Claude: OpenAI(sk- 로 시작하나 sk-ant- 아님)나 Gemini(AIzaSy/AQ.) 키가 들어간 경우 정리
            if c_key and (c_key.startswith("AIzaSy") or c_key.startswith("AQ.") or (c_key.startswith("sk-") and not c_key.startswith("sk-ant-"))):
                config["claude_api_key"] = ""
            # Gemini: sk- 로 시작하는 OpenAI/Claude 키가 들어간 경우만 정리 (AIzaSy 및 AQ. 등 모든 구글 키 허용)
            if g_key and g_key.startswith("sk-"):
                config["gemini_api_key"] = ""
            # OpenAI: Claude(sk-ant-)나 Gemini(AIzaSy/AQ.) 키가 들어간 경우 정리
            if o_key and (o_key.startswith("sk-ant-") or o_key.startswith("AIzaSy") or o_key.startswith("AQ.")):
                config["openai_api_key"] = ""

            # 활성 제공자의 유효한 키로 config["api_key"] 동기화
            active_p = config.get("active_llm_provider", "gemini")
            if active_p == "openai" and config.get("openai_api_key"):
                config["api_key"] = config["openai_api_key"]
            elif active_p == "gemini" and config.get("gemini_api_key"):
                config["api_key"] = config["gemini_api_key"]
            elif active_p == "claude" and config.get("claude_api_key"):
                config["api_key"] = config["claude_api_key"]
            elif config.get("gemini_api_key"):
                config["api_key"] = config["gemini_api_key"]
            elif config.get("openai_api_key"):
                config["api_key"] = config["openai_api_key"]
            elif config.get("claude_api_key"):
                config["api_key"] = config["claude_api_key"]

            return config
    except Exception as e:
        print(f"[경고] 설정 로드 실패, 기본값을 사용합니다: {e}")
        return DEFAULT_CONFIG.copy()

def save_config(config_data: dict) -> bool:
    """설정 딕셔너리를 config.json에 저장합니다. API 키들은 자동으로 안전하게 암호화(DPAPI)됩니다."""
    try:
        to_save = config_data.copy()

        # 활성 제공자에 맞춰 api_key 동기화
        active_p = to_save.get("active_llm_provider", "gemini")
        if active_p == "openai":
            to_save["api_key"] = to_save.get("openai_api_key", "")
        elif active_p == "claude":
            to_save["api_key"] = to_save.get("claude_api_key", "")
        else:
            to_save["api_key"] = to_save.get("gemini_api_key", "")

        for k in ["api_key", "gemini_api_key", "openai_api_key", "claude_api_key"]:
            raw_val = to_save.get(k, "")
            if raw_val:
                to_save[k] = encrypt_api_key(raw_val)

        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(to_save, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"[오류] 설정 저장 실패: {e}")
        return False



def resolve_selected_service_account(*names) -> str:
    """사용자가 선택한 서비스 계정 키 파일 하나만 실제 경로로 반환합니다.
    다른 .json 키(nspg 등)로 자동 대체하지 않으며, 파일이 없으면 빈 문자열을 반환합니다."""
    for name in names:
        name = (name or "").strip()
        if not name:
            continue
        for cand in (name, paths.resolve_key_file(name)):
            if os.path.isfile(cand):
                return os.path.abspath(cand)
        return ""  # 선택한 이름이 있으면 그 파일만 본다 (다음 후보로 넘어가지 않음)
    return ""
