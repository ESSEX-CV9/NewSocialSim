# NPC 状态机扩展设计

## 设计意图

将 NPC 从无记忆的概率掷骰机升级为有内态的角色。内态全部数值化（mood / 关系图 / 短记忆 / 当前活动），零 LLM 维护。行为决策由 tick 引擎读这些内态产出。不改动 HTTP API，只重做 simulator 内部的决策依据。

在 playback 模型下，剧本帖与关键节拍仍由编辑器/LLM 预填，运行时 NPC 是被 playback 驱动的角色：剧本规定"何时何人发何内容"，状态机决定"用什么语气发、是否触发后续连锁、有没有人接茬"。

状态机是贯穿所有非真人账号的底座：mood / 关系 / 记忆 / 活动这些数值对纯 LLM、半 LLM、纯模拟器账号一律照常维护，账号的驱动模式只决定谁消费这些数值来产出动作——纯模拟器账号由 tick 引擎读数值直接产出内容与互动；半 LLM 账号由引擎产出互动、内容交 LLM（LLM 也读得到这些数值）；纯 LLM 账号由 LLM 读数值产出内容与互动、引擎只维护数值不替它行动；一次性氛围号不维护这些数值。账号驱动模型详见 `docs/m5-account-model.md`。

## NPC 数据三层与存储

一个 NPC 由三层构成，各自服务不同消费者、各有其家：

| 层 | 服务对象 | 内容 | 存储 |
|---|---|---|---|
| 身份层 | 网站（所有人可见） | handle / 昵称 / 头像 / 横幅 / 简介 / 认证 / 地区 | users 表 + 媒体库，与真人账号完全一致 |
| 数值层 | tick 引擎（零 LLM） | 下文五层（Alignment / Persona / 订阅 / Mood / 关系-记忆-注意-活动） | 见下"文件与 DB 分工" |
| RP 资料层 | LLM（仅 LLM 介入时读） | 性格 / 背景 / 口癖 / 关系叙事 + 自由设定 | 见"RP 资料层"一节 |

身份层就是账号本身，不属于"档案"——头像横幅走普通用户资料与媒体那套。

### 一 NPC 一文件夹

详细 NPC 内容量大，按每个 NPC 一个文件夹组织，不挤在单一全局文件里：

```
data/worlds/<id>/npcs/<handle>/
  numbers.json     # 数值层的作者基线（事实依据）
  rp.json          # 结构化 RP（性格/背景/口癖/关系叙事）
  lore.md          # 自由设定（可选每次塞入 / 让 LLM 按需取）
  pool/            # 该 NPC 的私有说话池
  media/           # 该 NPC 的优先媒体池
```

### 文件与 DB 分工

NPC 数值层与运行时态进**模拟器独占的 NPC 状态库 `data/worlds/<id>/npc-state.db`**（WAL 模式），不进社交站 `world.db`——`world.db` 只装真人也会有的数据（账号 / 帖 / 互动），mood / 关系 / memory / activity 这类操控 NPC 的内部机关不属于社交站，见 `docs/m5-x-re-plan.md`「分库原则」。

- **文件为准、DB 为副本**：作者写的静态数值（Alignment / Persona / 概率 / 活跃时段 / 关系基线 / 阶段定义）以 NPC 文件夹的文件为唯一真相源，开世界时灌进 `npc-state.db` 作运行时副本。
- **运行时态进 DB**：模拟跑出来的动态值（Mood / 当前关系好感与熟悉度 / Memory / Activity）只活在 `npc-state.db`，高频写、可查询，重启靠 gap mitigation 恢复，不用 JSON 整文件重写。
- **编辑器可改两处**：改"基本起始数据"写回文件（再灌 `npc-state.db`）；改"当前实时数据"直接写 `npc-state.db`（GM 式手动拨动当前情绪/关系，不动作者基线，之后按衰减自然回归）。

`npc-state.db` 与 `world.db` 同处世界文件夹、随之迁移，DB 化不损可移植性；文件留作可手编、可 git diff 的事实依据。

## RP 资料层

RP 资料是 LLM 扮演该 NPC 时读的材料，分两块：

- **结构化必读**（`rp.json`）：性格 / 背景 / 口癖 / 关系叙事。扮演必看，结构化便于提示词组装，每次进上下文，属稳定前缀（缓存友好）。
- **自由设定**（`lore.md`）：作者随意写的设定文本，不固定。配开关——"每次塞入"或"让 LLM 用工具按需取"（同设计的"索引卡常驻 + agentic 检索"，缩到单 NPC 尺度）。

RP 资料层只在 LLM 介入时消费；确定性 tick 层不读它。先确定性阶段，rp.json / lore.md 由作者预写、引擎暂不消费，待行为的 LLM 阶段接入。

## 五层架构

NPC 数据模型由宏观到微观分五层（数值层的细分）。每层可由上层 derive 出来，也允许作者在任意层手动覆盖。

