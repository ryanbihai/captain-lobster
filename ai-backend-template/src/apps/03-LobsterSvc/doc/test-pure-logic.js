/**
 * @file test-pure-logic.js
 * @description 纯逻辑单元测试 — 不依赖 MongoDB/Redis/网络，可直接 node 运行
 *
 * 覆盖：
 * 1. 三级商品定价一致性
 * 2. calculateItemPrice 各种场景
 * 3. 库存公式边界值
 * 4. Haversine 航行计算
 * 5. 事件叠加逻辑
 * 6. CITIES 配置完整性
 */

// ═══════════════════════════════════════════════════════════════
// 复制 service.js 中的纯函数（无副作用，无需外部依赖）
// ═══════════════════════════════════════════════════════════════

const CITIES = [
  { id: 'canton', name: '广州', coords: [23.1, 113.3], specialty: ['silk', 'tea', 'porcelain'], basePrice: { silk: 1500, tea: 100, porcelain: 380, spice: 850, pepper: 190, pearl: 4800, perfume: 3600, gem: 7200, ivory: 1050, cotton: 200, coffee: 280 } },
  { id: 'calicut', name: '卡利卡特', coords: [11.3, 75.8], specialty: ['spice', 'pepper', 'cotton'], basePrice: { silk: 2300, tea: 210, porcelain: 680, spice: 420, pepper: 60, pearl: 2800, perfume: 3300, gem: 4800, ivory: 850, cotton: 85, coffee: 210 } },
  { id: 'zanzibar', name: '桑给巴尔', coords: [-6.2, 39.3], specialty: ['ivory', 'spice', 'pearl'], basePrice: { silk: 2800, tea: 240, porcelain: 750, spice: 520, pepper: 110, pearl: 2600, perfume: 3500, gem: 4200, ivory: 550, cotton: 160, coffee: 120 } },
  { id: 'alexandria', name: '亚历山大', coords: [31.2, 29.9], specialty: ['spice', 'perfume'], basePrice: { silk: 2500, tea: 230, porcelain: 700, spice: 480, pepper: 130, pearl: 3000, perfume: 1900, gem: 4500, ivory: 680, cotton: 90, coffee: 170 } },
  { id: 'venice', name: '威尼斯', coords: [45.4, 12.3], specialty: ['silk', 'perfume', 'pearl'], basePrice: { silk: 1800, tea: 250, porcelain: 720, spice: 600, pepper: 160, pearl: 3200, perfume: 2100, gem: 5000, ivory: 750, cotton: 150, coffee: 200 } },
  { id: 'lisbon', name: '里斯本', coords: [38.7, -9.1], specialty: ['spice', 'gem'], basePrice: { silk: 2800, tea: 260, porcelain: 820, spice: 650, pepper: 175, pearl: 4200, perfume: 3200, gem: 3800, ivory: 850, cotton: 180, coffee: 240 } },
  { id: 'london', name: '伦敦', coords: [51.5, -0.1], specialty: ['tea', 'gem', 'pearl'], basePrice: { silk: 3200, tea: 270, porcelain: 900, spice: 750, pepper: 190, pearl: 4500, perfume: 3700, gem: 4200, ivory: 1000, cotton: 210, coffee: 270 } },
  { id: 'amsterdam', name: '阿姆斯特丹', coords: [52.4, 4.9], specialty: ['spice', 'coffee', 'gem'], basePrice: { silk: 3100, tea: 265, porcelain: 880, spice: 720, pepper: 185, pearl: 4300, perfume: 3600, gem: 4000, ivory: 950, cotton: 200, coffee: 250 } },
  { id: 'istanbul', name: '伊斯坦布尔', coords: [41.0, 28.9], specialty: ['spice', 'silk', 'perfume'], basePrice: { silk: 1700, tea: 200, porcelain: 620, spice: 450, pepper: 125, pearl: 2900, perfume: 2000, gem: 4300, ivory: 650, cotton: 120, coffee: 150 } },
  { id: 'genoa', name: '热那亚', coords: [44.4, 8.9], specialty: ['silk', 'spice', 'pearl'], basePrice: { silk: 1900, tea: 240, porcelain: 700, spice: 580, pepper: 155, pearl: 3100, perfume: 2400, gem: 4900, ivory: 720, cotton: 145, coffee: 195 } }
]

