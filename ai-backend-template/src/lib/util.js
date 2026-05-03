/**
 * @file util.js
 * @description 基础工具函数库。存放格式清洗、ID 生成、深层对象取值等通用纯函数。
 */

const { v4: uuidv4 } = require('uuid')

/**
 * 生成 32 位无横杠的全局唯一标识符 (UUID)
 * 常用于数据库主键、请求 TraceId 等。
 * @returns {string} 32位 16 进制字符串
 */
exports.createId = () => uuidv4().replace(/-/g, '')

/**
 * 【安全嵌套取值】
 * 类似于可选链（Optional Chaining），从复杂对象中按路径提取属性值，防止出现 "Cannot read property of undefined" 错误。
 * @param {Object} obj 目标对象
 * @param {...string} keys 路径键名列表
 * @example getField(user, 'profile', 'avatar', 'url')
 */
exports.getField = (obj, ...keys) => keys.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj)
