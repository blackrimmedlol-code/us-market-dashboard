# 市场观察 v18
仅维护 blackrimmedlol-code/us-market-dashboard main 及现有 GitHub Pages，禁止写入 calorie-tracker。
用户 2026-09-24 明确用精简范围替代 v17；DATA_GUIDE.md 为唯一规范。

- 保留市场环境、全市场涨跌前三简短新闻、存储/新云/太空/加密四板块，不生成交易指令。
- 不再更新宏观、五周期个股分析、分位或判断账本；榜单只研究入榜6项。
- 先读最新指南；JSON 在工具内解析，模型只读紧凑摘要，不加载 legacy/ 或完整历史。
- 行情和规则由脚本计算；模型只核实增量消息，不虚构数字或涨跌原因。
- 写前 validate-data、check-session 和回归测试；退出2只算部分完成。
- 写前 fetch 最新SHA，冲突重读合并一次、不强推；写后核实Pages部署及线上数据才通知成功。
- legacy/ 冻结，不回填历史。所有展示时间为Asia/Shanghai；后台日程随美股DST。
- 日常更新采用 GPT-6 Sol；任务接口缺少模型字段不阻断行情刷新。若有明确的模型不符证据须如实报告；不可把提示词描述为底层模型配置。
