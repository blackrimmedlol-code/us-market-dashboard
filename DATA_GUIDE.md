# 美股策略台数据维护指南 · v15

线上页面：`https://blackrimmedlol-code.github.io/us-market-dashboard/`

页面是纯静态 GitHub Pages：`index.html` 负责渲染，本仓库根目录的 `data.json` 就是市场数据，由四个独立定时任务写入。页面使用中国时间（夏令时对应）：21:05 建立盘前先验、23:05 初次价格复核、次日 02:05 午后盘再验证、04:25 收盘收口。不得回退或写入 `blackrimmedlol-code/calorie-tracker`。

> 页面、JSON时点和通知统一使用 `Asia/Shanghai`。后台保留目前随交易所夏冬令时运行的四个任务，避免冬令时在收盘前取数；名义时间落成中国时间ISO后比较。上表时刻为夏令时，冬令时全部顺延1小时。收盘任务从原收盘后5分钟调整为25分钟；不增设重复收盘任务。

## 写入规则

重点标的唯一排序常量：`TARGET_ORDER = ["DRAM", "LITE", "CIEN", "CRDO", "IREN", "BE", "SPCX", "MSTR"]`。动作板、快照、watchlist、分位、信号矩阵、复盘和中期账本只要同时出现这些标的，都必须按此顺序输出；市场基准可放在它们之前，BTC 等联动资产可放在之后。BE 不得被追加到末尾或因单源失败而整项省略。

1. 更新前先读取 `data.json`，保留其他三个时段、`sourceGroups`、`reviews`、`mediumLedger` 和未知字段。
2. 四个任务只替换各自对象：中国时间 21:05=`premarket`、23:05=`intraday`、02:05=`late`、04:25=`close`。每个时段都维护自己的 `horizons`、`macroFramework`、`expectationGaps` 与 `odds`。
3. 同步更新 `meta.updatedAt`、`meta.latestSession`、`meta.sessionDate`、`meta.nextUpdate`。
   `meta.schemaVersion` 固定为 `15`；后续契约升级必须同步提高版本号，页面遇到低于当前版本的可执行数据时只展示、不开放新增风险权限。
4. 不可靠的具体数字填 `null`，不得编造价格、指标或来源；周期方向可以依据真实 OHLC 聚合或结构推断，但必须在 `timeframeMethods` 和 `timeframeNotes` 说明方法与证据。
5. `snapshot` 固定 12 项，顺序为 SPY、QQQ、SOXX、DRAM、LITE、CIEN、CRDO、IREN、BE、SPCX、MSTR、BTC；股票/ETF 默认写正式时段最新价，不能把盘后价伪装成正式收盘。延长交易统一写入 `extendedHours`。
6. `news` 只收录能解释当轮价格或行动变化的信息；外链必须指向实际来源。每条必须写 `material / impactFields / directness / impact / tone`：真正改变行动的证据写 `material:true / directness:"行动级"`，普通背景写 `material:false / directness:"背景" / impactFields:[]`，页面会自动折叠。不得为了凑满 3–5 条而重复旧闻。
7. `reviews` 最新在前，最多保留 20 条；短线复盘样本不足 20 条时不得展示命中率。
8. 根级 `mediumLedger` 是 1–6 周论点账本，保留历史状态，不随盘中噪音整表覆盖；只有因果证据变化时新增、降级、关闭或更新条目。
9. 每次更新直接提交到 `main`，GitHub Pages 通常 1–2 分钟后生效。

## 第一屏决策契约

第一屏固定按“市场状态 → 风险预算与动作 → 关键依据 → 改变判断的条件”组织，不把新闻摘要或完整复盘塞进首屏：

- `regime` 使用 `主标题 / 解释层一 / 解释层二` 结构。第一个分段必须是可独立阅读的 6–14 个汉字短标题；页面会把后续分段降级为副标题。禁止把整段盘面综述全部写成大标题。
- `thesis` 负责解释主标题，控制在 1–2 句；`watchVariable` 只保留真正决定下一次判断升级或降级的变量。
- 每个时段必须写 `largestChange`，用一句话提炼相对上一有效时段最重要的变化；无实质变化时明确写“无新增确认”，不能用普通新闻填充。
- 每个时段必须写 `regimeCode / breadthState`。自然语言 `regime` 负责解释，稳定枚举负责跨时段比较；禁止用长句替代状态码。
- `horizons.MARKET.short.trigger` 是第一屏“下一确认”，`invalidation` 是“总体失效”，必须能够直接改变总体 beta、追价或隔夜权限；不得只写某一只个股的价位。
- `reviewStatus / reviewNote` 继续承接上一判断复盘，只做跳转提示；详细复盘仍放在页面下方。

## 四时段链路与 nextUpdate

| 时段对象 | 名义时间 | 核心职责 | `meta.nextUpdate` |
|---|---:|---|---|
| `premarket` | 中国时间 21:05 | 建立可证伪先验、事件表与盘前风险预算 | 当日 23:05 |
| `intraday` | 中国时间 23:05 | 用开盘后价格初验盘前判断 | 次日 02:05 |
| `late` | 中国时间 02:05 | 检查午后延续/反转、量价和关键位 | 当日 04:25 |
| `close` | 中国时间 04:25 | 用完整日线最终收口、更新复盘 | 下一个交易日 21:05 |

- 每个时段必须写 `available:true / updatedAt / updateStatus / sessionContext`。未生成的时段写 `available:false`，页面会禁用，不能借用其他时段快照伪装成有效数据。
- `updateStatus` 使用 `按时更新 / 延迟补跑 / 数据不完整`。实际执行时间偏离名义时点时必须写清楚，不能只保留名义标签。
- 每个时段写 `deltaLabel` 和 `changes`，固定覆盖市场、DRAM、LITE、CIEN、CRDO、IREN、BE、SPCX、MSTR。字段：`asset / from / to / reason / tone / material / impactFields`。
  - `material:true` 仅限改变 `regimeCode / planStatus / tradeType / permissions / trigger / invalidation / confidence` 的行动级变化；页面只展开这些项目。
  - 未改变行动的量价延续仍可保存在 `changes` 中，但必须写 `material:false / impactFields:[]`，页面会合并为“已收起 N 项非行动级变化”。
  - 不得为了填满九项把普通新闻或微小价格波动标为行动级变化。

