import { polygonHull, polygonArea } from 'https://cdn.jsdelivr.net/npm/d3-polygon@3/+esm';

// ---------- 설정 ----------
const TOTAL_SHAPES = 22;
const TARGET_PCT = 80;
const SIDE = 60;
const SQ_VERTS = [
  { x: -SIDE/2, y: -SIDE/2 }, { x: SIDE/2, y: -SIDE/2 },
  { x: SIDE/2, y: SIDE/2 },   { x: -SIDE/2, y: SIDE/2 },
];
const TRI_VERTS = [
  { x: 0, y: -SIDE / Math.sqrt(3) },
  { x: -SIDE/2, y: SIDE / (2 * Math.sqrt(3)) },
  { x: SIDE/2, y: SIDE / (2 * Math.sqrt(3)) },
];
const PENT_R = SIDE / (2 * Math.sin(Math.PI / 5));
const PENT_VERTS = [];
for (let i = 0; i < 5; i++) {
  const ang = -Math.PI / 2 + i * (2 * Math.PI / 5);
  PENT_VERTS.push({ x: PENT_R * Math.cos(ang), y: PENT_R * Math.sin(ang) });
}
const RHOMBUS_VERTS = [
  { x: 51.961524227, y: 0 }, { x: 0, y: 30 },
  { x: -51.961524227, y: 0 }, { x: 0, y: -30 }
];

const SQ_AREA = SIDE * SIDE;
const TRI_AREA = (Math.sqrt(3) / 4) * SIDE * SIDE;
const PENT_AREA = (5 / 4) * SIDE * SIDE / Math.tan(Math.PI / 5);
const RHOMBUS_AREA = TRI_AREA * 2; 

const EPS = 1e-9;
const SNAP_DIST = 30;
const SAVE_PREFIX = 'shapeGame_save_';
const SAVE_SLOTS = 3;

// ---------- DOM ----------
const canvas = document.getElementById('cv');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const queueList = document.getElementById('queue-list');
const resultBar = document.getElementById('resultBar');
const resultTitle = document.getElementById('resultTitle');
const resultDesc = document.getElementById('resultDesc');

const ruleScreen = document.getElementById('ruleScreen');
const pauseMenu = document.getElementById('pauseMenu');
const saveMenu = document.getElementById('saveMenu');
const loadMenu = document.getElementById('loadMenu');
const rulesAgain = document.getElementById('rulesAgain');
const saveSlotsEl = document.getElementById('saveSlots');
const loadSlotsEl = document.getElementById('loadSlots');

// ---------- 상태 ----------
let gameState = 'ready';
let shapes = [];
let shapeQueue = [];
let savedType = null;
let view = { x: 0, y: 0, scale: 1 };
let mouse = { sx: 0, sy: 0, wx: 0, wy: 0 };
let preview = null;
let invalidPreview = null;
let panning = false;
let panStart = null;
let lastRejectReason = '';
let errorMsg = '';
let errorMsgTimer = null;
let tooltipX = 0;
let tooltipY = 0;
let tooltipStartTime = 0;

// ---------- 유틸 ----------
function rotPoint(p, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function worldVerts(shape) {
  let base;
  if (shape.type === 'square') base = SQ_VERTS;
  else if (shape.type === 'tri') base = TRI_VERTS;
  else if (shape.type === 'rhombus') base = RHOMBUS_VERTS;
  else base = PENT_VERTS;
  return base.map(v => {
    const r = rotPoint(v, shape.rot);
    return { x: shape.x + r.x, y: shape.y + r.y };
  });
}

function screenToWorld(sx, sy) {
  return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
}
function worldToScreen(wx, wy) {
  return { x: wx * view.scale + view.x, y: wy * view.scale + view.y };
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function closestPointOnSegment(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < EPS) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + abx * t, y: a.y + aby * t };
}

