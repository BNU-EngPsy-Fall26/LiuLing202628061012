/* ============================================================================
 * js/chart.js —— ECharts 薄封装：统一主题 + 窗口自适应
 *
 * 接口见 CONTRACT.md 5.5：
 *   Chart.make(dom, option)   建图，套统一主题，返回 ECharts 实例
 *   Chart.base(overrides)     返回一份套好主题的基础 option，调用方在上面覆盖
 *   Chart.color()             从 CSS 变量实时读出的主题色
 *
 * 【这个文件为什么存在】
 *   概念实验室 4 个面板都要画图。各写各的 ECharts 配置，
 *   悬停提示的背景色、字体、配色就会各不一样，4 个面板看起来
 *   像四个不同的网站拼起来的。统一走 Chart.make()，它们才像一个系统。
 *
 * 【三条规矩】
 *   1. 颜色一律从 CSS 变量实时读取（改 tokens.css，图表跟着变），
 *      本文件不写死任何品牌色 / 语义色。
 *   2. ECharts 从 js/vendor/echarts.min.js（本地文件）加载，绝不引 CDN。
 *   3. 不要在模块顶层调 Chart.make()：容器藏着的时候宽高是 0，
 *      图会建成 0×0。要写在 render() 里（契约 5.6）。
 * ==========================================================================*/

