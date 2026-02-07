const { app, BrowserWindow, ipcMain, Notification, globalShortcut, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const Logger = require('./logger');
const { encryptConfig, decryptConfig } = require('./crypto');

// 数据存储路径
const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'config.json');
const chatsPath = path.join(userDataPath, 'chats');
const skillsPath = path.join(userDataPath, 'skills');
const mcpPath = path.join(userDataPath, 'mcp');
const tasksPath = path.join(userDataPath, 'tasks.json');
const logsPath = path.join(userDataPath, 'logs');

// 初始化日志
const logger = new Logger(logsPath);
logger.info('应用启动', { version: app.getVersion(), platform: process.platform });

// 清理旧日志
logger.cleanOldLogs(7);

// 确保目录存在
[chatsPath, skillsPath, mcpPath].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

let mainWindow;
let tray = null;
const activeTimers = new Map();

// 创建托盘图标
function createTray() {
  // 创建简单的托盘图标（16x16 像素的简单图标）
  const iconPath = process.platform === 'darwin' 
    ? path.join(__dirname, 'assets', 'tray-icon.png')
    : path.join(__dirname, 'assets', 'tray-icon.png');
  
  // 如果没有图标文件，使用默认
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    // 创建一个简单的默认图标
    icon = nativeImage.createEmpty();
  }
  
  tray = new Tray(icon.isEmpty() ? createDefaultIcon() : icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: '显示窗口', 
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    { 
      label: '新建对话', 
      click: () => {
        mainWindow?.show();
        mainWindow?.webContents.send('shortcut:newChat');
      }
    },
    { type: 'separator' },
    { 
      label: '设置', 
      click: () => {
        mainWindow?.show();
        mainWindow?.webContents.send('shortcut:settings');
      }
    },
    { type: 'separator' },
    { 
      label: '退出', 
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('Claude Agent');
  tray.setContextMenu(contextMenu);
  
  // 点击托盘图标显示窗口
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

// 创建默认图标（简单的蓝色圆形）
function createDefaultIcon() {
  const size = 16;
  const canvas = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="7" fill="#00d9ff"/>
    <text x="8" y="12" font-size="10" fill="white" text-anchor="middle">C</text>
  </svg>`;
  return nativeImage.createFromBuffer(Buffer.from(canvas));
}

// 注册全局快捷键
function registerShortcuts() {
  // Cmd/Ctrl + Shift + C: 显示/隐藏窗口
  globalShortcut.register('CommandOrControl+Shift+C', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
  
  logger.info('全局快捷键已注册');
}

// 注销快捷键
function unregisterShortcuts() {
  globalShortcut.unregisterAll();
}

// 全局错误处理
process.on('uncaughtException', (error) => {
  logger.error('未捕获异常', { message: error.message, stack: error.stack });
});

process.on('unhandledRejection', (reason) => {
  logger.error('未处理的 Promise 拒绝', { reason: String(reason) });
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? false : true,
    show: false // 先隐藏，准备好后再显示
  });

  mainWindow.loadFile('dist/index.html');
  
  // 准备好后显示窗口
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // 关闭时隐藏到托盘而不是退出
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  logger.info('主窗口已创建');
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  registerShortcuts();
  loadAndStartTasks();
});

app.on('window-all-closed', () => {
  // macOS 下不退出
  if (process.platform !== 'darwin') {
    // Windows/Linux 也不退出，保持托盘
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  } else {
    createWindow();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  unregisterShortcuts();
  logger.info('应用即将退出');
});

// ==================== 工具函数 ====================

function safeReadJSON(filePath, defaultValue = null) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) {
    logger.error('读取 JSON 失败', { path: filePath, error: e.message });
  }
  return defaultValue;
}

function safeWriteJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    logger.error('写入 JSON 失败', { path: filePath, error: e.message });
    return false;
  }
}

// 网络请求封装（带重试）
async function fetchWithRetry(url, options, retries = 3, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        logger.warn('请求超时', { url, attempt: i + 1 });
        if (i === retries - 1) throw new Error('请求超时，请检查网络连接');
      } else if (i === retries - 1) {
        throw error;
      }
      
      // 等待后重试
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      logger.info('重试请求', { url, attempt: i + 2 });
    }
  }
}

// ==================== 定时任务系统 ====================

function loadTasks() {
  return safeReadJSON(tasksPath, []);
}

function saveTasks(tasks) {
  return safeWriteJSON(tasksPath, tasks);
}

function loadAndStartTasks() {
  const tasks = loadTasks();
  tasks.forEach(task => {
    if (task.enabled) {
      startTask(task);
    }
  });
  logger.info('定时任务已加载', { count: tasks.filter(t => t.enabled).length });
}

function startTask(task) {
  stopTask(task.id);
  
  if (!task.enabled) return;
  
  switch (task.type) {
    case 'reminder':
      const reminderTime = new Date(task.triggerAt).getTime();
      const now = Date.now();
      if (reminderTime > now) {
        const timer = setTimeout(() => {
          showNotification(task.title, task.message);
          const tasks = loadTasks();
          const t = tasks.find(t => t.id === task.id);
          if (t) {
            t.enabled = false;
            t.lastRun = new Date().toISOString();
            saveTasks(tasks);
            mainWindow?.webContents.send('tasks:updated');
          }
          logger.info('提醒任务已触发', { taskId: task.id, name: task.name });
        }, reminderTime - now);
        activeTimers.set(task.id, { type: 'timeout', timer });
      }
      break;
      
    case 'scheduled':
      const scheduleTime = new Date(task.triggerAt).getTime();
      const nowSched = Date.now();
      if (scheduleTime > nowSched) {
        const timer = setTimeout(async () => {
          await executePrompt(task);
          const tasks = loadTasks();
          const t = tasks.find(t => t.id === task.id);
          if (t) {
            t.enabled = false;
            t.lastRun = new Date().toISOString();
            saveTasks(tasks);
            mainWindow?.webContents.send('tasks:updated');
          }
        }, scheduleTime - nowSched);
        activeTimers.set(task.id, { type: 'timeout', timer });
      }
      break;
      
    case 'interval':
      const intervalMs = task.intervalMinutes * 60 * 1000;
      const intervalTimer = setInterval(async () => {
        await executePrompt(task);
        const tasks = loadTasks();
        const t = tasks.find(t => t.id === task.id);
        if (t) {
          t.lastRun = new Date().toISOString();
          saveTasks(tasks);
        }
      }, intervalMs);
      activeTimers.set(task.id, { type: 'interval', timer: intervalTimer });
      break;
  }
}

function stopTask(taskId) {
  const timerInfo = activeTimers.get(taskId);
  if (timerInfo) {
    if (timerInfo.type === 'interval') {
      clearInterval(timerInfo.timer);
    } else {
      clearTimeout(timerInfo.timer);
    }
    activeTimers.delete(taskId);
  }
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title,
      body: body,
      silent: false
    });
    notification.show();
    notification.on('click', () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
  }
}

async function executePrompt(task) {
  try {
    const config = safeReadJSON(configPath);
    if (!config) {
      showNotification('任务执行失败', '请先配置 API');
      return;
    }
    
    const decrypted = decryptConfig(config);
    const provider = decrypted.providers[decrypted.activeProvider];
    if (!provider || !provider.apiKey) {
      showNotification('任务执行失败', '请先配置 API Key');
      return;
    }
    
    logger.info('执行定时任务', { taskId: task.id, name: task.name });
    
    const response = await fetchWithRetry(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: decrypted.activeModel,
        messages: [{ role: 'user', content: task.prompt }],
        max_tokens: 2048
      })
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    
    const data = await response.json();
    const result = data.choices?.[0]?.message?.content || '无响应';
    
    mainWindow?.webContents.send('task:result', {
      taskId: task.id,
      taskName: task.name,
      result: result,
      timestamp: new Date().toISOString()
    });
    
    if (task.notifyOnResult) {
      showNotification(`${task.name} 执行完成`, result.slice(0, 100));
    }
    
    logger.info('定时任务执行成功', { taskId: task.id });
    
  } catch (error) {
    logger.error('定时任务执行失败', { taskId: task.id, error: error.message });
    showNotification('任务执行错误', error.message);
  }
}

// ==================== IPC Handlers ====================

// 配置管理（带加密）
ipcMain.handle('config:get', () => {
  const config = safeReadJSON(configPath, {
    theme: 'dark',
    activeProvider: 'default',
    providers: {
      default: {
        name: 'NewAPI',
        baseUrl: 'https://newapi.0707007.xyz/v1',
        apiKey: '',
        models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'gpt-4o']
      }
    },
    activeModel: 'claude-3-5-sonnet-20241022'
  });
  
  return decryptConfig(config);
});

ipcMain.handle('config:save', (_, config) => {
  const encrypted = encryptConfig(config);
  const success = safeWriteJSON(configPath, encrypted);
  if (success) {
    logger.info('配置已保存');
  }
  return success;
});

// 对话管理
ipcMain.handle('chats:list', () => {
  try {
    const files = fs.readdirSync(chatsPath).filter(f => f.endsWith('.json'));
    return files.map(f => {
      const data = safeReadJSON(path.join(chatsPath, f), {});
      return { 
        id: f.replace('.json', ''), 
        title: data.title || '未命名', 
        updatedAt: data.updatedAt 
      };
    }).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  } catch (e) {
    logger.error('获取对话列表失败', { error: e.message });
    return [];
  }
});

ipcMain.handle('chats:get', (_, id) => {
  return safeReadJSON(path.join(chatsPath, `${id}.json`));
});

ipcMain.handle('chats:save', (_, chat) => {
  chat.updatedAt = new Date().toISOString();
  return safeWriteJSON(path.join(chatsPath, `${chat.id}.json`), chat);
});

ipcMain.handle('chats:delete', (_, id) => {
  try {
    const filePath = path.join(chatsPath, `${id}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    logger.info('对话已删除', { id });
    return true;
  } catch (e) {
    logger.error('删除对话失败', { id, error: e.message });
    return false;
  }
});

