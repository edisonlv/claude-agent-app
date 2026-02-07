import './styles.css';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';

// 配置 marked
marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true
});

// 配置 mermaid
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose'
});

// Toast 通知
function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// 网络状态检查
async function checkNetwork() {
  try {
    state.isOnline = await window.api.network.check();
  } catch (e) {
    state.isOnline = navigator.onLine;
  }
  updateNetworkIndicator();
}

function updateNetworkIndicator() {
  let indicator = document.querySelector('.network-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'network-indicator';
    document.body.appendChild(indicator);
  }
  indicator.className = `network-indicator ${state.isOnline ? 'online' : 'offline'}`;
  indicator.textContent = state.isOnline ? '🟢 在线' : '🔴 离线';
  indicator.style.display = state.isOnline ? 'none' : 'block';
}

// Markdown 渲染函数
async function renderMarkdown(content) {
  // 先处理 mermaid 代码块，替换为占位符
  const mermaidBlocks = [];
  let processed = content.replace(/```mermaid\n([\s\S]*?)```/g, (match, code) => {
    const id = `mermaid-${mermaidBlocks.length}`;
    mermaidBlocks.push({ id, code: code.trim() });
    return `<div class="mermaid-placeholder" data-id="${id}"></div>`;
  });
  
  // 渲染 Markdown
  let html = marked.parse(processed);
  
  // 清理 HTML
  html = DOMPurify.sanitize(html, {
    ADD_TAGS: ['div'],
    ADD_ATTR: ['class', 'data-id']
  });
  
  return { html, mermaidBlocks };
}

// 渲染 Mermaid 图表
async function renderMermaidBlocks(mermaidBlocks) {
  for (const block of mermaidBlocks) {
    const element = document.querySelector(`[data-id="${block.id}"]`);
    if (element) {
      try {
        // mermaid v10+ 使用新 API
        const uniqueId = 'mermaid-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        const { svg } = await mermaid.render(uniqueId, block.code);
        element.innerHTML = svg;
        element.classList.add('mermaid-rendered');
      } catch (e) {
        // 如果新 API 失败，尝试旧方法
        try {
          element.innerHTML = block.code;
          element.classList.add('mermaid');
          await mermaid.init(undefined, element);
          element.classList.add('mermaid-rendered');
        } catch (e2) {
          element.innerHTML = `<pre class="mermaid-error">Mermaid 渲染错误: ${e.message}\n\n${block.code}</pre>`;
        }
      }
    }
  }
}

// 应用状态
const state = {
  config: null,
  chats: [],
  currentChat: null,
  skills: [],
  mcpConfig: null,
  tasks: [],
  taskResults: [],
  view: 'chat', // chat | settings | skills | mcp | tasks
  isOnline: true,
  isSending: false,
  showSystemPromptEditor: false,
  attachments: [] // 待上传的文件
};

// 初始化
async function init() {
  try {
    state.config = await window.api.config.get();
    state.chats = await window.api.chats.list();
    state.skills = await window.api.skills.list();
    state.mcpConfig = await window.api.mcp.list();
    state.tasks = await window.api.tasks.list();
  } catch (e) {
    console.error('初始化失败:', e);
    showToast('初始化失败: ' + e.message, 'error');
  }
  
  // 检查网络状态
  checkNetwork();
  setInterval(checkNetwork, 30000); // 每30秒检查一次
  
  // 监听任务结果
  window.api.tasks.onResult((data) => {
    state.taskResults.unshift(data);
    if (state.taskResults.length > 50) state.taskResults.pop();
    render();
    showToast(`任务 "${data.taskName}" 执行完成`, 'success');
  });
  
  // 监听任务更新
  window.api.tasks.onUpdated(async () => {
    state.tasks = await window.api.tasks.list();
    render();
  });
  
  // 监听快捷键事件
  window.api.shortcuts.onNewChat(() => {
    window.newChat();
  });
  
  window.api.shortcuts.onSettings(() => {
    state.view = 'settings';
    render();
  });
  
  // 注册应用内快捷键
  document.addEventListener('keydown', handleGlobalKeydown);
  
  // 应用主题
  applyTheme(state.config.theme || 'dark');
  
  render();
}

// 全局键盘快捷键处理
function handleGlobalKeydown(e) {
  // Cmd/Ctrl + N: 新建对话
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
    e.preventDefault();
    window.newChat();
  }
  // Cmd/Ctrl + ,: 设置
  if ((e.metaKey || e.ctrlKey) && e.key === ',') {
    e.preventDefault();
    state.view = 'settings';
    render();
  }
  // Cmd/Ctrl + 1-5: 切换视图
  if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '5') {
    e.preventDefault();
    const views = ['chat', 'tasks', 'skills', 'mcp', 'settings'];
    state.view = views[parseInt(e.key) - 1];
    render();
  }
  // Escape: 关闭弹窗
  if (e.key === 'Escape') {
    if (state.showSystemPromptEditor) {
      state.showSystemPromptEditor = false;
      render();
    }
  }
  // Cmd/Ctrl + E: 导出对话
  if ((e.metaKey || e.ctrlKey) && e.key === 'e' && state.currentChat) {
    e.preventDefault();
    window.exportChat();
  }
}

