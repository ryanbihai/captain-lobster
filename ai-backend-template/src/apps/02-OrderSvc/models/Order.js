/**
 * @file Order.js (Model)
 * @description 订单持久层模型定义。包含了订单金额、状态位、以及严格的物理表名隔离配置。
 */

const mongoose = require('mongoose')
const Schema = mongoose.Schema

/**
 * 【订单 Schema 定义】
 */
const orderSchema = new Schema({
  id:         { type: String, required: true, unique: true },              // 业务层唯一订单号
  userId:     { type: String, required: true },                            // 所属用户 ID
  productId:  { type: String, required: true },                            // 商品/SPU ID
  amount:     { type: Number, required: true },                            // 订单支付总金额
  status:     { type: String, default: 'pending' },                        // 订单状态：pending(待支付), paid(已支付), cancel(取消)
  createDate: { type: Date, default: Date.now },                           // 下单时间
  updateDate: { type: Date },                                              // 最后更新时间
  deleted:    { type: Boolean, default: false }                            // 逻辑删除标识
}, {
  /**
   * 【强制要求】：遵循数据隔离规范
   * 必须通过 collection 属性锁定所在的物理表名 (OrderSvc_Order)，
   * 防止多个微服务共用同一个数据库时发生物理数据表冲突。
   */
  collection: 'OrderSvc_Order'
})

// 默认导出 Mongoose 模型单例
module.exports = mongoose.model('Order', orderSchema)
