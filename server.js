/* ============================================================
   실시간 테트리스 배틀 - 서버 (외부 라이브러리 0개)
   실행:  node server.js
   포트 바꾸기:  PORT=4000 node server.js
   ============================================================ */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

/* ---------- 1) 정적 파일 서버 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];

  // 서버의 랜(LAN) IP 주소를 알려주는 엔드포인트 (상황판에서 학생 접속 주소 표시용)
  if (urlPath === '/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ port: PORT, ips: lanIPs() }));
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end('forbidden'); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

function lanIPs() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

/* ---------- 2) WebSocket (RFC6455 최소 구현) ---------- */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set();

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  const ws = new WSConn(socket);
  clients.add(ws);
  ws.on('message', (msg) => handleMessage(ws, msg));
  ws.on('close', () => { clients.delete(ws); });
});

class WSConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.meta = {}; // 앱에서 쓰는 상태(역할, 이름, 점수 등)
    socket.setNoDelay(true);
    socket.on('data', (d) => { this.buffer = Buffer.concat([this.buffer, d]); this._parse(); });
    socket.on('close', () => this._onClose());
    socket.on('error', () => this._onClose());
  }
  _onClose() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
  _parse() {
    while (true) {
      const buf = this.buffer;
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < off + 2) return;
        len = buf.readUInt16BE(off); off += 2;
      } else if (len === 127) {
        if (buf.length < off + 8) return;
        const hi = buf.readUInt32BE(off), lo = buf.readUInt32BE(off + 4);
        len = hi * 4294967296 + lo; off += 8;
      }
      let maskKey;
      if (masked) {
        if (buf.length < off + 4) return;
        maskKey = buf.slice(off, off + 4); off += 4;
      }
      if (buf.length < off + len) return; // 아직 페이로드가 다 안 옴
      let payload = buf.slice(off, off + len);
      if (masked) {
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
        payload = out;
      }
      this.buffer = buf.slice(off + len);

      if (opcode === 0x8) { this.close(); return; }      // close
      else if (opcode === 0x9) { this._send(0xA, payload); } // ping -> pong
      else if (opcode === 0x1) { this.emit('message', payload.toString('utf8')); } // text
      // (작은 JSON만 주고받으므로 프레임 분할은 처리하지 않음)
    }
  }
  _send(opcode, data) {
    if (this.closed) return;
    const len = data.length;
    let header;
    if (len < 126) {
      header = Buffer.allocUnsafe(2);
      header[0] = 0x80 | opcode; header[1] = len;
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[0] = 0x80 | opcode; header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[0] = 0x80 | opcode; header[1] = 127;
      header.writeUInt32BE(Math.floor(len / 4294967296), 2);
      header.writeUInt32BE(len >>> 0, 6);
    }
    try { this.socket.write(Buffer.concat([header, data])); } catch (e) {}
  }
  send(str) { this._send(0x1, Buffer.from(str, 'utf8')); }
  close() {
    if (this.closed) return;
    try { this._send(0x8, Buffer.alloc(0)); } catch (e) {}
    try { this.socket.end(); } catch (e) {}
    this._onClose();
  }
}

/* ---------- 3) 게임 로직 (한 학급 = 방 하나) ---------- */
let nextId = 1;
const game = { phase: 'lobby', activeTeams: [], keywords: [] }; // keywords: 교사가 등록한 학습 키워드 목록(최대 20)

const players = () => [...clients].filter(c => c.meta.role === 'player');
const hosts = () => [...clients].filter(c => c.meta.role === 'host');