```
Layer 1：Alignment 双轴（2 数字）          作者锚定形象的入口
   ↓ derive
Layer 2：Persona Traits（~8 数字）          性格细粒度
   ↓ 配合作者自填 factions / poolAffinities
Layer 3：Pool Subscriptions                 内容素材接入点
   ↓
Layer 4：Mood（5 维 runtime）               当下情绪态
   ↓
Layer 5：Activity / Memory / Attention      当下行为态
```

Layer 1–3 为静态人设层，属作者基线，源在 NPC 文件夹、灌进 `npc-state.db` 作副本。Layer 4–5 为运行时状态层，只活在 `npc-state.db`（持久化与恢复见后文）。

## Layer 1：Alignment 双轴

### 数值定义

```
lawfulness:  -100 (混乱) ━━━━━━━━━┃━━━━━━━━━ +100 (守序)
morality:    -100 (邪恶) ━━━━━━━━━┃━━━━━━━━━ +100 (善良)
```

底层连续，UI 双模式：九宫格快速选 + slider 精调。

### 九宫格 → 互联网形象映射

| | 守序 | 中立 | 混乱 |
|---|---|---|---|
| **善良** | 正能量博主 / 专家科普 / 劝架者 | 关爱型 / 夸夸群 / 知心姐姐 | 仗义喷子 / 为弱者出头 |
| **中立** | 法律博主 / 考据党 / "按规则说" | 普通路人 / 灌水 / 看热闹 | 乐子人 / 抽象画手 / 玩梗机器 |
| **邪恶** | 阴阳怪气键政 / "按理来说应该…" | 卖课的 / 流量贩子 / 自捧踩人 | 纯喷子 / 杠精 / 人身攻击 |

### 九宫格 jitter

点击九宫格某格时，引擎将 alignment 实际值设为该格中心 ± `tuning.alignment.gridCellHalfSize` 内的随机偏移。默认半径 25，即"守序善良"实际落点为 `(lawfulness ∈ [50, 100], morality ∈ [50, 100])` 内随机。

批量建号时引擎使用 Halton 序列在格内分散布点，避免同 alignment 的一批 NPC 派生出相近数值。

### 派生规则

Alignment 不直接驱动行为，而是 derive 出 Persona Traits 与 Pool Intent Bias。派生公式全部存于 `tuning.alignment.derive` 与 `tuning.alignment.poolIntentBias`，运行时由 `TuningService.evalDerive(rule, ctx)` 求值。

默认派生示例（具体系数在 tuning 配置）：

```
combativeness = base + lawfulness × wL + morality × wM
chaosSeeking  = base + lawfulness × wL'
slangDensity  = base + lawfulness × wL''
```

派生结果可被作者在 Persona Traits 层手动覆盖。覆盖后该项不再随 alignment 变化。

## Layer 2：Persona Traits

静态人格调速器，作为 mood 变化的速率/方向系数。完整清单：

| Trait | 范围 | 含义 |
|---|---|---|
| `combativeness` | 0–100 | 易撕逼度，影响 volatility 增量与 Beefing 进入概率 |
| `partisanship` | 0–100 | 站队倾向，影响撕逼蔓延 join_score |
| `chaosSeeking` | 0–100 | 主动找事倾向，放大 boredom 触发 |
| `slangDensity` | 0–1 | 池子组合修饰概率，黑话浓度 |
| `egoSize` | 0–100 | 自我评价基线，影响 confidence baseline |
| `insecurity` | 0–100 | 被怼/被无视时 valence 跌幅放大倍率 |
| `socialNeed` | 0–100 | energy 下限，影响潜水阈值 |
| `attentionSpan` | 0–100 | 话题厌倦衰减率的反向系数 |

每项必须有 baseline 值，运行时不变。

## Layer 3：Pool Subscriptions

NPC 通过 factions（阵营列表）与 poolAffinities（权重表）订阅内容池。详见后文"内容池架构"一节。

## Layer 4：Mood（5 维 runtime）

### 维度定义

| 维度 | 范围 | 影响 |
|---|---|---|
| `energy` | 0–100 | 发帖频率、回复延迟、是否上线 |
| `valence` | -100 ~ +100 | 选语气子池（正面 / 平淡 / 负面） |
| `volatility` | 0–100 | 易燃度，进 Beefing 阈值 |
| `boredom` | 0–100 | 无聊度，驱动主动找事 |
| `confidence` | 0–100 | 自我评价，决定是否挑战大 V / 被怼后反击 vs 退缩 |

### 衰减

每个 mood 维度按 sim 时间向 baseline 线性回归。衰减率存 `tuning.mood.decayPerSimMinute.<dim>`。

baseline 来源：
- `energy` baseline = `persona.socialNeed × 0.7 + 30`
- `valence` baseline = 0（中性）
- `volatility` baseline = `100 - persona.combativeness × 0.5`
- `boredom` baseline = `30 + persona.chaosSeeking × 0.3`
- `confidence` baseline = `persona.egoSize`

