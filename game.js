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
const SAVE_PREFIX = 'shapeGame_save_';
const SAVE_SLOTS = 3;
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

const ruleScreen = document.getElementById('ruleScreen');
const pauseMenu = document.getElementById('pauseMenu');
const saveMenu = document.getElementById('saveMenu');
const loadMenu = document.getElementById('loadMenu');
const rulesAgain = document.getElementById('rulesAgain');
const saveSlotsEl = document.getElementById('saveSlots');
const loadSlotsEl = document.getElementById('loadSlots');

// ---------- 설정 및 모드 판별 ----------
const urlParams = new URLSearchParams(window.location.search);
const currentMode = urlParams.get('mode') || 'hard'; // 기본값 hard

const modeConfig = {
  hard: {
    totalShapes: 25,
    targetPct: 80,
    hasTimer: true,      // ✨ 타이머 사용
    hasRanking: true,    // ✨ 랭킹 사용
    timeLimit: 100,
    shapes: ['square', 'tri', 'pent', 'rhombus']
  },
  easy: {
    totalShapes: 10,
    targetPct: 60,
    hasTimer: false,     // ✨ 타이머 미사용
    hasRanking: false,   // ✨ 랭킹 미사용
    timeLimit: 0,        // 사용하지 않음
    shapes: ['square', 'tri']
  }
};

const config = modeConfig[currentMode];
const TOTAL_SHAPES = config.totalShapes;
const TARGET_PCT = config.targetPct;
const HAS_TIMER = config.hasTimer;
const HAS_RANKING = config.hasRanking;
const TIME_LIMIT = config.timeLimit;
const AVAILABLE_SHAPES = config.shapes;

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
let currentBundleIndex = 0; // 현재 진행 중인 묶음 인덱스
let currentShapeIndex = 0;  // 현재 묶음 내에서 꺼낼 도형 인덱스
let replacedBundleIndex = -1; // 교체가 일어난 묶음 번호 (재교체 방지용)
let replacedShapeIndex = -1;  // 교체가 일어난 묶음 내 위치 (재교체 방지용)
let startTime = 0;           // 게임 시작 시간 (performance.now() 기준)
let isTimeOver = false;      // 시간 초과 여부
let pausedTime = 0;          // 일시정지된 시간 누적
let timerExplosionStart = 0; // ✨ 타이머 터짐 애니메이션 시작 시간
let timerParticles = []; // ✨ 파편(파티클) 배열 추가
let isFontLoaded = false;
let finalRemainingTime = 0; // ✨ 전역 변수 추가 (상태 변수 근처)
let stateBeforePause = 'playing'; // ✨ 일시정지 전 상태 저장용 변수
let pendingRankData = null; // ✨ 랭킹 등록 대기 데이터

// ✨ DSEG 폰트 로딩 대기 (게임 시작 전에 실행)
document.fonts.load('bold 80px "DSEG7 Classic"').then(() => {
  isFontLoaded = true;
}).catch(() => {
  console.warn('DSEG 폰트 로딩 실패, 기본 폰트 사용');
  isFontLoaded = true; // 실패해도 게임은 진행되도록
});

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
  let sets = [];
  
  if (currentMode === 'easy') {
    // ✨ 쉬움 모드: [삼각형, 사각형] 번들을 5개 생성 (순서 고정)
    for (let i = 0; i < 5; i++) {
      sets.push(['tri', 'square']);
    }
    // ✨ 쉬움 모드는 섞지 않고 그대로 반환
    return sets; 
  } 
  
  // --- 어려움(하드) 모드 로직 ---
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

  // 하드 모드는 내부 도형 섞기
  return sets.map(set => {
    const shuffled = [...set].sort(() => Math.random() - 0.5);
    if (set.isSpecial) shuffled.isSpecial = true;
    return shuffled;
  });
}

