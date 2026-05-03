/**
 * @file queue-manager.js
 * @description 异步队列管理器。基于 BullMQ 构建，负责生产者（Job 入队）与消费者（Worker 执行）的生命周期管理，并具备内存退避机制。
 */

const { INFO, ERROR, EXCEPTION } = require('./logSvc.js')(__filename)
const { Queue, Worker, QueueEvents } = require('bullmq')
const redisClient = require('./redis').client

// 缓存已创建的队列与工人实例
const queues = {}
const workers = {}

// 默认任务配置：从全局静态配置文件读取（默认：失败重试 3 次，移除缓存）
const defaultOpts = global.static_config?.bullmq?.defaultJobOptions || { attempts: 3, removeOnComplete: true }

/**
 * 【创建任务工人 (Consumer)】
 * @param {string} name 队列名称（需与生产者一致）
 * @param {Function} processor 业务处理函数
 * @param {Object} opts 覆盖 BullMQ Worker 配置
 */
function createWorker(name, processor, opts = {}) {
  try {
     const worker = new Worker(name, processor, { connection: redisClient, ...opts })
     workers[name] = worker
     INFO(`[队列工人] ${name} 已成功启动，开始监听任务...`)
  } catch (err) {
     // 降级：如果 Redis 连接不可用且在 local 开发环境，则标记为“内存运行”
     ERROR(`队列初始化失败: ${err.message}. ${name} 将降级为本地内存执行模式。`)
     workers[name] = { forceMemory: true, processor }
  }
}

/**
 * 【分发异步任务 (Producer)】
 * @param {string} name 目标队列名称
 * @param {Object} data 任务 Payload 数据
 * @param {Object} opts 调度控制（如 { delay: 1000 } 延迟执行）
 */
async function addJob(name, data, opts = {}) {
  // 如果队列尚未初始化，则先建立连接
  if (!queues[name]) {
    queues[name] = new Queue(name, { connection: redisClient, defaultJobOptions: defaultOpts })
  }
  
  try {
     // 真实的 Redis 队列推送
     return await queues[name].add(name, data, opts)
  } catch (err) {
     /**
      * 【韧性降级】
      * 如果 Redis 推送失败（如宕机或本地未起 Docker），则直接通过 setTimeout 模拟异步执行。
      * 这样即使缓存挂了，本地调试的 demo 依然能跑通流程（虽然不可持久化）。
      */
     ERROR(`队列推送失败，任务回退至本地内存异步执行: ${err.message}`)
     if (workers[name] && workers[name].forceMemory) {
        setTimeout(() => workers[name].processor({ data, id: Date.now() }).catch(EXCEPTION), opts.delay || 0)
     }
     return { id: `memory-${Date.now()}` }
  }
}

/**
 * 【批量推送任务】
 * @param {string} name 队列名
 * @param {Array} jobs 任务定义数组
 */
function addBulk(name, jobs) {
  return Promise.all(jobs.map(job => addJob(name, job.data, job.opts)))
}

/**
 * 监听任务完成事件
 * @param {string} name 
 * @param {Function} callback 
 */
function onCompleted(name, callback) {
  try {
    const events = new QueueEvents(name, { connection: redisClient })
    events.on('completed', callback)
  } catch(e) { /* 静默失败 */ }
}

/**
 * 监听任务失败事件
 * @param {string} name 
 * @param {Function} callback 
 */
function onFailed(name, callback) {
  try {
    const events = new QueueEvents(name, { connection: redisClient })
    events.on('failed', callback)
  } catch(e) { /* 静默失败 */ }
}

/**
 * 【优雅停机】
 * 确保进程退出前能够关闭所有的 Redis 句柄与轮询工人
 */
async function closeAll() {
  for (const name in workers) if(workers[name].close) await workers[name].close()
  for (const name in queues) if(queues[name].close) await queues[name].close()
}

module.exports = { createWorker, addJob, addBulk, onCompleted, onFailed, closeAll }
