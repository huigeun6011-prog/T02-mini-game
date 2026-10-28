import { polygonHull, polygonArea } from 'https://cdn.jsdelivr.net/npm/d3-polygon@3/+esm';

// ---------- 설정 ----------
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
const RANKING_KEY = 'shapeGame_ranking';
const MAX_RANKING = 3;

// ---------- DOM ----------
const canvas = document.getElementById('cv');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const queueList = document.getElementById('queue-list');
const resultBar = document.getElementById('resultBar');
const resultTitle = document.getElementById('resultTitle');
const resultDesc = document.getElementById('resultDesc');
const pauseMenu = document.getElementById('pauseMenu');
const saveMenu = document.getElementById('saveMenu');
const loadMenu = document.getElementById('loadMenu');
const saveSlotsEl = document.getElementById('saveSlots');
const loadSlotsEl = document.getElementById('loadSlots');

// ---------- 설정 및 모드 판별 ----------
const urlParams = new URLSearchParams(window.location.search);
const currentMode = urlParams.get('mode') || 'hard'; // 기본값 hard

const modeConfig = {
  hard: {
    totalShapes: 25,
    targetPct: 80,
    hasTimer: true,
    hasRanking: true,
    hasSave: true,
    timeLimit: 100,
    shapes: ['square', 'tri', 'pent', 'rhombus']
  },
  easy: {
    totalShapes: 10,
    targetPct: 60,
    hasTimer: false,
    hasRanking: false,
    hasSave: true,
    timeLimit: 0,
    shapes: ['square', 'tri']
  },
  practice: {
    totalShapes: Infinity, // 무한
    targetPct: 0,
    hasTimer: false,
    hasRanking: false,
    hasSave: false,
    timeLimit: 0,
    shapes: ['square', 'tri', 'pent', 'rhombus']
  }
};

const SAVE_PREFIX = `shapeGame_save_${currentMode}_`;
const SAVE_SLOTS = 3;

const config = modeConfig[currentMode];
const TOTAL_SHAPES = config.totalShapes;
const TARGET_PCT = config.targetPct;
const HAS_TIMER = config.hasTimer;
const HAS_RANKING = config.hasRanking;
const TIME_LIMIT = config.timeLimit;
const AVAILABLE_SHAPES = config.shapes;

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
let currentBundleIndex = 0;
let currentShapeIndex = 0;
let replacedBundleIndex = -1;
let replacedShapeIndex = -1;
let startTime = 0;
let isTimeOver = false;
let pausedTime = 0;
let timerExplosionStart = 0;
let timerParticles = [];
let isFontLoaded = false;
let finalRemainingTime = 0;
let stateBeforePause = 'playing';
let pendingRankData = null;

let hoveredShape = null;
let isShiftPressed = false;

// 폰트 로딩 대기
document.fonts.load('bold 80px "DSEG7 Classic"').then(() => {
  isFontLoaded = true;
}).catch(() => {
  console.warn('DSEG 폰트 로딩 실패, 기본 폰트 사용');
  isFontLoaded = true;
});

// ---------- 커스텀 모달 유틸 ----------
function showCustomAlert(message, title = '알림') {
  return new Promise((resolve) => {
    const modal = document.getElementById('customAlertModal');
    const titleEl = document.getElementById('customAlertTitle');
    const msgEl = document.getElementById('customAlertMessage');
    const btnContainer = document.getElementById('customAlertButtons');

    titleEl.textContent = title;
    msgEl.textContent = message;
    btnContainer.innerHTML = '';

    const btnOk = document.createElement('button');
    btnOk.textContent = '확인';
    btnOk.className = 'btn-confirm';
    btnOk.onclick = () => {
      modal.classList.add('hidden');
      resolve();
    };
    btnContainer.appendChild(btnOk);

    modal.classList.remove('hidden');
  });
}

function showCustomConfirm(message, title = '확인') {
  return new Promise((resolve) => {
    const modal = document.getElementById('customAlertModal');
    const titleEl = document.getElementById('customAlertTitle');
    const msgEl = document.getElementById('customAlertMessage');
    const btnContainer = document.getElementById('customAlertButtons');

    titleEl.textContent = title;
    msgEl.textContent = message;
    btnContainer.innerHTML = '';

    const btnCancel = document.createElement('button');
    btnCancel.textContent = '취소';
    btnCancel.className = 'btn-cancel';
    btnCancel.onclick = () => {
      modal.classList.add('hidden');
      resolve(false);
    };
    btnContainer.appendChild(btnCancel);

    const btnOk = document.createElement('button');
    btnOk.textContent = '확인';
    btnOk.className = 'btn-confirm';
    btnOk.onclick = () => {
      modal.classList.add('hidden');
      resolve(true);
    };
    btnContainer.appendChild(btnOk);

    modal.classList.remove('hidden');
  });
}

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

