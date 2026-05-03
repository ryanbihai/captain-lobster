/**
 * @file crypto.js
 * @description AES-256-GCM 加解密工具类。提供标准化的加解密方法。
 */

const crypto = require('crypto');

/**
 * 规范化密钥为 32 字节（256 位）
 * 如果提供的密钥不是 32 字节，则使用 SHA256 进行哈希处理，以确保符合 AES-256 的要求。
 * @param {string|Buffer} key 原始密钥
 * @returns {Buffer} 32 字节的密钥 Buffer
 */
function normalizeKey(key) {
  if (!key) throw new Error('密钥不能为空');
  if (Buffer.isBuffer(key) && key.length === 32) return key;
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * 【AES-256-GCM 加密】
 * 将明文加密为 base64 格式，并包含认证标签 (AuthTag) 和初始化向量 (IV)。
 * @param {string} text 待加密的明文本
 * @param {string} key 用于加密的密钥
 * @returns {string} 格式为 "iv:authTag:encryptedData" 的字符串（均为 base64 编码）
 */
exports.encrypt = (text, key) => {
  if (text === null || text === undefined) return '';
  
  const iv = crypto.randomBytes(12); // GCM 模式推荐使用 12 字节的 IV
  const normalizedKey = normalizeKey(key);
  const cipher = crypto.createCipheriv('aes-256-gcm', normalizedKey, iv);
  
  let encrypted = cipher.update(String(text), 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const authTag = cipher.getAuthTag().toString('base64');
  
  return `${iv.toString('base64')}:${authTag}:${encrypted}`;
};

/**
 * 【AES-256-GCM 解密】
 * 将加密后的 base64 字符串还原为明文。
 * @param {string} encryptedText 格式为 "iv:authTag:encryptedData" 的加密字符串
 * @param {string} key 用于解密的密钥
 * @returns {string} 还原后的明文本
 */
exports.decrypt = (encryptedText, key) => {
  if (!encryptedText) return '';
  
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('无效的密文格式。期望格式为 "iv:authTag:encryptedData"');
  }
  
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encryptedData = parts[2];
  
  const normalizedKey = normalizeKey(key);
  const decipher = crypto.createDecipheriv('aes-256-gcm', normalizedKey, iv);
  
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};
