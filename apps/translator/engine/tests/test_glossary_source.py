"""용어집 시트 주소 설정·연결·저장 대조 회귀 테스트 (네트워크·실제 키 없음, gspread 는 가짜 모듈).

실행: cd apps/translator/engine && python3 -m unittest discover -s tests -v
"""
import contextlib
import io
import json
import os
import sys
import tempfile
import types
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import i2_sheet_registry as reg  # noqa: E402

try:
    import web_runner  # noqa: E402
except ModuleNotFoundError:  # pragma: no cover - openpyxl 미설치 환경
    web_runner = None

DEFAULT_KEY = "1rrbDpylaH9580GkUYtrXEqNGr0OHuzIFQNlsSzK7QPI"
NEW_URL = "https://docs.google.com/spreadsheets/d/NEWSHEETKEY_123/edit#gid=77"


class FakeWorksheet:
    def __init__(self, wid, title, values):
        self.id, self.title, self.values = wid, title, values
        self.cleared = False
        self.updated = None

    def get_all_values(self):
        return self.values

    def clear(self):
        self.cleared = True

    def update(self, data):
        self.updated = data


class FakeSpreadsheet:
    def __init__(self, title, worksheets):
        self.title, self._ws = title, worksheets

    def worksheets(self):
        return self._ws


def fake_google(sheets: dict, opened: list, denied=None):
    """sheets: {sheet_key: FakeSpreadsheet}. 열린 키를 opened 에 기록"""
    gspread = types.ModuleType("gspread")

    class Client:
        def open_by_key(self, key):
            opened.append(key)
            if key not in sheets:
                raise PermissionError("403 no access")
            return sheets[key]

    def service_account(filename=None):
        used_keys.append(filename)
        if filename in denied_keys:
            class Denied:
                def open_by_key(self, key):
                    opened.append(key)
                    raise PermissionError()  # gspread 는 403 을 메시지 없는 PermissionError 로 올린다
            return Denied()
        return Client()

    used_keys, denied_keys = [], set(denied or ())
    gspread.service_account = service_account
    return mock.patch.dict(sys.modules, {"gspread": gspread})


GLOSSARY_VALUES = [["Korean", "English", "Spain"], ["체력", "HP", "Salud"], ["물약", "Potion", "Poción"]]


class ParseGlossaryUrlTest(unittest.TestCase):
    def test_empty_uses_default(self):
        self.assertEqual(reg.parse_glossary_url(""), (DEFAULT_KEY, 181735466))

    def test_custom_with_and_without_gid(self):
        self.assertEqual(reg.parse_glossary_url(NEW_URL), ("NEWSHEETKEY_123", 77))
        self.assertEqual(reg.parse_glossary_url("https://docs.google.com/spreadsheets/d/ABC-def_9/edit"), ("ABC-def_9", None))

    def test_invalid_url_raises_instead_of_opening_other_sheet(self):
        with self.assertRaises(ValueError):
            reg.parse_glossary_url("https://example.com/not-a-sheet")


