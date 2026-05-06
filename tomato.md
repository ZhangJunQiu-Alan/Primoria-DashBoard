# 番茄钟 v2 — Focus Journey 旅程式专注

> 文档目标：任何 AI（或新人开发者）读完这份文档，**不看代码也能完整复刻**这个 widget。同时记录所有未决问题与素材需求。
>
> 当前状态：**设计阶段 v0.3**（所有核心 Q 已确认；登顶模型 = 20h，分 5 段 viewport，每段 240min；resize 方案 2）。代码尚未实现，先用 TDD 测试驱动。

---

## 0. 一句话概述

把传统的 25/5 番茄钟改造成「徒步登山」叙事的**专注 + 休息**循环。共 4 个画面，构成一个有限状态机。

- **替换**现有 `pomodoro` widget。新 widget 类型 `focus-journey`。旧 `PomodoroData` 不做迁移（直接弃用字段）。
- 不弹全屏 overlay。**所有 4 个状态都在 dashboard 网格中的一个手机比例（9:16）窗口内渲染**。
- **仅支持等比缩放**（不允许单独改宽或改高）；具体技术方案见 §11。
- 配色沿用截图的深蓝夜景，与 dashboard 主色（奶油绿）解耦，不冲突也不需统一。

---

## 1. 状态机（Single Source of Truth）

```
        ┌─────────────────────────────────────────────────────┐
        │                                                     ▼
   ┌────────┐  click 专注     ┌────────┐  开始专注    ┌──────────┐
   │  IDLE  │ ─────────────►  │ SETUP  │ ──────────► │ FOCUSING │
   └────────┘                 └────────┘             └──────────┘
        ▲                       │   ▲                   │   ▲
        │ long-press ✓ 3s       │   │ rest 5min 归零     │   │ tap (非✓)
        │ OR focus timer = 0    │ < │ OR tap (非✓)      ▼   │
        │ (在 FOCUSING 触发)     │   └─────────────  ┌──────────┐
        │                        ▼                  │ RESTING  │
   ┌──────────┐                IDLE                 └──────────┘
   │ COMPLETED│ ◄───── (transient, 0.6s 动画)              │
   └──────────┘                                            │
        ▲                                                  │
        │ long-press ✓ 3s （RESTING 也允许提前结束）         │
        └──────────────────────────────────────────────────┘
```

### 1.1 状态枚举

| State | 对应图 | 说明 |
|---|---|---|
| `IDLE` | 图 1 | 名言 + 山图 + 波动「专注」按钮 |
| `SETUP` | 图 2 | 路径背景 + 主题输入 + 时长选择 + 开始按钮 |
| `FOCUSING` | 图 3 | 夜晚森林视差滚动 + 角色行走 + 顶部主倒计时 |
| `RESTING` | 图 4 | 同场景 + 篝火 + 顶部双行（专注剩余冻结+闪烁，休息倒计时） |
| `COMPLETED` | — | 瞬态：保存记录 → toast + 通知 → 回 IDLE |

### 1.2 转换矩阵（含触发器与副作用）

| From → To | 触发 | 守卫 (guard) | 副作用 |
|---|---|---|---|
| `IDLE → SETUP` | 点击「专注」按钮 | — | 加载 `defaultDuration`、`lastTopic`；计算角色位置（基于本次旅程累计分钟） |
| `SETUP → IDLE` | 点击左上角 `<` | — | 清空临时输入 |
| `SETUP → FOCUSING` | 点击「开始专注」 | `topic.trim() !== ''`（空则按钮置灰） | `currentRunStartedAt = now`；`consumedSecBeforeRun = 0`；启动 1s tick |
| `FOCUSING → RESTING` | 点击 ✓ 按钮**外**的任何区域 | — | **暂停主专注计时**：`consumedSecBeforeRun += (now - currentRunStartedAt)/1000`；`restStartedAt = now`，启动 5min 倒计时 |
| `RESTING → FOCUSING` | 点击 ✓ 按钮**外**的任何区域 / 5min 倒计时归零 | — | `totalRestSec += elapsedRest`；`restCount += 1`；`currentRunStartedAt = now`；清除 `restStartedAt` |
| `FOCUSING → COMPLETED` | 长按 ✓ 持续 3s | — | 保存为「提前结束」记录（`actualSec < plannedSec`） |
| `RESTING → COMPLETED` | 长按 ✓ 持续 3s | — | 同上（`consumedSec` 取冻结值，不含休息时间） |
| `FOCUSING → COMPLETED` | 主倒计时归零 | — | 保存完成记录；播放音效；触发系统通知 |
| `COMPLETED → IDLE` | 自动（动画结束 ~0.6s） | — | toast: `已完成 N 分钟专注：{topic}`；累加旅程进度；若达 `JOURNEY_GOAL_MIN` 触发登顶动画并归档旅程 |

