/**
 * @file test-intel-lifecycle.js
 * @description 酒馆情报全生命周期单元测试 — 不依赖外部服务
 *
 * 覆盖:
 * 1. 购买情报 (tavern_buy)
 * 2. 持有上限 (3份active)
 * 3. 航行中/金币不足拒绝
 * 4. 为情报撰写故事 (含截断)
 * 5. 情报转让 (含故事清除/满槽拒绝)
 * 6. 抵达完成 (cargo/passenger/discount)
 * 7. 情报过期
 * 8. 错误城市不结算
 * 9. 混合场景: 买→过期→完成→转让
 * 10. 边界鉴权
 */

// ═══════════════════════════════════════════════════════════════
// 简化的 in-memory 情报系统 (复制 oceanbus-service.js 核心逻辑)
// ═══════════════════════════════════════════════════════════════

const INTEL_HOLD_LIMIT = 3
const INTEL_COST_MIN = 800
const INTEL_COST_MAX = 1200
const INTEL_REWARD_MIN = 2500
const INTEL_REWARD_MAX = 4000
const INTEL_DEADLINE_MS = 2 * 60 * 60 * 1000
const INTEL_TYPES = ['cargo', 'passenger', 'discount']

const CITIES = {
  canton: { id: 'canton', name: '广州', specialty: ['silk', 'tea', 'porcelain'] },
  calicut: { id: 'calicut', name: '卡利卡特', specialty: ['spice', 'pepper', 'cotton'] },
  venice: { id: 'venice', name: '威尼斯', specialty: ['silk', 'perfume', 'pearl'] },
  london: { id: 'london', name: '伦敦', specialty: ['tea', 'gem', 'pearl'] },
  genoa: { id: 'genoa', name: '热那亚', specialty: ['silk', 'spice', 'pearl'] }
}

let _idCounter = 0
function createId() { return `test_${Date.now()}_${++_idCounter}` }

function createPlayer(openid, name, gold = 20000, currentCity = 'canton') {
  return {
    id: createId(), openid, name, gold, cargo: {},
    currentCity, targetCity: null, status: 'docked', intent: '',
    shipCapacity: 100,
    captainToken: 'tok_' + Math.random().toString(36).slice(2, 10),
    sailingUntil: null
  }
}

class IntelSystem {
  constructor() {
    this.players = {}
    this.intels = {}
  }

  _auth(openid, captainToken) {
    const p = this.players[openid]
    if (!p) return { code: 4, msg: '玩家不存在' }
    if (captainToken && p.captainToken !== captainToken) return { code: 401, msg: '鉴权失败' }
    return p
  }

  _expireIntels() {
    const now = Date.now()
    for (const intel of Object.values(this.intels)) {
      if (intel.status === 'active' && intel.deadline && now > intel.deadline) {
        intel.status = 'expired'
      }
    }
  }

  /** 直接注入情报 (绕过随机，用于测试) */
  injectIntel(holderOpenid, overrides = {}) {
    const intel = {
      id: createId(),
      type: 'cargo',
      from_city: 'canton',
      to_city: 'calicut',
      reward: 2500,
      cost: 800,
      deadline: Date.now() + INTEL_DEADLINE_MS,
      holder: holderOpenid,
      story: '',
      status: 'active',
      createdAt: Date.now(),
      completedAt: null,
      ...overrides
    }
    this.intels[intel.id] = intel
    return intel
  }

  tavernBuy(openid, captainToken, _rng = Math.random) {
    const player = this._auth(openid, captainToken)
    if (player.code) return player
    if (player.status !== 'docked') return { code: 1, msg: '航行中无法进入酒馆' }

    const myIntels = Object.values(this.intels).filter(i => i.holder === player.openid && i.status === 'active')
    if (myIntels.length >= INTEL_HOLD_LIMIT) return { code: 1, msg: `情报槽已满（最多${INTEL_HOLD_LIMIT}份）` }

    const cost = INTEL_COST_MIN + Math.floor(_rng() * (INTEL_COST_MAX - INTEL_COST_MIN + 1))
    if (player.gold < cost) return { code: 1, msg: `金币不足——需要${cost}，只有${player.gold}` }

    player.gold -= cost
    const type = INTEL_TYPES[Math.floor(_rng() * INTEL_TYPES.length)]
    const candidateCities = Object.keys(CITIES).filter(c => c !== player.currentCity)
    const toCity = candidateCities[Math.floor(_rng() * candidateCities.length)]

    let reward
    switch (type) {
      case 'passenger': reward = 3500 + Math.floor(_rng() * 2001); break
      case 'discount':  reward = 1500 + Math.floor(_rng() * 1001); break
      default:          reward = INTEL_REWARD_MIN + Math.floor(_rng() * (INTEL_REWARD_MAX - INTEL_REWARD_MIN + 1)); break
    }

    const intel = {
      id: createId(), type, from_city: player.currentCity, to_city: toCity,
      reward, cost, deadline: Date.now() + INTEL_DEADLINE_MS,
      holder: player.openid, story: '', status: 'active',
      createdAt: Date.now(), completedAt: null
    }
    this.intels[intel.id] = intel
    return { code: 0, data: { intel, playerGold: player.gold } }
  }

