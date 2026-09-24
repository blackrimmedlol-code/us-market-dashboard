# 市场观察 · 数据契约 v18.1

## 范围
只回答市场环境与四板块的自身走势、相对强弱、内部共振、新增事件。操作由用户决定。取消宏观、逐股操作建议、五周期、60/252分位、判断账本、全行业榜。legacy/冻结，正常更新不读取。

| 模块 | 固定样本 |
| --- | --- |
| 市场 | SPY / QQQ / VIX |
| 存储 | DRAM整体；MU / SKHY / SNDK / WDC内部验证 |
| 新云 | IREN / NBIS / CRWV |
| 太空 | SPCX / RKLB / ASTS |
| 加密 | BTC / ETH币；COIN / MSTR股；HOOD仅辅助 |

行情脚本不调用LLM；模型只读取node scripts/compact-summary.mjs输出与增量新闻。每板块最多一条有效事件、两来源；没新闻可为空。原始行情存history/v18，不作为每轮模型输入。优先GPT-5.6 SOL，Luna须满足同样核实门槛；不使用Astra。调度器模型独立于提示词，不能用文字冒充模型设置。

## 数据
data.json含meta/assets/breadth/news/cta/previous。
meta：schemaVersion=18、rulesVersion=18.1、timezone=Asia/Shanghai；updatedAt抓取/研究时刻；asOf行情截止点；marketDate美股交易日；session=premarket/intraday/late/close；priceBasis=close/intraday；automationEnabled按实际任务启停填写。
assets固定19项：symbol/name/status/price/changePct/asOf/marketDate/trend30m/spark/sourceUrl/note。verified才参与计算；失败unavailable且数字null，不沿用旧值冒充本轮。verified另含baselineAt/baselinePrice、ema20/emaSlopePct、vwapApprox、barCount/fetchedAt。
breadth：verified/snapshot/unavailable；advancing/declining/upPct；marketDate/sourceUrl/asOf/fetchedAt。来源无精确行情时点，asOf必须null，不以抓取时刻替代。上涨占比=上涨/(上涨+下跌)。
news按memory/cloud/space/crypto保存text/publishedAt/expiresAt/kind(reported|inference)/sources[{name,url}]，可加label/eventDate/priceRelation。日期精度未知可仅用日期；发布日期和未来事件日期分开。因果未证实须明示，不能从涨跌倒推原因。
cta缺可追溯资料时unavailable，非必查、不参与分类。
previous只保留上次meta/assets/breadth，不嵌套历史。同asOf重跑不制造新基线。首次不声称改善，缺证为待确认。

## 计算
完整30分钟K线；股票正式盘，盘前盘后不拼入。EMA20至少25条有效K线：价格在EMA上且斜率正为up，反向down，其余mixed，不足unknown。日内均价为30分钟HLC3量加权近似，非逐笔VWAP。
QQQ/SPY趋势与近似均价同时向上/下才是价格走强/走弱；广度≥55%/≤45%；VIX涨跌为波动压力。三项同向才Risk-on/Risk-off，分歧为分化，关键证据缺失为待确认。这是未做收益回测的描述规则，阈值附近可能切换，不是交易指令。
板块至少2/3样本趋势同向；缺失不缩小分母。存储以DRAM为整体并核对四股，不重复等权；新云/太空/加密股票固定等权。相对QQQ用同窗口涨幅差，±0.2个百分点内接近。币也比较上一美股收盘至同截止点，不用滚动24小时；HOOD不计分。

## 四时段流程
沿用America/New_York周一至五09:05/11:05/14:05/16:25。夏令时中国时间21:05/23:05/次日02:05/次日04:25，冬令时顺延1小时。非有效交易日静默跳过；短日采用来源实际收盘，已闭市不称盘中。

1. 读远端最新指南，工具内解析data并保存previous.json；核对交易日历和目标日期。
2. python scripts/refresh-dashboard.py --session SESSION --market-date YYYY-MM-DD。基准缺失则保留旧快照并报错；来源失败备用一次，板块缺项允许真实partial。
3. node scripts/compact-summary.mjs。只搜上次研究后新增公告，优先一手来源；每板块最多一条，最多5分钟新闻核实，10分钟全流程，不新建自愈任务、不无限重试。
4. 盘前试用版显示上一正式盘收盘、重点补隔夜消息，不把旧价说成盘前实时报价。盘中/午后只写变化，收盘核实完整正式盘。新闻截止updatedAt，晚于行情asOf的事件必须标记“快照后消息，价格反应待确认”。
5. 运行node validate-data.mjs data.json previous.json、node --test dashboard-model.test.mjs、python -m unittest discover -s scripts -p 'test_*.py'、node check-session.mjs data.json SESSION YYYY-MM-DD。退出2为部分完成。幂等须同目标session/date，updatedAt晚于名义时点且完整同窗口，不能仅凭日期跳过。
6. 写前fetch最新SHA；冲突重读合并一次，不强推。提交data与证据，核实Pages对应SHA成功及线上内容后才通知。通知只含市场状态、四板块变化、缺项、链接。

恢复仅这四任务，旧任务与自愈继续关闭；模型未核实前保持暂停。启动时同步automationEnabled。
legacy/data.json必须保持迁移前字节不变；回滚用正常新提交，不改写Git历史。