> 注意：**RESTING 不会**因为主倒计时归零而进入 COMPLETED——休息期间主计时是冻结的，只能通过长按 ✓ 提前结束。

### 1.3 不变量 (invariants)

- **I1**：主专注计时只在 `FOCUSING` 状态下每秒 -1。`RESTING` 期间 `focusRemainingSec` **冻结**为进入休息瞬间的快照值（UI 上加 blink 动画暗示"待恢复"）。
- **I2**：`RESTING` 期间存在唯一活跃计时器 `restRemainingSec`（每秒 -1）。
- **I3**：长按 ✓ 在 `FOCUSING` 与 `RESTING` 都可触发结束。其他状态下 ✓ 不存在。
- **I4 (刷新恢复)**：使用时间戳算剩余时间，不依赖 setInterval 累积。
  - 若刷新时为 `FOCUSING`：`focusRemainingSec = plannedSec - consumedSecBeforeRun - (now - currentRunStartedAt)/1000`；若 ≤0 则直接落入 `COMPLETED` 处理。
  - 若刷新时为 `RESTING`：`focusRemainingSec` 直接取存储快照（不变）；`restRemainingSec = 300 - (now - restStartedAt)/1000`；若 ≤0 则按"5min 归零"路径自动转回 `FOCUSING`，并把刚才的休息时长记入 `totalRestSec` / `restCount`。
- **I5**：✓ 按钮的 hit area **≥48×48 px** 且 `stopPropagation`，避免被"点空白进入休息"误触。
- **I6**：浏览器 tab 切走/最小化不影响计时（时间戳算法）。
- **I7**：Widget 渲染容器始终是 9:16 比例（手机形状）。改大改小时严格等比。
- **I8**：SETUP 里「开始专注」按钮在 `topic.trim() === ''` 时禁用（视觉置灰 + 不响应点击）。

---

## 2. UI 详细规范（逐画面）

> 所有画面都渲染在同一个 9:16 容器内（widget 内部）。容器宽高随 widget 尺寸等比缩放，所有像素值都按"逻辑设计稿宽 360px × 高 640px"标注，运行时按容器实际宽度 scale。

### 2.1 IDLE（图 1）

| 元素 | 规格（基于 360×640 设计稿） | 说明 |
|---|---|---|
| 背景 | `#0E2A4A` 纯色 | 深海军蓝 |
| 顶部名言 | `Cormorant Garamond` 16px / 行高 1.5 / `#A8C0D8` / 居中 | 默认：`"徒步旅行的乐趣在于旅程，而不是目的地"`。后续可做名言池随机 |
| 中央插画 | mountain-hero（**素材需要**） | 居中，最大宽 220px |
| 「专注」按钮 | 直径 100px，`#3B7BB8` 实心圆 + 半透明外环 + 文字「专注」(`Cormorant Garamond` 22px white) | **波动动画**：外环 scale 1.0→1.15、opacity 0.5→0，2s 循环 ease-out |

### 2.2 SETUP（图 2）

布局上下分两区：

**上半区（约 50% 高度）— 旅程地图（分段 viewport）**：
- 整段登顶之路按 `JOURNEY_GOAL_MIN = 1200` (20h) 分为 `TOTAL_SEGMENTS = 5` 个 viewport 段，每段 `VIEWPORT_MIN = 240` (4h)。每段对应一张独立的路径插画（图 10/11 那种），SETUP 上半区只显示**当前段的 viewport**。
- 段索引与段内进度：
  ```ts
  const currentSegmentIndex = Math.min(
    Math.floor(currentJourneyMin / VIEWPORT_MIN),
    TOTAL_SEGMENTS - 1
  )
  const progressInSegment =
    (currentJourneyMin % VIEWPORT_MIN) / VIEWPORT_MIN  // 0~1
  ```
- 背景：`path-bg-{index}.png`（**素材需要 5 张**），随 `currentSegmentIndex` 切换显示。
- 角色定位：
  - 每张段插画都附带一条 SVG `<path>` 几何（设计师必须提供，否则无法定位）
  - 角色坐标 = `currentPath.getPointAtLength(currentPath.getTotalLength() * progressInSegment)`
  - 绝对定位 `character-idle`
- **段切换时刻**：当 `currentJourneyMin` 跨过 `(N+1) × 240` 边界时，viewport 从段 N 滑动切换到段 N+1（建议 0.5s 上滑动画 + 角色平滑回落到新段起点）。
- **登顶**：当 `currentJourneyMin ≥ JOURNEY_GOAL_MIN (1200)` 时触发登顶动画 → 归档当前 journey → `currentJourneyMin = 0` → 回到段 0。
- 左上角 `<` 按钮：圆形 32px，半透明白底，返回 IDLE

