<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import MonthNav from '../components/MonthNav.vue'
import { fmtMoney, cleanIpcError } from '../utils'

// 图表配色：颜色与分类名固定绑定（经过色盲友好性校验的 10 色方案），排序变化不会改变颜色
const CATEGORY_COLORS = {
  餐饮: '#2a78d6',
  交通: '#eb6834',
  购物: '#1baf7a',
  居住: '#eda100',
  娱乐: '#e87ba4',
  医疗健康: '#008300',
  教育学习: '#4a3aa7',
  人情往来: '#e34948',
  金融: '#1a94b8',
  其他: '#c2456e'
}
const FALLBACK_COLORS = Object.values(CATEGORY_COLORS)
const INK = '#22262e'
const MUTED = '#8a9099'
const LINE = '#e9ebef'
const TREND_COLOR = '#eb6834'

const now = new Date()
const year = ref(now.getFullYear())
const month = ref(now.getMonth() + 1)
const stats = ref(null)
const trend = ref([])
const loading = ref(true)
const loadError = ref('')

const donutEl = ref(null)
const barEl = ref(null)
const lineEl = ref(null)
let donutChart = null
let barChart = null
let lineChart = null

const byCategory = computed(() => stats.value?.by_category ?? [])
const hasData = computed(() => (stats.value?.count ?? 0) > 0)

function colorOf(name, i) {
  return CATEGORY_COLORS[name] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
}

// 悬浮提示框统一样式
const tooltipBase = {
  backgroundColor: '#fff',
  borderColor: LINE,
  textStyle: { color: INK, fontSize: 13 },
  extraCssText: 'box-shadow: 0 4px 14px rgba(30,34,43,.12); border-radius: 8px;'
}

function renderDonut() {
  if (!donutChart) return
  const data = byCategory.value.map((c, i) => ({
    name: c.name,
    value: c.total_cents,
    itemStyle: { color: colorOf(c.name, i) }
  }))
  donutChart.setOption({
    tooltip: {
      trigger: 'item',
      formatter: (p) => `${p.marker} ${p.name}：${fmtMoney(p.value)}（${p.percent}%）`,
      ...tooltipBase
    },
    legend: {
      bottom: 0,
      type: 'scroll',
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 14,
      textStyle: { color: MUTED, fontSize: 12 }
    },
    series: [
      {
        type: 'pie',
        radius: ['55%', '74%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 },
        label: {
          show: true,
          formatter: (p) => (p.percent >= 6 ? `${p.percent}%` : ''),
          color: INK,
          fontSize: 12
        },
        labelLine: { length: 12, length2: 8 },
        data
      }
    ]
  })
}

function renderBar() {
  if (!barChart) return
  // 横向条形图：数值大的排在上面
  const list = byCategory.value.map((c, i) => ({ ...c, idx: i })).sort((a, b) => a.total_cents - b.total_cents)
  barChart.setOption({
    grid: { left: 8, right: 88, top: 10, bottom: 10, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: (p) => `${p.marker} ${p.name}：${fmtMoney(p.value)}`,
      ...tooltipBase
    },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category',
      data: list.map((d) => d.name),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: INK, fontSize: 13 }
    },
    series: [
      {
        type: 'bar',
        barWidth: 14,
        data: list.map((d) => ({
          value: d.total_cents,
          itemStyle: { color: colorOf(d.name, d.idx), borderRadius: [0, 4, 4, 0] }
        })),
        label: {
          show: true,
          position: 'right',
          color: MUTED,
          fontSize: 12,
          formatter: (p) => fmtMoney(p.value)
        }
      }
    ]
  })
}

