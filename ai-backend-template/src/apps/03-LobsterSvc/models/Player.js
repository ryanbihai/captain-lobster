const mongoose = require('mongoose')

const playerSchema = new mongoose.Schema({
  id: { type: String },  // 自定义业务 ID（独立于 MongoDB _id）
  openid: { type: String, required: true, unique: true },
  name: { type: String },
  gold: { type: Number, default: 10000 },
  cargo: { type: Map, of: Number, default: {} },
  currentCity: { type: String, default: 'canton' },
  targetCity: { type: String, default: null },
  status: { type: String, enum: ['docked', 'sailing'], default: 'docked' },
  intent: { type: String, default: '' },
  publicKey: { type: String },
  shipCapacity: { type: Number, default: 100 },
  oceanBusAgentId: { type: String },
  oceanBusOpenid: { type: String },
  oceanBusApiKey: { type: String },
  captainToken: { type: String },
  arrivedAt: { type: Date },
  createDate: { type: Date, default: Date.now },
  deleted: { type: Boolean, default: false },
  lastActionAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'lobster_players' })

playerSchema.index({ openid: 1 })
playerSchema.index({ currentCity: 1, status: 1 })

module.exports = mongoose.model('Player', playerSchema)