baseline 计算式存 `tuning.mood.baseline`。

### 事件触发

引擎内部 EventBus 派发的事件按 `tuning.events.<eventType>` 表查瞬时增减并应用。事件清单包含但不限于：

| 事件 | 默认效果 |
|---|---|
| `ownPostLiked` | valence +1, energy +1 |
| `ownPostReplied(friendly)` | valence +3, energy +2 |
| `ownPostReplied(hostile)` | valence -5, volatility +8 |
| `ownPostQuoted(mocking)` | valence -8, volatility +12, confidence -3 |
| `ownPostDead` | valence -3（自帖 N 分钟内零互动触发） |
| `ownPostDunked` | valence -10, confidence -5, energy -3 |
| `celebrityRepliedToMe` | valence +15, energy +20, confidence +10 |
| `gotFollowed` | valence +2, confidence +1 |
| `gotUnfollowed` | valence -3, confidence -2 |

所有事件的影响系数必须从 tuning 表读取，不允许写死。

`insecurity` trait 作为 valence 类事件的乘数：`actualValenceDelta = baseDelta × (1 + persona.insecurity × 0.01)`。

## Layer 5：Relationship / Memory / Attention / Activity

### RelationshipComponent

稀疏映射 `Map<userId, Edge>`：

```typescript
interface Edge {
  affinity: number;          // -100..+100，对此人的好感
  salience: number;          // 0..1，此人在认知中的占位
  lastInteractedAt: number;  // sim time
  tag?: 'friend' | 'rival' | 'crush' | 'idol' | 'nuisance';  // 运行时 derive
}
```

`salience` 按 sim 时间衰减，互动事件刷新顶峰。衰减率与互动加权存 `tuning.relationship`。

`tag` 由 RelationshipSystem 按 affinity × salience × 互动模式派生，作为池子选择时的过滤 key（"对 rival 说的话" vs "对 friend 说的话"用不同子池）。

绝大多数 NPC 互相为默认值（不入 map）。仅交互过的关系惰性建立，存储成本可控。

### 关系的叙事面与阶段化

关系是一条边、两张脸：上文 `Edge` 是**数值面**（运行时，存 DB）；另有作者写的**叙事面**（存 NPC 文件，喂 LLM）。二者天然挂钩——同一条 A→B 边。

叙事面不是一段死文本，而是**阶段化**：作者按"好感 × 熟悉度"阈值划若干阶段，每阶段一份内容。运行时引擎读 A→B 当前数值、命中阶段、用该阶段内容。每个阶段携带：

```typescript
interface RelationshipStage {
  condition: { affinity?: [number, number]; salience?: [number, number] };  // 命中区间
  // 确定性偏置（本阶段先用）：默认按语气标签选片段，重要关系可指名子池覆盖
  bias: {
    toneTag?: 'hostile' | 'cold' | 'neutral' | 'warm' | 'intimate';  // 默认 A：偏好此语气标签的片段
    intentBias?: Record<string, number>;                             // 把 intent 分布往某些意图偏
    pool?: string;                                                   // 可选 B：直接指名子池/私有池
  };
  narrativePrompt?: string;  // 叙事面（LLM 阶段消费，先存不读）
}
```

确定性内容选择据此对**有目标的动作**（回复 / 引用 / 掺和撕逼）生效：A 对 B 动作时，命中阶段的 `bias` 接进 ECS 池选择——优先该语气标签的片段、按 intentBias 偏移意图，与 A 自身 persona/mood 叠加。**随手发的顶层帖与具体某人无关，关系阶段不参与**，故关系阶段主要在回复里程碑发挥。

阶段须设**滞回**：进某阶段与退出用不同阈值（如进"和解"好感≥50、退出须跌破 40），避免数值卡在边界来回横跳致关系精神分裂。阈值与缓冲存 `tuning.relationship`。

关系弧可做**可复用模板**（对头弧 / 师徒弧 / 暗恋弧，各含多阶段），套到某对 NPC 后允许单独覆盖某阶段——颗粒度交给作者：重要关系手写，一般关系套模板。

### MemoryComponent

环形短队列，最近 N 条影响过自己的事件 id + 类型 + sim 时间戳：

```typescript
type MemoryEntry =
  | { type: 'liked_received', postId, from, at }
  | { type: 'reply_received', postId, from, sentiment: 'friendly'|'hostile'|'neutral', at }
  | { type: 'own_post_dead', postId, ageMs, at }
  | { type: 'topic_seen_again', topicId, count, at }
  | { type: 'dm_unanswered', from, ageMs, at }
  | { type: 'beef_witnessed', between: [a, b], at };
```

队列长度上限存 `tuning.memory.maxEntries`，默认 20。条目按 sim 时间过期，过期后清除。

只存事件 id 与分类，不存内容文本。

### AttentionComponent

可选指针：