**下半区（约 50% 高度）— 设置面板**：
- 背景 `#0E2A4A`，上沿带毛边/弧形过渡（参考截图）
- 顶部行：avatar(32×32, 静态装饰图标) + 「新旅程」(`Cormorant Garamond` 16px) + 右侧 `HH:MM:SS`（= 今日累计专注时长）
- 标题：「现在想要专注什么事呢？」14px 浅蓝
- 输入框：placeholder「例如，学习画画」，下划线样式，max 30 字
- 「开始专注」按钮：直径 90px，圆形，文字「开始专注」18px
  - **空主题时 disabled**：背景灰 `#3A4D63`，文字灰 `#7A8A9C`，cursor not-allowed
- 底部一行：仅时长选择（季节、一般专注按钮已删除）
  - 显示当前选中（如 `25 分钟`）+ Clock 图标
  - 点击弹 popover：25 / 45 / 60 三选项
  - 当前选中值持久化为 `defaultDuration`

### 2.3 FOCUSING（图 3）

**容器内绝对定位的多层视差**。

| 层级 | 元素 | 滚动速度 | 素材 |
|---|---|---|---|
| z-0 | 天空渐变 + 月亮 | 静止（被中层树遮挡是天然层叠） | sky.png + moon.png |
| z-1 | 远山轮廓 | 0.2× | mountains-far.png |
| z-2 | 中层树（深蓝剪影） | 0.5× | trees-mid.png |
| z-3 | 雪地斜坡 | 1.0× | snow-ground.png |
| z-4 | 角色 | 站立动画（呼吸/晃动），不水平移动 | character-walk.gif 或 sprite |
| z-5 | 前景树（黑色剪影模糊） | 1.5× | trees-front.png |
| z-6 | 速度线（地面斜线） | 1.2× loop | speed-lines.svg 或纯 CSS |
| z-10 | UI 顶栏 | 静止 | — |

**滚动实现**：使用 `requestAnimationFrame` 累加 offset，每层用 `transform: translate3d(-offset, 0, 0)`，开启 GPU 合成。`PARALLAX_BASE_PX_PER_SEC = 30`，每层乘上面的速度倍率。**不使用 canvas**。

**顶栏元素**：
- 中央：`MM:SS` 倒计时，`Cormorant Garamond` 28px 白色，`tabular-nums`
- 右上：✓ 圆形按钮 44×44，半透明白底；外圈 hit area 48×48
  - **长按 3s 结束**：`onPointerDown` 启动计时 + 显示 SVG 进度环；`onPointerUp / onPointerLeave` 取消
  - 进度环：SVG circle，`stroke-dasharray = circumference`，`stroke-dashoffset` 从 `circumference` → `0`，3s 线性插值
  - `onClick` 阻止冒泡，避免触发"进入休息"

**点击事件分层**：
- 全屏遮罩 `onClick` 进入 RESTING（除 ✓ 按钮 hit area 外）
- 左上角的音乐按钮：**不实现**

**月亮遮挡**：中层树 PNG 在月亮 X 坐标范围内有不透明像素 → 滚动时自然遮挡。无需 JS 干预。

### 2.4 RESTING（图 4）

继承 FOCUSING 全部背景层，**新增**：

- 篝火（**素材需要**）：放角色右侧 ~60px
  - 动画：CSS keyframes 缩放 + 颜色摇摆，4 帧 / 0.4s 循环；或 SVG flame
- 南瓜（**素材需要**，可选装饰）：角色左侧地面 ~50px
  - 季节系统不实现，南瓜固定显示
- 角色姿势变更：character-rest（**素材需要**），手持工具

**顶栏变化**：
- 第一行：`focusRemainingSec`（MM:SS）**冻结**（不每秒 -1），CSS 闪烁 `animation: blink 1.5s infinite alternate`，`opacity 1 ↔ 0.4`
  - `Cormorant Garamond` 28px 白色
- 第二行：`restRemainingSec`（MM:SS）每秒 -1，14px 灰白色，不闪烁
- ✓ 按钮：保留，行为同 FOCUSING（长按 3s 结束）
- 视差滚动可选：暂停（强调"休息"语义）或继续（保持画面活力）。**默认暂停背景滚动**，篝火与角色仍局部动画。

### 2.5 COMPLETED（瞬态）

- 当前 widget 内淡出 0.3s
- **sonner toast**：`已完成 25 分钟专注 · 学习画画 🎉`
- **音效**：`focus-end.mp3` 播放（≤2s）
- **系统级通知**：使用 [Notification API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API)
  - 权限请求时机：**首次进入 FOCUSING 时**自动请求一次（如未授权也不阻塞流程）
  - 通知内容：title `Primoria · 专注完成`，body `{topic} · {actualMin} 分钟`，icon = mountain icon
- 0.6s 后回到 IDLE；今日累计与本次旅程进度更新；若达旅程目标则播放登顶动画

---

## 3. 数据模型与持久化

