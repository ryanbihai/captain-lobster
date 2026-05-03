/**
 * @file service.js (03-LobsterSvc)
 * @description 龙虾船长 L1 游戏引擎业务逻辑层。
 *
 * 核心设计：
 * 1. 三级商品定价：运力瓶颈型（低价高毛利%）/ 双约束型 / 资金瓶颈型（高价低毛利%）
 * 2. 动态价格：城市库存随交易波动，库存越少价格越高
 * 3. 事件驱动：随机事件（节日/封锁/风暴等）临时扰动价格
 * 4. 信息不对称：价格仅当前港口可见
 * 5. 城市坐标系统：基于经纬度计算航行时间
 * 6. 交易合约：异步合约机制，卖家卸货 + 买家抵达后自动交割
 */

const { INFO, ERROR } = require('../../lib/logSvc.js')(__filename)
const { Service } = require('../../lib/servicelib')
const { Player, Trade, Contract } = require('./models')
const cache = require('./cache')
const util = require('../../lib/util')

const service = new Service({ __dirname, __filename, module })

// ═══════════════════════════════════════════════════════════════
// 城市配置（含坐标）
// 定价逻辑：
//   Tier 1 运力瓶颈型 (cotton/pepper/tea/coffee): 低价 50-280, 高毛利%, 舱位先满
//   Tier 2 双约束型   (porcelain/spice/ivory):     中价 300-1200
//   Tier 3 资金瓶颈型 (silk/perfume/pearl/gem):     高价 1200-7500, 低毛利%, 资金先干
// 坐标使用 [纬度, 经度]，航行时间 = 球面距离(km) / 500 分钟
// ═══════════════════════════════════════════════════════════════

const CITIES = [
  {
    id: 'canton', name: '广州', region: '中国',
    coords: [23.1, 113.3],
    basePrice: { silk: 1500, tea: 100, porcelain: 380, spice: 850, pepper: 190, pearl: 4800, perfume: 3600, gem: 7200, ivory: 1050, cotton: 200, coffee: 280 },
    specialty: ['silk', 'tea', 'porcelain']
  },
  {
    id: 'calicut', name: '卡利卡特', region: '印度',
    coords: [11.3, 75.8],
    basePrice: { silk: 2300, tea: 210, porcelain: 680, spice: 420, pepper: 60, pearl: 2800, perfume: 3300, gem: 4800, ivory: 850, cotton: 85, coffee: 210 },
    specialty: ['spice', 'pepper', 'cotton']
  },
  {
    id: 'zanzibar', name: '桑给巴尔', region: '东非',
    coords: [-6.2, 39.3],
    basePrice: { silk: 2800, tea: 240, porcelain: 750, spice: 520, pepper: 110, pearl: 2600, perfume: 3500, gem: 4200, ivory: 550, cotton: 160, coffee: 120 },
    specialty: ['ivory', 'spice', 'pearl']
  },
  {
    id: 'alexandria', name: '亚历山大', region: '埃及',
    coords: [31.2, 29.9],
    basePrice: { silk: 2500, tea: 230, porcelain: 700, spice: 480, pepper: 130, pearl: 3000, perfume: 1900, gem: 4500, ivory: 680, cotton: 90, coffee: 170 },
    specialty: ['spice', 'perfume']
  },
  {
    id: 'venice', name: '威尼斯', region: '欧洲',
    coords: [45.4, 12.3],
    basePrice: { silk: 1800, tea: 250, porcelain: 720, spice: 600, pepper: 160, pearl: 3200, perfume: 2100, gem: 5000, ivory: 750, cotton: 150, coffee: 200 },
    specialty: ['silk', 'perfume', 'pearl']
  },
  {
    id: 'lisbon', name: '里斯本', region: '葡萄牙',
    coords: [38.7, -9.1],
    basePrice: { silk: 2800, tea: 260, porcelain: 820, spice: 650, pepper: 175, pearl: 4200, perfume: 3200, gem: 3800, ivory: 850, cotton: 180, coffee: 240 },
    specialty: ['spice', 'gem']
  },
  {
    id: 'london', name: '伦敦', region: '英格兰',
    coords: [51.5, -0.1],
    basePrice: { silk: 3200, tea: 270, porcelain: 900, spice: 750, pepper: 190, pearl: 4500, perfume: 3700, gem: 4200, ivory: 1000, cotton: 210, coffee: 270 },
    specialty: ['tea', 'gem', 'pearl']
  },
  {
    id: 'amsterdam', name: '阿姆斯特丹', region: '荷兰',
    coords: [52.4, 4.9],
    basePrice: { silk: 3100, tea: 265, porcelain: 880, spice: 720, pepper: 185, pearl: 4300, perfume: 3600, gem: 4000, ivory: 950, cotton: 200, coffee: 250 },
    specialty: ['spice', 'coffee', 'gem']
  },
  {
    id: 'istanbul', name: '伊斯坦布尔', region: '奥斯曼',
    coords: [41.0, 28.9],
    basePrice: { silk: 1700, tea: 200, porcelain: 620, spice: 450, pepper: 125, pearl: 2900, perfume: 2000, gem: 4300, ivory: 650, cotton: 120, coffee: 150 },
    specialty: ['spice', 'silk', 'perfume']
  },
  {
    id: 'genoa', name: '热那亚', region: '意大利',
    coords: [44.4, 8.9],
    basePrice: { silk: 1900, tea: 240, porcelain: 700, spice: 580, pepper: 155, pearl: 3100, perfume: 2400, gem: 4900, ivory: 720, cotton: 145, coffee: 195 },
    specialty: ['silk', 'spice', 'pearl']
  }
]

