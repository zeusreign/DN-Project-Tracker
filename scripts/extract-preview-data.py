"""Read an authorized backup in memory; emit project tables only, never accounts/sessions."""
import sqlite3,zipfile,sys,json
with zipfile.ZipFile(sys.argv[1]) as z:
 sql=z.read('d1-backup.sql').decode()
db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row;db.executescript(sql)
tables=['business_units','projects','development_details','project_updates']
print(json.dumps({t:[dict(r) for r in db.execute('SELECT * FROM '+t)] for t in tables}))
