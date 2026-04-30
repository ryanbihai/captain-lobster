#!/usr/bin/env node
/**
 * @file diag-inbox.js
 * @description 最小化诊断：发消息给 L1 → 等待 → 检查收件箱
 * 核心问题：L1 的响应是否真的到达了客户端邮箱？
 */

const OceanBusClient = require('./skills/captain-lobster/src/oceanbus')

const OCEANBUS_URL = process.env.OCEANBUS_URL || 'https://ai-t.ihaola.com.cn/api/l0'
const L1_OPENID = process.env.L1_OPENID
if (!L1_OPENID) { console.error('请设置 L1_OPENID 环境变量'); process.exit(1) }

const ts = () => new Date().toISOString().split('T')[1].replace('Z', '')

async function main() {
  console.log('══════ 收件箱直达诊断 ══════')
  const client = new OceanBusClient(OCEANBUS_URL)

  // 注册
  console.log(`[${ts()}] 注册...`)
  const reg = await client.register()
  if (!client.isReady()) { console.error('注册失败'); process.exit(1) }
  console.log(`[${ts()}] AgentId: ${client.agentId}`)
  console.log(`[${ts()}] MyOpenID: ${client.openid}`)

  // 清空收件箱（获取当前 seq）
  console.log(`[${ts()}] 检查当前收件箱...`)
  const preSync = await client.syncMessages()
  console.log(`[${ts()}] 当前 since_seq=${preSync.data?.last_seq || 0}, 消息数=${preSync.data?.messages?.length || 0}`)

  // 发送 ping 到 L1
  const reqId = `diag_${Date.now()}`
  console.log(`[${ts()}] 发送 ping request_id=${reqId}`)
  const sendResult = await client.sendMessage(L1_OPENID, JSON.stringify({ action: 'ping', request_id: reqId }))
  console.log(`[${ts()}] sendMessage → code=${sendResult.code} http=${sendResult.httpStatus}`)

  // 等待 L1 轮询处理（L1 每 5s 轮询一次）
  console.log(`[${ts()}] 等待 15 秒（让 L1 有充足时间处理+回复）...`)
  await new Promise(r => setTimeout(r, 15000))

  // 检查收件箱（从头开始，since_seq=0 确保看到所有消息）
  console.log(`[${ts()}] 拉取完整收件箱 (since_seq=0)...`)
  const sync = await client.syncMessages(0)
  console.log(`[${ts()}] syncMessages → code=${sync.code} http=${sync.httpStatus}`)
  console.log(`[${ts()}] last_seq=${sync.data?.last_seq}, messages=${sync.data?.messages?.length || 0}`)

  if (sync.data?.messages?.length > 0) {
    console.log(`\n收件箱全部消息 (最新 20 条):`)
    const recent = sync.data.messages.slice(-20)
    for (const msg of recent) {
      try {
        const p = JSON.parse(msg.content)
        const match = p.request_id === reqId ? ' ← 目标!' : ''
        console.log(`  [${msg.from_openid?.substring(0, 16)}] action=${p.action} req=${(p.request_id||'').substring(0, 30)} code=${p.code}${match}`)
      } catch (e) {
        console.log(`  [raw] ${msg.content?.substring(0, 100)}`)
      }
    }

    // 精确查找我们的 request_id
    const found = sync.data.messages.find(m => {
      try { return JSON.parse(m.content).request_id === reqId } catch (e) { return false }
    })
    if (found) {
      console.log(`\n✅ 找到目标响应: ${found.content?.substring(0, 200)}`)
    } else {
      console.log(`\n❌ 未找到 request_id=${reqId} 的响应`)
    }
  } else {
    console.log('\n❌ 收件箱完全为空 — L1 的响应没有被投递到客户端')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
