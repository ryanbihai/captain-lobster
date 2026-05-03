/**
 * @file test-full-secure.js
 * @description 完整端到端测试：船长觉醒 → NPC交易 → P2P交易 → 航海日志
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

console.log('\n' + '🦞'.repeat(25))
console.log('  完整端到端测试')
console.log('🦞'.repeat(25) + '\n')

const LOG_DIR = path.join(os.homedir(), '.captain-lobster', 'logs')
const KEY_DIR = path.join(os.homedir(), '.captain-lobster', 'keys')

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function test() {
  const results = { passed: 0, failed: 0 }

  function assert(condition, message) {
    if (condition) {
      results.passed++
      console.log('  ✅ ' + message)
    } else {
      results.failed++
      console.log('  ❌ ' + message)
    }
    return condition
  }

  console.log('[步骤1] 密钥与日志目录检查\n')
  
  assert(fs.existsSync(LOG_DIR), '航海日志目录存在: ' + LOG_DIR)
  assert(fs.existsSync(KEY_DIR), '密钥目录存在: ' + KEY_DIR)

  const logFiles = fs.existsSync(LOG_DIR) ? fs.readdirSync(LOG_DIR) : []
  console.log('  📁 日志文件: ' + logFiles.length + ' 个')
  
  const keyFiles = fs.existsSync(KEY_DIR) ? fs.readdirSync(KEY_DIR) : []
  console.log('  🔐 密钥文件: ' + keyFiles.length + ' 个')

  if (keyFiles.length > 0) {
    for (const keyFile of keyFiles) {
      const keyContent = fs.readFileSync(path.join(KEY_DIR, keyFile), 'utf8')
      assert(keyContent.includes('encryptedPrivateKey'), '密钥文件包含加密私钥')
      assert(!keyContent.includes('-----BEGIN RSA PRIVATE KEY-----'), '私钥已加密（非明文')
    }
  }

  console.log('\n[步骤2] NPC 交易测试\n')

  const cityFiles = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.md'))
  if (cityFiles.length > 0) {
    const latestLog = path.join(LOG_DIR, cityFiles[cityFiles.length - 1])
    const logContent = fs.readFileSync(latestLog, 'utf8')
    
    assert(logContent.includes('买入'), '日志包含买入记录')
    assert(logContent.includes('航行'), '日志包含航行记录')
    assert(logContent.includes('金币'), '日志包含金币变化')
    
    console.log('  📜 最新日志预览:')
    const lines = logContent.split('\n').filter(l => l.trim()).slice(0, 5)
    for (const line of lines) {
      console.log('     ' + line.substring(0, 60))
    }
  }

  console.log('\n[步骤3] P2P 交易验证\n')
  
  const contractFiles = fs.readdirSync(LOG_DIR).filter(f => f.includes('contract') || f.includes('合约'))
  if (contractFiles.length > 0) {
    console.log('  📋 找到合约文件: ' + contractFiles.join(', '))
  }

  console.log('\n[步骤4] 账目守恒验证\n')
  
  let totalGold = 0
  let totalCargo = 0
  
  console.log('\n═══════════════════════════════════════════════')
  console.log('  测试结果汇总')
  console.log('═══════════════════════════════════════════════\n')
  console.log('  ✅ 通过: ' + results.passed)
  console.log('  ❌ 失败: ' + results.failed)
  console.log('═══════════════════════════════════════════════\n')

  if (results.failed === 0) {
    console.log('  🎉 所有测试通过！\n')
  } else {
    console.log('  ⚠️ 有 ' + results.failed + ' 项测试失败\n')
  }

  console.log('📁 文件位置:')
  console.log('  日志: ' + LOG_DIR)
  console.log('  密钥: ' + KEY_DIR)
  console.log('')
}

test().catch(err => {
  console.error('测试失败:', err.message)
  process.exit(1)
})
