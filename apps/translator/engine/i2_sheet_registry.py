import urllib.request
import urllib.parse
import json
import re

DEFAULT_WEB_SERVICE_URL = "https://script.google.com/macros/s/AKfycbxx7BnE6LTPzvP3GDIPEKgh365ceglr4wJ_cLYYOTBGnkslw88E18K5dhhrqmxhtjtE/exec"
DEFAULT_I2_PASSWORD = "ds_i2_pass_wd"

# 프로젝트 공식 I2 구글 스프레드시트 10개 키 매핑
OFFICIAL_I2_SHEETS = {
    "I2Loc 던전슬래셔 번역 (기본)": "1c1LyP3OUej2acQ5KGWuYQRoY5AhEM4p8rw7ZmLPckHA",
    "I2Loc 던전슬래셔 스킬 번역": "1mIew5_ss0Yt3dJ_EvWOASGBlhv_s0QrhZvZJ42ORhlE",
    "I2Loc 던전슬래셔 유물 번역": "1yR3vUhLKnYWno-rSqWLzrCvjDTS3teKndUMdRwQ_A9Y",
    "I2Loc 상점과 UI": "1ZmViQFV-jfempLMt10xISxLhXyD5sozVtBdZ9-cwzYo",
    "I2Loc 던전슬래셔 캐릭터 번역": "1lNtUTH899DPSzQWVNMHlW5PIy-2JZqnk85MzTNnnQm8",
    "I2Loc 몬스터 NPC": "1zMkUMZXvFsBrTgQbwgiwwFtgmKV1pYlvU0qSNe3NnoU",
    "I2Loc 캐릭터 대사": "1TjCa82Q4BUoRF32PWmS6zC-920oUYv44svsKNbH66Fk",
    "I2Loc 이벤트": "1CdM9rfAlI8siIQY0JCPThCjrZUsHpczmtaPByPq8Q9U",
    "I2Loc 시너지": "1vD3zVDZvpZf17FhE24D1edIYnED9XN8BsWzt8-s4-ks",
    "I2Loc 스토리": "1oS4GfAzfTbFcyqmgi-cGvd-G1mfT38qgL7Fh2btyBDo",
}

def get_sheet_url(sheet_key: str) -> str:
    """스프레드시트 키로부터 구글 시트 URL을 생성합니다."""
    return f"https://docs.google.com/spreadsheets/d/{sheet_key}/edit"

def fetch_live_i2_sheets(web_service_url: str = DEFAULT_WEB_SERVICE_URL, password: str = DEFAULT_I2_PASSWORD) -> dict[str, str]:
    """
    I2 Web Service URL에 질의하여 구글 드라이브에 등록된 최신 스프레드시트 목록을 가져옵니다.
    반환: {시트명: 시트키}
    """
    if not web_service_url:
        return OFFICIAL_I2_SHEETS.copy()

    sep = "&" if "?" in web_service_url else "?"
    query_url = f"{web_service_url.strip()}{sep}action=GetSpreadsheetList&password={urllib.parse.quote(password or '')}"
    req = urllib.request.Request(query_url, headers={"User-Agent": "Mozilla/5.0"})

    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            content = resp.read().decode("utf-8", errors="replace")
            data = json.loads(content)
            if isinstance(data, dict):
                cleaned = {}
                for name, key in data.items():
                    if "사본" in name or "트래블러" in name:
                        continue
                    cleaned[name] = key
                if cleaned:
                    return cleaned
    except Exception as e:
        print(f"[I2 웹서비스 조회 경고] {e} (기본 내장 목록을 사용합니다)")

    return OFFICIAL_I2_SHEETS.copy()

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 글로벌 언어 레지스트리 및 자동 판별 시스템
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KNOWN_LANGUAGES = {
    "ENG": {"name": "English", "code": "ENG", "display_name": "영어", "aliases": ["english", "eng", "en", "영어"]},
    "JPN": {"name": "Japanese", "code": "JPN", "display_name": "일본어", "aliases": ["japanese", "japan", "jpn", "ja", "일본어"]},
    "CHS": {"name": "Simplified Chinese", "code": "CHS", "display_name": "중국어 간체", "aliases": ["chinese (simplified)", "simplified chinese", "chinese", "chs", "zh-cn", "zh", "중국어 간체", "중국어(간체)", "중국어"]},
    "CHT": {"name": "Traditional Chinese", "code": "CHT", "display_name": "중국어 번체", "aliases": ["chinese (taiwan)", "chinese (traditional)", "traditional chinese", "chinese(taiwan)", "cht", "zh-tw", "중국어 번체", "중국어(번체)"]},
    "SPA": {"name": "Spanish", "code": "SPA", "display_name": "스페인어", "aliases": ["spain", "spanish", "español", "espanol", "spa", "es", "es-es", "eu-es", "스페인", "스페인어"]},
    "GER": {"name": "German", "code": "GER", "display_name": "독일어", "aliases": ["german", "deutsch", "ger", "de", "deu", "독일어"]},
    "FRA": {"name": "French", "code": "FRA", "display_name": "프랑스어", "aliases": ["french", "français", "francais", "fra", "fr", "fre", "프랑스어", "불어"]},
    "POR": {"name": "Portuguese", "code": "POR", "display_name": "포르투갈어", "aliases": ["portuguese", "português", "portugues", "por", "pt", "포르투갈어"]},
    "RUS": {"name": "Russian", "code": "RUS", "display_name": "러시아어", "aliases": ["russian", "rus", "ru", "러시아어"]},
    "ITA": {"name": "Italian", "code": "ITA", "display_name": "이탈리아어", "aliases": ["italian", "italiano", "ita", "it", "이탈리아어"]},
    "VIE": {"name": "Vietnamese", "code": "VIE", "display_name": "베트남어", "aliases": ["vietnamese", "vie", "vi", "베트남어"]},
    "THA": {"name": "Thai", "code": "THA", "display_name": "태국어", "aliases": ["thai", "tha", "th", "태국어"]},
    "IDN": {"name": "Indonesian", "code": "IDN", "display_name": "인도네시아어", "aliases": ["indonesian", "idn", "id", "인도네시아어"]},
    "TUR": {"name": "Turkish", "code": "TUR", "display_name": "튀르키예어", "aliases": ["turkish", "tur", "tr", "터키어", "튀르키예어"]},
    "POL": {"name": "Polish", "code": "POL", "display_name": "폴란드어", "aliases": ["polish", "pol", "pl", "폴란드어"]},
    "ARA": {"name": "Arabic", "code": "ARA", "display_name": "아랍어", "aliases": ["arabic", "ara", "ar", "아랍어"]}
}

