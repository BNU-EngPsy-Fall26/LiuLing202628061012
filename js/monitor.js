/* ============================================================================
 * js/monitor.js —— 监护仪面板（视觉层 · 第 1 阶段）
 *
 * 【它是什么】游戏屏里、患者卡片【上方】的那块"监护仪"：
 *   一条向左滚动的心电波形 + 三组大号读数 + 一颗按严重度闪烁的报警灯 + 一层光晕。
 *   纯增量：删掉它（或者根本不调 render），整局照样跑得完。
 *
 * 【它从哪儿拿数】
 *   · 波形的心率、三组读数 —— 全部直接读 patient.vitals，一个字都不自己算。
 *     面板上的 118 必须就是卡片上的 118：两处读的是同一个 patient.vitals.hr。
 *   · 报警灯的颜色和闪烁速度 —— 由 patient.severity 分档决定，
 *     边界从 PatientData.tierRules.bounds 现读（0.4 / 1.1，见 js/patient-data.js）。
 *     不写死在这里：写死了就成了第二份真源，早晚和那边对不上。
 *   · 读数的颜色 —— 和患者卡片那一行用同一套阈值、同一批类名（.vital-normal / -watch /
 *     -danger，颜色定义在 styles/main.css）。阈值表见下面第 1 节，它镜像
 *     js/patient-card.js 的 VITAL_RANGES。
 *
 * 【★ 铁律（CONTRACT.md 第 8 节）】
 *   ✅ 允许：根据 severity / vitals 决定波形密度、灯的颜色、闪烁速度
 *   ❌ 禁止：任何形式的 if (patient.hasSignal)
 *   ❌ 禁止：把 hasSignal 写进 DOM / data-* / class / title
 *   ❌ 禁止：console.log 打印 patient
 *   本文件的【代码里】一次都没有读过那个"真实答案"字段（它只允许出现在
 *   patient-card.js 和 engine.js 各自那唯一一处明文读取里）。
 *
 *   审计命令（在仓库根目录敲，那对方括号是 grep 的老写法：
 *   让命令本身不匹配自己这一行）：
 *
 *       grep -nE "has[S]ignal" js/monitor.js
 *
 *   判据：应当命中 3 行，且**【全部在文件开头的这段说明里】**（第 20 / 21 / 46 行）。
 *   只看代码、把注释行（`*` 块注释和 `//` 行注释）滤掉：
 *
 *       grep -nE "has[S]ignal" js/monitor.js | grep -vE "^[0-9]+: *(//|\*)"
 *
 *   判据：**0 命中**。命中 ≥1 行就说明有人把它写进了真代码，重点查是不是分支条件。
 *   （severity 反过来：代码里【正好读一次】，就是报警灯那一行 —— 它是任务书
 *     明确允许的输入，见 §三"✅ 允许"。）
 *
 *   ★ 为什么注释里不把它藏起来：藏了之后 grep 是 0 命中，但那个 0 只说明
 *     "用了藏的手法"，不说明"没读"，审计反而变成走过场（patient-card.js 头部
 *     第 0 节也是这个道理）。
 *
 * 【★ frozen 参数是给测试用的，必须实现】
 *   波形一直在动 → 同一个患者渲染两次，Canvas 像素天然不同。
 *   于是"把 hasSignal 从 true 改成 false，判断态 DOM 必须一字不差"这条铁律自查
 *   会【永远失败】—— 而失败的原因不是泄题，是动画。
 *   所以 opts.frozen === true 时：画在固定相位 t = 0，且【不启动】requestAnimationFrame。
 *   平时是动的，测试时冻结。
 *
 * 【接口（任务书 §四）】
 *   window.Monitor.render(el, patient, opts)   el = #monitorPanel
 *   window.Monitor.stop()
 * ==========================================================================*/

