import { app, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import Database from 'better-sqlite3'

// 预设分类体系（一级大类 + 二级小类），与 CLAUDE.md 产品文档一致
const CATEGORIES = [
  { name: '餐饮', icon: '🍚', children: ['早餐', '午餐', '晚餐', '零食饮料', '水果', '外卖', '咖啡奶茶', '聚餐'] },
  { name: '交通', icon: '🚗', children: ['公交地铁', '出租网约车', '火车高铁', '飞机', '加油充电', '停车过路', '共享单车'] },
  { name: '购物', icon: '🛒', children: ['日用品', '服饰鞋包', '数码家电', '美妆个护', '图书文具', '宠物用品', '其他购物'] },
  { name: '居住', icon: '🏠', children: ['房租', '房贷', '水电燃气', '物业费', '宽带话费', '家具家电', '维修装修'] },
  { name: '娱乐', icon: '🎮', children: ['电影演出', '游戏充值', '旅游度假', '运动健身', '会员订阅', 'KTV酒吧'] },
  { name: '医疗健康', icon: '🏥', children: ['门诊住院', '药品', '体检', '保健用品'] },
  { name: '教育学习', icon: '📚', children: ['书籍课程', '学费培训', '考试报名'] },
  { name: '人情往来', icon: '🧧', children: ['请客送礼', '红包礼金', '孝敬长辈', '爱心捐赠'] },
  { name: '金融', icon: '💰', children: ['手续费', '利息', '保险', '投资亏损'] },
  { name: '其他', icon: '📦', children: ['其他'] }
]

let db

/** 打开（或创建）本地数据库文件，建表、预置分类、注册界面调用接口。应用启动时调用一次。 */
export function initDatabase() {
  const dbPath = join(app.getPath('userData'), 'heima-accounting.db')
  // 仅数据库文件首次创建时预置分类；用户删光全部分类后重启，不能复活内置分类
  const isNew = !existsSync(dbPath)
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (parent_id) REFERENCES categories(id)
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_cents INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
  `)

  if (isNew) seedCategories()
  registerIpcHandlers()
}

function seedCategories() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM categories').get()
  if (n > 0) return
  const insert = db.prepare('INSERT INTO categories (parent_id, name, icon) VALUES (?, ?, ?)')
  const insertAll = db.transaction(() => {
    for (const parent of CATEGORIES) {
      const info = insert.run(null, parent.name, parent.icon)
      for (const child of parent.children) {
        insert.run(info.lastInsertRowid, child, '')
      }
    }
  })
  insertAll()
}

/** 某年某月的日期范围（YYYY-MM-DD 字符串比较即可覆盖整月） */
function monthRange(year, month) {
  const m = String(month).padStart(2, '0')
  return [`${year}-${m}-01`, `${year}-${m}-31`]
}

/** 校验一笔账的数据，金额转成「分」；不合法时抛出中文错误信息 */
function validateExpense(data) {
  const amount = Number(data.amount)
  if (!data.amount || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('金额必须大于 0')
  }
  const cents = Math.round(amount * 100)
  if (cents > 9999999999) throw new Error('金额超出范围')

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) throw new Error('日期格式不正确')

  const cat = db.prepare('SELECT id, parent_id FROM categories WHERE id = ?').get(data.category_id)
  if (!cat || cat.parent_id === null) throw new Error('请选择二级分类')

  return {
    amount_cents: cents,
    category_id: data.category_id,
    date: data.date,
    note: String(data.note ?? '').slice(0, 100)
  }
}

function listCategories() {
  const rows = db.prepare('SELECT id, parent_id, name, icon FROM categories ORDER BY id').all()
  return rows
    .filter((r) => r.parent_id === null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      children: rows.filter((c) => c.parent_id === p.id).map((c) => ({ id: c.id, name: c.name }))
    }))
}

// ---------- 自定义分类：校验与增删改 ----------

const MAX_CATEGORY_NAME_LEN = 10
const DEFAULT_CATEGORY_ICON = '📦'

/** 判断字符串是否为「一个 emoji」（兼容 👨‍👩‍👧 等组合表情与 1️⃣ 键帽） */
function isSingleEmoji(s) {
  const segs = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)]
  if (segs.length !== 1) return false
  return /\p{Extended_Pictographic}/u.test(s) || /^[0-9#*]️⃣$/u.test(s)
}

/** 校验新增分类的数据；不合法时抛出中文错误信息 */
function validateCategory(data) {
  const name = String(data.name ?? '').trim()
  if (!name) throw new Error('请输入分类名称')
  if ([...name].length > MAX_CATEGORY_NAME_LEN) throw new Error('分类名称最多 10 个字')

  const parentId = data.parent_id == null ? null : Number(data.parent_id)
  if (parentId !== null && (!Number.isInteger(parentId) || parentId <= 0)) {
    throw new Error('所属大类不正确')
  }

  let icon = ''
  if (parentId === null) {
    icon = String(data.icon ?? '').trim() || DEFAULT_CATEGORY_ICON
    if (!isSingleEmoji(icon)) throw new Error('图标必须是一个 emoji 表情')
    const dup = db.prepare('SELECT id FROM categories WHERE parent_id IS NULL AND name = ?').get(name)
    if (dup) throw new Error('已存在同名分类')
  } else {
    const parent = db
      .prepare('SELECT id FROM categories WHERE id = ? AND parent_id IS NULL')
      .get(parentId)
    if (!parent) throw new Error('所属大类不存在，可能已被删除')
    const dup = db
      .prepare('SELECT id FROM categories WHERE parent_id = ? AND name = ?')
      .get(parentId, name)
    if (dup) throw new Error('该大类下已存在同名分类')
  }
  return { name, parent_id: parentId, icon }
}

function createCategory(data) {
  const v = validateCategory(data)
  const info = db
    .prepare('INSERT INTO categories (parent_id, name, icon) VALUES (?, ?, ?)')
    .run(v.parent_id, v.name, v.icon)
  return { id: Number(info.lastInsertRowid) }
}

function updateCategory(id, data) {
  const existing = db
    .prepare('SELECT id, parent_id, name, icon FROM categories WHERE id = ?')
    .get(id)
  if (!existing) throw new Error('该分类不存在，可能已被删除')

  const name = String(data.name ?? '').trim()
  if (!name) throw new Error('请输入分类名称')
  if ([...name].length > MAX_CATEGORY_NAME_LEN) throw new Error('分类名称最多 10 个字')
  // 同层查重，排除自身；不支持把小类挪到别的大类（忽略传入的 parent_id）
  const dup =
    existing.parent_id === null
      ? db
          .prepare('SELECT id FROM categories WHERE parent_id IS NULL AND name = ? AND id != ?')
          .get(name, id)
      : db
          .prepare('SELECT id FROM categories WHERE parent_id = ? AND name = ? AND id != ?')
          .get(existing.parent_id, name, id)
  if (dup) throw new Error(existing.parent_id === null ? '已存在同名分类' : '该大类下已存在同名分类')

  let icon = existing.icon
  if (existing.parent_id === null) {
    icon = String(data.icon ?? '').trim() || DEFAULT_CATEGORY_ICON
    if (!isSingleEmoji(icon)) throw new Error('图标必须是一个 emoji 表情')
  }
  db.prepare('UPDATE categories SET name = ?, icon = ? WHERE id = ?').run(name, icon, id)
  return { id }
}

function deleteCategory(id) {
  const existing = db.prepare('SELECT id, parent_id FROM categories WHERE id = ?').get(id)
  if (!existing) throw new Error('该分类不存在，可能已被删除')

  let n
  if (existing.parent_id === null) {
    // 一级大类：统计其下所有小类关联的账目总数
    n = db
      .prepare(
        `SELECT COUNT(*) AS n FROM expenses e
         JOIN categories c ON c.id = e.category_id
         WHERE c.parent_id = ?`
      )
      .get(id).n
    if (n > 0) throw new Error(`该大类下还有 ${n} 笔账目，不能删除`)
  } else {
    n = db.prepare('SELECT COUNT(*) AS n FROM expenses WHERE category_id = ?').get(id).n
    if (n > 0) throw new Error(`该分类下还有 ${n} 笔账目，不能删除`)
  }

  const remove = db.transaction(() => {
    if (existing.parent_id === null) {
      db.prepare('DELETE FROM categories WHERE parent_id = ?').run(id) // 先删其下小类
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(id)
  })
  remove()
  return { id }
}

function listExpenses(year, month) {
  const [start, end] = monthRange(year, month)
  return db
    .prepare(
      `SELECT e.id, e.amount_cents, e.date, e.note, e.category_id,
              c.name AS category_name, p.id AS parent_id, p.name AS parent_name, p.icon AS parent_icon
       FROM expenses e
       JOIN categories c ON c.id = e.category_id
       JOIN categories p ON p.id = c.parent_id
       WHERE e.date BETWEEN ? AND ?
       ORDER BY e.date DESC, e.id DESC`
    )
    .all(start, end)
}

function createExpense(data) {
  const v = validateExpense(data)
  const info = db
    .prepare('INSERT INTO expenses (amount_cents, category_id, date, note) VALUES (?, ?, ?, ?)')
    .run(v.amount_cents, v.category_id, v.date, v.note)
  return { id: Number(info.lastInsertRowid) }
}

function updateExpense(id, data) {
  const v = validateExpense(data)
  const info = db
    .prepare('UPDATE expenses SET amount_cents = ?, category_id = ?, date = ?, note = ? WHERE id = ?')
    .run(v.amount_cents, v.category_id, v.date, v.note, id)
  if (info.changes === 0) throw new Error('这笔账不存在，可能已被删除')
  return { id }
}

function deleteExpense(id) {
  const info = db.prepare('DELETE FROM expenses WHERE id = ?').run(id)
  if (info.changes === 0) throw new Error('这笔账不存在，可能已被删除')
  return { id }
}

function monthStats(year, month) {
  const [start, end] = monthRange(year, month)
  const totalRow = db
    .prepare(
      'SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS n FROM expenses WHERE date BETWEEN ? AND ?'
    )
    .get(start, end)
  const byCategory = db
    .prepare(
      `SELECT p.id, p.name, p.icon, SUM(e.amount_cents) AS total_cents
       FROM expenses e
       JOIN categories c ON c.id = e.category_id
       JOIN categories p ON p.id = c.parent_id
       WHERE e.date BETWEEN ? AND ?
       GROUP BY p.id
       ORDER BY total_cents DESC`
    )
    .all(start, end)

  const now = new Date()
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month
  // 当月按已过天数算日均，历史月份按整月天数算
  const days = isCurrentMonth ? now.getDate() : new Date(year, month, 0).getDate()

  return {
    year,
    month,
    total_cents: totalRow.total,
    count: totalRow.n,
    avg_per_day_cents: Math.round(totalRow.total / days),
    by_category: byCategory
  }
}

function trendStats(months) {
  const now = new Date()
  const stmt = db.prepare(
    'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM expenses WHERE date BETWEEN ? AND ?'
  )
  const result = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const year = d.getFullYear()
    const month = d.getMonth() + 1
    const [start, end] = monthRange(year, month)
    result.push({ year, month, total_cents: stmt.get(start, end).total })
  }
  return result
}

function registerIpcHandlers() {
  ipcMain.handle('categories:list', () => listCategories())
  ipcMain.handle('categories:create', (_e, data) => createCategory(data))
  ipcMain.handle('categories:update', (_e, { id, ...data }) => updateCategory(id, data))
  ipcMain.handle('categories:delete', (_e, id) => deleteCategory(id))
  ipcMain.handle('expenses:list', (_e, { year, month }) => listExpenses(year, month))
  ipcMain.handle('expenses:create', (_e, data) => createExpense(data))
  ipcMain.handle('expenses:update', (_e, { id, ...data }) => updateExpense(id, data))
  ipcMain.handle('expenses:delete', (_e, id) => deleteExpense(id))
  ipcMain.handle('stats:month', (_e, { year, month }) => monthStats(year, month))
  ipcMain.handle('stats:trend', (_e, { months = 6 } = {}) => trendStats(months))
}