  intelList(openid, captainToken) {
    const player = this._auth(openid, captainToken)
    if (player.code) return player
    this._expireIntels()
    return { code: 0, data: { intels: Object.values(this.intels).filter(i => i.holder === player.openid) } }
  }

  intelTransfer(openid, captainToken, intelId, targetOpenid) {
    const player = this._auth(openid, captainToken)
    if (player.code) return player
    if (!intelId || !targetOpenid) return { code: 1, msg: '缺少 intel_id 或 target_openid' }
    const intel = this.intels[intelId]
    if (!intel) return { code: 4, msg: '情报不存在' }
    if (intel.holder !== player.openid) return { code: 1, msg: '情报不属于你' }
    if (intel.status !== 'active') return { code: 1, msg: '情报已终态，无法转让' }
    const target = this.players[targetOpenid]
    if (!target) return { code: 4, msg: '目标船长不存在' }
    const targetIntels = Object.values(this.intels).filter(i => i.holder === targetOpenid && i.status === 'active')
    if (targetIntels.length >= INTEL_HOLD_LIMIT) return { code: 1, msg: '对方的情报槽已满' }
    intel.story = ''
    intel.holder = targetOpenid
    return { code: 0, data: { intel } }
  }

  intelStory(openid, captainToken, intelId, story) {
    const player = this._auth(openid, captainToken)
    if (player.code) return player
    if (!intelId || !story) return { code: 1, msg: '缺少 intel_id 或 story' }
    const intel = this.intels[intelId]
    if (!intel) return { code: 4, msg: '情报不存在' }
    if (intel.holder !== player.openid) return { code: 1, msg: '情报不属于你' }
    if (intel.status !== 'active') return { code: 1, msg: '情报已终态，无法修改' }
    intel.story = story.substring(0, 500)
    return { code: 0, data: { intel_id: intelId, story_len: intel.story.length } }
  }

  settleIntels(player) {
    const results = []
    const completableIntels = Object.values(this.intels).filter(
      i => i.holder === player.openid && i.to_city === player.currentCity && i.status === 'active'
    )
    for (const intel of completableIntels) {
      if (Date.now() > intel.deadline) {
        intel.status = 'expired'
        results.push({ intelId: intel.id, status: 'expired', reason: 'deadline_passed' })
        continue
      }
      if (intel.type === 'discount') {
        player.gold += intel.reward
        const cityDef = CITIES[intel.to_city]
        const giftItem = cityDef?.specialty?.[Math.floor(Math.random() * cityDef.specialty.length)] || 'tea'
        const giftAmount = 2 + Math.floor(Math.random() * 4)
        player.cargo[giftItem] = (player.cargo[giftItem] || 0) + giftAmount
        intel.status = 'completed'
        intel.completedAt = Date.now()
        results.push({ intelId: intel.id, type: 'discount', reward: intel.reward, giftItem, giftAmount, status: 'completed' })
      } else {
        player.gold += intel.reward
        intel.status = 'completed'
        intel.completedAt = Date.now()
        results.push({ intelId: intel.id, type: intel.type, reward: intel.reward, status: 'completed' })
      }
    }
    return results
  }

  arrive(openid, captainToken, _now = Date.now) {
    const player = this._auth(openid, captainToken)
    if (player.code) return player
    if (player.status === 'docked') return { code: 0, data: { status: 'docked', note: 'already_docked', settleResults: [], intelResults: [] } }
    if (player.sailingUntil && _now() < player.sailingUntil) return { code: 1, msg: '航行中，尚未抵达' }
    player.status = 'docked'
    player.currentCity = player.targetCity
    player.targetCity = null
    player.sailingUntil = null
    const intelResults = this.settleIntels(player)
    return { code: 0, data: { status: 'docked', city: player.currentCity, gold: player.gold, cargo: { ...player.cargo }, intelResults } }
  }

