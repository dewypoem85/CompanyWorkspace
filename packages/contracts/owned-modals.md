# 공통 소유 팝업과 React 본문

`CompanyDialog.attach(node, options)`는 앱이 이미 마운트한 native dialog에 공통 수명주기를 연결한다. React는 본문·조건부 렌더링·초안을 소유하고, 공통 코어는 native open/close·중첩 창 순서·Escape·범위 변경·리스너 해제·포커스 복귀를 소유한다. React 어댑터 `useWorkspaceModal`은 생성 파일이며 직접 수정하지 않는다.

## 두 소유 방식

| 용도 | API | DOM 소유와 종료 |
| --- | --- | --- |
| 일회 실행 확인/변경 비교/입력 확인 | `present` / `confirm` | 공통 코어가 body에 추가하고 종료 시 제거. 일회 창은 한 개만 허용 |
| 유지되는 편집기/날짜 선택/이미지 보기 | `attach` / `useWorkspaceModal` | 앱 DOM을 이동·제거하지 않음. 조건부 렌더링/해제는 앱 책임 |

두 방식은 같은 내부 수명주기와 창 스택을 사용한다. 본문 편집창 위에 확인/비교창을 열 수 있으나 공통 확인창끼리 중복 실행되지는 않는다. Portal로 body에 렌더링된 자식도 부모 해제 때 종료된다. 엔티티 선택기와 아직 미전환 native 창의 내부를 모두 이 스택으로 옮긴 것은 아니다.

## 앱 연결

```tsx
const dialog = useRef<HTMLDialogElement>(null);
const modal = useWorkspaceModal(dialog, {
  scope: 'retain',
  canClose: () => !saving,
  beforeCloseRequest: requestDiscard, // Promise<현재 초안 재검증 함수 | null>
  onClose: closeEditor,
});
return <dialog ref={dialog} className="cw-modal" aria-label="업무 편집">
  <button className="cw-button" onClick={() => modal.close()}>닫기</button>
  {/* 업무 본문 */}
</dialog>;
```

- `scope`는 필수이며 한 번 마운트된 창의 고정 정책이다. `retain`은 작성 초안을 유지하는 창, `dismiss`는 날짜/이미지 등 일시 선택창이다. retained UI의 권한·데이터 갱신/저장 잠금은 도메인 읽기/쓰기 계약에서 처리한다. 창을 유지하는 것은 이전 계정의 쓰기 권한을 허용하는 것이 아니다.
- `canClose`는 동기식 사용자 닫기 판단이다. Escape·닫기 버튼·외부 native close에 적용하며 예외나 false는 닫지 않는다. 전송 중 닫기 차단 및 기존 동기 초안 이탈 확인을 보존한다. Promise 반환으로 바꾸지 않는다.
- 비동기 초안 확인은 명시적 `beforeCloseRequest({reason,signal})`와 `requestCloseAsync`를 사용한다. hook은 단순 true가 아니라 적용 직전 현재 초안을 대조하는 함수를 반환한다. 공통 코어는 이 함수와 최종 `canClose`가 모두 strict true일 때만 닫는다. hook의 사용 여부는 같은 노드에 연결할 때 고정하고 React는 최신 callback을 전달한다. 이 경로를 사용하는 창의 직접 동기 `requestClose`는 우회 승인하지 않는다.
- 확인 중 중복 닫기를 거부하고 기존 native dialog/초안을 유지한다. 외부 native close도 즉시 기존 층 순서로 복원한 뒤 확인을 기다린다. scope retain도 대기 중 승인은 취소하며, abort·해제·노드 분리·다른 최상위 창·초안 변경 뒤의 늦은 승인으로 닫지 않는다. 비동기 확인 hook이 abort를 무시해도 공통 요청은 종료된다. 라우트 변경은 별도 계약이며 이 API만으로 메뉴/뒤로가기까지 비동기가 되지는 않는다.
- 범위 무효화(`dismiss`), abort, 부모 해제는 사용자 닫기 판단과 다르다. 강제 정리가 서버 쓰기를 취소/롤백했다는 의미가 아니다. `retain`도 명시적인 abort/해제 시에는 닫힌다.
- `onClose`는 이유(`request`, `cancel`, `close`, `scope`, `abort`, `parent`)를 전달하며 앱의 open state를 정리한다. 자체 `dispose()` 및 열기 실패 때는 앱 state 콜백을 호출하지 않는다. 해제는 반복해도 안전하다.
- 공통 코어는 앱 노드/입력값을 삭제하지 않는다. JSX에 `open`, 개별 `.showModal()`/`.close()`, `onCancel` 수명주기를 중복 작성하지 않는다. React StrictMode·조건부 렌더링·노드 교체 후 이전 native close 이벤트는 새 창을 닫지 않는다.
- 뒤쪽 편집창으로 Escape를 전파하지 않는다. 부모의 외부 native close가 중첩 자식의 순서를 바꾸거나 초안 보호를 우회하지 않도록 한다.
- `returnFocus`는 필요할 때 명시한다. 날짜 선택은 기존 입력으로, 이미지 확대는 이미지 버튼으로 돌아간다. 닫은 뒤 React가 disabled를 해제하면 한 프레임 재시도하되 새 창/사용자가 선택한 포커스를 빼앗지 않는다.

