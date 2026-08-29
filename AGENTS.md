# AGENTS.md

本仓库仅用于美股策略台，和卡路里追踪页完全独立。

## 固定约束

- 线上地址：https://blackrimmedlol-code.github.io/us-market-dashboard/
- 页面入口：`index.html`
- 唯一数据文件：`data.json`
- 数据契约：`DATA_GUIDE.md`
- 写入前校验：`node validate-data.mjs data.json`
- 所有调度、页面时间、幂等比较与通知统一使用 `Asia/Shanghai`。
- 重点标的固定顺序：DRAM、LITE、IREN、BE、SPCX、MSTR。
- 更新前必须先读取最新 `DATA_GUIDE.md` 与当前 `data.json`；只合并目标 session 和指南允许字段，保留其他时段及未知字段。
- 写入前重新取得最新 blob SHA；冲突时重新读取并合并，最多重试一次。不得把 non-fast-forward 或 SHA 冲突误判为网络/CDN错误并循环重试。
- 写入后必须复读验证；只有提交与页面发布均确认成功，才通知“网页已同步”。
- 禁止向 `blackrimmedlol-code/calorie-tracker` 写入任何市场文件或市场数据。

Codex 维护本仓库的页面和市场数据自动任务；Hermes 不参与本仓库更新。
