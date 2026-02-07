const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 配置
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    save: (config) => ipcRenderer.invoke('config:save', config)
  },
  // 对话
  chats: {
    list: () => ipcRenderer.invoke('chats:list'),
    get: (id) => ipcRenderer.invoke('chats:get', id),
    save: (chat) => ipcRenderer.invoke('chats:save', chat),
    delete: (id) => ipcRenderer.invoke('chats:delete', id)
  },
  // Skills
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    get: (id) => ipcRenderer.invoke('skills:get', id),
    import: (path) => ipcRenderer.invoke('skills:import', path)
  },
  // MCP
  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    save: (config) => ipcRenderer.invoke('mcp:save', config)
  },
  // 定时任务
  tasks: {
    list: () => ipcRenderer.invoke('tasks:list'),
    add: (task) => ipcRenderer.invoke('tasks:add', task),
    update: (task) => ipcRenderer.invoke('tasks:update', task),
    delete: (id) => ipcRenderer.invoke('tasks:delete', id),
    toggle: (id) => ipcRenderer.invoke('tasks:toggle', id),
    runNow: (id) => ipcRenderer.invoke('tasks:runNow', id),
    onResult: (callback) => ipcRenderer.on('task:result', (_, data) => callback(data)),
    onUpdated: (callback) => ipcRenderer.on('tasks:updated', () => callback())
  },
  // AI 对话
  chat: (messages, config) => ipcRenderer.invoke('api:chat', { messages, config }),
  // 流式对话
  chatStream: (messages, config) => ipcRenderer.invoke('api:chatStream', { messages, config }),
  onStreamChunk: (callback) => ipcRenderer.on('stream:chunk', (_, chunk) => callback(chunk)),
  onStreamDone: (callback) => ipcRenderer.on('stream:done', () => callback()),
  removeStreamListeners: () => {
    ipcRenderer.removeAllListeners('stream:chunk');
    ipcRenderer.removeAllListeners('stream:done');
  },
  // 工具
  logs: {
    get: () => ipcRenderer.invoke('logs:get')
  },
  network: {
    check: () => ipcRenderer.invoke('network:check')
  },
  // 快捷键事件
  shortcuts: {
    onNewChat: (callback) => ipcRenderer.on('shortcut:newChat', () => callback()),
    onSettings: (callback) => ipcRenderer.on('shortcut:settings', () => callback())
  },
  // 窗口控制
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close')
  }
});
