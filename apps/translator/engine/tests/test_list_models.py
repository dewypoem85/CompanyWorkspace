"""웹 화면용 모델 목록 조회 액션(list_models) 회귀 테스트 (네트워크 호출 없음).

실행: cd apps/translator/engine && python3 -m unittest discover -s tests -v
"""
import contextlib
import io
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import web_runner  # noqa: E402  (openpyxl 등 엔진 의존성이 설치된 환경에서 실행)
except ModuleNotFoundError as exc:  # pragma: no cover
    web_runner = None
    _IMPORT_ERROR = exc

import model_discovery  # noqa: E402

GEMINI_KEY = "AIzaSy" + "x" * 33


def _run(options: dict, cfg: dict, discovered):
    buf = io.StringIO()
    with mock.patch.object(web_runner, "load_config", return_value=cfg), \
            mock.patch.object(model_discovery, "discover", side_effect=discovered) as disc, \
            contextlib.redirect_stdout(buf):
        web_runner.action_list_models(json.dumps(options))
    return json.loads(buf.getvalue()), disc


@unittest.skipIf(web_runner is None, "엔진 의존성(openpyxl 등) 미설치")
class ListModelsActionTest(unittest.TestCase):
    def test_returns_discovered_models_with_saved_key(self):
        out, disc = _run({"provider": "gemini"}, {"gemini_api_key": GEMINI_KEY},
                         lambda p, k: ["gemini-3.8-flash", "gemini-3.5-flash"])
        self.assertEqual(out, {"success": True, "provider": "gemini", "models": ["gemini-3.8-flash", "gemini-3.5-flash"]})
        disc.assert_called_once_with("gemini", GEMINI_KEY)

    def test_empty_discovery_is_reported_as_failure(self):
        # 조회 실패를 '모델 0개 성공'으로 숨기지 않아야 화면이 기본 목록으로 전환한다
        out, _ = _run({"provider": "gemini"}, {"gemini_api_key": GEMINI_KEY}, lambda p, k: [])
        self.assertFalse(out["success"])
        self.assertIn("불러오지 못했습니다", out["error"])

    def test_missing_key_does_not_call_api(self):
        out, disc = _run({"provider": "claude"}, {"claude_api_key": ""}, lambda p, k: ["x"])
        self.assertFalse(out["success"])
        disc.assert_not_called()

    def test_unknown_provider(self):
        out, disc = _run({"provider": "other"}, {}, lambda p, k: ["x"])
        self.assertFalse(out["success"])
        disc.assert_not_called()

    def test_key_is_not_echoed(self):
        out, _ = _run({"provider": "gemini"}, {"gemini_api_key": GEMINI_KEY}, lambda p, k: ["gemini-3.8-flash"])
        self.assertNotIn(GEMINI_KEY, json.dumps(out))


if __name__ == "__main__":
    unittest.main()