```typescript
interface Attention {
  kind: 'post' | 'user' | 'topic' | null;
  id: string;
  ttl: number;  // sim time absolute
}
```

InThread 与 Beefing 状态下不为空，决定 NPC 每 tick 看什么（不刷时间线，刷指定串/指定人）。

### ActivityComponent

当前 FSM 状态、进入时间、附加数据：

```typescript
interface Activity {
  state: 'Offline'|'Lurking'|'Browsing'|'Composing'|'InThread'|'Beefing'|'Hyped'|'Tilted';
  enteredAt: number;        // sim time
  payload?: { targetPostId?, targetUserId?, draft? };
}
```

详见下一节。

## Activity FSM

### 状态图

```
                ┌────────────┐
                │  Offline   │
                └─────┬──────┘
                      │ 活跃时段开始
                      ▼
            ┌─────────────────┐
            │     Lurking     │  低能耗潜水
            └────────┬────────┘
                     │ energy 充足、距上次互动够久
                     ▼
        ┌────────────────────────┐
   ┌────│       Browsing         │────┐
   │    └────────────────────────┘    │
   │            │           │         │
   │ 兴趣命中×salience      触发发帖   │
   │ ×mood 适配             条件      │
   │            ▼           ▼         │
   │  ┌──────────────┐ ┌──────────┐   │
   │  │ InThread(p)  │ │Composing │   │
   │  └──────┬───────┘ └────┬─────┘   │
   │         │              │         │
   │  被挑衅/自被怼          发帖完成   │
   │         ▼              │         │
   │  ┌──────────────┐      │         │
   │  │ Beefing(u)   │      │         │
   │  └──┬────────┬──┘      │         │
   │     │        │         │         │
   │  失势        得势       │         │
   │     ▼        ▼         ▼         │
   │ ┌──────┐ ┌───────┐ ┌───────┐     │
   │ │Tilted│ │ Hyped │←┘Hyped │      │
   │ └──┬───┘ └───┬───┘ └───────┘     │
   │    │        │                    │
   │    │        └─────────→──────────┘
   └────┴────→ Lurking / Offline ←─── (任何状态遇活跃时段结束 → Offline)
```

### 状态语义

| 状态 | 进入条件 | tick 行为 | 退出条件 |
|---|---|---|---|
| `Offline` | 活跃时段外 / 主动摔门 | 不轮询、不出现 | 活跃时段到 |
| `Lurking` | 上线但无动力 | 极低概率上调 mood 后退出 | mood 达 Browsing 阈值 / 活跃时段结束 |
| `Browsing` | energy 足且冷却完 | 拉时间线、按兴趣 × salience × mood 评估候选 | 发帖触发 / 找到串 / energy 耗尽 |
| `Composing` | 发帖触发条件满足 | N tick 内组装文本，到点发出 | 发帖完成 |
| `InThread(p)` | 在 Browsing 时看到撩到自己的帖 | 不刷时间线，刷该串新回复 | 该串冷却 / 自己被挑衅升级 / timeout |
| `Beefing(u)` | InThread 中被对方挑衅 / 自帖被对方怼 | attention 钉对方，必回对方新帖、冷处理对方同盟 | 输（valence 见底）/ 赢（对方退出）/ timeout |
| `Hyped` | 自帖爆 / 被名人回 / 撕赢 | 发帖频率 × 2、引用对应触发源概率激增 | timeout |
| `Tilted` | 撕输 / 被多人围攻 | 抽"丧"/"阴阳"子池、概率直接 Offline 摔门 | timeout / Offline |

所有转移条件的阈值、概率、timeout 时长均存 `tuning.activity.transitions` 与 `tuning.activity.stateMaxDuration`。

PostingSystem 与 InteractionSystem 改造为读 ActivityComponent 派活：同一概率事件在不同状态下走不同分支（Beefing 状态发帖优先 quote 对手、InThread 状态发帖优先 reply 串中现有成员）。

## 撕逼蔓延

A 与 B 进入 Beefing 时，引擎广播 `beef_started(a, b, postId)` 事件。事件被定向至"观众池"——三源混合：

| 源 | 默认权重 |
|---|---|
| 当前在 `InThread(postId)` 中盯着这场撕逼的 NPC | 0.5 |
| A 与 B 的粉丝交集 | 0.3 |
| 同话题关注者 | 0.2 |

权重存 `tuning.beefSpread.audienceSources`。

对每个观众 C 计算 join_score：

```
join_score = base
  + relationship[A].affinity × wAff_A
  - relationship[B].affinity × wAff_B
  + mood.boredom × persona.chaosSeeking × wBor
  + persona.partisanship × abs(rel[A].aff - rel[B].aff) × wPart
  - already_in_beef_count × wPenalty
```

加入概率：

```
P(join) = sigmoid(join_score / tuning.beefSpread.sigmoidTemperature)
```

不设硬阈值。`sigmoidTemperature` 控制随机性强度——低温度近确定性、高温度更随机。