// ---------- 큐 생성 ----------
function buildQueue() {
  let pool = [];
  const setCount = Math.floor(TOTAL_SHAPES / 3);
  for (let i = 0; i < setCount; i++) {
    let set = (i === 3) ? ['square', 'tri', 'pent', 'rhombus'] : ['square', 'tri', 'pent'];
    const shuffled = [...set].sort(() => Math.random() - 0.5);
    pool.push(...shuffled);
  }
  while (pool.length < TOTAL_SHAPES) {
    pool.push(['square', 'tri', 'pent', 'rhombus'][Math.floor(Math.random() * 4)]);
  }
  return pool.slice(0, TOTAL_SHAPES);
}

function getNextType() {
  if (shapeQueue.length === 0 && savedType) {
    shapeQueue.push(savedType);
    savedType = null;
    updateQueueUI();
  }
  return shapeQueue.length > 0 ? shapeQueue[0] : null;
}

// ---------- 순수 수학: 다각형 교차 넓이 계산 (Sutherland-Hodgman) ----------
function getLineIntersection(p1, p2, p3, p4) {
  const a1 = p2.y - p1.y, b1 = p1.x - p2.x, c1 = a1 * p1.x + b1 * p1.y;
  const a2 = p4.y - p3.y, b2 = p3.x - p4.x, c2 = a2 * p3.x + b2 * p3.y;
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-9) return null;
  return { x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det };
}

function clipPolygon(subjectPoly, clipPoly) {
  // ✨ 자르는 도형(clipPoly)의 방향을 미리 계산
  const isCCW = getSignedArea(clipPoly) > 0;
  let outputList = subjectPoly;

  for (let i = 0; i < clipPoly.length; i++) {
    const cp1 = clipPoly[i];
    const cp2 = clipPoly[(i + 1) % clipPoly.length];
    const inputList = outputList;
    outputList = [];
    if (inputList.length === 0) break;

    let s = inputList[inputList.length - 1];
    for (const e of inputList) {
      // ✨ 외적 결과에 방향을 곱해서 "무조건 안쪽"을 판별
      const crossE = (cp2.x - cp1.x) * (e.y - cp1.y) - (cp2.y - cp1.y) * (e.x - cp1.x);
      const crossS = (cp2.x - cp1.x) * (s.y - cp1.y) - (cp2.y - cp1.y) * (s.x - cp1.x);
      
      // 도형이 시계방향이면 부호를 반대로!
      const eInside = isCCW ? (crossE >= -1e-9) : (crossE <= 1e-9);
      const sInside = isCCW ? (crossS >= -1e-9) : (crossS <= 1e-9);

      if (eInside) {
        if (!sInside) {
          const inter = getLineIntersection(s, e, cp1, cp2);
          if (inter) outputList.push(inter);
        }
        outputList.push(e);
      } else if (sInside) {
        const inter = getLineIntersection(s, e, cp1, cp2);
        if (inter) outputList.push(inter);
      }
      s = e;
    }
  }
  return outputList;
}

function getSignedArea(verts) {
  let area = 0;
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    area += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
  }
  return area / 2;
}

function getOverlapArea(vertsA, vertsB) {
  // ✨ 방향 판정 및 reverse() 로직을 완전히 삭제!
  const clipped = clipPolygon(vertsA, vertsB);
  if (!clipped || clipped.length < 3) return 0;
  
  return Math.abs(polygonArea(clipped.map(p => [p.x, p.y])));
}

// ---------- 같은 타입 변 공유 판정 ----------
function segmentsSharePositiveLength(p1, p2, q1, q2) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = q2.x - q1.x, d2y = q2.y - q1.y;
  const len1 = Math.hypot(d1x, d1y), len2 = Math.hypot(d2x, d2y);
  if (len1 < EPS || len2 < EPS) return false;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) > EPS * len1 * len2) return false;
  const collinear = d1x * (q1.y - p1.y) - d1y * (q1.x - p1.x);
  if (Math.abs(collinear) > EPS * len1) return false;
  const ux = d1x / len1, uy = d1y / len1;
  const tq1 = (q1.x - p1.x) * ux + (q1.y - p1.y) * uy;
  const tq2 = (q2.x - p1.x) * ux + (q2.y - p1.y) * uy;
  const lo = Math.max(0, Math.min(tq1, tq2));
  const hi = Math.min(len1, Math.max(tq1, tq2));
  return (hi - lo) > 1e-6;
}

