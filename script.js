// --- [1] 전역 설정 및 상태 ---
const GRAVITY = 0.25;
const TANK_SIZE = 35;
const HIT_RADIUS = 30;
const PING_INTERVAL = 5000; // 5초마다 연결 확인

let canvas, ctx, w, h, myId, conn, isHost = false, myNum = 0;
let particles = [];
let heartbeatTimer;

let state = {
    terrain: [],
    p1: { x: 0, y: 0, hp: 100, angle: -0.5 },
    p2: { x: 0, y: 0, hp: 100, angle: 3.6 },
    turn: 1, wind: 0, ball: null, gameOver: false, winner: 0
};

// --- [2] 초정밀 네트워크 엔진 설정 ---
const peerConfig = {
    config: {
        'iceServers': [
            { url: 'stun:stun.l.google.com:19302' },
            { url: 'stun:stun1.l.google.com:19302' },
            { url: 'stun:stun2.l.google.com:19302' },
            { url: 'stun:stun3.l.google.com:19302' },
            { url: 'stun:stun4.l.google.com:19302' },
            { url: 'stun:global.stun.twilio.com:3478' }, // 트윌리오 글로벌 서버 추가
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ],
        iceCandidatePoolSize: 10,
        sdpSemantics: 'unified-plan'
    },
    debug: 1
};

const peer = new Peer(null, peerConfig);

// 피어 서버 연결 시
peer.on('open', id => {
    myId = id;
    const btn = document.getElementById('invite-btn');
    btn.disabled = false;
    btn.innerText = "초대 링크 복사 및 대기";
    updateStatus("서버 준비 완료. 상대를 기다리세요.");
    
    if(window.location.hash) {
        initiateConnection(window.location.hash.substring(1));
    }
});

// 호스트: 게스트의 연결을 수락
peer.on('connection', c => {
    if (conn) { // 이미 연결된 경우 새 연결 차단
        c.close();
        return;
    }
    conn = c;
    isHost = true;
    myNum = 1;
    bindConnectionEvents();
});

// 게스트: 호스트에게 연결 시도
function initiateConnection(targetId) {
    updateStatus("상대방과 경로 탐색 중...");
    conn = peer.connect(targetId, {
        reliable: true,
        serialization: 'json'
    });
    isHost = false;
    myNum = 2;
    bindConnectionEvents();
}

// 공통: 연결 이벤트 바인딩
function bindConnectionEvents() {
    conn.on('open', () => {
        updateStatus("연결 성공! 게임 데이터를 동기화합니다.");
        startHeartbeat();
        
        // 화면 전환
        document.getElementById('overlay').style.display = 'none';
        document.getElementById('game-ui').style.display = 'block';
        
        initCanvas();
        if(isHost) {
            createTerrain();
            setTimeout(sync, 300); // 안정적인 첫 동기화
        }
        requestAnimationFrame(loop);
    });

    conn.on('data', data => {
        handleIncomingData(data);
    });

    conn.on('close', () => {
        handleDisconnect();
    });

    conn.on('error', err => {
        console.error("연결 오류:", err);
        handleDisconnect();
    });
}

// 데이터 수신 처리 (성능 최적화 스위치)
function handleIncomingData(data) {
    switch(data.type) {
        case 'SYNC':
            state = data.state;
            updateUI();
            break;
        case 'FIRE':
            state.ball = { ...data.payload };
            break;
        case 'PONG':
            // 하트비트 응답 (필요 시 레이턴시 계산 가능)
            break;
    }
}

// 하트비트 시작 (연결 유지 기능)
function startHeartbeat() {
    heartbeatTimer = setInterval(() => {
        if (conn && conn.open) {
            conn.send({ type: 'PING', ts: Date.now() });
        }
    }, PING_INTERVAL);
}

function handleDisconnect() {
    clearInterval(heartbeatTimer);
    alert("연결이 끊어졌습니다. 메인 화면으로 돌아갑니다.");
    window.location.hash = "";
    window.location.reload();
}

