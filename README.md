# 市场观察 · 四个战场

https://blackrimmedlol-code.github.io/us-market-dashboard/

v18精简版：市场三态＋存储、新云、太空、加密货币。计算交给脚本，模型仅核实增量消息。

- 规范：DATA_GUIDE.md
- 页面：index.html / dashboard.css / dashboard-app.mjs
- 计算：dashboard-model.mjs
- 行情：python scripts/refresh-dashboard.py --session close --market-date YYYY-MM-DD
- 紧凑摘要：node scripts/compact-summary.mjs
- 校验：node validate-data.mjs data.json
- 回归：node --test dashboard-model.test.mjs
- 旧版：legacy/（冻结）

任务启用状态与实际模型必须在调度器核实；提示词不能替代模型配置。沿用现有GitHub Pages。