  move(openid, captainToken, targetCity, sailingMinutes = 1) {
    const player = this._auth(openid, captainToken)
    if (player.code) return player
    if (player.status === 'sailing') return { code: 1, msg: '已在航行中' }
    if (!CITIES[targetCity]) return { code: 4, msg: '目标城市不存在' }
    if (targetCity === player.currentCity) return { code: 1, msg: '已在目标城市' }
    player.status = 'sailing'
    player.targetCity = targetCity
    player.sailingUntil = Date.now() + sailingMinutes * 60 * 1000
    return { code: 0, data: { status: 'sailing', targetCity, sailingTime: sailingMinutes } }
  }
}

// ═══════════════════════════════════════════════════════════════
// 测试框架
// ═══════════════════════════════════════════════════════════════

let passed = 0, failed = 0
function assert(condition, label) {
  if (condition) { passed++; return true }
  console.error(`  FAIL: ${label}`)
  failed++; return false
}
function eq(a, b, label) { return assert(a === b, `${label} (expected=${JSON.stringify(b)}, got=${JSON.stringify(a)})`) }
function gt(a, b, label) { return assert(a > b, `${label} (${a} > ${b})`) }
function between(a, lo, hi, label) { return assert(a >= lo && a <= hi, `${label} (${lo} <= ${a} <= ${hi})`) }
function ok(val, label) { return assert(!!val, label) }

function test(name, fn) {
  console.log(`\n[${name}]`)
  fn()
}

// ═══════════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════════

// ─── 1. 直接注入 & 基础查询 ───────────────────────────────────

test('1. 注入情报 & 基础查询', () => {
  const sys = new IntelSystem()
  const p = createPlayer('cap_test', '测试')
  sys.players[p.openid] = p

  const intel = sys.injectIntel(p.openid, {
    type: 'cargo', to_city: 'calicut', reward: 3000, cost: 900
  })

  eq(intel.status, 'active', '新情报状态=active')
  eq(intel.holder, p.openid, '持有者正确')
  eq(intel.story, '', '初始无故事')
  ok(intel.deadline > Date.now(), '截止时间在未来')

  // 查询
  const list = sys.intelList(p.openid, p.captainToken)
  eq(list.code, 0, '查询成功')
  eq(list.data.intels.length, 1, '有1份情报')
  eq(list.data.intels[0].id, intel.id, '情报ID匹配')
})

// ─── 2. 购买情报 (真实随机) ────────────────────────────────────

test('2. 购买情报', () => {
  const sys = new IntelSystem()
  const p = createPlayer('cap_buy', '买家', 10000)
  sys.players[p.openid] = p
  const goldBefore = p.gold

  const r = sys.tavernBuy(p.openid, p.captainToken)
  eq(r.code, 0, '购买成功')
  ok(r.data.intel, '返回情报对象')
  assert(INTEL_TYPES.includes(r.data.intel.type), '类型合法')
  ok(Object.keys(CITIES).includes(r.data.intel.to_city), '目标城市合法')
  assert(r.data.intel.to_city !== p.currentCity, '目标≠当前城市')
  between(r.data.intel.cost, 800, 1200, '费用800-1200')
  between(r.data.intel.reward, 1500, 5500, '报酬1500-5500')
  eq(r.data.intel.from_city, p.currentCity, '出发城市正确')
  eq(r.data.intel.status, 'active', '状态=active')
  eq(r.data.intel.holder, p.openid, '持有者正确')
  ok(r.data.intel.deadline > Date.now(), '截止时间=+2小时')
  eq(r.data.playerGold, goldBefore - r.data.intel.cost, '金币返还正确')
  eq(p.gold, goldBefore - r.data.intel.cost, '玩家金币已扣')
})

// ─── 3. 持有上限 ──────────────────────────────────────────────