function sharesEdgeWithSameType(candVerts, candType) {
  const candEdges = [];
  for (let i = 0; i < candVerts.length; i++)
    candEdges.push([candVerts[i], candVerts[(i + 1) % candVerts.length]]);
  for (const other of shapes) {
    if (other.type !== candType) continue;
    const ov = worldVerts(other);
    for (let i = 0; i < ov.length; i++) {
      const a = ov[i], b = ov[(i + 1) % ov.length];
      for (const [c, d] of candEdges)
        if (segmentsSharePositiveLength(a, b, c, d)) return true;
    }
  }
  return false;
}

// ---------- 스냅 ----------
function computeSnap(mwx, mwy) {
  const nextType = getNextType();
  if (!nextType) return { best: null, invalid: null };
  if (shapes.length === 0) return { best: { x: mwx, y: mwy, rot: 0, type: nextType }, invalid: null };

  let base;
  if (nextType === 'square') base = SQ_VERTS;
  else if (nextType === 'tri') base = TRI_VERTS;
  else if (nextType === 'rhombus') base = RHOMBUS_VERTS;
  else if (nextType === 'pent') base = PENT_VERTS;

  let best = null;
  let invalidBest = null;
  let checkedEdges = 0;
  lastRejectReason = '';

  for (const shape of shapes) {
    const verts = worldVerts(shape);
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      const cp = closestPointOnSegment({ x: mwx, y: mwy }, a, b);
      
      // [1단계] 마우스와 가까운 변 찾기 (SNAP_DIST 이내)
      if (dist({ x: mwx, y: mwy }, cp) > SNAP_DIST) continue;
      checkedEdges++;

      // 내부 변(이미 다른 도형과 맞닿은 변) 제외
      let isInnerEdge = false;
      for (const other of shapes) {
        if (other === shape) continue;
        const ov = worldVerts(other);
        for (let k = 0; k < ov.length; k++) {
          if (segmentsSharePositiveLength(a, b, ov[k], ov[(k + 1) % ov.length])) {
            isInnerEdge = true; break;
          }
        }
        if (isInnerEdge) break;
      }
      if (isInnerEdge) { lastRejectReason = 'inner_edge'; continue; }

      // [2단계] 양쪽 방향 후보 생성 및 소유자 겹침 대소 비교
      let candidates = [];
      for (let j = 0; j < base.length; j++) {
        const c0 = base[j], d0 = base[(j + 1) % base.length];
        for (const flip of [false, true]) {
          const targetA = flip ? b : a, targetB = flip ? a : b;
          const cvec = { x: d0.x - c0.x, y: d0.y - c0.y };
          const tvec = { x: targetB.x - targetA.x, y: targetB.y - targetA.y };
          const rot = Math.atan2(tvec.y, tvec.x) - Math.atan2(cvec.y, cvec.x);
          const rc0 = rotPoint(c0, rot);
          const cx = targetA.x - rc0.x, cy = targetA.y - rc0.y;
          const candVerts = worldVerts({ type: nextType, x: cx, y: cy, rot });

          // 같은 타입끼리 변을 공유하는 후보는 제외
          if (sharesEdgeWithSameType(candVerts, nextType)) continue;
          
          // 소유자와의 겹침 면적 계산
          const ownerOverlapArea = getOverlapArea(candVerts, verts);
          
          // 소유자와 겹치는 면적이 0.1을 초과하면 내부로 파고드는 후보이므로 탈락
          if (ownerOverlapArea > 0.1) continue;

          const dMouse = Math.hypot(cx - mwx, cy - mwy);
          candidates.push({ x: cx, y: cy, rot, dMouse, candVerts });
        }
      }

      if (candidates.length === 0) continue;
      
      // 마우스와 가장 가까운 쪽(유저의 의도) 선택
      candidates.sort((x, y) => x.dMouse - y.dMouse);
      const chosen = candidates[0];

      // [3단계] 최종 겹침 검사 (모든 기존 도형 대상, 예외 없음)
      let hasOverlap = false;
      let overlapWith = null;

      for (const other of shapes) {
        const otherVerts = worldVerts(other);
        const area = getOverlapArea(chosen.candVerts, otherVerts);
                
        if (area > 0.1) { 
          hasOverlap = true;
          overlapWith = other;
          break;
        }
      }

      const dMouseFinal = Math.hypot(chosen.x - mwx, chosen.y - mwy);

      if (hasOverlap) {
        // 겹침 발생 (오류 후보)
        if (!invalidBest || dMouseFinal < invalidBest.dist) {
          invalidBest = { x: chosen.x, y: chosen.y, rot: chosen.rot, type: nextType, dist: dMouseFinal, overlapWith };
        }
      } else {
        // 정상 배치
        if (!best || dMouseFinal < best.dist) {
          best = { x: chosen.x, y: chosen.y, rot: chosen.rot, type: nextType, dist: dMouseFinal };
        }
      }
    }
  }

  if (!best && !invalidBest && checkedEdges === 0) {
    lastRejectReason = 'no_edges';
  }

  return { best, invalid: best ? null : invalidBest };
}

