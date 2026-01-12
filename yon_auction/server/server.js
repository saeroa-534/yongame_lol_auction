/**
 * server.js
 * 연낳대 시즌6 경매 시스템 - 메인 서버
 * 
 * 경매 순서: TOP → MID → BOTTOM(ADC+SUP)
 * 유찰 시: 최소 입찰가 +10pt 증가 후 해당 포지션 마지막으로 이동
 * 팀장 시작 포인트: 1000pt
 */

// === 모듈 불러오기 ===
const fs = require("fs");
const path = require("path");
const http = require("http");

const sqlite3 = require("sqlite3").verbose();
const express = require("express");
const { Server } = require("socket.io");

// 경매 로직 모듈
const { Auction } = require("./auction");
const { setupSockets } = require("./sockets");

// === 서버 설정 ===
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",  // 개발용
    methods: ["GET", "POST"]
  }
});

// Auction 인스턴스 (DB 초기화 후 생성)
let auction = null;

/* === DB 설정 === */

// 경로 설정
const db_DIR = path.join(__dirname, "db");                      // __dirname: 현재 파일(server/server.js)이 위치한 경로
const db_PATH = path.join(db_DIR, "auction.db");                // DB 파일 경로
const schema_SQL_PATH = path.join(db_DIR, "schema.sql");        // schema 파일 경로
const init_data_SQL_PATH = path.join(db_DIR, "init_data.sql");  // 초기 데이터 파일 경로
const reset_SQL_PATH = path.join(db_DIR, "reset.sql");          // DB 리셋 파일 경로

let db = null;  // DB 객체를 저장할 변수

// DB 디렉토리가 없으면 생성하는 함수
function ensureDBdir() {
    if (!fs.existsSync(db_DIR)) {
        fs.mkdirSync(db_DIR, {recursive: true});
    }
}

// SQL 파일을 promise로 실행하는 함수
// sqlite3의 db.exec()는 콜백 기반이므로, 이를 프로미스 기반으로 감싸서 비동기/await 패턴으로 사용할 수 있도록 함
/*. ===== callback 함수란 =====
    - 비동기 작업이 완료된 후 호출되는 함수. 작업이 끝난 후 콜백 함수가 호출되면서 결과를 전달
    - ex) 파일 읽기, 네트워크 요청 등 시간이 걸리는 작업이 끝난 후 실행할 코드를 정의할 때 사용 
    - 비동기란?
        - 시간이 걸리는 작업이 완료될 때까지 기다리지 않고, 다음 코드를 즉시 실행하는 방식
        - ex) 파일 읽기 요청을 보내고, 파일이 완전히 읽히기 전에 다른 작업을 수행할 수 있음
        - 콜백 함수는 비동기 작업이 완료된 후 호출되어 결과를 처리

    - 그럼 무엇이 문제인가?
        - 보통 await/async 패턴을 사용하여 비동기 작업을 기다림. 그러나 콜백 기반 함수는 이를 직접 지원하지 않음
        - sqlite3의 db.exec()는 콜백 기반이므로, 이를 프로미스 기반으로 감싸서 비동기/await 패턴으로 사용할 수 있도록 해야함

*/
/* ===== 문법에 대한 고찰 ===== 
    - new Promise((resolve, reject) => { ... }): 새로운 프로미스 객체를 생성
        - resolve: 작업이 성공했을 때 호출하는 함수
        - reject: 작업이 실패했을 때 호출하는 함수
    - db.exec()의 매개변수
        - sql: 실행할 SQL 명령 문자열 (필수)
        - callback: 실행 완료 후 호출될 콜백 함수 (선택)
    - db.exec(sql, (err) => { ... }): sqlite3의 exec 메서드를 사용하여 SQL 명령을 실행
        - err: 실행 중 발생한 오류 객체(오류가 없으면 null)
    - 삼항 연산자(err ? reject(err) : resolve()): err가 존재하면 reject(err)를 호출하여 프로미스를 실패 상태로 만들고, 그렇지 않으면 resolve()를 호출하여 성공 상태로 만듦

    풀어쓴 버전
    function execSql(sql) {
        return new Promise(function (resolve, reject) {
            db.exec(sql, function (err) {
            if (err) {
                reject(err);   // Promise 실패 처리
            } else {
                resolve();     // Promise 성공 처리
            }
            });
    });
}

*/
function execSql(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}

