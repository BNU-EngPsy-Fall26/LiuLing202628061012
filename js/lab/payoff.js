/* ============================================================================
 * js/lab/payoff.js —— 面板「代价与最优判据」（M11）
 *
 * 【要证明的事】（契约 5.0）
 *   改代价 → 最优判据 β_opt 移动，而 d′ 一动不动。
 *
 * 【这个面板是三轮游戏的理论解释器】
 *   玩家在游戏里是被三轮的代价推着走的，这一屏告诉他「为什么」：
 *   把支付矩阵代进 β_opt 的公式，算出来的就是「理性的人该用的标准」。
 *   三轮里 d′ 一直是 1.5，变的只有 β_opt（1.00 → 2.25 → 0.30）。
 *
 * 【三条纪律】
 *   1. 支付矩阵的初值一律从 window.ROUNDS[n-1].payoff 读，本文件不写死数值；
 *      用户在输入框里改的是面板自己的副本，绝不回写 config.js。
 *   2. d′ 从 window.D_PRIME 读（契约 3.4：三轮都是 1.5），不写死 1.5。
 *   3. 只在 render() 里建图（契约 5.6：容器藏着时建出来是 0×0）。
 *
 * 接口见契约 5.6：window.LabPayoff = { render: function (el) {...} }
 * ==========================================================================*/

