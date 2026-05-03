#!/usr/bin/env node
/**
 * @file start-oceanbus.js
 * @description 启动 OceanBus 消息驱动的 L1 服务（单实例保护）
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const LobsterL1Service = require('./oceanbus-service')
const AdminPanel = require('./admin-panel')

const PIDFILE = path.join(os.homedir(), '.captain-lobster', 'l1.pid')

function acquireLock() {
  if (fs.existsSync(PIDFILE)) {
    const raw = fs.readFileSync(PIDFILE, 'utf8').trim()
    const existingPid = parseInt(raw, 10)
    if (existingPid && isProcessAlive(existingPid)) {
      console.error(`❌ L1 已在运行中 (PID: ${existingPid})`)
      console.error(`   如需强制重启，请先停止旧实例或删除 ${PIDFILE}`)
      return false
    }
    // 残留的 pidfile，清理掉
    console.warn(`⚠️ 清理残留 pidfile (PID ${existingPid} 已不存在)`)
    try { fs.unlinkSync(PIDFILE) } catch (_) { /* ignore */ }
  }

  // 确保目录存在
  const dir = path.dirname(PIDFILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  fs.writeFileSync(PIDFILE, String(process.pid), 'utf8')
  return true
}

function releaseLock() {
  try {
    if (fs.existsSync(PIDFILE)) {
      const raw = fs.readFileSync(PIDFILE, 'utf8').trim()
      if (parseInt(raw, 10) === process.pid) {
        fs.unlinkSync(PIDFILE)
      }
    }
  } catch (_) { /* ignore */ }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (_) {
    return false
  }
}

async function main() {
  if (!acquireLock()) {
    process.exit(1)
  }
  // 正常退出和信号退出时都释放锁
  process.on('exit', () => releaseLock())
  process.on('SIGINT', () => { releaseLock(); process.exit(0) })
  process.on('SIGTERM', () => { releaseLock(); process.exit(0) })

  console.log('🦞 龙虾船长 L1 服务启动中...')

  const service = new LobsterL1Service()
  const result = await service.start()

  if (!result.success) {
    console.error('❌ 启动失败:', result.error)
    process.exit(1)
  }

  console.log('✅ L1 服务已启动 (PID: ' + process.pid + ')')
  console.log('请将以下环境变量配置到 Skill:')
  console.log(`L1_OPENID=${result.openid}`)
  console.log('')
  console.log('当前 L1 服务信息:')
  console.log(`  AgentId: ${result.agentId}`)
  console.log(`  OpenID: ${result.openid}`)

  // ── 启动管理面板（仅 127.0.0.1）──
  service._stats = { reqCount: 0, errCount: 0, lastMsgTime: null }
  const origHandle = service.handleMessage.bind(service)
  service.handleMessage = async function(msg) {
    service._stats.reqCount++
    service._stats.lastMsgTime = Date.now()
    try {
      return await origHandle(msg)
    } catch (e) {
      service._stats.errCount++
      throw e
    }
  }
  const admin = new AdminPanel(service)
  admin.start()
}

main().catch(err => {
  console.error('L1 服务异常:', err)
  process.exit(1)
})