// ═══════════════════════════════════════════════════════════════
// 游戏常量
// ═══════════════════════════════════════════════════════════════

const AMM_SPREAD = 0.10          // AMM 买卖价差 (±5%)
const SHIP_CAPACITY = 100        // 默认船只装载量
const SETTLE_HOURS = 3           // 合约交割等待时间
const STOCK_EQUILIBRIUM = 100    // 城市库存均衡值
const STOCK_ELASTICITY = 0.3     // 库存对价格弹性（库存为0时价格+30%）
const STOCK_REGEN_PER_HOUR = 15  // 库存每小时恢复量

const VALID_ITEMS = ['silk', 'tea', 'porcelain', 'spice', 'pearl', 'perfume', 'gem', 'ivory', 'cotton', 'coffee', 'pepper']
const SPECIALTY_DISCOUNT = 0.8   // 特产城市折扣

// ═══════════════════════════════════════════════════════════════
// 事件系统定义
// ═══════════════════════════════════════════════════════════════

const EVENT_DEFS = [
  { type: 'festival',      desc: '节日庆典，需求旺盛',       priceMod: 1.40, durationHours: 4 },
  { type: 'blockade',      desc: '港口封锁，供给中断',       priceMod: 1.55, durationHours: 3 },
  { type: 'surplus',       desc: '商船大量到港，供给过剩',   priceMod: 0.65, durationHours: 5 },
  { type: 'storm',         desc: '风暴损毁库存',             priceMod: 1.35, durationHours: 3 },
  { type: 'trader_fleet',  desc: '贸易船队抵达，货源充裕',   priceMod: 0.75, durationHours: 4 },
  { type: 'plague',        desc: '城市瘟疫，需求萎缩',       priceMod: 0.55, durationHours: 6 }
]

let activeEvents = []

function cleanExpiredEvents() {
  const before = activeEvents.length
  activeEvents = activeEvents.filter(e => e.expiresAt > Date.now())
  return before - activeEvents.length
}

function applyEventMultiplier(basePrice, cityId, item) {
  const now = Date.now()
  const events = activeEvents.filter(e =>
    e.expiresAt > now &&
    e.cityId === cityId &&
    (e.item === null || e.item === item)
  )
  let multiplier = 1.0
  for (const e of events) {
    multiplier *= e.priceMod
  }
  return Math.round(basePrice * multiplier)
}

function generateRandomEvent() {
  const def = EVENT_DEFS[Math.floor(Math.random() * EVENT_DEFS.length)]
  const city = CITIES[Math.floor(Math.random() * CITIES.length)]
  const item = Math.random() < 0.4 ? null : VALID_ITEMS[Math.floor(Math.random() * VALID_ITEMS.length)]

  const event = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: def.type,
    desc: def.desc,
    cityId: city.id,
    cityName: city.name,
    item,
    priceMod: def.priceMod,
    createdAt: Date.now(),
    expiresAt: Date.now() + def.durationHours * 3600000
  }

  activeEvents = activeEvents.filter(e => !(e.cityId === event.cityId && e.item === event.item))
  activeEvents.push(event)
  cleanExpiredEvents()

  INFO(`[龙虾船长] 事件: ${city.name} ${def.desc}${item ? ' (' + item + ')' : ' (全商品)'} 价格×${def.priceMod}`)
  return event
}

// ═══════════════════════════════════════════════════════════════
// 定价引擎
// ═══════════════════════════════════════════════════════════════

/**
 * 计算商品在某个城市的买入/卖出价格
 * @param {number} basePrice - 城市基础价格
 * @param {string} item - 商品名
 * @param {boolean} isSpecialty - 是否为该城市特产
 * @param {number} stockLevel - 当前库存量（默认均衡值100）
 */
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

// ═══════════════════════════════════════════════════════════════
// 城市动态库存管理
// ═══════════════════════════════════════════════════════════════

