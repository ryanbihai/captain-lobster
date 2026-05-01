/**
 * @file oceanbus-service.js
 * @description L1 Game Server - OceanBus 消息驱动模式
 *
 * 职责：
 * 1. 通过 OceanBus L0 接收 Skill 端请求
 * 2. 路由到对应 business handler
 * 3. 通过 OceanBus L0 回复响应
 * 4. 身份持久化到 ~/.captain-lobster/l1-agent.json
 */

const OceanBusClient = require('../../lib/oceanbus')
const util = require('../../lib/util')
const fs = require('fs')
const path = require('path')
const os = require('os')

const OCEANBUS_BASE_URL = process.env.OCEANBUS_URL || 'https://ai-t.ihaola.com.cn/api/l0'
const POLL_INTERVAL = 1000
const L1_CONFIG_FILE = path.join(os.homedir(), '.captain-lobster', 'l1-agent.json')
const L1_AGENT_NAME = 'lobster-l1'
const SAILING_MULTIPLIER = (parseFloat(process.env.L1_SAILING_MULTIPLIER) || 1) || 1

const CITIES = {
  canton: { id: 'canton', name: '广州', lat: 23.13, lng: 113.26, specialty: ['silk', 'tea', 'porcelain'] },
  calicut: { id: 'calicut', name: '卡利卡特', lat: 11.25, lng: 75.78, specialty: ['spice', 'pepper', 'cotton'] },
  zanzibar: { id: 'zanzibar', name: '桑给巴尔', lat: -6.16, lng: 39.20, specialty: ['ivory', 'spice', 'pearl'] },
  alexandria: { id: 'alexandria', name: '亚历山大', lat: 31.20, lng: 29.92, specialty: ['spice', 'perfume'] },
  venice: { id: 'venice', name: '威尼斯', lat: 45.44, lng: 12.32, specialty: ['silk', 'perfume', 'pearl'] },
  lisbon: { id: 'lisbon', name: '里斯本', lat: 38.72, lng: -9.14, specialty: ['spice', 'gem'] },
  london: { id: 'london', name: '伦敦', lat: 51.51, lng: -0.13, specialty: ['tea', 'gem', 'pearl'] },
  amsterdam: { id: 'amsterdam', name: '阿姆斯特丹', lat: 52.37, lng: 4.90, specialty: ['spice', 'coffee', 'gem'] },
  istanbul: { id: 'istanbul', name: '伊斯坦布尔', lat: 41.01, lng: 28.98, specialty: ['spice', 'silk', 'perfume'] },
  genoa: { id: 'genoa', name: '热那亚', lat: 44.41, lng: 8.94, specialty: ['silk', 'spice', 'pearl'] }
}

const BASE_PRICES = {
  silk: 1500, tea: 100, porcelain: 380, spice: 420, pepper: 60, pearl: 2600,
  perfume: 1900, gem: 3800, ivory: 550, cotton: 85, coffee: 120
}

const AMM_SPREAD = 0.10
const SHIP_CAPACITY = 100
const SETTLE_HOURS = 3

// ── 酒馆情报 ──
const INTEL_HOLD_LIMIT = 3
const INTEL_COST_MIN = 800; const INTEL_COST_MAX = 1200
const INTEL_REWARD_MIN = 2500; const INTEL_REWARD_MAX = 4000
const INTEL_DEADLINE_MS = 2 * 60 * 60 * 1000  // 2 hours
const INTEL_TYPES = ['cargo', 'passenger', 'discount']

