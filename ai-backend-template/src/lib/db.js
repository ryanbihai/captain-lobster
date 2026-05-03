/**
 * @file db.js
 * @description 数据库连接管理模块。负责初始化 Mongoose 客户端并建立与 MongoDB 的持久连接。
 */

const { INFO, ERROR, EXCEPTION, DEBUG, WARN } = require('./logSvc.js')(__filename)
const mongoose = require('mongoose')

/**
 * 【连接 MongoDB】
 * 使用全局 static_config 中的 uri 进行连接，具备超时自动降级逻辑。
 */
async function connectDB() {
  // 优先从全局配置读取，若不存在则回退至默认本地地址
  const mongoURI = global.static_config?.mongodb?.uri || 'mongodb://localhost:27017/ai-backend'
  
  try {
    /**
     * serverSelectionTimeoutMS 设置为 2s (2000ms)
     * 目的是在本地开发环境如果没开 MongoDB 时，能快速触发 catch 块，
     * 从而切换到“JSON 文件模拟持久化”的 fallback 模式，避免进程挂起。
     */
    await mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 2000 })
    INFO('MongoDB 数据库连接成功 (via Mongoose)')
  } catch (err) {
    // 连接失败时不崩溃，而是打印错误并允许系统以“文件系统数据库”模式运行
    ERROR(`MongoDB 连接失败: ${err.message}, 系统将尝试使用 JSON 文件作为替代存储`)
  }
}

module.exports = { connectDB, mongoose }
