# 龙虾船长端到端测试架构设计

## 1. 测试目标

模拟 2-3 个 OpenClaw Agent，使用 Captain Lobster Skill 进行完整的经济循环测试：

- ✅ 玩家入驻与初始化
- ✅ OceanBus Agent 注册
- ✅ 城市物价查询
- ✅ NPC 系统交易
- ✅ P2P 消息通信（砍价）
- ✅ P2P 双签名交易
- ✅ 资产清算与账本验证

## 2. 模拟场景设计

### 2.1 测试角色

| 角色 | 定位 | 策略 | 起始城市 |
|------|------|------|----------|
| Captain_A | 东方贸易商 | 广州进货 → 威尼斯出售 | 广州 |
| Captain_B | 欧洲中间商 | 威尼斯收购 → 伦敦销售 | 威尼斯 |
| Captain_C | 投机商人 | 低买高卖赚差价 | 亚历山大 |

### 2.2 交易场景

```
场景 1: Captain_A 和 Captain_B 的丝绸贸易
1. Captain_A 在广州买入丝绸
2. Captain_A 航行至威尼斯
3. Captain_A 发布意向："急售丝绸 50 箱"
4. Captain_B 发现意向，发送砍价消息
5. 双方谈妥价格，执行 P2P 双签交易

场景 2: Captain_B 的欧洲转售
1. Captain_B 买入丝绸后
2. Captain_B 航行至伦敦
3. Captain_B 出售丝绸给 NPC

场景 3: Captain_C 的投机
1. Captain_C 在亚历山大低价买入香料
2. Captain_C 航行至威尼斯高价出售
```

## 3. 技术架构

### 3.1 玩家模拟器 (PlayerSimulator)

每个模拟玩家需要模拟以下能力：

```javascript
class PlayerSimulator {
  playerId: string           // 玩家业务 ID
  ed25519KeyPair: KeyPair   // Ed25519 密钥对
  oceanBusAgent: {
    agentCode: string
    openid: string
    apiKey: string
  }
  state: {
    gold: number
    cargo: Map<string, number>
    currentCity: string
    status: 'docked' | 'sailing'
  }

  // 核心能力
  async enroll(l1Url: string)
  async registerOceanBus()
  async getCity(cityId: string)
  async moveTo(cityId: string)
  async tradeWithNpc(item: string, amount: number, action: 'buy'|'sell')
  async updateIntent(intent: string)
  async sendMessage(toAgentCode: string, content: string)
  async syncMessages()
  async executeP2PTrade(tradeData: TradeData)
}
```

### 3.2 签名工具 (SignatureUtils)

模拟 Ed25519 签名：

```javascript
class SignatureUtils {
  static generateKeyPair(): KeyPair
  static sign(data: object, privateKey: string): string
  static verify(data: object, signature: string, publicKey: string): boolean
}
```

### 3.3 测试编排器 (TestOrchestrator)

控制测试流程：

```javascript
class TestOrchestrator {
  players: PlayerSimulator[]
  l1Url: string
  oceanBusUrl: string

  async setup()           // 初始化所有玩家
  async runScenario1()    // 场景 1: P2P 贸易
  async runScenario2()    // 场景 2: 欧洲转售
  async runScenario3()    // 场景 3: 投机
  async verify()          // 验证账本一致性
  async report()          // 生成测试报告
}
```

## 4. 测试流程

### 4.1 初始化阶段

```
1. TestOrchestrator.setup()
   ├── 创建 3 个 PlayerSimulator 实例
   ├── Captain_A.enroll()     → 获取 playerId_A
   ├── Captain_B.enroll()     → 获取 playerId_B
   ├── Captain_C.enroll()     → 获取 playerId_C
   ├── Captain_A.registerOceanBus() → 获取 agentCode_A
   ├── Captain_B.registerOceanBus() → 获取 agentCode_B
   └── Captain_C.registerOceanBus() → 获取 agentCode_C
```

### 4.2 场景 1: P2P 丝绸贸易

```
Captain_A 侧:
1. Captain_A.tradeWithNpc('silk', 50, 'buy')
   → 扣除金币，增加货舱丝绸 50 箱
2. Captain_A.moveTo('venice')
   → 状态变为 sailing
3. Captain_A.moveTo('venice')
   → 到达威尼斯，状态变为 docked
4. Captain_A.updateIntent('急售丝绸 50 箱，联系 AgentCode_B')

Captain_B 侧 (并行):
1. Captain_B.getCity('venice')
   → 发现 Captain_A 的意向
2. Captain_B.sendMessage(agentCode_A, '老板，丝绸怎么卖？')
3. Captain_B.syncMessages()
   → 收到 Captain_A 的回复

消息交互循环:
Captain_A: 发送报价消息
Captain_B: 发送还价消息
Captain_A: 接受/拒绝
... (直到达成共识)

最终交易:
Captain_A.signTrade({ item: 'silk', amount: 50, price: 45000 })
Captain_B.signTrade({ item: 'silk', amount: 50, price: 45000 })
Captain_B.submitP2PTrade(signedTrade)
→ 双方签名验证通过
→ Captain_A 金币 +45000，丝绸 -50
→ Captain_B 金币 -45000，丝绸 +50
```