C 加入后进入 `Beefing(B)`，自身也广播 `beef_started`，但**蔓延限 2 跳**：第 2 跳加入者不再广播，避免雪崩。最大跳数存 `tuning.beefSpread.maxHops`。

## 话题厌倦

MemorySystem 维护 `topicSeenCount: Map<topicId, { count, lastSeenAt }>`：

- 每次 NPC 的 timeline 撞到该话题 → count += 1, lastSeenAt 刷新
- 按 sim 时间衰减：`count -= elapsedMin × tuning.topicSaturation.seenDecayPerMinute`

PostingSystem / InteractionSystem 在选话题与决定是否对该话题帖互动时拿 saturation 当负权重：

```
saturation = max(0, count - threshold) × (1 - persona.attentionSpan × 0.01)
topicWeight *= 1 - saturation × tuning.topicSaturation.suppressionFactor
```

当 `count` 超过 `tuning.topicSaturation.metaSnarkTriggerThreshold` 时，NPC 有概率触发 `intent=meta-snark` 子池发一条元吐槽（"这话题怎么还在刷"）。

`persona.attentionSpan` 高的 NPC saturation 增长慢——耐心好的人反复看同话题不会烦。

## 内容池架构

内容池不存完整整句，存可组装的片段，组织方式与模拟器 ECS 同构：组件类型（Component，自带候选片段）→ 语法（Archetype，有序引用一批组件类型）→ 池（维度 + 引用哪几套语法）。生成一条内容 = 按池选一套语法，逐组件各取一个片段填充，再解析占位符。组件类型库与语法库均为可跨池复用的注册表，按"全局共享 / 世界级"两层存放（全局层入 git）。

### 三类池

| 类别 | 例 | 存放 | 维护频率 |
|---|---|---|---|
| **基础原子池**（全局共享） | 黑话 6 字、通用情绪词、夸夸 | `data/global-pools/`（入 git） | 写一次永用 |
| **场景特化池**（世界级） | coser 赞美、二游讨论、舟原战、美食 | `data/worlds/<id>/scene-pools/<name>.json` | 作者按世界口味写/导入 |
| **话题专属池**（临时） | "X 公司财报暴雷"评论 | `data/worlds/<id>/topic-pools/<topicId>.json` | LLM 按当前话题补水生成，话题退潮即作废 |

### 三层结构

| 层 | ECS 对应 | 定义 |
|---|---|---|
| 组件类型 | Component | 作者自由定义的可复用槽位种类，自带候选片段库；片段可挂可选过滤 / 权重标签（见下） |
| 语法 | Archetype（实体组装式） | 有序引用一批组件类型 = 一种句式骨架；每个引用可标可选或按概率出现 |
| 池 | spawn 规格 | 由维度定义（`形态` / `模式` / 作品等），声明用哪几套语法及权重 |

**槽位平等**：语法中每个槽都是平级组件，无 opener / body / tail 之类内建特权角色；顺序只决定文本左右位置。语法引用具体组件类型还是更通用的组件类型，纯由作者按需要的颗粒度决定，不是引擎层的不同机制。

`形态`（standalone / reply / quote / interjection）与粗粒度意图 `模式`（attack / mock / support / earnest / meta-snark 等）是池的维度。组合修饰（前缀 / 后缀黑话）由语法里的可选前置 / 后置槽承担，是语法结构而非片段级开关。

### 片段标签

组件类型的候选片段可挂以下可选标签，供选择算法做过滤与加权（缺省 = 任意）：

```typescript
interface Fragment {
  text: string;                  // 可含占位符 {slang} / {target_faction:贬} / {pos_word}
  speakerFaction?: string[];     // 仅当说话人 factions 命中其一时可选
  targetFaction?: string[];      // 仅当互动目标 factions 命中其一时可选（Beefing 必对上）
  preferredAlignment?: { lawfulness?: number; morality?: number; tolerance?: number };  // 软权重
  topics?: string[];             // 仅在这些话题语境触发
  register?: 'slang' | 'casual' | 'formal';
  energyLevel?: 'low' | 'mid' | 'high';
}
```

### NPC 订阅

人设档案的 Layer 3 配置：

```jsonc
{
  "factions": ["二游玩家", "明日方舟玩家", "前端"],
  "poolAffinities": {
    "universal-slang": 0.9,
    "coser-praise": 0.0,
    "舟原战": 1.0,
    "美食": 0.3
  }
}
```

NPC 一旦 factions 命中某片段的 `speakerFaction`，即有资格抽到该片段。`poolAffinities` 提供细粒度偏好——同一二游玩家可"不爱掺和舟原战但爱聊 FGO"。

派系（faction）是世界级注册表：每个世界维护自己的 faction 列表，新建 NPC 时从列表选。跨世界的派系靠映射链接（"原神玩家"在 A 世界对应 X faction id、在 B 世界对应 Y，映射到同一基础组件）。

### 占位符即内联组件引用

