<script setup>
import { computed } from 'vue'
import { fmtYM } from '../utils'

// 月份切换条：账单页和统计页共用
const props = defineProps({
  year: { type: Number, required: true },
  month: { type: Number, required: true }
})
const emit = defineEmits(['update:year', 'update:month'])

const now = new Date()
const isCurrentMonth = computed(
  () => props.year === now.getFullYear() && props.month === now.getMonth() + 1
)

function shiftMonth(delta) {
  const target = new Date(props.year, props.month - 1 + delta, 1)
  emit('update:year', target.getFullYear())
  emit('update:month', target.getMonth() + 1)
}

function goCurrentMonth() {
  emit('update:year', now.getFullYear())
  emit('update:month', now.getMonth() + 1)
}
</script>

<template>
  <div class="month-nav">
    <button class="icon-btn" title="上个月" @click="shiftMonth(-1)">‹</button>
    <div class="month-title">{{ fmtYM(year, month) }}</div>
    <button class="icon-btn" title="下个月" :disabled="isCurrentMonth" @click="shiftMonth(1)">›</button>
    <button v-if="!isCurrentMonth" class="link-btn" @click="goCurrentMonth">回到本月</button>
  </div>
</template>
