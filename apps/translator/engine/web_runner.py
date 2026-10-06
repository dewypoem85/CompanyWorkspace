# -*- coding: utf-8 -*-
"""
SmartTranslator Web Runner Bridge
웹 백엔드(Node.js / Express)와 SmartTranslator 코어 엔진 간의 통신을 중계하는 브릿지 스크립트.
"""
import sys
import os
import io
import json
import re
import argparse
import openpyxl

# 인코딩 안전화
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

import paths  # 폴더 구조: config/, keys/, data/, output/

from config_manager import load_config, save_config, decrypt_api_key
from i2_sheet_registry import OFFICIAL_I2_SHEETS, fetch_live_i2_sheets, get_sheet_url, DEFAULT_WEB_SERVICE_URL, DEFAULT_I2_PASSWORD
from main import execute_translation_pipeline, apply_excel_report_to_google_sheet, is_test_mode_cfg, report_name_for_cfg

EXCEL_REPORT_NAME = "audit_report_전수검사_결과.xlsx"
EXCEL_PATH = os.path.join(paths.OUTPUT_DIR, EXCEL_REPORT_NAME)

def check_i2_key_access(live_sheets: dict, *names):
    """선택한 서비스 계정 키 하나만으로 I2 스프레드시트를 실제로 열 수 있는지 검사합니다.
    반환: (ok, 키 파일명, 봇 이메일, 오류 메시지)"""
    from config_manager import resolve_selected_service_account
    sel_sa = resolve_selected_service_account(*names)
    if not sel_sa:
        return False, "", "", "선택된 서비스 계정 키 파일을 찾을 수 없습니다. 시트 권한이 있는 키를 선택해 주세요."
    fname = os.path.basename(sel_sa)
    try:
        from google.oauth2.service_account import Credentials
        import gspread
        creds = Credentials.from_service_account_file(
            sel_sa, scopes=["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.readonly"])
        email = getattr(creds, "service_account_email", "")
        try:
            gspread.authorize(creds).open_by_key(next(iter(live_sheets.values())))
        except Exception as e:
            detail = str(e).strip() or type(e).__name__
            return False, fname, email, (
                f"선택한 키 '{fname}' ({email})로는 I2 시트에 접근할 수 없습니다 ({detail}). "
                f"시트의 [공유]에 이 봇 이메일이 없거나 다른 키에 권한이 있습니다. 시트 권한이 있는 키를 선택해 주세요.")
        return True, fname, email, ""
    except Exception as e:
        return False, fname, "", f"서비스 계정 키를 읽을 수 없습니다: {e}"

def apply_mode_service_account(cfg: dict) -> dict:
    """테스트 모드는 환경 설정(메인)과 별개로 관리되는 테스트 전용 키만 사용"""
    if is_test_mode_cfg(cfg):
        # 테스트 키가 아직 한 번도 지정되지 않았으면(None) 메인 키를 초기값으로 사용, 지정 후에는 독립 (빈 값 = 키 없음)
        test_key = cfg.get("test_service_account_json_path")
        if test_key is not None:
            cfg["service_account_json_path"] = test_key or ""
    return cfg

def action_list_sheets():
    try:
        cfg = load_config()
        sa_name = cfg.get("service_account_json_path") or ""
        sa_file = paths.resolve_key_file(sa_name) if sa_name else ""
        has_sa = bool(sa_file and os.path.exists(sa_file))

        # 1. 키 미등록 시 즉시 빈 목록 반환 (키 삭제 시 연동 즉시 해제 보장)
        if not has_sa:
            print(json.dumps({
                "success": True,
                "configured": False,
                "sheets": [],
                "message": "구글 서비스 계정 키(.json)가 등록되지 않았습니다. [환경 설정]에서 키를 등록해 주세요."
            }, ensure_ascii=False))
            return

        target_url = (cfg.get("target_sheet_url") or "").strip()
        i2_url = (cfg.get("i2_web_service_url") or "").strip()
        source_mode = cfg.get("target_source_mode", "custom_url")

        # 2. 대상 시트 주소 미등록 시
        if not target_url or not target_url.startswith("https://"):
            print(json.dumps({
                "success": True,
                "configured": False,
                "sheets": [],
                "message": "대상 시트 주소가 설정되지 않았습니다. [환경 설정]에서 구글 시트 URL 또는 I2 웹서비스 주소를 등록해 주세요."
            }, ensure_ascii=False))
            return

        # 3. 키가 등록되어 있고, URL이 I2 웹서비스 주소이거나 source_mode가 i2_official인 경우:
        if ("script.google.com/macros" in target_url) or ("script.google.com/macros" in i2_url) or (source_mode == "i2_official" and not target_url.startswith("https://docs.google.com")):
            active_i2_url = target_url if "script.google.com/macros" in target_url else (i2_url or DEFAULT_WEB_SERVICE_URL)
            pw = cfg.get("i2_password", DEFAULT_I2_PASSWORD)
            live_sheets = fetch_live_i2_sheets(active_i2_url, pw)

            # 선택한 키로 실제 시트 접근이 되는 경우에만 탭 목록을 노출
            ok, _fn, _em, perm_msg = check_i2_key_access(live_sheets, cfg.get("service_account_json_path"))
            if not ok:
                print(json.dumps({
                    "success": True,
                    "configured": False,
                    "is_i2_web_service": True,
                    "sheets": [],
                    "error": perm_msg,
                    "message": perm_msg
                }, ensure_ascii=False))
                return

            result = [
                {
                    "name": f"[전체 공식 시트 일괄 검수 (총 {len(live_sheets)}개)]",
                    "key": "ALL_OFFICIAL_I2_SHEETS",
                    "url": "ALL_OFFICIAL_I2_SHEETS",
                    "is_all": True
                }
            ]
            for name, key in live_sheets.items():
                result.append({
                    "name": name,
                    "key": key,
                    "url": get_sheet_url(key),
                    "is_all": False
                })

            print(json.dumps({
                "success": True,
                "configured": True,
                "sheet_title": "유니티 I2 공식 스프레드시트",
                "is_i2_web_service": True,
                "sheets": result
            }, ensure_ascii=False))
            return

        # 4. 일반 구글 스프레드시트 URL인 경우: 서비스 계정 키로 시트 탭 실시간 조회
        try:
            from google.oauth2.service_account import Credentials
            import gspread
            scopes = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.readonly"]
            creds = Credentials.from_service_account_file(sa_file, scopes=scopes)
            gc = gspread.authorize(creds)
            sh = gc.open_by_url(target_url)
            worksheets = sh.worksheets()

            result = [
                {
                    "name": f"[전체 탭 일괄 검수 (총 {len(worksheets)}개 탭)]",
                    "key": "ALL_SHEET_TABS",
                    "url": target_url,
                    "is_all": True
                }
            ]
            for ws in worksheets:
                result.append({
                    "name": ws.title,
                    "key": ws.title,
                    "url": target_url,
                    "is_all": False
                })

            print(json.dumps({
                "success": True,
                "configured": True,
                "sheet_title": sh.title,
                "sheets": result
            }, ensure_ascii=False))
        except Exception as sheet_err:
            print(json.dumps({
                "success": True,
                "configured": False,
                "sheets": [],
                "error": f"구글 시트 접속 실패: {str(sheet_err)}",
                "message": "구글 시트에 접근할 수 없습니다. 시트의 [공유] 메뉴에 서비스 계정이 '편집자'로 추가되어 있는지 확인하세요."
            }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e), "sheets": []}, ensure_ascii=False))