class OpenGlossaryWorksheetTest(unittest.TestCase):
    def setUp(self):
        self.keyfile = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
        self.addCleanup(os.unlink, self.keyfile.name)

    def _open(self, url, sheets):
        opened = []
        with fake_google(sheets, opened), mock.patch.object(reg, "glossary_key_candidates", return_value=[self.keyfile.name]):
            ws, info = reg.open_glossary_worksheet(url, "")
        return ws, info, opened

    def test_gid_tab_selected(self):
        ws77 = FakeWorksheet(77, "용어", GLOSSARY_VALUES)
        sheets = {"NEWSHEETKEY_123": FakeSpreadsheet("새 용어집", [FakeWorksheet(1, "Glossary", []), ws77])}
        ws, info, opened = self._open(NEW_URL, sheets)
        self.assertIs(ws, ws77)
        self.assertEqual((info["sheet_title"], info["tab"], info["gid"], info["note"]), ("새 용어집", "용어", 77, ""))
        self.assertEqual(opened, ["NEWSHEETKEY_123"])

    def test_tab_name_fallback_both_legacy_names(self):
        for name in ("Glossary", "번역키"):
            ws_named = FakeWorksheet(5, name, GLOSSARY_VALUES)
            sheets = {"ABC": FakeSpreadsheet("S", [FakeWorksheet(1, "기타", []), ws_named])}
            ws, info, _ = self._open("https://docs.google.com/spreadsheets/d/ABC/edit", sheets)
            self.assertIs(ws, ws_named)

    def test_missing_gid_falls_back_with_note(self):
        sheets = {"NEWSHEETKEY_123": FakeSpreadsheet("S", [FakeWorksheet(9, "번역키", GLOSSARY_VALUES)])}
        _, info, _ = self._open(NEW_URL, sheets)
        self.assertEqual(info["tab"], "번역키")
        self.assertIn("gid=77", info["note"])

    def test_no_tab_raises(self):
        sheets = {"ABC": FakeSpreadsheet("S", [FakeWorksheet(1, "기타", [])])}
        with self.assertRaises(LookupError):
            self._open("https://docs.google.com/spreadsheets/d/ABC/edit", sheets)

    def test_no_access_raises_permission_error(self):
        with self.assertRaises(PermissionError):
            self._open(NEW_URL, {})

    def test_permission_error_lists_tried_keys_and_missing_fallback(self):
        # 새 폴더처럼 용어집 전용 키가 없고, 선택한 키는 시트에 공유되지 않은 경우
        with open(self.keyfile.name, "w", encoding="utf-8") as f:
            json.dump({"client_email": "main@proj.iam.gserviceaccount.com"}, f)
        keys_dir = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(keys_dir, ignore_errors=True))
        sheets = {DEFAULT_KEY: FakeSpreadsheet("용어집", [FakeWorksheet(2046126010, "새 탭", GLOSSARY_VALUES)])}
        opened = []
        new_tab = "https://docs.google.com/spreadsheets/d/1rrbDpylaH9580GkUYtrXEqNGr0OHuzIFQNlsSzK7QPI/edit?gid=2046126010#gid=2046126010"
        with fake_google(sheets, opened, denied={self.keyfile.name}), \
                mock.patch.object(reg, "glossary_key_candidates", return_value=[self.keyfile.name]), \
                mock.patch("paths.KEYS_DIR", keys_dir):
            with self.assertRaises(PermissionError) as cm:
                reg.open_glossary_worksheet(new_tab, "")
        msg = str(cm.exception)
        self.assertIn("main@proj.iam.gserviceaccount.com", msg)
        self.assertIn(reg.GLOSSARY_FALLBACK_KEY_FILE, msg)
        self.assertIn("복사", msg)

    def test_second_key_used_when_first_denied(self):
        second = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
        self.addCleanup(os.unlink, second.name)
        ws = FakeWorksheet(2046126010, "새 탭", GLOSSARY_VALUES)
        sheets = {DEFAULT_KEY: FakeSpreadsheet("용어집", [ws])}
        opened = []
        url = "https://docs.google.com/spreadsheets/d/1rrbDpylaH9580GkUYtrXEqNGr0OHuzIFQNlsSzK7QPI/edit?gid=2046126010#gid=2046126010"
        with fake_google(sheets, opened, denied={self.keyfile.name}), \
                mock.patch.object(reg, "glossary_key_candidates", return_value=[self.keyfile.name, second.name]):
            got, info = reg.open_glossary_worksheet(url, "")
        self.assertIs(got, ws)
        self.assertEqual((info["gid"], opened), (2046126010, [DEFAULT_KEY, DEFAULT_KEY]))

    def test_no_key_files(self):
        with mock.patch.object(reg, "glossary_key_candidates", return_value=[]):
            with self.assertRaises(FileNotFoundError):
                reg.open_glossary_worksheet(NEW_URL, "")


