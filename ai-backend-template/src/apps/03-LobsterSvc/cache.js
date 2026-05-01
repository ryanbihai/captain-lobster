/**
 * @file cache.js (03-LobsterSvc)
 * @description Redis 缓存层 — 加速 Player 和 City 高频读取。
 *
 * 策略：
 * - Player: TTL 5min，写操作时主动失效
 * - City:   TTL 2min，库存变动时主动失效
 * - Redis 不可用时静默降级到 MongoDB
 */

const { WARN } = require('../../lib/logSvc.js')(__filename)
const { Player, City } = require('./models')

const PLAYER_TTL = 300   // 5 分钟
const CITY_TTL = 120     // 2 分钟

const PREFIX = 'lobster'

let _redis = null
function redis() {
  if (!_redis) {
    try {
      _redis = require('../../lib/redis').client
    } catch (e) {
      _redis = null
    }
  }
  return _redis
}

function playerKey(openid) { return `${PREFIX}:player:${openid}` }
function cityKey(cityId)   { return `${PREFIX}:city:${cityId}` }

// ─── Player Cache ───────────────────────────────────────────────

async function getPlayer(openid) {
  const r = redis()
  if (r) {
    try {
      const raw = await r.get(playerKey(openid))
      if (raw) {
        const doc = JSON.parse(raw)
        return Player.hydrate(doc)
      }
    } catch (e) {
      WARN(`Redis 读取 Player 失败: ${e.message}`)
    }
  }

  const player = await Player.findOne({ openid, deleted: { $ne: true } })
  if (player && r) {
    try {
      await r.set(playerKey(openid), JSON.stringify(player.toObject()), 'EX', PLAYER_TTL)
    } catch (e) {}
  }
  return player
}

async function cachePlayer(player) {
  const r = redis()
  if (!r || !player) return
  try {
    await r.set(playerKey(player.openid), JSON.stringify(player.toObject ? player.toObject() : player), 'EX', PLAYER_TTL)
  } catch (e) {}
}

async function invalidatePlayer(openid) {
  const r = redis()
  if (!r) return
  try {
    await r.del(playerKey(openid))
  } catch (e) {}
}

// ─── City Stock Cache ───────────────────────────────────────────

async function getCity(cityId) {
  const r = redis()
  if (r) {
    try {
      const raw = await r.get(cityKey(cityId))
      if (raw) {
        const doc = JSON.parse(raw)
        return City.hydrate(doc)
      }
    } catch (e) {
      WARN(`Redis 读取 City 失败: ${e.message}`)
    }
  }

  let cityDoc = await City.findOne({ id: cityId })
  if (!cityDoc) {
    cityDoc = await City.create({ id: cityId, stock: {}, lastStockUpdate: new Date() })
  }
  if (r) {
    try {
      await r.set(cityKey(cityId), JSON.stringify(cityDoc.toObject()), 'EX', CITY_TTL)
    } catch (e) {}
  }
  return cityDoc
}

async function cacheCity(cityDoc) {
  const r = redis()
  if (!r || !cityDoc) return
  try {
    const obj = cityDoc.toObject ? cityDoc.toObject() : cityDoc
    await r.set(cityKey(obj.id), JSON.stringify(obj), 'EX', CITY_TTL)
  } catch (e) {}
}

async function invalidateCity(cityId) {
  const r = redis()
  if (!r) return
  try {
    await r.del(cityKey(cityId))
  } catch (e) {}
}

// ─── 便捷：写后即缓存 ────────────────────────────────────────────

async function saveAndCacheCity(cityDoc) {
  await cityDoc.save()
  await cacheCity(cityDoc)
}

module.exports = {
  getPlayer,
  cachePlayer,
  invalidatePlayer,
  getCity,
  cacheCity,
  invalidateCity,
  saveAndCacheCity
}