// Skills 管理
ipcMain.handle('skills:list', () => {
  const skills = [];
  try {
    if (fs.existsSync(skillsPath)) {
      fs.readdirSync(skillsPath).forEach(dir => {
        const skillFile = path.join(skillsPath, dir, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          const content = fs.readFileSync(skillFile, 'utf-8');
          const nameMatch = content.match(/^name:\s*(.+)$/m);
          const descMatch = content.match(/^description:\s*(.+)$/m);
          skills.push({
            id: dir,
            name: nameMatch ? nameMatch[1] : dir,
            description: descMatch ? descMatch[1] : '',
            path: path.join(skillsPath, dir)
          });
        }
      });
    }
  } catch (e) {
    logger.error('获取 Skills 列表失败', { error: e.message });
  }
  return skills;
});

ipcMain.handle('skills:get', (_, id) => {
  try {
    const skillFile = path.join(skillsPath, id, 'SKILL.md');
    if (fs.existsSync(skillFile)) {
      return fs.readFileSync(skillFile, 'utf-8');
    }
  } catch (e) {
    logger.error('读取 Skill 失败', { id, error: e.message });
  }
  return null;
});

ipcMain.handle('skills:import', (_, skillPath) => {
  try {
    const skillName = path.basename(skillPath);
    const targetPath = path.join(skillsPath, skillName);
    fs.cpSync(skillPath, targetPath, { recursive: true });
    logger.info('Skill 已导入', { name: skillName });
    return true;
  } catch (e) {
    logger.error('导入 Skill 失败', { error: e.message });
    return false;
  }
});