window.LabPayoff = (function () {
  'use strict';

  /* --------------------------------------------------------------------------
   * 0. 常量与状态
   * ------------------------------------------------------------------------ */

  var ROUNDS  = window.ROUNDS || [];
  var D_PRIME = window.D_PRIME;              // 1.5（契约 3.4，三轮相同）
  var CN      = ['一', '二', '三'];

  /* 每一轮有一份自己的「当前支付矩阵」。
     初值从 ROUNDS 拷贝 —— config.js 是别的模块的真源，只读，不改。 */
  var pay = ROUNDS.map(function (r) {
    return { VH: r.payoff.VH, CM: r.payoff.CM,
             CFA: r.payoff.CFA, VCR: r.payoff.VCR };
  });

  var cur   = 0;                 // 当前显示的轮次（下标）
  var prior = window.PRIOR;      // 先验 P(S)，默认 0.5（三轮设计都是 0.5）

  var inst = null;               // ECharts 实例（render 里建，刷新时复用）
  var dom  = {};                 // 需要反复更新的节点

  /* --------------------------------------------------------------------------
   * 1. 契约 3.4 的两个公式
   * ------------------------------------------------------------------------ */

  /* β_opt = [P(N)/P(S)] × [V(CR) − V(FA)] / [V(H) − V(M)]
     支付值按「收益」填，代价是负数，所以 V(FA) = C(FA)、V(M) = C(M)。 */
  function betaAt(p, ps) {
    return ((1 - ps) / ps) * ((p.VCR - p.CFA) / (p.VH - p.CM));
  }

  // c_opt = ln(β_opt) / d′
  function cAt(b) {
    return Math.log(b) / D_PRIME;
  }

  // 第 i 轮的 β（配置里没有这一轮就返回 NaN，别让页面炸掉）
  function betaOfRound(i, ps) {
    return pay[i] ? betaAt(pay[i], ps) : NaN;
  }

  /* --------------------------------------------------------------------------
   * 2. 数字格式化
   * ------------------------------------------------------------------------ */

  function f2(x) {                       // 两位小数；算不出来就画个破折号
    return isFinite(x) ? x.toFixed(2) : '—';
  }

  // 带符号的两位小数：+0.54 / -0.80 / 0.00
  // 0 不带正号 —— 契约 3.4 的表里第一轮 c_opt 写的就是「0.00」
  function f2s(x) {
    if (!isFinite(x)) return '—';
    var s = x.toFixed(2);
    if (s === '0.00' || s === '-0.00') return '0.00';
    return (x > 0 ? '+' : '') + s;
  }

  /* 支付矩阵里那一格怎么念：+10 / −40 / 0
     减号用 U+2212（−），和正文里其他地方一致；
     但动词要按【实际改法】挑 —— 矩阵是学生可以直接改的，
     写死"加到/降到"就会念出「把 C(M) 从 −10 加到 −5」这种自相矛盾的话。
     · C(M) 是代价（负数）："加到"指代价变大（更负），比的是绝对值
     · V(CR) 是收益（正数）：比的是大小本身 */
  function fCell(x) {
    if (!isFinite(x)) return '—';
    var r = Math.round(x * 100) / 100;
    if (r === 0) return '0';
    return (r > 0 ? '+' : '−') + Math.abs(r);
  }

  function costVerb(from, to) {
    if (!isFinite(from) || !isFinite(to) || to === from) return '改成';
    return Math.abs(to) > Math.abs(from) ? '加到' : '降到';
  }

  function valVerb(from, to) {
    if (!isFinite(from) || !isFinite(to) || to === from) return '改成';
    return to > from ? '升到' : '降到';
  }

  function betaVerb(from, to) {
    if (!isFinite(from) || !isFinite(to) || to === from) return '仍是';
    return to < from ? '掉到' : '升到';
  }

  /* ==========================================================================
   * 3. render —— 建结构、绑事件、画第一遍
   * ======================================================================== */

  function render(el) {

    /* ------------------------------------------------------------------
     * 3.1 结构
     *
     * 表单控件（输入框 / 滑块 / 复选框）的样式只能写行内：
     * main.css 里还没有表单控件的样式，而本任务不许改 CSS
     * （契约第 7 节把这个列为待补事项）。色值一律走 var(--c-xxx)。
     * ---------------------------------------------------------------- */

    var inputStyle =
      'width:76px;padding:6px 8px;margin-left:6px;text-align:right;' +
      'background:var(--c-surface-2);border:1px solid var(--c-border);' +
      'border-radius:var(--radius-sm);color:var(--c-text);' +
      'font-family:var(--font-mono);font-size:0.95rem;';

    // 支付矩阵的一格：标签 + 数字输入框
    function cell(key, label, aria) {
      return '<td>' + label + ' =' +
             '<input type="number" data-key="' + key + '" aria-label="' + aria + '"' +
             ' style="' + inputStyle + '"></td>';
    }

    // 一个读数小方块
    function box(id, label, color) {
      return '<div style="flex:1 1 108px;padding:10px 12px;' +
               'background:var(--c-surface-2);border:1px solid var(--c-border);' +
               'border-radius:var(--radius-sm);">' +
               '<div style="font-size:0.78rem;color:var(--c-text-dim);">' + label + '</div>' +
               '<div class="mono" id="' + id + '" style="font-size:1.2rem;color:' + color + ';">—</div>' +
             '</div>';
    }

    // 解读那段里的数字：等宽 + 主色 + 加粗
    var numStyle = 'color:var(--c-primary);font-weight:600;';

    var roundBtn = ROUNDS.map(function (r, i) {
      return '<button class="btn" data-round="' + i + '">' +
             '第' + (CN[i] || (i + 1)) + '轮 ' + r.name + '</button>';
    }).join('');

    el.innerHTML = [
      '<p class="placeholder">三轮里患者的难度完全相同（d′ 一直是 ' + D_PRIME + '），' +
        '变的只有「判错的代价」。这一屏把支付矩阵换算成理论上的最优判据 β_opt，' +
        '再按 d′ 换算成标准 c_opt。</p>',

      // —— 轮次切换 ——
      '<div class="card">',
      '  <div class="card-head">轮次（支付矩阵从 config.js 的 ROUNDS 读，不写死在这里）</div>',
      '  <div class="btn-row" id="pfRounds">' + roundBtn + '</div>',
      '</div>',

      // —— 支付矩阵 + 先验 ——
      '<div class="card">',
      '  <div class="card-head">支付矩阵 —— 改这里的数字，下面所有内容实时重算</div>',
      '  <table class="cm-table">',
      '    <thead><tr><th>真实情况</th><th>说“有信号”</th><th>说“无信号”</th></tr></thead>',
      '    <tbody>',
      '      <tr><td>有信号</td>' +
               cell('VH',  'V(H)',  'V(H) 正确收治的收益') +
               cell('CM',  'C(M)',  'C(M) 漏报危重的代价') + '</tr>',
      '      <tr><td>无信号</td>' +
               cell('CFA', 'C(FA)', 'C(FA) 误收轻症的代价') +
               cell('VCR', 'V(CR)', 'V(CR) 正确分流的收益') + '</tr>',
      '    </tbody>',
      '  </table>',
      '  <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:8px;">',
      '    <label for="pfPrior" style="color:var(--c-text-dim);font-size:0.9rem;">' +
             '先验概率 P(S)</label>',
      '    <input type="range" id="pfPrior" min="0.05" max="0.95" step="0.01"' +
             ' style="flex:1 1 200px;accent-color:var(--c-primary);">',
      '    <span class="mono" id="pfPriorVal" style="min-width:3.2em;text-align:right;' +
             'color:var(--c-primary);font-size:1.05rem;">—</span>',
      '  </div>',
      '</div>',

      // —— 公式 + 四个读数 ——
      '<div class="card">',
      '  <div class="card-head">公式（契约 3.4，原样）</div>',
      // 公式原样显示；窄屏（<450px）让它从空格处折成两行，而不是横向滚动
      '  <div style="padding:12px 14px;background:var(--c-surface-2);' +
             'border:1px solid var(--c-border);border-radius:var(--radius-sm);' +
             'font-family:var(--font-mono);font-size:0.82rem;line-height:1.9;' +
             'color:var(--c-text-dim);word-break:break-word;">',
      '    <div>β_opt = [P(N)/P(S)] × [V(CR) − V(FA)] / [V(H) − V(M)]</div>',
      '    <div>c_opt = ln(β_opt) / d′　　其中 d′ = ' + D_PRIME + '</div>',
      '  </div>',
      '  <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;">',
             box('pfPs',   'P(S)',   'var(--c-text)') +
             box('pfPn',   'P(N)',   'var(--c-text)') +
             box('pfBeta', '最优 β', 'var(--c-primary)') +
             box('pfC',    '最优 c', 'var(--c-primary)'),
      '  </div>',
      '</div>',

      // —— 曲线 ——
      '<div class="card">',
      '  <div class="card-head">最优判据随先验怎么变</div>',
      '  <p style="font-size:0.82rem;color:var(--c-text-dim);margin-bottom:8px;">' +
        '横轴：先验概率 P(S)　纵轴：最优判据 β_opt（对数刻度）　' +
        '黄虚线：当前选中的 P(S)</p>',
      '  <div class="chart-sm" id="pfChart"></div>',
      '</div>',

      // —— 解读 ——
      '<div class="card">',
      '  <div class="card-head">怎么读这三个数</div>',
      '  <p style="margin-bottom:8px;">第二轮只改了 C(FA) 和 V(CR)，最优 β 就从 ' +
           '<span class="mono" id="pfR1" style="' + numStyle + '">—</span> 升到 ' +
           '<span class="mono" id="pfR2" style="' + numStyle + '">—</span> —— ' +
           '<b>误收的代价上升，理性的人就该更保守。</b></p>',
      /* ★ 第三轮改的是【两个】格子（C(M) 和 V(CR)），不能说"只改了 C(M)"。
         这句话里的四个数直接读当前面板上的支付矩阵（第一轮 → 第三轮），
         学生改了矩阵，描述立刻跟着变 —— 描述和矩阵永远对得上。 */
      '  <p style="margin-bottom:8px;">第三轮把 C(M) 从 ' +
           '<span id="pfCM0">—</span> <span id="pfCMVer">加到</span> ' +
           '<span id="pfCM2">—</span>，同时把 V(CR) 从 ' +
           '<span id="pfVCR0">—</span> <span id="pfVCRVer">降到</span> ' +
           '<span id="pfVCR2">—</span>，最优 β ' +
           '<span id="pfBVer">掉到</span> ' +
           '<span class="mono" id="pfR3" style="' + numStyle + '">—</span> —— ' +
           '<b>漏报的代价上升，理性的人就该更宽松。</b></p>',
      '  <p><b>三轮里 d′ 一直是 ' + D_PRIME + '，你的分辨能力没变。' +
           '变的只有该用什么标准。</b></p>',
      '  <p style="margin-top:12px;font-size:0.82rem;color:var(--c-text-dim);">' +
        '上面三个数按当前的先验 P(S) 算。先验回到 0.50 时，' +
        '它们就是契约 3.4 那张表里的 1.00 / 2.25 / 0.30。</p>',
      '</div>',
    ].join('\n');

    /* ------------------------------------------------------------------
     * 3.2 取节点
     * ---------------------------------------------------------------- */

    dom.chart    = el.querySelector('#pfChart');
    dom.prior    = el.querySelector('#pfPrior');
    dom.priorVal = el.querySelector('#pfPriorVal');
    dom.ps       = el.querySelector('#pfPs');
    dom.pn       = el.querySelector('#pfPn');
    dom.beta     = el.querySelector('#pfBeta');
    dom.c        = el.querySelector('#pfC');
    dom.r1       = el.querySelector('#pfR1');
    dom.r2       = el.querySelector('#pfR2');
    dom.r3       = el.querySelector('#pfR3');
    // 第三轮那句话里的数字与动词（都跟着矩阵走）
    dom.cm0      = el.querySelector('#pfCM0');
    dom.cm2      = el.querySelector('#pfCM2');
    dom.cmVer    = el.querySelector('#pfCMVer');
    dom.vcr0     = el.querySelector('#pfVCR0');
    dom.vcr2     = el.querySelector('#pfVCR2');
    dom.vcrVer   = el.querySelector('#pfVCRVer');
    dom.bVer     = el.querySelector('#pfBVer');

    var btns   = el.querySelectorAll('#pfRounds button');
    var inputs = el.querySelectorAll('input[type="number"]');

    /* ------------------------------------------------------------------
     * 3.3 刷新
     * ---------------------------------------------------------------- */

    function refresh() {
      var p = pay[cur];
      var b = betaAt(p, prior);
      var c = cAt(b);

      dom.priorVal.textContent = prior.toFixed(2);
      dom.ps.textContent = prior.toFixed(2);
      dom.pn.textContent = (1 - prior).toFixed(2);
      dom.beta.textContent = f2(b);
      dom.c.textContent = f2s(c);

      // 解读那段：三轮的 β，都用当前先验算（先验 0.5 时就是 1.00 / 2.25 / 0.30）
      dom.r1.textContent = f2(betaOfRound(0, prior));
      dom.r2.textContent = f2(betaOfRound(1, prior));
      dom.r3.textContent = f2(betaOfRound(2, prior));

      /* 第三轮那句描述里的四个数、三个动词：读【第一轮】和【第三轮】的当前矩阵
         （不是 cur —— 那句话讲的是三轮之间的改动，跟此刻在看哪一轮无关）。
         学生把 C(M) 改成别的数，这句话立刻跟着改。 */
      var p1 = pay[0] || {}, p3 = pay[2] || {};
      dom.cm0.textContent    = fCell(p1.CM);
      dom.cm2.textContent    = fCell(p3.CM);
      dom.cmVer.textContent  = costVerb(p1.CM, p3.CM);
      dom.vcr0.textContent   = fCell(p1.VCR);
      dom.vcr2.textContent   = fCell(p3.VCR);
      dom.vcrVer.textContent = valVerb(p1.VCR, p3.VCR);
      dom.bVer.textContent   = betaVerb(betaOfRound(1, prior), betaOfRound(2, prior));

      var opt = chartOption(p, b);

      // 第一次进来把图建起来 —— ★ 只在 render 里建（契约 5.6）
      if (!inst) inst = Chart.make(dom.chart, opt);
      else       inst.setOption(Chart.base(opt), true);
    }

    /* ------------------------------------------------------------------
     * 3.4 图表配置
     * ---------------------------------------------------------------- */

    function chartOption(p, beta) {
      var c = Chart.color();
      var k = (p.VCR - p.CFA) / (p.VH - p.CM);

      // β(P(S)) = [P(N)/P(S)] × k，画 0.05 ~ 0.95 这段。
      // 对数轴画不了 ≤ 0 的点，先滤掉（矩阵填得离谱时整条曲线会是空的）。
      var pts = [];
      for (var i = 0; i <= 90; i++) {
        var ps = (5 + i) / 100;               // 0.05, 0.06, … 0.95
        var b  = ((1 - ps) / ps) * k;
        if (isFinite(b) && b > 0) pts.push([ps, b]);
      }

      var series = {
        name: 'β_opt',
        type: 'line',
        data: pts,
        showSymbol: false,
        lineStyle: { color: c.primary, width: 2 },
        itemStyle: { color: c.primary }
      };

      // 当前先验处：一条竖虚线 + 一个点，把「当前值」标出来
      if (isFinite(beta) && beta > 0) {
        series.markLine = {
          silent: true,
          symbol: 'none',
          lineStyle: { color: c.watch, type: 'dashed', width: 1.5 },
          label: {
            show: true, position: 'end', color: c.watch,
            fontSize: 11, lineHeight: 16,
            formatter: 'P(S) = ' + prior.toFixed(2) + '\nβ_opt = ' + f2(beta)
          },
          data: [{ xAxis: prior }]
        };
        series.markPoint = {
          symbol: 'circle',
          symbolSize: 9,
          itemStyle: { color: c.watch },
          label: { show: false },
          data: [{ coord: [prior, beta] }]
        };
      }

      return {
        // 只有一条曲线，不需要图例。★ 必须显式关掉：
        // Chart.base() 的主题里带了 legend（只有 textStyle），ECharts 见到
        // legend 就会自动拿系列名生成一个图例，默认落在图的下缘，正好压住
        // x 轴刻度。关掉它，轴标签才干净。
        legend: { show: false },

        tooltip: {
          trigger: 'axis',
          formatter: function (params) {
            if (!params || !params.length) return '';
            var v = params[0].value;
            return '先验 P(S) = ' + Number(v[0]).toFixed(2) +
                   '<br>最优 β = ' + f2(Number(v[1]));
          }
        },
        xAxis: {
          type: 'value', min: 0.05, max: 0.95, interval: 0.15,
          axisLabel: { formatter: function (v) { return Number(v).toFixed(2); } }
        },
        // 没有可画的点时不摆对数轴（对数轴配空数据只会更混乱）
        yAxis: { type: pts.length ? 'log' : 'value' },
        series: [series]
      };
    }

    /* ------------------------------------------------------------------
     * 3.5 换轮次
     * ---------------------------------------------------------------- */

    function loadRound(i) {
      if (!pay[i]) return;
      cur = i;

      for (var k = 0; k < btns.length; k++) {
        var on = (k === i);
        btns[k].classList.toggle('btn-primary', on);
        btns[k].classList.toggle('btn-ghost', !on);
      }

      // 把这一轮的支付矩阵填回输入框
      for (var m = 0; m < inputs.length; m++) {
        inputs[m].value = pay[i][inputs[m].getAttribute('data-key')];
      }

      // 三轮的设计里先验都是 0.5，换轮次就回到 0.5 —— 这样三轮的
      // β_opt 可以直接对比，不会掺进「先验不同」这个额外变量
      prior = window.PRIOR;
      dom.prior.value = prior;

      refresh();
    }

    /* ------------------------------------------------------------------
     * 3.6 事件
     * ---------------------------------------------------------------- */

    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.addEventListener('click', function () {
          loadRound(parseInt(b.getAttribute('data-round'), 10));
        });
      })(btns[i]);
    }

    // 改矩阵数字 → 实时重算（input 事件：每敲一个字符就重算一次）
    for (var j = 0; j < inputs.length; j++) {
      (function (inp) {
        inp.addEventListener('input', function () {
          var v = parseFloat(inp.value);
          pay[cur][inp.getAttribute('data-key')] = isFinite(v) ? v : 0;
          refresh();
        });
      })(inputs[j]);
    }

    dom.prior.addEventListener('input', function () {
      prior = parseFloat(dom.prior.value);
      refresh();
    });

    /* ------------------------------------------------------------------
     * 3.7 开张
     * ---------------------------------------------------------------- */

    loadRound(0);
  }

  return { render: render };
})();
