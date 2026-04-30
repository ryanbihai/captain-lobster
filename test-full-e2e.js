/**
 * @file test-full-e2e.js
 * @description 龙虾船长完整双端全流程测试（OceanBus L0 架构）
 *
 * 架构: Skill ← OceanBus L0 → L1 Server
 * 运行: node test-full-e2e.js
 */

const { spawn } = require('child_process')
const OceanBusClient = require('./skills/captain-lobster/src/oceanbus')

const OCEANBUS_URL = 'https://ai-t.ihaola.com.cn/api/l0'
const SLEEP = ms => new Promise(r => setTimeout(r, ms))

let stepNum = 0
function divider(title) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  [${++stepNum}] ${title}`)
  console.log(`${'═'.repeat(60)}`)
}

function ok(label, detail) { console.log(`  ✅ ${label}${detail ? ': ' + detail : ''}`) }
function fail(label, detail) { console.log(`  ❌ ${label}${detail ? ': ' + detail : ''}`) }
function info(label) { console.log(`  ℹ️  ${label}`) }

// ─── 启动 L1 服务 ────────────────────────────────────────────

async function startL1Service() {
  return new Promise((resolve, reject) => {
    const l1Path = require('path').join(__dirname, 'ai-backend-template', 'src', 'apps', '03-LobsterSvc', 'start-oceanbus.js')
    const proc = spawn('node', [l1Path], {
      cwd: __dirname,
      env: { ...process.env, OCEANBUS_URL },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let l1Openid = null, l1AgentId = null, output = ''
    const timeout = setTimeout(() => { proc.kill(); reject(new Error('L1 服务启动超时 (30s)')) }, 30000)

    const onData = chunk => {
      output += chunk.toString()
      const m1 = output.match(/L1_OPENID=(\S+)/)
      if (m1) l1Openid = m1[1]
      const m2 = output.match(/AgentId:\s*(\S+)/)
      if (m2) l1AgentId = m2[1]
      if (l1Openid) { clearTimeout(timeout); resolve({ proc, l1Openid, l1AgentId }) }
    }

    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('error', err => { clearTimeout(timeout); reject(err) })
    proc.on('exit', code => { clearTimeout(timeout); if (!l1Openid) reject(new Error(`L1 进程退出 (code=${code})`)) })
  })
}

// ─── 虚拟船长 ────────────────────────────────────────────────

class VirtualCaptain {
  constructor(name, l1Openid, initialGold = 10000) {
    this.name = name
    this.l1Openid = l1Openid
    this.initialGold = initialGold
    this.bus = new OceanBusClient(OCEANBUS_URL)
    this.state = { playerId: null, openid: null, gold: 0, cargo: {}, currentCity: 'canton', status: 'docked' }
    this._lastSeq = 0
  }

  async init() {
    const reg = await this.bus.register()
    if (reg.code !== 0) throw new Error(`${this.name} OceanBus 注册失败`)
    ok(`${this.name} 注册 OceanBus`, `agentId=${this.bus.agentId}`)

    const result = await this._call('enroll', { openid: this.bus.openid, publicKey: 'pk_' + this.name, initialGold: this.initialGold })
    if (!result || result.code !== 0) throw new Error(`${this.name} 入驻失败: ${JSON.stringify(result)}`)
    this.state.playerId = result.data?.doc?.id
    this.state.openid = result.data?.doc?.openid || this.bus.openid
    this.state.gold = result.data?.doc?.gold || this.initialGold
    ok(`${this.name} 入驻 L1`, `金币=${this.state.gold}`)
    return this
  }

  async _call(action, params, timeoutMs = 60000) {
    const requestId = `e2e_${action}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
    await this.bus.sendMessage(this.l1Openid, JSON.stringify({ action, request_id: requestId, ...params }))

    const start = Date.now()
    let attempts = 0
    while (Date.now() - start < timeoutMs) {
      attempts++
      await SLEEP(Math.min(1500 * Math.pow(1.5, Math.floor(attempts / 3)), 8000))
      const sync = await this.bus.syncMessages(this._lastSeq)
      if (sync.code !== 0 || !sync.data?.messages) continue

      for (const msg of sync.data.messages) {
        this._lastSeq = Math.max(this._lastSeq, (msg.seq_id || 0) + 1)
        try { const p = JSON.parse(msg.content); if (p.request_id === requestId) return p } catch (e) {}
      }
      if (sync.code === 401) return { code: 401, msg: 'API Key 失效' }
    }
    return null
  }

  async getCity(cityId) {
    const r = await this._call('get_city', { city_id: cityId || this.state.currentCity })
    if (r?.code === 0) {
      const c = r.data.city
      const prices = c.prices
      // L1 OceanBus 版返回单值价格，不是 buy/sell 对象
      const isObj = prices && typeof Object.values(prices)[0] === 'object'
      const items = ['silk', 'tea', 'spice', 'pepper'].map(i => {
        const p = prices[i]
        return isObj ? `${i}:买${p.buy}/卖${p.sell}` : `${i}:${p}`
      }).join(' ')
      ok(`${this.name} 查询 ${c.name}`, items)
      if (r.data.players?.length) info(`停靠玩家: ${r.data.players.length}人`)
    } else { fail(`${this.name} 查询城市`, r?.data?.msg) }
    return r
  }

  async tradeNpc(item, amount, tradeAction) {
    const r = await this._call('trade_npc', { openid: this.state.openid, item, amount, trade_action: tradeAction })
    if (r?.code === 0) {
      this.state.gold = r.data.playerGold
      this.state.cargo = r.data.cargo || {}
      ok(`${this.name} ${tradeAction === 'buy' ? '买入' : '卖出'}`, `${amount}x${item} 单价${r.data.unitPrice} 余额=${this.state.gold}`)
    } else { fail(`${this.name} 交易`, r?.data?.msg || r?.msg) }
    return r
  }

  async setIntent(intent) {
    const r = await this._call('intent', { openid: this.state.openid, intent })
    if (r?.code === 0) ok(`${this.name} 挂牌`, `"${intent}"`)
    return r
  }

  async moveTo(targetCity) {
    const r = await this._call('move', { openid: this.state.openid, target_city: targetCity })
    if (r?.code === 0) {
      ok(`${this.name} 启航`, `→ ${targetCity} (${r.data.sailingTime}分钟)`)
      this.state.status = 'sailing'
    } else { fail(`${this.name} 航行`, r?.data?.msg) }
    return r
  }

  async arrive() {
    const r = await this._call('arrive', { openid: this.state.openid })
    if (r?.code === 0) {
      this.state.status = 'docked'
      this.state.gold = r.data.playerGold || r.data.gold || this.state.gold
      this.state.cargo = r.data.cargo || this.state.cargo
      ok(`${this.name} 抵达`, `余额=${this.state.gold} 交割=${r.data.settleResults?.length || 0}笔`)
    } else { fail(`${this.name} 抵达`, r?.data?.msg) }
    return r
  }

  async createContract(buyerOpenid, sellerOpenid, item, amount, price, deliveryCity) {
    const r = await this._call('create_contract', { buyer_openid: buyerOpenid, seller_openid: sellerOpenid, item, amount, price, delivery_city: deliveryCity })
    if (r?.code === 0) ok(`${this.name} 创建合约`, `${amount}${item}@${price} → ${deliveryCity}`)
    else fail(`${this.name} 创建合约`, r?.data?.msg || r?.msg)
    return r
  }

  async listContracts(status = null) {
    const params = { openid: this.state.openid }
    if (status) params.status = status
    const r = await this._call('list_contracts', params)
    if (r?.code === 0) {
      const contracts = r.data?.contracts || []
      ok(`${this.name} 合约列表`, `${contracts.length}个`)
      contracts.forEach(c => info(`  ${c.id?.substring(0,12)}... ${c.item}x${c.amount} @${c.price} [${c.status}]`))
    }
    return r
  }

  async getStatus() {
    const r = await this._call('status', { openid: this.state.openid })
    if (r?.code === 0) {
      const p = r.data?.player
      const cargoStr = Object.entries(p?.cargo || {}).filter(([,v]) => v > 0).map(([k,v]) => `${k}x${v}`).join(' ') || '空'
      ok(`${this.name} 状态`, `金币=${p?.gold} 城市=${p?.currentCity} 状态=${p?.status} 货舱=[${cargoStr}]`)
    }
    return r
  }

  async sendP2P(peerOpenid, content) {
    const r = await this.bus.sendMessage(peerOpenid, content)
    if (r.code === 0) ok(`${this.name} 私聊`, `→ ${peerOpenid.substring(0,16)}...`)
    return r
  }

  async ping() {
    const r = await this._call('ping', {})
    if (r?.code === 0) ok(`${this.name} Ping`, `L1 agentId=${r.data?.agentId}`)
    return r
  }
}

