import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';

export function openStore(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(path.resolve(filename)), {recursive:true});
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, idem TEXT NOT NULL, version INTEGER NOT NULL,
      body TEXT NOT NULL, UNIQUE(owner, idem)
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
      body TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      delivered_at TEXT
    );
    CREATE TABLE IF NOT EXISTS bot_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const parse = row => row ? JSON.parse(row.body) : null;
  return {
    db,
    get: id => parse(db.prepare('SELECT body FROM requests WHERE id=?').get(id)),
    byKey: (owner, key) => parse(db.prepare('SELECT body FROM requests WHERE owner=? AND idem=?').get(String(owner),key)),
    list: (owner, admin=false) => (admin ? db.prepare('SELECT body FROM requests ORDER BY rowid').all() : db.prepare('SELECT body FROM requests WHERE owner=? ORDER BY rowid').all(String(owner))).map(parse),
    insert(request, notification) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO requests(id,owner,idem,version,body) VALUES(?,?,?,?,?)').run(request.id,String(request.ownerId),request.idempotencyKey,request.version,JSON.stringify(request));
        if (notification) db.prepare('INSERT INTO outbox(request_id,body) VALUES(?,?)').run(request.id, JSON.stringify(notification));
        db.exec('COMMIT'); return request;
      } catch(error) {db.exec('ROLLBACK');throw error;}
    },
    update(request, expectedVersion) {
      const result=db.prepare('UPDATE requests SET body=?,version=? WHERE id=? AND version=?').run(JSON.stringify(request),request.version,request.id,expectedVersion);
      if (!result.changes) {const error=new Error('Запрос уже изменён. Обновите его.');error.status=409;throw error;}
      return request;
    },
    pendingNotifications: () => db.prepare('SELECT * FROM outbox WHERE delivered_at IS NULL AND attempts < 50 ORDER BY id LIMIT 10').all(),
    delivered: id => db.prepare('UPDATE outbox SET delivered_at=? WHERE id=?').run(new Date().toISOString(),id),
    attempted: id => db.prepare('UPDATE outbox SET attempts=attempts+1 WHERE id=?').run(id),
    getOffset: () => Number(db.prepare("SELECT value FROM bot_state WHERE key='offset'").get()?.value || 0),
    setOffset: offset => db.prepare("INSERT INTO bot_state(key,value) VALUES('offset',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(offset)),
    close: () => db.close(),
  };
}