const CAPABILITIES = {
  ping: {
    description: '检测 L1 服务是否在线',
    params: {}
  },
  enroll: {
    description: '入驻游戏世界，创建船长身份',
    params: {
      openid: { type: 'string', required: true, description: '玩家 OceanBus OpenID' },
      publicKey: { type: 'string', required: false, description: 'RSA 公钥（P2P 签名用）' },
      initialGold: { type: 'number', required: false, default: 20000, description: '初始金币（固定20000，客户端传值无效）' }
    }
  },
  status: {
    description: '查询船长完整状态（金币/货舱/位置/航行状态）',
    params: {
      openid: { type: 'string', required: true, description: '玩家 OpenID' }
    }
  },
  get_city: {
    description: '查询城市行情、停靠玩家、进行中合约',
    params: {
      city_id: { type: 'string', required: false, default: 'canton', description: '城市 ID', enum: Object.keys(CITIES) }
    }
  },
  move: {
    description: '启航前往目标城市（需等待航行时间后才能 arrive）',
    params: {
      openid: { type: 'string', required: true, description: '玩家 OpenID' },
      target_city: { type: 'string', required: true, description: '目标城市 ID', enum: Object.keys(CITIES) }
    }
  },
  arrive: {
    description: '抵达目标城市并交割合约（幂等：已停靠时静默成功）',
    params: {
      openid: { type: 'string', required: true, description: '玩家 OpenID' }
    }
  },
  trade_npc: {
    description: '与 NPC 进行买卖交易（需在停靠状态）',
    params: {
      openid: { type: 'string', required: true, description: '玩家 OpenID' },
      item: { type: 'string', required: true, description: '商品名称', enum: Object.keys(BASE_PRICES) },
      amount: { type: 'number', required: true, description: '交易数量（正整数）' },
      trade_action: { type: 'string', required: true, description: '买卖方向', enum: ['buy', 'sell'] }
    }
  },
  intent: {
    description: '更新意向牌（供其他玩家在城市列表中看到）',
    params: {
      openid: { type: 'string', required: true, description: '玩家 OpenID' },
      intent: { type: 'string', required: true, description: '意向内容（最长 140 字）' }
    }
  },
  create_contract: {
    description: '创建 P2P 交易合约（卖方货物立即扣除）',
    params: {
      buyer_openid: { type: 'string', required: true, description: '买方 OpenID' },
      seller_openid: { type: 'string', required: true, description: '卖方 OpenID' },
      item: { type: 'string', required: true, description: '商品名称', enum: Object.keys(BASE_PRICES) },
      amount: { type: 'number', required: true, description: '交易数量' },
      price: { type: 'number', required: true, description: '单价' },
      delivery_city: { type: 'string', required: true, description: '交割城市 ID', enum: Object.keys(CITIES) },
      buyer_signature: { type: 'string', required: false, description: '买方签名' }
    }
  },
  cancel_contract: {
    description: '取消未完成的合约（退还卖方货物）',
    params: {
      contract_id: { type: 'string', required: true, description: '合约 ID' },
      openid: { type: 'string', required: true, description: '操作者 OpenID（需为合约参与方）' }
    }
  },
  list_contracts: {
    description: '查询我的合约列表',
    params: {
      openid: { type: 'string', required: true, description: '玩家 OpenID' },
      status: { type: 'string', required: false, description: '按状态筛选', enum: ['pending', 'seller_arrived', 'completed', 'cancelled', 'failed'] }
    }
  },
  capabilities: {
    description: '返回所有可用 action 及参数定义（本接口）',
    params: {}
  },
  rename: {
    description: '为你的船长改名',
    params: {
      openid: { type: 'string', required: true, description: '玩家 OpenID' },
      name: { type: 'string', required: true, description: '新船名（最长 20 字）' }
    }
  },
  tavern_buy: {
    description: '在酒馆购买一份随机情报（需停靠，费用800-1200金币，限持3份）',
    params: {
      openid: { type: 'string', required: true, description: '玩家 OpenID' }
    }
  },
  intel_list: {
    description: '查看我持有的所有情报',
    params: {
      openid: { type: 'string', required: true, description: '玩家 OpenID' }
    }
  },
  intel_transfer: {
    description: '将情报转让给另一位船长（清除故事，变更持有者）',
    params: {
      openid: { type: 'string', required: true, description: '转出方 OpenID' },
      intel_id: { type: 'string', required: true, description: '情报 ID' },
      target_openid: { type: 'string', required: true, description: '接收方 OpenID' }
    }
  },
  intel_story: {
    description: '为情报撰写故事（购买后由买家 AI 生成）',
    params: {
      openid: { type: 'string', required: true, description: '持有者 OpenID' },
      intel_id: { type: 'string', required: true, description: '情报 ID' },
      story: { type: 'string', required: true, description: '故事内容（≤500字）' }
    }
  }
}

const ITEM_NAMES = {
  silk: '丝绸', tea: '茶叶', porcelain: '瓷器', spice: '香料', pearl: '珍珠',
  perfume: '香水', gem: '宝石', ivory: '象牙', cotton: '棉花', coffee: '咖啡', pepper: '胡椒'
}