test('3. 持有上限 (3 active)', () => {
  const sys = new IntelSystem()
  const p = createPlayer('cap_full', '满载', 30000)
  sys.players[p.openid] = p

  for (let i = 0; i < 3; i++) {
    sys.injectIntel(p.openid, { to_city: 'venice', type: 'cargo' })
  }

  const active = Object.values(sys.intels).filter(i => i.holder === p.openid && i.status === 'active')
  eq(active.length, 3, '恰好3份active')

  // 第4份购买被拒
  const r = sys.tavernBuy(p.openid, p.captainToken)
  assert(r.code !== 0, '第4份被拒')
  ok(r.msg.includes('已满'), '提示情报槽已满')
})

// ─── 4. 拒绝场景 ──────────────────────────────────────────────

test('4. 拒绝场景', () => {
  const sys = new IntelSystem()

  // 4a: 航行中
  const pSail = createPlayer('cap_sail', '航行中')
  sys.players[pSail.openid] = pSail
  pSail.status = 'sailing'
  pSail.targetCity = 'venice'
  const r1 = sys.tavernBuy(pSail.openid, pSail.captainToken)
  assert(r1.code !== 0 && r1.msg.includes('航行中'), '航行中被拒')

  // 4b: 金币不足
  const pPoor = createPlayer('cap_poor', '穷人', 500)
  sys.players[pPoor.openid] = pPoor
  const r2 = sys.tavernBuy(pPoor.openid, pPoor.captainToken)
  assert(r2.code !== 0 && r2.msg.includes('金币不足'), '金币不足被拒')
  eq(pPoor.gold, 500, '金币未扣')

  // 4c: 玩家不存在
  const r3 = sys.tavernBuy('ghost', 'bad')
  eq(r3.code, 4, '不存在玩家 code=4')

  // 4d: 鉴权失败
  const pOk = createPlayer('cap_ok', '正常')
  sys.players[pOk.openid] = pOk
  const r4 = sys.tavernBuy(pOk.openid, 'wrong_token')
  eq(r4.code, 401, '鉴权失败 code=401')
})

// ─── 5. 撰写故事 ──────────────────────────────────────────────

test('5. 撰写故事', () => {
  const sys = new IntelSystem()
  const p = createPlayer('cap_story', '作家')
  sys.players[p.openid] = p
  const intel = sys.injectIntel(p.openid)

  // 正常写
  const story = '在酒馆遇到一位神秘商人，他说卡利卡特的胡椒即将涨价。我花800金币买下这份情报。'
  const r = sys.intelStory(p.openid, p.captainToken, intel.id, story)
  eq(r.code, 0, '撰写成功')
  eq(r.data.story_len, story.length, '返回长度正确')
  eq(sys.intels[intel.id].story, story, '故事已存储')

  // 500字截断
  const long = 'x'.repeat(600)
  sys.intelStory(p.openid, p.captainToken, intel.id, long)
  eq(sys.intels[intel.id].story.length, 500, '故事截断至500字')

  // 非持有者被拒
  const other = createPlayer('cap_other', '路人')
  sys.players[other.openid] = other
  const r3 = sys.intelStory(other.openid, other.captainToken, intel.id, 'hack')
  assert(r3.code !== 0, '非持有者被拒')

  // 空故事被拒
  const r4 = sys.intelStory(p.openid, p.captainToken, intel.id, '')
  assert(r4.code !== 0, '空故事被拒')

  // 已完成情报不可修改
  sys.intels[intel.id].status = 'completed'
  const r5 = sys.intelStory(p.openid, p.captainToken, intel.id, 'after')
  assert(r5.code !== 0, '已完成情报不可修改')
})

// ─── 6. 情报转让 ──────────────────────────────────────────────

