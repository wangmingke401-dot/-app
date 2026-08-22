<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { cleanIpcError } from '../utils'

// 一级分类可选的预设图标
const ICON_PRESETS = ['🍚', '🚗', '🛒', '🏠', '🎮', '🏥', '📚', '🧧', '💰', '📦', '☕', '👶', '🐶', '✈️', '📱', '🎁']

const categories = ref([])
const loading = ref(true)
const saving = ref(false) // 弹窗保存中
const busy = ref(false) // 删除操作中（防止重复点击）
// 弹窗状态机：null 关闭；其余见 openXxx 系列函数
const dialog = ref(null)
const form = reactive({ name: '', icon: '📦' })
const error = ref('')

const isParentMode = computed(() => ['create-parent', 'edit-parent'].includes(dialog.value?.mode))

const dialogTitle = computed(() => {
  const d = dialog.value
  if (!d) return ''
  if (d.mode === 'create-parent') return '添加一级分类'
  if (d.mode === 'edit-parent') return '编辑一级分类'
  if (d.mode === 'create-child') return `在「${d.parentName}」下添加小类`
  return `编辑小类（${d.parentName}）`
})

async function load() {
  loading.value = true
  try {
    categories.value = await window.api.getCategories()
  } finally {
    loading.value = false
  }
}

function openCreateParent() {
  dialog.value = { mode: 'create-parent' }
  form.name = ''
  form.icon = '📦'
  error.value = ''
}

function openEditParent(p) {
  dialog.value = { mode: 'edit-parent', id: p.id }
  form.name = p.name
  form.icon = p.icon || '📦'
  error.value = ''
}

function openCreateChild(p) {
  dialog.value = { mode: 'create-child', parentId: p.id, parentName: p.name }
  form.name = ''
  error.value = ''
}

function openEditChild(p, c) {
  dialog.value = { mode: 'edit-child', id: c.id, parentName: p.name }
  form.name = c.name
  error.value = ''
}

async function save() {
  error.value = ''
  const name = form.name.trim()
  if (!name) {
    error.value = '请输入分类名称'
    return
  }
  if ([...name].length > 10) {
    error.value = '分类名称最多 10 个字'
    return
  }

  saving.value = true
  try {
    const d = dialog.value
    if (d.mode === 'create-parent') {
      await window.api.createCategory({ parent_id: null, name, icon: form.icon })
    } else if (d.mode === 'create-child') {
      await window.api.createCategory({ parent_id: d.parentId, name })
    } else if (d.mode === 'edit-parent') {
      await window.api.updateCategory(d.id, { name, icon: form.icon })
    } else {
      await window.api.updateCategory(d.id, { name })
    }
    dialog.value = null
    await load()
  } catch (err) {
    error.value = cleanIpcError(err)
  } finally {
    saving.value = false
  }
}

async function removeCategory(cat, isParent) {
  const tip = isParent
    ? `确定删除大类「${cat.name}」吗？其下所有小类会一并删除，删除后无法恢复。`
    : `确定删除分类「${cat.name}」吗？删除后无法恢复。`
  if (!confirm(tip)) return

  busy.value = true
  try {
    await window.api.deleteCategory(cat.id)
    await load()
  } catch (err) {
    alert(cleanIpcError(err)) // 分类下有账目等原因被后台拒绝时，弹窗告知
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <span class="month-title">分类管理</span>
      <button class="btn-primary" @click="openCreateParent">＋ 添加一级分类</button>
    </header>

    <div v-if="loading" class="empty">加载中…</div>
    <div v-else-if="!categories.length" class="empty">
      <div class="empty-icon">🗂️</div>
      <p>还没有分类</p>
      <p class="empty-sub">点击右上角「添加一级分类」新建</p>
    </div>
    <div v-else class="cat-manage">
      <section v-for="p in categories" :key="p.id" class="cat-card">
        <div class="cat-card-header">
          <div class="cat-card-icon">{{ p.icon }}</div>
          <div class="cat-name">{{ p.name }}</div>
          <div class="cat-actions">
            <button class="link-btn cat-add-child" :disabled="busy" @click="openCreateChild(p)">
              添加小类
            </button>
            <button class="link-btn cat-edit" :disabled="busy" @click="openEditParent(p)">编辑</button>
            <button class="link-btn link-danger cat-delete" :disabled="busy" @click="removeCategory(p, true)">
              删除
            </button>
          </div>
        </div>
        <div class="cat-children">
          <template v-if="p.children.length">
            <div v-for="c in p.children" :key="c.id" class="cat-child-row">
              <div class="cat-child-name">{{ c.name }}</div>
              <div class="cat-actions">
                <button class="link-btn cat-edit" :disabled="busy" @click="openEditChild(p, c)">编辑</button>
                <button class="link-btn link-danger cat-delete" :disabled="busy" @click="removeCategory(c, false)">
                  删除
                </button>
              </div>
            </div>
          </template>
          <div v-else class="cat-empty-children">还没有小类，点击「添加小类」新建</div>
        </div>
      </section>
    </div>

    <div v-if="dialog" class="dialog-mask" @click.self="dialog = null">
      <div class="dialog dialog-narrow">
        <div class="dialog-header">
          <span class="dialog-title">{{ dialogTitle }}</span>
          <button class="icon-btn" title="关闭" @click="dialog = null">✕</button>
        </div>

        <div class="dialog-body">
          <div class="field">
            <label>分类名称</label>
            <input v-model="form.name" class="text-input" maxlength="10" placeholder="最多 10 个字" autofocus />
          </div>

          <div v-if="isParentMode" class="field">
            <label>图标</label>
            <div class="emoji-grid">
              <button
                v-for="e in ICON_PRESETS"
                :key="e"
                type="button"
                class="emoji-cell"
                :class="{ active: form.icon === e }"
                @click="form.icon = e"
              >
                {{ e }}
              </button>
            </div>
          </div>

          <p v-if="error" class="form-error">{{ error }}</p>
        </div>

        <div class="dialog-footer">
          <div class="spacer"></div>
          <button class="btn-ghost" @click="dialog = null">取消</button>
          <button class="btn-primary" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
