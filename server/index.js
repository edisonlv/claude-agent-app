const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3721;

// 数据目录
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
['chats', 'config', 'tasks'].forEach(dir => {
  const p = path.join(DATA_DIR, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 简单的 token 认证
const AUTH_TOKEN = process.env.AUTH_TOKEN || crypto.randomBytes(24).toString('hex');
console.log(`🔑 Auth Token: ${AUTH_TOKEN}`);

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// 静态文件（PWA）
app.use(express.static(path.join(__dirname, '../web/dist')));

// ==================== 同步 API ====================

// 获取所有数据的时间戳（用于增量同步）
app.get('/api/sync/status', auth, (req, res) => {
  const status = {
    chats: getFileList('chats'),
    config: getFileTimestamp('config/config.json'),
    tasks: getFileTimestamp('tasks/tasks.json')
  };
  res.json(status);
});

// 全量拉取
app.get('/api/sync/pull', auth, (req, res) => {
  const data = {
    config: readJSON('config/config.json', {}),
    chats: getAllChats(),
    tasks: readJSON('tasks/tasks.json', [])
  };
  res.json(data);
});

// 全量推送
app.post('/api/sync/push', auth, (req, res) => {
  const { config, chats, tasks } = req.body;
  
  if (config) writeJSON('config/config.json', config);
  if (tasks) writeJSON('tasks/tasks.json', tasks);
  if (chats) {
    chats.forEach(chat => {
      writeJSON(`chats/${chat.id}.json`, chat);
    });
  }
  
  res.json({ ok: true, timestamp: Date.now() });
});

// ==================== 对话 API ====================

app.get('/api/chats', auth, (req, res) => {
  res.json(getAllChats());
});

app.get('/api/chats/:id', auth, (req, res) => {
  const chat = readJSON(`chats/${req.params.id}.json`);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  res.json(chat);
});

app.put('/api/chats/:id', auth, (req, res) => {
  req.body.updatedAt = new Date().toISOString();
  writeJSON(`chats/${req.params.id}.json`, req.body);
  res.json({ ok: true });
});

app.delete('/api/chats/:id', auth, (req, res) => {
  const filePath = path.join(DATA_DIR, `chats/${req.params.id}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ ok: true });
});

// ==================== 配置 API ====================

app.get('/api/config', auth, (req, res) => {
  res.json(readJSON('config/config.json', {}));
});

app.put('/api/config', auth, (req, res) => {
  writeJSON('config/config.json', req.body);
  res.json({ ok: true });
});

// ==================== 任务 API ====================

app.get('/api/tasks', auth, (req, res) => {
  res.json(readJSON('tasks/tasks.json', []));
});

app.put('/api/tasks', auth, (req, res) => {
  writeJSON('tasks/tasks.json', req.body);
  res.json({ ok: true });
});

// ==================== AI 代理 API ====================

app.post('/api/ai/chat', auth, async (req, res) => {
  const { messages, provider, model } = req.body;
  
  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 4096
      })
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SSE 流式 AI
app.post('/api/ai/stream', auth, async (req, res) => {
  const { messages, provider, model } = req.body;
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 4096,
        stream: true
      })
    });
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      res.write(text);
    }
    
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// PWA fallback
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../web/dist/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'PWA not built yet' });
  }
});

// ==================== 工具函数 ====================

function readJSON(relativePath, defaultValue = null) {
  const filePath = path.join(DATA_DIR, relativePath);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) { }
  return defaultValue;
}

function writeJSON(relativePath, data) {
  const filePath = path.join(DATA_DIR, relativePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getFileTimestamp(relativePath) {
  const filePath = path.join(DATA_DIR, relativePath);
  try {
    if (fs.existsSync(filePath)) {
      return fs.statSync(filePath).mtime.getTime();
    }
  } catch (e) { }
  return 0;
}

function getFileList(dir) {
  const dirPath = path.join(DATA_DIR, dir);
  try {
    return fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.json'))
      .map(f => ({
        id: f.replace('.json', ''),
        updatedAt: fs.statSync(path.join(dirPath, f)).mtime.getTime()
      }));
  } catch (e) { return []; }
}

function getAllChats() {
  const dirPath = path.join(DATA_DIR, 'chats');
  try {
    return fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const data = readJSON(`chats/${f}`, {});
        return { id: f.replace('.json', ''), title: data.title, updatedAt: data.updatedAt };
      })
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  } catch (e) { return []; }
}

// ==================== 启动 ====================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Claude Agent Server running on port ${PORT}`);
  console.log(`📱 PWA: http://localhost:${PORT}`);
  console.log(`🔗 Remote: http://<your-ip>:${PORT}`);
});