async function getCityStock(cityId) {
  let cityDoc = await cache.getCity(cityId)

  const now = new Date()
  const lastUpdate = cityDoc.lastStockUpdate ? new Date(cityDoc.lastStockUpdate) : now
  const hoursElapsed = (now - lastUpdate) / 3600000

  if (hoursElapsed > 0.05) {
    const regenAmount = Math.floor(hoursElapsed * STOCK_REGEN_PER_HOUR)
    if (regenAmount > 0) {
      let changed = false
      for (const item of VALID_ITEMS) {
        const current = _getStockLevel(cityDoc, item)
        if (current < STOCK_EQUILIBRIUM) {
          _setStockLevel(cityDoc, item, Math.min(STOCK_EQUILIBRIUM, current + regenAmount))
          changed = true
        } else if (current > STOCK_EQUILIBRIUM) {
          _setStockLevel(cityDoc, item, Math.max(STOCK_EQUILIBRIUM, current - regenAmount))
          changed = true
        }
      }
      if (changed) {
        cityDoc.lastStockUpdate = now
        await cache.saveAndCacheCity(cityDoc)
      }
    }
  }

  return cityDoc
}

function _getStockLevel(cityDoc, item) {
  if (!cityDoc || !cityDoc.stock) return STOCK_EQUILIBRIUM
  if (cityDoc.stock instanceof Map) {
    const val = cityDoc.stock.get(item)
    return val !== undefined && val !== null ? val : STOCK_EQUILIBRIUM
  }
  const val = cityDoc.stock[item]
  return val !== undefined && val !== null ? val : STOCK_EQUILIBRIUM
}

function _setStockLevel(cityDoc, item, value) {
  if (!cityDoc) return
  if (cityDoc.stock instanceof Map) {
    cityDoc.stock.set(item, value)
  } else {
    cityDoc.stock[item] = value
  }
  cityDoc.markModified('stock')
}

async function updateCityStock(cityId, item, delta) {
  let cityDoc = await cache.getCity(cityId)
  const current = _getStockLevel(cityDoc, item)
  const newVal = Math.max(0, current + delta)
  _setStockLevel(cityDoc, item, newVal)
  cityDoc.lastStockUpdate = new Date()
  await cityDoc.save()
  await cache.invalidateCity(cityId)
}

// ═══════════════════════════════════════════════════════════════
// 航行计算
// ═══════════════════════════════════════════════════════════════

/**
 * 计算两点间的球面距离（km），使用 Haversine 公式
 */
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

/**
 * 计算航行时间（分钟），公式: 球面距离(km) / 500
 */
function calculateSailingTime(fromCityId, toCityId) {
  const from = CITIES.find(c => c.id === fromCityId)
  const to = CITIES.find(c => c.id === toCityId)
  if (!from || !to) return 10
  const distance = calculateDistance(from.coords, to.coords)
  return Math.round(distance / 500)
}

// ═══════════════════════════════════════════════════════════════
// 货物操作辅助函数
// ═══════════════════════════════════════════════════════════════

/**
 * 获取玩家总货物数量
 */
function getTotalCargo(player) {
  let total = 0
  if (player.cargo instanceof Map) {
    for (const count of player.cargo.values()) total += count
  } else if (typeof player.cargo === 'object') {
    for (const count of Object.values(player.cargo)) total += count
  }
  return total
}

/**
 * 获取玩家指定货物数量
 */
function getCargoItem(player, item) {
  if (!player || !player.cargo) return 0
  if (player.cargo instanceof Map) {
    const val = player.cargo.get(item)
    return typeof val === 'number' ? val : 0
  }
  if (player.cargo && typeof player.cargo === 'object' && item in player.cargo) {
    const val = player.cargo[item]
    return typeof val === 'number' ? val : 0
  }
  return 0
}

/**
 * 设置玩家货物数量
 */
function setCargoItem(player, item, value) {
  if (!player) return

  if (value === 0 || value === undefined || value === null || value < 0) {
    value = 0
  }

  if (player.cargo instanceof Map) {
    if (value > 0) {
      player.cargo.set(item, value)
    } else {
      player.cargo.delete(item)
    }
  } else if (player.cargo && typeof player.cargo === 'object') {
    if (value > 0) {
      player.cargo[item] = value
    } else {
      delete player.cargo[item]
    }
  } else {
    if (value > 0) {
      player.cargo = { [item]: value }
    }
  }
}

/**
 * 将玩家 cargo 转为纯对象（仅保留数量>0的货物）
 */
function cargoToPlainObject(player) {
  const result = {}
  if (!player || !player.cargo) return result
  const entries = player.cargo instanceof Map
    ? Array.from(player.cargo.entries())
    : Object.entries(player.cargo)
  for (const [key, value] of entries) {
    if (value > 0) result[key] = value
  }
  return result
}

