import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { initDatabase } from './db'

// 应用名（决定数据文件的存放目录名）
app.setName('黑马记账')

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 750,
    minWidth: 940,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f5f7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 界面里如果有链接，用系统默认浏览器打开，不在应用内打开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL) // 开发模式：加载开发服务器
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html')) // 打包后：加载本地页面
  }
}

app.whenReady().then(() => {
  initDatabase()
  createWindow()

  // macOS 习惯：点击程序坞图标时若无窗口则重新打开
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
