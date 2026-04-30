/**
 * @file task.js
 * @description 独立任务执行引擎入口。用于在单独的进程中运行定时任务、数据清理、报表生成等非 HTTP 业务。
 */

const { INFO, ERROR, EXCEPTION, DEBUG, WARN } = require('./lib/logSvc.js')(__filename)
const fs = require('fs')
const path = require('path')

/**
 * 【实时配置重载】
 * 实现逻辑与 server.js 一致，确保任务引擎能感知到 Cron 频率的动态修改。
 */
function loadConfig() {
  let envSuffix = ''
  switch (process.env.NODE_ENV) {
    case 'development':
      envSuffix = 'dev'
      break
    case 'local':
      envSuffix = 'local'
      break
    case 'production':
    default:
      envSuffix = ''
      break
  }
  const configName = envSuffix ? `realtime-config-${envSuffix}.json` : 'realtime-config.json'
  const configPath = path.join(__dirname, '../config', configName)
  if (fs.existsSync(configPath)) {
    global.realtime_config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  }
}

// 启动即加载并建立 15s 热更新心跳
loadConfig()
setInterval(loadConfig, 15000)

const { connectDB } = require('./lib/db')

// 尝试引入 node-cron，若未安装则自动降级为 setInterval 驱动
let cron
try {
  cron = require('node-cron')
} catch(e) {
  INFO('未检测到 node-cron 依赖，任务引擎将自动降级为基于 setInterval 的模拟驱动模式')
}

/**
 * 任务调度封装器
 * @param {string} cronExp 标准 Cron 表达式 (如 "0 0 * * *")
 * @param {Function} taskFunc 待执行的异步/同步函数
 */
function scheduleTask(cronExp, taskFunc) {
  if (cron && cron.schedule) {
    // 生产推荐：使用 node-cron 精准调度
    cron.schedule(cronExp, taskFunc)
  } else {
    // 降级方案：每分钟轮询检查，启动后 1s 立即执行一次
    setInterval(taskFunc, 60000)
    setTimeout(taskFunc, 1000)
  }
}

/**
 * 任务启动主函数
 */
async function startTasks() {
  // 1. 建立数据库连接（部分任务涉及读写 DB）
  await connectDB()
  INFO('调度引擎已就绪，正在分析并挂载任务...')

  // 2. 从实时配置中提取任务列表
  const taskConfig = global.realtime_config?.task || {}

  /**
   * 按微服务模块注册任务
   * TODO: 待后续优化为自动遍历 apps 目录执行
   */
  if (taskConfig['00-CoreSvc'] && taskConfig['00-CoreSvc'].cron) {
    const service = require('./apps/00-CoreSvc/service')
    // 挂载 00-CoreSvc 模块下的 someTask 业务
    scheduleTask(taskConfig['00-CoreSvc'].cron, async () => {
      try {
        await service.someTask()
      } catch(err) {
        EXCEPTION(`[00-CoreSvc 任务执行异常]: ${err.message}`)
      }
    })
    INFO(`00-CoreSvc 任务挂载成功: [${taskConfig['00-CoreSvc'].cron}]`)
  }
}

// 执行启动并捕获最高层级异常
startTasks().catch(EXCEPTION)