// ═══════════════════════════════════════════════════════════════
// 合约交割内部辅助函数
// ═══════════════════════════════════════════════════════════════

/**
 * 完成合约：转移金币+货物，更新合约状态，创建交易记录
 */
async function _completeContract(contract, buyer, seller, now) {
  buyer.gold -= contract.totalPrice
  setCargoItem(buyer, contract.item, getCargoItem(buyer, contract.item) + contract.amount)
  await buyer.save()
  await cache.invalidatePlayer(buyer.openid)

  if (seller) {
    seller.gold += contract.totalPrice
    await seller.save()
    await cache.invalidatePlayer(seller.openid)
  }

  contract.status = 'completed'
  contract.buyerArrived = true
  contract.buyerArrivedAt = now
  contract.settleAt = now
  await contract.save()

  await Trade.create({
    id: util.createId(),
    type: 'p2p',
    buyerOpenid: contract.buyerOpenid,
    sellerOpenid: contract.sellerOpenid,
    item: contract.item,
    amount: contract.amount,
    price: contract.price,
    totalPrice: contract.totalPrice,
    createDate: now
  })
}

/**
 * 货物退还卖家
 */
async function _refundSeller(contract) {
  const seller = await cache.getPlayer(contract.sellerOpenid)
  if (seller) {
    setCargoItem(seller, contract.item, getCargoItem(seller, contract.item) + contract.amount)
    await seller.save()
    await cache.invalidatePlayer(seller.openid)
  }
}

/**
 * 处理卖家抵达卸货
 */
async function _handleSellerArrival(contract, now) {
  contract.sellerArrived = true
  contract.sellerArrivedAt = now
  contract.status = 'seller_arrived'
  contract.settleAt = new Date(now.getTime() + SETTLE_HOURS * 60 * 60 * 1000)
  await contract.save()
  INFO(`[龙虾船长] 合约 ${contract.id} 卖家已抵达卸货，等待至 ${contract.settleAt}`)
  return {
    contractId: contract.id,
    result: 'seller_arrived',
    reason: '卖家已抵达卸货，等待买家到来',
    settleAt: contract.settleAt
  }
}

/**
 * 处理买家抵达装船
 */
async function _handleBuyerArrival(contract, now) {
  if (!contract.sellerArrived) {
    return {
      contractId: contract.id,
      result: 'buyer_too_early',
      reason: '卖家尚未抵达卸货，买家无法装船'
    }
  }

  const buyer = await cache.getPlayer(contract.buyerOpenid)
  if (!buyer || buyer.gold < contract.totalPrice) {
    contract.status = 'failed'
    await contract.save()
    await _refundSeller(contract)
    return {
      contractId: contract.id,
      result: 'failed',
      reason: '买家金币不足，合约取消，货物返还卖家'
    }
  }

  const seller = await cache.getPlayer(contract.sellerOpenid)
  await _completeContract(contract, buyer, seller, now)
  INFO(`[龙虾船长] 合约 ${contract.id} 交割完成`)
  return {
    contractId: contract.id,
    result: 'success',
    reason: '买家抵达，款项已付，货物已装'
  }
}

/**
 * 处理超时强制交割
 */
async function _handleExpiredContracts(cityId, sellerOpenid, now) {
  const expired = await Contract.find({
    deliveryCity: cityId,
    status: 'seller_arrived',
    settleAt: { $lte: now },
    deleted: { $ne: true }
  })

  const results = []
  for (const contract of expired) {
    if (contract.sellerOpenid !== sellerOpenid || contract.buyerArrived) continue

    const buyer = await cache.getPlayer(contract.buyerOpenid)

    if (buyer && buyer.gold >= contract.totalPrice) {
      const seller = await cache.getPlayer(contract.sellerOpenid)
      await _completeContract(contract, buyer, seller, now)
      INFO(`[龙虾船长] 合约 ${contract.id} 强制交割`)
      results.push({
        contractId: contract.id,
        result: 'force_settle',
        reason: '卖家等待超时，强制交割'
      })
    } else {
      contract.status = 'failed'
      await contract.save()
      await _refundSeller(contract)
      results.push({
        contractId: contract.id,
        result: 'expired',
        reason: '超时未交割，货物返还卖家'
      })
    }
  }
  return results
}

// ═══════════════════════════════════════════════════════════════
// 业务接口
// ═══════════════════════════════════════════════════════════════

/**
 * 玩家入驻
 */
