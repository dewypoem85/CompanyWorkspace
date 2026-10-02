# 초안 폐기와 비동기 상세 전환

CS 플레이어 데이터는 native confirm 대신 기존 `CompanyDialog.confirm`을 사용한다. 확인은 초안을 버리겠다는 의도이며 저장/삭제 실행이나 서버 처리 성공을 뜻하지 않는다. 조회를 확인했더라도 조회가 실패하면 기존 초안은 유지한다.

## 공통 상세 API

- 기존 `CompanyDisclosure.setOpen`/`beforeChange`는 동기 boolean 규약을 유지한다. Promise를 반환해 승인으로 간주하지 않는다.
- 확인을 기다려야 하는 사용처는 `beforeRequest({key, open, signal})`와 `requestOpen(key, open)`을 사용한다. 이 hook을 지정한 그룹의 사용자 클릭만 새 경로를 사용하며, 지정하지 않은 기존 그룹은 동기 동작을 유지한다.
- 요청 중에는 이전 패널·ARIA·필드 값이 유지된다. 중복 요청/클릭은 거부한다. 승인 후에도 패널별 노드·키·열림 상태와 루트 연결을 대조하고 마지막 동기 `beforeChange`를 통과해야 한다. `requested`는 이 경로를 거쳤다는 표시일 뿐 서버 인가가 아니다.
- `refresh`, 직접 `setOpen`, 계정 범위 변경과 `destroy`는 대기 중 요청을 취소한다. hook이 abort를 무시하더라도 요청 관찰은 종료되며 늦은 승인으로 전환하지 않는다. 취소 신호는 하위 확인창에 연결한다. 노드 교체/분리·직접 hidden 변경도 승인 후 대조에서 거부한다.
- 공통 코어는 업무 초안·계정·저장 버전을 해석하지 않는다. 소비자가 확인 전 기준값을 잡고 실제 전환 직전에도 대조한다. 직접 `setOpen`은 확인을 거치지 않으므로 소비자의 동기 가드가 파괴적인 우회를 허용하지 않아야 한다.

## CS 소비자

- `confirmDiscard`는 현재 scope·조회 객체/목록·서버/UID·선택 키·원문/사유/체크값을 캡처한다. 확인하는 동안 기존 pending fieldset을 잠그며, 취소/오류는 원문을 유지한다. 승인 시 boolean만 전달하지 않고 현재성을 다시 확인하는 함수를 반환해 호출자가 적용 직전에 사용한다.
- 다른 키 열기에는 공통 요청 경로와 마지막 승인 검증을 연결한다. 닫기/검색으로 상세를 숨길 때는 초안을 버리지 않는다. 저장 후 동일 키 복원은 기존 내부 경로를 유지한다.
- 서버 변경·새 조회/새로고침·원본 복원·키 추가/삭제 진입·저장 후 목록 재확인은 같은 확인 소유자를 사용한다. 서버 변경을 취소하면 원래 선택으로 돌아가되 더 최근에 바뀐 선택을 이전 취소 응답으로 덮지 않는다.
- 키 추가/삭제는 초안 확인과 실제 업무 확인/입력창이 별개다. 확인 전 원래 트리거를 다음 창의 `returnFocus`로 전달하여 닫기/Escape 후 원래 버튼으로 돌아간다. 초안이 없으면 불필요한 폐기 확인창을 열지 않는다.
- scope/pagehide는 확인창을 닫고 이전 승인을 폐기한다. 조회/저장 API, CSRF·edit token, GZip/lossless 원문·읽기 전용/내부 저장소 및 결과 미확정 보호는 유지한다. 브라우저 탭 닫기/새로고침의 `beforeunload`는 그대로 유지한다.

## 검증과 남은 경계

`disclosure.test.mjs`는 동기 호환·취소·중복·해제·늦은 승인/노드 교체·마지막 가드를 검사한다. 실제 CS 브라우저는 PC/모바일·두 테마의 확인/취소, scope/dispose/원문/대상/패널/검색 변경과 기존 읽기·쓰기·초안·포커스 회귀를 유지한다. 구조 검사는 소비자의 필수 연결을 검사하되 임의 비동기 제어 흐름 전체를 증명하지는 않는다.

Schedule 버전 편집창·주요 일정 설정, 업무 상세 창과 개인 TODO는 공통 비동기 닫기 및 `useWorkspaceNavigationRequest`에 연결한다. 모든 전환은 초안·원문/버전·계정 범위를 승인 직전 다시 대조하고, 취소 시 URL과 React 상태를 유지한다. TODO 페이지 이탈은 새 TODO와 수정 초안을 함께 표시하며 사이드바·링크와 브라우저 history 모두 승인 후에만 적용한다. 브라우저 새로고침·탭 닫기의 `beforeunload`는 별도로 유지한다. 일부 소비자 연결만으로 모든 전환을 완료했다고 보고하지 않는다.

### Schedule 후속 전환의 실제 연결 지점

Schedule의 literal confirm은 0회다. TODO 편집 취소·다른 TODO 편집·목록 탭 전환과 페이지 이탈, Settings 주요 일정 삭제·설정 초안, 댓글과 업무의 기존 전환은 공통 실행/초안 확인으로 전환했다. 페이지 이탈은 새 TODO와 수정 초안을 함께 대조하고 history/navigation 모두 승인 후에만 적용한다.

- generated `useWorkspacePage.navigate`는 `Promise<boolean>`을 반환한다. 동기 가드와 등록된 비동기 요청을 모두 승인한 뒤 URL/화면을 적용하며, `popstate`는 위치가 기록된 history를 원래 항목으로 복구한 후 확인하고 승인 시 같은 대상 항목을 재생한다. 호출자 상태는 반환값이 true일 때만 정리한다. 수정 소유자는 generated 사본이 아닌 `packages/workspace-ui/react/workspace-navigation.tsx`다.
- `App.openId`·`closeTask`·`closeSettings`는 라우트 승인을 기다린 뒤에만 creating/settings/selected 상태를 비운다. `TaskPanel`의 다른 업무/댓글 전환과 창 닫기도 공통 승인과 실제 이동 결과를 기다린다.
- `CompanyDialog.attach.requestClose`/generated modal의 `canClose`는 동기 strict boolean이다. 브라우저 Escape·외부 native close·상위 창 해제·scope retain/dismiss와 중첩 확인창의 포커스는 서로 다른 종료 이유를 가진다. 확인을 기다리는 경로를 명시적으로 추가하고 강제 해제/계정 변경이 늦은 승인으로 무효화되지 않도록 검증한다.
- TODO와 버전 편집은 자체 locked/epoch·계정 스냅샷 및 beforeunload를 가진다. TODO 편집 취소·대상·탭 전환은 이 범위와 서로 배타적인 AbortController를 사용한다. 저장/비교 중 닫기 금지와 결과 미확정 잠금을 보존해야 하며, 남은 페이지 이탈 확인 중 새 입력·대상/계정 변경·여러 이동 요청이 생겼을 때 이전 승인으로 최신 초안을 제거하지 않아야 한다.

기존 `schedule-shell.spec.mjs`의 주요 일정 선택/최신값/닫기/뒤로가기, 업무 history 이탈·다른 업무 링크 전환·업무 창 닫기와 TODO 편집 취소·대상·탭·페이지 이탈의 취소·승인은 공통 창 직접 조작으로 전환했다. TODO 페이지 이동은 PC/모바일·두 테마에서 새/수정 초안 보존, history 복구, native dialog·쓰기 없음까지 검사한다. 이 절은 Schedule의 해당 전환 근거이며 전체 목표 완료 기록이 아니다.
