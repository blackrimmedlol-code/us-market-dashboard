# 美股策略台数据维护指南 · v14

线上页面：`https://blackrimmedlol-code.github.io/us-market-dashboard/`

页面是纯静态 GitHub Pages：`index.html` 负责渲染，本仓库根目录的 `data.json` 就是市场数据，由四个独立定时任务写入。固定使用中国时间：21:05 建立盘前先验、23:05 初次价格复核、次日 02:05 午后盘再验证、04:05 收盘收口。不得回退或写入 `blackrimmedlol-code/calorie-tracker`。

> `Asia/Shanghai` 是任务调度、页面展示、幂等比较和通知文字的唯一时区。美股交易日只用于判断是否休市，不作为第二套展示或调度时区。

## 写入规则

重点标的唯一排序常量：`TARGET_ORDER = ["DRAM", "LITE", "IREN", "BE", "SPCX", "MSTR"]`。动作板、快照、watchlist、分位、信号矩阵、复盘和中期账本只要同时出现这些标的，都必须按此顺序输出；市场基准可放在它们之前，BTC 等联动资产可放在之后。BE 不得被追加到末尾或因单源失败而整项省略。

1. 更新前先读取 `data.json`，保留其他三个时段、`sourceGroups`、`reviews`、`mediumLedger` 和未知字段。
2. 四个任务只替换各自对象：中国时间 21:05=`premarket`、23:05=`intraday`、02:05=`late`、04:05=`close`。每个时段都维护自己的 `horizons`、`macroFramework`、`expectationGaps` 与 `odds`。
3. 同步更新 `meta.updatedAt`、`meta.latestSession`、`meta.sessionDate`、`meta.nextUpdate`。
   `meta.schemaVersion` 固定为 `14`；后续契约升级必须同步提高版本号，页面遇到低于当前版本的可执行数据时只展示、不开放新增风险权限。
4. 不可靠的具体数字填 `null`，不得编造价格、指标或来源；周期方向可以依据真实 OHLC 聚合或结构推断，但必须在 `timeframeMethods` 和 `timeframeNotes` 说明方法与证据。
5. `snapshot` 固定 10 项，顺序为 SPY、QQQ、SOXX、DRAM、LITE、IREN、BE、SPCX、MSTR、BTC；股票/ETF 默认写正式时段最新价，不能把盘后价伪装成正式收盘。延长交易统一写入 `extendedHours`。
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
| `late` | 中国时间 02:05 | 检查午后延续/反转、量价和关键位 | 当日 04:05 |
| `close` | 中国时间 04:05 | 用完整日线最终收口、更新复盘 | 下一个交易日 21:05 |

- 每个时段必须写 `available:true / updatedAt / updateStatus / sessionContext`。未生成的时段写 `available:false`，页面会禁用，不能借用其他时段快照伪装成有效数据。
- `updateStatus` 使用 `按时更新 / 延迟补跑 / 数据不完整`。实际执行时间偏离名义时点时必须写清楚，不能只保留名义标签。
- 每个时段写 `deltaLabel` 和 `changes`，固定覆盖市场、DRAM、LITE、IREN、BE、SPCX、MSTR。字段：`asset / from / to / reason / tone / material / impactFields`。
  - `material:true` 仅限改变 `regimeCode / planStatus / tradeType / permissions / trigger / invalidation / confidence` 的行动级变化；页面只展开这些项目。
  - 未改变行动的量价延续仍可保存在 `changes` 中，但必须写 `material:false / impactFields:[]`，页面会合并为“已收起 N 项非行动级变化”。
  - 不得为了填满七格把普通新闻或微小价格波动标为行动级变化。

## v14 决策有效性契约

### 稳定状态与自由说明分离

- `short.planStatus` 只能使用本文枚举；原始细节放入 `short.stateNote`。例如“延续但联动不完整”应写为 `planStatus:"部分确认" / stateNote:"延续但联动不完整"`。
- `short.tradeType` 只能使用本文枚举；具体形态放入 `short.setupLabel`。例如“供给吸收验证”应写为 `tradeType:"短线事件交易" / setupLabel:"供给吸收验证"`。
- 自动任务写入前必须执行等价于 `node validate-data.mjs data.json` 的校验。枚举、排序或必要字段不合规时不得静默写入；无法及时修复则将 `updateStatus` 写为“数据不完整”。

### 数据锁权 `decisionGate`

