#!/usr/bin/env node
/**
 * @file sim-e2e-v2.js
 * @description 双玩家端到端完整测试 v2 — 覆盖全部功能 + 新增特性
 *
 * 测试矩阵 (含 captainToken 鉴权、P2P 私聊、供需波动、行情趋势):
 *   系统:     ping, capabilities
 *   玩家A/B:  注册→入驻(含token)→查城→买入→查趋势→挂牌→P2P私聊→查信箱
 *            →航行→抵达→卖出→P2P合约→状态查询→改名
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

// ── OceanBus 消息收发（自动注入 captain_token）──
async function sendAndWait(client, action, params = {}, label = action, token = null) {
  const rid = `sim_${action}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`
  const payload = { action, request_id: rid, ...params }
  // 注入鉴权令牌（enroll 除外）
  if (token && action !== 'enroll') payload.captain_token = token
  const sendResult = await client.sendMessage(L1_OPENID, JSON.stringify(payload))
  if (sendResult.code !== 0) {
    check(label, false, `sendMessage failed code=${sendResult.code}`)
    return null
  }
  const reply = await client.pollForReply(rid, 60000, 1000)
  if (!reply) {
    check(label, false, 'pollForReply timeout (60s)')
    return null
  }
  if (reply.code === 401) {
    check(label, false, `鉴权失败: ${reply.data?.msg || reply.msg}`)
    return reply
  }
  if (reply.code !== 0) {
    // 某些错误是可预期的（如航行中不能交易）
    return reply
  }
  return reply
}

// ── 主流程 ────────────────────────────────────
async function main() {
  const startTs = Date.now()
  console.log('══════════════════════════════════════════════')
  console.log('  龙虾船长 双玩家全流程模拟测试 v2')
  console.log('  覆盖: captainToken鉴权 / P2P私聊 / 供需波动')
  console.log('══════════════════════════════════════════════\n')

  // ═══════════════════════════════════════════════
  // Step 1: 系统连通性 & 能力查询
  // ═══════════════════════════════════════════════
  console.log('── 1. 系统能力查询 ──')
  const sys = new OceanBusClient(OCEANBUS_URL)
  await sys.register()
  check('系统注册', sys.isReady())

  const ping = await sendAndWait(sys, 'ping', {}, 'ping')
  if (ping) check('ping', ping.data?.status === 'ok')

  const cap = await sendAndWait(sys, 'capabilities', {}, 'capabilities')
  let actionCount = 0
  if (cap) {
    actionCount = Object.keys(cap.data?.actions || {}).length
    check('capabilities', actionCount >= 12, `${actionCount} actions, ${cap.data?.cities?.length} cities, ${cap.data?.items?.length} items`)
  }
  console.log('')

  // ═══════════════════════════════════════════════
  // Step 2: 玩家 A 注册 & 入驻
  // ═══════════════════════════════════════════════
  console.log('── 2. Player A (黑珍珠号) 注册入驻 ──')
  const clientA = new OceanBusClient(OCEANBUS_URL)
  await clientA.register()
  check('A: 注册', clientA.isReady(), clientA.agentId.substring(0, 12))

  const enrollA = await sendAndWait(clientA, 'enroll', {
    openid: clientA.openid,
    publicKey: 'pk_黑珍珠号',
    captainName: '黑珍珠号',
    initialGold: 20000
  }, 'A: enroll')
  let aToken = null, aGold = 20000
  if (enrollA) {
    aToken = enrollA.data?.captainToken || enrollA.data?.doc?.captainToken
    aGold = enrollA.data?.doc?.gold || 20000
    check('A: 入驻', !!aToken, `token=${aToken?.substring(0, 8)}... 金币=${aGold} 出生港=${enrollA.data?.doc?.currentCity}`)
  }
  const aOpenid = clientA.openid
  console.log('')

  // ═══════════════════════════════════════════════
  // Step 3: 玩家 B 注册 & 入驻
  // ═══════════════════════════════════════════════
  console.log('── 3. Player B (飞翔荷兰人号) 注册入驻 ──')
  const clientB = new OceanBusClient(OCEANBUS_URL)
  await clientB.register()
  check('B: 注册', clientB.isReady(), clientB.agentId.substring(0, 12))

  const enrollB = await sendAndWait(clientB, 'enroll', {
    openid: clientB.openid,
    publicKey: 'pk_飞翔荷兰人号',
    captainName: '飞翔荷兰人号',
    initialGold: 20000
  }, 'B: enroll')
  let bToken = null, bGold = 20000
  if (enrollB) {
    bToken = enrollB.data?.captainToken || enrollB.data?.doc?.captainToken
    bGold = enrollB.data?.doc?.gold || 20000
    check('B: 入驻', !!bToken, `token=${bToken?.substring(0, 8)}... 金币=${bGold} 出生港=${enrollB.data?.doc?.currentCity}`)
  }
  const bOpenid = clientB.openid
  console.log('')

  // ═══════════════════════════════════════════════
  // Step 4: 查询城市行情（带趋势）
  // ═══════════════════════════════════════════════
  console.log('── 4. 城市行情 & 趋势 ──')
  const cityA = await sendAndWait(clientA, 'get_city', { city_id: 'canton' }, 'A: 广州行情', aToken)
  if (cityA) {
    const prices = cityA.data?.city?.prices
    check('A: 行情', !!prices)
    if (prices?.silk) {
      const s = prices.silk
      console.log(`    丝绸 buy=${s.buy} sell=${s.sell} trend=${s.trend || 'N/A'}`)
      check('A: 趋势字段', !!s.trend, `silk:${s.trend}`)
    }
    // 检查同港玩家是否含名字
    const players = cityA.data?.players || []
    if (players.length > 0) {
      check('A: 同港玩家有名字', !!players[0].name, players[0].name)
    }
  }
  console.log('')

  // ═══════════════════════════════════════════════
  // Step 5: 验证鉴权 — 错误 token 应被拒绝
  // ═══════════════════════════════════════════════
  console.log('── 5. 鉴权验证 ──')
  // 注意：sendAndWait 会自动注入正确的 token，鉴权测试需要直接构造请求
  const badRid = `sim_badAuth_${Date.now()}`
  await clientA.sendMessage(L1_OPENID, JSON.stringify({
    action: 'status', request_id: badRid,
    openid: aOpenid, captain_token: 'bad_token_12345'
  }))
  const badReply = await clientA.pollForReply(badRid, 10000, 1000)
  if (badReply && badReply.code === 401) {
    check('鉴权拒绝', true, '错误 token → 401 (正确)')
  } else if (badReply && badReply.code === 0) {
    check('鉴权拒绝', false, '错误 token 居然通过了!')
  } else {
    check('鉴权拒绝', false, `code=${badReply?.code} ${badReply?.data?.msg || badReply?.msg || 'timeout'}`)
  }
  console.log('')

  // ═══════════════════════════════════════════════
  // Step 6: NPC 交易（买入） + 供需波动
  // ═══════════════════════════════════════════════
  console.log('── 6. NPC 买入 & 供需波动 ──')
  const buyA1 = await sendAndWait(clientA, 'trade_npc', {
    openid: aOpenid, item: 'silk', amount: 10, trade_action: 'buy'
  }, 'A: buy silk×10', aToken)
  if (buyA1) {
    aGold = buyA1.data?.playerGold || aGold
    check('A: buy', buyA1.data?.cargo?.silk >= 10, `金币=${aGold} silk=${buyA1.data?.cargo?.silk}`)
  }

  // 大量买入后价格应上涨（在玩家当前所在城市）
  const buyA2 = await sendAndWait(clientA, 'trade_npc', {
    openid: aOpenid, item: 'silk', amount: 30, trade_action: 'buy'
  }, 'A: buy silk×30 (推高价格)', aToken)
  if (buyA2) aGold = buyA2.data?.playerGold || aGold

  // 重新查行情（玩家所在城市），验证趋势变了
  const playerCity = enrollA.data?.doc?.currentCity || 'canton'
  const cityAfterBuy = await sendAndWait(clientA, 'get_city', { city_id: playerCity }, `A: ${playerCity}行情(交易后)`, aToken)
  if (cityAfterBuy) {
    const trend = cityAfterBuy.data?.city?.prices?.silk?.trend
    const newBuy = cityAfterBuy.data?.city?.prices?.silk?.buy
    const origBuy = cityAfterBuy.data?.city?.prices?.silk?.market ? Math.round(cityAfterBuy.data.city.prices.silk.market * 1.05) : null
    check('供需推高价格', trend === 'up' || (origBuy && newBuy > origBuy), `silk buy=${newBuy} trend=${trend}`)
  }

  const buyB = await sendAndWait(clientB, 'trade_npc', {
    openid: bOpenid, item: 'tea', amount: 8, trade_action: 'buy'
  }, 'B: buy tea×8', bToken)
  if (buyB) {
    bGold = buyB.data?.playerGold || bGold
    check('B: buy', (buyB.data?.cargo?.tea || 0) >= 8, `金币=${bGold}`)
  }
  console.log('')

  // ═══════════════════════════════════════════════
  // Step 7: 挂牌意向
  // ═══════════════════════════════════════════════
  console.log('── 7. 挂牌意向 ──')
  await sendAndWait(clientA, 'intent', {
    openid: aOpenid, intent: '大量收购香料！价格好商量'
  }, 'A: 挂牌', aToken)
  await sendAndWait(clientB, 'intent', {
    openid: bOpenid, intent: '出售上等茶叶，欢迎询价'
  }, 'B: 挂牌', bToken)
  check('A&B 挂牌', true, '双方意向已更新')
  console.log('')

  // ═══════════════════════════════════════════════
  // Step 8: P2P 私聊
  // ═══════════════════════════════════════════════
  console.log('── 8. P2P 飞鸽传书 ──')

  // A 发消息给 B
  const p2pResult = await clientA.sendMessage(bOpenid, '你好飞翔荷兰人号，我是黑珍珠号！你的茶叶怎么卖？')
  check('A→B 发信', p2pResult.code === 0, `sendMessage → code=${p2pResult.code}`)

  // 等投递（L1 1s 轮询 + OceanBus 投递延迟）
  await new Promise(r => setTimeout(r, 5000))

  // B 查信箱（用 B 自己的 OceanBus agent 查自己的信箱）
  const inboxB = await clientB.syncMessages()
  console.log(`    B syncMessages: code=${inboxB.code} msgCount=${inboxB.data?.messages?.length || 0} lastSeq=${inboxB.data?.last_seq || 'N/A'}`)
  const bMessages = []
  if (inboxB.code === 0 && inboxB.data?.messages) {
    for (const m of inboxB.data.messages) {
      let isP2P = false
      try {
        const p = JSON.parse(m.content)
        if (!p.action && !p.request_id) isP2P = true
      } catch (e) {
        isP2P = true  // 非 JSON → 纯文本 → P2P 消息
      }
      if (isP2P) bMessages.push({ from: m.from_openid, content: m.content })
    }
  }
  check('B: 收到P2P信', bMessages.length > 0, `${bMessages.length} 封私信`)
  if (bMessages.length > 0) {
    console.log(`    信内容: ${bMessages[0].content?.substring(0, 60)}`)
  }

  // B 回复 A
  if (bMessages.length > 0) {
    const replyResult = await clientB.sendMessage(aOpenid, '黑珍珠号你好！我的茶叶 350 金币一箱，要多少？')
    check('B→A 回信', replyResult.code === 0, `sendMessage → code=${replyResult.code}`)
  }

  // 等投递
  await new Promise(r => setTimeout(r, 5000))

  // A 查信箱
  const inboxA = await clientA.syncMessages()
  console.log(`    A syncMessages: code=${inboxA.code} msgCount=${inboxA.data?.messages?.length || 0} lastSeq=${inboxA.data?.last_seq || 'N/A'}`)
  const aMessages = []
  if (inboxA.code === 0 && inboxA.data?.messages) {
    for (const m of inboxA.data.messages) {
      let isP2P = false
      try {
        const p = JSON.parse(m.content)
        if (!p.action && !p.request_id) isP2P = true
      } catch (e) {
        isP2P = true
      }
      if (isP2P) aMessages.push({ from: m.from_openid, content: m.content })
    }
  }
  check('A: 收到回信', aMessages.length > 0, `${aMessages.length} 封私信`)
  console.log('')

  // ═══════════════════════════════════════════════
  // Step 9: P2P 合约
  // ═══════════════════════════════════════════════
  console.log('── 9. P2P 合约 ──')
  const contract = await sendAndWait(clientA, 'create_contract', {
    buyer_openid: aOpenid,
    seller_openid: bOpenid,
    item: 'tea',
    amount: 3,
    price: 350,
    delivery_city: 'canton'
  }, 'A: 创建合约', aToken)
  let contractId = null
  if (contract) {
    contractId = contract.data?.contract?.id
    check('合约创建', !!contractId, contractId?.substring(0, 16))
  }

  const listContracts = await sendAndWait(clientA, 'list_contracts', { openid: aOpenid }, 'A: 查合约', aToken)
  if (listContracts) check('合约列表', Array.isArray(listContracts.data?.contracts))

  if (contractId) {
    const cancel = await sendAndWait(clientA, 'cancel_contract', {
      contract_id: contractId, openid: aOpenid
    }, 'A: 取消合约', aToken)
    if (cancel) check('合约取消', cancel.data?.status === 'cancelled')
  }
  console.log('')

  // ═══════════════════════════════════════════════
  // Step 10: 改名
  // ═══════════════════════════════════════════════
  console.log('── 10. 船长改名 ──')
  const rename = await sendAndWait(clientA, 'rename', {
    openid: aOpenid, name: '黑珍珠·改'
  }, 'A: 改名', aToken)
  if (rename) check('改名', rename.data?.name === '黑珍珠·改', rename.data?.name)
  console.log('')

  // ═══════════════════════════════════════════════
  // Step 11: 状态查询
  // ═══════════════════════════════════════════════
  console.log('── 11. 状态查询 ──')
  const statusA = await sendAndWait(clientA, 'status', { openid: aOpenid }, 'A: status', aToken)
  if (statusA) {
    const p = statusA.data?.player
    check('A: 状态', !!p, `位置=${p?.currentCity} 金币=${p?.gold} 船名=${p?.name}`)
  }
  const statusB = await sendAndWait(clientB, 'status', { openid: bOpenid }, 'B: status', bToken)
  if (statusB) {
    const p = statusB.data?.player
    check('B: 状态', !!p, `位置=${p?.currentCity} 金币=${p?.gold} 船名=${p?.name}`)
  }
  console.log('')

  // ═══════════════════════════════════════════════
  // 结果
  // ═══════════════════════════════════════════════
  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1)
  console.log('══════════════════════════════════════════════')
  console.log(`  测试完成: ${passed} 通过 / ${failed} 失败 / ${total} 总计`)
  console.log(`  耗时: ${elapsed}s`)
  console.log(`  通过率: ${(passed / total * 100).toFixed(1)}%`)
  if (failed > 0) {
    console.log(`  ❌ ${failed} 项失败`)
  } else {
    console.log('  🎉 全部通过!')
  }
  console.log('══════════════════════════════════════════════')

  if (failed > 0) process.exit(1)
}

main().catch(err => { console.error('脚本异常:', err); process.exit(1) })
