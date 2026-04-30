/**
 * @file mongoose-crypto-plugin.js
 * @description Mongoose 加解密插件。自动处理 schema 中指定字段的 AES-256-GCM 加解密流程。
 */

const crypto = require('./crypto');

/**
 * Mongoose 加解密插件
 * @param {Schema} schema Mongoose Schema 对象
 * @param {Object} options 配置项
 * @param {string[]} options.fields 需要加解密的字段列表
 * @param {string} options.key 加解密所需的密钥
 */
module.exports = function(schema, options) {
  const fields = options.fields || [];
  const key = options.key;

  if (!key) {
    throw new Error('Mongoose Crypto Plugin: 必须在配置项中提供加密密钥 (key)');
  }

  /**
   * 加密辅助函数
   */
  const encryptField = (val) => {
    if (!val || typeof val !== 'string') return val;
    // 如果已经是加密格式（包含三个冒号分隔的部分），则不再重复加密
    if (val.split(':').length === 3) return val;
    return crypto.encrypt(val, key);
  };

  /**
   * 解密辅助函数
   */
  const decryptField = (val) => {
    if (!val || typeof val !== 'string') return val;
    const parts = val.split(':');
    if (parts.length !== 3) return val; // 不是加密格式，原样返回
    try {
      return crypto.decrypt(val, key);
    } catch (err) {
      console.warn(`[Mongoose Crypto] 解密失败，返回原值。字段值: ${val.substring(0, 10)}... Error: ${err.message}`);
      return val;
    }
  };

  /**
   * 【落库加密：Save】
   */
  schema.pre('save', function(next) {
    const doc = this;
    fields.forEach(field => {
      if (doc.isModified(field) && doc[field]) {
        doc[field] = encryptField(doc[field]);
      }
    });
    next();
  });

  /**
   * 【批量落库加密：insertMany】
   */
  schema.pre('insertMany', function(next, docs) {
    if (!Array.isArray(docs)) return next();
    docs.forEach(doc => {
      fields.forEach(field => {
        if (doc[field]) {
          doc[field] = encryptField(doc[field]);
        }
      });
    });
    next();
  });

  /**
   * 【更新行为加密：findOneAndUpdate / updateOne / updateMany】
   */
  schema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function(next) {
    const update = this.getUpdate();
    if (!update) return next();

    // 处理 $set 操作或直接更新的对象
    const target = update.$set || update;
    fields.forEach(field => {
      if (target[field]) {
        target[field] = encryptField(target[field]);
      }
    });
    next();
  });

  /**
   * 【出库解密：Init】
   * 当文档从 MongoDB 查询出来并初始化为 Mongoose 文档对象时触发。
   */
  schema.post('init', function(doc) {
    fields.forEach(field => {
      if (doc[field]) {
        doc[field] = decryptField(doc[field]);
      }
    });
  });

  /**
   * 【导出转换：toObject / toJSON】
   * 确保在使用 toObject() 或 JSON.stringify() 时返回的是明文。
   */
  const transform = function(doc, ret, options) {
    fields.forEach(field => {
      if (ret[field]) {
        ret[field] = decryptField(ret[field]);
      }
    });
    return ret;
  };

  schema.set('toObject', { transform: transform });
  schema.set('toJSON', { transform: transform });
};
