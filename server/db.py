# -*- coding: utf-8 -*-
"""server/db.py —— SQLite 建表 / 读写（CONTRACT.md 6.2）

【这个文件干什么】
  只管一件事：把前端 POST 上来的一个 Session（契约 4.4）落进 sdt.db，
  以及把库里的行取出来给教师后台用。不碰 Flask、不碰 HTTP。

【为什么既有拆开的列、又存一整份 JSON】（契约 6.2 的说明）
  拆开的列给教师后台直接 SELECT 和画图用（快、好写）；
  payload 是保险 —— 以后想看"某个学生第三轮的漏报数"，
  不用改表结构，从 JSON 里取就行。

【表结构就是契约 6.2 那一份，一个字没加】——
  多一列就意味着 M13（教师后台）要跟着改，别顺手加。
"""

import json
import os
import sqlite3
from datetime import datetime, timezone

# 数据库文件放在 server/ 目录里。自测时可以设 SDT_DB_PATH 指到别处，
# 这样验"重复提交覆盖"的时候不会污染真库。
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get('SDT_DB_PATH') or os.path.join(BASE_DIR, 'sdt.db')

# 契约 6.2，逐字照抄
SCHEMA = """
CREATE TABLE IF NOT EXISTS results (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id      TEXT NOT NULL UNIQUE,     -- 学号，唯一键（重复提交走覆盖）
  student_name    TEXT NOT NULL,
  mode            TEXT NOT NULL,            -- 'standard' | 'quick'

  -- 三轮各自的 d′ / c / 准确率（教师后台画图主要用这几列）
  r1_dprime REAL, r1_c REAL, r1_accuracy REAL,
  r2_dprime REAL, r2_c REAL, r2_accuracy REAL,
  r3_dprime REAL, r3_c REAL, r3_accuracy REAL,

  -- 三轮合并
  overall_dprime   REAL,
  overall_c        REAL,
  overall_accuracy REAL,

  system_dprime   REAL,        -- ★ 系统设定的 d′（1.5）。

  started_at      TEXT,
  finished_at     TEXT,
  created_at      TEXT NOT NULL,

  payload         TEXT         -- ★ 完整 Session 的 JSON 原样存一份。
);
"""

# INSERT 和 DO UPDATE SET 里的列（顺序和下面的占位符一一对应）
_COLUMNS = [
    'student_id', 'student_name', 'mode',
    'r1_dprime', 'r1_c', 'r1_accuracy',
    'r2_dprime', 'r2_c', 'r2_accuracy',
    'r3_dprime', 'r3_c', 'r3_accuracy',
    'overall_dprime', 'overall_c', 'overall_accuracy',
    'system_dprime',
    'started_at', 'finished_at', 'created_at',
    'payload',
]

# ★ 重名覆盖不是新增（契约 6.1）：学生可能玩两遍，教师后台不该看到两条。
#   created_at 故意【不在】更新列表里 —— 它是"这一行第一次出现"的时刻；
#   教师后台要显示"提交时间"请用 finished_at，那个每次都会刷新。
UPSERT_SQL = """
INSERT INTO results ({cols})
VALUES ({marks})
ON CONFLICT(student_id) DO UPDATE SET
  {sets}
""".format(
    cols=', '.join(_COLUMNS),
    marks=', '.join(['?'] * len(_COLUMNS)),
    sets=',\n  '.join(
        '{0}=excluded.{0}'.format(c) for c in _COLUMNS
        if c not in ('student_id', 'created_at')
    ),
)


# ---------------------------------------------------------------------------
# 连接
# ---------------------------------------------------------------------------

def connect(path=None):
    """开一个连接（每次请求开一个，用完就关 —— 没有多线程共享连接的麻烦）。"""
    conn = sqlite3.connect(path or DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(path=None):
    """建表（IF NOT EXISTS，可以反复调）。返回连接，调用方负责关。"""
    conn = connect(path)
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def utc_now_iso():
    """created_at 用 UTC。前端给的 started_at / finished_at 是带时区的 ISO 串，原样存。"""
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


# ---------------------------------------------------------------------------
# 从 Session 里取数（一路 .get，缺字段不抛异常，宁可存 NULL 也别 500）
# ---------------------------------------------------------------------------

def _num(v):
    """只接受真数字；None / 字符串 / bool 一律当没有。"""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v)


def _text(v):
    return None if v is None else str(v)


def _round_metrics(session, i):
    """第 i 轮（0 基）的 (dPrime, c, accuracy)，缺了返回 (None, None, None)。"""
    rounds = session.get('rounds')
    if not isinstance(rounds, list) or i >= len(rounds):
        return (None, None, None)
    r = rounds[i] if isinstance(rounds[i], dict) else {}
    m = r.get('metrics') if isinstance(r.get('metrics'), dict) else {}
    return (_num(m.get('dPrime')), _num(m.get('c')), _num(m.get('accuracy')))


def _overall_metrics(session):
    o = session.get('overall') if isinstance(session.get('overall'), dict) else {}
    m = o.get('metrics') if isinstance(o.get('metrics'), dict) else {}
    return (_num(m.get('dPrime')), _num(m.get('c')), _num(m.get('accuracy')))


