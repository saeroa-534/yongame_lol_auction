const path = require("path");
const fs = require("fs/promises");
const sqlite3 = require("sqlite3").verbose();


const DB_DIR = path.join(__dirname, "db");
const DB_PATH = process.env.DB_PATH || path.join(DB_DIR, "auction.db");
const SCHEMA_SQL_PATH = path.join(DB_DIR, "schema.sql");
const RESET_SQL_PATH = path.join(DB_DIR, "reset.sql");
const INIT_DATA_SQL_PATH = path.join(DB_DIR, "init_data.sql");

let db = null;  // sqlite3.Database 인스턴스를 재사용하기 위해
let resettingPromise = null;    // reset 동시에 여러 번 호출되는 것 방지 (락)

/** DB 연결 (한 번 열고 재사용) */
async function openDb() {
  if (db) return db;

  db = await new Promise((resolve, reject) => {
    const instance = new sqlite3.Database(DB_PATH, (err) => {
      if (err) reject(err);
      else resolve(instance);
    });
  });

  await execSql("PRAGMA foreign_keys = ON;");

  return db;
}

/** DB 닫기 */
async function closeDb() {
  if (!db) return;

  const instance = db;
  db = null;

  await new Promise((resolve, reject) => {
    instance.close((err) => (err ? reject(err) : resolve()));
  });
}

/** 여러 SQL 문 실행 (세미콜론으로 이어진 스크립트 포함) */
async function execSql(sql) {
  const instance = await openDb();
  return new Promise((resolve, reject) => {
    instance.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

/** .sql 파일 읽어서 실행 */
async function execSqlFile(filePath) {
  const sql = await fs.readFile(filePath, "utf8");
  return execSql(sql);
}

/** SELECT 한 줄 */
async function get(sql, params = []) {
  const instance = await openDb();
  return new Promise((resolve, reject) => {
    instance.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

/** SELECT 여러 줄 */
async function all(sql, params = []) {
  const instance = await openDb();
  return new Promise((resolve, reject) => {
    instance.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

/** INSERT/UPDATE/DELETE */
async function run(sql, params = []) {
  const instance = await openDb();
  return new Promise((resolve, reject) => {
    instance.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

// ===================================================
/**
 * initDb:
 * - schema.sql 적용(테이블 생성/보장)
 * - reseed=true면 reset.sql + init_data.sql까지 재주입
 * - reseed=false면 "비어있을 때만" init_data.sql 주입
 */
async function initDb({ reseed = false } = {}) {
  await openDb();
  await execSqlFile(SCHEMA_SQL_PATH);

  if (reseed) {
    await execSqlFile(RESET_SQL_PATH);
    await execSqlFile(INIT_DATA_SQL_PATH);
    return;
  }

  // players 테이블이 있다고 가정(네 schema 기준). 비었을 때만 seed
  const row = await get("SELECT COUNT(*) AS cnt FROM players;");
  if (!row || row.cnt === 0) {
    await execSqlFile(INIT_DATA_SQL_PATH);
  }
}

/**
 * resetDb:
 * - 동시에 여러 번 호출돼도 1번만 실행되도록 락
 * - reseed=true면 reset 후 init_data.sql 재주입
 */
async function resetDb({ reseed = true } = {}) {
  if (resettingPromise) return resettingPromise;

  resettingPromise = (async () => {
    await openDb();
    await execSqlFile(RESET_SQL_PATH);
    if (reseed) {
      await execSqlFile(INIT_DATA_SQL_PATH);
    }
  })().finally(() => {
    resettingPromise = null;
  });

  return resettingPromise;
}

module.exports = {
  // paths
  DB_PATH,
  SCHEMA_SQL_PATH,
  RESET_SQL_PATH,
  INIT_DATA_SQL_PATH,

  // connection
  openDb,
  closeDb,

  // helpers
  execSql,
  execSqlFile,
  get,
  all,
  run,

  // lifecycle
  initDb,
  resetDb,
};