function updateStatus(msg) {
    document.getElementById('status').innerText = msg;
}

function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}#${myId}`;
    navigator.clipboard.writeText(url).then(() => {
        updateStatus("링크가 복사되었습니다! 친구에게 보내세요.");
    });
}

// --- [3] 게임 로직 (기능 유지) ---

function initCanvas() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    setupInput();
}

function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
}

function createTerrain() {
    state.terrain = [];
    let curH = h * 0.7;
    for(let x = 0; x <= w + 100; x += 50) {
        curH += (Math.random() - 0.5) * 120;
        curH = Math.max(h * 0.4, Math.min(h * 0.85, curH));
        state.terrain.push({x, y: curH});
    }
    state.p1.x = w * 0.15; state.p1.y = getTerrainY(state.p1.x);
    state.p2.x = w * 0.85; state.p2.y = getTerrainY(state.p2.x);
    state.wind = (Math.random() - 0.5) * 0.4;
}

function getTerrainY(x) {
    for(let i=0; i<state.terrain.length-1; i++) {
        if(x >= state.terrain[i].x && x <= state.terrain[i+1].x) {
            let r = (x - state.terrain[i].x) / (state.terrain[i+1].x - state.terrain[i].x);
            return state.terrain[i].y * (1-r) + state.terrain[i+1].y * r;
        }
    }
    return h;
}

function sync() {
    if(isHost && conn && conn.open) {
        conn.send({ type: 'SYNC', state: state });
        updateUI();
    }
}

function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
}

function update() {
    if(!state.ball || state.gameOver) return;
    const b = state.ball;
    b.vx += b.wind; b.vy += GRAVITY; b.x += b.vx; b.y += b.vy;

    const targetNum = state.turn === 1 ? 2 : 1;
    const target = targetNum === 1 ? state.p1 : state.p2;
    const distToTarget = Math.sqrt((b.x - target.x)**2 + (b.y - (target.y - 15))**2);
    const groundY = getTerrainY(b.x);
    
    if(distToTarget < HIT_RADIUS || b.y > groundY || b.x < 0 || b.x > w) {
        createBoom(b.x, b.y, state.turn === 1 ? '#3b82f6' : '#ef4444');
        if(isHost) {
            if(distToTarget < HIT_RADIUS + 10) {
                target.hp = Math.max(0, target.hp - 34);
                if(target.hp <= 0) { state.gameOver = true; state.winner = state.turn; }
            }
            state.ball = null;
            if(!state.gameOver) {
                state.turn = state.turn === 1 ? 2 : 1;
                state.wind = (Math.random() - 0.5) * 0.4;
            }
            sync();
        } else { state.ball = null; }
    }
}

// --- [4] 렌더링 및 입력 (기능 유지) ---

function draw() {
    ctx.clearRect(0,0,w,h);
    let g = ctx.createLinearGradient(0,0,0,h);
    g.addColorStop(0,'#020617'); g.addColorStop(1,'#1e293b');
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
    
    if(state.terrain.length) {
        ctx.beginPath(); ctx.moveTo(0,h);
        state.terrain.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(w,h); ctx.fillStyle = '#0f172a'; ctx.fill();
        ctx.strokeStyle = '#334155'; ctx.lineWidth = 2; ctx.stroke();
    }
    drawTank(state.p1, 1); drawTank(state.p2, 2);
    if(state.ball) {
        ctx.fillStyle = '#fff'; ctx.shadowBlur = 15; ctx.shadowColor = '#fff';
        ctx.beginPath(); ctx.arc(state.ball.x, state.ball.y, 6, 0, Math.PI*2); ctx.fill();
        ctx.shadowBlur = 0;
    }
    if(input.active && state.turn === myNum && !state.ball) drawGuide();
    particles.forEach((p,i) => {
        p.x += p.vx; p.y += p.vy; p.a -= 0.02;
        ctx.fillStyle = `rgba(${p.c}, ${p.a})`;
        ctx.fillRect(p.x, p.y, p.s, p.s);
        if(p.a <= 0) particles.splice(i,1);
    });
}