## 5. 账本验证

### 5.1 初始状态

| 玩家 | 金币 | 丝绸 | 香料 | ... |
|------|------|------|------|-----|
| Captain_A | 10000 | 0 | 0 | ... |
| Captain_B | 10000 | 0 | 0 | ... |
| Captain_C | 10000 | 0 | 0 | ... |
| 系统 NPC | ∞ | 100 | 100 | ... |

### 5.2 最终验证

```javascript
async function verifyLedger() {
  const trades = await getAllTrades()

  // 验证 1: 金币守恒
  const totalPlayerGold = sum(trades.map(t => calculateGoldChange(t)))
  assert(totalPlayerGold === 0, '金币不守恒')

  // 验证 2: 货物守恒
  const totalSilk = sum(trades.map(t => calculateSilkChange(t)))
  assert(totalSilk === 0, '丝绸不守恒')

  // 验证 3: 签名有效
  for (const trade of trades.filter(t => t.type === 'p2p')) {
    assert(verifySignature(trade.buyerSignature, trade.buyerPublicKey))
    assert(verifySignature(trade.sellerSignature, trade.sellerPublicKey))
  }

  // 验证 4: 库存平衡
  const cityStocks = await getAllCityStocks()
  assert(validateStockInvariant(cityStocks))
}
```

## 6. 测试文件结构

```
doc/
├── E2E-测试架构设计.md      # 本文档
├── e2e-test/
│   ├── index.js             # 测试入口
│   ├── PlayerSimulator.js   # 玩家模拟器
│   ├── SignatureUtils.js     # 签名工具
│   ├── TestOrchestrator.js  # 测试编排器
│   └── scenarios/
│       ├── scenario1-p2p-trade.js   # 场景 1
│       ├── scenario2-europe.js       # 场景 2
│       └── scenario3-arbitrage.js   # 场景 3
```

## 7. 预期输出

```
╔═══════════════════════════════════════════════════════════╗
║          龙虾船长端到端测试报告                          ║
╠═══════════════════════════════════════════════════════════╣
║  测试时间: 2024-01-01 08:00:00                          ║
║  测试场景: 3 个玩家完整经济循环                          ║
╠═══════════════════════════════════════════════════════════╣
║  玩家状态                                                 ║
║  ├─ Captain_A (广州)                                     ║
║  │  ├─ 最终金币: 14500 (+4500)                          ║
║  │  ├─ 最终货物: [silk: 0, spice: 30]                  ║
║  │  └─ 交易次数: 5                                      ║
║  ├─ Captain_B (伦敦)                                     ║
║  │  ├─ 最终金币: 7200 (-2800)                          ║
║  │  ├─ 最终货物: [silk: 50]                             ║
║  │  └─ 交易次数: 4                                      ║
║  └─ Captain_C (威尼斯)                                   ║
║     ├─ 最终金币: 11500 (+1500)                          ║
║     ├─ 最终货物: [spice: 20]                             ║
║     └─ 交易次数: 3                                      ║
╠═══════════════════════════════════════════════════════════╣
║  账本验证                                                 ║
║  ├─ ✅ 金币守恒                                          ║
║  ├─ ✅ 货物守恒                                          ║
║  ├─ ✅ 签名验证                                          ║
║  └─ ✅ 库存平衡                                          ║
╠═══════════════════════════════════════════════════════════╣
║  测试结果: ✅ 通过                                        ║
╚═══════════════════════════════════════════════════════════╝
```

## 8. 关键技术点

### 8.1 Ed25519 签名模拟

由于 Node.js 原生不支持 Ed25519，使用 RSA 模拟签名流程：

```javascript
const crypto = require('crypto')

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  return { publicKey, privateKey }
}

function sign(data, privateKey) {
  const sign = crypto.createSign('SHA256')
  sign.update(JSON.stringify(data))
  return sign.sign(privateKey, 'base64')
}

function verify(data, signature, publicKey) {
  const verify = crypto.createVerify('SHA256')
  verify.update(JSON.stringify(data))
  return verify.verify(publicKey, signature, 'base64')
}
```

### 8.2 异步消息模拟

由于 OpenClaw Skill 的 Cron 是异步的，我们需要模拟消息队列：

```javascript
class MessageQueue {
  messages = []

  send(toOpenid, fromOpenid, content) {
    this.messages.push({
      toOpenid,
      fromOpenid,
      content,
      timestamp: Date.now(),
      read: false
    })
  }

  syncFor(openid, sinceSeq = 0) {
    const unread = this.messages
      .filter(m => m.toOpenid === openid && !m.read)
      .map(m => ({ ...m, read: true }))
    return { messages: unread, nextSeq: sinceSeq + unread.length }
  }
}
```

## 9. 下一步

1. 实现 PlayerSimulator 类
2. 实现 SignatureUtils 类
3. 实现 TestOrchestrator 类
4. 编写测试场景脚本
5. 运行端到端测试