exports.enrollPlayer = async ({ openid, publicKey, initialGold = 20000 }) => {
  if (!openid || !publicKey) return { code: 1, msg: '缺少必要参数 (openid/publicKey)' }

  const id = util.createId()

  try {
    const player = await Player.create({
      id,
      openid,
      publicKey,
      gold: initialGold,
      cargo: {},
      currentCity: 'canton',
      targetCity: null,
      status: 'docked',
      intent: '',
      shipCapacity: SHIP_CAPACITY,
      arrivedAt: new Date(),
      createDate: new Date(),
      deleted: false
    })

    INFO(`[龙虾船长] 新玩家入驻: ${openid}`)
    await cache.cachePlayer(player)
    return { code: 0, data: { doc: player } }
  } catch (e) {
    ERROR(`玩家入驻失败: ${e.message}`)
    return { code: 500, msg: e.message }
  }
}

/**
 * 获取城市信息（含动态价格、库存、事件）
 * 信息不对称：仅返回当前查询的城市信息
 */
exports.getCity = async ({ id }) => {
  if (!id) return { code: 1, msg: '缺少城市 ID' }

  const cityConfig = CITIES.find(c => c.id === id)
  if (!cityConfig) return { code: 4, msg: '城市不存在' }

  try {
    const players = await Player.find({ currentCity: id, status: 'docked', deleted: { $ne: true } })
    const contracts = await Contract.find({ deliveryCity: id, status: { $in: ['pending', 'seller_arrived', 'buyer_arrived'] }})

    const cityDoc = await getCityStock(id)
    cleanExpiredEvents()

    const prices = {}
    const stockInfo = {}
    for (const [item, basePrice] of Object.entries(cityConfig.basePrice)) {
      const stockLevel = _getStockLevel(cityDoc, item)
      const eventPrice = applyEventMultiplier(basePrice, id, item)
      prices[item] = calculateItemPrice(eventPrice, item, cityConfig.specialty?.includes(item), stockLevel)
      stockInfo[item] = stockLevel
    }

    const cityEvents = activeEvents.filter(e => e.expiresAt > Date.now() && e.cityId === id)

    return {
      code: 0,
      data: {
        city: {
          id: cityConfig.id,
          name: cityConfig.name,
          coords: cityConfig.coords,
          specialty: cityConfig.specialty,
          prices,
          stock: stockInfo,
          events: cityEvents.map(e => ({
            type: e.type,
            desc: e.desc,
            item: e.item,
            priceMod: e.priceMod,
            expiresInMin: Math.round((e.expiresAt - Date.now()) / 60000)
          }))
        },
        players: players.map(p => ({
          openid: p.openid,
          intent: p.intent,
          status: p.status,
          cargoCapacity: { used: getTotalCargo(p), max: p.shipCapacity }
        })),
        contracts: contracts.map(c => ({
          id: c.id,
          sellerOpenid: c.sellerOpenid,
          item: c.item,
          amount: c.amount,
          price: c.price,
          status: c.status,
          sellerArrived: c.sellerArrived,
          buyerArrived: c.buyerArrived
        }))
      }
    }
  } catch (e) {
    ERROR(`获取城市信息失败: ${e.message}`)
    return { code: 500, msg: e.message }
  }
}

/**
 * 移动到新城市
 */
exports.movePlayer = async ({ openid, targetCity }) => {
  if (!openid || !targetCity) return { code: 1, msg: '缺少必要参数 (openid/targetCity)' }

  const target = CITIES.find(c => c.id === targetCity)
  if (!target) return { code: 4, msg: '目标城市不存在' }

  try {
    const player = await cache.getPlayer(openid)
    if (!player) return { code: 4, msg: '玩家不存在' }

    if (player.status === 'sailing') {
      player.currentCity = targetCity
      player.status = 'docked'
      player.arrivedAt = new Date()
    } else {
      player.status = 'sailing'
      player.targetCity = targetCity
    }

    await player.save()
    await cache.invalidatePlayer(openid)

    const sailingTime = player.status === 'sailing'
      ? calculateSailingTime(player.currentCity, targetCity)
      : 0

    INFO(`[龙虾船长] 玩家 ${openid} ${player.status === 'sailing' ? '启航' : '抵达'} ${target.name} (预计${sailingTime}分钟)`)

    return {
      code: 0,
      data: {
        status: player.status,
        targetCity,
        sailingTime: player.status === 'sailing' ? sailingTime : 0
      }
    }
  } catch (e) {
    ERROR(`移动失败: ${e.message}`)
    return { code: 500, msg: e.message }
  }
}

/**
 * 更新供需意向牌
 */
exports.updateIntent = async ({ openid, intent }) => {
  if (!openid) return { code: 1, msg: '缺少 openid' }

  const truncatedIntent = intent ? intent.substring(0, 140) : ''

  try {
    const player = await cache.getPlayer(openid)
    if (!player) return { code: 4, msg: '玩家不存在' }

    player.intent = truncatedIntent
    await player.save()
    await cache.invalidatePlayer(openid)

    INFO(`[龙虾船长] 玩家 ${openid} 更新意向牌: ${truncatedIntent}`)
    return { code: 0, data: { intent: truncatedIntent } }
  } catch (e) {
    ERROR(`更新意向牌失败: ${e.message}`)
    return { code: 500, msg: e.message }
  }
}