function getNextType() {
  // 큐의 현재 인덱스가 범위를 벗어났고, 슬롯에 도형이 있다면 슬롯을 큐로 이동
  // (이때가 "마지막 도형을 다 써서 슬롯의 도형을 들어야 하는 시점"임)
  if (currentBundleIndex >= shapeQueue.length) {
    if (savedType) {
      shapeQueue.push([savedType]);
      savedType = null;
      updateQueueUI(); // 슬롯이 비워졌으므로 UI 갱신
    } else {
      return null;
    }
  }
  
  // 현재 큐의 도형 반환
  if (shapeQueue.length > currentBundleIndex && 
      shapeQueue[currentBundleIndex].length > currentShapeIndex) {
    return shapeQueue[currentBundleIndex][currentShapeIndex];
  }
  return null;
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
      
      // [1단계] 거리 조건
      if (dist({ x: mwx, y: mwy }, cp) > SNAP_DIST) continue;
      checkedEdges++;

      // 내부 변 제외
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

      // [2단계] 양쪽 방향 후보 생성
      let candidates = [];
      for (let j = 0; j < base.length; j++) {
        const c0 = base[j], d0 = base[(j + 1) % base.length];
        for (const flip of [false, true]) {
          const targetA = flip ? b : a, targetB = flip ? a : b;
          const cvec = { x: d0.x - c0.x, y: d0.y - c0.y };
          const tvec = { x: targetB.x - targetA.x, y: targetB.y - targetA.y };
          
          // ✨ [변경] 회전각을 계산한 후 1도 단위로 반올림
          let rot = Math.atan2(tvec.y, tvec.x) - Math.atan2(cvec.y, cvec.x);
          const rotDegrees = Math.round(rot * (180 / Math.PI));
          rot = rotDegrees * (Math.PI / 180);

          const rc0 = rotPoint(c0, rot);
          const cx = targetA.x - rc0.x, cy = targetA.y - rc0.y;
          
          // 임시 후보 도형 생성
          let candVerts = worldVerts({ type: nextType, x: cx, y: cy, rot });

          // ✨ [핵심 변경] 기존 도형의 꼭짓점 좌표를 새 도형에 강제 대입 (오차 제거)
          candVerts[j] = { x: targetA.x, y: targetA.y };
          candVerts[(j + 1) % base.length] = { x: targetB.x, y: targetB.y };

          if (sharesEdgeWithSameType(candVerts, nextType)) continue;
          
          // 소유자와의 겹침 면적 계산
          const ownerOverlapArea = getOverlapArea(candVerts, verts);
          if (ownerOverlapArea > 0.1) continue;

          const dMouse = Math.hypot(cx - mwx, cy - mwy);
          candidates.push({ x: cx, y: cy, rot, dMouse, candVerts });
        }
      }

      if (candidates.length === 0) continue;
      
      candidates.sort((x, y) => x.dMouse - y.dMouse);
      const chosen = candidates[0];

      // [3단계] 최종 겹침 검사
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

// ✨ 도형 아이콘을 생성하는 헬퍼 함수 (중복 제거)
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

// ✨ 큐 UI를 업데이트하는 함수
function updateQueueUI() {
  const queueArea = document.getElementById('queue-area');
  const slotArea = document.getElementById('slot-area');
  
  if (!queueArea || !slotArea) return;
  
  queueArea.innerHTML = '';
  slotArea.innerHTML = '';

  // 1. 현재 큐 영역 (3칸 고정)
  const currentBundle = shapeQueue[currentBundleIndex] || [];
  
  // ✨ 수정: 길이가 아니라 특수 표식(isSpecial)으로 판별
  const isTripleTri = currentBundle.isSpecial === true; 
  const originalBundleSize = currentBundle.length + currentShapeIndex; 

  // 3칸 렌더링
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

  // 2. 구분선
  const divider = document.createElement('div');
  divider.className = 'queue-divider';
  queueArea.appendChild(divider);

  // 3. 다음 큐 첫 번째 도형 (미리보기)
  const nextBundleIndex = currentBundleIndex + 1;
  let nextItem = null;
  
  if (shapeQueue.length > nextBundleIndex && shapeQueue[nextBundleIndex].length > 0) {
    // 다음 큐도 333 번들인지 확인 (특수 표식 기반)
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

  // 4. 슬롯 렌더링
  slotArea.innerHTML = '';
  
  // ✨ 수정: isTripleTri가 특수 표식 기반이므로, 남은 도형이 1개여도 잠금 유지됨
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

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // ✨ 0. 타이머 및 파편 렌더링
  if (HAS_TIMER && (gameState === 'playing' || gameState === 'result')) {
    let remainingTime = TIME_LIMIT;
    
    if (gameState === 'playing') {
      remainingTime = Math.max(0, TIME_LIMIT - (performance.now() - startTime) / 1000);
      if (remainingTime <= 0 && !isTimeOver) {
        isTimeOver = true;
        timerExplosionStart = performance.now();
        // ✨ 폭발 시점에 파편 생성
        createTimerParticles(); 
      }
    } else if (gameState === 'result') {
      remainingTime = finalRemainingTime; 
    }

    const centerX = window.innerWidth / 2;
    const timerY = window.innerHeight / 2 - 200;

    // ✨ 폭발 후 파편 그리기
    if (isTimeOver && timerParticles.length > 0) {
      const elapsed = performance.now() - timerExplosionStart;
      
      // 파편 업데이트 및 그리기
      for (let i = timerParticles.length - 1; i >= 0; i--) {
        const p = timerParticles[i];
        
        // 물리 연산 (속도, 중력, 투명도)
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05; // 아주 약한 중력
        p.alpha -= 0.015; // 서서히 투명해짐
        
        // 수명이 다하면 제거
        if (p.alpha <= 0) {
          timerParticles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = '#ff5050'; // 붉은색 파편
        ctx.fillRect(p.x, p.y, p.size, p.size);
        ctx.restore();
      }
    } 
    // ✨ 폭발 전 타이머 그리기
    else if (!isTimeOver) {
      ctx.save();
      // ✨ 폰트가 로드되었으면 DSEG, 아니면 기본 sans-serif
      const fontFamily = isFontLoaded ? '"DSEG7 Classic", monospace' : 'sans-serif';
      ctx.font = `bold 80px ${fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // 시간 문자열 포맷
      let timeStr;
      if (remainingTime > 30) {
        timeStr = Math.ceil(remainingTime).toString();
      } else if (remainingTime > 10) {
        timeStr = remainingTime.toFixed(1);
      } else {
        timeStr = remainingTime.toFixed(2);
      }

      // 10초 이하 파동(심장박동) 효과
      if (remainingTime <= 10 && remainingTime > 0) {
        const now = performance.now();
        const cycle = (now % 1000) / 1000; // 1초 주기
        
        // 글자는 가만히 있고, 뒤에서 붉은 파동이 퍼져나감
        const pulseRadius = 40 + (cycle * 60); // 40 -> 100으로 커짐
        const pulseAlpha = 1 - cycle; // 1 -> 0으로 투명해짐
        
        ctx.beginPath();
        ctx.arc(centerX, timerY, pulseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 80, 80, ${pulseAlpha * 0.5})`;
        ctx.lineWidth = 4;
        ctx.stroke();

        // 글자 자체는 고정 (붉은색)
        ctx.fillStyle = 'rgba(255, 80, 80, 0.2)';
        ctx.fillText(timeStr, centerX, timerY);
      } else {
        // 평소 상태
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fillText(timeStr, centerX, timerY);
      }
      ctx.restore();
    }
  }
  
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
      let color;
      if (nextT === 'square') color = 'rgba(80,140,220,0.35)';
      else if (nextT === 'tri') color = 'rgba(220,140,80,0.35)';
      else if (nextT === 'pent') color = 'rgba(138,74,216,0.35)';
      else color = 'rgba(80, 200, 180, 0.35)'; // rhombus
                  
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
  
  // 80% 이상인지 미만인지에 따라 부등호 결정
  const compareSymbol = displayPct >= TARGET_PCT ? '≥' : '<';
  
  hud.textContent =
    `${shapes.length} / ${TOTAL_SHAPES}\n` +
    `${displayPct.toFixed(2)}% ${compareSymbol} ${TARGET_PCT}%\n` +
    `줌: ${view.scale.toFixed(2)}x`; // 줌 텍스트는 유지 (원하시면 삭제 가능)
}

// ✨ 타이머가 터질 때 파편을 생성하는 함수 (render 함수 바깥에 추가)
function createTimerParticles() {
  timerParticles = [];
  const centerX = window.innerWidth / 2;
  const timerY = window.innerHeight / 2 - 200;
  
  // 글자 영역(약 200x80)을 바탕으로 무작위 파편 생성
  const width = 200;
  const height = 80;
  
  for (let i = 0; i < 80; i++) {
    // 글자 영역 안에서 무작위 위치
    const px = centerX - width / 2 + Math.random() * width;
    const py = timerY - height / 2 + Math.random() * height;
    
    // 무작위 속도 (사방으로 조금씩 퍼짐)
    const vx = (Math.random() - 0.5) * 4;
    const vy = (Math.random() - 0.5) * 4;
    
    timerParticles.push({
      x: px,
      y: py,
      vx: vx,
      vy: vy,
      size: Math.random() * 3 + 2, // 2~5px 크기
      alpha: 1
    });
  }
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
  
  // ✨ 첫 번째 큐의 첫 번째 도형을 꺼내서 배치하고, 큐에서 제거
  const currentBundle = shapeQueue[currentBundleIndex];
  const firstType = currentBundle.shift(); // 배열에서 제거
  shapes.push({ type: firstType, x: w.x, y: w.y, rot: 0 });
  
  // 만약 첫 번째 큐가 비었다면 다음 큐로 이동
  if (currentBundle.length === 0) {
    currentBundleIndex++;
    currentShapeIndex = 0;
  } else {
    currentShapeIndex = 0; // 남은 도형의 첫 번째가 현재 들고 있는 도형
  }
  
  updateQueueUI();
  document.getElementById('rankingPanel').classList.add('hidden'); // ✨ 숨기기
}

function startGame() {
  resetGame();
  gameState = 'playing';
  hideAllOverlays();
}

function goHome() {
  // ✨ index.html로 이동
  window.location.href = 'index.html';
}

function showRankingOverlay(canInput) {
  const initialsMenu = document.getElementById('initialsMenu');
  const inputGroup = document.getElementById('initialsInputGroup');
  const title = document.getElementById('initialsTitle');
  const desc = document.getElementById('initialsDesc');
  const rankingList = document.getElementById('rankingList');

  // 랭킹 목록 렌더링
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
  const rawPct = computeFillPercent();
  const truncatedPct = Math.floor(rawPct * 100) / 100; 
  const success = truncatedPct >= TARGET_PCT;

  gameState = 'result';
  resultTitle.textContent = success ? '성공!' : '실패';
  resultTitle.className = 'result-title ' + (success ? 'success' : 'fail');
  
  const compareSymbol = success ? '≥' : '<';
  resultDesc.textContent = `${truncatedPct.toFixed(2)}% ${compareSymbol} ${TARGET_PCT}%`;
  
  hideAllOverlays();
  resultBar.classList.add('show');
  
  // ✨ 랭킹 로직 (HAS_RANKING이 true일 때만 실행)
  if (HAS_RANKING) {
    const elapsed = HAS_TIMER ? (performance.now() - startTime) / 1000 : 0;
    finalRemainingTime = HAS_TIMER ? Math.max(0, TIME_LIMIT - elapsed) : 0;
    if (isTimeOver) finalRemainingTime = 0;

    // 우측 랭킹 패널 표시
    updateRankingPanel();
    
    // 랭킹 등록 자격 확인 및 입력창 띄우기
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
    // 쉬움 모드에서는 랭킹 패널 숨김
    document.getElementById('rankingPanel').classList.add('hidden');
  }
  
  // 저장 버튼 비활성화
  const btnSave = document.getElementById('btnSave');
  if (btnSave) btnSave.disabled = true;
}

// ---------- 저장/불러오기 ----------
function serializeState() {
  return {
    version: 4,
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
    isTimeOver: isTimeOver, // ✨ 저장
    view: { x: view.x, y: view.y, scale: view.scale },
    savedAt: new Date().toISOString(),
  };
}
// loadFromSlot에서 version === 3 조건 확인 및 변수 복원
function saveToSlot(i) {
  if (!confirm('저장하시겠습니까?\n(주의: 저장/불러오기를 하면 랭킹 등록이 불가능해집니다.)')) {
    return false;
  }
  try {
    // ✨ 저장 시 시간 초과 처리 강제
    isTimeOver = true; 
    localStorage.setItem(SAVE_PREFIX + i, JSON.stringify(serializeState()));
    return true;
  } catch (e) { return false; }
}
function loadFromSlot(i) {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + i);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || data.version !== 4 || !Array.isArray(data.shapes)) return false;
    
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
    
    // ✨ 불러오기 시 시간 초과 상태 강제
    isTimeOver = true; 
    
    gameState = 'playing';
    resultBar.classList.remove('show');
    updateQueueUI();
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
      // 1. 저장 버튼
      btn.textContent = '저장';
      btn.onclick = () => {
        if (info) { 
          if (!confirm(`슬롯 ${i + 1}에 이미 데이터가 있습니다. 덮어쓰시겠습니까?`)) return;
        }
        if (saveToSlot(i)) renderSlots(container, 'save'); 
        else alert('저장 실패'); 
      };
      btnGroup.appendChild(btn);

      // ✨ 2. 저장 화면에서도 삭제 버튼 추가
      const btnDel = document.createElement('button');
      btnDel.textContent = '삭제';
      btnDel.className = 'danger';
      btnDel.disabled = !info;
      btnDel.onclick = () => {
        if (confirm(`슬롯 ${i + 1}의 데이터를 정말 삭제하시겠습니까?`)) {
          if (deleteSlot(i)) renderSlots(container, 'save'); // ✨ 저장 화면 갱신
          else alert('삭제 실패');
        }
      };
      btnGroup.appendChild(btnDel);

    } else {
      // 불러오기 모드
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
      initials: initials, // ✨ 이니셜 저장
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

// ✨ 우측 랭킹 패널 갱신
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

// ✨ 이니셜 입력창 띄우기 (중앙)
function showInitialsInput() {
  hideAllOverlays();
  document.getElementById('initialsMenu').classList.remove('hidden');
  document.getElementById('initialsInput').value = '';
  document.getElementById('initialsInput').focus();
}

// ---------- 이벤트 ----------
document.getElementById('btnStart').onclick = startGame;
document.getElementById('btnResume').onclick = () => { gameState = 'playing'; hideAllOverlays(); };
document.getElementById('btnShowRules').onclick = () => { hideOverlay(pauseMenu); showOverlay(rulesAgain); };
document.getElementById('btnRulesBack').onclick = () => { hideOverlay(rulesAgain); showOverlay(pauseMenu); };
document.getElementById('btnSave').onclick = () => {
  if (gameState === 'result' || stateBeforePause === 'result') {
    return;
  }
  renderSlots(saveSlotsEl, 'save');
  hideOverlay(pauseMenu);
  showOverlay(saveMenu);
};
document.getElementById('btnLoad').onclick = () => { renderSlots(loadSlotsEl, 'load'); hideOverlay(pauseMenu); showOverlay(loadMenu); };
document.getElementById('btnSaveClose').onclick = () => { hideOverlay(saveMenu); showOverlay(pauseMenu); };
document.getElementById('btnLoadClose').onclick = () => { hideOverlay(loadMenu); showOverlay(pauseMenu); };
document.getElementById('btnRestart').onclick = () => { if (confirm('처음으로 돌아갑니다. 저장하지 않은 진행은 사라집니다.')) goHome(); };
document.getElementById('btnResultRestart').onclick = startGame;
document.getElementById('btnResultHome').onclick = goHome;

document.getElementById('btnSubmitRanking').onclick = () => {
  const input = document.getElementById('initialsInput');
  // ✨ 영문 대문자와 숫자만 허용
  let initials = input.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  
  // ✨ 3글자가 아니면 저장하지 않고 경고
  if (initials.length !== 3) {
    alert('이름은 영문 및 숫자 3글자로 정확히 입력해야 합니다.');
    input.focus();
    return; 
  }
  
  if (pendingRankData) {
    // ✨ 3글자가 확인된 시점에만 랭킹 저장
    saveRanking(pendingRankData.pct, pendingRankData.time, initials);
    pendingRankData = null;
  }
  
  hideOverlay(document.getElementById('initialsMenu')); // 입력창 닫기
  updateRankingPanel(); // 우측 랭킹 패널 갱신
};

document.getElementById('initialsInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('btnSubmitRanking').click();
  }
});

