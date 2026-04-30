#!/usr/bin/env node
/**
 * @file sim-e2e-full.js
 * @description 双玩家全流程模拟测试 — 纯 OceanBus 通道
 *
 * 测试矩阵:
 *   Player A (黑珍珠号): 注册→入驻→查城→买→航行→抵达→卖→挂牌→P2P合约
 *   Player B (飞翔荷兰人号): 注册→入驻→查城→买→航行→抵达→卖→挂牌→P2P合约
 *   系统: capabilities, ping, status
 */

const OceanBusClient = require('./skills/captain-lobster/src/oceanbus')

const OCEANBUS_URL = process.env.OCEANBUS_URL || 'https://ai-t.ihaola.com.cn/api/l0'
const L1_OPENID = process.env.L1_OPENID
if (!L1_OPENID) { console.error('请设置 L1_OPENID 环境变量'); process.exit(1) }

// ── 工具 ──────────────────────────────────────
let passed = 0, failed = 0, total = 0
function check(label, ok, detail) {
  total++
  if (ok) { passed++; console.log(`  ✅ ${label}${detail ? ' — ' + detail : ''}`) }
  else    { failed++; console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`) }
  return ok
}

// ── OceanBus 消息收发 ─────────────────────────
async function sendAndWait(client, action, params = {}, label = action) {
  const rid = `sim_${action}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`
  const sendResult = await client.sendMessage(L1_OPENID, JSON.stringify({ action, request_id: rid, ...params }))
  if (sendResult.code !== 0) {
    check(label, false, `sendMessage failed code=${sendResult.code}`)
    return null
  }
  // 轮询等待响应（最多 60 秒墙钟截止）
  const reply = await client.pollForReply(rid, 60000, 1000)
  if (!reply) {
    check(label, false, 'pollForReply timeout (60s)')
    return null
  }
  if (reply.code !== 0) {
    check(label, false, `L1 error code=${reply.code}: ${reply.data?.msg || reply.msg || 'unknown'}`)
    return reply
  }
  return reply
}

// ── 主流程 ────────────────────────────────────
async function main() {
  const startTs = Date.now()
  console.log('══════════════════════════════════════════════')
  console.log('  龙虾船长 双玩家全流程模拟测试')
  console.log('  通道: OceanBus L0')
  console.log(`  L1: ${L1_OPENID.substring(0, 20)}...`)
  console.log('══════════════════════════════════════════════\n')

  // ─── Step 1: 系统连通性 & 能力查询 ──────────
  console.log('── 第 1 步: 系统能力查询 ──')
  const sysClient = new OceanBusClient(OCEANBUS_URL)
  await sysClient.register()
  check('系统 Agent 注册', sysClient.isReady(), `AgentId=${sysClient.agentId.substring(0, 12)}`)

  const pingReply = await sendAndWait(sysClient, 'ping', {}, 'ping L1 连通性')
  if (pingReply) check('ping 响应', pingReply.data?.status === 'ok', `service=${pingReply.data?.service}`)

  const capReply = await sendAndWait(sysClient, 'capabilities', {}, 'capabilities 能力查询')
  if (capReply) {
    const count = capReply.data?.actions ? Object.keys(capReply.data.actions).length : 0
    check('capabilities 返回', count > 0, `${count} 个 action, ${capReply.data?.cities?.length || 0} 个城市, ${capReply.data?.items?.length || 0} 种商品`)
  }
  console.log('')

  // ─── Step 2: 玩家 A 注册 & 入驻 ──────────────
  console.log('── 第 2 步: Player A (黑珍珠号) 注册入驻 ──')
  const clientA = new OceanBusClient(OCEANBUS_URL)
  await clientA.register()
  const aReady = clientA.isReady()
  check('A: OceanBus 注册', aReady, `AgentId=${clientA.agentId.substring(0, 12)}`)

  const enrollA = await sendAndWait(clientA, 'enroll', {
    openid: clientA.openid,
    publicKey: 'pk_黑珍珠号',
    initialGold: 10000
  }, 'A: enroll 入驻')
  let aGold = 10000
  if (enrollA) {
    aGold = enrollA.data?.doc?.gold || enrollA.data?.gold || 10000
    check('A: enroll 响应', aGold > 0, `初始金币 ${aGold}`)
  }
  const aOpenid = clientA.openid
  console.log('')

  // ─── Step 3: 玩家 B 注册 & 入驻 ──────────────
  console.log('── 第 3 步: Player B (飞翔荷兰人号) 注册入驻 ──')
  const clientB = new OceanBusClient(OCEANBUS_URL)
  await clientB.register()
  check('B: OceanBus 注册', clientB.isReady(), `AgentId=${clientB.agentId.substring(0, 12)}`)

  const enrollB = await sendAndWait(clientB, 'enroll', {
    openid: clientB.openid,
    publicKey: 'pk_飞翔荷兰人号',
    initialGold: 8000
  }, 'B: enroll 入驻')
  let bGold = 8000
  if (enrollB) {
    bGold = enrollB.data?.doc?.gold || enrollB.data?.gold || 8000
    check('B: enroll 响应', bGold > 0, `初始金币 ${bGold}`)
  }
  const bOpenid = clientB.openid
  console.log('')

  // ─── Step 4: 查询城市行情 ────────────────────
  console.log('── 第 4 步: 查询城市行情 ──')
  const cityA = await sendAndWait(clientA, 'get_city', { city_id: 'canton' }, 'A: get_city 广州')
  if (cityA) {
    const hasPrices = !!(cityA.data?.city?.prices || cityA.data?.prices)
    check('A: 广州行情', hasPrices, '价格数据获取成功')
    // 打印关键价格
    if (cityA.data?.city?.prices?.silk) {
      const s = cityA.data.city.prices.silk
      console.log(`    丝绸: buy=${s.buy} sell=${s.sell} market=${s.market || s.base}`)
    }
  }

  const cityB = await sendAndWait(clientB, 'get_city', { city_id: 'canton' }, 'B: get_city 广州')
  if (cityB) check('B: 广州行情', !!(cityB.data?.city?.prices || cityB.data?.prices))
  console.log('')

  // ─── Step 5: NPC 交易 (买入) ──────────────────
  console.log('── 第 5 步: NPC 买入 ──')
  const buyA = await sendAndWait(clientA, 'trade_npc', {
    openid: aOpenid, item: 'silk', amount: 10, trade_action: 'buy'
  }, 'A: buy silk×10')
  if (buyA) {
    aGold = buyA.data?.playerGold || aGold
    const cargo = buyA.data?.cargo || {}
    check('A: buy 成功', cargo.silk >= 10, `金币剩余 ${aGold}, 货舱 silk=${cargo.silk || 0}`)
  }

  const buyB = await sendAndWait(clientB, 'trade_npc', {
    openid: bOpenid, item: 'tea', amount: 8, trade_action: 'buy'
  }, 'B: buy tea×8')
  if (buyB) {
    bGold = buyB.data?.playerGold || bGold
    const cargo = buyB.data?.cargo || {}
    check('B: buy 成功', cargo.tea >= 8, `金币剩余 ${bGold}, 货舱 tea=${cargo.tea || 0}`)
  }
  console.log('')

  // ─── Step 6: 挂牌意向 ────────────────────────
  console.log('── 第 6 步: 挂牌意向 ──')
  const intentA = await sendAndWait(clientA, 'intent', {
    openid: aOpenid, intent: '大量收购香料！价格好商量'
  }, 'A: 挂牌')
  if (intentA) check('A: 意向更新', intentA.data?.intent?.includes('香料'))

  const intentB = await sendAndWait(clientB, 'intent', {
    openid: bOpenid, intent: '出售上等茶叶，欢迎询价'
  }, 'B: 挂牌')
  if (intentB) check('B: 意向更新', intentB.data?.intent?.includes('茶叶'))
  console.log('')

  // ─── Step 7: 航行到新城市 ────────────────────
  console.log('── 第 7 步: 航行 → 科泽科德 ──')
  const moveA = await sendAndWait(clientA, 'move', {
    openid: aOpenid, target_city: 'calicut'
  }, 'A: move → calicut')
  let needArriveA = true
  if (moveA) {
    const st = moveA.data?.status
    const time = moveA.data?.sailingTime || 0
    check('A: 启航', st === 'sailing', `航程 ${time} 分钟`)
    if (st === 'docked') needArriveA = false
  }

  const moveB = await sendAndWait(clientB, 'move', {
    openid: bOpenid, target_city: 'calicut'
  }, 'B: move → calicut')
  let needArriveB = true
  if (moveB) {
    const st = moveB.data?.status
    const time = moveB.data?.sailingTime || 0
    check('B: 启航', st === 'sailing', `航程 ${time} 分钟`)
    if (st === 'docked') needArriveB = false
  }
  console.log('')

  // ─── Step 8: 抵达 ────────────────────────────
  console.log('── 第 8 步: 抵达科泽科德 ──')
  if (needArriveA) {
    // 幂等测试：先发一次 arrive（应该失败，还在航行中）
    const earlyArrive = await sendAndWait(clientA, 'arrive', { openid: aOpenid }, 'A: arrive 提前(预计失败)')
    // 不管成败，等 2 秒再试
    await new Promise(r => setTimeout(r, 2000))
  }
  const arriveA = await sendAndWait(clientA, 'arrive', { openid: aOpenid }, 'A: arrive')
  if (arriveA) {
    const city = arriveA.data?.city
    check('A: 抵达', city === 'calicut', `当前位置: ${city}`)
    aGold = arriveA.data?.gold || arriveA.data?.playerGold || aGold
  }

  const arriveB = await sendAndWait(clientB, 'arrive', { openid: bOpenid }, 'B: arrive')
  if (arriveB) {
    const city = arriveB.data?.city
    check('B: 抵达', city === 'calicut', `当前位置: ${city}`)
    bGold = arriveB.data?.gold || arriveB.data?.playerGold || bGold
  }
  console.log('')

  // ─── Step 9: 新城市行情 & 卖出 ────────────────
  console.log('── 第 9 步: 科泽科德行情 & 卖出 ──')
  const cityA2 = await sendAndWait(clientA, 'get_city', { city_id: 'calicut' }, 'A: get_city 科泽科德')
  if (cityA2) {
    const hasCalicut = !!(cityA2.data?.city?.prices || cityA2.data?.prices)
    check('A: 科泽科德行情', hasCalicut)
  }

  const sellA = await sendAndWait(clientA, 'trade_npc', {
    openid: aOpenid, item: 'silk', amount: 5, trade_action: 'sell'
  }, 'A: sell silk×5')
  if (sellA) {
    aGold = sellA.data?.playerGold || aGold
    check('A: sell 成功', aGold > 5000, `金币 ${aGold}`)
  }

  const sellB = await sendAndWait(clientB, 'trade_npc', {
    openid: bOpenid, item: 'tea', amount: 4, trade_action: 'sell'
  }, 'B: sell tea×4')
  if (sellB) {
    bGold = sellB.data?.playerGold || bGold
    check('B: sell 成功', bGold > 5000, `金币 ${bGold}`)
  }
  console.log('')

  // ─── Step 10: P2P 合约 ───────────────────────
  console.log('── 第 10 步: P2P 合约 ──')

  // A 创建合约：买 B 的 tea
  const contract = await sendAndWait(clientA, 'create_contract', {
    buyer_openid: aOpenid,
    seller_openid: bOpenid,
    item: 'tea',
    amount: 2,
    price: 350,
    delivery_city: 'calicut'
  }, 'A: create_contract (买B的tea×2)')
  let contractId = null
  if (contract) {
    contractId = contract.data?.contract?.id
    check('合约创建', !!contractId, `contractId=${contractId?.substring(0, 16)}`)
  }

  // 查合约列表
  const listA = await sendAndWait(clientA, 'list_contracts', { openid: aOpenid }, 'A: list_contracts')
  if (listA) check('合约列表', Array.isArray(listA.data?.contracts), `${listA.data?.contracts?.length || 0} 个合约`)

  // 取消合约
  if (contractId) {
    const cancel = await sendAndWait(clientA, 'cancel_contract', {
      contract_id: contractId, openid: aOpenid
    }, 'A: cancel_contract')
    if (cancel) check('合约取消', cancel.data?.status === 'cancelled')
  }
  console.log('')

  // ─── Step 11: 状态查询 ───────────────────────
  console.log('── 第 11 步: 状态查询 ──')
  const statusA = await sendAndWait(clientA, 'status', { openid: aOpenid }, 'A: status')
  if (statusA) {
    const p = statusA.data?.player
    check('A: 状态', !!p, `位置=${p?.currentCity} 金币=${p?.gold} status=${p?.status}`)
  }

  const statusB = await sendAndWait(clientB, 'status', { openid: bOpenid }, 'B: status')
  if (statusB) {
    const p = statusB.data?.player
    check('B: 状态', !!p, `位置=${p?.currentCity} 金币=${p?.gold} status=${p?.status}`)
  }
  console.log('')

  // ─── Step 12: 返回广州 (航行) ──────────────────
  console.log('── 第 12 步: 返回广州 ──')
  await sendAndWait(clientA, 'move', { openid: aOpenid, target_city: 'canton' }, 'A: move → canton')
  // 等 2 秒模拟航行
  await new Promise(r => setTimeout(r, 2000))
  await sendAndWait(clientA, 'arrive', { openid: aOpenid }, 'A: arrive canton')

  await sendAndWait(clientB, 'move', { openid: bOpenid, target_city: 'canton' }, 'B: move → canton')
  await new Promise(r => setTimeout(r, 2000))
  await sendAndWait(clientB, 'arrive', { openid: bOpenid }, 'B: arrive canton')
  console.log('')

  // ─── 结果 ─────────────────────────────────────
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1)
  console.log('══════════════════════════════════════════════')
  console.log(`  测试完成: ${passed} 通过 / ${failed} 失败 / ${total} 总计`)
  console.log(`  耗时: ${elapsed}s`)
  console.log(`  通过率: ${(passed / total * 100).toFixed(1)}%`)
  console.log('══════════════════════════════════════════════')

  if (failed > 0) process.exit(1)
}

main().catch(err => { console.error('脚本异常:', err); process.exit(1) })