def action_detect_languages(options_json):
    try:
        data = json.loads(options_json) if options_json else {}
        cfg = load_config()
        cfg.update(data)

        from i2_sheet_registry import detect_available_target_languages
        source_mode = cfg.get("target_source_mode", "custom_url")
        detected = detect_available_target_languages(source_mode, cfg)
        print(json.dumps({
            "success": True,
            "count": len(detected),
            "languages": detected
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e), "count": 0, "languages": []}, ensure_ascii=False))

def is_valid_key_for_provider(provider: str, key_str: str) -> bool:
    k = (key_str or "").strip()
    if not k or k == "******" or len(k) < 15:
        return False
    if provider == "claude":
        return k.startswith("sk-ant-") and len(k) >= 25
    elif provider == "gemini":
        # Google Gemini: AIzaSy 또는 AQ. 또는 구글 토큰 (sk- 제외)
        return (k.startswith("AIzaSy") or k.startswith("AQ.") or not k.startswith("sk-")) and len(k) >= 20
    elif provider == "openai":
        return k.startswith("sk-") and not k.startswith("sk-ant-") and len(k) >= 20
    return False

def action_test_key(options_json):
    try:
        data = json.loads(options_json) if options_json else {}
        provider = data.get("provider", "gemini")
        input_key = (data.get("key") or "").strip()

        cfg = load_config()
        if not input_key or input_key == "******":
            if provider == "claude":
                input_key = cfg.get("claude_api_key", "")
            elif provider == "gemini":
                input_key = cfg.get("gemini_api_key", "")
            elif provider == "openai":
                input_key = cfg.get("openai_api_key", "")

        if not input_key:
            print(json.dumps({"success": False, "error": f"{provider.upper()} API 키가 입력되지 않았습니다."}, ensure_ascii=False))
            return

        from ui_window import test_gemini_key, test_claude_key, test_openai_key
        if provider == "gemini":
            ok, msg, models = test_gemini_key(input_key)
        elif provider == "claude":
            ok, msg = test_claude_key(input_key)
            models = []
        elif provider == "openai":
            ok, msg = test_openai_key(input_key)
            models = []
        else:
            ok, msg, models = False, "지원되지 않는 제공자입니다.", []

        if ok:
            # 검증 성공 시 verified_providers 업데이트 및 저장
            if "verified_providers" not in cfg:
                cfg["verified_providers"] = {}
            cfg["verified_providers"][provider] = True
            save_config(cfg)

        print(json.dumps({"success": ok, "message": msg, "models": models if provider == "gemini" else []}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))

def action_list_models(options_json):
    """등록된 API 키로 제공자의 실제 사용 가능 모델 목록을 조회합니다 (model_discovery 재사용).
    조회 실패를 빈 목록 성공으로 숨기지 않고 success=False 로 알려 화면이 기본 목록으로 전환하게 합니다."""
    try:
        data = json.loads(options_json) if options_json else {}
        provider = (data.get("provider") or "").strip()
        if provider not in ("gemini", "claude", "openai"):
            print(json.dumps({"success": False, "error": "지원되지 않는 제공자입니다."}, ensure_ascii=False))
            return
        key = (load_config().get(f"{provider}_api_key") or "").strip()
        if not is_valid_key_for_provider(provider, key):
            print(json.dumps({"success": False, "provider": provider, "error": f"{provider.upper()} API 키가 등록되지 않았습니다."}, ensure_ascii=False))
            return
        import model_discovery
        models = model_discovery.discover(provider, key)
        if not models:
            print(json.dumps({"success": False, "provider": provider, "error": "모델 목록을 불러오지 못했습니다. (키 권한 또는 네트워크 확인)"}, ensure_ascii=False))
            return
        print(json.dumps({"success": True, "provider": provider, "models": models}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))