每个可用 session 必须包含：

- `quoteAsOf`：用于当前判断的最新正式行情 ISO 时间；
- `validUntil`：本时段行动权限的截止 ISO 时间，通常衔接下一名义更新；
- `sourceConflict`：关键报价或 OHLC 是否仍有未解决冲突；
- `volumeComplete / closeFinal`：量能是否完整、日线是否已正式收口；
- `status`：`open | caution | locked`；
- `note`：数据边界与锁权原因。

页面在以下任一情况自动把“新增风险”降为仅观察，并关闭追价、隔夜与 beta：`validUntil` 已过、`updateStatus` 为“数据不完整”、schema 校验失败、`sourceConflict:true` 或 `status:"locked"`。锁权只限制行动，不删除历史研究内容。

### 事件倒计时 `eventCalendar`

每个 session 维护经过来源确认的未来事件数组；没有事件时允许空数组。字段：

- `id / label / eventDate`，有可靠具体时点时再写 `startsAt`；
- `affectedAssets`：可包含 `MARKET` 或六个固定标的；
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

每个可用时段应尽量维护 `extendedHours`，标的顺序固定为 DRAM、LITE、IREN、BE、SPCX、MSTR。每条包含：

- `symbol / session / price / regularClose / changePct / tone`；
- `asOf / status / source / sourceUrl`；
- `state / note / nextConfirmation`。

延长交易必须分清三个口径；所有 `asOf`、说明文字和页面标签统一写中国时间：

- `盘后`：正式收盘后的连续盘后阶段，可使用统一可审计的交易所/UTP/Cboe/S&P Global 报价；
- `夜盘`：盘后结束至盘前开始的经纪商或替代交易系统时段，只有同时写清提供商、成交时点和报价状态时才能展示；
- `盘前`：正式开盘前的盘前阶段，必须与前一晚盘后锚点分开。

不得把已经结束的盘后报价继续标成“当前夜盘价”，也不得把单一经纪商的稀疏打印当成全市场统一价格。没有可审计夜盘价时，保留最近可验证盘后锚点并写清边界；价格地图可用 `status:"verified"` 的最新延长交易价，但标题必须显示对应 session。盘后/夜盘突破只能提高下一正式时段的确认优先级，不能单独升级为完整交易信号。

DRAM、LITE、IREN、BE、SPCX、MSTR 的 watchlist 项必须额外写，并按 `TARGET_ORDER` 排序：

- `priceStatus`：例如 `盘中价 · 中国时间 23:05`、`收盘价 · 中国时间 04:05`；
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

每个时段的 `horizons` 固定包含 `MARKET / DRAM / LITE / IREN / BE / SPCX / MSTR`，每个对象分别包含：

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
- 新基金不足 252 个交易日时，不得把上市以来样本冒充 252 日。只有能从发行文件确认核心持仓、且成份股有完整日线时，才允许输出显式标记 `proxy:true` 的核心持仓代理；同时保留基金自身上市以来的样本数与分位；
- SPCX 存在代码换主：旧的 SPAC and New Issue ETF 已于 2026-04-07 改为 SPCK，SpaceX 自 2026-06-12 才以 SPCX 上市。SPCX 的历史序列必须从 2026-06-12 重启，剔除旧 ETF 以及 IPO 前无成交的占位记录。样本不足 60/252 时仍可展示“上市后位置”，但必须写 `sampleNote` 和真实 `sampleSize`，不得把 47 根样本包装成完整窗口；
- 只有进入前/后 10%，同时出现新催化，并被反转或突破确认，才升级为交易信号。

## 五周期规则

DRAM、LITE、IREN、BE、SPCX、MSTR 固定写入 `15m / 30m / 1h / 4h / 1d`，不得因为某个平台没有现成 4h 图而跳过。

- 15m、30m、1h：优先直接读取对应 K 线。
- 4h：优先直接 4h K 线；其次聚合连续四根 1h K 线；再其次结合小时结构、当日 OHLC 和前 3–5 个交易日日线判断。
- 1d：使用日线 OHLC，并参考最近 5–20 个交易日的高低点、收盘位置、均线或结构。
- 若使用聚合或结构判断，不得虚构 RSI、MACD、EMA 等未实际取得的数值。

`timeframeMethods` 枚举：

- `direct`：直接周期行情
- `aggregate`：低周期 OHLC 聚合
- `structure`：多日/多周期结构推断
- `daily`：日线 OHLC

