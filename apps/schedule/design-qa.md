# Schedule compact chrome design QA

- Source visual truth: `C:\Users\LTN\AppData\Local\Temp\codex-clipboard-4d15a8d9-b5fb-4e4f-9f59-e4282ad4a8eb.png`
- Implementation screenshot: `C:\dev\docker\company-workspace\artifacts\browser\schedule-shell-short-deskt-22383-hout-wrapping-its-mode-list\compact-schedule-chrome.png`
- Combined comparison: `C:\dev\docker\company-workspace\artifacts\browser\schedule-chrome-before-after.png`
- Viewport and pixels: source 1686×603 px; implementation 1686×603 CSS px and 1686×603 px at device scale factor 1.
- State: dark theme, weekly schedule, employee grouping, view options closed. The source is cropped below the shared workspace shell while the implementation includes that shell, so the comparison uses the schedule-content region rather than the browser/global header.

## Full-view comparison evidence

The source spends roughly 330 px before the schedule grid because mode controls, page heading, period controls, filters and actions occupy separate wrapped rows. The revised content reaches the schedule grid within the automated 200 px limit from the compact mode bar. The 1686 px regression test also confirms that both mode groups share one vertical position, the mode rail has no internal line wrap, the toolbar is at most 60 px high, and the filter row is at most 56 px high.

## Focused comparison evidence

A separate crop was unnecessary because both 1686×603 captures preserve readable control text at 1:1 density. DOM geometry assertions provide focused evidence for the mode rail, toolbar, filter row and grid boundary. Additional browser checks cover 320 px and 1440 px in both light and dark themes, including focus, selected states, searchable pickers and horizontal page overflow.

## Required fidelity surfaces

- Fonts and typography: the shared workspace font, weights and button sizes are unchanged. Compact buttons use the existing 12 px primitive; form controls retain the contract's 13 px minimum and 44 px touch target. Filter labels use a compact floating label without changing their accessible names.
- Spacing and layout rhythm: duplicate visible page heading and redundant hidden `내 일정` toolbar button were removed. Mode, grouping and primary actions now form one compact command bar; period, filters and board actions use bounded one-line overflow instead of increasing page height.
- Colors and visual tokens: all light/dark surfaces, active states, borders and text continue to use shared `--cw-*` tokens. No new page-owned state palette was introduced.
- Image quality and assets: this change introduces no new image assets and preserves existing company, profile and project imagery.
- Copy and content: existing task actions and accessible filter names are preserved. Visible filter labels were shortened to `부서`, `프로젝트`, `담당자`; the `날짜 미정 업무` action and all mode labels remain unchanged.

## Comparison history

1. Initial findings:
   - P1: the schedule controls consumed too much vertical space, leaving little room for the primary grid in a short desktop viewport.
   - P2: view and grouping controls could wrap into multiple lines and were visually split into oversized groups.
   - P2: `팀 일정` and `업무 등록` occupied a separate row even though the shared shell already identifies the service.
2. Fixes:
   - Merged view, grouping, goal management and task creation into one compact command bar.
   - Kept the semantic H1 for assistive technology while removing the duplicated visible title.
   - Converted the mode and action areas to non-wrapping, independently scrollable rails.
   - Reworked filters as 44 px floating-label controls in one bounded row and compacted date/board actions.
3. Post-fix evidence:
   - The 1686×603 density regression passes.
   - The 320 px and 1440 px light/dark interaction suite passes in all four combinations.
   - No document-level horizontal overflow, console errors or unhandled page errors were observed.

## Findings

No actionable P0, P1 or P2 findings remain for the requested schedule-header density and wrapping scope.

## Follow-up polish

- P3: on very narrow screens, the compact rails intentionally scroll horizontally; a subtle edge fade could make that affordance more discoverable later.

final result: passed
