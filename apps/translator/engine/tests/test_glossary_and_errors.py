"""용어집 매칭 일관성 · 언어별 적용 판정 · LLM 오류 가시화 회귀 테스트 (네트워크 호출 없음).

실행: cd apps/translator/engine && python3 -m unittest discover -s tests -v
"""
import contextlib
import io
import json
import os
import sys
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main  # noqa: E402


GLOSSARY = {
    "물약": {"English": "Potion", "Spain": "Poción"},
    "신성한 방패": {"English": "Holy Shield", "Spain": "Escudo sagrado", "German": "Heiliger Schild"},
}


def _http_error(code, body):
    return urllib.error.HTTPError("https://example.test/?key=SECRETKEY123456", code, "err", {}, io.BytesIO(body.encode("utf-8")))


class GlossaryPromptConsistencyTest(unittest.TestCase):
    def test_short_term_with_particle_is_in_prompt_rules(self):
        # '물약을' 처럼 조사가 붙은 2글자 용어도 검증이 강제하므로 프롬프트에 있어야 한다
        rules = main.glossary_prompt_rules(["물약을 사용한다"], GLOSSARY, "ENG")
        self.assertEqual(rules, ["- '물약' -> 'Potion'"])

    def test_every_enforced_term_appears_in_rules(self):
        texts = ["물약을 사용한다", "신성한 방패를 장착한다"]
        enforced = {ko for t in texts for ko, _ in main.glossary_terms_for(t, "SPA", GLOSSARY)}
        rules = "\n".join(main.glossary_prompt_rules(texts, GLOSSARY, "SPA"))
        for ko in enforced:
            self.assertIn(f"'{ko}'", rules)

    def test_review_format_keeps_preferred_label(self):
        rules = main.glossary_prompt_rules(["물약을 사용한다"], GLOSSARY, "ENG", review=True)
        self.assertEqual(rules, ["- '물약' (Preferred Glossary: 'Potion')"])

    def test_loose_partial_match_keeps_previous_behavior(self):
        # 활용형('신성한')이라 검증은 강제하지 않는다. 기존 프롬프트 규칙은 그대로:
        # 검수(review)는 부분 일치도 참고용으로 포함, 번역은 공백 구분 없는 2글자 용어를 제외
        g = {"신성": {"English": "Holy"}}
        self.assertEqual(main.glossary_terms_for("신성한 힘", "ENG", g), [])
        self.assertEqual(main.glossary_prompt_rules(["신성한 힘"], g, "ENG", review=True), ["- '신성' (Preferred Glossary: 'Holy')"])
        self.assertEqual(main.glossary_prompt_rules(["신성한 힘"], g, "ENG"), [])
        self.assertEqual(main.glossary_prompt_rules(["신성 한 힘"], g, "ENG"), ["- '신성' -> 'Holy'"])

    def test_empty_glossary(self):
        self.assertEqual(main.glossary_prompt_rules(["물약"], None, "ENG"), [])

    def test_gemini_batch_prompt_contains_short_term(self):
        captured = {}

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps({"k": "Use the Potion"})}]}}]}).encode()

        def fake_urlopen(req, timeout=0):
            captured["prompt"] = json.loads(req.data.decode("utf-8"))["contents"][0]["parts"][0]["text"]
            return Resp()

        with mock.patch.object(main, "get_active_gemini_models", return_value=["m"]), \
                mock.patch.object(main.urllib.request, "urlopen", fake_urlopen):
            out = main.translate_batch_with_gemini({"k": "물약을 사용한다"}, "ENG", "KEY", glossary=GLOSSARY)
        self.assertEqual(out, {"k": "Use the Potion"})
        self.assertIn("'물약' -> 'Potion'", captured["prompt"])


class GlossaryMatchTest(unittest.TestCase):
    def test_exact_languages_unchanged(self):
        self.assertTrue(main.glossary_term_present("Holy Shield", "Equip the <b>Holy Shield</b>", "ENG"))
        self.assertFalse(main.glossary_term_present("Holy Shield", "Equip the Sacred Shield", "ENG"))

    def test_spanish_plural_and_gender_accepted(self):
        for t in ("Equipa el escudo sagrado", "Los escudos sagrados brillan", "La Escudo Sagrada"):
            self.assertTrue(main.glossary_term_present("Escudo sagrado", t, "SPA"), t)

    def test_spanish_missing_term_still_fails(self):
        self.assertFalse(main.glossary_term_present("Escudo sagrado", "Equipa el arma bendita", "SPA"))
        self.assertFalse(main.glossary_term_present("Escudo sagrado", "Equipa el escudo", "SPA"))

    def test_german_inflection_accepted(self):
        self.assertTrue(main.glossary_term_present("Heiliger Schild", "Der heilige Schild", "GER"))
        self.assertTrue(main.glossary_term_present("Heiliger Schild", "Mit heiligen Schilden", "GER"))

    def test_short_words_need_exact_match_in_stem_mode(self):
        self.assertFalse(main.glossary_term_present("Mago", "Maga", "SPA"))   # 4글자 이하는 어간 비교 안 함

    def test_glossary_missing_uses_language_rule(self):
        miss = main.glossary_missing("신성한 방패", "los escudos sagrados", "SPA", GLOSSARY)
        self.assertEqual(miss, [])
        miss = main.glossary_missing("신성한 방패", "Equipa el arma", "SPA", GLOSSARY)
        self.assertEqual(miss, [("신성한 방패", "Escudo sagrado")])
        # 영어는 기존처럼 정확히 일치해야 한다
        miss = main.glossary_missing("신성한 방패", "Equip the Holy Shields", "ENG", GLOSSARY)
        self.assertEqual(miss, [])  # 부분 문자열 일치(기존 동작 유지)
        miss = main.glossary_missing("신성한 방패", "Equip the Sacred Shield", "ENG", GLOSSARY)
        self.assertEqual(len(miss), 1)


