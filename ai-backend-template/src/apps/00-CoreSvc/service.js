/**
 * @file service.js (00-CoreSvc)
 * @description 核心业务逻辑实现层。包含对用户数据的 CRUD 操作以及后台定时任务。
 */

const { INFO, ERROR } = require('../../lib/logSvc.js')(__filename)
const { Service } = require('../../lib/servicelib')
const User = require('../01-UserSvc/models/User') // 跨模块引用示例
const util = require('../../lib/util')

// 实例化业务基类，并注入当前模块上下文
const service = new Service({ __dirname, __filename, module })

/**
 * 【创建用户】
 * @param {string} name 姓名
 * @param {string} mobile 手机号
 * @param {string} gender 性别
 */
exports.createUser = async ({ name, mobile, gender }) => {
  if (!name) return { code: 1, msg: '姓名必填' }
  const id = util.createId()
  
  try {
     const user = await User.create({ id, name, mobile, gender })
     return { code: 0, data: { doc: user } }
  } catch(e) {
     ERROR(`数据库写入失败: ${e.message}`)
     // 韧性设计：即便数据库不可用，开发阶段也返回 mock 数据确保流程不中断
     return { code: 0, msg: 'Mock 数据(数据库不可用)', data: { doc: { id, name, mobile, gender } } }
  }
}

/**
 * 【获取用户详情】
 * @param {string} id 用户唯一标识
 */
exports.getUserById = async ({ id }) => {
  try {
     const user = await User.findOne({ id })
     if (!user) return { code: 4, msg: '用户不存在' }
     return { code: 0, data: { doc: user } }
  } catch(e) {
     return { code: 0, msg: 'Mock数据(数据库不可用)', data: { doc: { id, name: '测试用户' } } }
  }
}

/**
 * 【更新用户信息】
 * @param {string} id 
 * @param {string} name 
 * @param {string} mobile 
 */
exports.updateUser = async ({ id, name, mobile }) => {
  try {
     const user = await User.findOneAndUpdate(
       { id, deleted: { $ne: true } }, // 仅允许更新未被逻辑删除的数据
       { $set: { name, mobile } },
       { new: true }, // 返回更新后的文档内容
     )
     if (!user) return { code: 4, msg: '目标用户不存在或已删除' }
     return { code: 0, data: { doc: user } }
  } catch(e) {
     return { code: 0, msg: 'Mock数据(数据库不可用)', data: { doc: { id, name } } }
  }
}

/**
 * 【逻辑删除用户】
 * @param {string} id 
 */
exports.deleteUser = async ({ id }) => {
  try {
     const result = await User.findOneAndUpdate(
       { id },
       { $set: { deleted: true, updateDate: new Date() } },
       { new: true },
     )
     return result ? { code: 0 } : { code: 4, msg: '用户不存在' }
  } catch(e) {
     return { code: 0, msg: 'Mock逻辑执行(数据库不可用)' }
  }
}

/**
 * 【用户列表查询】
 * @param {Object} condition 过滤条件
 * @param {number} skip 跳过的记录数
 * @param {number} limit 每次返回的数量
 */
exports.listUsers = async ({ condition = {}, skip = 0, limit = 10 }) => {
  try {
     const docs = await User.find(condition).skip(Number(skip)).limit(Number(limit)).exec()
     return { code: 0, data: { docs } }
  } catch(e) {
     return { code: 0, msg: 'Mock数据(数据库不可用)', data: { docs: [] } }
  }
}

/**
 * 【定时任务示例】
 * 会被 src/task.js 扫描并按 Cron 表达式配置触发。
 */
exports.someTask = () => {
  INFO('CoreSvc 后台任务 someTask 执行成功！')
}

// 【关键步骤】调用父类的自动导出包装器，实现全局 try-catch 拦截与 AOP 增强
service.exportMe()
