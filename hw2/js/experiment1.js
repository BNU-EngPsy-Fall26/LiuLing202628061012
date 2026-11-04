// ===== 实验一：视觉搜索（Treisman范式 + 颜色对比度改进）=====
// 像素风格船只和礁石，融入暗夜海域场景

(function() {
  'use strict';

  // ===== 实验参数 =====
  const CONFIG = {
    practice: {
      trials: 8, // 练习试次
      setSizes: [8, 24], // 集合大小
    },
    formal: {
      trials: 80, // 正式试次 (2×2×2 条件 × 10)
      setSizes: [8, 24], // 2 个集合大小，用于估计搜索斜率
    },
    timing: {
      fixation: 800,    // 注视点
      stimulus: 0,      // 刺激无限制，按键后消失
      feedback: 600,    // 反馈时长
      iti: 400,         // 试次间隔
    },
    colors: {
      // 高对比度：目标—干扰物色差 ΔE76 ≈ 129.6，黄蓝亮度差 ΔL* ≈ 20.6
      clear: {
        target: '#ffe600',    // 黄：(L*90.7, a*-9.4, b*89.8) 鲜黄
        distractor: '#57b4f0', // 蓝：(L*70.1, a*-9.6, b*-38.1)
        bg: '#123048',
      },
      // 低对比度：目标—干扰物色差 ΔE76 ≈ 71.1，黄蓝亮度差 ΔL* ≈ 19.2
      fog: {
        target: '#d8c06a',    // 黄：(L*78.1, a*-2.5, b*46.1)
        distractor: '#6493b4', // 蓝：(L*58.9, a*-6.9, b*-22.2)
        bg: '#122534',
      },
    },
    canvas: {
      width: 1200,
      height: 800,
    },
    keys: {
      present: 'f',  // 目标存在
      absent: 'j',   // 目标不存在
    },
  };

  // ===== 状态管理 =====
  let currentPhase = 'practice';
  let trials = [];
  let currentTrialIndex = 0;
  let results = [];
  let practiceResults = [];
  let canvas, ctx;

  // ===== 初始化 =====
  window.addEventListener('load', () => {
    canvas = document.getElementById('stimulusCanvas');
    ctx = canvas.getContext('2d');
    canvas.style.imageRendering = 'pixelated';

    // 绑定上传：只上传正式试次
    bindUpload('btn-upload-1', 'upload-status-1', () => ({
      experiment: 'search',
      participant: localStorage.getItem('participant_id') || 'unknown',
      trials: results,
      meta: { task_order: localStorage.getItem('task_order') || '' },
    }));
  });

  window.startPractice = function() {
    currentPhase = 'practice';
    trials = generateTrials('practice');
    currentTrialIndex = 0;
    practiceResults = [];
    hideAllWindows();
    document.getElementById('experimentWindow').classList.add('active');
    runTrial();
  };

  window.startFormal = function() {
    currentPhase = 'formal';
    trials = generateTrials('formal');
    currentTrialIndex = 0;
    results = [];
    hideAllWindows();
    document.getElementById('experimentWindow').classList.add('active');
    runTrial();
  };

  window.goToExperiment2 = function() {
    // 保存数据到localStorage
    localStorage.setItem('exp1_results', JSON.stringify(results));
    localStorage.setItem('exp1_practice', JSON.stringify(practiceResults));
    localStorage.setItem('exp1_done', 'true');

    // 检查实验2是否已完成
    const exp2Done = localStorage.getItem('exp2_done');
    if (exp2Done) {
      // 实验2已完成，返回首页
      window.location.href = 'index.html';
    } else {
      // 跳转到实验二
      window.location.href = 'experiment2.html';
    }
  };

  // 下载已完成的数据（实验二若已完成也会一并包含）
  window.downloadAll = function() {
    const exp2Results = JSON.parse(localStorage.getItem('exp2_results') || '[]');
    const exp2Practice = JSON.parse(localStorage.getItem('exp2_practice') || '[]');
    const participant = localStorage.getItem('participant_id') || 'unknown';

    const allData = {
      participantId: participant,
      experiment1: {
        practice: practiceResults,
        formal: results,
      },
      experiment2: {
        practice: exp2Practice,
        formal: exp2Results,
      },
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

  // ===== 生成试次列表 =====
  function generateTrials(phase) {
    const cfg = CONFIG[phase];
    const trialList = [];

    const searchTypes = ['feature', 'conjunction'];
    const environments = ['clear', 'fog'];

    if (phase === 'practice') {
      // 练习 8 次：2 搜索类型 × 2 对比度 × 2 集合大小，有无目标交替
      let k = 0;
      for (const searchType of searchTypes) {
        for (const env of environments) {
          for (const setSize of cfg.setSizes) {
            trialList.push({
              searchType,
              environment: env,
              setSize,
              targetPresent: k % 2 === 0,
            });
            k++;
          }
        }
      }
    } else {
      // 正式 80 次：8 个主要条件，每条件 10 次（有/无目标各 5 次）
      for (const searchType of searchTypes) {
        for (const env of environments) {
          for (const setSize of cfg.setSizes) {
            for (let i = 0; i < 10; i++) {
              trialList.push({
                searchType,
                environment: env,
                setSize,
                targetPresent: i % 2 === 0,
              });
            }
          }
        }
      }
    }

    return shuffle(trialList);
  }

  // ===== 运行单个试次 =====
  function runTrial() {
    if (currentTrialIndex >= trials.length) {
      endPhase();
      return;
    }

    const trial = trials[currentTrialIndex];
    const startTime = performance.now();

    // 1. 注视点
    showFixation(trial);

    setTimeout(() => {
      // 2. 呈现刺激
      hideFixation();
      showStimulus(trial, startTime);
    }, CONFIG.timing.fixation);
  }

  // ===== 呈现刺激 =====
  function showStimulus(trial, startTime) {
    // 绘制海域背景（含浅蓝色像素反光点）
    drawSeaBackground(trial);

    // 添加浓雾效果
    if (trial.environment === 'fog') {
      drawFog();
    }

    // 生成物体位置（集合大时适当缩小最小间距，保证 24 个物体放得下）
    const minDist = trial.setSize >= 20 ? 95 : 125;
    const positions = generatePositions(trial.setSize, canvas.width, canvas.height, minDist);
    let targetIndex = trial.targetPresent ? Math.floor(Math.random() * trial.setSize) : -1;

    // 绘制物体
    for (let i = 0; i < trial.setSize; i++) {
      const isTarget = (i === targetIndex);
      drawObject(positions[i], trial, isTarget);
    }

    // 添加像素化网格
    drawPixelGrid();

    // 记录按键
    let responded = false;
    const keyHandler = (e) => {
      if (responded) return;
      if (e.key !== CONFIG.keys.present && e.key !== CONFIG.keys.absent) return;

      responded = true;
      const rt = performance.now() - startTime - CONFIG.timing.fixation;
      const response = e.key === CONFIG.keys.present ? 'present' : 'absent';
      const correct = (response === 'present') === trial.targetPresent;

      const result = {
        participant: localStorage.getItem('participant_id') || 'unknown',
        ...trial,
        response,
        rt,
        correct,
        phase: currentPhase,
      };

      if (currentPhase === 'practice') {
        practiceResults.push(result);
      } else {
        results.push(result);
      }

      document.removeEventListener('keydown', keyHandler);

      // 显示反馈
      showFeedback(correct);

      setTimeout(() => {
        hideFeedback();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        setTimeout(() => {
          currentTrialIndex++;
          runTrial();
        }, CONFIG.timing.iti);
      }, CONFIG.timing.feedback);
    };

    document.addEventListener('keydown', keyHandler);
  }

  // ===== 海面背景：渐变色 + 浅蓝色像素反光点 =====
  function drawSeaBackground(trial) {
    const w = canvas.width;
    const h = canvas.height;
    const isClear = trial.environment === 'clear';

    // 1. 深蓝海面渐变（不是纯黑）
    const g = ctx.createLinearGradient(0, 0, 0, h);
    if (isClear) {
      g.addColorStop(0, '#1a4763');
      g.addColorStop(0.5, '#123048');
      g.addColorStop(1, '#0b1f30');
    } else {
      // 普通（低对比度）条件：仍然保持可辨认的海面纹理
      g.addColorStop(0, '#1f3c4e');
      g.addColorStop(0.5, '#16293a');
      g.addColorStop(1, '#0f1f2d');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 2. 浅蓝色像素反光点（每个试次固定，不会干扰反应计时）
    const seed = 9000 + currentTrialIndex * 37 + (isClear ? 0 : 501);
    const rng = mulberry32(seed);
    const density = isClear ? 560 : 470;      // 两种条件都保留充足的浅蓝碎光
    const alphaScale = isClear ? 1.25 : 1.0;  // 高对比条件更亮

    for (let i = 0; i < density; i++) {
      const x = Math.floor(rng() * w / 4) * 4;
      const y = Math.floor(rng() * h / 4) * 4;
      const len = (1 + Math.floor(rng() * 4)) * 4;
      const a = (0.06 + rng() * 0.18) * alphaScale;
      ctx.fillStyle = `rgba(158, 212, 245, ${Math.min(a, 0.42).toFixed(3)})`;
      ctx.fillRect(x, y, len, 4);
    }

    // 3. 少量更亮的闪烁像素
    const brightCount = isClear ? 42 : 28;
    for (let i = 0; i < brightCount; i++) {
      const x = Math.floor(rng() * w / 4) * 4;
      const y = Math.floor(rng() * h / 4) * 4;
      const a = (0.32 + rng() * 0.30) * alphaScale;
      ctx.fillStyle = `rgba(215, 243, 255, ${Math.min(a, 0.72).toFixed(3)})`;
      ctx.fillRect(x, y, 4, 4);
    }
  }

  // ===== 可复现随机数 =====
  function mulberry32(a) {
    return function() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ===== 绘制物体（船只或礁岛）=====
  function drawObject(pos, trial, isTarget) {
    const colors = CONFIG.colors[trial.environment];
    const lightColor = isTarget ? colors.target : colors.distractor;

    let kind;
    if (trial.searchType === 'feature') {
      // 特征搜索：全部是船，只有信号灯颜色不同
      kind = 'ship';
    } else {
      // 联合搜索：目标=黄色灯船；干扰物=蓝灯船 或 暗色礁岛
      kind = isTarget ? 'ship' : ((Math.random() < 0.5) ? 'ship' : 'rock');
    }

    if (kind === 'ship') {
      drawShip(pos.x, pos.y, lightColor);
    } else {
      // 联合搜索中的礁石直接使用目标同色，与目标共享颜色
      drawRock(pos.x, pos.y, colors.target);
    }
  }

  // ===== 像素块绘制基础函数 =====
  function pixelRect(x, y, w, h, color, alpha) {
    ctx.save();
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
    ctx.restore();
  }

  // ===== 船只：整体染色的像素小船 =====
  function drawShip(cx, cy, color) {
    const px = 6;
    const dark = shade(color, -0.18);
    const darker = shade(color, -0.3);

    // 船体：上宽下窄的轮廓，整体用条件颜色
    const rows = [4, 7, 9, 10, 9, 7];
    const hullTop = cy - (rows.length * px) / 2 + px * 2;

    rows.forEach((w, i) => {
      const left = cx - (w * px) / 2;
      const y = hullTop + i * px;
      // 只有最底两行加深，主体保持原本的鲜色
      const c = i <= 3 ? color : (i === 4 ? dark : darker);
      pixelRect(left, y, w * px, px, c);
    });

    // 船舱：更亮的色块，让轮廓像船
    pixelRect(cx - px, hullTop - px, px * 2, px, shade(color, 0.25));
    // 船舷暗边
    pixelRect(cx - (4 * px) / 2, hullTop + rows.length * px, 4 * px, px, darker);

    // 桅杆（同色系加深）
    pixelRect(cx - px / 2, hullTop - px * 3, px, px * 2, dark);

    // 小旗（同色）
    pixelRect(cx + px / 2, hullTop - px * 3, px * 2, px, color);

    // 光晕：所有物体同尺寸，只有颜色不同
    drawGlow(cx, cy, color, 32, 0.55);
  }

  // ===== 礁石：整体染色的像素椭圆块 =====
  function drawRock(cx, cy, color) {
    const px = 6;
    const dark = shade(color, -0.2);
    const darker = shade(color, -0.32);

    // 不规则椭圆轮廓（宽 > 高，边缘带缺口）
    const mask = [
      [0, 1, 1, 1, 1, 0],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [0, 1, 1, 1, 0, 0],
    ];
    const cols = mask[0].length;
    const rows = mask.length;
    const w = cols * px;
    const h = rows * px;
    const left = cx - w / 2;
    const top = cy - h / 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!mask[r][c]) continue;
        // 外圈亮、内部暗，形成礁石体积感
        const isEdge = (r === 0 || r === rows - 1 || c === 0 || c === cols - 1);
        const fill = isEdge ? color : (r >= 3 ? darker : dark);
        pixelRect(left + c * px, top + r * px, px, px, fill);
      }
    }

    // 顶部一排亮色（浪花反光）
    pixelRect(left + px, top, px * 2, px, shade(color, 0.3));

    // 光晕：与船同尺寸
    drawGlow(cx, cy, color, 32, 0.55);
  }

  // ===== 光晕 =====
  function drawGlow(cx, cy, color, radius, alpha) {
    const rgb = hexToRgb(color);
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, radius);
    glow.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    glow.addColorStop(0.5, `rgba(${rgb}, ${alpha * 0.35})`);
    glow.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // ===== 颜色明暗调整 =====
  function shade(hex, amount) {
    const h = hex.replace('#', '');
    let r = parseInt(h.substring(0, 2), 16);
    let g = parseInt(h.substring(2, 4), 16);
    let b = parseInt(h.substring(4, 6), 16);
    const adjust = (v) => Math.max(0, Math.min(255, Math.round(v + 255 * amount)));
    r = adjust(r); g = adjust(g); b = adjust(b);
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  // 颜色转换：把 #rrggbb 变成 "r, g, b"，供 rgba 使用
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `${r}, ${g}, ${b}`;
  }

  // ===== 绘制浓雾效果（轻雾：只压低信号灯对比，不糊死海面）=====
  function drawFog() {
    // 很薄的一层冷灰雾
    ctx.fillStyle = 'rgba(70, 90, 110, 0.14)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 少量雾团，透明度很低
    for (let i = 0; i < 6; i++) {
      const fogX = Math.random() * canvas.width;
      const fogY = Math.random() * canvas.height;
      const fogGrad = ctx.createRadialGradient(fogX, fogY, 0, fogX, fogY, 170);
      fogGrad.addColorStop(0, 'rgba(80, 100, 120, 0.10)');
      fogGrad.addColorStop(1, 'rgba(80, 100, 120, 0)');
      ctx.fillStyle = fogGrad;
      ctx.beginPath();
      ctx.arc(fogX, fogY, 170, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ===== 绘制像素化网格 =====
  function drawPixelGrid() {
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#000';

    const gridSize = 8;
    for (let x = 0; x < canvas.width; x += gridSize) {
      for (let y = 0; y < canvas.height; y += gridSize) {
        if ((Math.floor(x / gridSize) + Math.floor(y / gridSize)) % 2 === 0) {
          ctx.fillRect(x, y, gridSize, gridSize);
        }
      }
    }
    ctx.restore();
  }

  // ===== 生成随机不重叠位置 =====
  function generatePositions(n, width, height, minDist) {
    const positions = [];
    const maxAttempts = 2000;
    const margin = 85;

    for (let i = 0; i < n; i++) {
      let attempts = 0;
      let pos;

      do {
        pos = {
          x: Math.random() * (width - 2 * margin) + margin,
          y: Math.random() * (height - 2 * margin) + margin,
        };
        attempts++;
      } while (tooClose(pos, positions, minDist) && attempts < maxAttempts);

      positions.push(pos);
    }

    return positions;
  }

  function tooClose(pos, positions, minDist) {
    return positions.some(p => {
      const dx = p.x - pos.x;
      const dy = p.y - pos.y;
      return Math.sqrt(dx * dx + dy * dy) < minDist;
    });
  }

  // ===== UI辅助函数 =====
  function showFixation(trial) {
    drawSeaBackground(trial);

    ctx.fillStyle = '#f4d084';
    ctx.font = '48px "Pixelify Sans","FusionPixel","Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', canvas.width / 2, canvas.height / 2);
  }

  function hideFixation() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function showFeedback(correct) {
    const feedback = document.getElementById('feedback');
    feedback.textContent = correct ? '✓' : '✗';
    feedback.className = 'feedback show ' + (correct ? 'correct' : 'incorrect');
  }

  function hideFeedback() {
    const feedback = document.getElementById('feedback');
    feedback.classList.remove('show');
  }

  function hideAllWindows() {
    document.querySelectorAll('.window').forEach(w => w.classList.remove('active'));
  }

  // ===== 阶段结束 =====
  function endPhase() {
    hideAllWindows();

    if (currentPhase === 'practice') {
      const acc = practiceResults.filter(r => r.correct).length / practiceResults.length;
      const avgRt = practiceResults.reduce((sum, r) => sum + r.rt, 0) / practiceResults.length;

      document.getElementById('practiceStats').innerHTML = `
        <p>正确率：${(acc * 100).toFixed(1)}%</p>
        <p>平均反应时：${avgRt.toFixed(0)} ms</p>
      `;
      document.getElementById('practiceEndWindow').classList.add('active');
    } else {
      const acc = results.filter(r => r.correct).length / results.length;
      const avgRt = results.reduce((sum, r) => sum + r.rt, 0) / results.length;

      document.getElementById('endStats').innerHTML = `
        <p>正确率：${(acc * 100).toFixed(1)}%</p>
        <p>平均反应时：${avgRt.toFixed(0)} ms</p>
        <p>已保存 ${results.length} 条数据</p>
      `;
      document.getElementById('endWindow').classList.add('active');
    }
  }

  // ===== 工具函数 =====
  function shuffle(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

})();