try:
    import lang_config as _lc
    _lc.register_languages(KNOWN_LANGUAGES)   # languages.json 의 name/aliases 로 신규 언어 확장
except Exception:
    pass

def resolve_language_info(identifier: str) -> tuple[str, str]:
    """
    임의의 식별자(헤더명 'German', 코드 'GER', 언어명 'Spanish' 등)를 받아
    (표준 언어 코드, LLM 프롬프트용 영문 언어명) 튜플을 반환합니다.
    미등록 신규 언어인 경우 식별자 자체를 안전하게 사용합니다.
    """
    clean_id = (identifier or "").strip().lower()
    for code, info in KNOWN_LANGUAGES.items():
        if code.lower() == clean_id:
            return info["code"], info["name"]
        if info["name"].lower() == clean_id:
            return info["code"], info["name"]
        for a in info["aliases"]:
            if a == clean_id or clean_id == a:
                return info["code"], info["name"]
    norm_name = identifier.strip().title() if identifier else "Unknown"
    norm_code = norm_name[:3].upper() if len(norm_name) >= 3 else norm_name
    return norm_code, norm_name

def fetch_i2_sheet_rows(sheet_key: str, web_service_url: str = DEFAULT_WEB_SERVICE_URL, password: str = DEFAULT_I2_PASSWORD) -> tuple[list[str], list[dict]]:
    """
    I2 Web Service URL을 통해 특정 스프레드시트의 전체 행 데이터를 다운로드하여 파싱합니다.
    구글 시트에 추가된 모든 신규 언어 열을 실시간 동적으로 자동 감지합니다.
    반환: (headers, rows)
    """
    sep = "&" if "?" in web_service_url else "?"
    query = f"{web_service_url.strip()}{sep}key={sheet_key}&action=GetLanguageSource&password={urllib.parse.quote(password or '')}"
    req = urllib.request.Request(query, headers={"User-Agent": "Mozilla/5.0"})

    with urllib.request.urlopen(req, timeout=45) as resp:
        raw = resp.read().decode("utf-8", errors="replace")

    if not raw or raw == "Wrong Password":
        raise ValueError(f"I2 Web Service 오류: {raw}")

    parts = re.split(r'\[i2category\](.*?)\[/i2category\]', raw)
    global_headers = ["Keys"]
    rows = []

    if len(parts) > 1:
        # 멀티 탭 시트 구조: [prefix, cat1, content1, cat2, content2, ...]
        for i in range(1, len(parts), 2):
            cat_name = parts[i].strip()
            sheet_content = parts[i+1].split('[/i2csv]')[0].strip()
            lines = sheet_content.split('[ln]')
            if not lines:
                continue

            h_cols = [c.strip() for c in lines[0].split('[*]')]
            lang_headers = [h for h in h_cols[3:] if h]
            for lh in lang_headers:
                if lh not in global_headers:
                    global_headers.append(lh)

            for l in lines[1:]:
                cols = l.split('[*]')
                if len(cols) < 4:
                    continue
                k = cols[0].strip()
                if not k or k == "Keys":
                    continue
                row_dict = {"Keys": k, "Category": cat_name}
                for h_idx, h_name in enumerate(lang_headers):
                    val_idx = 3 + h_idx
                    row_dict[h_name] = cols[val_idx].strip() if val_idx < len(cols) else ""
                rows.append(row_dict)
    else:
        # 단일 탭 구조 폴백
        lines = raw.split("[ln]")
        h0 = lines[0] if lines else ""
        keys_idx = h0.find("Keys[*]")
        if keys_idx != -1:
            header_str = h0[keys_idx:]
            raw_headers = [c.strip() for c in header_str.split("[*]")]
            lang_headers = [h for h in raw_headers[3:] if h]
            global_headers = ["Keys"] + lang_headers
        else:
            lang_headers = ["Korean", "English", "Japanese", "Chinese", "Chinese (Taiwan)", "Spain", "German"]
            global_headers = ["Keys"] + lang_headers

        for line in lines[1:]:
            cols = line.split("[*]")
            if len(cols) < 4:
                continue
            k = cols[0].strip()
            if not k or k == "Keys":
                continue
            row_dict = {"Keys": k}
            for h_idx, h_name in enumerate(lang_headers):
                val_idx = 3 + h_idx
                row_dict[h_name] = cols[val_idx].strip() if val_idx < len(cols) else ""
            rows.append(row_dict)

    return global_headers, rows

