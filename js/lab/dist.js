/* ============================================================================
 * js/lab/dist.js —— 实验室面板「两个分布」（M9）
 *   window.LabDist = { render: function (el) {...} }        ← 契约 5.6
 *
 * 【这一屏要证明什么】
 *   SDT 的地基：信号和噪音是两个重叠的正态分布。判定标准 c 是一把刀，
 *   切在哪儿，决定了两块阴影的面积 ——
 *     刀右边、噪音曲线下面的那块 = 误报率 P(FA)（红）
 *     刀左边、信号曲线下面的那块 = 漏报率 P(M)（绿）
 *   下面混淆矩阵的四格，就是这两块阴影的补集。拖 c 只是挪刀，
 *   拖 d′ 才是把两条曲线分开。
 *
 * 【★ 横轴用的是哪把尺子（动手前必须想清楚，否则阴影和数字对不上）】
 *   契约 3.2 里玩家的 severity 轴是「噪音 N(0,1) / 信号 N(d′,1)」，
 *   但这个面板的横轴**不是** severity，而是 c 的尺子（契约 4.5 里 c 的定义）：
 *      c = -0.5 · (z(PH) + z(PFA))       →   在 c 的尺子上，两个分布
 *   对称地落在 −d′/2 和 +d′/2，判定线正好在 x = c。
 *   两把尺子只差一个平移 d′/2，图形一模一样，区别只在刻度标签。
 *
 *   为什么必须选 c 这把：若照 severity 轴把噪音摆到 0、判定线摆到 x = c，
 *   那么 c = 0（契约 3.4 说的"中立标准"，β = 1）时刀会落在噪音的峰上，
 *   P(FA) 应该算出 0.5 —— 可公式给的是 0.227，图和数字当场打架。
 *   选 c 尺子，阴影面积与公式、与 β = exp(c·d′) 三者严格自洽。
 *
 * 【公式出自哪里 · 自己怎么验的】（任务书 M9「混淆矩阵四格」）
 *      P(H)  = 1 − Φ(c − d′/2)
 *      P(FA) = 1 − Φ(c + d′/2)
 *   反着推 z 值： z(PH) = d′/2 − c ， z(PFA) = −d′/2 − c，于是
 *      z(PH) − z(PFA) = d′                              ✓ 契约 4.5 的 dPrime
 *      −0.5·(z(PH) + z(PFA)) = c                        ✓ 契约 4.5 的 c 定义
 *      β = exp(−0.5·(z(PH)² − z(PFA)²)) = exp(c·d′)      ✓ 契约 3.4 的 c_opt = ln β / d′
 *   三条都对上了，说明四条公式和契约是同一套东西（另用 Node 独立验算过，
 *   见汇报：反算 d′/c 与设定值完全一致）。
 *
 *   方向性（任务书要求自查的一点）：c 变大 = 刀右移 → P(H)、P(FA) 同时变小。
 *   ★ 同增同减 —— 这正是"标准只改态度、不改能力"的代数证据：
 *   拖 c 时 z(PH) − z(PFA) 恒等于 d′，所以 β 会动、d′ 一动不动。
 *
 * 【A′ 的分子：任务书原式与标准式不一致，这里按标准式实现】
 *   任务书原式  A′ = 0.5 + sign(PH−PFA)·(PH−PFA)² / (4·max(PH,PFA) − 4·PH·PFA)
 *   标准式（Grier 1971 / Snodgrass & Corwin 1988，分母与上式完全相同）
 *               A′ = 0.5 + sign(PH−PFA)·|PH−PFA|·(1+|PH−PFA|) / (同一个分母)
 *   默认值 d′ = 1.5、c = 0 下：原式 0.625，标准式 0.854，
 *   而等方差双正态 ROC 的面积 Φ(d′/√2) = 0.856，标准式才对得上；
 *   任务书上"应该显示 0.79"那个数两个式子都给不出来。
 *   改动只有一处（见下面 aPrimeOf 里标了 ★ 的那行），要换回去一行的事。
 *
 * 【依赖】契约 5.4 的 Utils（ncdf / npdf / zScore / clamp）、5.5 的 Chart。
 *   所有分布计算一律走 Utils，本文件不自己实现 Φ 或 z。
 * ==========================================================================*/