def _system_dprime(session):
    """系统设定的 d′：优先读第一轮自己记的 systemDPrime，再退到顶层的 D_PRIME。"""
    rounds = session.get('rounds')
    if isinstance(rounds, list) and rounds and isinstance(rounds[0], dict):
        v = _num(rounds[0].get('systemDPrime'))
        if v is not None:
            return v
    return _num(session.get('dPrime'))


def upsert_result(conn, session):
    """把一份 Session 写进 results。同一学号 → 覆盖那一行。"""
    r1 = _round_metrics(session, 0)
    r2 = _round_metrics(session, 1)
    r3 = _round_metrics(session, 2)
    ov = _overall_metrics(session)

    name = session.get('studentName')
    # 游客模式 studentName 是 null，而这一列是 NOT NULL —— 存空串，
    # 教师后台自己显示成「（未填姓名）」。
    row = [
        _text(session.get('studentId')),
        '' if name is None else str(name),
        _text(session.get('mode')),
        r1[0], r1[1], r1[2],
        r2[0], r2[1], r2[2],
        r3[0], r3[1], r3[2],
        ov[0], ov[1], ov[2],
        _system_dprime(session),
        _text(session.get('startedAt')),
        _text(session.get('finishedAt')),
        utc_now_iso(),
        json.dumps(session, ensure_ascii=False),
    ]

    conn.execute(UPSERT_SQL, row)
    conn.commit()
    return row[0]


# ---------------------------------------------------------------------------
# 读
# ---------------------------------------------------------------------------

def fetch_results(conn, mode='all'):
    """取成绩行。mode = 'all' | 'standard' | 'quick'。最新的排前面。"""
    sql = 'SELECT * FROM results'
    params = []
    if mode in ('standard', 'quick'):
        sql += ' WHERE mode = ?'
        params.append(mode)
    # finished_at 为 NULL 的排在最后（SQLite 里 NULL 最小，DESC 自然沉底）
    sql += ' ORDER BY finished_at DESC, id DESC'
    return [row_to_api(r) for r in conn.execute(sql, params).fetchall()]


def _payload_metrics(row):
    """从 payload JSON 里捞出各轮和合并的 pH / pFA。

    实体的表里没有 pH/pFA 两列（契约 6.2 没它们），但 M13 的图 2
    （班级 ROC 散点）要一人一个 (P(FA), P(H)) 点 —— 正好用 payload，
    这就是契约里那句"以后想加什么统计，不用改表结构"的用处。
    """
    try:
        session = json.loads(row['payload'] or '{}')
    except (ValueError, TypeError):
        return [None] * 3, (None, None)

    per_round = []
    rounds = session.get('rounds')
    for i in range(3):
        m = {}
        if isinstance(rounds, list) and i < len(rounds) and isinstance(rounds[i], dict):
            m = rounds[i].get('metrics') if isinstance(rounds[i].get('metrics'), dict) else {}
        per_round.append((_num(m.get('pH')), _num(m.get('pFA'))))

    o = session.get('overall') if isinstance(session.get('overall'), dict) else {}
    om = o.get('metrics') if isinstance(o.get('metrics'), dict) else {}
    return per_round, (_num(om.get('pH')), _num(om.get('pFA')))


def row_to_api(row):
    """DB 的一行 → 给教师后台的 JSON 对象。

    命名用 camelCase、和前端 Session（契约 4.4）保持一致 ——
    M13 拿到的字段名和它读 Store 时看到的是同一套，不用做名字翻译。

    ★ 拼写约定（契约 6.1「rows[] 字段名」那一段）：dPrime 的 P **大写**。
      overallDPrime / r1DPrime / systemDPrime 三处都是。
      第一版这里写成了小写 p，M13 那边按大写 P 取，字段名对不上，
      图 4「实测 d′ vs 系统 d′」一个点都画不出来 —— 就是这次修正的由来。
    """
    per_round, overall = _payload_metrics(row)

    out = {
        'id':          row['id'],
        'studentId':   row['student_id'],
        'studentName': row['student_name'],
        'mode':        row['mode'],
        'systemDPrime': row['system_dprime'],
        'startedAt':   row['started_at'],
        'finishedAt':  row['finished_at'],
        'createdAt':   row['created_at'],

        # ★ 完整 Session 的 JSON 原样带出来（契约 6.1 明令必须带）。
        #   拆开的列里没有的东西 —— 比如某一轮的漏报数 M ——
        #   教师后台要靠这份 JSON 兜底。不带的话那边会静默变成 null：
        #   不报错、不崩溃，就是悄悄少一块，最难查。
        'payload':     row['payload'],
    }

    for i in range(3):
        n = i + 1
        out['r%dDPrime' % n]   = row['r%d_dprime' % n]
        out['r%dC' % n]        = row['r%d_c' % n]
        out['r%dAccuracy' % n] = row['r%d_accuracy' % n]
        out['r%dPH' % n]       = per_round[i][0]
        out['r%dPFA' % n]      = per_round[i][1]

    out['overallDPrime']   = row['overall_dprime']
    out['overallC']        = row['overall_c']
    out['overallAccuracy'] = row['overall_accuracy']
    out['overallPH']       = overall[0]
    out['overallPFA']      = overall[1]

    return out
