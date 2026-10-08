# server/ —— 后端 API（M14）

急诊分诊台的后端：Python 3 + Flask + SQLite。**只是 M15 部署那一步的原料，现在还没上线。**

## 跑起来

```bash
cd server
pip3 install -r requirements.txt
python3 app.py            # → http://127.0.0.1:5055
```

数据库文件 `server/sdt.db` 第一次启动时自动建出来，**不进 git**（已在 .gitignore 里）。

### 端口：默认 5055，要改用 `SDT_PORT`

**默认不是 5000** —— macOS 的「隔空播放接收器」（`ControlCenter` 进程）常年占着 5000，
用它起步就是 `Address already in use`。所以默认换成 5055：

```bash
python3 app.py                  # 5055
SDT_PORT=8000 python3 app.py    # 临时换端口
```

此外，访问时**用 `127.0.0.1` 而不是 `localhost`**：macOS 上 `localhost` 会先解析到 `::1`，
另有一堆东西（AirPlay 就在其中）盯着回环地址，`127.0.0.1` 最不容易撞车。

## ⚠️ 部署前必须做的一件事：改口令

教师口令从环境变量读，代码里那个 `admin123` 只是**本地开发的默认值**：

```python
ADMIN_PASSWORD = os.environ.get('SDT_ADMIN_PASSWORD', 'admin123')
```

**部署前必须在服务器上设环境变量**，否则任何看了这份源码的人都知道口令：

```bash
export SDT_ADMIN_PASSWORD='换成一个只有老师知道的口令'
python3 app.py
```

（这条和 CONTRACT.md 第 9 节「教师后台有口令保护，且口令不在前端代码里明文出现」
是同一条要求。前端 `admin.html` 只负责把老师输入的口令 POST 上来，不存口令。）

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `SDT_ADMIN_PASSWORD` | `admin123` | 教师口令。★ 部署前必改 |
| `SDT_PORT` | `5055` | 监听端口（5000 被 macOS AirPlay 占着） |
| `SDT_DB_PATH` | `server/sdt.db` | 数据库路径。自测时指到临时文件，别污染真库 |

## 接口

响应格式统一 `{ ok: true, ... }` / `{ ok: false, msg: '中文提示' }`，失败用 400 / 401 / 500。

| 方法 | 路径 | 入参 | 返回 | 鉴权 |
|---|---|---|---|---|
| POST | `/api/login` | `{ studentId, name }` | `{ ok, student:{id,name} }` | 无 |
| POST | `/api/submit` | 一个 Session（契约 4.4） | `{ ok }` | 无 |
| POST | `/api/admin/login` | `{ password }` | `{ ok, token }` | 无 |
| GET | `/api/admin/results` | `?mode=all\|standard\|quick` | `{ ok, rows:[...] }` | Bearer token |
| GET | `/api/admin/summary` | `?mode=all\|standard\|quick` | `{ ok, summary:{...} }` | Bearer token |

鉴权：`Authorization: Bearer <token>`。token 由 `/api/admin/login` 用口令换来，
**只存在进程内存里**（`VALID_TOKENS`），重启服务就全部失效，老师重新输一次口令即可。

### 校验与覆盖规则

- `/api/submit`：`studentId` / `mode` / `rounds` 缺一个 → 400；`mode` 不是
  `standard`/`quick` → 400；`rounds` 不是**长度 3** 的数组 → 400（契约 4.4 规定恒为 3）。
- **同一个 `studentId` 重复提交 → 覆盖那一行**，不是新增。
  `created_at` 保持第一次入库的时刻；要看"最近一次提交时间"请用 `finished_at`。
- 口令错误只回「口令错误」，不回显任何与口令有关的信息。

## `rows[]` 里每一行长什么样（★ 写 M13 的人看这一段）

字段名用 camelCase，和前端 Session（契约 4.4）是同一套命名，不用做名字翻译。
**★ `dPrime` 的 P 一律大写** —— 全项目只有一个约定，别写成 `Dprime`。

