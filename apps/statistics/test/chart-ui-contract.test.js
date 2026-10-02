import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const components = readFileSync(new URL('../client/src/components.tsx', import.meta.url), 'utf8');
const buildDetail = readFileSync(new URL('../client/src/pages/BuildDetail.tsx', import.meta.url), 'utf8');
const bossDetail = readFileSync(new URL('../client/src/pages/BossDetail.tsx', import.meta.url), 'utf8');
const builds = readFileSync(new URL('../client/src/pages/Builds.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../client/src/pages/Dashboard.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../client/src/layout.css', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../client/src/styles.css', import.meta.url), 'utf8');
const shared = readFileSync(new URL('../client/src/shared.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../client/src/App.tsx', import.meta.url), 'utf8');
const server = readFileSync(new URL('../app-server.js', import.meta.url), 'utf8');
const users = readFileSync(new URL('../client/src/pages/Users.tsx', import.meta.url), 'utf8');
const document = readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
const refresh = readFileSync(new URL('../public/refresh.js', import.meta.url), 'utf8');

test('그래프는 표본 없는 점만 제외하고 0%인 실제 기록과 상세 툴팁을 유지한다', () => {
  assert.match(components, /Number\.isFinite\(point\.value\)&&point\.hasData/);
  assert.match(components, /hasData:hasData\?\.\[index\]\?\?true/);
  assert.match(components, /표본이 없는 항목을 제외한 시간 순서 추이 그래프/);
  assert.match(buildDetail, /hasData=\{item\.versions\.map\(version=>version\.runs>0\)\}/);
  for (const label of ['출정', '클리어', '선택률', '클리어율']) {
    assert.match(buildDetail, new RegExp(`label:'${label}'`));
  }
});

test('통계 PC 레이아웃은 회사 공통 셸을 사용하고 그래프 기하만 앱이 소유한다', () => {
  assert.match(document, /data-company-workspace data-company-service="statistics"/);
  assert.match(app, /className="cw-sidebar" data-workspace-navigation="statistics"/);
  assert.match(app, /className="workspace cw-main statistics-main"/);
  assert.doesNotMatch(app, /statistics-sidebar|statistics-brand|statistics-nav/);
  assert.match(layout, /global frame is owned by company-workspace/);
  assert.match(styles, /\.chart-wrap \{/);
  assert.match(styles, /\.chart-wrap svg \{/);
  assert.match(styles, /grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,340px\),1fr\)\)/);
});

test('대시보드 그래프는 컨테이너 전체 폭과 7·30·90일 전환을 제공한다', () => {
  assert.match(components, /new ResizeObserver\(update\)/);
  assert.match(components, /const width=Math\.max\(640,availableWidth\)/);
  assert.match(dashboard, /\[7,30,90\]\.map/);
  assert.match(dashboard, /className="quick chart-period"/);
  assert.match(styles, /\.dashboard-trend-panel \.chart-wrap/);
});

test('캐릭터 상세는 항목별 탭으로 나누고 대표 노드 조합만 크게 표시한다', () => {
  assert.match(buildDetail, /type CharacterSection='overview'\|'nodes'\|'skins'\|'weapons'\|'pets'\|'skills'\|'artifacts'\|'combinations'/);
  assert.match(buildDetail, /role="tablist"/);
  assert.match(buildDetail, /section==='nodes'/);
  for (const [section,type] of [['skins','skins'],['weapons','weapons'],['pets','pets'],['skills','skills'],['artifacts','artifacts']]) {
    assert.match(buildDetail, new RegExp(`section==='${section}'\\?[^\\n]+types=\\{\\['${type}'\\]\\}`));
  }
  assert.doesNotMatch(buildDetail, /section==='equipment'|section==='abilities'/);
  assert.match(buildDetail, /<NodeCombinationTree combination=\{combinations\[0\]\}/);
  assert.match(buildDetail, /combinations\.slice\(1,10\)/);
  assert.match(styles, /\.detail-tabs \{ display:grid/);
  assert.match(styles, /\.node-combination-compact-list \{ display:grid/);
});

test('로그가 없는 죄악 포인트 탭은 사용자 화면에 노출하지 않는다', () => {
  assert.doesNotMatch(builds, /\['sinPoints','죄악 포인트'\]/);
  assert.doesNotMatch(buildDetail, /\['sins','죄악','7종 포인트 분배'\]/);
  assert.doesNotMatch(buildDetail, /SinPointSection|SIN POINTS|SinPoints/);
  assert.doesNotMatch(bossDetail, /죄악 포인트/);
  assert.match(bossDetail, /filter\(\(\[type\]\)=>type!==['"]sinPoints['"]\)/);
  assert.doesNotMatch(styles, /\.sin-point-groups|\.sin-point-distribution/);
});

test('캐릭터 종합 탭은 핵심 선택과 대표 조합 및 성과를 함께 요약한다', () => {
  for (const label of ['핵심 선택 요약', '대표 전체 조합', '인기 노드 조합', '성과 요약']) {
    assert.match(buildDetail, new RegExp(label));
  }
  for (const type of ['skins', 'weapons', 'pets', 'skills', 'artifacts']) {
    assert.match(buildDetail, new RegExp(`type:'${type}'`));
  }
  assert.match(buildDetail, /components\.combinations\?\.length\?'combinations':'combinationsWithNodes'/);
  assert.match(buildDetail, /components\.nodeCombinations\|\|\[\]/);
  assert.match(styles, /\.overview-summary-layout \{ display:grid/);
  assert.match(styles, /\.overview-pick-groups \{ display:grid/);
});

test('노드 조합 아이콘은 마우스와 키보드 포커스에서 노드 이름을 표시한다', () => {
  assert.match(shared, /tooltipLabel\?:string/);
  assert.match(shared, /className="entity-name-tooltip is-visible" role="tooltip"/);
  assert.match(shared, /createPortal\(tooltip,document\.body\)/);
  assert.match(shared, /캐릭터 출정 기준 선택률/);
  assert.match(shared, /노드 코드/);
  assert.match(components, /tooltipLabel=\{String\(item\.name\|\|id\)\}/);
  assert.match(components, /nodeStageSelectionRates\(items\)/);
  assert.match(components, /rateLabel="같은 단계 선택 기준"/);
  assert.match(buildDetail, /tooltipLabel=\{String\(node\.name\|\|node\.id\|\|'노드'\)\}/);
  assert.match(styles, /\.entity-name-tooltip \{ position:fixed/);
  assert.match(styles, /\.entity-name-tooltip\.is-visible/);
  assert.match(styles, /\.node-stage:hover,\.node-stage:focus-within \{ z-index:70/);
  assert.match(styles, /\.node-choice:hover,\.node-choice:focus-within \{ z-index:71/);
});

test('유저 지표는 계정 UID 중복 제거 사용률과 진척·이탈을 별도 화면에 제공한다', () => {
  assert.match(app, /route\.name==='users'/);
  assert.match(users, /고유 사용자 사용률/);
  assert.match(users, /챕터 도달률/);
  assert.match(users, /첫 출정 시간과 이탈/);
  assert.match(users, /단계별 도달·이탈/);
  assert.match(styles, /\.user-usage-grid \{ display:grid/);
  assert.match(styles, /\.user-metric-grid \{ display:grid/);
});

test('노드 조합 행은 불필요한 대표·순번 이름 없이 아이콘과 지표만 표시한다', () => {
  assert.doesNotMatch(components, /<strong>대표 조합<\/strong>/);
  assert.doesNotMatch(buildDetail, /노드 조합 \{rank\}/);
  assert.doesNotMatch(buildDetail, /node-combination-rank/);
  assert.match(buildDetail, /<div className="compact-node-icons">/);
  assert.match(buildDetail, /<h2>인기 노드 조합<\/h2>/);
});

test('모든 항목 아이콘에 이름 툴팁을 제공하고 조합 목록은 별도 이름을 표시하지 않는다', () => {
  assert.match(shared, /tooltipLabel\?\?detail\?\.name\?\?item\.name\?\?''/);
  assert.match(shared, /resolveEntityDetail\(type,item\)/);
  assert.match(shared, /detail\?\.sections\.map/);
  assert.match(shared, /type==='nodes'\?'캐릭터 출정 기준 선택률':'현재 조건 선택률'/);
  assert.match(components, /\['combinations','combinationsWithNodes','nodeCombinations'\]\.includes\(type\)/);
  assert.match(components, /if\(combined\)return <div className="entity-name combined"/);
  assert.doesNotMatch(buildDetail, /name:`조합 \$\{/);
  assert.doesNotMatch(builds, /name:`조합 \$\{/);
  assert.match(builds, /<EntityName type=\{type\} item=\{item\}\/>/);
  assert.match(buildDetail, /isCombinationDetail\?`\$\{LABELS\[type\]\|\|'조합'\} 상세`/);
});

test('관리자는 사이트에서 Google Sheets 상세정보를 안전하게 갱신할 수 있다', () => {
  assert.match(app, /user\?\.isAdmin/);
  assert.match(app, /설명 갱신/);
  assert.match(app, /X-Statistics-Intent':'entity-details-refresh-v1/);
  assert.match(server, /\/api\/admin\/entity-details\/refresh/);
  assert.match(server, /if \(!user\.isAdmin\)/);
  assert.match(server, /input\.expectedUserId !== user\.id \|\| input\.expectedRole !== user\.role/);
});

test('캐릭터 상세의 개별 구성은 같은 열 기준으로 정렬 가능한 표를 사용한다', () => {
  assert.match(buildDetail, /function SortableComponentTable/);
  assert.match(buildDetail, /const \[sort,setSort\]=useState<ComponentSort>\('runs'\)/);
  assert.match(buildDetail, /aria-sort=\{ariaSort\('name'\)\}/);
  for (const [label,field] of [['대상','name'],['출정 횟수','runs'],['사용 플레이어','uniquePlayers'],['선택률','selectionRate'],['클리어율','clearRate']]) {
    assert.match(buildDetail, new RegExp(`label="${label}" field="${field}"`));
  }
  assert.match(buildDetail, /<EntityName type=\{componentType\} item=\{component\} showRate=\{false\}\/>/);
  assert.match(buildDetail, /data-tone="success" className="good"/);
  assert.match(styles, /\.component-table \{ min-width:760px/);
  assert.match(styles, /\.component-table tbody tr:hover/);
  assert.doesNotMatch(buildDetail, /className="component component-with-rates"/);
  assert.match(buildDetail, /className="overview-pick build-detail-trigger"[\s\S]*className="component-rate-pair"/);
});

test('캐릭터 상세의 모든 구성 항목은 개별 상세 페이지와 왕복 연결된다', () => {
  assert.match(buildDetail, /function useOpenBuildDetail/);
  assert.match(buildDetail, /fromCharacterKey/);
  assert.match(buildDetail, /fromSection/);
  assert.match(buildDetail, /'← 캐릭터 상세'/);
  assert.match(buildDetail, /type==='combinationsWithNodes'\?'combinations':type/);
  assert.match(buildDetail, /params\.set\('includeNodes','1'\)/);
  assert.match(buildDetail, /<OverviewCombinations items=\{combinations\} componentType=\{combinationType\}\/?>/);
  assert.match(buildDetail, /onClick=\{\(\)=>openDetail\(group\.type,component\)\}/);
  assert.match(buildDetail, /onClick=\{\(\)=>openDetail\(componentType,component\)\}/);
  assert.match(buildDetail, /openDetail\('nodeCombinations',combinations\[0\]\)/);
  assert.match(buildDetail, /openDetail\('nodes',node\)/);
  assert.match(buildDetail, /openDetail\(group\.type,related\)/);
  assert.match(styles, /\.build-detail-trigger/);
});

test('조합 탭은 조합을 좁은 카드로 쪼개지 않고 전체 폭 한 줄로 표시한다', () => {
  assert.match(buildDetail, /combinationOnly/);
  assert.match(buildDetail, /combination-sections/);
  assert.match(buildDetail, /combination-metrics/);
  assert.match(styles, /\.detail-section-grid \.component-grid\.combination-component-grid\s*\{\s*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(styles, /\.entity-name\.combined \.icon-strip\s*\{[^}]*flex-wrap:nowrap;[^}]*overflow-x:auto/);
});

test('각 항목 상세에 보스 처치 시간과 요청한 연관 통계를 표시한다', () => {
  for (const label of ['마지막 보스 평균 처치 시간', '가장 많이 사용된 시너지 타입', '가장 많이 사용된 캐릭터', '가장 많이 사용된 무기', '가장 많이 같이 사용된 스킬', '가장 많이 같이 사용된 유물']) {
    assert.match(buildDetail, new RegExp(label));
  }
  assert.match(buildDetail, /boss\.kills\?`\$\{formatNumber\(boss\.kills\)\}회 처치 기준`:'처치 기록 없음'/);
  assert.match(buildDetail, /formatDuration\(boss\.averageMs\)/);
  assert.match(styles, /\.item-insights-grid\.has-associations \{ grid-template-columns/);
  assert.match(styles, /\.boss-time-list article/);
  assert.match(styles, /\.related-insight,\.synergy-insight/);
});

test('백그라운드 집계 확인은 페이지 높이를 바꾸는 상태 카드를 노출하지 않는다', () => {
  assert.match(refresh, /readStatus\(\{ passive = false \} = \{\}\)/);
  assert.match(refresh, /startPolling\(\) \{ if \(current\(\)\) \{ hideStatus\(\); timer = setTimeout\(\(\) => void readStatus\(\{ passive: true \}\)/);
  assert.match(refresh, /if \(passive\) \{ hideStatus\(\); return; \}/);
  assert.match(styles, /\.refresh-state:not\(\[hidden\]\) \{ position:fixed;/);
});