window.Chart = (function () {
  'use strict';

  /* ==========================================================================
   * 1. 读 CSS 变量
   *
   * 颜色 / 字体都从 tokens.css 实时读，本文件里一个色值都不写。
   * 读不到（tokens.css 没加载）就 console.warn 一句并退回 ECharts 默认值——
   * 不静默兜底成某个写死的颜色，否则问题会被藏起来。
   * ======================================================================== */

  var warned = {};

  function warnOnce(key, msg) {
    if (warned[key]) return;
    warned[key] = true;
    console.warn(msg);
  }

  function cssVar(cs, name) {
    var v = cs.getPropertyValue(name).trim();
    if (!v) {
      warnOnce('var:' + name,
        '[Chart] CSS 变量 ' + name + ' 读不到值 —— 检查 tokens.css 有没有加载成功。' +
        '这一处会退回 ECharts 默认样式。');
    }
    return v;
  }

  function css() {
    return getComputedStyle(document.documentElement);
  }

  // 契约 5.5 规定的 8 个键，一个不多一个不少
  function color() {
    var cs = css();
    return {
      primary: cssVar(cs, '--c-primary'),
      accent:  cssVar(cs, '--c-accent'),
      normal:  cssVar(cs, '--c-normal'),
      watch:   cssVar(cs, '--c-watch'),
      danger:  cssVar(cs, '--c-danger'),
      text:    cssVar(cs, '--c-text'),
      dim:     cssVar(cs, '--c-text-dim'),
      grid:    cssVar(cs, '--c-border')
    };
  }

  /* 给一个颜色加透明度。只做格式换算，不引入新色值。
     认不出来（比如 currentColor）就原样返回，让 ECharts 自己处理。 */
  function withAlpha(c, alpha) {
    var s = String(c).trim();

    var hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (hex) {
      var h = hex[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
    }

    var rgb = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (rgb) {
      var p = rgb[1].split(',').slice(0, 3);
      if (p.length === 3) return 'rgba(' + p.join(',') + ',' + alpha + ')';
    }

    return c;
  }

  /* ==========================================================================
   * 2. 深合并
   *
   * 契约里写的是 Object.assign(base, option)，但那是浅合并：
   * 面板只要写了 tooltip:{ trigger:'axis' }，整个套好主题的 tooltip
   * 就被顶掉了，又变回 ECharts 默认的白底提示框——正是本文件要防的事。
   * 所以这里做深合并：嵌套对象逐层并，数组 / 函数 / 原始值整体覆盖
   * （series、data 这类数组必须整体替换，不能拼接）。
   * ======================================================================== */

  function isPlainObject(v) {
    return Object.prototype.toString.call(v) === '[object Object]';
  }

  function clone(v) {
    if (Array.isArray(v)) {
      return v.map(clone);
    }
    if (isPlainObject(v)) {
      var o = {};
      Object.keys(v).forEach(function (k) { o[k] = clone(v[k]); });
      return o;
    }
    return v;
  }

  // 返回新对象，不修改 target / source
  function mergeTheme(target, source) {
    var out = isPlainObject(target) ? clone(target) : {};
    if (!isPlainObject(source)) return out;

    Object.keys(source).forEach(function (k) {
      var sv = source[k];
      if (isPlainObject(sv) && isPlainObject(out[k])) {
        out[k] = mergeTheme(out[k], sv);
      } else {
        out[k] = clone(sv);
      }
    });
    return out;
  }

  /* ==========================================================================
   * 3. 基础 option
   * ======================================================================== */

  // 坐标轴的统一外观：轴线和网格线走 --c-border，标签走 --c-text-dim，
  // 数字一律 --font-mono（和生命体征一致，数字不会左右跳）。
  function axisTheme(c, mono, sans) {
    return {
      axisLine:  { lineStyle: { color: c.grid } },
      axisTick:  { lineStyle: { color: c.grid } },
      axisLabel: { color: c.dim, fontFamily: mono, fontSize: 12, margin: 8 },
      nameTextStyle: { color: c.dim, fontFamily: sans, fontSize: 12 },
      // 只定颜色，不定 show —— 让它保持 ECharts 的默认（数值轴有网格线、
      // 类目轴没有）。类目轴也画满竖线是纯粹的噪音。
      splitLine: { lineStyle: { color: c.grid, width: 1, type: 'solid' } }
    };
  }

  // 调用方给的轴可能是对象，也可能是数组。数组要一轴一轴地套主题，
  // 否则双轴图上会有一根轴偷偷用回 ECharts 默认样式。
  function withAxisTheme(userAxis, defaults) {
    if (Array.isArray(userAxis)) {
      return userAxis.map(function (a) { return mergeTheme(defaults, a); });
    }
    return mergeTheme(defaults, userAxis);
  }

  function base(overrides) {
    var cs = css();
    var c = color();
    var sans = cssVar(cs, '--font-sans');
    var mono = cssVar(cs, '--font-mono');

    var theme = {
      // 默认色序（契约 5.5）：primary → accent → watch → danger
      color: [c.primary, c.accent, c.watch, c.danger],

      textStyle: { fontFamily: sans, color: c.text, fontSize: 13 },

      // 标题 / 图例也统一，否则 4 个面板各写各的又不一样了
      title: {
        textStyle: { color: c.text, fontFamily: sans, fontSize: 15, fontWeight: 600 },
        subtextStyle: { color: c.dim, fontFamily: sans, fontSize: 12 }
      },
      legend: {
        textStyle: { color: c.dim, fontFamily: sans, fontSize: 12 }
      },

      /* 悬停提示 —— 本项目特意要的效果。
         深色底上的难点是「提示框和图表底一样黑，糊在一起」，
         所以：底色用比卡片亮一档的 --c-surface-2、加一条 --c-border 细边、
         再补一层投影把它从图表上抬起来。transitionDuration:0 让它跟手，不拖影。 */
      tooltip: {
        backgroundColor: cssVar(cs, '--c-surface-2'),
        borderColor: c.grid,
        borderWidth: 1,
        padding: [6, 10],
        textStyle: { color: c.text, fontFamily: sans, fontSize: 13 },
        transitionDuration: 0,
        extraCssText: 'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);',
        axisPointer: {
          lineStyle:  { color: c.dim, width: 1, type: 'dashed' },
          crossStyle: { color: c.dim, width: 1, type: 'dashed' },
          shadowStyle: { color: withAlpha(c.primary, 0.08) },
          label: {
            backgroundColor: c.grid, borderWidth: 0,
            color: c.text, fontFamily: mono, fontSize: 11
          }
        }
      },

      // 四周留白，别让坐标轴贴着容器边
      grid: { left: 8, right: 20, top: 36, bottom: 8, containLabel: true }
    };

    var merged = mergeTheme(theme, overrides);

    // 只有调用方真的画了坐标系，才给它注入轴样式。
    // 无条件塞 xAxis/yAxis 的话，饼图之类也会凭空长出一套网格。
    if (merged.xAxis) merged.xAxis = withAxisTheme(merged.xAxis, axisTheme(c, mono, sans));
    if (merged.yAxis) merged.yAxis = withAxisTheme(merged.yAxis, axisTheme(c, mono, sans));

    return merged;
  }

  /* ==========================================================================
   * 4. 建图 + 自适应
   * ======================================================================== */

  // 活着的图：[{ inst, ro, w, h }]
  //   ro = ResizeObserver（没有就 null）
  //   w/h = 上次同步过的容器尺寸，尺寸没变就不 resize ——
  //         一来省事，二来挡住 ResizeObserver 的循环回调
  //         （resize 会动 canvas，canvas 又可能被观察者看到）。
  var live = [];

  function recOf(inst) {
    for (var i = 0; i < live.length; i++) {
      if (live[i].inst === inst) return live[i];
    }
    return null;
  }

  function drop(rec) {
    var i = live.indexOf(rec);
    if (i >= 0) live.splice(i, 1);
    if (rec.ro) { rec.ro.disconnect(); rec.ro = null; }
  }

  /* 把图表尺寸对齐到容器。
     容器藏着（display:none）时宽高是 0，这时调 resize() 会把 canvas
     压成 0×0，切回来就是一片空白 —— 所以宽高为 0 直接跳过，等它显形再说。 */
  function fit(rec) {
    var inst = rec.inst;
    if (inst.isDisposed()) { drop(rec); return; }

    var dom = inst.getDom();
    var w = dom.clientWidth;
    var h = dom.clientHeight;
    if (!w || !h) return;

    if (rec.w === w && rec.h === h) return;
    rec.w = w;
    rec.h = h;
    inst.resize();
  }

  window.addEventListener('resize', function () {
    // 倒着走：fit() 可能把已经销毁的图从 live 里摘掉
    for (var i = live.length - 1; i >= 0; i--) {
      if (i < live.length) fit(live[i]);
    }
  });

  function make(dom, option) {
    if (!dom) {
      console.warn('[Chart] make() 没拿到容器元素，跳过。');
      return null;
    }
    if (typeof echarts === 'undefined' || !echarts.init) {
      console.warn('[Chart] 找不到 echarts —— 检查 index.html 里 ' +
        'js/vendor/echarts.min.js 有没有加载成功。');
      return null;
    }

    var w = dom.clientWidth;
    var h = dom.clientHeight;
    if (!w || !h) {
      console.warn('[Chart] 容器 #' + (dom.id || '(无 id)') + ' 的宽高是 ' +
        w + '×' + h + ' —— 容器可能还藏着（display:none）。' +
        '图表会画成空白，请等容器可见后再调 make()（契约 5.6）。');
    }

    // 同一个容器建第二次（面板重渲染）时先销毁旧实例，
    // 否则 ECharts 会报 "There is a chart instance already initialized on the dom"。
    var old = echarts.getInstanceByDom(dom);
    if (old) {
      var oldRec = recOf(old);
      if (oldRec) drop(oldRec);
      old.dispose();
    }

    var inst = echarts.init(dom);
    inst.setOption(base(option), true);

    var rec = { inst: inst, ro: null, w: 0, h: 0 };
    live.push(rec);

    /* 窗口 resize 之外再挂一个 ResizeObserver，是因为本项目的面板是
       用 display 切换的：图表在 A 面板，用户切到 B、把窗口拉窄、再切回 A，
       A 藏在 display:none 里收不到有效通知，切回来尺寸还是旧的
       （比容器宽 → 横向滚动条）。容器从 0 变成有尺寸时 RO 会回调，
       正好补上这一下。老浏览器没有 RO 就只靠上面的 resize 兜着。 */
    if (typeof ResizeObserver === 'function') {
      rec.ro = new ResizeObserver(function () { fit(rec); });
      rec.ro.observe(dom);
    }

    return inst;
  }

  return {
    make: make,
    base: base,
    color: color
  };
})();
