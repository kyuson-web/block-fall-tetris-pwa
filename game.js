/* ============================================================
   Block Fall — 方塊迷陣
   Vanilla JavaScript (ES6) + Canvas 2D API
   單檔 game.js，目標體積 ~16KB
   ============================================================ */
'use strict';

/* 常數 */
const COLS = 10;
const ROWS = 20;
const CELL = 30;
const TICK_BASE = 900;      // 基礎下落間隔 (ms)
const LOCK_DELAY = 500;     // 觸底後鎖定延遲 (ms)
const ANIM_FRAMES = 20;     // 消除動畫幀數

const SHAPES = {
  I: [[0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};
const COLORS = {
  I: '#00e5ff', O: '#ffe600', T: '#b366ff',
  S: '#00e676', Z: '#ff3d3d', J: '#2979ff', L: '#ff9100',
};
const TYPE = Object.keys(SHAPES);

/* DOM */
const boardEl = document.getElementById('board');
const ctx = boardEl.getContext('2d');
const nextEl = document.getElementById('next');
const nctx = nextEl.getContext('2d');
const holdEl = document.getElementById('hold');
const hctx = holdEl ? holdEl.getContext('2d') : null;

const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elLines = document.getElementById('lines');
const elBest = document.getElementById('best');
const msgEl = document.getElementById('msg');
const msgTitle = document.getElementById('msgTitle');
const msgScore = document.getElementById('msgScore');

/* ---------- 遊戲狀態 ---------- */
let grid, piece, nextPiece, holdPiece, canHold;
let score, level, lines, combo, running, paused;
let lastTime, dropInterval, rafId;
let lockTimer = 0;
let animRows = null;     // { rows:[...], frame:0 }
let lastClear = 0;

/* 粒子 */
let particles = [];
function spawnParticles(r, color) {
  for (let c = 0; c < COLS; c++) {
    const n = 3 + Math.random() * 3;
    for (let i = 0; i < n; i++) {
      particles.push({
        x: (c + 0.5) * CELL,
        y: (r + 0.5) * CELL,
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 1) * 3,
        life: 20 + Math.random() * 20,
        color,
      });
    }
  }
}
function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.2;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
}
function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / 40);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
}

/* 統計 */
const stats = {
  start: 0, pieces: 0, drops: 0, clears: [0, 0, 0, 0, 0], // 1~4 行消除次數
};
function nowSeconds() { return Math.floor((performance.now() - stats.start) / 1000); }
function pps() {
  const s = nowSeconds();
  return s > 0 ? (stats.pieces / s).toFixed(2) : '0.00';
}

/* gravity 曲線 */
function gravityFor(lv) {
  return Math.max(90, TICK_BASE * Math.pow(0.85, lv - 1));
}

/* 7-bag */
let bag = [];
function pullFromBag() {
  if (bag.length === 0) bag = TYPE.slice();
  const idx = Math.floor(Math.random() * bag.length);
  return bag.splice(idx, 1)[0];
}

function makePiece() {
  const t = pullFromBag();
  return {
    type: t,
    shape: SHAPES[t],
    row: 0,
    col: Math.floor((COLS - SHAPES[t].length) / 2),
    color: COLORS[t],
  };
}

/* 旋轉 */
function rotate(shape) {
  const n = shape.length;
  const r = Array.from({ length: n }, () => Array(n).fill(0));
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      r[x][n - 1 - y] = shape[y][x];
  return r;
}

/* 碰撞 */
function collide(p, shape, dr, dc) {
  for (let y = 0; y < shape.length; y++)
    for (let x = 0; x < shape[y].length; x++) {
      if (!shape[y][x]) continue;
      const nr = p.row + y + dr;
      const nc = p.col + x + dc;
      if (nr >= ROWS || nc < 0 || nc >= COLS) return true;
      if (nr >= 0 && grid[nr][nc]) return true;
    }
  return false;
}

/* 牆踢 */
function tryMove(dr, dc) {
  if (!collide(piece, piece.shape, dr, dc)) {
    piece.row += dr;
    piece.col += dc;
    return true;
  }
  if (dc !== 0) {
    for (const kick of [1, -1, 2, -2]) {
      if (!collide(piece, piece.shape, dr, dc + kick)) {
        piece.row += dr;
        piece.col += dc + kick;
        return true;
      }
    }
  }
  return false;
}

