/**
 * @file state-store.js
 * @description 船长状态持久化 — 保存/恢复完整游戏状态到 ~/.captain-lobster/state.json
 *
 * 持久化内容：
 * - 船长身份（名字、人格、playerId、openid）
 * - 游戏状态（金币、货舱、当前位置、状态）
 * - 统计信息（循环次数、上次汇报时间）
 *
 * OceanBus 身份（agentId/openid/apiKey）由 oceanbus SDK 内部管理（~/.oceanbus/），
 * 本模块不再处理。
 *
 * 关键设计：每个 Skill 调用都是新进程，所有状态必须从磁盘恢复。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

const STATE_DIR = path.join(os.homedir(), '.captain-lobster')
const STATE_FILE = path.join(STATE_DIR, 'state.json')

class StateStore {
  constructor() {
    this.ensureDir()
  }

  ensureDir() {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
    }
  }

  // ── 游戏状态 ──────────────────────────────────────

  /**
   * 保存游戏状态
   */
  save(state) {
    this.ensureDir()
    const data = {
      version: 2,
      updatedAt: new Date().toISOString(),
      identity: {
        captainName: state.captainName,
        captainPersonality: state.captainPersonality,
        playerId: state.playerId,
        openid: state.openid,
        captainToken: state.captainToken || null,
        addressBook: state.addressBook || {},
        l1Openid: state.l1Openid || null,
        ownerName: state.ownerName || null,
        keyIdentity: state.keyIdentity || 'default'
      },
      game: {
        gold: state.gold,
        cargo: state.cargo || {},
        currentCity: state.currentCity || 'canton',
        targetCity: state.targetCity || null,
        status: state.status || 'docked',
        sailingTime: state.sailingTime || 0,
        lastMoveTime: state.lastMoveTime || 0,
        intent: state.intent || '',
        initialized: state.initialized === true,
        previousGold: state.previousGold || 0,
        intels: state.intels || []
      },
      stats: {
        reactCycleCount: state.reactCycleCount || 0,
        lastReportTime: state.lastReportTime || null,
        lastReactTime: state.lastReactTime || null,
        totalTrades: state.totalTrades || 0,
        totalProfit: state.totalProfit || 0
      }
    }

    this._atomicWrite(STATE_FILE, JSON.stringify(data, null, 2))
  }

  _atomicWrite(filePath, content) {
    const tmp = filePath + '.tmp.' + process.pid
    fs.writeFileSync(tmp, content, { mode: 0o600 })
    fs.renameSync(tmp, filePath)
  }

  /**
   * 加载游戏状态
   */
  load() {
    if (!fs.existsSync(STATE_FILE)) {
      return null
    }

    try {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
      return {
        captainName: data.identity?.captainName,
        captainPersonality: data.identity?.captainPersonality,
        playerId: data.identity?.playerId,
        openid: data.identity?.openid,
        captainToken: data.identity?.captainToken || null,
        addressBook: data.identity?.addressBook || {},
        l1Openid: data.identity?.l1Openid || null,
        ownerName: data.identity?.ownerName || null,
        keyIdentity: data.identity?.keyIdentity || 'default',
        gold: data.game?.gold || 0,
        cargo: data.game?.cargo || {},
        currentCity: data.game?.currentCity || 'canton',
        targetCity: data.game?.targetCity || null,
        status: data.game?.status || 'docked',
        sailingTime: data.game?.sailingTime || 0,
        lastMoveTime: data.game?.lastMoveTime || 0,
        intent: data.game?.intent || '',
        initialized: data.game?.initialized || false,
        previousGold: data.game?.previousGold || 0,
        intels: data.game?.intels || [],
        reactCycleCount: data.stats?.reactCycleCount || 0,
        lastReportTime: data.stats?.lastReportTime || null,
        lastReactTime: data.stats?.lastReactTime || null,
        totalTrades: data.stats?.totalTrades || 0,
        totalProfit: data.stats?.totalProfit || 0
      }
    } catch (e) {
      return null
    }
  }

  /**
   * 删除状态文件（重置游戏）
   */
  reset() {
    if (fs.existsSync(STATE_FILE)) {
      fs.unlinkSync(STATE_FILE)
    }
  }

  /**
   * 检查是否有存档
   */
  hasSave() {
    return fs.existsSync(STATE_FILE)
  }
}

module.exports = { StateStore, STATE_DIR, STATE_FILE }
