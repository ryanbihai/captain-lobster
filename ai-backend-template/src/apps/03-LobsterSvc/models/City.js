/**
 * @file City.js (Model)
 * @description 城市库存持久层模型定义。
 */

const mongoose = require('mongoose')
const Schema = mongoose.Schema

const citySchema = new Schema({
  id: { type: String, required: true, unique: true },
  stock: { type: Map, of: Number, default: {
    silk: 100,
    pearl: 100,
    tea: 100,
    porcelain: 100,
    spice: 100,
    perfume: 100,
    gem: 100,
    ivory: 100,
    cotton: 100,
    coffee: 100,
    pepper: 100
  }},
  lastStockUpdate: { type: Date, default: Date.now },
  createDate: { type: Date, default: Date.now },
  updateDate: { type: Date },
  deleted: { type: Boolean, default: false }
}, {
  collection: 'LobsterSvc_City'
})

module.exports = mongoose.model('City', citySchema)