function handleMessage(ws, raw) {
  let m; try { m = JSON.parse(raw); } catch { return; }
  switch (m.type) {
    case 'join':
      ws.meta.role = (m.role === 'host') ? 'host' : 'player';
      ws.meta.id = nextId++;
      ws.meta.name = (m.name || '학생').toString().slice(0, 14);
      ws.meta.team = (m.team || '').toString().slice(0, 16);   // 팀 id (없으면 미배정)
      ws.meta.score = 0; ws.meta.lines = 0; ws.meta.alive = false; ws.meta.board = null;
      ws.send(JSON.stringify({ type: 'welcome', id: ws.meta.id, phase: game.phase }));
      if (ws.meta.role === 'player') {
        // 팀을 안 들고 들어왔는데 교사가 팀을 운영 중이면 → 인원이 가장 적은 팀에 자동 배치
        if (!ws.meta.team && game.activeTeams.length) ws.meta.team = smallestActiveTeam(ws);
        if (ws.meta.team) notifyTeam(ws);
        if (game.keywords.length) ws.send(JSON.stringify({ type: 'keywords', words: game.keywords }));
        // 게임 도중 들어오면 바로 참가
        if (game.phase === 'playing') {
          ws.meta.alive = true;
          ws.send(JSON.stringify({ type: 'start' }));
        }
      }
      break;
    case 'state':
      ws.meta.score = m.score | 0; ws.meta.lines = m.lines | 0; ws.meta.board = m.board || null;
      break;
    case 'topout':
      ws.meta.alive = false; ws.meta.score = m.score | 0; ws.meta.lines = m.lines | 0;
      break;
    case 'attack':
      sendGarbage(ws, m.amount | 0);
      break;
    case 'start':
      if (ws.meta.role === 'host') startGame();
      break;
    case 'reset':
      if (ws.meta.role === 'host') resetGame();
      break;
    case 'autoassign':       // 교사: 팀 자동 배정 (m.teams = 사용할 팀 id 목록)
      if (ws.meta.role === 'host') autoAssign(Array.isArray(m.teams) ? m.teams : []);
      break;
    case 'assign':           // 교사: 특정 학생을 특정 팀으로
      if (ws.meta.role === 'host') {
        const p = players().find(x => x.meta.id === (m.id | 0));
        if (p) { p.meta.team = (m.team || '').toString().slice(0, 16); notifyTeam(p); }
      }
      break;
    case 'clearteams':       // 교사: 팀 해제 → 개인전
      if (ws.meta.role === 'host') {
        game.activeTeams = [];
        for (const p of players()) { p.meta.team = ''; notifyTeam(p); }
      }
      break;
    case 'setkeyword':       // 교사: 학습 키워드 목록 등록(빈 목록이면 해제)
      if (ws.meta.role === 'host') {
        let raw = Array.isArray(m.words) ? m.words : String(m.word || '').split(/[\n,]/);
        game.keywords = raw
          .map(w => String(w).replace(/\s+/g, '').slice(0, 12))   // 공백 제거 + 단어당 12자
          .filter(w => w.length > 0)
          .slice(0, 20);                                          // 최대 20개
        broadcastAll({ type: 'keywords', words: game.keywords });
      }
      break;
  }
}

function startGame() {
  game.phase = 'playing';
  for (const p of players()) { p.meta.alive = true; p.meta.score = 0; p.meta.lines = 0; p.meta.board = null; }
  broadcastAll({ type: 'start' });
}
function resetGame() {
  game.phase = 'lobby';
  for (const p of players()) { p.meta.alive = false; p.meta.score = 0; p.meta.lines = 0; p.meta.board = null; }
  broadcastAll({ type: 'reset' });
}
function sendGarbage(from, amount) {
  if (game.phase !== 'playing' || amount <= 0) return;
  // 팀전이면 '다른 팀'에게만, 개인전(팀 없음)이면 아무에게나
  const targets = from.meta.team
    ? players().filter(p => p !== from && p.meta.alive && p.meta.team !== from.meta.team)
    : players().filter(p => p !== from && p.meta.alive);
  if (!targets.length) return;
  const t = targets[(Math.random() * targets.length) | 0];
  t.send(JSON.stringify({ type: 'garbage', amount }));
}
function broadcastAll(obj) {
  const s = JSON.stringify(obj);
  for (const c of clients) c.send(s);
}