## v15 决策有效性契约

### 稳定状态与自由说明分离

- `short.planStatus` 只能使用本文枚举；原始细节放入 `short.stateNote`。例如“延续但联动不完整”应写为 `planStatus:"部分确认" / stateNote:"延续但联动不完整"`。
- `short.tradeType` 只能使用本文枚举；具体形态放入 `short.setupLabel`。例如“供给吸收验证”应写为 `tradeType:"短线事件交易" / setupLabel:"供给吸收验证"`。
- 自动任务写入前必须执行等价于 `node validate-data.mjs data.json` 的校验。枚举、排序或必要字段不合规时不得静默写入；无法及时修复则将 `updateStatus` 写为“数据不完整”。

### 数据摘要 `decisionGate`

每个可用 session 必须包含：

- `quoteAsOf`：用于当前判断的最新正式行情 ISO 时间；
- `validUntil`：本时段行动权限的截止 ISO 时间，通常衔接下一名义更新；
- `sourceConflict`：关键报价或 OHLC 是否仍有未解决冲突；
- `volumeComplete / closeFinal`：量能是否完整、日线是否已正式收口；
- `status`：`open | caution | locked`；
- `note`：数据边界与锁权原因。

v15不再把这些汇总字段直接传播为全局锁定。`updateStatus`、`decisionGate.status`和`note`仅概括状态；执行限制由共享 `market-model.js` 按结构化质量字段计算。旧记录仍保留汇总字段用于审计。

### 分级质量与完成状态（v15）

- 每个时段必填 `sessionDate`（美东交易日）、`nominalAt`（该轮名义时间，中国时间ISO）、`marketCloseAt`（该日实际正式收盘时点，含提前收盘）、`quality.checkedAt`、`quality.quotes`、`quality.issues` 和 `completion`。
- `quality.quotes`覆盖12个快照标的。每项含`price/status/asOf/marketDate/session/isFinal/source/sourceUrl`；正式日线另有`open/high/low/volume`。状态仅`verified/missing/conflict/unverified`；缺失值为null。股票日线`session=regular`，盘前`pre`，盘后`after`，BTC`crypto`。
- `quality.issues`每项含`code/message/scope/assets/level/effect`：scope为`global/asset/metric`，level为`info/warning/critical`，effect为`execution/volume/linkage/reference`。局部问题写明assets；全局问题assets为空。BTC成交量缺失只影响MSTR/IREN的加密量能说明，不关闭无关股票权限。
- 个股关键价格缺失或冲突：只暂停该标的新增执行判断。SPY/QQQ/SOXX关键行情或数据契约失效：才影响市场层。量能没有比较基准：量能确认降为unknown/mixed，不能因为有累计量就写confirmed。
- 历史时段、已过有效期的版本与收盘版显示中性的“参考记录”；它们不是实时可执行信号，模型不自动给出新交易权限。真实关键错误仍在统一数据说明和对应标的显示，不能隐藏或直接删掉保护。
- 同一共同问题只解释一次；各卡只显示自身例外。分析权限与数据完整性分开，数据恢复也不能自动放宽原投资策略。
- `completion.status`仅`pending/partial/final/snapshot`。文件写成功不等于收盘完成。只有八标的和SPY/QQQ/SOXX本日正式OHLCV齐全、时间不早于实际收盘且来源明确，才可`final`及`closeFinal=true`。BTC不参与美股正式收盘完成判定。
- `node check-session.mjs data.json SESSION YYYY-MM-DD previous.json`先校验契约与原始判断，再判定完成：0=完成；1=非法数据；2=合法暂存但未完成。退出2必须继续一次备用获取或明确报告待补项，不能静默宣告收盘完成。禁止把15:52快照改标签为16:00。
- 完成判断还检查`quote.asOf`和市场日，不允许通过刷新`updatedAt`伪装新行情。盘前/盘中必须取得本轮名义时点前15分钟之后的关键报价。

### 内容与原判断冻结

- 每个`horizons.*.short`必填`holdingPlan`和`entryPlan`：前者说明已有持仓的观察/防守条件，后者说明新增仓位条件；不替用户挑选或排名。
- `confirmations.volume.state=confirmed`必须带`benchmark:{basis,value,current,asOf,sourceUrl}`。盘中仅接受`basis=same-time`；正式收盘可用此前20日均量，明确样本、倍数和描述阈值。1.2倍是统一描述口径，不是经验证的收益模型，也不代表低于它就不能上涨。
- CIEN分析光网络系统/DCI与收入到毛利兑现；CRDO分析高速互连/AEC与交付、客户集中、利润质量；LITE/CIEN/CRDO共同暴露于AI网络资本开支，不包装成完全分散。
- CRDO为研究标的，CRDU为独立的杠杆ETF。未经用户输入，不写持仓成本或股数；严禁用CRDO报价计算CRDU盈亏、止损或敞口。
- 每条`decisionLedger`新增`originalPlan`，冻结`trigger/invalidation/referenceAt/referencePrice/setupType`及`capturedAt/provenance`。改条件必须新建callId，旧条目用`supersededBy`关联，结果未核实保持待评估；不能直接改原条件让其“命中”。
- 写前必须保留previous.json并执行`node validate-data.mjs data.json previous.json`；拒绝历史判断删改。v15迁移仅冻结当时已有记录，不声称追溯修复此前的改写。新收盘剧本在形成时间后才开始验证，不可回算当日命中率。
- 新增CIEN/CRDO时仅在首次纳入版本写真实研究；旧时段保持“尚未纳入”占位，不倒填价格、方向、分位或胜负。