def fetch_i2_sheet_tabs(sheet_key: str, web_service_url: str = DEFAULT_WEB_SERVICE_URL, password: str = DEFAULT_I2_PASSWORD) -> dict[str, tuple[list[str], list[dict]]]:
    """
    I2 Web Service에서 스프레드시트의 모든 탭 데이터를 탭별로 분리하여 반환합니다.
    반환: {탭이름: (headers, rows), ...}
    """
    sep = "&" if "?" in web_service_url else "?"
    query = f"{web_service_url.strip()}{sep}key={sheet_key}&action=GetLanguageSource&password={urllib.parse.quote(password or '')}"
    req = urllib.request.Request(query, headers={"User-Agent": "Mozilla/5.0"})

    with urllib.request.urlopen(req, timeout=45) as resp:
        raw = resp.read().decode("utf-8", errors="replace")

    if not raw or raw == "Wrong Password":
        raise ValueError(f"I2 Web Service 오류: {raw}")

    parts = re.split(r'\[i2category\](.*?)\[/i2category\]', raw)
    tabs_dict = {}

    if len(parts) > 1:
        # 멀티 탭 시트 구조: [prefix, cat1, content1, cat2, content2, ...]
        for i in range(1, len(parts), 2):
            cat_name = parts[i].strip()
            sheet_content = parts[i+1].split('[/i2csv]')[0].strip()
            lines = sheet_content.split('[ln]')
            if not lines:
                continue

            h_cols = [c.strip() for c in lines[0].split('[*]')]
            lang_headers = [h for h in h_cols[3:] if h]
            headers = ["Keys"] + lang_headers

            rows = []
            for l in lines[1:]:
                cols = l.split('[*]')
                if len(cols) < 4:
                    continue
                k = cols[0].strip()
                if not k or k == "Keys":
                    continue
                row_dict = {"Keys": k, "Category": cat_name}
                for h_idx, h_name in enumerate(lang_headers):
                    val_idx = 3 + h_idx
                    row_dict[h_name] = cols[val_idx].strip() if val_idx < len(cols) else ""
                rows.append(row_dict)

            tabs_dict[cat_name] = (headers, rows)
    else:
        # 단일 탭 구조 폴백
        lines = raw.split("[ln]")
        h0 = lines[0] if lines else ""
        keys_idx = h0.find("Keys[*]")
        if keys_idx != -1:
            header_str = h0[keys_idx:]
            raw_headers = [c.strip() for c in header_str.split("[*]")]
            lang_headers = [h for h in raw_headers[3:] if h]
            headers = ["Keys"] + lang_headers
        else:
            lang_headers = ["Korean", "English", "Japanese", "Chinese", "Chinese (Taiwan)", "Spain", "German"]
            headers = ["Keys"] + lang_headers

        rows = []
        for line in lines[1:]:
            cols = line.split("[*]")
            if len(cols) < 4:
                continue
            k = cols[0].strip()
            if not k or k == "Keys":
                continue
            row_dict = {"Keys": k}
            for h_idx, h_name in enumerate(lang_headers):
                val_idx = 3 + h_idx
                row_dict[h_name] = cols[val_idx].strip() if val_idx < len(cols) else ""
            rows.append(row_dict)

        tabs_dict["기본"] = (headers, rows)

    return tabs_dict

def save_i2_sheet_tab_rows(
    sheet_key: str,
    category_name: str,
    lang_headers: list[str],
    rows: list[dict],
    web_service_url: str = DEFAULT_WEB_SERVICE_URL,
    password: str = DEFAULT_I2_PASSWORD,
    update_mode: str = "Merge",
    original_rows: list[dict] | None = None
) -> bool:
    """
    I2 Web Service(action=SetLanguageSource)를 통해 해당 탭의 번역 데이터를 구글 시트에 원격 일괄 반영합니다.
    구글 서비스 계정 권한이 필요 없으며, I2 Apps Script 권한으로 즉시 시트에 쓰여집니다.

    original_rows가 제공된 경우, 실제 번역값이 변경된 항목(key)만 필터링하여 전송합니다.
    이를 통해 구글 시트 버전 기록에 실제 수정된 셀만 남도록 최소화합니다.
    """
    clean_langs = [h for h in lang_headers if h != "Keys" and not any(x in h for x in ["[점수", "[Score", "점수/사유"])]

    # 변경된 항목만 추출 (original_rows 제공 시)
    if original_rows is not None:
        orig_map = {r.get("Keys", "").strip(): r for r in original_rows if r.get("Keys", "").strip()}
        changed_rows = []
        for r in rows:
            k = r.get("Keys", "").strip()
            if not k or k == "Keys":
                continue
            orig = orig_map.get(k)
            if orig is None:
                # 원본에 없던 신규 항목 → 포함
                changed_rows.append(r)
                continue
            # 언어 컬럼 중 하나라도 값이 달라졌으면 포함
            for lh in clean_langs:
                old_v = str(orig.get(lh, "") or "").strip()
                new_v = str(r.get(lh, "") or "").strip()
                if old_v != new_v:
                    changed_rows.append(r)
                    break
        rows_to_send = changed_rows
        print(f"[I2 변경 필터] 전체 {len(rows)}행 중 실제 변경된 {len(rows_to_send)}행만 전송합니다.")
    else:
        rows_to_send = [r for r in rows if r.get("Keys", "").strip() and r.get("Keys", "").strip() != "Keys"]

    if not rows_to_send:
        print(f"[I2 변경 필터] 변경된 항목이 없습니다. 구글 시트 저장을 건너뜁니다.")
        return True  # 변경 없음 → 성공으로 처리

    header_line = "Keys[*]Type[*]Description[*]" + "[*]".join(clean_langs)

    data_lines = [header_line]
    for r in rows_to_send:
        k = r.get("Keys", "").strip()
        term_type = r.get("Type", "Text")
        desc = r.get("Description", "")
        row_vals = [k, term_type, desc]
        for lh in clean_langs:
            row_vals.append(str(r.get(lh, "") or "").strip())
        data_lines.append("[*]".join(row_vals))

    csv_data = "[ln]".join(data_lines)
    full_data = f"{category_name}<I2Loc>{csv_data}"

    form_data = {
        'key': sheet_key,
        'action': 'SetLanguageSource',
        'password': password,
        'updateMode': update_mode,
        'data': full_data
    }

    encoded = urllib.parse.urlencode(form_data).encode('utf-8')
    req = urllib.request.Request(web_service_url, data=encoded, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            result = resp.read().decode('utf-8').strip()
            return result.lower() == "true" or "true" in result.lower()
    except Exception as e:
        print(f"[I2 웹서비스 저장 오류] {e}")
        return False

def save_i2_sheet_tab_cells_direct(
    sheet_key: str,
    category_name: str,
    lang_headers: list[str],
    rows: list[dict],
    sa_json_path: str = None,
    logger=print
) -> tuple[int | None, int]:
    """
    gspread(Google Sheets API v4)를 사용하여 해당 탭에서 '실제 번역이 변경된 셀만' 핀포인트로 batch_update합니다.
    - 장점: 구글 시트 '버전 기록(Version History)'에 오직 실제 수정된 셀만 정확히 녹색으로 하이라이트됩니다!
    - 전체 덮어쓰기가 전혀 발생하지 않으며, 수정 없는 셀/행은 100% 무결성을 유지합니다.
    - 서비스 계정 권한 문제 등으로 실패 시 (None, 0)을 반환하여 상위 호출부에서 웹서비스 폴백을 수행하도록 합니다.
    반환: (실제 업데이트된 셀 수, 총 변경 시도 수) / 실패 시: (None, 0)
    """
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except Exception as e:
        logger(f"  ⚠️ [gspread 라이브러리 부재] {e}")
        return None, 0

    scopes = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]

    # 1. 사용자가 선택한 서비스 계정 키 하나만 사용 (nspg/기본 키로 자동 대체하지 않음)
    from config_manager import resolve_selected_service_account
    selected = resolve_selected_service_account(sa_json_path)
    candidates = [selected] if selected else []

    client = None
    connected_key = None
    for cand in candidates:
        try:
            creds = Credentials.from_service_account_file(cand, scopes=scopes)
            temp_client = gspread.authorize(creds)
            # 연결 확인 (open_by_key 시도)
            sh = temp_client.open_by_key(sheet_key)
            client = temp_client
            connected_key = cand
            break
        except Exception:
            continue

    if not client:
        return None, 0

    try:
        sh = client.open_by_key(sheet_key)

        # 탭 워크시트 찾기
        ws = None
        target_tab = (category_name or "기본").strip()
        try:
            ws = sh.worksheet(target_tab)
        except Exception:
            for w in sh.worksheets():
                if w.title.strip() == target_tab or (target_tab == "기본" and w.id == 0):
                    ws = w
                    break
        if not ws:
            ws = sh.sheet1

        # 시트 기존 데이터 로드 (실시간 diff 비교용)
        sheet_data = ws.get_all_values()
        if not sheet_data:
            return 0, 0

        sheet_headers = [h.strip() for h in sheet_data[0]]
        header_to_col = {h: idx + 1 for idx, h in enumerate(sheet_headers)}

        key_to_row = {}
        for row_idx, r_vals in enumerate(sheet_data[1:], start=2):
            if r_vals and r_vals[0].strip():
                key_to_row[r_vals[0].strip()] = (row_idx, r_vals)

        clean_langs = [h for h in lang_headers if h != "Keys" and not any(x in h for x in ["[점수", "[Score", "점수/사유"])]

        cell_updates = []
        new_rows_to_append = []

        for r in rows:
            k = r.get("Keys", "").strip()
            if not k or k == "Keys":
                continue

            if k in key_to_row:
                row_num, orig_vals = key_to_row[k]
                for lh in clean_langs:
                    col_num = header_to_col.get(lh)
                    if not col_num:
                        continue
                    orig_val = orig_vals[col_num - 1].strip() if col_num - 1 < len(orig_vals) else ""
                    new_val = str(r.get(lh, "") or "").strip()
                    # 💡 핵심: 기존 값과 실제 차이가 있는 셀만 핀포인트로 수집!
                    if new_val and new_val != orig_val:
                        cell_a1 = gspread.utils.rowcol_to_a1(row_num, col_num)
                        cell_updates.append({"range": cell_a1, "values": [[new_val]]})
            else:
                # 시트에 없던 신규 키인 경우 새 행으로 추가
                new_row = [r.get(h, "") for h in sheet_headers]
                new_rows_to_append.append(new_row)

        total_saved = 0
        if cell_updates:
            ws.batch_update(cell_updates, value_input_option="USER_ENTERED")
            total_saved += len(cell_updates)

        if new_rows_to_append:
            ws.append_rows(new_rows_to_append, value_input_option="USER_ENTERED")
            total_saved += len(new_rows_to_append)

        return total_saved, len(cell_updates) + len(new_rows_to_append)

    except Exception as e:
        logger(f"  ⚠️ [gspread 직접 저장 오류] {e}")
        return None, 0



