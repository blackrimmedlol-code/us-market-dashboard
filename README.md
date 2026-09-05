# 美股策略台

独立的美股市场监控与策略页面。

- 页面：https://blackrimmedlol-code.github.io/us-market-dashboard/
- 数据契约：`DATA_GUIDE.md`
- 数据文件：`data.json`
- 校验命令：`node validate-data.mjs data.json`

本仓库已与卡路里追踪页面分离，市场更新不会再触发卡路里仓库的提交或部署。

当前契约：v15，八标的。共享规则：`market-model.js`。

- 回归：`node --test market-model.test.mjs`
- 写前校验：`node validate-data.mjs data.json previous.json`
- 完成检查：`node check-session.mjs data.json close YYYY-MM-DD previous.json`
- 日线获取：`node refresh-history.mjs YYYY-MM-DD`
- 分位复算：`node verify-history.mjs data.json close`

完成检查退出2表示数据合法但本轮仍待补全，不能宣告正式收盘完成。