test('6. 情报转让', () => {
  const sys = new IntelSystem()
  const pA = createPlayer('cap_a', '转出方')
  const pB = createPlayer('cap_b', '接收方')
  sys.players[pA.openid] = pA
  sys.players[pB.openid] = pB

  const intel = sys.injectIntel(pA.openid, { story: '重要商业机密！' })

  // 正常转让
  const r = sys.intelTransfer(pA.openid, pA.captainToken, intel.id, pB.openid)
  eq(r.code, 0, '转让成功')
  eq(sys.intels[intel.id].holder, pB.openid, '持有者已变更')
  eq(sys.intels[intel.id].story, '', '故事已清除')

  // 新持有者可写故事
  sys.intelStory(pB.openid, pB.captainToken, intel.id, 'B的新发现')
  eq(sys.intels[intel.id].story, 'B的新发现', '新持有者故事生效')

  // 原持有者不可再操作
  const r2 = sys.intelTransfer(pA.openid, pA.captainToken, intel.id, pB.openid)
  assert(r2.code !== 0, '原持有者不可再转让')

  // 转让已完成情报被拒
  sys.intels[intel.id].status = 'completed'
  const r3 = sys.intelTransfer(pB.openid, pB.captainToken, intel.id, pA.openid)
  assert(r3.code !== 0, '已完成不可转让')

  // 目标玩家不存在
  const intel2 = sys.injectIntel(pB.openid)
  const r4 = sys.intelTransfer(pB.openid, pB.captainToken, intel2.id, 'ghost')
  assert(r4.code !== 0, '目标不存在被拒')

  // 目标槽满
  const pFull = createPlayer('cap_full', '满槽')
  sys.players[pFull.openid] = pFull
  for (let i = 0; i < 3; i++) sys.injectIntel(pFull.openid)
  const intel3 = sys.injectIntel(pB.openid)
  const r5 = sys.intelTransfer(pB.openid, pB.captainToken, intel3.id, pFull.openid)
  assert(r5.code !== 0 && r5.msg.includes('已满'), '目标槽满被拒')
})

// ─── 7. 抵达完成 cargo 类型 ───────────────────────────────────

test('7. 抵达完成 cargo 情报', () => {
  const sys = new IntelSystem()
  const p = createPlayer('cap_go', '赶路人', 20000, 'canton')
  sys.players[p.openid] = p
  const goldBefore = p.gold

  const intel = sys.injectIntel(p.openid, {
    type: 'cargo', to_city: 'venice', reward: 2800, cost: 1000, story: '威尼斯香料紧缺'
  })

  // 航行→抵达
  sys.move(p.openid, p.captainToken, 'venice', 0)
  const arrive = sys.arrive(p.openid, p.captainToken)

  eq(arrive.code, 0, '抵达成功')
  eq(arrive.data.city, 'venice', '到达威尼斯')
  eq(arrive.data.intelResults.length, 1, '1份情报结算')
  eq(arrive.data.intelResults[0].status, 'completed', 'status=completed')
  eq(arrive.data.intelResults[0].reward, 2800, '报酬2800')
  eq(arrive.data.intelResults[0].type, 'cargo', 'type=cargo')

  // 金币=原金币+报酬 (buy时没扣金币，因为我们是直接injected)
  eq(arrive.data.gold, goldBefore + 2800, `金币 ${goldBefore} + 2800 = ${goldBefore + 2800}`)

  // 系统状态
  eq(sys.intels[intel.id].status, 'completed', '系统状态=completed')
  ok(sys.intels[intel.id].completedAt, '有完成时间戳')
  eq(sys.intels[intel.id].story, '威尼斯香料紧缺', '故事保留')
})

// ─── 8. 抵达完成 discount 类型 (附赠货物) ─────────────────────

test('8. discount 情报附赠货物', () => {
  const sys = new IntelSystem()
  const p = createPlayer('cap_disc', '折扣猎手', 20000, 'canton')
  sys.players[p.openid] = p

  sys.injectIntel(p.openid, { type: 'discount', to_city: 'calicut', reward: 2000, cost: 1000 })

  sys.move(p.openid, p.captainToken, 'calicut', 0)
  const arrive = sys.arrive(p.openid, p.captainToken)

  eq(arrive.data.intelResults.length, 1, '1份结算')
  const r = arrive.data.intelResults[0]
  eq(r.type, 'discount', 'type=discount')
  eq(r.reward, 2000, '金币报酬2000')

  // 验证赠品
  ok(r.giftItem, `有赠品: ${r.giftItem}`)
  assert(['spice', 'pepper', 'cotton'].includes(r.giftItem), `赠品是卡利卡特特产: ${r.giftItem}`)
  between(r.giftAmount, 2, 5, `赠品数量2-5: ${r.giftAmount}`)
  ok(p.cargo[r.giftItem] >= r.giftAmount, `货舱有赠品 ${r.giftItem}x${r.giftAmount}`)

  console.log(`    discount情报: 金币+${r.reward}, 赠品 ${r.giftItem}x${r.giftAmount}`)
})

// ─── 9. passenger 类型 ────────────────────────────────────────

