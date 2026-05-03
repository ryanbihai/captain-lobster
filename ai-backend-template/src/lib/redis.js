/**
 * @file redis.js
 * @description Redis 客户端中心。基于 ioredis 提供高效的缓存与 Session 存储连接，并具备连接失败自动降级的韧性。
 */

const { INFO, ERROR, EXCEPTION, DEBUG, WARN } = require('./logSvc.js')(__filename)
const Redis = require('ioredis')

// 内部单例客户端句柄
let redisClient = null

/**
 * 【初始化 Redis 实例】
 * 从 realtime_config 或默认本地参数读取物理连接信息
 */
function initRedis() {
  const config = global.static_config?.redis || { host: '127.0.0.1', port: 6380 } // 默认对齐 Docker 的 6380 端口
  
  redisClient = new Redis({
    ...config,
    maxRetriesPerRequest: 1, // 限制单次请求重试，避免在 Redis 故障时造成请求堆积
    /**
     * 策略：不执行物理层重连
     * 目的是在开发环境下如果没拉起 Docker，系统能通过 connect-redis 捕捉到 error
     * 从而优雅降级。
     */
    retryStrategy() { return null }, 
  })

  // 捕获连接异常，避免主进程因 Redis 握手失败而退出
  redisClient.on('error', err => {
    ERROR(`Redis 连接发生异常: ${err.message}, 缓存/Session 功能可能受限`)
  })
}

module.exports = {
  /**
   * 获取 Redis 客户端 (单例模式)
   * 支持外部通过 require('./redis').client 惰性加载初始化
   */
  get client() {
    if (!redisClient) initRedis()
    return redisClient
  },
}
