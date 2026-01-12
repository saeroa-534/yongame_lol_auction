//  === Node.js의 내장모듈과 외부 라이브러리 불러오기 ===
const fs = require("fs");                       // Node.js의 내장 모듈 fs(File System)를 가져옴. 파일 및 디렉토리 작업을 수행하는 기능 제공
const path = require("path");                   // Node.js의 내장 모듈 path를 가져옴. path 모듈을 통해 운영체재와 상관없이 파일의 경로를 다룰 수 있음
const http = require("http");                   // Node.js의 내장 모듈 http를 가져옴. http 모듈은 HTTP 서버와 클라이언트를 만들기 위한 기능을 제공함

const sqlite3 = require("sqlite3").verbose();   // sqlite3 라이브러리를 가져옴. verbose(): 디버깅 정보를 더 많이 출력하도록 설정(디버깅 용이)
const express = require("express");             // express 라이브러리를 가져옴. xpress는 Node.js에서 가장 많이 사용되는 웹 프레임워크중 하나이며, HTTP 서버를 쉽게 만들고, 라우팅/정적파일 제공 등을 편하게 함
const { Server } = require("socket.io");        // socket.io 라이브러리에서 Server 클래스를 가져옴. 웹 소켓 기반의 실시간 통신 버서를 만들기 위한 핵심 객체

// === 서버 설정 및 생성 ===
const app = express();                          // express 어플리케이션의 인스턴드를 생성. app 변수는 요청 처리 규칙(미들웨어/라우트)를 설정하는데 사용

// HTTP 서버를 생성
// express 어플리케이션을 인자로 전달하여, 서버가 요청을 받으면 app(express)가 HTTP 요청을 처리할 수 있도록 함
// 즉, HTTP의 실서버 = server, 요청 처리 로직 = app
const server = http.createServer(app);

// socket.io 서버를 생성
// HTTP(웹페이지)와 Socket.io(실시간)가 같은 포트를 공유할 수 있음
// Socket.io - HTTP(서버) - express(처리)
const io = new Server(server);

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
/* === ({reseed = true} = {})의 의미 ===
    - 함수의 매개변수로 객체를 받고, 그 객체의 reseed 속성에 기본값 true를 설정
    - 즉, resetDb() 함수 호출 시 reseed 옵션을 명시하지 않으면 기본적으로 true로 처리됨
    - 예시:
        resetDb();              // reseed = true (기본값)
        resetDb({reseed: false}); // reseed = false (명시적 지정)

    - 함수의 매개변수를 객체로 받는 이유?
        - 옵션이 많아질 경우, 매개변수를 일일이 지정하는 것보다 객체로 받는 것이 편리 (순서 신경 안써도 됨)
        - 기본값을 이용해서 선택 옵션을 처리하기 쉬움
        - 가독성이 좋아지고, 호출 시 어떤 옵션이 사용되는지 명확해짐
        - "구조 분해 할당"과 함께 사용 됨
    
    - 구조 분해 할당(Destructuring Assignment)이란?
        - 객체나 배열의 속성/요소를 개별 변수로 쉽게 추출하는 문법
        - ex) 
            const obj = {a: 1, b: 2};
            const {a, b} = obj; // a=1, b=2
        - obj.a를 매번 쓰는 대신 a로 바로 접근 가능

    - 객체를 미리 선언을 안해도 되는 이유
        - 즉석에서 객체를 생성하여 함수에 전달하는 방식

    - reset을 하는데 reseed 옵셥이 필요하지는 않음. 무조건 초기값을 넣을거니깐. 만약 초기값을 넣지 않는다고 하면 고려될 수도 있음
        - 공부용으로 남겨둠
*/

async function resetDb({ reseed = true } = {}) {
  await execSql("PRAGMA foreign_keys = ON;");
  await execSqlFile(reset_SQL_PATH);
  if (reseed) {
    await execSqlFile(init_data_SQL_PATH);
  }
  console.log("♻️ DB reset 완료 (reseed:", reseed, ")");
}



// admin의 DB 리셋 요청 처리
let resettingDB = false;

socket.on("admin:reset", async () => {
  if (socket.data.role !== "admin") return;

  // ✅ 락: 이미 reset 중이면 거절
  if (resettingDB) {
    socket.emit("admin:reset:done", { ok: false, error: "이미 초기화 진행 중입니다." });
    return;
  }

  resettingDB = true;
  try {
    await resetDb({ reseed: true });

    // 메모리 상태도 초기화
    state.phase = "idle";
    state.index = 0;
    state.highestBid = 0;
    state.highestBidder = null;
    state.endsAt = null;
    state.results = [];
    broadcastState();

    socket.emit("admin:reset:done", { ok: true });
  } catch (e) {
    console.error("admin:reset failed:", e);
    socket.emit("admin:reset:done", { ok: false, error: String(e.message || e) });
  } finally {
    resettingDB = false; // ✅ 무조건 락 해제 (성공/실패 상관없이)
  }
});


// === 정적 파일(프론트) 설정 ===