// ---------- 볼록 껍질 / 채움 비율 ----------
function computeHullPoints() {
  if (shapes.length === 0) return null; 
  const points = [];
  for (const s of shapes) {
    for (const v of worldVerts(s)) {
      let dup = false;
      for (const p of points) {
        if (Math.abs(p[0] - v.x) < 1e-6 && Math.abs(p[1] - v.y) < 1e-6) { dup = true; break; }
      }
      if (!dup) points.push([v.x, v.y]);
    }
  }
  if (points.length < 3) return null;
  return polygonHull(points);
}

function shapesTotalArea() {
  let sum = 0;
  for (const s of shapes) {
    if (s.type === 'square') sum += SQ_AREA;
    else if (s.type === 'tri') sum += TRI_AREA;
    else if (s.type === 'rhombus') sum += RHOMBUS_AREA;
    else sum += PENT_AREA;
  }
  return sum;
}

function computeFillPercent() {
  const hull = computeHullPoints();
  if (!hull || hull.length < 3) return 0;
  const hullA = Math.abs(polygonArea(hull));
  if (hullA < EPS) return 0;
  return (shapesTotalArea() / hullA) * 100;
}

// ---------- 렌더 ----------
function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawShape(shape, opts = {}) {
  const verts = worldVerts(shape);
  ctx.beginPath();
  const p0 = worldToScreen(verts[0].x, verts[0].y);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < verts.length; i++) {
    const p = worldToScreen(verts[i].x, verts[i].y);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  if (opts.fill) { ctx.fillStyle = opts.fill; ctx.fill(); }
  if (opts.stroke) { ctx.strokeStyle = opts.stroke; ctx.lineWidth = opts.lineWidth || 2; ctx.stroke(); }
}