### 事件倒计时 `eventCalendar`

每个 session 维护经过来源确认的未来事件数组；没有事件时允许空数组。字段：

- `id / label / eventDate`，有可靠具体时点时再写 `startsAt`；
- `affectedAssets`：可包含 `MARKET` 或八个固定标的；
- `riskWindowHours / riskLevel`；
- `permissionOverride.chase / overnight / beta`；
- `timing / note / sourceUrl`。

具体发布时间未知时只能显示“距事件日”，不得伪造小时倒计时。进入风险窗口后页面按 `permissionOverride` 收紧对应标的权限；事件结束或过期后不再沿用。

### 条件判断结果账本 `decisionLedger`

根级 `decisionLedger` 用于验证策略有效性，而不是记录个人成交。每个真正建立或改变的短线判断写一条：

- `callId / sessionDate / session / asset / horizon`；
- `regimeCode / setupType / referencePrice / referenceAt`；
- `trigger / invalidation / planStatus / permissionsAtCall / evidenceAtCall`；
- `outcome.status`：`open | triggered | invalidated | closed | expired`；
- 触发后按可得数据补充 `triggeredAt / invalidatedAt / evaluatedAt / return1D / return3D / mfe / mae / falseBreakout`。

同一剧本跨时段只更新同一 `callId`，不能每次刷新都追加同义样本。未触发判断不能算胜负；只有已触发并完成评估的同类样本进入统计。相同 `setupType + regimeCode + horizon` 的可比已结样本不足 20 条时，页面只展示开放、触发、失效和已结数量，不展示胜率或收益率结论。

账本生命周期必须自洽：`open` 不得带 `triggeredAt / invalidatedAt / evaluatedAt`；`triggered` 必须有 `triggeredAt`；`invalidated` 必须有失效或评估时间；`closed / expired` 必须有 `evaluatedAt`。`失败突破 / 剧本失效` 是已结束或已失效的旧剧本，不能同时保持 `outcome.status:"open"` 或 `"triggered"`；若下一轮建立恢复条件，应另建或重置为 `等待触发` 的开放判断。

最新时段仍为 `open / triggered` 的判断必须与对应 `horizons.*.short` 的 `planStatus / trigger / invalidation` 完全一致。上一轮“剧本失效”只保留在 `reviews` 或已结束账本中；一旦建立下一轮恢复条件，当前页必须显示新的“等待触发”剧本，不能把历史结果与当前动作混写。

### 本机持仓风险联动

持仓成本、股数和计划止损只保存在浏览器本机。页面根据当前可审计价格显示敞口、浮盈亏、距止损和从现价到止损的计划风险；同时引用 `decisionGate` 与事件窗口展示当前是否允许新增风险。页面不得把本机输入写回 `data.json`，也不得把模型权限替代为确定性买卖指令。

## 低 Token 执行协议

本指南是研究与写入的唯一规范；定时任务提示词只负责启动、判时段、幂等检查和故障恢复，不重复粘贴本指南。每轮必须按以下阶段执行：

1. **Stage 0 · 零内容预检**：只按 `Asia/Shanghai` 判断当前时间、对应的美股交易日和应执行时段。若调度器在名义时点前 0–2 分钟启动，必须等待至名义时点后再继续，不能按“未到期”跳过；更早启动、未命中窗口或非交易日时立即结束，不读取仓库、行情或新闻。
2. **Stage 1 · 轻量幂等**：命中后仅在工具侧读取并解析 `data.json` 的 `meta` 与候选 session 的 `available/updatedAt/updateStatus`。工具只向模型返回这些字段，不回显整份 JSON。已完成则结束且不通知。
3. **Stage 2 · 按需加载**：只有确需更新时，才读取最新完整 `DATA_GUIDE.md` 与 `data.json`，再进行研究、合并和写入。
4. **Stage 3 · 增量研究**：优先沿用上一有效时段中时点清晰、因果未变的宏观支柱、公司静态事实、AI 资本循环、基本面兑现链、来源组和中期账本；四时段常规只重新取得价格、OHLC、成交量、联动、催化、触发与失效证据。只有发生合同/项目/报价/融资事件或财报时，才改写对应基本面节点。不得为了省 Token 沿用已过期行情，也不得为了显得有更新而重述没有变化的长期背景。
5. **Stage 4 · 工具侧合并**：JSON 解析、字段保留、session 替换、SHA 合并与复读验证尽量在工具侧完成；工具向模型只返回变更摘要、缺失字段、commit/blob SHA 与验证结果，不输出整份 `data.json`。

各时段的增量边界：

- `premarket`：以上一 `close` 与最新 `modelChange` 为基线，研究隔夜/盘前新增变化。
- `intraday`：只验证盘前先验与开盘后新增量价，不重复盘前新闻背景。
- `late`：只写相对 `intraday` 的延续、反转、量能与关键位变化。
- `close`：取得完整日线并最终收口；只有此时才常规重算 60D/252D 分位、刷新完整日线基线和评估 `mediumLedger`。

非收盘时段的 `odds` 默认沿用最近一次已验证结果及原始 `asOf/referencePrice/sampleSize/source`，除非本轮确实取得新的完整滚动日线序列；禁止拿盘中价或延长交易价伪算分位。

## 数据时效与价格地图

每个时段固定写 `freshness`：

- `quotes`：盘前/盘中/收盘行情的实际 `asOf`；
- `timeframes`：15m/30m/1h/4h 的获取或聚合时点；
- `daily`：日线与分位数据的截止交易日，不能和盘中现价混写；
- `macro`：宏观信息的截止时点。

每个可用时段应尽量维护 `extendedHours`，标的顺序固定为 DRAM、LITE、CIEN、CRDO、IREN、BE、SPCX、MSTR。每条包含：

- `symbol / session / price / regularClose / changePct / tone`；
- `asOf / status / source / sourceUrl`；
- `state / note / nextConfirmation`。