// 브라우저에서 localhost:3000에 접속했을 때 public/index.html을 제공하도록 설정
/*
    __dirname: 현재파일(server/index.js)이 위치한 경로. 실행중인 파일이 들어 있는 폴더의 절대경로를 반환하는 특수 값
    path.join(__dirname, "..", "public"): 상위폴더로 이동 후(".."), public 폴더 경로와 합침
    express.static(): 경로 안의 파일들을 정적 파일로 제공
        ex)
        - /index.html 요청 -> public/index.html을 반환
        - /style.css를 요청 -> public/style.css를 반환
    app.use(): 들어오는 모든 요청에 대해 이 미들웨어를 적용해라

    --> public 폴더가 웹서버의 루트처럼 동작하게 함
*/
app.use(express.static(path.join(__dirname, "..", "public")));

// === Socket.io 이벤트 처리 ===

// io.on(connection, 콜백): 새로운 클라이언트가 접속했을 때 발생하는 이벤트
// callback의 매개변수 socket은 접속한 클라이언트와 통신할 수 있는 객체
io.on("connection", (socket) => {
    
    const role = socket.handshake.auth.role || "viewer";
    socket.data.role = role;

    socket.emit("state", publicState());
    console.log("connected: ", socket.id, "role: ", role);


    // 접속자가 "bid" 이벤트를 보내면 실행되는 핸들러
    /*
        data: 크라이언트가 보낸 객체
        io.emit("bid", ...): 현재 서버에 연결된 모든 사람들에게 bid 이벤트를 보냄
            -> 즉, 누가 입찰하든 모든 접속자의 화면이 즉시 갱신되는 구조
        (...data, at: Date.now()): 크라이언트가 보낸 데이터에 at 속성을 추가하여 현재 시간을 기록
    */

    // ===== 입찰 처리 =====
    socket.on("bid", (data) => {
        if (state.phase !== "running") {
            socket.emit("bidRejected", { reason: "경매가 진행 중이 아닙니다." });
            return;
        }
        const name = String(data?.name ?? "익명").slice(0,20);
        const price = Number(data?.price);

        if (!Number.isFinite(price) || price <= 0) {
            socket.emit("bidRejected", { reason: "입찰가는 1 이상의 숫자여야 합니다."});
            return;
        }

        if (price <= state.highestBid) {
            socket.emit("bidRejected", { reason: `입찰가는 현재 최고 입찰가(${state.highestBid}원)보다 높아야 합니다.`});
            return;
        }

        state.highestBid = price;
        state.highestBidder = name;

        broadcastState();
    });

    // ====== 관리자 컨트롤(일단 role=admin이면 허용) ======
    socket.on("admin:start", () => {
        if (socket.data.role !== "admin") return;
        startAuction();
    });

    socket.on("admin:end", () => {
        if (socket.data.role !== "admin") return;
        endAuction();
    });
    socket.on("admin:reset", () => {
        if (socket.data.role !== "admin") return;
        state.phase = "idle";
        state.index = 0;
        state.highestBid = 0;
        state.highestBidder = null;
        state.endsAt = null;
        state.results = [];
        broadcastState();
    });
});

// === 서버 실행 ===

const PORT = 3000; // 서버가 사용할 포트 번호

// server.listen(PORT, ...): 해당 포트로 서버를 열고 요청을 받기 시작
// callback은 서버가 성공적으로 켜졌을 때 한 번 실행 됨
// server.listen(PORT, () => {
//     console.log(`http://localhost:${PORT}`);    // 콭솔에 접속 주소 출력
// });

// DB 초기화 후 서버 시작
(async () => {
  try {
    await openOrInitDb();
    server.listen(PORT, () => {
      console.log(`http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error("❌ DB init failed:", e);
    process.exit(1);
  }
})();


// === 테스트 ===
const items = ["탑A", "탑B", "탑C", "미드A", "미드B", "원딜A", "서폿A"];    // 테스트를 위한 라인 배열

// 서버 상태
const state = {
    phase: "idle",  // 현재 상태: idle, running, ended
    index: 0,   // 현재 경매 대상
    highestBid: 0,  // 현재 최고 입찰가
    highestBidder: null,    // 현재 최고 입찰자
    endsAt: null,   // 경매 종료 시간
    results: [] // 최종 낙찰 결과
}

function currentItem() {
    return items[state.index] ?? null;
}

// 클라이언트에게 보내는 정보
function publicState() {
    return {
        phase: state.phase,
        item: currentItem(),
        index: state.index,
        total: items.length,
        highestBid: state.highestBid,
        highestBidder: state.highestBidder,
        endsAt: state.endsAt,
        results: state.results
    }
}

// 서버에 연결된 모든 사람에게 현재 상태를 이벤트로 방송
function broadcastState() {
    io.emit("state", publicState());
}

function startAuction(durationMs = 30000) {
    if (!currentItem()) {
        state.phase = "ended";
        state.endsAt = null;
        broadcastState();
        return;
    }
    
    state.phase = "running";
    state.highestBid = 0;
    state.highestBidder = null;
    state.endsAt = Date.now() + durationMs;
    broadcastState();
}

function endAuction() {
    if (state.phase !== "running") return;

    const item = currentItem();
    state.results.push({
        item,
        winner: state.highestBidder,
        price: state.highestBid,
        endedAt: Date.now()
    });

    state.index += 1;
    state.phase = "idle"
    state.endsAt = null;
    state.highestBid = 0;
    state.highestBidder = null;
    
    broadcastState();
}

setInterval(() => {
  if (state.phase === "running" && state.endsAt && Date.now() >= state.endsAt) {
    endAuction();
  }
}, 200);