function updateQueueUI() {
  queueList.innerHTML = '';
  for (let i = 1; i < Math.min(4, shapeQueue.length); i++) { 
    const t = shapeQueue[i];
    const el = document.createElement('div');
    el.className = 'q-item';
    let svgContent = '', color = '';
    if (t === 'square') { color = '#4a80d8'; svgContent = `<rect x="4" y="4" width="16" height="16" fill="${color}" />`; }
    else if (t === 'tri') { color = '#d8804a'; svgContent = `<polygon points="12,4 20,20 4,20" fill="${color}" />`; }
    else if (t === 'rhombus') { color = '#50c8b4'; svgContent = `<polygon points="12,2 22,12 12,22 2,12" fill="${color}" />`; }
    else if (t === 'pent') { 
      color = '#8a4ad8'; 
      const pts = [];
      for (let k = 0; k < 5; k++) {
        const ang = -Math.PI / 2 + k * (2 * Math.PI / 5);
        pts.push(`${12 + 9 * Math.cos(ang)},${12 + 9 * Math.sin(ang)}`);
      }
      svgContent = `<polygon points="${pts.join(' ')}" fill="${color}" />`;
    }
    el.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${svgContent}</svg>`;
    queueList.appendChild(el);
  }

  const slotList = document.getElementById('slot-list');
  slotList.innerHTML = '';
  const slotEl = document.createElement('div');
  slotEl.className = 'q-item';
  if (savedType) {
    let svgContent = '', color = '';
    if (savedType === 'square') { color = '#4a80d8'; svgContent = `<rect x="4" y="4" width="16" height="16" fill="${color}" />`; }
    else if (savedType === 'tri') { color = '#d8804a'; svgContent = `<polygon points="12,4 20,20 4,20" fill="${color}" />`; }
    else if (savedType === 'rhombus') { color = '#50c8b4'; svgContent = `<polygon points="12,2 22,12 12,22 2,12" fill="${color}" />`; }
    else if (savedType === 'pent') {
      color = '#8a4ad8';
      const pts = [];
      for (let k = 0; k < 5; k++) {
        const ang = -Math.PI / 2 + k * (2 * Math.PI / 5);
        pts.push(`${12 + 9 * Math.cos(ang)},${12 + 9 * Math.sin(ang)}`);
      }
      svgContent = `<polygon points="${pts.join(' ')}" fill="${color}" />`;
    }
    slotEl.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${svgContent}</svg>`;
  } else {
    slotEl.innerHTML = `<div style="width:20px; height:20px; border:2px dashed #555; border-radius:4px;"></div>`;
  }
  slotList.appendChild(slotEl);
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  for (const s of shapes) {
    const color = s.type === 'square' ? 'rgba(80,140,220,0.85)'
                : s.type === 'tri' ? 'rgba(220,140,80,0.85)'
                : s.type === 'pent' ? 'rgba(138,74,216,0.85)'
                : 'rgba(80, 200, 180, 0.85)';
    drawShape(s, { fill: color, stroke: '#fff', lineWidth: 1.5 });
  }
  
  if (gameState === 'playing') {
    const nextT = getNextType();
    if (nextT) {
      let drawX, drawY, drawRot;
      let isSnapped = false;
      
      if (preview) { drawX = preview.x; drawY = preview.y; drawRot = preview.rot; isSnapped = true; }
      else if (invalidPreview) { drawX = invalidPreview.x; drawY = invalidPreview.y; drawRot = invalidPreview.rot; isSnapped = true; }
      else { drawX = mouse.wx; drawY = mouse.wy; drawRot = 0; isSnapped = false; }

      const handShape = { type: nextT, x: drawX, y: drawY, rot: drawRot };
      const color = nextT === 'square' ? 'rgba(80,140,220,0.35)'
                  : nextT === 'tri' ? 'rgba(220,140,80,0.35)'
                  : nextT === 'pent' ? 'rgba(138,74,216,0.35)'
                  : 'rgba(80, 200, 180, 0.35)';
                  
      ctx.globalAlpha = isSnapped ? 1.0 : 0.4; 
      drawShape(handShape, { fill: color, stroke: 'rgba(255,255,255,0.7)', lineWidth: 1.5 });
      ctx.globalAlpha = 1.0;
    }
  }
  
  if (invalidPreview && gameState === 'playing') {
    drawShape(invalidPreview, { fill: 'rgba(255, 80, 80, 0.1)', stroke: 'rgba(255, 80, 80, 0.6)', lineWidth: 1.5 });
  }

  const hull = computeHullPoints();
  if (hull) {
    ctx.beginPath();
    const hp0 = worldToScreen(hull[0][0], hull[0][1]);
    ctx.moveTo(hp0.x, hp0.y);
    for (let i = 1; i < hull.length; i++) {
      const hp = worldToScreen(hull[i][0], hull[i][1]);
      ctx.lineTo(hp.x, hp.y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,220,80,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (errorMsg && gameState === 'playing') {
    const elapsed = performance.now() - tooltipStartTime;
    let alpha = 1;
    if (elapsed < 150) alpha = elapsed / 150;
    else if (elapsed > 900) alpha = Math.max(0, 1 - (elapsed - 900) / 300);
    
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const textWidth = ctx.measureText(errorMsg).width;
    const paddingX = 10;
    const boxWidth = textWidth + paddingX * 2;
    const boxHeight = 26;
    
    ctx.fillStyle = 'rgba(30, 30, 36, 0.95)';
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.8)';
    ctx.lineWidth = 1;
    
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(tooltipX - boxWidth / 2, tooltipY - boxHeight / 2, boxWidth, boxHeight, 6);
    else ctx.rect(tooltipX - boxWidth / 2, tooltipY - boxHeight / 2, boxWidth, boxHeight);
    
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(errorMsg, tooltipX, tooltipY);
    ctx.restore();
  }

  const rawPct = computeFillPercent();
  const displayPct = Math.floor(rawPct * 100) / 100; 
  hud.textContent =
    `${shapes.length} / ${TOTAL_SHAPES}\n` +
    `채움: ${displayPct.toFixed(2)}% (목표 ${TARGET_PCT}%)\n` +
    `줌: ${view.scale.toFixed(2)}x`;
}

function loop() { render(); requestAnimationFrame(loop); }

// ---------- 화면 전환 및 게임 ----------
function showOverlay(el) { el.classList.remove('hidden'); }
function hideOverlay(el) { el.classList.add('hidden'); }
function hideAllOverlays() { [ruleScreen, pauseMenu, saveMenu, loadMenu, rulesAgain].forEach(hideOverlay); }

function resetGame() {
  shapes = [];
  shapeQueue = buildQueue();
  preview = null;
  savedType = null;
  view = { x: 0, y: 0, scale: 1 };
  resultBar.classList.remove('show');
  
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const w = screenToWorld(cx, cy);
  const firstType = shapeQueue.shift();
  shapes.push({ type: firstType, x: w.x, y: w.y, rot: 0 });
  
  updateQueueUI();
}

function startGame() {
  resetGame();
  gameState = 'playing';
  hideAllOverlays();
}

function goHome() {
  gameState = 'ready';
  shapes = [];
  shapeQueue = [];
  preview = null;
  resultBar.classList.remove('show');
  hideAllOverlays();
  showOverlay(ruleScreen);
}

function checkResult() {
  const rawPct = computeFillPercent();
  const truncatedPct = Math.floor(rawPct * 100) / 100; 
  const success = truncatedPct >= TARGET_PCT;
  gameState = 'result';
  
  resultTitle.textContent = success ? '성공!' : '실패';
  resultTitle.className = 'result-title ' + (success ? 'success' : 'fail');
  resultDesc.textContent = `채움 비율: ${truncatedPct.toFixed(2)}% (목표 ${TARGET_PCT}%)`;
  
  hideAllOverlays();
  resultBar.classList.add('show');
}

// ---------- 저장/불러오기 ----------
function serializeState() {
  return {
    version: 2,
    shapes: shapes.map(s => ({ type: s.type, x: s.x, y: s.y, rot: s.rot })),
    queue: [...shapeQueue],
    view: { x: view.x, y: view.y, scale: view.scale },
    savedAt: new Date().toISOString(),
  };
}
function saveToSlot(i) {
  try { localStorage.setItem(SAVE_PREFIX + i, JSON.stringify(serializeState())); return true; } 
  catch (e) { return false; }
}
function loadFromSlot(i) {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + i);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || data.version !== 2 || !Array.isArray(data.shapes)) return false;
    shapes = data.shapes.map(s => ({ type: s.type, x: s.x, y: s.y, rot: s.rot }));
    shapeQueue = Array.isArray(data.queue) ? [...data.queue] : [];
    view = data.view && typeof data.view.x === 'number' ? { x: data.view.x, y: data.view.y, scale: data.view.scale } : { x: 0, y: 0, scale: 1 };
    preview = null;
    savedType = data.savedType || null;
    gameState = 'playing';
    resultBar.classList.remove('show');
    updateQueueUI();
    hideAllOverlays();
    return true;
  } catch (e) { return false; }
}
function slotInfo(i) {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + i);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.shapes)) return null;
    return { count: d.shapes.length, savedAt: d.savedAt || '' };
  } catch (e) { return null; }
}
function deleteSlot(i) {
  try { localStorage.removeItem(SAVE_PREFIX + i); return true; } 
  catch (e) { return false; }
}
function renderSlots(container, mode) {
  container.innerHTML = '';
  for (let i = 0; i < SAVE_SLOTS; i++) {
    const info = slotInfo(i);
    const row = document.createElement('div');
    row.className = 'slot-item';
    
    let timeStr = '';
    if (info && info.savedAt) {
      timeStr = new Date(info.savedAt).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      });
    }

    const label = document.createElement('div');
    label.innerHTML = `<b>슬롯 ${i + 1}</b> <span class="info">${info ? `${info.count}개 · ${timeStr}` : '비어 있음'}</span>`;
    
    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex';
    btnGroup.style.gap = '6px';

    const btn = document.createElement('button');
    if (mode === 'save') {
      btn.textContent = '저장';
      btn.onclick = () => { if (saveToSlot(i)) renderSlots(container, 'save'); else alert('저장 실패'); };
      btnGroup.appendChild(btn);
    } else {
      btn.textContent = '불러오기';
      btn.disabled = !info;
      btn.onclick = () => { if (!loadFromSlot(i)) alert('불러오기 실패'); };
      btnGroup.appendChild(btn);

      const btnDel = document.createElement('button');
      btnDel.textContent = '삭제';
      btnDel.className = 'danger';
      btnDel.disabled = !info;
      btnDel.onclick = () => {
        if (confirm(`슬롯 ${i + 1}의 데이터를 정말 삭제하시겠습니까?`)) {
          if (deleteSlot(i)) renderSlots(container, 'load');
          else alert('삭제 실패');
        }
      };
      btnGroup.appendChild(btnDel);
    }

    row.appendChild(label);
    row.appendChild(btnGroup);
    container.appendChild(row);
  }
}