// MCP 管理
ipcMain.handle('mcp:list', () => {
  return safeReadJSON(path.join(mcpPath, 'config.json'), { servers: [] });
});

ipcMain.handle('mcp:save', (_, config) => {
  return safeWriteJSON(path.join(mcpPath, 'config.json'), config);
});

// 定时任务管理
ipcMain.handle('tasks:list', () => loadTasks());

ipcMain.handle('tasks:add', (_, task) => {
  const tasks = loadTasks();
  task.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
  task.createdAt = new Date().toISOString();
  task.enabled = true;
  tasks.push(task);
  saveTasks(tasks);
  startTask(task);
  logger.info('定时任务已创建', { taskId: task.id, name: task.name, type: task.type });
  return task;
});

ipcMain.handle('tasks:update', (_, task) => {
  const tasks = loadTasks();
  const index = tasks.findIndex(t => t.id === task.id);
  if (index !== -1) {
    tasks[index] = { ...tasks[index], ...task };
    saveTasks(tasks);
    if (task.enabled) {
      startTask(tasks[index]);
    } else {
      stopTask(task.id);
    }
    logger.info('定时任务已更新', { taskId: task.id });
  }
  return true;
});

ipcMain.handle('tasks:delete', (_, id) => {
  stopTask(id);
  const tasks = loadTasks().filter(t => t.id !== id);
  saveTasks(tasks);
  logger.info('定时任务已删除', { taskId: id });
  return true;
});

