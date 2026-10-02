"""용어집 ↔ 인게임(I2Languages) 사용 실태 검증기.

용어집에 정의된 용어가 실제 게임 텍스트(I2Languages.asset)에서 어떻게 쓰이는지 집계합니다.
AI 호출 없이 결정론적으로 동작하며, 결과를 엑셀로 저장합니다.

  python glossary_audit.py [--asset <I2Languages.asset>] [--out <결과.xlsx>]

판정 기준(언어별):
  일치   용어가 쓰인 모든 항목에서 용어집 번역이 사용됨
  혼용   용어집 번역과 다른 표기가 함께 쓰임 (사용 비율 표시)
  미사용 용어가 쓰인 항목에서 용어집 번역이 한 번도 쓰이지 않음 (게임이 다르게 일관 사용)
"""
import argparse
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import paths  # noqa: E402
import main as eng  # noqa: E402  (glossary_terms_for 등 검수 엔진과 동일한 매칭 규칙 사용)
from config_manager import load_config  # noqa: E402

LANGS = ["ENG", "JPN", "CHS", "CHT", "SPA"]
LANG_COL = {"ENG": "English", "JPN": "Japanese", "CHS": "Chinese", "CHT": "Chinese (Taiwan)", "SPA": "Spain"}
CJK = {"JPN", "CHS", "CHT"}
TAG = re.compile(r"<[^>]+>|\[[^\]]*\]|\{[^}]*\}")


def clean(text: str) -> str:
    return TAG.sub("", text or "")


def load_game_rows(asset_path: str):
    cats = [c for c, n in eng.get_local_i2_categories(asset_path) if n > 0 and not c.startswith("#")]
    rows = []
    for c in cats:
        _h, rs = eng.parse_local_i2languages_asset(asset_path, c)
        for r in rs:
            kor = (r.get("Korean") or "").strip()
            if kor:
                r["_cat"] = c
                rows.append(r)
    return rows


def ngrams(text: str, lang: str):
    """대안 표기 후보 추출용 n-gram (CJK: 글자 2~4, 그 외: 단어 1~2)"""
    t = clean(text).lower()
    out = set()
    if lang in CJK:
        for chunk in re.findall(r"[぀-ヿ一-鿿]+", t):
            for n in (2, 3, 4):
                for i in range(len(chunk) - n + 1):
                    out.add(chunk[i:i + n])
    else:
        words = re.findall(r"[a-záéíóúñü'’-]+", t)
        for n in (1, 2):
            for i in range(len(words) - n + 1):
                out.add(" ".join(words[i:i + n]))
    return out


def find_alternatives(miss_texts, other_ngram_counts, n_other, expected, lang):
    """용어집 번역을 쓰지 않은 항목들에서 공통으로 나타나는(=게임이 대신 쓰는) 표기 후보"""
    if not miss_texts:
        return []
    cnt = Counter()
    for t in miss_texts:
        cnt.update(ngrams(t, lang))
    n_miss = len(miss_texts)
    stop = {"the", "of", "a", "an", "to", "and", "in", "de", "la", "el", "los", "las", "del", "y", "en", "un", "una", "por", "con", "que"}
    cands = []
    for g, c in cnt.items():
        share = c / n_miss
        if c < 3 or share < 0.4:
            continue
        if lang not in CJK and all(w in stop for w in g.split()):
            continue
        lift = share / ((other_ngram_counts.get(g, 0) + 1) / (n_other + 1))
        if lift < 15:
            continue
        cands.append((share, lift, len(g), g, c))
    cands.sort(reverse=True)
    picked = []
    for share, lift, ln, g, c in cands:
        if any(g in p[3] or p[3] in g for p in picked):
            continue
        picked.append((share, lift, ln, g, c))
        if len(picked) >= 3:
            break
    return [f"{g} ({c}/{n_miss})" for _s, _l, _n, g, c in picked]


