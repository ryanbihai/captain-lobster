/**
 * @file PlayerSimulator.js
 * @description 玩家模拟器，模拟一个 OpenClaw Agent 使用 Captain Lobster Skill
 */

const request = require('superagent')
const SignatureUtils = require('./SignatureUtils')

class PlayerSimulator {
  constructor(name, config = {}) {
    this.name = name
    this.l1Url = config.l1Url || 'http://localhost:17019/api'
    this.oceanBusUrl = config.oceanBusUrl || 'https://ai-t.ihaola.com.cn/api/l0'

    this.state = {
      playerId: null,
      openid: null,
      ed25519KeyPair: null,
      oceanBusAgent: {
        agentCode: null,
        openid: null,
        apiKey: null
      },
      gold: config.initialGold || 10000,
      cargo: {},
      currentCity: config.startCity || 'canton',
      status: 'docked',
      intent: '',
      tradeHistory: [],
      messageHistory: []
    }

    this.lastSeq = 0
  }

  async enroll(initialGold = 10000) {
    this.state.ed25519KeyPair = SignatureUtils.generateKeyPair()
    const publicKeyPem = this.state.ed25519KeyPair.publicKey.replace('-----BEGIN PUBLIC KEY-----', '').replace('-----END PUBLIC KEY-----', '')

    const openid = `test_${this.name}_${Date.now()}`

    const res = await this._post('/lobster/enroll', {
      openid,
      publicKey: publicKeyPem,
      initialGold
    })

    if (res.code !== 0) {
      throw new Error(`入驻失败: ${res.msg}`)
    }

    this.state.playerId = res.data.doc.id
    this.state.openid = openid
    this.state.gold = res.data.doc.gold
    this.state.currentCity = res.data.doc.currentCity

    console.log(`[${this.name}] 入驻成功: playerId=${this.state.playerId}, gold=${this.state.gold}`)

    return res.data
  }

  async registerOceanBus() {
    const res = await this._post('/lobster/oceanbus/register', {
      playerId: this.state.playerId
    })

    if (res.code !== 0) {
      throw new Error(`OceanBus 注册失败: ${res.msg}`)
    }

    this.state.oceanBusAgent.agentCode = res.data.agentCode
    this.state.oceanBusAgent.openid = res.data.openid

    console.log(`[${this.name}] OceanBus 注册成功: agentCode=${this.state.oceanBusAgent.agentCode}`)

    return res.data
  }

  async getCity(cityId) {
    const res = await this._get(`/lobster/city/${cityId}`)

    if (res.code !== 0) {
      throw new Error(`获取城市信息失败: ${res.msg}`)
    }

    console.log(`[${this.name}] 查询城市 ${cityId}: ${res.data.players.length} 名玩家停靠`)

    return res.data
  }

  async moveTo(cityId) {
    const res = await this._post('/lobster/action/move', {
      openid: this.state.openid,
      targetCity: cityId
    })

    if (res.code !== 0) {
      throw new Error(`移动失败: ${res.msg}`)
    }

    if (res.data.status === 'sailing') {
      console.log(`[${this.name}] 启航前往 ${cityId}...`)
    } else if (res.data.status === 'docked') {
      console.log(`[${this.name}] 抵达 ${cityId}`)
      this.state.currentCity = cityId
    }

    return res.data
  }

  async updateIntent(intent) {
    const res = await this._post('/lobster/action/intent', {
      openid: this.state.openid,
      intent
    })

    if (res.code !== 0) {
      throw new Error(`更新意向牌失败: ${res.msg}`)
    }

    this.state.intent = intent
    console.log(`[${this.name}] 更新意向牌: "${intent}"`)

    return res.data
  }

  async tradeWithNpc(item, amount, action) {
    const res = await this._post('/lobster/trade/npc', {
      openid: this.state.openid,
      item,
      amount,
      action
    })

    if (res.code !== 0) {
      throw new Error(`NPC 交易失败: ${res.msg}`)
    }

    this.state.gold = res.data.playerGold
    this.state.cargo = res.data.cargo

    const actionText = action === 'buy' ? '买入' : '卖出'
    console.log(`[${this.name}] NPC ${actionText}: ${amount} ${item}, 金币: ${this.state.gold}`)

    this.state.tradeHistory.push({
      type: 'npc',
      item,
      amount,
      action,
      price: res.data.trade.price,
      totalPrice: res.data.trade.totalPrice,
      timestamp: Date.now()
    })

    return res.data
  }