延长交易必须分清三个口径；所有 `asOf`、说明文字和页面标签统一写中国时间：

- `盘后`：正式收盘后的连续盘后阶段，可使用统一可审计的交易所/UTP/Cboe/S&P Global 报价；
- `夜盘`：盘后结束至盘前开始的经纪商或替代交易系统时段，只有同时写清提供商、成交时点和报价状态时才能展示；
- `盘前`：正式开盘前的盘前阶段，必须与前一晚盘后锚点分开。

不得把已经结束的盘后报价继续标成“当前夜盘价”，也不得把单一经纪商的稀疏打印当成全市场统一价格。没有可审计夜盘价时，保留最近可验证盘后锚点并写清边界；价格地图可用 `status:"verified"` 的最新延长交易价，但标题必须显示对应 session。盘后/夜盘突破只能提高下一正式时段的确认优先级，不能单独升级为完整交易信号。

DRAM、LITE、CIEN、CRDO、IREN、BE、SPCX、MSTR 的 watchlist 项必须额外写，并按 `TARGET_ORDER` 排序：

- `priceStatus`：例如 `盘中价 · 中国时间 23:05`、`收盘价 · 中国时间 04:25`；
- `supportValue / resistanceValue`：用于计算现价到一级支撑、阻力的距离；对应文字仍放在 `support / resistance`；
- 结构化数值必须与文字价位一致。支撑或阻力为区间时，用最近、最可执行的一侧作为 value，并在文字中保留完整区间。

## AI 资本循环、需求闭环与三时钟

这一层只负责把 AI 长期产业逻辑翻译成可证伪的中期证据，不能覆盖价格确认，也不能新增第五个宏观支柱。

### `aiCapitalCycle`

每个可用 session 必须包含 `aiCapitalCycle`，固定五项并按顺序输出：`endDemand / unitEconomics / capex / financing / price`。每项写 `key / label / state / tone / evidence / invalidation`，对象另写 `asOf / note / demandFormula / overbuild`。

- `endDemand`：需求强度不是单一 Token 总量，而是“场景渗透 × 使用强度 × 工作负载复杂度 ÷ 效率提升”。使用云收入、AI 收入、订单、ARR、客户上线、利用率等可审计数据验证；
- `unitEconomics`：把使用量与价值捕获分开，检查单位收入、每 GW/MW 收入、利用率、租金/Token 单价、毛利率和现金回收。无法统一口径时写“待验证”，不得拿未经来源验证的 ARR/GW 估算当事实；
- `capex`：从“宣布资本开支”推进到“规划 → 下单 → 通电 → 部署 → 利用率”，只有投入形成可用且被使用的产能，才算有效兑现；
- `financing`：债务、可转债、股权、供应商或客户融资必须与经营现金流分开，同时检查融资成本、期限、信用利差和潜在稀释；
- `price`：相关标的、同业与行业 ETF 是否共同确认。长期需求成立不等于股票已完成定价。

`overbuild` 不输出黑箱“泡沫分数”，固定写：

- `stateCode`：`unknown | no_signal | early_warning | confirmed`；
- `state / tone`：自然语言状态与方向；
- `warningEvidence / offsettingEvidence`：只放可复读证据数组；
- `nextTrigger`：什么连续证据会使过建判断升级。

只有当可用产能增速持续高于收入/利用率，同时出现租金或价格下降、项目延期/取消、毛利和现金流恶化、融资压力上升、供应链订单/广度转弱中的多项连续证据，才允许升级为 `early_warning` 或 `confirmed`。单一估值回撤、单家公司融资或一日股价分化不能单独确认过建。

更新频率必须分层：

- **四时段**：常规只更新 `price`、短线价格/量能/联动和操作权限；
- **事件/周度**：合同、项目交付、利用率、行业报价、GPU 租金、融资条件或订单发生真实变化时，才更新相应基本面节点；
- **财报/重大经营事件**：完整重估 `endDemand / unitEconomics / capex / financing`、`overbuild` 与中期账本。

非收盘时段默认沿用仍有效且带 `asOf` 的结构基线，不得为了制造“四次更新”而改写静态事实。AI 长期逻辑不得替短线失效找理由。

### `watchlist[].demandLoop`

DRAM、LITE、IREN、BE 的 `demandLoop` 只负责基本面兑现，固定按五项输出：`industryDemand / ordersCommitments / deliveryUtilization / revenueConversion / marginCashFlow`。每项写 `key / label / state / tone / note`。

- **DRAM**：AI/服务器需求 → 订单、合约价/现货价与库存 → 位元出货、产品组合、产能利用率/良率 → 成份股收入 → 毛利、现金流和资本开支；
- **LITE**：集群规模与光连接价值量 → 订单/积压 → 交付、交期、产能爬坡与客户验收 → 收入 → 毛利和现金流；
- **IREN**：AI Cloud 与 BTC 两条需求链 → 合同/容量 → 通电 MW、GPU 上线、客户启用与利用率 → ARR 转已确认收入 → 毛利、现金流、CapEx 与稀释；
- **BE**：数据中心现场供电需求 → 合同/积压 → 获批、通电、部署与客户验收 → 收入确认 → 毛利和经营现金流。

`peerBreadth / priceConfirmation` 不再写入 `demandLoop`，避免与短线确认重复；同业广度放入 `horizons.*.short.confirmations.linkage`，价格与量能分别放入 `confirmations.price / volume`。SPCX、MSTR 不强行套用 AI 基本面链，没有独立、可证伪的五步兑现证据时保持空值。

### `mediumLedger[].clocks`

中期账本允许包含 `clocks.technology / clocks.commercialization / clocks.financing`，每个时钟写 `state / tone / note`。

- 技术时钟：单项突破是否已形成完整技术系统；
- 商业化时钟：试用、订单是否转化为规模部署和真实收入；
- 融资时钟：扩张主要由经营现金流还是外部资本驱动。
- 三时钟只在因果证据变化时更新，不随一根盘中 K 线漂移。

