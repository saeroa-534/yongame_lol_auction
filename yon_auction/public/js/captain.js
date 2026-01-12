/**
 * captain.js - 팀장 페이지 스크립트
 */

// URL에서 팀 ID 가져오기
const params = new URLSearchParams(location.search);
let teamId = params.get('team');

// DOM 요소
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// 상태
let currentState = null;
let socket = null;

// ===== 초기화 =====
document.addEventListener('DOMContentLoaded', () => {
  if (!teamId) {
    // 팀 선택 화면 표시
    showTeamSelect();
  } else {
    initSocket();
  }
});

function showTeamSelect() {
  $('#teamSelect').classList.remove('hidden');
  
  // 임시로 T1~T6 버튼 생성
  const teams = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
  $('#teamSelectList').innerHTML = teams.map(t => `
    <button class="btn btn-primary btn-lg" onclick="selectTeam('${t}')">${t}</button>
  `).join('');
}

window.selectTeam = function(id) {
  teamId = id;
  location.href = `?team=${id}`;
};

function initSocket() {
  socket = io({
    auth: { 
      role: 'captain',
      teamId: teamId
    }
  });

  setupSocketEvents();
  setupEventListeners();
}

function setupSocketEvents() {
  socket.on('connect', () => {
    console.log('✅ 서버 연결됨');
    showMessage('서버에 연결되었습니다.', 'success');
    // 내 팀 로스터 요청
    socket.emit('getRoster', { teamId });
  });

  socket.on('disconnect', () => {
    console.log('❌ 서버 연결 끊김');
    showMessage('서버 연결이 끊어졌습니다!', 'error');
  });

  socket.on('state', (state) => {
    console.log('📦 상태 수신:', state);
    currentState = state;
    renderAll();
  });

  socket.on('roster', (data) => {
    console.log('📋 로스터 수신:', data);
    if (data.teamId === teamId) {
      renderMyRoster(data.roster);
    }
  });

  socket.on('bidAccepted', (data) => {
    showMessage(`입찰 성공! ${data.price} pt`, 'success');
    $('#customBidInput').value = '';
  });

  socket.on('bidRejected', (data) => {
    showMessage(data.reason, 'error');
    showBidError(data.reason);
  });
}

function setupEventListeners() {
  // 빠른 입찰 버튼
  $$('.bid-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const amount = btn.dataset.amount;
      let bidPrice;
      
      const currentHigh = currentState?.currentHighBid || 0;
      const minBid = currentState?.globalMinBid || 5;
      const bidStep = currentHigh >= 300 ? 10 : 5;
      
      if (amount === 'min') {
        bidPrice = currentHigh > 0 ? currentHigh + bidStep : minBid;
      } else {
        const add = parseInt(amount.replace('+', ''));
        bidPrice = currentHigh + add;
      }
      
      $('#customBidInput').value = bidPrice;
      placeBid(bidPrice);
    });
  });

  // 직접 입찰 버튼
  $('#btnBid').addEventListener('click', () => {
    const price = parseInt($('#customBidInput').value);
    if (price > 0) {
      placeBid(price);
    }
  });

  // Enter 키로 입찰
  $('#customBidInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const price = parseInt($('#customBidInput').value);
      if (price > 0) {
        placeBid(price);
      }
    }
  });
}

function placeBid(price) {
  if (!currentState?.isRunning) {
    showBidError('경매가 진행 중이 아닙니다.');
    return;
  }
  
  socket.emit('bid', { price });
  hideBidError();
}

// ===== 렌더링 =====
function renderAll() {
  if (!currentState) return;
  
  renderMyTeam();
  renderCurrentPlayer();
  renderBidInfo();
  renderTimer();
  renderTeams();
  updateBidPanel();
  updateBidIndicator();
  
  // 로스터 새로고침
  socket.emit('getRoster', { teamId });
}

function renderMyTeam() {
  const myTeam = currentState.teams?.find(t => t.id === teamId);
  if (!myTeam) return;
  
  $('#myTeamName').textContent = myTeam.name;
  $('#myCaptainName').textContent = myTeam.captainName;
  $('#myPoints').textContent = myTeam.pointNow;
  $('#teamBadge').textContent = `🏆 ${myTeam.name}`;
}

function renderMyRoster(roster) {
  const slots = ['TOP', 'JUG', 'MID', 'ADC', 'SUP'];
  const container = $('#myRoster');
  
  container.innerHTML = slots.map(slot => {
    const player = roster?.find(r => r.slot === slot);
    
    if (player) {
      return `
        <div class="roster-slot">
          <div class="slot-position position-${slot}">${slot}</div>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: var(--white);">${player.player_name}</div>
            <div style="font-size: 0.85rem; color: #72767D;">${player.price_paid} pt</div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="roster-slot empty">
          <div class="slot-position position-${slot}">${slot}</div>
          <div style="flex: 1; color: #72767D;">비어있음</div>
        </div>
      `;
    }
  }).join('');
}