class ErrorVisibilityTest(unittest.TestCase):
    def setUp(self):
        main._LLM_ERR_NOTED.clear()

    def test_redact_masks_keys(self):
        s = main._redact("GET https://x/v1beta/models/m:generateContent?key=AIzaSyABCDEFGHIJ1234 failed; Authorization: Bearer sk-abcdefghijklmnop; x-api-key: sk-ant-abcdefghijk")
        for secret in ("AIzaSyABCDEFGHIJ1234", "sk-abcdefghijklmnop", "sk-ant-abcdefghijk"):
            self.assertNotIn(secret, s)
        self.assertIn("key=***", s)

    def test_log_once_and_masked(self):
        buf = io.StringIO()
        err = _http_error(429, '{"error":"quota exceeded for key=AIzaSyABCDEFGHIJ1234"}')
        with contextlib.redirect_stdout(buf):
            for _ in range(5):
                main._log_llm_error("gemini", "m", err)
        out = buf.getvalue()
        self.assertEqual(out.count("호출 실패"), 1)
        self.assertIn("HTTP 429", out)
        self.assertNotIn("AIzaSyABCDEFGHIJ1234", out)

    def test_permanent_error_classification(self):
        self.assertTrue(main._is_permanent_llm_error(_http_error(401, "unauthorized")))
        self.assertTrue(main._is_permanent_llm_error(_http_error(400, "API key not valid. Please pass a valid API key.")))
        self.assertFalse(main._is_permanent_llm_error(_http_error(429, "rate")))
        self.assertFalse(main._is_permanent_llm_error(_http_error(503, "busy")))
        # 모델 접근 불가는 키 문제가 아니므로 다른 후보 모델로 넘어가야 한다
        self.assertFalse(main._is_permanent_llm_error(_http_error(403, "The model does not exist or you do not have access")))
        self.assertFalse(main._is_permanent_llm_error(ValueError("x")))

    def test_call_gemini_raw_stops_on_auth_error(self):
        calls = []

        def fake(req, timeout=0):
            calls.append(req.full_url)
            raise _http_error(403, "API key not valid")

        buf = io.StringIO()
        with mock.patch.object(main, "get_active_gemini_models", return_value=["a", "b", "c"]), \
                mock.patch.object(main.urllib.request, "urlopen", fake), contextlib.redirect_stdout(buf):
            self.assertEqual(main.call_gemini_raw("p", "KEY", ""), "")
        self.assertEqual(len(calls), 1)
        self.assertIn("API 키/권한", buf.getvalue())
        self.assertNotIn("SECRETKEY", buf.getvalue())

    def test_call_gemini_raw_still_falls_back_on_quota(self):
        calls = []

        def fake(req, timeout=0):
            calls.append(1)
            raise _http_error(429, "quota")

        with mock.patch.object(main, "get_active_gemini_models", return_value=["a", "b"]), \
                mock.patch.object(main.urllib.request, "urlopen", fake), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main.call_gemini_raw("p", "KEY", ""), "")
        self.assertEqual(len(calls), 2)

    def test_llm_call_raw_logs_instead_of_silent(self):
        buf = io.StringIO()
        with mock.patch.object(main, "_llm_urlopen", side_effect=RuntimeError("HTTP 401 (gpt): bad key")), contextlib.redirect_stdout(buf):
            self.assertEqual(main._llm_call_raw("p", "openai", "KEY", "gpt-x"), "")
        self.assertIn("호출 실패", buf.getvalue())
        self.assertIn("HTTP 401", buf.getvalue())

    def test_gemini_batch_error_message_is_masked_and_stops(self):
        calls = []

        def fake(req, timeout=0):
            calls.append(1)
            raise _http_error(401, "bad key=AIzaSyABCDEFGHIJ1234")

        with mock.patch.object(main, "get_active_gemini_models", return_value=["a", "b"]), \
                mock.patch.object(main.urllib.request, "urlopen", fake), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError) as cm:
                main.translate_batch_with_gemini({"k": "안녕"}, "ENG", "KEY")
        self.assertEqual(len(calls), 1)
        self.assertNotIn("AIzaSyABCDEFGHIJ1234", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
