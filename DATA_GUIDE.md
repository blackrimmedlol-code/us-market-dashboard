# 市场观察 · 数据契约 v18.5

## 范围
回答市场环境、全市场涨跌前三与四板块的自身走势、相对强弱、内部共振、新增事件。操作由用户决定。取消宏观、逐股操作建议、五周期、60/252分位、判断账本。legacy/冻结，正常更新不读取。

| 模块 | 固定样本 |
| --- | --- |
| 市场 | SPY / QQQ / VIX / RSP / SPMO / VIX3M |
| 存储 | DRAM整体；MU / SKHY / SNDK / WDC内部验证 |
| 新云 | IREN / NBIS / CRWV |
| 太空 | SPCX / RKLB / ASTS |
| 加密 | BTC / ETH币；COIN / MSTR股；HOOD仅辅助 |

行情脚本不调用LLM；模型只读取node scripts/compact-summary.mjs输出与增量新闻。每板块最多一条有效事件、两来源；没新闻可为空。原始行情存history/v18，不作为每轮模型输入。四个定时任务采用 GPT-6 Sol 执行信息搜集、处理、摘要与提交。调度器或任务接口若不返回模型元数据，不因无法独立读取模型字段而中止行情更新；仍严格执行数据源、时间窗口和写入验证。若有明确证据显示执行模型不符，应如实报告，不将提示词当作已完成底层模型设置。

## 数据
data.json含meta/assets/breadth/news/cta/previous/sectorPulse。
meta：schemaVersion=18、rulesVersion=18.2、timezone=Asia/Shanghai；updatedAt抓取/研究时刻；asOf行情截止点；marketDate美股交易日；session=premarket/intraday/late/close；priceBasis=close/intraday；automationEnabled按实际任务启停填写。
assets固定22项：symbol/name/status/price/changePct/asOf/marketDate/trend30m/spark/sourceUrl/note。verified才参与计算；失败unavailable且数字null，不沿用旧值冒充本轮。verified另含baselineAt/baselinePrice、ema20/emaSlopePct、vwapApprox、barCount/fetchedAt。
breadth：verified/snapshot/unavailable；advancing/declining/upPct；marketDate/sourceUrl/asOf/fetchedAt。来源无精确行情时点，asOf必须null，不以抓取时刻替代。上涨占比=上涨/(上涨+下跌)。
news按memory/cloud/space/crypto保存text/publishedAt/expiresAt/kind(reported|inference)/sources[{name,url}]，可加label/eventDate/priceRelation。日期精度未知可仅用日期；发布日期和未来事件日期分开。因果未证实须明示，不能从涨跌倒推原因。
cta缺可追溯资料时unavailable，非必查、不参与分类。
previous只保留上次meta/assets/breadth，不嵌套历史。同asOf重跑不制造新基线。首次不声称改善，缺证为待确认。

## 计算
完整30分钟K线；股票正式盘，盘前盘后不拼入。EMA20至少25条有效K线：价格在EMA上且斜率正为up，反向down，其余mixed，不足unknown。日内均价为30分钟HLC3量加权近似，非逐笔VWAP。
QQQ/SPY完整30分钟EMA趋势同向决定风险倾向；均价仅补充确认。广度≥55%/≤45%支持向上/向下；VIX/VIX3M≥1或VIX上涨为压力增加，其余VIX不涨为缓和。广度和波动都反对价格才降为分化；单项反向或缺确认保留低置信度倾向；指数缺失才待确认。置信度是证据一致性，不是胜率：至少一项支持、无反向、广度和VIX/VIX3M完整为中；再有两项支持、均价同向、RSP同向、广度精确时点才高。
RSP/SPY、SPMO/SPY须同一asOf/baselineAt，用(现比值/基准比值-1)*100。±0.2%内接近，只描述本轮窗口。RSP只补参与程度；SPMO只辅助，不决定方向或置信度。波动比值不是期货期限结构。全部规则未经收益回测。
板块结构/相对上轮变化/改变判断条件由sectorInsights程序生成，不额外写四份LLM研报；消息默认直接展开，显示事件、日期、来源与价格关系。跨日相对差变化标明窗口重置，不称资金流。旧规则与新规则的市场标签不可直接比较，首次升级显示规则升级；不得回填旧历史。
板块至少2/3样本趋势同向；缺失不缩小分母。存储以DRAM为整体并核对四股，不重复等权；新云/太空/加密股票固定等权。相对QQQ用同窗口涨幅差，±0.2个百分点内接近。币也比较上一美股收盘至同截止点，不用滚动24小时；HOOD不计分。