// ---------- 이벤트 ----------
document.getElementById('btnStart').onclick = startGame;
document.getElementById('btnResume').onclick = () => { gameState = 'playing'; hideAllOverlays(); };
document.getElementById('btnShowRules').onclick = () => { hideOverlay(pauseMenu); showOverlay(rulesAgain); };
document.getElementById('btnRulesBack').onclick = () => { hideOverlay(rulesAgain); showOverlay(pauseMenu); };
document.getElementById('btnSave').onclick = () => { renderSlots(saveSlotsEl, 'save'); hideOverlay(pauseMenu); showOverlay(saveMenu); };
document.getElementById('btnLoad').onclick = () => { renderSlots(loadSlotsEl, 'load'); hideOverlay(pauseMenu); showOverlay(loadMenu); };
document.getElementById('btnSaveClose').onclick = () => { hideOverlay(saveMenu); showOverlay(pauseMenu); };
document.getElementById('btnLoadClose').onclick = () => { hideOverlay(loadMenu); showOverlay(pauseMenu); };
document.getElementById('btnRestart').onclick = () => { if (confirm('처음으로 돌아갑니다. 저장하지 않은 진행은 사라집니다.')) goHome(); };
document.getElementById('btnResultRestart').onclick = startGame;
document.getElementById('btnResultHome').onclick = goHome;

