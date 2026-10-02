import os
import sys
import re
import json
import time
import urllib.request
import urllib.error
import subprocess
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from config_manager import load_config, save_config, decrypt_api_key
from i2_sheet_registry import (
    OFFICIAL_I2_SHEETS, fetch_live_i2_sheets, get_sheet_url,
    get_default_local_i2_asset_path, get_local_i2_categories,
    detect_available_target_languages, DEFAULT_WEB_SERVICE_URL
)

AUTO_MODEL_LABEL = "⚡ [Auto] 최신 최적 모델 자동 감지 (추천)"

def discover_gemini_models(api_key: str) -> list[str]:
    """구글 API에서 현재 키로 실제 사용 가능한 최신 모델들을 우선순위(최신 Flash 순)로 실시간 자동 조회합니다."""
    fallback = [
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-flash-latest",
        "gemini-flash-lite-latest"
    ]
    clean_key = (api_key or "").strip()
    if clean_key.startswith("ENC:"):
        clean_key = decrypt_api_key(clean_key)
    if not clean_key:
        return fallback

    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={clean_key}"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            models = data.get("models", [])
            gen_models = []
            for m in models:
                name = m.get("name", "").replace("models/", "")
                methods = m.get("supportedGenerationMethods", [])
                if "generateContent" in methods and "gemini" in name.lower():
                    if any(x in name.lower() for x in ["tts", "image", "transcribe", "robotics", "computer-use"]):
                        continue
                    gen_models.append(name)
            if not gen_models:
                return fallback

            def model_priority(m: str):
                is_flash = "flash" in m.lower()
                is_preview = "preview" in m.lower()
                ver_match = re.search(r"(\d+(?:\.\d+)?)", m)
                ver = float(ver_match.group(1)) if ver_match else 1.0
                if "latest" in m.lower():
                    ver = 3.0
                return (1 if is_flash else 0, 0 if is_preview else 1, ver)

            sorted_models = sorted(gen_models, key=model_priority, reverse=True)
            return sorted_models
    except Exception:
        return fallback

def test_gemini_key(api_key: str, model_name: str = "") -> tuple[bool, str, list[str]]:
    """
    구글 제미나이 API 키를 검증합니다.
    계정에서 지원하는 최신 모델들을 실시간 자동 감지하여 순차 테스트합니다.
    """
    api_key = api_key.strip()
    if not api_key:
        return False, "API 키가 비어 있습니다.", []

    available_models = discover_gemini_models(api_key)
    if not available_models:
        return False, "이 API 키로 사용 가능한 제미나이 모델이 없습니다.", []

    # 사용자가 특정 모델을 선택한 경우 해당 모델을 최우선으로 시도
    candidates = list(available_models)
    for m in available_models:
        if m in model_name:
            candidates.remove(m)
            candidates.insert(0, m)
            break

    last_error = ""
    for target_model in candidates:
        gen_url = f"https://generativelanguage.googleapis.com/v1beta/models/{target_model}:generateContent?key={api_key}"
        payload = {
            "contents": [{
                "parts": [{"text": "Translate '안녕' to English. Reply with only one word."}]
            }]
        }
        data = json.dumps(payload).encode("utf-8")
        req_gen = urllib.request.Request(gen_url, data=data, headers={"Content-Type": "application/json"})

        try:
            with urllib.request.urlopen(req_gen, timeout=10) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                candidate = res_data.get("candidates", [{}])[0]
                text = candidate.get("content", {}).get("parts", [{}])[0].get("text", "").strip()
                return True, f"인증 성공! (모델: {target_model} / 응답: '{text}') - 정상 작동 중", available_models
        except urllib.error.HTTPError as e:
            err_msg = e.read().decode("utf-8", errors="replace")
            last_error = f"{target_model}: {err_msg[:120]}"
            continue
        except Exception as e:
            last_error = str(e)
            continue

    return False, f"호출 실패. 마지막 오류: {last_error}", available_models

def test_openai_key(api_key: str, model_name: str = "gpt-4o-mini") -> tuple[bool, str]:
    """OpenAI API 키 검증"""
    api_key = api_key.strip()
    url = "https://api.openai.com/v1/chat/completions"
    payload = {
        "model": "gpt-4o-mini" if "mini" in model_name else "gpt-4o",
        "messages": [{"role": "user", "content": "Say 'OK'"}],
        "max_tokens": 5
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    })

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            reply = res_data["choices"][0]["message"]["content"].strip()
            return True, f"인증 성공! (OpenAI 응답: '{reply}')"
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="replace")
        try:
            err_json = json.loads(err_msg)
            return False, f"OpenAI 오류 ({e.code}): {err_json.get('error', {}).get('message', err_msg)}"
        except:
            return False, f"OpenAI 오류 ({e.code}): {err_msg}"
    except Exception as e:
        return False, f"연결 실패: {e}"

def test_claude_key(api_key: str, model_name: str = "claude-3-5-sonnet") -> tuple[bool, str]:
    """Anthropic Claude API 키 검증"""
    api_key = api_key.strip()
    if not api_key:
        return False, "API 키가 비어 있습니다."

    # 사용자가 Anthropic 콘솔 목록의 'Key ID (apikey_...)'를 실수로 복사한 경우 친절한 안내
    if api_key.startswith("apikey_"):
        return False, (
            "입력하신 키는 Anthropic 콘솔의 'Key ID'입니다!\n\n"
            "• Anthropic 콘솔(console.anthropic.com)의 키 목록에 보이는 'apikey_...'는 관리용 ID이며 비밀 키가 아닙니다.\n"
            "• 실제 동작하는 API Key는 'sk-ant-api03-...' (또는 'sk-ant-...')로 시작합니다.\n"
            "• [Create Key]를 눌러 새로 발급받을 때 팝업창에 나타나는 sk-ant-... 전체를 복사하여 입력해주세요."
        )

    url = "https://api.anthropic.com/v1/messages"
    actual_model = "claude-3-5-haiku-20241022" if "haiku" in model_name.lower() else (
        "claude-3-7-sonnet-20250219" if ("3-7" in model_name or "3.7" in model_name) else "claude-3-5-sonnet-20241022"
    )
    payload = {
        "model": actual_model,
        "max_tokens": 10,
        "messages": [{"role": "user", "content": "Say OK"}]
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01"
    })

    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            content_list = res_data.get("content", [])
            reply = content_list[0].get("text", "").strip() if content_list else "OK"
            return True, f"인증 성공! (Claude 응답: '{reply}')"
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="replace")
        try:
            err_json = json.loads(err_msg)
            raw_err = err_json.get('error', {}).get('message', err_msg)
            if "invalid x-api-key" in raw_err.lower():
                return False, (
                    f"Claude 인증 실패 (401 invalid x-api-key)\n\n"
                    "• 입력하신 API 키가 유효하지 않습니다.\n"
                    "• Anthropic API Key는 반드시 'sk-ant-api03-...' 또는 'sk-ant-...' 형식이어야 합니다.\n"
                    "• console.anthropic.com에서 새 키를 생성(Create Key)한 직후 나타나는 비밀 키를 복사했는지 확인해주세요."
                )
            if "credit balance is too low" in raw_err.lower():
                return False, (
                    "Claude 계정 잔액 부족 (Credit Balance Too Low)\n\n"
                    "• API 키 자체는 유효하게 확인되었으나, Anthropic 계정에 충전된 크레딧(잔액)이 없습니다.\n"
                    "• Anthropic Claude API는 선불제 유료 서비스(최소 $5 충전)입니다.\n"
                    "• console.anthropic.com의 [Plans & Billing] 메뉴에서 크레딧을 충전하시면 즉시 사용 가능합니다.\n\n"
                    "💡 무료로 이용하시려면 상단 제공자에서 'Google Gemini (추천/무료)'를 선택하여 사용해주세요!"
                )
            return False, f"Claude 오류 ({e.code}): {raw_err}"
        except Exception:
            return False, f"Claude 오류 ({e.code}): {err_msg}"
    except Exception as e:
        return False, f"연결 실패: {e}"

# 제공자별 전용 모델 목록 상수
GEMINI_DEFAULT_MODELS = [
    AUTO_MODEL_LABEL,
    "gemini-3.8-flash (구글 최신)",
    "gemini-3.7-flash",
    "gemini-3.6-flash (검증 완료)",
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-flash-lite-latest"
]

OPENAI_DEFAULT_MODELS = [
    "gpt-4o-mini (가성비 추천)",
    "gpt-4o (최고 품질)",
    "gpt-4.5-preview (최신 플래그십)",
    "o3-mini (고성능 추론)"
]

CLAUDE_DEFAULT_MODELS = [
    "claude-3-7-sonnet-20250219 (최신 하이브리드 추론)",
    "claude-3-5-sonnet-20241022 (최고 품질 추천)",
    "claude-3-5-haiku-20241022 (초고속/가성비)",
    "claude-3-opus-20240229"
]

PROVIDER_MODEL_MAP = {
    "gemini": GEMINI_DEFAULT_MODELS,
    "openai": OPENAI_DEFAULT_MODELS,
    "claude": CLAUDE_DEFAULT_MODELS
}

PROVIDER_LABELS = {
    "gemini": "Gemini Key (Google):",
    "openai": "OpenAI Key (GPT):",
    "claude": "Claude Key (Anthropic):"
}

PROVIDER_DISPLAY_NAMES = {
    "gemini": "Google Gemini",
    "openai": "OpenAI GPT",
    "claude": "Anthropic Claude"
}

def detect_api_key_provider(api_key: str) -> str:
    """API 키 형식으로부터 제공자('gemini', 'openai', 'claude')를 자동 판별합니다."""
    key = (api_key or "").strip()
    if key.startswith("ENC:"):
        key = decrypt_api_key(key)
    
    if "AIzaSy" in key or key.startswith("AQ."):
        return "gemini"
    if "sk-ant-" in key or key.startswith("apikey_"):
        return "claude"
    if "sk-" in key:
        return "openai"
    return "gemini"

class AutoScrollbar(ttk.Scrollbar):
    """내용이 화면보다 작을 때는 자동으로 숨겨지고, 넘칠 때만 나타나는 스마트 스크롤바"""
    def set(self, lo, hi):
        if float(lo) <= 0.0 and float(hi) >= 1.0:
            self.grid_remove()
        else:
            self.grid()
        super().set(lo, hi)

class ScrollableFrame(ttk.Frame):
    def __init__(self, container, *args, **kwargs):
        super().__init__(container, *args, **kwargs)
        self.canvas = tk.Canvas(self, borderwidth=0, highlightthickness=0, width=670)
        self.v_scrollbar = AutoScrollbar(self, orient="vertical", command=self.canvas.yview)
        self.h_scrollbar = AutoScrollbar(self, orient="horizontal", command=self.canvas.xview)
        self.scrollable_window = ttk.Frame(self.canvas, padding="8")

        self.canvas_window = self.canvas.create_window((0, 0), window=self.scrollable_window, anchor="nw")
        self.canvas.configure(yscrollcommand=self.v_scrollbar.set, xscrollcommand=self.h_scrollbar.set)

        def _update_scrollregion(event=None):
            self.canvas.update_idletasks()
            self.canvas.configure(scrollregion=self.canvas.bbox("all"))

        self.scrollable_window.bind("<Configure>", _update_scrollregion)

        def _on_canvas_configure(event):
            req_w = self.scrollable_window.winfo_reqwidth()
            target_w = max(event.width, req_w)
            self.canvas.itemconfig(self.canvas_window, width=target_w)
            self.canvas.configure(scrollregion=self.canvas.bbox("all"))

        self.canvas.bind("<Configure>", _on_canvas_configure)

        def _on_mousewheel(event):
            self.canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")

        def _on_shift_mousewheel(event):
            self.canvas.xview_scroll(int(-1 * (event.delta / 120)), "units")

        def _bind_mousewheel(event):
            self.canvas.bind_all("<MouseWheel>", _on_mousewheel)
            self.canvas.bind_all("<Shift-MouseWheel>", _on_shift_mousewheel)

        def _unbind_mousewheel(event):
            self.canvas.unbind_all("<MouseWheel>")
            self.canvas.unbind_all("<Shift-MouseWheel>")

        self.scrollable_window.bind("<Enter>", _bind_mousewheel)
        self.scrollable_window.bind("<Leave>", _unbind_mousewheel)

        # 캔버스와 자동 숨김 스크롤바 Grid 배치
        self.canvas.grid(row=0, column=0, sticky="nsew")
        self.v_scrollbar.grid(row=0, column=1, sticky="ns")
        self.h_scrollbar.grid(row=1, column=0, sticky="ew")
        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(0, weight=1)