```js
{
  id, studentId, studentName, mode,
  r1DPrime, r1C, r1Accuracy, r1PH, r1PFA,   // 第 1 轮
  r2DPrime, r2C, r2Accuracy, r2PH, r2PFA,   // 第 2 轮
  r3DPrime, r3C, r3Accuracy, r3PH, r3PFA,   // 第 3 轮
  overallDPrime, overallC, overallAccuracy, overallPH, overallPFA,
  systemDPrime,        // 系统设定的 d′（1.5）—— 图 4「实测 vs 系统」的横轴
  startedAt, finishedAt, createdAt,          // ISO 字符串
  payload,             // ★ 完整 Session 的 JSON 字符串（数据库 payload 那一列原样带出）
}
```

- **`payload` 必须带上**：拆开的列里没有的东西（比如某一轮的漏报数 M）要从它兜底。
  不带的话那边会**静默变成 null** —— 不报错、不崩溃，就是悄悄少一块。
- `PH` / `PFA` 是击中率 / 误报率，后端从 `payload` 的 JSON 里现取（契约 6.2 的表里没有这两列）
  —— **图 2「班级 ROC 散点」就用 `r1PH/r2PH/r3PH` 对 `r1PFA/r2PFA/r3PFA`**。
- 缺失值时是 `null`，画图前先过滤掉。
- 游客模式（没填姓名）`studentName` 是空串 `''`，显示时自己给个「（未填姓名）」。
- 行按 `finished_at` 倒序（最新提交的在最前面）。

## `summary` 的结构

```js
{
  ok: true,
  summary: {
    n: 42,                                  // 当前筛选下交成绩的人数
    byMode: { standard: 30, quick: 12 },
    dprime:   { mean, sd, values: [...] },  // 三轮合并的 d′，一人一个值（图 3 直方图）
    c:        { mean, sd, values: [...] },
    accuracy: { mean, sd, values: [...] },  // 0~1 的小数，显示时 ×100
    rounds: [                               // ★ 图 1 的原料
      { round: 1, dprimeMean, cMean, accuracyMean },
      { round: 2, dprimeMean, cMean, accuracyMean },
      { round: 3, dprimeMean, cMean, accuracyMean },
    ],
  }
}
```

- **这一层的键名和 `rows[]` 不是一套，别改混了**：`summary.dprime`（小写 d）、
  `rounds[].dprimeMean` 是**统计量的名字**，不是 Session 里的字段。契约 6.1 就是这么定的。
- **`summary` 的每一项都跟着 `?mode=` 过滤走**。选了「快速版」，`n`、均值、`rounds`
  都只统计快速版的人；`byMode` 也按同一批人算，所以恒有
  `n === byMode.standard + byMode.quick`。
- **★ 空库语义（前端要按这个判）**：
  - **一个值都没有** → `mean` / `sd` 都是 **`null`**，`values` 是 `[]`；
    `n = 0` 时 `rounds` 里的三个均值**也是 `null`**。
    「还没有人交卷」和「全班 d′ 是 0」是两件不同的事实，别都显示成 `0.00`
    —— 老师会以为这个班完全分不清危重患者。**前端见 null 就显示「暂无数据」。**
  - **只有一个样本** → `sd` 仍然是 **`0.0`**（样本只有一个，离散度确实是 0）。
    只有零个样本才是 null，这两个不一样。
- 均值一律留 3 位小数。
- `rounds` 长度恒为 3（前端可以直接按 3 轮画图）。

## 自测（curl）

```bash
cd server
python3 app.py                       # 一个终端，起在 5055

curl -s -X POST 127.0.0.1:5055/api/admin/login \
  -H 'Content-Type: application/json' -d '{"password":"admin123"}'

# 空库语义（一份成绩都没有时 mean/sd 应该是 null，不是 0.0）
SDT_DB_PATH=/tmp/empty-test.db python3 app.py
```

完整的 7 条自测命令见 `tasks/M14-后端.md` 的「自测」一节。
