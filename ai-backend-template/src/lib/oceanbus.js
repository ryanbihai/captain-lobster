/**
 * @file lib/oceanbus.js
 * @description 服务端 OceanBus L0 客户端 (superagent 版本)
 *
 * v2 核心变更：
 * - register() 返回 {agent_id, api_key}，不再含 agent_code
 * - /agents/lookup 已废弃，用 GET /agents/me 获取 my_openid
 * - 三要素 (agentId + openid + apiKey) 缺一不可
 */

const superagent = require('superagent')

class OceanBus {
  constructor(baseUrl) {
    this.baseUrl = baseUrl || 'https://ai-t.ihaola.com.cn/api/l0'
    this.apiKey = null
    this.openid = null
    this.agentId = null
  }

  async register() {
    try {
      const res = await superagent
        .post(this.baseUrl + '/agents/register')
        .set('Content-Type', 'application/json')

      if (res.body && res.body.code === 0) {
        this.apiKey = res.body.data.api_key
        this.agentId = res.body.data.agent_id

        // v2: /agents/me 替代已废弃的 /agents/lookup
        const meResult = await this.getMe()
        if (meResult.code === 0 && meResult.data) {
          this.openid = meResult.data.my_openid
        }
      }

      return res.body
    } catch (err) {
      return { code: 500, msg: err.message }
    }
  }

  /**
   * 获取自身永久路由票据
   * v2 新增：替代已废弃的 /agents/lookup
   */
  async getMe() {
    try {
      const res = await superagent
        .get(this.baseUrl + '/agents/me')
        .set('Authorization', 'Bearer ' + this.apiKey)

      return res.body
    } catch (err) {
      return { code: 500, msg: err.message }
    }
  }

  async sendMessage(toOpenid, content) {
    try {
      const res = await superagent
        .post(this.baseUrl + '/messages')
        .set('Content-Type', 'application/json')
        .set('Authorization', 'Bearer ' + this.apiKey)
        .send({
          to_openid: toOpenid,
          client_msg_id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
          content: content
        })

      return res.body
    } catch (err) {
      let detail = err.message
      if (err.response) {
        detail = `HTTP ${err.response.status}: ${JSON.stringify(err.response.body || err.response.text).substring(0, 200)}`
      }
      return { code: 500, msg: err.message, detail, httpStatus: err.response?.status || 0 }
    }
  }

  async syncMessages(sinceSeq = 0) {
    try {
      const res = await superagent
        .get(this.baseUrl + '/messages/sync')
        .set('Authorization', 'Bearer ' + this.apiKey)
        .query({ since_seq: sinceSeq })

      return res.body
    } catch (err) {
      return { code: 500, msg: err.message }
    }
  }

  restoreFromConfig(agentId, openid, apiKey) {
    this.agentId = agentId
    this.openid = openid
    this.apiKey = apiKey
  }

  async validateApiKey() {
    if (!this.apiKey) return false
    try {
      const result = await this.syncMessages(0)
      return result.code !== 401 && result.code !== 403
    } catch (e) {
      return false
    }
  }

  isReady() {
    return !!(this.apiKey && this.agentId && this.openid)
  }

  getStatus() {
    return {
      agentId: this.agentId,
      openid: this.openid,
      hasApiKey: !!this.apiKey,
      ready: this.isReady()
    }
  }
}

module.exports = OceanBus