def action_get_config():
    try:
        cfg = load_config()
        safe_cfg = dict(cfg)
        
        # 각 제공자별 정식 API 키 포맷 및 실제 인증(verified) 여부 엄격 검증
        verified_dict = safe_cfg.get("verified_providers") or {}
        registered_providers = []
        verified_providers = []
        for p, k in [("claude", "claude_api_key"), ("gemini", "gemini_api_key"), ("openai", "openai_api_key")]:
            val = (safe_cfg.get(k) or "").strip()
            is_valid = is_valid_key_for_provider(p, val)
            safe_cfg[k + "_set"] = is_valid
            safe_cfg[k] = "******" if is_valid else ""
            if is_valid:
                registered_providers.append(p)
                # 실제 인증(verified) 완료된 것만 허용
                if verified_dict.get(p) is True:
                    verified_providers.append(p)

        safe_cfg["registered_providers"] = registered_providers
        # 번역/검수 화면에서 선택 가능한 것은 오직 인증(verified) 완료된 제공자만!
        safe_cfg["available_providers"] = verified_providers
        safe_cfg["has_any_key"] = len(verified_providers) > 0
        safe_cfg["verified_providers"] = {
            "claude": "claude" in verified_providers,
            "gemini": "gemini" in verified_providers,
            "openai": "openai" in verified_providers,
        }

        # legacy api_key 필드 정리
        safe_cfg["api_key_set"] = safe_cfg["has_any_key"]
        safe_cfg["api_key"] = "******" if safe_cfg["has_any_key"] else ""

        print(json.dumps({"success": True, "config": safe_cfg}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))

def action_save_config(options_json):
    try:
        data = json.loads(options_json) if options_json else {}
        cfg = load_config()

        # API 키 업데이트 (빈 문자열이면 삭제/초기화, '******'는 유지, 평문은 갱신)
        for k in ["gemini_api_key", "openai_api_key", "claude_api_key"]:
            if k in data:
                val = str(data[k]).strip()
                if val == "" or val.upper() == "DELETE":
                    cfg[k] = ""
                elif val and val != "******":
                    cfg[k] = val

        # 일반 설정 업데이트
        allowed_keys = [
            "active_llm_provider", "gemini_model", "openai_model", "claude_model",
            "model", "i2_selected_sheet", "target_sheet_url", "target_source_mode",
            "glossary_sheet_url", "character_sheet_url", "local_i2_asset_path",
            "local_i2_category", "i2_web_service_url", "i2_password",
            "enable_gate_a", "enable_mqm", "operation_mode", "mqm_threshold",
            "service_account_json_path"
        ]
        for k in allowed_keys:
            if k in data:
                cfg[k] = data[k]

        if "target_sheet_url" in data:
            u = (data["target_sheet_url"] or "").strip()
            if "script.google.com/macros" in u:
                cfg["i2_web_service_url"] = u
                cfg["target_source_mode"] = "i2_official"
            elif "/spreadsheets/d/" in u:
                cfg["target_source_mode"] = "custom_url"

        if "glossary_sheet_url" in data:
            # 형식이 틀린 주소는 저장하지 않는다 (빈 값 = 기본 용어집)
            from i2_sheet_registry import parse_glossary_url
            cfg["glossary_sheet_url"] = str(data["glossary_sheet_url"] or "").strip()
            try:
                parse_glossary_url(cfg["glossary_sheet_url"])
            except ValueError as e:
                print(json.dumps({"success": False, "error": f"용어집 시트 주소 오류: {e}"}, ensure_ascii=False))
                return

        save_config(cfg)
        print(json.dumps({"success": True, "message": "환경 설정이 안전하게 저장되었습니다."}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))

GLOSSARY_CSV_PATH = os.path.join(paths.DATA_DIR, "I2_Glossary_고유명사용어사전.csv")
GLOSSARY_XLSX_PATH = os.path.join(paths.DATA_DIR, "I2_Glossary_고유명사용어사전.xlsx")
DEFAULT_GLOSSARY_HEADERS = ["Korean", "English", "Japanese", "Chinese", "Chinese (Taiwan)", "Spain"]


def _glossary_target():
    """환경 설정의 용어집 시트 주소와 서비스 계정 키 (빈 주소 = 기본 용어집)"""
    cfg = load_config()
    return (cfg.get("glossary_sheet_url") or "").strip(), (cfg.get("service_account_json_path") or "").strip()


def _rows_from_values(values):
    headers = values[0]
    rows = []
    for idx, r in enumerate(values[1:], 1):
        row_dict = {"id": idx}
        for col_idx, h in enumerate(headers):
            row_dict[h] = r[col_idx] if col_idx < len(r) else ""
        rows.append(row_dict)
    return headers, rows


def _same_glossary_source(expected, info) -> bool:
    return bool(expected) and str(expected.get("sheet_key")) == str(info.get("sheet_key")) and str(expected.get("gid")) == str(info.get("gid"))


def action_get_glossary():
    import csv
    from i2_sheet_registry import open_glossary_worksheet
    headers = list(DEFAULT_GLOSSARY_HEADERS)
    rows = []
    source = None       # 실제로 연결된 용어집 시트 (화면 표시 + 저장 시 대조용)
    sheet_error = ""    # 시트를 쓰지 못한 이유 (로컬 CSV 로 대체된 경우 화면에 표시)
    sheet_empty = False

    # 1. 환경 설정의 용어집 시트 실시간 조회
    synced_from_sheet = False
    url, sa = _glossary_target()
    try:
        ws, source = open_glossary_worksheet(url, sa)
        vals = ws.get_all_values()
        if vals and len(vals) > 1:
            headers, rows = _rows_from_values(vals)
            synced_from_sheet = True
        else:
            sheet_empty = True
            sheet_error = "용어집 시트의 탭이 비어 있습니다."
    except Exception as e:
        sheet_error = str(e) or type(e).__name__

    # 2. 구글 시트 실패 시 로컬 CSV fallback
    if not synced_from_sheet and os.path.exists(GLOSSARY_CSV_PATH):
        try:
            with open(GLOSSARY_CSV_PATH, "r", encoding="utf-8-sig") as f:
                reader = csv.reader(f)
                headers = next(reader)
                for idx, r in enumerate(reader, 1):
                    row_dict = {"id": idx}
                    for col_idx, h in enumerate(headers):
                        row_dict[h] = r[col_idx] if col_idx < len(r) else ""
                    rows.append(row_dict)
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
            return

    print(json.dumps({
        "success": True,
        "headers": headers,
        "rows": rows,
        "synced_from_sheet": synced_from_sheet,
        "total": len(rows),
        "source": source,
        "sheet_error": sheet_error,
        "sheet_empty": sheet_empty,
    }, ensure_ascii=False))