canvas.addEventListener('mousemove', (e) => {
  if (gameState !== 'playing' && gameState !== 'result') return;
  
  if (panning && panStart) {
    view.x += e.clientX - panStart.x;
    view.y += e.clientY - panStart.y;
    panStart = { x: e.clientX, y: e.clientY };
    return;
  }
  
  if (gameState === 'playing') {
    const rect = canvas.getBoundingClientRect();
    mouse.sx = e.clientX - rect.left;
    mouse.sy = e.clientY - rect.top;
    const w = screenToWorld(mouse.sx, mouse.sy);
    mouse.wx = w.x; mouse.wy = w.y;
    
    const res = computeSnap(w.x, w.y);
    preview = res.best;
    invalidPreview = res.invalid;
    
    if (preview) {
      canvas.style.cursor = 'pointer';
    } else if (invalidPreview) {
      canvas.style.cursor = 'not-allowed';
    } else {
      canvas.style.cursor = 'crosshair';
    }
  }
});

canvas.addEventListener('mousedown', (e) => {
  if (gameState !== 'playing' && gameState !== 'result') return;
  if (e.button === 1) {
    e.preventDefault();
    panning = true;
    panStart = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 1 && panning) {
    panning = false; panStart = null;
    canvas.style.cursor = 'crosshair';
  }
});

