import importlib.util
import json
import sqlite3
from contextlib import closing
import tempfile
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('importer',Path(__file__).with_name('import-release-sheet.py'))
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class ReleaseImportTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory(); self.db=Path(self.folder.name)/'test.db'
        with closing(sqlite3.connect(self.db)) as db, db:
            db.executescript('''CREATE TABLE Projects(Id INTEGER PRIMARY KEY,Name TEXT); INSERT INTO Projects VALUES(1,'test');
                CREATE TABLE Tasks(Id INTEGER); INSERT INTO Tasks VALUES(99); CREATE TABLE Comments(Id INTEGER); CREATE TABLE Attachments(Id INTEGER);
                CREATE TABLE Releases(Id INTEGER PRIMARY KEY,ProjectId INTEGER,BaseVersion INTEGER,Minor INTEGER,ReleasedOn TEXT,ReleasedOnUnknown INTEGER,Notes TEXT,Issue TEXT,Status TEXT,SourceReference TEXT UNIQUE,RollbackTargetId INTEGER,ResolvedInId INTEGER,CreatedBy INTEGER,Version INTEGER,UpdatedAt TEXT,UNIQUE(ProjectId,BaseVersion,Minor));
                CREATE TABLE LegacyReleases(Id INTEGER PRIMARY KEY,ProjectId INTEGER,ReleasedOn TEXT,Notes TEXT,Issue TEXT,SourceReference TEXT UNIQUE);
                CREATE TABLE ReleaseRevisions(Id INTEGER PRIMARY KEY,ReleaseId INTEGER REFERENCES Releases(Id),ActorId INTEGER,Snapshot TEXT,CreatedAt TEXT);''')
        self.source=dict(spreadsheetId='test',sheetId=532234269,title='버전내역',rows=[
            dict(row=3,cells=[dict(cell='D3',v='번호와 날짜 미기재'),dict(cell='H3',v='제외할 오른쪽')]),
            dict(row=4,cells=[dict(cell='A4',v='770',red=True),dict(cell='B4',v='770.5'),dict(cell='C4',v='2026.7.20'),dict(cell='D4',v='패치',note='문제\n.5에서 수정 완료 ')]),
        ])
    def tearDown(self): self.folder.cleanup()
    def run_import(self,apply=False): return module.migrate(self.db,self.source,1,'test',apply)
    def test_dry_run_import_repeat_preserves_notes_and_unknowns(self):
        self.assertEqual(3,self.run_import()['pending'])
        with closing(sqlite3.connect(self.db)) as db, db: self.assertEqual(0,db.execute('SELECT COUNT(*) FROM Releases').fetchone()[0])
        self.run_import(True); self.assertEqual(3,self.run_import(True)['skipped'])
        with closing(sqlite3.connect(self.db)) as db, db:
            self.assertEqual(2,db.execute('SELECT COUNT(*) FROM Releases').fetchone()[0])
            self.assertIn('문제\n.5에서 수정 완료 ',db.execute('SELECT Issue FROM Releases WHERE Minor=0').fetchone()[0])
            self.assertEqual(('unrecorded',1),db.execute('SELECT Status,ReleasedOnUnknown FROM Releases WHERE Minor=5').fetchone())
            self.assertIsNone(db.execute('SELECT ReleasedOn FROM LegacyReleases').fetchone()[0])
            self.assertEqual(99,db.execute('SELECT Id FROM Tasks').fetchone()[0])
        self.source['rows'][1]['cells'][-1]['note']='원본 변경'
        with self.assertRaises(ValueError): self.run_import(True)
    def test_existing_version_aborts_all_inserts(self):
        with closing(sqlite3.connect(self.db)) as db, db: db.execute("INSERT INTO Releases(ProjectId,BaseVersion,Minor,Notes) VALUES(1,770,0,'기존 기록')")
        with self.assertRaises(ValueError): self.run_import(True)
        with closing(sqlite3.connect(self.db)) as db, db:
            self.assertEqual(0,db.execute('SELECT COUNT(*) FROM LegacyReleases').fetchone()[0])
            self.assertEqual('기존 기록',db.execute('SELECT Notes FROM Releases').fetchone()[0])
    def test_failure_mid_import_rolls_back_everything(self):
        with closing(sqlite3.connect(self.db)) as db, db: db.execute("CREATE TRIGGER reject_minor BEFORE INSERT ON Releases WHEN NEW.Minor>0 BEGIN SELECT RAISE(ABORT,'test failure'); END")
        with self.assertRaises(sqlite3.IntegrityError): self.run_import(True)
        with closing(sqlite3.connect(self.db)) as db, db:
            for table in ['Releases','LegacyReleases','ReleaseRevisions']:
                self.assertEqual(0,db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0])

if __name__=='__main__': unittest.main()