## 双周期操作卡

每个时段的 `horizons` 固定包含 `MARKET / DRAM / LITE / CIEN / CRDO / IREN / BE / SPCX / MSTR`，每个对象分别包含：

- `permissions`：`chase / overnight / beta`，把宏观框架压缩为追价权限、隔夜权限和 beta 预算；

- `short`：0–3 个交易日，字段为 `bias / confidence / posture / driver / trigger / invalidation / planStatus / tradeType / confirmations`。
  - `planStatus` 是剧本生命周期，不等同涨跌方向；使用 `等待触发 / 已触发 / 部分确认 / 已确认 / 失败突破 / 剧本失效`。一旦进入 `失败突破` 或 `剧本失效`，必须同步降低追价、隔夜或 beta 权限，不能继续用原叙事论证。
  - `tradeType` 是交易类型锁；使用 `风险预算 / 短线事件交易 / 趋势交易 / 中期逻辑观察 / 仅观察`。短线触发失效后不得临时改写成中期持有；若要改变类型，必须重新建立触发、失效和仓位权限。
  - `confirmations` 固定包含 `price / volume / linkage`，每项写 `state / note`。`state` 使用 `confirmed / mixed / failed / unknown`；没有可比成交量或联动数据时必须写 `unknown`，不能用价格涨跌代替量能。`linkage` 对市场表示广度/跨资产，对 DRAM 表示存储同业，对 LITE 表示 COHR/光通信链，对 IREN 表示 BTC/矿企同业与 AI 数据中心链，对 BE 表示 VST/NRG/CEG/GEV 与数据中心供电链，对 SPCX 表示上市后相对强弱与供给吸收，对 MSTR 表示 BTC/IBIT/COIN 联动。
- `medium`：1–6 周，字段为 `bias / posture / driver / trigger / invalidation`。

短线优先级固定为：价格确认与关键位 > 跨资产/行业广度 > 事件预期差 > 宏观先验。中期优先看宏观/行业因果链、日线与周线结构、资金流和供给约束。

`posture` 使用可执行语言，例如：`突破跟随 / 等回踩 / 只按反弹看 / 不追高 / 降低隔夜权限 / 允许小仓隔夜`。不要写确定性买卖指令，也不要用一个 0–100 黑箱分数代替证据。

## 高善文式宏观因果框架

`macroFramework.pillars` 固定四项：增长、通胀、流动性/信用、风险定价。每项写：

- `state / direction`：当前状态和方向；
- `evidence`：可验证的广泛观察；
- `transmission`：从宏观变量到资产价格的传导机制；
- `invalidation`：排除证据或失效条件。

`macroFramework.chain` 写 2–5 条真正影响当日判断的因果链：`from → through → to → verdict`。宏观框架只负责方向偏向、风险预算和是否允许隔夜，不直接充当入场信号；盘中价格可以推翻盘前宏观先验。

`expectationGaps` 只收录有明确“市场先验 / 实际发生 / 价格反应 / 持仓含义”的事件，不能把普通新闻列表复制进来。

`odds` 只在取得真实历史序列时计算。页面展示的是“参考收盘价在窗口内所有收盘价中的位置分位”，不是收益率分位：

`percentile = (低于参考价的样本数 + 0.5 × 等于参考价的样本数) ÷ 样本数 × 100`

- 60 日分位：短线延伸与均值回归风险；
- 252 日分位：中期所处位置；
- 每条必须写 `asOf / referencePrice / sampleSize / basis / source`；历史 K 线有延迟，不得称为盘中现价；
- `percentile` 无法可靠计算时必须为 `null`；
- `percentile:null` 在页面必须显示“待计算 / 样本不足”，不得标为 ACTUAL；样本不足窗口但数值真实时，页面必须显示“上市后 N 日”或“可用 N 日”，不得把不足 60/252 根包装成完整窗口；代理分位必须明确标为“代理”。
- 收盘任务必须主动拉取八个标的的完整日线：优先使用交易所/基金官网，Nasdaq Historical Quotes 可作为统一可审计序列；单一来源失败时至少重试一次并切换备用源，不能仅因上轮字段为 `null` 就继续沿用。IREN 与 BE 在公开源已有完整 252 根日线时不得保持“待计算”。
- 重算只更新当前收盘版本的odds；已归档的盘前/盘中版本保留当时可得的分位，避免事后信息渗入历史。下一轮盘前、盘中、午后原样继承其形成时已可得的最近正式收盘分位。新标的历史占位不得回填。
- `oddsMethod` 每轮整段覆盖，只保留当前计算公式、截止日和不足样本说明；禁止拼接历次“未取得序列”文字。写后必须断言八标的各有 60D/252D 两项、顺序正确、`asOf` 不早于最近可得正式收盘（确有源故障时除外，并明确写出失败源与重试结果）。
- 新基金不足 252 个交易日时，不得把上市以来样本冒充 252 日。只有能从发行文件确认核心持仓、且成份股有完整日线时，才允许输出显式标记 `proxy:true` 的核心持仓代理；同时保留基金自身上市以来的样本数与分位；
- SPCX 存在代码换主：旧的 SPAC and New Issue ETF 已于 2026-04-07 改为 SPCK，SpaceX 自 2026-06-12 才以 SPCX 上市。SPCX 的历史序列必须从 2026-06-12 重启，剔除旧 ETF 以及 IPO 前无成交的占位记录。样本不足 60/252 时仍可展示“上市后位置”，但必须写 `sampleNote` 和真实 `sampleSize`，不得把 47 根样本包装成完整窗口；
- 分位用于描述位置；高低分位本身不升级交易权限，也不是强制入场筛选条件。

## 五周期规则

DRAM、LITE、CIEN、CRDO、IREN、BE、SPCX、MSTR 固定写入 `15m / 30m / 1h / 4h / 1d`，不得因为某个平台没有现成 4h 图而跳过。

