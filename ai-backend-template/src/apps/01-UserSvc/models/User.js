/**
 * @file User.js (Model)
 * @description 用户持久层模型定义。使用了 Mongoose Schema 并集成了自动软删除过滤器与时间戳勾子。
 */

const mongoose = require('mongoose')
const { Schema } = mongoose
const path = require('path')
const fs = require('fs')
const cryptoPlugin = require('../../../lib/mongoose-crypto-plugin')

// --- 动态加载应用特定配置 (获取加密密钥) ---
let cryptoKey = 'default-secret-key-32-chars-long'
try {
  const configPath = path.join(__dirname, '../config.json')
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    if (config.crypto && config.crypto.key) {
      cryptoKey = config.crypto.key
    }
  }
} catch (e) {
  // 仅在开发阶段打印警告
  console.warn(`[User Model] Warning: Could not load crypto key from config, using default.`);
}
// ------------------------------------------

/**
 * 【用户数据模式定义】
 */
const userSchema = new Schema({
  id:         { type: String, required: true, unique: true, index: true }, // 全局唯一业务 ID
  name:       { type: String, default: '' },                               // 用户真实姓名
  mobile:     { type: String, default: '' },                               // 手机号 (用于登录/通知)
  gender:     { type: String, enum: ['male', 'female', ''], default: '' }, // 性别枚举
  openid:     { type: String, default: '' },                               // 外部三方联营 ID (如微信)
  avatar:     { type: String, default: '' },                               // 图像 URL 路径
  deleted:    { type: Boolean, default: false },                           // 软删除标识 (true 代表已删除)
  createDate: { type: Date, default: Date.now },                           // 记录物理创建时间
  updateDate: { type: Date, default: Date.now },                           // 最后一次更新时间
}, {
  timestamps: false, // 禁用 Mongoose 默认的时间戳，改用自定义的 createDate/updateDate 以适配老系统兼容
  versionKey: false, // 禁用 __v 内部版本号显示
  collection: 'users', // 物理表名
})

/**
 * 【敏感字段加密插件】
 * 自动处理 mobile, openid 的 AES-256-GCM 加解密
 */
userSchema.plugin(cryptoPlugin, {
  fields: ['mobile', 'openid'],
  key: cryptoKey
})

/**
 * 【中间件勾子：自动过滤器】
 * 在执行 find/findOne 等查询时，自动追加 deleted: false 条件，
 * 从而在业务层感知不到已删除的数据。
 */
userSchema.pre(/^find/, function(next) {
  if (this.getFilter().deleted === undefined) {
    this.where({ deleted: { $ne: true } })
  }
  next()
})

/**
 * 【中间件勾子：自动更新时间戳】
 * 拦截更新操作，自动将当前时间注入 updateDate 字段。
 */
userSchema.pre(/^(update|findOneAndUpdate)/, function(next) {
  this.set({ updateDate: new Date() })
  next()
})

// 导出单例模型
module.exports = mongoose.model('User', userSchema)
