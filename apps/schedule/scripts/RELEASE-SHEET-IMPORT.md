# 버전 시트 이전

`import-release-sheet.py`는 Google Sheets에서 읽은 셀 값·메모·빨간색 표시의 검토된 JSON 스냅샷을 사용한다. 원본 시트를 수정하거나 네트워크를 호출하지 않는다. 실제 스냅샷과 이전 계획은 `.cache/` 또는 백업 디렉터리에 보관하고 커밋하지 않는다.

## 매핑

- 지정된 `버전내역` 탭의 A~D열만 읽는다. E~H열은 제외한다.
- A: 기본 버전, B: 시트에 명시된 최종 마이너, C: 최초 업데이트, D: 주요 내용.
- A가 비어 있는 행은 `LegacyReleases`에 원본 순서로 보존한다. 날짜도 비어 있으면 NULL로 보존한다. 앞 행의 날짜나 번호로 채우지 않는다.
- A~D의 모든 메모는 셀 주소와 원문을 기본 버전의 `Issue`에 보존한다.
- 빨간 A/B 셀만 해당 버전의 `unstable` 상태로 이전한다. 표시가 없으면 안정 여부를 추정하지 않고 `unrecorded`로 보존한다. 기능 롤백 메모만으로 앱 전체의 복귀 버전을 만들지 않는다.
- B에 있는 최종 마이너만 별도 기록한다. 중간 마이너를 임의 생성하지 않는다. 마이너 날짜는 DB 호환용 기본 날짜와 `ReleasedOnUnknown=true`를 함께 저장하며 UI에서는 **출시일 미기재**로 표시한다. 날짜를 확인해 입력하면 이 플래그를 해제한다.
- SourceReference는 원본 행/셀 링크이다. 이후 일반 편집 API로 변경할 수 없다. CreatedBy/ActorId 0은 사람을 추정하지 않은 시스템 이전 기록이며, UI에 '기존 시트에서 이전'으로 표시된다.

## 실행

1. DB·첨부 전체 백업을 확보한다. 백업 복사본에 새 앱의 `ReleaseImportSchema`를 적용한다.
2. 복사본에서 사전 검사, 적용, 같은 입력 재실행을 확인한다. `--apply`가 없으면 트랜잭션을 롤백한다.

```powershell
python scripts/import-release-sheet.py --database <copy.db> --source <source.json> --project-id <id> --project-name <정확한이름> --plan-output <plan.json>
python scripts/import-release-sheet.py --database <copy.db> --source <source.json> --project-id <id> --project-name <정확한이름> --apply
```

3. 새 앱을 배포한 후 운영 데이터에 같은 사전 검사를 실행한다. 적용 시에는 서비스를 잠시 멈추고 동일 파일·프로젝트로 `--apply`를 실행한 뒤 서비스를 재시작한다.
4. 메모 원문·버전 수·미기재 수·프로젝트 범위·첨부 무결성을 검증한다.

전체 검증과 쓰기는 하나의 SQLite 트랜잭션이다. 기존 동일 번호가 있거나 원본이 바뀌었으면 기존 기록을 덮어쓰지 않고 중단한다. `ReleaseSheetImports`의 원본별 해시·대상 ID로 재실행 시 중복을 방지한다. 오류 시 전체 삽입이 롤백되며, 운영 반영 전 백업은 별도로 유지한다. 이전 후 이용자가 수정한 기록도 재실행으로 덮어쓰지 않는다.

테스트: `python scripts/test-import-release-sheet.py`, `dotnet test tests -c Release`.