import os
import codecs
from collections import Counter

# 프로젝트 내 기본 I2Languages.asset 경로 자동 탐색
def get_default_local_i2_asset_path() -> str:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.abspath(os.path.join(current_dir, "..", "..", "01_DungeonSlasher", "02_DungeonSlasher_Live", "Assets", "Resources", "I2Languages.asset")),
        os.path.abspath(os.path.join(current_dir, "..", "..", "Assets", "Resources", "I2Languages.asset")),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return ""

def parse_i2_languages(asset_path: str = None) -> list[dict]:
    """
    Unity I2Languages.asset 파일의 mLanguages 섹션을 파싱하여 등록된 모든 언어 목록을 반환합니다.
    반환: [{'Name': 'Korean', 'Code': 'ko'}, {'Name': 'English', 'Code': 'en'}, ...]
    """
    if not asset_path:
        asset_path = get_default_local_i2_asset_path()
    if not asset_path or not os.path.exists(asset_path):
        return []

    languages = []
    try:
        with open(asset_path, 'r', encoding='utf-8', errors='replace') as f:
            in_mlanguages = False
            curr_lang = {}
            for line in f:
                stripped = line.strip()
                if stripped == 'mLanguages:':
                    in_mlanguages = True
                    continue
                if in_mlanguages:
                    if stripped.startswith('- Name:'):
                        if curr_lang and 'Name' in curr_lang:
                            languages.append(curr_lang)
                        curr_lang = {'Name': stripped.replace('- Name:', '').strip().strip('"\'')}
                    elif stripped.startswith('Name:') and 'Name' not in curr_lang:
                        curr_lang['Name'] = stripped.replace('Name:', '').strip().strip('"\'')
                    elif stripped.startswith('Code:'):
                        curr_lang['Code'] = stripped.replace('Code:', '').strip().strip('"\'')
                    elif stripped.startswith('- ') and not stripped.startswith('- Name:'):
                        break
                    elif not stripped or (line.startswith('    ') and not line.startswith('      ') and not stripped.startswith('-')):
                        if not any(stripped.startswith(x) for x in ['Name:', 'Code:', 'Flags:', '-']):
                            break
            if curr_lang and 'Name' in curr_lang and curr_lang not in languages:
                languages.append(curr_lang)
    except Exception as e:
        print(f"[I2Languages 언어 파싱 오류] {e}")
    return languages

def decode_yaml_str(raw: str) -> str:
    """Unity YAML 내의 유니코드 이스케이프 및 따옴표를 디코딩합니다."""
    raw = raw.strip()
    if not raw:
        return ""

    if raw.startswith('"') and raw.endswith('"') and len(raw) >= 2:
        content = raw[1:-1]
        try:
            return codecs.decode(content, 'unicode_escape')
        except Exception:
            def repl_u(m):
                try:
                    return chr(int(m.group(1), 16))
                except Exception:
                    return m.group(0)
            def repl_x(m):
                try:
                    return chr(int(m.group(1), 16))
                except Exception:
                    return m.group(0)
            res = re.sub(r'\\u([0-9a-fA-F]{4})', repl_u, content)
            res = re.sub(r'\\x([0-9a-fA-F]{2})', repl_x, res)
            res = res.replace('\\n', '\n').replace('\\t', '\t').replace('\\"', '"').replace('\\\\', '\\')
            return res

    if raw.startswith("'") and raw.endswith("'") and len(raw) >= 2:
        content = raw[1:-1]
        return content.replace("''", "'")

    return raw

