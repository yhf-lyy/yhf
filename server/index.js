const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件服务 - 前端页面
app.use(express.static(path.join(__dirname, '..')));

// 数据库初始化
const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');

// 创建报名表（增加微信、QQ、联系方式偏好字段）
db.exec(`
  CREATE TABLE IF NOT EXISTS enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    wechat TEXT DEFAULT '',
    qq TEXT DEFAULT '',
    parent_name TEXT DEFAULT '',
    program TEXT NOT NULL,
    contact_pref TEXT DEFAULT 'phone',
    remark TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT (datetime('now', 'localtime'))
  )
`);

// 创建管理员表
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )
`);

// 初始化默认管理员（密码: admin123）
const adminExists = db.prepare('SELECT COUNT(*) as count FROM admins').get();
if (adminExists.count === 0) {
  db.prepare('INSERT INTO admins (username, password) VALUES (?, ?)').run('admin', 'admin123');
}

// ========== API 路由 ==========

// 提交报名
app.post('/api/enroll', (req, res) => {
  try {
    const { student_name, phone, wechat, qq, parent_name, program, contact_pref, remark } = req.body;

    if (!student_name || !phone || !program) {
      return res.status(400).json({ success: false, message: '请填写必填信息' });
    }

    const result = db.prepare(
      'INSERT INTO enrollments (student_name, phone, wechat, qq, parent_name, program, contact_pref, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(student_name, phone, wechat || '', qq || '', parent_name || '', program, contact_pref || 'phone', remark || '');

    res.json({ success: true, message: '报名提交成功', id: result.lastInsertRowid });
  } catch (err) {
    console.error('报名提交失败:', err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 管理员登录
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = db.prepare('SELECT * FROM admins WHERE username = ? AND password = ?').get(username, password);

    if (admin) {
      res.json({ success: true, message: '登录成功' });
    } else {
      res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取报名列表（支持分页、搜索、状态筛选）
app.get('/api/enrollments', (req, res) => {
  try {
    const { page = 1, pageSize = 10, keyword = '', status = '' } = req.query;
    const offset = (page - 1) * pageSize;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (keyword) {
      whereClause += ' AND (student_name LIKE ? OR phone LIKE ? OR parent_name LIKE ? OR wechat LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    const total = db.prepare(`SELECT COUNT(*) as count FROM enrollments ${whereClause}`).get(...params);
    const rows = db.prepare(
      `SELECT * FROM enrollments ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, Number(pageSize), Number(offset));

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: Number(page),
        pageSize: Number(pageSize),
        total: total.count,
        totalPages: Math.ceil(total.count / Number(pageSize))
      }
    });
  } catch (err) {
    console.error('获取报名列表失败:', err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 获取统计数据
app.get('/api/stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM enrollments').get();
    const pending = db.prepare("SELECT COUNT(*) as count FROM enrollments WHERE status = 'pending'").get();
    const contacted = db.prepare("SELECT COUNT(*) as count FROM enrollments WHERE status = 'contacted'").get();
    const enrolled = db.prepare("SELECT COUNT(*) as count FROM enrollments WHERE status = 'enrolled'").get();
    const byProgram = db.prepare(
      'SELECT program, COUNT(*) as count FROM enrollments GROUP BY program'
    ).all();

    res.json({
      success: true,
      data: {
        total: total.count,
        pending: pending.count,
        contacted: contacted.count,
        enrolled: enrolled.count,
        byProgram
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 更新报名状态
app.put('/api/enrollments/:id', (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'contacted', 'enrolled', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: '无效的状态值' });
    }

    db.prepare('UPDATE enrollments SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ success: true, message: '状态更新成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 删除报名记录
app.delete('/api/enrollments/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM enrollments WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: '服务器错误' });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`\n  兴艺中学招生系统已启动！`);
  console.log(`  前台页面: http://localhost:${PORT}`);
  console.log(`  后台管理: http://localhost:${PORT}/admin.html`);
  console.log(`  默认账号: admin / admin123\n`);
});
