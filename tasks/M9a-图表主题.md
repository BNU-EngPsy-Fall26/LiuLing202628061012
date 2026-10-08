# 任务书 M9a —— 图表主题（4 个面板共用）

> 开工前完整读 `CONTRACT.md` 的 **5.5 节**（图表接口）+ 2.2 节（配色变量）。

## 只改一个文件

`js/chart.js`（现在是占位文件，整个替换掉）。**不碰其他文件，不跑 git。**

## 为什么要有这个文件

另外 3 个会话正在并行写 4 个实验室面板，它们都要画图。
如果各写各的 ECharts 配置，**悬停提示的背景色、字体、配色会各不一样**，
四个面板看起来像四个不同的网站拼起来的。

统一走 `Chart.make()`，它们才像**一个系统**。

## 接口（契约 5.5）

```js
window.Chart = {
  make(dom, option),     // 建图，套统一主题，返回 ECharts 实例
  base(overrides),       // 返回套好主题的基础 option
  color(),               // → { primary, accent, normal, watch, danger, text, dim, grid }
};
```

### `Chart.color()`

**从 CSS 变量实时读取**，不许写死色值：

```js
var cs = getComputedStyle(document.documentElement);
cs.getPropertyValue('--c-primary').trim()   // → '#22B8CF'
```

变量名见契约 2.2。`grid` 用 `--c-border`。

### `Chart.base(overrides)`

返回一份 ECharts 的基础 option，调用方在上面覆盖。至少要把这些默认值定好：

- `textStyle.fontFamily` 用 `--font-sans`，`color` 用 `--c-text`
- **坐标轴的数字标签用 `--font-mono`**（和生命体征一致）
- `tooltip`：背景 `--c-surface-2`、边框 `--c-border`、文字 `--c-text`、
  `borderWidth: 1`、`transitionDuration: 0`
  —— **悬停提示是本项目特意要的效果，请确认它在深色底上清晰可读**
- `grid`：四周留白，别让坐标轴贴着边
- 默认色序：`primary` → `accent` → `watch` → `danger`

### `Chart.make(dom, option)`

1. 用 `echarts.init(dom)` 建图
2. `setOption(Object.assign(Chart.base(), option))`
3. **监听 `window.resize`**，容器宽度变了要 `instance.resize()`
   —— 不加这个，手机上图表会溢出
4. 返回实例

**★ 注意**：这个函数是在容器**已经可见**的时候被调用的（见契约 5.6 的说明），
所以不用处理"容器隐藏导致宽高为 0"的情况。但**如果 `dom` 的宽高是 0，请
`console.warn` 一句**，方便排查。

## 自测

写一个临时页（放 `/tmp`，不要进仓库），加载 `tokens.css` + echarts + chart.js，
画一条最简单的折线：

```js
var el = document.createElement('div');
el.className = 'chart';              // main.css 里定义好了，高 340px
document.body.appendChild(el);
Chart.make(el, {
  xAxis: { type: 'category', data: ['一', '二', '三'] },
  yAxis: { type: 'value' },
  series: [{ type: 'line', data: [1.5, 1.2, 2.8] }]
});
```

**验收**：
1. 折线画出来了，配色是青色系（不是 ECharts 默认的蓝紫）
2. 鼠标移到数据点上，**出现悬停提示**，提示框是深色底 + 细边框
3. 坐标轴数字是等宽字体
4. 把窗口从 1200px 拖到 400px，**图表跟着变窄，没有溢出、没有横向滚动条**
5. 控制台无红字

## 汇报

1. `js/chart.js` 多少行
2. 上面 5 条验收的自测结果（截图最好）
3. `Chart.color()` 实际返回的值
4. 你觉得哪一段最不确定