// ✨ 퀵 재시작 버튼 이벤트
document.getElementById('btnQuickRestart').onclick = () => {
  if (gameState === 'playing' || gameState === 'result') {
    if (confirm('게임을 다시 시작하시겠습니까?\n현재 진행 상황은 저장되지 않습니다.')) {
      startGame(); // 게임 재시작 함수 호출
    }
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
    
    // 큐에서 제거 및 인덱스 이동
    if (shapeQueue.length > currentBundleIndex) {
      const currentBundle = shapeQueue[currentBundleIndex];
      if (currentShapeIndex < currentBundle.length) {
        currentBundle.splice(currentShapeIndex, 1);
      }
      
      // 현재 묶음을 다 썼다면 다음 묶음으로 이동
      if (currentBundle.length === 0 || currentShapeIndex >= currentBundle.length) {
        currentBundleIndex++;
        currentShapeIndex = 0;
      }
    } else if (savedType) {
      savedType = null;
    }

    // ✨ [예외 1 해제] 도형이 배치되었으므로 교체 락 해제
    replacedBundleIndex = -1;
    replacedShapeIndex = -1;

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
  
  // 1. 큐가 비었거나 현재 묶음이 없으면 중단
  if (shapeQueue.length === 0 || currentBundleIndex >= shapeQueue.length) return;
  
  // ✨ [수정] currentBundle 변수를 가장 먼저 선언하여 참조 에러 방지
  const currentBundle = shapeQueue[currentBundleIndex];
  if (currentShapeIndex >= currentBundle.length) return; // 현재 묶음 다 씀

  const currentNext = currentBundle[currentShapeIndex];

  // ✨ 2. 마지막 도형 체크 (현재 큐에 남은 도형이 1개이고, 다음 큐가 없을 때)
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

  // 3. 슬롯에 있는 도형과 현재 도형이 같으면 경고 (교체 무의미)
  if (savedType === currentNext) {
    errorMsg = '이미 같은 도형을 들고 있습니다.';
    tooltipX = mouse.sx;
    tooltipY = mouse.sy - 20;
    tooltipStartTime = performance.now();
    clearTimeout(errorMsgTimer);
    errorMsgTimer = setTimeout(() => { errorMsg = ''; }, 1200);
    return;
  }

  // 4. 삼삼삼 번들인 경우 교체 불가
  if (currentBundle.isSpecial === true) {
    errorMsg = '삼각형 3개 번들은 교체할 수 없습니다!';
    tooltipX = mouse.sx;
    tooltipY = mouse.sy - 20;
    tooltipStartTime = performance.now();
    clearTimeout(errorMsgTimer);
    errorMsgTimer = setTimeout(() => { errorMsg = ''; }, 1200);
    return;
  }

  // 5. 이미 이 조각을 교체했다면 재교체 불가
  if (currentBundleIndex === replacedBundleIndex && currentShapeIndex === replacedShapeIndex) {
    errorMsg = '이미 교체한 조각입니다. 배치 후 다시 시도하세요.';
    tooltipX = mouse.sx;
    tooltipY = mouse.sy - 20;
    tooltipStartTime = performance.now();
    clearTimeout(errorMsgTimer);
    errorMsgTimer = setTimeout(() => { errorMsg = ''; }, 1200);
    return;
  }

  // 6. 교체 로직 수행
  if (!savedType) {
    // 슬롯이 비어있으면 현재 도형을 슬롯으로 이동
    savedType = currentNext;
    currentBundle.splice(currentShapeIndex, 1); 
    
    // splice로 인해 배열이 당겨지므로, 현재 인덱스가 배열 길이를 넘어가면 다음 묶음으로 넘김
    if (currentShapeIndex >= currentBundle.length) {
      currentBundleIndex++;
      currentShapeIndex = 0;
    }
  } else {
    // 슬롯에 도형이 있으면 서로 교체(Swap)
    const temp = savedType;
    savedType = currentNext;
    currentBundle[currentShapeIndex] = temp;
  }

  // 7. 교체 락 기록 (재교체 방지)
  replacedBundleIndex = currentBundleIndex;
  replacedShapeIndex = currentShapeIndex;

  // 8. UI 및 미리보기 갱신
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
    if (gameState === 'playing' || gameState === 'result') {
      stateBeforePause = gameState;
      gameState = 'paused';
      if (HAS_TIMER) pausedTime = performance.now(); // ✨ 타이머가 있을 때만 기록
      showOverlay(pauseMenu);
      
      const btnSave = document.getElementById('btnSave');
      if (btnSave) btnSave.disabled = true; 
      
    } else if (gameState === 'paused') {
      // ... (기존 하위 메뉴 닫기 로직) ...
    } else {
      gameState = stateBeforePause;
      if (HAS_TIMER) {
        startTime += (performance.now() - pausedTime); // ✨ 타이머 보정
      }
      hideAllOverlays();
      
      const btnSave = document.getElementById('btnSave');
      if (btnSave) btnSave.disabled = (gameState === 'result');
    }
  }
});

window.addEventListener('resize', resize);

// ---------- 초기화 ----------
resize();
loop();