// 应用主题
function applyTheme(themeName) {
  const themes = getThemes();
  const theme = themes[themeName] || themes.dark;
  
  // 应用 CSS 变量
  const root = document.documentElement;
  Object.entries(theme.colors).forEach(([key, value]) => {
    root.style.setProperty(`--${key}`, value);
  });
  
  document.body.className = themeName;
}

// 主题配置
function getThemes() {
  return {
    dark: {
      name: '深色',
      colors: {
        'bg-primary': '#1a1a2e',
        'bg-secondary': '#16213e',
        'bg-tertiary': '#0f3460',
        'text-primary': '#ffffff',
        'text-secondary': '#a0a0a0',
        'accent': '#00d9ff',
        'accent-hover': '#00b8d9',
        'danger': '#ff4757',
        'success': '#2ed573',
        'border': '#2a2a4a'
      }
    },
    light: {
      name: '浅色',
      colors: {
        'bg-primary': '#ffffff',
        'bg-secondary': '#f5f5f5',
        'bg-tertiary': '#e8e8e8',
        'text-primary': '#333333',
        'text-secondary': '#666666',
        'accent': '#0066cc',
        'accent-hover': '#0052a3',
        'danger': '#dc3545',
        'success': '#28a745',
        'border': '#dddddd'
      }
    },
    purple: {
      name: '紫色',
      colors: {
        'bg-primary': '#1a1a2e',
        'bg-secondary': '#2d1b4e',
        'bg-tertiary': '#4a2c7a',
        'text-primary': '#ffffff',
        'text-secondary': '#b8a8d4',
        'accent': '#a855f7',
        'accent-hover': '#9333ea',
        'danger': '#ff4757',
        'success': '#2ed573',
        'border': '#4a2c7a'
      }
    },
    green: {
      name: '绿色',
      colors: {
        'bg-primary': '#0d1f0d',
        'bg-secondary': '#1a3a1a',
        'bg-tertiary': '#2d5a2d',
        'text-primary': '#ffffff',
        'text-secondary': '#a8d4a8',
        'accent': '#22c55e',
        'accent-hover': '#16a34a',
        'danger': '#ff4757',
        'success': '#2ed573',
        'border': '#2d5a2d'
      }
    },
    ocean: {
      name: '海洋',
      colors: {
        'bg-primary': '#0c1929',
        'bg-secondary': '#1a365d',
        'bg-tertiary': '#2a4a7a',
        'text-primary': '#ffffff',
        'text-secondary': '#a0c4e8',
        'accent': '#38bdf8',
        'accent-hover': '#0ea5e9',
        'danger': '#ff4757',
        'success': '#2ed573',
        'border': '#2a4a7a'
      }
    }
  };
}