def get_category_from_term(full_term: str) -> str:
    """Unity I2 Localization 공식 GetCategoryFromFullTerm(OnlyMainCategory=True)와 100% 동일하게 카테고리를 추출합니다."""
    term_clean = full_term.strip().strip('"\'')
    sep_idx = -1
    for idx, ch in enumerate(term_clean):
        if ch in ('/', '\\'):
            sep_idx = idx
            break
    # 유니티 공식 EmptyCategory는 "Default"
    return term_clean[:sep_idx].strip() if sep_idx >= 0 else "Default"

def get_local_i2_categories(asset_path: str = None) -> list[tuple[str, int]]:
    """
    I2Languages.asset 파일을 빠르게 스캔하여 유니티 에디터와 100% 일치하는 카테고리 목록과 항목 수를 반환합니다.
    (따옴표 중복 분리 버그 완벽 해결 및 Unity 공식 Default 카테고리 일치)
    """
    if not asset_path:
        asset_path = get_default_local_i2_asset_path()
    if not os.path.exists(asset_path):
        return []

    counts = Counter()
    try:
        with open(asset_path, 'r', encoding='utf-8', errors='replace') as f:
            current_term_parts = []
            in_term_multiline = False

            for line in f:
                stripped = line.strip()

                if line.startswith("    - Term: "):
                    val_part = line[12:].strip()
                    # 멀티라인 Term 검사 (따옴표로 시작하나 그 줄에서 닫히지 않은 경우)
                    if (val_part.startswith('"') and not (val_part.endswith('"') and len(val_part) >= 2 and not val_part.endswith('\\"'))) or \
                       (val_part.startswith("'") and not (val_part.endswith("'") and len(val_part) >= 2)):
                        in_term_multiline = True
                        current_term_parts = [val_part]
                    else:
                        in_term_multiline = False
                        term_key = decode_yaml_str(val_part)
                        cat = get_category_from_term(term_key)
                        counts[cat] += 1
                    continue

                if in_term_multiline:
                    if stripped.startswith("TermType:") or stripped.startswith("Description:") or stripped.startswith("Languages:"):
                        in_term_multiline = False
                        full_raw = " ".join(current_term_parts)
                        term_key = decode_yaml_str(full_raw)
                        cat = get_category_from_term(term_key)
                        counts[cat] += 1
                        current_term_parts = []
                    else:
                        current_term_parts.append(stripped)
                        if (current_term_parts[0].startswith('"') and stripped.endswith('"') and not stripped.endswith('\\"')) or \
                           (current_term_parts[0].startswith("'") and stripped.endswith("'")):
                            in_term_multiline = False
                            full_raw = " ".join(current_term_parts)
                            term_key = decode_yaml_str(full_raw)
                            cat = get_category_from_term(term_key)
                            counts[cat] += 1
                            current_term_parts = []
    except Exception as e:
        print(f"[로컬 카테고리 스캔 오류] {e}")
        return []

    return counts.most_common()