- 15m、30m、1h：优先直接读取对应 K 线。
- 4h：优先直接 4h K 线；其次聚合连续四根 1h K 线；再其次结合小时结构、当日 OHLC 和前 3–5 个交易日日线判断。
- 1d：使用日线 OHLC，并参考最近 5–20 个交易日的高低点、收盘位置、均线或结构。
- 若使用聚合或结构判断，不得虚构 RSI、MACD、EMA 等未实际取得的数值。

`timeframeMethods` 枚举：

- `direct`：直接周期行情
- `aggregate`：低周期 OHLC 聚合
- `structure`：多日/多周期结构推断
- `daily`：日线 OHLC

页面证据权重必须与方法匹配：`structure` 是同一批多日/多周期信息的结构推断，不得与 `direct / aggregate` 一样呈现为多份独立确认。无论方法是否同源，页面均保留15m、30m、1h、4h、1d五个独立按钮和各自说明；structure只标结构参考，不冒充四份独立K线确认。1–6周论点账本默认展开。

## 数据源梯队

- 行情 / K 线：WeStock / 腾讯自选股用于结构化日线和历史窗口计算；交易所、基金官网优先校验，TradingView、Barchart、Nasdaq、Yahoo Finance 补充分时与小时行情。
- 宏观 / 波动：美联储、美国财政部、FRED、CME FedWatch、Cboe VIX、Reuters。
- DRAM：Roundhill 官方持仓，Micron、SK Hynix、Samsung、SanDisk/Kioxia IR，TrendForce/DRAMeXchange。
- LITE：Lumentum IR 与 SEC 为公司事实源；云厂商 CapEx、AI 数据中心光连接需求、COHR 和光模块链用于验证行业广度与相对强弱。
- IREN：IREN IR 与 SEC 为公司事实源；BTC产量/持仓、算力与电力容量、GPU交付、AI Cloud合同/ARR及资本开支为核心变量；BTC、MARA、RIOT、CLSK与AI数据中心链用于验证联动。
- BE：Bloom Energy IR 与 SEC 为公司事实主源；AI/数据中心现场供电合同、积压、部署节奏、收入、毛利率与经营现金流为核心变量；VST、NRG、CEG、GEV 与数据中心电力链用于验证价格广度，PLUG/FCEL 只作次级参考。不得把长期电力缺口直接等同于 BE 短线确认。
- SPCX：SpaceX IR 与 SEC、Nasdaq 为身份和公司事实源；发射节奏、Starlink 运营、政府/商业订单、AI 业务资本开支与成交量用于验证。严禁使用旧 SPCX ETF 历史；旧基金只可用于解释代码换主。
- MSTR / BTC：Strategy IR 与 SEC，BTC 多市场价格，现货 ETF 资金流，IBIT/COIN 相对表现。
- 期权 / 仓位：Cboe、CME、Nasdaq 期权链及可靠成交/未平仓数据；缺少完整序列时不得虚构 gamma、IV 或挤压结论。
- 跨资产 / 广度：2Y/10Y/30Y、DXY、VIX、油金、行业广度、SOXX 与同业价格；用于验证传导链而不是堆数字。
- 任何付费墙、延迟数据或不完整交易日必须在来源边界中说明。

## 复盘逻辑

- 中国时间 23:05：初次复核 21:05 盘前判断。
- 中国时间 02:05：只记录相对 23:05 新出现的延续、反转或关键位破坏，不重复整份新闻。
- 收盘：用完整日线最终复核当天判断，写入有效驱动、失效假设和模型调整；相同交易日的盘中复盘可以保留，但阶段必须不同。
- 下一个交易日中国时间 21:05：引用上一收盘复盘建立新先验，不重复造一份同义复盘。
- 每个新时段生成前，必须读取最新一条相关 `reviews[].modelChange`，把其中的权重、确认条件或失效规则应用到本轮判断；若新证据推翻旧调整，应在本轮复盘中明确替换原因，不能只展示而不执行。
- 复盘资产顺序固定为市场、DRAM、LITE、CIEN、CRDO、IREN、BE、SPCX、MSTR。首次加入而没有上期判断时标为“新基线”，不倒填胜负；从下一有效时段起必须正常复核。
- 判断错误要直接写“失效”，不能用模糊措辞回避。
- 短线复盘回答“今天错在哪一环”；中期账本回答“1–6 周的因果论点是否仍成立”。
- `reviews` 只做模型判断复盘，不记录个人交易执行。每条至少包含 `validDriver / errorLayer / failedAssumption / modelChange`；`errorLayer` 必须明确归入宏观驱动、传导机制、行业/跨资产联动、量能、价格确认或数据边界中的一层。
- 历史最新在前；相同日期与阶段应更新原条目，不重复追加。`reviews` 条数只表示复盘记录量，命中率与收益统计必须使用 `decisionLedger` 中已触发且完成评估的可比样本。

## 枚举

- `tone`: `up | down | flat`
- `timeframes`: `bull | bear | neutral | unknown`
- `regimeCode`: `RISK_ON | SELECTIVE_RISK_ON | ROTATION_NEUTRAL | RISK_OFF | EVENT_LOCK`
- `breadthState`: `broad | selective | mixed | weak | unknown`
- `planStatus`: `等待触发 | 已触发 | 部分确认 | 已确认 | 失败突破 | 剧本失效`
- `tradeType`: `风险预算 | 短线事件交易 | 趋势交易 | 中期逻辑观察 | 仅观察`
- `confirmations.*.state`: `confirmed | mixed | failed | unknown`
- `decisionGate.status`: `open | caution | locked`
- `decisionLedger.outcome.status`: `open | triggered | invalidated | closed | expired`
- `changes[].impactFields`: `regimeCode | planStatus | tradeType | permissions | trigger | invalidation | confidence`
- 复盘结果：`确认 | 部分确认 | 失效 | 新基线`
- 矩阵信号：`+ | 0 | -`
- `latestSession`: `premarket | intraday | late | close`
- `updateStatus`: `按时更新 | 延迟补跑 | 数据不完整`

