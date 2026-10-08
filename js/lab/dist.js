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
 * 【这一屏画的是模型，不是你的成绩】
 *   两条曲线是按 d′ 现画的【理论模型】（契约 3.2），不读患者数据；实测的 d′ 只有
 *   玩完三轮之后才有 —— 所以页面上给了一条"你自己实测的 d′"（读 Store.rounds，
 *   契约 5.3），点一下就把滑块跳到你的值，这一屏才和"我玩的那一局"接上。
 *
 * 【依赖】契约 5.4 的 Utils（ncdf / npdf / zScore / clamp）、5.5 的 Chart、
 *   5.3 的 Store（只读 rounds，缺了也不报错）。
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

  /* ------------------------------------------------- 连回玩家自己的数据
   *
   * 【为什么要有这一段】
   *   这一屏画的是【理论模型】（两条正态分布），契约定的分工就是不读患者数据。
   *   但玩家刚跑完三轮、他自己实测的 d′ 就躺在 Store.rounds 里（契约 5.3 / 4.3），
   *   面板一个字都不提 —— 玩家就会以为这一屏在展示某个"标准状态"。
   *   所以给他三个按钮：点一下就把上面的 d′ 滑块跳到他自己的那个值。
   *
   * 【边界】
   *   · Store 不存在 / rounds 为空（游客、直接进实验室）→ 只给一句提示，不报错
   *   · 实测 d′ 可能为负（pH < pFA），而滑块只有 0~4 → 夹进范围，并说明夹到了哪边
   */
  var MY_NAMES = ['第一轮', '第二轮', '第三轮'];

  // 两位小数，减号用 U+2212（−）—— 和结果页 / ROC 面板的写法一致
  function fmt2(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '—';
    return (Math.round(v * 100) / 100).toFixed(2).replace('-', '−');
  }

  // 从 Store.rounds 里取玩家自己三轮的 d′（缺的、不是数的就跳过）
  function readMyRounds() {
    var out = [];
    var rounds = (window.Store && window.Store.rounds) ? window.Store.rounds : null;
    if (!rounds || !rounds.length) return out;
    for (var i = 0; i < rounds.length && i < MY_NAMES.length; i++) {
      var m = rounds[i] && rounds[i].metrics;
      if (!m || typeof m.dPrime !== 'number' || !isFinite(m.dPrime)) continue;
      out.push({ name: MY_NAMES[i], dPrime: m.dPrime });
    }
    return out;
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

    // 玩家上一局自己三轮的实测 d′（读 Store.rounds；没玩过就是空数组）
    var my = readMyRounds();
    var myBlock;
    if (my.length) {
      myBlock = [
        '  <p style="margin:0 0 10px;font-size:0.85rem;color:var(--c-text-dim);line-height:1.6;">',
        '    这是你上一局三轮各自实测的 d′。点一下，就把上面的 d′ 滑块跳到那个值。',
        '  </p>',
        '  <div class="btn-row lab-dist-my-btns">',
        my.map(function (r, i) {
          return '<button class="btn btn-ghost" data-my-round="' + i + '">' +
                 r.name + ' ' + fmt2(r.dPrime) + '</button>';
        }).join(''),
        '  </div>',
        // 实测 d′ 超出滑块范围时，那句话写在这里（见下面的点击逻辑）
        '  <p class="lab-dist-my-note" style="margin:10px 0 0;font-size:0.82rem;' +
          'color:var(--c-watch);line-height:1.6;"></p>',
      ].join('\n');
    } else {
      myBlock = [
        '  <p style="margin:0;font-size:0.85rem;color:var(--c-text-dim);line-height:1.6;">',
        '    玩完三轮再回来看，这里会标出你自己实测的 d′。',
        '  </p>',
      ].join('\n');
    }

    el.innerHTML = [
      /* — 控件 — */
      '<div class="card">',
      '  <div class="card-head">拖动滑块 · 两个分布与判定标准</div>',
      sliderRow('lab-dist-d', 'lab-dist-sld-d', '敏感性 d′', 0, 4, 0.1, DEF_D,
                'd′ 越大，两条曲线分得越开 —— 这是"能力"。'),
      sliderRow('lab-dist-c', 'lab-dist-sld-c', '判定标准 c', -2, 2, 0.05, DEF_C,
                'c 越大 = 判定线越靠右 = 越保守 —— 这是"态度"，它不动 d′，只动 β。'),
      '</div>',

      /* — 把这一屏和玩家刚跑完的那一局接上 — */
      '<div class="card">',
      '  <div class="card-head">你自己实测的 d′（上一局）</div>',
      myBlock,
      '</div>',

      /* — 主图 — */
      '<div class="card">',
      '  <div class="card-head">噪音与信号两个分布 · 判定线切在哪儿</div>',
      '  <div class="chart lab-dist-chart"></div>',
      /* 图上两块阴影的说明：★ 这里只说了一件事 —— "那块面积意味着什么"。
         原来写的是"（刀右边、噪音那一片）"：只说位置、不说意思，
         不懂 SDT 的人读完还是不知道误报率到底是什么；
         而且同一个东西在这张卡片里被叫成"刀 / 判定线 / 判定标准 c"三个名字。
         现在：名字统一成【判定线】（比喻只在上面那句里用一次），
         每条说明都补上"你却判成了什么"。 */
      '  <p style="margin:10px 0 0;font-size:0.82rem;color:var(--c-text-dim);line-height:1.6;">',
      '    想象你在两条曲线重叠的地方切下去 —— 切在哪儿由 c 决定，那一条线就是<b>判定线</b>。<br>',
      /* ★ 这句原来写的是"噪音分布在 −d′/2、信号分布在 +d′/2，两峰相距 d′"：
         · −d′/2 / +d′/2 是【实现细节】—— 选这个刻度只是为了让判定线落在 x = c、
           β = exp(c·d′) 干净，玩家不需要知道；
         · "两峰相距 d′"是同义反复 —— 峰就定义在 ∓d′/2，相距当然是 d′，
           读起来像信息，其实什么都没说；
         · 而且没说清这一屏是【理论模型】、曲线间距是可以拖的，玩家会以为
           这里画的是某个"标准状态"、固定不变。
         现在：说清是模型、说清间距就是 d′ 且能拖。 */
      '    横轴是判定标准 c 的尺子。<br>',
      '    这是<b>理论模型</b>：两条曲线的横向间距就是 d′ —— 拖上面的滑块就能看到它变。',
      '  </p>',
      '  <p style="margin:8px 0 0;font-size:0.82rem;line-height:1.7;">',
      '    <span style="color:var(--c-danger);">■ 红色阴影的面积 = 误报率 P(FA)</span><br>',
      '    <span style="color:var(--c-text-dim);">判定线<b>右</b>侧的噪音 —— 其实没有信号，你却判成了「有」。</span>',
      '  </p>',
      '  <p style="margin:6px 0 0;font-size:0.82rem;line-height:1.7;">',
      '    <span style="color:var(--c-accent);">■ 绿色阴影的面积 = 漏报率 P(M)</span><br>',
      '    <span style="color:var(--c-text-dim);">判定线<b>左</b>侧的信号 —— 真的有信号，你却判成了「无」。</span>',
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
      metricBox('判定标准 c', 'lab-dist-v-c', '--c-primary', '判定线在哪'),
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

    /* ---- "你自己实测的 d′" 那几个按钮 ----
       点了就把 d′ 滑块跳到那个值：改 state → 改滑块 DOM → sync() 重画。
       ★ 三步缺一不可：只改 DOM 不改 state 的话，下一次拖 c 会把 d′ 打回原值；
         改了 state 不 sync() 的话，图不跟着变 —— 那就是个假按钮。
       ★ 滑块只有 0~4，而实测 d′ 可能为负（pH < pFA）——夹进去并说明，
         不然玩家点了按钮看见滑块不动，会以为按钮坏了。 */
    var myBtns = el.querySelectorAll('.lab-dist-my-btns button');
    var myNote = el.querySelector('.lab-dist-my-note');
    for (var b = 0; b < myBtns.length; b++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var r = my[parseInt(btn.getAttribute('data-my-round'), 10)];
          if (!r) return;

          var v = Utils.clamp(r.dPrime, 0, 4);
          if (myNote) {
            myNote.textContent = (Math.abs(v - r.dPrime) > 1e-9)
              ? '你的' + r.name + '实测 d′ 是 ' + fmt2(r.dPrime) +
                '，超出了滑块范围（0 ~ 4），已夹到最' + (r.dPrime < 0 ? '左' : '右') + '边。'
              : '';
          }

          state.d = v;
          dSld.value = v;
          sync();
        });
      })(myBtns[b]);
    }

    // ★ 建图：容器此刻已经可见（契约 5.6：render 由 showLab 在第一次显示时调用）
    inst = Chart.make(el.querySelector('.lab-dist-chart'), buildOption(state.d, state.c));
    sync();
  }

  return { render: render };

})();