// ─── 主流程 ──────────────────────────────────────────────────

async function main() {
  console.log('🦞 龙虾船长 双玩家完整 E2E 测试')
  console.log('架构: Skill ← OceanBus L0 → L1 Server\n')

  let l1Proc = null
  try {
    // 1. 启动 L1
    divider('启动 L1 Game Server')
    const l1 = await startL1Service()
    l1Proc = l1.proc
    ok('L1 启动成功', `AgentId=${l1.l1AgentId}`)
    ok('L1 OpenID', l1.l1Openid)
    console.log('  等待 L1 轮询就绪 (5s)...')
    await SLEEP(5000)

    // 2. 创建虚拟船长
    divider('创建 2 个虚拟船长并入驻')
    const A = new VirtualCaptain('黑珍珠号', l1.l1Openid, 10000)
    const B = new VirtualCaptain('飞翔荷兰人号', l1.l1Openid, 8000)
    await A.init()
    await B.init()

    // 3. 查询行情
    divider('查询广州行情')
    await A.getCity('canton')
    await B.getCity('canton')

    // 4. NPC 交易 — 广州特产 silk/tea 8折
    divider('NPC 交易 — 广州特产 8 折')
    await A.tradeNpc('silk', 5, 'buy')    // silk 广州8折 buy=403, 5*403=2015
    await B.tradeNpc('tea', 3, 'buy')     // tea 广州8折 buy=294, 3*294=882

    // 5. 挂牌
    divider('挂牌意向')
    await A.setIntent('大量收购香料！')
    await B.setIntent('出售上等丝绸，价格公道！')

    // 6. 航行到卡利卡特
    divider('黑珍珠号航行到卡利卡特（香料产地）')
    await A.moveTo('calicut')
    await A.arrive()
    await A.getCity('calicut')

    divider('飞翔荷兰人号航行到卡利卡特')
    await B.moveTo('calicut')
    await B.arrive()
    await B.getCity('calicut')

    // 7. 在卡利卡特交易 — spice/pepper 产地 8 折
    divider('在卡利卡特交易 — 产地折扣')
    // 黑珍珠号卖一点 silk（卡利卡特非 silk 产地，价高）再买本地 spice
    await A.tradeNpc('silk', 2, 'sell')
    await A.tradeNpc('spice', 3, 'buy')
    // 飞翔荷兰人号买本地 pepper（8折）
    await B.tradeNpc('pepper', 5, 'buy')

    // 8. P2P 合约
    divider('P2P 合约：荷兰人卖胡椒给黑珍珠')
    // buyer=黑珍珠(A), seller=荷兰人(B), item=pepper, amount=3, price=350
    await A.createContract(A.state.openid, B.state.openid, 'pepper', 3, 350, 'calicut')
    await A.listContracts()
    await B.listContracts()

    // 9. P2P 私聊
    divider('P2P 私聊')
    await A.sendP2P(B.bus.openid, '嘿！那批胡椒能便宜点吗？350太贵了！')
    await SLEEP(2000)
    await B.sendP2P(A.bus.openid, '350已是最低价，卡利卡特现货！')

    // 10. 心跳
    divider('心跳 Ping')
    await A.ping()
    await B.ping()

    // 11. 最终状态
    divider('最终状态汇总')
    await A.getStatus()
    await B.getStatus()

    // 汇总
    console.log(`\n${'═'.repeat(60)}`)
    console.log(`  📊 测试结果`)
    console.log(`${'═'.repeat(60)}`)
    console.log(`  黑珍珠号:    金币=${A.state.gold} 城市=${A.state.currentCity} cargo=${JSON.stringify(A.state.cargo)}`)
    console.log(`  飞翔荷兰人号: 金币=${B.state.gold} 城市=${B.state.currentCity} cargo=${JSON.stringify(B.state.cargo)}`)
    console.log(`\n  ✅ 全流程测试完成！`)

  } catch (err) {
    console.error(`\n  ❌ 测试异常: ${err.message}`)
  } finally {
    if (l1Proc) { console.log('\n  关闭 L1 服务...'); l1Proc.kill(); setTimeout(() => { try { l1Proc.kill() } catch (e) {} }, 3000) }
  }
}

main()
