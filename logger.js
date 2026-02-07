const fs = require('fs');
const path = require('path');

class Logger {
  constructor(logDir) {
    this.logDir = logDir;
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logFile = path.join(logDir, `app-${this.getDateStr()}.log`);
  }

  getDateStr() {
    return new Date().toISOString().split('T')[0];
  }

  getTimestamp() {
    return new Date().toISOString();
  }

  formatMessage(level, message, data) {
    const log = {
      timestamp: this.getTimestamp(),
      level,
      message,
      ...(data && { data })
    };
    return JSON.stringify(log);
  }

  write(level, message, data) {
    // 每天一个日志文件
    const currentFile = path.join(this.logDir, `app-${this.getDateStr()}.log`);
    if (this.logFile !== currentFile) {
      this.logFile = currentFile;
    }

    const logLine = this.formatMessage(level, message, data) + '\n';
    fs.appendFileSync(this.logFile, logLine);

    // 控制台输出
    const colors = {
      INFO: '\x1b[36m',
      WARN: '\x1b[33m',
      ERROR: '\x1b[31m',
      DEBUG: '\x1b[90m'
    };
    console.log(`${colors[level] || ''}[${level}]\x1b[0m ${message}`, data || '');
  }

  info(message, data) {
    this.write('INFO', message, data);
  }

  warn(message, data) {
    this.write('WARN', message, data);
  }

  error(message, data) {
    this.write('ERROR', message, data);
  }

  debug(message, data) {
    if (process.env.NODE_ENV === 'development') {
      this.write('DEBUG', message, data);
    }
  }

  // 清理旧日志（保留最近 7 天）
  cleanOldLogs(keepDays = 7) {
    const files = fs.readdirSync(this.logDir);
    const now = Date.now();
    const maxAge = keepDays * 24 * 60 * 60 * 1000;

    files.forEach(file => {
      const filePath = path.join(this.logDir, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtime.getTime() > maxAge) {
        fs.unlinkSync(filePath);
        this.info(`清理旧日志: ${file}`);
      }
    });
  }
}

module.exports = Logger;