const CITY_NAMES = {
  canton: '广州', calicut: '卡利卡特', zanzibar: '桑给巴尔', alexandria: '亚历山大',
  venice: '威尼斯', lisbon: '里斯本', london: '伦敦', amsterdam: '阿姆斯特丹',
  istanbul: '伊斯坦布尔', genoa: '热那亚'
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function getItemPrice(item, cityId) {
  let price = BASE_PRICES[item] || 300
  const city = CITIES[cityId]
  if (city && city.specialty && city.specialty.includes(item)) {
    price = Math.round(price * 0.8)
  }
  return price
}

// ── 供需价格波动引擎 ──
const MAX_PRICE_SWING = 0.30   // 价格最大偏离 ±30%
const FLOW_DEPTH_BASE = 50      // 市场深度基数
const DECAY_RATE = 0.99         // 每小时衰减率（约 3 天回归原点）
const DECAY_INTERVAL_MS = 60 * 60 * 1000  // 衰减间隔 1 小时

// 轻量 tanh 近似（避免 Math.tanh 依赖）
function tanh(x) {
  if (x > 5) return 1
  if (x < -5) return -1
  const e2 = Math.exp(2 * x)
  return (e2 - 1) / (e2 + 1)
}

class LobsterL1Service {
  constructor() {
    this.oceanbus = new OceanBusClient(OCEANBUS_BASE_URL)
    this.myOpenid = null
    this.myAgentId = null
    this.running = false
    this.lastSeq = this._loadLastSeq()
    this.players = {}
    this.contracts = {}
    this.marketFlow = {}        // { 'canton:silk': 0, ... } 供需净流量
    this.intels = {}            // { intelId: IntelObject } 酒馆情报
    this.senderPlayers = {}     // { fromOpenid: gameOpenid } 发送者→玩家映射，防止重复入驻
    this.lastDecayTime = Date.now()
  }

  async start() {
    console.log('[L1] 正在连接 OceanBus...')
    console.log('[L1] Agent Name:', L1_AGENT_NAME)

    try {
      let config = null
      if (fs.existsSync(L1_CONFIG_FILE)) {
        try {
          config = JSON.parse(fs.readFileSync(L1_CONFIG_FILE, 'utf8'))
          // 兼容旧字段名 agentCode → agentId
          if (!config.agentId && config.agentCode) {
            config.agentId = config.agentCode
          }
          console.log('[L1] 找到已有配置, agentId:', config.agentId, ', 有apiKey:', !!config.apiKey, ', 有openid:', !!config.openid)
        } catch (e) {
          console.log('[L1] 配置文件损坏，将重新注册')
        }
      }

      const hasFullConfig = config && config.agentId && config.openid && config.apiKey

      if (hasFullConfig) {
        this.oceanbus.restoreFromConfig(config.agentId, config.openid, config.apiKey)
        this.myAgentId = config.agentId

        // 先验证 apiKey 是否仍然有效
        const isValid = await this.oceanbus.validateApiKey()
        if (!isValid) {
          console.log('[L1] 已有 apiKey 失效(401/403)，需要重新注册')
          config.apiKey = null
        } else {
          // 使用已持久化的 OpenID（不刷新，避免 Skill 端 PUBLIC_L1_OPENID 漂移）
          this.myOpenid = config.openid
          console.log('[L1] 恢复已有身份, OpenID:', this.myOpenid)
        }
      }

      // apiKey 缺失或失效 → 重新注册
      if (!config || !config.agentId || !config.apiKey) {
        if (config && config.agentId && !config.apiKey) {
          console.log('[L1] 配置缺少 apiKey（v2 中 apiKey 无法通过 API 恢复），执行重新注册...')
        } else {
          console.log('[L1] 未找到有效配置，注册新服务...')
        }

        const oldOpenid = config?.openid
        const regResult = await this.oceanbus.register()
        if (regResult.code !== 0) {
          throw new Error('OceanBus 注册失败: ' + JSON.stringify(regResult))
        }
        this.myAgentId = this.oceanbus.agentId
        this.myOpenid = this.oceanbus.openid

        if (!this.myOpenid) {
          throw new Error('注册后 openid 为空')
        }

        config = {
          agentId: this.myAgentId,
          openid: this.myOpenid,
          apiKey: this.oceanbus.apiKey
        }
        const configDir = path.dirname(L1_CONFIG_FILE)
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true })
        }
        fs.writeFileSync(L1_CONFIG_FILE, JSON.stringify(config, null, 2))
        console.log('[L1] 配置已保存到:', L1_CONFIG_FILE)

        if (oldOpenid && oldOpenid !== this.myOpenid) {
          console.log('[L1] ⚠️ OpenID 已变更！旧:', oldOpenid)
          console.log('[L1] ⚠️ 请立即更新 Skill 端的 L1_OPENID:')
        }
        console.log('L1_OPENID=' + this.myOpenid)
      }

      if (!this.oceanbus.isReady()) {
        throw new Error('OceanBus 身份不完整: ' + JSON.stringify(this.oceanbus.getStatus()))
      }

      this.running = true
      this.pollMessages()

      console.log('[L1] 服务启动成功, OpenID:', this.myOpenid)
      return { success: true, openid: this.myOpenid, agentId: this.myAgentId }
    } catch (err) {
      console.error('[L1] 连接失败:', err.message)
      return { success: false, error: err.message }
    }
  }

  async pollMessages() {
    while (this.running) {
      try {
        const result = await this.oceanbus.syncMessages(this.lastSeq)
        if (result.code === 0 && result.data && result.data.messages && result.data.messages.length > 0) {
          for (const msg of result.data.messages) {
            await this.handleMessage(msg)
            const msgSeq = (typeof msg.seq_id === 'number' && msg.seq_id > 0) ? msg.seq_id : this.lastSeq
            this.lastSeq = Math.max(this.lastSeq, msgSeq + 1)
          }
          // 每处理完一批就持久化 lastSeq（防止重启后重放）
          this._saveLastSeq()
        } else if (result.code === 0 && result.data) {
          const serverSeq = result.data.last_seq || result.data.lastSeq || 0
          if (serverSeq > this.lastSeq) {
            this.lastSeq = serverSeq
            this._saveLastSeq()
          }
        }
      } catch (err) {
        console.error('[L1] 拉取消息失败:', err.message)
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL))
    }
  }

  _saveLastSeq() {
    try {
      const seqFile = path.join(path.dirname(L1_CONFIG_FILE), 'l1-last-seq.json')
      fs.writeFileSync(seqFile, JSON.stringify({ lastSeq: this.lastSeq, updatedAt: Date.now() }))
    } catch (e) {
      console.error('[L1] 保存 lastSeq 失败:', e.message)
    }
  }

  _loadLastSeq() {
    try {
      const seqFile = path.join(path.dirname(L1_CONFIG_FILE), 'l1-last-seq.json')
      if (fs.existsSync(seqFile)) {
        const data = JSON.parse(fs.readFileSync(seqFile, 'utf8'))
        const seq = data.lastSeq || 0
        if (seq > 0) console.log('[L1] 恢复 lastSeq:', seq)
        return seq
      }
    } catch (e) {
      console.error('[L1] 加载 lastSeq 失败:', e.message)
    }
    return 0
  }

  async handleMessage(msg) {
    const preview = (msg.content || '').substring(0, 80)
    console.log('[L1] 收到消息 from', msg.from_openid, ':', preview)

    try {
      const payload = JSON.parse(msg.content)
      const { action: routeAction, request_id, ...params } = payload

      // enroll 请求记录完整参数（用于调试密钥格式问题）
      if (routeAction === 'enroll') {
        const pk = params.publicKey || '(未提供)'
        console.log('[L1] enroll 详情: openid=%s, publicKey长度=%d, publicKey前40=%s, initialGold=%d',
          (params.openid || '').substring(0, 20), pk.length, pk.substring(0, 40), params.initialGold)
      }

      let result
      try {
        result = this.processAction(routeAction, params, msg.from_openid)
      } catch (e) {
        result = { code: 500, msg: e.message }
      }

      const response = {
        code: result.code === undefined ? 0 : result.code,
        request_id,
        data: result.data || result
      }

      const responseStr = JSON.stringify(response)
      const sendResult = await this.oceanbus.sendMessage(msg.from_openid, responseStr)
      if (sendResult.code === 0) {
        console.log('[L1] 响应已发送, action:', routeAction, ', to:', (msg.from_openid || '').substring(0, 16))
      } else {
        console.error('[L1] 响应发送失败! action:', routeAction, ', code:', sendResult.code, ', msg:', sendResult.msg, ', httpStatus:', sendResult.httpStatus, ', to:', (msg.from_openid || '').substring(0, 16), ', respSize:', responseStr.length)
      }
    } catch (err) {
      console.error('[L1] 处理消息失败:', err.message)
      try {
        await this.oceanbus.sendMessage(msg.from_openid, JSON.stringify({
          code: 500,
          request_id: null,
          data: { msg: '消息处理失败: ' + err.message }
        }))
      } catch (e) {}
    }
  }

  // ── 供需引擎 ──
  _flowKey(cityId, item) { return `${cityId}:${item}` }

  _addFlow(cityId, item, amount) {
    const key = this._flowKey(cityId, item)
    this.marketFlow[key] = (this.marketFlow[key] || 0) + amount
  }

  _decayMarkets() {
    const now = Date.now()
    if (now - this.lastDecayTime < DECAY_INTERVAL_MS) return
    const hours = Math.floor((now - this.lastDecayTime) / DECAY_INTERVAL_MS)
    const factor = Math.pow(DECAY_RATE, hours)
    for (const key of Object.keys(this.marketFlow)) {
      this.marketFlow[key] = Math.round(this.marketFlow[key] * factor)
      if (Math.abs(this.marketFlow[key]) < 1) delete this.marketFlow[key]
    }
    this.lastDecayTime = now
  }

  _getDynamicPrice(item, cityId) {
    const base = getItemPrice(item, cityId)
    const key = this._flowKey(cityId, item)
    const flow = this.marketFlow[key] || 0
    const activePlayers = Math.max(1, Object.keys(this.players).length)
    const depth = Math.max(1, Math.round(Math.sqrt(activePlayers))) * FLOW_DEPTH_BASE
    const offset = tanh(flow / depth)
    const marketBuy = Math.round(base * (1 + AMM_SPREAD / 2))
    const marketSell = Math.round(base * (1 - AMM_SPREAD / 2))
    const finalBuy = Math.round(marketBuy * (1 + offset * MAX_PRICE_SWING))
    const finalSell = Math.round(marketSell * (1 + offset * MAX_PRICE_SWING))
    let trend = 'stable'
    if (offset > 0.05) trend = 'up'
    else if (offset < -0.05) trend = 'down'
    return { market: base, buy: finalBuy, sell: finalSell, trend }
  }

  processAction(action, params, fromOpenid) {
    switch (action) {
      case 'ping':
        return { status: 'ok', timestamp: Date.now(), service: 'lobster-l1', agentId: this.myAgentId, openid: this.myOpenid }
      case 'enroll':
        return this.handleEnroll(params, fromOpenid)
      case 'get_city':
        return this.handleGetCity(params)
      case 'move':
        return this.handleMove(params)
      case 'arrive':
        return this.handleArrive(params)
      case 'trade_npc':
        return this.handleTradeNpc(params)
      case 'intent':
        return this.handleIntent(params)
      case 'create_contract':
        return this.handleCreateContract(params)
      case 'cancel_contract':
        return this.handleCancelContract(params)
      case 'list_contracts':
        return this.handleListContracts(params)
      case 'status':
        return this.handleStatus(params)
      case 'lookup':
        return { agentId: this.myAgentId, openid: this.myOpenid }
      case 'capabilities':
        return this.handleCapabilities(params)
      case 'rename':
        return this.handleRename(params)
      case 'tavern_buy':
        return this.handleTavernBuy(params)
      case 'intel_list':
        return this.handleIntelList(params)
      case 'intel_transfer':
        return this.handleIntelTransfer(params)
      case 'intel_story':
        return this.handleIntelStory(params)
      default:
        return { code: 404, msg: 'Unknown action: ' + action }
    }
  }

  handleEnroll(params, fromOpenid) {
    const openid = params.openid || fromOpenid
    const { publicKey, captainName } = params
    const initialGold = 20000  // 固定初始金币，不接受客户端传值（防作弊）
    if (!openid) return { code: 1, msg: '缺少 openid' }

    // 已入驻：更新发送者映射，返回已有船长（不新建）
    if (this.players[openid]) {
      this.senderPlayers[fromOpenid] = openid
      if (captainName) this.players[openid].name = captainName
      if (!this.players[openid].captainToken) {
        this.players[openid].captainToken = require('crypto').randomBytes(16).toString('hex')
      }
      console.log('[L1] 船长归港:', openid.substring(0, 12), '→', this.players[openid].name)
      return { doc: this.players[openid], captainToken: this.players[openid].captainToken }
    }

    // 同一个 OceanBus 发送者已有船长 → 拒绝新建，返回已有船长
    if (fromOpenid && this.senderPlayers[fromOpenid]) {
      const existingOpenid = this.senderPlayers[fromOpenid]
      const existingPlayer = this.players[existingOpenid]
      if (existingPlayer) {
        console.log('[L1] 拒绝新建船长: 发送者已有船长', existingOpenid.substring(0, 12), '→', existingPlayer.name)
        if (!existingPlayer.captainToken) {
          existingPlayer.captainToken = require('crypto').randomBytes(16).toString('hex')
        }
        return { doc: existingPlayer, captainToken: existingPlayer.captainToken }
      }
    }

    // 随机出生城市
    const cityIds = Object.keys(CITIES)
    const birthCity = cityIds[Math.floor(Math.random() * cityIds.length)]
    const birthCityDef = CITIES[birthCity]

    // 祖传库存：送 5 箱当地特产
    const starterCargo = {}
    if (birthCityDef.specialty && birthCityDef.specialty.length > 0) {
      const gift = birthCityDef.specialty[Math.floor(Math.random() * birthCityDef.specialty.length)]
      starterCargo[gift] = 5
    }

    // 生成船长令牌（用于后续操作鉴权）
    const captainToken = require('crypto').randomBytes(16).toString('hex')

    const player = {
      id: util.createId(),
      openid,
      name: captainName || '无名船长',
      publicKey: publicKey || '',
      gold: initialGold,
      cargo: starterCargo,
      currentCity: birthCity,
      targetCity: null,
      status: 'docked',
      intent: '',
      shipCapacity: SHIP_CAPACITY,
      captainToken
    }
    this.players[openid] = player
    this.senderPlayers[fromOpenid] = openid
    console.log('[L1] 新玩家入驻:', openid.substring(0, 12), ', 金币:', initialGold, ', 出生港:', birthCity)
    return { doc: player, captainToken }
  }

  // ── 鉴权工具 ──
  _auth(params) {
    const player = this.players[params.openid]
    if (!player) return { code: 4, msg: `玩家不存在 (openid=${(params.openid||'').substring(0,16)})` }
    if (!params.captain_token || params.captain_token !== player.captainToken) {
      console.error('[L1] _auth 失败! sent=' + (params.captain_token||'NONE').substring(0,12) + '... stored=' + (player.captainToken||'NONE').substring(0,12) + '... match=' + (params.captain_token === player.captainToken))
      return { code: 401, msg: '鉴权失败：船长令牌不匹配' }
    }
    return player
  }

  handleStatus(params) {
    const player = this._auth(params)
    if (player.code) return player
    return { player }
  }

  handleRename(params) {
    const player = this._auth(params)
    if (player.code) return player
    const { name } = params
    if (!name) return { code: 1, msg: '缺少新船名' }
    const trimmed = name.substring(0, 20)
    player.name = trimmed
    console.log('[L1] 船长改名:', player.openid, '→', trimmed)
    return { name: trimmed }
  }

  // ── 酒馆情报 ──

  handleTavernBuy(params) {
    const player = this._auth(params)
    if (player.code) return player
    if (player.status !== 'docked') return { code: 1, msg: '航行中无法进入酒馆——酒馆在港口陆地上，不是船上' }

    const myIntels = Object.values(this.intels).filter(
      i => i.holder === player.openid && i.status === 'active'
    )
    if (myIntels.length >= INTEL_HOLD_LIMIT) {
      return { code: 1, msg: `情报槽已满（最多${INTEL_HOLD_LIMIT}份），请先完成或转让已有情报` }
    }

    const cost = INTEL_COST_MIN + Math.floor(Math.random() * (INTEL_COST_MAX - INTEL_COST_MIN + 1))
    if (player.gold < cost) {
      return { code: 1, msg: `金币不足——酒馆老板要价${cost}金币，你只有${player.gold}` }
    }

    player.gold -= cost

    const type = INTEL_TYPES[Math.floor(Math.random() * INTEL_TYPES.length)]
    const candidateCities = Object.keys(CITIES).filter(c => c !== player.currentCity)
    const toCity = candidateCities[Math.floor(Math.random() * candidateCities.length)]

    // 不同类型不同报酬区间
    let reward
    switch (type) {
      case 'passenger':
        reward = 3500 + Math.floor(Math.random() * 2001)  // 3500-5500 乘客溢价
        break
      case 'discount':
        reward = 1500 + Math.floor(Math.random() * 1001)  // 1500-2500 但附赠货物
        break
      default: // cargo
        reward = INTEL_REWARD_MIN + Math.floor(Math.random() * (INTEL_REWARD_MAX - INTEL_REWARD_MIN + 1))
        break
    }

    const intel = {
      id: util.createId(),
      type,
      from_city: player.currentCity,
      to_city: toCity,
      reward,
      cost,
      deadline: Date.now() + INTEL_DEADLINE_MS,
      holder: player.openid,
      story: '',
      status: 'active',
      createdAt: Date.now(),
      completedAt: null
    }

    this.intels[intel.id] = intel
    console.log('[L1] 酒馆情报:', player.openid.substring(0, 12), '在', player.currentCity, '买了', type, '→', toCity, '费用', cost, '报酬', reward)
    return { intel, playerGold: player.gold }
  }

  handleIntelList(params) {
    const player = this._auth(params)
    if (player.code) return player
    this._expireIntels()
    const myIntels = Object.values(this.intels).filter(i => i.holder === player.openid)
    return { intels: myIntels }
  }

  handleIntelTransfer(params) {
    const player = this._auth(params)
    if (player.code) return player

    const { intel_id, target_openid } = params
    if (!intel_id || !target_openid) return { code: 1, msg: '缺少 intel_id 或 target_openid' }

    const intel = this.intels[intel_id]
    if (!intel) return { code: 4, msg: '情报不存在' }
    if (intel.holder !== player.openid) return { code: 1, msg: '情报不属于你' }
    if (intel.status !== 'active') return { code: 1, msg: '情报已终态，无法转让' }

    const target = this.players[target_openid]
    if (!target) return { code: 4, msg: '目标船长不存在' }

    const targetIntels = Object.values(this.intels).filter(
      i => i.holder === target_openid && i.status === 'active'
    )
    if (targetIntels.length >= INTEL_HOLD_LIMIT) {
      return { code: 1, msg: '对方的情报槽已满' }
    }

    intel.story = ''
    intel.holder = target_openid

    console.log('[L1] 情报转让:', intel_id, '从', player.openid.substring(0, 12), '到', target_openid.substring(0, 12))
    return { intel }
  }

  handleIntelStory(params) {
    const player = this._auth(params)
    if (player.code) return player

    const { intel_id, story } = params
    if (!intel_id || !story) return { code: 1, msg: '缺少 intel_id 或 story' }

    const intel = this.intels[intel_id]
    if (!intel) return { code: 4, msg: '情报不存在' }
    if (intel.holder !== player.openid) return { code: 1, msg: '情报不属于你' }
    if (intel.status !== 'active') return { code: 1, msg: '情报已终态，无法修改' }

    intel.story = (story || '').substring(0, 500)
    return { intel_id, story_len: intel.story.length }
  }

  handleGetCity(params) {
    const cityId = params.city_id || 'canton'
    const cityDef = CITIES[cityId]
    if (!cityDef) return { code: 4, msg: '城市不存在' }

    // 衰减
    this._decayMarkets()
    this._expireIntels()
    const prices = {}
    for (const item of Object.keys(BASE_PRICES)) {
      prices[item] = this._getDynamicPrice(item, cityId)
    }

    const players = Object.values(this.players).filter(p => p.currentCity === cityId && p.status === 'docked')

    const playerContracts = Object.values(this.contracts).filter(
      c => (c.delivery_city === cityId) && c.status !== 'completed' && c.status !== 'cancelled'
    )

    return {
      city: { ...cityDef, prices },
      players: players.map(p => ({ openid: p.openid, name: p.name || '某船长', intent: p.intent, cargo: Object.fromEntries(
        Object.entries(p.cargo).filter(([, v]) => v > 0)
      )})),
      contracts: playerContracts
    }
  }

  handleMove(params) {
    const player = this._auth(params)
    if (player.code) return player
    const { target_city } = params
    if (player.status === 'sailing') {
      if (player.targetCity === target_city) {
        // 幂等：已经在驶向该城市
        const remaining = player.sailingUntil ? Math.max(0, Math.ceil((player.sailingUntil - Date.now()) / 60000)) : 0
        return {
          status: 'sailing',
          targetCity: target_city,
          sailingTime: remaining,
          note: 'already_sailing_to_same_city'
        }
      }
      return { code: 1, msg: `航行中不能改变目的地（当前驶向 ${player.targetCity}）` }
    }
    if (!CITIES[target_city]) return { code: 4, msg: '目标城市不存在' }
    if (target_city === player.currentCity) return { code: 1, msg: '已在目标城市' }

    const from = CITIES[player.currentCity]
    const to = CITIES[target_city]
    const distKm = haversineKm(from.lat, from.lng, to.lat, to.lng)
    // 公式: 500km = 1 分钟；SAILING_MULTIPLIER 加速航行（测试用）
    const rawMinutes = Math.max(1, Math.round(distKm / 500))
    const effectiveMs = Math.round(rawMinutes * 60 * 1000 / SAILING_MULTIPLIER)
    const displayTime = effectiveMs >= 60000 ? `${Math.round(effectiveMs / 60000)}分钟` : `${Math.round(effectiveMs / 1000)}秒`

    player.status = 'sailing'
    player.targetCity = target_city
    player.sailingUntil = Date.now() + effectiveMs

    console.log('[L1] 玩家', player.openid, '启航前往', target_city, ', 航程', displayTime)
    return {
      status: 'sailing',
      targetCity: target_city,
      distance: Math.round(distKm),
      sailingTime: rawMinutes,
      sailingSeconds: Math.round(effectiveMs / 1000)
    }
  }

  handleArrive(params) {
    const player = this._auth(params)
    if (player.code) return player

    // 幂等：已停靠则直接返回当前状态
    if (player.status === 'docked') {
      console.log('[L1] 玩家', player.openid, '已在', player.currentCity, '，arrive 幂等返回')
      return {
        status: 'docked',
        city: player.currentCity,
        gold: player.gold,
        cargo: Object.fromEntries(Object.entries(player.cargo).filter(([, v]) => v > 0)),
        settleResults: [],
        note: 'already_docked'
      }
    }

    // 检查航行时间是否已到
    if (player.sailingUntil && Date.now() < player.sailingUntil) {
      const remainingMs = player.sailingUntil - Date.now()
      const remaining = remainingMs >= 60000
        ? `${Math.ceil(remainingMs / 60000)} 分钟`
        : `${Math.ceil(remainingMs / 1000)} 秒`
      return { code: 1, msg: `航行中，还需约 ${remaining} 抵达 ${player.targetCity}` }
    }

    player.status = 'docked'
    player.currentCity = player.targetCity
    player.targetCity = null
    player.sailingUntil = null

    const intelResults = this.settleIntels(player)
    const settleResults = this.settleContracts(player)

    console.log('[L1] 玩家', player.openid, '抵达', player.currentCity, ', 情报:', intelResults.length, '笔, 交割:', settleResults.length, '笔')
    return {
      status: 'docked',
      city: player.currentCity,
      gold: player.gold,
      cargo: Object.fromEntries(Object.entries(player.cargo).filter(([, v]) => v > 0)),
      settleResults,
      intelResults
    }
  }

  handleTradeNpc(params) {
    const player = this._auth(params)
    if (player.code) return player
    const { item, amount, trade_action } = params
    if (!trade_action) return { code: 1, msg: '缺少 trade_action (buy/sell)' }
    const action = trade_action
    console.log('[L1] handleTradeNpc params:', JSON.stringify({ openid: player.openid?.substring(0,20), item, amount, trade_action }))
    if (player.status !== 'docked') return { code: 1, msg: '航行中不能交易' }
    if (!amount || amount <= 0) return { code: 1, msg: '数量必须大于0' }

    const prices = this._getDynamicPrice(item, player.currentCity)
    const unitPrice = action === 'buy' ? prices.buy : prices.sell
    const totalCost = unitPrice * amount

    if (action === 'buy') {
      const currentCargo = Object.values(player.cargo).reduce((s, v) => s + v, 0)
      if (currentCargo + amount > player.shipCapacity) {
        return { code: 1, msg: `货舱不足（已有 ${currentCargo}/${player.shipCapacity}，需要 ${amount} 空间）`, currentCargo, capacity: player.shipCapacity, needed: amount }
      }
      if (player.gold < totalCost) return { code: 1, msg: `金币不足（需要 ${totalCost}，当前 ${player.gold}，差 ${totalCost - player.gold}）`, required: totalCost, available: player.gold, unitPrice, amount }
      player.gold -= totalCost
      player.cargo[item] = (player.cargo[item] || 0) + amount
    } else {
      if ((player.cargo[item] || 0) < amount) return { code: 1, msg: `货物不足（${item} 仅有 ${player.cargo[item] || 0}，需要 ${amount}）`, available: player.cargo[item] || 0, needed: amount }
      player.gold += totalCost
      player.cargo[item] -= amount
      if (player.cargo[item] <= 0) delete player.cargo[item]
    }

    // 记录供需流量（买=需求+ 卖=供给-）
    const flowDelta = action === 'buy' ? amount : -amount
    this._addFlow(player.currentCity, item, flowDelta)

    console.log('[L1] NPC交易:', player.openid, action, amount, item, '@', unitPrice, '总价:', totalCost, '趋势:', prices.trend)
    return {
      item,
      amount,
      unitPrice,
      totalCost,
      playerGold: player.gold,
      cargo: Object.fromEntries(Object.entries(player.cargo).filter(([, v]) => v > 0))
    }
  }

  handleIntent(params) {
    const player = this._auth(params)
    if (player.code) return player
    const { intent } = params
    player.intent = (intent || '').substring(0, 140)
    console.log('[L1] 玩家', player.openid, '挂牌:', player.intent.substring(0, 30))
    return { intent: player.intent }
  }

  handleCreateContract(params) {
    const { buyer_openid, seller_openid, item, amount, price, delivery_city, buyer_signature } = params
    // 鉴权：创建者必须是买方
    const creator = this._auth({ ...params, openid: buyer_openid })
    if (creator.code) return { code: 401, msg: '买方鉴权失败' }
    const buyer = creator
    const seller = this.players[seller_openid]
    if (!seller) return { code: 4, msg: '卖方不存在' }
    if (!CITIES[delivery_city]) return { code: 4, msg: '交割城市不存在' }
    if ((seller.cargo[item] || 0) < amount) return { code: 1, msg: '卖方货物不足', available: seller.cargo[item] || 0 }

    seller.cargo[item] -= amount
    if (seller.cargo[item] <= 0) delete seller.cargo[item]

    const contract = {
      id: util.createId(),
      buyer_openid,
      seller_openid,
      item,
      amount,
      price,
      total_price: price * amount,
      delivery_city,
      buyer_signature: buyer_signature || null,
      status: 'pending',
      createdAt: Date.now()
    }
    this.contracts[contract.id] = contract

    console.log('[L1] 合约创建:', contract.id, item, amount, '@', price)
    return { contract }
  }

  handleCancelContract(params) {
    const player = this._auth(params)
    if (player.code) return player
    const { contract_id } = params
    const contract = this.contracts[contract_id]
    if (!contract) return { code: 4, msg: '合约不存在' }
    if (contract.buyer_openid !== player.openid && contract.seller_openid !== player.openid) {
      return { code: 1, msg: '非合约参与方' }
    }
    if (contract.status === 'completed' || contract.status === 'cancelled') {
      return { code: 1, msg: '合约已终态' }
    }

    const seller = this.players[contract.seller_openid]
    if (seller) {
      seller.cargo[contract.item] = (seller.cargo[contract.item] || 0) + contract.amount
    }

    contract.status = 'cancelled'
    console.log('[L1] 合约取消:', contract_id)
    return { contract_id, status: 'cancelled' }
  }

  handleListContracts(params) {
    const player = this._auth(params)
    if (player.code) return player
    const { status } = params
    let contracts = Object.values(this.contracts).filter(c => c.buyer_openid === player.openid || c.seller_openid === player.openid)
    if (status) {
      contracts = contracts.filter(c => c.status === status)
    }
    return { contracts }
  }

  handleCapabilities(params) {
    // 精简版：只返回 action 名 + 参数键列表，避免超出 OceanBus 消息大小限制
    const compact = {}
    for (const [name, def] of Object.entries(CAPABILITIES)) {
      const pnames = Object.keys(def.params)
      compact[name] = pnames.length > 0 ? pnames : null
    }
    return {
      actions: compact,
      cities: Object.keys(CITIES).map(id => ({ id, name: CITY_NAMES[id] })),
      items: Object.keys(BASE_PRICES).map(id => ({ id, name: ITEM_NAMES[id] })),
      constants: { spread: AMM_SPREAD, capacity: SHIP_CAPACITY, settleHours: SETTLE_HOURS },
      sailingFormula: 'max(1, round(distKm / 500 / multiplier)) minutes (set L1_SAILING_MULTIPLIER env)'
    }
  }

  settleContracts(player) {
    const results = []
    const cityContracts = Object.values(this.contracts).filter(
      c => c.delivery_city === player.currentCity &&
        (c.buyer_openid === player.openid || c.seller_openid === player.openid) &&
        c.status !== 'completed' && c.status !== 'cancelled'
    )

    for (const contract of cityContracts) {
      const buyer = this.players[contract.buyer_openid]
      const seller = this.players[contract.seller_openid]

      if (!buyer || !seller) continue

      const buyerPresent = buyer.currentCity === contract.delivery_city && buyer.status === 'docked'
      const sellerPresent = seller.currentCity === contract.delivery_city && seller.status === 'docked'

      if (contract.status === 'pending' && sellerPresent) {
        contract.status = 'seller_arrived'
        contract.sellerArrivedAt = Date.now()
      }

      if (contract.status === 'seller_arrived' && buyerPresent) {
        if (buyer.gold >= contract.total_price) {
          buyer.gold -= contract.total_price
          seller.gold += contract.total_price
          buyer.cargo[contract.item] = (buyer.cargo[contract.item] || 0) + contract.amount
          contract.status = 'completed'
          contract.completedAt = Date.now()
          results.push({ contractId: contract.id, status: 'completed', item: contract.item, amount: contract.amount })
        } else {
          contract.status = 'failed'
          seller.cargo[contract.item] = (seller.cargo[contract.item] || 0) + contract.amount
          results.push({ contractId: contract.id, status: 'failed', reason: 'buyer_insufficient_funds' })
        }
      }
    }

    return results
  }

  settleIntels(player) {
    const results = []
    const completableIntels = Object.values(this.intels).filter(
      i => i.holder === player.openid &&
          i.to_city === player.currentCity &&
          i.status === 'active'
    )

    for (const intel of completableIntels) {
      if (Date.now() > intel.deadline) {
        intel.status = 'expired'
        results.push({ intelId: intel.id, status: 'expired', reason: 'deadline_passed' })
        continue
      }
      if (intel.type === 'discount') {
        // 折扣情报：金币报酬较低但附赠当地特产
        player.gold += intel.reward
        const cityDef = CITIES[intel.to_city]
        const giftItem = cityDef?.specialty?.[Math.floor(Math.random() * cityDef.specialty.length)] || 'tea'
        const giftAmount = 2 + Math.floor(Math.random() * 4)  // 2-5 单位
        player.cargo[giftItem] = (player.cargo[giftItem] || 0) + giftAmount
        intel.status = 'completed'
        intel.completedAt = Date.now()
        results.push({ intelId: intel.id, type: 'discount', reward: intel.reward, giftItem, giftAmount, status: 'completed' })
        console.log('[L1] 情报完成(折扣):', intel.id, '金币:', intel.reward, '赠品:', giftItem, 'x' + giftAmount)
      } else {
        player.gold += intel.reward
        intel.status = 'completed'
        intel.completedAt = Date.now()
        results.push({ intelId: intel.id, type: intel.type, reward: intel.reward, status: 'completed' })
        console.log('[L1] 情报完成:', intel.id, '类型:', intel.type, '报酬:', intel.reward, '玩家:', player.openid.substring(0, 12))
      }
    }

    return results
  }

  _expireIntels() {
    const now = Date.now()
    for (const intel of Object.values(this.intels)) {
      if (intel.status === 'active' && intel.deadline && now > intel.deadline) {
        intel.status = 'expired'
        console.log('[L1] 情报过期:', intel.id, '持有者:', intel.holder.substring(0, 12))
      }
    }
  }

  stop() {
    this.running = false
    console.log('[L1] 服务已停止')
  }
}

module.exports = LobsterL1Service