/* 合併/消除 */
function merge(p) {
  for (let y = 0; y < p.shape.length; y++)
    for (let x = 0; x < p.shape[y].length; x++)
      if (p.shape[y][x]) grid[p.row + y][p.col + x] = p.color;
}

function findFullRows() {
  const rows = [];
  for (let r = 0; r < ROWS; r++)
    if (grid[r].every(c => c)) rows.push(r);
  return rows;
}

function clearLines(rows) {
  if (rows.length === 0) { combo = 0; return; }
  animRows = { rows: rows.slice(), frame: 0 };
  const map = [0, 100, 300, 500, 800];
  combo++;
  const comboBonus = 1 + 0.1 * (combo - 1);
  const multiBonus = rows.length >= 4 ? 1.5 : 1;
  score += Math.round((map[rows.length] || 800) * level * comboBonus * multiBonus);
  lines += rows.length;
  level = 1 + Math.floor(lines / 10);
  dropInterval = gravityFor(level);
  lastClear = performance.now();
  playClear(rows.length);
  stats.clears[rows.length] = (stats.clears[rows.length] || 0) + 1;
  for (const r of rows) {
    for (let c = 0; c < COLS; c++) if (grid[r][c]) spawnParticles(r, grid[r][c]);
  }
  updateHUD();
}

/* 動畫結束後實際移除列 */
function commitClear() {
  if (!animRows) return;
  for (const r of animRows.rows) {
    grid.splice(r, 1);
    grid.unshift(Array(COLS).fill(0));
  }
  animRows = null;
}

/* 渲染 */
function drawCell(c, x, y, size, color, alpha = 1) {
  c.globalAlpha = alpha;
  c.fillStyle = color;
  c.fillRect(x + 1, y + 1, size - 2, size - 2);
  c.globalAlpha = alpha * 0.4;
  c.fillStyle = '#ffffff';
  c.fillRect(x + 2, y + 2, size - 4, 4);
  c.fillRect(x + 2, y + 2, 4, size - 4);
  c.globalAlpha = 1;
  c.strokeStyle = 'rgba(0,0,0,0.4)';
  c.lineWidth = 1;
  c.strokeRect(x + 1, y + 1, size - 2, size - 2);
}

function drawBoard() {
  ctx.clearRect(0, 0, boardEl.width, boardEl.height);
  // 背景格線
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, ROWS * CELL); ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(COLS * CELL, r * CELL); ctx.stroke();
  }
  // 已鎖定方塊（若有消除動畫則閃爍該列）
  for (let r = 0; r < ROWS; r++) {
    const isAnim = animRows && animRows.rows.includes(r);
    const alpha = isAnim ? 1 - animRows.frame / ANIM_FRAMES : 1;
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c]) {
        if (isAnim && animRows.frame % 2 === 0) continue; // 閃爍
        drawCell(ctx, c * CELL, r * CELL, CELL, grid[r][c], alpha);
      }
    }
  }
  // Ghost piece
  if (running && piece && !animRows) {
    let ghost = piece.row;
    while (!collide(piece, piece.shape, ghost - piece.row + 1, 0)) ghost++;
    if (ghost > piece.row) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      for (let y = 0; y < piece.shape.length; y++)
        for (let x = 0; x < piece.shape[y].length; x++)
          if (piece.shape[y][x])
            drawCell(ctx, (piece.col + x) * CELL, (ghost + y) * CELL, CELL, piece.color);
      ctx.restore();
    }
  }
  // 當前方塊
  if (piece && !animRows) {
    for (let y = 0; y < piece.shape.length; y++)
      for (let x = 0; x < piece.shape[y].length; x++)
        if (piece.shape[y][x])
          drawCell(ctx, (piece.col + x) * CELL, (piece.row + y) * CELL, CELL, piece.color);
  }

  // 粒子（在格線之上、方塊之下渲染）
  updateParticles();
  drawParticles();
}

