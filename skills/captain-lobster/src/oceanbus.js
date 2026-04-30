/**
 * @file oceanbus.js
 * @description OceanBus L0 客户端
 *
 * 核心协议事实（2026-04-28 更新）：
 * - register() 返回 {agent_id, api_key}，不含 openid
 * - 需 register 后立即 GET /agents/me 获取 my_openid
 * - 三要素 (agentId + openid + apiKey) 缺一不可
 * - agent_code 已废弃，改为 UUID 格式的 agent_id
 * - /agents/lookup 已下线，由 /agents/me 取代
 */

const https = require('https')

class OceanBusClient {
  constructor(baseUrl = 'https://ai-t.ihaola.com.cn/api/l0') {
    this.baseUrl = baseUrl
    this.apiKey = null
    this.agentId = null
    this.openid = null
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey
  }

  setAgentInfo(agentId, openid) {
    this.agentId = agentId
    this.openid = openid
  }

  async request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path)
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json'
        }
      }

      if (this.apiKey) {
        options.headers['Authorization'] = `Bearer ${this.apiKey}`
      }

      const req = https.request(options, res => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try {
            const body = JSON.parse(data)
            body.httpStatus = res.statusCode
            resolve(body)
          } catch (e) {
            resolve({ code: 500, msg: '解析失败', httpStatus: res.statusCode })
          }
        })
      })

      req.on('error', e => resolve({ code: 500, msg: e.message, httpStatus: 0 }))
      req.setTimeout(15000, () => { req.destroy(); resolve({ code: 408, msg: '请求超时', httpStatus: 0 }) })

      if (body) {
        const bodyStr = JSON.stringify(body)
        options.headers['Content-Length'] = Buffer.byteLength(bodyStr)
        req.write(bodyStr)
      }
      req.end()
    })
  }

  async register() {
    const result = await this.requestWithRetry('POST', '/agents/register')
    if (result.code === 0) {
      this.apiKey = result.data.api_key
      this.agentId = result.data.agent_id
      // 通过 /agents/me 获取 openid（替代已废弃的 /agents/lookup）
      const meResult = await this.requestWithRetry('GET', '/agents/me')
      if (meResult.code === 0 && meResult.data) {
        this.openid = meResult.data.my_openid
      }
    }
    return result
  }

  async lookup(agentId) {
    // DEPRECATED: /agents/lookup 已永久下线（OceanBus v2）。
    // 获取他人 openid 的正确方式：通过 get_city 响应中的 players 列表，
    // 或通过 P2P 合约交互。本方法仅返回自身 openid，不应用于寻址他人。
    console.warn('[OceanBus] lookup() 已废弃，请通过 get_city 获取其他玩家 openid')
    return await this.requestWithRetry('GET', `/agents/me`)
  }

  async sendMessage(toOpenid, content) {
    return await this.requestWithRetry('POST', '/messages', {
      to_openid: toOpenid,
      client_msg_id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      content
    })
  }

  async syncMessages(sinceSeq = 0) {
    return await this.requestWithRetry('GET', `/messages/sync?since_seq=${sinceSeq}`)
  }

  async requestWithRetry(method, path, body = null, maxRetries = 3) {
    let lastResult = null
    for (let i = 0; i <= maxRetries; i++) {
      lastResult = await this.request(method, path, body)
      // 只重试网络层错误（httpStatus 0=网络断开, 5xx=服务端故障, 408=超时）
      // API 业务层错误（httpStatus 2xx 但 body.code !== 0）不重试
      if (lastResult.httpStatus === 0 || lastResult.httpStatus >= 500 || lastResult.httpStatus === 408) {
        if (i < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, i), 8000)
          await new Promise(r => setTimeout(r, delay))
        }
      } else {
        break
      }
    }
    return lastResult
  }

  async sendP2P(peerOpenid, type, payload) {
    const message = JSON.stringify({ type, ...payload, from: this.openid, ts: Date.now() })
    return await this.sendMessage(peerOpenid, message)
  }

  async pollForReply(requestId, maxWaitMs = 45000, baseIntervalMs = 1000) {
    let attempts = 0
    let highestSeq = 0
    const deadline = Date.now() + maxWaitMs

    while (Date.now() < deadline) {
      try {
        const syncResult = await this.syncMessages(highestSeq)
        if (syncResult.code === 0 && syncResult.data && syncResult.data.messages) {
          for (const msg of syncResult.data.messages) {
            if (typeof msg.seq_id === 'number' && msg.seq_id > highestSeq) {
              highestSeq = msg.seq_id
            }
            try {
              const payload = JSON.parse(msg.content)
              if (payload.request_id === requestId) {
                return payload
              }
            } catch (e) {}
          }
        }
        if (syncResult.code === 401) {
          return { code: 401, msg: 'API Key 失效，请重新注册' }
        }
      } catch (e) {}

      // 找到新消息但没匹配 → 立即继续不睡；否则指数退避
      const backoffFactor = Math.min(Math.pow(2, Math.floor(attempts / 5)), 4)
      await new Promise(r => setTimeout(r, baseIntervalMs * backoffFactor))
      attempts++
    }
    return null
  }

  parseMessages(messages, type = null) {
    const parsed = []
    if (!messages || !Array.isArray(messages)) return parsed
    for (const msg of messages) {
      try {
        const payload = JSON.parse(msg.content)
        if (!type || payload.type === type || payload.action === type) {
          parsed.push({ ...payload, from_openid: msg.from_openid, seq: msg.seq })
        }
      } catch (e) {}
    }
    return parsed
  }

  async validateApiKey() {
    if (!this.apiKey) return false
    const result = await this.request('GET', '/messages/sync?since_seq=0')
    return result.code !== 401 && result.code !== 403
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

module.exports = OceanBusClient
