/**
 * @file server.js
 * @description 项目核心入口文件。负责 Express 服务初始化、中间件挂载、配置文件加载、数据库连接、微服务路由注册等。
 */

const { INFO, ERROR, EXCEPTION, DEBUG, WARN } = require('./lib/logSvc.js')(__filename)
const os = require('os')
const express = require('express')
const session = require('express-session')
const cors = require('cors')
const { RedisStore } = require('connect-redis')

const path = require('path')
const fs = require('fs')

// 服务默认监听端口（优先从环境变量读取，默认 17019）
const port = process.env.PORT || 17019

/**
 * 【全局异常兜底】捕获同步代码中未处理的异常 (uncaughtException)
 * 防止由于未捕获异常导致 Node.js 进程直接挂掉进入僵死或循环重启状态
 */
process.on('uncaughtException', err => {
  ERROR(`[进程崩溃] 未捕获的异常 (uncaughtException): ${err.message || err}\n${err.stack}`)
  process.exit(-1)
})

/**
 * 【全局异常兜底】捕获未处理的 Promise 拒绝 (unhandledRejection)
 * 对于忘记写 .catch() 的异步调用进行最后一道防线拦截
 */
process.on('unhandledRejection', (reason, p) => {
  ERROR(`[进程崩溃] 未处理的 Promise 拒绝 (unhandledRejection): ${reason}, Promise: ${JSON.stringify(p)}`)
  process.exit(-1)
})

/**
 * 获取当前环境对应的配置文件后缀名
 * @returns {string} dev/local 或空（代表 production）
 */
function getEnvSuffix() {
  switch (process.env.NODE_ENV) {
    case 'development': return 'dev'
    case 'local': return 'local'
    case 'production':
    default: return ''
  }
}

/**
 * 【静态配置初始化】
 * 加载基础 static-config.json 并尝试根据运行环境覆盖特定值
 */
global.static_config = require('../config/static-config.json')
const envSuffix = getEnvSuffix()
if (envSuffix) {
  const customStatic = path.join(__dirname, `../config/static-config-${envSuffix}.json`)
  if (fs.existsSync(customStatic)) {
    // 环境特定配置存在时进行替换/合并执行
    global.static_config = require(customStatic)
  }
}

/**
 * 【动态实时配置加载】
 * 负责加载 realtime-config.json 系列文件。该函数会被定时调用实现热更新。
 */
function loadRealtimeConfig() {
  const rtEnvSuffix = getEnvSuffix()
  // 1. 先读取基础配置作为底座
  const baseConfigPath = path.join(__dirname, '../config/realtime-config.json')
  let config = {}
  if (fs.existsSync(baseConfigPath)) {
    config = JSON.parse(fs.readFileSync(baseConfigPath, 'utf8'))
  }

  // 2. 如果存在环境特定配置（如 -local/-dev），则执行合并覆盖
  if (rtEnvSuffix) {
    const customConfigPath = path.join(__dirname, `../config/realtime-config-${rtEnvSuffix}.json`)
    if (fs.existsSync(customConfigPath)) {
      const customConfig = JSON.parse(fs.readFileSync(customConfigPath, 'utf8'))
      // 执行层级合并（目前采用浅合并方式覆盖 Redis/Tasks 等顶层对象）
      config = { ...config, ...customConfig }
    }
  }
  global.realtime_config = config
}

// 首次应用启动时同步循环载入配置
loadRealtimeConfig()

/**
 * 【配置热更新机制】
 * 每隔 15 秒重新读取一次磁盘上的实时配置文件，实现无需重启动态修改 Cron 频率等功能
 */
setInterval(loadRealtimeConfig, 15000)

// 载入数据库、路由注册逻辑、统一网关与队列管理器
const { connectDB } = require('./lib/db')
const { loadApps } = require('./routes/register')
const { expressRouter } = require('./routes/api')
const queueManager = require('./lib/queue-manager')

/**
 * 服务主启动异步闭包
 */
