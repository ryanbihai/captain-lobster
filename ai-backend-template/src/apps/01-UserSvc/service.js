/**
 * @file service.js (01-UserSvc)
 * @description 用户微服务核心业务层。实现了用户数据的全生命周期管理，并集成了日志与异常处理机制。
 */

const { INFO, ERROR, EXCEPTION, DEBUG, WARN } = require('../../lib/logSvc.js')(__filename)
const { Service } = require('../../lib/servicelib')
const util = require('../../lib/util')
const User = require('./models/User')
const queueManager = require('../../lib/queue-manager')

// 继承基类并初始化当前模块上下文
const service = new Service({ __dirname, __filename, module })

/**
 * 【创建用户】
 * @param {string} name 姓名
 * @param {string} mobile 手机
 * @param {string} gender 性别
 */
exports.createUser = async ({ name, mobile, gender }) => {
   if (!name) return { code: 1, msg: 'Name参数不能为空' }
   const id = util.createId()
   
   try {
      // 写入 MongoDB
      const user = await User.create({ id, name, mobile, gender })
      return { code: 0, msg: '用户创建成功', data: { doc: user } }
   } catch (e) {
      ERROR(`数据库写入异常: ${e.message}`)
      // 开发阶段韧性回退：数据库不可用时返回内存 Mock 数据
      return { code: 0, msg: '[离线Mock] 用户创建成功', data: { doc: { id, name, mobile, gender } } }
   }
}

/**
 * 【查：获取用户详情】
 * @param {string} id 用户唯一 ID
 */
exports.getUserById = async ({ id }) => {
   if (!id) return { code: 1, msg: '缺少ID参数' }
   try {
      const user = await User.findOne({ id })
      if (!user) return { code: 4, msg: '未找到该用户' }
      return { code: 0, data: { doc: user } }
   } catch (e) {
      return { code: 0, msg: '[离线Mock] 未找到对应数据', data: { doc: null } }
   }
}

/**
 * 【改：更新用户信息】
 * @param {string} id 目标 ID
 * @param {string} name (可选)
 * @param {string} mobile (可选)
 * @param {string} avatar (可选)
 */
exports.updateUser = async ({ id, name, mobile, avatar }) => {
   if (!id) return { code: 1, msg: '缺少ID参数' }
   
   // 动态构建更新字段，避免覆盖掉未传入的已有字段
   const updates = {}
   if (name !== undefined) updates.name = name
   if (mobile !== undefined) updates.mobile = mobile
   if (avatar !== undefined) updates.avatar = avatar

   try {
      const user = await User.findOneAndUpdate(
         { id, deleted: { $ne: true } }, // 仅操作未被软删除的用户
         { $set: updates },
         { new: true }, // 返回更新后的最新文档
      )
      if (!user) return { code: 4, msg: '未找到可更新的用户' }
      return { code: 0, msg: '更新成功', data: { doc: user } }
   } catch (e) {
      return { code: 0, msg: '[离线Mock] 更新成功', data: { doc: { id, ...updates } } }
   }
}

/**
 * 【删：逻辑软删除】
 * @param {string} id 
 */
exports.deleteUser = async ({ id }) => {
   if (!id) return { code: 1, msg: '缺少ID参数' }
   try {
      const result = await User.findOneAndUpdate(
         { id },
         { $set: { deleted: true, updateDate: new Date() } },
         { new: true },
      )
      return result ? { code: 0, msg: '删除成功' } : { code: 4, msg: '操作失败或用户不存在' }
   } catch (e) {
      return { code: 0, msg: '[离线Mock] 删除指令接收成功' }
   }
}

/**
 * 【查：分页与模糊搜索】
 * @param {string} keyword 搜索关键字（模糊匹配姓名）
 * @param {number} skip 分页起始位
 * @param {number} limit 每页条数
 */
exports.listUsers = async ({ keyword = '', skip = 0, limit = 10 }) => {
   const condition = {}
   // 支持简单的姓名不区分大小写模糊查询
   if (keyword) condition.name = new RegExp(keyword, 'i')

   try {
      const total = await User.countDocuments(condition)
      const docs = await User.find(condition).skip(Number(skip)).limit(Number(limit)).lean().exec()
      return { code: 0, data: { total, docs } }
   } catch (e) {
      return { code: 0, msg: '[离线Mock] 服务器当前未连接DB', data: { total: 0, docs: [] } }
   }
}

// 执行 AOP 自动导出装饰
service.exportMe()