function renderCurrentPlayer() {
  const player = currentState.currentPlayer;
  
  if (!player) {
    $('#noPlayer').classList.remove('hidden');
    $('#playerInfo').classList.add('hidden');
    return;
  }
  
  $('#noPlayer').classList.add('hidden');
  $('#playerInfo').classList.remove('hidden');
  
  $('#playerName').textContent = player.name;
  $('#playerPosition').textContent = player.position;
  $('#playerPosition').className = `player-position position-${player.position}`;
  
  const img = $('#playerImage');
  if (player.imgUrl && !player.imgUrl.includes('PLACEHOLDER')) {
    img.src = player.imgUrl;
  } else {
    img.src = `https://via.placeholder.com/200x200/23272A/DCDDDE?text=${encodeURIComponent(player.name)}`;
  }
}

function renderBidInfo() {
  $('#currentBid').textContent = currentState.currentHighBid || 0;
  $('#currentBidder').textContent = currentState.currentHighTeam?.teamName || '-';
  $('#minBid').textContent = currentState.globalMinBid || 5;
}

function renderTimer() {
  const timerEl = $('#timer');
  const statusEl = $('#timerStatus');
  
  if (!currentState.isRunning || !currentState.endsAt) {
    timerEl.textContent = '--';
    timerEl.className = 'timer';
    statusEl.textContent = '대기 중';
    return;
  }
  
  updateTimerDisplay();
}

function updateTimerDisplay() {
  if (!currentState?.isRunning || !currentState?.endsAt) return;
  
  const timerEl = $('#timer');
  const statusEl = $('#timerStatus');
  const remaining = Math.max(0, currentState.endsAt - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  
  timerEl.textContent = seconds;
  statusEl.textContent = '진행 중';
  
  timerEl.className = 'timer';
  if (seconds <= 3) {
    timerEl.classList.add('danger');
  } else if (seconds <= 5) {
    timerEl.classList.add('warning');
  }
}

setInterval(updateTimerDisplay, 200);

function renderTeams() {
  const container = $('#teamList');
  if (!currentState.teams) return;
  
  container.innerHTML = currentState.teams
    .filter(t => t.id !== teamId)  // 내 팀 제외
    .map(team => {
      const isCurrent = currentState.currentHighTeam?.teamId === team.id;
      return `
        <div class="team-item ${isCurrent ? 'current-bidder-team' : ''}">
          <div>
            <div class="team-name">${team.name}</div>
            <div style="font-size: 0.85rem; color: #72767D;">${team.captainName}</div>
          </div>
          <div class="team-points">${team.pointNow} pt</div>
        </div>
      `;
    }).join('');
}

function updateBidPanel() {
  const panel = $('#bidPanel');
  const isRunning = currentState.isRunning;
  const hasPlayer = !!currentState.currentPlayer;
  
  // 입찰 가능 여부
  const canBid = isRunning && hasPlayer && canBidOnCurrentPlayer();
  
  // 버튼 비활성화
  $$('.bid-btn').forEach(btn => btn.disabled = !canBid);
  $('#btnBid').disabled = !canBid;
  $('#customBidInput').disabled = !canBid;
  
  if (!canBid && hasPlayer) {
    panel.style.opacity = '0.5';
  } else {
    panel.style.opacity = '1';
  }
}

function canBidOnCurrentPlayer() {
  if (!currentState.currentPlayer) return false;
  
  const position = currentState.currentPlayer.position;
  const myTeam = currentState.teams?.find(t => t.id === teamId);
  
  // 해당 포지션에 이미 선수가 있는지 체크 (results에서)
  const alreadyHas = currentState.results?.some(
    r => r.teamId === teamId && r.slot === position
  );
  
  if (alreadyHas) return false;
  
  // 포인트 체크
  const minBid = currentState.globalMinBid || 5;
  if (myTeam && myTeam.pointNow < minBid) return false;
  
  return true;
}

function updateBidIndicator() {
  const indicator = $('#bidIndicator');
  const isRunning = currentState.isRunning;
  const hasPlayer = !!currentState.currentPlayer;
  
  if (!isRunning || !hasPlayer) {
    indicator.classList.add('hidden');
    return;
  }
  
  indicator.classList.remove('hidden');
  
  if (canBidOnCurrentPlayer()) {
    indicator.className = 'can-bid-indicator can-bid';
    indicator.textContent = '✅ 입찰 가능';
  } else {
    indicator.className = 'can-bid-indicator cannot-bid';
    
    // 사유
    const position = currentState.currentPlayer?.position;
    const alreadyHas = currentState.results?.some(
      r => r.teamId === teamId && r.slot === position
    );
    
    if (alreadyHas) {
      indicator.textContent = `❌ 이미 ${position} 선수 보유`;
    } else {
      indicator.textContent = '❌ 포인트 부족';
    }
  }
}

// ===== 유틸리티 =====
function showMessage(text, type = 'info') {
  const msg = $('#message');
  msg.textContent = text;
  msg.className = `message message-${type}`;
  msg.classList.remove('hidden');
  
  setTimeout(() => {
    msg.classList.add('hidden');
  }, 3000);
}

function showBidError(text) {
  const el = $('#bidError');
  el.textContent = text;
  el.style.display = 'block';
  
  setTimeout(() => {
    el.style.display = 'none';
  }, 3000);
}

function hideBidError() {
  $('#bidError').style.display = 'none';
}
