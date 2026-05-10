# Personal Dashboard 行为事件层学习笔记

## 目标

这一步不是直接做 RAG、知识图谱或者主动建议，而是先给 Dashboard 建一个可靠的“感知系统”。

AI 助手要像长期个人助手一样理解你，第一步必须知道发生过什么：

- 你什么时候开始专注、什么时候休息、什么时候完成番茄钟
- 你怎么移动任务、推迟任务、完成任务
- 你什么时候写便签、生成简报、连接日历、上传音乐
- 你让 AI 做了什么，AI 准备了什么变更，你最后是否确认

这些原始行为事件会成为后续长期记忆、习惯推断、主动建议、RAG 检索的基础数据。

## 为什么先做事件层，不先做 RAG 或 KG

RAG 的核心是“检索相关上下文”，但它必须先有值得检索的数据。知识图谱的核心是“实体和关系”，但它也需要从真实事件里抽取稳定关系。

如果一开始就做 RAG，系统可能只能搜索便签或对话文本，却不知道这些内容在什么场景下发生。比如“周五下午切轻松模式”不是一条文档事实，而是一个从多次行为中总结出来的模式。

所以第一步选择事件流：

```text
Dashboard 行为
  -> 行为事件
  -> 本地队列
  -> Supabase 独立事件表
  -> 后续总结/向量化/习惯推断
```

这相当于先给 AI 助手建立“观察能力”，再建立“记忆能力”和“推理能力”。

## 架构

当前实现分成三层。

第一层是本地队列。用户操作发生后，事件立即写入 `localStorage` 的 `primoria-behavior-events-queue.v1`。这样即使未登录、断网或 Supabase 临时失败，也不会丢失事件。

第二层是批量同步。登录后，前端 hook 会监听队列变化，每 60 秒节流上传一次，每批最多 50 条；如果本地队列已经达到 50 条，会立即同步一批。上传失败时保留队列，并用指数退避重试，最高 60 秒。

第三层是 Supabase 独立表。`user_behavior_events` 只负责长期保存行为事件，不和 `dashboard_snapshots` 混在一起。这样未来可以按时间线、事件类型、组件、元数据做分析。

## 为什么用独立事件表

现有 `dashboard_snapshots` 适合保存“当前状态”，比如现在有哪些组件、任务和便签。行为事件表适合保存“发生过程”，比如任务什么时候被移动、AI 建议什么时候被确认、番茄钟什么时候结束。

这两个数据模型不同：

```text
snapshot：现在是什么样
event log：过去发生了什么
```

长期 AI 助手需要两者。snapshot 让它知道当前状态，event log 让它知道你的习惯和变化轨迹。

## 数据分层

事件采用“摘要 + 元数据”，不保存完整正文。

例如便签更新不会把整篇便签写入事件，只记录：

- 字数
- 简短摘要
- widget id
- 更新时间

音乐不会保存 signed URL，壁纸不会保存 data URL，日历不会保存 iframe HTML。事件模块会对 URL、data URL、token、iframe/html 做清洗。

这个设计不只是为了隐私，更重要的是保持数据模型清晰：事件表记录“发生过什么”，内容表或当前状态记录“完整内容是什么”，记忆表记录“从事件和内容里提炼出的长期认知”。

```text
事件表 user_behavior_events
  -> 发生了什么、什么时候、哪个组件、短摘要、结构化 metadata

内容表 / 当前状态
  -> 完整便签、完整 AI 对话、完整任务内容、完整项目资料

记忆表 / RAG 索引
  -> 从内容和事件中提炼出来的长期偏好、习惯、总结、embedding
```

即使是个人使用、完全不考虑隐私，也不应该把完整正文塞进事件表。否则一次便签编辑就会复制一份全文，事件表会很快变成多个中间版本混杂的内容仓库，既浪费 Supabase Free Plan 的数据库空间，也会降低未来 RAG 检索质量。

## 巧思

`client_event_id` 用于幂等。事件先在本地生成唯一 ID，同一批事件重复上传时，Supabase 通过 `unique(user_id, client_event_id)` 避免重复记录。

本地队列让系统支持离线。没有网络时先记下来，恢复登录和网络后再上传。

RLS 保证用户只能读写自己的事件。这个表会变成长期记忆基础，所以权限边界必须从第一天就放进去。

事件类型统一。无论是 AI、任务、便签、音乐、日历还是番茄钟，都使用同一套字段：`event_name`、`actor`、`surface`、`summary`、`metadata`。这样未来 RAG 或习惯分析只需要接一个统一入口。

## 和 RAG 的关系

后续 RAG 不应该直接检索所有原始事件。更合理的流程是：

```text
原始事件
  -> 每日/每周总结
  -> 提炼稳定偏好和习惯
  -> 对摘要和长期记忆生成 embedding
  -> 查询时检索相关记忆
```

原始事件是证据层，长期记忆是认知层，RAG 是取回层。

## 和 Caliby / pgvector 的关系

当前第一步不绑定具体向量数据库。Supabase 保存权威事件数据，未来可以有两个方向：

- 云端：用 Supabase pgvector 做跨设备 RAG
- 本地：用 Caliby 做本地长期记忆检索和更快的离线搜索

因为事件格式统一，后续替换或增加向量索引时，不需要重做 Dashboard 的行为采集。

## 下一阶段

下一步可以基于事件表做“每日反思任务”：

