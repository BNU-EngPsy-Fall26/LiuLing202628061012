/* ============================================================================
 * js/admin.js —— 教师后台（模块 M13）
 *
 * 【这一页要干的事】
 *   把全班成绩读回来，让老师一眼看到三件事：
 *     1. 提交了多少人、平均 d′ / c / 准确率是多少          → 4 个概览卡片
 *     2. ★ 三轮的平均 d′ 几乎不动、c 在动（图 1，这一页的核心）
 *     3. 每个人的明细，能排序能搜                          → 成绩表格
 *
 * 【为什么是独立页面】
 *   学生端是 index.html。学生翻源码不该看见"有个后台在记录我的数据"，
 *   教师端则【网址本身就是入口】—— 老师存个书签就行，不用做隐藏参数那套。
 *   两页共用 utils.js / chart.js，代码不重复（契约第 1 节）。
 *
 * 【数据从哪来 —— 全部来自后端，这个文件一个指标都不自己算】
 *   /api/admin/login    口令换 token
 *   /api/admin/results  每人一行（契约 6.1）
 *   /api/admin/summary  班级汇总，含三轮各自的平均（契约 6.1）
 *   d′、c、准确率这些数字全部由 M14 的 `/api/submit` 存库时算好，
 *   这里只做格式化、排版和"把已经算好的数相减"。
 *   ★ 全文件不出现 z() / 对数线性修正 / dPrime 公式（契约 4.5 铁律）——
 *     唯一一次数学换算在 rocPoint() 里，用的是 Utils.ncdf，且只是把
 *     d′ 和 c 这两条定义式联立解一下，不是另写一遍 SDT 计算。
 *
 * 【口令】
 *   ★ 本文件不存、不写、不猜任何口令。老师输的口令直接 POST 给后端换 token，
 *     换完立刻从 DOM 里清掉，只留 token（存 sessionStorage，关标签页就失效）。
 * ==========================================================================*/

