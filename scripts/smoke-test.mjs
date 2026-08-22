// 黑马记账 - 冒烟测试脚本
// 作用：模拟真人操作，逐项验证「记一笔 / 列表 / 统计图表 / 编辑 / 删除 / 分类管理」流程，每步截图
//
// 使用方式（Windows）：
//   1. 启动应用并打开调试端口：
//      unset ELECTRON_RUN_AS_NODE && ./node_modules/electron/dist/electron.exe --remote-debugging-port=9222 .
//   2. 另开一个终端运行本脚本：
//      node scripts/smoke-test.mjs
//
// 截图保存在项目根目录 screenshots/ 下

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const PORT = process.env.CDP_PORT || '9222'
const SHOT_DIR = join(process.cwd(), 'screenshots')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

mkdirSync(SHOT_DIR, { recursive: true })

// ---------- 连接应用页面 ----------
let targets = []
for (let i = 0; i < 30; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    if (targets.some((t) => t.type === 'page')) break
  } catch {}
  await sleep(1000)
}
const page = targets.find((t) => t.type === 'page')
if (!page) {
  console.error('没有找到应用页面，请确认应用已带调试端口启动')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})

let msgId = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  } else if (m.method === 'Page.javascriptDialogOpening') {
    // 自动点击确认框的「确定」（用于删除确认）
    send('Page.handleJavaScriptDialog', { accept: true })
  }
}

function send(method, params = {}) {
  return new Promise((res) => {
    const id = ++msgId
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (r.result?.exceptionDetails) {
    throw new Error(
      '页面脚本出错: ' +
        (r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails))
    )
  }
  return r.result?.result?.value
}

// 轮询等待某条件成立（替代固定延时，更可靠）
async function waitFor(expression, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await evalJs(`Boolean(${expression})`)) return
    await sleep(200)
  }
  throw new Error('等待超时: ' + expression)
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const file = join(SHOT_DIR, name)
  writeFileSync(file, Buffer.from(r.result.data, 'base64'))
  console.log('📸 已截图:', name)
}

// 点击包含指定文字的按钮
function clickByText(selector, text) {
  return evalJs(`(() => {
    const els = [...document.querySelectorAll('${selector}')]
    const el = els.find(e => e.textContent.trim().includes('${text}'))
    if (!el) throw new Error('找不到元素: ${selector} 包含「${text}」')
    el.click()
    return true
  })()`)
}