### 3.1 新建 store：`src/store/pomodoroJourneyStore.ts`

```ts
interface FocusSession {
  id: string                      // uuid
  topic: string                   // 用户输入主题，已通过 trim() !== '' 校验
  plannedSec: number              // 25*60 / 45*60 / 60*60
  actualSec: number               // 实际专注秒数（不含休息）= plannedSec - focusRemainingSecAtEnd
  startedAt: number               // ms epoch（首次进入 FOCUSING 的时间）
  endedAt: number                 // ms epoch
  restCount: number               // 期间进入休息的次数
  totalRestSec: number            // 累计休息秒数
  // 注意：不再有 completedNaturally / completedCount 概念
  //   是否提前结束直接通过 actualSec < plannedSec 判断
}

interface DailyStat {
  date: string                    // 'YYYY-MM-DD'
  totalFocusSec: number           // 当日所有 actualSec 之和
  sessionCount: number            // 当日 session 数（不分提前/完整）
  // 移除：completedCount
}

interface JourneyArchive {
  id: string
  startedAt: number               // 旅程开始时间
  reachedSummitAt: number         // 登顶时间（满 JOURNEY_GOAL_MIN 那一刻）
  totalFocusSec: number           // 该旅程总专注秒数
  sessionIds: string[]            // 关联的 sessions
}

interface ActiveSession {
  state: 'FOCUSING' | 'RESTING'
  topic: string
  plannedSec: number
  startedAt: number               // session 首次开始
  currentRunStartedAt: number     // 当前 FOCUSING run 的开始时间
  consumedSecBeforeRun: number    // 在当前 run 之前已经消耗的专注秒数（先前 FOCUSING 段累加）
  restStartedAt: number | null    // 仅 RESTING 时有值
  restCount: number
  totalRestSec: number
}

interface PomodoroJourneyState {
  sessions: FocusSession[]                    // 全量历史，按 startedAt 升序
  journeys: JourneyArchive[]                  // 历史登顶档案
  currentJourneyMin: number                   // 当前进行中的旅程已累计分钟（用于 SETUP 角色位置）
  currentSession: ActiveSession | null        // 进行中的会话快照（刷新恢复用）
  defaultDuration: 1500 | 2700 | 3600         // 25/45/60 分钟
  lastTopic: string                           // 上次主题（输入框预填，可选）
  notificationPermission: 'default' | 'granted' | 'denied'
}
```

**派生数据**（不存储，每次计算）：
- `todayTotalSec` = sum of `actualSec` where `startOfDay(startedAt) === today`
- `currentSegmentIndex` = `min(floor(currentJourneyMin / VIEWPORT_MIN), TOTAL_SEGMENTS - 1)`
- `progressInSegment` = `(currentJourneyMin % VIEWPORT_MIN) / VIEWPORT_MIN`
- `journeyProgressPct` = `currentJourneyMin / JOURNEY_GOAL_MIN`（仅用于 debug / 总进度条，UI 默认不展示）

**持久化**：用 zustand `persist` middleware → localStorage key `primoria.pomodoroJourney.v1`

**Supabase 同步**：第一版仅 localStorage。后续可加 sync hook（`sessions` 表 + `user_id` 列）。结构已为同步预留：所有时间戳 ms epoch，所有 ID 用 uuid，date 用 ISO 字符串。

### 3.2 与现有 `widgetDataStore.pomodoro` 的关系

- **替换**旧 PomodoroWidget。从 `WidgetType` 中移除 `'pomodoro'`，删除 `PomodoroWidget.tsx`。
- `widgetDataStore.pomodoro` 字段保留但弃用（避免破坏 persist 反序列化）；新建 widget 后无引用即可。
- 旧用户布局中如有 `pomodoro` 类型，渲染时 fallback 到新的 `focus-journey`（在 `WidgetShell` 的 switch 里加兼容映射），并在 console 提示一次。

---

## 4. TDD 测试清单（Test-Driven 实现顺序）

> 用 Vitest（需要安装 `vitest @testing-library/react @testing-library/user-event`）。
> 测试文件：
> - `src/store/pomodoroJourneyStore.test.ts`
> - `src/components/widgets/FocusJourneyWidget.test.tsx`

### Phase A — 状态机（纯逻辑，无 UI）

把状态机抽成纯函数 `reducer(state, event) → state`，便于单测：

