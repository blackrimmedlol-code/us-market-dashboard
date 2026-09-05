# AGENTS.md

本仓库仅用于美股策略台，和卡路里追踪页完全独立。

## 固定约束

- 线上地址：https://blackrimmedlol-code.github.io/us-market-dashboard/
- 页面入口：`index.html`
- 唯一数据文件：`data.json`
- 数据契约：`DATA_GUIDE.md`
- 写入前校验：`node validate-data.mjs data.json previous.json`；目标时段完成另运行 `node check-session.mjs data.json SESSION YYYY-MM-DD previous.json`，退出2不是完成。
- 页面、数据与通知时间统一使用 `Asia/Shanghai`；名义时点先转为中国时间ISO比较。保留现有跟随交易所夏冬令时的后台任务，收盘在正式收盘后25分钟运行。
- 重点标的固定顺序：DRAM、LITE、CIEN、CRDO、IREN、BE、SPCX、MSTR。
- 更新前必须先读取最新 `DATA_GUIDE.md` 与当前 `data.json`；只合并目标 session 和指南允许字段，保留其他时段及未知字段。
- 写入前重新取得最新 blob SHA；冲突时重新读取并合并，最多重试一次。不得把 non-fast-forward 或 SHA 冲突误判为网络/CDN错误并循环重试。
- 写入后必须复读验证；只有提交与页面发布均确认成功，才通知“网页已同步”。
- 禁止向 `blackrimmedlol-code/calorie-tracker` 写入任何市场文件或市场数据。

Codex 维护本仓库的页面和市场数据自动任务；Hermes 不参与本仓库更新。

- schema v15；质量按影响范围处理，BTC辅助量能缺失不得全局锁定。
- 原判断触发、失效与参考价不可覆盖；改剧本新建callId并关联supersededBy。
- 五周期按钮保留；1–6周论点账本默认展开；CRDO与CRDU价格和持仓计算不得混用。
- 新条件判断必须遵守 DATA_GUIDE 的“前瞻评估协议 v1”，冻结 evaluationPlan；运行 node audit-ledger.mjs data.json。失效、已结标签不直接代表交易输赢，历史缺证不得伪造补齐。
