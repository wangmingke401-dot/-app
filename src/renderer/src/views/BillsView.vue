<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import ExpenseDialog from '../components/ExpenseDialog.vue'
import MonthNav from '../components/MonthNav.vue'
import { fmtMoney, fmtDateCN, weekDay } from '../utils'

const now = new Date()
const year = ref(now.getFullYear())
const month = ref(now.getMonth() + 1)
const expenses = ref([])
const categories = ref([])
const loading = ref(true)
const showDialog = ref(false)
const editing = ref(null) // null 表示新增；否则为正在编辑的那笔账

const monthTotal = computed(() => expenses.value.reduce((s, e) => s + e.amount_cents, 0))

// 按日期分组（后台已按日期倒序返回）
const grouped = computed(() => {
  const map = new Map()
  for (const e of expenses.value) {
    if (!map.has(e.date)) map.set(e.date, [])
    map.get(e.date).push(e)
  }
  return [...map.entries()].map(([date, items]) => ({
    date,
    items,
    total: items.reduce((s, e) => s + e.amount_cents, 0)
  }))
})

async function load() {
  loading.value = true
  try {
    const [list, cats] = await Promise.all([
      window.api.getExpenses({ year: year.value, month: month.value }),
      window.api.getCategories()
    ])
    expenses.value = list
    categories.value = cats
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  showDialog.value = true
}

function openEdit(expense) {
  editing.value = expense
  showDialog.value = true
}

watch([year, month], load)
onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <MonthNav v-model:year="year" v-model:month="month" />
      <button class="btn-primary" @click="openCreate">＋ 记一笔</button>
    </header>

    <div class="month-summary">
      <span>本月共支出</span>
      <span class="summary-amount">{{ fmtMoney(monthTotal) }}</span>
      <span class="summary-count">· {{ expenses.length }} 笔</span>
    </div>

    <div v-if="loading" class="empty">加载中…</div>
    <div v-else-if="!grouped.length" class="empty">
      <div class="empty-icon">🐎</div>
      <p>这个月还没有账单</p>
      <p class="empty-sub">点击右上角「记一笔」开始记账吧</p>
    </div>
    <div v-else class="bill-list">
      <section v-for="g in grouped" :key="g.date" class="day-group">
        <div class="day-header">
          <span>{{ fmtDateCN(g.date) }} · {{ weekDay(g.date) }}</span>
          <span class="day-total">支出 {{ fmtMoney(g.total) }}</span>
        </div>
        <div v-for="e in g.items" :key="e.id" class="bill-item" @click="openEdit(e)">
          <div class="bill-icon">{{ e.parent_icon }}</div>
          <div class="bill-info">
            <div class="bill-title">{{ e.category_name }}</div>
            <div class="bill-sub">
              {{ e.parent_name }}<template v-if="e.note"> · {{ e.note }}</template>
            </div>
          </div>
          <div class="bill-amount">-{{ fmtMoney(e.amount_cents) }}</div>
        </div>
      </section>
    </div>

    <ExpenseDialog
      v-if="showDialog"
      :categories="categories"
      :editing="editing"
      @saved="showDialog = false; load()"
      @deleted="showDialog = false; load()"
      @cancel="showDialog = false"
    />
  </div>
</template>