function renderLine() {
  if (!lineChart) return
  const labels = trend.value.map((t) => `${t.month}月`)
  const values = trend.value.map((t) => t.total_cents)
  // 只给最高点加直接标注，避免数字铺满
  const maxIdx = values.indexOf(Math.max(...values))
  lineChart.setOption({
    grid: { left: 8, right: 20, top: 24, bottom: 10, containLabel: true },
    tooltip: {
      trigger: 'axis',
      formatter: (ps) => {
        const t = trend.value[ps[0].dataIndex]
        return `${t.year}年${t.month}月<br/>支出：${fmtMoney(t.total_cents)}`
      },
      ...tooltipBase,
      axisPointer: { type: 'line', lineStyle: { color: LINE } }
    },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: LINE } },
      axisTick: { show: false },
      axisLabel: { color: MUTED, fontSize: 12 }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: LINE } },
      axisLabel: { color: MUTED, fontSize: 12, formatter: (v) => '¥' + (v / 100).toFixed(0) }
    },
    series: [
      {
        type: 'line',
        data: values,
        smooth: 0.35,
        lineStyle: { width: 2, color: TREND_COLOR },
        itemStyle: { color: TREND_COLOR },
        symbol: 'circle',
        symbolSize: 8,
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(235,104,52,0.16)' },
            { offset: 1, color: 'rgba(235,104,52,0)' }
          ])
        },
        label: {
          show: true,
          color: MUTED,
          fontSize: 12,
          formatter: (p) => (p.dataIndex === maxIdx ? fmtMoney(p.value) : '')
        }
      }
    ]
  })
}

// 图表画布元素可能因「无数据/有数据」切换而被重建，
// 发现实例绑定的元素已更换时，销毁旧实例、绑定新元素
function ensureChart(instance, el) {
  if (!el.value) return null
  if (instance && instance.getDom() === el.value) return instance
  instance?.dispose()
  return echarts.init(el.value)
}

function renderCharts() {
  if (!hasData.value) return
  donutChart = ensureChart(donutChart, donutEl)
  barChart = ensureChart(barChart, barEl)
  lineChart = ensureChart(lineChart, lineEl)
  renderDonut()
  renderBar()
  renderLine()
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [s, t] = await Promise.all([
      window.api.getMonthStats({ year: year.value, month: month.value }),
      window.api.getTrend(6)
    ])
    stats.value = s
    trend.value = t
  } catch (err) {
    loadError.value = cleanIpcError(err)
    return
  } finally {
    loading.value = false
  }
  // 等界面把图表容器渲染出来后再初始化图表
  await nextTick()
  renderCharts()
}

function handleResize() {
  donutChart?.resize()
  barChart?.resize()
  lineChart?.resize()
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
  load()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  donutChart?.dispose()
  barChart?.dispose()
  lineChart?.dispose()
})

watch([year, month], load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <MonthNav v-model:year="year" v-model:month="month" />
    </header>

    <div v-if="loading" class="empty">加载中…</div>
    <div v-else-if="loadError" class="empty">
      <div class="empty-icon">⚠️</div>
      <p>{{ loadError }}</p>
    </div>
    <template v-else>
      <div class="stat-cards">
        <div class="stat-card">
          <div class="stat-label">总支出</div>
          <div class="stat-value">{{ fmtMoney(stats.total_cents) }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">账目笔数</div>
          <div class="stat-value">{{ stats.count }} 笔</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">日均支出</div>
          <div class="stat-value">{{ fmtMoney(stats.avg_per_day_cents) }}</div>
        </div>
      </div>

      <div v-if="!hasData" class="empty">
        <div class="empty-icon">📊</div>
        <p>这个月还没有数据</p>
        <p class="empty-sub">记几笔账后再来看看统计吧</p>
      </div>

      <div v-else class="stats-scroll">
        <div class="stats-grid">
          <div class="chart-card">
            <div class="chart-title">分类支出占比</div>
            <div class="chart-wrap">
              <div ref="donutEl" class="chart-box"></div>
              <div class="donut-center">
                <div class="donut-center-value">{{ fmtMoney(stats.total_cents) }}</div>
                <div class="donut-center-label">本月总支出</div>
              </div>
            </div>
          </div>
          <div class="chart-card">
            <div class="chart-title">分类支出排行</div>
            <div ref="barEl" class="chart-box"></div>
          </div>
        </div>

        <div class="chart-card">
          <div class="chart-title">近 6 个月支出趋势</div>
          <div ref="lineEl" class="chart-box small"></div>
        </div>
      </div>
    </template>
  </div>
</template>