function drawPreview(canvas, ctxt, p) {
  ctxt.clearRect(0, 0, canvas.width, canvas.height);
  if (!p) return;
  const s = Math.floor(Math.min(canvas.width, canvas.height) / (p.shape.length + 1));
  const offX = (canvas.width - p.shape.length * s) / 2;
  const offY = (canvas.height - p.shape.length * s) / 2;
  for (let y = 0; y < p.shape.length; y++)
    for (let x = 0; x < p.shape[y].length; x++)
      if (p.shape[y][x])
        drawCell(ctxt, offX + x * s, offY + y * s, s, p.color);
}

/* HUD */
function updateHUD() {
  elScore.textContent = score;
  elLevel.textContent = level;
  elLines.textContent = lines;
  const best = Math.max(score, loadBest());
  if (elBest) elBest.textContent = best;
}

function loadBest() {
  try { return parseInt(localStorage.getItem('bf_best') || '0', 10); }
  catch (e) { return 0; }
}

function saveBest() {
  try {
    const b = loadBest();
    if (score > b) localStorage.setItem('bf_best', String(score));
  } catch (e) {}
}

/* 流程 */
function spawn() {
  piece = nextPiece || makePiece();
  nextPiece = makePiece();
  stats.pieces++;
  canHold = true;
  drawPreview(nextEl, nctx, nextPiece);
  if (collide(piece, piece.shape, 0, 0)) gameOver();
}

function lockPiece() {
  playDrop();
  merge(piece);
  const rows = findFullRows();
  if (rows.length) {
    clearLines(rows);
    drawBoard();
    // 等動畫播完再 commit + spawn
    setTimeout(() => { if (running) { commitClear(); spawn(); drawBoard(); } }, 180);
  } else {
    combo = 0;
    spawn();
    drawBoard();
  }
}

function step() {
  if (!running || paused || animRows) return;
  if (collide(piece, piece.shape, 1, 0)) {
    lockTimer += dropInterval;
    if (lockTimer >= LOCK_DELAY) { lockTimer = 0; lockPiece(); }
    return;
  }
  lockTimer = 0;
  piece.row++;
  score += 1; // 軟降計分
}

function hardDrop() {
  if (!running || paused || animRows) return;
  let dropped = 0;
  while (!collide(piece, piece.shape, 1, 0)) { piece.row++; dropped++; }
  stats.drops++;
  score += dropped * 2;
  updateHUD();
  lockTimer = LOCK_DELAY; // 立即鎖定
  lockPiece();
}

function doHold() {
  if (!canHold || !running || paused || animRows) return;
  const t = piece.type;
  if (holdPiece) {
    piece = { type: holdPiece.type, shape: holdPiece.shape, row: 0,
      col: Math.floor((COLS - holdPiece.shape.length) / 2), color: holdPiece.color };
  } else {
    piece = makePiece();
  }
  holdPiece = { type: t, shape: SHAPES[t], color: COLORS[t] };
  canHold = false;
  drawPreview(holdEl, hctx, holdPiece);
  drawBoard();
}

function gameOver() {
  running = false;
  cancelAnimationFrame(rafId);
  saveBest();
  // 組合統計文字
  const single = stats.clears[1] || 0;
  const double = stats.clears[2] || 0;
  const triple = stats.clears[3] || 0;
  const tetris = stats.clears[4] || 0;
  const time = nowSeconds();
  const m = String(Math.floor(time / 60)).padStart(2, '0');
  const s = String(time % 60).padStart(2, '0');
  msgTitle.textContent = 'Game Over';
  msgScore.innerHTML =
    '得分：<b>' + score + '</b>　最佳：' + loadBest() + '<br>' +
    '時間 ' + m + ':' + s + '　方塊 ' + stats.pieces + '　PPS ' + pps() + '<br>' +
    '1/' + single + '　2/' + double + '　3/' + triple + '　4/' + tetris;
  msgEl.classList.add('show');
}

function togglePause() {
  if (!running) return;
  paused = !paused;
  if (paused) {
    cancelAnimationFrame(rafId);
    msgTitle.textContent = '暫停中';
    msgScore.textContent = '按 P 或點擊繼續';
    msgEl.classList.add('show');
  } else {
    msgEl.classList.remove('show');
    lastTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }
}

