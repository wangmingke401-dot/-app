<script setup>
import { ref } from 'vue'
import BillsView from './views/BillsView.vue'
import CategoriesView from './views/CategoriesView.vue'
import StatsView from './views/StatsView.vue'

const view = ref('bills')
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="logo">
        <span class="logo-icon">🐎</span>
        <div>
          <div class="logo-name">黑马记账</div>
          <div class="logo-sub">本地记账 · 隐私安全</div>
        </div>
      </div>
      <nav>
        <button class="nav-btn" :class="{ active: view === 'bills' }" @click="view = 'bills'">
          📒 账单
        </button>
        <button class="nav-btn" :class="{ active: view === 'categories' }" @click="view = 'categories'">
          🗂️ 分类
        </button>
        <button class="nav-btn" :class="{ active: view === 'stats' }" @click="view = 'stats'">
          📊 统计
        </button>
      </nav>
      <div class="sidebar-foot">所有数据只保存在<br />你自己电脑上，不联网</div>
    </aside>
    <main class="main">
      <BillsView v-if="view === 'bills'" />
      <CategoriesView v-else-if="view === 'categories'" />
      <StatsView v-else />
    </main>
  </div>
</template>
