// ===== 实验二：变化检测（Rensink闪烁范式 + 稳定海图参照）=====
// 视觉：像素风群岛海图，多条不同颜色的航线，船只标记

(function() {
  'use strict';

  // ===== 实验参数 =====
  const CONFIG = {
    practice: { trials: 8 },
    formal: { trials: 40 },
    timing: {
      fixation: 800,
      imageA: 300,
      blank: 160,
      imageB: 300,
      maxCycles: 45,
      feedback: 800,
      iti: 600,
    },
    canvas: { width: 1200, height: 800 },
    markers: {
      count: 26,        // 船只标记数量（第二次校准）
      size: 26,         // 点击判定半径基准
      moveDistance: 40, // 变化位移（最终冻结值）
    },
    routes: { count: 6 },
    // 每条航线一种颜色（像素风调色板）
    routeColors: ['#c8a44a', '#4a8fb5', '#b5564a', '#6a9b6f', '#9a7ab5', '#c97f4a'],
  };

  // ===== 状态 =====
  let currentPhase = 'practice';
  let trials = [];
  let currentTrialIndex = 0;
  let results = [];
  let practiceResults = [];
  let canvas, ctx;
  let animationId = null;
  let currentTrial = null;
  let cycleCount = 0;
  let detectionTime = null;
  let spacePressed = false;

  // 固定海图（整个实验只生成一次，保证参照层恒定）
  let CHART = null;

  // 变化点的抽样状态：避免连续同一区域、四周象限失衡
  let lastChangePos = null;
  const quadrantCounts = { NW: 0, NE: 0, SW: 0, SE: 0 };

  // ===== 初始化 =====
  window.addEventListener('load', () => {
    canvas = document.getElementById('stimulusCanvas');
    ctx = canvas.getContext('2d');
    canvas.style.imageRendering = 'pixelated';
    CHART = buildChart(); // 生成固定群岛与航线

    // 绑定上传：只上传正式试次
    bindUpload('btn-upload-2', 'upload-status-2', () => ({
      experiment: 'route_change',
      participant: localStorage.getItem('participant_id') || 'unknown',
      trials: results,
      meta: { task_order: localStorage.getItem('task_order') || '' },
    }));
  });

  // ===== 可复现随机数 =====
  function mulberry32(a) {
    return function() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ===== 构建海图 =====
  function buildChart() {
    const rng = mulberry32(20261103);
    const { width, height } = CONFIG.canvas;

    // --- 群岛：在网格上撒不规则像素岛 ---
    const islands = [];
    for (let i = 0; i < 26; i++) {
      islands.push({
        x: 60 + rng() * (width - 120),
        y: 60 + rng() * (height - 120),
        r: 22 + rng() * 46,          // 半径
        hRatio: 0.55 + rng() * 0.35, // 压扁比例
        wobble: 0.35 + rng() * 0.4,  // 轮廓不规则度
        phase: rng() * Math.PI * 2,
      });
    }

    // --- 航线：每条由若干航路点连成的折线 ---
    const routes = [];
    for (let i = 0; i < CONFIG.routes.count; i++) {
      const pts = [];
      const startY = 90 + (i / CONFIG.routes.count) * (height - 180);
      const segments = 5 + Math.floor(rng() * 3);
      for (let s = 0; s <= segments; s++) {
        pts.push({
          x: 80 + (s / segments) * (width - 160) + (rng() - 0.5) * 90,
          y: startY + (rng() - 0.5) * 150,
        });
      }
      routes.push({ points: pts, color: CONFIG.routeColors[i % CONFIG.routeColors.length] });
    }

    return { islands, routes };
  }

  // ===== 模式预览（指导页用，不计入数据）=====
  let previewId = null;

  window.startPreview = function(mode) {
    hideAllWindows();
    document.getElementById('experimentWindow').classList.add('active');

    const demo = {
      displayMode: mode,
      changeLocation: 'center',
      markers: buildMarkers('center'),
      isPreview: true,
    };

    const prevTrial = currentTrial;
    currentTrial = demo;

    const startTime = performance.now();
    let phase = 'A';
    let phaseStart = performance.now();
    const A = CONFIG.timing.imageA;
    const B = CONFIG.timing.imageB;
    const BLANK = CONFIG.timing.blank;

    function step() {
      const now = performance.now();

      // 9 秒后自动结束预览，回到指导页
      if (now - startTime > 9000) {
        cancelAnimationFrame(previewId);
        currentTrial = prevTrial;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hideAllWindows();
        document.getElementById('instructionWindow').classList.add('active');
        return;
      }

      const elapsed = now - phaseStart;
      if (phase === 'A' && elapsed >= A) { phase = 'blank1'; phaseStart = now; }
      else if (phase === 'blank1' && elapsed >= BLANK) { phase = 'B'; phaseStart = now; }
      else if (phase === 'B' && elapsed >= B) { phase = 'blank2'; phaseStart = now; }
      else if (phase === 'blank2' && elapsed >= BLANK) { phase = 'A'; phaseStart = now; }

      drawFrame(phase);
      previewId = requestAnimationFrame(step);
    }

    step();
  };

  // ===== 试验流程 =====
  window.startPractice = function() {
    resetSampling();
    currentPhase = 'practice';
    trials = generateTrials('practice');
    currentTrialIndex = 0;
    practiceResults = [];
    hideAllWindows();
    document.getElementById('experimentWindow').classList.add('active');
    runTrial();
  };

  window.startFormal = function() {
    resetSampling();
    currentPhase = 'formal';
    trials = generateTrials('formal');
    currentTrialIndex = 0;
    results = [];
    hideAllWindows();
    document.getElementById('experimentWindow').classList.add('active');
    runTrial();
  };

  window.downloadData = function() {
    localStorage.setItem('exp2_results', JSON.stringify(results));
    localStorage.setItem('exp2_practice', JSON.stringify(practiceResults));

    const exp1Results = JSON.parse(localStorage.getItem('exp1_results') || '[]');
    const exp1Practice = JSON.parse(localStorage.getItem('exp1_practice') || '[]');
    const participant = localStorage.getItem('participant_id') || 'unknown';

    const allData = {
      participantId: participant,
      experiment1: { practice: exp1Practice, formal: exp1Results },
      experiment2: { practice: practiceResults, formal: results },
      timestamp: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lighthouse_${participant}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  window.checkReturnPath = function() {
    const exp1Done = localStorage.getItem('exp1_done');
    if (exp1Done) {
      window.location.href = 'index.html';
    } else {
      localStorage.setItem('exp2_done', 'true');
      window.location.href = 'experiment1.html';
    }
  };

  function resetSampling() {
    lastChangePos = null;
    Object.keys(quadrantCounts).forEach(k => quadrantCounts[k] = 0);
  }

  function quadrantOf(p, w, h) {
    const ns = p.y < h / 2 ? 'N' : 'S';
    const ew = p.x < w / 2 ? 'W' : 'E';
    return ns + ew;
  }

  // ===== 生成试次 =====
  function generateTrials(phase) {
    const trialList = [];
    // 两个显示模式：均匀遮蔽 / 稳定参照
    const displayModes = ['uniform', 'reference'];
    const changeLocations = ['edge', 'center'];
    // 正式：2 × 2 × 10 = 40；练习：2 × 2 × 2 = 8
    const reps = phase === 'practice' ? 2 : 10;

    for (let r = 0; r < reps; r++) {
      for (const mode of displayModes) {
        for (const location of changeLocations) {
          trialList.push({ displayMode: mode, changeLocation: location });
        }
      }
    }
    return shuffle(trialList);
  }

  // ===== 单试次 =====
  function runTrial() {
    if (currentTrialIndex >= trials.length) { endPhase(); return; }

    currentTrial = trials[currentTrialIndex];
    cycleCount = 0;
    detectionTime = null;
    spacePressed = false;

    // 本试次的船只标记（基准位置 + 一个变化位置）
    currentTrial.markers = buildMarkers(currentTrial.changeLocation);
    currentTrial.trialStart = performance.now();

    showFixation();
    setTimeout(() => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // 刺激（第一次 A 帧）出现的时间，作为发现时间的起点
      currentTrial.stimulusStart = performance.now();
      startFlicker();
    }, CONFIG.timing.fixation);
  }

  // ===== 生成船只标记（含一个变化点）=====
  function buildMarkers(changeLocation) {
    const { width, height } = CONFIG.canvas;
    const positions = generatePositions(CONFIG.markers.count, width, height, 95, 90);

    // 按位置类型挑选变化点
    const score = (p) => changeLocation === 'edge'
      ? Math.min(p.x, p.y, width - p.x, height - p.y)   // 越小越靠边
      : Math.hypot(p.x - width / 2, p.y - height / 2);   // 越小越靠中心

    const within = (p) => changeLocation === 'edge' ? score(p) < 170 : score(p) < 190;

    // 候选：符合位置条件
    let candidates = positions.map((p, i) => i).filter(i => within(positions[i]));

    // 排除与上一试次变化点过近的位置（避免连续同一区域）
    if (lastChangePos) {
      const far = candidates.filter(i => {
        const p = positions[i];
        return Math.hypot(p.x - lastChangePos.x, p.y - lastChangePos.y) > 170;
      });
      if (far.length) candidates = far;
    }

    let changeIndex;

    if (candidates.length === 0) {
      // 没有符合位置的船时：把最接近该区域的一艘移进去，保证条件标记与实际一致
      changeIndex = 0;
      let best = Infinity;
      positions.forEach((p, i) => {
        const s = score(p);
        if (s < best) { best = s; changeIndex = i; }
      });

      if (changeLocation === 'center') {
        positions[changeIndex] = {
          x: width / 2 + (Math.random() - 0.5) * 120,
          y: height / 2 + (Math.random() - 0.5) * 120,
        };
      } else {
        const band = 90;
        const side = Math.floor(Math.random() * 4);
        if (side === 0) positions[changeIndex] = { x: band + Math.random() * (width - 2 * band), y: band + Math.random() * 40 };
        if (side === 1) positions[changeIndex] = { x: band + Math.random() * (width - 2 * band), y: height - band - Math.random() * 40 };
        if (side === 2) positions[changeIndex] = { x: band + Math.random() * 40, y: band + Math.random() * (height - 2 * band) };
        if (side === 3) positions[changeIndex] = { x: width - band - Math.random() * 40, y: band + Math.random() * (height - 2 * band) };
      }
    } else {
      // 四象限均衡：优先挑出现次数最少的象限
      const byQuad = {};
      candidates.forEach(i => {
        const q = quadrantOf(positions[i], width, height);
        (byQuad[q] = byQuad[q] || []).push(i);
      });

      const minCount = Math.min(...Object.keys(byQuad).map(q => quadrantCounts[q] || 0));
      const bestQuads = Object.keys(byQuad).filter(q => (quadrantCounts[q] || 0) === minCount);
      const chosenQuad = bestQuads[Math.floor(Math.random() * bestQuads.length)];
      const pool = byQuad[chosenQuad];

      changeIndex = pool[Math.floor(Math.random() * pool.length)];

      quadrantCounts[chosenQuad] = (quadrantCounts[chosenQuad] || 0) + 1;
    }

    lastChangePos = { x: positions[changeIndex].x, y: positions[changeIndex].y };

    // 变化后的新位置：保证在画布内，且与其他船保持距离
    const base = positions[changeIndex];
    let newPos = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const cand = {
        x: Math.max(70, Math.min(width - 70, base.x + Math.cos(angle) * CONFIG.markers.moveDistance)),
        y: Math.max(70, Math.min(height - 70, base.y + Math.sin(angle) * CONFIG.markers.moveDistance)),
      };
      const clear = positions.every((p, i) => i === changeIndex || Math.hypot(p.x - cand.x, p.y - cand.y) > 60);
      if (clear) { newPos = cand; break; }
    }
    if (!newPos) {
      newPos = {
        x: Math.max(70, Math.min(width - 70, base.x + CONFIG.markers.moveDistance)),
        y: base.y,
      };
    }

    return positions.map((p, i) => i === changeIndex
      ? { posA: p, posB: newPos, isChange: true, markerIndex: i }
      : { posA: p, posB: { x: p.x, y: p.y }, isChange: false, markerIndex: i });
  }

  // ===== 闪烁 =====
  function startFlicker() {
    let phase = 'A';
    let phaseStartTime = performance.now();

    const spaceHandler = (e) => {
      if (e.key === ' ' && !spacePressed) {
        e.preventDefault();
        spacePressed = true;
        // 发现时间从刺激出现算起，不含注视点
        detectionTime = performance.now() - currentTrial.stimulusStart;
        cancelAnimationFrame(animationId);
        document.removeEventListener('keydown', spaceHandler);
        waitForClick();
      }
    };
    document.addEventListener('keydown', spaceHandler);

    function animate() {
      const elapsed = performance.now() - phaseStartTime;

      if (phase === 'A' && elapsed >= CONFIG.timing.imageA) {
        phase = 'blank1'; phaseStartTime = performance.now();
      } else if (phase === 'blank1' && elapsed >= CONFIG.timing.blank) {
        phase = 'B'; phaseStartTime = performance.now();
      } else if (phase === 'B' && elapsed >= CONFIG.timing.imageB) {
        phase = 'blank2'; phaseStartTime = performance.now();
      } else if (phase === 'blank2' && elapsed >= CONFIG.timing.blank) {
        phase = 'A'; phaseStartTime = performance.now();
        cycleCount++;
        if (cycleCount >= CONFIG.timing.maxCycles) {
          cancelAnimationFrame(animationId);
          document.removeEventListener('keydown', spaceHandler);
          trialTimeout();
          return;
        }
      }

      drawFrame(phase);
      animationId = requestAnimationFrame(animate);
    }
    animate();
  }

  // ===== 绘制一帧 =====
  function drawFrame(phase) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 深海底色（提亮）
    ctx.fillStyle = '#0e2434';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (phase === 'blank1' || phase === 'blank2') {
      if (currentTrial.displayMode === 'reference') {
        // 稳定参照：空白期保留整层非目标任务结构（岛屿/网格/罗盘/航线）
        drawWaterTexture(0.85);
        drawIslands(0.95);
        drawGrid(0.85);
        drawRoutes(1);      // 航线与航路点也持续可见
        drawCompass(0.85);
      } else if (currentTrial.displayMode === 'uniform') {
        // 均匀遮蔽：与参照层平均亮度一致的纯色块，没有任何空间结构
        ctx.fillStyle = getUniformColor();
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        // 普通模式：空白期只剩纯黑，结构完全消失
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      drawPreviewLabel();
      return;
    }

    // 完整海图（A/B 帧两种模式完全一致）
    drawWaterTexture(1);
    drawIslands(1);
    drawGrid(1);
    drawRoutes(1);

    // 船只标记
    const key = phase === 'A' ? 'posA' : 'posB';
    currentTrial.markers.forEach(m => drawShipMarker(m[key].x, m[key].y));

    // 罗盘：A/B 帧常驻（只有空白期是否保留才是条件差异）
    drawCompass(1);
    drawPreviewLabel();
  }

  // 预览时在左上角标注当前模式与空白期内容
  function drawPreviewLabel() {
    if (!currentTrial || !currentTrial.isPreview) return;
    const info = {
      'reference': ['稳定参照', '空白期：保留海图骨架'],
      'uniform': ['均匀遮蔽', '空白期：纯色块，无结构'],
      'no-reference': ['普通闪烁', '空白期：纯黑'],
    };
    const [name, desc] = info[currentTrial.displayMode] || ['', ''];

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(16, 16, 420, 78);
    ctx.strokeStyle = '#c8a44a';
    ctx.lineWidth = 2;
    ctx.strokeRect(16, 16, 420, 78);

    ctx.fillStyle = '#f4d084';
    ctx.font = '24px "Pixelify Sans","FusionPixelFine","FusionPixel","Press Start 2P", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 32, 46);

    ctx.fillStyle = '#c9d9e8';
    ctx.font = '24px "Pixelify Sans","FusionPixelFine","FusionPixel","Press Start 2P", monospace';
    ctx.fillText(desc, 32, 74);
    ctx.restore();
  }

  // ===== 计算参照层平均色（用于均匀遮蔽条件）=====
  let UNIFORM_COLOR = null;
  function getUniformColor() {
    if (UNIFORM_COLOR) return UNIFORM_COLOR;

    const off = document.createElement('canvas');
    off.width = CONFIG.canvas.width;
    off.height = CONFIG.canvas.height;
    const octx = off.getContext('2d');

    const prevCtx = ctx, prevCanvas = canvas;
    ctx = octx; canvas = off;

    ctx.fillStyle = '#0e2434';
    ctx.fillRect(0, 0, off.width, off.height);
    drawWaterTexture(0.7);
    drawIslands(0.75);
    drawGrid(0.6);
    drawRoutes(0.85);
    drawCompass(0.6);

    ctx = prevCtx; canvas = prevCanvas;

    const data = octx.getImageData(0, 0, off.width, off.height).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4 * 37) {
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    UNIFORM_COLOR = `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
    return UNIFORM_COLOR;
  }

  // ===== 海面纹理：浅蓝色像素反光点 =====
  function drawWaterTexture(alpha) {
    ctx.save();
    const rng = mulberry32(7779);

    for (let i = 0; i < 260; i++) {
      const x = Math.floor(rng() * canvas.width / 6) * 6;
      const y = Math.floor(rng() * canvas.height / 6) * 6;
      const len = rng() < 0.3 ? 12 : 6;
      const a = (0.10 + rng() * 0.24) * alpha;

      ctx.fillStyle = `rgba(150, 205, 240, ${a.toFixed(3)})`;
      ctx.fillRect(x, y, len, 6);

      // 少量更亮的点，增强"碎光"感
      if (rng() < 0.12) {
        ctx.fillStyle = `rgba(205, 238, 255, ${(a * 1.3).toFixed(3)})`;
        ctx.fillRect(x, y, 6, 6);
      }
    }
    ctx.restore();
  }

  // ===== 群岛 =====
  function drawIslands(alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;

    CHART.islands.forEach(isl => {
      const px = 6;
      const totalH = isl.r * 2 * isl.hRatio;

      for (let y = 0; y < totalH; y += px) {
        const t = (y + px / 2) / totalH;
        const shape = Math.sqrt(Math.max(0, 1 - Math.pow(2 * t - 1, 2)));
        const wob = 1 + isl.wobble * Math.sin(t * 7 + isl.phase);
        const halfW = Math.max(px, isl.r * shape * wob);

        const left = Math.round((isl.x - halfW) / px) * px;
        const width = Math.round((halfW * 2) / px) * px;

        // 岛体（陆地的暗色，提亮）
        ctx.fillStyle = '#31495c';
        ctx.fillRect(left, Math.round((isl.y - totalH / 2 + y) / px) * px, width, px);
      }

      // 海岸线：沿岛体横向中点描一条较亮边
      ctx.fillStyle = '#6f8b9c';
      for (let y = 0; y < totalH; y += px * 2) {
        const t = (y + px / 2) / totalH;
        const shape = Math.sqrt(Math.max(0, 1 - Math.pow(2 * t - 1, 2)));
        const wob = 1 + isl.wobble * Math.sin(t * 7 + isl.phase);
        const halfW = Math.max(px, isl.r * shape * wob);

        // 左侧边缘
        ctx.fillRect(
          Math.round((isl.x - halfW) / px) * px,
          Math.round((isl.y - totalH / 2 + y) / px) * px,
          px, px
        );
        // 右侧边缘
        ctx.fillRect(
          Math.round((isl.x + halfW - px) / px) * px,
          Math.round((isl.y - totalH / 2 + y) / px) * px,
          px, px
        );
      }
    });
    ctx.restore();
  }

  // ===== 经纬网格 + 罗盘线 =====
  function drawGrid(alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(150, 190, 215, 0.45)';
    ctx.lineWidth = 1;

    const step = 100;
    for (let x = 0; x <= canvas.width; x += step) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(canvas.width, y + 0.5); ctx.stroke();
    }

    // 中央十字（空间锚点）
    ctx.strokeStyle = 'rgba(244, 208, 132, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0); ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.moveTo(0, canvas.height / 2); ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
    ctx.restore();
  }

  // ===== 航线（不同颜色）=====
  function drawRoutes(alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 4;
    ctx.lineCap = 'butt';
    ctx.setLineDash([10, 6]);

    CHART.routes.forEach(r => {
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = alpha * 0.95;
      ctx.beginPath();
      r.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();

      // 航路点方块
      ctx.setLineDash([]);
      r.points.forEach(p => {
        ctx.fillStyle = r.color;
        ctx.fillRect(Math.round(p.x / 4) * 4 - 3, Math.round(p.y / 4) * 4 - 3, 6, 6);
      });
      ctx.setLineDash([10, 6]);
    });

    ctx.restore();
  }

  // ===== 船只标记（像素小船）=====
  function drawShipMarker(cx, cy) {
    const px = 4;
    const rows = [3, 5, 6, 5, 3];
    const top = cy - (rows.length * px) / 2;

    rows.forEach((w, i) => {
      const left = cx - (w * px) / 2;
      // 更鲜艳的黄色船体：上部亮黄、下部深黄
      ctx.fillStyle = i <= 1 ? '#ffe33d' : '#c99a1f';
      ctx.fillRect(Math.round(left), Math.round(top + i * px), w * px, px);
    });

    // 船灯
    ctx.fillStyle = '#fffbd6';
    ctx.fillRect(Math.round(cx - px / 2), Math.round(top - px), px, px);

    // 同色微微发光，让船在暗色海图上更跳
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 18);
    glow.addColorStop(0, 'rgba(255, 227, 61, 0.35)');
    glow.addColorStop(1, 'rgba(255, 227, 61, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  // ===== 罗盘 =====
  function drawCompass(alpha) {
    const cx = canvas.width - 80;
    const cy = 80;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(200, 164, 74, 0.85)';
    ctx.fillStyle = 'rgba(200, 164, 74, 0.85)';
    ctx.lineWidth = 2;

    ctx.beginPath(); ctx.arc(cx, cy, 28, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 26); ctx.lineTo(cx - 7, cy + 6); ctx.lineTo(cx, cy);
    ctx.lineTo(cx + 7, cy + 6); ctx.closePath(); ctx.fill();

    ctx.font = '24px "Pixelify Sans","FusionPixelFine","FusionPixel","Press Start 2P", monospace';
    ctx.fillText('N', cx - 6, cy - 34);
    ctx.restore();
  }

  // ===== 等待点击 =====
  function waitForClick() {
    drawFrame('B'); // 停在变化后的画面，便于点击变化后的船位

    const clickHandler = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const clickX = (e.clientX - rect.left) * scaleX;
      const clickY = (e.clientY - rect.top) * scaleY;

      let clicked = null;
      let minDist = Infinity;

      currentTrial.markers.forEach(m => {
        const d = Math.hypot(clickX - m.posB.x, clickY - m.posB.y);
        if (d < minDist && d < 42) { minDist = d; clicked = m; }
      });

      if (!clicked) return; // 没点中任何标记，继续等待

      const correct = clicked.isChange;
      const changedMarker = currentTrial.markers.find(m => m.isChange);
      const result = {
        participant: localStorage.getItem('participant_id') || 'unknown',
        displayMode: currentTrial.displayMode,
        changeLocation: currentTrial.changeLocation,
        markerIndex: clicked.markerIndex,
        changeX: changedMarker ? changedMarker.posB.x : null,
        changeY: changedMarker ? changedMarker.posB.y : null,
        changeQuadrant: changedMarker ? quadrantOf(changedMarker.posA, canvas.width, canvas.height) : '',
        detectionTime,
        cyclesUntilSpace: cycleCount,
        clickX, clickY,
        targetX: clicked.isChange ? clicked.posB.x : null,
        targetY: clicked.isChange ? clicked.posB.y : null,
        clickError: clicked.isChange
          ? Math.hypot(clickX - clicked.posB.x, clickY - clicked.posB.y)
          : null,
        clickCorrect: correct,
        phase: currentPhase,
      };

      (currentPhase === 'practice' ? practiceResults : results).push(result);
      canvas.removeEventListener('click', clickHandler);

      showFeedback(correct);
      setTimeout(() => {
        hideFeedback();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setTimeout(() => { currentTrialIndex++; runTrial(); }, CONFIG.timing.iti);
      }, CONFIG.timing.feedback);
    };
    canvas.addEventListener('click', clickHandler);
  }

  // ===== 超时 =====
  function trialTimeout() {
    const result = {
      participant: localStorage.getItem('participant_id') || 'unknown',
      displayMode: currentTrial.displayMode,
      changeLocation: currentTrial.changeLocation,
      detectionTime: null,
      cyclesUntilSpace: CONFIG.timing.maxCycles,
      clickX: null, clickY: null, targetX: null, targetY: null, clickError: null,
      clickCorrect: false,
      timeout: true,
      phase: currentPhase,
    };
    (currentPhase === 'practice' ? practiceResults : results).push(result);

    showFeedback(false);
    setTimeout(() => {
      hideFeedback();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setTimeout(() => { currentTrialIndex++; runTrial(); }, CONFIG.timing.iti);
    }, CONFIG.timing.feedback);
  }

  // ===== 随机位置 =====
  function generatePositions(n, width, height, minDist, margin = 0) {
    const positions = [];
    for (let i = 0; i < n; i++) {
      let attempts = 0, pos;
      do {
        pos = {
          x: Math.random() * (width - 2 * margin) + margin,
          y: Math.random() * (height - 2 * margin) + margin,
        };
        attempts++;
      } while (tooClose(pos, positions, minDist) && attempts < 1000);
      positions.push(pos);
    }
    return positions;
  }

  function tooClose(pos, positions, minDist) {
    return positions.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < minDist);
  }

  // ===== UI =====
  function showFixation() {
    ctx.fillStyle = '#0e2434';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f4d084';
    ctx.font = '48px "Pixelify Sans","FusionPixelFine","FusionPixel","Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', canvas.width / 2, canvas.height / 2);
  }

  function showFeedback(correct) {
    const f = document.getElementById('feedback');
    f.textContent = correct ? '✓' : '✗';
    f.className = 'feedback show ' + (correct ? 'correct' : 'incorrect');
  }

  function hideFeedback() {
    document.getElementById('feedback').classList.remove('show');
  }

  function hideAllWindows() {
    document.querySelectorAll('.window').forEach(w => w.classList.remove('active'));
  }

  // ===== 阶段结束 =====
  function endPhase() {
    hideAllWindows();
    const arr = currentPhase === 'practice' ? practiceResults : results;
    const valid = arr.filter(r => !r.timeout);
    const acc = valid.filter(r => r.clickCorrect).length / Math.max(1, arr.length);
    const avg = valid.length
      ? valid.reduce((s, r) => s + r.detectionTime, 0) / valid.length
      : 0;

    if (currentPhase === 'practice') {
      document.getElementById('practiceStats').innerHTML = `
        <p>正确率：${(acc * 100).toFixed(1)}%</p>
        <p>平均发现时间：${avg.toFixed(0)} ms</p>
        <p>超时：${arr.filter(r => r.timeout).length} 次</p>`;
      document.getElementById('practiceEndWindow').classList.add('active');
    } else {
      localStorage.setItem('exp2_results', JSON.stringify(results));
      localStorage.setItem('exp2_practice', JSON.stringify(practiceResults));
      document.getElementById('endStats').innerHTML = `
        <p>正确率：${(acc * 100).toFixed(1)}%</p>
        <p>平均发现时间：${avg.toFixed(0)} ms</p>
        <p>已保存 ${results.length} 条数据</p>`;
      document.getElementById('endWindow').classList.add('active');
    }
  }

  function shuffle(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

})();
