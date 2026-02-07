// Claude Agent PWA - 移动端 + 浏览器
(function() {
  'use strict';

  // ==================== API 客户端 ====================
  
  const API = {
    baseUrl: window.location.origin,
    token: localStorage.getItem('auth_token') || '',
    
    setToken(token) {
      this.token = token;
      localStorage.setItem('auth_token', token);
    },
    
    async request(method, path, body = null) {
      const opts = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        }
      };
      if (body) opts.body = JSON.stringify(body);
      
      const res = await fetch(this.baseUrl + path, opts);
      if (res.status === 401) {
        showLogin();
        throw new Error('认证失败');
      }
      return res.json();
    },
    
    // 对话
    getChats: () => API.request('GET', '/api/chats'),
    getChat: (id) => API.request('GET', `/api/chats/${id}`),
    saveChat: (chat) => API.request('PUT', `/api/chats/${chat.id}`, chat),
    deleteChat: (id) => API.request('DELETE', `/api/chats/${id}`),
    
    // 配置
    getConfig: () => API.request('GET', '/api/config'),
    saveConfig: (config) => API.request('PUT', '/api/config', config),
    
    // 任务
    getTasks: () => API.request('GET', '/api/tasks'),
    saveTasks: (tasks) => API.request('PUT', '/api/tasks', tasks),
    
    // AI
    chat: (messages, provider, model) => API.request('POST', '/api/ai/chat', { messages, provider, model }),
    
    // 同步
    pull: () => API.request('GET', '/api/sync/pull'),
    push: (data) => API.request('POST', '/api/sync/push', data)
  };

  // ==================== 状态管理 ====================
  
  const state = {
    config: {},
    chats: [],
    currentChat: null,
    tasks: [],
    view: 'chat',
    showSidebar: false, // 移动端侧边栏
    isSending: false,
    showSystemPrompt: false
  };

  // ==================== 初始化 ====================
  
  async function init() {
    // 注册 Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js');
    }
    
    if (!API.token) {
      showLogin();
      return;
    }
    
    try {
      state.config = await API.getConfig();
      state.chats = await API.getChats();
      state.tasks = await API.getTasks();
      render();
    } catch (e) {
      showLogin();
    }
  }

  // ==================== 登录界面 ====================
  
  function showLogin() {
    document.getElementById('app').innerHTML = `
      <div class="login-screen">
        <div class="login-card">
          <h1>🤖 Claude Agent</h1>
          <p>输入服务器 Token 连接</p>
          <input type="password" id="loginToken" placeholder="Auth Token..." autofocus>
          <div class="login-server">
            <label>服务器地址</label>
            <input type="text" id="loginServer" value="${API.baseUrl}" placeholder="http://your-server:3721">
          </div>
          <button onclick="doLogin()">连接</button>
        </div>
      </div>
    `;
  }

  window.doLogin = async function() {
    const token = document.getElementById('loginToken').value.trim();
    const server = document.getElementById('loginServer').value.trim();
    if (!token) return;
    
    API.baseUrl = server;
    API.setToken(token);
    localStorage.setItem('server_url', server);
    
    try {
      await API.getConfig();
      init();
    } catch (e) {
      alert('连接失败，请检查 Token 和服务器地址');
    }
  };

  // ==================== 渲染 ====================
  
  function render() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="app-container ${state.showSidebar ? 'sidebar-open' : ''}">
        <div class="sidebar-overlay" onclick="toggleSidebar()"></div>
        <aside class="sidebar">
          <div class="sidebar-header">
            <h1>🤖 Claude Agent</h1>
            <button class="btn-icon" onclick="window.newChat()">✏️</button>
          </div>
          <nav class="nav-tabs">
            <button class="${state.view === 'chat' ? 'active' : ''}" onclick="setView('chat')">💬</button>
            <button class="${state.view === 'tasks' ? 'active' : ''}" onclick="setView('tasks')">⏰</button>
            <button class="${state.view === 'settings' ? 'active' : ''}" onclick="setView('settings')">⚙️</button>
          </nav>
          <div class="chat-list">
            ${state.chats.map(chat => `
              <div class="chat-item ${state.currentChat?.id === chat.id ? 'active' : ''}" onclick="loadChat('${chat.id}')">
                <span>${chat.title || '新对话'}</span>
                <button class="btn-delete" onclick="deleteChat('${chat.id}', event)">×</button>
              </div>
            `).join('')}
          </div>
        </aside>
        <main class="main">
          <div class="topbar">
            <button class="btn-icon hamburger" onclick="toggleSidebar()">☰</button>
            <span class="topbar-title">${getTitle()}</span>
            ${state.view === 'chat' && state.currentChat ? `
              <button class="btn-icon" onclick="toggleSystemPrompt()">🎭</button>
              <button class="btn-icon" onclick="exportChat()">📤</button>
            ` : ''}
          </div>
          ${renderMain()}
        </main>
      </div>
    `;
    
    // 渲染后处理
    if (state.view === 'chat') {
      scrollToBottom();
    }
  }

  function getTitle() {
    switch(state.view) {
      case 'tasks': return '⏰ 定时任务';
      case 'settings': return '⚙️ 设置';
      default: return state.currentChat?.title || '💬 对话';
    }
  }

  function renderMain() {
    switch(state.view) {
      case 'settings': return renderSettings();
      case 'tasks': return renderTasks();
      default: return renderChat();
    }
  }

  // ==================== 对话界面 ====================
  
  function renderChat() {
    const messages = state.currentChat?.messages || [];
    
    return `
      ${state.showSystemPrompt && state.currentChat ? `
        <div class="system-prompt-bar">
          <textarea id="sysPrompt" placeholder="System Prompt...">${state.currentChat.systemPrompt || ''}</textarea>
          <div class="sp-actions">
            <button onclick="saveSystemPrompt()">保存</button>
            <button onclick="toggleSystemPrompt()">关闭</button>
          </div>
        </div>
      ` : ''}
      <div class="messages" id="messages">
        ${messages.length === 0 ? `
          <div class="welcome">
            <h2>👋 开始对话</h2>
            <p>输入消息开始与 Claude 对话</p>
            <div class="quick-btns">
              <button onclick="insertPrompt('帮我分析：')">💡 分析</button>
              <button onclick="insertPrompt('写代码：')">💻 代码</button>
              <button onclick="insertPrompt('总结：')">📝 总结</button>
              <button onclick="insertPrompt('翻译：')">🌐 翻译</button>
            </div>
          </div>
        ` : messages.map(msg => `
          <div class="message ${msg.role} ${msg.loading ? 'loading' : ''}">
            <div class="msg-avatar">${msg.role === 'user' ? '👤' : '🤖'}</div>
            <div class="msg-body">
              <div class="msg-content">${renderMarkdown(msg.content || '')}</div>
              ${msg.role === 'assistant' && !msg.loading ? `
                <div class="msg-actions">
                  <button onclick="copyText(this)">📋 复制</button>
                </div>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
      <div class="input-bar">
        <textarea id="userInput" placeholder="输入消息..." rows="1" oninput="autoResize(this)" onkeydown="handleKey(event)"></textarea>
        <button class="btn-send" onclick="sendMessage()" ${state.isSending ? 'disabled' : ''}>
          ${state.isSending ? '⏳' : '➤'}
        </button>
      </div>
    `;
  }

  // ==================== 设置界面 ====================
  
  function renderSettings() {
    const providers = state.config.providers || {};
    const providerIds = Object.keys(providers);
    const activeProvider = providers[state.config.activeProvider] || {};
    
    return `
      <div class="page-content">
        <div class="card">
          <h3>🔌 API 配置</h3>
          <div class="form-group">
            <label>提供商</label>
            <select id="selProvider" onchange="selectProvider(this.value)">
              ${providerIds.map(id => `
                <option value="${id}" ${state.config.activeProvider === id ? 'selected' : ''}>${providers[id].name}</option>
              `).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Base URL</label>
            <input type="text" id="cfgBaseUrl" value="${activeProvider.baseUrl || ''}">
          </div>
          <div class="form-group">
            <label>API Key</label>
            <input type="password" id="cfgApiKey" value="${activeProvider.apiKey || ''}">
          </div>
          <div class="form-group">
            <label>模型</label>
            <select id="cfgModel">
              ${(activeProvider.models || []).map(m => `
                <option value="${m}" ${state.config.activeModel === m ? 'selected' : ''}>${m}</option>
              `).join('')}
            </select>
          </div>
          <button class="btn-primary" onclick="saveSettings()">💾 保存</button>
        </div>
        
        <div class="card">
          <h3>📱 同步</h3>
          <p>数据已通过服务器自动同步</p>
          <button class="btn-primary" onclick="forcePull()">📥 拉取最新</button>
          <button class="btn-secondary" onclick="forcePush()">📤 推送本地</button>
        </div>
        
        <div class="card">
          <h3>🔑 连接信息</h3>
          <p>服务器: ${API.baseUrl}</p>
          <button class="btn-danger" onclick="logout()">退出登录</button>
        </div>
      </div>
    `;
  }

  // ==================== 任务界面 ====================
  
  function renderTasks() {
    return `
      <div class="page-content">
        <div class="tasks-header">
          <button onclick="addTask('reminder')">🔔 提醒</button>
          <button onclick="addTask('scheduled')">📋 定时</button>
          <button onclick="addTask('interval')">🔄 轮询</button>
        </div>
        ${state.tasks.length === 0 ? '<p class="empty">暂无任务</p>' :
          state.tasks.map((task, i) => `
            <div class="card task-card ${task.enabled ? '' : 'disabled'}">
              <div class="task-header">
                <span>${getTaskIcon(task.type)} ${task.name}</span>
                <label class="switch">
                  <input type="checkbox" ${task.enabled ? 'checked' : ''} onchange="toggleTask(${i})">
                  <span class="slider"></span>
                </label>
              </div>
              <p class="task-detail">${getTaskDetail(task)}</p>
              <div class="task-actions">
                <button onclick="deleteTask(${i})">🗑️</button>
              </div>
            </div>
          `).join('')}
      </div>
    `;
  }

  function getTaskIcon(type) {
    return { reminder: '🔔', scheduled: '📋', interval: '🔄' }[type] || '⏰';
  }

  function getTaskDetail(task) {
    if (task.type === 'reminder') return `提醒: ${new Date(task.triggerAt).toLocaleString()}`;
    if (task.type === 'scheduled') return `执行: ${new Date(task.triggerAt).toLocaleString()}`;
    if (task.type === 'interval') return `每 ${task.intervalMinutes} 分钟`;
    return '';
  }

  // ==================== Markdown 渲染 ====================
  
  function renderMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\n/g, '<br>');
  }

  // ==================== 事件处理 ====================
  
  window.setView = function(view) {
    state.view = view;
    state.showSidebar = false;
    render();
  };

  window.toggleSidebar = function() {
    state.showSidebar = !state.showSidebar;
    render();
  };

  window.newChat = function() {
    state.currentChat = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      title: '新对话',
      messages: [],
      systemPrompt: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.view = 'chat';
    state.showSidebar = false;
    render();
  };

  window.loadChat = async function(id) {
    try {
      state.currentChat = await API.getChat(id);
      state.view = 'chat';
      state.showSidebar = false;
      render();
    } catch (e) {
      showToast('加载失败', 'error');
    }
  };

  window.deleteChat = async function(id, event) {
    event?.stopPropagation();
    if (!confirm('确定删除？')) return;
    await API.deleteChat(id);
    state.chats = await API.getChats();
    if (state.currentChat?.id === id) state.currentChat = null;
    render();
  };

  window.sendMessage = async function() {
    const input = document.getElementById('userInput');
    const content = input.value.trim();
    if (!content || state.isSending) return;
    
    state.isSending = true;
    
    if (!state.currentChat) {
      state.currentChat = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        title: content.slice(0, 20),
        messages: [],
        systemPrompt: '',
        createdAt: new Date().toISOString()
      };
    }
    
    state.currentChat.messages.push({ role: 'user', content });
    input.value = '';
    state.currentChat.messages.push({ role: 'assistant', content: '', loading: true });
    render();
    
    try {
      const apiMessages = [];
      if (state.currentChat.systemPrompt) {
        apiMessages.push({ role: 'system', content: state.currentChat.systemPrompt });
      }
      state.currentChat.messages.filter(m => !m.loading).forEach(m => {
        apiMessages.push({ role: m.role, content: m.content });
      });
      
      const provider = state.config.providers?.[state.config.activeProvider];
      if (!provider) throw new Error('请先配置 API');
      
      const response = await API.chat(apiMessages, provider, state.config.activeModel);
      
      const lastMsg = state.currentChat.messages[state.currentChat.messages.length - 1];
      if (response.error) {
        lastMsg.content = `❌ ${response.error}`;
      } else {
        lastMsg.content = response.choices?.[0]?.message?.content || '无响应';
      }
      lastMsg.loading = false;
      
      await API.saveChat(state.currentChat);
      state.chats = await API.getChats();
    } catch (e) {
      const lastMsg = state.currentChat.messages[state.currentChat.messages.length - 1];
      lastMsg.content = `❌ ${e.message}`;
      lastMsg.loading = false;
    }
    
    state.isSending = false;
    render();
  };

  window.handleKey = function(e) {
    // 手机端 Enter 直接发送，桌面端 Ctrl+Enter 发送
    if (e.key === 'Enter' && !e.shiftKey && window.innerWidth < 768) {
      e.preventDefault();
      sendMessage();
    }
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  window.autoResize = function(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  };

  window.insertPrompt = function(text) {
    const input = document.getElementById('userInput');
    if (input) { input.value = text; input.focus(); }
  };

  window.toggleSystemPrompt = function() {
    state.showSystemPrompt = !state.showSystemPrompt;
    render();
  };

  window.saveSystemPrompt = async function() {
    if (state.currentChat) {
      state.currentChat.systemPrompt = document.getElementById('sysPrompt')?.value || '';
      await API.saveChat(state.currentChat);
      showToast('已保存');
    }
    state.showSystemPrompt = false;
    render();
  };

  window.exportChat = function() {
    if (!state.currentChat) return;
    let md = `# ${state.currentChat.title}\n\n`;
    state.currentChat.messages.forEach(m => {
      md += `### ${m.role === 'user' ? '👤 用户' : '🤖 助手'}\n\n${m.content}\n\n---\n\n`;
    });
    
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.currentChat.title}.md`;
    a.click();
    showToast('已导出');
  };

  window.copyText = function(btn) {
    const text = btn.closest('.msg-body').querySelector('.msg-content').innerText;
    navigator.clipboard.writeText(text);
    showToast('已复制');
  };

  window.saveSettings = async function() {
    const id = state.config.activeProvider;
    state.config.providers[id].baseUrl = document.getElementById('cfgBaseUrl').value;
    state.config.providers[id].apiKey = document.getElementById('cfgApiKey').value;
    state.config.activeModel = document.getElementById('cfgModel').value;
    await API.saveConfig(state.config);
    showToast('已保存');
  };

  window.selectProvider = function(id) {
    state.config.activeProvider = id;
    render();
  };

  window.forcePull = async function() {
    const data = await API.pull();
    if (data.config) state.config = data.config;
    if (data.chats) state.chats = data.chats;
    if (data.tasks) state.tasks = data.tasks;
    render();
    showToast('已拉取最新数据');
  };

  window.forcePush = async function() {
    await API.push({ config: state.config, tasks: state.tasks });
    showToast('已推送');
  };

  window.addTask = function(type) {
    const name = prompt('任务名称：');
    if (!name) return;
    
    const task = { type, name, enabled: true, id: Date.now().toString(36) };
    
    if (type === 'reminder') {
      task.triggerAt = prompt('提醒时间 (2025-01-01 12:00)：');
      task.message = prompt('提醒内容：');
    } else if (type === 'scheduled') {
      task.triggerAt = prompt('执行时间：');
      task.prompt = prompt('Prompt：');
    } else {
      task.intervalMinutes = parseInt(prompt('间隔(分钟)：', '30'));
      task.prompt = prompt('Prompt：');
    }
    
    state.tasks.push(task);
    API.saveTasks(state.tasks);
    render();
  };

  window.toggleTask = function(i) {
    state.tasks[i].enabled = !state.tasks[i].enabled;
    API.saveTasks(state.tasks);
    render();
  };

  window.deleteTask = function(i) {
    if (confirm('确定删除？')) {
      state.tasks.splice(i, 1);
      API.saveTasks(state.tasks);
      render();
    }
  };

  window.logout = function() {
    localStorage.removeItem('auth_token');
    API.token = '';
    showLogin();
  };

  // ==================== 工具 ====================
  
  function scrollToBottom() {
    setTimeout(() => {
      const el = document.getElementById('messages');
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }

  function showToast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = `toast toast-${type} show`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.remove(); }, 2500);
  }

  // 启动
  const savedServer = localStorage.getItem('server_url');
  if (savedServer) API.baseUrl = savedServer;
  init();

})();
