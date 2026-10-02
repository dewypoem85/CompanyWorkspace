"""Import a reviewed, read-only Google Sheets CellData snapshot. Dry run by default.

No network requests, inferred versions, inferred dates, or updates to existing rows.
Run against a consistent backup first. Stop the service and back up before --apply.
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import sqlite3
from contextlib import closing
from pathlib import Path


def make_plan(source, project_id):
    if source['sheetId'] != 532234269 or source['title'] != '버전내역':
        raise ValueError('Unexpected source sheet')
    if not re.fullmatch(r'[A-Za-z0-9_-]+', source['spreadsheetId']):
        raise ValueError('Invalid spreadsheet ID')
    base_url = f"https://docs.google.com/spreadsheets/d/{source['spreadsheetId']}/edit#gid={source['sheetId']}&range="
    plan = []
    for row in source['rows']:
        number = row['row']
        if number <= 2:
            continue
        cells = {c['cell'][0]: c for c in row['cells'] if c['cell'][0] in 'ABCD'}
        if not cells:
            continue
        values = {key: cells.get(key, {}).get('v', '').strip() for key in 'ABCD'}
        memo = '\n\n'.join(f"[원본 메모 · {c['cell']}]\n{c['note']}" for c in cells.values() if c.get('note'))
        date = None
        if values['C']:
            match = re.fullmatch(r'(\d{4})\.(\d{1,2})\.(\d{1,2})', values['C'])
            if not match:
                raise ValueError(f'Unrecognized date C{number}: {values["C"]}')
            date = dt.date(*map(int, match.groups())).isoformat()
        common = dict(ProjectId=project_id, ReleasedOn=date, Notes=values['D'], Issue=memo,
                      SourceReference=base_url + f'A{number}:D{number}')
        digest = hashlib.sha256(json.dumps(cells, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        if not values['A']:
            if values['B']:
                raise ValueError(f'Final version without base on row {number}')
            plan.append(dict(kind='legacy', sourceHash=digest, **common))
            continue
        if not values['A'].isdigit() or not date:
            raise ValueError(f'Base version or date missing on row {number}')
        base = int(values['A'])
        red = cells['A'].get('red', False)
        common['Notes'] = common['Notes'] or '원본 시트에 주요 내용 미기재'
        if red:
            common['Issue'] += ('\n\n' if memo else '') + f'[원본 표시 · A{number}] 버전 셀이 빨간색으로 표시되어 있습니다.'
        plan.append(dict(kind='release', sourceHash=digest, BaseVersion=base, Minor=0,
                         Status='unstable' if red else 'unrecorded', ReleasedOnUnknown=0, **common))
        if values['B']:
            match = re.fullmatch(r'(\d+)\.(\d+)', values['B'])
            if not match or int(match[1]) != base or int(match[2]) <= 0:
                raise ValueError(f'Unrecognized final version B{number}: {values["B"]}')
            minor = int(match[2]); final_red = cells['B'].get('red', False)
            plan.append(dict(kind='release', sourceHash=digest, ProjectId=project_id,
                             BaseVersion=base, Minor=minor, ReleasedOn=date, ReleasedOnUnknown=1,
                             Notes=f"원본 시트의 최종 버전: {values['B']}\n마이너별 패치 내용과 출시일은 미기재입니다. 기본 버전의 문제·조치 내용에서 원본 메모를 확인할 수 있습니다.",
                             Issue=f'[원본 표시 · B{number}] 최종 버전 셀이 빨간색으로 표시되어 있습니다.' if final_red else '',
                             Status='unstable' if final_red else 'unrecorded', SourceReference=base_url+f'B{number}'))
    return plan


def migrate(database, source, project_id, project_name, apply=False):
    plan = make_plan(source, project_id)
    with closing(sqlite3.connect(database, timeout=30)) as db, db:
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('BEGIN IMMEDIATE' if apply else 'BEGIN')
        project = db.execute('SELECT Name FROM Projects WHERE Id=?', (project_id,)).fetchone()
        if not project or project['Name'] != project_name:
            raise ValueError('Target project name/ID mismatch')
        required = {'ReleasedOnUnknown', 'SourceReference'}
        if not required.issubset({r['name'] for r in db.execute("PRAGMA table_info('Releases')")}):
            raise ValueError('Deploy ReleaseImportSchema before importing')
        ledger_exists = db.execute("SELECT 1 FROM sqlite_master WHERE name='ReleaseSheetImports'").fetchone()
        pending = []; skipped = 0
        for item in plan:
            table = 'Releases' if item['kind'] == 'release' else 'LegacyReleases'
            previous = db.execute('SELECT * FROM ReleaseSheetImports WHERE SourceReference=?', (item['SourceReference'],)).fetchone() if ledger_exists else None
            if previous:
                target = db.execute(f'SELECT SourceReference FROM {table} WHERE Id=?', (previous['TargetId'],)).fetchone()
                if previous['SourceHash'] != item['sourceHash'] or previous['Kind'] != item['kind'] or not target or target[0] != item['SourceReference']:
                    raise ValueError('Previously imported source changed or target missing: ' + item['SourceReference'])
                skipped += 1
                continue
            if item['kind'] == 'release' and db.execute('SELECT 1 FROM Releases WHERE ProjectId=? AND BaseVersion=? AND Minor=?', (project_id, item['BaseVersion'], item['Minor'])).fetchone():
                raise ValueError(f"Existing version conflicts: {item['BaseVersion']}.{item['Minor']}")
            if db.execute(f'SELECT 1 FROM {table} WHERE SourceReference=?', (item['SourceReference'],)).fetchone():
                raise ValueError('Untracked source reference conflicts')
            if len(item['Notes']) > 20000 or len(item['Issue']) > 10000:
                raise ValueError('Content exceeds release field limits')
            pending.append(item)
        if len({(i['ProjectId'], i['BaseVersion'], i['Minor']) for i in plan if i['kind']=='release'}) != sum(i['kind']=='release' for i in plan):
            raise ValueError('Duplicate versions in source')
        before = {table: db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] for table in ['Tasks', 'Comments', 'Attachments', 'Releases', 'LegacyReleases']}
        if apply:
            db.execute('CREATE TABLE IF NOT EXISTS ReleaseSheetImports (SourceReference TEXT PRIMARY KEY, SourceHash TEXT NOT NULL, Kind TEXT NOT NULL, TargetId INTEGER NOT NULL, ImportedAt TEXT NOT NULL)')
            now = dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')
            for item in pending:
                table = 'Releases' if item['kind'] == 'release' else 'LegacyReleases'
                values = {k:v for k,v in item.items() if k not in ('kind', 'sourceHash')}
                if item['kind'] == 'release':
                    values.update(RollbackTargetId=None, ResolvedInId=None, CreatedBy=0, Version=1, UpdatedAt=now)
                keys = list(values)
                target_id = db.execute(f'INSERT INTO {table} ({",".join(keys)}) VALUES ({",".join("?" for _ in keys)})', [values[k] for k in keys]).lastrowid
                if item['kind'] == 'release':
                    snapshot = {k[0].lower()+k[1:]: (bool(v) if k=='ReleasedOnUnknown' else v) for k,v in values.items()}
                    snapshot['id'] = target_id
                    db.execute('INSERT INTO ReleaseRevisions (ReleaseId,ActorId,Snapshot,CreatedAt) VALUES (?,?,?,?)', (target_id,0,json.dumps(snapshot,ensure_ascii=False),now))
                db.execute('INSERT INTO ReleaseSheetImports VALUES (?,?,?,?,?)', (item['SourceReference'],item['sourceHash'],item['kind'],target_id,now))
            for table in ['Tasks', 'Comments', 'Attachments']:
                if db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] != before[table]:
                    raise ValueError('Unrelated data changed')
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or db.execute('PRAGMA foreign_key_check').fetchone():
                raise ValueError('Database integrity check failed')
            db.commit()
        else:
            db.rollback()
        return dict(applied=apply, numbered=sum(i['kind']=='release' and i['Minor']==0 for i in plan),
                    finalMinors=sum(i['kind']=='release' and i['Minor']>0 for i in plan), legacy=sum(i['kind']=='legacy' for i in plan),
                    pending=len(pending), skipped=skipped, before=before)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True); parser.add_argument('--source', required=True)
    parser.add_argument('--project-id', type=int, required=True); parser.add_argument('--project-name', required=True)
    parser.add_argument('--apply', action='store_true'); parser.add_argument('--plan-output')
    args = parser.parse_args()
    source = json.loads(Path(args.source).read_text(encoding='utf-8-sig'))
    if args.plan_output:
        Path(args.plan_output).write_text(json.dumps(make_plan(source,args.project_id),ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(migrate(args.database,source,args.project_id,args.project_name,args.apply),ensure_ascii=False))
