import { contextBridge, ipcRenderer } from 'electron'

// 把后台能力以 window.api 的形式提供给界面，界面不能直接碰系统底层，更安全
contextBridge.exposeInMainWorld('api', {
  getCategories: () => ipcRenderer.invoke('categories:list'),
  createCategory: (data) => ipcRenderer.invoke('categories:create', data),
  updateCategory: (id, data) => ipcRenderer.invoke('categories:update', { id, ...data }),
  deleteCategory: (id) => ipcRenderer.invoke('categories:delete', id),
  getExpenses: (query) => ipcRenderer.invoke('expenses:list', query),
  createExpense: (data) => ipcRenderer.invoke('expenses:create', data),
  updateExpense: (id, data) => ipcRenderer.invoke('expenses:update', { id, ...data }),
  deleteExpense: (id) => ipcRenderer.invoke('expenses:delete', id),
  getMonthStats: (query) => ipcRenderer.invoke('stats:month', query),
  getTrend: (months) => ipcRenderer.invoke('stats:trend', { months })
})