window.Monitor = (function () {
  'use strict';

  /* --------------------------------------------------------------------------
   * 0. 常量
   * ------------------------------------------------------------------------ */

  var FALLBACK_ACCENT = '#2ED3A6';   // tokens.css 的 --c-accent（读不到时的兜底）
  var FALLBACK_HR     = 72;          // vitals.hr 缺失时的兜底心率
  var FALLBACK_BOUNDS = [0.4, 1.1];  // PatientData.tierRules.bounds 的兜底

  var PX_PER_SECOND   = 140;         // 走纸速度：每秒 140 像素（向左滚）
  var MIN_BPS         = 0.5;         // 心率下限 30 bpm（防除零/防疯跑）
  var MAX_BPS         = 4.0;         // 心率上限 240 bpm

  /* --------------------------------------------------------------------------
   * 1. 读数分档阈值 —— 镜像 js/patient-card.js 的 VITAL_RANGES
   *
   * 【为什么在这儿抄了一份】patient-card.js 没把这个表导出来，而本次任务
   *   只允许新建本文件、不许改 patient-card.js。所以这里照抄一份，
   *   只抄面板上要显示的三项（心率 / 血压 / 血氧），阈值和判断顺序都一样：
   *   normal → watch → danger（压在边界上的值算正常）。
   *   ★ 改 patient-card.js 的阈值时，这张表要跟着改 —— 自测里有一条
   *     "面板上的颜色类名 = 卡片上的颜色类名"（20 位随机患者）专门盯这个。
   * ------------------------------------------------------------------------ */

  var VITAL_BANDS = {
    hr:   { normal: [60, 100],       watch: [[50, 60], [100, 120]] },
    sbp:  { normal: [90, 140],       watch: [[85, 90], [140, 160]] },
    spo2: { normal: [95, Infinity],  watch: [[90, 94]] },
  };

  // 分档 → main.css 里已有的类（和患者卡片用的是同一批）
  var BAND_CLASS = {
    normal: 'vital-normal',
    watch:  'vital-watch',
    danger: 'vital-danger',
  };

  /* --------------------------------------------------------------------------
   * 2. 一个心动周期的形状
   *
   *   横轴 = 周期内的相位 0~1，纵轴 = 相对基线的幅值（R 波 = 1.0）。
   *   关键点之间线性插值。相位区间和峰值按任务书 §二① 那张表：
   *     0.10~0.15 P 波 · 0.28~0.32 Q 波 · 0.32~0.38 R 波 · 0.38~0.44 S 波 · 0.62~0.78 T 波
   *   ★ 这不是正弦波 —— QRS 是尖的，T 波是宽而缓的。
   * ------------------------------------------------------------------------ */

  var BEAT = [
    [0.000,  0.00],
    [0.100,  0.00],
    [0.125,  0.15],   // P
    [0.150,  0.00],
    [0.280,  0.00],
    [0.320, -0.15],   // Q
    [0.350,  1.00],   // R ★ 最显眼的那一竖
    [0.380,  0.35],
    [0.410, -0.35],   // S
    [0.440,  0.00],
    [0.620,  0.00],
    [0.700,  0.30],   // T
    [0.780,  0.00],
    [1.000,  0.00],
  ];

  function amplitudeAt(phase) {
    for (var i = 1; i < BEAT.length; i++) {
      if (phase <= BEAT[i][0]) {
        var p0 = BEAT[i - 1], p1 = BEAT[i];
        var span = p1[0] - p0[0];
        if (span <= 0) return p1[1];
        return p0[1] + (p1[1] - p0[1]) * ((phase - p0[0]) / span);
      }
    }
    return 0;
  }

  /* --------------------------------------------------------------------------
   * 3. 小工具
   * ------------------------------------------------------------------------ */

  function isNum(v) {
    return (typeof v === 'number' && isFinite(v));
  }

  // 保留 0 位小数的显示文本；不是有限数就返回 null（页面上显示成占位符）
  function fmt0(v) {
    return isNum(v) ? String(Math.round(v)) : null;
  }

  // 与 patient-card.js 的 fmtBloodPressure() 完全一致：96/62；缺舒张压就只显示收缩压
  function fmtBloodPressure(vitals) {
    var s = fmt0(vitals.sbp);
    if (s === null) return null;
    var d = fmt0(vitals.dbp);
    return d === null ? s : s + '/' + d;
  }

  function bandOf(key, vitals) {
    var spec = VITAL_BANDS[key];
    var v = vitals[key];
    if (!isNum(v)) return null;

    if (v >= spec.normal[0] && v <= spec.normal[1]) return 'normal';
    for (var i = 0; i < spec.watch.length; i++) {
      if (v >= spec.watch[i][0] && v <= spec.watch[i][1]) return 'watch';
    }
    return 'danger';
  }

  function makeEl(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // 报警灯的三档：阈值现读 patient-data.js，别在这儿写死
  function alarmBounds() {
    var rules = window.PatientData && window.PatientData.tierRules;
    var b = rules && rules.bounds;
    return (b && typeof b[0] === 'number' && typeof b[1] === 'number')
             ? b : FALLBACK_BOUNDS;
  }

  /* --------------------------------------------------------------------------
   * 4. 模块状态（闭包变量，不挂 window）
   * ------------------------------------------------------------------------ */

  // 走纸的"起点"。用模块加载时刻而不是每位患者的渲染时刻 ——
  // 换患者时波形是接着走的，不会一顿一顿地重新起头。
  var ORIGIN = (window.performance && performance.now) ? performance.now() : Date.now();

  var state = {
    rafId:   0,
    running: false,
    canvas:  null,
    ctx:     null,
    bps:     1.2,     // 每秒多少个心动周期
    warned:  false,   // "容器不见了"只提醒一次，别刷屏
  };

  function nowSeconds() {
    var t = (window.performance && performance.now) ? performance.now() : Date.now();
    return (t - ORIGIN) / 1000;
  }

  /* --------------------------------------------------------------------------
   * 5. 画一帧波形
   *
   *   横轴 → 时间：最右边那一列是"现在"，往左是"过去"。
   *   x 这一列对应的时间 tt = t - (W - x) / PX_PER_SECOND
   *   相位 phase = tt × (心率/60) 的小数部分
   *   ★ 于是每过一个周期的时间（60 / 心率 秒），整条线恰好向左移动一个周期的宽度。
   * ------------------------------------------------------------------------ */

  function drawFrame(t) {
    var ctx = state.ctx;
    if (!ctx) return;

    var w = state.w;   // CSS 像素（已经按 devicePixelRatio 缩放好了坐标系）
    var h = state.h;
    if (!(w > 0) || !(h > 0)) return;

    ctx.clearRect(0, 0, w, h);

    var baseY = h * 0.70;        // 基线压在偏下的位置：R 波往上冲，S 波往下探
    var scale = h * 0.52;        // 幅值 1.0 → 0.52 × 高度

    var dx       = 1;            // 每 1 个 CSS 像素取一个点，够平滑也够快
    var beatsPs  = state.bps;

    ctx.beginPath();
    for (var x = 0; x <= w; x += dx) {
      var tt    = t - (w - x) / PX_PER_SECOND;
      var phase = ((tt * beatsPs) % 1 + 1) % 1;
      var y     = baseY - amplitudeAt(phase) * scale;
      if (x === 0) ctx.moveTo(x, y);
      else         ctx.lineTo(x, y);
    }

    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';

    /* ★ 光晕 —— 这块面板的灵魂（任务书 §二④）
     *
     * 任务书给的 CSS 是 box-shadow: 0 0 6px var(--c-accent),
     * 0 0 14px rgba(46,211,166,.35)。但 Canvas 里的线条不吃 box-shadow
     * （那会变成给整块画布描一个发光的方框），线条自己的光晕要用
     * shadowBlur / shadowColor 画 —— 视觉上是同一件事，而且光晕是【贴着线】的。
     * 所以这里来两遍，正好对应任务书那两层：先大模糊低透明度的一层，
     * 再小模糊的实色芯线。
     */
    var glow = state.accent;

    ctx.save();
    ctx.shadowColor = 'rgba(46,211,166,.85)';
    ctx.shadowBlur  = 14;
    ctx.lineWidth   = 2.6;
    ctx.strokeStyle = 'rgba(46,211,166,.35)';
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur  = 6;
    ctx.lineWidth   = 1.6;
    ctx.strokeStyle = glow;
    ctx.stroke();
    ctx.restore();
  }

  function tick(ts) {
    if (!state.running) return;
    // rAF 给的是"从页面开始计时起"的毫秒数，和 performance.now() 同源
    drawFrame((ts - ORIGIN) / 1000);
    state.rafId = window.requestAnimationFrame(tick);
  }

  /* --------------------------------------------------------------------------
   * 6. 面板的 DOM
   *    全部走 createElement + textContent —— 患者数据里的文字不会被当成 HTML
   * ------------------------------------------------------------------------ */

  function readoutCell(label, text, unit, band) {
    var cell = makeEl('div', 'monitor-readout');

    cell.appendChild(makeEl('div', 'monitor-readout-label', label));

    // 颜色用 main.css 里和患者卡片同一批的类名（契约 2.4）
    var value = makeEl('div',
      'monitor-readout-value ' + (BAND_CLASS[band] || ''));
    if (!band) value.style.color = 'var(--c-text-dim)';   // 数值缺失：中性灰

    if (text === null) {
      value.textContent = '—';
    } else {
      value.textContent = text;
      if (unit) value.appendChild(makeEl('span', 'monitor-readout-unit', unit));
    }

    cell.appendChild(value);
    return cell;
  }

  function buildPanel(patient) {
    var vitals = patient.vitals || {};

    var panel = makeEl('div', 'monitor-panel');

    // —— 屏幕上那层：报警灯 + 波形
    var screenEl = makeEl('div', 'monitor-screen');

    var alarm = makeEl('span', 'monitor-alarm ' + alarmBand(patient));
    screenEl.appendChild(alarm);

    var canvas = makeEl('canvas', 'monitor-ecg');
    canvas.setAttribute('aria-hidden', 'true');
    screenEl.appendChild(canvas);

    panel.appendChild(screenEl);

    // —— 读数：心率 / 血氧 / 血压（顺序照任务书 §一 的示意图）
    var row = makeEl('div', 'monitor-readouts');
    row.appendChild(readoutCell('心率', fmt0(vitals.hr),   'bpm',  bandOf('hr',   vitals)));
    row.appendChild(readoutCell('血氧', fmt0(vitals.spo2), '%',    bandOf('spo2', vitals)));
    row.appendChild(readoutCell('血压', fmtBloodPressure(vitals), 'mmHg', bandOf('sbp', vitals)));
    panel.appendChild(row);

    return { panel: panel, canvas: canvas };
  }

  // 报警灯的分档名。★ 只看 severity，从不看那位患者的真实答案。
  function alarmBand(patient) {
    var b = alarmBounds();
    var s = patient.severity;
    if (!isNum(s)) return 'normal';        // 拿不到严重度就别报警（中性：常亮绿）
    if (s < b[0]) return 'normal';
    if (s < b[1]) return 'watch';
    return 'danger';
  }

  /* --------------------------------------------------------------------------
   * 7. Canvas 的尺寸
   *
   *   CSS 那边把 .monitor-ecg 的 width / height 定死了（100% / 96px）——
   *   这一条是"布局不跳动"的硬保证：画布高度不随内容变。
   *   这里做的只是按 devicePixelRatio 给位图分配像素，再缩放坐标系，
   *   让高分屏上的线不发虚。位图尺寸不影响布局。
   * ------------------------------------------------------------------------ */

  function sizeCanvas(canvas) {
    var cssW = canvas.clientWidth  || 0;
    var cssH = canvas.clientHeight || 0;

    var dpr = window.devicePixelRatio || 1;
    if (!(dpr > 0)) dpr = 1;

    // 量不到尺寸（jsdom 没有布局引擎）就别折腾，直接放弃画图：
    // DOM 该有的照样有，只是没有波形 —— 不影响任何断言里的 DOM 比较。
    if (!(cssW > 0) || !(cssH > 0)) return null;

    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return null;                 // 没有 2D 上下文（jsdom）：只搭 DOM，不画

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function accentColor() {
    try {
      var v = window.getComputedStyle(document.documentElement)
                     .getPropertyValue('--c-accent');
      v = (v || '').trim();
      if (v) return v;
    } catch (e) { /* 读不到就用兜底色 */ }
    return FALLBACK_ACCENT;
  }

  /* --------------------------------------------------------------------------
   * 8. 出口
   * ------------------------------------------------------------------------ */

  function stop() {
    state.running = false;
    if (state.rafId && window.cancelAnimationFrame) {
      window.cancelAnimationFrame(state.rafId);
    }
    state.rafId = 0;
    state.canvas = null;
    state.ctx = null;
  }

  function render(el, patient, opts) {
    // 先停上一轮循环：同一局里每换一位患者都调一次 render，
    // 不停的话每换一位就多一条 rAF 在跑（任务书 §四）。
    stop();

    if (!el) {
      if (!state.warned) {
        state.warned = true;
        console.warn('[Monitor] 找不到监护仪容器（#monitorPanel），面板不渲染。');
      }
      return;
    }

    el.innerHTML = '';
    if (!patient) return;

    opts = opts || {};

    var built  = buildPanel(patient);
    el.appendChild(built.panel);

    var vitals = patient.vitals || {};
    var hr     = isNum(vitals.hr) ? vitals.hr : FALLBACK_HR;
    state.bps = Math.min(MAX_BPS, Math.max(MIN_BPS, hr / 60));

    var ctx = sizeCanvas(built.canvas);
    state.canvas = built.canvas;
    state.ctx    = ctx;
    state.w       = built.canvas.clientWidth  || 0;
    state.h       = built.canvas.clientHeight || 0;
    state.accent  = accentColor();

    // ★ frozen：画在固定相位 t = 0，且【不启动】动画循环（任务书 §四）。
    //   平时（opts.frozen 不是 true）走下面那支。
    if (opts.frozen === true || typeof window.requestAnimationFrame !== 'function') {
      drawFrame(0);
      return;
    }

    state.running = true;
    state.rafId = window.requestAnimationFrame(tick);
  }

  return {
    render: render,
    stop:   stop,
  };

})();