  async sendMessage(toAgentCode, content) {
    const res = await this._post('/lobster/oceanbus/messages/send', {
      playerId: this.state.playerId,
      toAgentCode,
      content
    })

    if (res.code !== 0) {
      throw new Error(`发送消息失败: ${res.msg}`)
    }

    console.log(`[${this.name}] 发送消息至 ${toAgentCode}: "${content}"`)

    this.state.messageHistory.push({
      type: 'sent',
      to: toAgentCode,
      content,
      timestamp: Date.now()
    })

    return res.data
  }

  async syncMessages() {
    const res = await this._get('/lobster/oceanbus/messages/sync', {
      playerId: this.state.playerId,
      sinceSeq: this.lastSeq
    })

    if (res.code !== 0) {
      throw new Error(`同步消息失败: ${res.msg}`)
    }

    const newMessages = res.data.messages
    if (newMessages.length > 0) {
      console.log(`[${this.name}] 收到 ${newMessages.length} 条新消息`)
      newMessages.forEach(msg => {
        console.log(`  - 来自 ${msg.from_openid}: "${msg.content}"`)
        this.state.messageHistory.push({
          type: 'received',
          from: msg.from_openid,
          content: msg.content,
          timestamp: msg.timestamp
        })
      })
    }

    this.lastSeq = res.data.nextSeq

    return res.data
  }

  signTrade(tradeData) {
    const payload = SignatureUtils.createTradePayload(
      tradeData.tradeId,
      tradeData.buyerOpenid,
      tradeData.sellerOpenid,
      tradeData.item,
      tradeData.amount,
      tradeData.totalPrice
    )

    return SignatureUtils.sign(payload, this.state.ed25519KeyPair.privateKey)
  }

  async executeP2PTrade(tradeData) {
    const buyerSignature = tradeData.buyerOpenid === this.state.openid
      ? this.signTrade(tradeData)
      : null

    const sellerSignature = tradeData.sellerOpenid === this.state.openid
      ? this.signTrade(tradeData)
      : null

    if (!buyerSignature || !sellerSignature) {
      throw new Error('双方都需要签名才能执行 P2P 交易')
    }

    const res = await this._post('/lobster/trade/p2p', {
      trade_id: tradeData.tradeId,
      buyer_openid: tradeData.buyerOpenid,
      seller_openid: tradeData.sellerOpenid,
      item: tradeData.item,
      amount: tradeData.amount,
      total_price: tradeData.totalPrice,
      buyer_signature: buyerSignature,
      seller_signature: sellerSignature
    })

    if (res.code !== 0) {
      throw new Error(`P2P 交易失败: ${res.msg}`)
    }

    if (tradeData.buyerOpenid === this.state.openid) {
      this.state.gold -= tradeData.totalPrice
      this.state.cargo[tradeData.item] = (this.state.cargo[tradeData.item] || 0) + tradeData.amount
    } else {
      this.state.gold += tradeData.totalPrice
      this.state.cargo[tradeData.item] = (this.state.cargo[tradeData.item] || 0) - tradeData.amount
    }

    console.log(`[${this.name}] P2P 交易完成: ${tradeData.amount} ${tradeData.item} @ ${tradeData.totalPrice}, 金币: ${this.state.gold}`)

    this.state.tradeHistory.push({
      type: 'p2p',
      ...tradeData,
      timestamp: Date.now()
    })

    return res.data
  }

  getStatus() {
    return {
      name: this.name,
      playerId: this.state.playerId,
      openid: this.state.openid,
      agentCode: this.state.oceanBusAgent.agentCode,
      gold: this.state.gold,
      cargo: this.state.cargo,
      currentCity: this.state.currentCity,
      status: this.state.status,
      intent: this.state.intent,
      tradeCount: this.state.tradeHistory.length,
      messageCount: this.state.messageHistory.length
    }
  }

  async _post(path, body) {
    try {
      const res = await request
        .post(`${this.l1Url}${path}`)
        .send(body)
        .timeout(10000)
      return res.body
    } catch (err) {
      throw new Error(`请求失败: ${err.message}`)
    }
  }

  async _get(path, query = {}) {
    try {
      const res = await request
        .get(`${this.l1Url}${path}`)
        .query(query)
        .timeout(10000)
      return res.body
    } catch (err) {
      throw new Error(`请求失败: ${err.message}`)
    }
  }
}

module.exports = PlayerSimulator