ipcMain.handle('tasks:toggle', (_, id) => {
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.enabled = !task.enabled;
    saveTasks(tasks);
    if (task.enabled) {
      startTask(task);
    } else {
      stopTask(id);
    }
    logger.info('定时任务状态已切换', { taskId: id, enabled: task.enabled });
  }
  return true;
});

ipcMain.handle('tasks:runNow', async (_, id) => {
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === id);
  if (task) {
    await executePrompt(task);
    task.lastRun = new Date().toISOString();
    saveTasks(tasks);
  }
  return true;
});

// API 调用（流式响应）
ipcMain.handle('api:chat', async (_, { messages, config, stream = false }) => {
  try {
    const decrypted = decryptConfig(config);
    const provider = decrypted.providers[decrypted.activeProvider];
    if (!provider || !provider.apiKey) {
      throw new Error('请先配置 API Key');
    }
    
    logger.debug('API 调用', { model: decrypted.activeModel, stream });
    
    const response = await fetchWithRetry(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: decrypted.activeModel,
        messages: messages,
        max_tokens: 4096,
        stream: stream
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    logger.error('API 调用失败', { error: error.message });
    return { error: error.message };
  }
});

// 流式 API 调用
ipcMain.handle('api:chatStream', async (event, { messages, config }) => {
  try {
    const decrypted = decryptConfig(config);
    const provider = decrypted.providers[decrypted.activeProvider];
    if (!provider || !provider.apiKey) {
      throw new Error('请先配置 API Key');
    }
    
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: decrypted.activeModel,
        messages: messages,
        max_tokens: 4096,
        stream: true
      })
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            mainWindow?.webContents.send('stream:done');
            return { success: true };
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              mainWindow?.webContents.send('stream:chunk', content);
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }
    
    return { success: true };
  } catch (error) {
    logger.error('流式 API 调用失败', { error: error.message });
    return { error: error.message };
  }
});

// 获取日志
ipcMain.handle('logs:get', () => {
  try {
    const logFile = path.join(logsPath, `app-${new Date().toISOString().split('T')[0]}.log`);
    if (fs.existsSync(logFile)) {
      return fs.readFileSync(logFile, 'utf-8');
    }
  } catch (e) {
    // ignore
  }
  return '';
});

// 检查网络状态
ipcMain.handle('network:check', async () => {
  try {
    const response = await fetch('https://www.google.com/generate_204', {
      method: 'HEAD',
      timeout: 5000
    });
    return response.status === 204;
  } catch (e) {
    return false;
  }
});

// 窗口控制
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window:close', () => {
  mainWindow?.hide();
});
