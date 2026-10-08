/* ============================================================================
 * js/submit.js —— 前端调后端那一层（模块 M14）
 *
 * 【这个文件干什么】
 *   学生玩完一场之后，把 Session（契约 4.4）送到后端去。三件事：
 *     Submit.send(session)        → POST /api/submit（契约 6.1）
 *     Submit.save(session)        → 存 localStorage，后端没通时的兜底
 *     Submit.exportCsv(session)   → 生成 CSV 并触发下载
 *                                     （老师不用后端时，让学生交这个文件）
 *
 * 【★ 最重要的一条：成败都不许影响学生】
 *   后端挂了、断网了、老师忘记开服务 —— 学生照样要能一路玩到结果页。
 *   所以 send() 【永远不抛错、永远不 alert】，返回的 Promise 只会 resolve，
 *   永远不 reject。调用方可以完全不管它：
 *       Submit.send(session);     // 就这样，不用 .then 也不用 .catch
 *   要给学生看到"交上去了没有"的地方，再去看它 resolve 出来的 { ok, msg }。
 *
 * 【和其它模块的关系】
 *   收的是契约 4.4 的 Session 对象，不读 Store、不碰 DOM 以外的任何东西。
 *   index.html 还没引这个文件 —— 在结果页里插调用是后面独立的一步。
 * ==========================================================================*/

