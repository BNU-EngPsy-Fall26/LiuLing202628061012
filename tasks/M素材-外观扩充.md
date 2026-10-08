# 任务书 · 素材扩充 —— 给患者加一行「来院方式」

> 给施工队的指令。开工前请先完整读 `CONTRACT.md`（重点：**3.3.1**、4.1、5.1、第 8 节铁律）
> 和 **`js/patient-data.js` 全文**（素材已经写好了，**只读不改**）。

## 为什么要做这件事

玩家反馈：标准版 90 次判断里，同一条主诉平均要出现 2.5 次，玩起来在重复。

`js/patient-data.js` 里已经加好了两样东西（你不用写内容，直接用）：

- `PatientData.complaints` —— 每档从 12 条扩到 **18 条**
- `PatientData.arrivals` —— **新加的**，每档 12 条来院方式描述
- `PatientData.arrivalRules` —— 来院方式的分档规则

**你要做的是把它们接进 `generate()` 和 `render()`。**

## 只改这两个文件

| 文件 | 改什么 |
|---|---|
| `js/patient.js` | `generate()` 多产出一个 `arrival` 字段 |
| `js/patient-card.js` | `render()` 把这一行显示出来 |

**别的一律不碰**，尤其不许改 `js/patient-data.js`（素材和规则都在里面，是唯一的真源）。
不跑 git。

---

## 一、`js/patient.js`：generate() 多抽一个 arrival

### 接口不变

```js
window.PatientGen = {
  generate: function (opts) { ... }   // → Patient，但多一个 arrival 字段
};
```

`Patient` 的新结构见契约 4.1，`arrival` 加在 `chiefComplaint` 后面。

### 抽取逻辑

**和主诉的机制完全一样，只是读的规则对象不同：**

| | 主诉 | 来院方式 |
|---|---|---|
| 素材池 | `PatientData.complaints` | `PatientData.arrivals` |
| 规则 | `PatientData.tierRules` | `PatientData.arrivalRules` |

两套规则结构完全一致（`bounds` / `order` / `adjacentChance`），
所以**你应该把"按 severity 定档 + 相邻档漂移 + 从池里抽一条"这段逻辑抽成一个函数**，
主诉和来院方式各调一次，只是传入不同的池子和规则对象。

**别把这段逻辑复制两遍** —— 复制出来的两份迟早会有人只改其中一份。

### ★ 铁律

这一行**绝对不许按 `hasSignal` 分档**。信号患者和噪音患者走完全相同的抽取路径，
唯一的差别就是传进去的 `severity` 数值不同。

写完之后，`grep -n "hasSignal" js/patient.js` 应该仍然是**只有 3 行**
（读 opts、采 severity、返回值带出去）。多了就是出问题了。

### rng 消耗会变

多抽一次来院方式会多消耗几次 `rng.next()`。**这是预期的**，
但请重新确认：**同一种子跑两次，结果仍然逐字节一致。**

---

## 二、`js/patient-card.js`：把这一行画出来

### 位置

紧挨在主诉下面、生命体征上面：

```
┌──────────────────────────────────────────────┐
│  P-0423  王先生  54 岁  男                     │   ← 小字，--c-text-dim
├──────────────────────────────────────────────┤
│  胸痛两小时，压榨样，往左肩放射，出了一身冷汗    │   ← 主诉，正文字号
│  由家属搀扶进入，面色苍白                       │   ← ★ 新增这一行
├──────────────────────────────────────────────┤
│  体温      心率      血压       血氧    意识    │
│  36.9°C    118       96/62      93%     嗜睡    │
└──────────────────────────────────────────────┘
```

### 样式要求

- **字号比主诉小一号**，颜色用 `--c-text-dim`（次要文字色）
  —— 它是辅助信息，不能和主诉抢注意力
- **不要给它加任何颜色分档**。来院方式是文字，没有"数值偏离"这回事，
  所以**不适用**契约 2.4 的生命体征分档规则。整行统一用 `--c-text-dim`。