def action_save_glossary(options_json):
    import csv
    from i2_sheet_registry import open_glossary_worksheet
    try:
        data = json.loads(options_json) if options_json else {}
        headers = data.get("headers") or list(DEFAULT_GLOSSARY_HEADERS)
        rows = data.get("rows") or []
        expected = data.get("expected_source") or None          # 화면이 불러올 때 연결돼 있던 시트
        loaded_from_sheet = bool(data.get("loaded_from_sheet"))

        # 0. 현재 설정된 용어집 시트 확인 (쓰기 전에 대상부터 대조)
        url, sa = _glossary_target()
        ws, info, open_error = None, None, ""
        try:
            ws, info = open_glossary_worksheet(url, sa)
        except Exception as e:
            open_error = str(e) or type(e).__name__
        if expected and info and not _same_glossary_source(expected, info):
            # 편집하는 동안 환경 설정의 용어집 주소가 바뀌었음: 다른 시트를 덮어쓰지 않도록 아무것도 쓰지 않는다
            print(json.dumps({
                "success": False,
                "error": f"용어집 시트 설정이 바뀌었습니다. (불러온 시트와 현재 설정된 시트 '{info['sheet_title']} / {info['tab']}'가 다름) 새로고침 후 다시 편집해 주세요.",
                "source_changed": True,
            }, ensure_ascii=False))
            return

        # 1. 로컬 CSV 저장 (utf-8-sig)
        with open(GLOSSARY_CSV_PATH, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(headers)
            for r in rows:
                writer.writerow([r.get(h, "") for h in headers])

        # 2. 로컬 엑셀 저장
        try:
            wb = openpyxl.Workbook()
            ws_x = wb.active
            ws_x.title = "번역키"
            ws_x.append(headers)
            for r in rows:
                ws_x.append([r.get(h, "") for h in headers])
            wb.save(GLOSSARY_XLSX_PATH)
        except Exception as e:
            print(f"[경고] 엑셀 용어집 저장 오류: {e}", file=sys.stderr)

        # 3. 구글 스프레드시트 동기화: 화면이 같은 시트에서 불러온 데이터이거나, 시트가 비어 있을 때만 덮어쓴다
        sheet_synced = False
        skip_reason = ""
        if ws is None:
            skip_reason = f"용어집 시트에 접근하지 못했습니다: {open_error}"
        elif not loaded_from_sheet or not expected:
            existing = ws.get_all_values()
            if existing and len(existing) > 1:
                skip_reason = "화면의 용어집이 시트가 아닌 로컬 파일에서 불러온 데이터라, 이미 내용이 있는 시트를 덮어쓰지 않았습니다."
        if ws is not None and not skip_reason:
            try:
                table_data = [headers] + [[r.get(h, "") for h in headers] for r in rows]
                ws.clear()
                ws.update(table_data)
                sheet_synced = True
            except Exception as e:
                skip_reason = f"구글 시트 반영 실패: {e}"
                print(f"[경고] 구글 시트 용어집 반영 실패: {e}", file=sys.stderr)

        print(json.dumps({
            "success": True,
            "message": f"용어집 총 {len(rows)}개 항목이 저장되었습니다." + (" (구글 시트 실시간 동기화 완료)" if sheet_synced else " (로컬 파일 저장 완료)"),
            "sheet_synced": sheet_synced,
            "sheet_skip_reason": skip_reason,
            "source": info,
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))


def action_test_glossary(options_json):
    """환경 설정에서 입력한 용어집 주소를 저장하기 전에 확인 (시트 열기·탭 찾기·헤더/항목 수). 아무것도 쓰지 않는다."""
    from i2_sheet_registry import open_glossary_worksheet
    try:
        data = json.loads(options_json) if options_json else {}
        url = (data.get("url") or "").strip()
        _, sa = _glossary_target()
        ws, info = open_glossary_worksheet(url, sa)
        vals = ws.get_all_values()
        headers = [h.strip() for h in (vals[0] if vals else [])]
        total = sum(1 for r in vals[1:] if r and str(r[0]).strip()) if vals else 0
        warnings = []
        if info.get("note"):
            warnings.append(info["note"])
        if not headers:
            warnings.append("탭이 비어 있습니다. 저장하면 이 탭에 용어집이 기록됩니다.")
        elif headers[0].lower() not in ("korean", "한국어", "kor"):
            warnings.append(f"첫 번째 열 제목이 'Korean'이 아닙니다 ('{headers[0]}'). 첫 열을 한국어 원문으로 사용합니다.")
        print(json.dumps({
            "success": True,
            "source": info,
            "total": total,
            "languages": [h for h in headers[1:] if h],
            "warnings": warnings,
            "is_default": not url,
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e) or type(e).__name__}, ensure_ascii=False))


def parse_latest_excel(target_path=None):
    file_path = target_path or EXCEL_PATH
    if not os.path.exists(file_path):
        return None
    wb = openpyxl.load_workbook(file_path, data_only=True)
    sheets_data = {}
    total_summary = {"passed": 0, "suggested": 0, "corrected": 0, "new": 0, "total": 0}

    for ws_name in wb.sheetnames:
        ws = wb[ws_name]
        headers = [cell.value for cell in ws[1]]
        if not headers or "Keys" not in headers:
            continue
        
        # 컬럼 인덱스 매핑
        key_idx = headers.index("Keys") if "Keys" in headers else 0
        kor_idx = headers.index("Korean") if "Korean" in headers else 1

        # 동적 언어 컬럼 탐색 (헤더에 존재하는 ENG, JPN, CHS, CHT, SPA, GER 등 모든 언어 지원)
        IGNORE_HEADERS = {"keys", "key", "category", "korean", "kor", "type", "description", "desc"}
        target_langs = []
        lang_col_map = {}
        full_names = {
            "ENG": "English", "JPN": "Japanese", "CHS": "Chinese",
            "CHT": "Chinese (Taiwan)", "SPA": "Spain", "GER": "German",
            "FRA": "French", "ITA": "Italian", "RUS": "Russian", "POR": "Portuguese"
        }

        for idx, h in enumerate(headers):
            if not h:
                continue
            h_str = str(h).strip()
            if h_str.startswith("[점수/사유]") or h_str.startswith("[Score]") or "점수/사유" in h_str:
                continue
            if h_str.lower() in IGNORE_HEADERS:
                continue

            # 표준 언어 코드 판별
            matched_code = h_str.upper()
            for code, name in full_names.items():
                if h_str.upper() == code or h_str.lower() == name.lower():
                    matched_code = code
                    break
            if matched_code not in target_langs:
                target_langs.append(matched_code)
                lang_col_map[matched_code] = idx

        rows_data = []
        for r_idx in range(2, ws.max_row + 1):
            row_cells = [ws.cell(r_idx, c_idx).value for c_idx in range(1, ws.max_column + 1)]
            row_key = str(row_cells[key_idx] or "").strip()
            row_kor = str(row_cells[kor_idx] or "").strip()
            if not row_key and not row_kor:
                continue

            lang_items = {}
            for l in target_langs:
                c_idx = lang_col_map.get(l)
                val = str(row_cells[c_idx] or "").strip() if c_idx is not None and c_idx < len(row_cells) else ""
                fn = full_names.get(l, "")

                # 점수/사유 열 찾기
                score_col_idx = None
                for h_i, h_name in enumerate(headers):
                    if h_name and ("점수/사유" in str(h_name) or "[Score]" in str(h_name)):
                        h_upper = str(h_name).upper()
                        if l in h_upper or (fn and fn.upper() in h_upper):
                            score_col_idx = h_i
                            break

                score_reason = str(row_cells[score_col_idx] or "").strip() if score_col_idx is not None and score_col_idx < len(row_cells) else ""

                # 상태 판별 (선두 표식 우선: 사유 본문에 '교정' 같은 단어가 있어도 등급이 뒤바뀌지 않게)
                status = "passed"
                _sr = score_reason.lstrip()
                if _sr.startswith("⛔") or "[수동 확인 필요]" in _sr[:30]:
                    status = "corrected"  # 수동 확인 필요(자동 반영 금지)도 교정 대상으로 집계
                    total_summary["corrected"] += 1
                elif _sr.startswith("💡"):
                    status = "suggested"
                    total_summary["suggested"] += 1
                elif _sr.startswith("✅"):
                    status = "passed"
                    total_summary["passed"] += 1
                elif "신규" in score_reason or "✨" in score_reason or "번역 누락" in score_reason:  # 확인 전용 모드: "⚠️ 번역 누락 ➔ 권장: ..."
                    status = "new"
                    total_summary["new"] += 1
                elif "검수 미수행" in score_reason or "기존 번역 유지" in score_reason:
                    # 신규 번역 모드에서 기존 채워져 있던 셀: 검수 미수행이므로 통과/교정/제안/신규 대상이 아님 (변경 없음)
                    status = "uninspected"
                elif "교정" in score_reason or "✏️" in score_reason:
                    status = "corrected"
                    total_summary["corrected"] += 1
                elif "제안" in score_reason or "💡" in score_reason:
                    status = "suggested"
                    total_summary["suggested"] += 1
                elif "통과" in score_reason or "✅" in score_reason or "원문 유지" in score_reason:
                    status = "passed"
                    total_summary["passed"] += 1
                else:
                    status = "passed"
                    total_summary["passed"] += 1
                total_summary["total"] += 1

                lang_items[l] = {
                    "text": val,
                    "score_reason": score_reason,
                    "status": status
                }

            has_change = any(item.get("status") in ["new", "corrected", "suggested"] for item in lang_items.values())
            rows_data.append({
                "key": row_key,
                "korean": row_kor,
                "languages": lang_items,
                "has_change": has_change
            })

        # 변경 사항(신규 번역, 교정, 제안)이 있는 행을 최우선으로 배치
        changed_rows = [r for r in rows_data if r.get("has_change")]
        unchanged_rows = [r for r in rows_data if not r.get("has_change")]
        # 변경된 행 전체 + 변경 없는 행은 최대 300개까지
        sorted_rows = changed_rows + unchanged_rows[:max(0, 300 - len(changed_rows))]
        sheets_data[ws_name] = sorted_rows

    return {
        "summary": total_summary,
        "sheets": sheets_data,
        "excel_path": file_path,
        "modified_time": os.path.getmtime(file_path)
    }

def action_get_results(options_json=None):
    try:
        opts = json.loads(options_json) if options_json else {}
        mode = opts.get("mode", "main")
        target_file = os.path.join(paths.OUTPUT_DIR, "audit_report_테스트_결과.xlsx" if mode == "test" else "audit_report_전수검사_결과.xlsx")
        data = parse_latest_excel(target_file)
        if data:
            print(json.dumps({"success": True, "data": data}, ensure_ascii=False))
        else:
            print(json.dumps({"success": True, "data": None, "message": "해당 모드의 검수 결과가 없습니다."}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))

def action_run(options_json):
    opts = json.loads(options_json) if options_json else {}
    cfg = load_config()
    cfg.update(opts)
    apply_mode_service_account(cfg)

    # 1. 실행 모드 3종 매핑
    op_mode = cfg.get("operation_mode", "fill_empty")
    if op_mode == "audit_apply":
        cfg["full_audit_mode"] = True
        cfg["audit_apply_changes"] = True
    elif op_mode == "inspect_only":
        cfg["full_audit_mode"] = True
        cfg["audit_apply_changes"] = False
    else:  # fill_empty
        cfg["full_audit_mode"] = False
        cfg["audit_apply_changes"] = False

    # 2. 전체 공식 시트 일괄 처리 매핑
    selected_sheet = cfg.get("i2_selected_sheet", "")
    target_url = cfg.get("target_sheet_url", "")
    if "전체" in selected_sheet or target_url == "ALL_OFFICIAL_I2_SHEETS":
        cfg["target_source_mode"] = "i2_official"
        cfg["target_sheet_url"] = "ALL_OFFICIAL_I2_SHEETS"
        cfg["i2_selected_sheet"] = "[전체 공식 시트 일괄 검수]"

    # 실시간 2단 게이지 추적 상태 (전체 진행도 + 세부 단계 진행도)
    progress_state = {
        "total_percent": 0,
        "total_message": "파이프라인 초기화 중...",
        "step_percent": 0,
        "step_message": "시작 대기 중..."
    }

    def web_logger(msg):
        clean = msg.strip()
        payload = {"type": "log", "message": msg}

        # 1. 1단계: 인증 및 용어집
        if "[1/3] 구글 서비스 계정 인증 중" in clean:
            progress_state["total_percent"] = 5
            progress_state["total_message"] = "전체 진행도: [1단계: 인증/준비] 구글 서비스 계정 인증 중... (5%)"
            progress_state["step_percent"] = 30
            progress_state["step_message"] = "단계별 진행: 서비스 계정 키 인증 중..."
        elif "성공! 시트" in clean and "연결 완료" in clean:
            progress_state["total_percent"] = 10
            progress_state["total_message"] = "전체 진행도: [1단계: 인증/준비] 구글 시트 연결 성공 (10%)"
            progress_state["step_percent"] = 70
            progress_state["step_message"] = "단계별 진행: 온라인 시트 연결 완료"
        elif "[Glossary]" in clean and ("로드됨" in clean or "적용 완료" in clean):
            m_g = re.search(r"(\d+)개\s*고유명사", clean)
            g_cnt = m_g.group(1) if m_g else "다수"
            progress_state["total_percent"] = 15
            progress_state["total_message"] = f"전체 진행도: [1단계: 용어집] 공식 고유명사 {g_cnt}개 적용 완료 (15%)"
            progress_state["step_percent"] = 100
            progress_state["step_message"] = f"단계별 진행: 📖 용어집 {g_cnt}개 메모리 로드 완료"

        # 2. 2단계: 데이터 로드
        elif "[2/3]" in clean and "행 로드 완료" in clean:
            progress_state["total_percent"] = 25
            progress_state["total_message"] = "전체 진행도: [2단계: 데이터 로드] 시트 데이터 로드 완료 (25%)"
            progress_state["step_percent"] = 100
            progress_state["step_message"] = "단계별 진행: 대상 언어 확인 및 데이터 로드 완료"

        # 3. 3단계: 고속 번역 준비
        elif "[3/3]" in clean and "고속 번역" in clean:
            progress_state["total_percent"] = 25
            progress_state["total_message"] = "전체 진행도: [3단계: 고속 번역] 번역 대상 항목 검사 중... (25%)"
            progress_state["step_percent"] = 0
            progress_state["step_message"] = "단계별 진행: 미번역 셀 탐색 및 번역 준비..."

        # 4. 언어별 번역 시작 알림
        elif "⚡ [" in clean and "번역 중" in clean:
            m_l = re.search(r"⚡\s*\[([A-Z]{2,4})\]\s*비어 있는\s*(\d+)개", clean)
            l_code = m_l.group(1) if m_l else ""
            progress_state["total_message"] = f"전체 진행도: [3단계: 번역] {l_code} AI 번역 진행 중..."
            progress_state["step_percent"] = 10
            progress_state["step_message"] = f"단계별 진행: ⚡ [{l_code}] 번역 요청 시작"

        # 4-1. 모델 429 전환
        elif "할당량(429)" in clean or "최적 모델로" in clean:
            m_m = re.search(r"\[(gemini-[^\]]+)\]", clean)
            m_name = m_m.group(1) if m_m else "대체 모델"
            progress_state["step_percent"] = 45
            progress_state["step_message"] = f"단계별 진행: ⚡ {m_name} 모델 전환 가속 중..."

        # 4-2. 배치 완료
        elif "AI 번역 완료" in clean:
            m_b = re.search(r"✅\s*\[([A-Z]{2,4})\]\s*배치\s*(\d+)/(\d+)", clean)
            if m_b:
                l_code, bc, bt = m_b.groups()
                b_pct = int(int(bc) / max(1, int(bt)) * 90)
                progress_state["step_percent"] = b_pct
                progress_state["step_message"] = f"단계별 진행: ✅ [{l_code}] 배치 {bc}/{bt} 완료"

        # 5. [PROGRESS c/t pct%]
        elif "[PROGRESS" in clean:
            m_p = re.search(r"\[PROGRESS\s+(\d+)/(\d+)(?:\s+(\d+)%)?\]\s*(.*)", clean)
            if m_p:
                c_num = int(m_p.group(1))
                t_num = max(1, int(m_p.group(2)))
                m_lang = re.search(r"\[([A-Z]{2,4})\]", m_p.group(4))
                l_code = m_lang.group(1) if m_lang else ""

                macro_pct = 25 + int((c_num / t_num) * 60)
                macro_pct = max(25, min(85, macro_pct))
                progress_state["total_percent"] = macro_pct
                progress_state["total_message"] = f"전체 진행도: [3단계: 번역] {c_num}/{t_num}개 언어 완료 ({macro_pct}%)"
                progress_state["step_percent"] = 100
                progress_state["step_message"] = f"단계별 진행: ✅ [{l_code}] 고속 번역 완료 (100%)" if l_code else f"단계별 진행: ✅ {c_num}/{t_num} 완료"

        # 6. 4단계: 스마트 저장
        elif "[구글 시트 스마트 저장]" in clean:
            progress_state["total_percent"] = 87
            progress_state["total_message"] = "전체 진행도: [4단계: 저장] 온라인 시트 기록 준비 중... (87%)"
            progress_state["step_percent"] = 20
            progress_state["step_message"] = "단계별 진행: 스마트 저장 구조 분석 중..."
        elif "[스마트 저장 분석]" in clean:
            progress_state["total_percent"] = 90
            progress_state["total_message"] = "전체 진행도: [4단계: 저장] 수식(=IMPORTRANGE) 검사 중... (90%)"
            progress_state["step_percent"] = 40
            progress_state["step_message"] = "단계별 진행: IMPORTRANGE 보호 분석 중..."
        elif "수식 셀 감지" in clean or ("원본 시트" in clean and "매핑" in clean):
            progress_state["total_percent"] = 92
            progress_state["total_message"] = "전체 진행도: [4단계: 저장] 원본 시트 매핑 완료 (92%)"
            progress_state["step_percent"] = 60
            progress_state["step_message"] = "단계별 진행: 원본 시트 직접 저장 경로 매핑"
        elif "Batch Update 실행 중" in clean:
            progress_state["total_percent"] = 95
            progress_state["total_message"] = "전체 진행도: [4단계: 저장] 초고속 Batch Update 실행 중... (95%)"
            progress_state["step_percent"] = 85
            progress_state["step_message"] = "단계별 진행: 🚀 구글 시트 API 대량 일괄 쓰기 중..."
        elif "일괄 저장 완료" in clean:
            progress_state["total_percent"] = 98
            progress_state["total_message"] = "전체 진행도: [4단계: 저장] 온라인 시트 일괄 저장 완료 (98%)"
            progress_state["step_percent"] = 100
            progress_state["step_message"] = "단계별 진행: ✅ 온라인 시트 셀 일괄 반영 완료"

        # 7. 5단계: 완료 신호
        elif any(kw in clean for kw in ["스마트 반영 완료", "전체 일괄 처리 완료", "모든 작업 완료", "[탭 처리 완료]"]):
            progress_state["total_percent"] = 100
            progress_state["total_message"] = "전체 진행도: ✅ 모든 번역 및 검수 작업 완료 (100%)"
            progress_state["step_percent"] = 100
            progress_state["step_message"] = "단계별 진행: ✅ 100% 처리 완료"

        payload["progress"] = {
            "current": progress_state["total_percent"],
            "total": 100,
            "percent": progress_state["total_percent"]
        }
        payload["total_progress"] = {
            "current": progress_state["total_percent"],
            "total": 100,
            "percent": progress_state["total_percent"],
            "message": progress_state["total_message"]
        }
        payload["step_progress"] = {
            "current": progress_state["step_percent"],
            "total": 100,
            "percent": progress_state["step_percent"],
            "message": progress_state["step_message"]
        }
        print(json.dumps(payload, ensure_ascii=False), flush=True)

    try:
        web_logger("🚀 [웹 실행 시작] SmartTranslator 엔진을 구동합니다...")
        run_summary = execute_translation_pipeline(cfg, logger=web_logger)
        total_issues = run_summary.get("total", 0) if isinstance(run_summary, dict) else (run_summary or 0)

        # 엑셀 파싱 (이 실행의 모드에 맞는 보고서)
        results = parse_latest_excel(os.path.join(paths.OUTPUT_DIR, report_name_for_cfg(cfg)))
        print(json.dumps({
            "type": "complete",
            "success": True,
            "total_issues": total_issues,
            "summary": run_summary if isinstance(run_summary, dict) else None,
            "results": results
        }, ensure_ascii=False), flush=True)
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(json.dumps({"type": "error", "error": str(e), "traceback": tb}, ensure_ascii=False), flush=True)

def action_apply_excel(options_json=None):
    opts = json.loads(options_json) if options_json else {}
    cfg = load_config()
    cfg.update(opts)
    apply_mode_service_account(cfg)
    def web_logger(msg):
        print(json.dumps({"type": "log", "message": msg}, ensure_ascii=False), flush=True)

    try:
        web_logger("⚡ [구글 시트 반영 시작] 엑셀 보고서의 변경사항을 구글 시트에 일괄 반영합니다...")
        res = apply_excel_report_to_google_sheet(cfg, logger=web_logger)
        if isinstance(res, dict):
            updated_count = res.get("total_applied", 0)
            applied_items = res.get("applied_items", [])
        else:
            updated_count = res
            applied_items = []

        print(json.dumps({
            "type": "apply_complete",
            "success": True,
            "updated_count": updated_count,
            "applied_items": applied_items
        }, ensure_ascii=False), flush=True)
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(json.dumps({"type": "error", "error": str(e), "traceback": tb}, ensure_ascii=False), flush=True)

def action_clear_cache():
    try:
        cache_files = set([
            os.path.join(paths.DATA_DIR, "audit_cache.json"),
        ])
        cleared = 0
        for cp in cache_files:
            if os.path.exists(cp):
                with open(cp, "w", encoding="utf-8") as f:
                    f.write("{}")
                cleared += 1
        print(json.dumps({"success": True, "cleared_count": cleared}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))

def action_test_service_account(options_json=None):
    try:
        data = json.loads(options_json) if options_json else {}
        cfg = load_config()
        cfg.update(data)

        target_url = (data.get("sheet_url") or data.get("target_sheet_url") or cfg.get("target_sheet_url") or "").strip()
        i2_url = (data.get("i2_web_service_url") or cfg.get("i2_web_service_url") or "").strip()

        # 1. 유니티 I2 Google Apps Script Web App URL 검사 (키 파일 불필요)
        # target_url이 일반 구글 시트(docs.google.com)인 경우 절대 I2 웹서비스로 오판하지 않음
        is_i2 = ("script.google.com/macros" in target_url) or (not target_url and "script.google.com/macros" in i2_url)
        if is_i2:
            active_i2_url = target_url if "script.google.com/macros" in target_url else (i2_url or DEFAULT_WEB_SERVICE_URL)
            pw = cfg.get("i2_password", DEFAULT_I2_PASSWORD)
            try:
                live_sheets = fetch_live_i2_sheets(active_i2_url, pw)
                if live_sheets and len(live_sheets) > 0:
                    # 선택한 키 하나만으로 실제 시트 권한을 검증 (다른 키로 대체 금지)
                    ok, sel_name, sel_email, perm_msg = check_i2_key_access(
                        live_sheets, data.get("filename"), cfg.get("service_account_json_path"))
                    if not ok:
                        print(json.dumps({
                            "success": False,
                            "is_i2_web_service": True,
                            "email": sel_email,
                            "filename": sel_name,
                            "error": perm_msg
                        }, ensure_ascii=False))
                        return
                    cfg["i2_web_service_url"] = active_i2_url
                    cfg["target_sheet_url"] = active_i2_url
                    cfg["target_source_mode"] = "i2_official"
                    # 테스트용 일회성 값은 저장하지 않음 (선택 키는 service_account_json_path만 기준)
                    for _tmp in ("filename", "sheet_url", "refresh"):
                        cfg.pop(_tmp, None)
                    save_config(cfg)

                    sheet_titles = list(live_sheets.keys())
                    print(json.dumps({
                        "success": True,
                        "is_i2_web_service": True,
                        "message": f"유니티 I2 웹서비스 연동 성공! (총 {len(live_sheets)}개 공식 스프레드시트 목록 확인)",
                        "sheet_info": {
                            "title": "유니티 I2 공식 스프레드시트",
                            "worksheets": sheet_titles,
                            "count": len(sheet_titles)
                        }
                    }, ensure_ascii=False))
                    return
                else:
                    print(json.dumps({
                        "success": False,
                        "is_i2_web_service": True,
                        "error": "I2 웹서비스 연결에 실패했습니다. Web App URL 및 배포 권한을 확인해주세요."
                    }, ensure_ascii=False))
                    return
            except Exception as i2_err:
                print(json.dumps({
                    "success": False,
                    "is_i2_web_service": True,
                    "error": f"I2 웹서비스 호출 오류: {str(i2_err)}"
                }, ensure_ascii=False))
                return

        # 2. 일반 구글 스프레드시트 또는 서비스 계정 키 검증
        sa_name = data.get("filename") or cfg.get("service_account_json_path") or "service_account.json"
        candidates = [
            sa_name,
            paths.resolve_key_file(sa_name),
        ]
        resolved = None
        for c in candidates:
            if c and os.path.exists(c) and os.path.isfile(c):
                resolved = c
                break

        if not resolved:
            print(json.dumps({
                "success": False,
                "error": f"서비스 계정 키 파일(.json)을 찾을 수 없습니다: {sa_name}\n(일반 구글 시트 연동 시 키 파일을 업로드하거나, 유니티 I2 웹서비스 URL을 입력해 주세요.)"
            }, ensure_ascii=False))
            return

        from google.oauth2.service_account import Credentials
        scopes = [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive.readonly"
        ]
        creds = Credentials.from_service_account_file(resolved, scopes=scopes)
        email = getattr(creds, 'service_account_email', '')
        project_id = getattr(creds, 'project_id', '')

        # 전달받은 시트 URL이 있으면 실제 시트 열기 및 탭 목록 접근 테스트
        sheet_info = None
        if target_url and target_url.startswith("https://"):
            try:
                import gspread
                gc = gspread.authorize(creds)
                sh = gc.open_by_url(target_url)
                ws_titles = [w.title for w in sh.worksheets()]
                sheet_info = {
                    "title": sh.title,
                    "worksheets": ws_titles,
                    "count": len(ws_titles),
                }
            except Exception as se:
                print(json.dumps({
                    "success": False,
                    "error": f"서비스 계정 키 인증은 되었으나 구글 시트 접근에 실패했습니다: {str(se)}\n(구글 시트의 [공유] 메뉴에 봇 이메일 '{email}'을 '편집자'로 추가했는지 확인해 주세요.)",
                    "email": email,
                    "project_id": project_id,
                    "filename": os.path.basename(resolved),
                }, ensure_ascii=False))
                return

        msg = "구글 서비스 계정 인증 성공!"
        if sheet_info:
            msg += f" (연동 시트: '{sheet_info['title']}', 총 {sheet_info['count']}개 탭 확인)"

        print(json.dumps({
            "success": True,
            "message": msg,
            "email": email,
            "project_id": project_id,
            "filename": os.path.basename(resolved),
            "sheet_info": sheet_info,
        }, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": f"인증 실패: {str(e)}"}, ensure_ascii=False))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True, choices=[
        "list_sheets", "get_config", "save_config", "test_key", "detect_languages",
        "get_results", "run", "apply_excel", "get_glossary", "save_glossary", "clear_cache",
        "test_service_account", "list_models", "test_glossary"
    ])
    parser.add_argument("--options", default="")
    args = parser.parse_args()

    if args.action == "list_sheets":
        action_list_sheets()
    elif args.action == "get_config":
        action_get_config()
    elif args.action == "save_config":
        action_save_config(args.options)
    elif args.action == "test_key":
        action_test_key(args.options)
    elif args.action == "detect_languages":
        action_detect_languages(args.options)
    elif args.action == "get_results":
        action_get_results(args.options)
    elif args.action == "get_glossary":
        action_get_glossary()
    elif args.action == "save_glossary":
        action_save_glossary(args.options)
    elif args.action == "run":
        action_run(args.options)
    elif args.action == "apply_excel":
        action_apply_excel(args.options)
    elif args.action == "clear_cache":
        action_clear_cache()
    elif args.action == "test_service_account":
        action_test_service_account(args.options)
    elif args.action == "list_models":
        action_list_models(args.options)
    elif args.action == "test_glossary":
        action_test_glossary(args.options)
