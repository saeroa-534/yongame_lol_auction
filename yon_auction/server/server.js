// server/server.js
const path = require("path");
const http = require("http");
const crypto = require("crypto");           // 로그 테이블에 넣을 고유 ID 만들기
const express = require("express");
const { Server } = require("socket.io");

const {
  initDb,
  resetDb,
  get,
  all,
  run,
  execSql,
} = require("./db/db");

// ------------------------------
// 기본 설정
// ------------------------------
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const PHASE_ORDER_SQL = `
  CASE phase
    WHEN 'TOP' THEN 1
    WHEN 'MID' THEN 2
    WHEN 'BOTTOM' THEN 3
    ELSE 99
  END
`;

// ------------------------------
// 서버/소켓 생성
// ------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 정적 파일 서빙 (public 폴더)
app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.redirect("/index.html");
});

// 디버그용: 현재 스냅샷 JSON
app.get("/api/snapshot", async (req, res) => {
  try {
    const snapshot = await buildSnapshot();
    res.json(snapshot);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ------------------------------
// 경매 실행 상태(메모리)
// ------------------------------
let auctionRunning = false;     // admin:start 이후 true
let timerEndAt = null;          // Date.now() 기준 ms
let timerInterval = null;       // setInterval 핸들
let lastEmittedRemaining = null;

// ------------------------------
// 유틸: DB 트랜잭션
// ------------------------------
async function withTransaction(fn) {
  await execSql("BEGIN;");
  try {
    const out = await fn();
    await execSql("COMMIT;");
    return out;
  } catch (err) {
    await execSql("ROLLBACK;");
    throw err;
  }
}

// ------------------------------
// 스냅샷: 화면들(관리자/팀장/관전자)이 한 번에 렌더링하기 좋게
// ------------------------------
async function buildSnapshot() {
  const config = await get("SELECT * FROM auction_config WHERE id = 1;");
  const state = await get("SELECT * FROM auction_state WHERE id = 1;");

  const current = state?.current_player_id
    ? await get(
        `
        SELECT
          q.id AS queue_id,
          q.phase, q.sequence, q.status,
          p.id AS player_id, p.name AS player_name, p.position, p.tier, p.bio, p.img_url
        FROM auction_queue q
        JOIN players p ON p.id = q.player_id
        WHERE q.id = ?
        `,
        [state.current_queue_id]
      )
    : null;

  const teams = await all(
    `
    SELECT
      t.*,
      p.name AS captain_name
    FROM teams t
    JOIN players p ON p.id = t.captain_player_id
    ORDER BY t.id
    `
  );

  const roster = await all(
    `
    SELECT
      r.team_id, r.slot, r.player_id, r.price_paid, r.acquired_via, r.acquired_at,
      p.name AS player_name, p.position AS player_position, p.img_url
    FROM team_roster r
    JOIN players p ON p.id = r.player_id
    ORDER BY r.team_id, r.slot
    `
  );

  const queue = await all(
    `
    SELECT
      q.id AS queue_id, q.phase, q.sequence, q.status,
      p.id AS player_id, p.name AS player_name, p.position, p.img_url
    FROM auction_queue q
    JOIN players p ON p.id = q.player_id
    ORDER BY ${PHASE_ORDER_SQL}, q.sequence
    `
  );

  const logs = await all(
    `
    SELECT * FROM auction_log
    ORDER BY created_at DESC
    LIMIT 50
    `
  );

  return {
    serverTime: new Date().toISOString(),
    running: auctionRunning,
    timer: timerEndAt ? { endAt: timerEndAt } : null,
    config,
    state,
    current,
    teams,
    roster,
    queue,
    logs,
  };
}

async function broadcastSnapshot() {
  const snapshot = await buildSnapshot();
  io.emit("snapshot", snapshot);
}

// ------------------------------
// 타이머
// ------------------------------
function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  timerEndAt = null;
  lastEmittedRemaining = null;
}

function startTimer(seconds) {
  timerEndAt = Date.now() + seconds * 1000;
  lastEmittedRemaining = null;

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(async () => {
    if (!auctionRunning || !timerEndAt) return;

    const msLeft = timerEndAt - Date.now();
    const secLeft = Math.max(0, Math.ceil(msLeft / 1000));

    // 너무 잦은 emit 방지(초가 바뀔 때만)
    if (secLeft !== lastEmittedRemaining) {
      lastEmittedRemaining = secLeft;
      io.emit("timer", { remaining: secLeft });
    }

    if (msLeft <= 0) {
      // 타이머 종료 => 현재 선수 SOLD/UNSOLD 처리 후 다음으로
      stopTimer();
      try {
        await finalizeCurrentByTimer();
      } catch (e) {
        io.emit("toast", { type: "error", message: `Finalize error: ${String(e)}` });
      }
    }
  }, 200);
}

// ------------------------------
// 입찰 규칙 계산 (네 config 테이블 기준)
// ------------------------------
function getBidStep(config, currentHighBid) {
  if (!config) return 5;
  if (currentHighBid >= config.bid_step_threshold) return config.bid_step_high;
  return config.bid_step_low;
}

function calcMinAllowedBid(config, state) {
  // 최소 입찰가: global_min_bid (state에 유지)
  return Math.max(0, Number(state?.global_min_bid || config?.min_bid_start || 5));
}

// ------------------------------
// 현재 대상 경매 종료 처리(타이머로 자동 호출)
// ------------------------------
async function finalizeCurrentByTimer() {
  const config = await get("SELECT * FROM auction_config WHERE id = 1;");
  const state = await get("SELECT * FROM auction_state WHERE id = 1;");
  if (!state?.current_queue_id || !state?.current_player_id) {
    await broadcastSnapshot();
    return;
  }

  const queueRow = await get("SELECT * FROM auction_queue WHERE id = ?;", [state.current_queue_id]);
  if (!queueRow || queueRow.status !== "PENDING") {
    // 이미 처리된 상태면 그냥 다음 스냅샷
    await broadcastSnapshot();
    return;
  }

  const player = await get("SELECT * FROM players WHERE id = ?;", [state.current_player_id]);
  const hasBid = Number(state.current_high_bid || 0) > 0 && !!state.current_high_team_id;

  await withTransaction(async () => {
    if (hasBid) {
      const team = await get("SELECT * FROM teams WHERE id = ?;", [state.current_high_team_id]);

      if (!team) throw new Error("High bid team not found.");
      if (team.point_now < state.current_high_bid) throw new Error("Team point insufficient at finalize.");

      // SOLD 처리
      await run("UPDATE auction_queue SET status = 'SOLD' WHERE id = ?;", [state.current_queue_id]);

      await run(
        `
        INSERT INTO team_roster (team_id, slot, player_id, price_paid, acquired_via)
        VALUES (?, ?, ?, ?, 'bid')
        `,
        [team.id, player.position, player.id, state.current_high_bid]
      );

      await run("UPDATE teams SET point_now = point_now - ? WHERE id = ?;", [
        state.current_high_bid,
        team.id,
      ]);

      await run(
        `
        INSERT INTO auction_log (id, event_type, act, queue_id, player_id, team_id, price)
        VALUES (?, 'ADMIN', 'SOLD_BY_TIMER', ?, ?, ?, ?)
        `,
        [crypto.randomUUID(), state.current_queue_id, player.id, team.id, state.current_high_bid]
      );

      // 판매 완료 => 유찰 카운트 초기화 + 최소입찰가 초기값으로
      await run(
        `
        UPDATE auction_state
        SET
          current_high_bid = 0,
          current_high_team_id = NULL,
          unsold_count = 0,
          global_min_bid = ?,
          last_tick_at = CURRENT_TIMESTAMP
        WHERE id = 1
        `,
        [config.min_bid_start]
      );
    } else {
      // UNSOLD 처리
      await run("UPDATE auction_queue SET status = 'UNSOLD' WHERE id = ?;", [state.current_queue_id]);

      const newUnsold = Number(state.unsold_count || 0) + 1;
      const newMinBid = config.min_bid_start + newUnsold * config.min_bid_increment_on_unsold;

      await run(
        `
        INSERT INTO auction_log (id, event_type, act, queue_id, player_id, team_id, price)
        VALUES (?, 'ADMIN', 'UNSOLD_BY_TIMER', ?, ?, NULL, 0)
        `,
        [crypto.randomUUID(), state.current_queue_id, player.id]
      );

      await run(
        `
        UPDATE auction_state
        SET
          current_high_bid = 0,
          current_high_team_id = NULL,
          unsold_count = ?,
          global_min_bid = ?,
          last_tick_at = CURRENT_TIMESTAMP
        WHERE id = 1
        `,
        [newUnsold, newMinBid]
      );
    }
  });

  // 다음 경매 대상으로 이동
  await advanceToNextQueueItem();

  // 자동 진행이면 다음 타이머 시작(러닝 상태일 때만)
  if (auctionRunning) {
    const config2 = await get("SELECT * FROM auction_config WHERE id = 1;");
    startTimer(config2.timer_seconds);
  }

  await broadcastSnapshot();
}

// 다음 PENDING 한 명을 찾아 state 갱신
async function advanceToNextQueueItem() {
  const next = await get(
    `
    SELECT id, player_id
    FROM auction_queue
    WHERE status = 'PENDING'
    ORDER BY ${PHASE_ORDER_SQL}, sequence
    LIMIT 1
    `
  );

  if (!next) {
    await run(
      `
      UPDATE auction_state
      SET
        current_queue_id = NULL,
        current_player_id = NULL,
        current_high_bid = 0,
        current_high_team_id = NULL,
        last_tick_at = CURRENT_TIMESTAMP
      WHERE id = 1
      `
    );
    return;
  }

  await run(
    `
    UPDATE auction_state
    SET
      current_queue_id = ?,
      current_player_id = ?,
      current_high_bid = 0,
      current_high_team_id = NULL,
      last_tick_at = CURRENT_TIMESTAMP
    WHERE id = 1
    `,
    [next.id, next.player_id]
  );
}

// ------------------------------
// 소켓 이벤트
// ------------------------------
io.on("connection", async (socket) => {
  // 접속 즉시 현재 스냅샷 전달
  socket.emit("snapshot", await buildSnapshot());

  // 클라가 역할/팀 정보를 알려주도록 (admin/captain/viewer)
  socket.on("hello", async (payload) => {
    // payload 예: { role: "captain", teamId: "T1" }
    socket.data.role = payload?.role || "viewer";
    socket.data.teamId = payload?.teamId || null;

    socket.emit("toast", { type: "info", message: `Hello: ${socket.data.role}` });
  });

  // --------------------------
  // 팀장 입찰
  // --------------------------
  socket.on("bid", async (payload) => {
    try {
      if (!auctionRunning) {
        socket.emit("toast", { type: "warn", message: "Auction is not running." });
        return;
      }

      const teamId = payload?.teamId || socket.data.teamId;
      const bidPrice = Number(payload?.price);

      if (!teamId) {
        socket.emit("toast", { type: "error", message: "teamId is required." });
        return;
      }
      if (!Number.isFinite(bidPrice) || bidPrice <= 0) {
        socket.emit("toast", { type: "error", message: "price must be a positive number." });
        return;
      }

      const config = await get("SELECT * FROM auction_config WHERE id = 1;");
      const state = await get("SELECT * FROM auction_state WHERE id = 1;");

      if (!state?.current_queue_id || !state?.current_player_id) {
        socket.emit("toast", { type: "warn", message: "No current auction target." });
        return;
      }

      // 최소 허용 입찰가 계산
      const minBid = calcMinAllowedBid(config, state);
      const step = getBidStep(config, Number(state.current_high_bid || 0));
      const minByStep = Number(state.current_high_bid || 0) > 0 ? Number(state.current_high_bid) + step : minBid;
      const minAllowed = Math.max(minBid, minByStep);

      if (bidPrice < minAllowed) {
        socket.emit("toast", {
          type: "warn",
          message: `Bid too low. 최소 ${minAllowed} 이상이어야 함.`,
        });
        return;
      }

      const team = await get("SELECT * FROM teams WHERE id = ?;", [teamId]);
      if (!team) {
        socket.emit("toast", { type: "error", message: "Team not found." });
        return;
      }
      if (team.point_now < bidPrice) {
        socket.emit("toast", { type: "warn", message: "포인트가 부족합니다." });
        return;
      }

      // DB 반영 (현재 최고입찰 갱신 + 로그)
      await withTransaction(async () => {
        await run(
          `
          UPDATE auction_state
          SET
            current_high_bid = ?,
            current_high_team_id = ?,
            last_tick_at = CURRENT_TIMESTAMP
          WHERE id = 1
          `,
          [bidPrice, teamId]
        );

        await run(
          `
          INSERT INTO auction_log (id, event_type, act, queue_id, player_id, team_id, price)
          VALUES (?, 'BID', 'BID_PLACED', ?, ?, ?, ?)
          `,
          [
            crypto.randomUUID(),
            state.current_queue_id,
            state.current_player_id,
            teamId,
            bidPrice,
          ]
        );
      });

      // 입찰 들어오면 타이머 리셋(10초 등)
      startTimer(config.timer_seconds);

      await broadcastSnapshot();
    } catch (e) {
      socket.emit("toast", { type: "error", message: String(e) });
    }
  });

  // --------------------------
  // 관리자 컨트롤
  // --------------------------
  socket.on("admin:start", async () => {
    if (socket.data.role !== "admin") return;

    const config = await get("SELECT * FROM auction_config WHERE id = 1;");
    auctionRunning = true;

    // running 시작 시 타이머 가동
    startTimer(config.timer_seconds);
    io.emit("toast", { type: "info", message: "Auction started." });
    await broadcastSnapshot();
  });

  socket.on("admin:pause", async () => {
    if (socket.data.role !== "admin") return;

    auctionRunning = false;
    stopTimer();
    io.emit("toast", { type: "info", message: "Auction paused." });
    await broadcastSnapshot();
  });

  // 즉시 현재 선수 마감(강제 다음으로)
  socket.on("admin:finalize", async () => {
    if (socket.data.role !== "admin") return;

    stopTimer();
    await finalizeCurrentByTimer();
  });

  // DB 완전 리셋(초기데이터 다시)
  socket.on("admin:reset", async () => {
    if (socket.data.role !== "admin") return;

    auctionRunning = false;
    stopTimer();

    await resetDb({ reseed: true });

    io.emit("toast", { type: "info", message: "DB reset done." });
    await broadcastSnapshot();
  });

  socket.on("disconnect", () => {
    // 필요하면 접속자 관리 로직 추가
  });
});

// ------------------------------
// 서버 시작
// ------------------------------
async function main() {
  // 최초 구동 시: schema 적용 + 비어있을 때만 init_data 주입
  // (강제 초기화가 필요하면 initDb({ reseed: true })로 바꾸면 됨)
  await initDb({ reseed: false });

  // placeholder 때문에 current_high_team_id가 세팅돼 있을 수 있어서,
  // 경매 시작 전에 일단 current_high_bid=0이면 team_id를 NULL로 정리해둠(선택)
  await run(
    `
    UPDATE auction_state
    SET current_high_team_id = NULL
    WHERE id = 1 AND current_high_bid = 0
    `
  );

  server.listen(PORT, () => {
    console.log(`[yonauction] http://localhost:${PORT}`);
    console.log(`[yonauction] admin:  /admin.html`);
    console.log(`[yonauction] captain: /captain.html`);
    console.log(`[yonauction] viewer:  /viewer.html`);
  });

  // 첫 스냅샷 전체 브로드캐스트(접속자 없어도 OK)
  await broadcastSnapshot();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});