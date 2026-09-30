# 市场观察 · 四个战场

https://blackrimmedlol-code.github.io/us-market-dashboard/

v18.7：市场状态、涨跌前三和四个战场；报价、内容更新、发布与下一轮时间分别显示。浏览器在可见时每分钟读取已发布快照，保持当前排序与已展开的来源说明。

- 规范：DATA_GUIDE.md；执行限制：AGENTS.md
- 页面：index.html / dashboard.css / dashboard-app.mjs
- 计算：dashboard-model.mjs；正式盘盘中与收盘可以连续比较
- 共享日历：schedule.json / schedule.mjs / scripts/market_calendar.py
- 统一入口：scripts/update-session.py prepare / finalize / publish / verify
- 摘要：scripts/compact-summary.mjs；增量研究与同源事件分组：scripts/research-plan.mjs
- 校验：validate-data.mjs / check-session.mjs；测试：Node与Python现有及pipeline/schedule用例
- 旧版：legacy/（冻结）

保留四项GPT-6 Sol任务与原时段。接口缺少实际模型字段不会阻断行情更新。先发布已验证数值，随后在研究预算内合并新闻；复用事件与行业代表股保留原核实时间。完整行业表和原始行情不进入模型上下文。没有令牌时沿用已有GitHub连接器发布计划，不另建定时器或补跑。
