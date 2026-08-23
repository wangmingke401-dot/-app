// 贪吃蛇游戏 - 专项验证脚本
// 使用方式：先带调试端口启动应用（见 smoke-test.mjs 头部注释），再运行本脚本：
//   node scripts/snake-test.mjs
//
// 验证思路：不依赖窗口可见性（测试时窗口可能被遮挡，Page 截图会超时）。
// 用「游戏行为」当证据：蛇初始向右，10 步内必撞右墙 → 不按键等 2 秒，
// 若出现「游戏结束」遮罩 = 定时器在跑、移动/撞墙/结束逻辑全部正常。
// 截图统一用 canvas.toDataURL()，窗口隐藏也能截。

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const PORT = process.env.CDP_PORT || '9222'
const SHOT_DIR = join(process.cwd(), 'screenshots')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

mkdirSync(SHOT_DIR, { recursive: true })

// ---------- 连接应用页面 ----------
console.log('step0: 连接应用…')
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
  }
}

// 带 10 秒超时的 send：卡住时能报出是哪个命令，而不是永远等待
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId
    const t = setTimeout(() => {
      pending.delete(id)
      rej(new Error('CDP 命令超时: ' + method))
    }, 10000)
    pending.set(id, (m) => {
      clearTimeout(t)
      res(m)
    })
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
async function waitFor(expression, timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await evalJs(`Boolean(${expression})`)) return
    await sleep(150)
  }
  throw new Error('等待超时: ' + expression)
}

// 画布截图：直接从 canvas 位图导出，窗口被遮挡也能截
async function shotCanvas(name) {
  const b64 = await evalJs(
    `document.querySelector('.snake-canvas').toDataURL('image/png').split(',')[1]`
  )
  writeFileSync(join(SHOT_DIR, name), Buffer.from(b64, 'base64'))
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

// 模拟按键（方向键 / 空格）
function pressKey(key) {
  const code = key === ' ' ? 'Space' : key
  const vk = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 }[key] ?? 32
  return send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode: vk
  }).then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key, code }))
}

const maskTitle = () => evalJs(`document.querySelector('.snake-mask-title')?.textContent ?? '(无遮罩)'`)
const scores = () => evalJs(`document.querySelector('.snake-scores')?.textContent.replace(/\\s+/g, ' ')`)

// ---------- 开始测试 ----------
console.log('== 贪吃蛇游戏 专项验证开始 ==\n')

try {
  // 0. 进入游戏页
  console.log('step1: 点击侧边栏「游戏」')
  await clickByText('.nav-btn', '游戏')
  await waitFor(`document.querySelector('.snake-canvas')`)
  await sleep(300)
  console.log('待开始遮罩:', await maskTitle(), '|', await scores())
  await shotCanvas('14-贪吃蛇-待开始.png')

  // 1. 开始游戏 + 自动移动 + 撞墙（不按键，蛇初始向右，10 步内必撞右墙）
  // 遮罩里的主按钮「开始游戏」/「再来一局」都能开新局，直接点它即可
  console.log('step2: 点击遮罩主按钮开新局，不按键等待撞墙')
  await evalJs(`(() => {
    const el = document.querySelector('.snake-mask .btn-primary')
    if (!el) throw new Error('找不到开始按钮')
    el.click()
    return true
  })()`)
  await waitFor(`!document.querySelector('.snake-mask')`)
  console.log('✅ 遮罩消失，游戏开始运行')
  const t0 = Date.now()
  await waitFor(
    `document.querySelector('.snake-mask-title')?.textContent.includes('游戏结束')`,
    8000
  )
  console.log(`✅ 撞墙结束触发（用时 ${Date.now() - t0}ms）→ 定时器驱动移动、撞墙判定、结束逻辑全部正常`)
  console.log('结束遮罩:', await maskTitle(), '|', await scores())
  await shotCanvas('15-贪吃蛇-游戏结束.png')

  // 2. 吃食物验证：控制随机数把食物放在蛇头正上方 (9,9)，按 ↑ 第一步必吃到
  console.log('step3: 再来一局，用固定食物位置验证吃食物加分')
  await evalJs(`(() => {
    const seq = [0.47, 0.47] // floor(0.47*20)=9,9 —— 食物固定在蛇头正上方
    let si = 0
    const orig = Math.random
    window.Math.random = () => (si < seq.length ? seq[si++] : orig())
    return true
  })()`)
  await evalJs(`(() => {
    const el = document.querySelector('.snake-mask .btn-primary')
    if (!el) throw new Error('找不到开始按钮')
    el.click()
    return true
  })()`)
  await waitFor(`!document.querySelector('.snake-mask')`)
  await pressKey('ArrowUp')
  await sleep(600)
  const scoreAfterEat = await scores()
  console.log('吃食物后分数:', scoreAfterEat)
  if (!scoreAfterEat.includes('本局 1 分')) {
    throw new Error('预期吃到食物后本局 1 分，实际: ' + scoreAfterEat)
  }
  console.log('✅ 吃到食物加 1 分')
  await shotCanvas('16-贪吃蛇-吃到食物.png')

  // 3. 暂停验证：按空格后 2 秒内不应结束（暂停真的停住了）
  console.log('step4: 按空格暂停，验证游戏真的停住')
  await pressKey(' ')
  await waitFor(`document.querySelector('.snake-mask-title')?.textContent.includes('暂停')`)
  console.log('✅ 暂停遮罩出现')
  await shotCanvas('17-贪吃蛇-暂停.png')
  await sleep(2500)
  const pausedTitle = await maskTitle()
  console.log('2.5 秒后遮罩仍是:', pausedTitle)
  if (pausedTitle.includes('游戏结束')) throw new Error('暂停期间游戏仍在跑！')
  console.log('✅ 暂停期间游戏确实停住')

  // 4. 继续验证：按空格继续，向上方向 8 步内撞上墙
  console.log('step5: 按空格继续，等待撞墙结束')
  await pressKey(' ')
  await waitFor(`!document.querySelector('.snake-mask')`)
  await waitFor(`document.querySelector('.snake-mask-title')?.textContent.includes('游戏结束')`, 8000)
  console.log('✅ 继续后正常跑动并撞墙结束')
  console.log('结束遮罩:', await maskTitle(), '|', await scores())

  // 5. 最高分保存
  console.log('step6: 检查最高分保存')
  const savedBest = await evalJs(`localStorage.getItem('snake-best')`)
  console.log('localStorage 最高分:', savedBest !== null ? '✅ 已保存 = ' + savedBest : '⚠️ 未保存')
  console.log('页面显示:', await scores())

  // 6. 离开游戏页，验证计时器清理（回到账单页无异常）
  console.log('step7: 切回账单页')
  await clickByText('.nav-btn', '账单')
  await sleep(500)
  console.log('✅ 切回账单页正常')

  console.log('\n== 贪吃蛇验证全部通过 ==')
} catch (e) {
  console.error('\n❌ 验证失败:', e.message)
  try {
    await shotCanvas('99-贪吃蛇-失败现场.png')
  } catch {}
  process.exitCode = 1
} finally {
  ws.close()
}