window.LabDist = (function () {
  'use strict';

  /* ---------------------------------------------------------------- 常量 */

  var DEF_D   = 1.5;    // 契约 3.4：三轮的系统 d′
  var DEF_C   = 0;      // 契约 3.4：第一轮的理论最优标准
  var VIEW    = 4;      // 横轴视野半宽（c 单位）—— 够放下 ±2 的滑块范围还有余
  var SAMPLES = 240;    // 曲线采样点数

  /* -------------------------------------------------------------- 公式层 */

  // 击中率 / 误报率：判定线右侧的尾部面积。推导见文件头。
  function pHit(d, c) { return 1 - Utils.ncdf(c - d / 2); }
  function pFA(d, c)  { return 1 - Utils.ncdf(c + d / 2); }

  // 似然比判据 β（契约 4.5 的式子，恒等于 exp(c·d′)）
  function betaOf(d, c) {
    var zH = Utils.zScore(pHit(d, c));
    var zF = Utils.zScore(pFA(d, c));
    return Math.exp(-0.5 * (zH * zH - zF * zF));
  }

  // A′ —— 非参数 ROC 面积。分母用任务书的写法，分子用标准式的 |D|·(1+|D|)。
  function aPrimeOf(ph, pf) {
    var D = ph - pf;
    var denom = 4 * Math.max(ph, pf) - 4 * ph * pf;   // 退化（d′=0）时 D = 0，下面直接给 0.5
    if (denom <= 0) return 0.5;
    return 0.5 + (D >= 0 ? 1 : -1) * Math.abs(D) * (1 + Math.abs(D)) / denom;   // ★ 分子
  }

  // β 的中文说法（契约 3.4：β > 1 更保守、β < 1 更宽松）
  function betaWord(beta) {
    if (beta > 1.005) return '偏严格 → 更少说「要急诊」';
    if (beta < 0.995) return '偏宽松 → 更多说「要急诊」';
    return '中立';
  }

  /* ------------------------------------------------------------ HTML 片段 */

  function sliderRow(id, cls, label, min, max, step, val, hint) {
    return '<div style="display:flex;align-items:center;gap:12px;margin:14px 0 4px;">' +
             '<label for="' + id + '" style="flex:0 0 6.5em;font-size:0.9rem;color:var(--c-text-dim);">' +
               label + '</label>' +
             '<input id="' + id + '" class="' + cls + '" type="range" min="' + min + '" max="' + max +
               '" step="' + step + '" value="' + val + '"' +
               ' style="flex:1 1 auto;min-width:0;accent-color:var(--c-primary);">' +
             '<span class="' + cls + '-val"' +
               ' style="flex:0 0 3.6em;text-align:right;font-family:var(--font-mono);font-size:1rem;">' +
               Number(val).toFixed(2) + '</span>' +
           '</div>' +
           (hint ? '<p style="margin:0;padding-left:calc(6.5em + 12px);font-size:0.78rem;' +
                   'color:var(--c-text-dim);">' + hint + '</p>' : '');
  }

  // SDT 指标的小方块
  function metricBox(label, cls, color, hint) {
    return '<div style="background:var(--c-surface-2);border-radius:var(--radius-sm);padding:10px 12px;">' +
             '<div style="font-size:0.78rem;color:var(--c-text-dim);">' + label + '</div>' +
             '<div class="' + cls + '" style="font-family:var(--font-mono);font-size:1.3rem;' +
               'color:var(' + color + ');">—</div>' +
             '<div style="font-size:0.72rem;color:var(--c-text-dim);line-height:1.35;">' + hint + '</div>' +
           '</div>';
  }

  /* -------------------------------------------------------------- render */

  function render(el) {
    var state = { d: DEF_D, c: DEF_C };
    var inst  = null;         // 主图实例（★ 只在 render 里建，见契约 5.6）

    el.innerHTML = [
      /* — 控件 — */
      '<div class="card">',
      '  <div class="card-head">拖动滑块 · 两个分布与判定标准</div>',
      sliderRow('lab-dist-d', 'lab-dist-sld-d', '敏感性 d′', 0, 4, 0.1, DEF_D,
                'd′ 越大，两条曲线分得越开 —— 这是"能力"。'),
      sliderRow('lab-dist-c', 'lab-dist-sld-c', '判定标准 c', -2, 2, 0.05, DEF_C,
                'c 越大 = 刀越靠右 = 越保守 —— 这是"态度"，它不动 d′，只动 β。'),
      '</div>',

      /* — 主图 — */
      '<div class="card">',
      '  <div class="card-head">噪音与信号两个分布 · 判定线切在哪儿</div>',
      '  <div class="chart lab-dist-chart"></div>',
      '  <p style="margin:10px 0 0;font-size:0.82rem;color:var(--c-text-dim);line-height:1.6;">',
      '    横轴是判定标准 c 的尺子：噪音分布在 −d′/2、信号分布在 +d′/2，两峰相距 d′。<br>',
      '    <span style="color:var(--c-danger);">■ 红色阴影 = 误报率 P(FA)</span>（刀右边、噪音那一片）· ',
      '    <span style="color:var(--c-accent);">■ 绿色阴影 = 漏报率 P(M)</span>（刀左边、信号那一片）。',
      '  </p>',
      '</div>',

      /* — 混淆矩阵 + SDT 指标，左右并排 — */
      '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:stretch;">',

      '  <div class="card" style="flex:1 1 320px;min-width:0;">',
      '    <div class="card-head">混淆矩阵 · 理想观察者会得到</div>',
      '    <table class="cm-table">',
      '      <thead><tr><th></th><th>实际有信号</th><th>实际无信号</th></tr></thead>',
      '      <tbody>',
      '        <tr><td>说「有」</td>' +
                 '<td class="lab-dist-cm-h">H = —</td>' +
                 '<td class="lab-dist-cm-fa">FA = —</td></tr>',
      '        <tr><td>说「无」</td>' +
                 '<td class="lab-dist-cm-m">M = —</td>' +
                 '<td class="lab-dist-cm-cr">CR = —</td></tr>',
      '      </tbody>',
      '    </table>',
      '    <p style="margin:0;font-size:0.8rem;color:var(--c-text-dim);line-height:1.6;">',
      '      这四格是从当前 d′ 和 c 反算出来的期望比例（P(S) = 0.5）。<br>',
      '      H + M = 1，FA + CR = 1。',
      '    </p>',
      '  </div>',

      '  <div class="card" style="flex:1 1 320px;min-width:0;">',
      '    <div class="card-head">SDT 指标</div>',
      '    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">',
      metricBox('敏感性 d′', 'lab-dist-v-d', '--c-primary', '两条曲线分开的程度'),
      metricBox('似然比判据 β', 'lab-dist-v-beta', '--c-accent', '&gt; 1 严格 · &lt; 1 宽松'),
      metricBox('判定标准 c', 'lab-dist-v-c', '--c-primary', '刀的位置'),
      metricBox('非参数面积 A′', 'lab-dist-v-ap', '--c-accent', '0.5 = 随机 · 1.0 = 完美'),
      '    </div>',
      '  </div>',

      '</div>',

      /* — 一句话解读 — */
      '<div class="card">',
      '  <div class="card-head">一句话记住</div>',
      '  <p style="margin-bottom:8px;">d′ 越大，两个分布分得越开。β &gt; 1 = 严格，β &lt; 1 = 宽松。</p>',
      '  <p style="margin-bottom:0;"><strong>同一个 d′ 下，改变标准只会改 β 和 c，不会改 d′。</strong></p>',
      '  <p class="lab-dist-readout" style="margin:12px 0 0;font-family:var(--font-mono);' +
           'font-size:0.88rem;color:var(--c-text-dim);line-height:1.7;">—</p>',
      '</div>',
    ].join('\n');

    var dSld = el.querySelector('.lab-dist-sld-d');
    var cSld = el.querySelector('.lab-dist-sld-c');

    /* ------------------------------------------------------- 图的配置 */

    function buildOption(d, c) {
      var C = Chart.color();
      // Chart.make 会把 Chart.base() 的主题和我们这份 option 做【深】合并
      // （chart.js 第 2 节），所以下面只写自己要改的键 —— 提示框底色、轴的字号
      // 和颜色、字体那一份都会自动留着。

      // 采样点：把判定线 c 精确插进数组，阴影的下边界才正好压在判定线上
      var lo = -(VIEW + d / 2), hi = VIEW + d / 2;
      var stepX = (hi - lo) / SAMPLES;
      var xs = [], i, x;
      for (i = 0; i <= SAMPLES; i++) xs.push(lo + i * stepX);
      for (i = 0; i < xs.length; i++) {
        if (Math.abs(xs[i] - c) < stepX / 2) { xs[i] = c; break; }
      }

      var noiseLine = [], signalLine = [], noiseFill = [], signalFill = [];
      for (i = 0; i < xs.length; i++) {
        x = xs[i];
        var dn = Utils.npdf(x, -d / 2, 1);   // ★ 分布一律调 Utils.npdf
        var ds = Utils.npdf(x, d / 2, 1);
        noiseLine.push([x, dn]);
        signalLine.push([x, ds]);
        noiseFill.push([x, x >= c ? dn : null]);    // 刀右边：误报那一片
        signalFill.push([x, x <= c ? ds : null]);   // 刀左边：漏报那一片
      }

      return {
        grid: { left: 58, right: 24, top: 40, bottom: 52 },
        // 主题只给了 legend.textStyle，没给位置；不管位置的话 ECharts 会把图例摆到
        // 图的【下缘】，正好压住 x 轴刻度。所以这里必须给一个 top。
        legend: { data: ['噪音分布', '信号分布'], top: 0 },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'line' },
          formatter: function (params) {
            if (!params || !params.length) return '';
            var v = params[0].axisValue;
            if (typeof v !== 'number') return '';
            var side = (v >= c)
              ? '<span style="opacity:.75;">判定线右侧 · 噪音这一段计入 P(FA)</span>'
              : '<span style="opacity:.75;">判定线左侧 · 信号这一段计入 P(M)</span>';
            return 'x = ' + v.toFixed(2) + '<br>' +
                   '噪音密度 ' + Utils.npdf(v, -d / 2, 1).toFixed(4) + '<br>' +
                   '信号密度 ' + Utils.npdf(v, d / 2, 1).toFixed(4) + '<br>' + side;
          },
        },
        xAxis: {
          type: 'value', min: lo, max: hi,
          name: '判定标准 c', nameLocation: 'middle', nameGap: 28,
          axisLabel: { formatter: function (v) { return Number(v).toFixed(1); } },
        },
        yAxis: {
          type: 'value', min: 0,
          // ★ nameLocation 必须显式写 'middle'：默认的 'end' 会把轴名摆到顶端正中间，
          //   正好和图例撞在一起（实测截图确认过）。'middle' 是贴着轴竖排，不会打架。
          name: '概率密度', nameLocation: 'middle', nameGap: 42,
          axisLabel: { formatter: function (v) { return Number(v).toFixed(2); } },
        },
        series: [
          // 两块阴影先画（z 小 = 压在下面），曲线盖在上面
          {
            id: 'fill-noise', type: 'line', data: noiseFill, symbol: 'none', silent: true, z: 1,
            lineStyle: { width: 0 },
            areaStyle: { color: C.danger, opacity: 0.32 },
          },
          {
            id: 'fill-signal', type: 'line', data: signalFill, symbol: 'none', silent: true, z: 1,
            lineStyle: { width: 0 },
            areaStyle: { color: C.accent, opacity: 0.32 },
          },
          {
            id: 'noise', name: '噪音分布', type: 'line', data: noiseLine,
            symbol: 'none', z: 3, lineStyle: { color: C.danger, width: 2 },
            itemStyle: { color: C.danger },
            markLine: {
              silent: true, symbol: 'none', z: 4,
              data: [{ xAxis: c }],
              lineStyle: { color: C.text, width: 2, type: 'solid' },
              label: {
                formatter: '判定线 c = ' + c.toFixed(2),
                // ★ 判定线是竖的，ECharts 默认会把标签【竖着】贴着线画，直接压在图例和
                //   曲线上（实测截图确认过）。改成"贴着 x 轴、横排"才不挡东西。
                position: 'insideStartTop', rotate: 0,
                color: C.text, fontSize: 11,
              },
            },
          },
          {
            id: 'signal', name: '信号分布', type: 'line', data: signalLine,
            symbol: 'none', z: 3, lineStyle: { color: C.accent, width: 2 },
            itemStyle: { color: C.accent },
          },
        ],
      };
    }

    /* ----------------------------------------------------------- 刷新 */

    function setCell(cls, label, p) {
      var cell = el.querySelector('.' + cls);
      if (!cell) return;
      cell.innerHTML = label + ' = <span style="font-family:var(--font-mono);">' +
        p.toFixed(3) + '</span><span style="color:var(--c-text-dim);font-size:0.85em;"> ' +
        (p * 100).toFixed(1) + '%</span>';
    }

    function sync() {
      var d = state.d, c = state.c;
      var ph = pHit(d, c), pf = pFA(d, c);
      var beta = betaOf(d, c), ap = aPrimeOf(ph, pf);

      el.querySelector('.lab-dist-sld-d-val').textContent = d.toFixed(2);
      el.querySelector('.lab-dist-sld-c-val').textContent = c.toFixed(2);

      setCell('lab-dist-cm-h',  'H',  ph);
      setCell('lab-dist-cm-fa', 'FA', pf);
      setCell('lab-dist-cm-m',  'M',  1 - ph);
      setCell('lab-dist-cm-cr', 'CR', 1 - pf);

      el.querySelector('.lab-dist-v-d').textContent     = d.toFixed(2);
      el.querySelector('.lab-dist-v-beta').textContent  = beta.toFixed(2);
      el.querySelector('.lab-dist-v-c').textContent     = c.toFixed(2);
      el.querySelector('.lab-dist-v-ap').textContent    = ap.toFixed(2);

      el.querySelector('.lab-dist-readout').textContent =
        '当前：d′ = ' + d.toFixed(2) + '（拖 c 时这个数一动不动）· c = ' + c.toFixed(2) +
        ' → β = ' + beta.toFixed(2) + '（' + betaWord(beta) + '）· A′ = ' + ap.toFixed(2);

      if (inst) inst.setOption(buildOption(d, c));
    }

    /* --------------------------------------------------------- 事件绑定 */

    function onSlide() {
      // 滑块收值走 Utils.clamp（任务书通用要求）
      state.d = Utils.clamp(parseFloat(dSld.value), 0, 4);
      state.c = Utils.clamp(parseFloat(cSld.value), -2, 2);
      sync();
    }

    dSld.addEventListener('input', onSlide);
    cSld.addEventListener('input', onSlide);

    // ★ 建图：容器此刻已经可见（契约 5.6：render 由 showLab 在第一次显示时调用）
    inst = Chart.make(el.querySelector('.lab-dist-chart'), buildOption(state.d, state.c));
    sync();
  }

  return { render: render };

})();