canvas.addEventListener('click', (e) => {
  if (gameState !== 'playing' || e.button !== 0) return;
  
  const nextT = getNextType();
  if (!nextT) return;

  if (preview) {
    shapes.push({ type: nextT, x: preview.x, y: preview.y, rot: preview.rot });
    
    if (shapeQueue.length > 0) shapeQueue.shift();
    else if (savedType) savedType = null;
    
    updateQueueUI();
    errorMsg = '';
    
    if (shapes.length >= TOTAL_SHAPES) {
      checkResult();
      return;
    }
    
    const res = computeSnap(mouse.wx, mouse.wy);
    preview = res.best;
    invalidPreview = res.invalid;
    
  } else if (invalidPreview) {
    errorMsg = '공간이 부족합니다!';
    tooltipX = mouse.sx;
    tooltipY = mouse.sy - 20;
    tooltipStartTime = performance.now();
    clearTimeout(errorMsgTimer);
    errorMsgTimer = setTimeout(() => { errorMsg = ''; }, 1200);
    
  } else {
    errorMsg = '도형의 변에 인접하게 놓아주세요.';
    tooltipX = mouse.sx;
    tooltipY = mouse.sy - 20;
    tooltipStartTime = performance.now();
    clearTimeout(errorMsgTimer);
    errorMsgTimer = setTimeout(() => { errorMsg = ''; }, 1200);
  }
});

canvas.addEventListener('wheel', (e) => {
  if (gameState !== 'playing' && gameState !== 'result') return;
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const before = screenToWorld(sx, sy);
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const newScale = Math.max(0.2, Math.min(5, view.scale * factor));
  if (newScale === view.scale) return;
  view.scale = newScale;
  view.x = sx - before.x * newScale;
  view.y = sy - before.y * newScale;
}, { passive: false });

canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (gameState !== 'playing') return;
  if (shapeQueue.length === 0) return;

  const currentNext = shapeQueue[0];

  if (!savedType) {
    savedType = currentNext;
    shapeQueue.shift();
  } else {
    const temp = savedType;
    savedType = currentNext;
    shapeQueue[0] = temp;
  }

  updateQueueUI();
  preview = null;
  invalidPreview = null;
  
  const w = screenToWorld(mouse.sx, mouse.sy);
  const res = computeSnap(w.x, w.y);
  preview = res.best;
  invalidPreview = res.invalid;
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (gameState === 'playing') {
      gameState = 'paused';
      showOverlay(pauseMenu);
    } else if (gameState === 'paused') {
      if (!saveMenu.classList.contains('hidden') || !loadMenu.classList.contains('hidden') || !rulesAgain.classList.contains('hidden')) {
        hideOverlay(saveMenu); hideOverlay(loadMenu); hideOverlay(rulesAgain);
        showOverlay(pauseMenu);
      } else {
        gameState = 'playing';
        hideAllOverlays();
      }
    }
  }
});

window.addEventListener('resize', resize);

// ---------- 초기화 ----------
resize();
loop();