```
A1.  reducer({state:IDLE}, {type:OPEN_SETUP}) → {state:SETUP}
A2.  reducer({state:SETUP}, {type:CANCEL})    → {state:IDLE}
A3.  reducer({state:SETUP}, {type:START, topic:'画画', duration:1500})
       → {state:FOCUSING, topic:'画画', focusRemainingSec:1500,
          currentRunStartedAt:<now>, consumedSecBeforeRun:0, ...}
A4.  reducer({state:SETUP}, {type:START, topic:'  ', ...})
       → 不变（topic 空白守卫触发，按钮应 disabled）
A5.  reducer({state:FOCUSING, focusRemainingSec:1500}, {type:TICK})
       → {focusRemainingSec:1499}
A6.  reducer({state:FOCUSING, focusRemainingSec:1500, currentRunStartedAt:T0,
              consumedSecBeforeRun:0}, {type:TAP_BG, now:T0+10_000})
       → {state:RESTING, focusRemainingSec:1500, // 冻结
          consumedSecBeforeRun:10, restStartedAt:T0+10_000, restRemainingSec:300}
A7.  reducer({state:RESTING, focusRemainingSec:1500, restRemainingSec:300},
              {type:TICK})
       → {focusRemainingSec:1500, // 冻结不动
          restRemainingSec:299}
A8.  reducer({state:RESTING, restRemainingSec:299, restCount:0,
              restStartedAt:T1}, {type:TAP_BG, now:T1+1_000})
       → {state:FOCUSING, restCount:1, totalRestSec:1,
          currentRunStartedAt:T1+1_000, restStartedAt:null}
A9.  reducer({state:RESTING, restRemainingSec:1, restStartedAt:T1},
              {type:TICK})
       → {state:FOCUSING, restRemainingSec:0, restCount:+1, totalRestSec:+300,
          currentRunStartedAt:<now>}
A10. reducer({state:FOCUSING}, {type:LONGPRESS_DONE}) → {state:COMPLETED}
A11. reducer({state:RESTING},  {type:LONGPRESS_DONE}) → {state:COMPLETED}
A12. reducer({state:FOCUSING, focusRemainingSec:1}, {type:TICK})
       → {state:COMPLETED, focusRemainingSec:0}
A13. reducer({state:RESTING},  {type:TICK})  // RESTING 不会因为 focus 归零进入 COMPLETED
       → 不会进入 COMPLETED；focus 保持冻结快照
A14. reducer({state:COMPLETED, ...}, {type:DISMISS})
       → {state:IDLE, sessions:[..., newSession],
          currentJourneyMin: prev + actualSec/60}
A15. reducer with currentJourneyMin crossing N×VIEWPORT_MIN
       → currentSegmentIndex 增加，progressInSegment 回到 0
A16. reducer with currentJourneyMin reaching JOURNEY_GOAL_MIN
       → 触发 SUMMIT_REACHED 副作用：归档 journey 到 journeys[]，
          currentJourneyMin = 0，currentSegmentIndex 回到 0
```

### Phase B — Store 持久化与派生

```
B1.  写入 session 后 todayTotalSec 反映新总和
B2.  跨日：今天的 session 不计入昨天的 dailyStat
B3.  currentSegmentIndex 与 progressInSegment 的派生公式正确（包含 0 / 边界 / 满 5 段）
B4.  defaultDuration 更新后，下次 SETUP 默认值跟随
B5.  refresh 模拟（FOCUSING）：载入 currentSession
       → focusRemainingSec = plannedSec - consumedSecBeforeRun - (now - currentRunStartedAt)/1000
B6.  refresh 时若 focusRemainingSec ≤ 0 → 自动转 COMPLETED 并保存
B7.  refresh 模拟（RESTING）：focusRemainingSec 取存储快照不变；
       restRemainingSec = 300 - (now - restStartedAt)/1000
B8.  refresh 时若 restRemainingSec ≤ 0 → 自动转 FOCUSING 路径，
       totalRestSec += 300，restCount += 1
B9.  达到 JOURNEY_GOAL_MIN(1200) 时归档 journey，currentJourneyMin 重置为 0
B10. 跨段切换：currentJourneyMin 从 239 → 241 时 currentSegmentIndex 由 0 变 1
```

### Phase C — UI 组件（React Testing Library）

```
C1.  IDLE 渲染：「专注」按钮存在，点击触发 onOpenSetup
C2.  SETUP 渲染：默认显示 25 分钟，输入框可输入
C3.  SETUP：空白主题时「开始专注」按钮 disabled，aria-disabled='true'，点击无副作用
C4.  FOCUSING：每 1s 倒计时 -1（用 vi.useFakeTimers）
C5.  FOCUSING：点击非 ✓ 区域进入 RESTING
C6.  FOCUSING：点击 ✓ 按钮**不会**进入 RESTING（事件 stopPropagation）
C7.  长按 ✓ 3s：触发结束；2.9s 释放不结束
C8.  RESTING：focusRemaining 显示有 .blink class，每秒不变化
C9.  RESTING：restRemaining 每秒 -1
C10. RESTING：5min 自动回 FOCUSING，restCount 累加
C11. COMPLETED toast 出现，0.6s 后回 IDLE
C12. COMPLETED 触发 Notification API（mock window.Notification）
C13. SETUP 顶部「今日累计 HH:MM:SS」显示 todayTotalSec 格式化
C14. 角色绝对位置 = 当前段 path 的 `progressInSegment` 百分比对应坐标（mock SVG path）
C15. 跨段切换时 viewport 背景图从 path-bg-N 切到 path-bg-(N+1)，并播放 0.5s 上滑动画
```