## 全市场板块涨跌前三与新闻
2026-09-25 用户要求恢复旧版全行业榜的精简形式，并加入简短新闻分析。复用旧版 Finviz 细分行业表和排名算法；榜单位于市场状态与四个战场之间，每侧最多3项。不是只对四个战场排序，也不是11个大类ETF排名。
- `scripts/refresh_sectors.py` 随主行情脚本批量抓一次完整行业表；抓取失败备用一次，失败显示 unavailable，不拿旧榜冒充新榜。无需模型逐个研究全部行业。
- `sectorPulse`：status=snapshot/unavailable、marketDate、targetAsOf（对应主行情完成K线窗口）、asOf=null（来源无行业精确时刻）、fetchedAt、returnBasis=daily、universe/universeCount/sourceUrl/dateBasis、rows完整数值、gainers/losers前三。只正涨幅进入上涨榜，只负涨幅进入下跌榜，不足不凑；重复、非数值、不足100个行业均拒收。
- 统计是当日截至本轮抓取的日累计涨跌，非两次更新间涨跌。盘前为上一正式盘；盘中来源可能延迟。必须核对同源SPY日期及实时/闭市窗口；禁止历史盘中时段回填之后的全日榜。显示榜单日期与独立抓取时间。
- `sectorPulse.news` 按榜单行业英文原名存一条简短解读（text≤240字，建议60–100字），kind=reported/inference/unknown；checkedAt实际核实时刻；有消息必须有publishedAt、expiresAt、sources[{name,url}]（1–2个）。reported只表示消息事实核实，不能自动代表涨跌因果已证实。unknown可无来源，明确原因待核实。
- 每轮只研究入榜6行业；同日仍入榜、未过期的新闻可复用，复核有无新增变化并更新checkedAt；换榜或跨日重新检查。研究完成写researchAt且不早于fetchedAt，6项都需有新闻或unknown记录。新闻晚于行情时点则标“快照后消息”；发布日期精度未知仅填日期，不能假造具体时刻。
- 四个战场新闻直接展示，不折叠；继续每板块最多1条有效新闻，不凑数。榜单新闻优先原公告，再使用可靠媒体，不能用一家公司事件解释整个行业而不说明局限。
- `compact-summary.mjs`只输出榜单6项及新闻，完整rows不进入模型上下文。主行情与榜单可以部分成功；来源失败/研究未完成写具体缺项，不称全量完成。不要重启旧版任务或恢复宏观长篇分析。

## 四时段流程
榜单每个行业直接展示2–4个核心标的：`sectorPulse.coreTickers[英文行业名]` 保存 symbols、status、checkedAt、sourceUrl、selection=optionable-marketcap。脚本仅对当轮入榜行业并行读取 Finviz 同行业、Optionable 筛选，按市值选前4只；不足2只如实显示、不跨行业凑数。未核实显示待核实并计入partial，不妨碍有效榜单和新闻展示。每轮随主脚本更新，不另启模型研究，不调用期权链、不新增个股分析。当前来源标的核实时间与行情快照时间分开，不能冒充历史时点成分。核心标的不是期权活跃度排名；日内候选仍需用户检查到期日、买卖价差、成交量与持仓量，不能声称可做0DTE。四个任务采用 GPT-6 Sol 与原有时段。

沿用America/New_York周一至五09:05/11:05/14:05/16:25。夏令时中国时间21:05/23:05/次日02:05/次日04:25，冬令时顺延1小时。非有效交易日静默跳过；短日采用来源实际收盘，已闭市不称盘中。

1. 读远端最新指南，工具内解析data并保存previous.json；核对交易日历和目标日期。
2. python scripts/refresh-dashboard.py --session SESSION --market-date YYYY-MM-DD。基准缺失则保留旧快照并报错；来源失败备用一次，板块缺项允许真实partial。
3. node scripts/compact-summary.mjs。只搜上次研究后新增公告，优先一手来源；四战场各最多一条，加涨跌榜6行业各一条简短解读（无可靠原因标unknown）；复用同日仍有效新闻，合并相同事件检索，最多5分钟新闻核实，10分钟全流程，不新建自愈任务、不无限重试。
4. 盘前试用版显示上一正式盘收盘、重点补隔夜消息，不把旧价说成盘前实时报价。盘中/午后只写变化，收盘核实完整正式盘。新闻截止updatedAt，晚于行情asOf的事件必须标记“快照后消息，价格反应待确认”。
5. 运行node validate-data.mjs data.json previous.json、node --test dashboard-model.test.mjs sector-pulse.test.mjs、python -m unittest discover -s scripts -p 'test_*.py'、node check-session.mjs data.json SESSION YYYY-MM-DD。退出2为部分完成。幂等须同目标session/date，updatedAt晚于名义时点且完整同窗口，不能仅凭日期跳过。
6. 写前fetch最新SHA；冲突重读合并一次，不强推。提交data与证据，核实Pages对应SHA成功及线上内容后才通知。通知只含市场状态、四板块变化、缺项、链接。

仅启用这四项新版任务，旧任务与自愈继续关闭；缺少模型字段不作为暂停理由。启动时同步automationEnabled。
legacy/data.json必须保持迁移前字节不变；回滚用正常新提交，不改写Git历史。