- 总结今天完成了哪些任务
- 统计番茄钟和习惯完成度
- 识别哪些任务被反复推迟
- 生成明天建议
- 把稳定偏好写入长期记忆表

这时才进入真正的长期记忆和主动建议阶段。

---

# 第二步：内容表 / 当前状态层学习笔记

## 目标

第二步给 Dashboard 增加“完整内容层”。第一步的事件表记录“发生了什么”，但它只保存摘要和 metadata；第二步的内容表记录“现在完整内容是什么”，例如完整便签、完整任务、完整 AI 对话、每日简报和日历读取结果。

这一步仍然不做 embedding、不做 RAG 检索、不做主动建议。它的目标是把未来可以被检索、总结、提炼记忆的内容先整理成统一索引。

## 为什么 dashboard_snapshots 不等于内容层

`dashboard_snapshots` 保存的是整份 Dashboard 快照，适合做跨设备恢复：

```text
打开新设备
  -> 读取 dashboard_snapshots
  -> 恢复组件、布局、待办、便签、壁纸
```

但它不适合直接做 AI 检索。原因是快照是一大块 JSON，AI 很难高效地问：

- 哪些内容是任务？
- 哪些内容是便签？
- 哪条 AI 消息提到了某个项目？
- 今天的日历事件在哪里？
- 某个任务当前是否完成？

所以第二步新增 `user_content_items`。它不是替代快照，而是从快照和本地状态中派生出来的“内容索引表”。

## 三层边界更清楚了

现在的数据层可以这样理解：

```text
dashboard_snapshots
  -> 恢复权威快照
  -> 记录整个 Dashboard 当前状态

user_behavior_events
  -> 行为证据层
  -> 记录发生了什么、何时发生、哪个组件触发

user_content_items
  -> 当前内容层
  -> 记录完整文本内容、类型、来源、对象 id、检索 metadata
```

一个例子：

```text
用户把“写内容层”这个任务移到明天

事件表：
  scheduled_task.moved
  summary = 移动日程任务：写内容层
  metadata = fromDueDate / toDueDate / widgetId

内容表：
  content_key = scheduled_task:schedule-1:task-1
  body = 写内容层
  metadata = completed / dueDate / widgetTitle

快照：
  保存整个 scheduledTasksByWidget JSON
```

这三个数据都重要，但用途不同。

## 为什么用统一内容表

第二步选择一个统一表 `user_content_items`，而不是马上拆成 notes、tasks、ai_messages、briefs 多张表。

原因是个人 AI 助手的早期目标是“统一检索和总结”，不是复杂业务报表。统一内容表让所有内容都拥有同样的字段：

- `content_key`：稳定唯一键
- `content_type`：内容类型
- `title`：可读标题
- `body`：完整正文
- `metadata`：结构化信息
- `content_hash`：判断内容是否变化
- `sync_batch_id`：判断哪些旧内容已经不存在

这样未来做 RAG 时，可以先从一个入口取回候选内容。

## 为什么快照上传后重建索引

内容表是派生索引，不是用户直接编辑的权威数据。因此同步策略选择：

```text
本地状态变化
  -> 现有云同步上传 dashboard_snapshots
  -> 上传成功后从本地状态重新 buildUserContentItems()
  -> upsert 到 user_content_items
  -> 删除旧 batch 中已经不存在的内容
```

这个设计有几个好处：

- 不需要在每个按钮操作里直接写 Supabase。
- 离线时本地照常可用。
- 云同步成功后内容索引自然追上。
- 如果内容索引失败，快照仍然已经保存，不会丢数据。
- 下次云同步可以重新生成整份内容索引，修复中间失败。

这和搜索引擎的索引很像：原始网页才是权威内容，索引是为了搜索服务的派生数据。

## content_key 的巧思

每个内容项都有稳定的 `content_key`：

```text
note:notes-1
lined_note:lined-1:page-1
todo:todo-1:todo-a
scheduled_task:schedule-1:task-1
daily_brief:2026-05-10
ai_message:default-dashboard-agent:msg-1
```

这样同一条任务被编辑时，不会插入一条新 row，而是更新原来的 row。删除任务后，下一次同步会通过 `sync_batch_id` 清理旧 row。

`client_event_id` 解决事件表重复上传问题；`content_key` 解决内容表重复索引问题。

## AI 对话为什么要持久化

之前 AI 对话只存在 React state 里，刷新页面就消失。第二步把 AI 会话放入 widget data snapshot：

- 可见消息
- Gemini contents
- 工具调用记录
- pending actions
- 更新时间

这样 AI 对话不只是 UI 聊天记录，也会进入内容层，未来可以被总结和检索。例如“上次我让 AI 帮我改了什么任务？”就需要完整会话历史。

pending action 仍然不会自动执行。内容层只保存“AI 准备了什么”和“用户是否确认”的上下文，不改变权限模型。

## 和未来 RAG 的关系

第二步完成后，RAG 的数据来源会更自然：

```text
用户问题
  -> 查当前内容 user_content_items
  -> 查长期记忆表
  -> 必要时回看 user_behavior_events
  -> 把相关上下文注入 LLM
```

这里 `user_content_items` 是当前内容入口，`user_behavior_events` 是行为证据入口，未来的记忆表是长期认知入口。

这一步先把“可检索内容”准备好，下一步才适合做每日反思、长期记忆和 embedding。