## 质量检查

- JSON 可解析，且未覆盖另一时段内容或复盘历史。
- 当前任务只改自己的时段对象；空时段保持 `available:false`，不能回退到其他时段的快照。
- 市场、DRAM、LITE、CIEN、CRDO、IREN、BE、SPCX、MSTR 的 `changes` 完整，八个重点标的严格按 `TARGET_ORDER` 排序；每个数据模块都有实际时点和状态标签。
- `regime` 首段是可独立阅读的短标题，`largestChange` 已填写；`MARKET.short.trigger / invalidation` 分别能作为下一确认与总体失效条件。
- `meta.schemaVersion` 为 15；每个可用时段都有合法 `regimeCode / breadthState / decisionGate / eventCalendar`，所有枚举通过 `validate-data.mjs`。
- `changes` 九项均显式标明 `material / impactFields`；页面展开行动级变化、收起普通延续。
- DRAM、LITE、CIEN、CRDO、IREN、BE、SPCX、MSTR 同时具有 `supportValue / resistanceValue / priceStatus`，距离计算方向正确。
- `extendedHours` 如存在，严格按 `TARGET_ORDER`，正式收盘与盘后/夜盘不混写；每条都有 session、时点、状态和来源，页面关键位距离采用的价格口径可见。
- 四时段的 `nextUpdate` 按中国时间 21:05 → 23:05 → 02:05 → 04:25 连续衔接。
- 盘中版必须复核中国时间 21:05 盘前判断，不得只是重复新闻。
- DRAM/LITE/CIEN/CRDO/IREN/BE/SPCX/MSTR 五周期字段完整，4h 与 1d 有方法和证据说明。
- 每个可用时段的 `aiCapitalCycle` 严格包含需求强度、单位经济、产能兑现、融资质量、价格确认五项及 `overbuild`；每项都有失效条件，过建状态不使用单一股价或无来源估算升级。
- DRAM/LITE/CIEN/CRDO/IREN/BE 的 `demandLoop` 严格为五步基本面兑现链，不再混入同业与价格确认；SPCX/MSTR 不为完整性硬凑 AI 链条。
- `MARKET / DRAM / LITE / CIEN / CRDO / IREN / BE / SPCX / MSTR` 的短线与中期字段完整，触发和失效不能互相矛盾。
- 九个操作对象都具有 `planStatus / tradeType / confirmations.price / confirmations.volume / confirmations.linkage`；剧本失败必须同步降权，交易类型不能因被套而漂移；确认灯没有证据时使用 `unknown`。
- 四个宏观支柱、至少两条因果链与预期差板块有真实证据；没有事件时允许空数组，不能凑数。
- 60/252 日价格位置分位必须能追溯到真实日线、日期和样本数；代理必须标明成份、权重口径和基金自身可用样本，不得与实际基金历史混写。
- DRAM 的消息—价格一致性、LITE 的公司—光通信链确认、IREN 的 BTC/矿企—AI数据中心双链验证、BE 的数据中心电力需求—合同—部署—利润/现金流闭环、SPCX 的上市后量价与代码换主隔离、MSTR 的 BTC-MSTR 背离必须进入 `verdict` 或 `priceAction`。
- 复盘区只在确有重复错误或数据完整性问题时记录模型调整，不为每轮凑新规则；`mediumLedger` 只有证据变化时才更新，不输出小样本伪精度。
- `decisionLedger` 对同一剧本只维护一个 `callId`；未触发与未完成评估的记录不进入胜率或收益统计，少于 20 个可比已结样本不展示绩效结论。
- `decisionLedger` 生命周期时间戳与状态严格自洽；开放判断不夹带旧触发时间，失败剧本不保持开放状态。
- `news` 每条均有 `material / impactFields / directness / impact / tone`；页面行动证据只展示 `material:true`，背景信息默认折叠。
- 五周期的 `timeframeMethods` 与页面证据权重一致：结构推断不会被包装成四份独立 K 线确认。
- 分位为空、样本不足或使用代理时，标签分别显示“待计算 / 可用 N 日 / 代理”，不误标完整 ACTUAL。
- 页面只用于信息整理，不输出确定性买卖建议。

## 自动任务执行与可复算文件

四个主任务保持独立；现有中段自愈继续复用，不新建重叠任务。所有五条启用任务均使用v15八标的契约。先完成主行情与来源记录，20分钟内争取第一笔合法提交；收盘未齐可写partial，但必须列出未齐标的、已尝试来源和失败原因，不能当成幂等命中。一次备用尝试后仍未完成，应明确报告，不无限轮询。行情齐全后优先补分位，35分钟后停止扩展新闻研究。

收盘取数可运行`node refresh-history.mjs YYYY-MM-DD`，结果存`history/YYYY-MM-DD.json`，含完整原始样本与来源。`--peers`仅补同业最近数日，不计算同业60D/252D。接口日期使用ISO，必须核验分页总数、交易日、重复行、OHLC边界与有效成交量。接口异常需要一次备用来源，脚本报错不能当作完成。

正式数据写前、写后均运行契约校验与目标时段完成检查；分位可用`node verify-history.mjs data.json close`复算，少样本仅DRAM上市起及SPCX新主体上市起允许。日内原始序列暂缺时，五个按钮显示待验证，不能用日线伪造分钟信号。

`check-session`分别返回`complete`（主行情）与`researchComplete`（收盘分位）。正式OHLCV齐全可以显示已收盘，分位待补不重锁股票；但任一研究分位陈旧/空值/无可复算样本时退出2，自动任务不能幂等跳过。两项都完成且写后复读通过，才算本轮完全完成。

## 前瞻评估协议 v1（条件判断体检改进）