def parse_local_i2languages_asset(asset_path: str = None, category_filter: str = None) -> tuple[list[str], list[dict]]:
    """
    Unity의 I2Languages.asset(로컬 YAML 파일)을 파싱하여 headers, rows(dict 리스트) 형태로 반환합니다.
    유니티 공식 카테고리 규칙을 완벽 준수합니다.
    """
    if not asset_path:
        asset_path = get_default_local_i2_asset_path()

    if not os.path.exists(asset_path):
        raise FileNotFoundError(f"I2Languages.asset 파일을 찾을 수 없습니다: {asset_path}")

    parsed_langs = parse_i2_languages(asset_path)
    if parsed_langs:
        headers = ["Keys"] + [l["Name"] for l in parsed_langs]
    else:
        headers = ["Keys", "Korean", "English", "Japanese", "Chinese", "Chinese (Taiwan)", "Spain"]
    rows = []

    with open(asset_path, 'r', encoding='utf-8', errors='replace') as f:
        in_mterms = False
        current_term_parts = []
        in_term_multiline = False
        current_term_key = None
        in_languages = False
        current_languages = []
        current_lang_buf = []
        in_multiline = False
        multiline_quote = None

        for line in f:
            stripped = line.strip()

            if stripped == "mTerms:":
                in_mterms = True
                continue

            if not in_mterms:
                continue

            # Term 시작
            if line.startswith("    - Term: "):
                # 이전 term 저장
                if current_term_key is not None:
                    if current_lang_buf:
                        current_languages.append(decode_yaml_str(" ".join(current_lang_buf)))
                        current_lang_buf = []

                    cat = get_category_from_term(current_term_key)
                    include = True
                    if category_filter and category_filter not in ("전체", "[전체]", "ALL", "all", ""):
                        if category_filter in ("Default", "(Root)"):
                            if cat != "Default":
                                include = False
                        else:
                            if cat != category_filter and not current_term_key.startswith(category_filter + "/") and not current_term_key.startswith(category_filter + "\\"):
                                include = False

                    if include:
                        row = {"Keys": current_term_key}
                        for idx, h in enumerate(headers[1:]):
                            row[h] = current_languages[idx] if idx < len(current_languages) else ""
                        rows.append(row)

                val_part = line[12:].strip()
                current_languages = []
                current_lang_buf = []
                in_languages = False
                in_multiline = False
                multiline_quote = None

                if (val_part.startswith('"') and not (val_part.endswith('"') and len(val_part) >= 2 and not val_part.endswith('\\"'))) or \
                   (val_part.startswith("'") and not (val_part.endswith("'") and len(val_part) >= 2)):
                    in_term_multiline = True
                    current_term_parts = [val_part]
                    current_term_key = None
                else:
                    in_term_multiline = False
                    current_term_key = decode_yaml_str(val_part).strip('"\'')
                continue

            # Term 멀티라인 수집
            if in_term_multiline:
                if stripped.startswith("TermType:") or stripped.startswith("Description:") or stripped.startswith("Languages:"):
                    in_term_multiline = False
                    full_raw = " ".join(current_term_parts)
                    current_term_key = decode_yaml_str(full_raw).strip('"\'')
                    current_term_parts = []
                else:
                    current_term_parts.append(stripped)
                    if (current_term_parts[0].startswith('"') and stripped.endswith('"') and not stripped.endswith('\\"')) or \
                       (current_term_parts[0].startswith("'") and stripped.endswith("'")):
                        in_term_multiline = False
                        full_raw = " ".join(current_term_parts)
                        current_term_key = decode_yaml_str(full_raw).strip('"\'')
                        current_term_parts = []
                    continue

            # Languages 블록 진입
            if stripped == "Languages:":
                in_languages = True
                current_languages = []
                current_lang_buf = []
                in_multiline = False
                continue

            # Languages 블록 내부
            if in_languages:
                if stripped.startswith("Flags:") or stripped.startswith("Languages_Touch:") or stripped.startswith("TermType:") or stripped.startswith("Description:"):
                    in_languages = False
                    if current_lang_buf:
                        current_languages.append(decode_yaml_str(" ".join(current_lang_buf)))
                        current_lang_buf = []
                    in_multiline = False
                    continue

                # 새로운 언어 항목 시작 (- )
                if line.startswith("      - "):
                    if current_lang_buf:
                        current_languages.append(decode_yaml_str(" ".join(current_lang_buf)))
                        current_lang_buf = []

                    val_part = line[8:].rstrip("\r\n")
                    stripped_val = val_part.strip()

                    # 빈 항목
                    if not stripped_val or stripped_val in ("''", '""', "[]"):
                        current_languages.append("")
                        in_multiline = False
                        multiline_quote = None
                        continue

                    first_char = stripped_val[0]
                    if first_char in ('"', "'"):
                        if stripped_val.endswith(first_char) and len(stripped_val) >= 2 and not (first_char == '"' and stripped_val.endswith('\\"') and not stripped_val.endswith('\\\\"')):
                            current_languages.append(decode_yaml_str(stripped_val))
                            in_multiline = False
                            multiline_quote = None
                        else:
                            in_multiline = True
                            multiline_quote = first_char
                            current_lang_buf = [stripped_val]
                    else:
                        # 따옴표 없는 일반 텍스트 (Unity YAML의 Unquoted multiline plain scalar 지원)
                        in_multiline = True
                        multiline_quote = None
                        current_lang_buf = [stripped_val]
                    continue

                # 여러 줄로 이어지는 텍스트
                if in_multiline:
                    stripped_line = line.strip()
                    if multiline_quote:
                        current_lang_buf.append(stripped_line)
                        if stripped_line.endswith(multiline_quote) and not (multiline_quote == '"' and stripped_line.endswith('\\"') and not stripped_line.endswith('\\\\"')):
                            in_multiline = False
                            current_languages.append(decode_yaml_str(" ".join(current_lang_buf)))
                            current_lang_buf = []
                            multiline_quote = None
                    else:
                        # 따옴표 없는 경우 8칸 이상 들여쓰기된 줄은 이전 텍스트에 연결
                        if line.startswith("        "):
                            current_lang_buf.append(stripped_line)
                        else:
                            in_multiline = False
                            current_languages.append(decode_yaml_str(" ".join(current_lang_buf)))
                            current_lang_buf = []
                    continue

        # 마지막 Term 저장
        if current_term_key is not None:
            if current_lang_buf:
                current_languages.append(decode_yaml_str(" ".join(current_lang_buf)))
            cat = get_category_from_term(current_term_key)
            include = True
            if category_filter and category_filter not in ("전체", "[전체]", "ALL", "all", ""):
                if category_filter in ("Default", "(Root)"):
                    if cat != "Default":
                        include = False
                else:
                    if cat != category_filter and not current_term_key.startswith(category_filter + "/") and not current_term_key.startswith(category_filter + "\\"):
                        include = False
            if include:
                row = {"Keys": current_term_key}
                for idx, h in enumerate(headers[1:]):
                    row[h] = current_languages[idx] if idx < len(current_languages) else ""
                rows.append(row)

    return headers, rows


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 용어집 시트 연결 (번역 파이프라인·용어집 화면 조회/저장·연결 테스트가 같은 규칙을 공유)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEFAULT_GLOSSARY_URL = "https://docs.google.com/spreadsheets/d/1rrbDpylaH9580GkUYtrXEqNGr0OHuzIFQNlsSzK7QPI/edit#gid=181735466"
# 주소에 gid 가 없거나 해당 탭이 없을 때 찾는 탭 이름 (기존 파이프라인 'Glossary', 기존 용어집 화면 '번역키')
GLOSSARY_TAB_NAMES = ("Glossary", "번역키")
# 용어집 시트 전용 기본 서비스 계정 키 (선택한 키로 접근 못 할 때 두 번째로 시도)
GLOSSARY_FALLBACK_KEY_FILE = "nspg-498907-a319691c5bb3.json"


def parse_glossary_url(glossary_url: str = "") -> tuple:
    """용어집 주소 → (시트 키, gid 또는 None). 빈 값은 기본 용어집. 형식이 틀리면 ValueError
    (예전처럼 다른 시트를 대신 열지 않는다)."""
    url = (glossary_url or "").strip() or DEFAULT_GLOSSARY_URL
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url)
    if not m:
        raise ValueError("구글 스프레드시트 주소 형식이 아닙니다. (https://docs.google.com/spreadsheets/d/... 형식)")
    g = re.search(r"[#&?]gid=(\d+)", url)
    return m.group(1), (int(g.group(1)) if g else None)


def glossary_key_candidates(sa_json_path: str = "") -> list:
    """용어집 접근에 시도할 서비스 계정 키 파일: 환경 설정에서 선택한 키 → 용어집 전용 기본 키"""
    import paths
    out = []
    if sa_json_path:
        p = paths.resolve_key_file(sa_json_path)
        if os.path.isfile(p):
            out.append(p)
    fallback = os.path.join(paths.KEYS_DIR, GLOSSARY_FALLBACK_KEY_FILE)
    if os.path.isfile(fallback) and fallback not in out:
        out.append(fallback)
    return out


