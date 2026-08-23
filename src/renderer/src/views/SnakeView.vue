<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const GRID = 20 // 棋盘格子数（20×20）
const TICK_BASE = 150 // 起步速度：150 毫秒走一步
const TICK_MIN = 80 // 最快速度：80 毫秒走一步
const BEST_KEY = 'snake-best' // 最高分保存在本机 localStorage，与记账数据完全分开

const canvasEl = ref(null)
const stageEl = ref(null)
const status = ref('idle') // idle 待开始 | running 进行中 | paused 暂停 | over 结束
const score = ref(0)
const best = ref(Number(localStorage.getItem(BEST_KEY)) || 0)
const isNewBest = ref(false)

let ctx = null
let cellPx = 28 // 每格像素，随窗口大小自适应
let snake = [] // 蛇身坐标 [{x,y}...]，第一项是蛇头
let food = null // 食物坐标 {x,y}
let dir = { x: 1, y: 0 } // 当前移动方向
let nextDir = { x: 1, y: 0 } // 下次移动方向（缓冲一步，防止连续按键瞬间掉头）
let timer = null

function reset() {
  snake = [
    { x: 9, y: 10 },
    { x: 8, y: 10 },
    { x: 7, y: 10 }
  ]
  dir = { x: 1, y: 0 }
  nextDir = { x: 1, y: 0 }
  score.value = 0
  isNewBest.value = false
  spawnFood()
}

function spawnFood() {
  let p
  do {
    p = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) }
  } while (snake.some((s) => s.x === p.x && s.y === p.y))
  food = p
}

function start() {
  stopLoop()
  reset()
  status.value = 'running'
  setSpeed()
  draw()
}

function togglePause() {
  if (status.value === 'running') {
    stopLoop()
    status.value = 'paused'
  } else if (status.value === 'paused') {
    setSpeed()
    status.value = 'running'
  }
}

function setSpeed() {
  // 每吃一个食物加快 5 毫秒，最快 80 毫秒一步
  const ms = Math.max(TICK_MIN, TICK_BASE - score.value * 5)
  stopLoop()
  timer = setInterval(tick, ms)
}

function stopLoop() {
  clearInterval(timer)
  timer = null
}

function tick() {
  dir = nextDir
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y }
  if (head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID) return gameOver()
  const eating = food && head.x === food.x && head.y === food.y
  // 没吃到食物时尾巴会移走一格，撞到尾巴不算撞自己
  const body = eating ? snake : snake.slice(0, -1)
  if (body.some((s) => s.x === head.x && s.y === head.y)) return gameOver()
  snake.unshift(head)
  if (eating) {
    score.value += 1
    spawnFood()
    setSpeed()
  } else {
    snake.pop()
  }
  draw()
}

function gameOver() {
  stopLoop()
  status.value = 'over'
  if (score.value > best.value) {
    best.value = score.value
    isNewBest.value = true
    localStorage.setItem(BEST_KEY, String(best.value))
  }
}

function onKey(e) {
  const k = e.key.toLowerCase()
  let d = null
  if (k === 'arrowup' || k === 'w') d = { x: 0, y: -1 }
  else if (k === 'arrowdown' || k === 's') d = { x: 0, y: 1 }
  else if (k === 'arrowleft' || k === 'a') d = { x: -1, y: 0 }
  else if (k === 'arrowright' || k === 'd') d = { x: 1, y: 0 }
  if (d) {
    e.preventDefault() // 防止方向键滚动页面
    if (status.value !== 'running') return
    if (d.x === -nextDir.x && d.y === -nextDir.y) return // 不能 180° 掉头
    nextDir = d
  } else if (k === ' ') {
    e.preventDefault() // 防止空格触发聚焦中的按钮
    if (status.value === 'running' || status.value === 'paused') togglePause()
    else start() // 待开始 / 结束后按空格直接开局
  }
}

function fitCanvas() {
  // 棋盘最大 560px，窗口太小时自动缩小，保证完整显示
  const size = Math.max(280, Math.min(560, stageEl.value.clientWidth, stageEl.value.clientHeight))
  const dpr = window.devicePixelRatio || 1
  const canvas = canvasEl.value
  canvas.width = size * dpr
  canvas.height = size * dpr
  canvas.style.width = size + 'px'
  canvas.style.height = size + 'px'
  ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  cellPx = size / GRID
}

function draw() {
  const size = GRID * cellPx
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  // 棋盘网格线
  ctx.strokeStyle = '#eef0f3'
  ctx.lineWidth = 1
  for (let i = 1; i < GRID; i++) {
    const p = i * cellPx
    ctx.beginPath()
    ctx.moveTo(p, 0)
    ctx.lineTo(p, size)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, p)
    ctx.lineTo(size, p)
    ctx.stroke()
  }
  // 食物：红色圆点
  if (food) {
    ctx.fillStyle = '#e5484d'
    ctx.beginPath()
    ctx.arc((food.x + 0.5) * cellPx, (food.y + 0.5) * cellPx, cellPx / 2 - 3, 0, Math.PI * 2)
    ctx.fill()
  }
  // 蛇身：主题橙色，蛇头更深一点
  snake.forEach((s, i) => {
    ctx.fillStyle = i === 0 ? '#f0561f' : '#ff6b35'
    ctx.beginPath()
    ctx.roundRect(s.x * cellPx + 1.5, s.y * cellPx + 1.5, cellPx - 3, cellPx - 3, cellPx * 0.25)
    ctx.fill()
  })
}

function onResize() {
  fitCanvas()
  draw()
}

onMounted(() => {
  fitCanvas()
  reset()
  draw()
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  stopLoop()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div class="month-title">🐍 贪吃蛇</div>
      <div class="snake-scores">
        <span>本局 <b>{{ score }}</b> 分</span>
        <span>最高 <b>{{ best }}</b> 分</span>
      </div>
      <div>
        <button v-if="status === 'idle' || status === 'over'" class="btn-primary" @click="start">
          {{ status === 'idle' ? '开始游戏' : '再来一局' }}
        </button>
        <button v-else class="btn-ghost" @click="togglePause">
          {{ status === 'paused' ? '继续' : '暂停' }}
        </button>
      </div>
    </div>

    <div ref="stageEl" class="snake-stage">
      <canvas ref="canvasEl" class="snake-canvas"></canvas>
      <div v-if="status === 'idle'" class="snake-mask">
        <div class="snake-mask-title">🐍 贪吃蛇</div>
        <div class="snake-mask-sub">方向键 / WASD 控制移动 · 空格暂停 · 吃到食物加分变长</div>
        <button class="btn-primary" @click="start">开始游戏</button>
      </div>
      <div v-else-if="status === 'paused'" class="snake-mask">
        <div class="snake-mask-title">⏸️ 已暂停</div>
        <div class="snake-mask-sub">按空格或点「继续」接着玩</div>
        <button class="btn-primary" @click="togglePause">继续</button>
      </div>
      <div v-else-if="status === 'over'" class="snake-mask">
        <div class="snake-mask-title">💀 游戏结束</div>
        <div class="snake-mask-sub">
          本局得分 <b>{{ score }}</b><template v-if="isNewBest"> · 🎉 新纪录！</template>
        </div>
        <button class="btn-primary" @click="start">再来一局</button>
      </div>
    </div>

    <div class="snake-tip">小提示：撞墙或撞到自己就结束啦；最高分会自动保存在你电脑上</div>
  </div>
</template>