window.Submit = (function () {
  'use strict';

  /* --------------------------------------------------------------------------
   * 0. 配置
   * ------------------------------------------------------------------------ */

  // 默认同源（'' → '/api/submit'）。前端如果是从 file:// 打开、
  // 或者页面和 API 不在同一个端口，调一次 Submit.apiBase = 'http://127.0.0.1:5055'。
  //
  // ★ 本机上别写 'http://localhost:5055' —— macOS 的 AirPlay 接收器占着 5000 端口，
  //   localhost 会先解析到 ::1 打到它身上，回一个 403。写 127.0.0.1 才对得上 Flask。
  //
  // ★ 加了静态伺服之后，正常情况下【不用设 apiBase】—— 直接打开
  //   http://127.0.0.1:5055/ 就是同源的，相对路径自动就对。
  var apiBase = '';

  // localStorage 的键。整场实验只有一份，重复存就覆盖 ——
  // 它只是"后端没通"时的兜底，不是数据库。
  var STORAGE_KEY = 'sdt.session';

  function url(path) {
    return apiBase + path;
  }

  /* --------------------------------------------------------------------------
   * 1. send —— 把 Session POST 上去
   *
   * 契约 6.1 说得很清楚：这个调用是"发出去就不管了"。
   * 所以下面每一个可能出事的环节都各有一层兜底：
   *   · JSON.stringify 抛错（Session 里有循环引用）
   *   · fetch 本身同步抛错（环境不支持 / URL 非法）
   *   · 网络失败（后端没开）→ Promise reject
   *   · 后端回了非 JSON（500 的 HTML 错误页）
   * 四层都吃掉了，最后统一 resolve 成 { ok, msg }，绝不 reject。
   *
   * 返回值：Promise<{ ok:boolean, msg:string }> —— 只为"想显示状态"的调用方准备，
   * 不关心的话直接忽略。
   * ------------------------------------------------------------------------ */

  function send(session) {
    var payload;
    try {
      payload = JSON.stringify(session);
    } catch (e) {
      return Promise.resolve({ ok: false, msg: '成绩数据无法序列化，没有提交' });
    }
    if (!payload) {
      return Promise.resolve({ ok: false, msg: '没有可提交的成绩' });
    }

    try {
      return fetch(url('/api/submit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      })
        .then(function (res) {
          // 后端 500 时回的可能是 HTML，res.json() 会抛 —— 这里也吃掉
          return res.json().catch(function () { return {}; })
            .then(function (body) {
              var good = !!(body && body.ok);
              return {
                ok: good,
                msg: (body && body.msg) || (good ? '' : '服务器返回 ' + res.status),
              };
            });
        })
        .catch(function () {
          return { ok: false, msg: '连不上服务器，成绩没有交上去' };
        });
    } catch (e) {
      // 静默失败：不弹窗、不抛错、不打断学生
      return Promise.resolve({ ok: false, msg: '连不上服务器，成绩没有交上去' });
    }
  }

  /* --------------------------------------------------------------------------
   * 2. save / load / clear —— localStorage 兜底
   *
   * 隐私模式、磁盘配额满、file:// 下某些浏览器禁用 localStorage，
   * 都会让 setItem 抛异常。存不下就存不下，返回 false 让调用方知道，
   * 但绝不往外抛。
   * ------------------------------------------------------------------------ */

  function save(session) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      return true;
    } catch (e) {
      return false;
    }
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clear() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* --------------------------------------------------------------------------
   * 3. exportCsv —— 生成 CSV 字符串并触发下载
   *
   * 列（任务书定的）：学号、姓名、模式、三轮各自的 d′/c/准确率、合并的 d′/c/准确率。
   *
   * 两个细节：
   *   · 开头加 UTF-8 BOM —— 否则 Excel 打开中文姓名是乱码。
   *     这是中文 CSV 唯一必踩的坑，别删。
   *   · 准确率写成百分数（80.0 而不是 0.8），表头带 %，
   *     老师拿到的是一眼能读的表，不用自己乘 100。
   *
   * 返回值：CSV 字符串本身。浏览器里它同时会触发一次下载；
   * 在没有 Blob / createObjectURL 的环境（比如测试用的 jsdom）里
   * 只返回字符串、不下载，不会抛错。
   * ------------------------------------------------------------------------ */

  function r2(v, digits) {
    if (typeof v !== 'number' || !isFinite(v)) return '';
    var f = Math.pow(10, digits === undefined ? 2 : digits);
    var x = Math.round(v * f) / f;
    return String(x === 0 ? 0 : x);   // 顺手把 -0 归一成 0
  }

  function pct(v) {
    if (typeof v !== 'number' || !isFinite(v)) return '';
    return r2(v * 100, 1);
  }

  function cell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    // 含逗号/引号/换行就整体加引号，内部引号翻倍（RFC 4180）
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function roundMetrics(session, i) {
    var rounds = session && session.rounds;
    var r = (rounds && rounds[i]) || {};
    var m = r.metrics || {};
    return { dPrime: m.dPrime, c: m.c, accuracy: m.accuracy };
  }

  function modeLabel(mode) {
    var cfg = window.TRIAL_MODES && window.TRIAL_MODES[mode];
    return (cfg && cfg.label) || mode || '';
  }

  function buildCsv(session) {
    session = session || {};

    var header = [
      '学号', '姓名', '模式',
      '第一轮d′', '第一轮c', '第一轮准确率%',
      '第二轮d′', '第二轮c', '第二轮准确率%',
      '第三轮d′', '第三轮c', '第三轮准确率%',
      '合并d′', '合并c', '合并准确率%',
    ];

    var m1 = roundMetrics(session, 0);
    var m2 = roundMetrics(session, 1);
    var m3 = roundMetrics(session, 2);
    var om = (session.overall && session.overall.metrics) || {};

    var row = [
      session.studentId || '', session.studentName || '', modeLabel(session.mode),
      r2(m1.dPrime), r2(m1.c), pct(m1.accuracy),
      r2(m2.dPrime), r2(m2.c), pct(m2.accuracy),
      r2(m3.dPrime), r2(m3.c), pct(m3.accuracy),
      r2(om.dPrime), r2(om.c), pct(om.accuracy),
    ];

    // \r\n 是 CSV 规范；BOM 在最前面
    return '﻿' + header.map(cell).join(',') + '\r\n' + row.map(cell).join(',') + '\r\n';
  }

  function csvFileName(session) {
    var who = (session && session.studentId) ? session.studentId : 'guest';
    var d = new Date();
    var stamp = d.getFullYear() + '-' +
                ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
                ('0' + d.getDate()).slice(-2);
    return 'sdt-' + who + '-' + stamp + '.csv';
  }

  function exportCsv(session) {
    var csv = buildCsv(session);
    var name = csvFileName(session);

    // 没有文件 API 的环境（jsdom、老浏览器）→ 只把字符串交出去
    try {
      if (typeof Blob === 'undefined' ||
          typeof URL === 'undefined' ||
          typeof URL.createObjectURL !== 'function') {
        return csv;
      }
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var href = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = href;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 立刻 revoke 在部分浏览器里会让下载中断，挪到下一个事件循环
      setTimeout(function () { URL.revokeObjectURL(href); }, 0);
    } catch (e) {
      // 下载失败不影响返回值：调用方还可以自己拿这串 CSV 另存
    }
    return csv;
  }

  /* ------------------------------------------------------------------------ */

  return {
    send: send,
    save: save,
    load: load,
    clear: clear,
    exportCsv: exportCsv,

    // 建 CSV 字符串本身（exportCsv 内部用它；单独暴露方便自测和预览）
    buildCsv: buildCsv,
    fileName: csvFileName,

    get apiBase() { return apiBase; },
    set apiBase(v) { apiBase = v || ''; },

    storageKey: STORAGE_KEY,
  };

})();