// 给输入框赋值（模拟真实键盘输入，Vue 能感知）
function setInput(selector, value, index = 0) {
  return evalJs(`(() => {
    const el = document.querySelectorAll('${selector}')[${index}]
    if (!el) throw new Error('找不到输入框: ${selector}[${index}]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, '${value}')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
}

const listState = () =>
  evalJs(
    `JSON.stringify([...document.querySelectorAll('.bill-item')].map(el => el.textContent.trim().replace(/\\s+/g, ' ')))`
  )

// 在指定一级分类卡片内点击某个操作按钮（用于分类页测试）
function clickCatAction(cardName, selector) {
  return evalJs(`(() => {
    const card = [...document.querySelectorAll('.cat-card')]
      .find(c => c.querySelector('.cat-name')?.textContent.trim() === '${cardName}')
    if (!card) throw new Error('找不到分类卡片: ${cardName}')
    const el = card.querySelector('${selector}')
    if (!el) throw new Error('找不到按钮: ${selector}')
    el.click()
    return true
  })()`)
}

// 检查三个图表画布是否真的画出了内容（采样像素，验证不是空白）
const canvasCheck = () =>
  evalJs(`(() => {
    const canvases = [...document.querySelectorAll('.chart-box canvas')]
    if (canvases.length < 3) return '画布数量不足: ' + canvases.length
    return canvases.map((cv, i) => {
      const { width, height } = cv
      const data = cv.getContext('2d').getImageData(0, 0, width, height).data
      let colored = 0
      for (let p = 0; p < data.length; p += 40) {
        if (data[p] !== 255 || data[p + 1] !== 255 || data[p + 2] !== 255) colored++
      }
      return '图表' + (i + 1) + '(' + width + 'x' + height + ') 非白采样点=' + colored
    }).join(' | ')
  })()`)

// 关键界面元素的样式是否符合设计（颜色、尺寸）
const styleCheck = () =>
  evalJs(`(() => {
    const sb = document.querySelector('.sidebar')
    const card = document.querySelector('.stat-card')
    return '侧边栏背景=' + getComputedStyle(sb).backgroundColor +
      ' 宽=' + sb.getBoundingClientRect().width + 'px' +
      ' | 统计卡片背景=' + getComputedStyle(card).backgroundColor
  })()`)

// ---------- 开始测试 ----------
console.log('== 黑马记账 冒烟测试开始 ==\n')

try {
  // 开启 CDP 事件（处理确认框）并接管页面确认框：自动视为点击「确定」
  await send('Page.enable')
  await send('Runtime.enable')
  await evalJs(`window.confirm = () => true; true`)

// 0. 确保从账单页开始（应用可能停留在上次使用的页面）
await clickByText('.nav-btn', '账单')
await sleep(400)

// 测试账目的日期用「今天」，保证出现在本月账单里
const testDate = (() => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})()

// 1. 账单页空状态
await shot('01-账单页-空状态.png')

// 2. 打开「记一笔」弹窗
await clickByText('.btn-primary', '记一笔')
await sleep(400)
await shot('02-记账弹窗.png')

// 3. 填写表单：金额 25.5 元、餐饮-午餐、日期、备注
await setInput('.amount-input', '25.5')
await clickByText('.cat-parent', '餐饮')
await sleep(150)
await clickByText('.cat-child', '午餐')
await setInput('input[type="date"]', testDate)
await setInput('.text-input', '测试账目：和同事午餐', 1)
await sleep(300)
await shot('03-表单填写完成.png')

// 4. 保存
await clickByText('.btn-primary', '保存')
await sleep(700)
await shot('04-保存后-账单列表.png')
console.log('保存后列表内容:', await listState())

// 5. 统计页
await clickByText('.nav-btn', '统计')
await sleep(1500)
await shot('05-统计页-图表.png')
console.log(
  '统计卡片内容:',
  await evalJs(
    `JSON.stringify([...document.querySelectorAll('.stat-card')].map(el => el.textContent.trim().replace(/\\s+/g, ' ')))`
  )
)
// 图表渲染检查：三个图表画布应真实画出内容（采样非白像素）
console.log('图表渲染检查:', await canvasCheck())
// 界面样式检查：关键元素颜色/尺寸是否符合设计
console.log('样式检查:', await styleCheck())

// 6. 回到账单页，编辑测试账目：金额改成 30
await clickByText('.nav-btn', '账单')
await waitFor(`document.querySelector('.bill-item')`)
await evalJs(`(() => {
  const item = [...document.querySelectorAll('.bill-item')].find(el => el.textContent.includes('测试账目'))
  if (!item) throw new Error('找不到测试账目')
  item.click()
  return true
})()`)
await waitFor(`document.querySelector('.dialog')`)
console.log('编辑弹窗预填金额:', await evalJs(`document.querySelector('.amount-input').value`))
await setInput('.amount-input', '30')
await clickByText('.btn-primary', '保存')
await waitFor(`!document.querySelector('.dialog')`)
await shot('06-编辑后-金额30.png')
console.log('编辑后列表内容:', await listState())

// 7. 删除测试账目（自动确认弹窗）
await evalJs(`(() => {
  const item = [...document.querySelectorAll('.bill-item')].find(el => el.textContent.includes('测试账目'))
  if (!item) throw new Error('找不到测试账目')
  item.click()
  return true
})()`)
await waitFor(`document.querySelector('.dialog .btn-danger')`)
await clickByText('.btn-danger', '删除')
await waitFor(`!document.querySelector('.dialog')`)
await shot('07-删除后-空状态.png')
console.log('删除后列表内容:', await listState())

// ---------- 分类管理 ----------
// 预清理：删除上次运行可能残留的测试账目与测试分类（保证脚本可重复运行）
console.log('预清理上次运行残留…')
// 先删测试账目（账单页，当前月；循环处理多次中断残留，只碰带测试标记的账目）
for (let i = 0; i < 5; i++) {
  const opened = await evalJs(`(() => {
    const item = [...document.querySelectorAll('.bill-item')]
      .find(el => el.textContent.includes('测试账目') || el.textContent.includes('分类链路'))
    if (!item) return false
    item.click()
    return true
  })()`)
  if (!opened) break
  await waitFor(`document.querySelector('.dialog .btn-danger')`)
  await clickByText('.btn-danger', '删除')
  await waitFor(`!document.querySelector('.dialog')`)
}
// 再删测试分类（分类页）
await clickByText('.nav-btn', '分类')
await waitFor(`document.querySelector('.cat-manage, .empty')`)
for (const childName of ['测试小类改', '测试小类']) {
  await evalJs(`(() => {
    const card = [...document.querySelectorAll('.cat-card')]
      .find(c => c.querySelector('.cat-name')?.textContent.trim() === '测试大类')
    if (!card) return true
    const row = [...card.querySelectorAll('.cat-child-row')]
      .find(r => r.querySelector('.cat-child-name')?.textContent.trim() === '${childName}')
    if (row) row.querySelector('.cat-delete').click()
    return true
  })()`)
  await sleep(400)
}
await evalJs(`(() => {
  const card = [...document.querySelectorAll('.cat-card')]
    .find(c => c.querySelector('.cat-name')?.textContent.trim() === '测试大类')
  if (card) card.querySelector('.cat-card-header .cat-delete').click()
  return true
})()`)
await sleep(400)

// 8. 分类页：内置 10 个大类应齐全（用户可能已自行添加分类，故只判断不少于 10）
await waitFor(`document.querySelectorAll('.cat-card').length >= 10`)
await shot('08-分类页-内置分类.png')
console.log('大类卡片数:', await evalJs(`document.querySelectorAll('.cat-card').length`))

// 9. 添加一级分类「测试大类」（选 🐶 图标）
await clickByText('.btn-primary', '添加一级分类')
await sleep(300)
await setInput('.dialog .text-input', '测试大类')
await clickByText('.emoji-cell', '🐶')
await shot('09-添加一级分类弹窗.png')
await clickByText('.dialog .btn-primary', '保存')
await waitFor(`!document.querySelector('.dialog')`)
await waitFor(`[...document.querySelectorAll('.cat-name')].some(e => e.textContent.trim() === '测试大类')`)
console.log('新建一级分类成功')

// 10. 添加二级分类「测试小类」并改名「测试小类改」
await clickCatAction('测试大类', '.cat-add-child')
await sleep(300)
await setInput('.dialog .text-input', '测试小类')
await clickByText('.dialog .btn-primary', '保存')
await waitFor(`!document.querySelector('.dialog')`)
await clickCatAction('测试大类', '.cat-child-row .cat-edit')
await sleep(300)
await setInput('.dialog .text-input', '测试小类改')
await clickByText('.dialog .btn-primary', '保存')
await waitFor(`!document.querySelector('.dialog')`)
await waitFor(`[...document.querySelectorAll('.cat-child-name')].some(e => e.textContent.trim() === '测试小类改')`)
await shot('10-新建小类并改名.png')
console.log('新建小类并改名成功')

// 11. 用新分类记一笔账（日期默认今天，出现在本月账单）
await clickByText('.nav-btn', '账单')
await waitFor(`document.querySelector('.page-header')`)
await clickByText('.btn-primary', '记一笔')
await sleep(300)
await setInput('.amount-input', '9.9')
await clickByText('.cat-parent', '测试大类')
await sleep(150)
await clickByText('.cat-child', '测试小类改')
await setInput('.text-input', '分类链路测试账目', 1)
await clickByText('.dialog .btn-primary', '保存')
await waitFor(`!document.querySelector('.dialog')`)
await shot('11-用新分类记账.png')
console.log('用新分类记账成功')

// 12. 删除保护：分类下有账目时删除应被拒绝（确认框自动确定，后端弹提示）
await clickByText('.nav-btn', '分类')
await waitFor(`document.querySelector('.cat-card')`)
await clickCatAction('测试大类', '.cat-card-header .cat-delete')
await sleep(600)
await waitFor(`[...document.querySelectorAll('.cat-name')].some(e => e.textContent.trim() === '测试大类')`)
await clickCatAction('测试大类', '.cat-child-row .cat-delete')
await sleep(600)
await waitFor(`[...document.querySelectorAll('.cat-child-name')].some(e => e.textContent.trim() === '测试小类改')`)
console.log('删除保护生效：有账目的分类未被删除')
await shot('12-删除被拒绝.png')

// 13. 清理：先删测试账目，再删测试分类
await clickByText('.nav-btn', '账单')
await waitFor(`document.querySelector('.bill-item')`)
await evalJs(`(() => {
  const item = [...document.querySelectorAll('.bill-item')].find(el => el.textContent.includes('分类链路'))
  if (!item) throw new Error('找不到测试账目')
  item.click()
  return true
})()`)
await waitFor(`document.querySelector('.dialog .btn-danger')`)
await clickByText('.btn-danger', '删除')
await waitFor(`!document.querySelector('.dialog')`)
await clickByText('.nav-btn', '分类')
await waitFor(`document.querySelector('.cat-card')`)
await clickCatAction('测试大类', '.cat-child-row .cat-delete')
await waitFor(`![...document.querySelectorAll('.cat-child-name')].some(e => e.textContent.trim() === '测试小类改')`)
await clickCatAction('测试大类', '.cat-card-header .cat-delete')
await waitFor(`![...document.querySelectorAll('.cat-name')].some(e => e.textContent.trim() === '测试大类')`)
console.log('清理完成：测试分类已删除')
await shot('13-清理完成.png')

console.log('\n== 冒烟测试全部完成 ==')
} finally {
  ws.close()
}