test('9. passenger 情报 (高报酬)', () => {
  const sys = new IntelSystem()
  const p = createPlayer('cap_pax', '客运', 20000, 'canton')
  sys.players[p.openid] = p
  const goldBefore = p.gold

  sys.injectIntel(p.openid, { type: 'passenger', to_city: 'london', reward: 4500, cost: 1100 })

  sys.move(p.openid, p.captainToken, 'london', 0)
  const arrive = sys.arrive(p.openid, p.captainToken)

  eq(arrive.data.intelResults.length, 1, '1份结算')
  eq(arrive.data.intelResults[0].type, 'passenger', 'type=passenger')
  eq(arrive.data.intelResults[0].reward, 4500, '报酬4500')
  eq(arrive.data.gold, goldBefore + 4500, '金币增加4500')

  // passenger 无赠品
  eq(Object.keys(arrive.data.cargo).length, 0, 'passenger无赠品')
})

// ─── 10. 情报过期 ─────────────────────────────────────────────

test('10. 情报过期', () => {
  const sys = new IntelSystem()
  const p = createPlayer('cap_late', '迟到', 20000, 'canton')
  sys.players[p.openid] = p

  // 注入即将过期的情报 (已过期)
  sys.injectIntel(p.openid, { to_city: 'venice', deadline: Date.now() - 5000 })

  // _expireIntels 标记
  sys._expireIntels()
  const intels = Object.values(sys.intels)
  eq(intels[0].status, 'expired', '过期情报 status=expired')

  // 抵达目标 — 过期情报不结算
  sys.move(p.openid, p.captainToken, 'venice', 0)
  const arrive = sys.arrive(p.openid, p.captainToken)

  const completed = arrive.data.intelResults.filter(r => r.status === 'completed')
  eq(completed.length, 0, '过期情报不产生completed')

  // settleIntels 中走到 deadline 检查
  const expired = arrive.data.intelResults.filter(r => r.status === 'expired')
  // 注: _expireIntels 已在前面设置status=expired, 但 settleIntels 只处理 status==='active' 的情报
  // 所以不会出现在结果中
  eq(arrive.data.intelResults.length, 0, '已过期情报不在结算列表')
})

// ─── 11. 错误城市不结算 ───────────────────────────────────────

test('11. 错误城市不结算', () => {
  const sys = new IntelSystem()
  const p = createPlayer('cap_wrong', '迷路', 20000, 'canton')
  sys.players[p.openid] = p

  sys.injectIntel(p.openid, { to_city: 'calicut', reward: 3000 })
  sys.injectIntel(p.openid, { to_city: 'venice', reward: 3500 })

  // 抵达 london (不是任何情报的目标)
  sys.move(p.openid, p.captainToken, 'london', 0)
  const arrive = sys.arrive(p.openid, p.captainToken)

  eq(arrive.data.intelResults.length, 0, '错误城市不结算')
  // 情报仍为 active
  const active = Object.values(sys.intels).filter(i => i.status === 'active')
  eq(active.length, 2, '2份情报仍为active')
})

// ─── 12. 同城多份情报一次结算 ─────────────────────────────────

test('12. 同城多份情报一次结算', () => {
  const sys = new IntelSystem()
  const p = createPlayer('cap_multi', '多任务', 50000, 'canton')
  sys.players[p.openid] = p

  sys.injectIntel(p.openid, { type: 'cargo', to_city: 'genoa', reward: 2500 })
  sys.injectIntel(p.openid, { type: 'passenger', to_city: 'genoa', reward: 4000 })
  sys.injectIntel(p.openid, { type: 'discount', to_city: 'genoa', reward: 1800 })

  sys.move(p.openid, p.captainToken, 'genoa', 0)
  const arrive = sys.arrive(p.openid, p.captainToken)

  const completed = arrive.data.intelResults.filter(r => r.status === 'completed')
  eq(completed.length, 3, '3份同时完成')
  eq(completed.reduce((s, r) => s + r.reward, 0), 2500 + 4000 + 1800, '总报酬=8300')
  eq(p.gold, 50000 + 2500 + 4000 + 1800, '金币正确累加')
})

// ─── 13. 混合场景 ─────────────────────────────────────────────

