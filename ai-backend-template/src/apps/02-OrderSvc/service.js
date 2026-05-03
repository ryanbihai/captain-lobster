/**
 * @file service.js (02-OrderSvc)
 * @description 订单业务逻辑层。负责处理订单的创建、查询以及后续的状态流转（如支付、取消等）。
 */

const { INFO, ERROR } = require('../../lib/logSvc.js')(__filename)
const { Service } = require('../../lib/servicelib')
const { Order } = require('./models')
const util = require('../../lib/util')

// 初始化业务基类
const service = new Service({ __dirname, __filename, module })

/**
 * 【创建订单】
 * @param {string} userId 下单用户 ID
 * @param {string} productId 商品 ID
 * @param {number} amount 订单总金额
 */
exports.createOrder = async ({ userId, productId, amount }) => {
  if (!userId || !productId) return { code: 1, msg: '缺少必要参数 (userId/productId)' }
  
  // 生成 32 位全量唯一订单业务号
  const id = util.createId()
  
  try {
     // 执行数据库持久化
     const order = await Order.create({ id, userId, productId, amount })
     INFO(`[订单系统] 新订单创建成功: ${id}`)
     return { code: 0, data: { doc: order } }
  } catch (e) {
     ERROR(`订单创建失败: ${e.message}`)
     return { code: 500, msg: e.message }
  }
}

/**
 * 【获取订单详情】
 * @param {string} id 订单业务 ID
 */
exports.getOrder = async ({ id }) => {
  if (!id) return { code: 1, msg: '缺少订单 ID' }
  try {
     // 增加逻辑删除过滤（deleted: false）进行查询
     const order = await Order.findOne({ id, deleted: { $ne: true } })
     if (!order) return { code: 4, msg: '订单不存在或已被取消' }
     return { code: 0, data: { doc: order } }
  } catch (e) {
     ERROR(`查询订单详情失败: ${e.message}`)
     return { code: 500, msg: e.message }
  }
}

// 执行 AOP 自动导出装饰，启用统一异常拦截
service.exportMe()
