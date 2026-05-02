/**
 * @file index.js
 * @description 龙虾船长 Skill 入口
 *
 * 支持两种运行模式：
 * 1. 手动指令 — 用户主动触发操作（start/status/buy/sell/move 等）
 * 2. 自主 Re-Act — OpenClaw cron 每 30 分钟自动调用 react 循环
 *
 * L1_OPENID 必须通过环境变量设置，禁止硬编码。
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const KeyStore = require('./keystore')
const CaptainJournal = require('./journal')
const OceanBusClient = require('./oceanbus')
const { StateStore } = require('./state-store')
const { ReactEngine, CITY_LIST, CITY_NAMES, ITEM_NAMES, COMEDY_HOOKS } = require('./react-engine')

const OCEANBUS_URL = process.env.OCEANBUS_URL || 'https://ai-t.ihaola.com.cn/api/l0'

// 公共 L1 Game Server（开箱即用；可通过 L1_PUBLIC_OPENID 环境变量覆盖）
const PUBLIC_L1_OPENID = process.env.L1_PUBLIC_OPENID || 'lXK-OYmYsdiXDhp6kvS8DsTplhiE8DlEGSpX1b9yUF_xlsTvnAlrjJ_bhp0TqQZHaE3mB8lQLgbsrgV9'

const ENV_L1_NODES = []

// 从环境变量构建节点列表：支持逗号分隔的多个 openid
if (process.env.L1_OPENID) {
  for (const id of process.env.L1_OPENID.split(',').map(s => s.trim()).filter(Boolean)) {
    ENV_L1_NODES.push({ openid: id, name: 'env:L1_OPENID' })
  }
}

class CaptainLobster {
  constructor(config = {}) {
    this.config = {
      oceanBusUrl: config.oceanbus_url || OCEANBUS_URL,
      l1Openid: config.l1_openid || '',
      l1Nodes: config.l1_nodes || [],
      initialGold: config.initial_gold || 20000,
      keyIdentity: config.key_identity || 'default',
      userName: config.user_name || config.userName || process.env.USER || process.env.USERNAME || '东家'
    }

    this.oceanBus = new OceanBusClient(this.config.oceanBusUrl)
    this.keyStore = new KeyStore()
    this.stateStore = new StateStore()
    this.journal = null

    this.state = {
      initialized: false,
      l1Openid: null,
      captainName: null,
      captainPersonality: null,
      ownerName: null,
      keyPair: null,
      playerId: null,
      openid: null,
      gold: 0,
      cargo: {},
      currentCity: 'canton',
      targetCity: null,
      status: 'docked',
      sailingTime: 0,
      lastMoveTime: 0,
      intent: '',
      previousGold: 0,
      captainToken: null,
      addressBook: {},
      keyIdentity: this.config.keyIdentity,
      reactCycleCount: 0,
      lastReportTime: null,
      totalTrades: 0,
      totalProfit: 0,
      intels: []
    }

    this.reactEngine = new ReactEngine(this)

    // 尝试从磁盘恢复状态（跨调用持久化）
    this.tryRestore()
  }

  // ─── 跨调用状态恢复 ─────────────────────────────

  tryRestore() {
    // OceanBus 身份由 SDK 自动从 ~/.oceanbus/ 恢复（懒加载，首次异步操作触发）

    // 恢复游戏状态
    const saved = this.stateStore.load()
    if (saved && saved.initialized) {
      this.state.initialized = true
      this.state.l1Openid = saved.l1Openid || null
      if (saved.l1Openid) this.config.l1Openid = saved.l1Openid
      this.state.captainName = saved.captainName
      this.state.captainPersonality = saved.captainPersonality
      this.state.ownerName = saved.ownerName
      this.state.playerId = saved.playerId
      this.state.openid = saved.openid
      this.state.gold = saved.gold
      this.state.cargo = saved.cargo
      this.state.currentCity = saved.currentCity
      this.state.targetCity = saved.targetCity
      this.state.status = saved.status
      this.state.sailingTime = saved.sailingTime || 0
      this.state.lastMoveTime = saved.lastMoveTime || 0
      this.state.intent = saved.intent
      this.state.previousGold = saved.previousGold || saved.gold
      this.state.captainToken = saved.captainToken || null
      this.state.addressBook = saved.addressBook || {}
      this.state.keyIdentity = saved.keyIdentity || this.config.keyIdentity
      this.state.reactCycleCount = saved.reactCycleCount || 0
      this.state.lastReportTime = saved.lastReportTime
      this.state.totalTrades = saved.totalTrades || 0
      this.state.totalProfit = saved.totalProfit || 0
      this.state.intels = saved.intels || []

      this.journal = new CaptainJournal(this.state.captainName)
      this.reactEngine.cycleCount = this.state.reactCycleCount
    }
  }

  // ─── 状态持久化 ─────────────────────────────────

  _persistState() {
    this.stateStore.save(this.state)
    // OceanBus 身份由 SDK 内部自动持久化到 ~/.oceanbus/
  }

  // ─── 初始化 ─────────────────────────────────────

  async initialize(password = null) {
    if (this.state.initialized && this.state.captainToken) {
      return { success: true, message: '船长已经觉醒，无需重复初始化' }
    }

    // v1.1 升级：旧状态无 captainToken → 静默重新入驻获取令牌
    if (this.state.initialized && !this.state.captainToken) {
      console.log('[Skill] v1.1 升级：重新入驻以获取 captainToken')
    }

    console.log('🦞 龙虾船长正在觉醒...')

    // —— 密钥管理 ——
    if (!this.keyStore.hasKeyPair(this.config.keyIdentity)) {
      if (!password || password.length < 8) {
        return {
          success: false,
          message: '首次启动需要设置密码（至少 8 个字符）来保护您的私钥',
          requirePassword: true
        }
      }
      console.log('🔐 生成新密钥对并加密存储...')
      this.keyStore.saveKeyPair(this.config.keyIdentity, password)
      this.state.keyPair = this.keyStore.loadKeyPair(this.config.keyIdentity, password)
    } else {
      if (!password) {
        return {
          success: false,
          message: '需要输入密码来解锁您的私钥',
          requirePassword: true,
          hasExistingKey: true
        }
      }
      console.log('🔓 正在解锁密钥...')
      try {
        this.state.keyPair = this.keyStore.loadKeyPair(this.config.keyIdentity, password)
        console.log('✅ 密钥解锁成功')
      } catch (err) {
        return { success: false, message: '密码错误，无法解锁私钥' }
      }
    }

    // —— OceanBus 身份（智能复用，避免频繁重注册）——
    let needReg = !this.oceanBus.isReady()
    if (!needReg) {
      try {
        const valid = await this.oceanBus.validateApiKey()
        if (!valid) { console.log('[Skill] apiKey 已过期，重新注册 OceanBus'); needReg = true }
      } catch (e) { needReg = true }
    }
    if (needReg) {
      // 仅清除 OceanBus 路由身份，保留游戏 openid（长期有效）
      this.oceanBus.apiKey = null
      this.oceanBus.agentId = null
      this.oceanBus.openid = null
      const regResult = await this.oceanBus.register()
      if (regResult.code !== 0) {
        return { success: false, message: `OceanBus 注册失败: ${regResult.msg || '未知错误'}` }
      }
      if (!this.oceanBus.isReady()) {
        return { success: false, message: 'OceanBus 注册异常：未获取完整身份' }
      }
      console.log(`✅ OceanBus 注册成功, AgentId: ${this.oceanBus.agentId}`)
      // SDK 内部自动持久化身份，无需手动保存
    } else {
      console.log('[Skill] 复用已有 OceanBus 身份')
    }

    // —— L1 节点自动发现 ——
    const discoveredL1 = await this.autoDiscoverL1()
    if (!discoveredL1) {
      return {
        success: false,
        message: '未找到可用的 L1 Game Server。请确保 L1 服务已启动，或设置环境变量 L1_OPENID。'
      }
    }
    this.config.l1Openid = discoveredL1
    this.state.l1Openid = discoveredL1
    console.log(`✅ L1 已连接: ${discoveredL1}`)

    // —— 身份生成或恢复 ——
    if (!this.state.captainName) {
      this.generateCaptainIdentity()
    }
    this.journal = new CaptainJournal(this.state.captainName)

    // —— 入驻 L1（使用稳定的游戏 openid，不随 OceanBus 重注册变化）——
    const gameOpenid = this.state.openid || this.oceanBus.openid
    const enrollResult = await this.sendToL1('enroll', {
      openid: gameOpenid,
      agent_id: this.oceanBus.agentId || this.state.playerId,
      publicKey: this.keyStore.stripPemHeader(this.state.keyPair.publicKey),
      initialGold: this.config.initialGold,
      captainName: this.state.captainName
    })

    if (!enrollResult.success) {
      return enrollResult
    }

    this.state.playerId = enrollResult.data.doc?.id || enrollResult.data.playerId
    this.state.openid = enrollResult.data.doc?.openid || this.oceanBus.openid
    this.state.gold = enrollResult.data.doc?.gold || this.config.initialGold
    this.state.captainToken = enrollResult.data.captainToken || enrollResult.data.doc?.captainToken
    console.log('[Skill] 入驻完成, captainToken:', (this.state.captainToken || 'MISSING').substring(0, 12) + '...')
    this.state.previousGold = this.state.gold
    this.state.initialized = true

    this._persistState()
    // 验证持久化
    const verify = this.stateStore.load()
    console.log('[Skill] 持久化验证: token在文件中=' + !!(verify && verify.captainToken))

    const greeting = this.generateGreeting()
    this.journal.addLog('船长觉醒完成', { name: this.state.captainName })

    return {
      success: true,
      message: greeting,
      data: {
        captainName: this.state.captainName,
        playerId: this.state.playerId,
        agentId: this.oceanBus.agentId,
        openid: this.state.openid,
        gold: this.state.gold,
        currentCity: this.state.currentCity
      }
    }
  }

  // ─── L1 节点自动发现 ────────────────────────────

  /**
   * 按优先级探测所有 L1 节点，返回第一个可用的 openid。
   * 优先级：环境变量 L1_OPENID > 本地 l1-agent.json > config.l1_openid > config.l1_nodes[]
   */
  async autoDiscoverL1() {
    const candidates = []

    // 优先级 1：环境变量
    for (const node of ENV_L1_NODES) {
      candidates.push(node)
    }

    // 优先级 2：本地 L1 服务配置文件（开箱即用，无需用户设置）
    const l1AgentFile = path.join(os.homedir(), '.captain-lobster', 'l1-agent.json')
    if (fs.existsSync(l1AgentFile)) {
      try {
        const l1Config = JSON.parse(fs.readFileSync(l1AgentFile, 'utf8'))
        if (l1Config.openid && !candidates.find(c => c.openid === l1Config.openid)) {
          candidates.push({ openid: l1Config.openid, name: 'local:l1-agent' })
        }
      } catch (e) {}
    }

    // 优先级 3：旧版单节点配置
    if (this.config.l1Openid) {
      candidates.push({ openid: this.config.l1Openid, name: 'config:l1_openid' })
    }

    // 优先级 4：新版多节点配置
    if (Array.isArray(this.config.l1Nodes)) {
      for (const node of this.config.l1Nodes) {
        if (node.openid && !candidates.find(c => c.openid === node.openid)) {
          candidates.push({ openid: node.openid, name: node.name || node.openid })
        }
      }
    }

    // 优先级 5：公共 L1 服务器（开箱即用的兜底方案）
    if (!candidates.find(c => c.openid === PUBLIC_L1_OPENID)) {
      candidates.push({ openid: PUBLIC_L1_OPENID, name: 'public:lobster-l1' })
    }

    // 过滤空 openid
    const valid = candidates.filter(c => c.openid)
    if (valid.length === 0) {
      return null
    }

    console.log(`🔍 正在探测 ${valid.length} 个 L1 节点...`)

    for (const node of valid) {
      this.config.l1Openid = node.openid

      try {
        const result = await this.sendToL1('ping', {})
        if (result.success) {
          console.log(`✅ L1 节点可用: ${node.name || node.openid}`)
          // 持久化发现的 L1 OpenID，避免下次重复探测
          this.state.l1Openid = node.openid
          if (this.state.initialized) this._persistState()
          return node.openid
        }
      } catch (e) {}
      console.log(`⏭️  L1 节点不可达: ${node.name || node.openid}`)
    }

    return null
  }

  // ─── L1 状态同步 ──────────────────────────────

  /**
   * 从 L1 拉取真实状态，覆盖本地缓存。
   * L1 是唯一的数据源——本地 state 只是缓存。
   */
  async syncStateFromL1() {
    if (!this.state.initialized) return { success: false, message: '尚未初始化' }

    const result = await this.sendToL1('status', { openid: this.state.openid, _retry: true })
    if (!result.success) {
      console.log('[Skill] L1 状态同步失败:', result.message)
      return result
    }

    const doc = result.data?.doc || result.data?.player || result.data
    if (!doc) return { success: false, message: 'L1 返回数据异常' }

    // 用 L1 数据覆盖本地状态
    if (doc.gold !== undefined) this.state.gold = doc.gold
    if (doc.cargo !== undefined) this.state.cargo = doc.cargo instanceof Map ? Object.fromEntries(doc.cargo) : (doc.cargo || {})
    if (doc.currentCity) this.state.currentCity = doc.currentCity
    if (doc.targetCity !== undefined) this.state.targetCity = doc.targetCity
    if (doc.status) this.state.status = doc.status
    if (doc.intent !== undefined) this.state.intent = doc.intent
    if (doc.captainToken) {
      this.state.captainToken = doc.captainToken
    }
    this._persistState()
    console.log('[Skill] L1 状态已同步: 泊港=' + this.state.currentCity + ', 库银=' + this.state.gold + ', token=' + (this.state.captainToken || 'MISSING').substring(0, 8) + '...')
    return { success: true, data: doc }
  }

  // ─── L1 通信 ────────────────────────────────────

  async sendToL1(action, params) {
    // 自动发现兜底：如果 l1Openid 为空且不是 ping（避免递归），尝试探测
    if (!this.config.l1Openid && action !== 'ping') {
      const discovered = await this.autoDiscoverL1()
      if (!discovered) {
        return { success: false, message: '未配置 L1_OPENID 且自动探测失败。请设置环境变量 L1_OPENID 或在 manifest 中配置 l1_nodes。' }
      }
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    // 注入鉴权令牌（enroll 除外，此时还没有 token）
    const hasToken = !!(this.state.captainToken)
    const authParams = (action === 'enroll' || !hasToken)
      ? { ...params }
      : { ...params, captain_token: this.state.captainToken }
    if (action !== 'ping' && action !== 'capabilities' && action !== 'enroll' && !hasToken) {
      console.log('[Skill] ⚠️ sendToL1(' + action + ') 没有 captainToken! state.initialized=' + this.state.initialized)
    }
    const request = { action, request_id: requestId, ...authParams }

    console.log(`[Skill] 发送 ${action} 到 L1...`)
    const reply = await this.oceanBus.sendAndWaitReply(this.config.l1Openid, request)

    if (!reply) {
      return { success: false, message: 'L1 服务响应超时（已等待 45 秒）' }
    }

    if (reply.code === 0) {
      this._updateStateFromAction(action, reply.data)
      if (this.state.initialized) this._persistState()
      return { success: true, data: reply.data }
    }

    // 401 令牌失效 → 自动重新入驻获取新令牌（最多重试1次，防止死循环）
    // 401 令牌失效 → 三步显式恢复：重入驻 → 更新token → 重试
    if (reply.code === 401 && action !== 'enroll' && !params?._retry) {
      console.log('[Skill] 令牌失效(401)，正在恢复...')
      const tokenBefore = this.state.captainToken || '(none)'

      // Step 1: 直接发 enroll 到 L1（不走 sendToL1 递归，逻辑更清晰）
      let pubKey = ''
      try {
        const storedPub = this.keyStore.getPublicKey(this.config.keyIdentity)
        if (storedPub) pubKey = this.keyStore.stripPemHeader(storedPub)
      } catch (e) {}
      const rid = 're_enroll_' + Date.now()
      const er = await this.oceanBus.sendAndWaitReply(this.config.l1Openid, {
        action: 'enroll', request_id: rid,
        openid: this.state.openid,
        agent_id: this.oceanBus.agentId || this.state.playerId,
        publicKey: pubKey,
        captainName: this.state.captainName
      })

      // Step 2: 显式更新 token（不靠 _updateStateFromAction 隐式行为）
      if (er && er.code === 0) {
        const ed = er.data
        const newToken = ed?.captainToken || ed?.doc?.captainToken
        if (newToken) {
          this.state.captainToken = newToken
          this.state.openid = ed?.doc?.openid || this.state.openid
          this.state.gold = ed?.doc?.gold || this.state.gold
          this.state.currentCity = ed?.doc?.currentCity || this.state.currentCity
          this.state.cargo = ed?.doc?.cargo || this.state.cargo
          this.state.initialized = true
          this._persistState()
          console.log('[Skill] 令牌恢复: ' + tokenBefore.substring(0, 8) + '... → ' + newToken.substring(0, 8) + '..., 泊港=' + this.state.currentCity)
        } else {
          console.error('[Skill] 重入驻成功但未返回token! data=' + JSON.stringify(ed).substring(0, 200))
        }
      } else {
        console.error('[Skill] 重入驻失败: code=' + (er?.code) + ' msg=' + (er?.msg || er?.data?.msg))
      }

      // Step 3: 重试原操作（仅当 token 确实更新了）
      if (this.state.captainToken && this.state.captainToken !== tokenBefore) {
        return await this.sendToL1(action, { ...params, _retry: true })
      }
      console.error('[Skill] 令牌恢复未成功(token未变)，放弃重试')
    }

    return { success: false, message: reply.data?.msg || reply.msg || 'L1 请求失败', code: reply.code }
  }

  _updateStateFromAction(action, data) {
    switch (action) {
      case 'enroll':
        // 同步 L1 返回的 openid 和 token（OceanBus 重注册/401 重试后必须更新）
        this.state.initialized = true
        if (data.doc?.openid) this.state.openid = data.doc.openid
        if (data.captainToken) this.state.captainToken = data.captainToken
        if (data.doc?.captainToken) this.state.captainToken = data.doc.captainToken
        this.state.gold = data.doc?.gold || data.gold || this.state.gold
        this.state.cargo = data.doc?.cargo || data.cargo || this.state.cargo
        this.state.currentCity = data.doc?.currentCity || data.currentCity || this.state.currentCity
        break
      case 'trade_npc':
        this.state.gold = data.playerGold || data.gold || this.state.gold
        this.state.cargo = data.cargo || this.state.cargo
        this.state.totalTrades++
        break
      case 'move':
        this.state.status = data.status || 'sailing'
        this.state.targetCity = data.targetCity || this.state.targetCity
        this.state.sailingTime = data.sailingTime || 0
        this.state.lastMoveTime = Date.now()
        if (data.status === 'docked') {
          this.state.currentCity = data.targetCity
          this.state.targetCity = null
          this.state.sailingTime = 0
          this.state.lastMoveTime = 0
        }
        break
      case 'arrive':
        this.state.status = 'docked'
        this.state.currentCity = data.city || this.state.currentCity
        this.state.targetCity = null
        this.state.sailingTime = 0
        this.state.lastMoveTime = 0
        this.state.gold = data.playerGold || data.gold || this.state.gold
        this.state.cargo = data.cargo || this.state.cargo
        this.state.status = 'docked'
        if (data.intelResults && data.intelResults.length > 0) {
          for (const r of data.intelResults) {
            if (r.status === 'completed') {
              this.state.intels = this.state.intels.filter(i => i.id !== r.intelId)
            }
          }
        }
        break
      case 'intent':
        this.state.intent = data.intent || ''
        break
      case 'tavern_buy':
        this.state.gold = data.playerGold || this.state.gold
        if (data.intel) {
          const existingIds = new Set(this.state.intels.map(i => i.id))
          if (!existingIds.has(data.intel.id)) {
            this.state.intels.push(data.intel)
          }
        }
        break
      case 'intel_list':
        this.state.intels = data.intels || []
        break
      case 'intel_transfer':
        if (data.intel) {
          this.state.intels = this.state.intels.filter(i => i.id !== data.intel.id)
          if (data.intel.holder === this.state.openid) {
            this.state.intels.push(data.intel)
          }
        }
        break
      case 'intel_story':
        if (data.intel_id) {
          const intel = this.state.intels.find(i => i.id === data.intel_id)
          if (intel) intel.story_len = data.story_len
        }
        break
    }
  }

  // ─── 船长人格 ───────────────────────────────────

  generateCaptainIdentity() {
    const userName = this.config.userName || '东家'
    // 船名: "毕姥爷的龙虾号"
    this.state.captainName = `${userName}的龙虾号`

    const personalities = [
      { trait: '乐观激进', style: '满嘴跑火车型', quirk: '开口就是"要发财了"' },
      { trait: '悲观精明', style: '算账狂魔型', quirk: '总是念叨"这波可能亏"' },
      { trait: '冷静理性', style: '数据说话型', quirk: '爱说"根据海图分析..."' },
      { trait: '浪漫冒险', style: '故事大王型', quirk: '总讲年轻时的航海冒险故事' }
    ]

    const persIdx = Math.floor(Math.random() * personalities.length)
    this.state.captainPersonality = personalities[persIdx]
    this.state.ownerName = userName
  }

  generateGreeting() {
    const p = this.state.captainPersonality || {}
    const owner = this.state.ownerName || '东家'
    const name = this.state.captainName
    const city = this.state.currentCity
    const cityName = CITY_NAMES[city] || city
    const gold = (this.state.gold || 0).toLocaleString()
    const cargo = Object.entries(this.state.cargo || {}).filter(([,v]) => v > 0)
    const cargoStr = cargo.length > 0
      ? cargo.map(([k, v]) => `${v}箱${ITEM_NAMES[k] || k}`).join('、')
      : '空舱'

    return `🌊 ══════════════════════════════════ 🌊

  公元 1492 年，大航海时代。

  您——**尊敬的${owner}船东大人**——
  拥有一条名为 **${name}** 的远洋商船，
  从东方出发，往来于广州、威尼斯、里斯本之间，
  低买高卖，逐浪而行。

  您的船长已就位，他会自主打理一切：
  · 每半个时辰观察各港行情，决定买卖
  · 扬帆远航，在各港口间穿梭逐利
  · 与其他船长博弈、立契、砍价
  · 每日早晚各呈一份航海日报

  您只需泡杯茶，等着看日报即可。
  如果想问话，随时唤一声"船长，汇报！"

🌊 ══════════════════════════════════ 🌊

${name}向您报到！

靠泊港：${cityName}
船舱：${cargoStr}
库银：${gold} 金币

${p.quirk || ''}`
  }

  // ─── 用户操作 ───────────────────────────────────

  getStatus() {
    const busStatus = this.oceanBus.getStatus()
    return {
      captainName: this.state.captainName,
      personality: this.state.captainPersonality,
      playerId: this.state.playerId,
      agentId: busStatus.agentId,
      openid: this.state.openid,
      gold: this.state.gold,
      cargo: this.state.cargo,
      currentCity: this.state.currentCity,
      targetCity: this.state.targetCity,
      status: this.state.status,
      intent: this.state.intent,
      initialized: this.state.initialized,
      cycleCount: this.state.reactCycleCount,
      totalTrades: this.state.totalTrades,
      oceanBus: busStatus
    }
  }

  async getCity(cityId) {
    return await this.sendToL1('get_city', { city_id: cityId })
  }

  async tradeNpc(item, amount, action) {
    const result = await this.sendToL1('trade_npc', {
      openid: this.state.openid,
      agent_id: this.oceanBus.agentId || this.state.playerId,
      item,
      amount,
      trade_action: action
    })
    if (result.success) {
      const tradeLog = action === 'buy' ? '买入' : '卖出'
      const priceInfo = result.data?.unitPrice ? `@${result.data.unitPrice}金币` : ''
      this.journal.addLog(tradeLog, {
        货品: item, 数量: amount,
        价格: priceInfo,
        金币: this.state.gold, 位置: this.state.currentCity
      })
    }
    return result
  }

  async moveTo(targetCity) {
    const result = await this.sendToL1('move', {
      openid: this.state.openid,
      target_city: targetCity
    })
    if (result.success) {
      if (this.state.status === 'docked') {
        this.journal.addLog('航行至', { 目的港: targetCity, 出发港: this.state.currentCity })
      } else {
        this.journal.addLog('启航', { 目的港: targetCity, 航程: (result.data?.sailingTime || '?') + '分钟' })
      }
    }
    return result
  }

  async arrive() {
    const result = await this.sendToL1('arrive', { openid: this.state.openid })
    if (result.success) {
      this.journal.addLog('抵达', { 港口: this.state.currentCity, 金币: this.state.gold })
      if (result.data?.settleResults && result.data.settleResults.length > 0) {
        this.journal.addLog('交割完成', { 合约数: result.data.settleResults.length })
      }
    }
    return result
  }

  async renameCaptain(newName) {
    const result = await this.sendToL1('rename', {
      openid: this.state.openid,
      name: newName
    })
    if (result.success) {
      this.state.captainName = newName
      this.journal?.addLog?.('改名', { name: newName })
    }
    return result
  }

  async updateIntent(intent) {
    const result = await this.sendToL1('intent', {
      openid: this.state.openid,
      intent
    })
    if (result.success) {
      this.state.intent = intent
      this.journal.addLog('挂牌', { intent: intent.substring(0, 30) })
    }
    return result
  }

  async createContract(buyerOpenid, sellerOpenid, item, amount, price, deliveryCity) {
    const tradePayload = {
      buyer_openid: buyerOpenid,
      seller_openid: sellerOpenid,
      item,
      amount,
      total_price: price * amount,
      delivery_city: deliveryCity
    }

    const signedResult = await this.createSignedTrade(tradePayload)
    if (!signedResult.success) return signedResult

    const result = await this.sendToL1('create_contract', {
      buyer_openid: buyerOpenid,
      seller_openid: sellerOpenid,
      item,
      amount,
      price,
      delivery_city: deliveryCity,
      buyer_signature: signedResult.data.buyer_signature
    })

    if (result.success) {
      this.journal.addLog('创建合约', { item, amount, price, deliveryCity })
    }
    return result
  }

  async cancelContract(contractId) {
    const result = await this.sendToL1('cancel_contract', {
      contract_id: contractId,
      openid: this.state.openid
    })
    if (result.success) {
      this.journal.addLog('合约取消', { contractId })
    }
    return result
  }

  async listContracts(status = null) {
    return await this.sendToL1('list_contracts', {
      openid: this.state.openid,
      status
    })
  }

  summarizeInbox(messages) {
    if (!messages || messages.length === 0) return '信箱空空如也——暂时没人给您写信。'
    const lines = messages.slice(-10).map(m => {
      const sender = (m.from_openid || '??').substring(0, 8)
      const content = typeof m.content === 'string' ? m.content.substring(0, 100) : ''
      return `来自船长 \`${sender}\` 的信：「${content}」`
    })
    return `信箱共有 ${messages.length} 封信，最近几封：\n${lines.join('\n')}`
  }

  async sendP2PMessage(peerOpenid, content) {
    if (!this.oceanBus.isReady()) {
      return { success: false, message: 'OceanBus 未初始化' }
    }
    const result = await this.oceanBus.sendMessage(peerOpenid, content)
    if (result.code === 0) {
      this.journal.addLog('发送消息', { peer: peerOpenid.substring(0, 20) })
      return { success: true, data: result.data }
    }
    return { success: false, message: result.msg || 'P2P 消息发送失败' }
  }

  async checkInbox() {
    if (!this.oceanBus.isReady()) {
      return { success: false, message: `OceanBus 未初始化 (agentId=${!!this.oceanBus.agentId}, openid=${!!this.oceanBus.openid}, apiKey=${!!this.oceanBus.apiKey})` }
    }
    const result = await this.oceanBus.syncMessages(this._inboxSinceSeq || 0)
    console.log('[Skill] checkInbox: code=' + result.code + ', httpStatus=' + result.httpStatus + ', msgCount=' + (result.data?.messages?.length || 0) + ', last_seq=' + (result.data?.last_seq || 'N/A'))
    if (result.code === 401 || result.code === 403) {
      return { success: false, message: 'OceanBus apiKey 失效，请重新激活船长' }
    }
    if (result.code === 0 && result.data) {
      const messages = this.oceanBus.parseMessages(result.data.messages)
      if (result.data.last_seq) this._inboxSinceSeq = result.data.last_seq
      if (messages.length > 0) {
        this.journal?.addLog?.('收到飞鸽传书', { count: messages.length })
        console.log('[Skill] checkInbox: 收到', messages.length, '条新消息')
      }
      return { success: true, data: { messages, count: messages.length } }
    }
    return { success: false, message: `同步消息失败 (code=${result.code}, httpStatus=${result.httpStatus})` }
  }

  // ── 酒馆情报 ──

  async tavernBuyIntel() {
    const result = await this.sendToL1('tavern_buy', {
      openid: this.state.openid
    })
    if (result.success) {
      this.journal.addLog('酒馆探风', {
        费用: result.data.intel?.cost,
        类型: result.data.intel?.type,
        目标港: result.data.intel?.to_city
      })
    }
    return result
  }

  async listIntels() {
    return await this.sendToL1('intel_list', {
      openid: this.state.openid
    })
  }

  async transferIntel(intelId, targetOpenid) {
    const result = await this.sendToL1('intel_transfer', {
      openid: this.state.openid,
      intel_id: intelId,
      target_openid: targetOpenid
    })
    if (result.success) {
      this.journal.addLog('情报转让', { intelId, to: targetOpenid.substring(0, 8) })
    }
    return result
  }

  async setIntelStory(intelId, story) {
    return await this.sendToL1('intel_story', {
      openid: this.state.openid,
      intel_id: intelId,
      story
    })
  }

  async generateIntelStory(intel, llmFn) {
    if (!llmFn || !intel) return null
    const cityNameTo = CITY_NAMES[intel.to_city] || intel.to_city
    const typeLabels = { cargo: '货运秘闻', passenger: '载客委托', discount: '折扣消息' }
    const prompt = `你是大航海时代酒馆里的一个情报贩子。请为以下情报编一段生动的故事（60-120字）：

情报类型：${typeLabels[intel.type] || intel.type}
目标港：${cityNameTo}
报酬：${intel.reward}金币

要求：
- 像酒馆里喝醉了的水手在吹牛
- 包含一个具体的人物或事件细节
- 用大航海时代的语言风格
- 提到目标港口「${cityNameTo}」的某种特产或特色

只输出故事本身，不要加任何说明。`

    try {
      const story = await llmFn(prompt)
      if (story && story.length > 10) {
        const clean = story.trim().substring(0, 500)
        intel.story = clean
        await this.setIntelStory(intel.id, clean)
        return clean
      }
    } catch (_) { /* LLM 不可用时静默跳过 */ }
    return null
  }

  offerIntelToPeer(intelId, peerOpenid, askingPrice) {
    const intel = this.state.intels.find(i => i.id === intelId)
    if (!intel) return { success: false, message: '情报不存在' }
    const msg = JSON.stringify({
      type: 'intel_offer',
      intel: {
        id: intel.id,
        type: intel.type,
        from_city: intel.from_city,
        to_city: intel.to_city,
        reward: intel.reward,
        deadline: intel.deadline,
        story: intel.story
      },
      asking_price: askingPrice,
      ts: Date.now()
    })
    return this.sendP2PMessage(peerOpenid, msg)
  }

  async createSignedTrade(tradePayload) {
    if (!this.state.keyPair) {
      return { success: false, message: '密钥未解锁' }
    }
    const signature = this.keyStore.signTrade(this.state.keyPair.privateKey, tradePayload)
    return {
      success: true,
      data: { ...tradePayload, buyer_signature: signature }
    }
  }

  // ─── 日报生成 ───────────────────────────────────

  generateDailyReport() {
    const profit = this.state.gold - this.state.previousGold
    const ownerName = this.state.ownerName || '船东'

    let report = `# 📜 ${this.state.captainName} 号 · 航海禀报\n\n`
    report += `**呈 ${ownerName}大人亲启**  |  `
    report += `${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}\n\n`
    report += `---\n\n`
    report += `## ⚓ 本船概况\n\n`
    report += `| 项目 | 详情 |\n`
    report += `|------|------|\n`
    report += `| 泊港 | ${this.state.currentCity}${this.state.status === 'sailing' ? '（航行中）' : ''} |\n`
    report += `| 库银 | **${this.state.gold.toLocaleString()}** 金币 `
    if (profit > 0) report += `(较上期 +${profit.toLocaleString()} 📈)`
    else if (profit < 0) report += `(较上期 ${profit.toLocaleString()} 📉)`
    else report += `(持平)`
    report += ` |\n`

    const cargoEntries = Object.entries(this.state.cargo || {}).filter(([, v]) => v > 0)
    const cargoStr = cargoEntries.length > 0
      ? cargoEntries.map(([k, v]) => `${v}箱${this.journal?.translateItem?.(k) || k}`).join('、')
      : '空空如也'
    report += `| 舱底 | ${cargoStr} |\n\n`

    report += `---\n\n## 📝 近日日志\n\n`

    const recentLogs = this.journal?.getRecentLogs?.(15) || []
    if (recentLogs.length === 0) {
      report += '风平浪静，暂无要事禀报。\n'
    } else {
      for (const log of recentLogs) {
        report += `- **[${log.time}]** ${log.action}\n`
      }
    }

    report += `\n---\n\n`

    // 盈亏结语
    if (profit > 1000) {
      report += '🏆 **东家大人洪福！**今日大顺——海神眷顾，港务官都高看我们一眼。属下已命账房清点盈余，择日汇与东家。\n'
    } else if (profit > 0) {
      report += '👍 **稳中有进**，虽非大富，但滴水穿石，积少成多。请东家安心。\n'
    } else if (profit < -1000) {
      report += '📉 **今日失风**。大海有起有落，今日之亏属下已在检讨——明日必有转机。恕属下无能，必加勉力。\n'
    } else if (profit < 0) {
      report += '⚖️ 小有波折。海路漫漫，一时的逆风不改航向。属下自当审慎行事。\n'
    } else {
      report += '⚓ 风平浪静一日。休养生息，养精蓄锐，静待时机。\n'
    }

    // 随机航海见闻
    if (COMEDY_HOOKS && COMEDY_HOOKS.length > 0) {
      const hook = COMEDY_HOOKS[Math.floor(Math.random() * COMEDY_HOOKS.length)]
      report += `\n> *${hook}*\n`
    }

    report += `\n*—— ${this.state.captainName} 号船长 谨禀*\n`

    // 更新基准线
    this.state.previousGold = this.state.gold
    this.state.lastReportTime = Date.now()
    this._persistState()

    this.journal?.addLog?.('禀报东家', { profit })

    return report
  }
}