window.Admin = (function () {
  'use strict';

  /* ==========================================================================
   * 0. 常量与状态
   * ======================================================================== */

  var TOKEN_KEY = 'sdt.admin.token';   // sessionStorage 的键（关掉标签页就没了）

  var API = {
    login:   '/api/admin/login',
    results: '/api/admin/results',
    summary: '/api/admin/summary'
  };

  var MODE_LABEL = { all: '全部', standard: '标准版', quick: '快速版' };
  var CN_NUM = ['一', '二', '三'];

  var MONO = 'var(--font-mono)';

  // 图 2 里三轮的颜色与标记形状。
  //   ★ 颜色只能用 tokens.css 里现成的那几个（契约 2.2：不许新增色值）。
  //   挑这三只的理由：绿 / 黄 / 红两两之间，正常视觉与色觉障碍下的色差都是
  //   本项目令牌里唯一一组全部达标的（拿可视化的调色板校验脚本跑过
  //   全对校验）。青色（--c-primary）留给图里的理论曲线，跟三个数据系列
  //   都不撞色。
  //   同时给三组不同的 symbol —— 就算打印成黑白，三种形状也分得开。
  var ROUND_COLORS = ['accent', 'watch', 'danger'];
  var ROUND_SYMBOLS = ['circle', 'rect', 'triangle'];

  // 图 3 的分箱宽度（d′ 的常用刻度）。箱宽是排版参数，不是实验参数。
  var BIN_W = 0.25;

  // 图 1 那句话成立与否的判据（见 capRounds）：
  //   d′ 摆幅 ≤ DPRIME_FLAT，而且 c 的摆幅明显更大 → 才说"d′ 不动、c 在动"
  var DPRIME_FLAT = 0.30;
  var C_MOVE_RATIO = 1.5;

  /* ---------------------------------------------------------------- 重叠的点
   *
   * ★ 真实数据里的坑：两位同学的实测 d′ 完全相同（都是 1.42），坐标一模一样，
   *   图上就只画得出来一个点 —— 老师会以为班上只有 4 个人交了卷，
   *   而表格里明明写着"显示 5 / 5 人"、平均值也是按 5 个人算的。
   *
   * 所以：只在【两个坐标都完全相同】时才把这些点横向微微错开，
   * 位置本来就不重合的点一个都不动 —— 否则横轴就没意义了。
   * 数据本身一个数都不改（tooltip 里报的仍是真实值），图的说明里也照实写。
   */
  /* 错开的【一格】有多宽（相邻两个重合点之间）。横轴范围不一样的两张图，
     同样 0.02 个数据单位差了三四倍：图 2 的横轴是 0~1（0.02 ≈ 图上 7px），
     图 4 是 0~M（M 常是 2~3，0.02 只有 3px）—— 两个 12px 的圆差几像素还是糊成一团，
     数不出"这里有两个点"。所以一格取【数据单位】和【横轴全长的比例】里大的那个：
     图 2 上就是 ±0.02（两点相距 0.04），图 4 上按轴长放大，两张图看着错开一样宽。 */
  var OVERLAP_STEP  = 0.04;  // 一格的最小宽度（数据单位）—— 图 2 那种 0~1 的轴用它
  var OVERLAP_RATIO = 0.04;  // 或者：横轴全长的 4%（≈ 图上 15px）—— 图 4 那种 0~3 的轴用它
  var OVERLAP_SLOTS = 5;     // 一组最多摆 5 个位置（以 0 为中心 ±2 格）

  /* 一组 n 个重合的点各错开多少（以 0 为中心对称摆开，一格见上）。
     · 两个点（真实数据就是这一档）错开 ±半格，也就是"两点相距一格"；
     · 三个点及以上按整格摆（−1 / 0 / +1 …）；
     · 重合的点特别多时把格子压窄，保证总宽度不超过 ±2 格 ——
       错位是为了让人看清"这里有几个点"，不是把横轴搅乱。 */
  function overlapOffsets(n, span) {
    var unit = Math.max(OVERLAP_STEP, (isNum(span) && span > 0 ? span : 0) * OVERLAP_RATIO);
    var maxW = (OVERLAP_SLOTS - 1) / 2 * unit;        // ±2 格
    var step = ((n - 1) * unit > 2 * maxW) ? (2 * maxW) / (n - 1) : unit;
    var out = [];
    for (var i = 0; i < n; i++) out.push((i - (n - 1) / 2) * step);
    return out;
  }

  /* 传入每个点的 x、y（外加横轴全长 span），返回每个点的 { dx, n }：
     dx = 横坐标要加多少（不重合的点恒为 0），n = 同一个坐标上共有几个点。 */
  function spreadOverlaps(xs, ys, span) {
    var out = [], groups = {}, key, i, g, os;

    for (i = 0; i < xs.length; i++) {
      out.push({ dx: 0, n: 1 });
      if (!isNum(xs[i]) || !isNum(ys[i])) continue;   // 缺坐标的点不参与分组
      key = xs[i] + '|' + ys[i];                      // ★ 两个坐标都相同才算重合
      if (!groups[key]) groups[key] = [];
      groups[key].push(i);
    }

    for (key in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, key)) continue;
      g = groups[key];
      if (g.length < 2) continue;
      os = overlapOffsets(g.length, span);
      for (i = 0; i < g.length; i++) {
        out[g[i]].dx = os[i];
        out[g[i]].n  = g.length;
      }
    }
    return out;
  }

  // 这一遍画下来，每张图上最多有几个点叠在同一个坐标上（1 = 没有重叠）
  var maxOverlap = { roc: 1, sys: 1 };

  // 图下面那行小字：只在真的错开过点时出现（错开过就得说明，没动就别废话）
  function overlapNote(el, n) {
    if (!el || !(n > 1)) return;
    el.appendChild(E('br'));
    el.appendChild(E('span', 'cap-dim',
      '为了看清坐标重叠的同学，重叠的点横向做了微小平移（数据本身没有改动）；' +
      '本图里最多有 ' + n + ' 个点落在同一坐标上。'));
  }

  var state = {
    token: null,
    mode: 'all',
    rows: [],
    summary: null,
    sortKey: 'studentId',
    sortDir: 1,          // 1 = 升序，-1 = 降序
    query: '',
    loadedOnce: false,
    reqSeq: 0            // 请求序号，用来丢弃过期响应（见 load）
  };

  var dom = {};          // 元素引用，init() 里一次性取好

  /* ==========================================================================
   * 1. DOM 与格式化小工具
   * ======================================================================== */

  // E(标签, class, 文本)
  function E(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function $(id) { return document.getElementById(id); }

  // 转义：后端的 msg、学生的姓名学号都可能被拼进 ECharts 的 tooltip（HTML），
  // 不转义就是一个注入点。表格那边一律走 textContent，不需要转义。
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 数字一律等宽（契约 2.3）。tokens.css 里的 .num 就是干这个的，
  // ECharts 的 tooltip 是页面里的真实 DOM，所以 class 也生效。
  function monoHtml(s) { return '<span class="num">' + s + '</span>'; }

  // 元素版：给 caption 用（caption 里也会有数字）
  function mono(text) { return E('span', 'num', text); }

  // 往 el 里拼一段话：字符串当文本节点，元素原样插入（不用 innerHTML）
  function para(el, parts) {
    el.textContent = '';
    for (var i = 0; i < parts.length; i++) {
      if (typeof parts[i] === 'string') el.appendChild(document.createTextNode(parts[i]));
      else if (parts[i]) el.appendChild(parts[i]);
    }
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  // 两位小数。★ 摆幅（"d′ 摆幅 0.29"这句）要先各自取整再相减 ——
  // 不然图上写着 1.57 → 1.28，摆幅却按 1.574 − 1.283 算出来，老师拿计算器一减对不上。
  function r2(v) { return Math.round(v * 100) / 100; }

  // 解析成数字，给不出数字就 null（后端字段缺失 / 是空字符串时别硬当 0）
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = parseFloat(v);
      return isFinite(n) ? n : null;
    }
    return null;
  }

  // 取第一个"有值"的字段 —— 后端字段名可能写成 snake_case（数据库列名）
  // 或 camelCase（JSON 风格），两种都认（见 normRow 的说明）
  function pick(obj, names) {
    if (!obj) return undefined;
    for (var i = 0; i < names.length; i++) {
      var v = obj[names[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }

  // d′ 保留两位（负数用 U+2212，跟结果页一致）
  function fmt2(v) {
    if (!isNum(v)) return '—';
    return (Math.round(v * 100) / 100).toFixed(2).replace(/^-/, '−');
  }

  // c 带正负号：0.00 / +0.62 / −0.54（契约 3.6 的样表写法）
  function fmtC(v) {
    if (!isNum(v)) return '—';
    var r = Math.round(v * 100) / 100;
    if (r > 0) return '+' + r.toFixed(2);
    if (r < 0) return '−' + Math.abs(r).toFixed(2);
    return '0.00';
  }

  function fmtPct(a) {
    if (!isNum(a)) return '—';
    return Math.round(a * 100) + '%';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // 提交时间：表里只放"月-日 时:分"，完整的原文挂在 title 上
  function fmtTime(ms) {
    if (!isNum(ms)) return '—';
    var d = new Date(ms);
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
           pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // 轮次的中文标签（教师端不加载 config.js，所以按 round 序号自己拼）
  function roundLabel(n) {
    var i = (typeof n === 'number') ? n - 1 : -1;
    return '第' + (CN_NUM[i] || n) + '轮';
  }

  // 游客模式交上来的姓名是空的（后端那一列 NOT NULL，存的是空串）。
  // 空着比写"游客"好 —— 老师看到的是"这个人没填姓名"，而不是"这是个游客"。
  function nameOf(row) {
    var n = (row && row.studentName) ? String(row.studentName).trim() : '';
    return n || '（未填姓名）';
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ==========================================================================
   * 2. 网络层
   *
   * 契约 6.1：所有接口统一返回 { ok:true, ... } / { ok:false, msg }，
   * 失败用 400/401/500，鉴权走 Authorization: Bearer <token>。
   * ======================================================================== */

  function fail(msg, kind) {
    var e = new Error(msg);
    e.kind = kind || 'api';     // 'api' | 'auth' | 'offline'
    return e;
  }

  function api(path, opts) {
    opts = opts || {};

    if (typeof fetch !== 'function') {
      return Promise.reject(fail('这个浏览器太老，没有 fetch，用不了教师后台。', 'offline'));
    }

    var headers = { 'Accept': 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.token && opts.auth !== false) headers['Authorization'] = 'Bearer ' + state.token;

    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: (opts.body === undefined) ? undefined : JSON.stringify(opts.body)
    }).then(function (res) {
      return res.json().then(function (data) {
        if (res.status === 401) {
          throw fail((data && data.msg) || '登录已过期，请重新输入口令。', 'auth');
        }
        if (!res.ok || !data || data.ok !== true) {
          throw fail((data && data.msg) || ('请求失败（HTTP ' + res.status + '）'), 'api');
        }
        return data;
      }, function () {
        /* 后端返回的不是 JSON（多半是静态服务器给的 404 HTML 页面）——
           从这一页的角度看就是"连不上后台"。开头那句"连不上服务器"要有，
           因为老师说得出问题出在哪，却不会去读括号里的 HTTP 状态码。 */
        throw fail('连不上服务器 —— 服务器返回的不是 JSON（HTTP ' + res.status +
                   '）：后台服务没启动，或者这个网址上没有 /api/。', 'api');
      });
    }, function () {
      /* fetch 自己 reject = 网络层就没通。浏览器不给原因，所以把两种最常见的
         情况都写出来：后端没启动；页面不是从服务器网址打开的（直接双击
         admin.html 时 fetch('/api/...') 会解析成 file:///api/... 必然失败）。 */
      throw fail('连不上服务器 —— 后台服务没启动，或者本页面不是从服务器网址打开的。', 'offline');
    });
  }

  /* ==========================================================================
   * 3. 把后端的一行成绩归一化
   *
   * 【为什么要认三种拼法】
   *   契约 6.1 一开始只写了 rows: [...]，没定义里面每个字段叫什么；
   *   后端（M14）和这一页（M13）是两个会话并行做的，各猜了一套 ——
   *   后端给 'r1Dprime'（小写 p），契约 4.3 里 Session 的字段却是
   *   'systemDPrime'（大写 P）。M14b 之后后端统一成大写 P。
   *   所以这里三种都认：r1_dprime（数据库列名）/ r1Dprime（M14 当时）
   *   / r1DPrime（契约 · M14b 之后）。★ 认不出来的字段一律置 null ——
   *   表格显示"—"、图里少一个点，绝不瞎补 0（补 0 会静默污染统计）。
   *   实在一个都对不上，还有 payload（契约 6.2：完整 Session 的 JSON）兜底。
   * ======================================================================== */

  // 由 d′ 与 c 反推出工作点（图 2 的散点要用 P(FA) / P(H)）：
  //     z(P(H))  = d′/2 − c        z(P(FA)) = −d′/2 − c
  // 这两条就是把契约 4.5 的定义式联立解一下：
  //     d′ = z(pH) − z(pFA)，c = −½(z(pH) + z(pFA))
  // ★ 不是另写一遍 SDT 计算：正态 CDF 走 Utils.ncdf（契约 4.5 铁律），
  //   而且 rows 里的 d′、c 本来就是后端用同一批数据算出来的，反推回去
  //   和原始工作点只差浮点误差。
  function rocPoint(m) {
    if (!m || !isNum(m.dPrime) || !isNum(m.c)) return null;
    return {
      pH:  Utils.ncdf(m.dPrime / 2 - m.c),
      pFA: Utils.ncdf(-m.dPrime / 2 - m.c)
    };
  }

  function normRound(row, n, payload) {
    var p = 'r' + n;
    var pr = (payload && payload.rounds && payload.rounds[n - 1]) || null;
    var pm = pr && pr.metrics ? pr.metrics : null;

    var d = pick(row, [p + '_dprime', p + 'Dprime', p + 'DPrime']);
    var c = pick(row, [p + '_c', p + 'C']);
    var a = pick(row, [p + '_accuracy', p + 'Accuracy']);
    // 后端顺手把（从 payload 里捞出来的）工作点也给了 —— 有就直接用，
    // 没有再退回去从 d′、c 反推（见 rocPoint）。
    var ph = pick(row, [p + 'PH', p + '_ph', p + '_PH']);
    var pfa = pick(row, [p + 'PFA', p + '_pfa', p + '_PFA']);

    return {
      round: n,
      dPrime:   num(d) !== null ? num(d) : (pm ? num(pm.dPrime) : null),
      c:        num(c) !== null ? num(c) : (pm ? num(pm.c) : null),
      accuracy: num(a) !== null ? num(a) : (pm ? num(pm.accuracy) : null),
      _pH:  num(ph),
      _pFA: num(pfa)
    };
  }

  function normRow(row) {
    var payload = row.payload;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (e) { payload = null; }
    }

    var rounds = [normRound(row, 1, payload), normRound(row, 2, payload), normRound(row, 3, payload)];
    var om = (payload && payload.overall && payload.overall.metrics) || null;

    var od = pick(row, ['overall_dprime', 'overallDprime', 'overallDPrime']);
    var oc = pick(row, ['overall_c', 'overallC']);
    var oa = pick(row, ['overall_accuracy', 'overallAccuracy']);

    /* ★ 这一处的拼写最要命：backend 现在给的是 'systemDprime'（小写 p），
       而契约里 Session 的字段是 'systemDPrime'（大写 P，见 4.3）——
       M14b 任务书把后端统一成大写 P 之前，两种都得认。
       少认一个，图 4 就一个点都画不出来（它对没有 systemDPrime 的行直接跳过）。 */
    var sysD = pick(row, ['system_dprime', 'systemDprime', 'systemDPrime']);
    if (num(sysD) === null && payload && payload.rounds && payload.rounds[0]) {
      sysD = payload.rounds[0].systemDPrime;
    }

    var fin = pick(row, ['finishedAt', 'finished_at']);
    var finMs = (typeof fin === 'string' && fin) ? Date.parse(fin) : NaN;

    var out = {
      studentId:   String(pick(row, ['studentId', 'student_id']) || ''),
      studentName: String(pick(row, ['studentName', 'student_name', 'name']) || ''),
      mode:        String(pick(row, ['mode']) || ''),
      rounds:      rounds,
      overallDPrime:   num(od) !== null ? num(od) : (om ? num(om.dPrime) : null),
      overallC:        num(oc) !== null ? num(oc) : (om ? num(om.c) : null),
      overallAccuracy: num(oa) !== null ? num(oa) : (om ? num(om.accuracy) : null),
      systemDPrime:    num(sysD),
      finishedAt:      (typeof fin === 'string') ? fin : '',
      finishedAtMs:    isFinite(finMs) ? finMs : null
    };

    for (var i = 0; i < 3; i++) {
      var r = out.rounds[i];
      if (isNum(r._pH) && isNum(r._pFA)) {
        r.pH = r._pH;          // 后端直接给的，优先
        r.pFA = r._pFA;
      } else {
        var pt = rocPoint(r);  // 没给就自己反推
        r.pH  = pt ? pt.pH  : null;
        r.pFA = pt ? pt.pFA : null;
      }
      delete r._pH;
      delete r._pFA;
    }
    return out;
  }

  /* summary 同样做一层兜底：字段缺了就当 null，画不出图就明说"还没有数据"，
     而不是让整页崩掉（任务书 M13 自测第 1 条：后端没起来也不能白屏）。 */
  function normalizeSummary(s) {
    s = s || {};

    function stat(o) {
      if (!o) return null;
      var vals = [];
      var raw = o.values;
      if (Object.prototype.toString.call(raw) === '[object Array]') {
        for (var i = 0; i < raw.length; i++) {
          var v = num(raw[i]);
          if (v !== null) vals.push(v);
        }
      }
      return { mean: num(o.mean), sd: num(o.sd), values: vals };
    }

    var rounds = [];
    for (var n = 1; n <= 3; n++) {
      var r = (s.rounds && s.rounds[n - 1]) || null;
      rounds.push({
        round: n,
        dprimeMean:   r ? num(r.dprimeMean)   : null,
        cMean:        r ? num(r.cMean)        : null,
        accuracyMean: r ? num(r.accuracyMean) : null
      });
    }

    return {
      n: num(s.n) || 0,
      byMode: s.byMode || {},
      dprime:   stat(s.dprime),
      c:        stat(s.c),
      accuracy: stat(s.accuracy),
      rounds:   rounds
    };
  }

  /* ==========================================================================
   * 4. 登录 / 退出
   * ======================================================================== */

  function readToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || null; }
    catch (e) { return null; }        // 无痕模式下可能直接抛异常
  }

  function writeToken(t) {
    try {
      if (t) sessionStorage.setItem(TOKEN_KEY, t);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* 存不进去就只留在内存里，这一页照样能用 */ }
  }

  function setLoginMsg(text) {
    dom.loginMsg.textContent = text || '';
    dom.loginMsg.hidden = !text;
  }

  function setBusy(busy) {
    dom.loginBtn.disabled = busy;
    dom.refreshBtn.disabled = busy;
    dom.loginBtn.textContent = busy ? '请稍候…' : '进入';
  }

  function showGate(msg) {
    dom.panel.hidden = true;
    dom.gate.hidden = false;
    setLoginMsg(msg);
    dom.loginPassword.value = '';
    dom.loginPassword.focus();
  }

  function showPanel() {
    dom.gate.hidden = true;
    dom.panel.hidden = false;
  }

  function doLogin(password) {
    return api(API.login, {
      method: 'POST',
      body: { password: password },
      auth: false                       // 登录接口当然不带 token
    }).then(function (data) {
      if (!data.token) throw fail('服务器没有返回 token。', 'api');
      state.token = data.token;
      writeToken(data.token);
    });
  }

  function onLoginSubmit(ev) {
    if (ev) ev.preventDefault();

    var pw = dom.loginPassword.value;   // ★ 口令只在这个局部变量里活一下
    if (!pw) { setLoginMsg('请先输入口令。'); return; }

    setBusy(true);
    setLoginMsg('');

    doLogin(pw).then(function () {
      dom.loginPassword.value = '';     // 换到 token 之后立刻从 DOM 里清掉
      showPanel();
      return load();
    }).catch(function (err) {
      setLoginMsg(err.message);
    }).then(function () {
      setBusy(false);
    });
  }

  function onLogout() {
    state.token = null;
    writeToken(null);
    state.reqSeq++;      // 让还在路上的请求作废，别在退出之后把数据画回来
    state.rows = [];
    state.summary = null;
    state.loadedOnce = false;
    renderEmpty('登录之后才会显示数据。');
    showGate('');
  }

  function onTokenExpired(msg) {
    state.token = null;
    writeToken(null);
    showGate(msg || '登录已过期，请重新输入口令。');
  }

  /* ==========================================================================
   * 5. 取数据
   * ======================================================================== */

  function setStatus(text) { dom.status.textContent = text || ''; }

  function showBanner(text) {
    dom.errText.textContent = text;
    dom.errBanner.hidden = false;
  }

  function hideBanner() { dom.errBanner.hidden = true; }

  function load() {
    hideBanner();
    setStatus('正在取数据…');

    var q = '?mode=' + encodeURIComponent(state.mode);

    /* 连点「标准版 → 快速版」会同时发出两个请求，回来的顺序不保证 ——
       谁后到就用谁的话，表格可能停在上一个模式的数字上，而按钮已经高亮了新模式。
       所以每次请求带一个序号，回来的不是最新那次就整份丢掉。 */
    var seq = ++state.reqSeq;

    return Promise.all([
      api(API.results + q),
      api(API.summary + q)
    ]).then(function (res) {
      if (seq !== state.reqSeq) return;      // 已经有更新的请求了，这次作废

      state.rows = (res[0].rows || []).map(normRow);
      state.summary = normalizeSummary(res[1].summary);
      state.loadedOnce = true;

      /* 画不出来是这一页自己的毛病，不是"连不上服务器"。
         分开处理：渲染出错就大声报在控制台（页面上的数据仍是刚到手的），
         免得一个排版 bug 被渲染成"网络故障"，把排查方向带偏。 */
      try {
        render();
      } catch (e) {
        console.error('[Admin] 渲染出错：', e);
        showBanner('数据取回来了，但页面没画出来 —— 看控制台的报错。');
      }

      var by = state.summary.byMode || {};
      var split = [];
      if (isNum(by.standard) && by.standard > 0) split.push('标准版 ' + by.standard);
      if (isNum(by.quick) && by.quick > 0) split.push('快速版 ' + by.quick);

      var d = new Date();
      setStatus('共 ' + state.summary.n + ' 人' +
                (split.length ? '（' + split.join(' · ') + '）' : '') +
                ' · 当前筛：' + (MODE_LABEL[state.mode] || state.mode) +
                ' · 更新于 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()));
    }).catch(function (err) {
      if (seq !== state.reqSeq) return;      // 旧的请求失败不该盖掉新请求的结果
      if (err.kind === 'auth') { onTokenExpired(err.message); return; }

      showBanner(err.message);
      setStatus('');

      // 一次都没取到过数据 → 把占位文案铺上，别留一页空壳
      if (!state.loadedOnce) renderEmpty('连不上服务器，暂时没有数据。');
    });
  }

  /* ==========================================================================
   * 6. 渲染总入口
   * ======================================================================== */

  function render() {
    renderTiles();
    renderCharts();
    renderTable();
  }

  // 没数据时的占位（后端没起来 / 还没人交卷）
  function renderEmpty(note) {
    var ids = ['chartRounds', 'chartRoc', 'chartHist', 'chartSys'];
    for (var i = 0; i < ids.length; i++) {
      var el = dom[ids[i]];
      if (!el) continue;
      el.textContent = '';
      el.appendChild(E('p', 'empty', note || '还没有数据。'));
    }
    ['capRounds', 'capRoc', 'capHist', 'capSys'].forEach(function (k) {
      if (dom[k]) dom[k].textContent = '';
    });
    dom.tileN.textContent = '—';
    dom.tileD.textContent = '—';
    dom.tileC.textContent = '—';
    dom.tileAcc.textContent = '—';

    /* 没数据可显示时也没有东西可导出：
       进来还没登录、后端连不上（一次都没取到）、刚点了退出登录，都走这里。
       表格那边由 renderTable 每次重算，这里补上按钮的置灰状态。 */
    if (dom.exportBtn) {
      dom.exportBtn.disabled = true;
      dom.exportBtn.title = '后台还没有成绩';
    }
  }

  /* ---------------------------------------------------------------- 概览卡片 */

  function renderTiles() {
    var s = state.summary;
    if (!s) return;
    // 人数以后端给的 n 为准；万一是 0，就用 rows 的长度兜底
    var n = (isNum(s.n) && s.n > 0) ? s.n : state.rows.length;
    dom.tileN.textContent = String(n);

    /* ★ 一个人都没交的时候，后端给的均值是 0.0（见 M14 的 _mean_of：
       空数组返回 0）—— 照抄就会在屏幕上写"全班平均 d′ 0.00"，
       看着像"这个班完全分不清危重"，其实是"还没有人考"。所以一律显示 —。 */
    var noData = !(n > 0);
    dom.tileD.textContent = (!noData && s.dprime && isNum(s.dprime.mean)) ? fmt2(s.dprime.mean) : '—';
    dom.tileC.textContent = (!noData && s.c && isNum(s.c.mean)) ? fmtC(s.c.mean) : '—';
    dom.tileAcc.textContent = (!noData && s.accuracy && isNum(s.accuracy.mean)) ? fmtPct(s.accuracy.mean) : '—';
  }

  /* ==========================================================================
   * 7. 四张图
   *
   * 全部走 Chart.make()（契约 5.5）：配色、字体、悬停提示框都由 chart.js 统一，
   * 这一页只写"这张图自己特有的东西"。
   *
   * ★ 两个已经踩过的坑（写在 chart.js 的备忘里，这里照做）：
   *   1. Chart.base() 自带 legend 键 —— 单系列的图必须显式 { show:false }，
   *      否则 ECharts 会凭空长出一个图例压在 x 轴上；多系列的图要给 top。
   *   2. 轴名要写 nameLocation:'middle'，默认的 'end' 会把轴名摆到顶端正中，
   *      正好和顶部居中的图例打架。竖线的 markLine 标签要 rotate:0 才横排。
   * ======================================================================== */

  // 清掉容器里的旧内容，再建图。build() 返回 null 表示"没数据，画不了"。
  function drawChart(el, build) {
    el.textContent = '';

    var opt = null;
    try {
      opt = build();
    } catch (e) {
      opt = null;
      console.warn('[Admin] 生成图表配置时出错：', e);
    }

    if (!opt) {
      el.appendChild(E('p', 'empty', '这张图还没有数据可画 —— 等有同学交卷之后再点「刷新数据」。'));
      return;
    }
    Chart.make(el, opt);
  }

  // 一组 d′（或 c）值里，"最多"的那几个数怎么定轴的上下限。
  // 用手写死的范围（比如 c 固定 ±1.5）看着最稳，但班里真跑出 ±2 就被截掉了，
  // 所以取"至少 1.5 起步、随数据放宽"的做法：换一批数据图不会跳得很夸张，
  // 也不会把点画到框外面去。
  function axisBound(values, floor) {
    var m = 0;
    for (var i = 0; i < values.length; i++) {
      var v = Math.abs(values[i] || 0);
      if (v > m) m = v;
    }
    return Math.max(floor, Math.ceil(m * 1.2 * 2) / 2);   // 向上取到 0.5 的整数倍
  }

  function allNum(arr) {
    for (var i = 0; i < arr.length; i++) if (!isNum(arr[i])) return false;
    return true;
  }

  function spread(arr) {
    if (!allNum(arr) || arr.length < 2) return null;
    return Math.max.apply(null, arr) - Math.min.apply(null, arr);
  }

  /* -------------------------------------------------- 图 1：三轮的 d′ 与 c */

  function optRounds(summary) {
    var rs = summary.rounds || [];
    var cats = [], dData = [], cData = [], accData = [];
    for (var i = 0; i < rs.length; i++) {
      cats.push(roundLabel(rs[i].round));
      dData.push(rs[i].dprimeMean);
      cData.push(rs[i].cMean);
      accData.push(rs[i].accuracyMean);
    }
    // ★ 一个人都没交时，后端的三轮均值也是 0.0（空数组求均值返回 0）——
    //   照画就是一条贴着 0 的平线，看着像"这个班完全分不清危重"。宁可不画。
    if (!(summary.n > 0)) return null;
    if (!allNum(dData) && !allNum(cData)) return null;   // 三轮一个数都没有

    var C = Chart.color();
    var dMax = axisBound(dData, 3);        // 左轴 d′：0 ~ dMax
    var cMax = axisBound(cData, 1.5);      // 右轴 c ：−cMax ~ +cMax（对称，0 在正中）

    return {
      grid: { left: 52, right: 88, top: 58, bottom: 40 },

      // 图例放顶部；只给 top 就能把主题里默认的"下缘图例"顶掉
      legend: { top: 4, itemGap: 18, data: ['平均 d′（左轴）', '平均 c（右轴）'] },

      tooltip: {
        trigger: 'axis',
        formatter: function (params) {
          if (!params || !params.length) return '';
          var k = params[0].dataIndex;
          var out = [esc(cats[k])];
          if (isNum(dData[k]))   out.push('平均 d′ = ' + monoHtml(fmt2(dData[k])));
          if (isNum(cData[k]))   out.push('平均 c = ' + monoHtml(fmtC(cData[k])));
          if (isNum(accData[k])) out.push('平均准确率 = ' + monoHtml(fmtPct(accData[k])));
          return out.join('<br>');
        }
      },

      xAxis: { type: 'category', boundaryGap: false, data: cats },

      yAxis: [
        {
          type: 'value', min: 0, max: dMax,
          name: '平均 d′', nameLocation: 'middle', nameGap: 36,
          axisLabel: { formatter: function (v) { return Number(v).toFixed(1); } }
        },
        {
          type: 'value', min: -cMax, max: cMax,
          name: '平均 c', nameLocation: 'middle', nameGap: 36,
          splitLine: { show: false },       // 两套网格线叠在一起太花
          axisLabel: { formatter: function (v) { return fmtC(v); } }
        }
      ],

      series: [
        {
          name: '平均 d′（左轴）', type: 'line', yAxisIndex: 0,
          symbol: 'circle', symbolSize: 11, z: 5,
          lineStyle: { color: C.accent, width: 2.5 },
          itemStyle: { color: C.accent },
          // 只给最后一个点配直接标注（"selective direct labels"：不是每个点都标数字）。
          // 三个数全标出来，图就变成一张表了；具体数值悬停能看，图下面那句话里也写全。
          data: lastPointLabel(dData, {
            position: 'top', formatter: function (p) { return fmt2(p.value); }
          })
        },
        {
          name: '平均 c（右轴）', type: 'line', yAxisIndex: 1,
          symbol: 'diamond', symbolSize: 11, z: 5,
          // 虚线 = 第二通道：颜色之外再给一个区分信号，色觉障碍和黑白打印也分得开
          lineStyle: { color: C.watch, width: 2.5, type: 'dashed' },
          itemStyle: { color: C.watch },
          data: lastPointLabel(cData, {
            position: 'bottom', formatter: function (p) { return fmtC(p.value); }
          })
        }
      ]
    };
  }

  /* 把一串数变成"只有最后一个点带标签"的 series.data。
     标签放点的上/下方（而不是摆在坐标轴旁边）—— 轴那边本来就有刻度数字，
     挤在一起就没人分得清哪个是刻度、哪个是数据。 */
  function lastPointLabel(values, labelOpt) {
    return values.map(function (v, i) {
      var item = { value: v };
      if (i === values.length - 1 && isNum(v)) {
        item.label = {
          show: true, position: labelOpt.position, distance: 8,
          formatter: labelOpt.formatter, color: Chart.color().text,
          fontFamily: MONO, fontSize: 12
        };
      }
      return item;
    });
  }

  /* 图 1 下面那句话 —— 这是整个作业的教学结论，老师投屏就靠它。
     任务书钉死了这句话本身；但如果这一班的 d′ 恰好抖得厉害，
     硬说"几乎不动"就是骗人，所以按数据挑一句（判据见 DPRIME_FLAT）。 */
  function capRounds(summary) {
    var el = dom.capRounds;
    var rs = summary.rounds || [];
    var d = [], c = [];
    for (var i = 0; i < rs.length; i++) { d.push(rs[i].dprimeMean); c.push(rs[i].cMean); }

    if (!allNum(d) || !allNum(c) || !(summary.n > 0)) {
      para(el, ['等有人交卷之后，这里会写出这一班的结论句。']);
      return;
    }

    d = d.map(r2);      // 先各自取整，摆幅才和上面写出来的那串数对得上（见 r2）
    c = c.map(r2);

    var dS = spread(d), cS = spread(c);
    var flat = (dS !== null && dS <= DPRIME_FLAT && cS !== null && cS > dS * C_MOVE_RATIO);

    var head = flat
      ? '全班平均 d′ 几乎不动，而 c 从第 1 轮走到第 3 轮 —— 这正是这场实验要证明的：代价改变的是标准，不是能力。'
      : '这一批数据里，三轮的 d′ 摆幅是 ' + fmt2(dS) + '，并不比 c 小 —— ' +
        '样本量小的时候 d′ 本身就会抖（快速版尤其明显）。趋势要看，但别把抖动当结论。';

    para(el, [
      head,
      E('br'),
      E('span', 'cap-dim', '（本班实测：'),
      mono('d′ ' + d.map(fmt2).join(' → ') + '，摆幅 ' + fmt2(dS)),
      '；',
      mono('c ' + c.map(fmtC).join(' → ') + '，摆幅 ' + fmt2(cS)),
      E('span', 'cap-dim', '）')
    ]);
  }

  /* ------------------------------------------------- 图 2：班级 ROC 散点 */

  // d′ = 常数时的理论 ROC 曲线：z(P(H)) = z(P(FA)) + d′
  function rocCurve(d) {
    var pts = [];
    for (var i = 0; i <= 60; i++) {
      var pfa = i / 60;
      var pf = Utils.clamp(pfa, 1e-4, 1 - 1e-4);
      pts.push([pfa, Utils.ncdf(Utils.zScore(pf) + d)]);
    }
    return pts;
  }

  // 后端给所有人的 system_dprime 都一样（契约 3.4 的铁律：三轮都是 1.5）
  function systemDPrime(rows) {
    for (var i = 0; i < rows.length; i++) {
      if (isNum(rows[i].systemDPrime)) return rows[i].systemDPrime;
    }
    return null;
  }

  function optRoc(rows) {
    var pts = 0;
    for (var i = 0; i < rows.length; i++) {
      for (var r = 0; r < 3; r++) if (rows[i].rounds[r].pH !== null) pts++;
    }
    if (!pts) return null;

    var C = Chart.color();
    var SURFACE = cssVar('--c-surface');       // 点叠在一起时的描边色
    var series = [];

    // 图例顺序：三轮排前面（这是主角），两条参考线排后面
    var legendData = ['第一轮', '第二轮', '第三轮'];

    // ① 纯瞎猜的基准线（和实验室的 ROC 面板用同一种画法）
    series.push({
      name: '对角线（纯瞎猜）', type: 'line', data: [[0, 0], [1, 1]],
      symbol: 'none', silent: true, z: 1, tooltip: { show: false },
      lineStyle: { color: C.dim, width: 1.5, type: 'dashed' }
    });

    // ② d′ = 1.5 的理论曲线 —— 没有它，这一堆点就只是散在方格子里
    var sysD = systemDPrime(rows);
    if (isNum(sysD)) {
      var curveName = 'd′ = ' + fmt2(sysD) + ' 理论曲线';
      legendData.push(curveName);
      series.push({
        name: curveName, type: 'line', data: rocCurve(sysD),
        symbol: 'none', silent: true, z: 2,
        lineStyle: { color: C.primary, width: 1.5, type: 'dotted' }
      });
    }
    legendData.push('对角线（纯瞎猜）');

    // ③ 每人每轮一个点（任务书 M13 图 2）
    maxOverlap.roc = 1;
    for (var n = 1; n <= 3; n++) {
      var data = [], xs = [], ys = [];
      for (var k = 0; k < rows.length; k++) {
        var m = rows[k].rounds[n - 1];
        if (m.pH === null) continue;
        data.push({ value: [m.pFA, m.pH], row: rows[k], round: n });
        xs.push(m.pFA);
        ys.push(m.pH);
      }
      /* 同一轮里两位同学的工作点完全重合（同样的 H、同样的 FA）时，
         图上只剩一个点 —— 老师数不出有几个人。横向微移一下，数值不动。
         （图 2 的横轴是 0~1，span 传 1。） */
      var offs = spreadOverlaps(xs, ys, 1);
      for (var j = 0; j < data.length; j++) {
        data[j].value = [xs[j] + offs[j].dx, ys[j]];
        data[j].dupN  = offs[j].n;
        if (offs[j].n > maxOverlap.roc) maxOverlap.roc = offs[j].n;
      }
      series.push({
        name: roundLabel(n), type: 'scatter', data: data,
        symbol: ROUND_SYMBOLS[n - 1], symbolSize: 12, z: 5,
        itemStyle: {
          color: C[ROUND_COLORS[n - 1]],
          borderColor: SURFACE, borderWidth: 1.5, opacity: 0.92
        }
      });
    }

    return {
      grid: { left: 52, right: 24, top: 62, bottom: 46 },
      legend: { top: 2, itemGap: 12, textStyle: { fontSize: 11 }, data: legendData },
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          var d = p.data;
          if (!d || !d.row) {
            // 参考线上的点：只报坐标
            var v = p.value || [];
            return esc(p.seriesName) + '<br>P(FA) = ' + monoHtml(Number(v[0]).toFixed(2)) +
                   '<br>P(H) = ' + monoHtml(Number(v[1]).toFixed(2));
          }
          var row = d.row;
          var m = row.rounds[d.round - 1];
          var lines = [
            esc(nameOf(row)) + ' · ' + esc(row.studentId),
            roundLabel(d.round),
            'P(FA) = ' + monoHtml(m.pFA.toFixed(2)) + '，P(H) = ' + monoHtml(m.pH.toFixed(2)),
            'd′ = ' + monoHtml(fmt2(m.dPrime)) + '，c = ' + monoHtml(fmtC(m.c))
          ];
          // 这个位置叠着 N 个人（图上把它们横向错开了，得让老师知道）
          if (isNum(d.dupN) && d.dupN > 1) lines.push('（此位置共 ' + d.dupN + ' 人）');
          return lines.join('<br>');
        }
      },
      xAxis: {
        type: 'value', min: 0, max: 1,
        name: 'P(FA) 误报率', nameLocation: 'middle', nameGap: 28,
        axisLabel: { formatter: function (v) { return Number(v).toFixed(1); } }
      },
      yAxis: {
        type: 'value', min: 0, max: 1,
        name: 'P(H) 击中率', nameLocation: 'middle', nameGap: 40,
        axisLabel: { formatter: function (v) { return Number(v).toFixed(1); } }
      },
      series: series
    };
  }

  function capRoc(rows, summary) {
    var el = dom.capRoc;
    if (!rows.length) { para(el, ['还没有人交卷。']); return; }

    var sysD = systemDPrime(rows);
    var parts = ['每个点 = 一位同学的一轮判断（三种形状 / 三种颜色分三轮）。'];
    if (isNum(sysD)) {
      parts.push('那条细点线是 d′ = ' + fmt2(sysD) + ' 的理论 ROC —— 点贴在这条曲线上，');
      parts.push('说明这一班的判断力和系统设定是相称的；点贴着左下方，说明实际比系统更难分辨。');
    }
    para(el, parts);
    overlapNote(el, maxOverlap.roc);      // 错开过重叠点才加这行说明
  }

  /* ------------------------------------------------ 图 3：d′ 分布直方图 */

  function optHist(summary) {
    var st = summary.dprime;
    var vals = (st && st.values && st.values.length) ? st.values : null;
    if (!vals) return null;

    var minV = Math.min.apply(null, vals);
    var maxV = Math.max.apply(null, vals);
    var lo = Math.floor(minV / BIN_W) * BIN_W;
    var hi = Math.ceil(maxV / BIN_W) * BIN_W;
    if (hi - lo < BIN_W) hi = lo + BIN_W;

    var nBins = Math.round((hi - lo) / BIN_W);
    if (nBins > 24) { nBins = 24; hi = lo + nBins * BIN_W; }   // 极端离群值别铺满整条轴

    var bins = [];
    for (var i = 0; i < nBins; i++) {
      bins.push({ x0: lo + i * BIN_W, x1: lo + (i + 1) * BIN_W, count: 0 });
    }
    for (var k = 0; k < vals.length; k++) {
      var idx = Math.floor((vals[k] - lo) / BIN_W);
      if (idx < 0) idx = 0;
      if (idx > nBins - 1) idx = nBins - 1;
      bins[idx].count++;
    }

    var mean = isNum(st.mean) ? st.mean : null;
    var C = Chart.color();
    var data = bins.map(function (b) { return [b.x0 + BIN_W / 2, b.count]; });

    return {
      grid: { left: 46, right: 24, top: 34, bottom: 48 },
      // 单系列：必须显式关掉图例，否则 Chart.base() 里那个 legend 键
      // 会让 ECharts 生成一个压在 x 轴上的图例（chart.js 备忘里的坑）
      legend: { show: false },
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          var b = bins[p.dataIndex];
          if (!b) return '';
          var pct = vals.length ? Math.round(b.count / vals.length * 100) : 0;
          return 'd′ ' + monoHtml(b.x0.toFixed(2) + ' ~ ' + b.x1.toFixed(2)) + '<br>' +
                 monoHtml(b.count) + ' 人（' + monoHtml(pct + '%') + '）';
        }
      },
      xAxis: {
        type: 'value', min: lo, max: hi,
        name: 'd′（每箱 ' + BIN_W.toFixed(2) + '）', nameLocation: 'middle', nameGap: 28,
        axisLabel: { formatter: function (v) { return Number(v).toFixed(2); } }
      },
      yAxis: {
        type: 'value', minInterval: 1,
        name: '人数', nameLocation: 'middle', nameGap: 30
      },
      series: [{
        name: '人数', type: 'bar', data: data, barWidth: '72%', z: 3,
        itemStyle: { color: C.primary, borderRadius: [4, 4, 0, 0] },
        markLine: mean === null ? undefined : {
          silent: true, symbol: 'none', z: 4,
          data: [{ xAxis: mean }],
          lineStyle: { color: C.watch, width: 2, type: 'dashed' },
          label: {
            formatter: '平均 ' + fmt2(mean),
            // 竖线的标签默认会转 90° 贴着线画，压住柱子；改成贴轴横排
            position: 'insideStartTop', rotate: 0,
            color: C.text, fontFamily: MONO, fontSize: 11
          }
        }
      }]
    };
  }

  function capHist(summary) {
    var el = dom.capHist;
    var st = summary.dprime;
    if (!st || !st.values || !st.values.length) { para(el, ['还没有数据。']); return; }
    var parts = ['横轴是 d′ 的分箱（每箱 ' + BIN_W.toFixed(2) + '），纵轴是人数。'];
    if (isNum(st.mean)) {
      parts.push('虚线是全班平均 ');
      parts.push(mono('d′ = ' + fmt2(st.mean)));
      if (isNum(st.sd)) {
        parts.push('，标准差 ');
        parts.push(mono(fmt2(st.sd)));
      }
      parts.push(' —— 大家的能力分布得越开，这条分布就越宽，但平均值才是和系统设定 1.50 对比的那个数。');
    }
    para(el, parts);
  }

  /* --------------------------------------------- 图 4：实测 d′ vs 系统 d′ */

  function optSys(rows) {
    maxOverlap.sys = 1;
    var data = [], xs = [], ys = [];
    var maxV = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!isNum(r.systemDPrime) || !isNum(r.overallDPrime)) continue;
      data.push({ value: [r.systemDPrime, r.overallDPrime], row: r });
      xs.push(r.systemDPrime);
      ys.push(r.overallDPrime);
      maxV = Math.max(maxV, r.systemDPrime, r.overallDPrime);
    }
    if (!data.length) return null;

    var C = Chart.color();
    var SURFACE = cssVar('--c-surface');
    var M = Math.max(2, Math.ceil(maxV * 1.25));
    var mean = isNum(state.summary && state.summary.dprime && state.summary.dprime.mean)
                 ? state.summary.dprime.mean : null;

    /* ★ 这张图最容易重叠：所有人的系统 d′ 都是同一个数（1.5），点本来就排成
       一根竖线；实测 d′ 再撞上（两位同学都是 1.42），坐标就完全重合 ——
       图上只看得到一个点，老师会以为班上只有 4 个人交卷。
       这里把重合的点横向微移开（错开量按横轴全长 M 折算，见 overlapOffsets），
       数值一个都不改（tooltip 报的还是真值）。 */
    var offs = spreadOverlaps(xs, ys, M);
    for (var j = 0; j < data.length; j++) {
      data[j].value = [xs[j] + offs[j].dx, ys[j]];
      data[j].dupN  = offs[j].n;
      if (offs[j].n > maxOverlap.sys) maxOverlap.sys = offs[j].n;
    }

    return {
      grid: { left: 52, right: 24, top: 34, bottom: 46 },
      legend: { show: false },         // 单系列，关掉主题自带的图例
      tooltip: {
        trigger: 'item',
        formatter: function (p) {
          var r = p.data && p.data.row;
          if (!r) return '';
          var gap = r.systemDPrime - r.overallDPrime;
          var lines = [
            esc(nameOf(r)) + ' · ' + esc(r.studentId),
            '系统 d′ = ' + monoHtml(fmt2(r.systemDPrime)),
            '实测 d′ = ' + monoHtml(fmt2(r.overallDPrime)),
            '差了 ' + monoHtml(fmt2(Math.abs(gap))) + (gap >= 0 ? '（低于理想观察者）' : '（高于理想观察者）')
          ];
          // 这个位置叠着 N 个人（图上把它们横向错开了，得让老师知道）
          if (p.data && isNum(p.data.dupN) && p.data.dupN > 1) {
            lines.push('（此位置共 ' + p.data.dupN + ' 人）');
          }
          return lines.join('<br>');
        }
      },
      xAxis: {
        type: 'value', min: 0, max: M,
        name: '系统 d′', nameLocation: 'middle', nameGap: 28,
        axisLabel: { formatter: function (v) { return Number(v).toFixed(1); } }
      },
      yAxis: {
        type: 'value', min: 0, max: M,      // 两个轴同范围，对角线才是真的 45°
        name: '实测 d′', nameLocation: 'middle', nameGap: 36,
        axisLabel: { formatter: function (v) { return Number(v).toFixed(1); } }
      },
      series: [
        {
          name: '对角线（理想观察者）', type: 'line', data: [[0, 0], [M, M]],
          symbol: 'none', silent: true, z: 1, tooltip: { show: false },
          lineStyle: { color: C.dim, width: 1.5, type: 'dashed' }
        },
        {
          name: '每位同学', type: 'scatter', data: data, symbolSize: 12, z: 5,
          // 所有人的系统 d′ 都是同一个数（1.5），点本来就排成一根竖线；
          // 描边用卡片底色，挨在一起也分得开；坐标【完全】重合的那几个
          // 已经横向微移开了（见 spreadOverlaps），不会再压成一个点
          itemStyle: { color: C.accent, borderColor: SURFACE, borderWidth: 1.5, opacity: 0.9 },
          markLine: mean === null ? undefined : {
            silent: true, symbol: 'none', z: 4,
            data: [{ yAxis: mean }],
            lineStyle: { color: C.watch, width: 1.5, type: 'dashed' },
            label: {
              formatter: '实测平均 ' + fmt2(mean),
              position: 'insideStartTop', rotate: 0,
              color: C.text, fontFamily: MONO, fontSize: 11
            }
          }
        }
      ]
    };
  }

  /* 图 4 下面那句话。
     ★ 任务书给的那句（"真人通常落在对角线下方"）只有在实测平均真的低于
       系统 d′ 时才成立。贴在对角线上的话硬套就是骗人，所以按数据挑句子。 */
  function capSys(rows, summary) {
    var el = dom.capSys;
    var sysD = systemDPrime(rows);
    var mean = (summary && summary.dprime) ? summary.dprime.mean : null;

    if (!isNum(sysD) || !isNum(mean)) { para(el, ['还没有数据。']); return; }

    // 先各自取整再作差：正文里写的是 1.36 和 1.50，差值就该是 0.14（见 r2）
    sysD = r2(sysD);
    mean = r2(mean);
    var gap = r2(sysD - mean);

    if (gap > 0.15) {
      para(el, [
        '理想观察者落在对角线上。真人通常落在对角线下方 —— 因为我们有内部噪声，还有注意力的波动。',
        E('br'),
        E('span', 'cap-dim', '（本班实测：平均 d′ '),
        mono(fmt2(mean)),
        E('span', 'cap-dim', '，系统设定 '),
        mono(fmt2(sysD)),
        E('span', 'cap-dim', '，低了 '),
        mono(fmt2(gap)),
        E('span', 'cap-dim', '。）')
      ]);
      overlapNote(el, maxOverlap.sys);      // 错开过重叠点才加这行说明
      return;
    }

    // 数据不支持上面那句话 —— 照实说，别硬套（任务书 M13 图 4 的明确要求）
    para(el, [
      '这一批数据里，实测 d′ 平均 ',
      mono(fmt2(mean)),
      '，系统设定 ',
      mono(fmt2(sysD)),
      '，两者只差 ',
      mono(fmt2(Math.abs(gap))),
      ' —— 点就压在对角线上。这说明这个设计里的体征读数相当透明，',
      '大家基本做到了理想观察者的水平，「真人会系统性低于理想观察者」这句话在你们这班不成立。'
    ]);
    overlapNote(el, maxOverlap.sys);
  }

  function renderCharts() {
    var s = state.summary;
    var rows = state.rows;

    if (s) drawChart(dom.chartRounds, function () { return optRounds(s); });
    drawChart(dom.chartRoc, function () { return optRoc(rows); });
    if (s) drawChart(dom.chartHist, function () { return optHist(s); });
    drawChart(dom.chartSys, function () { return optSys(rows); });

    if (s) capRounds(s);
    capRoc(rows, s);
    if (s) capHist(s);
    capSys(rows, s);
  }

  /* ==========================================================================
   * 8. 成绩表格（排序 + 搜索）
   * ======================================================================== */

  function sortValue(row, key) {
    switch (key) {
      case 'studentId':       return row.studentId;
      case 'studentName':     return row.studentName;
      case 'mode':            return MODE_LABEL[row.mode] || row.mode;
      case 'r1d':             return row.rounds[0].dPrime;
      case 'r2d':             return row.rounds[1].dPrime;
      case 'r3d':             return row.rounds[2].dPrime;
      case 'overallDPrime':   return row.overallDPrime;
      case 'overallC':        return row.overallC;
      case 'overallAccuracy': return row.overallAccuracy;
      case 'finishedAt':      return row.finishedAtMs;
    }
    return '';
  }

  function cmpText(a, b) {
    var sa = String(a), sb = String(b);
    try {
      // 学号是数字串，"10" 要排在 "9" 后面，所以开 numeric
      return sa.localeCompare(sb, 'zh-Hans-CN', { numeric: true });
    } catch (e) {
      return sa < sb ? -1 : (sa > sb ? 1 : 0);
    }
  }

  function compareRows(a, b, key, dir) {
    var va = sortValue(a, key), vb = sortValue(b, key);
    var ea = (va === null || va === undefined || va === '');
    var eb = (vb === null || vb === undefined || vb === '');
    if (ea && eb) return 0;
    if (ea) return 1;        // 缺数据的行永远沉底，不管升序还是降序
    if (eb) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return cmpText(va, vb) * dir;
  }

  function visibleRows() {
    var q = state.query.trim().toLowerCase();
    var out = state.rows;

    if (q) {
      out = out.filter(function (r) {
        return (r.studentId || '').toLowerCase().indexOf(q) >= 0 ||
               (r.studentName || '').toLowerCase().indexOf(q) >= 0;
      });
    }

    var key = state.sortKey, dir = state.sortDir;
    return out.slice().sort(function (a, b) { return compareRows(a, b, key, dir); });
  }

  // 一轮的 "d′ / c" 两个数字，中间用次要颜色的斜杠隔开
  function roundCell(row, n) {
    var m = row.rounds[n - 1];
    var td = E('td', 'num');
    td.appendChild(E('span', null, fmt2(m.dPrime)));
    td.appendChild(E('span', 'cap-dim', ' / '));
    td.appendChild(E('span', null, fmtC(m.c)));
    return td;
  }

  function renderTable() {
    var rows = visibleRows();
    var tb = dom.tbody;
    tb.textContent = '';

    if (!rows.length) {
      var tr = E('tr');
      var td = E('td', 'txt', state.rows.length
        ? '没有匹配「' + state.query + '」的记录。'
        : '后台还没有成绩 —— 等同学交卷之后再点「刷新数据」。');
      td.colSpan = 10;
      td.setAttribute('style', 'text-align:center;color:var(--c-text-dim);padding:24px 8px;');
      tr.appendChild(td);
      tb.appendChild(tr);
    } else {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var tr2 = E('tr');
        tr2.appendChild(E('td', 'txt', r.studentId));
        tr2.appendChild(E('td', 'txt', nameOf(r)));
        tr2.appendChild(E('td', 'txt', MODE_LABEL[r.mode] || r.mode));
        tr2.appendChild(roundCell(r, 1));
        tr2.appendChild(roundCell(r, 2));
        tr2.appendChild(roundCell(r, 3));
        tr2.appendChild(E('td', 'num', fmt2(r.overallDPrime)));
        tr2.appendChild(E('td', 'num', fmtC(r.overallC)));
        tr2.appendChild(E('td', 'num', fmtPct(r.overallAccuracy)));

        var tdT = E('td', 'num', fmtTime(r.finishedAtMs));
        if (r.finishedAt) tdT.title = r.finishedAt;
        tr2.appendChild(tdT);

        tb.appendChild(tr2);
      }
    }

    // 超过 10 人表头吸顶（任务书 M13 第 5 节）
    dom.tableWrap.classList.toggle('sticky', rows.length > 10);

    /* ★ 导出按钮跟着表格的可导出行数走：一行都没有就置灰。
       判据用 rows.length（visibleRows 的结果）而不是 state.rows.length ——
       老师搜了"张三"、结果没这个人，此时导出也应当是空的。
       另外补一句 title，鼠标停上去就知道为什么点不动。 */
    dom.exportBtn.disabled = !rows.length;
    dom.exportBtn.title = rows.length
      ? '把当前表格里的 ' + rows.length + ' 行导出成 CSV（Excel 可直接打开）'
      : (state.rows.length ? '当前筛选下没有记录' : '后台还没有成绩');

    dom.tableHint.textContent = state.rows.length
      ? '显示 ' + rows.length + ' / ' + state.rows.length + ' 人'
      : '';
  }

  function updateSortArrows() {
    var ths = dom.theadRow.querySelectorAll('th');
    for (var i = 0; i < ths.length; i++) {
      var th = ths[i];
      var on = th.getAttribute('data-key') === state.sortKey;
      var arrow = th.querySelector('.arrow');
      if (arrow) th.removeChild(arrow);

      if (on) {
        th.setAttribute('aria-sort', state.sortDir > 0 ? 'ascending' : 'descending');
        th.appendChild(E('span', 'arrow', state.sortDir > 0 ? '▲' : '▼'));
      } else {
        th.removeAttribute('aria-sort');
      }
    }
  }

  function onHeadClick(ev) {
    var th = ev.target;
    while (th && th !== dom.theadRow && !th.getAttribute('data-key')) th = th.parentNode;
    if (!th || th === dom.theadRow) return;

    var key = th.getAttribute('data-key');
    if (!key) return;

    if (state.sortKey === key) {
      state.sortDir = -state.sortDir;      // 再点一下换方向
    } else {
      state.sortKey = key;
      state.sortDir = 1;
    }
    updateSortArrows();
    renderTable();
  }

  /* ==========================================================================
   * 8.1 导出全班 CSV（交付前清理 · 第 5 件事）
   *
   * 【为什么要有这个按钮】在这之前，老师的备份路线是"把表格整张选中、
   *   粘进 Excel"—— 能用，但很笨，而且一旦平台把容器重建（SQLite 没挂
   *   持久盘的话），数据就没了。一个导出按钮是【不依赖运维】的退路。
   *
   * 【导出哪些行】visibleRows() —— 就是表格里此刻显示的那些：
   *   模式筛选（标准版 / 快速版）和搜索框都算数，排序也照着来。
   *   老师筛了"快速版"却导出一个混着两种模式的文件，那才是坑。
   *
   * 【CSV 的几条硬要求】（照抄 js/submit.js 的 exportCsv，它已经被学生端验过）
   *   · 开头加 UTF-8 BOM —— 不加的话 Excel 打开中文姓名/学号是乱码。
   *     这是中文 CSV 唯一必踩的坑，别删。
   *   · 换行用 \r\n（RFC 4180）。
   *   · 含逗号/引号/换行格的单元格整体加引号、内部引号翻倍 ——
   *     学生姓名里出现逗号（"张,三"）不是不可能，逃逸一次的成本很低。
   *   · ★ 下载前必须 document.body.appendChild(a)：不挂进 DOM 的 <a>
   *     在部分浏览器上点了什么都不会发生。
   *
   * 【数值的格式】和表格一致，但走的是"给 Excel 用的写法"：
   *   表格里 c 写成 +0.30 / −0.22，CSV 里就是 0.3 / -0.22
   *   （留着正号 Excel 会当成文本，求和/排序都不认）；
   *   准确率折算成百分数（表头带 %，老师不用自己乘 100）。
   *   缺数据的格子写空串 —— 表格上显示的是"—"，但"—"进 Excel 是一列文本，
   *   反而挡住求和；留空更干净。
   *
   * ★ 这里没有复用 js/submit.js 的 buildCsv：那一份是"一个人一场实验"的
   *   一张表（从 Session 对象取数），这一份是"全班一人一行"（从后端 rows 取数），
   *   列都不一样。而且 admin.html 不加载 submit.js（教师端不玩游戏），
   *   引过来的话为了一个字符串函数要带进整个提交层。
   * ======================================================================== */

  // 单元格逃逸：含逗号 / 引号 / 换行就整体加引号，内部引号翻倍（RFC 4180）
  function csvCell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // 数值列：不是有限数就留空（缺数据的行不瞎补 0，理由同 normRow）
  function csvNum(v, digits) {
    if (!isNum(v)) return '';
    var p = Math.pow(10, digits === undefined ? 2 : digits);
    var x = Math.round(v * p) / p;
    return String(x === 0 ? 0 : x);     // 顺手把 −0 归一成 0
  }

  function csvPct(v) {
    if (!isNum(v)) return '';
    return csvNum(v * 100, 1);
  }

  // 表头 —— 列与表格一一对应（任务书 ⑤ 给定的那 16 列，顺序不许换）
  var CSV_HEADER = [
    '学号', '姓名', '模式',
    '第一轮d′', '第一轮c', '第一轮准确率%',
    '第二轮d′', '第二轮c', '第二轮准确率%',
    '第三轮d′', '第三轮c', '第三轮准确率%',
    '总d′', '总c', '总准确率%',
    '提交时间'
  ];

  function buildClassCsv(rows) {
    var lines = [CSV_HEADER.map(csvCell).join(',')];

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var cells = [
        r.studentId, r.studentName, MODE_LABEL[r.mode] || r.mode,
        csvNum(r.rounds[0].dPrime), csvNum(r.rounds[0].c, 2), csvPct(r.rounds[0].accuracy),
        csvNum(r.rounds[1].dPrime), csvNum(r.rounds[1].c, 2), csvPct(r.rounds[1].accuracy),
        csvNum(r.rounds[2].dPrime), csvNum(r.rounds[2].c, 2), csvPct(r.rounds[2].accuracy),
        csvNum(r.overallDPrime), csvNum(r.overallC, 2), csvPct(r.overallAccuracy),
        // 表格里显示的是"月-日 时:分"（fmtTime），CSV 里就给同一个读法，
        // 免得老师对着文件还要自己换算一遍时区。
        isNum(r.finishedAtMs) ? fmtTime(r.finishedAtMs) : r.finishedAt
      ];
      lines.push(cells.map(csvCell).join(','));
    }

    // BOM 在最前面，\r\n 是 CSV 规范
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  function csvFileName() {
    var d = new Date();
    return 'sdt-全班-' + d.getFullYear() + '-' +
           pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '.csv';
  }

  function downloadText(name, text) {
    // 没有文件 API 的环境（jsdom、老浏览器）→ 只把字符串交出去，不抛错
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' ||
        typeof URL.createObjectURL !== 'function') {
      return text;
    }
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var href = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);       // ★ 不挂进 DOM，某些浏览器点了不下载
    a.click();
    document.body.removeChild(a);
    // 立刻 revoke 在部分浏览器里会让下载中断，挪到下一个事件循环
    setTimeout(function () { URL.revokeObjectURL(href); }, 0);
    return text;
  }

  function onExportCsv() {
    var rows = visibleRows();

    if (!rows.length) {
      // 按钮平时是置灰的（renderTable 里同步），这里是兜底：
      // 空表也绝不下发一个只有表头的文件 —— 老师会以为"全班都没交"。
      setStatus(state.rows.length
        ? '当前筛选下没有记录，没有可导出的内容。'
        : '后台还没有成绩，没有可导出的内容。');
      return;
    }

    downloadText(csvFileName(), buildClassCsv(rows));
    setStatus('已导出 ' + rows.length + ' 人的成绩（' +
              (MODE_LABEL[state.mode] || state.mode) + '）。');
  }

  /* ==========================================================================
   * 9. 事件绑定与初始化
   * ======================================================================== */

  function bindEvents() {
    dom.loginForm.addEventListener('submit', onLoginSubmit);
    dom.logoutBtn.addEventListener('click', onLogout);
    dom.exportBtn.addEventListener('click', onExportCsv);
    dom.refreshBtn.addEventListener('click', function () { load(); });
    dom.retryBtn.addEventListener('click', function () { load(); });

    dom.modeSeg.addEventListener('click', function (ev) {
      var btn = ev.target;
      while (btn && btn !== dom.modeSeg && !btn.getAttribute('data-mode')) btn = btn.parentNode;
      if (!btn || btn === dom.modeSeg) return;

      var mode = btn.getAttribute('data-mode');
      if (mode === state.mode) return;
      state.mode = mode;

      var btns = dom.modeSeg.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('active', btns[i] === btn);
      }
      load();
    });

    dom.theadRow.addEventListener('click', onHeadClick);

    var t = null;
    dom.search.addEventListener('input', function () {
      var v = dom.search.value;
      if (t) clearTimeout(t);
      t = setTimeout(function () {          // 输入停顿一下再筛，别每敲一个字都重排整张表
        state.query = v;
        renderTable();
      }, 120);
    });
  }

  function init() {
    dom.gate = $('gate');
    dom.panel = $('panel');
    dom.loginForm = $('loginForm');
    dom.loginPassword = $('loginPassword');
    dom.loginBtn = $('loginBtn');
    dom.loginMsg = $('loginMsg');
    dom.modeSeg = $('modeSeg');
    dom.exportBtn = $('exportBtn');
    dom.refreshBtn = $('refreshBtn');
    dom.logoutBtn = $('logoutBtn');
    dom.status = $('status');
    dom.errBanner = $('errBanner');
    dom.errText = $('errText');
    dom.retryBtn = $('retryBtn');
    dom.tileN = $('tileN');
    dom.tileD = $('tileD');
    dom.tileC = $('tileC');
    dom.tileAcc = $('tileAcc');
    dom.chartRounds = $('chartRounds');
    dom.chartRoc = $('chartRoc');
    dom.chartHist = $('chartHist');
    dom.chartSys = $('chartSys');
    dom.capRounds = $('capRounds');
    dom.capRoc = $('capRoc');
    dom.capHist = $('capHist');
    dom.capSys = $('capSys');
    dom.search = $('search');
    dom.tableWrap = $('tableWrap');
    dom.tableHint = $('tableHint');
    dom.theadRow = $('theadRow');
    dom.tbody = $('tbody');

    bindEvents();
    updateSortArrows();

    // 一进来先把四个图容器铺上占位文案 —— 这样后端没起来时
    // 看到的是"还没有数据"，不是四个 340px 高的空白块（任务书自测第 1 条）
    renderEmpty('还没有数据 —— 登录并连上后端之后这里会画出图。');

    state.token = readToken();
    if (state.token) {
      showPanel();
      load();
    } else {
      showGate('');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* 给调试和联调用（控制台里能直接 Admin.load() 重取一次） */
  return {
    state: state,
    load: load,
    init: init
  };
})();
