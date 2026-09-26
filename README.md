# 市场观察 · 四个战场

https://blackrimmedlol-code.github.io/us-market-dashboard/

v18.3精简版：市场风险倾向与证据置信度、RSP/SPY、SPMO/SPY、VIX/VIX3M＋存储、新云、太空、加密货币。计算交给脚本，模型仅核实增量消息。

- 规范：DATA_GUIDE.md
- 页面：index.html / dashboard.css / dashboard-app.mjs
- 计算：dashboard-model.mjs
- 行情：python scripts/refresh-dashboard.py --session close --market-date YYYY-MM-DD
- 紧凑摘要：node scripts/compact-summary.mjs
- 校验：node validate-data.mjs data.json
- 回归：node --test dashboard-model.test.mjs
- 旧版：legacy/（冻结）

四项新版任务采用 GPT-6 Sol；任务接口不返回模型字段时不因此中止更新，仍须严格核验行情来源、数据时点与部署。沿用现有 GitHub Pages。

## v18.3 板块涨跌榜
复用旧版Finviz全行业抓取与排序，展示日累计涨幅/跌幅前三及带日期来源的简短新闻。榜单位于市场状态和四战场之间；四战场新闻直接展开。规则分类仍为18.2，避免把展示升级误报为市场方向变化。每轮只向模型输出6条榜单，不输出完整行业表。
