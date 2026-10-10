# -*- coding: utf-8 -*-
"""server/app.py —— 急诊分诊台 后端 API + 静态伺服（CONTRACT.md 6.1）

技术栈：Python 3 + Flask + SQLite。只有两个依赖：flask / flask-cors。

【跑起来】
    pip3 install flask flask-cors
    python3 app.py                    # 默认 http://127.0.0.1:5055
                                      # （★ 不是 5000 —— macOS 的 AirPlay 接收器占着它）
                                      改端口：SDT_PORT=8000 python3 app.py

【★ 一个进程带走全部：接口 + 两个页面 + 静态资源都在这个端口上】
    http://127.0.0.1:5055/            学生端 index.html
    http://127.0.0.1:5055/admin.html  教师端（老师用的那个网址）
    http://127.0.0.1:5055/js/…        静态资源
    http://127.0.0.1:5055/api/…       接口
  同源之后前端那几个相对路径 '/api/...' 直接就对，本机验收不用再起
  python -m http.server、也不用反代。M15 部署要的就是这个形态。

【响应格式统一】{ ok: true, ... } / { ok: false, msg: '中文提示' }
  失败用 400 / 401 / 500 —— 契约 6.1 定的。

【四个安全上的约定】
  1. 教师口令从环境变量 SDT_ADMIN_PASSWORD 读，代码里那个 'admin123' 只是
     本地开发的默认值，★ 部署前必须改（见 server/README.md）。
  2. token 只放内存（VALID_TOKENS 集合），进程重启就失效 —— 作业场景够用。
  3. 口令错了只回"口令错误"，绝不回显"你输的 xxx 不对"或透露口令本身。
  4. ★ 静态文件走**白名单**：只放行 js/、styles/ 和两个 .html 根文件。
     后端自己的代码（server/）、数据库、任务书、契约一律 404 ——
     这些东西能被人下载走就是事故（见本文件最后一节）。
"""

import os
import secrets
import sqlite3
import statistics
from functools import wraps

from flask import Flask, abort, jsonify, request, send_from_directory
from flask_cors import CORS

import db

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------

# ★★ 部署前必须改成环境变量 ★★
#      export SDT_ADMIN_PASSWORD='你们班的口令'
#   这里的默认值只为了本机开发时不用先配环境变量。
#   作业场景下也请别再写回代码里 —— 学生翻得到这份源码。
ADMIN_PASSWORD = os.environ.get('SDT_ADMIN_PASSWORD', 'admin123')

# token 只放内存：重启即失效，不落盘、不进数据库。
#
# ★★ 正因为这个集合是【进程级】的，gunicorn 必须只开 1 个 worker ★★
#   一旦写 --workers 4，老师点登录时 token 存在 worker 1 的内存里，
#   下一次请求被分到 worker 3 → 不认这个 token → 后台「随机掉线」，
#   四分之三的请求都会掉，症状像网络问题，极难查。
#   要并发就加 --threads（线程共享同一份内存，安全）。
#   详见 docs/部署手册-自有服务器.md 第 6.2 节。
VALID_TOKENS = set()

VALID_MODES = ('standard', 'quick')

# 监听端口。★ 默认 5055 不是 5000 —— macOS 的 AirPlay 接收器（ControlCenter）
# 常年占着 5000，用它起步就是 Address already in use。要改端口设 SDT_PORT。
PORT = int(os.environ.get('SDT_PORT', 5055))

app = Flask(__name__)
CORS(app)          # 开发时前端可能是 file:// 或别的端口，全放开（作业场景）

# jsonify 默认把中文转义成 \uXXXX（契约 6.1 提到参考站也是这个行为）。
# ★ 这不是乱码：浏览器 JSON.parse 出来就是正常中文，别把它"修"成 ensure_ascii=False。

# 建表。放在模块层面：无论用 python3 app.py 跑还是被测试 import 都会建。
db.init_db().close()


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------

def ok(**data):
    body = {'ok': True}
    body.update(data)
    return jsonify(body)


def fail(msg, code=400):
    return jsonify({'ok': False, 'msg': msg}), code


def body_json():
    """取请求体。不是 JSON 对象就返回 None（由各路由自己回 400）。"""
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else None


