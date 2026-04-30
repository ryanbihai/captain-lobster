#!/usr/bin/env node
/**
 * @file diag-l1-flow.js
 * @description 模拟前端 Skill 联调 L1 后端，逐步骤打印日志排查问题
 *
 * 流程：注册 → ping → get_city → capabilities → 再 ping
 * 每步详细记录时机和结果
 */

const OceanBusClient = require('./skills/captain-lobster/src/oceanbus')

const OCEANBUS_URL = process.env.OCEANBUS_URL || 'https://ai-t.ihaola.com.cn/api/l0'
// L1 的公开 OpenID（与 L1 启动日志一致）
const L1_OPENID = process.env.L1_OPENID
if (!L1_OPENID) { console.error('请设置 L1_OPENID 环境变量'); process.exit(1) }

const log = (label, detail) => {
  const ts = new Date().toISOString().split('T')[1].replace('Z', '')
  if (detail !== undefined) {
    console.log(`[${ts}] ${label}`, typeof detail === 'object' ? JSON.stringify(detail).substring(0, 300) : detail)
  } else {
    console.log(`[${ts}] ${label}`)
  }
}

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  龙虾船长 L1 联调诊断')
  console.log('═══════════════════════════════════════════')
  log('OceanBus URL', OCEANBUS_URL)
  log('L1 OpenID', L1_OPENID)
  console.log('')

  const client = new OceanBusClient(OCEANBUS_URL)

  // ── Step 1: 注册 ──
  console.log('── Step 1: 注册测试 Agent ──')
  log('开始注册...')
  const regStart = Date.now()
  const regResult = await client.register()
  log(`注册完成 (${Date.now() - regStart}ms)`, { code: regResult.code, agentId: client.agentId, hasApiKey: !!client.apiKey, openid: client.openid ? client.openid.substring(0, 20) + '...' : 'NONE' })

  if (!client.isReady()) {
    console.error('❌ 注册失败，终止测试')
    console.error(JSON.stringify(regResult, null, 2).substring(0, 500))
    process.exit(1)
  }
  console.log(`✅ Agent 就绪: ${client.agentId}`)
  console.log('')

  // ── Step 2: Ping ──
  console.log('── Step 2: Ping L1 ──')
  const pingId = `diag_ping_${Date.now()}`
  log('发送 ping...', { request_id: pingId })
  const pingSendStart = Date.now()
  const pingSendResult = await client.sendMessage(L1_OPENID, JSON.stringify({ action: 'ping', request_id: pingId }))
  log(`sendMessage 返回 (${Date.now() - pingSendStart}ms)`, { code: pingSendResult.code, httpStatus: pingSendResult.httpStatus })

  log('开始 pollForReply (最多45s)...')
  const pingReplyStart = Date.now()
  const pingReply = await client.pollForReply(pingId, 45000, 1000)
  const pingElapsed = Date.now() - pingReplyStart
  if (pingReply) {
    console.log(`✅ ping 成功 (${pingElapsed}ms) →`, JSON.stringify(pingReply).substring(0, 200))
  } else {
    console.log(`❌ ping 超时 (${pingElapsed}ms) — L1 无响应`)
  }
  console.log('')

  // ── Step 3: get_city ──
  console.log('── Step 3: get_city 广州 ──')
  const cityId = `diag_get_city_${Date.now()}`
  log('发送 get_city...', { request_id: cityId })
  const citySendStart = Date.now()
  const citySendResult = await client.sendMessage(L1_OPENID, JSON.stringify({ action: 'get_city', request_id: cityId, city_id: 'canton' }))
  log(`sendMessage 返回 (${Date.now() - citySendStart}ms)`, { code: citySendResult.code, httpStatus: citySendResult.httpStatus })

  log('开始 pollForReply (最多45s)...')
  const cityReplyStart = Date.now()
  const cityReply = await client.pollForReply(cityId, 45000, 1000)

  // 诊断：如果不成功，看看同步到了什么消息
  if (!cityReply) {
    const cityElapsed = Date.now() - cityReplyStart
    console.log(`❌ get_city 超时 (${cityElapsed}ms) — 诊断收件箱...`)
    const diagSync = await client.syncMessages()
    log('syncMessages 结果', { code: diagSync.code, msgCount: diagSync.data?.messages?.length || 0, last_seq: diagSync.data?.last_seq })
    if (diagSync.data?.messages?.length > 0) {
      console.log('  收件箱最近消息:')
      for (const msg of diagSync.data.messages.slice(-5)) {
        try {
          const p = JSON.parse(msg.content)
          console.log(`    - [${msg.from_openid?.substring(0, 12)}] action=${p.action} request_id=${p.request_id?.substring(0, 30)} code=${p.code}`)
        } catch (e) {
          console.log(`    - [raw] ${msg.content?.substring(0, 80)}`)
        }
      }
    }
  } else {
    console.log(`✅ get_city 成功 (${Date.now() - cityReplyStart}ms) →`, JSON.stringify(cityReply).substring(0, 300))
  }
  console.log('')

  // ── Step 4: capabilities ──
  console.log('── Step 4: capabilities ──')
  const capId = `diag_cap_${Date.now()}`
  log('发送 capabilities...', { request_id: capId })
  const capSendResult = await client.sendMessage(L1_OPENID, JSON.stringify({ action: 'capabilities', request_id: capId }))
  log(`sendMessage 返回`, { code: capSendResult.code, httpStatus: capSendResult.httpStatus })

  log('开始 pollForReply (最多45s)...')
  const capReplyStart = Date.now()
  const capReply = await client.pollForReply(capId, 45000, 1000)
  if (capReply) {
    const actionCount = capReply.data?.actions ? Object.keys(capReply.data.actions).length : 0
    console.log(`✅ capabilities 成功 (${Date.now() - capReplyStart}ms) → ${actionCount} 个 action`)
  } else {
    console.log(`❌ capabilities 超时 (${Date.now() - capReplyStart}ms)`)
    // 再次诊断
    const diagSync2 = await client.syncMessages()
    log('syncMessages', { code: diagSync2.code, msgCount: diagSync2.data?.messages?.length || 0 })
    if (diagSync2.data?.messages?.length > 0) {
      console.log('  收件箱最近消息:')
      for (const msg of diagSync2.data.messages.slice(-5)) {
        try {
          const p = JSON.parse(msg.content)
          console.log(`    - from=${msg.from_openid?.substring(0, 12)} action=${p.action} request_id=${p.request_id?.substring(0, 30)}`)
        } catch (e) {
          console.log(`    - [raw] ${msg.content?.substring(0, 80)}`)
        }
      }
    }
  }
  console.log('')

  // ── Step 5: 再 Ping 验证连通性 ──
  console.log('── Step 5: 最终连通性验证 ──')
  const ping2Id = `diag_ping2_${Date.now()}`
  await client.sendMessage(L1_OPENID, JSON.stringify({ action: 'ping', request_id: ping2Id }))
  const ping2Reply = await client.pollForReply(ping2Id, 10000, 1000)
  if (ping2Reply) {
    console.log('✅ 最终 ping 成功 — OceanBus 通道正常')
  } else {
    console.log('❌ 最终 ping 失败 — 通道可能有问题')
  }

  console.log('')
  console.log('═══════════════════════════════════════════')
  console.log('  诊断完成')
  console.log('═══════════════════════════════════════════')
}

main().catch(err => {
  console.error('诊断脚本异常:', err)
  process.exit(1)
})
