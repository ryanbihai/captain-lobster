# GitHub 更新指南

## 每次修改代码后

```bash
# 1. 暂存所有改动
git add -A

# 2. 提交（写好改动说明）
git commit -m "改动说明"

# 3. 推送到 GitHub
git push origin master
```

## 常见情况

### 只想提交部分文件
```bash
git add 文件1.js 文件2.js
git commit -m "改动说明"
git push origin master
```

### 看看改了哪些文件
```bash
git status
```

### 看看具体改了什么
```bash
git diff
```

### 撤销未提交的改动
```bash
git checkout -- 文件名    # 撤销单个文件
git checkout -- .         # 撤销所有文件
```

## 注意事项

- `.env` 文件已在 `.gitignore` 中，不会被提交到 GitHub
- remote 地址已配置为 `https://github.com/ryanbihai/captain-lobster`
- token 已内置在 remote URL 中，无需每次输入密码
