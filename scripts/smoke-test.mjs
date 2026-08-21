// 黑马记账 - 冒烟测试脚本
// 作用：模拟真人操作，逐项验证「记一笔 / 列表 / 统计图表 / 编辑 / 删除」流程，每步截图
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
await setInput('input[type="date"]', '2026-08-21')
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

// 6. 回到账单页，编辑账目：金额改成 30
await clickByText('.nav-btn', '账单')
await waitFor(`document.querySelector('.bill-item')`)
await evalJs(`document.querySelector('.bill-item').click(); true`)
await waitFor(`document.querySelector('.dialog')`)
console.log('编辑弹窗预填金额:', await evalJs(`document.querySelector('.amount-input').value`))
await setInput('.amount-input', '30')
await clickByText('.btn-primary', '保存')
await waitFor(`!document.querySelector('.dialog')`)
await shot('06-编辑后-金额30.png')
console.log('编辑后列表内容:', await listState())

// 7. 删除账目（自动确认弹窗）
await evalJs(`document.querySelector('.bill-item').click(); true`)
await waitFor(`document.querySelector('.dialog .btn-danger')`)
await clickByText('.btn-danger', '删除')
await waitFor(`!document.querySelector('.dialog')`)
await shot('07-删除后-空状态.png')
console.log('删除后列表内容:', await listState())

console.log('\n== 冒烟测试全部完成 ==')
} finally {
  ws.close()
}