## 프레임과 실제 전환

`.cw-modal`의 배경·글자·선·그림자·backdrop·viewport 한도는 공통 `primitives.css`가 소유한다. drawer는 `data-placement="drawer"`로 사용한다. 앱은 업무 너비·이미지/닫기 버튼 여백·내부 스크롤 등 본문 기하만 소유한다. 접근 가능한 이름은 `aria-label` 또는 `aria-labelledby`로 연결한다.

Schedule의 `TaskPanel`, `Editor.ImageList`, `DatePicker`, `DateNavigation`, `Releases.ReleaseEditor`, `Settings`는 실제 소비자다. 버전 편집창 닫기는 `edit.canCloseNow`/`edit.requestDiscard`로 연결해 잠금과 전체 초안·기준 버전·계정을 다시 대조한다. 메뉴와 뒤로/앞으로 이동도 같은 `requestDiscard`를 공통 라우팅 요청에 연결하며, 승인 전 React 편집 상태나 URL을 제거하지 않는다. 주요 일정 관리 등 나머지 소비자는 기존 동기 가드를 유지한다. 날짜 이동은 열 때 기존 시작일로 초기화하고 native 날짜 검증 후에만 이동한다. 업무·버전·주요 일정 관리는 동일 drawer 기하를 유지한다. 어디에서도 import/등록되지 않는 옛 `Notifications.tsx`는 제거하며 실제 회사 통합 알림은 변경하지 않는다. 다른 앱의 미전환 dialog는 별도로 남는다. TaskPanel의 생성/수정/상태 저장은 `schedule-task-writes.md`, 댓글 저장은 `schedule-comment-writes.md`, 이미지 업로드는 `schedule-image-uploads.md`, 상세/권한/초안은 `schedule-detail-reads.md`를 따른다. 공휴일 조회 등 다른 계약이 이번 프레임 전환으로 자동 완성되는 것은 아니다.

## 검증

Leave 월간 날짜 상세는 Razor 노드를 직접 `attach`하며 `leave-day-detail.md`를 따른다. 기본 스택/테마는 공유하지만 닫고 다시 열기·승인 후 숨김·동적 달력 교체는 해당 도메인 연결이 담당한다. 원래 세 저장 어댑터는 직접 overlay를 숨기지 않는다.

- `dialogs.test.mjs`: 두 DOM 소유 방식, 전체 강제 종료·예외·가드·포커스·초안·재연결.
- `useWorkspaceModal.test.tsx`: 실제 공통 런타임과 React StrictMode/portal/조건부 마운트/노드 교체/늦은 close·계정 범위.
- `check-owned-modals.mjs` 및 변이 테스트: 실제 여섯 소비자의 필수 연결·초안 가드·정책·private 수명주기 복원 차단. 정적 문구 검사는 임의 JSX/DOM 흐름 전체의 증명이 아니다.
- Chrome Schedule: 기존 저장/확인/비교/댓글/이탈 동작, 두 너비/두 테마의 프레임 계산 색·기하, 달력/이미지 포커스, 중첩 native close/Escape·계정 변경 후 초안 유지.
- 공통 코어/CSS 변경은 여섯 서비스 전체 회귀 대상이다. 운영 인증·실제 사용자 데이터·DB를 사용하는 검증과 합성 HTTP 브라우저 검증을 구분한다.
