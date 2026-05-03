/**
 * @file Contract.js (Model)
 * @description 交易合约持久层模型定义。
 */

const mongoose = require('mongoose')
const Schema = mongoose.Schema

const contractSchema = new Schema({
  id: { type: String, required: true, unique: true },
  buyerOpenid: { type: String, required: true },
  sellerOpenid: { type: String, required: true },
  item: { type: String, required: true },
  amount: { type: Number, required: true },
  price: { type: Number, required: true },
  totalPrice: { type: Number, required: true },
  deliveryCity: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'seller_arrived', 'buyer_arrived', 'completed', 'cancelled', 'failed', 'expired'],
    default: 'pending'
  },
  sellerArrived: { type: Boolean, default: false },
  buyerArrived: { type: Boolean, default: false },
  sellerArrivedAt: { type: Date },
  buyerArrivedAt: { type: Date },
  settleAt: { type: Date },
  buyerSignature: { type: String },
  sellerSignature: { type: String },
  createDate: { type: Date, default: Date.now },
  updateDate: { type: Date },
  deleted: { type: Boolean, default: false }
}, {
  collection: 'LobsterSvc_Contract'
})

module.exports = mongoose.model('Contract', contractSchema)