def open_glossary_worksheet(glossary_url: str = "", sa_json_path: str = ""):
    """설정된 용어집 시트의 워크시트와 출처 정보를 반환. 실패하면 사유가 담긴 예외를 올린다.
    반환: (worksheet, {"sheet_key", "sheet_title", "tab", "gid", "url", "note"})"""
    sheet_key, gid = parse_glossary_url(glossary_url)
    candidates = glossary_key_candidates(sa_json_path)
    if not candidates:
        raise FileNotFoundError("용어집 시트에 접근할 서비스 계정 키가 없습니다. [환경 설정 > 데이터 연결]에서 키를 등록하세요.")
    import gspread
    from google.oauth2.service_account import Credentials
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    sh, last_err = None, None
    for kp in candidates:
        try:
            sh = gspread.authorize(Credentials.from_service_account_file(kp, scopes=scopes)).open_by_key(sheet_key)
            break
        except Exception as e:
            last_err = e
    if sh is None:
        raise PermissionError(f"용어집 시트를 열 수 없습니다 (서비스 계정 공유 권한 확인): {type(last_err).__name__} {last_err}".strip())
    worksheets = sh.worksheets()
    ws, note = None, ""
    if gid is not None:
        ws = next((w for w in worksheets if w.id == gid), None)
        if ws is None:
            note = f"주소의 탭(gid={gid})이 없어 탭 이름으로 찾았습니다."
    if ws is None:
        ws = next((w for name in GLOSSARY_TAB_NAMES for w in worksheets if w.title == name), None)
    if ws is None:
        raise LookupError(f"용어집 탭을 찾을 수 없습니다. 주소에 탭(gid)을 포함하거나 탭 이름을 {' 또는 '.join(GLOSSARY_TAB_NAMES)}(으)로 지정하세요.")
    info = {
        "sheet_key": sheet_key,
        "sheet_title": sh.title,
        "tab": ws.title,
        "gid": ws.id,
        "url": f"https://docs.google.com/spreadsheets/d/{sheet_key}/edit#gid={ws.id}",
        "note": note,
    }
    return ws, info


def fetch_glossary_from_google_sheet(glossary_url: str = "", sa_json_path: str = "") -> dict[str, dict[str, str]]:
    """
    설정된 용어집 시트(open_glossary_worksheet)에서 고유명사 사전을 실시간으로 가져옵니다.
    반환: { "체력": { "English": "HP", "Japanese": "体力", ... }, ... }
    실패 시 로컬 I2_Glossary_고유명사용어사전.csv로 fallback합니다.
    """
    import csv
    import paths
    default_csv_path = os.path.join(paths.DATA_DIR, "I2_Glossary_고유명사용어사전.csv")

    # 1. 구글 시트에서 실시간 다운로드 시도
    try:
        ws, info = open_glossary_worksheet(glossary_url, sa_json_path)
        print(f"[Glossary] 용어집 시트: '{info['sheet_title']}' / 탭 '{info['tab']}'" + (f" ({info['note']})" if info["note"] else ""))
        all_values = ws.get_all_values()
        if all_values and len(all_values) > 1:
            headers = all_values[0]
            glossary = {}
            for row in all_values[1:]:
                if not row or not row[0].strip():
                    continue
                kor = row[0].strip()
                glossary[kor] = {}
                for idx, h in enumerate(headers[1:], 1):
                    glossary[kor][h.strip()] = row[idx].strip() if idx < len(row) else ""
            print(f"[Glossary] 구글 시트 실시간 동기화 완료: {len(glossary)}개 고유명사 로드됨.")
            return glossary
    except Exception as e:
        err_name = type(e).__name__ if not str(e) else str(e)
        print(f"[Glossary] 구글 시트 접근 제한 ({err_name}). 로컬 고유명사 사전으로 자동 안전 전환합니다.")

    # 2. 로컬 CSV Fallback
    glossary = {}
    if os.path.exists(default_csv_path):
        try:
            with open(default_csv_path, 'r', encoding='utf-8-sig') as f:
                reader = csv.reader(f)
                headers = next(reader)
                for row in reader:
                    if not row or not row[0].strip():
                        continue
                    kor = row[0].strip()
                    glossary[kor] = {}
                    for idx, h in enumerate(headers[1:], 1):
                        glossary[kor][h.strip()] = row[idx].strip() if idx < len(row) else ""
            print(f"[Glossary] 로컬 CSV 로드 완료: {len(glossary)}개 고유명사.")
            return glossary
        except Exception as e:
            print(f"[Glossary] 로컬 CSV 로드 실패: {e}")

    return glossary