def bearer_token():
    h = request.headers.get('Authorization', '')
    if not h.startswith('Bearer '):
        return None
    return h[len('Bearer '):].strip()


def require_token(fn):
    """/api/admin/* 的鉴权：Authorization: Bearer <token>。"""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = bearer_token()
        if not token or token not in VALID_TOKENS:
            return fail('未登录或登录已过期，请重新输入教师口令', 401)
        return fn(*args, **kwargs)
    return wrapper


def query_mode():
    """读 ?mode=。默认 all。返回 (mode, 错误响应 or None)。"""
    mode = (request.args.get('mode') or 'all').strip().lower()
    if mode not in ('all', 'standard', 'quick'):
        return None, fail('mode 只能是 all / standard / quick', 400)
    return mode, None


# ---------------------------------------------------------------------------
# 1. 学生登录
# ---------------------------------------------------------------------------

@app.route('/api/login', methods=['POST'])
def api_login():
    data = body_json()
    if data is None:
        return fail('请求体必须是一个 JSON 对象', 400)

    student_id = str(data.get('studentId') or '').strip()
    name = str(data.get('name') or '').strip()

    if not student_id:
        return fail('请填写学号', 400)

    # 这一步只是让前端确认格式、把学号姓名回显出来，不查重、不写库 ——
    # 真正入库发生在 /api/submit（学生玩完一整场再交）。
    return ok(student={'id': student_id, 'name': name})


# ---------------------------------------------------------------------------
# 2. 提交成绩
# ---------------------------------------------------------------------------

@app.route('/api/submit', methods=['POST'])
def api_submit():
    data = body_json()
    if data is None:
        return fail('请求体必须是一个 JSON 对象', 400)

    # —— 字段校验（契约 6.1：studentId / mode / rounds 缺一个就 400）——
    student_id = data.get('studentId')
    student_id = '' if student_id is None else str(student_id).strip()
    if not student_id:
        return fail('缺少 studentId（学号）', 400)

    mode = data.get('mode')
    if mode is None or mode == '':
        return fail('缺少 mode（试次模式）', 400)
    if mode not in VALID_MODES:
        return fail('mode 只能是 standard 或 quick', 400)

    rounds = data.get('rounds')
    if rounds is None:
        return fail('缺少 rounds（三轮成绩）', 400)
    if not isinstance(rounds, list):
        return fail('rounds 必须是一个数组', 400)
    # 契约 4.4：Session.rounds 长度恒为 3。长度不对说明前端算出问题来了，
    # 与其存一条残废记录让教师后台的图瘪一块，不如当场报错。
    if len(rounds) != 3:
        return fail('rounds 必须是长度为 3 的数组（三轮成绩）', 400)

    try:
        conn = db.connect()
        try:
            db.upsert_result(conn, data)
        finally:
            conn.close()
    except sqlite3.Error as e:
        app.logger.exception('提交成绩写库失败')
        return fail('保存成绩失败：%s' % e, 500)

    return ok()


# ---------------------------------------------------------------------------
# 3. 教师后台：登录换 token
# ---------------------------------------------------------------------------

@app.route('/api/admin/login', methods=['POST'])
def api_admin_login():
    data = body_json()
    if data is None:
        return fail('请求体必须是一个 JSON 对象', 400)

    password = data.get('password')
    if not isinstance(password, str):
        password = ''

    # compare_digest：定长比较，顺手挡掉计时侧信道（用 == 也行，但没理由不用）
    if not secrets.compare_digest(password, ADMIN_PASSWORD):
        # ★ 只说"错了"，不说口令长什么样、也不提示默认值是什么
        return fail('口令错误', 401)

    token = secrets.token_hex(16)
    VALID_TOKENS.add(token)
    return ok(token=token)


# ---------------------------------------------------------------------------
# 4. 教师后台：成绩明细
# ---------------------------------------------------------------------------

@app.route('/api/admin/results', methods=['GET'])
@require_token
def api_admin_results():
    mode, err = query_mode()
    if err:
        return err

    try:
        conn = db.connect()
        try:
            rows = db.fetch_results(conn, mode)
        finally:
            conn.close()
    except sqlite3.Error as e:
        app.logger.exception('读取成绩失败')
        return fail('读取成绩失败：%s' % e, 500)

    return ok(rows=rows)