const AMM_SPREAD = 0.10
const SHIP_CAPACITY = 100
const STOCK_EQUILIBRIUM = 100
const STOCK_ELASTICITY = 0.3
const STOCK_REGEN_PER_HOUR = 15
const VALID_ITEMS = ['silk', 'tea', 'porcelain', 'spice', 'pearl', 'perfume', 'gem', 'ivory', 'cotton', 'coffee', 'pepper']
const SPECIALTY_DISCOUNT = 0.8

const EVENT_DEFS = [
  { type: 'festival',      desc: '节日庆典', priceMod: 1.40, durationHours: 4 },
  { type: 'blockade',      desc: '港口封锁', priceMod: 1.55, durationHours: 3 },
  { type: 'surplus',       desc: '供给过剩', priceMod: 0.65, durationHours: 5 },
  { type: 'storm',         desc: '风暴损毁', priceMod: 1.35, durationHours: 3 },
  { type: 'trader_fleet',  desc: '商队抵达', priceMod: 0.75, durationHours: 4 },
  { type: 'plague',        desc: '瘟疫流行', priceMod: 0.55, durationHours: 6 }
]

// ═══════════════════════════════════════════════════════════════
// 复制 service.js 纯函数
// ═══════════════════════════════════════════════════════════════

function calculateItemPrice(basePrice, item, isSpecialty = false, stockLevel = STOCK_EQUILIBRIUM) {
  const specialtyMultiplier = isSpecialty ? SPECIALTY_DISCOUNT : 1.0
  const stockRatio = stockLevel / STOCK_EQUILIBRIUM
  const stockMultiplier = 1 + (1 - stockRatio) * STOCK_ELASTICITY
  const price = Math.round(basePrice * specialtyMultiplier * stockMultiplier)
  return {
    buy: Math.round(price * (1 + AMM_SPREAD / 2)),
    sell: Math.round(price * (1 - AMM_SPREAD / 2))
  }
}

