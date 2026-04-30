/**
 * @file Trade.js (Model)
 * @description 交易记录持久层模型定义。
 */

const mongoose = require('mongoose')
const Schema = mongoose.Schema

const tradeSchema = new Schema({
  id: { type: String, required: true, unique: true },
  type: { type: String, enum: ['npc', 'p2p'], required: true },
  buyerOpenid: { type: String, required: true },
  sellerOpenid: { type: String, required: true },
  item: { type: String, required: true },
  amount: { type: Number, required: true },
  price: { type: Number, required: true },
  totalPrice: { type: Number, required: true },
  buyerSignature: { type: String },
  sellerSignature: { type: String },
  createDate: { type: Date, default: Date.now },
  deleted: { type: Boolean, default: false }
}, {
  collection: 'LobsterSvc_Trade'
})

module.exports = mongoose.model('Trade', tradeSchema)
