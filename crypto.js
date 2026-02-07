const crypto = require('crypto');
const os = require('os');

// 使用机器特征生成加密密钥
function getMachineKey() {
  const info = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || 'cpu'
  ].join('-');
  return crypto.createHash('sha256').update(info).digest();
}

const ALGORITHM = 'aes-256-gcm';
const KEY = getMachineKey();

function encrypt(text) {
  if (!text) return '';
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText) {
  if (!encryptedText || !encryptedText.includes(':')) {
    return encryptedText; // 返回原文（兼容未加密的旧数据）
  }
  
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) return encryptedText;
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (e) {
    // 解密失败，可能是旧的未加密数据
    return encryptedText;
  }
}

// 加密配置中的敏感字段
function encryptConfig(config) {
  const encrypted = JSON.parse(JSON.stringify(config));
  
  if (encrypted.providers) {
    Object.values(encrypted.providers).forEach(provider => {
      if (provider.apiKey && !provider.apiKey.includes(':')) {
        provider.apiKey = encrypt(provider.apiKey);
        provider._encrypted = true;
      }
    });
  }
  
  return encrypted;
}

// 解密配置中的敏感字段
function decryptConfig(config) {
  const decrypted = JSON.parse(JSON.stringify(config));
  
  if (decrypted.providers) {
    Object.values(decrypted.providers).forEach(provider => {
      if (provider.apiKey && provider._encrypted) {
        provider.apiKey = decrypt(provider.apiKey);
        delete provider._encrypted;
      }
    });
  }
  
  return decrypted;
}

module.exports = {
  encrypt,
  decrypt,
  encryptConfig,
  decryptConfig
};
