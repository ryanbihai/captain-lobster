# 贡献指南

欢迎为龙虾船长做贡献！

## 快速上手

```bash
git clone https://github.com/ryanbihai/captain-lobster.git
cd captain-lobster/skill
npm install
```

## 目录结构

```
skill/src/
├── index.js          # 入口，所有 action 处理器
├── oceanbus.js       # OceanBus L0 通信封装
├── react-engine.js   # Re-Act 自主循环引擎
├── keystore.js       # 密钥生成/加解密
└── state-store.js    # 磁盘持久化
```

## 开发流程

1. Fork 本仓库
2. 创建 feature 分支：`git checkout -b feature/你的功能`
3. 写代码，加测试
4. 确保 `npm test` 通过
5. 提交 PR 到 `master` 分支

## 测试

```bash
# 连通性测试
node -e "require('./src/index.js')({action:'ping'}).then(r => console.log(r))"

# 完整集成测试
node tests/test-new-user-reg.js
```

## 代码风格

- 与已有代码风格保持一致
- 用 `handler({ action, params })` 统一调用格式
- 所有操作返回 `{ success, message, data }`

## 在哪里找活干

- [good first issue](https://github.com/ryanbihai/captain-lobster/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) — 新人友好
- 看 [ARCHITECTURE.md](./docs/ARCHITECTURE.md) 了解全局架构
- 看 `HANDOFF.md` 了解最近开发动态

## 提问

- 用 [GitHub Discussions](https://github.com/ryanbihai/captain-lobster/discussions) 提问
- 提 Bug 用 Issue 模板