/**
 * NPC 系统交易（含动态库存更新）
 */
exports.tradeWithNpc = async ({ openid, item, amount, action }) => {
  if (!openid || !item || !amount || !action) {
    return { code: 1, msg: '缺少必要参数 (openid/item/amount/action)' }
  }

  if (!['buy', 'sell'].includes(action)) {
    return { code: 1, msg: 'action 必须是 buy 或 sell' }
  }

  if (!VALID_ITEMS.includes(item)) {
    return { code: 1, msg: '无效的商品类型' }
  }

  try {
    const player = await cache.getPlayer(openid)
    if (!player) return { code: 4, msg: '玩家不存在' }

    if (player.status !== 'docked') {
      return { code: 1, msg: '航行中不能进行交易' }
    }

    const cityConfig = CITIES.find(c => c.id === player.currentCity)
    if (!cityConfig) return { code: 4, msg: '玩家不在任何城市' }

    const cityDoc = await getCityStock(player.currentCity)
    const stockLevel = _getStockLevel(cityDoc, item)
    const eventPrice = applyEventMultiplier(cityConfig.basePrice[item], player.currentCity, item)
    const prices = calculateItemPrice(eventPrice, item, cityConfig.specialty?.includes(item), stockLevel)
    const tradePrice = action === 'buy' ? prices.buy : prices.sell
    const totalCost = tradePrice * Math.abs(amount)

    if (action === 'buy') {
      const currentCargo = getTotalCargo(player)
      if (currentCargo + amount > player.shipCapacity) {
        return { code: 1, msg: `货物超过装载量限制 (${player.shipCapacity})` }
      }
      if (player.gold < totalCost) {
        return { code: 1, msg: '金币不足' }
      }
      player.gold -= totalCost
      setCargoItem(player, item, getCargoItem(player, item) + amount)
      await updateCityStock(player.currentCity, item, -amount)
    } else {
      const playerStock = getCargoItem(player, item)
      if (playerStock < amount) {
        return { code: 1, msg: '货物不足' }
      }
      player.gold += totalCost
      setCargoItem(player, item, playerStock - amount)
      await updateCityStock(player.currentCity, item, amount)
    }

    await player.save()
    await cache.invalidatePlayer(openid)

    const trade = await Trade.create({
      id: util.createId(),
      type: 'npc',
      buyerOpenid: action === 'buy' ? openid : 'npc',
      sellerOpenid: action === 'sell' ? openid : 'npc',
      item,
      amount,
      price: tradePrice,
      totalPrice: totalCost,
      createDate: new Date()
    })

    const newStockLevel = _getStockLevel(await cache.getCity(player.currentCity), item)
    INFO(`[龙虾船长] NPC 交易: ${openid} ${action === 'buy' ? '买入' : '卖出'} ${amount} ${item} @ ${tradePrice} (库存: ${stockLevel}→${newStockLevel})`)
    return {
      code: 0,
      data: {
        trade,
        playerGold: player.gold,
        cargo: cargoToPlainObject(player),
        cargoUsed: getTotalCargo(player),
        cargoCapacity: player.shipCapacity,
        priceDetail: {
          basePrice: cityConfig.basePrice[item],
          eventPrice,
          stockLevel,
          tradePrice,
          totalCost
        }
      }
    }
  } catch (e) {
    ERROR(`NPC 交易失败: ${e.message}`)
    return { code: 500, msg: e.message }
  }
}

/**
 * 创建交易合约
 */