class SmartTranslatorUI:
    def __init__(self, root):
        self.root = root
        self.root.title("DungeonSlasher - 파이썬 번역 & API 키 테스터")
        
        self.current_process = None
        self.config = load_config()

        # 화면 해상도 감지 및 저장된 윈도우 크기/위치 복원
        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()
        default_w = min(1440, int(screen_w * 0.90))
        default_h = min(825, int(screen_h * 0.90))
        x = max(0, (screen_w - default_w) // 2)
        y = max(0, (screen_h - default_h) // 2)

        saved_geom = self.config.get("window_geometry", "")
        if saved_geom:
            try:
                self.root.geometry(saved_geom)
            except Exception:
                self.root.geometry(f"{default_w}x{default_h}+{x}+{y}")
        else:
            self.root.geometry(f"{default_w}x{default_h}+{x}+{y}")
        self.root.minsize(700, 450)

        self.provider_keys = {
            "gemini": "",
            "openai": "",
            "claude": ""
        }
        self.provider_models = {
            "gemini": AUTO_MODEL_LABEL,
            "openai": OPENAI_DEFAULT_MODELS[0],
            "claude": CLAUDE_DEFAULT_MODELS[0]
        }
        self.verified_providers = {
            "gemini": False,
            "openai": False,
            "claude": False
        }
        self._active_provider = "gemini"
        self.is_lang_expanded = False
        self.extra_lang_widgets = []

        self._init_ui()
        self._load_values_to_ui()
        self.root.protocol("WM_DELETE_WINDOW", self._on_window_close)

    def _on_window_close(self):
        if self.current_process:
            try:
                self.current_process.terminate()
            except Exception:
                pass
        try:
            pos = self.paned.sashpos(0)
            if pos > 150:
                self.config["paned_sash_position"] = pos
        except Exception:
            pass
        self._on_save_clicked(silent=True)
        self.root.destroy()
        sys.exit(0)

    def _init_ui(self):
        style = ttk.Style()
        style.theme_use('clam')

        # [좌우 분할 스플리터 (PanedWindow)]
        self.paned = ttk.PanedWindow(self.root, orient=tk.HORIZONTAL)
        self.paned.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)

        # 좌측 패널 (설정 및 조작 - 스크롤 지원, 너비 보존)
        left_container = ScrollableFrame(self.paned)
        self.paned.add(left_container, weight=1)
        main_frame = left_container.scrollable_window

        # [섹션 0] 실행할 파이썬 파일 선택
        sec0 = ttk.LabelFrame(main_frame, text=" 📂 실행할 파이썬 파일 (.py) 선택 ", padding="8")
        sec0.pack(fill=tk.X, pady=3)

        ttk.Label(sec0, text="스크립트 경로:").grid(row=0, column=0, sticky=tk.W, pady=3)
        self.entry_script_path = ttk.Entry(sec0)
        self.entry_script_path.grid(row=0, column=1, sticky=tk.EW, padx=5, pady=3)

        btn_browse = ttk.Button(sec0, text="파일 찾기...", command=self._on_browse_file)
        btn_browse.grid(row=0, column=2, padx=3, pady=3)

        ttk.Label(sec0, text="추가 인자(Args):").grid(row=1, column=0, sticky=tk.W, pady=3)
        self.entry_script_args = ttk.Entry(sec0)
        self.entry_script_args.grid(row=1, column=1, columnspan=2, sticky=tk.EW, padx=5, pady=3)
        sec0.columnconfigure(1, weight=1)

        # [섹션 1] AI 제공자 선택 및 다중 API 키 관리
        sec1 = ttk.LabelFrame(main_frame, text=" 1. AI 제공자 선택 및 다중 API 키 관리 ", padding="12")
        sec1.pack(fill=tk.X, pady=4)

        # 1-0. AI 제공자 라디오 버튼 (좌측 정렬 및 텍스트-선택원 정중앙 정렬)
        prov_frame = ttk.Frame(sec1)
        prov_frame.grid(row=0, column=0, columnspan=3, sticky=tk.W, pady=(2, 6))

        lbl_prov = ttk.Label(prov_frame, text="AI 제공자:")
        lbl_prov.pack(side=tk.LEFT, padx=(0, 10))

        self.var_provider = tk.StringVar(value="gemini")
        self.rb_prov_gemini = ttk.Radiobutton(
            prov_frame, text="Google Gemini (추천/무료)", variable=self.var_provider,
            value="gemini", command=self._on_provider_changed
        )
        self.rb_prov_gemini.pack(side=tk.LEFT, padx=(0, 14))

        self.rb_prov_openai = ttk.Radiobutton(
            prov_frame, text="OpenAI GPT", variable=self.var_provider,
            value="openai", command=self._on_provider_changed
        )
        self.rb_prov_openai.pack(side=tk.LEFT, padx=(0, 14))

        self.rb_prov_claude = ttk.Radiobutton(
            prov_frame, text="Anthropic Claude", variable=self.var_provider,
            value="claude", command=self._on_provider_changed
        )
        self.rb_prov_claude.pack(side=tk.LEFT)

        # 1-1. 모델 선택 (인증 전에는 비활성화 및 안내 문구 표시)
        self.lbl_model = ttk.Label(sec1, text="모델 선택:")
        self.lbl_model.grid(row=1, column=0, sticky=tk.W, pady=6)
        self.combo_model = ttk.Combobox(sec1, state="disabled", width=48)
        self.combo_model.grid(row=1, column=1, sticky=tk.W, padx=5, pady=6)
        self.combo_model.bind("<<ComboboxSelected>>", self._on_model_selected)

        # 1-2. API Key
        self.lbl_api_key = ttk.Label(sec1, text="Gemini Key (Google):")
        self.lbl_api_key.grid(row=2, column=0, sticky=tk.W, pady=6)
        self.entry_api_key = ttk.Entry(sec1, show="*")
        self.entry_api_key.grid(row=2, column=1, sticky=tk.EW, padx=5, pady=6)
        self.entry_api_key.bind("<KeyRelease>", self._on_api_key_input_changed)
        self.entry_api_key.bind("<<Paste>>", lambda e: self.root.after(50, self._on_api_key_input_changed))

        btn_test_key = ttk.Button(sec1, text="🔑 선택된 키 테스트", command=self._on_test_key_clicked)
        btn_test_key.grid(row=2, column=2, padx=3, pady=6)
        sec1.columnconfigure(1, weight=1)

        # [섹션 2] 번역 및 검수 대상 소스 설정 (I2 공식 시트 vs 로컬 에셋 vs 임시 시트)
        sec2 = ttk.LabelFrame(main_frame, text=" 2. 번역 및 검수 대상 소스 선택 ", padding="10")
        sec2.pack(fill=tk.X, pady=4)

        # 소스 선택 라디오버튼 (3종 세트)
        source_mode_frame = ttk.Frame(sec2)
        source_mode_frame.pack(fill=tk.X, pady=(0, 6))

        self.var_source_mode = tk.StringVar(value="i2_official")
        self.rb_mode_i2 = ttk.Radiobutton(
            source_mode_frame,
            text="📋 I2 공식 구글 시트 선택",
            variable=self.var_source_mode,
            value="i2_official",
            command=self._on_source_mode_changed
        )
        self.rb_mode_i2.pack(side=tk.LEFT, padx=(0, 10))

        self.rb_mode_local = ttk.Radiobutton(
            source_mode_frame,
            text="🎮 로컬 I2Languages.asset 직접 검수",
            variable=self.var_source_mode,
            value="local_asset",
            command=self._on_source_mode_changed
        )
        self.rb_mode_local.pack(side=tk.LEFT, padx=(0, 10))

        self.rb_mode_custom = ttk.Radiobutton(
            source_mode_frame,
            text="🌐 사용자 지정 시트 URL 직접 입력",
            variable=self.var_source_mode,
            value="custom_url",
            command=self._on_source_mode_changed
        )
        self.rb_mode_custom.pack(side=tk.LEFT)

        # [동적 컨텐츠 컨테이너]: 모드에 따라 i2_select / local_asset / url_display가 안전하게 전환됨
        self.frame_dynamic_content = ttk.Frame(sec2)
        self.frame_dynamic_content.pack(fill=tk.X, pady=2)

        # 2-A: I2 공식 시트 선택 프레임
        self.frame_i2_select = ttk.Frame(self.frame_dynamic_content)

        ttk.Label(self.frame_i2_select, text="공식 시트 선택:").pack(side=tk.LEFT, padx=(0, 5))
        self.i2_sheets_map = OFFICIAL_I2_SHEETS.copy()
        sheet_options = [f"[전체 공식 시트 일괄 검수 (총 {len(self.i2_sheets_map)}개)]"] + list(self.i2_sheets_map.keys())
        self.combo_i2_sheet = ttk.Combobox(self.frame_i2_select, values=sheet_options, state="readonly", width=42)
        self.combo_i2_sheet.pack(side=tk.LEFT, padx=3)
        self.combo_i2_sheet.bind("<<ComboboxSelected>>", self._on_i2_sheet_selected)

        btn_sync_i2 = ttk.Button(self.frame_i2_select, text="🔄 목록 동기화", command=self._on_refresh_i2_sheets)
        btn_sync_i2.pack(side=tk.LEFT, padx=5)

        # 2-B: 로컬 I2Languages.asset 파일 및 카테고리 선택 프레임
        self.frame_local_asset = ttk.Frame(self.frame_dynamic_content)

        # 로컬 에셋 1행: 파일 경로
        row_asset_file = ttk.Frame(self.frame_local_asset)
        row_asset_file.pack(fill=tk.X, pady=1)
        ttk.Label(row_asset_file, text="로컬 에셋 경로:").pack(side=tk.LEFT, padx=(0, 5))
        self.entry_local_asset = ttk.Entry(row_asset_file)
        self.entry_local_asset.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=3)
        btn_browse_asset = ttk.Button(row_asset_file, text="파일 찾기...", command=self._on_browse_local_asset)
        btn_browse_asset.pack(side=tk.LEFT, padx=3)

        # 로컬 에셋 2행: 카테고리 선택
        row_asset_cat = ttk.Frame(self.frame_local_asset)
        row_asset_cat.pack(fill=tk.X, pady=(3, 1))
        ttk.Label(row_asset_cat, text="검수 카테고리:").pack(side=tk.LEFT, padx=(0, 5))
        self.combo_local_category = ttk.Combobox(row_asset_cat, state="readonly", width=38)
        self.combo_local_category.pack(side=tk.LEFT, padx=3)
        btn_refresh_cat = ttk.Button(row_asset_cat, text="🔄 카테고리 새로고침", command=self._refresh_local_categories)
        btn_refresh_cat.pack(side=tk.LEFT, padx=3)
        lbl_local_tip = ttk.Label(row_asset_cat, text="⚡ 0.2초 초고속 파싱 (권한 불필요)", font=("Pretendard", 8), foreground="#007a3d")
        lbl_local_tip.pack(side=tk.LEFT, padx=6)

        # 2-C: 대상 시트 URL 프레임 (직접 입력 또는 자동 연결된 URL 표시)
        self.frame_url_display = ttk.Frame(self.frame_dynamic_content)

        self.lbl_target_url = ttk.Label(self.frame_url_display, text="연결된 시트 URL:")
        self.lbl_target_url.pack(side=tk.LEFT, padx=(0, 5))
        self.entry_target = ttk.Entry(self.frame_url_display)
        self.entry_target.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=3)
        self.entry_target.bind("<FocusOut>", lambda e: self._refresh_target_languages())

        # 참조 사전 프레임 (고유명사 및 캐릭터 대사 시트)
        ref_frame = ttk.Frame(sec2)
        ref_frame.pack(fill=tk.X, pady=(6, 0))

        ttk.Label(ref_frame, text="참조(선택): 고유명사:").pack(side=tk.LEFT)
        self.entry_glossary = ttk.Entry(ref_frame, width=22)
        self.entry_glossary.pack(side=tk.LEFT, padx=(3, 10))

        ttk.Label(ref_frame, text="대사 시트:").pack(side=tk.LEFT)
        self.entry_character = ttk.Entry(ref_frame, width=22)
        self.entry_character.pack(side=tk.LEFT, padx=3)

        # [섹션 2-1] 구글 서비스 계정 (Service Account) 인증 및 비공개 시트 보안
        sec2_sa = ttk.LabelFrame(main_frame, text=" 2-1. 구글 서비스 계정 키 (비공개 시트 직접 쓰기/보안) ", padding="10")
        sec2_sa.pack(fill=tk.X, pady=4)

        ttk.Label(sec2_sa, text="서비스 계정 키 (.json):").grid(row=0, column=0, sticky=tk.W, pady=2)
        self.entry_service_account = ttk.Entry(sec2_sa)
        self.entry_service_account.grid(row=0, column=1, sticky=tk.EW, padx=5, pady=2)

        btn_browse_sa = ttk.Button(sec2_sa, text="키 파일 찾기...", command=self._on_browse_service_account)
        btn_browse_sa.grid(row=0, column=2, padx=3, pady=2)

        btn_test_sa = ttk.Button(sec2_sa, text="🔒 시트 권한 테스트", command=self._on_test_service_account)
        btn_test_sa.grid(row=0, column=3, padx=3, pady=2)

        self.lbl_sa_info = ttk.Label(sec2_sa, text="💡 서비스 계정 .json 키를 선택하면 봇 이메일이 여기에 표시됩니다.", font=("Pretendard", 8), foreground="#555555")
        self.lbl_sa_info.grid(row=1, column=0, columnspan=4, sticky=tk.W, padx=5, pady=(3, 0))
        sec2_sa.columnconfigure(1, weight=1)

        # [섹션 3] 언어 및 품질 옵션
        sec3 = ttk.LabelFrame(main_frame, text=" 3. 언어 및 품질 옵션 ", padding="10")
        sec3.pack(fill=tk.X, pady=4)

        # 3-A: 타겟 언어 상단 헤더 & 컨트롤 바
        lang_top_bar = ttk.Frame(sec3)
        lang_top_bar.pack(fill=tk.X, pady=(2, 4))

        ttk.Label(lang_top_bar, text="타겟 언어:", font=("Segoe UI", 9, "bold")).pack(side=tk.LEFT, padx=(0, 8))
        btn_sel_all = ttk.Button(lang_top_bar, text="전체 선택", width=8, command=self._select_all_languages)
        btn_sel_all.pack(side=tk.LEFT, padx=2)
        btn_desel_all = ttk.Button(lang_top_bar, text="전체 해제", width=8, command=self._deselect_all_languages)
        btn_desel_all.pack(side=tk.LEFT, padx=2)

        self.btn_detect_langs = ttk.Button(lang_top_bar, text="🔄 언어 감지", width=11, command=self._refresh_target_languages)
        self.btn_detect_langs.pack(side=tk.RIGHT, padx=2)

        # 3-B: 5개씩 그리드로 배치되는 언어 체크박스 컨테이너
        self.lang_vars = {}
        self.lang_chk_container = ttk.Frame(sec3)
        self.lang_chk_container.pack(fill=tk.X, pady=(0, 2))

        # 3-C: 2줄(10개) 초과 시 표시되는 토글 버튼
        self.lang_more_btn = ttk.Button(
            sec3,
            text="▼ 언어 더보기",
            command=self._toggle_expand_languages
        )

        gate_frame = ttk.Frame(sec3)
        gate_frame.pack(fill=tk.X, pady=(5, 0))
        self.var_gate_a = tk.BooleanVar(value=True)
        ttk.Checkbutton(gate_frame, text="Gate A (태그/파라미터 즉시 검증)", variable=self.var_gate_a).pack(side=tk.LEFT, padx=(0, 15))
        self.var_mqm = tk.BooleanVar(value=True)
        ttk.Checkbutton(gate_frame, text="MQM 다면 평가 (정확성/용어/말투/문화)", variable=self.var_mqm).pack(side=tk.LEFT)

        # 동작 모드 라디오 버튼 프레임 (3단 단일 선택)
        mode_frame = ttk.LabelFrame(sec3, text=" 3. 번역 및 검수 동작 모드 선택 ")
        mode_frame.pack(fill=tk.X, pady=(6, 2), padx=2)

        self.var_operation_mode = tk.StringVar(value="fill_empty")

        rb1 = ttk.Radiobutton(
            mode_frame,
            text="⚡ [기본 모드] 비어 있는 칸만 채우기 (기존 번역 유지, 빈칸만 번역)",
            variable=self.var_operation_mode,
            value="fill_empty"
        )
        rb1.pack(anchor=tk.W, padx=8, pady=(5, 3))

        rb2 = ttk.Radiobutton(
            mode_frame,
            text="📋 [전수 검사] 전체 품질 확인만 (시트 수정 안 함 ➔ 엑셀 보고서로 오류 확인)",
            variable=self.var_operation_mode,
            value="inspect_only"
        )
        rb2.pack(anchor=tk.W, padx=8, pady=3)

        rb3 = ttk.Radiobutton(
            mode_frame,
            text="✏️ [전수 검사 + 적용] 전체 검사 후 올바른 번역 즉시 덮어쓰기 (오역 자동 교정)",
            variable=self.var_operation_mode,
            value="audit_apply"
        )
        rb3.pack(anchor=tk.W, padx=8, pady=(3, 5))

        # [버튼 영역]
        btn_frame = ttk.Frame(main_frame)
        btn_frame.pack(fill=tk.X, pady=(8, 4))

        # 1행: 메인 제어 버튼 (실행 & 실행 중지) - 눈에 가장 잘 띄고 어떤 너비에서도 절대 잘리지 않음
        row_main_btns = ttk.Frame(btn_frame)
        row_main_btns.pack(fill=tk.X, pady=(0, 4))

        self.btn_run = ttk.Button(row_main_btns, text="▶ 선택한 파이썬 파일 실행", command=self._on_run_clicked)
        self.btn_run.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 6))

        self.btn_stop = ttk.Button(row_main_btns, text="■ 실행 중지", command=self._on_stop_clicked, state=tk.DISABLED, width=14)
        self.btn_stop.pack(side=tk.RIGHT)

        # 2행: 유틸리티 버튼 (설정 저장 & 보고서 열기)
        row_sub_btns = ttk.Frame(btn_frame)
        row_sub_btns.pack(fill=tk.X)

        btn_save = ttk.Button(row_sub_btns, text="💾 설정 저장 (Save)", command=self._on_save_clicked)
        btn_save.pack(side=tk.LEFT, padx=(0, 6))

        btn_open_report = ttk.Button(row_sub_btns, text="📊 전수검사 엑셀 보고서 열기", command=self._on_open_excel_report)
        btn_open_report.pack(side=tk.LEFT, padx=(0, 6))

        self.btn_apply_excel = ttk.Button(row_sub_btns, text="⚡ 엑셀 결과 시트 즉시 반영", command=self._on_apply_excel_clicked)
        self.btn_apply_excel.pack(side=tk.LEFT)

        # [우측 패널: 실시간 실행 로그 콘솔 및 진행도 모니터]
        right_frame = ttk.LabelFrame(self.paned, text=" 📜 실시간 모니터 및 콘솔 ", padding="8")
        self.paned.add(right_frame, weight=1)

        # 1. 상단 진행도 모니터 프레임 (전체 진행도 + 단계별 번역 진행도 세분화)
        self.prog_box = ttk.LabelFrame(right_frame, text=" 📊 실시간 진행 상황 모니터 ", padding="8")
        self.prog_box.pack(fill=tk.X, pady=(0, 6))

        # (1) 전체 진행도 영역
        row_total_hdr = ttk.Frame(self.prog_box)
        row_total_hdr.pack(fill=tk.X, pady=(0, 2))

        self.lbl_status_total = ttk.Label(
            row_total_hdr,
            text="전체 진행도: 대기 중",
            font=("Pretendard", 9, "bold"),
            foreground="#1e293b"
        )
        self.lbl_status_total.pack(side=tk.LEFT)

        self.lbl_timer = ttk.Label(
            row_total_hdr,
            text="⏱️ 00:00",
            font=("Pretendard", 9, "bold"),
            foreground="#475569"
        )
        self.lbl_timer.pack(side=tk.RIGHT)

        self.progress_bar_total = ttk.Progressbar(self.prog_box, mode='determinate', maximum=100)
        self.progress_bar_total.pack(fill=tk.X, pady=(0, 6))

        # (2) 단계별 번역 진행도 영역
        row_step_hdr = ttk.Frame(self.prog_box)
        row_step_hdr.pack(fill=tk.X, pady=(0, 2))

        self.lbl_status_step = ttk.Label(
            row_step_hdr,
            text="단계별 번역 진행: 대기 중",
            font=("Pretendard", 9, "bold"),
            foreground="#2563eb"
        )
        self.lbl_status_step.pack(side=tk.LEFT)

        self.lbl_step_detail = ttk.Label(
            row_step_hdr,
            text="",
            font=("Pretendard", 8),
            foreground="#64748b"
        )
        self.lbl_step_detail.pack(side=tk.RIGHT)

        self.progress_bar_step = ttk.Progressbar(self.prog_box, mode='determinate', maximum=100)
        self.progress_bar_step.pack(fill=tk.X, pady=(0, 2))

        # 이전 코드 호환성용 참조 매핑
        self.lbl_status = self.lbl_status_step
        self.progress_bar = self.progress_bar_step

        # 2. 콘솔 상단 툴바 (지우기 / 복사 버튼)
        log_toolbar = ttk.Frame(right_frame)
        log_toolbar.pack(fill=tk.X, pady=(2, 4))

        ttk.Label(log_toolbar, text="실시간 출력 화면:", font=("Pretendard", 9, "bold"), foreground="#475569").pack(side=tk.LEFT)

        btn_copy = ttk.Button(log_toolbar, text="📋 전체 복사", command=self._on_copy_log, width=11)
        btn_copy.pack(side=tk.RIGHT, padx=2)

        btn_clear = ttk.Button(log_toolbar, text="🧹 지우기", command=self._on_clear_log, width=9)
        btn_clear.pack(side=tk.RIGHT, padx=2)

        log_container = ttk.Frame(right_frame)
        log_container.pack(fill=tk.BOTH, expand=True)

        scrollbar_y = ttk.Scrollbar(log_container, orient=tk.VERTICAL)
        scrollbar_x = ttk.Scrollbar(log_container, orient=tk.HORIZONTAL)

        self.txt_log = tk.Text(
            log_container,
            state=tk.DISABLED,
            bg="#1e1e1e",
            fg="#e2e8f0",
            font=("Consolas", 10),
            wrap=tk.WORD,
            yscrollcommand=scrollbar_y.set,
            xscrollcommand=scrollbar_x.set
        )
        scrollbar_y.config(command=self.txt_log.yview)
        scrollbar_x.config(command=self.txt_log.xview)

        self.txt_log.grid(row=0, column=0, sticky="nsew")
        scrollbar_y.grid(row=0, column=1, sticky="ns")
        scrollbar_x.grid(row=1, column=0, sticky="ew")
        log_container.grid_rowconfigure(0, weight=1)
        log_container.grid_columnconfigure(0, weight=1)

        # 좌우 분할 스플리터 (PanedWindow) 위치 설정 및 사용자 조절 크기 영속화
        def _apply_initial_sash(event=None):
            try:
                self.root.update_idletasks()
                win_w = self.root.winfo_width()
                saved_sash = self.config.get("paned_sash_position", 680)
                if not isinstance(saved_sash, int) or saved_sash < 450:
                    saved_sash = max(680, int(win_w * 0.46)) if win_w > 500 else 680

                if win_w > 900:
                    target_sash = min(saved_sash, win_w - 400)
                else:
                    target_sash = saved_sash
                target_sash = max(550, target_sash)
                self.paned.sashpos(0, target_sash)
            except Exception:
                pass

        self.root.after(50, _apply_initial_sash)
        self.root.after(150, _apply_initial_sash)
        self.root.after(400, _apply_initial_sash)

        # 사용자가 마우스로 스플리터를 드래그하여 조절했을 때 실시간 위치 기억
        def _on_sash_drag_end(event=None):
            try:
                pos = self.paned.sashpos(0)
                if pos > 450:
                    self.config["paned_sash_position"] = pos
            except Exception:
                pass

        self.paned.bind("<ButtonRelease-1>", _on_sash_drag_end)

    def _on_clear_log(self):
        """로그 창 비우기"""
        self.txt_log.config(state=tk.NORMAL)
        self.txt_log.delete("1.0", tk.END)
        self.txt_log.config(state=tk.DISABLED)

    def _on_copy_log(self):
        """전체 로그 클립보드 복사"""
        content = self.txt_log.get("1.0", tk.END).strip()
        if content:
            self.root.clipboard_clear()
            self.root.clipboard_append(content)
            messagebox.showinfo("복사 완료", "로그 내용이 클립보드에 복사되었습니다.")

    def _sync_model_state(self):
        """현재 선택된 AI 제공자의 키 인증 여부에 따라 모델 드롭다운 활성/비활성화 제어"""
        curr_p = self.var_provider.get()
        is_verified = self.verified_providers.get(curr_p, False)
        models_for_p = PROVIDER_MODEL_MAP.get(curr_p, GEMINI_DEFAULT_MODELS)

        if is_verified:
            # 인증 완료: 모델 선택 가능 (readonly)
            self.combo_model.configure(state="readonly")
            self.combo_model["values"] = models_for_p
            saved_m = self.provider_models.get(curr_p, "")
            if saved_m and not saved_m.startswith("🔒") and (saved_m in models_for_p or any(saved_m.split()[0] in m for m in models_for_p)):
                self.combo_model.set(saved_m)
            else:
                self.combo_model.current(0)
            self.lbl_model.config(text="모델 선택:")
        else:
            # 인증 전: 비활성화 및 안내 문구 노출 (disabled)
            lock_msg = "🔒 [인증 필요] 아래 '🔑 선택된 키 테스트'를 먼저 완료해주세요"
            self.combo_model.configure(state="normal")
            self.combo_model["values"] = [lock_msg]
            self.combo_model.set(lock_msg)
            self.combo_model.configure(state="disabled")
            self.lbl_model.config(text="모델 선택 (🔒):")

    def _on_provider_changed(self):
        """AI 제공자(Gemini, OpenAI, Claude) 전환 처리"""
        old_p = getattr(self, "_active_provider", "gemini")
        curr_key = self.entry_api_key.get().strip()
        if curr_key:
            if curr_key.startswith("ENC:"):
                curr_key = decrypt_api_key(curr_key)
            self.provider_keys[old_p] = curr_key
        curr_m = self.combo_model.get().strip()
        if curr_m and not curr_m.startswith("🔒"):
            self.provider_models[old_p] = curr_m

        new_p = self.var_provider.get()
        self._active_provider = new_p

        # 라벨 및 키 입력창 갱신
        self.lbl_api_key.config(text=PROVIDER_LABELS.get(new_p, "API Key:"))
        self.entry_api_key.delete(0, tk.END)
        saved_key = self.provider_keys.get(new_p, "")
        if saved_key:
            self.entry_api_key.insert(0, saved_key)

        # 모델 드롭다운 상태 동기화 (인증 여부에 따라 활성/비활성 전환)
        self._sync_model_state()

        p_name = PROVIDER_DISPLAY_NAMES.get(new_p, new_p)
        self.log(f"🤖 [제공자 전환] {p_name} 선택됨")
        self._on_save_clicked(silent=True)

    def _on_model_selected(self, event=None):
        """모델 드롭다운 선택 시 해당 제공자의 선택 모델로 저장"""
        curr_p = self.var_provider.get()
        val = self.combo_model.get().strip()
        if val and not val.startswith("🔒"):
            self.provider_models[curr_p] = val
            self._on_save_clicked(silent=True)

    def _on_api_key_input_changed(self, event=None):
        """API 키 입력 시 현재 제공자에 보관하며, 타 제공자 키 서명 감지 시 제공자 자동 전환"""
        raw_key = self.entry_api_key.get().strip()
        if raw_key.startswith("ENC:"):
            raw_key = decrypt_api_key(raw_key)

        curr_p = self.var_provider.get()
        if not raw_key:
            self.provider_keys[curr_p] = ""
            if self.verified_providers.get(curr_p, False):
                self.verified_providers[curr_p] = False
                self._sync_model_state()
            return

        # 다른 제공자의 시그니처가 명확히 감지되는 경우 자동 전환
        detected_p = detect_api_key_provider(raw_key)
        has_explicit_sig = ("sk-ant-" in raw_key) or ("sk-" in raw_key and "sk-ant-" not in raw_key) or ("AIzaSy" in raw_key) or raw_key.startswith("AQ.")
        if has_explicit_sig and detected_p != curr_p:
            self.provider_keys[detected_p] = raw_key
            self.var_provider.set(detected_p)
            self._on_provider_changed()
            return

        # 키 내용이 변경되면 미인증 상태로 전환하여 재인증 유도
        if self.provider_keys.get(curr_p, "") != raw_key:
            self.provider_keys[curr_p] = raw_key
            self.verified_providers[curr_p] = False
            self._sync_model_state()

    def _on_test_key_clicked(self):
        """현재 선택된 제공자의 API 키를 테스트하고, 성공 시 영구 저장"""
        provider = self.var_provider.get()
        raw_key = self.entry_api_key.get().strip()
        if raw_key.startswith("ENC:"):
            raw_key = decrypt_api_key(raw_key)

        import re
        gemini_match = re.search(r"(?:AIzaSy[A-Za-z0-9_\-]{33}|AQ\.[A-Za-z0-9_\-]{20,})", raw_key)
        claude_match = re.search(r"sk-ant-[A-Za-z0-9_\-]{20,}", raw_key)
        openai_match = re.search(r"sk-[A-Za-z0-9_\-]{20,}", raw_key)

        if provider == "gemini" and gemini_match:
            key = gemini_match.group(0)
            self.entry_api_key.delete(0, tk.END)
            self.entry_api_key.insert(0, key)
        elif provider == "claude" and claude_match:
            key = claude_match.group(0)
            self.entry_api_key.delete(0, tk.END)
            self.entry_api_key.insert(0, key)
        elif provider == "openai" and openai_match:
            key = openai_match.group(0)
            self.entry_api_key.delete(0, tk.END)
            self.entry_api_key.insert(0, key)
        else:
            key = "".join(raw_key.split())  # 제어문자 제거
            if any(ord(c) < 32 or ord(c) > 126 for c in key):
                messagebox.showerror("키 형식 오류", "API Key에 잘못된 문자(한글, 줄바꿈 등)가 들어가 있습니다.")
                return

        p_name = PROVIDER_DISPLAY_NAMES.get(provider, provider)
        if not key:
            messagebox.showwarning("입력 필요", f"{p_name} API Key를 먼저 입력해주세요.")
            return

        self.provider_keys[provider] = key

        # 테스트에 사용할 모델 (잠금 상태일 경우 제공자의 대표 기본 모델 사용)
        curr_m = self.combo_model.get().strip()
        models_for_p = PROVIDER_MODEL_MAP.get(provider, GEMINI_DEFAULT_MODELS)
        saved_m = self.provider_models.get(provider, "")
        if curr_m and not curr_m.startswith("🔒"):
            model = curr_m
        elif saved_m and not saved_m.startswith("🔒"):
            model = saved_m
        else:
            model = models_for_p[0]

        self.log("=" * 60)
        self.log(f"[API 키 테스트 시작] {p_name} ({model}) 연결 확인 중...")

        def test_thread():
            if provider == "gemini":
                success, msg, discovered_models = test_gemini_key(key, model)
            elif provider == "claude":
                success, msg = test_claude_key(key, model)
                discovered_models = []
            else:
                success, msg = test_openai_key(key, model)
                discovered_models = []

            if success:
                self.verified_providers[provider] = True
                self.log(f"✅ {msg}")
                if provider == "gemini" and discovered_models:
                    model_vals = [AUTO_MODEL_LABEL] + [f"{m} (실시간 감지)" for m in discovered_models[:8]]
                    PROVIDER_MODEL_MAP["gemini"] = model_vals
                    self.log(f"📋 [모델 자동 갱신] 구글 API에서 현재 사용 가능한 {len(discovered_models)}개 최신 모델 목록 갱신 완료!")

                self.root.after(0, self._sync_model_state)
                self.root.after(0, lambda: self._on_save_clicked(silent=True))
                self.log(f"💾 [자동 저장] 인증된 {p_name} API 키가 config.json에 안전하게 저장되었습니다.")
                messagebox.showinfo("API 키 인증 성공", f"성공적으로 연결되었습니다!\n\n{msg}\n\n(키가 config.json에 자동 저장되었습니다)")
            else:
                self.verified_providers[provider] = False
                self.root.after(0, self._sync_model_state)
                self.log(f"❌ {msg}")
                messagebox.showerror("API 키 인증 실패", f"키 인증에 실패했습니다.\n\n{msg}")

        threading.Thread(target=test_thread, daemon=True).start()

    def _update_model_dropdown(self, values: list[str]):
        if not self.verified_providers.get(self.var_provider.get(), False):
            return
        curr = self.combo_model.get()
        self.combo_model["values"] = values
        if curr in values:
            self.combo_model.set(curr)
        elif any(curr.split()[0] in v for v in values if curr):
            matched = [v for v in values if curr.split()[0] in v]
            self.combo_model.set(matched[0])
        else:
            self.combo_model.current(0)

    def _on_browse_file(self):
        initial_dir = os.path.dirname(os.path.abspath(__file__))
        selected_file = filedialog.askopenfilename(
            title="실행할 파이썬 스크립트 선택",
            initialdir=initial_dir,
            filetypes=[("Python Files (*.py)", "*.py"), ("All Files (*.*)", "*.*")]
        )
        if selected_file:
            self.entry_script_path.delete(0, tk.END)
            self.entry_script_path.insert(0, selected_file)
            self._on_save_clicked(silent=True)

    def _on_browse_service_account(self):
        initial_dir = os.path.dirname(os.path.abspath(__file__))
        selected = filedialog.askopenfilename(
            title="구글 서비스 계정 JSON 키 파일 선택",
            initialdir=initial_dir,
            filetypes=[("JSON Files (*.json)", "*.json"), ("All Files (*.*)", "*.*")]
        )
        if selected:
            self.entry_service_account.delete(0, tk.END)
            self.entry_service_account.insert(0, selected)
            self._update_sa_email_label(selected)
            self._on_save_clicked(silent=True)

    def _update_sa_email_label(self, json_path):
        if json_path and os.path.exists(json_path):
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    email = data.get("client_email", "")
                    if email:
                        self.lbl_sa_info.config(
                            text=f"🔑 봇 이메일: {email}\n👉 구글 시트의 [공유] 메뉴에서 이 이메일을 [편집자]로 추가하세요!",
                            foreground="#2058ad"
                        )
                        return
            except Exception:
                pass
        self.lbl_sa_info.config(text="💡 서비스 계정 .json 키를 선택하면 봇 이메일이 여기에 표시됩니다.", foreground="#555555")

    def _on_test_service_account(self):
        json_path = self.entry_service_account.get().strip()
        if not json_path or not os.path.exists(json_path):
            messagebox.showwarning("키 파일 필요", "서비스 계정 .json 키 파일 경로를 먼저 선택해주세요.")
            return

        # 선택된 .json 파일에서 실제 서비스 계정 이메일 동적 추출
        current_bot_email = ""
        try:
            with open(json_path, "r", encoding="utf-8") as jf:
                current_bot_email = json.load(jf).get("client_email", "")
        except Exception:
            pass

        # 현재 모드에 맞게 테스트할 시트 URL 동적 결정
        mode = self.var_source_mode.get()
        target_url = ""
        target_name = ""

        if mode == "i2_official":
            selected_name = self.combo_i2_sheet.get()
            sheet_key = ""
            if selected_name in self.i2_sheets_map:
                sheet_key = self.i2_sheets_map[selected_name]
                target_name = selected_name
            elif self.i2_sheets_map:
                # 전체 일괄 선택인 경우 첫 번째 공식 시트로 연결 테스트
                target_name = list(self.i2_sheets_map.keys())[0]
                sheet_key = list(self.i2_sheets_map.values())[0]
            if sheet_key:
                target_url = get_sheet_url(sheet_key)
        elif mode == "local_asset":
            messagebox.showinfo("로컬 에셋 모드", "로컬 에셋 모드는 Unity I2Languages.asset 파일을 직접 읽으므로 구글 서비스 계정 인증이 필요 없습니다.")
            return
        else:
            target_url = self.entry_target.get().strip()
            target_name = "사용자 지정 시트"

        if not target_url:
            messagebox.showwarning("시트 URL 필요", "테스트할 대상 시트 URL 또는 I2 공식 시트를 먼저 선택해주세요.")
            return

        self.log("=" * 65)
        self.log(f"[서비스 계정 검증] {json_path}")
        if current_bot_email:
            self.log(f"🔑 서비스 계정 이메일: {current_bot_email}")
        self.log(f"📄 테스트 대상 시트: {target_name} ({target_url}) 권한 확인 중...")

        try:
            try:
                import gspread
                from google.oauth2.service_account import Credentials
            except ModuleNotFoundError:
                self.log("[패키지 설치] gspread 패키지를 현재 파이썬 환경에 자동 설치 중...")
                import subprocess
                subprocess.check_call([sys.executable, "-m", "pip", "install", "gspread", "google-auth"])
                import gspread
                from google.oauth2.service_account import Credentials

            scopes = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
            creds = Credentials.from_service_account_file(json_path, scopes=scopes)
            client = gspread.authorize(creds)
            sheet = client.open_by_url(target_url)
            self.log(f"✅ [서비스 계정 인증 성공] 시트명: '{sheet.title}' 접근 및 쓰기 권한 확인 완료!")
            messagebox.showinfo("시트 접근 성공", f"비공개 시트 연결에 성공했습니다!\n\n시트 제목: '{sheet.title}'\n워크시트: {len(sheet.worksheets())}개\n인증 계정: {current_bot_email or '인증 완료'}")
        except Exception as e:
            err_text = str(e)
            if hasattr(e, 'response') and hasattr(e.response, 'text'):
                err_text = e.response.text
            self.log(f"❌ [서비스 계정 인증 실패] {err_text}")
            if "Google Sheets API has not been used" in err_text or "is disabled" in err_text:
                msg = "Google Sheets API가 클라우드 콘솔에서 활성화(사용 설정)되어 있지 않습니다.\n\n구글 콘솔에서 [사용] 버튼을 눌러주세요."
            elif "The caller does not have permission" in err_text or "PermissionError" in type(e).__name__:
                target_email = current_bot_email or "선택하신 서비스 계정의 client_email"
                msg = f"시트에 접근할 권한이 없습니다.\n\n구글 시트 우측 상단 [공유] 메뉴에서 아래 서비스 계정 이메일을 [편집자]로 등록해주세요:\n\n{target_email}"
            else:
                msg = f"인증 오류:\n{err_text}"
            messagebox.showerror("시트 접근 실패", msg)

    def _load_values_to_ui(self):
        default_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "main.py")
        self.entry_script_path.insert(0, self.config.get("selected_script_path", default_script))
        self.entry_script_args.insert(0, self.config.get("script_args", ""))

        # 다중 제공자 API 키 로드
        self.provider_keys["gemini"] = self.config.get("gemini_api_key", "")
        self.provider_keys["openai"] = self.config.get("openai_api_key", "")
        self.provider_keys["claude"] = self.config.get("claude_api_key", "")

        legacy_key = self.config.get("api_key", "").strip()
        if legacy_key:
            p = detect_api_key_provider(legacy_key)
            if not self.provider_keys.get(p):
                self.provider_keys[p] = legacy_key

        # 제공자별 모델 로드
        self.provider_models["gemini"] = self.config.get("gemini_model", AUTO_MODEL_LABEL)
        self.provider_models["openai"] = self.config.get("openai_model", OPENAI_DEFAULT_MODELS[0])
        self.provider_models["claude"] = self.config.get("claude_model", CLAUDE_DEFAULT_MODELS[0])

        active_provider = self.config.get("active_llm_provider", "gemini")
        if active_provider not in ["gemini", "openai", "claude"]:
            active_provider = "gemini"
        self.var_provider.set(active_provider)
        self._active_provider = active_provider

        # 활성 제공자의 UI 상태 반영
        self.lbl_api_key.config(text=PROVIDER_LABELS.get(active_provider, "API Key:"))
        self.entry_api_key.delete(0, tk.END)
        self.entry_api_key.insert(0, self.provider_keys.get(active_provider, ""))

        # 인증 상태 복원
        saved_verified = self.config.get("verified_providers", {})
        for p in ["gemini", "openai", "claude"]:
            self.verified_providers[p] = bool(saved_verified.get(p, False))

        # 기존 호환성: saved_verified에 정보가 없고 유효한 gemini_api_key가 이미 설정되어 있는 경우 기본 인증 유지
        if not any(saved_verified.values()) and self.provider_keys.get("gemini"):
            self.verified_providers["gemini"] = True

        # 모델 드롭다운 상태 동기화 (인증 여부에 따라 활성/비활성화)
        self._sync_model_state()

        self.entry_glossary.insert(0, self.config.get("glossary_sheet_url", ""))
        source_mode = self.config.get("target_source_mode", "i2_official")
        self.var_source_mode.set(source_mode)

        local_path = self.config.get("local_i2_asset_path") or get_default_local_i2_asset_path()
        self.entry_local_asset.delete(0, tk.END)
        self.entry_local_asset.insert(0, local_path)
        if source_mode == "local_asset":
            self._refresh_local_categories()
        else:
            self.combo_local_category['values'] = ["[전체]"]
            self.combo_local_category.current(0)

        selected_i2 = self.config.get("i2_selected_sheet", "I2Loc 던전슬래셔 스킬 번역")
        if selected_i2 in self.combo_i2_sheet['values']:
            self.combo_i2_sheet.set(selected_i2)
        elif len(self.combo_i2_sheet['values']) > 1:
            self.combo_i2_sheet.current(1)

        target_url = self.config.get("target_sheet_url", "")
        self.entry_target.delete(0, tk.END)
        self.entry_target.insert(0, target_url)

        self._on_source_mode_changed(trigger_refresh=False)

        sa_path = self.config.get("service_account_json_path", "")
        self.entry_service_account.insert(0, sa_path)
        self._update_sa_email_label(sa_path)

        # 1단계: 캐시 또는 기본 언어로 UI 체크박스를 즉시 렌더링 (< 0.01초 빠른 창 노출)
        cached_detected = self.config.get("cached_detected_languages", None)
        if not cached_detected:
            cached_detected = [
                {"code": "ENG", "label": "ENG (영어)"},
                {"code": "JPN", "label": "JPN (일본어)"},
                {"code": "CHS", "label": "CHS (중국어 간체)"},
                {"code": "CHT", "label": "CHT (중국어 번체)"},
                {"code": "SPA", "label": "SPA (스페인어)"},
                {"code": "GER", "label": "GER (독일어)"}
            ]
        self._apply_detected_languages(cached_detected, initial_load=True)
        target_langs = self.config.get("target_languages", ["ENG", "JPN", "CHS", "CHT", "SPA"])
        for code, var in self.lang_vars.items():
            var.set(code in target_langs)

        # 2단계: 백그라운드 스레드로 시트/에셋 언어 비동기 감지 (UI 지연 제로)
        self._refresh_target_languages(initial_load=True, async_detect=True)

        self.var_gate_a.set(self.config.get("enable_gate_a", True))
        self.var_mqm.set(self.config.get("enable_mqm", True))
        
        op_mode = self.config.get("operation_mode")
        if not op_mode:
            if not self.config.get("full_audit_mode", False):
                op_mode = "fill_empty"
            elif self.config.get("audit_apply_changes", False):
                op_mode = "audit_apply"
            else:
                op_mode = "inspect_only"
        self.var_operation_mode.set(op_mode)

    def _on_browse_local_asset(self):
        curr = self.entry_local_asset.get().strip()
        initial_dir = os.path.dirname(curr) if (curr and os.path.exists(curr)) else os.path.dirname(os.path.abspath(__file__))
        selected = filedialog.askopenfilename(
            title="Unity I2Languages.asset 파일 선택",
            initialdir=initial_dir,
            filetypes=[("Unity Asset (*.asset)", "*.asset"), ("All Files (*.*)", "*.*")]
        )
        if selected:
            self.entry_local_asset.delete(0, tk.END)
            self.entry_local_asset.insert(0, selected)
            self._refresh_local_categories()
            self._refresh_target_languages()
            self._on_save_clicked(silent=True)

    def _select_all_languages(self):
        """모든 타겟 언어 체크박스를 선택합니다."""
        for var in self.lang_vars.values():
            var.set(True)

    def _deselect_all_languages(self):
        """모든 타겟 언어 체크박스를 선택 해제합니다."""
        for var in self.lang_vars.values():
            var.set(False)

    def _toggle_expand_languages(self):
        """2줄 초과 언어 체크박스 표시를 토글합니다."""
        self.is_lang_expanded = not self.is_lang_expanded
        for chk, row, col in self.extra_lang_widgets:
            if self.is_lang_expanded:
                chk.grid(row=row, column=col, sticky=tk.W, padx=6, pady=2)
            else:
                chk.grid_remove()
        extra_count = len(self.extra_lang_widgets)
        btn_text = f"▲ 언어 접기 ({extra_count}개)" if self.is_lang_expanded else f"▼ 언어 더보기 (+{extra_count}개)"
        self.lang_more_btn.config(text=btn_text)

    def _apply_detected_languages(self, detected: list, initial_load: bool = False, done_btn: bool = False):
        """감지된 언어 목록을 UI 체크박스로 렌더링하고 선택 상태를 복원합니다."""
        self.is_detecting_langs = False
        if done_btn and hasattr(self, "btn_detect_langs"):
            self.btn_detect_langs.config(text="🔄 언어 감지", state=tk.NORMAL)
        if hasattr(self, "btn_run") and not getattr(self, "current_process", None):
            self.btn_run.config(state=tk.NORMAL, text="▶ 선택한 파이썬 파일 실행")

        if not detected:
            return

        current_checked = {code: var.get() for code, var in self.lang_vars.items()}
        if not current_checked:
            cfg_langs = self.config.get("target_languages", ["ENG", "JPN", "CHS", "CHT", "SPA"])
            current_checked = {c: True for c in cfg_langs}

        if hasattr(self, "lang_chk_container"):
            for widget in self.lang_chk_container.winfo_children():
                widget.destroy()

        self.lang_vars = {}
        self.extra_lang_widgets = []
        for idx, item in enumerate(detected):
            code = item["code"]
            label = item["label"]
            is_on = current_checked.get(code, code in self.config.get("target_languages", []))
            var = tk.BooleanVar(value=is_on)
            self.lang_vars[code] = var
            chk = ttk.Checkbutton(self.lang_chk_container, text=label, variable=var)

            row = idx // 5
            col = idx % 5
            chk.grid(row=row, column=col, sticky=tk.W, padx=6, pady=2)

            if row >= 2:
                self.extra_lang_widgets.append((chk, row, col))
                if not self.is_lang_expanded:
                    chk.grid_remove()

        for c in range(5):
            self.lang_chk_container.columnconfigure(c, weight=1)

        extra_count = len(self.extra_lang_widgets)
        if extra_count > 0:
            btn_text = f"▲ 언어 접기 ({extra_count}개)" if self.is_lang_expanded else f"▼ 언어 더보기 (+{extra_count}개)"
            self.lang_more_btn.config(text=btn_text)
            self.lang_more_btn.pack(anchor=tk.W, padx=6, pady=(1, 4))
        else:
            self.lang_more_btn.pack_forget()

        if not initial_load and hasattr(self, "log"):
            self.log(f"🌐 [언어 동적 감지] 총 {len(detected)}개 언어 활성화 ({', '.join(d['code'] for d in detected)})")

    def _refresh_target_languages(self, initial_load: bool = False, async_detect: bool = True):
        """에셋 파일 또는 구글 시트에서 언어 목록을 비동기(기본값) 또는 동기로 감지하여 갱신합니다."""
        mode = self.var_source_mode.get() if hasattr(self, 'var_source_mode') else "custom_url"
        
        if mode == "i2_official":
            selected_name = self.combo_i2_sheet.get().strip() if hasattr(self, 'combo_i2_sheet') else ""
            sheet_key = ""
            sheets_map = getattr(self, "i2_sheets_map", OFFICIAL_I2_SHEETS)
            if selected_name in sheets_map:
                sheet_key = sheets_map[selected_name]
            else:
                for k, v in sheets_map.items():
                    if "전체" not in k and v:
                        sheet_key = v
                        break
            target_url = get_sheet_url(sheet_key) if sheet_key else ""
        else:
            target_url = self.entry_target.get().strip() if hasattr(self, 'entry_target') else ""
            if not target_url:
                target_url = self.config.get("target_sheet_url", "")

        sa_path = self.entry_service_account.get().strip() if hasattr(self, 'entry_service_account') else ""
        if not sa_path:
            sa_path = self.config.get("service_account_json_path", "")

        cfg_for_detect = {
            "target_sheet_url": target_url,
            "service_account_json_path": sa_path,
            "local_i2_asset_path": self.entry_local_asset.get().strip() if hasattr(self, 'entry_local_asset') else "",
            "i2_web_service_url": DEFAULT_WEB_SERVICE_URL,
            "current_sheet_name": self.combo_i2_sheet.get().strip() if hasattr(self, 'combo_i2_sheet') else "",
            "i2_sheets": getattr(self, "i2_sheets_map", OFFICIAL_I2_SHEETS)
        }

        self.is_detecting_langs = True
        if hasattr(self, "btn_detect_langs"):
            self.btn_detect_langs.config(text="⏳ 감지 중...", state=tk.DISABLED)
        if hasattr(self, "btn_run") and not getattr(self, "current_process", None):
            self.btn_run.config(state=tk.DISABLED, text="⏳ 언어 감지 중 (잠시 대기)...")

        if not async_detect:
            try:
                detected = detect_available_target_languages(mode, cfg_for_detect)
                if detected:
                    self.config["cached_detected_languages"] = detected
            except Exception:
                detected = []
            self._apply_detected_languages(detected, initial_load=initial_load, done_btn=True)
            return

        def _worker():
            try:
                detected = detect_available_target_languages(mode, cfg_for_detect)
                if detected:
                    self.config["cached_detected_languages"] = detected
            except Exception:
                detected = []
            if hasattr(self, "root") and self.root.winfo_exists():
                self.root.after(0, lambda: self._apply_detected_languages(detected, initial_load=initial_load, done_btn=True))

        threading.Thread(target=_worker, daemon=True).start()

    def _refresh_local_categories(self):
        asset_path = self.entry_local_asset.get().strip() or get_default_local_i2_asset_path()
        if not asset_path or not os.path.exists(asset_path):
            self.combo_local_category['values'] = ["[전체] (에셋 파일 없음)"]
            self.combo_local_category.current(0)
            return

        cat_list = get_local_i2_categories(asset_path)
        total_terms = sum(cnt for _, cnt in cat_list)
        options = [f"[전체 카테고리 일괄 검수 (시트별 개별 탭 생성 - 총 {total_terms:,}개)]"]
        for cat_name, cnt in cat_list:
            options.append(f"{cat_name} ({cnt:,}개)")

        self.combo_local_category['values'] = options
        
        current_cat = self.config.get("local_i2_category", "전체")
        matched_idx = 0
        if current_cat in ("전체", "[전체]", "ALL", "all", ""):
            matched_idx = 0
        else:
            for idx, opt in enumerate(options):
                if opt.startswith(current_cat + " ") or opt == current_cat:
                    matched_idx = idx
                    break
        self.combo_local_category.current(matched_idx)

    def _get_selected_category_name(self) -> str:
        raw = self.combo_local_category.get().strip()
        if not raw or "전체" in raw:
            return "전체"
        return raw.split(" ")[0].strip()

    def _on_source_mode_changed(self, trigger_refresh: bool = True):
        mode = self.var_source_mode.get()

        # 모든 동적 프레임 언팩 (컨테이너 내 초기화)
        self.frame_i2_select.pack_forget()
        self.frame_local_asset.pack_forget()
        self.frame_url_display.pack_forget()

        if mode == "i2_official":
            self.frame_i2_select.pack(fill=tk.X, pady=2)
            self.combo_i2_sheet.configure(state="readonly")
            self._update_sa_email_label(self.entry_service_account.get().strip())
        elif mode == "local_asset":
            self.frame_local_asset.pack(fill=tk.X, pady=2)
            self._refresh_local_categories()
            self.lbl_sa_info.config(
                text="⚡ [로컬 에셋 모드] Unity 로컬 데이터를 직접 읽어오므로 구글 서비스 계정 및 공유 권한 설정이 필요 없습니다.",
                foreground="#007a3d"
            )
        else:
            self.frame_url_display.pack(fill=tk.X, pady=(4, 2))
            self.lbl_target_url.config(text="사용자 지정 시트 URL:")
            self._update_sa_email_label(self.entry_service_account.get().strip())

        if trigger_refresh:
            self._refresh_target_languages(async_detect=True)

    def _on_i2_sheet_selected(self, event=None):
        self._refresh_target_languages()

    def _on_refresh_i2_sheets(self):
        self.log("[I2 동기화] Google Web Service에서 최신 I2 스프레드시트 목록을 조회합니다...")
        try:
            live_sheets = fetch_live_i2_sheets()
            if live_sheets:
                self.i2_sheets_map = live_sheets
                new_options = [f"[전체 공식 시트 일괄 검수 (총 {len(self.i2_sheets_map)}개)]"] + list(self.i2_sheets_map.keys())
                self.combo_i2_sheet['values'] = new_options
                self.log(f"[I2 동기화 완료] 총 {len(live_sheets)}개의 최신 공식 시트 목록을 성공적으로 갱신했습니다!")
                messagebox.showinfo("I2 시트 동기화 완료", f"총 {len(live_sheets)}개의 I2 공식 스프레드시트 목록을 갱신했습니다.")
        except Exception as e:
            self.log(f"[I2 동기화 실패] {e}")
            messagebox.showwarning("동기화 실패", f"I2 웹서비스 조회 중 오류가 발생했습니다: {e}")

    def _on_audit_toggle(self):
        pass

    def _get_current_ui_config(self) -> dict:
        curr_p = self.var_provider.get()
        current_input_key = self.entry_api_key.get().strip()
        if current_input_key:
            if current_input_key.startswith("ENC:"):
                current_input_key = decrypt_api_key(current_input_key)
            self.provider_keys[curr_p] = current_input_key
        curr_m = self.combo_model.get().strip()
        if curr_m and not curr_m.startswith("🔒"):
            self.provider_models[curr_p] = curr_m

        active_model = self.provider_models.get(curr_p, "")
        if not active_model or active_model.startswith("🔒"):
            active_model = PROVIDER_MODEL_MAP.get(curr_p, GEMINI_DEFAULT_MODELS)[0]

        selected_langs = [code for code, var in self.lang_vars.items() if var.get()]
        curr_geom = self.root.geometry()
        if not curr_geom or curr_geom.startswith("1x1") or "x" not in curr_geom:
            curr_geom = self.config.get("window_geometry", "")

        curr_sash = self.config.get("paned_sash_position", 700)
        try:
            val = self.paned.sashpos(0)
            if val > 150:
                curr_sash = val
        except Exception:
            pass

        op_mode = self.var_operation_mode.get() if hasattr(self, 'var_operation_mode') else "fill_empty"
        is_full_audit = (op_mode != "fill_empty")
        audit_apply = (op_mode == "audit_apply")

        return {
            "selected_script_path": self.entry_script_path.get().strip(),
            "script_args": self.entry_script_args.get().strip(),
            "active_llm_provider": curr_p,
            "verified_providers": self.verified_providers.copy(),
            "api_key": self.provider_keys.get(curr_p, ""),
            "gemini_api_key": self.provider_keys.get("gemini", ""),
            "openai_api_key": self.provider_keys.get("openai", ""),
            "claude_api_key": self.provider_keys.get("claude", ""),
            "gemini_model": self.provider_models.get("gemini", AUTO_MODEL_LABEL),
            "openai_model": self.provider_models.get("openai", OPENAI_DEFAULT_MODELS[0]),
            "claude_model": self.provider_models.get("claude", CLAUDE_DEFAULT_MODELS[0]),
            "model": active_model,
            "target_source_mode": self.var_source_mode.get(),
            "local_i2_asset_path": self.entry_local_asset.get().strip(),
            "local_i2_category": self._get_selected_category_name(),
            "i2_selected_sheet": self.combo_i2_sheet.get(),
            "glossary_sheet_url": self.entry_glossary.get().strip(),
            "character_sheet_url": self.entry_character.get().strip(),
            "target_sheet_url": self.entry_target.get().strip(),
            "service_account_json_path": self.entry_service_account.get().strip(),
            "target_languages": selected_langs,
            "enable_gate_a": self.var_gate_a.get(),
            "enable_mqm": self.var_mqm.get(),
            "operation_mode": op_mode,
            "full_audit_mode": is_full_audit,
            "audit_apply_changes": audit_apply,
            "write_scores_to_sheet": False,
            "window_geometry": curr_geom,
            "paned_sash_position": curr_sash,
            "mqm_threshold": 9.0,
            "max_retry_attempts": 3
        }

    def _on_save_clicked(self, silent=False):
        cfg = self._get_current_ui_config()
        if save_config(cfg) and not silent:
            messagebox.showinfo("저장 완료", "설정 및 선택한 파일 경로가 config.json에 저장되었습니다.")

    def log(self, message: str):
        self.txt_log.config(state=tk.NORMAL)
        self.txt_log.insert(tk.END, message + "\n")
        self.txt_log.see(tk.END)
        self.txt_log.config(state=tk.DISABLED)

    def _on_run_clicked(self):
        if getattr(self, "is_detecting_langs", False):
            messagebox.showwarning(
                "언어 감지 진행 중",
                "현재 시트 1행의 언어 목록을 감지하는 중입니다.\n\n감지가 완료된 후 다시 실행해주세요."
            )
            return

        cfg = self._get_current_ui_config()
        save_config(cfg)

        curr_p = cfg.get("active_llm_provider", "gemini")
        p_name = PROVIDER_DISPLAY_NAMES.get(curr_p, curr_p)
        if not self.verified_providers.get(curr_p, False):
            messagebox.showerror(
                "API 키 인증 필요",
                f"현재 선택된 [{p_name}]의 API 키가 아직 인증되지 않았습니다.\n\n"
                f"키 인증 전에는 번역 작업을 시작할 수 없습니다.\n"
                f"먼저 [🔑 선택된 키 테스트] 버튼을 눌러 정상 인증을 완료해주세요."
            )
            return

        script_path = cfg["selected_script_path"]
        if not script_path or not os.path.exists(script_path):
            messagebox.showerror("파일 오류", f"실행할 파이썬 파일을 먼저 [파일 찾기...]로 선택해주세요:\n{script_path}")
            return

        self.btn_run.config(state=tk.DISABLED)
        self.btn_apply_excel.config(state=tk.DISABLED)
        self.btn_stop.config(state=tk.NORMAL)
        self._current_sheet_idx = 1
        self._total_sheets_count = 1
        self.progress_bar_total['value'] = 0
        self.progress_bar_step['value'] = 0
        self.progress_bar['value'] = 0
        self.start_time = time.time()
        self.lbl_timer.config(text="⏱️ 00:00", foreground="#285fb1")
        self.lbl_status_total.config(text="전체 진행도: 파이프라인 초기화 중...", foreground="#1e293b")
        self.lbl_status_step.config(text="단계별 번역 진행: 시작 대기 중...", foreground="#2563eb")
        self.lbl_step_detail.config(text="")
        self.log("=" * 65)
        self.log(f"[실행 시작] {script_path}")

        self._tick_timer()

        def run_thread():
            try:
                # -u 옵션: 표준 출력 버퍼링을 해제하여 실시간 즉시 출력 보장!
                cmd = [sys.executable, "-u", script_path]
                if os.path.basename(script_path) == "main.py" and "--cli" not in cmd:
                    cmd.append("--cli")
                if cfg["script_args"]:
                    cmd.extend(cfg["script_args"].split())

                env = os.environ.copy()
                env["PYTHONIOENCODING"] = "utf-8"
                env["PYTHONUNBUFFERED"] = "1"

                self.current_process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding='utf-8',
                    errors='replace',
                    env=env,
                    bufsize=1
                )

                for line in self.current_process.stdout:
                    clean_line = line.rstrip()
                    self.log(clean_line)
                    self._parse_and_update_progress(clean_line)

                self.current_process.wait()
                exit_code = self.current_process.returncode
                self.log(f"[종료] 프로세스 종료 코드: {exit_code}")
                if exit_code == 0:
                    self.root.after(0, lambda: self._on_finish_progress_ui())
                else:
                    self.root.after(0, lambda code=exit_code: self._on_error_progress_ui(code))
            except Exception as e:
                self.log(f"[오류 발생] {e}")
            finally:
                self.current_process = None
                self.btn_run.config(state=tk.NORMAL)
                self.btn_apply_excel.config(state=tk.NORMAL)
                self.btn_stop.config(state=tk.DISABLED)

        threading.Thread(target=run_thread, daemon=True).start()

    def _tick_timer(self):
        """실행 중일 때 1초마다 실시간 경과 시간 및 예상 남은 시간을 갱신합니다."""
        if hasattr(self, 'start_time') and self.start_time:
            elapsed = time.time() - self.start_time
            m, s = divmod(int(elapsed), 60)

            # 실시간 잔여 시간(ETA) 추정 (전체 진행도 기준)
            val = self.progress_bar_total['value']
            eta_str = ""
            if val >= 3 and elapsed >= 3:
                total_est = (elapsed / val) * 100
                remain = max(0, total_est - elapsed)
                rm, rs = divmod(int(remain), 60)
                eta_str = f" (남은 시간: 약 {rm}분 {rs:02d}초)"

            self.lbl_timer.config(text=f"⏱️ {m:02d}:{s:02d}{eta_str}", foreground="#285fb1")
            self.root.after(1000, self._tick_timer)

    def _apply_progress(self, total_val=None, total_text=None, step_val=None, step_text=None, detail_text=None):
        """전체 진행도와 세부 진행도를 독립적으로 안전하게 갱신합니다."""
        if total_val is not None:
            self.progress_bar_total['value'] = max(0, min(100, int(total_val)))
            self.progress_bar['value'] = self.progress_bar_total['value']
        if total_text:
            self.lbl_status_total.config(text=total_text, foreground="#1e293b")

        if step_val is not None:
            self.progress_bar_step['value'] = max(0, min(100, int(step_val)))
        if step_text:
            self.lbl_status_step.config(text=step_text, foreground="#2563eb")
        if detail_text:
            self.lbl_step_detail.config(text=detail_text)

    def _parse_and_update_progress(self, line: str):
        """실행 중인 엔진 stdout 로그를 실시간 분석하여
        전체 진행도(파이프라인 전체 완료율)와 세부 진행도(현재 언어/단계 완료율)를 완전 분리 갱신합니다.
        """
        clean = line.strip()
        if not clean:
            return

        # 1. 1단계: 계정 인증 및 용어집 동기화 ([1/3])
        if "[1/3] 구글 서비스 계정 인증 중" in clean:
            self.root.after(0, lambda: self._apply_progress(
                total_val=5,
                total_text="전체 진행도: [1단계: 인증/준비] 구글 서비스 계정 인증 중... (5%)",
                step_val=30,
                step_text="단계별 번역 진행: 서비스 계정 키 인증 중...",
                detail_text="인증 진행 중"
            ))
            return
        elif "성공! 시트" in clean and "연결 완료" in clean:
            self.root.after(0, lambda: self._apply_progress(
                total_val=10,
                total_text="전체 진행도: [1단계: 인증/준비] 구글 시트 연결 성공 (10%)",
                step_val=70,
                step_text="단계별 번역 진행: 온라인 시트 연결 완료",
                detail_text="시트 연결 성공"
            ))
            return
        elif "[Glossary]" in clean and ("로드됨" in clean or "적용 완료" in clean):
            m_g = re.search(r"(\d+)개\s*고유명사", clean)
            g_cnt = m_g.group(1) if m_g else "다수"
            self.root.after(0, lambda: self._apply_progress(
                total_val=15,
                total_text=f"전체 진행도: [1단계: 용어집] 공식 고유명사 {g_cnt}개 적용 완료 (15%)",
                step_val=100,
                step_text=f"단계별 번역 진행: 📖 용어집 {g_cnt}개 메모리 로드 완료",
                detail_text="용어집 동기화 완료"
            ))
            return

        # 2. 2단계: 시트 행 로드 및 대상 언어 확인 ([2/3])
        m_step2 = re.search(r"\[2/3\]\s*총\s*(\d+)개\s*행 로드 완료.*대상 언어:\s*(.*)", clean)
        if m_step2:
            row_cnt, lang_list = m_step2.groups()
            self.root.after(0, lambda: self._apply_progress(
                total_val=25,
                total_text=f"전체 진행도: [2단계: 데이터 로드] 총 {row_cnt}개 행 로드 완료 (25%)",
                step_val=100,
                step_text=f"단계별 번역 진행: 대상 언어 [{lang_list.strip()}] 확인 완료",
                detail_text="시트 파싱 완료"
            ))
            return

        # 3. 3단계: 고속 번역 시작 신호 ([3/3])
        if "[3/3]" in clean and "고속 번역" in clean:
            self.root.after(0, lambda: self._apply_progress(
                total_val=25,
                total_text="전체 진행도: [3단계: 고속 번역] 번역 대상 항목 검사 중... (25%)",
                step_val=0,
                step_text="단계별 번역 진행: [대기] 언어별 미번역 셀 탐색 중...",
                detail_text="번역 준비"
            ))
            return

        # 4. 언어별 번역 시작: ⚡ [ENG] 비어 있는 1개 항목 번역 중 (총 1개 배치)...
        m_lang_start = re.search(r"⚡\s*\[([A-Z]{2,4})\]\s*비어 있는\s*(\d+)개\s*항목 번역 중(?:\s*\(총\s*(\d+)개\s*배치\))?", clean)
        if m_lang_start:
            lang_code, item_cnt, batch_cnt = m_lang_start.groups()
            b_text = f" (총 {batch_cnt}개 배치)" if batch_cnt else ""
            self.root.after(0, lambda: self._apply_progress(
                total_val=None,
                total_text=f"전체 진행도: [3단계: 번역] {lang_code} AI 번역 진행 중...",
                step_val=10,  # 새 언어 진입 시 세부 게이지는 10%로 초기화
                step_text=f"단계별 번역 진행: ⚡ [{lang_code}] {item_cnt}개 항목 번역 시작{b_text}",
                detail_text=f"{lang_code} AI 번역 중..."
            ))
            return

        # 4-1. 모델 즉시 전환 / 할당량(429) 등 처리
        if "할당량(429)" in clean or "최적 모델로" in clean:
            m_model = re.search(r"\[(gemini-[^\]]+)\]", clean)
            m_name = m_model.group(1) if m_model else "대체 모델"
            self.root.after(0, lambda: self._apply_progress(
                total_val=None,
                total_text=None,
                step_val=45,
                step_text=f"단계별 번역 진행: ⚡ {m_name} 모델 전환 가속 중...",
                detail_text="모델 자동 전환"
            ))
            return

        # 4-2. 배치 완료 알림: ✅ [ENG] 배치 1/1 AI 번역 완료 (19.97초)
        m_batch_done = re.search(r"✅\s*\[([A-Z]{2,4})\]\s*배치\s*(\d+)/(\d+)\s*AI 번역 완료(?:\s*\(([^)]+)\))?", clean)
        if m_batch_done:
            lang_code, b_curr, b_tot, elap = m_batch_done.groups()
            b_pct = int(int(b_curr) / int(b_tot) * 90)
            elap_str = f" ({elap})" if elap else ""
            self.root.after(0, lambda: self._apply_progress(
                total_val=None,
                total_text=None,
                step_val=b_pct,
                step_text=f"단계별 번역 진행: ✅ [{lang_code}] 배치 {b_curr}/{b_tot} 완료{elap_str}",
                detail_text=f"배치 {b_curr}/{b_tot} 완료"
            ))
            return

        # 5. [PROGRESS c/t pct%] [LANG] 고속 번역 (x/y 청크) 완료 - pct%
        m_prog = re.search(r"\[PROGRESS\s+(\d+)/(\d+)(?:\s+(\d+)%)?\]\s*(.*)", clean)
        if m_prog:
            c_str, t_str, pct_str, detail = m_prog.groups()
            c_num = int(c_str)
            t_num = max(1, int(t_str))
            p_num = int(pct_str) if pct_str else int(c_num / t_num * 100)

            m_lang_tag = re.search(r"\[([A-Z]{2,4})(?:\s+(\d+)/(\d+))?\]", detail)
            lang_code = m_lang_tag.group(1) if m_lang_tag else ""

            is_sheet_step = any(k in detail for k in ["시트 처리 중", "시트 검수 중", "카테고리", "공식 시트"]) and t_num <= 30

            if is_sheet_step:
                sheet_pct = p_num
                self.root.after(0, lambda: self._apply_progress(
                    total_val=sheet_pct,
                    total_text=f"전체 진행도: [{c_num}/{t_num} 시트 - {sheet_pct}%] {detail[:40]}",
                    step_val=0,
                    step_text="단계별 번역 진행: [0%] 시작 대기 중...",
                    detail_text="시트 초기화 중"
                ))
            else:
                # 3단계 번역 구간: 전체 진행률 25% ~ 85% 범위를 언어 수(t_num)로 균등 배분
                macro_pct = 25 + int((c_num / t_num) * 60)
                macro_pct = max(25, min(85, macro_pct))

                tag_desc = f" [{lang_code}]" if lang_code else ""
                self.root.after(0, lambda: self._apply_progress(
                    total_val=macro_pct,
                    total_text=f"전체 진행도: [3단계: 번역] {c_num}/{t_num}개 언어 완료 ({macro_pct}%){tag_desc}",
                    step_val=100,  # 해당 언어 완료 시 세부 진행률은 100%
                    step_text=f"단계별 번역 진행: ✅{tag_desc} 고속 번역 완료 (100%)",
                    detail_text=f"{lang_code} 완료" if lang_code else f"{c_num}/{t_num} 완료"
                ))
            return

        # 6. 4단계: 스마트 시트 저장 및 Batch Update
        if "[구글 시트 스마트 저장]" in clean:
            self.root.after(0, lambda: self._apply_progress(
                total_val=87,
                total_text="전체 진행도: [4단계: 저장] 온라인 시트 기록 준비 중... (87%)",
                step_val=20,
                step_text="단계별 번역 진행: 스마트 저장 구조 분석 중...",
                detail_text="저장 분석 중"
            ))
            return
        elif "[스마트 저장 분석]" in clean:
            self.root.after(0, lambda: self._apply_progress(
                total_val=90,
                total_text="전체 진행도: [4단계: 저장] 수식(=IMPORTRANGE) 검사 중... (90%)",
                step_val=40,
                step_text="단계별 번역 진행: IMPORTRANGE 보호 분석 중...",
                detail_text="수식 구조 검사"
            ))
            return
        elif "⚡ [수식 셀 감지]" in clean or "수식이 가리키는 원본 시트" in clean:
            self.root.after(0, lambda: self._apply_progress(
                total_val=92,
                total_text="전체 진행도: [4단계: 저장] 원본 시트 매핑 완료 (92%)",
                step_val=60,
                step_text="단계별 번역 진행: 원본 시트 셀 매핑 완료",
                detail_text="원본 시트 매핑"
            ))
            return
        elif "Batch Update 실행 중" in clean:
            self.root.after(0, lambda: self._apply_progress(
                total_val=95,
                total_text="전체 진행도: [4단계: 저장] 초고속 Batch Update 실행 중... (95%)",
                step_val=85,
                step_text="단계별 번역 진행: 🚀 구글 시트 API 대량 일괄 쓰기 중...",
                detail_text="Batch Update 전송"
            ))
            return
        elif "일괄 저장 완료" in clean:
            self.root.after(0, lambda: self._apply_progress(
                total_val=98,
                total_text="전체 진행도: [4단계: 저장] 온라인 시트 일괄 저장 완료 (98%)",
                step_val=100,
                step_text="단계별 번역 진행: ✅ 원본 시트 일괄 반영 완료 (100%)",
                detail_text="저장 완료"
            ))
            return

        # 7. 5단계: 완료 신호 감지
        if any(kw in clean for kw in ["스마트 반영 완료", "전체 일괄 처리 완료", "모든 작업 완료"]):
            self.root.after(0, lambda: self._on_finish_progress_ui(clean))
            return
        elif "[탭 처리 완료]" in clean:
            tab_clean = clean.replace("📋", "").strip()
            self.root.after(0, lambda: self._apply_progress(
                total_val=100,
                total_text="전체 진행도: ✅ [완료] 시트 탭 처리 완료 (100%)",
                step_val=100,
                step_text=f"단계별 번역 진행: 📋 {tab_clean}",
                detail_text="100% 완료"
            ))
            return

    def _on_finish_progress_ui(self, msg=""):
        self.progress_bar_total['value'] = 100
        self.progress_bar_step['value'] = 100
        self.progress_bar['value'] = 100
        elapsed_str = ""
        if hasattr(self, 'start_time') and self.start_time:
            elapsed = time.time() - self.start_time
            m, s = divmod(int(elapsed), 60)
            elapsed_str = f" | 총 소요 시간: {m}분 {s}초"
            self.lbl_timer.config(text=f"⏱️ 총 소요 시간: {m}분 {s}초", foreground="#2f8552")
            self.log(f"⏱️ [완료] 총 소요 시간: {m}분 {s}초 ({elapsed:.2f}초)")
            self.start_time = None

        clean_msg = msg.replace('🎉', '').strip() if msg else "모든 번역 및 검수 작업 완료"
        self.lbl_status_total.config(text=f"✅ 전체 완료 (100%{elapsed_str})", foreground="#2f8552")
        self.lbl_status_step.config(text=f"✅ {clean_msg}", foreground="#2f8552")
        self.lbl_step_detail.config(text="100% 완료")

    def _on_error_progress_ui(self, exit_code):
        elapsed_str = ""
        if hasattr(self, 'start_time') and self.start_time:
            elapsed = time.time() - self.start_time
            m, s = divmod(int(elapsed), 60)
            elapsed_str = f" (진행 시간: {m}분 {s}초)"
            self.start_time = None
        self.lbl_status_total.config(text=f"⚠️ 오류 발생으로 프로세스 종료 (코드: {exit_code}){elapsed_str}", foreground="#b83a3a")
        self.lbl_status_step.config(text="⚠️ 작업 중단됨", foreground="#b83a3a")

    def _on_stop_clicked(self):
        if self.current_process:
            self.current_process.terminate()
            elapsed_str = ""
            if hasattr(self, 'start_time') and self.start_time:
                elapsed = time.time() - self.start_time
                m, s = divmod(int(elapsed), 60)
                elapsed_str = f" (진행 시간: {m}분 {s}초)"
                self.start_time = None
            self.lbl_status_total.config(text=f"현재 상태: 사용자에 의해 중지됨{elapsed_str}", foreground="#b83a3a")
            self.lbl_status_step.config(text="중지됨", foreground="#b83a3a")
            self.log(f"[사용자 중지] 실행 중인 프로세스를 중지했습니다.{elapsed_str}")

    def _on_open_excel_report(self):
        dir_path = os.path.dirname(os.path.abspath(__file__))
        xlsx_path = os.path.join(dir_path, "audit_report_전수검사_결과.xlsx")
        csv_path = os.path.join(dir_path, "audit_report_전수검사_결과.csv")
        if os.path.exists(xlsx_path):
            self.log(f"[보고서 열기] 엑셀 파일을 실행합니다: {xlsx_path}")
            os.startfile(xlsx_path)
        elif os.path.exists(csv_path):
            self.log(f"[보고서 열기] CSV 파일을 실행합니다: {csv_path}")
            os.startfile(csv_path)
        else:
            messagebox.showinfo("보고서 없음", "아직 생성된 전수검사 보고서가 없습니다.\n\n[기존 번역 전수 검사 모드]를 체크하고 번역을 먼저 실행해주세요.")

    def _on_apply_excel_clicked(self):
        dir_path = os.path.dirname(os.path.abspath(__file__))
        xlsx_path = os.path.join(dir_path, "audit_report_전수검사_결과.xlsx")
        if not os.path.exists(xlsx_path):
            messagebox.showwarning(
                "엑셀 보고서 없음",
                "반영할 엑셀 보고서('audit_report_전수검사_결과.xlsx')가 없습니다.\n\n먼저 [확인 전용] 또는 [전수 검사]를 실행하여 엑셀 보고서를 생성해주세요."
            )
            return

        confirm = messagebox.askyesno(
            "⚡ 엑셀 결과 시트 즉시 반영 확인",
            "엑셀 보고서('audit_report_전수검사_결과.xlsx')에 기록된 수정/교정 내용(사용자가 직접 수정한 텍스트 포함)을 구글 시트에 즉시 반영하시겠습니까?\n\n※ AI 재검수 없이 1초 만에 일괄 저장(Batch Update)됩니다."
        )
        if not confirm:
            return

        self._on_save_clicked(silent=True)
        self._run_apply_excel_process()

    def _run_apply_excel_process(self):
        main_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "main.py")
        if not os.path.exists(main_script):
            messagebox.showerror("파일 오류", f"main.py 파일을 찾을 수 없습니다:\n{main_script}")
            return

        self.btn_run.config(state=tk.DISABLED)
        self.btn_apply_excel.config(state=tk.DISABLED)
        self.btn_stop.config(state=tk.NORMAL)
        self.progress_bar['value'] = 0
        self.start_time = time.time()
        self.lbl_timer.config(text="⏱️ 00:00", foreground="#285fb1")
        self.lbl_status.config(text="현재 상태: 엑셀 보고서 내용 구글 시트 반영 중...", foreground="#2f6fcf")
        self.log("=" * 65)
        self.log("[시트 즉시 반영] audit_report_전수검사_결과.xlsx ➔ 구글 시트")

        self._tick_timer()

        def run_thread():
            try:
                cmd = [sys.executable, "-u", main_script, "--cli", "--apply-excel"]
                env = os.environ.copy()
                env["PYTHONIOENCODING"] = "utf-8"
                env["PYTHONUNBUFFERED"] = "1"

                self.current_process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding='utf-8',
                    errors='replace',
                    env=env,
                    bufsize=1
                )

                for line in self.current_process.stdout:
                    clean_line = line.rstrip()
                    self.log(clean_line)

                exit_code = self.current_process.wait()
                if exit_code == 0:
                    self.root.after(0, lambda: self._on_finish_progress_ui("엑셀 보고서의 수정/교정 내용이 구글 시트에 즉시 반영되었습니다!"))
                else:
                    self.root.after(0, lambda code=exit_code: self._on_error_progress_ui(code))
            except Exception as e:
                self.log(f"[오류 발생] {e}")
            finally:
                self.current_process = None
                self.btn_run.config(state=tk.NORMAL)
                self.btn_apply_excel.config(state=tk.NORMAL)
                self.btn_stop.config(state=tk.DISABLED)

        threading.Thread(target=run_thread, daemon=True).start()

def launch_gui():
    root = tk.Tk()
    app = SmartTranslatorUI(root)
    root.mainloop()

if __name__ == "__main__":
    launch_gui()
