// SQLite-backed session store so sessions survive restarts (MemoryStore is not
// suitable for production).
const DAY = 24 * 60 * 60 * 1000;

module.exports = function createStore(session, db) {
  const get = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?');
  const upsert = db.prepare('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)');
  const del = db.prepare('DELETE FROM sessions WHERE sid = ?');
  const touch = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
  const sweep = db.prepare('DELETE FROM sessions WHERE expires < ?');

  const expiry = (sess) =>
    sess && sess.cookie && sess.cookie.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + DAY;

  class SqliteStore extends session.Store {
    constructor() {
      super();
      this.timer = setInterval(() => sweep.run(Date.now()), 60 * 60 * 1000);
      this.timer.unref();
    }
    get(sid, cb) {
      try {
        const row = get.get(sid);
        if (!row) return cb(null, null);
        if (row.expires < Date.now()) {
          del.run(sid);
          return cb(null, null);
        }
        cb(null, JSON.parse(row.data));
      } catch (err) { cb(err); }
    }
    set(sid, sess, cb) {
      try { upsert.run(sid, JSON.stringify(sess), expiry(sess)); cb && cb(null); }
      catch (err) { cb && cb(err); }
    }
    destroy(sid, cb) {
      try { del.run(sid); cb && cb(null); } catch (err) { cb && cb(err); }
    }
    touch(sid, sess, cb) {
      try { touch.run(expiry(sess), sid); cb && cb(null); } catch (err) { cb && cb(err); }
    }
  }
  return new SqliteStore();
};
