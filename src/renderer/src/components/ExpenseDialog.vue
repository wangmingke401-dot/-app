<script setup>
import { ref, computed, watch } from 'vue'
import { todayStr, cleanIpcError } from '../utils'

const props = defineProps({
  categories: { type: Array, default: () => [] },
  editing: { type: Object, default: null } // null 表示新增
})
const emit = defineEmits(['saved', 'deleted', 'cancel'])

const amount = ref('')
const date = ref(todayStr())
const note = ref('')
const selectedParent = ref(null) // 选中的一级大类 id
const selectedChild = ref(null) // 选中的二级小类 id
const error = ref('')
const saving = ref(false)

// 打开弹窗时根据「新增 / 编辑」填充表单
watch(
  () => props.editing,
  (v) => {
    error.value = ''
    if (v) {
      amount.value = (v.amount_cents / 100).toFixed(2)
      date.value = v.date
      note.value = v.note
      selectedChild.value = v.category_id
      selectedParent.value =
        props.categories.find((p) => p.children.some((c) => c.id === v.category_id))?.id ?? null
    } else {
      amount.value = ''
      date.value = todayStr()
      note.value = ''
      selectedParent.value = null
      selectedChild.value = null
    }
  },
  { immediate: true }
)

const activeChildren = computed(
  () => props.categories.find((p) => p.id === selectedParent.value)?.children ?? []
)

function selectParent(id) {
  selectedParent.value = id
  selectedChild.value = null // 切换大类时清空已选小类
}

async function save() {
  error.value = ''
  const amt = parseFloat(amount.value)
  if (!amount.value || !Number.isFinite(amt) || amt <= 0) {
    error.value = '请输入大于 0 的金额'
    return
  }
  if (amt > 99999999.99) {
    error.value = '金额太大啦，请检查一下'
    return
  }
  if (!selectedChild.value) {
    error.value = '请选择分类（大类 + 小类）'
    return
  }
  if (!date.value) {
    error.value = '请选择日期'
    return
  }

  saving.value = true
  try {
    const payload = {
      amount: amount.value,
      category_id: selectedChild.value,
      date: date.value,
      note: note.value.trim()
    }
    if (props.editing) {
      await window.api.updateExpense(props.editing.id, payload)
    } else {
      await window.api.createExpense(payload)
    }
    emit('saved')
  } catch (err) {
    error.value = cleanIpcError(err)
  } finally {
    saving.value = false
  }
}

async function del() {
  if (!confirm('确定删除这笔账吗？删除后无法恢复。')) return
  saving.value = true
  try {
    await window.api.deleteExpense(props.editing.id)
    emit('deleted')
  } catch (err) {
    error.value = cleanIpcError(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="dialog-mask" @click.self="$emit('cancel')">
    <div class="dialog">
      <div class="dialog-header">
        <span class="dialog-title">{{ editing ? '编辑账单' : '记一笔' }}</span>
        <button class="icon-btn" title="关闭" @click="$emit('cancel')">✕</button>
      </div>

      <div class="dialog-body">
        <div class="field">
          <label>金额（元）</label>
          <div class="amount-input-wrap">
            <span class="amount-prefix">¥</span>
            <input
              v-model="amount"
              class="amount-input"
              type="number"
              min="0.01"
              step="0.01"
              inputmode="decimal"
              placeholder="0.00"
              autofocus
            />
          </div>
        </div>

        <div class="field">
          <label>分类</label>
          <div class="cat-picker">
            <div class="cat-parents">
              <button
                v-for="p in categories"
                :key="p.id"
                class="cat-parent"
                :class="{ active: p.id === selectedParent }"
                @click="selectParent(p.id)"
              >
                {{ p.icon }} {{ p.name }}
              </button>
            </div>
            <div class="cat-children">
              <button
                v-for="c in activeChildren"
                :key="c.id"
                class="cat-child"
                :class="{ active: c.id === selectedChild }"
                @click="selectedChild = c.id"
              >
                {{ c.name }}
              </button>
            </div>
          </div>
        </div>

        <div class="field">
          <label>日期</label>
          <input v-model="date" type="date" class="text-input" />
        </div>

        <div class="field">
          <label>备注（选填）</label>
          <input
            v-model="note"
            class="text-input"
            placeholder="例如：和同事聚餐"
            maxlength="100"
          />
        </div>

        <p v-if="error" class="form-error">{{ error }}</p>
      </div>

      <div class="dialog-footer">
        <button v-if="editing" class="btn-danger" :disabled="saving" @click="del">删除</button>
        <div class="spacer"></div>
        <button class="btn-ghost" @click="$emit('cancel')">取消</button>
        <button class="btn-primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>