def spacing_variants(term: str, korean_texts):
    """한글 원문에서 용어가 어떤 띄어쓰기 형태로 쓰였는지 (공백 유무 변형)"""
    chars = [re.escape(ch) for ch in term if not ch.isspace()]
    if len(chars) < 3:
        return Counter()
    pat = re.compile(r"[ \t]?".join(chars))
    forms = Counter()
    for t in korean_texts:
        for m in pat.finditer(t):
            forms[m.group(0)] += 1
    return forms


def main():
    ap = argparse.ArgumentParser()
    cfg = load_config()
    ap.add_argument("--asset", default=cfg.get("local_i2_asset_path") or "")
    ap.add_argument("--out", default=os.path.join(paths.OUTPUT_DIR, "용어집_인게임_검증_결과.xlsx"))
    args = ap.parse_args()

    if not args.asset or not os.path.isfile(args.asset):
        print(f"[오류] I2Languages.asset 경로를 찾을 수 없습니다: {args.asset!r} (--asset 으로 지정)")
        return 1

    print("[1/4] 용어집 로드…")
    glossary = eng.fetch_glossary_from_google_sheet("", cfg.get("service_account_json_path", ""))
    print(f"      용어 {len(glossary)}개")
    print("[2/4] 인게임 텍스트 로드…")
    rows = load_game_rows(args.asset)
    print(f"      항목 {len(rows)}개")

    korean_texts = [r["Korean"] for r in rows]

    # 언어별 전체 n-gram 빈도 (대안 표기 리프트 계산의 기준선)
    print("[3/4] 용어별 사용 실태 집계…")
    stats = {}          # (ko, lang) -> dict
    term_rows = defaultdict(lambda: defaultdict(list))   # ko -> lang -> [(row, used)]
    for lang in LANGS:
        for r in rows:
            for ko, exp in eng.glossary_terms_for(r["Korean"], lang, glossary):
                trans = (r.get(LANG_COL[lang]) or "").strip()
                if not trans:
                    continue
                used = exp.lower() in clean(trans).lower()
                term_rows[ko][lang].append((r, exp, used))

    all_ngrams = {}
    for lang in LANGS:
        c = Counter()
        for r in rows:
            c.update(ngrams(r.get(LANG_COL[lang], ""), lang))
        all_ngrams[lang] = c

    detail = []
    standalone = []
    for ko in sorted(glossary):
        for lang in LANGS:
            entries = term_rows.get(ko, {}).get(lang, [])
            exp = str((glossary.get(ko) or {}).get(LANG_COL[lang], "") or "").strip()
            n = len(entries)
            used = sum(1 for _r, _e, u in entries if u)
            miss = [(r, e) for r, e, u in entries if not u]
            n_miss = n - used
            if n == 0:
                status = "해당 없음"
            elif used == n:
                status = "일치"
            elif used == 0:
                status = "미사용"
            elif n_miss <= 2 or used / n >= 0.95:
                status = "소수 예외"          # 거의 일치 (95% 이상 또는 불일치 2건 이하)
            elif used / n < 0.5:
                status = "주로 다른 표기"      # 용어집 번역보다 다른 표기가 더 많이 쓰임
            else:
                status = "혼용"
            alts = []
            if miss:
                # (a) 짧은 항목(한글이 용어 + 3글자 이내)의 실제 번역: 게임이 이 용어를 어떻게 부르는지 가장 직접적인 증거
                short_c = Counter()
                for r, _e in miss:
                    if len(r["Korean"].strip()) <= len(ko) + 3:
                        v = clean((r.get(LANG_COL[lang]) or "").strip())
                        if v:
                            short_c[v] += 1
                alts = [f"{v} ×{c}" for v, c in short_c.most_common(3)]
                # (b) 불일치 항목이 충분할 때만 n-gram 대안 후보 (표본이 작으면 잡음이 커서 생략)
                if not alts and len(miss) >= 4:
                    miss_texts = [r.get(LANG_COL[lang], "") for r, _e in miss]
                    in_term = Counter()
                    for r, _e, _u in entries:
                        in_term.update(ngrams(r.get(LANG_COL[lang], ""), lang))
                    other = Counter(all_ngrams[lang])
                    other.subtract(in_term)
                    alts = [("(추정) " + a) for a in find_alternatives(miss_texts, other, max(1, len(rows) - n), exp, lang)]
            # 단독 항목(한글 == 용어)의 실제 번역
            exact = [(r["Keys"], (r.get(LANG_COL[lang]) or "").strip()) for r, _e, _u in entries if r["Korean"].strip() == ko]
            if exact:
                forms = Counter(clean(v) for _k, v in exact if v)
                distinct = list(forms)
                has_gloss = any(exp.lower() == f.lower() for f in distinct)
                if len(distinct) > 1 or not has_gloss:
                    standalone.append({
                        "한글 용어": ko, "언어": lang, "용어집 번역": exp,
                        "구분": ("단독 표기가 둘 이상" if len(distinct) > 1 else "단독 표기가 용어집과 다름")
                                + ("" if has_gloss else " (용어집 번역 없음)"),
                        "인게임 단독 표기": " | ".join(f"'{f}' ×{c}" for f, c in forms.most_common()),
                        "Keys": " | ".join(f"{k}: {v}" for k, v in exact[:6]),
                    })
            samples = []
            for r, _e in miss[:3]:
                samples.append(f"{r['Keys']} | {r['Korean'][:40]} → {(r.get(LANG_COL[lang]) or '')[:60]}")
            detail.append({
                "한글 용어": ko, "언어": lang, "용어집 번역": exp, "판정": status,
                "용어 사용 항목 수": n, "용어집 번역 사용": used,
                "사용 비율": (used / n) if n else None,
                "게임이 대신 쓰는 표기(후보)": " | ".join(alts),
                "단독 항목의 실제 번역": " | ".join(f"{k}: {v}" for k, v in exact[:3]),
                "불일치 예시": "\n".join(samples),
            })

    print("[4/4] 한글 표기(띄어쓰기) 변형 점검…")
    spacing = []
    for ko in sorted(glossary):
        forms = spacing_variants(ko, korean_texts)
        if len(forms) >= 2:
            ranked = forms.most_common()
            if ranked[1][1] >= 1:
                spacing.append({"용어집 용어": ko, "변형 수": len(ranked),
                                "표기별 사용 횟수": " | ".join(f"'{f}' ×{c}" for f, c in ranked)})
    # 용어집 안에서 공백만 다른 항목
    by_norm = defaultdict(list)
    for ko in glossary:
        by_norm[re.sub(r"\s+", "", ko)].append(ko)
    gloss_conflicts = []
    for norm, kos in by_norm.items():
        if len(kos) < 2:
            continue
        for lang in LANGS:
            vals = {k: str((glossary[k] or {}).get(LANG_COL[lang], "") or "").strip() for k in kos}
            if len({v for v in vals.values() if v}) > 1:
                gloss_conflicts.append({"용어(공백 무시)": norm, "언어": lang,
                                        "정의": " vs ".join(f"'{k}'={v}" for k, v in vals.items()),
                                        "인게임 한글 표기": " | ".join(f"'{f}' ×{c}" for f, c in spacing_variants(norm, korean_texts).most_common())})
    # 용어집 용어이면서 인게임에서 한 번도 쓰이지 않는 항목
    unused = []
    for ko in sorted(glossary):
        if not any(korean_texts and ko in t for t in korean_texts):
            unused.append({"한글 용어": ko, "용어집 번역(ENG)": str((glossary[ko] or {}).get("English", ""))})

    # 용어 단위 요약
    summary = []
    for ko in sorted(glossary):
        per = {d["언어"]: d for d in detail if d["한글 용어"] == ko}
        statuses = {l: per[l]["판정"] for l in LANGS}
        bad = [l for l, s in statuses.items() if s in ("혼용", "미사용", "주로 다른 표기")]
        total = max((per[l]["용어 사용 항목 수"] for l in LANGS), default=0)
        summary.append({"한글 용어": ko, "인게임 사용 항목 수(최대)": total,
                        "문제 언어": ", ".join(bad),
                        **{f"{l}": f"{statuses[l]}" + (f" {per[l]['사용 비율']:.0%}" if per[l]['사용 비율'] is not None and statuses[l] in ('혼용', '미사용', '주로 다른 표기', '소수 예외') else "") for l in LANGS}})

    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill
    wb = openpyxl.Workbook()

    def sheet(title, records, widths=None):
        ws = wb.create_sheet(title)
        if not records:
            ws.append(["(해당 없음)"])
            return ws
        heads = list(records[0].keys())
        ws.append(heads)
        for c in range(1, len(heads) + 1):
            cell = ws.cell(1, c)
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", start_color="1E293B")
        for rec in records:
            ws.append([rec[h] for h in heads])
        for i, h in enumerate(heads, 1):
            ws.column_dimensions[ws.cell(1, i).column_letter].width = (widths or {}).get(h, 18)
        for row in ws.iter_rows(min_row=2):
            for cell in row:
                cell.alignment = Alignment(wrap_text=True, vertical="top")
        ws.freeze_panes = "A2"
        return ws

    wb.remove(wb.active)
    n_bad = sum(1 for d in detail if d["판정"] in ("혼용", "미사용", "주로 다른 표기"))
    n_all = sum(1 for d in detail if d["판정"] != "해당 없음")
    ov = wb.create_sheet("개요")
    ov.append(["항목", "값"])
    for a, b in [("용어집 용어 수", len(glossary)), ("인게임 항목 수", len(rows)),
                 ("용어×언어 점검 대상", n_all), ("조치 필요(혼용·주로 다른 표기·미사용)", n_bad), ("소수 예외(95%+ 일치)", sum(1 for d in detail if d["판정"] == "소수 예외")),
                 ("한글 표기 변형이 있는 용어", len(spacing)), ("용어집 내부 모순", len(gloss_conflicts)),
                 ("인게임 미등장 용어", len(unused)), ("asset", args.asset)]:
        ov.append([a, b])
    ov.column_dimensions["A"].width = 28
    ov.column_dimensions["B"].width = 60
    order = {"미사용": 0, "주로 다른 표기": 1, "혼용": 2, "소수 예외": 3}
    problems = [d for d in detail if d["판정"] in order]
    problems.sort(key=lambda d: (order[d["판정"]], -(d["용어 사용 항목 수"] - d["용어집 번역 사용"]), d["한글 용어"]))
    for d in problems:
        d["사용 비율"] = f"{d['사용 비율']:.0%}"
    sheet("문제 목록", problems, {"한글 용어": 14, "게임이 대신 쓰는 표기(후보)": 36, "단독 항목의 실제 번역": 40, "불일치 예시": 70})
    standalone.sort(key=lambda d: (d["구분"], d["한글 용어"], d["언어"]))
    sheet("단독 표기 분기", standalone, {"인게임 단독 표기": 40, "Keys": 70, "구분": 30})
    sheet("용어별 요약", summary, {"문제 언어": 20})
    sheet("한글 표기 변형", spacing, {"표기별 사용 횟수": 70})
    sheet("용어집 내부 모순", gloss_conflicts, {"정의": 60, "인게임 한글 표기": 50})
    sheet("인게임 미등장 용어", unused)
    wb.save(args.out)

    print(f"\n완료: {args.out}")
    print(f"  점검 {n_all}건 중 조치 필요 {n_bad}건 | 표기 변형 {len(spacing)}개 | 용어집 내부 모순 {len(gloss_conflicts)}건 | 미등장 {len(unused)}개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