页面证据权重必须与方法匹配：`structure` 是同一批多日/多周期信息的结构推断，不得与 `direct / aggregate` 一样呈现为多份独立确认。当 15m、30m、1h、4h 全部为 `structure` 时，页面合并为一个“短线结构推断”，只把 1d 作为另一份独立证据；数据层仍保留完整五字段以便审计。

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
- 复盘资产顺序固定为市场、DRAM、LITE、IREN、BE、SPCX、MSTR。首次加入而没有上期判断时标为“新基线”，不倒填胜负；从下一有效时段起必须正常复核。
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
- 市场、DRAM、LITE、IREN、BE、SPCX、MSTR 的 `changes` 完整，六个重点标的严格按 `TARGET_ORDER` 排序；每个数据模块都有实际时点和状态标签。
- `regime` 首段是可独立阅读的短标题，`largestChange` 已填写；`MARKET.short.trigger / invalidation` 分别能作为下一确认与总体失效条件。
- `meta.schemaVersion` 为 14；每个可用时段都有合法 `regimeCode / breadthState / decisionGate / eventCalendar`，所有枚举通过 `validate-data.mjs`。
- `changes` 七项均显式标明 `material / impactFields`；页面展开行动级变化、收起普通延续。
- DRAM、LITE、IREN、BE、SPCX、MSTR 同时具有 `supportValue / resistanceValue / priceStatus`，距离计算方向正确。
- `extendedHours` 如存在，严格按 `TARGET_ORDER`，正式收盘与盘后/夜盘不混写；每条都有 session、时点、状态和来源，页面关键位距离采用的价格口径可见。
- 四时段的 `nextUpdate` 按中国时间 21:05 → 23:05 → 02:05 → 04:05 连续衔接。
- 盘中版必须复核中国时间 21:05 盘前判断，不得只是重复新闻。
- DRAM/LITE/IREN/BE/SPCX/MSTR 五周期字段完整，4h 与 1d 有方法和证据说明。
- 每个可用时段的 `aiCapitalCycle` 严格包含需求强度、单位经济、产能兑现、融资质量、价格确认五项及 `overbuild`；每项都有失效条件，过建状态不使用单一股价或无来源估算升级。
- DRAM/LITE/IREN/BE 的 `demandLoop` 严格为五步基本面兑现链，不再混入同业与价格确认；SPCX/MSTR 不为完整性硬凑 AI 链条。
- `MARKET / DRAM / LITE / IREN / BE / SPCX / MSTR` 的短线与中期字段完整，触发和失效不能互相矛盾。
- 六个操作对象都具有 `planStatus / tradeType / confirmations.price / confirmations.volume / confirmations.linkage`；剧本失败必须同步降权，交易类型不能因被套而漂移；确认灯没有证据时使用 `unknown`。
- 四个宏观支柱、至少两条因果链与预期差板块有真实证据；没有事件时允许空数组，不能凑数。
- 60/252 日价格位置分位必须能追溯到真实日线、日期和样本数；代理必须标明成份、权重口径和基金自身可用样本，不得与实际基金历史混写。
- DRAM 的消息—价格一致性、LITE 的公司—光通信链确认、IREN 的 BTC/矿企—AI数据中心双链验证、BE 的数据中心电力需求—合同—部署—利润/现金流闭环、SPCX 的上市后量价与代码换主隔离、MSTR 的 BTC-MSTR 背离必须进入 `verdict` 或 `priceAction`。
- 复盘区包含至少一个明确的模型调整；`mediumLedger` 只有证据变化时才更新，不输出小样本伪精度。
- `decisionLedger` 对同一剧本只维护一个 `callId`；未触发与未完成评估的记录不进入胜率或收益统计，少于 20 个可比已结样本不展示绩效结论。
- `decisionLedger` 生命周期时间戳与状态严格自洽；开放判断不夹带旧触发时间，失败剧本不保持开放状态。
- `news` 每条均有 `material / impactFields / directness / impact / tone`；页面行动证据只展示 `material:true`，背景信息默认折叠。
- 五周期的 `timeframeMethods` 与页面证据权重一致：结构推断不会被包装成四份独立 K 线确认。
- 分位为空、样本不足或使用代理时，标签分别显示“待计算 / 可用 N 日 / 代理”，不误标完整 ACTUAL。
- 页面只用于信息整理，不输出确定性买卖建议。