片段文本内的 `{key}` / `{key:variant}` 占位符就是在该位置内联取一个组件的值——与槽位同一机制的两种位置（槽位为位置式、占位符为内联式）。引擎解析时按下表填充：

| 占位符 | 来源 |
|---|---|
| `{slang}` | 通用黑话组件中 shape=interjection 的片段随机抽 |
| `{target_faction}` | 当前互动目标的 factions 列表抽一 |
| `{target_faction:贬}` | 同上但带 `variant=贬` 的 faction 别名（如"原神"→"原批"） |
| `{target_faction:中}` | 中性别名 |
| `{target_faction:雅}` | 文雅别名 |
| `{pos_word}` / `{neg_word}` | 通用褒贬词组件 |

faction 的多 variant 别名存于派系注册表，每个 faction 可登记多种称呼。

占位符填不到匹配项时，引擎丢弃该候选片段重抽，不输出病句。

### 选择算法

NPC 触发"发帖/回复"事件，意图为 `模式`（由 activity + mood 决定，即粗粒度 intent）：

1. **选候选池**：维度匹配当前 `shape` 与 `模式`，来源 = 基础原子池 ∪ NPC.factions 命中的场景池 ∪ 当前 active 话题对应的话题池。
2. **选语法**：从候选池声明的语法中按 `poolAffinity` × 语法权重加权抽一套；必填组件无可用片段的语法剔除。
3. **逐组件填片段**：对语法每个槽，过滤其组件类型的候选片段——
   - `speakerFaction` 含 NPC 某 faction（或为空）
   - `targetFaction` 兼容（Beefing 时必须对上目标 faction）
   - `topics` 兼容
   - 占位符可解析

   再加权抽一个：
   ```
   weight = alignmentMatchFactor(fragment, NPC)     // 1.5 / 1.0 / 0.6
          × noveltyFactor(fragment, NPC.memory)      // 最近用过的打折
          × topicRelevance(fragment, currentTopic)
   ```
4. **可选槽判定**：标 `optional` 或 `prob`（如收尾黑话槽 `prob = slangDensity`）的槽独立判定是否出现。
5. **占位符（内联组件）解析**。

所有 weight 系数存 `tuning.pools`。

### 工作示例

场景：alice (factions=["二游","原神"], lawfulness=-60, morality=-30) 嘲讽 bob (factions=["二游","明日方舟"]) 的舟玩家发言，activity=Beefing(bob), intent=mock。

选候选池（维度 模式=mock / 形态=reply）：舟原战池，其语法之一 `典中典式` 含一个嘲讽主体槽。

候选片段（经过滤）：
- `"急了急了，{target_faction:贬}典中典"`（舟原战）
- `"{target_faction}玩家又开始绷不住了"`（舟原战）
- `"乐"`（通用黑话组件）

抽中 `"急了急了，{target_faction:贬}典中典"`，`{target_faction:贬}` ← "方舟" 的贬称别名 = "舟批" → `"急了急了，舟批典中典"`。

slangDensity=0.7，再抽前缀："笑死" → 最终输出 `"笑死，急了急了，舟批典中典"`。

## 剧本与状态机协作

剧本帖支持"casting 表达式"，演员不写死：

```yaml
- actor:
    factions: ["二游"]
    alignment:
      lawfulness: [-100, -20]
      morality: [-100, 0]
  shape: post
  intent: mock
  content: "{target_faction:贬}玩家典中典"
  scheduledAt: 2026-06-15T20:00:00
```

引擎按约束在当前 NPC 池里筛选符合者；多个候选时按 alignment 中心距离 + 当前 mood 适配度加权抽一个；找不到合适演员的剧本帖写入"剧本未上演日志"供作者审视。

剧本可声明**期望前置状态**：

```yaml
- actor: "alice"
  preconditions:
    mood: { valence: { min: 30 } }
    activity: ["Hyped"]
```

引擎在剧本到点前若发现演员状态不符，可选行为：
- 注入触发性事件（让一个 NPC 来点赞 alice → 进 Hyped）以达成前置
- 等待自然到达
- 跳过此条剧本（作者预设的允许跳过开关决定）

剧本可声明**期望连锁**：

```yaml
- actor: "alice"
  expectedReactions:
    - by: "bob"
      activity: "Beefing"
      withinSimMs: 1800000
```

引擎按状态机判断 bob 是否会咬钩。不咬时跳过该期望连锁段，不强行插戏（避免"剧本要求 bob 反对但 bob 是 alice 铁粉"的违和）。

## 状态持久化与崩溃恢复

### 落盘策略

- 运行时态（mood / memory / activity / attention / 当前关系好感与熟悉度）写入模拟器独占的 `npc-state.db`（per-NPC 行），随互动事务或按 tick 批量提交，不用 JSON 整文件重写。
- 作者基线（静态数值 / 关系阶段定义 / RP 资料）以 NPC 文件夹文件为源，开世界灌进 `npc-state.db`；编辑器改基线写回文件、改实时态直接写 `npc-state.db`。
- DB 写按 SQLite 事务语义处理；基线文件写失败必须重试至少 3 次，仍失败需告警。