// 渲染主界面
function render() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="container">
      <aside class="sidebar">
        <div class="sidebar-header">
          <h1>🤖 Claude Agent</h1>
          <button class="btn-new" onclick="newChat()">+ 新对话</button>
        </div>
        <nav class="nav-tabs">
          <button class="${state.view === 'chat' ? 'active' : ''}" onclick="setView('chat')">💬 对话</button>
          <button class="${state.view === 'tasks' ? 'active' : ''}" onclick="setView('tasks')">⏰ 任务</button>
          <button class="${state.view === 'skills' ? 'active' : ''}" onclick="setView('skills')">🔧 Skills</button>
          <button class="${state.view === 'mcp' ? 'active' : ''}" onclick="setView('mcp')">🔌 MCP</button>
          <button class="${state.view === 'settings' ? 'active' : ''}" onclick="setView('settings')">⚙️ 设置</button>
        </nav>
        <div class="chat-list">
          ${state.chats.map(chat => `
            <div class="chat-item ${state.currentChat?.id === chat.id ? 'active' : ''}" onclick="loadChat('${chat.id}')">
              <span class="chat-title">${chat.title || '新对话'}</span>
              <button class="btn-delete" onclick="deleteChat('${chat.id}', event)">×</button>
            </div>
          `).join('')}
        </div>
      </aside>
      <main class="main-content">
        ${renderContent()}
      </main>
    </div>
  `;
  
  // 异步渲染 Markdown
  if (state.view === 'chat') {
    setTimeout(() => renderAllMarkdown(), 0);
  }
}

function renderContent() {
  switch(state.view) {
    case 'settings': return renderSettings();
    case 'skills': return renderSkills();
    case 'mcp': return renderMCP();
    case 'tasks': return renderTasks();
    default: return renderChat();
  }
}

function renderChat() {
  const messages = state.currentChat?.messages || [];
  const systemPrompt = state.currentChat?.systemPrompt || '';
  const showSystemPrompt = state.showSystemPromptEditor;
  
  return `
    <div class="chat-container">
      ${state.currentChat ? `
        <div class="chat-toolbar">
          <button class="toolbar-btn ${showSystemPrompt ? 'active' : ''}" onclick="toggleSystemPrompt()" title="System Prompt">
            🎭 系统提示词
          </button>
          <button class="toolbar-btn" onclick="exportChat()" title="导出对话">
            📤 导出
          </button>
          <button class="toolbar-btn" onclick="clearChat()" title="清空对话">
            🗑️ 清空
          </button>
        </div>
        ${showSystemPrompt ? `
          <div class="system-prompt-editor">
            <label>System Prompt（系统提示词）</label>
            <textarea id="systemPrompt" placeholder="设定AI的角色、行为规则等...">${systemPrompt}</textarea>
            <div class="system-prompt-actions">
              <button onclick="saveSystemPrompt()">保存</button>
              <button onclick="toggleSystemPrompt()">关闭</button>
            </div>
          </div>
        ` : ''}
      ` : ''}
      <div class="messages" id="messages">
        ${messages.length === 0 ? `
          <div class="welcome">
            <h2>👋 开始对话</h2>
            <p>输入消息开始与 Claude 对话</p>
            <div class="quick-actions">
              <button onclick="insertPrompt('帮我分析这个问题：')">💡 问题分析</button>
              <button onclick="insertPrompt('请用代码实现：')">💻 代码生成</button>
              <button onclick="insertPrompt('总结以下内容：')">📝 内容总结</button>
            </div>
            <div class="prompt-templates">
              <h3>📋 Prompt 模板</h3>
              <div class="template-list">
                ${(state.config?.promptTemplates || []).map((t, i) => `
                  <button class="template-btn" onclick="useTemplate(${i})">${t.name}</button>
                `).join('')}
                <button class="template-btn add" onclick="addTemplate()">+ 添加模板</button>
              </div>
            </div>
          </div>
        ` : messages.map(msg => `
          <div class="message ${msg.role} ${msg.loading ? 'loading' : ''}">
            <div class="message-avatar">${msg.role === 'user' ? '👤' : '🤖'}</div>
            <div class="message-content">${msg.content ? formatMessage(msg.content) : '<span class="typing">正在思考...</span>'}</div>
            ${msg.role === 'assistant' && !msg.loading ? `
              <div class="message-actions">
                <button onclick="copyMessage(this)" title="复制">📋</button>
                <button onclick="branchFromMessage('${msg.id || ''}')" title="从此分支">🔀</button>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
      <div class="input-area">
        <div class="input-attachments" id="attachments"></div>
        <div class="input-row">
          <button class="btn-attach" onclick="document.getElementById('fileInput').click()" title="添加附件">📎</button>
          <input type="file" id="fileInput" multiple style="display:none" onchange="handleFileSelect(event)">
          <textarea id="userInput" placeholder="输入消息... (Ctrl+Enter 发送)" onkeydown="handleKeyDown(event)"></textarea>
          <button class="btn-send" onclick="sendMessage()" ${state.isSending ? 'disabled' : ''}>
            ${state.isSending ? '⏳' : '发送'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderSettings() {
  const providers = state.config.providers || {};
  const providerIds = Object.keys(providers);
  const activeProvider = providers[state.config.activeProvider] || {};
  const models = activeProvider.models || [];
  const themes = getThemes();
  
  return `
    <div class="settings-container">
      <h2>⚙️ 设置</h2>
      
      <div class="settings-section">
        <h3>🎨 外观</h3>
        <div class="form-group">
          <label>主题</label>
          <div class="theme-grid">
            ${Object.entries(themes).map(([id, theme]) => `
              <button class="theme-btn ${state.config.theme === id ? 'active' : ''}" 
                      onclick="changeTheme('${id}')"
                      style="--preview-bg: ${theme.colors['bg-primary']}; --preview-accent: ${theme.colors['accent']}">
                <span class="theme-preview"></span>
                <span class="theme-name">${theme.name}</span>
              </button>
            `).join('')}
          </div>
        </div>
      </div>
      
      <div class="settings-section">
        <h3>⌨️ 快捷键</h3>
        <div class="shortcuts-list">
          <div class="shortcut-item"><kbd>Ctrl/Cmd + N</kbd> <span>新建对话</span></div>
          <div class="shortcut-item"><kbd>Ctrl/Cmd + ,</kbd> <span>打开设置</span></div>
          <div class="shortcut-item"><kbd>Ctrl/Cmd + E</kbd> <span>导出对话</span></div>
          <div class="shortcut-item"><kbd>Ctrl/Cmd + 1-5</kbd> <span>切换视图</span></div>
          <div class="shortcut-item"><kbd>Ctrl/Cmd + Enter</kbd> <span>发送消息</span></div>
          <div class="shortcut-item"><kbd>Ctrl/Cmd + Shift + C</kbd> <span>显示/隐藏窗口 (全局)</span></div>
          <div class="shortcut-item"><kbd>Escape</kbd> <span>关闭弹窗</span></div>
        </div>
      </div>
      
      <div class="settings-section">
        <h3>🔌 API 提供商</h3>
        <div class="provider-tabs">
          ${providerIds.map(id => `
            <button class="provider-tab ${state.config.activeProvider === id ? 'active' : ''}" 
                    onclick="selectProvider('${id}')">${providers[id].name}</button>
          `).join('')}
          <button class="provider-tab add" onclick="addProvider()">+ 添加</button>
        </div>
        
        <div class="provider-config">
          <div class="form-group">
            <label>提供商名称</label>
            <input type="text" id="providerName" value="${activeProvider.name || ''}" placeholder="例如：OpenAI">
          </div>
          <div class="form-group">
            <label>API Base URL</label>
            <input type="text" id="baseUrl" value="${activeProvider.baseUrl || ''}" placeholder="https://api.openai.com/v1">
          </div>
          <div class="form-group">
            <label>API Key</label>
            <input type="password" id="apiKey" value="${activeProvider.apiKey || ''}" placeholder="sk-...">
            <button class="btn-toggle" onclick="toggleApiKey()">👁</button>
          </div>
          <div class="form-group">
            <label>可用模型（每行一个）</label>
            <textarea id="providerModels" rows="4" placeholder="claude-3-5-sonnet-20241022&#10;gpt-4o&#10;gpt-4o-mini">${(activeProvider.models || []).join('\n')}</textarea>
          </div>
          <div class="form-actions">
            <button class="btn-save" onclick="saveProvider()">💾 保存提供商</button>
            ${providerIds.length > 1 ? `<button class="btn-danger" onclick="deleteProvider()">🗑️ 删除</button>` : ''}
          </div>
        </div>
      </div>
      
      <div class="settings-section">
        <h3>🤖 当前模型</h3>
        <div class="form-group">
          <label>选择模型</label>
          <select id="activeModel" onchange="changeModel(this.value)">
            ${models.map(m => `<option value="${m}" ${state.config.activeModel === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
      </div>
      
      <div class="settings-section">
        <h3>📋 预设提供商</h3>
        <div class="preset-providers">
          <button onclick="addPresetProvider('openai')">OpenAI</button>
          <button onclick="addPresetProvider('anthropic')">Anthropic</button>
          <button onclick="addPresetProvider('deepseek')">DeepSeek</button>
          <button onclick="addPresetProvider('openrouter')">OpenRouter</button>
          <button onclick="addPresetProvider('groq')">Groq</button>
          <button onclick="addPresetProvider('together')">Together AI</button>
        </div>
      </div>
    </div>
  `;
}

function renderSkills() {
  return `
    <div class="skills-container">
      <h2>🔧 Skills 管理</h2>
      <div class="skills-actions">
        <button onclick="importSkill()">📂 导入 Skill</button>
      </div>
      <div class="skills-list">
        ${state.skills.length === 0 ? '<p class="empty">暂无 Skills，点击上方按钮导入</p>' : 
          state.skills.map(skill => `
            <div class="skill-card">
              <h3>${skill.name}</h3>
              <p>${skill.description}</p>
              <div class="skill-actions">
                <button onclick="viewSkill('${skill.id}')">查看</button>
                <button onclick="useSkill('${skill.id}')">使用</button>
              </div>
            </div>
          `).join('')}
      </div>
    </div>
  `;
}

function renderMCP() {
  const servers = state.mcpConfig?.servers || [];
  return `
    <div class="mcp-container">
      <h2>🔌 MCP 服务器管理</h2>
      <div class="mcp-actions">
        <button onclick="addMCPServer()">+ 添加服务器</button>
      </div>
      <div class="mcp-list">
        ${servers.length === 0 ? '<p class="empty">暂无 MCP 服务器</p>' :
          servers.map((server, i) => `
            <div class="mcp-card">
              <div class="mcp-header">
                <h3>${server.name}</h3>
                <label class="switch">
                  <input type="checkbox" ${server.enabled ? 'checked' : ''} onchange="toggleMCP(${i})">
                  <span class="slider"></span>
                </label>
              </div>
              <code>${server.command} ${(server.args || []).join(' ')}</code>
              <button class="btn-delete" onclick="deleteMCP(${i})">删除</button>
            </div>
          `).join('')}
      </div>
    </div>
  `;
}

function renderTasks() {
  return `
    <div class="tasks-container">
      <h2>⏰ 定时任务</h2>
      <div class="tasks-actions">
        <button onclick="addTask('reminder')">🔔 添加提醒</button>
        <button onclick="addTask('scheduled')">📋 定时执行</button>
        <button onclick="addTask('interval')">🔄 轮询检查</button>
      </div>
      
      <div class="tasks-list">
        ${state.tasks.length === 0 ? '<p class="empty">暂无定时任务</p>' :
          state.tasks.map(task => `
            <div class="task-card ${task.enabled ? '' : 'disabled'}">
              <div class="task-header">
                <div class="task-info">
                  <span class="task-type">${getTaskTypeIcon(task.type)}</span>
                  <h3>${task.name}</h3>
                </div>
                <label class="switch">
                  <input type="checkbox" ${task.enabled ? 'checked' : ''} onchange="toggleTask('${task.id}')">
                  <span class="slider"></span>
                </label>
              </div>
              <div class="task-details">
                ${renderTaskDetails(task)}
              </div>
              <div class="task-meta">
                ${task.lastRun ? `<span>上次运行: ${formatTime(task.lastRun)}</span>` : ''}
              </div>
              <div class="task-actions">
                ${task.type !== 'reminder' ? `<button onclick="runTaskNow('${task.id}')">▶ 立即执行</button>` : ''}
                <button onclick="editTask('${task.id}')">✏️ 编辑</button>
                <button class="btn-danger" onclick="deleteTask('${task.id}')">🗑️ 删除</button>
              </div>
            </div>
          `).join('')}
      </div>
      
      ${state.taskResults.length > 0 ? `
        <div class="task-results">
          <h3>📜 执行结果</h3>
          <div class="results-list">
            ${state.taskResults.slice(0, 10).map(r => `
              <div class="result-item">
                <div class="result-header">
                  <span class="result-name">${r.taskName}</span>
                  <span class="result-time">${formatTime(r.timestamp)}</span>
                </div>
                <div class="result-content">${formatMessageSimple(r.result.slice(0, 200))}${r.result.length > 200 ? '...' : ''}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function getTaskTypeIcon(type) {
  switch(type) {
    case 'reminder': return '🔔';
    case 'scheduled': return '📋';
    case 'interval': return '🔄';
    default: return '⏰';
  }
}

function renderTaskDetails(task) {
  switch(task.type) {
    case 'reminder':
      return `<p>提醒时间: ${formatTime(task.triggerAt)}</p><p>消息: ${task.message}</p>`;
    case 'scheduled':
      return `<p>执行时间: ${formatTime(task.triggerAt)}</p><p>Prompt: ${task.prompt?.slice(0, 50)}...</p>`;
    case 'interval':
      return `<p>间隔: 每 ${task.intervalMinutes} 分钟</p><p>Prompt: ${task.prompt?.slice(0, 50)}...</p>`;
    default:
      return '';
  }
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString('zh-CN');
}

// 工具函数 - 简单格式化（用于非聊天区域）
function formatMessageSimple(content) {
  return content
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="$1">$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

// 用于聊天消息的完整 Markdown 渲染
function formatMessage(content, isSimple = false) {
  if (isSimple) {
    return formatMessageSimple(content);
  }
  // 返回占位符，实际渲染在 render 后异步完成
  return `<div class="markdown-content" data-raw="${encodeURIComponent(content)}">加载中...</div>`;
}

// 渲染所有 Markdown 内容
async function renderAllMarkdown() {
  const elements = document.querySelectorAll('.markdown-content[data-raw]');
  for (const el of elements) {
    const raw = decodeURIComponent(el.dataset.raw);
    const { html, mermaidBlocks } = await renderMarkdown(raw);
    el.innerHTML = html;
    el.removeAttribute('data-raw');
    
    // 渲染 Mermaid
    if (mermaidBlocks.length > 0) {
      await renderMermaidBlocks(mermaidBlocks);
    }
    
    // 添加代码复制按钮
    el.querySelectorAll('pre').forEach(pre => {
      if (!pre.querySelector('.copy-btn')) {
        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.textContent = '复制';
        btn.onclick = () => {
          const code = pre.querySelector('code')?.textContent || pre.textContent;
          navigator.clipboard.writeText(code);
          btn.textContent = '已复制!';
          setTimeout(() => btn.textContent = '复制', 2000);
        };
        pre.style.position = 'relative';
        pre.appendChild(btn);
      }
    });
  }
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// 事件处理
window.setView = function(view) {
  state.view = view;
  render();
};

window.newChat = function() {
  state.currentChat = {
    id: generateId(),
    title: '新对话',
    messages: [],
    systemPrompt: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.view = 'chat';
  render();
};

window.loadChat = async function(id) {
  state.currentChat = await window.api.chats.get(id);
  state.view = 'chat';
  render();
};

window.deleteChat = async function(id, event) {
  event.stopPropagation();
  if (confirm('确定删除这个对话？')) {
    await window.api.chats.delete(id);
    state.chats = await window.api.chats.list();
    if (state.currentChat?.id === id) {
      state.currentChat = null;
    }
    render();
  }
};

window.sendMessage = async function() {
  const input = document.getElementById('userInput');
  const content = input.value.trim();
  if (!content && state.attachments.length === 0) return;
  
  state.isSending = true;
  
  if (!state.currentChat) {
    state.currentChat = {
      id: generateId(),
      title: content.slice(0, 30) || '新对话',
      messages: [],
      systemPrompt: '',
      createdAt: new Date().toISOString()
    };
  }
  
  // 处理附件
  let messageContent = content;
  if (state.attachments.length > 0) {
    const attachmentText = state.attachments.map(a => `[附件: ${a.name}]\n${a.content}`).join('\n\n');
    messageContent = attachmentText + (content ? '\n\n' + content : '');
    state.attachments = [];
  }
  
  state.currentChat.messages.push({ role: 'user', content: messageContent, id: generateId() });
  input.value = '';
  render();
  
  const messagesDiv = document.getElementById('messages');
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  
  // 构建 API 消息（包含 System Prompt）
  const apiMessages = [];
  if (state.currentChat.systemPrompt) {
    apiMessages.push({ role: 'system', content: state.currentChat.systemPrompt });
  }
  state.currentChat.messages.forEach(m => {
    if (!m.loading) {
      apiMessages.push({ role: m.role, content: m.content });
    }
  });
  
  // 添加一个空的助手消息用于流式显示
  state.currentChat.messages.push({ role: 'assistant', content: '', loading: true, id: generateId() });
  render();
  
  // 使用流式响应
  let streamContent = '';
  
  window.api.removeStreamListeners();
  
  window.api.onStreamChunk((chunk) => {
    streamContent += chunk;
    const lastMsg = state.currentChat.messages[state.currentChat.messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      lastMsg.content = streamContent;
      lastMsg.loading = false;
      render();
      // 滚动到底部
      const messagesDiv = document.getElementById('messages');
      if (messagesDiv) messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  });
  
  window.api.onStreamDone(async () => {
    window.api.removeStreamListeners();
    state.isSending = false;
    await window.api.chats.save(state.currentChat);
    state.chats = await window.api.chats.list();
    render();
  });
  
  try {
    const response = await window.api.chatStream(apiMessages, state.config);
    
    if (response.error) {
      // 流式失败，回退到普通请求
      window.api.removeStreamListeners();
      const normalResponse = await window.api.chat(apiMessages, state.config);
      
      const lastMsg = state.currentChat.messages[state.currentChat.messages.length - 1];
      if (normalResponse.error) {
        lastMsg.content = `❌ 错误: ${normalResponse.error}`;
      } else {
        lastMsg.content = normalResponse.choices?.[0]?.message?.content || '无响应';
      }
      lastMsg.loading = false;
      state.isSending = false;
      
      await window.api.chats.save(state.currentChat);
      state.chats = await window.api.chats.list();
      render();
    }
  } catch (error) {
    window.api.removeStreamListeners();
    const lastMsg = state.currentChat.messages[state.currentChat.messages.length - 1];
    lastMsg.content = `❌ 错误: ${error.message}`;
    lastMsg.loading = false;
    state.isSending = false;
    render();
  }
  
  setTimeout(() => {
    const messagesDiv = document.getElementById('messages');
    if (messagesDiv) messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }, 100);
};

window.handleKeyDown = function(event) {
  if (event.ctrlKey && event.key === 'Enter') {
    sendMessage();
  }
};

window.insertPrompt = function(text) {
  const input = document.getElementById('userInput');
  input.value = text;
  input.focus();
};

window.toggleApiKey = function() {
  const input = document.getElementById('apiKey');
  input.type = input.type === 'password' ? 'text' : 'password';
};

window.changeTheme = function(theme) {
  state.config.theme = theme;
  applyTheme(theme);
  window.api.config.save(state.config);
  render();
};

window.selectProvider = function(id) {
  state.config.activeProvider = id;
  const provider = state.config.providers[id];
  if (provider && provider.models && provider.models.length > 0) {
    state.config.activeModel = provider.models[0];
  }
  window.api.config.save(state.config);
  render();
};

window.addProvider = function() {
  const id = 'provider_' + Date.now();
  state.config.providers[id] = {
    name: '新提供商',
    baseUrl: '',
    apiKey: '',
    models: []
  };
  state.config.activeProvider = id;
  window.api.config.save(state.config);
  render();
};

window.saveProvider = async function() {
  const id = state.config.activeProvider;
  const modelsText = document.getElementById('providerModels').value;
  
  state.config.providers[id] = {
    name: document.getElementById('providerName').value,
    baseUrl: document.getElementById('baseUrl').value,
    apiKey: document.getElementById('apiKey').value,
    models: modelsText.split('\n').map(m => m.trim()).filter(m => m)
  };
  
  // 确保 activeModel 有效
  const models = state.config.providers[id].models;
  if (models.length > 0 && !models.includes(state.config.activeModel)) {
    state.config.activeModel = models[0];
  }
  
  await window.api.config.save(state.config);
  alert('提供商配置已保存！');
  render();
};

window.deleteProvider = async function() {
  if (!confirm('确定删除这个提供商？')) return;
  
  const id = state.config.activeProvider;
  delete state.config.providers[id];
  
  const remainingIds = Object.keys(state.config.providers);
  state.config.activeProvider = remainingIds[0];
  
  await window.api.config.save(state.config);
  render();
};

window.changeModel = function(model) {
  state.config.activeModel = model;
  window.api.config.save(state.config);
};

const presetProviders = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini']
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307']
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner']
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'google/gemini-pro', 'meta-llama/llama-3-70b']
  },
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: '',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768']
  },
  together: {
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    apiKey: '',
    models: ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1', 'Qwen/Qwen2-72B-Instruct']
  }
};

window.addPresetProvider = function(preset) {
  const template = presetProviders[preset];
  if (!template) return;
  
  const id = preset + '_' + Date.now();
  state.config.providers[id] = { ...template };
  state.config.activeProvider = id;
  state.config.activeModel = template.models[0];
  
  window.api.config.save(state.config);
  render();
};

// ==================== Skills ====================

window.importSkill = async function() {
  // 在 Electron 中使用文件选择对话框
  try {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      const skillMd = files.find(f => f.name === 'SKILL.md');
      if (!skillMd) {
        showToast('未找到 SKILL.md 文件', 'error');
        return;
      }
      // 获取目录路径
      const dirPath = skillMd.webkitRelativePath.split('/')[0];
      const reader = new FileReader();
      reader.onload = async () => {
        const content = reader.result;
        // 创建 skill 对象
        const skill = {
          id: generateId(),
          name: dirPath,
          content: content,
          importedAt: new Date().toISOString()
        };
        if (!state.skills) state.skills = [];
        state.skills.push(skill);
        render();
        showToast('Skill 已导入: ' + dirPath, 'success');
      };
      reader.readAsText(skillMd);
    });
    input.click();
  } catch (e) {
    showToast('导入失败: ' + e.message, 'error');
  }
};

window.deleteSkill = function(index) {
  if (confirm('确定删除这个 Skill？')) {
    state.skills.splice(index, 1);
    render();
    showToast('Skill 已删除', 'success');
  }
};

window.viewSkill = function(index) {
  const skill = state.skills?.[index];
  if (!skill) return;
  alert(skill.content || '无内容');
};

window.addMCPServer = function() {
  const name = prompt('服务器名称：');
  if (!name) return;
  const command = prompt('命令：', 'npx');
  if (!command) return;
  const args = prompt('参数（空格分隔）：', '-y @anthropic/mcp-filesystem /path/to/dir');
  
  if (!state.mcpConfig.servers) state.mcpConfig.servers = [];
  state.mcpConfig.servers.push({
    name,
    command,
    args: args ? args.split(' ') : [],
    enabled: true
  });
  
  window.api.mcp.save(state.mcpConfig);
  render();
};

window.toggleMCP = function(index) {
  state.mcpConfig.servers[index].enabled = !state.mcpConfig.servers[index].enabled;
  window.api.mcp.save(state.mcpConfig);
};

window.deleteMCP = function(index) {
  if (confirm('确定删除这个 MCP 服务器？')) {
    state.mcpConfig.servers.splice(index, 1);
    window.api.mcp.save(state.mcpConfig);
    render();
  }
};

window.viewSkill = async function(id) {
  const content = await window.api.skills.get(id);
  alert(content || '无法读取 Skill 内容');
};

window.useSkill = function(id) {
  const skill = state.skills.find(s => s.id === id);
  if (skill) {
    const input = document.getElementById('userInput');
    if (input) {
      input.value = `使用 /${skill.name} skill：`;
      input.focus();
    }
    state.view = 'chat';
    render();
  }
};

// 定时任务相关
window.addTask = function(type) {
  let task = { type };
  
  task.name = prompt('任务名称：');
  if (!task.name) return;
  
  switch(type) {
    case 'reminder':
      const reminderTime = prompt('提醒时间（格式：2024-02-06 22:30）：');
      if (!reminderTime) return;
      task.triggerAt = new Date(reminderTime).toISOString();
      task.message = prompt('提醒内容：') || '时间到了！';
      task.title = task.name;
      break;
      
    case 'scheduled':
      const scheduleTime = prompt('执行时间（格式：2024-02-06 22:30）：');
      if (!scheduleTime) return;
      task.triggerAt = new Date(scheduleTime).toISOString();
      task.prompt = prompt('要执行的 Prompt：');
      if (!task.prompt) return;
      task.notifyOnResult = confirm('执行完成后是否通知？');
      break;
      
    case 'interval':
      const minutes = prompt('间隔时间（分钟）：', '30');
      if (!minutes) return;
      task.intervalMinutes = parseInt(minutes);
      task.prompt = prompt('要执行的 Prompt：');
      if (!task.prompt) return;
      task.notifyOnResult = confirm('每次执行后是否通知？');
      break;
  }
  
  window.api.tasks.add(task).then(newTask => {
    state.tasks.push(newTask);
    render();
  });
};

window.toggleTask = async function(id) {
  await window.api.tasks.toggle(id);
  state.tasks = await window.api.tasks.list();
  render();
};

window.runTaskNow = async function(id) {
  await window.api.tasks.runNow(id);
};

window.editTask = async function(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  
  const name = prompt('任务名称：', task.name);
  if (name) task.name = name;
  
  if (task.type === 'interval') {
    const minutes = prompt('间隔时间（分钟）：', task.intervalMinutes);
    if (minutes) task.intervalMinutes = parseInt(minutes);
  }
  
  if (task.prompt !== undefined) {
    const prompt_val = prompt('Prompt：', task.prompt);
    if (prompt_val) task.prompt = prompt_val;
  }
  
  await window.api.tasks.update(task);
  state.tasks = await window.api.tasks.list();
  render();
};

window.deleteTask = async function(id) {
  if (confirm('确定删除这个任务？')) {
    await window.api.tasks.delete(id);
    state.tasks = state.tasks.filter(t => t.id !== id);
    render();
  }
};

// ==================== System Prompt ====================

window.toggleSystemPrompt = function() {
  state.showSystemPromptEditor = !state.showSystemPromptEditor;
  render();
};

window.saveSystemPrompt = async function() {
  const textarea = document.getElementById('systemPrompt');
  if (textarea && state.currentChat) {
    state.currentChat.systemPrompt = textarea.value;
    await window.api.chats.save(state.currentChat);
    showToast('System Prompt 已保存', 'success');
  }
  state.showSystemPromptEditor = false;
  render();
};

// ==================== 对话导出 ====================

window.exportChat = function() {
  if (!state.currentChat) return;
  
  const format = prompt('导出格式 (md/json):', 'md');
  if (!format) return;
  
  let content, filename, mimeType;
  
  if (format === 'json') {
    content = JSON.stringify(state.currentChat, null, 2);
    filename = `${state.currentChat.title || 'chat'}.json`;
    mimeType = 'application/json';
  } else {
    // Markdown 格式
    let md = `# ${state.currentChat.title || '对话'}\n\n`;
    md += `> 导出时间: ${new Date().toLocaleString()}\n\n`;
    if (state.currentChat.systemPrompt) {
      md += `## System Prompt\n\n${state.currentChat.systemPrompt}\n\n---\n\n`;
    }
    state.currentChat.messages.forEach(msg => {
      const role = msg.role === 'user' ? '👤 用户' : '🤖 助手';
      md += `### ${role}\n\n${msg.content}\n\n---\n\n`;
    });
    content = md;
    filename = `${state.currentChat.title || 'chat'}.md`;
    mimeType = 'text/markdown';
  }
  
  // 下载文件
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('对话已导出', 'success');
};

window.clearChat = function() {
  if (!state.currentChat) return;
  if (!confirm('确定清空当前对话的所有消息？')) return;
  
  state.currentChat.messages = [];
  window.api.chats.save(state.currentChat);
  render();
  showToast('对话已清空', 'success');
};

// ==================== Prompt 模板 ====================

window.addTemplate = function() {
  const name = prompt('模板名称:');
  if (!name) return;
  
  const content = prompt('模板内容 (使用 {input} 作为输入占位符):');
  if (!content) return;
  
  if (!state.config.promptTemplates) {
    state.config.promptTemplates = [];
  }
  
  state.config.promptTemplates.push({ name, content });
  window.api.config.save(state.config);
  render();
  showToast('模板已添加', 'success');
};

window.useTemplate = function(index) {
  const template = state.config.promptTemplates?.[index];
  if (!template) return;
  
  const input = prompt('输入内容:');
  if (input === null) return;
  
  const content = template.content.replace(/{input}/g, input);
  const inputEl = document.getElementById('userInput');
  if (inputEl) {
    inputEl.value = content;
    inputEl.focus();
  }
};

// ==================== 文件上传 ====================

window.handleFileSelect = async function(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;
  
  for (const file of files) {
    try {
      // 读取文件内容
      const content = await readFileContent(file);
      state.attachments.push({
        name: file.name,
        type: file.type,
        size: file.size,
        content: content
      });
    } catch (e) {
      showToast(`读取文件失败: ${file.name}`, 'error');
    }
  }
  
  renderAttachments();
  event.target.value = ''; // 清空 input
};

async function readFileContent(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    if (file.type.startsWith('image/')) {
      // 图片转 base64
      reader.onload = () => resolve(`[图片: ${file.name}]\n(Base64 数据省略)`);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    } else if (file.type.startsWith('text/') || 
               file.name.endsWith('.md') || 
               file.name.endsWith('.json') ||
               file.name.endsWith('.js') ||
               file.name.endsWith('.py') ||
               file.name.endsWith('.html') ||
               file.name.endsWith('.css')) {
      // 文本文件
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    } else {
      // 其他文件显示信息
      resolve(`[文件: ${file.name}] (${(file.size / 1024).toFixed(2)} KB)`);
    }
  });
}

function renderAttachments() {
  const container = document.getElementById('attachments');
  if (!container) return;
  
  if (state.attachments.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  
  container.style.display = 'flex';
  container.innerHTML = state.attachments.map((a, i) => `
    <div class="attachment-item">
      <span class="attachment-name">${a.name}</span>
      <button onclick="removeAttachment(${i})">×</button>
    </div>
  `).join('');
}

window.removeAttachment = function(index) {
  state.attachments.splice(index, 1);
  renderAttachments();
};

// ==================== 消息操作 ====================

window.copyMessage = function(btn) {
  const content = btn.closest('.message').querySelector('.message-content');
  if (content) {
    // 获取纯文本
    const text = content.innerText;
    navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板', 'success');
  }
};

window.branchFromMessage = async function(messageId) {
  if (!state.currentChat || !messageId) return;
  
  const messageIndex = state.currentChat.messages.findIndex(m => m.id === messageId);
  if (messageIndex === -1) return;
  
  // 创建新对话，包含到该消息为止的所有内容
  const newChat = {
    id: generateId(),
    title: state.currentChat.title + ' (分支)',
    messages: state.currentChat.messages.slice(0, messageIndex + 1).map(m => ({...m, id: generateId()})),
    systemPrompt: state.currentChat.systemPrompt,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  await window.api.chats.save(newChat);
  state.chats = await window.api.chats.list();
  state.currentChat = newChat;
  render();
  
  showToast('已创建分支对话', 'success');
};

// 初始化
init();