2026-09-05体检发现：121条记录中14条标为失效，其中13条没有触发时间；3条closed没有收益结果；21条带触发时间中8条不晚于参考行情时点。旧记录完整保留，不能把13条改成“未成交所以正确”，也不能把14条当成交易亏损。审计由`node audit-ledger.mjs data.json`与页面共用规则实时重算，完整初始分析见`ANALYSIS_AUDIT.md`。

`meta.analysisProtocol`记录启用时间和原始基线SHA，不能随行情更新重置。此后新增callId必须冻结`evaluationPlan`；规则发生实质变化时建立新callId，沿用同一`familyId`并关联supersededBy。没有实质变化复用原callId。旧记录不事后补一个“当时已知”的新协议。

evaluationPlan必填：

| 字段 | 约定 |
|---|---|
| version / kind | 1；trade（趋势/短线事件）、observation（仅观察/中期）、market（市场预算）分开 |
| familyId / hypothesisId | 同一标的同一轮行情的修订共用family；假设编号用于前瞻分组，不把四时段当四次独立成功 |
| recordedAt / validUntil | 真实形成时间、不早于参考行情；触发截止时间。中国时间ISO；不能倒签 |
| confirmationTimeframe | 15m / 30m / 1d，形成前选定，结果出现后不得换周期 |
| conditions | 非空数组`[{id,rule}]`；所有条件AND，复合OR写清在单条rule中。数字关键位、比较符号、连续根数、同业名单/数量、相对强弱比较区间必须写清，禁止只写“站稳/转强” |
| invalidationRule | 明确触价还是哪一周期收线、AND/OR；区分入场前取消条件与入场后止损 |
| direction / stopPrice / stopRule | trade必填：long/short、初始止损价、touch/bar_close |
| entryRule / exitRule | trade固定next_bar_open / stop_or_horizon；确认收线后下一根可交易开盘模拟成交；跳空越过止损则跳过并记原因，不假设成交在突破价 |
| horizonTradingDays / roundTripCostBps | trade必填：1或3个交易日，双边成本基点（包含费用和滑点假设）。必须预先固定，不能忽略休市或结果出来后调整 |

最小示例（说明格式，非实际标的建议）：
```json
{"version":1,"kind":"trade","familyId":"EXAMPLE-episode-1","hypothesisId":"repair-v1","recordedAt":"2026-09-08T21:05:00+08:00","validUntil":"2026-09-09T04:00:00+08:00","confirmationTimeframe":"15m","conditions":[{"id":"price","rule":"正式盘一根15m收盘严格大于100；不得以日内最高价等于100替代"}],"invalidationRule":"入场前15m收盘小于95则取消；入场后触及95止损","direction":"long","stopPrice":95,"stopRule":"touch","entryRule":"next_bar_open","exitRule":"stop_or_horizon","horizonTradingDays":1,"roundTripCostBps":20}
```

写triggeredAt时必须同时写`outcome.triggerEvidence={barClosedAt,timeframe,checks:[{conditionId,result:"pass",observed,asOf,sourceUrl}]}`，覆盖每一条conditions。observed写真实测量结果；asOf为实际行情时点；必须晚于方案形成、不晚于触发；barClosedAt等于triggeredAt。先有方案，再有收线证据，不能拿形成时已经看到的高点当未来预测命中。只有价格碰位而同业/量能未确认时保持部分确认，不得写triggered。

每轮先复核已有判断，再写新判断：逐项核对原条件，不用新条件解释旧结果。盘中确认只回答盘中执行；是否隔夜在收盘另作持有判断，不把“当日正式收盘确认”事后加到原盘中策略来消除亏损。风险预算不是市场涨跌预测，观察取消不是交易失败。

有足够分钟原始数据时尽力修复历史触发与后续路径，另附补证时间和来源；不能用全天最高/最低价推算入场后的MFE/MAE，不能虚构分钟数据、成交或手续费。找不到的写明缺证并保留待核验。旧记录重建结果也只作回顾性分析，不混入新协议前瞻绩效。

新trade结束时写`outcome.execution={entryAt,entryPrice,exitAt,exitPrice,exitReason:"stop"|"horizon",horizonAt,sourceUrl,pathVerified:true,ambiguous:false}`；horizonAt按真实交易日历指定为进场后的第N个交易日正式收盘。先止损则按实际可成交价退出；若同一根K线同时出现目标/止损而无法恢复先后，标ambiguous并保留空收益，不选有利路径。模拟结果不是用户实际成交。`return1D`或`return3D`为对应既定期限的**止损或到期净收益百分比**，不混写成不止损的持有收益；净收益=方向×(退出/进入−1)×100−roundTripCostBps/100。MFE非负、MAE非正，单位均为相对进入价的百分比，只用进入至退出路径。evaluatedAt不早于exitAt。

旧数据标签作为历史事实保留；仅当新方案、逐项触发证据、进出场路径、费用和结果均核验后，才算可统计模拟交易。收益为负也必须计入。按市场状态×类型×假设×确认周期×持有期×方向×费用口径分组，同family重复修订不能重复贡献独立样本；同日多个AI资产仍相关。20个可比family只是最低展示门槛，不是统计显著或模型有效的证明。还应列样本覆盖率、遗漏机会、净收益分布和回撤，不能单靠提高胜率。

首轮改进只验证三项假设：弱市修复与趋势延续分开；行业强势必须有个股确认；触及关键位不等于收线突破。不凭一个失败增加永久禁令，不事后找最优周期。新规则在下一批未见结果的样本前冻结，积累后与预先固定的基准、成本和风险预算比较，明确减少假突破是否同时错过大趋势。

自动任务完成检查之外，每次还运行audit-ledger并复核到期/已触发待评估项。主行情已更新不代表结果台账已完成；有到期项必须尝试补结果或记录本轮`outcome.assessmentAttempt={at,status:"blocked",reason,sourcesTried:[...]}`，同轮已经记录无法取得的数据不无限重试。此审计不锁定行情或交易权限、不新增重叠任务。写后复读协议字段、原计划完整性和结果数量；新规则实际效果等待后续样本验证。