提交频率与重试次数存 `tuning.persistence`。

### 启动时 Gap Mitigation

进程启动后，对每个 NPC 计算 `gapMs = realNow - savedAt`，按 gap 应用：

1. **Mood 衰减一次性折算**：按 `gapMs` 等价的 sim 时间，套用 `tuning.mood.decayPerSimMinute` 计算从 savedAt 到当前的累计衰减
2. **Memory 过期清理**：超出 TTL 的条目清除
3. **Attention TTL**：`attention.ttl < now` 的清空
4. **Activity 不清**：Beefing 还是 Beefing、追串还是追串
5. **Activity 自然超时检查**：若 `enteredAt + tuning.activity.stateMaxDuration[state] < now`，则按状态正常退出流程退出

效果：
- 宕机 1 分钟：几乎无感
- 宕机 1 小时：mood 已大致回 baseline、记忆部分褪去、活动状态视超时设置决定是否还在
- 宕机 1 天：大部分活动状态自然超时退出，等价 NPC 自然休息了一天

崩溃恢复后世界连贯靠机制保证，不靠叙事合理化。

## Tuning 配置层

### 文件结构

```
data/global-config/
  defaults.json          全局默认，入 git，所有世界共享

data/worlds/<id>/
  tuning.json            世界级 override，不入 git，作者自调
```

加载时 deep-merge：world override 覆盖到 global default。未覆盖项使用默认。

### 命名空间

```jsonc
{
  "mood": {
    "decayPerSimMinute": { "energy": 1.0, "valence": 0.5, "volatility": 2.0, "boredom": 0.3, "confidence": 0.2 },
    "baseline": {
      "energy": "persona.socialNeed * 0.7 + 30",
      "valence": 0,
      "volatility": "100 - persona.combativeness * 0.5",
      "boredom": "30 + persona.chaosSeeking * 0.3",
      "confidence": "persona.egoSize"
    }
  },
  "events": {
    "ownPostLiked":            { "valence": 1, "energy": 1 },
    "ownPostReplied_friendly": { "valence": 3, "energy": 2 },
    "ownPostReplied_hostile":  { "valence": -5, "volatility": 8 },
    "ownPostDunked":           { "valence": -10, "confidence": -5 },
    "celebrityRepliedToMe":    { "valence": 15, "energy": 20, "confidence": 10 }
  },
  "alignment": {
    "gridCellHalfSize": 25,
    "derive": {
      "combativeness": { "base": 50, "lawfulness": -0.3, "morality": -0.4 },
      "partisanship":  { "base": 50, "morality": 0.2, "absLawfulness": 0.2 },
      "chaosSeeking":  { "base": 50, "lawfulness": -0.5 },
      "slangDensity":  { "base": 0.5, "lawfulness": -0.004 },
      "egoSize":       { "base": 50, "absMorality": 0.1, "lawfulness": -0.1 },
      "insecurity":    { "base": 50, "egoSize": -0.6 },
      "socialNeed":    { "base": 50, "morality": 0.2 },
      "attentionSpan": { "base": 50, "lawfulness": 0.3 }
    },
    "poolIntentBias": {
      "attack":     { "morality": -1.0, "lawfulness": -0.3 },
      "mock":       { "morality": -1.0, "lawfulness": -0.6 },
      "meta-snark": { "lawfulness": -1.2 },
      "earnest":    { "lawfulness": 0.8 },
      "support":    { "morality": 1.0 },
      "flex":       { "morality": -0.5 },
      "lament":     { "morality": -0.3, "lawfulness": 0.3 }
    }
  },
  "pools": {
    "alignmentMatchWeight":   { "match": 1.5, "neutral": 1.0, "mismatch": 0.6 },
    "noveltyWindowMs": 1800000,
    "noveltyPenalty": 0.4,
    "compositionByDensity": { "prefixProb": "slangDensity", "suffixProb": "slangDensity * 0.6" }
  },
  "activity": {
    "transitions": {
      "Lurking_to_Browsing":   { "baseProbPerTick": 0.05, "energyFactor": 0.01 },
      "Browsing_to_Composing": { "cooldownMs": 1800000, "baseProbPerTick": 0.02, "boredomFactor": 0.01 },
      "Browsing_to_InThread":  { "interestThreshold": 0.6 },
      "InThread_to_Beefing":   { "hostileTriggerCount": 1, "volatilityFactor": 0.5 }
    },
    "stateMaxDuration": {
      "Beefing":  1800000,
      "InThread": 1200000,
      "Hyped":    7200000,
      "Tilted":   3600000
    }
  },
  "beefSpread": {
    "audienceSources": { "threadOnlookers": 0.5, "fanIntersection": 0.3, "topicFollowers": 0.2 },
    "weights": { "wAff_A": 0.4, "wAff_B": 0.4, "wBor": 0.3, "wPart": 0.5, "wPenalty": 1.5, "base": -1.0 },
    "sigmoidTemperature": 1.0,
    "maxHops": 2
  },
  "cascade": {
    "depthMax": 3, "decayPerHop": 0.5, "delayMin": 60000, "delayMax": 600000
  },
  "topicSaturation": {
    "seenDecayPerMinute": 0.1,
    "threshold": 5,
    "metaSnarkTriggerThreshold": 8,
    "suppressionFactor": 0.15
  },
  "relationship": {
    "salienceDecayPerHour": 0.05,
    "interactionImpact": { "liked": { "affinity": 0.5, "salience": 0.05 }, "replied": { ... } }
  },
  "memory": {
    "maxEntries": 20,
    "ttlMs": 21600000
  },
  "persistence": {
    "moodDebounceMs": 30000, "dirtyPagesThreshold": 10, "retryCount": 3
  }
}
```