### Phase D — 边界与异常

```
D1.  快速连点专注按钮不重复进入 SETUP
D2.  长按过程中状态切换（FOCUSING → RESTING）：长按取消
D3.  浏览器 tab 切走 30s 再回来：剩余时间正确（按时间戳）
D4.  系统时间被回拨：剩余时间不变成负数（clamp 0）
D5.  localStorage 满 / 写失败：UI 不崩，console.error 即可
D6.  Notification.requestPermission denied 不阻塞流程
D7.  Widget 等比缩放后内部布局不溢出
```

---

## 5. 实现拆分（建议提交粒度）

| Step | 内容 | 测试 |
|---|---|---|
| 1 | `pomodoroJourneyStore.ts` + reducer 纯函数 | Phase A 全部 |
| 2 | persist 接入 + 派生 selector + 刷新恢复 | Phase B 全部 |
| 3 | `FocusJourneyWidget.tsx` 容器 + 9:16 比例壳 + IDLE | C1 |
| 4 | SETUP（含路径角色定位、时长 popover、空主题 disable） | C2-C3, C13-C14 |
| 5 | FOCUSING 视差场景 + 顶部倒计时 + 长按 ✓ | C4-C7 |
| 6 | RESTING 双行顶栏 + 篝火 | C8-C10 |
| 7 | COMPLETED toast + sound + 系统通知 | C11-C12, D6 |
| 8 | 替换 `WidgetType`，删除旧 PomodoroWidget，注册到 `AddWidgetModal` / `WidgetShell` 兼容映射 | — |
| 9 | 边界 / 刷新恢复 / 缩放测试 | D1-D7 |
| 10 | 美术素材替换占位图 | 手测 |

> 每步独立 commit。第 1-2 步可以无 UI 跑通整个状态机。

---

## 6. 美术素材清单（**主要 blocker**）

⚠️ 整个体验高度依赖原画质量。无原画时用 placeholder（纯色矩形 + emoji），但效果会很差。
> 设计稿基准 360×640；@2x 提供，运行时按容器实际尺寸 scale。

| ID | 用途 | 推荐尺寸（@2x） | 必需性 | 备注 |
|---|---|---|---|---|
| `mountain-hero.png` | 图1 中央山图 | 440×360 | 必需 | 透明背景，蓝白雪山 + 上升箭头 |
| `path-bg-{0..4}.png` + 各自 path SVG | 图2 5 段 viewport 背景 + 各自路径几何 | 720×640 ×5 张 | 必需 | 每段对应一张插画（参考图 10 森林、图 11 山面）+ 一条 SVG `<path>`，按 `currentSegmentIndex` 切换；做不齐 5 段时降级方案：用 1 张+变色 hint，每完成 1 段路径变色提示进入下一段 |
| `character-idle.png` | 图2 角色站立 | 80×80 | 必需 | 白色小幽灵 |
| `character-walk` 精灵图 | 图3 角色行走 | 4 帧 ×80×80 | 必需 | 简单走路循环；做不了就用 idle + 上下浮动 |
| `character-rest.png` | 图4 角色休息姿势 | 80×80 | 推荐 | 手持工具/食物 |
| `sky` 渐变 | 图3 天空 | 可纯 CSS | 可选 | 深蓝 → 中蓝 |
| `moon.png` | 图3 月亮 | 80×80 | 必需 | 透明背景 |
| `mountains-far.png` | 图3 远山轮廓 | 1440×320 | 推荐 | 横向可平铺 |
| `trees-mid.png` | 图3 中层树 | 1440×600 | 必需 | 横向可平铺；月亮 X 坐标处需有不透明像素以做遮挡 |
| `trees-front.png` | 图3 前景剪影 | 1440×280 | 必需 | 模糊 / 黑色剪影 |
| `snow-ground.png` | 图3 雪地斜坡 | 1440×320 | 必需 | 横向可平铺 |
| `speed-lines.svg` | 图3 地面动线 | 矢量 | 可选 | 可纯 CSS |
| `campfire` 4 帧序列 | 图4 篝火 | 80×120 ×4 | 必需 | 帧动画或 SVG flame |
| `pumpkin.png` | 图4 南瓜装饰 | 60×60 | 可选 | 固定显示 |
| `avatar-icon.png` | 图2 头像 | 64×64 | 可选 | 无则用 lucide `User` |
| `mountain-icon.png` | 系统通知图标 | 192×192 | 必需 | Notification API 要 |