test('13. 混合场景: 过期1 + 完成1 + 转让1', () => {
  const sys = new IntelSystem()
  const pA = createPlayer('cap_mix_a', '混合A', 30000, 'canton')
  const pB = createPlayer('cap_mix_b', '混合B', 30000, 'venice')
  sys.players[pA.openid] = pA
  sys.players[pB.openid] = pB
  const goldA_before = pA.gold

  // A 有3份情报
  const i1 = sys.injectIntel(pA.openid, { type: 'cargo', to_city: 'calicut', reward: 2600, cost: 900, deadline: Date.now() - 1000 })
  const i2 = sys.injectIntel(pA.openid, { type: 'cargo', to_city: 'venice', reward: 3000, cost: 1000 })
  const i3 = sys.injectIntel(pA.openid, { type: 'passenger', to_city: 'london', reward: 4200, cost: 1100 })

  // i1 立即过期
  sys._expireIntels()
  eq(sys.intels[i1.id].status, 'expired', '情报1过期')

  // i3 转让给B
  const transfer = sys.intelTransfer(pA.openid, pA.captainToken, i3.id, pB.openid)
  eq(transfer.code, 0, '情报3转让给B')
  eq(sys.intels[i3.id].holder, pB.openid, 'i3归属B')

  // A 航行到 venice → 完成 i2
  sys.move(pA.openid, pA.captainToken, 'venice', 0)
  const arriveA = sys.arrive(pA.openid, pA.captainToken)
  const completedA = arriveA.data.intelResults.filter(r => r.status === 'completed')
  eq(completedA.length, 1, 'A完成1份')
  eq(completedA[0].intelId, i2.id, '完成的是i2')
  eq(completedA[0].reward, 3000, '报酬3000')

  // B 航行到 london → 完成 i3
  sys.move(pB.openid, pB.captainToken, 'london', 0)
  const arriveB = sys.arrive(pB.openid, pB.captainToken)
  const completedB = arriveB.data.intelResults.filter(r => r.status === 'completed')
  eq(completedB.length, 1, 'B完成1份')
  eq(completedB[0].intelId, i3.id, '完成的是i3')
  eq(completedB[0].reward, 4200, '报酬4200')

  // 汇总: i1过期, i2→A完成(+3000), i3→B完成(+4200)
  console.log(`    A: 过期1 + 完成1(+3000), B: 完成1(+4200 from转让)`)
})

// ─── 14. 抵达时 deadline 检查 ─────────────────────────────────

test('14. 抵达时 deadline 未过则正常完成', () => {
  const sys = new IntelSystem()
  const p = createPlayer('cap_ontime', '刚好', 20000, 'canton')
  sys.players[p.openid] = p
  const goldBefore = p.gold

  // 情报 deadline 设得很远
  sys.injectIntel(p.openid, { to_city: 'venice', reward: 3000, deadline: Date.now() + 3600000 })

  // 航行0分钟 (立即到达)
  sys.move(p.openid, p.captainToken, 'venice', 0)
  const arrive = sys.arrive(p.openid, p.captainToken)

  eq(arrive.code, 0, '抵达成功')
  const completed = arrive.data.intelResults.filter(r => r.status === 'completed')
  eq(completed.length, 1, 'deadline未过 → 完成')
  eq(p.gold, goldBefore + 3000, '报酬到位')
})

// ─── 15. 边界 ─────────────────────────────────────────────────

test('15. 边界', () => {
  const sys = new IntelSystem()
  const p = createPlayer('cap_edge', '边缘', 20000)
  sys.players[p.openid] = p

  // 不存在的情报ID
  const r1 = sys.intelStory(p.openid, p.captainToken, 'nonexistent', 'test')
  eq(r1.code, 4, '不存在情报 code=4')

  // 不存在的情报转让
  const r2 = sys.intelTransfer(p.openid, p.captainToken, 'nonexistent', p.openid)
  eq(r2.code, 4, '不存在情报转让 code=4')

  // 情报列表却玩家不存在
  const r3 = sys.intelList('ghost', 'x')
  eq(r3.code, 4, '不存在玩家查列表 code=4')

  // empty string openid
  const r4 = sys.intelList('', 'x')
  assert(r4.code !== 0, '空openid被拒')
})

// ═══════════════════════════════════════════════════════════════
// 结果汇总
// ═══════════════════════════════════════════════════════════════

const total = passed + failed
console.log(`\n${'='.repeat(60)}`)
console.log(`酒馆情报测试完成: ${total} 项, 通过 ${passed}, 失败 ${failed}`)
console.log(`${'='.repeat(60)}`)

if (failed > 0) {
  console.error(`\n${failed} 项测试失败!`)
  process.exit(1)
} else {
  console.log(`\n全部通过!`)
}