async function startServer() {
  INFO(`-------- 服务启动初始化 --------`)

  // 1. 实现 MongoDB 持久层连接
  try {
    await connectDB()
  } catch (ex) {
    EXCEPTION(`数据库连接失败，终止启动: ${ex.message}`)
    process.exit(-1)
  }

  // 2. 【获取本机局域网 IP】用于精准日志展示或未来可能的集群注册中心上报
  const net = os.networkInterfaces()
  let localIP = '0.0.0.0'
  try {
    // 动态适配 MacOS/Linux/Windows：寻找系统中第一个非回环的 IPv4 地址
    for (const name of Object.keys(net)) {
      for (const iface of net[name]) {
        if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
          localIP = iface.address
          break
        }
      }
      if (localIP !== '0.0.0.0') break
    }
  } catch (ex) {
    WARN(`无法获取本机局域网 IP，默认使用 0.0.0.0`)
  }
  global.myself = `${localIP}@${port}`

  // 3. 初始化 Express 对象并挂载全局错误监听
  const app = express()
  app.on('error', err => {
    ERROR(`Express Server 发生内部错误: ${err}`)
  })

  /**
   * 4. 【安全与网关优化】
   * 信任前置反向代理（如 Nginx），同时隐藏 x-powered-by 头部防扫描
   */
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  /**
   * 5. 【跨域配置 CORS】
   * 允许前端调取接口，配置允许携带跨域 Cookie
   */
  app.use(cors({
    origin: true, // TODO: 生产环境建议替换为真实的白名单 [URL]
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }))

  /**
   * 6. 【数据解析中间件】
   * 将 Payload 限制提升至 5MB，应对包含图片 Base64 或长文本的 AI 交互场景
   */
  app.use(express.json({ limit: '5mb' }))
  app.use(express.urlencoded({ extended: true, limit: '5mb' }))
  app.use(express.text({ type: '*/*' }))

  // 7. 【响应标准报文封装】 res.ok(data) / res.fail(msg)
  app.use(require('./lib/responder'))

  /**
   * 8. 【集群会话管理】
   * 将默认内存存储 Session 迁移至外部 Redis，保障 PM2 负载均衡时状态同步
   */
  const redisClient = require('./lib/redis').client
  app.use(session({
    store: new RedisStore({ client: redisClient, prefix: 'sess:' }),
    secret: 'ai-backend-session-secret',
    resave: false,
    saveUninitialized: false, 
    cookie: { secure: false, maxAge: 1800000 }, // 默认 30 分钟有效期
  }))

  /**
   * 9. 【请求流水线日志采集 (DEBUG)】
   * 详细记录每次请求的 Body、Query、Session 等上下文，方便本地研发调试
   */
  app.use((req, res, next) => {
    DEBUG(`\n${`  [INCOMING REQUEST]
      URL:\t${req.url}
      Method:\t${req.method}
      Headers:\t${JSON.stringify(req.headers)}
      Body:\t(${typeof req.body}) \t ${JSON.stringify(req.body)}
      Query:\t${JSON.stringify(req.query)}
      Params:\t${JSON.stringify(req.params)}
      Session:\t${JSON.stringify(req.session)}`.replace(/^\s+/mg, '  ')}`)
    next()
  })

  // 10. 【组件式路由装载器】 遍历 src/apps 下的所有子计划微服务并挂载至 /api 路径下
  loadApps()
  app.use('/api', expressRouter)

  /**
   * 11. 【全局 404 兜底】
   * 当以上所有业务路由均未命中时触发，防止请求一直 Hang 住返回空响应
   */
  app.use((req, res, next) => {
    if (res.headersSent) return next()
    const error = new Error('您请求的 API 接口不存在 (Page Not Found)')
    error.status = 404
    return next(error)
  })

  /**
   * 12. 【全局 500 异常捕获】
   * 拦截所有通过 next(err) 抛出的服务端错误并格式化为标准 JSON 返回前端
   */
  app.use((error, req, res, next) => {
    if (res.headersSent) return next()
    ERROR(`[500 Internal Error] ${error.message}\n${error.stack}`)
    res.status(error.status || 500).json({ code: error.status || 500, msg: error.message || '内部服务错误' })
  })

  // 13. 【执行端口监听绑定】
  const server = app.listen(port, err => {
    if (err) {
      ERROR(`服务端口绑定失败: ${err}`)
      return
    }
    const envStr = process.env.NODE_ENV || 'production'
    INFO(`Server started at ${localIP}:${port} in ${envStr} mode`)
    INFO(`Node Version Info:\n${JSON.stringify(process.versions, null, 2)}`)
    INFO(`----------------------SERVER is R-E-A-D-Y------------------------`)
  })

  /**
   * 14. 【服务心跳自检进度条】
   * 定时在控制台输出字符动画，向监控守护进程反馈主线程暂未死锁
   */
  let tick = 0
  const progress = `                         _
  _ __ _   _ _ __  _ __ (_)_ __   __ _
 | '__| | | | '_ \\| '_ \\| | '_ \\ / _\` |
 | |  | |_| | | | | | | | | | | | (_| |
 |_|   \\__,_|_| |_|_| |_|_|_| |_|\\__, |
                                 |___/ `.split('\n')
  setInterval(() => {
    INFO(`server is heartbeating... ${progress[tick++] || (tick = 0, progress[tick++])}`)
  }, 15000)

  /**
   * 15. 【平滑停机机制 (Graceful Shutdown)】
   * 接收到 PM2 或 系统退出信号时，优先关闭 API 监听并清理 Redis/队列连接
   */
  const shutdown = async () => {
    INFO('接收到停止信号，正在优雅关闭服务与队列...')
    server.close()
    await queueManager.closeAll()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

// 执行启动
startServer()