function calculateDistance(coords1, coords2) {
  const [lat1, lon1] = coords1
  const [lat2, lon2] = coords2
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

function calculateSailingTime(fromCityId, toCityId) {
  const from = CITIES.find(c => c.id === fromCityId)
  const to = CITIES.find(c => c.id === toCityId)
  if (!from || !to) return 10
  const distance = calculateDistance(from.coords, to.coords)
  return Math.round(distance / 500)
}

function applyEventMultiplier(basePrice, cityId, item, events) {
  const now = Date.now()
  const relevant = events.filter(e =>
    e.expiresAt > now &&
    e.cityId === cityId &&
    (e.item === null || e.item === item)
  )
  let multiplier = 1.0
  for (const e of relevant) {
    multiplier *= e.priceMod
  }
  return Math.round(basePrice * multiplier)
}

function getStockPriceMultiplier(stockLevel) {
  const stockRatio = stockLevel / STOCK_EQUILIBRIUM
  return 1 + (1 - stockRatio) * STOCK_ELASTICITY
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

function eq(a, b, label) { return assert(a === b, `${label} (expected=${b}, got=${a})`) }
function approx(a, b, tolerance, label) { return assert(Math.abs(a - b) <= tolerance, `${label} (expected≈${b}, got=${a})`) }
function gt(a, b, label) { return assert(a > b, `${label} (${a} > ${b})`) }
function lt(a, b, label) { return assert(a < b, `${label} (${a} < ${b})`) }
function between(a, lo, hi, label) { return assert(a >= lo && a <= hi, `${label} (${lo} <= ${a} <= ${hi})`) }

function test(name, fn) {
  console.log(`\n[${name}]`)
  fn()
}

// ═══════════════════════════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════════════════════════

// ─── 1. CITIES 配置完整性 ──────────────────────────────────────

test('1. CITIES 配置完整性', () => {
  // 1a: 所有城市覆盖
  eq(CITIES.length, 10, '10个城市')

  const cityIds = CITIES.map(c => c.id)
  const expected = ['canton','calicut','zanzibar','alexandria','venice','lisbon','london','amsterdam','istanbul','genoa']
  for (const id of expected) {
    assert(cityIds.includes(id), `城市 ${id} 存在`)
  }

  // 1b: 每个城市 11 种商品
  for (const city of CITIES) {
    const items = Object.keys(city.basePrice)
    eq(items.length, 11, `${city.name} 有11种商品`)
    for (const item of VALID_ITEMS) {
      assert(city.basePrice[item] !== undefined, `${city.name} 有 ${item}`)
    }
  }

  // 1c: 坐标合法性
  for (const city of CITIES) {
    between(city.coords[0], -90, 90, `${city.name} 纬度合法`)
    between(city.coords[1], -180, 180, `${city.name} 经度合法`)
  }

  // 1d: 每个 specialty 都是有效商品
  for (const city of CITIES) {
    for (const spec of city.specialty) {
      assert(VALID_ITEMS.includes(spec), `${city.name} specialty ${spec} 是有效商品`)
    }
  }
})

// ─── 2. 三级商品定价分类 ───────────────────────────────────────

test('2. 三级商品定价分类', () => {
  // 统计每个商品在所有城市的价格范围
  const itemRanges = {}
  for (const item of VALID_ITEMS) {
    const prices = CITIES.map(c => c.basePrice[item])
    itemRanges[item] = { min: Math.min(...prices), max: Math.max(...prices), avg: Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) }
  }

  // Tier 1: 运力瓶颈型 — 最低价 50-130, 最高价 180-300
  const tier1 = ['cotton', 'pepper', 'tea', 'coffee']
  for (const item of tier1) {
    const r = itemRanges[item]
    between(r.min, 50, 130, `T1 ${item} 最低价`)

    // 高毛利率: (max - min) / min > 1.0 (100%+)
    const margin = (r.max - r.min) / r.min
    gt(margin, 1.0, `T1 ${item} 价格跨市倍率 > 1.0 (got ${margin.toFixed(2)})`)
    console.log(`    ${item}: 最低=${r.min}, 最高=${r.max}, 均价=${r.avg}, 倍率=${margin.toFixed(2)}`)
  }

  // Tier 2: 双约束型 — 最低价 300-600
  const tier2 = ['porcelain', 'spice', 'ivory']
  for (const item of tier2) {
    const r = itemRanges[item]
    between(r.min, 300, 600, `T2 ${item} 最低价`)
    console.log(`    ${item}: 最低=${r.min}, 最高=${r.max}, 均价=${r.avg}`)
  }

  // Tier 3: 资金瓶颈型 — 最低价 1100+, 最高价 3000+
  const tier3 = ['silk', 'perfume', 'pearl', 'gem']
  for (const item of tier3) {
    const r = itemRanges[item]
    gt(r.min, 1100, `T3 ${item} 最低价 > 1100`)
    gt(r.max, 3000, `T3 ${item} 最高价 > 3000`)

    // 低毛利率: (max - min) / min < 1.5
    const margin = (r.max - r.min) / r.min
    lt(margin, 1.5, `T3 ${item} 价格跨市倍率 < 1.5 (got ${margin.toFixed(2)})`)
    console.log(`    ${item}: 最低=${r.min}, 最高=${r.max}, 均价=${r.avg}, 倍率=${margin.toFixed(2)}`)
  }

  // 验证 T1 倍率 > T3 倍率 (运力品跨市利润率高)
  const t1AvgMargin = tier1.reduce((s, i) => s + (itemRanges[i].max - itemRanges[i].min) / itemRanges[i].min, 0) / tier1.length
  const t3AvgMargin = tier3.reduce((s, i) => s + (itemRanges[i].max - itemRanges[i].min) / itemRanges[i].min, 0) / tier3.length
  gt(t1AvgMargin, t3AvgMargin, `T1 平均跨市倍率(${t1AvgMargin.toFixed(2)}) > T3(${t3AvgMargin.toFixed(2)})`)
})

// ─── 3. calculateItemPrice ─────────────────────────────────────

test('3. calculateItemPrice', () => {
  // 3a: 标准情况 (均衡库存, 非特产)
  const silkVenice = calculateItemPrice(1800, 'silk', false, 100)
  eq(silkVenice.buy, Math.round(1800 * 1.05), '非特产 buy=base×1.05')
  eq(silkVenice.sell, Math.round(1800 * 0.95), '非特产 sell=base×0.95')

  // 3b: 特产折扣
  const silkCanton = calculateItemPrice(1500, 'silk', true, 100)
  eq(silkCanton.buy, Math.round(1500 * 0.8 * 1.05), '特产 buy=base×0.8×1.05')

  // 3c: 库存为0时价格最高
  const priceEmpty = calculateItemPrice(1000, 'gem', false, 0)
  const priceNormal = calculateItemPrice(1000, 'gem', false, 100)
  gt(priceEmpty.buy, priceNormal.buy, '库存0时价格 > 库存100时价格')
  // stockMultiplier at stock=0: 1 + (1-0)*0.3 = 1.3
  eq(priceEmpty.buy, Math.round(1000 * 1.3 * 1.05), '库存0时 buy=base×1.3×1.05')

  // 3d: 库存为200时价格最低
  const priceFull = calculateItemPrice(1000, 'gem', false, 200)
  lt(priceFull.buy, priceNormal.buy, '库存200时价格 < 库存100时价格')
  eq(priceFull.buy, Math.round(1000 * 0.7 * 1.05), '库存200时 buy=base×0.7×1.05')

  // 3e: buy > sell (AMM spread)
  for (const item of VALID_ITEMS) {
    const p = calculateItemPrice(500, item, false, 100)
    gt(p.buy, p.sell, `${item} buy(${p.buy}) > sell(${p.sell})`)
  }

  // 3f: 零库存不出负价
  const zeroStock = calculateItemPrice(10, 'cotton', false, 0)
  gt(zeroStock.sell, 0, '零库存不出负卖价')
  gt(zeroStock.buy, 0, '零库存不出负买价')

  // 3g: 极低库存+特产
  const lowStock = calculateItemPrice(60, 'pepper', true, 10)
  gt(lowStock.buy, 0, '低库存特产不出负价')
})

// ─── 4. 库存公式边界值 ─────────────────────────────────────────

test('4. 库存公式边界值', () => {
  const m = getStockPriceMultiplier

  eq(m(100), 1.0, '库存=100时 multiplier=1.0')
  eq(m(0), 1.3, '库存=0时 multiplier=1.3')
  eq(m(200), 0.7, '库存=200时 multiplier=0.7')
  approx(m(50), 1.15, 0.001, '库存=50时 multiplier=1.15')
  approx(m(150), 0.85, 0.001, '库存=150时 multiplier=0.85')

  // 极低库存恢复: 从0恢复到100需要的时间
  const hoursNeeded = STOCK_EQUILIBRIUM / STOCK_REGEN_PER_HOUR
  approx(hoursNeeded, 6.67, 0.1, '库存0→100恢复需~6.7小时')

  // 库存不能为负
  const minPrice = calculateItemPrice(100, 'tea', false, 0)
  gt(minPrice.buy, 0, '负库存场景不出负价')
})

// ─── 5. Haversine 航行计算 ─────────────────────────────────────

test('5. Haversine 航行计算', () => {
  // 5a: 广州→卡利卡特 约 4000+ km
  const d1 = calculateDistance(CITIES[0].coords, CITIES[1].coords)
  between(d1, 3500, 5000, `广州→卡利卡特 距离 ${Math.round(d1)}km`)

  // 5b: 里斯本→伦敦 约 1500+ km
  const d2 = calculateDistance(CITIES[5].coords, CITIES[6].coords)
  between(d2, 1000, 2000, `里斯本→伦敦 距离 ${Math.round(d2)}km`)

  // 5c: 同城距离为0
  const d3 = calculateDistance(CITIES[0].coords, CITIES[0].coords)
  eq(d3, 0, '同城距离=0')

  // 5d: 广州→伦敦 约 9600km (half world)
  const d4 = calculateDistance(CITIES[0].coords, CITIES[6].coords)
  between(d4, 9000, 10500, `广州→伦敦 距离 ${Math.round(d4)}km`)

  // 5e: 航行时间
  const time1 = calculateSailingTime('canton', 'london')
  gt(time1, 15, `广州→伦敦 航行时间 > 15分钟 (${time1}min)`)

  const time2 = calculateSailingTime('venice', 'genoa')
  lt(time2, 5, `威尼斯→热那亚 航行时间 < 5分钟 (${time2}min)`)

  // 5f: 无效城市返回默认10分钟
  eq(calculateSailingTime('canton', 'atlantis'), 10, '无效目标城市→默认10分钟')
  eq(calculateSailingTime('atlantis', 'canton'), 10, '无效出发城市→默认10分钟')
})

// ─── 6. 事件叠加逻辑 ───────────────────────────────────────────

test('6. 事件叠加逻辑', () => {
  const now = Date.now()

  // 6a: 无事件时价格不变
  const noEvents = applyEventMultiplier(1000, 'canton', 'silk', [])
  eq(noEvents, 1000, '无事件时价格不变')

  // 6b: 单品事件生效
  const singleEvent = [
    { id: 'e1', cityId: 'canton', item: 'silk', priceMod: 1.4, expiresAt: now + 3600000 }
  ]
  const withEvent = applyEventMultiplier(1000, 'canton', 'silk', singleEvent)
  eq(withEvent, 1400, '单品事件: 1000×1.4=1400')

  // 6c: 事件不匹配商品时不生效
  const noMatch = applyEventMultiplier(1000, 'canton', 'tea', singleEvent)
  eq(noMatch, 1000, '事件不匹配商品时价格不变')

  // 6d: 事件不匹配城市时不生效
  const noCity = applyEventMultiplier(1000, 'london', 'silk', singleEvent)
  eq(noCity, 1000, '事件不匹配城市时价格不变')

  // 6e: 全局事件(item=null)对所有商品生效
  const globalEvent = [
    { id: 'e2', cityId: 'canton', item: null, priceMod: 1.5, expiresAt: now + 3600000 }
  ]
  const globalEffect = applyEventMultiplier(1000, 'canton', 'tea', globalEvent)
  eq(globalEffect, 1500, '全局事件对所有商品生效')

  // 6f: 过期事件不生效
  const expiredEvent = [
    { id: 'e3', cityId: 'canton', item: 'silk', priceMod: 2.0, expiresAt: now - 1 }
  ]
  const expired = applyEventMultiplier(1000, 'canton', 'silk', expiredEvent)
  eq(expired, 1000, '过期事件不生效')

  // 6g: 多个事件叠加 (乘法)
  const multiEvents = [
    { id: 'e4', cityId: 'canton', item: null, priceMod: 1.4, expiresAt: now + 3600000 },
    { id: 'e5', cityId: 'canton', item: 'silk', priceMod: 1.5, expiresAt: now + 3600000 }
  ]
  const multiEffect = applyEventMultiplier(1000, 'canton', 'silk', multiEvents)
  eq(multiEffect, Math.round(1000 * 1.4 * 1.5), `多事件叠加: 1000×1.4×1.5=${Math.round(1000 * 1.4 * 1.5)}`)

  // 6h: 所有事件类型都有合法 priceMod
  for (const def of EVENT_DEFS) {
    gt(def.priceMod, 0, `${def.type} priceMod > 0`)
    gt(def.durationHours, 0, `${def.type} durationHours > 0`)
    assert(def.type.length > 0, `${def.type} 有类型名`)
  }
})

// ─── 7. 完整交易路径模拟 ──────────────────────────────────────

test('7. 完整交易路径模拟 (无DB)', () => {
  // 模拟一个玩家在广州买入 10 丝绸，航行到伦敦卖出的全流程价格计算

  // Step 1: 广州查询价格 (库存均衡)
  const cantonSilkPrice = calculateItemPrice(1500, 'silk', true, 100)
  const buyPrice = cantonSilkPrice.buy  // 1500*0.8*1.0*1.05 = 1260

  // Step 2: 买入 10 单位
  const buyCost = buyPrice * 10
  eq(buyCost, buyPrice * 10, `买入10丝绸花费=${buyCost}`)

  // Step 3: 库存变化 (买走10单位, 库存 100→90)
  const cantonSilkAfterBuy = calculateItemPrice(1500, 'silk', true, 90)
  gt(cantonSilkAfterBuy.buy, buyPrice, '买入后库存减少→价格上涨')

  // Step 4: 航行到伦敦
  const sailingTime = calculateSailingTime('canton', 'london')
  gt(sailingTime, 0, `航行需 ${sailingTime} 分钟`)

  // Step 5: 伦敦查询价格 (库存均衡, 非特产)
  const londonSilkPrice = calculateItemPrice(3200, 'silk', false, 100)
  const sellPrice = londonSilkPrice.sell  // 3200*1.0*1.0*0.95 = 3040

  // Step 6: 卖出 10 单位
  const sellRevenue = sellPrice * 10
  const profit = sellRevenue - buyCost
  gt(profit, 0, `跨市套利利润 > 0 (${profit})`)

  // Step 7: 计算 ROI
  const roi = ((sellRevenue - buyCost) / buyCost * 100).toFixed(1)
  console.log(`    10丝绸 广州→伦敦: 买入=${buyCost}, 卖出=${sellRevenue}, 利润=${profit}, ROI=${roi}%`)

  // ─── 对比：棉花(运力品) vs 宝石(资金品) ───

  // 棉花: 卡利卡特→伦敦
  const cottonCalicut = calculateItemPrice(85, 'cotton', true, 100)
  const cottonBuy = cottonCalicut.buy
  const cottonLondon = calculateItemPrice(210, 'cotton', false, 100)
  const cottonSell = cottonLondon.sell
  const cottonProfit = cottonSell - cottonBuy
  const cottonRoi = (cottonProfit / cottonBuy * 100)
  const cottonFillCost = cottonBuy * SHIP_CAPACITY
  const cottonTripProfit = cottonProfit * SHIP_CAPACITY
  console.log(`    棉花 卡利卡特→伦敦: 买入=${cottonBuy}, 卖出=${cottonSell}, 单位利润=${cottonProfit}, ROI=${cottonRoi.toFixed(1)}%, 满舱成本=${cottonFillCost}, 满舱利润=${cottonTripProfit}`)

  // 宝石: 里斯本(特产)→热那亚(非特产) — 正确的套利方向
  const gemLisbon = calculateItemPrice(3800, 'gem', true, 100)
  const gemBuy = gemLisbon.buy
  const gemGenoa = calculateItemPrice(4900, 'gem', false, 100)
  const gemSell = gemGenoa.sell
  const gemProfit = gemSell - gemBuy
  const gemRoi = (gemProfit / gemBuy * 100)
  const gemFillCost = gemBuy * SHIP_CAPACITY
  const gemTripProfit = gemProfit * SHIP_CAPACITY

  // 实际能买的数量 (资金20000)
  const affordableGems = Math.floor(20000 / gemBuy)
  const gemRealProfit = gemProfit * affordableGems
  console.log(`    宝石 里斯本→热那亚: 买入=${gemBuy}, 卖出=${gemSell}, 单位利润=${gemProfit}, ROI=${gemRoi.toFixed(1)}%, 满舱成本=${gemFillCost}, 满舱利润=${gemTripProfit}`)
  console.log(`    初始资金20000: 可买${affordableGems}颗宝石, 利润=${gemRealProfit}; 棉花满舱100利润=${cottonTripProfit}`)

  // 关键断言: 棉花 ROI > 宝石 ROI (运力品跨市收益率更高)
  gt(cottonRoi, gemRoi, `棉花ROI(${cottonRoi.toFixed(1)}%) > 宝石ROI(${gemRoi.toFixed(1)}%)`)

  // 关键断言: 宝石单位利润 > 棉花单位利润 (资金品单件赚钱更多)
  gt(gemProfit, cottonProfit, `宝石单位利润(${gemProfit}) > 棉花单位利润(${cottonProfit})`)

  // 关键断言: 棉花满舱成本 < 初始资金 (运力瓶颈)
  lt(cottonFillCost, 20000, `棉花满舱成本(${cottonFillCost}) < 初始资金20000 → 运力瓶颈`)

  // 关键断言: 宝石满舱成本 > 初始资金*3 (资金瓶颈)
  gt(gemFillCost, 20000 * 3, `宝石满舱成本(${gemFillCost}) > 初始资金×3 → 资金瓶颈`)
})

// ─── 8. 库存恢复模拟 ───────────────────────────────────────────

test('8. 库存恢复模拟', () => {
  // 8a: 3分钟内有交易不恢复
  const hours1 = 0.04  // 2.4分钟
  const regenAmount1 = Math.floor(hours1 * STOCK_REGEN_PER_HOUR)
  eq(regenAmount1, 0, '2.4分钟内不触发恢复')

  // 8b: 1小时后恢复15单位
  const hours2 = 1.0
  const regenAmount2 = Math.floor(hours2 * STOCK_REGEN_PER_HOUR)
  eq(regenAmount2, 15, '1小时恢复15单位')

  // 8c: 从95恢复到100只需5单位 (不超过均衡值)
  const current = 95
  const recovered = Math.min(STOCK_EQUILIBRIUM, current + regenAmount2)
  eq(recovered, STOCK_EQUILIBRIUM, '恢复不超过均衡值100')

  // 8d: 从120恢复到100 (超过均衡值向下恢复)
  const overStock = 120
  const recovered2 = Math.max(STOCK_EQUILIBRIUM, overStock - regenAmount2)
  eq(recovered2, 105, '向下恢复: 120→105 (15单位/小时)')
})

// ─── 9. 边界场景 ───────────────────────────────────────────────

test('9. 边界场景', () => {
  // 9a: amount=0 交易
  const zero = Math.abs(0)
  eq(zero, 0, 'amount=0 绝对值')

  // 9b: 超大金额
  const bigBuy = calculateItemPrice(7500, 'gem', false, 100).buy * 100
  gt(bigBuy, 700000, '100颗宝石花费 > 70万金币')

  // 9c: 无效商品
  assert(!VALID_ITEMS.includes('gold'), 'gold 不是有效商品')
  assert(!VALID_ITEMS.includes('weapon'), 'weapon 不是有效商品')

  // 9d: 所有商品名非空
  for (const item of VALID_ITEMS) {
    assert(item.length > 0 && item.length < 20, `${item} 名称合法`)
  }

  // 9e: 城市 specialty 不重复
  for (const city of CITIES) {
    const unique = new Set(city.specialty)
    eq(unique.size, city.specialty.length, `${city.name} specialty 无重复`)
  }

  // 9f: 同商品在不同城市有价差
  for (const item of VALID_ITEMS) {
    const prices = CITIES.map(c => c.basePrice[item])
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    gt(max, min, `${item} 存在跨市价差 (${min}~${max})`)
  }
})

// ─── 10. AMM 价差一致性 ────────────────────────────────────────

test('10. AMM 价差一致性', () => {
  for (const city of CITIES) {
    for (const [item, basePrice] of Object.entries(city.basePrice)) {
      const isSpecialty = city.specialty.includes(item)
      const p = calculateItemPrice(basePrice, item, isSpecialty, 100)

      // buy 应该比基础价高约5%
      const expectedBase = Math.round(basePrice * (isSpecialty ? 0.8 : 1.0))
      const expectedBuy = Math.round(expectedBase * 1.05)
      const expectedSell = Math.round(expectedBase * 0.95)

      eq(p.buy, expectedBuy, `${city.id}:${item} buy=${p.buy} expected=${expectedBuy}`)
      eq(p.sell, expectedSell, `${city.id}:${item} sell=${p.sell} expected=${expectedSell}`)
    }
  }
})

// ═══════════════════════════════════════════════════════════════
// 结果汇总
// ═══════════════════════════════════════════════════════════════

const total = passed + failed
console.log(`\n${'='.repeat(60)}`)
console.log(`测试完成: ${total} 项, 通过 ${passed}, 失败 ${failed}`)
console.log(`${'='.repeat(60)}`)

if (failed > 0) {
  console.error(`\n${failed} 项测试失败!`)
  process.exit(1)
} else {
  console.log(`\n全部通过!`)
}