# ---------------------------------------------------------------------------
# 5. 教师后台：班级汇总（★ 图 1「三轮 d′ 不变、c 在动」的原料）
# ---------------------------------------------------------------------------

def _stat(values):
    """一组数 → { mean, sd, values }。

    ★ 一条数据都没有时，mean / sd 返回 null（不是 0.0）—— 契约后补的语义。
      「还没有一个人交卷」和「全班 d′ 平均是 0」是两件不同的事实，
      都显示成 0.00 的话，老师打开空后台会以为这个班完全分不清危重患者。
      前端拿到 null 就该显示「暂无数据」。

    ★ 但"只有一个样本"时 sd 仍然返回 0.0 —— 那是有意义的：
      样本只有一个，离散度确实就是 0。**只有零个样本才是 null。**
      （statistics.stdev() 一个数时会抛 StatisticsError，所以这里必须挡住。）

    正常有数据时一律留 3 位小数。
    """
    vals = [float(v) for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
    if not vals:
        return {'mean': None, 'sd': None, 'values': []}
    mean = statistics.mean(vals)
    sd = statistics.stdev(vals) if len(vals) >= 2 else 0.0
    return {
        'mean':   _r3(mean),
        'sd':     _r3(sd),
        'values': [_r3(v) for v in vals],
    }


def _r3(x):
    """留 3 位小数 —— 免得 JSON 里出现 1.4155555555555557 这种数。"""
    return round(float(x), 3)


@app.route('/api/admin/summary', methods=['GET'])
@require_token
def api_admin_summary():
    mode, err = query_mode()
    if err:
        return err

    try:
        conn = db.connect()
        try:
            rows = db.fetch_results(conn, mode)
        finally:
            conn.close()
    except sqlite3.Error as e:
        app.logger.exception('读取成绩失败')
        return fail('读取成绩失败：%s' % e, 500)

    # ★ 下面每一项都跟着 ?mode= 过滤走：老师点了「快速版」，
    #   卡片和四张图就都只统计快速版的人。
    #   byMode 也按同一批人算（不选模式时就是一个班的全貌），
    #   所以恒有 n == byMode.standard + byMode.quick，两个数对得上。
    n_standard = sum(1 for r in rows if r['mode'] == 'standard')
    n_quick = sum(1 for r in rows if r['mode'] == 'quick')

    summary = {
        'n': len(rows),
        'byMode': {'standard': n_standard, 'quick': n_quick},

        # 全班平均 d′ / c / 准确率（用三轮合并的那个 overall）
        # ★ rows 里的键是 overallDPrime（大写 P，契约 6.1）；
        #   而 summary 这一层的 'dprime' 故意小写 —— 它是"统计量的名字"，
        #   不是 Session 里的字段，两处拼法不同是有意的，别改。
        'dprime':   _stat([r['overallDPrime']   for r in rows]),
        'c':        _stat([r['overallC']        for r in rows]),
        'accuracy': _stat([r['overallAccuracy'] for r in rows]),

        # ★ 三轮各自的平均 —— 教师后台靠它画"三轮 d′ 不变、c 在动"那张图，
        #   它是这个项目最有教学价值的图，所以这一段单独备好料。
        #   没有这一轮数据的人（NULL）不计入该轮的均值，不会把均值拉成 0。
        'rounds': [
            {
                'round': i + 1,
                'dprimeMean':   _mean_of(rows, 'r%dDPrime' % (i + 1)),
                'cMean':        _mean_of(rows, 'r%dC' % (i + 1)),
                'accuracyMean': _mean_of(rows, 'r%dAccuracy' % (i + 1)),
            }
            for i in range(3)
        ],
    }

    return ok(summary=summary)


def _mean_of(rows, key):
    """某一列的平均。一个值都没有 → 返回 None（不是 0.0）—— 理由同 _stat()。"""
    vals = [r[key] for r in rows if isinstance(r.get(key), (int, float))]
    return _r3(statistics.mean(vals)) if vals else None


# ---------------------------------------------------------------------------
# 6. 静态文件：学生端 / 教师端页面本身
#
# ★ 这三条路由必须【排在所有 /api/... 后面】。虽然 Werkzeug 是按规则的
#   "具体程度"选路由（/api/admin/login 比 /<path:path> 具体，谁先注册都赢），
#   但还是把兜底放最后 —— 靠具体程度获胜这件事太隐晦，读代码的人看不出来。
#
# ★ 为什么是白名单、不是黑名单：
#   黑名单（"不许访问 server/、tasks/…"）永远漏 —— 以后加一个新目录
#   （比如 docs/ 或者某个 .env）默认就是敞开的。白名单反过来：
#   新东西默认关着，要放行得显式写一行，想忘都忘不掉。
# ---------------------------------------------------------------------------

# 项目根目录 = server/ 的上一级
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 允许伺服的根文件（就这两个页面）
STATIC_ROOT_FILES = ('index.html', 'admin.html')

# 允许伺服的顶层目录。★ 没放 docs/ —— 那是给人看的设计文档，
#   页面不引用它，暴露出去只是多一个能被翻的地方（理由见 server/README.md）。
STATIC_DIRS = ('js', 'styles')


def _no_cache(resp):
    """静态响应一律不缓存。

    开发阶段最烦的就是浏览器拿着旧 JS 跑，看着像"我改的代码没生效"。
    作业场景不做长缓存优化：让人永远看到最新文件比省那点流量重要得多。
    """
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp


def _allowed_static(path):
    """白名单判断：这个相对路径允许伺服吗？

    第 0 关，在 realpath 之前先把明显不该有的形状挡掉：
      · 空路径
      · 任何一段是 '..'   （目录穿越的字面写法）
      · 任何一段以 '.' 开头（.git、.env、.DS_Store…）
      · 绝对路径（开头的 '/' 会被 Werkzeug 吃掉，但 '/' 段也要挡）
    """
    if not path:
        return False

    parts = path.split('/')
    for p in parts:
        if p == '' or p == '..' or p.startswith('.'):
            return False

    if path in STATIC_ROOT_FILES:
        return True

    # 目录里的文件：第一段必须在白名单目录里
    return len(parts) > 1 and parts[0] in STATIC_DIRS


@app.route('/')
def _index():
    return _no_cache(send_from_directory(ROOT, 'index.html'))


@app.route('/<path:path>')
def _static(path):
    # 第一关：白名单（管"能访问到什么"）
    if not _allowed_static(path):
        abort(404)

    # 第二关：目录穿越（管"能不能跑出 ROOT"）
    #   ★ 不能只靠白名单：'js/../../../etc/passwd' 的第一段是 'js'，
    #     白名单放行，但 realpath 一解析就跑出项目根了。
    #   ★ 也不能只靠字符串判断 '..' not in path —— 编码变体（%2e%2e、
    #     双重编码）和符号链接都绕得过去。解析成真实路径再看前缀才靠谱。
    full = os.path.realpath(os.path.join(ROOT, path))
    root = os.path.realpath(ROOT)
    if full != root and not full.startswith(root + os.sep):
        abort(404)

    # 第三关：必须真是一个文件。目录、符号链接指向的另一处、不存在的，
    #        一律 404 —— 不要让它冒成 500（任务书第 ⑦ 条）。
    if not os.path.isfile(full):
        abort(404)

    # send_from_directory 自己还有一层防穿越检查，留着当第四道保险。
    resp = send_from_directory(ROOT, path)
    return _no_cache(resp)


# ---------------------------------------------------------------------------

if __name__ == '__main__':
    print('后端已启动')
    print('  学生端  http://127.0.0.1:%d/' % PORT)
    print('  教师端  http://127.0.0.1:%d/admin.html' % PORT)
    print('  接口    http://127.0.0.1:%d/api/...' % PORT)
    print('数据库：%s' % db.DB_PATH)
    if 'SDT_PORT' not in os.environ:
        print('（端口是默认值 %d，要改用环境变量 SDT_PORT；'
              '默认避开 macOS AirPlay 占着的 5000）' % PORT)
    if 'SDT_ADMIN_PASSWORD' not in os.environ:
        print('⚠  教师口令用的是代码里的默认值，部署前请设环境变量 SDT_ADMIN_PASSWORD')
    app.run(host='127.0.0.1', port=PORT, debug=True)
