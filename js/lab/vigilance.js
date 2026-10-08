/* ============================================================================
 * js/lab/vigilance.js —— 面板「警觉衰退模拟」（M12）
 *
 * 【要证明的事】（契约 5.0）
 *   d′ 也会变 —— 但那是疲劳，不是代价。
 *
 * M11 证明的是「c 会被代价推动」，这个面板证明的是「d′ 会被疲劳压低」。
 * 两个放在一起，d′ 和 c 是两个独立维度这件事才算讲透：
 *   · 只勾「敏感性下降」→ d′ 一路走低，c 基本不动
 *   · 只勾「标准偏移」  → c 一路走高，d′ 基本不动
 *
 * 【为什么每点一次结果都不一样】
 *   每个时段的 H / FA 不是画出来的，是从这个时段设定的 d′、c 用二项分布
 *   采样出来的。只有 30 / 270 个试次，所以反算回来的 d′、c 永远带着抽样噪声。
 *   ——这正是要展示的东西：「你看到的实测值，永远带着噪声。」
 *
 * 接口见契约 5.6：window.LabVigilance = { render: function (el) {...} }
 * ==========================================================================*/

window.LabVigilance = (function () {
  'use strict';

  /* --------------------------------------------------------------------------
   * 0. 场景参数（任务书 M12 指定）
   * ------------------------------------------------------------------------ */

  var D_PRIME  = window.D_PRIME;   // 1.5 —— 起始敏感性从 config.js 读，不写死
  var N_SLOT   = 8;                // 8 个 15 分钟时段 = 2 小时（Mackworth 钟实验原版的时长）
  var N_SIGNAL = 30;               // 每个时段的信号数
  var N_NOISE  = 270;              // 每个时段的噪音事件数
  var MIN_SLOT = 15;               // 一个时段多少分钟（只用于文案）

  var RATE_D = 0.06;               // 敏感性下降：d′_t = d′ × (1 − 0.06 t)
  var RATE_C = 0.09;               // 标准偏移：  c_t = 0 + 0.09 t

  var inst = null;                 // ECharts 实例
  var dom  = {};
  var lastRows = [];               // 最近一次采样的逐时段结果（悬停提示要用）

  /* --------------------------------------------------------------------------
   * 1. 采样
   * ------------------------------------------------------------------------ */

  // Binomial(n, p)：n 次 Utils.rand01(rng) < p 累加（任务书指定，别用 randN）
  function binomial(n, p, rng) {
    var k = 0;
    for (var i = 0; i < n; i++) {
      if (Utils.rand01(rng) < p) k++;
    }
    return k;
  }

  /* 跑一次模拟：8 个时段，每个时段采样一次，再按契约 4.5 反算实测 d′ / c。
     不传固定种子 —— 每次点击都要给出不一样的结果，这是这个面板的教学点。 */
  function simulate(sens, shift) {
    var rng = { next: Math.random };
    var rows = [];

    for (var t = 0; t < N_SLOT; t++) {
      // ① 这个时段「设定」的 d′ 和 c —— 只有勾了对应的框才随时间变
      var dSet = sens  ? D_PRIME * (1 - RATE_D * t) : D_PRIME;
      var cSet = shift ? RATE_C * t : 0;

      // ② 由 SDT 模型推出击中率 / 误报率
      var pH  = 1 - Utils.ncdf(cSet - dSet / 2);
      var pFA = 1 - Utils.ncdf(cSet + dSet / 2);

      // ③ 采样：30 个信号里击中几个、270 个噪音里误报几个
      var H  = binomial(N_SIGNAL, pH,  rng);
      var FA = binomial(N_NOISE,  pFA, rng);

      // ④ 反算实测值。对数线性修正（契约 4.5，Hautus 1995）必须用：
      //    H = 0 或 FA = 270 时不做修正，zScore 会返回 ±Infinity，整页数据全废
      var zH = Utils.zScore((H  + 0.5) / (N_SIGNAL + 1));
      var zFA = Utils.zScore((FA + 0.5) / (N_NOISE  + 1));

      rows.push({
        dPrime: zH - zFA,          // 实测敏感性
        c: -0.5 * (zH + zFA),      // 实测标准
        H: H,
        FA: FA
      });
    }
    return rows;
  }

  // 带符号的两位小数：+0.54 / -0.18 / 0.00
  function f2s(x) {
    if (!isFinite(x)) return '—';
    var s = x.toFixed(2);
    if (s === '0.00' || s === '-0.00') return '0.00';
    return (x > 0 ? '+' : '') + s;
  }

  /* ==========================================================================
   * 2. render
   * ======================================================================== */

  function render(el) {

    /* ------------------------------------------------------------------
     * 2.1 结构
     * ---------------------------------------------------------------- */

    var checkStyle =
      'display:flex;gap:10px;align-items:flex-start;margin-top:10px;cursor:pointer;';

    // 复选框 + 说明（样式行内的原因同 M11：main.css 还没有表单控件样式）
    function checkbox(id, label, desc) {
      return '<label for="' + id + '" style="' + checkStyle + '">' +
               '<input type="checkbox" id="' + id + '" checked' +
                      ' style="margin-top:5px;accent-color:var(--c-primary);">' +
               '<span style="flex:1;">' +
                 '<span style="display:block;color:var(--c-text);">' + label + '</span>' +
                 '<span style="display:block;font-size:0.85rem;color:var(--c-text-dim);">' +
                   desc + '</span>' +
               '</span>' +
             '</label>';
    }

    // 一张机制说明卡
    function mechCard(title, items) {
      return '<div class="card" style="flex:1 1 250px;margin-bottom:0;">' +
               '<div class="card-head">' + title + '</div>' +
               items.map(function (s) {
                 return '<p style="font-size:0.88rem;line-height:1.8;' +
                        'color:var(--c-text-dim);">· ' + s + '</p>';
               }).join('') +
             '</div>';
    }

    el.innerHTML = [
      // ★ 时长必须和面板自己的设定一致：8 个 15 分钟时段 = 2 小时。
      //   这里原来写的时长跟下面那行「8 个 15 分钟时段」当场打架。
      '<p class="placeholder">急诊分诊员值夜班 —— 持续盯着分诊台 2 小时会发生什么？</p>',
      '<p class="placeholder">模拟 Mackworth 钟实验：' + N_SLOT + ' 个 ' + MIN_SLOT +
        ' 分钟时段，每时段 ' + N_SIGNAL + ' 个信号 + ' + N_NOISE + ' 个噪音事件。</p>',

      // —— 控制 ——
      '<div class="card">',
      '  <div class="card-head">让哪个机制起作用</div>',
             checkbox('vgSens',  '敏感性下降', 'd′ 随时间降低 —— 唤醒 / 资源理论'),
             checkbox('vgShift', '标准偏移',   'c 随时间升高 —— 期望理论'),
      '  <div style="margin-top:16px;">',
      '    <button class="btn btn-primary" id="vgRun">开始模拟</button>',
      '  </div>',
      '  <p style="margin-top:12px;font-size:0.82rem;color:var(--c-text-dim);">' +
        '每点一次结果都不一样：每个时段的 H 和 FA 都是按该时段设定的 d′、c ' +
        '<b>采样</b>出来的（30 个信号、270 个噪音，二项分布），不是一条预设曲线。</p>',
      '</div>',

      // —— 图 ——
      '<div class="card">',
      '  <div class="card-head">实测 d′ 与实测 c 的走势</div>',
      '  <p style="font-size:0.82rem;color:var(--c-text-dim);margin-bottom:8px;">' +
        '横轴：' + N_SLOT + ' 个时段（每段 ' + MIN_SLOT + ' 分钟）　左轴：实测 d′　右轴：实测 c</p>',
      '  <div class="chart" id="vgChart"></div>',
      '  <p id="vgState" style="margin-top:10px;font-size:0.82rem;' +
        'color:var(--c-text-dim);">—</p>',
      '</div>',

      // —— 解释 ——
      '<div class="card">',
      '  <div class="card-head">怎么读这张图</div>',
      '  <p style="margin-bottom:8px;">只勾「敏感性下降」→ ' +
           '<b>d′ 一路走低</b>，c 基本不动。</p>',
      '  <p style="margin-bottom:8px;">只勾「标准偏移」→ ' +
           '<b>c 一路走高</b>，d′ 基本不动。</p>',
      '  <p style="margin-bottom:8px;">都勾上 → 两个一起动。</p>',
      '  <p>把两个都关掉，再点几次「开始模拟」—— ' +
           '<b>你会看到一条上下抖动的水平线。那不是在变化，那是抽样噪声。</b>' +
           '真实实验里这两件事很容易搞混。</p>',
      '</div>',

      // —— 两张机制卡 + 阻止技术 ——
      '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px;">',
             mechCard('敏感性下降（d′ 降低）', [
               '唤醒理论（Welford）：长期没有事件 → 唤醒水平下降 → 两个分布靠拢',
               '维持需求理论（Warm）：持续注意消耗认知资源 → 资源耗竭'
             ]),
             mechCard('标准偏移（β 升高）', [
               '期望理论（Baker）：漏掉信号 → 主观 P(S) 下降 → 调高 β → ' +
               '更多漏报 → 恶性循环'
             ]),
      '</div>',

      '<div class="card">',
      '  <div class="card-head">阻止技术 —— 怎么让衰退慢一点</div>',
      '  <p style="font-size:0.88rem;line-height:1.8;color:var(--c-text-dim);">' +
        '目标样例 · 降低事件率 · 培训 · 休息 · 结果反馈 · 虚假信号 · ' +
        '置信水平报告 · 间歇的第二任务</p>',
      '</div>',
    ].join('\n');

    /* ------------------------------------------------------------------
     * 2.2 取节点
     * ---------------------------------------------------------------- */

    dom.chart = el.querySelector('#vgChart');
    dom.sens  = el.querySelector('#vgSens');
    dom.shift = el.querySelector('#vgShift');
    dom.run   = el.querySelector('#vgRun');
    dom.state = el.querySelector('#vgState');

    /* ------------------------------------------------------------------
     * 2.3 图表配置
     * ---------------------------------------------------------------- */

    // 悬停提示：时段 + 实测 d′ + 实测 c + H + FA
    function tooltipText(params) {
      if (!params || !params.length) return '';
      var i = params[0].dataIndex;
      var r = lastRows[i];
      if (!r) return '';
      var from = i * MIN_SLOT, to = (i + 1) * MIN_SLOT;
      return '时段 ' + (i + 1) + '（' + from + '–' + to + ' 分钟）' +
             '<br>实测 d′：' + r.dPrime.toFixed(2) +
             '<br>实测 c：' + f2s(r.c) +
             '<br>H：' + r.H + ' / ' + N_SIGNAL +
             '<br>FA：' + r.FA + ' / ' + N_NOISE;
    }

    function chartOption(rows) {
      var c = Chart.color();

      var xs = [], ds = [], cs = [];
      for (var i = 0; i < rows.length; i++) {
        xs.push(String(i + 1));
        ds.push(rows[i].dPrime);
        cs.push(rows[i].c);
      }

      return {
        legend: { top: 4 },
        // 双 Y 轴要留出右边的轴和标签，图例在上方
        grid: { top: 56, right: 48 },

        tooltip: { trigger: 'axis', formatter: tooltipText },

        xAxis: { type: 'category', data: xs },

        /* ★ 两根轴都写死范围，不跟着数据自动缩放。
           否则每点一次「开始模拟」，轴的范围都会变，
           两次结果就没法比 —— 而「再点几次看抖动」正是这个面板的用法。
           范围按设定值的可能区间定：d′ 从 1.5 降到 0.87（再留出抽样噪声），
           c 从 0 升到 0.63。 */
        yAxis: [
          {
            type: 'value', min: -0.5, max: 2.5, minInterval: 0.5,
            axisLabel: { formatter: function (v) { return v.toFixed(1); } }
          },
          {
            type: 'value', min: -1, max: 1, minInterval: 0.5,
            splitLine: { show: false },   // 网格线只画一套，两套太乱
            axisLabel: { formatter: function (v) { return v.toFixed(1); } }
          }
        ],

        series: [
          {
            name: '实测 d′（左轴）',
            type: 'line',
            yAxisIndex: 0,
            data: ds,
            symbolSize: 7,
            lineStyle: { width: 2, color: c.accent },
            itemStyle: { color: c.accent }
          },
          {
            name: '实测 c（右轴）',
            type: 'line',
            yAxisIndex: 1,
            data: cs,
            symbol: 'diamond',
            symbolSize: 9,
            lineStyle: { width: 2, color: c.watch },
            itemStyle: { color: c.watch }
          }
        ]
      };
    }

    /* ------------------------------------------------------------------
     * 2.4 跑一次
     * ---------------------------------------------------------------- */

    function run() {
      var sens  = !!dom.sens.checked;
      var shift = !!dom.shift.checked;

      lastRows = simulate(sens, shift);

      var opt = chartOption(lastRows);
      if (!inst) inst = Chart.make(dom.chart, opt);      // ★ 只在 render 里建图
      else       inst.setOption(Chart.base(opt), true);

      // 说清楚这一遍是哪两个机制在起作用 —— 下次对比时才不会记错
      dom.state.textContent = '本次模拟：敏感性下降 ' + (sens ? '✓' : '✗') +
                              '　标准偏移 ' + (shift ? '✓' : '✗');
      dom.run.textContent = '再模拟一次';
    }

    dom.run.addEventListener('click', run);

    /* ------------------------------------------------------------------
     * 2.5 开张：先跑一遍，面板一打开就有图（不是空白）
     * ---------------------------------------------------------------- */

    run();
  }

  return { render: render };
})();