### TuningService 接口

```typescript
interface TuningService {
  get<T>(path: string): T;
  evalDerive(rule: DeriveRule, ctx: Record<string, number>): number;
  reload(): Promise<void>;
  onChange(cb: () => void): () => void;
}

interface DeriveRule {
  base: number;
  // 任意键名 → 系数；引擎按 ctx 中对应值乘以系数累加到 base
  // 特殊键名前缀 abs 表示取绝对值（如 absLawfulness）
  [coefficientKey: string]: number;
}
```

所有 System 构造时接收 `TuningService`，全部数值经 `tuning.get(...)` 或 `tuning.evalDerive(...)` 取得。不得在 .ts 文件中出现任何业务可调的 magic number。

### 编辑器 UI

编辑器新增 Tuning 面板：按命名空间分组，每项显示 default 值与 override 值，作者可逐项 override；reload 经 SSE 推送至 simulator 进程，无需重启。

## 实施子里程碑

总顺序：先 M5-X.0 立 Tuning 层，再 M5-X.1 / .2 / .3 / .4 依次叠加，最后回头迁移现有硬编码。每个子里程碑可独立验收"世界明显更不机械了"。

### M5-X.0：Tuning 配置层

- `data/global-config/defaults.json` 初稿入库
- `TuningService` 实现：加载、deep-merge、`get`、`evalDerive`、`reload`、`onChange`
- 编辑器 Tuning 面板（只读浏览先做、override 编辑可后置）
- 已有 simulator 的硬编码值（PostingSystem / InteractionSystem / CascadeSystem 的常量）迁移到 tuning，不留尾巴

### M5-X.1：Mood + Memory + 内容池 tag 扩

- `MoodComponent` / `MemoryComponent` + `MoodSystem` / `MemorySystem`
- 内部 EventBus
- 内容池三层 schema 落地（组件类型 / 语法 / 片段）：池维度含 `模式`(intent) / `形态`(shape)，片段挂 `preferredAlignment` 等标签，组合修饰用语法可选前后缀槽
- 现有 content-pools.json 数据按新 schema 补标（手动 + LLM 协助）
- PostingSystem 改造为读 mood + intent 选子池
- 可见效果：同一 NPC 同一天不同时刻发帖语气会变

### M5-X.2：Relationship + Activity FSM 主体

- `RelationshipComponent` + `RelationshipSystem`
- `ActivityComponent` + `ActivitySystem`，先实现 Offline / Lurking / Browsing / Composing / InThread 五态
- `AttentionComponent`
- 状态持久化与启动 gap mitigation
- 可见效果：NPC 会"追串"，关系积累影响互动概率

### M5-X.3：戏剧态 + 撕逼蔓延

- Activity FSM 补 Beefing / Tilted / Hyped 三态
- 撕逼蔓延机制（观众池 + sigmoid join 概率 + 2 跳上限）
- Alignment 双轴（Layer 1）+ Persona Traits 派生（Layer 2）
- 九宫格 UI + slider + jitter
- 话题厌倦
- 编辑器 NPC 设计器升级
- 可见效果：撕逼能持续 20 分钟并蔓延、不同 alignment 的 NPC 可识别地不同

### M5-X.4：剧本与状态机协作接口

- 剧本 casting 表达式语法
- 期望前置状态机制
- 期望连锁声明
- "剧本未上演日志"供作者审视
- 可见效果：作者写剧本只需指定形象与意图，不必锁定演员

## 未决事项

- **第 3 alignment 轴**（外向↔内向 / 真诚↔戏精）暂不上，待 v1 跑起来感受到表达力不足再扩
- **alignment 影响站队方向的二阶细节**（混乱邪恶帮弱者继续踩 vs 守序邪恶趋利避害）暂不做，让 partisanship + morality 自然涌现，看效果再决定
- **derive 系数的世界级 override**：v1 全局共享 derive 规则，将来若需"该世界混乱就是不爱撕"这种特殊调子再开放