@unittest.skipIf(web_runner is None, "엔진 의존성(openpyxl 등) 미설치")
class WebRunnerGlossaryTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.csv = os.path.join(tmp.name, "g.csv")
        with open(self.csv, "w", encoding="utf-8-sig") as f:
            f.write("Korean,English\n로컬,Local\n")
        for target, value in (("GLOSSARY_CSV_PATH", self.csv), ("GLOSSARY_XLSX_PATH", os.path.join(tmp.name, "g.xlsx"))):
            p = mock.patch.object(web_runner, target, value)
            p.start()
            self.addCleanup(p.stop)

    def _run(self, fn, options, ws=None, info=None, open_error=None, cfg=None):
        def fake_open(url, sa):
            if open_error:
                raise open_error
            return ws, info
        buf = io.StringIO()
        with mock.patch.object(reg, "open_glossary_worksheet", side_effect=fake_open) as opener, \
                mock.patch.object(web_runner, "load_config", return_value=cfg or {"glossary_sheet_url": NEW_URL, "service_account_json_path": "k.json"}), \
                contextlib.redirect_stdout(buf):
            fn(json.dumps(options)) if options is not None else fn()
        return json.loads(buf.getvalue()), opener

    def info(self, key="NEWSHEETKEY_123", gid=77):
        return {"sheet_key": key, "sheet_title": "새 용어집", "tab": "용어", "gid": gid, "url": "u", "note": ""}

    def test_get_uses_configured_url_and_returns_source(self):
        ws = FakeWorksheet(77, "용어", GLOSSARY_VALUES)
        out, opener = self._run(web_runner.action_get_glossary, None, ws=ws, info=self.info())
        opener.assert_called_once_with(NEW_URL, "k.json")
        self.assertTrue(out["synced_from_sheet"])
        self.assertEqual(out["total"], 2)
        self.assertEqual(out["source"]["sheet_key"], "NEWSHEETKEY_123")

    def test_get_falls_back_to_csv_with_reason(self):
        out, _ = self._run(web_runner.action_get_glossary, None, open_error=PermissionError("공유 권한 없음"))
        self.assertFalse(out["synced_from_sheet"])
        self.assertIsNone(out["source"])
        self.assertIn("공유 권한 없음", out["sheet_error"])
        self.assertEqual(out["rows"][0]["Korean"], "로컬")
        self.assertEqual(out["configured_url"], NEW_URL)  # 접속 실패여도 원본 링크용 주소는 유지

    def test_get_configured_url_defaults(self):
        out, _ = self._run(web_runner.action_get_glossary, None, open_error=PermissionError("x"),
                           cfg={"glossary_sheet_url": "", "service_account_json_path": ""})
        self.assertEqual(out["configured_url"], reg.DEFAULT_GLOSSARY_URL)

    def _save(self, ws, info, expected, loaded_from_sheet):
        return self._run(web_runner.action_save_glossary,
                         {"headers": ["Korean", "English"], "rows": [{"Korean": "새", "English": "New"}],
                          "expected_source": expected, "loaded_from_sheet": loaded_from_sheet}, ws=ws, info=info)[0]

    def test_save_refuses_when_configured_sheet_changed(self):
        ws = FakeWorksheet(77, "용어", GLOSSARY_VALUES)
        with open(self.csv, encoding="utf-8-sig") as f:
            before = f.read()
        out = self._save(ws, self.info(), {"sheet_key": "OLDKEY", "gid": 1}, True)
        self.assertFalse(out["success"])
        self.assertTrue(out["source_changed"])
        self.assertFalse(ws.cleared)
        with open(self.csv, encoding="utf-8-sig") as f:
            self.assertEqual(f.read(), before)  # 로컬 파일도 쓰지 않음

    def test_save_writes_when_loaded_from_same_sheet(self):
        ws = FakeWorksheet(77, "용어", GLOSSARY_VALUES)
        out = self._save(ws, self.info(), {"sheet_key": "NEWSHEETKEY_123", "gid": 77}, True)
        self.assertTrue(out["success"] and out["sheet_synced"])
        self.assertEqual(ws.updated, [["Korean", "English"], ["새", "New"]])

    def test_save_from_local_csv_does_not_overwrite_nonempty_sheet(self):
        ws = FakeWorksheet(77, "용어", GLOSSARY_VALUES)
        out = self._save(ws, self.info(), None, False)
        self.assertTrue(out["success"])
        self.assertFalse(out["sheet_synced"])
        self.assertFalse(ws.cleared)
        self.assertIn("덮어쓰지 않았습니다", out["sheet_skip_reason"])

    def test_save_from_local_csv_initializes_empty_sheet(self):
        ws = FakeWorksheet(77, "용어", [])
        out = self._save(ws, self.info(), self.info(), False)
        self.assertTrue(out["sheet_synced"])

    def test_test_glossary_reports_counts_and_writes_nothing(self):
        ws = FakeWorksheet(77, "용어", GLOSSARY_VALUES)
        out, opener = self._run(web_runner.action_test_glossary, {"url": NEW_URL}, ws=ws, info=self.info())
        opener.assert_called_once_with(NEW_URL, "k.json")
        self.assertEqual((out["success"], out["total"], out["languages"]), (True, 2, ["English", "Spain"]))
        self.assertFalse(ws.cleared)
        self.assertIsNone(ws.updated)

    def test_save_config_rejects_invalid_glossary_url(self):
        saved = []
        buf = io.StringIO()
        with mock.patch.object(web_runner, "load_config", return_value={}), \
                mock.patch.object(web_runner, "save_config", side_effect=saved.append), contextlib.redirect_stdout(buf):
            web_runner.action_save_config(json.dumps({"glossary_sheet_url": "https://example.com/x"}))
        self.assertFalse(json.loads(buf.getvalue())["success"])
        self.assertEqual(saved, [])

    def test_save_config_accepts_empty_as_default(self):
        saved = []
        buf = io.StringIO()
        with mock.patch.object(web_runner, "load_config", return_value={"glossary_sheet_url": NEW_URL}), \
                mock.patch.object(web_runner, "save_config", side_effect=saved.append), contextlib.redirect_stdout(buf):
            web_runner.action_save_config(json.dumps({"glossary_sheet_url": "  "}))
        self.assertTrue(json.loads(buf.getvalue())["success"])
        self.assertEqual(saved[0]["glossary_sheet_url"], "")


if __name__ == "__main__":
    unittest.main()
