# 캐릭터 상세 정렬 표 시각 검증

- Source visual truth: `C:/Users/LTN/.codex/attachments/b982b651-5933-42fb-88be-3464544962d9/codex-clipboard-09cb5dc6-eaa4-4bc4-a498-cfc767e49117.png`
- Source pixels: 1623 × 699
- Implementation: Codex in-app Browser tab 9 capture of `http://127.0.0.1:4174/dist/?visualFixture=character&section=skills`
- Implementation capture: in-app Browser `getScreenshot`, 1264 × 712 output at a 1280px CSS viewport; the browser API did not persist a local screenshot path.
- State: dark theme, character detail `스킬` tab, sorted by clear rate descending; additional `무기·고유룬` and `노드` tab checks completed.
- Density normalization: both artifacts were reviewed at CSS-pixel scale. The source includes a wider crop, so the comparison focused on the content table rather than matching outer page chrome.

## Full-view comparison evidence

- The implementation follows the source hierarchy: section title and guidance, dark header row, rank, entity identity, then right-aligned numeric measures.
- The sort control is visually bound to the active column and exposes ascending/descending direction.
- The table remains inside its panel and does not create document-level horizontal overflow at the 1280px viewport.
- The source includes a play-time column, but character component records do not contain component-level play-time data. The implementation intentionally stops at clear rate instead of showing an empty or misleading column.

## Focused region comparison evidence

- Header and first four rows were inspected at readable scale because sorting affordance, number alignment, icon/name pairing, and row density are the fidelity-critical details.
- `클리어율` descending reordered the first row to `번개 57.9%`.
- `대상` ascending and descending reordered the first row to `마법부여`, then `유체화`, and updated `aria-sort` with the visible arrow.
- The `무기·고유룬` tab rendered four rows with `출정 횟수` descending by default.
- The `노드` tab kept the featured and compact combination sections and rendered 21 individual node rows in the same sortable table.

## Required fidelity surfaces

- Fonts and typography: existing company Inter/Pretendard stack, compact table labels, numeric tabular alignment, and single-line entity truncation are preserved.
- Spacing and layout rhythm: the table uses the existing panel radius and common table spacing; 62px rows retain icon readability without returning to card density.
- Colors and visual tokens: canvas, surface, raised row hover, active sort, muted labels, and success clear-rate values use company workspace tokens.
- Image quality and asset fidelity: the existing entity icon renderer is reused, so supplied game icons and hover detail behavior are preserved without recreated assets.
- Copy and content: labels match the statistics vocabulary: 대상, 출정 횟수, 사용 플레이어, 선택률, 클리어율.

## Findings

- No actionable P0/P1/P2 mismatch remains.
- P3: the source can display component play time, but the current detail response has no per-component duration. Adding that column requires a separate aggregation/data-contract change.

## Comparison history

- Initial implementation review: no P0/P1/P2 layout issue was found. The active sort state, row ordering, table containment, and the three representative tabs were validated without a corrective visual iteration.

## Primary interactions tested

- Clear-rate descending sort.
- Name ascending and descending sort.
- Tab changes between skill, weapon, and node views.
- Document and table overflow measurements at the desktop viewport.

## Console errors checked

- The in-app Browser did not expose a console-message API. No runtime error UI appeared, DOM interaction remained responsive, and all tested state changes completed successfully.

## Implementation checklist

- [x] Replace individual component cards with a common sortable table.
- [x] Keep combination rows in their purpose-built icon-strip layout.
- [x] Expose sort direction visually and through `aria-sort`.
- [x] Preserve hover-detail entity rendering.
- [x] Keep horizontal overflow inside the common table scroller.

final result: passed
