//  === 모듈 불러오기 ===

// Node.js의 내장 모듈 path를 가져옴
// path 모듈을 통해 운영체재와 상관없이 파일의 경로를 다룰 수 있음
const path = require("path");

// express 라이브러리를 가져옴
// express는 Node.js에서 가장 많이 사용되는 웹 프레임워크중 하나이며, HTTP 서버를 쉽게 만들고, 라우팅/정적파일 제공 등을 편하게 함
const express = require("express");

// Node.js의 내장 모듈 http를 가져옴
// http 모듈은 HTTP 서버와 클라이언트를 만들기 위한 기능을 제공함
const http = require("http");

// socket.io 라이브러리에서 Server 클래스를 가져옴
// 웹 소켓 기반의 실시간 통신 버서를 만들기 위한 핵심 객체
const { Server } = require("socket.io");


// === 서버 설정 및 생성 ===

// express 어플리케이션의 인스턴드를 생성
// app 변수는 요청 처리 규칙(미들웨어/라우트)를 설정하는데 사용
const app = express();

// HTTP 서버를 생성
// express 어플리케이션을 인자로 전달하여, 서버가 요청을 받으면 app(express)가 HTTP 요청을 처리할 수 있도록 함
// 즉, HTTP의 실서버 = server, 요청 처리 로직 = app
const server = http.createServer(app);

// socket.io 서버를 생성
// HTTP(웹페이지)와 Socket.io(실시간)가 같은 포트를 공유할 수 있음
// Socket.io - HTTP(서버) - express(처리)
const io = new Server(server);

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
server.listen(PORT, () => {
    console.log(`http://localhost:${PORT}`);    // 콭솔에 접속 주소 출력
});


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