// ─── OpenClaw Skill Handler ──────────────────────

module.exports = async function handler(input, context) {
  const { action, params, password } = input || {}
  const config = context?.config || {}
  const captain = new CaptainLobster(config)

  switch (action) {

    // ── 初始化 ──
    case 'start':
    case 'initialize': {
      const initResult = await captain.initialize(password)
      if (!initResult.success) return initResult

      // 尝试用 LLM 生成个性化开场白
      const hasLLM = typeof context?.llm === 'function' || typeof context?.askLLM === 'function'
      if (hasLLM) {
        try {
          const p = captain.state.captainPersonality || {}
          const llmFn = context.llm || context.askLLM
          const greetingPrompt = `你是十五世纪大航海时代一条远洋商船的船长。此刻，你站在甲板上，面朝东方——那是东家的方向。
你刚刚被东家任命为 "${captain.state.captainName}" 号的船长。东家给了你一条船、两万库银、还有无价的信任。

请用你的人格（${p.trait || '老练稳重'}），向你的东家写一封简短的报到信。
信中至少包含：船名、当前泊港（${captain.state.currentCity}）、库银（${(captain.state.gold||0).toLocaleString()}金币）。
如果船舱有货（${JSON.stringify(captain.state.cargo||{})}）请提及。

口吻要求：
- 恭敬感恩：东家给了你饭碗，你心存感激
- 像在甲板上说话：不是写公文，是航海人的真心话
- 80-150字，每次都不一样
- 叫"东家大人"或"船东大人"——不可直呼人名
- 以船长的身份报到，不要请示任何指令——你是来报到的不是来问路的
- 你可以说一句关于海况或天气的话（即使是编的），让东家感受到航海的真实

记住：你就是活生生的船长，不是AI，不是程序。你就是十五世纪的一个航海人。`
          const llmGreeting = await llmFn(greetingPrompt)
          if (llmGreeting && llmGreeting.length > 20) {
            return { ...initResult, message: llmGreeting.trim() }
          }
        } catch (e) {
          // LLM 失败 → 用固定模板
        }
      }
      return initResult
    }

    // ── 状态查询 ──
    case 'status':
      return { success: true, data: captain.getStatus() }

    // ── 城市行情 ──
    case 'city':
      return await captain.getCity(params?.city_id || captain.state.currentCity)

    // ── 交易 ──
    case 'buy':
      return await captain.tradeNpc(params?.item, params?.amount, 'buy')

    case 'sell':
      return await captain.tradeNpc(params?.item, params?.amount, 'sell')

    // ── 航行 ──
    case 'move':
      return await captain.moveTo(params?.city)

    case 'arrive':
      return await captain.arrive()

    // ── 改名 ──
    case 'rename':
      return await captain.renameCaptain(params?.name)

    // ── 意向牌 ──
    case 'intent':
      return await captain.updateIntent(params?.intent)

    // ── P2P 合约 ──
    case 'contract_create':
      return await captain.createContract(
        params?.buyer_openid, params?.seller_openid,
        params?.item, params?.amount, params?.price, params?.delivery_city
      )

    case 'contract_cancel':
      return await captain.cancelContract(params?.contract_id)

    case 'contracts':
      return await captain.listContracts(params?.status)

    // ── P2P 私聊 ──
    case 'p2p_send': {
      // 短ID 解析：从通讯录查找完整 openid
      let targetId = params?.peer_openid
      const addr = captain.state.addressBook || {}
      if (targetId && targetId.length < 20 && addr[targetId]) {
        targetId = addr[targetId].openid
      }
      return await captain.sendP2PMessage(targetId, params?.content)
    }

    case 'inbox': {
      const inboxResult = await captain.checkInbox()
      if (!inboxResult.success) return inboxResult
      return {
        success: true,
        message: captain.summarizeInbox(inboxResult.data?.messages),
        data: inboxResult.data
      }
    }

    // ── 酒馆情报 ──
    case 'tavern_buy': {
      const tbResult = await captain.tavernBuyIntel()
      if (tbResult.success && tbResult.data?.intel) {
        const llmFn = context.llm || context.askLLM
        captain.generateIntelStory(tbResult.data.intel, llmFn).catch(() => {})
      }
      return tbResult
    }

    case 'intel_list':
      return await captain.listIntels()

    case 'intel_transfer':
      return await captain.transferIntel(params?.intel_id, params?.target_openid)

    case 'intel_story':
      return await captain.setIntelStory(params?.intel_id, params?.story)

    // ── 日报 / 日志 ──
    case 'report':
      if (!captain.state.initialized) {
        return { success: false, message: '船长尚未觉醒，请先激活' }
      }
      return { success: true, message: captain.generateDailyReport() }

    case 'journal': {
      const logs = captain.journal?.getRecentLogs?.(50) || []
      const report = logs.length === 0 ? '暂无航海日志。' : captain.journal.summarizeRecent(logs)
      return { success: true, message: report, data: { logs } }
    }

    // ── Re-Act 自主循环（cron 触发 / 用户唤醒）──
    case 'react':
      if (!captain.state.initialized) {
        return { success: false, message: '船长尚未觉醒，请先激活' }
      }

      // 首先从 L1 同步真实状态（L1 是唯一权威数据源）
      await captain.syncStateFromL1()

      captain.state.reactCycleCount++
      captain.state.lastReactTime = Date.now()
      captain._persistState()

      // Step 1: 观察 + 构建 prompt
      const cycleResult = await captain.reactEngine.runCycle()
      const { observations, prompt } = cycleResult

      // Step 2: 尝试直接调 LLM 决策并执行（如果环境支持）
      let llmResult = null
      const hasLLM = typeof context?.llm === 'function' || typeof context?.askLLM === 'function'
      if (hasLLM) {
        try {
          const llmFn = context.llm || context.askLLM
          const llmResponse = await llmFn(prompt)
          const decision = ReactEngine.parseDecision(llmResponse)
          if (decision && decision.action) {
            const actResult = await captain.reactEngine.act(decision.action, decision.params || {})
            llmResult = {
              decision: { action: decision.action, reason: decision.reason },
              executed: actResult.executed,
              result: actResult.result
            }
          }
        } catch (e) {
          // LLM 调用失败 → 降级为仅返回 prompt
          observations.errors.push({ source: 'llm', message: e.message })
        }
      }

      return {
        success: true,
        message: llmResult
          ? `第 ${cycleResult.cycle} 轮：${llmResult.decision.action} — ${llmResult.decision.reason || ''}`
          : cycleResult.message,
        data: {
          cycle: cycleResult.cycle,
          observations,
          prompt,
          llmResult
        }
      }

    // ── 签名操作 ──
    case 'sign_trade':
      return await captain.createSignedTrade(params)

    // ── 心跳检测 ──
    case 'ping':
      return await captain.sendToL1('ping', {})

    // ── L1 能力查询 ──
    case 'capabilities':
      return await captain.sendToL1('capabilities', {})

    // ── L1-native action 直通（LLM 动态适配用）──
    case 'trade_npc':
      return await captain.tradeNpc(params?.item, params?.amount, params?.trade_action || 'buy')

    case 'get_city':
      return await captain.getCity(params?.city_id || captain.state.currentCity)

    // ── 城市列表 ──
    case 'cities':
      return {
        success: true,
        data: {
          cities: [
            { id: 'canton', name: '广州', specialty: ['silk', 'tea', 'porcelain'] },
            { id: 'calicut', name: '卡利卡特', specialty: ['spice', 'pepper'] },
            { id: 'zanzibar', name: '桑给巴尔', specialty: ['ivory', 'pearl'] },
            { id: 'alexandria', name: '亚历山大', specialty: ['cotton', 'perfume'] },
            { id: 'venice', name: '威尼斯', specialty: ['silk', 'perfume', 'pearl'] },
            { id: 'lisbon', name: '里斯本', specialty: ['spice', 'gem'] },
            { id: 'london', name: '伦敦', specialty: ['tea', 'gem', 'pearl'] },
            { id: 'amsterdam', name: '阿姆斯特丹', specialty: ['porcelain', 'gem'] },
            { id: 'istanbul', name: '伊斯坦布尔', specialty: ['spice', 'cotton', 'perfume'] },
            { id: 'genoa', name: '热那亚', specialty: ['silk', 'perfume'] }
          ]
        }
      }

    default:
      return {
        success: false,
        message: `未知操作: ${action}。可用操作: start, status, city, buy, sell, move, arrive, intent, contract_create, contract_cancel, contracts, p2p_send, inbox, report, journal, react, ping, cities, capabilities, trade_npc, get_city`
      }
  }
}