/* 主迴圈 */
function loop(now) {
  if (!running || paused) return;
  if (animRows) {
    animRows.frame++;
    if (animRows.frame >= ANIM_FRAMES) { commitClear(); drawBoard(); }
  }
  if (now - lastTime >= dropInterval) { step(); lastTime = now; }
  if (running) drawBoard();
  rafId = requestAnimationFrame(loop);
}

/* 初始化 */
function init() {
  grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  score = 0; level = 1; lines = 0; combo = 0;
  dropInterval = TICK_BASE;
  bag = [];
  particles = [];
  stats.start = performance.now();
  stats.pieces = 0; stats.drops = 0; stats.clears = [0, 0, 0, 0, 0];
  nextPiece = makePiece();
  holdPiece = null;
  canHold = true;
  animRows = null;
  lockTimer = 0;
  updateHUD();
  msgEl.classList.remove('show');
  drawBoard();
  drawPreview(nextEl, nctx, nextPiece);
  if (hctx) drawPreview(holdEl, hctx, null);
}

function start() {
  init();
  spawn();
  paused = false;
  running = true;
  lastTime = performance.now();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

/* 輸入 */
function handle(key) {
  if (!running || paused || animRows) {
    if (key === 'p' || key === 'P') togglePause();
    return;
  }
  switch (key) {
    case 'ArrowLeft':  tryMove(0, -1); break;
    case 'ArrowRight': tryMove(0, 1); break;
    case 'ArrowDown':  step(); lastTime = performance.now(); break;
    case 'ArrowUp':
    case 'x': case 'X': {
      const r = rotate(piece.shape);
      if (!collide(piece, r, 0, 0)) piece.shape = r;
      else {
        // 牆踢嘗試
        for (const kick of [-1, 1, -2, 2]) {
          if (!collide(piece, r, 0, kick)) { piece.shape = r; piece.col += kick; break; }
        }
      }
      lockTimer = 0;
      break;
    }
    case ' ': hardDrop(); break;
    case 'c': case 'C': doHold(); break;
    case 'p': case 'P': togglePause(); return;
    default: return;
  }
  drawBoard();
}

document.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  handle(e.key);
});

// 觸控按鈕
document.querySelectorAll('#pad button').forEach(b => {
  b.addEventListener('click', () => {
    const k = b.dataset.k;
    if (k === 'ArrowUp') handle('ArrowUp');
    else if (k === 'ArrowDown') hardDrop();
    else handle(k);
  });
});

const holdBtn = document.getElementById('holdBtn');
if (holdBtn) holdBtn.addEventListener('click', doHold);

document.getElementById('startBtn').addEventListener('click', start);
document.getElementById('restartBtn').addEventListener('click', start);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && running && !paused) togglePause();
});

/* 觸控手勢 */
(() => {
  let ts = 0, startX = 0, startY = 0, tracking = false;
  const board = boardEl;
  function onStart(e) {
    const t = e.changedTouches ? e.changedTouches[0] : e;
    tracking = true; startX = t.clientX; startY = t.clientY; ts = performance.now();
  }
  function onEnd(e) {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches ? e.changedTouches[0] : e;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    const dur = performance.now() - ts;
    if (Math.max(adx, ady) < 24) return; // tap = 旋轉
    if (ady > adx) {
      if (dy < 0) handle('ArrowUp');      // 上滑 = 旋轉
      else handle(' ');                     // 下滑 = 硬降
    } else {
      if (dx < 0) handle('ArrowLeft');     // 左滑
      else handle('ArrowRight');            // 右滑
    }
  }
  board.addEventListener('touchstart', onStart, { passive: true });
  board.addEventListener('touchend', onEnd);
  board.addEventListener('mousedown', onStart);
  board.addEventListener('mouseup', onEnd);
})();

/* 音效 */
let actx = null;
function beep(freq, dur, type, vol) {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type || 'square';
    o.frequency.value = freq;
    g.gain.value = vol || 0.15;
    o.connect(g); g.connect(actx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
    o.stop(actx.currentTime + dur);
  } catch (e) {}
}
function playClear(n) { beep(220 + n * 60, 0.15, 'sine', 0.2); }
function playDrop() { beep(120, 0.08, 'triangle', 0.15); }
/* 啟動：等待資源就緒後再 init，避免同步初始化競爭 */
window.addEventListener('load', () => requestAnimationFrame(init));
// xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