exports.createContract = async ({ buyerOpenid, sellerOpenid, item, amount, price, deliveryCity }) => {
  if (!buyerOpenid || !sellerOpenid || !item || !amount || !price || !deliveryCity) {
    return { code: 1, msg: '缺少必要参数' }
  }

  const delivery = CITIES.find(c => c.id === deliveryCity)
  if (!delivery) return { code: 4, msg: '交割城市不存在' }

  try {
    const seller = await cache.getPlayer(sellerOpenid)
    if (!seller) return { code: 4, msg: '卖方不存在' }

    const buyer = await cache.getPlayer(buyerOpenid)
    if (!buyer) return { code: 4, msg: '买方不存在' }

    const sellerStock = getCargoItem(seller, item)
    if (sellerStock < amount) {
      return { code: 1, msg: '卖方货物不足' }
    }

    setCargoItem(seller, item, sellerStock - amount)
    await seller.save()
    await cache.invalidatePlayer(sellerOpenid)

    const contract = await Contract.create({
      id: util.createId(),
      buyerOpenid,
      sellerOpenid,
      item,
      amount,
      price,
      totalPrice: price * amount,
      deliveryCity,
      status: 'pending',
      sellerArrived: seller.currentCity === deliveryCity && seller.status === 'docked',
      buyerArrived: false,
      sellerArrivedAt: seller.currentCity === deliveryCity && seller.status === 'docked' ? new Date() : null,
      buyerArrivedAt: null,
      settleAt: seller.currentCity === deliveryCity && seller.status === 'docked' ? new Date(Date.now() + SETTLE_HOURS * 60 * 60 * 1000) : null,
      createDate: new Date()
    })

    INFO(`[龙虾船长] 合约创建: ${contract.id}, 卖家${sellerOpenid} -> 买家${buyerOpenid}, ${amount}${item}@${price}`)
    return { code: 0, data: { contract } }
  } catch (e) {
    ERROR(`创建合约失败: ${e.message}`)
    return { code: 500, msg: e.message }
  }
}

/**
 * 取消合约
 */
exports.cancelContract = async ({ contractId, openid }) => {
  if (!contractId || !openid) return { code: 1, msg: '缺少必要参数' }

  try {
    const contract = await Contract.findOne({ id: contractId })
    if (!contract) return { code: 4, msg: '合约不存在' }

    if (contract.sellerOpenid !== openid && contract.buyerOpenid !== openid) {
      return { code: 1, msg: '无权取消此合约' }
    }

    if (contract.status !== 'pending') {
      return { code: 1, msg: '合约状态不允许取消' }
    }

    await _refundSeller(contract)

    contract.status = 'cancelled'
    await contract.save()

    INFO(`[龙虾船长] 合约取消: ${contractId}`)
    return { code: 0, data: { contract } }
  } catch (e) {
    ERROR(`取消合约失败: ${e.message}`)
    return { code: 500, msg: e.message }
  }
}

/**
 * 查询合约列表
 */
exports.listContracts = async ({ openid, status }) => {
  if (!openid) return { code: 1, msg: '缺少 openid' }

  try {
    const query = {
      $or: [{ buyerOpenid: openid }, { sellerOpenid: openid }],
      deleted: { $ne: true }
    }
    if (status) {
      query.status = status
    }

    const contracts = await Contract.find(query).sort({ createDate: -1 })

    return {
      code: 0,
      data: {
        contracts: contracts.map(c => ({
          id: c.id,
          buyerOpenid: c.buyerOpenid,
          sellerOpenid: c.sellerOpenid,
          item: c.item,
          amount: c.amount,
          price: c.price,
          totalPrice: c.totalPrice,
          deliveryCity: c.deliveryCity,
          status: c.status,
          sellerArrived: c.sellerArrived,
          buyerArrived: c.buyerArrived,
          settleAt: c.settleAt,
          createDate: c.createDate
        }))
      }
    }
  } catch (e) {
    ERROR(`查询合约失败: ${e.message}`)
    return { code: 500, msg: e.message }
  }
}

/**
 * 玩家抵达检测合约交割
 */
exports.arriveAndSettle = async ({ openid }) => {
  if (!openid) return { code: 1, msg: '缺少 openid' }

  try {
    const player = await cache.getPlayer(openid)
    if (!player) return { code: 4, msg: '玩家不存在' }
    if (player.status !== 'docked') {
      return { code: 1, msg: '玩家不在停泊状态' }
    }

    const now = new Date()
    const settleResults = []

    const activeContracts = await Contract.find({
      deliveryCity: player.currentCity,
      status: { $in: ['pending', 'seller_arrived'] },
      deleted: { $ne: true }
    })

    for (const contract of activeContracts) {
      const isSeller = contract.sellerOpenid === openid
      const isBuyer = contract.buyerOpenid === openid
      if (!isSeller && !isBuyer) continue

      if (isSeller && !contract.sellerArrived) {
        settleResults.push(await _handleSellerArrival(contract, now))
        continue
      }

      if (isBuyer) {
        settleResults.push(await _handleBuyerArrival(contract, now))
      }
    }

    const expiredResults = await _handleExpiredContracts(player.currentCity, openid, now)
    settleResults.push(...expiredResults)

    return {
      code: 0,
      data: {
        settleResults,
        playerGold: player.gold,
        cargo: cargoToPlainObject(player),
        cargoUsed: getTotalCargo(player)
      }
    }
  } catch (e) {
    ERROR(`交割检测失败: ${e.message}`)
    return { code: 500, msg: e.message }
  }
}

// ═══════════════════════════════════════════════════════════════
// 事件系统接口
// ═══════════════════════════════════════════════════════════════