**音频**（必需第一版做：focus-end + rest-end；其余可选）：
- `focus-end.mp3` 专注完成 (1-2s, ≤50KB)
- `rest-end.mp3` 休息结束 (1s)
- `forest-ambient.mp3` 循环背景音 (≤200KB, 30s loop) — 可选
- `tick.mp3` 每秒滴答 — 默认关闭

---

## 7. 设计常量

```ts
// 时长
const FOCUS_DURATIONS = [25, 45, 60] as const  // 分钟，对应 popover 选项
const REST_DURATION_SEC = 300                   // 5min 休息
const LONGPRESS_END_MS = 3000                   // 长按 3s 结束

// 旅程进度
const JOURNEY_GOAL_MIN = 1200                   // 20h = 1 次登顶
const VIEWPORT_MIN = 240                        // 4h = 1 段 viewport
const TOTAL_SEGMENTS = 5                        // = JOURNEY_GOAL_MIN / VIEWPORT_MIN
// 注意："今日目标 240min" 不是日打卡线，而是每段 viewport 的容量。
// 不强制按天结算；跨日继承 currentJourneyMin。

// 动画
const PULSE_BUTTON_DURATION_MS = 2000           // IDLE 按钮波动周期
const PARALLAX_BASE_PX_PER_SEC = 30             // mid 层基础速度
const PARALLAX_SPEEDS = { far: 0.2, mid: 0.5, ground: 1.0, front: 1.5 }
const BLINK_PERIOD_MS = 1500                    // RESTING focus 文字闪烁
const COMPLETED_DISMISS_MS = 600                // COMPLETED → IDLE 动画时长

// 容器
const WIDGET_ASPECT_RATIO = 9 / 16              // 手机比
const WIDGET_DESIGN_WIDTH = 360                 // 设计稿基准宽
const WIDGET_DESIGN_HEIGHT = 640                // 设计稿基准高
```

---

## 8. 与项目既有约定的对齐

- **颜色**：widget 内是独立深色主题，使用以下专属变量（写在 widget 容器 scope 里，不污染全局）：
  ```css
  --focus-bg: #0E2A4A
  --focus-bg-alt: #1A3A5C
  --focus-accent: #3B7BB8
  --focus-text: #E8EEF5
  --focus-text-muted: #8FA8C0
  --focus-disabled-bg: #3A4D63
  --focus-disabled-text: #7A8A9C
  ```
- **字体**：标题 `Cormorant Garamond`，正文 `DM Sans`（与全局一致）
- **Hover**：深色主题下新建 `.focus-btn-hover` 工具类（不复用奶油绿色 `.btn-ghost-hover`）
- **react-grid-layout** 配置：见 §11
- **z-index**：因为不弹 overlay，所有内容在 widget 内部。`AddWidgetModal` 等模态在更高 z-index，无冲突

---

## 9. 未决问题（v0.2 仍开放）

| # | 问题 | 当前默认 | 状态 |
|---|---|---|---|
| Q1 | 替换旧 PomodoroWidget？ | **是**（删除 PomodoroWidget.tsx） | ✅ 已确认 |
| Q2 | 全屏 overlay vs widget 内？ | **widget 内 9:16 等比窗口** | ✅ 已确认 |
| Q3 | 主题为空允许开始？ | **不允许，按钮置灰** | ✅ 已确认 |
| Q4 | RESTING 期间主计时是否暂停？ | **暂停**，UI 闪烁提示 | ✅ 已确认 |
| Q5 | 长按提前结束是否计入"完成"？ | 不再有「完成数」概念，所有 session 都是有效记录 | ✅ 已确认 |
| Q6 | 5min 休息能进入几次？ | 不限制，记 restCount | ✅ 已确认 |
| Q7 | 刷新页面恢复 vs 丢弃？ | 恢复（按时间戳） | ✅ 已确认 |
| Q8 | 时长选择是否支持 20min？ | 仅 25/45/60 | ✅ 已确认 |
| Q9 | 完成时声音 / 桌面通知？ | **第一版做**：sonner toast + audio + Notification API | ✅ 已确认 |
| Q10 | 季节系统是否实现？ | 不实现，南瓜固定显示 | ✅ 已确认 |
| Q11 | 同步到 Supabase？ | 第一版仅 localStorage | ✅ 已确认 |
| Q12 | 名言池是否做？ | 第一版固定一句 | ✅ 已确认 |
| Q-A | 登顶阈值与"今日目标 240min"的关系？ | **登顶 = 20h (1200min)**；240min 是单段 viewport 容量；总 5 段；跨日继承不重置 | ✅ 已确认 |
| Q-B | react-grid-layout 等比缩放实现方案？ | **方案 2**：角落手柄 + onResize 强制比例（详见 §11） | ✅ 已确认 |
| Q-C | Notification 权限请求时机？ | 首次进入 FOCUSING 时自动请求一次 | 待确认（第一版按此实现） |
| Q-D | 5 段 viewport 各需独立插画吗？ | 理想 5 张；最低降级 1 张+段间变色 hint | 待美术确认 |