function drawTank(p, n) {
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.fillStyle = n === 1 ? '#3b82f6' : '#ef4444';
    ctx.beginPath(); ctx.roundRect(-22, -12, 44, 18, 6); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -12, 12, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0,-15);
    ctx.lineTo(Math.cos(p.angle)*30, Math.sin(p.angle)*30-15); ctx.stroke();
    ctx.restore();
}

function drawGuide() {
    const p = myNum === 1 ? state.p1 : state.p2;
    const dx = input.sx - input.cx, dy = input.sy - input.cy;
    const pwr = Math.min(Math.sqrt(dx*dx+dy*dy)*0.15, 25);
    const ang = Math.atan2(dy, dx);
    ctx.beginPath(); ctx.setLineDash([6,6]); ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    let tx = p.x, ty = p.y-15, tvx = Math.cos(ang)*pwr, tvy = Math.sin(ang)*pwr;
    for(let i=0; i<40; i++) {
        ctx.lineTo(tx, ty); tvx += state.wind; tvy += GRAVITY; tx += tvx; ty += tvy;
    }
    ctx.stroke(); ctx.setLineDash([]);
}

function createBoom(x, y, color) {
    const rgb = color === '#3b82f6' ? '59, 130, 246' : '239, 68, 68';
    for(let i=0; i<30; i++) {
        particles.push({ x, y, vx:(Math.random()-0.5)*12, vy:(Math.random()-0.5)*12, s:Math.random()*6+2, a:1, c:rgb });
    }
}

let input = { active:false, sx:0, sy:0, cx:0, cy:0 };
function setupInput() {
    canvas.addEventListener('pointerdown', e => {
        if(state.turn !== myNum || state.ball || state.gameOver) return;
        input.active = true; input.sx = input.cx = e.clientX; input.sy = input.cy = e.clientY;
    });
    window.addEventListener('pointermove', e => {
        if(!input.active) return;
        input.cx = e.clientX; input.cy = e.clientY;
        const p = myNum === 1 ? state.p1 : state.p2;
        p.angle = Math.atan2(input.sy - input.cy, input.sx - input.cx);
    });
    window.addEventListener('pointerup', () => {
        if(!input.active) return;
        input.active = false;
        const dx = input.sx - input.cx, dy = input.sy - input.cy;
        const pwr = Math.min(Math.sqrt(dx*dx+dy*dy)*0.15, 25);
        const ang = Math.atan2(dy, dx);
        if(pwr > 3 && conn && conn.open) {
            const firePayload = { x:(myNum===1?state.p1.x:state.p2.x), y:(myNum===1?state.p1.y:state.p2.y)-15, vx:Math.cos(ang)*pwr, vy:Math.sin(ang)*pwr, wind:state.wind };
            conn.send({ type: 'FIRE', payload: firePayload });
            state.ball = { ...firePayload };
        }
    });
}

function updateUI() {
    document.getElementById('hp1').style.width = state.p1.hp + '%';
    document.getElementById('hp2').style.width = state.p2.hp + '%';
    const wnd = state.wind * 100;
    document.getElementById('wind-ui').innerText = `WIND: ${Math.abs(wnd).toFixed(1)} ${wnd>=0?'→':'←'}`;
    const msg = document.getElementById('msg');
    if(state.gameOver) {
        msg.innerText = (state.winner === 1 ? "BLUE" : "RED") + " WINS!";
        msg.style.color = state.winner === 1 ? 'var(--p1)' : 'var(--p2)';
        msg.classList.add('show');
    } else {
        msg.innerText = state.turn === myNum ? "YOUR TURN" : "ENEMY TURN";
        msg.style.color = state.turn === myNum ? 'var(--accent)' : '#fff';
        msg.classList.add('show');
    }
}
