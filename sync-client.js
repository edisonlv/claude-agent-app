// 同步客户端 - Electron 桌面端使用
const fs = require('fs');
const path = require('path');

class SyncClient {
  constructor(serverUrl, token, dataDir) {
    this.serverUrl = serverUrl;
    this.token = token;
    this.dataDir = dataDir;
    this.syncInterval = null;
  }
  
  async request(method, path, body = null) {
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      }
    };
    if (body) opts.body = JSON.stringify(body);
    
    const res = await fetch(this.serverUrl + path, opts);
    if (!res.ok) throw new Error(`Sync error: ${res.status}`);
    return res.json();
  }
  
  // 拉取远程数据
  async pull() {
    try {
      const remote = await this.request('GET', '/api/sync/pull');
      return remote;
    } catch (e) {
      console.error('Pull failed:', e.message);
      return null;
    }
  }
  
  // 推送本地数据
  async push(data) {
    try {
      await this.request('POST', '/api/sync/push', data);
      return true;
    } catch (e) {
      console.error('Push failed:', e.message);
      return false;
    }
  }
  
  // 同步对话
  async syncChat(chat) {
    try {
      await this.request('PUT', `/api/chats/${chat.id}`, chat);
    } catch (e) {
      console.error('Sync chat failed:', e.message);
    }
  }
  
  // 删除远程对话
  async deleteRemoteChat(id) {
    try {
      await this.request('DELETE', `/api/chats/${id}`);
    } catch (e) {
      console.error('Delete remote chat failed:', e.message);
    }
  }
  
  // 同步配置
  async syncConfig(config) {
    try {
      await this.request('PUT', '/api/config', config);
    } catch (e) {
      console.error('Sync config failed:', e.message);
    }
  }
  
  // 同步任务
  async syncTasks(tasks) {
    try {
      await this.request('PUT', '/api/tasks', tasks);
    } catch (e) {
      console.error('Sync tasks failed:', e.message);
    }
  }
  
  // 启动自动同步
  startAutoSync(intervalMs = 60000) {
    this.syncInterval = setInterval(() => {
      this.pull().then(data => {
        if (data) {
          console.log('Auto sync: pulled remote data');
        }
      });
    }, intervalMs);
  }
  
  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}

module.exports = SyncClient;