---

## 10. 验收清单（Definition of Done）

- [ ] 状态机所有 15 条 reducer 测试通过
- [ ] IDLE → SETUP → FOCUSING → RESTING → FOCUSING → COMPLETED → IDLE 全链路手测通过
- [ ] 25/45/60 分钟均可正确倒计时
- [ ] 主题为空时「开始专注」按钮 disabled，无法启动
- [ ] RESTING 期间主倒计时冻结 + 闪烁；休息计时每秒 -1
- [ ] RESTING 5min 归零自动回 FOCUSING，restCount + 1
- [ ] 长按 ✓ 进度环可视，3s 触发，<3s 取消
- [ ] 刷新页面后专注/休息会话正确恢复（剩余时间误差 ≤2s）
- [ ] 切 tab 30s 后剩余时间正确
- [ ] 跨日：昨天的 session 不影响今天 todayTotalSec
- [ ] 完成时播放音效 + 系统通知 + sonner toast
- [ ] Widget 拖拽 resize 时严格保持 9:16 比例（按 §11 方案 2，仅角落手柄，离散 4 档：3×5 / 4×7 / 5×9 / 6×11）
- [ ] 跨段切换：`currentJourneyMin` 跨过 240/480/720/960 时 viewport 平滑过渡到下一段
- [ ] 登顶：`currentJourneyMin ≥ 1200` 时归档 journey + 重置回段 0
- [ ] 旧 `PomodoroWidget.tsx` 已删除；旧布局中 `pomodoro` 类型回退到 `focus-journey`
- [ ] 所有美术素材替换为终稿，或 placeholder 标记清晰
- [ ] 首次 FOCUSING 时请求 Notification 权限；拒绝后不阻塞

---

## 11. Widget 9:16 等比缩放实现方案（方案 2）

`react-grid-layout` 不原生支持锁定宽高比。**采用方案 2：角落手柄 + onResize 强制比例**。

### 配置

```ts
// dashboardStore.ts DEFAULT_SIZES
'focus-journey': {
  w: 3, h: 5,       // 默认 3 col × 5 row（最接近手机比的最小档）
  minW: 3, minH: 5,
  maxW: 6, maxH: 11,
  resizeHandles: ['se'],  // 只开右下角手柄
}
```

### Aspect 锁定逻辑（写在 Dashboard.tsx onResize 回调）

ratio 目标 = 9:16 ≈ 0.5625（即 `h ≈ w × 16/9 ≈ w × 1.778`）。允许的整数 grid 档位：

| w | 理论 h (w × 1.778) | 取整 h | 实际比例 (w/h) | 偏差 |
|---|---|---|---|---|
| 3 | 5.33 | **5** | 0.600 | +6.7% |
| 4 | 7.11 | **7** | 0.571 | +1.6% |
| 5 | 8.89 | **9** | 0.556 | -1.2% |
| 6 | 10.67 | **11** | 0.545 | -3.0% |

实现：

```ts
const RATIO = 16 / 9
const ALLOWED_W_TO_H: Record<number, number> = { 3: 5, 4: 7, 5: 9, 6: 11 }

function onResize(layout, oldItem, newItem, placeholder) {
  if (newItem.i !== focusJourneyItemId) return
  // 用户拖动哪个维度更多就以哪个为主
  const dw = Math.abs(newItem.w - oldItem.w)
  const dh = Math.abs(newItem.h - oldItem.h)
  if (dw >= dh) {
    const w = Math.max(3, Math.min(6, newItem.w))
    newItem.w = w
    newItem.h = ALLOWED_W_TO_H[w]
  } else {
    // 反推 w
    const targetW = Math.round(newItem.h / RATIO)
    const w = Math.max(3, Math.min(6, targetW))
    newItem.w = w
    newItem.h = ALLOWED_W_TO_H[w]
  }
  // 同步 placeholder 防止视觉抖动
  placeholder.w = newItem.w
  placeholder.h = newItem.h
}
```

### 内部容器样式

无论外层 grid cell 像素如何，widget 内部用 `aspect-ratio: 9/16` + 居中 + `overflow: hidden`，所有 4 个状态的内容按"设计稿基准 360×640"等比 scale（用 `transform: scale(containerWidth / 360)` 或 viewport 单位）。

### Trade-off

- ✅ 用户能调大调小，比例稳定（最差档位偏差 6.7%，肉眼基本无感）
- ⚠️ 整 col 跳变不丝滑（react-grid-layout 限制，无法做亚像素级 resize）
- ⚠️ 需要在 `Dashboard.tsx` 里加 widget-id 判别逻辑（仅对 `focus-journey` 锁比例）