/* ---------- 팀 배정 (교사 권한) ---------- */
function notifyTeam(p) {
  p.send(JSON.stringify({ type: 'team', team: p.meta.team }));
}
function smallestActiveTeam(except) {
  const counts = {};
  for (const t of game.activeTeams) counts[t] = 0;
  for (const p of players()) { if (p !== except && counts[p.meta.team] != null) counts[p.meta.team]++; }
  let best = game.activeTeams[0], bestN = Infinity;
  for (const t of game.activeTeams) { if (counts[t] < bestN) { bestN = counts[t]; best = t; } }
  return best;
}
function autoAssign(teamIds) {
  game.activeTeams = teamIds.filter(x => typeof x === 'string' && x).slice(0, 8);
  const ps = players();
  for (let i = ps.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[ps[i], ps[j]] = [ps[j], ps[i]]; } // 섞기
  ps.forEach((p, i) => {
    p.meta.team = game.activeTeams.length ? game.activeTeams[i % game.activeTeams.length] : '';
    notifyTeam(p);
  });
}

/* ---------- 4) 주기적 상태 전송 (300ms마다) ---------- */
function teamSummary(ps) {
  const map = new Map();
  for (const p of ps) {
    const t = p.meta.team || '';
    if (!map.has(t)) map.set(t, { team: t, score: 0, lines: 0, alive: 0, players: 0 });
    const e = map.get(t);
    e.score += p.meta.score; e.lines += p.meta.lines; e.players++;
    if (p.meta.alive) e.alive++;
  }
  const arr = [...map.values()];
  arr.forEach(e => e.avg = e.players ? Math.round(e.score / e.players) : 0);  // 평균 점수
  arr.sort((a, b) => (b.avg - a.avg) || (b.score - a.score));                 // 등수: 평균 우선
  return arr;
}

setInterval(() => {
  const ps = players();
  const teamMode = ps.some(p => p.meta.team);
  const rank = ps.map(p => ({
    id: p.meta.id, name: p.meta.name, team: p.meta.team, score: p.meta.score, lines: p.meta.lines, alive: p.meta.alive, board: p.meta.board,
  })).sort((a, b) => (b.alive - a.alive) || (b.score - a.score));
  const teams = teamSummary(ps);

  // 모두에게(학생·상황판) 동일한 월드 상태 전송. 보드는 압축 문자열이라 가벼움.
  const world = JSON.stringify({ type: 'world', phase: game.phase, count: ps.length, teams, players: rank });
  for (const c of clients) c.send(world);

  // 승부 판정 (종료 시점: 전멸 또는 마지막 1명/1팀 생존 / 우승은 '점수 우선')
  if (game.phase === 'playing' && ps.length > 0) {
    const alive = ps.filter(p => p.meta.alive);
    let ended = false;
    if (teamMode) {
      const aliveTeams = new Set(alive.map(p => p.meta.team));
      const allTeams = new Set(ps.map(p => p.meta.team));
      if (alive.length === 0 || (allTeams.size > 1 && aliveTeams.size === 1)) ended = true;
    } else {
      const lastStanding = ps.length > 1 && alive.length === 1;
      if (lastStanding || alive.length === 0) ended = true;
    }
    if (ended) {
      game.phase = 'ended';
      const result = rank.map(({ board, ...r }) => r).sort((a, b) => b.score - a.score); // 점수순 최종 순위
      let winnerTeam = null, winnerTeams = [], winnerNames = [];
      if (teamMode && teams[0]) {
        const top = teams[0].avg;                                  // 평균 1위
        winnerTeams = teams.filter(t => t.team && t.avg === top).map(t => t.team);
        winnerTeam = winnerTeams[0];                               // 대표 1팀(하위호환)
      } else if (!teamMode && result[0]) {
        const top = result[0].score;                               // 점수 1위
        winnerNames = result.filter(p => p.score === top).map(p => p.name);
      }
      broadcastAll({ type: 'gameover', players: result, teams, teamMode, winnerTeam, winnerTeams, winnerNames });
    }
  }
}, 300);

/* ---------- 5) 시작 ---------- */
server.listen(PORT, '0.0.0.0', () => {
  const ips = lanIPs();
  console.log('\n=== 실시간 테트리스 배틀 서버 시작 ===');
  console.log('상황판(교사 화면) 열기:');
  console.log('   http://localhost:' + PORT + '/?host=1');
  console.log('\n학생 접속 주소 (같은 와이파이):');
  if (ips.length) ips.forEach(ip => console.log('   http://' + ip + ':' + PORT));
  else console.log('   (네트워크 주소를 찾지 못했어요)');
  console.log('\n종료: Ctrl + C\n');
});