// 점이 다각형 내부에 있는지 판별
function isPointInPolygon(p, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x, yi = verts[i].y;
    const xj = verts[j].x, yj = verts[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ---------- 큐 생성 ----------
function buildQueue() { 
  if (currentMode === 'practice') {
    return [];
  }

  let sets = [];

  if (currentMode === 'easy') {
    for (let i = 0; i < 5; i++) {
      sets.push(['tri', 'square']);
    }
    return sets; 
  } 
  
  // 어려움(하드) 모드
  for (let i = 0; i < 7; i++) {
    sets.push(['square', 'tri', 'pent']);
  }
  const rhombusIndex = Math.floor(Math.random() * 7) + 1; 
  sets.splice(rhombusIndex, 0, ['rhombus']);

  let triSetIndex = Math.floor(Math.random() * 8);
  while (triSetIndex === 0 || triSetIndex === rhombusIndex) { 
    triSetIndex = Math.floor(Math.random() * 8);
  }
  const triBundle = ['tri', 'tri', 'tri'];
  triBundle.isSpecial = true; 
  sets.splice(triSetIndex, 0, triBundle);

  return sets.map(set => {
    const shuffled = [...set].sort(() => Math.random() - 0.5);
    if (set.isSpecial) shuffled.isSpecial = true;
    return shuffled;
  });
}

let practiceCurrentType = 'tri';

function getNextType() {
  if (currentMode === 'practice') {
    return practiceCurrentType;
  }
  
  if (currentBundleIndex >= shapeQueue.length) {
    if (savedType) {
      shapeQueue.push([savedType]);
      savedType = null;
      updateQueueUI();
    } else {
      return null;
    }
  }
  
  if (shapeQueue.length > currentBundleIndex && 
      shapeQueue[currentBundleIndex].length > currentShapeIndex) {
    return shapeQueue[currentBundleIndex][currentShapeIndex];
  }
  return null;
}

// ---------- 순수 수학 ----------
function getLineIntersection(p1, p2, p3, p4) {
  const a1 = p2.y - p1.y, b1 = p1.x - p2.x, c1 = a1 * p1.x + b1 * p1.y;
  const a2 = p4.y - p3.y, b2 = p3.x - p4.x, c2 = a2 * p3.x + b2 * p3.y;
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-9) return null;
  return { x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det };
}

function clipPolygon(subjectPoly, clipPoly) {
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
      const crossE = (cp2.x - cp1.x) * (e.y - cp1.y) - (cp2.y - cp1.y) * (e.x - cp1.x);
      const crossS = (cp2.x - cp1.x) * (s.y - cp1.y) - (cp2.y - cp1.y) * (s.x - cp1.x);
      
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

// 두 도형이 변을 공유하는지 검사
function shapesShareEdge(vertsA, vertsB) {
  for (let i = 0; i < vertsA.length; i++) {
    const a1 = vertsA[i], a2 = vertsA[(i + 1) % vertsA.length];
    for (let j = 0; j < vertsB.length; j++) {
      const b1 = vertsB[j], b2 = vertsB[(j + 1) % vertsB.length];
      if (segmentsSharePositiveLength(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

// ---------- 스냅 ----------
function computeSnap(mwx, mwy) {
  const nextType = getNextType();
  if (!nextType) return { best: null, invalid: null };
  
  if (shapes.length === 0) {
    return { best: { x: mwx, y: mwy, rot: 0, type: nextType }, invalid: null };
  }

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
      
      if (dist({ x: mwx, y: mwy }, cp) > SNAP_DIST) continue;
      checkedEdges++;

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

      let candidates = [];
      for (let j = 0; j < base.length; j++) {
        const c0 = base[j], d0 = base[(j + 1) % base.length];
        for (const flip of [false, true]) {
          const targetA = flip ? b : a, targetB = flip ? a : b;
          const cvec = { x: d0.x - c0.x, y: d0.y - c0.y };
          const tvec = { x: targetB.x - targetA.x, y: targetB.y - targetA.y };
          
          let rot = Math.atan2(tvec.y, tvec.x) - Math.atan2(cvec.y, cvec.x);
          const rotDegrees = Math.round(rot * (180 / Math.PI));
          rot = rotDegrees * (Math.PI / 180);

          const rc0 = rotPoint(c0, rot);
          const cx = targetA.x - rc0.x, cy = targetA.y - rc0.y;
          
          let candVerts = worldVerts({ type: nextType, x: cx, y: cy, rot });

          candVerts[j] = { x: targetA.x, y: targetA.y };
          candVerts[(j + 1) % base.length] = { x: targetB.x, y: targetB.y };

          if (sharesEdgeWithSameType(candVerts, nextType)) continue;
          
          const ownerOverlapArea = getOverlapArea(candVerts, verts);
          if (ownerOverlapArea > 1e-6) continue;

          const dMouse = Math.hypot(cx - mwx, cy - mwy);
          candidates.push({ x: cx, y: cy, rot, dMouse, candVerts });
        }
      }

      if (candidates.length === 0) continue;
      
      candidates.sort((x, y) => x.dMouse - y.dMouse);
      const chosen = candidates[0];

      let hasOverlap = false;
      let overlapWith = null;

      for (const other of shapes) {
        const otherVerts = worldVerts(other);
        const area = getOverlapArea(chosen.candVerts, otherVerts);
        if (area > 1e-6) { 
          hasOverlap = true;
          overlapWith = other;
          break;
        }
      }

      const dMouseFinal = Math.hypot(chosen.x - mwx, chosen.y - mwy);

      if (hasOverlap) {
        if (!invalidBest || dMouseFinal < invalidBest.dist) {
          invalidBest = { x: chosen.x, y: chosen.y, rot: chosen.rot, type: nextType, dist: dMouseFinal, overlapWith };
        }
      } else {
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

function createShapeIcon(type) {
  const el = document.createElement('div');
  el.className = 'q-item';
  
  let svgContent = '', color = '';
  if (type === 'square') { 
    color = '#4a80d8'; 
    svgContent = `<rect x="4" y="4" width="16" height="16" fill="${color}" />`; 
  } else if (type === 'tri') { 
    color = '#d8804a'; 
    svgContent = `<polygon points="12,4 20,20 4,20" fill="${color}" />`; 
  } else if (type === 'rhombus') { 
    color = '#50c8b4'; 
    svgContent = `<polygon points="12,2 22,12 12,22 2,12" fill="${color}" />`; 
  } else if (type === 'pent') { 
    color = '#8a4ad8'; 
    const pts = [];
    for (let k = 0; k < 5; k++) {
      const ang = -Math.PI / 2 + k * (2 * Math.PI / 5);
      pts.push(`${12 + 9 * Math.cos(ang)},${12 + 9 * Math.sin(ang)}`);
    }
    svgContent = `<polygon points="${pts.join(' ')}" fill="${color}" />`;
  }
  
  el.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${svgContent}</svg>`;
  return el;
}

function updateQueueUI() {
  if (currentMode === 'practice') {
    const queueUi = document.getElementById('queue-ui');
    const slotUi = document.getElementById('slot-ui');
    if (queueUi) queueUi.style.display = 'none';
    if (slotUi) slotUi.style.display = 'none';
    return;
  }
  const queueArea = document.getElementById('queue-area');
  const slotArea = document.getElementById('slot-area');
  
  if (!queueArea || !slotArea) return;
  
  queueArea.innerHTML = '';
  slotArea.innerHTML = '';

  const currentBundle = shapeQueue[currentBundleIndex] || [];
  const isTripleTri = currentBundle.isSpecial === true; 
  const originalBundleSize = currentBundle.length + currentShapeIndex; 

  for (let i = 0; i < 3; i++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'q-item-wrapper';

    if (i < currentShapeIndex) {
      const empty = document.createElement('div');
      empty.className = 'empty-slot';
      wrapper.appendChild(empty);
    } 
    else if (i < originalBundleSize) {
      if (i === currentShapeIndex) {
        const indicator = document.createElement('div');
        indicator.className = 'indicator';
        indicator.textContent = '▼';
        wrapper.appendChild(indicator);
      }
      
      const shapeType = currentBundle[i - currentShapeIndex];
      if (isTripleTri) {
        const specialWrapper = document.createElement('div');
        specialWrapper.className = 'special-bundle';
        specialWrapper.appendChild(createShapeIcon(shapeType));
        wrapper.appendChild(specialWrapper);
      } else {
        wrapper.appendChild(createShapeIcon(shapeType));
      }
    } 
    else {
      const empty = document.createElement('div');
      empty.className = 'empty-slot';
      wrapper.appendChild(empty);
    }

    queueArea.appendChild(wrapper);
  }

  const divider = document.createElement('div');
  divider.className = 'queue-divider';
  queueArea.appendChild(divider);

  const nextBundleIndex = currentBundleIndex + 1;
  let nextItem = null;
  
  if (shapeQueue.length > nextBundleIndex && shapeQueue[nextBundleIndex].length > 0) {
    const isNextSpecial = shapeQueue[nextBundleIndex].isSpecial === true;
    nextItem = { type: shapeQueue[nextBundleIndex][0], isSlot: false, isSpecial: isNextSpecial };
  } else if (savedType) {
    nextItem = { type: savedType, isSlot: true };
  }

  if (nextItem) {
    const nextWrapper = document.createElement('div');
    nextWrapper.className = 'q-item-wrapper';
    
    if (nextItem.isSpecial) {
      const specialWrapper = document.createElement('div');
      specialWrapper.className = 'special-bundle';
      specialWrapper.appendChild(createShapeIcon(nextItem.type));
      nextWrapper.appendChild(specialWrapper);
    } else if (nextItem.isSlot) {
      const slotWrapper = document.createElement('div');
      slotWrapper.className = 'slot-styled';
      slotWrapper.appendChild(createShapeIcon(nextItem.type));
      nextWrapper.appendChild(slotWrapper);
    } else {
      nextWrapper.appendChild(createShapeIcon(nextItem.type));
    }
    queueArea.appendChild(nextWrapper);
  } else {
    const emptyNext = document.createElement('div');
    emptyNext.className = 'q-item-wrapper';
    emptyNext.innerHTML = `<div class="empty-slot"></div>`;
    queueArea.appendChild(emptyNext);
  }

  slotArea.innerHTML = '';
  const isLocked = isTripleTri || (currentBundleIndex === replacedBundleIndex && currentShapeIndex === replacedShapeIndex);

  const slotEl = document.createElement('div');
  slotEl.className = 'slot-base ' + (savedType ? 'slot-filled' : 'slot-empty');
  if (isLocked) slotEl.classList.add('slot-locked');

  if (savedType) {
    const icon = createShapeIcon(savedType);
    icon.style.width = '28px';
    icon.style.height = '28px';
    slotEl.appendChild(icon);
  }
  slotArea.appendChild(slotEl);
}

function updatePracticeCountUI() {
  const counts = { tri: 0, square: 0, pent: 0, rhombus: 0 };
  for (const s of shapes) {
    if (counts[s.type] !== undefined) counts[s.type]++;
  }

  document.querySelectorAll('.count-icon').forEach(el => {
    if (el.innerHTML === '') {
      const type = el.getAttribute('data-type');
      el.appendChild(createShapeIcon(type));
    }
  });

  document.getElementById('count-tri').textContent = counts.tri;
  document.getElementById('count-square').textContent = counts.square;
  document.getElementById('count-pent').textContent = counts.pent;
  document.getElementById('count-rhombus').textContent = counts.rhombus;
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 0. 타이머 및 파편 렌더링
  if (HAS_TIMER && (gameState === 'playing' || gameState === 'result')) {
    let remainingTime = TIME_LIMIT;
    
    if (gameState === 'playing') {
      remainingTime = Math.max(0, TIME_LIMIT - (performance.now() - startTime) / 1000);
      if (remainingTime <= 0 && !isTimeOver) {
        isTimeOver = true;
        timerExplosionStart = performance.now();
        if (!prefersReducedMotion) createTimerParticles();
      }
    } else if (gameState === 'result') {
      remainingTime = finalRemainingTime; 
    }

    const centerX = window.innerWidth / 2;
    const timerY = window.innerHeight / 2 - 200;

    // 폭발 후 파편 그리기
    if (isTimeOver && timerParticles.length > 0) {
      for (let i = timerParticles.length - 1; i >= 0; i--) {
        const p = timerParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05;
        p.alpha -= 0.015;
        
        if (p.alpha <= 0) {
          timerParticles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = '#ff5050';
        ctx.fillRect(p.x, p.y, p.size, p.size);
        ctx.restore();
      }
    } 
    // 폭발 전 타이머 그리기
    else if (!isTimeOver) {
      ctx.save();
      const fontFamily = isFontLoaded ? '"DSEG7 Classic", monospace' : 'sans-serif';
      ctx.font = `bold 80px ${fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      let timeStr;
      if (remainingTime > 30) {
        timeStr = Math.ceil(remainingTime).toString();
      } else if (remainingTime > 10) {
        timeStr = remainingTime.toFixed(1);
      } else {
        timeStr = remainingTime.toFixed(2);
      }

      if (remainingTime <= 10 && remainingTime > 0 && !prefersReducedMotion) {
        const now = performance.now();
        const cycle = (now % 1000) / 1000;
        
        const pulseRadius = 40 + (cycle * 60);
        const pulseAlpha = 1 - cycle;
        
        ctx.beginPath();
        ctx.arc(centerX, timerY, pulseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 80, 80, ${pulseAlpha * 0.5})`;
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 80, 80, 0.2)';
        ctx.fillText(timeStr, centerX, timerY);
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fillText(timeStr, centerX, timerY);
      }
      ctx.restore();
    }
  }
  
  // 1. 배치된 도형 렌더링
  for (const s of shapes) {
    const color = s.type === 'square' ? 'rgba(80,140,220,0.85)'
                : s.type === 'tri' ? 'rgba(220,140,80,0.85)'
                : s.type === 'pent' ? 'rgba(138,74,216,0.85)'
                : 'rgba(80, 200, 180, 0.85)';
    drawShape(s, { fill: color, stroke: '#fff', lineWidth: 1.5 });

    // Shift 키가 눌려있고, 이 도형이 hoveredShape라면 붉은색 덧씌우기
    if (isShiftPressed && s === hoveredShape) {
      drawShape(s, { fill: 'rgba(255, 80, 80, 0.4)', stroke: 'rgba(255, 80, 80, 0.9)', lineWidth: 2 });
    }
  }

  // 2. 미리보기 (Shift 키가 눌리지 않았을 때만 그리기)
  if (gameState === 'playing' && !isShiftPressed) {
    const nextT = getNextType();
    if (nextT) {
      let drawX, drawY, drawRot;
      let isSnapped = false;
      
      if (preview) { drawX = preview.x; drawY = preview.y; drawRot = preview.rot; isSnapped = true; }
      else if (invalidPreview) { drawX = invalidPreview.x; drawY = invalidPreview.y; drawRot = invalidPreview.rot; isSnapped = true; }
      else { drawX = mouse.wx; drawY = mouse.wy; drawRot = 0; isSnapped = false; }

      const handShape = { type: nextT, x: drawX, y: drawY, rot: drawRot };
      let color;
      if (nextT === 'square') color = 'rgba(80,140,220,0.35)';
      else if (nextT === 'tri') color = 'rgba(220,140,80,0.35)';
      else if (nextT === 'pent') color = 'rgba(138,74,216,0.35)';
      else color = 'rgba(80, 200, 180, 0.35)';
                  
      ctx.globalAlpha = isSnapped ? 1.0 : 0.4; 
      drawShape(handShape, { fill: color, stroke: 'rgba(255,255,255,0.7)', lineWidth: 1.5 });
      ctx.globalAlpha = 1.0;
    }
  }
  
  // 3. 겹침 미리보기 (Shift 키가 눌리지 않았을 때만 그리기)
  if (invalidPreview && gameState === 'playing' && !isShiftPressed) {
    drawShape(invalidPreview, { fill: 'rgba(255, 80, 80, 0.1)', stroke: 'rgba(255, 80, 80, 0.6)', lineWidth: 1.5 });
  }

  // 4. 볼록 껍질 렌더링
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

  // 5. 에러 툴팁 렌더링
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

  // 6. HUD 텍스트 업데이트
  const rawPct = computeFillPercent();
  const displayPct = Math.floor(rawPct * 100) / 100; 
  const compareSymbol = displayPct >= TARGET_PCT ? '≥' : '<';
  
  if (currentMode === 'practice') {
    hud.textContent =
      `${shapes.length} / ∞\n` +
      `${displayPct.toFixed(2)}% ${compareSymbol} ${TARGET_PCT}%\n` +
      `줌: ${view.scale.toFixed(2)}x`;
  } else {
    hud.textContent =
      `${shapes.length} / ${TOTAL_SHAPES}\n` +
      `${displayPct.toFixed(2)}% ${compareSymbol} ${TARGET_PCT}%\n` +
      `줌: ${view.scale.toFixed(2)}x`;
  }
}

// 타이머 파편 생성
function createTimerParticles() {
  timerParticles = [];
  const centerX = window.innerWidth / 2;
  const timerY = window.innerHeight / 2 - 200;
  
  const width = 200;
  const height = 80;
  
  for (let i = 0; i < 80; i++) {
    const px = centerX - width / 2 + Math.random() * width;
    const py = timerY - height / 2 + Math.random() * height;
    const vx = (Math.random() - 0.5) * 4;
    const vy = (Math.random() - 0.5) * 4;
    
    timerParticles.push({
      x: px, y: py, vx: vx, vy: vy,
      size: Math.random() * 3 + 2,
      alpha: 1
    });
  }
}

function loop() { render(); requestAnimationFrame(loop); }

// ---------- 화면 전환 및 게임 ----------
function showOverlay(el) { el.classList.remove('hidden'); }
function hideOverlay(el) { el.classList.add('hidden'); }

// ✨ 수정: 삭제된 요소 제거
function hideAllOverlays() { 
  [pauseMenu, saveMenu, loadMenu].forEach(hideOverlay); 
}

function resetGame() {
  shapes = [];
  shapeQueue = buildQueue();
  preview = null;
  savedType = null;
  view = { x: 0, y: 0, scale: 1 };
  resultBar.classList.remove('show');

  if (HAS_TIMER) {
    startTime = performance.now();
    isTimeOver = false;
    pausedTime = 0;
    timerParticles = [];
  }
  
  currentBundleIndex = 0;
  currentShapeIndex = 0;
  replacedBundleIndex = -1;
  replacedShapeIndex = -1;

  const btnSave = document.getElementById('btnSave');
  if (btnSave) btnSave.disabled = false;

  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const w = screenToWorld(cx, cy);

  if (currentMode === 'practice') {
    practiceCurrentType = 'tri';
    updatePracticeCountUI();
  } else {
    const currentBundle = shapeQueue[currentBundleIndex];
    if (currentBundle && currentBundle.length > 0) {
      const firstType = currentBundle.shift();
      shapes.push({ type: firstType, x: w.x, y: w.y, rot: 0 });
      
      if (currentBundle.length === 0) {
        currentBundleIndex++;
        currentShapeIndex = 0;
      } else {
        currentShapeIndex = 0;
      }
    }
  }
  
  updateQueueUI();
  document.getElementById('rankingPanel').classList.add('hidden');
}

function startGame() {
  resetGame();
  gameState = 'playing';
  hideAllOverlays();
}

function goHome() {
  window.location.href = 'index.html';
}

function showRankingOverlay(canInput) {
  const initialsMenu = document.getElementById('initialsMenu');
  const inputGroup = document.getElementById('initialsInputGroup');
  const title = document.getElementById('initialsTitle');
  const desc = document.getElementById('initialsDesc');
  const rankingList = document.getElementById('rankingList');

  const rankings = getRankings();
  rankingList.innerHTML = rankings.map((r, i) => 
    `<div style="display:flex; justify-content:space-between; padding: 4px 0; border-bottom: 1px solid #444;">
      <span>${i + 1}. <b>${r.initials || '???'}</b></span>
      <span>${r.pct.toFixed(2)}% | ${r.time}초</span>
    </div>`
  ).join('') || '<div style="text-align:center; color:#aaa;">아직 기록이 없습니다.</div>';

  if (canInput) {
    title.textContent = '랭킹 등록';
    desc.textContent = '축하합니다! 랭킹 Top 3에 진입했습니다. 이니셜을 입력하세요.';
    inputGroup.style.display = 'block';
    document.getElementById('initialsInput').value = '';
    document.getElementById('initialsInput').focus();
  } else {
    title.textContent = '명예의 전당';
    desc.textContent = '아쉽게도 랭킹 Top 3에는 들지 못했습니다.';
    inputGroup.style.display = 'none';
  }

  hideAllOverlays();
  initialsMenu.classList.remove('hidden');
}

function checkResult() {
  if (currentMode === 'practice') return;

  const rawPct = computeFillPercent();
  const truncatedPct = Math.floor(rawPct * 100) / 100; 
  const success = truncatedPct >= TARGET_PCT;

  gameState = 'result';
  resultTitle.textContent = success ? '성공!' : '실패';
  resultTitle.className = 'result-title ' + (success ? 'success' : 'fail');
  
  const compareSymbol = success ? '≥' : '<';
  let descText = `${truncatedPct.toFixed(2)}% ${compareSymbol} ${TARGET_PCT}%`;
  
  // ✨ 랭킹 등재 불가 사유 표시 (시간 초과 OR 저장/불러오기 강제 터짐)
  if (HAS_RANKING && success && isTimeOver) {
    descText += ' (시간 초과 · 랭킹 등록 불가)';
  }
  
  resultDesc.textContent = descText;

  resultDesc.textContent = descText;
  
  hideAllOverlays();
  resultBar.classList.add('show');
  
  // ✨ 수정된 부분: 어려움 모드라면 결과(성공/실패/시간초과)와 무관하게 랭킹 패널 표시
  if (HAS_RANKING) {
    updateRankingPanel(); // 랭킹 패널 렌더링 및 표시

    // (선택) 100초 내에 성공했을 때만 랭킹 등록 창을 띄우는 로직은 유지
    const elapsed = HAS_TIMER ? (performance.now() - startTime) / 1000 : 0;
    finalRemainingTime = HAS_TIMER ? Math.max(0, TIME_LIMIT - elapsed) : 0;
    if (isTimeOver) finalRemainingTime = 0;

    const currentRankings = getRankings();
    const isRankable = success && !isTimeOver && (
      currentRankings.length < MAX_RANKING || 
      truncatedPct > currentRankings[currentRankings.length - 1].pct ||
      (truncatedPct === currentRankings[currentRankings.length - 1].pct && Math.floor(finalRemainingTime) > currentRankings[currentRankings.length - 1].time)
    );

    if (isRankable) {
      pendingRankData = { pct: truncatedPct, time: Math.floor(finalRemainingTime) };
      showInitialsInput(); 
    }
  } else {
    document.getElementById('rankingPanel').classList.add('hidden');
  }
  
  const btnSave = document.getElementById('btnSave');
  if (btnSave) btnSave.disabled = true;
}

// ---------- 저장/불러오기 ----------
function serializeState() {
  return {
    version: 4,
    mode: currentMode,
    shapes: shapes.map(s => ({ type: s.type, x: s.x, y: s.y, rot: s.rot })),
    queue: shapeQueue.map(bundle => ({
      shapes: [...bundle],
      isSpecial: bundle.isSpecial === true
    })),
    currentBundleIndex,
    currentShapeIndex,
    replacedBundleIndex,
    replacedShapeIndex,
    savedType: savedType,
    practiceCurrentType: practiceCurrentType,
    isTimeOver: isTimeOver,
    view: { x: view.x, y: view.y, scale: view.scale },
    savedAt: new Date().toISOString(),
  };
}

async function saveToSlot(i) {
  const isConfirmed = await showCustomConfirm('저장하시겠습니까?\n(주의: 저장을 하면 타이머가 강제 종료되며,\n랭킹 등록이 불가능해집니다.)', '저장');
  if (!isConfirmed) return false;
  
  try {
    if (HAS_TIMER) isTimeOver = true;
    localStorage.setItem(SAVE_PREFIX + i, JSON.stringify(serializeState()));
    return true;
  } catch (e) { return false; }
}

async function loadFromSlot(i) {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + i);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || data.version !== 4 || !Array.isArray(data.shapes)) return false;
    
    if (data.mode !== currentMode) {
      await showCustomAlert('다른 난이도의 저장 데이터는 불러올 수 없습니다.', '불러오기 실패');
      return false;
    }

    shapes = data.shapes.map(s => ({ type: s.type, x: s.x, y: s.y, rot: s.rot }));
    shapeQueue = data.queue.map(item => {
      const bundle = [...item.shapes];
      if (item.isSpecial) bundle.isSpecial = true;
      return bundle;
    });

    currentBundleIndex = data.currentBundleIndex || 0;
    currentShapeIndex = data.currentShapeIndex || 0;
    replacedBundleIndex = data.replacedBundleIndex !== undefined ? data.replacedBundleIndex : -1;
    replacedShapeIndex = data.replacedShapeIndex !== undefined ? data.replacedShapeIndex : -1;
    
    view = data.view && typeof data.view.x === 'number' ? { x: data.view.x, y: data.view.y, scale: data.view.scale } : { x: 0, y: 0, scale: 1 };
    preview = null;
    savedType = data.savedType || null;
    
    if (currentMode === 'practice') {
      practiceCurrentType = data.practiceCurrentType || 'tri';
    } else {
      isTimeOver = true;
    }
    
    gameState = 'playing';
    resultBar.classList.remove('show');
    updateQueueUI();
    if (currentMode === 'practice') updatePracticeCountUI();
    hideAllOverlays();
    return true;
  } catch (e) { 
    console.error(e);
    return false; 
  }
}

function slotInfo(i) {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + i);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.shapes)) return null;
    return { 
      count: d.shapes.length, 
      savedAt: d.savedAt || '',
      mode: d.mode || 'unknown'
    };
  } catch (e) { return null; }
}

function deleteSlot(i) {
  try { localStorage.removeItem(SAVE_PREFIX + i); return true; } 
  catch (e) { return false; }
}

function renderSlots(container, mode) {
  container.innerHTML = ''; // 슬롯 영역 초기화
  
  for (let i = 0; i < SAVE_SLOTS; i++) {
    const info = slotInfo(i);
    const row = document.createElement('div');
    row.className = 'slot-item';
    
    // 시간 포맷
    let timeStr = '';
    if (info && info.savedAt) {
      timeStr = new Date(info.savedAt).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      });
    }

    // 난이도 텍스트
    let modeStr = '';
    if (info && info.mode === 'easy') modeStr = '[쉬움] ';
    else if (info && info.mode === 'hard') modeStr = '[어려움] ';
    else if (info && info.mode === 'practice') modeStr = '[전략실] ';

    const label = document.createElement('div');
    label.innerHTML = `<b>슬롯 ${i + 1}</b> <span class="info">${info ? `${modeStr}${info.count}개 · ${timeStr}` : '비어 있음'}</span>`;
    
    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex';
    btnGroup.style.gap = '6px';

    if (mode === 'save') {
      // 저장 버튼
      const btnSave = document.createElement('button');
      btnSave.textContent = '저장';
      btnSave.onclick = async () => {
        if (info) { 
          const isOverwrite = await showCustomConfirm(`슬롯 ${i + 1}에 이미 데이터가 있습니다. 덮어쓰시겠습니까?`, '덮어쓰기');
          if (!isOverwrite) return;
        }
        if (await saveToSlot(i)) renderSlots(container, 'save'); 
        else showCustomAlert('저장 실패', '오류'); 
      };
      btnGroup.appendChild(btnSave);

      // 삭제 버튼
      const btnDel = document.createElement('button');
      btnDel.textContent = '삭제';
      btnDel.className = 'danger';
      btnDel.disabled = !info;
      btnDel.onclick = async () => {
        const isDelete = await showCustomConfirm(`슬롯 ${i + 1}의 데이터를 정말 삭제하시겠습니까?`, '삭제');
        if (isDelete) {
          if (deleteSlot(i)) renderSlots(container, 'save');
          else showCustomAlert('삭제 실패', '오류');
        }
      };
      btnGroup.appendChild(btnDel);

    } else {
      // 불러오기 버튼
      const btnLoad = document.createElement('button');
      btnLoad.textContent = '불러오기';
      btnLoad.disabled = !info;
      btnLoad.onclick = async () => { 
        // ✨ 불러오기 확인창 추가
        const isConfirmed = await showCustomConfirm('불러오시겠습니까?\n(주의: 불러오기를 하면 타이머가 강제 종료되며,\n랭킹 등록이 불가능해집니다.)', '불러오기');
        if (!isConfirmed) return;

        if (!await loadFromSlot(i)) showCustomAlert('불러오기 실패', '오류'); 
      };
      btnGroup.appendChild(btnLoad);

      // 삭제 버튼
      const btnDel = document.createElement('button');
      btnDel.textContent = '삭제';
      btnDel.className = 'danger';
      btnDel.disabled = !info;
      btnDel.onclick = async () => {
        const isDelete = await showCustomConfirm(`슬롯 ${i + 1}의 데이터를 정말 삭제하시겠습니까?`, '삭제');
        if (isDelete) {
          if (deleteSlot(i)) renderSlots(container, 'load');
          else showCustomAlert('삭제 실패', '오류');
        }
      };
      btnGroup.appendChild(btnDel);
    }

    row.appendChild(label);
    row.appendChild(btnGroup);
    container.appendChild(row);
  }
}

// ---------- 랭킹 ----------
function getRankings() {
  try {
    const raw = localStorage.getItem(RANKING_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveRanking(pct, time, initials) {
  try {
    let rankings = getRankings();
    const newRecord = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      initials: initials,
      pct: pct,
      time: time,
      date: new Date().toISOString()
    };
    rankings.push(newRecord);
    
    rankings.sort((a, b) => b.pct - a.pct || b.time - a.time);
    rankings = rankings.slice(0, MAX_RANKING);
    
    localStorage.setItem(RANKING_KEY, JSON.stringify(rankings));
    return rankings;
  } catch (e) {
    console.error('랭킹 저장 실패:', e);
    return [];
  }
}

function updateRankingPanel() {
  const panel = document.getElementById('rankingPanel');
  const list = document.getElementById('rankingList');
  
  const rankings = getRankings();
  list.innerHTML = rankings.map((r, i) => 
    `<div>
      <span>${i + 1}. <b>${r.initials || '???'}</b></span>
      <span>${r.pct.toFixed(2)}% | ${r.time}초</span>
    </div>`
  ).join('') || '<div style="text-align:center; color:#aaa; padding:10px 0;">기록 없음</div>';
  
  panel.classList.remove('hidden');
}

function showInitialsInput() {
  hideAllOverlays();
  document.getElementById('initialsMenu').classList.remove('hidden');
  document.getElementById('initialsInput').value = '';
  document.getElementById('initialsInput').focus();
}

// ---------- 도형 삭제 관련 ----------
function canRemoveShape(targetShape) {
  if (shapes.length <= 1) return true;

  const adj = new Map();
  for (const s of shapes) adj.set(s, []);

  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      if (shapesShareEdge(worldVerts(shapes[i]), worldVerts(shapes[j]))) {
        adj.get(shapes[i]).push(shapes[j]);
        adj.get(shapes[j]).push(shapes[i]);
      }
    }
  }

  // 제거 전 연결 요소 개수 (targetShape 포함)
  const visitedBefore = new Set();
  let componentsBefore = 0;
  for (const s of shapes) {
    if (visitedBefore.has(s)) continue;
    componentsBefore++;
    const queue = [s];
    visitedBefore.add(s);
    while (queue.length > 0) {
      const curr = queue.shift();
      for (const neighbor of adj.get(curr)) {
        if (!visitedBefore.has(neighbor)) {
          visitedBefore.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  // 제거 후 연결 요소 개수 (targetShape 제외)
  const visitedAfter = new Set();
  let componentsAfter = 0;
  for (const s of shapes) {
    if (s === targetShape || visitedAfter.has(s)) continue;
    componentsAfter++;
    const queue = [s];
    visitedAfter.add(s);
    while (queue.length > 0) {
      const curr = queue.shift();
      for (const neighbor of adj.get(curr)) {
        if (neighbor !== targetShape && !visitedAfter.has(neighbor)) {
          visitedAfter.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  return componentsAfter === componentsBefore;
}

// ---------- 이벤트 ----------
document.getElementById('btnResume').onclick = () => { gameState = 'playing'; hideAllOverlays(); };
document.getElementById('btnSave').onclick = () => {
  if (gameState === 'result' || stateBeforePause === 'result') return;
  renderSlots(saveSlotsEl, 'save');
  hideOverlay(pauseMenu);
  showOverlay(saveMenu);
};
document.getElementById('btnLoad').onclick = () => {
  renderSlots(loadSlotsEl, 'load');
  hideOverlay(pauseMenu);
  showOverlay(loadMenu);
};
document.getElementById('btnSaveClose').onclick = () => { hideOverlay(saveMenu); showOverlay(pauseMenu); };
document.getElementById('btnLoadClose').onclick = () => { hideOverlay(loadMenu); showOverlay(pauseMenu); };
document.getElementById('btnRestart').onclick = async () => {
  const isHome = await showCustomConfirm('처음으로 돌아갑니다. 저장하지 않은 진행은 사라집니다.', '처음으로');
  if (isHome) goHome();
};
document.getElementById('btnResultRestart').onclick = startGame;
document.getElementById('btnResultHome').onclick = goHome;

document.getElementById('btnSubmitRanking').onclick = async () => {
  const input = document.getElementById('initialsInput');
  let initials = input.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  
  if (initials.length !== 3) {
    await showCustomAlert('이름은 영문 및 숫자 3글자로 정확히 입력해야 합니다.', '입력 오류');
    input.focus();
    return; 
  }
  
  if (pendingRankData) {
    saveRanking(pendingRankData.pct, pendingRankData.time, initials);
    pendingRankData = null;
  }
  
  hideOverlay(document.getElementById('initialsMenu'));
  updateRankingPanel();
};

document.getElementById('initialsInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btnSubmitRanking').click();
});

document.getElementById('btnQuickRestart').onclick = async () => {
  if (gameState === 'playing' || gameState === 'result') {
    const isRestart = await showCustomConfirm('게임을 다시 시작하시겠습니까?\n현재 진행 상황은 저장되지 않습니다.', '다시 시작');
    if (isRestart) startGame();
  }
};

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
    
    if (currentMode === 'practice' && isShiftPressed) {
      hoveredShape = null;
      for (let i = shapes.length - 1; i >= 0; i--) {
        if (isPointInPolygon({ x: mouse.wx, y: mouse.wy }, worldVerts(shapes[i]))) {
          hoveredShape = shapes[i];
          break;
        }
      }
      preview = null;
      invalidPreview = null;
      return; 
    } else {
      hoveredShape = null;
    }

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

  // ✨ Shift 키가 눌린 상태: 무조건 삭제 로직만 수행하고 종료
  if (currentMode === 'practice' && isShiftPressed) {
    let target = hoveredShape;
    if (!target) {
      for (let i = shapes.length - 1; i >= 0; i--) {
        if (isPointInPolygon({ x: mouse.wx, y: mouse.wy }, worldVerts(shapes[i]))) {
          target = shapes[i];
          break;
        }
      }
    }
    
    if (target) {
      if (canRemoveShape(target)) {
        const index = shapes.indexOf(target);
        if (index > -1) {
          shapes.splice(index, 1);
          updatePracticeCountUI();
          hoveredShape = null;
          errorMsg = '도형을 삭제했습니다.';
          tooltipX = mouse.sx;
          tooltipY = mouse.sy - 20;
          tooltipStartTime = performance.now();
          clearTimeout(errorMsgTimer);
          errorMsgTimer = setTimeout(() => { errorMsg = ''; }, 1200);
        }
      } else {
        errorMsg = '이 도형을 삭제하면 도형이 분리됩니다!';
        tooltipX = mouse.sx;
        tooltipY = mouse.sy - 20;
        tooltipStartTime = performance.now();
        clearTimeout(errorMsgTimer);
        errorMsgTimer = setTimeout(() => { errorMsg = ''; }, 1200);
      }
    } else {
      // ✨ 빈 곳을 클릭했을 때는 아무런 동작도 하지 않고 종료
      errorMsg = ''; // 기존 오류 메시지 초기화
    }
    
    return; // ✨ 배치 로직으로 넘어가지 않도록 여기서 무조건 종료
  }
  
  // --- 이하 일반 배치 로직 ---
  const nextT = getNextType();
  if (!nextT) return;

  if (preview) {
    shapes.push({ type: nextT, x: preview.x, y: preview.y, rot: preview.rot });
    
    if (currentMode === 'practice') {
      updatePracticeCountUI();
    } else {
      if (shapeQueue.length > currentBundleIndex) {
        const currentBundle = shapeQueue[currentBundleIndex];
        if (currentShapeIndex < currentBundle.length) {
          currentBundle.splice(currentShapeIndex, 1);
        }
        if (currentBundle.length === 0 || currentShapeIndex >= currentBundle.length) {
          currentBundleIndex++;
          currentShapeIndex = 0;
        }
      } else if (savedType) {
        savedType = null;
      }
      updateQueueUI();
    }

    replacedBundleIndex = -1;
    replacedShapeIndex = -1;
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
  const newScale = Math.max(0.2, Math.min(10, view.scale * factor));
  if (newScale === view.scale) return;
  view.scale = newScale;
  view.x = sx - before.x * newScale;
  view.y = sy - before.y * newScale;
}, { passive: false });

canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (gameState !== 'playing') return;

  if (currentMode === 'practice') {
    const shapesOrder = ['tri', 'square', 'pent', 'rhombus'];
    const currentIndex = shapesOrder.indexOf(practiceCurrentType);
    practiceCurrentType = shapesOrder[(currentIndex + 1) % shapesOrder.length];
    
    const w = screenToWorld(mouse.sx, mouse.sy);
    const res = computeSnap(w.x, w.y);
    preview = res.best;
    invalidPreview = res.invalid;
    return;
  }
  
  if (shapeQueue.length === 0 || currentBundleIndex >= shapeQueue.length) return;
  
  const currentBundle = shapeQueue[currentBundleIndex];
  if (currentShapeIndex >= currentBundle.length) return;

  const currentNext = currentBundle[currentShapeIndex];

  const isLastShapeInQueue = (currentBundle.length === 1);
  const isNoNextBundle = (shapeQueue.length === currentBundleIndex + 1);
  
  if (isLastShapeInQueue && isNoNextBundle && !savedType) {
    errorMsg = '마지막 도형은 슬롯에 넣을 수 없습니다!';
    tooltipX = mouse.sx;
    tooltipY = mouse.sy - 20;
    tooltipStartTime = performance.now();
    clearTimeout(errorMsgTimer);
    errorMsgTimer = setTimeout(() => { errorMsg = ''; }, 1200);
    return;
  }

  if (savedType === currentNext) {
    errorMsg = '이미 같은 도형을 들고 있습니다.';
    tooltipX = mouse.sx;
    tooltipY = mouse.sy - 20;
    tooltipStartTime = performance.now();
    clearTimeout(errorMsgTimer);
    errorMsgTimer = setTimeout(() => { errorMsg = ''; }, 1200);
    return;
  }

  if (currentBundle.isSpecial === true) {
    errorMsg = '삼각형 3개 번들은 교체할 수 없습니다!';
    tooltipX = mouse.sx;
    tooltipY = mouse.sy - 20;
    tooltipStartTime = performance.now();
    clearTimeout(errorMsgTimer);
    errorMsgTimer = setTimeout(() => { errorMsg = ''; }, 1200);
    return;
  }

  if (currentBundleIndex === replacedBundleIndex && currentShapeIndex === replacedShapeIndex) {
    errorMsg = '이미 교체한 조각입니다. 배치 후 다시 시도하세요.';
    tooltipX = mouse.sx;
    tooltipY = mouse.sy - 20;
    tooltipStartTime = performance.now();
    clearTimeout(errorMsgTimer);
    errorMsgTimer = setTimeout(() => { errorMsg = ''; }, 1200);
    return;
  }

  if (!savedType) {
    savedType = currentNext;
    currentBundle.splice(currentShapeIndex, 1); 
    if (currentShapeIndex >= currentBundle.length) {
      currentBundleIndex++;
      currentShapeIndex = 0;
    }
  } else {
    const temp = savedType;
    savedType = currentNext;
    currentBundle[currentShapeIndex] = temp;
  }

  replacedBundleIndex = currentBundleIndex;
  replacedShapeIndex = currentShapeIndex;

  updateQueueUI();
  preview = null;
  invalidPreview = null;
  
  const w = screenToWorld(mouse.sx, mouse.sy);
  const res = computeSnap(w.x, w.y);
  preview = res.best;
  invalidPreview = res.invalid;
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') {
    isShiftPressed = true;
    document.body.classList.add('shift-pressed');
  }
  if (e.key === 'Escape') {
    if (gameState === 'playing' || gameState === 'result') {
      stateBeforePause = gameState; 
      gameState = 'paused';
      if (HAS_TIMER) pausedTime = performance.now(); 
      showOverlay(pauseMenu);
      
      const btnSave = document.getElementById('btnSave');
      if (btnSave) btnSave.disabled = (stateBeforePause === 'result'); 
      
    } else if (gameState === 'paused') {
      if (!saveMenu.classList.contains('hidden') || !loadMenu.classList.contains('hidden')) {
        hideOverlay(saveMenu); hideOverlay(loadMenu); // ✨ rulesAgain 제거
        showOverlay(pauseMenu);
      } else {
        gameState = stateBeforePause; 
        if (HAS_TIMER) {
          startTime += (performance.now() - pausedTime); 
        }
        hideAllOverlays();
        
        const btnSave = document.getElementById('btnSave');
        if (btnSave) btnSave.disabled = (gameState === 'result');
      }
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') {
    isShiftPressed = false;
    document.body.classList.remove('shift-pressed');
  }
});

window.addEventListener('resize', resize);

// ---------- 초기화 ----------
resize();
loop();
startGame(); 