/**
 * 手动触发随机事件
 */
exports.triggerRandomEvent = async () => {
  const event = generateRandomEvent()
  return {
    code: 0,
    data: { event }
  }
}

/**
 * 查询当前活跃事件
 */
exports.listEvents = async ({ cityId } = {}) => {
  cleanExpiredEvents()
  let events = activeEvents
  if (cityId) events = events.filter(e => e.cityId === cityId)

  return {
    code: 0,
    data: {
      events: events.map(e => ({
        id: e.id,
        type: e.type,
        desc: e.desc,
        cityId: e.cityId,
        cityName: e.cityName,
        item: e.item,
        priceMod: e.priceMod,
        createdAt: e.createdAt,
        expiresInMin: Math.round((e.expiresAt - Date.now()) / 60000)
      }))
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// OceanBus 集成
// ═══════════════════════════════════════════════════════════════

const OceanBusClient = require('../../lib/oceanbus')

exports.registerOceanBus = async ({ playerId }) => {
  if (!playerId) return { code: 1, msg: '缺少玩家 ID' }

  try {
    const player = await Player.findOne({ id: playerId, deleted: { $ne: true } })
    if (!player) return { code: 4, msg: '玩家不存在' }

    if (player.oceanBusAgentId && player.oceanBusOpenid && player.oceanBusApiKey) {
      return {
        code: 0,
        data: {
          agentId: player.oceanBusAgentId,
          openid: player.oceanBusOpenid,
          message: '该玩家已注册 OceanBus Agent'
        }
      }
    }

    const client = new OceanBusClient()
    const regResult = await client.register()
    if (regResult.code !== 0) {
      return { code: 500, msg: 'OceanBus 注册失败: ' + JSON.stringify(regResult) }
    }

    if (!client.openid) {
      return { code: 500, msg: 'OceanBus 注册后 openid 为空，请重试' }
    }

    player.oceanBusAgentId = client.agentId
    player.oceanBusOpenid = client.openid
    player.oceanBusApiKey = client.apiKey
    await player.save()

    INFO(`[龙虾船长] 玩家 ${playerId} 注册 OceanBus Agent: ${client.agentId}`)
    return {
      code: 0,
      data: {
        agentId: client.agentId,
        openid: client.openid
      }
    }
  } catch (e) {
    ERROR(`注册 OceanBus Agent 失败: ${e.message}`)
    return { code: 500, msg: e.message }
  }
}

function getPlayerOceanBusClient(player) {
  if (!player.oceanBusApiKey || !player.oceanBusAgentId || !player.oceanBusOpenid) {
    return null
  }
  const client = new OceanBusClient()
  client.restoreFromConfig(player.oceanBusAgentId, player.oceanBusOpenid, player.oceanBusApiKey)
  return client
}

exports.sendOceanMessage = async ({ playerId, toAgentCode, content }) => {
  if (!playerId || !toAgentCode || !content) {
    return { code: 1, msg: '缺少必要参数 (playerId/toAgentCode/content)' }
  }

  try {
    const player = await Player.findOne({ id: playerId, deleted: { $ne: true } })
    if (!player) return { code: 4, msg: '玩家不存在' }

    const client = getPlayerOceanBusClient(player)
    if (!client) {
      return { code: 1, msg: '该玩家未注册 OceanBus Agent 或身份信息不完整' }
    }

    const targetInfo = await client.lookup(toAgentCode)
    const result = await client.sendMessage(targetInfo.data.to_openid, content)

    INFO(`[龙虾船长] 玩家 ${playerId} 发送消息至 ${toAgentCode}`)
    return { code: 0, data: result }
  } catch (e) {
    ERROR(`发送 OceanBus 消息失败: ${e.message}`)
    return { code: 500, msg: e.message }
  }
}

exports.syncOceanMessages = async ({ playerId, sinceSeq = 0 }) => {
  if (!playerId) return { code: 1, msg: '缺少玩家 ID' }

  try {
    const player = await Player.findOne({ id: playerId, deleted: { $ne: true } })
    if (!player) return { code: 4, msg: '玩家不存在' }

    const client = getPlayerOceanBusClient(player)
    if (!client) {
      return { code: 1, msg: '该玩家未注册 OceanBus Agent 或身份信息不完整' }
    }

    const result = await client.syncMessages(sinceSeq)

    INFO(`[龙虾船长] 玩家 ${playerId} 同步消息 since_seq: ${sinceSeq}`)
    return {
      code: 0,
      data: {
        messages: result.data?.messages || [],
        nextSeq: result.data?.last_seq || sinceSeq
      }
    }
  } catch (e) {
    ERROR(`同步 OceanBus 消息失败: ${e.message}`)
    return { code: 500, msg: e.message }
  }
}

service.exportMe()