- 主诉区原本就有"固定最小高度约 3 行"的要求，现在**主诉 + 来院方式合起来**
  要有固定的最小高度，否则不同长度的文字会让下面的生命体征上下跳动。
  **这一条请重点自测**（见下）。

### 判断态和反馈态都要显示

`arrival` 是患者卡片的一部分，`reveal: false` 和 `reveal: true` 都要画。
它不参与"真实情况"的揭示，所以在两种状态下**长得一模一样**。

---

## 三、自测（做完必须自己跑一遍再交）

### ① 来院方式的分档分布

在浏览器控制台跑，各 5000 次：

```js
var tier = function (p) {
  for (var t of ['mild','mid','severe'])
    if (PatientData.arrivals[t].indexOf(p.arrival) >= 0) return t;
  return '??';
};
function dist(hasSignal) {
  var c = { mild: 0, mid: 0, severe: 0 };
  for (var i = 0; i < 5000; i++) c[tier(PatientGen.generate({hasSignal:hasSignal, dPrime:1.5}))]++;
  return c;
}
console.log('信号组', dist(true));
console.log('噪音组', dist(false));
```

**期望**：信号组偏向 severe/mid，噪音组偏向 mild/mid，**但两组有大量交叉**。
（因为 `adjacentChance` 是 0.50，交叉会比主诉更明显 —— 这是故意的。）

**如果两组几乎分得开**，说明你没读 `arrivalRules.adjacentChance`，
或者把它写成 0 了。

### ② ★ 铁律自查（和 M5 那次一样）

把同一个患者的 `hasSignal` 从 `true` 改成 `false`，重渲染，
**判断态的 DOM 必须一字不差**（`innerHTML` 字符串相等）。

带 `arrival` 之后还要再确认一遍。

### ③ 布局不跳动

连着渲染 20 个随机患者，观察生命体征那一行的 **y 坐标**
（`getBoundingClientRect().top`）**必须完全不变**。

```js
var box = document.createElement('div');
document.getElementById('screen-game').appendChild(box);
var tops = [];
for (var i = 0; i < 20; i++) {
  PatientCard.render(box, PatientGen.generate({hasSignal:i%2===0, dPrime:1.5}), {reveal:false});
  tops.push(box.querySelector('.vitals').getBoundingClientRect().top);
}
console.log('体征行 top 是否全相同：', new Set(tops).size === 1);
```

（`.vitals` 这个类名以你实际写的为准。）

### ④ rng 可复现性

同一种子跑两次，`JSON.stringify` 结果相等。

### ⑤ 契约 3.6 那三组数不受影响

`scoring.js` 只吃 Trial 的 outcome，不该受这次改动影响。
顺便确认一下你的改动没有波及它。

---

## 四、汇报什么

1. 改了哪两个文件、各多少行
2. 上面 5 项自测的实际输出
3. `grep -n "hasSignal" js/patient.js` 的输出（应该还是 3 行）
4. 你觉得哪一段最不确定

## 五、不做的事

- **不改** `js/patient-data.js`（素材已经写好了）
- **不改** `index.html`、`styles/`、`CONTRACT.md`
- **不改** `js/engine.js`（它调用 `generate()` 的签名没变，不用动）
- 不跑 git

---

## 附：校准提醒（做完之后要做的事）

加这一行等于**多给玩家一条线索**，可能让游戏变简单。

做完之后我会让玩家玩一局，在控制台读：

```js
Store.rounds.map(r => +r.metrics.dPrime.toFixed(2))
```

- 还在 **1.3 ~ 1.5** → 合适
- 涨到 **1.8 以上** → 把 `PatientData.arrivalRules.adjacentChance` 调到 0.8 或 1.0

**这一步不用你做**，我只是告诉你为什么这个值设成 0.50 而不是 0.30。