def detect_available_target_languages(source_mode: str = "google_sheet", cfg: dict = None) -> list[dict]:
    """
    현재 설정(구글 시트 또는 I2Languages.asset)에서 사용 가능한 번역 대상 언어 목록을 실시간 동적으로 감지합니다.
    (한국어/원문 및 [점수/사유] 컬럼은 대상 언어에서 자동 제외)
    반환: [{'code': 'ENG', 'name': 'English', 'label': 'ENG (영어)', 'raw_header': 'English'}, ...]
    """
    cfg = cfg or {}
    results = []
    seen_codes = set()

    def _add_lang(identifier: str, raw_header: str):
        if not identifier:
            return
        clean_id = str(identifier).strip()
        # 점수/사유 컬럼 또는 키/타입/설명 제외
        if any(x in clean_id.lower() for x in ["점수", "score", "keys", "type", "description"]):
            return
        code, full_name = resolve_language_info(clean_id)
        if code in seen_codes:
            return
        # 한국어 및 비언어 제외
        if code in ["KOR", "KEY", "TYP", "DES"] or code.lower() in ["ko", "kor", "korean"] or full_name.lower() in ["korean", "한국어"]:
            return
        info = KNOWN_LANGUAGES.get(code, {})
        disp = info.get("display_name", "")
        label = f"{code} ({disp})" if disp else code
        seen_codes.add(code)
        results.append({
            "code": code,
            "name": full_name,
            "label": label,
            "raw_header": raw_header or full_name
        })

    is_google_mode = source_mode in ["google_sheet", "custom_url", "i2_official"]

    # 1. 구글 시트 모드 우선 감지 (Google Sheets API / gspread 또는 I2 Web Service)
    if is_google_mode:
        target_sheet_url = cfg.get("target_sheet_url") or cfg.get("sheet_url") or ""
        sa_path = cfg.get("service_account_json_path") or ""

        # 1-0. 초고속 글로벌 메모리 캐시 확인 (0ms 즉시 반환, refresh=True 시 무시)
        is_force_refresh = bool(cfg.get("refresh"))
        cache_key = f"{source_mode}:{target_sheet_url}:{cfg.get('current_sheet_name', '')}:{cfg.get('filename', '')}"
        global _TARGET_LANGS_CACHE
        if "_TARGET_LANGS_CACHE" not in globals() or is_force_refresh:
            _TARGET_LANGS_CACHE = {}
        if not is_force_refresh and cache_key in _TARGET_LANGS_CACHE:
            cached_data = _TARGET_LANGS_CACHE[cache_key]
            if cached_data:
                return [dict(d) for d in cached_data]

        # 1-1. 서비스 계정 키(.json)가 등록되어 있는 경우, 서비스 계정(gspread)으로 실제 시트 권한 및 헤더 검사
        base_dir = os.path.dirname(os.path.abspath(__file__))
        # 선택한 키 하나만 사용 (filename 우선, 없으면 service_account_json_path)
        from config_manager import resolve_selected_service_account
        _sel = resolve_selected_service_account(cfg.get("filename"), sa_path)
        sa_candidates = [_sel] if _sel else []

        if sa_candidates and target_sheet_url and "/spreadsheets/d/" in target_sheet_url:
            sa_error = None
            for sa_file in sa_candidates:
                try:
                    import gspread
                    from google.oauth2.service_account import Credentials
                    match = re.search(r'/d/([a-zA-Z0-9-_]+)', target_sheet_url)
                    if not match:
                        break
                    sheet_id = match.group(1)
                    scopes = ['https://www.googleapis.com/auth/spreadsheets']
                    creds = Credentials.from_service_account_file(sa_file, scopes=scopes)
                    gc = gspread.authorize(creds)
                    sh = gc.open_by_key(sheet_id)
                    gid_match = re.search(r'gid=(\d+)', target_sheet_url)
                    gid = int(gid_match.group(1)) if gid_match else None
                    ws = None
                    if gid is not None:
                        for w in sh.worksheets():
                            if w.id == gid:
                                ws = w
                                break
                    if not ws:
                        ws = sh.get_worksheet(0)
                    headers = ws.row_values(1)
                    if headers:
                        for h in headers:
                            _add_lang(h, h)
                        if results:
                            _TARGET_LANGS_CACHE[cache_key] = [dict(d) for d in results]
                            return results
                except Exception as ex:
                    sa_error = ex

            # 서비스 계정 키가 등록되어 있으나 시트 접근 권한이 없는 경우, 공개 CSV나 I2 에셋으로 속이지 않고 에러 발생
            if sa_error:
                raise PermissionError(
                    f"해당 구글 시트에 서비스 계정 접근 권한이 없습니다 (키: {os.path.basename(sa_candidates[0])}): "
                    f"{str(sa_error).strip() or type(sa_error).__name__}\n"
                    f"(구글 시트의 [공유] 메뉴에 서비스 계정 봇 이메일을 '편집자'로 추가해 주세요.)"
                )

        # 1-2. 서비스 계정 키가 없는 경우에만 공개 시트(HTTP CSV 스트림) 또는 I2 Web Service로 1행 헤더 추출
        if not sa_candidates and target_sheet_url and "/spreadsheets/d/" in target_sheet_url:
            match = re.search(r'/d/([a-zA-Z0-9-_]+)', target_sheet_url)
            if match:
                sheet_id = match.group(1)
                gid_match = re.search(r'gid=(\d+)', target_sheet_url)
                gid = gid_match.group(1) if gid_match else "0"
                csv_export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
                try:
                    import csv
                    req = urllib.request.Request(csv_export_url, headers={"User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(req, timeout=2.5) as resp:
                        first_chunk = resp.read(4096).decode("utf-8", errors="replace")
                        first_line = first_chunk.splitlines()[0] if first_chunk else ""
                        if first_line and ("," in first_line or "\t" in first_line):
                            reader = csv.reader([first_line])
                            csv_headers = next(reader, [])
                            for h in csv_headers:
                                _add_lang(h.strip(), h.strip())
                            if results:
                                _TARGET_LANGS_CACHE[cache_key] = [dict(d) for d in results]
                                return results
                except Exception:
                    pass

        # 1-2. I2 Web Service로 시트 헤더 검사
        web_service_url = cfg.get("i2_web_service_url") or DEFAULT_WEB_SERVICE_URL
        password = cfg.get("i2_password") or DEFAULT_I2_PASSWORD
        sheet_name = cfg.get("current_sheet_name")
        sheets_map = cfg.get("i2_sheets") or OFFICIAL_I2_SHEETS
        sheet_key = sheets_map.get(sheet_name) if sheet_name else None
        if not sheet_key and target_sheet_url:
            match = re.search(r'/d/([a-zA-Z0-9-_]+)', target_sheet_url)
            if match:
                sheet_key = match.group(1)
        if not sheet_key and sheets_map:
            sheet_key = next(iter(sheets_map.values()))
        if sheet_key and web_service_url:
            try:
                headers, _ = fetch_i2_sheet_rows(sheet_key, web_service_url, password)
                for h in headers:
                    _add_lang(h, h)
                if results:
                    return results
            except Exception:
                pass

    # 2. 로컬 I2 에셋 모드 (또는 구글 시트 실패 시의 폴백)
    if not is_google_mode or not results:
        asset_path = cfg.get("local_i2_asset_path") or get_default_local_i2_asset_path()
        if asset_path and os.path.exists(asset_path):
            try:
                parsed_langs = parse_i2_languages(asset_path)
                for item in parsed_langs:
                    name = item.get("Name", "").strip()
                    code_raw = item.get("Code", "").strip()
                    _add_lang(name or code_raw, name)
                if results:
                    return results
            except Exception as e:
                print(f"[언어 감지] 로컬 에셋 파싱 실패: {e}")

    # 3. 최후 폴백: 기본 국어 목록 (독일어 GER 포함)
    if not results:
        for default_code in ["ENG", "JPN", "CHS", "CHT", "SPA", "GER"]:
            _add_lang(default_code, default_code)

    if results and cache_key:
        _TARGET_LANGS_CACHE[cache_key] = [dict(d) for d in results]

    return results