// SQL 파일을 읽어서 실행하는 함수
/*.===== buffer vs string =====
    - buffer: 바이너리 데이터를 저장하는 객체. 파일을 읽을 때, raw한 바이너리 데이터를 담고 있음
    - string: 텍스트 데이터를 저장하는 객체. buffer를 특정 인코딩(예: utf8)으로 디코딩한 결과
    - fs.readFileSync()는 기본적으로 바이너리(buffer)로 읽어옴
    - 따라서 fs.readFileSync(filePath, "utf8")를 통해 문자열(string)로 읽어와야 함
*/
function execSqlFile(filePath) {
  const sql = fs.readFileSync(filePath, "utf8");
  return execSql(sql);
}

// DB 열기 또는 초기화 함수
async function openOrInitDb() {
  ensureDBdir();
  const isNew = !fs.existsSync(db_PATH);    // DB 파일이 존재하지 않으면 true

  db = new sqlite3.Database(db_PATH);       // DB 파일 열기(없으면 새로 생성)

  await execSql("PRAGMA foreign_keys = ON;");   // SQLite에서는 foreign key 제약 조건이 기본적으로 비활성화 되어 있으므로, 이를 활성화(혹시 모르니까)

  if (isNew) {
    await execSqlFile(schema_SQL_PATH);
    await execSqlFile(init_data_SQL_PATH);
    console.log("✅ auction.db 생성 + schema/init_data 적용 완료");
  } else {
    console.log("✅ 기존 auction.db 사용:", db_PATH);
  }
}

// DB reset 함수
async function resetDb({ reseed = true } = {}) {
  await execSql("PRAGMA foreign_keys = OFF;");
  await execSqlFile(reset_SQL_PATH);
  await execSql("PRAGMA foreign_keys = ON;");
  if (reseed) {
    await execSqlFile(init_data_SQL_PATH);
  }
  console.log("♻️ DB reset 완료 (reseed:", reseed, ")");
}

// === 정적 파일 제공 ===
app.use(express.static(path.join(__dirname, "..", "public")));

// === API 엔드포인트 ===
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// === 서버 실행 ===
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    // 1. DB 초기화
    await openOrInitDb();

    // 2. Auction 인스턴스 생성
    auction = new Auction(db);

    // 3. 소켓 이벤트 핸들러 설정
    setupSockets(io, auction);

    // 4. 관리자용 DB 리셋 핸들러
    io.on("connection", (socket) => {
      socket.on("admin:reset", async () => {
        if (socket.data.role !== "admin") return;

        try {
          // 진행 중인 타이머 정리
          if (auction.timerHandle) {
            clearTimeout(auction.timerHandle);
            auction.timerHandle = null;
            auction.endsAt = null;
          }

          await resetDb({ reseed: true });

          // Auction 인스턴스 재생성
          auction = new Auction(db);
          auction.onStateChange = (state) => io.emit("state", state);

          await auction.broadcastState();
          socket.emit("admin:reset:done", { ok: true });
          console.log("♻️ 관리자 DB 리셋 완료");
        } catch (e) {
          console.error("admin:reset failed:", e);
          socket.emit("admin:reset:done", { ok: false, error: String(e.message) });
        }
      });
    });

    // 5. 서버 시작
    server.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════════╗
║     연낳대 시즌6 경매 시스템                      ║
║     http://localhost:${PORT}                       ║
╠═══════════════════════════════════════════════╣
║  화면 접속 방법:                                 ║
║  - 관리자: /admin.html                          ║
║  - 팀장:   /captain.html?team=T1               ║
║  - 시청자: /viewer.html                         ║
║  - 테스트: /index.html                          ║
╚═══════════════════════════════════════════════╝
      `);
    });

  } catch (e) {
    console.error("❌ 서버 시작 실패:", e);
    process.exit(1);
  }
})();
