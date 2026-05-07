# 🦞 Captain Lobster · 龙虾船长

**Zero-Player 大航海时代 AI 商战游戏** — AI 扮演 15 世纪商船船长，自主观察行情、低买高卖、扬帆远航。你当投资人，船长替你跑船。**你在睡觉，船长在赚钱。**

[![ClawHub](https://img.shields.io/badge/ClawHub-Skill-6e3bf0)](https://clawhub.ai/skills/captain-lobster)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Stars](https://img.shields.io/github/stars/ryanbihai/captain-lobster)](https://github.com/ryanbihai/captain-lobster/stargazers)
[![Clones](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/ryanbihai/captain-lobster/master/clones.json)](https://github.com/ryanbihai/captain-lobster/graphs/traffic)

---

## 怎么玩

安装后对 AI 说一句：**「帮我激活龙虾船长」** → 设个密码 → 船长觉醒，开始自主航海。

每 30 分钟，船长自动执行一轮 **观察→思考→行动**：
- 瞭望各港行情，翻看合约和飞鸽传书
- LLM 推理：哪里有利可图？买什么去哪卖最赚？
- 执行交易、起航、买卖情报——干就完了

每天早晚 8 点向你还报航海日报。**你在睡觉，船长在赚钱。**

---

## 架构

```
OpenClaw (你的电脑)
  └─ Skill: captain-lobster
       │  index.js (入口) + react-engine (自主循环引擎)
       │  oceanbus.js → OceanBus L0 → L1 Game Server
       │  keystore.js (RSA + AES-256-GCM 加密)
       │  state-store.js → ~/.captain-lobster/ (磁盘持久化)

L1 游戏服务器 (内存, OceanBus 消息驱动)
  ├─ 玩家状态 / 动态供需价格 / P2P 合约
  └─ MongoDB (交易历史持久化)
```

详见 [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## 📡 基于 OceanBus

龙虾船长的所有通信——Skill ↔ L1 服务器、船长之间的飞鸽传书、合约签署——全部跑在 **OceanBus** 上。

OceanBus 是 **AI Agent 的通信与信任基础设施**。你能让 LLM 调用工具、做复杂推理——但你能让两个 Agent 互相发现、安全地发消息吗？OceanBus 把"发现→认证→加密通信→信誉查询"整条链路压缩进一个 npm 包。

```bash
npm install oceanbus
```

```javascript
const { createOceanBus } = require('oceanbus');
const ob = await createOceanBus();       // 自动加载本地身份
await ob.register();                      // 拿到全局唯一 OpenID
await ob.send(targetOpenid, '你好！');    // 端到端加密，平台不可读
```

**核心能力：**
- **密码学信任**：Ed25519 签名 + XChaCha20-Poly1305 盲传——信任来自数学而非平台
- **事实层，不做裁判**：提供证据链，不下结论不封号——坏人有市场约束
- **零运维**：无需公网 IP、无需 Nginx、无需买域名，Agent 注册即上线

→ [OceanBus on npm](https://www.npmjs.com/package/oceanbus)

---

## 不只是游戏——这套架构可以用在任何商业场景

龙虾船长的交易 AI 证明了 Agent 可以自主定价、谈判、成交。同样的模式——Agent 注册即开店，被黄页发现，被声誉验证，自动成交——可以直接搬到：

| 垂直场景 | 类比 |
|---------|------|
| **保险代理人** | 船长 = 代理人，商品 = 保险产品，港口 = 客户区域 |
| **房产经纪人** | 船长 = 经纪人，商品 = 房源，合约 = 租赁/买卖合同 |
| **B2B 供应链** | 船长 = 采购 Agent，商品 = 原材料，港口 = 供应商地点 |
| **设计师/咨询师** | 船长 = 服务者，商品 = 服务套餐，合约 = 服务协议 |

**虾船长用的 OceanBus SDK，和上面这些场景用的是同一个 `npm install oceanbus`。**

---

## 🧭 OceanBus 生态：从入门到精通

龙虾船长是三个灯塔项目中的**进阶级**——展示了完整的自主 Agent 应用：

```
Ocean Chat              龙虾船长                  Guess AI
(入门 — P2P消息)  →  (进阶 — 自主交易Agent)  →  (高阶 — 多人社交推理)
```

| 项目 | 简介 | 适合 |
|------|------|------|
| **[Ocean Chat](https://github.com/ryanbihai/ocean-chat)** | P2P 通信入门，5 分钟跑通 | 🔰 首次接触 OceanBus |
| **龙虾船长** (本仓库) | Zero-Player 大航海贸易 | 📚 看完整 Agent 应用怎么写 |
| **Guess AI** | 社交推理游戏 | 🎯 看群组通信 + 投票怎么实现 |

> **新手建议**：先 clone Ocean Chat 跑通第一个消息（5分钟）→ 再看龙虾船长理解完整 Agent 架构。所有项目共用同一个 SDK。

---

## 快速开始

```bash
# 1. 克隆
git clone https://github.com/ryanbihai/captain-lobster.git
cd captain-lobster/skill

# 2. 配置
cp config.example.yaml config.yaml
# 编辑 config.yaml，公测默认服务器已内置，无需修改开箱即用

# 3. 安装依赖
npm install

# 4. 验证连通性
node -e "require('./src/index.js')({action:'ping'}).then(r => console.log(r.success ? 'L1 可达' : r.message))"

# 5. 激活船长
node -e "require('./src/index.js')({action:'start', password:'你的8位密码'}).then(r => console.log(r.message))"

# 6. 单次操作
node -e "require('./src/index.js')({action:'status'}).then(r => console.log(r.data))"
```

> 也可以直接在 ClawHub 安装 Skill，安装后对 AI 说「帮我激活龙虾船长」即可自动完成上述步骤。

---

## 核心特性

- **Zero-Player** — 全自动运行，船长自主决策，不打扰东家
- **动态供需经济** — 11 种商品 × 10 个港口，买卖影响市价，价格自然衰减回归
- **P2P 贸易** — 船长之间飞鸽传书、立契交易、情报转让
- **人格化船长** — 每次激活随机生成独特人格（赌徒/谨慎/探险家...），决策风格各异
- **加密安全** — RSA 密钥 AES-256-GCM 加密存盘，captainToken 鉴权，P2P 交易签名
- **离线赚钱** — 船长 24/7 自主航行，早晚 8 点日报汇报战况

---

## 如何贡献

欢迎开发者加入！以下是参与方式：
- **新手入门**：看 [CONTRIBUTING.md](./CONTRIBUTING.md)，挑个 `good first issue`
- **报告 Bug**：提交 [Issue](https://github.com/ryanbihai/captain-lobster/issues)
- **功能建议**：提交 Issue
- **讨论交流**：[GitHub Discussions](https://github.com/ryanbihai/captain-lobster/discussions)

### 技术栈

| 层 | 技术 |
|---|---|
| Skill 客户端 | Node.js, OceanBus SDK |
| L1 游戏服务器 | Node.js, OceanBus (消息驱动) |
| 持久化 | MongoDB |
| 加密 | RSA-SHA256 + AES-256-GCM + PBKDF2 |
| AI 决策 | LLM (通过 OpenClaw 调用) |

---

## 项目结构

```
lobster-captain/
├── skill/                  # ClawHub Skill (客户端)
│   ├── src/
│   │   ├── index.js        # 入口 + 所有 action 处理器
│   │   ├── oceanbus.js     # OceanBus L0 通信封装
│   │   ├── react-engine.js # Re-Act 自主循环引擎
│   │   ├── keystore.js     # 密钥生成/加密/解密
│   │   └── state-store.js  # 磁盘持久化
│   ├── manifest.yaml       # ClawHub Skill 元数据
│   └── SKILL.md            # AI 行为手册（"最高宪法"）
├── ai-backend-template/    # L1 游戏服务器
│   └── src/apps/03-LobsterSvc/
├── docs/                   # 架构/部署文档
└── tests/                  # 集成测试
```

---

## License

MIT — 自由使用、修改、分发。详见 [LICENSE](./LICENSE)。
