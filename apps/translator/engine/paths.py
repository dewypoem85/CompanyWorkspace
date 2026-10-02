"""엔진 폴더 구조 (코드는 루트, 나머지는 용도별 폴더). Node 서버(smart-translator.ts)도 같은 구조를 가정합니다.
  config/  설정: config.json, languages.json
  keys/    인증 키: service_account.json, nspg-*.json 등 (비밀 파일, 공유/커밋 금지)
  data/    입력·캐시·상태: audit_cache.json, schedule_state.json, I2_Glossary_*.csv/xlsx
  output/  결과물: audit_report_*.xlsx, evidence/, 각종 검증 결과 xlsx
  prompts/ 번역·검수 프롬프트
예전 구조(모두 루트)의 파일은 import 시 한 번 새 위치로 옮깁니다. (대상 위치에 이미 있으면 건드리지 않음)
"""
import json
import os
import shutil

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_DIR = os.path.join(BASE_DIR, "config")
KEYS_DIR = os.path.join(BASE_DIR, "keys")
DATA_DIR = os.path.join(BASE_DIR, "data")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")


def ensure_dirs():
    for d in (CONFIG_DIR, KEYS_DIR, DATA_DIR, OUTPUT_DIR):
        os.makedirs(d, exist_ok=True)


def _is_service_account(path: str) -> bool:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f).get("type") == "service_account"
    except Exception:
        return False


def migrate_legacy_files():
    """루트에 있던 예전 위치의 파일을 새 폴더로 이동 (Node 쪽 migrateLegacyLayout 과 같은 규칙)"""
    moved = []

    def mv(src, dst_dir):
        if not os.path.exists(src):
            return
        dst = os.path.join(dst_dir, os.path.basename(src))
        if os.path.exists(dst):
            return  # 새 위치에 이미 있으면 그대로 둔다
        try:
            shutil.move(src, dst)
            moved.append(os.path.relpath(dst, BASE_DIR))
        except Exception:
            pass

    for name in ("config.json", "languages.json"):
        mv(os.path.join(BASE_DIR, name), CONFIG_DIR)
    for name in ("audit_cache.json", "schedule_state.json", "I2_Glossary_고유명사용어사전.csv", "I2_Glossary_고유명사용어사전.xlsx"):
        mv(os.path.join(BASE_DIR, name), DATA_DIR)
    try:
        for name in os.listdir(BASE_DIR):
            full = os.path.join(BASE_DIR, name)
            low = name.lower()
            if os.path.isfile(full) and low.endswith(".json") and low not in ("config.json", "languages.json") and _is_service_account(full):
                mv(full, KEYS_DIR)
            elif os.path.isfile(full) and low.endswith(".xlsx") and not name.startswith("~$") and not low.startswith("i2_glossary"):
                mv(full, OUTPUT_DIR)
            elif os.path.isdir(full) and name == "evidence":
                mv(full, OUTPUT_DIR)
    except Exception:
        pass
    return moved


def resolve_key_file(path_or_name: str) -> str:
    """키 파일 경로 해석: 존재하는 절대경로 → keys/<파일명> → 루트(구버전 위치) 순. 못 찾으면 keys/<파일명> 반환"""
    if not path_or_name:
        return ""
    if os.path.isabs(path_or_name) and os.path.exists(path_or_name):
        return path_or_name
    name = os.path.basename(path_or_name)
    for cand in (os.path.join(KEYS_DIR, name), os.path.join(BASE_DIR, name)):
        if os.path.exists(cand):
            return cand
    return os.path.join(KEYS_DIR, name)


ensure_dirs()
migrate_legacy_files()
