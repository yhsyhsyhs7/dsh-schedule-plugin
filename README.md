# DSH 个人计划表插件 (Personal Schedule)

基于日期、可拖动、可缩小为悬浮球的 DSH 动态 Cordis 插件：查看/编辑今天前后 14 天的计划（默认显示今日），计划项含开始/结束时间与内容，数据持久化到磁盘。

## 功能

- 侧边栏底部「📋 计划表」按钮：显示/隐藏计划表（保留上次的展开/缩小状态）
- **展开状态**：完整面板（360px），按住标题栏可拖动位置
- **缩小状态**：48px 圆形悬浮球（带 📋 图标），整球可拖动，点击展开回面板
- 展开/缩小共享同一位置锚点（右上角），切换状态不跳位
- **日期窗口**：今天 ±14 天；日期栏提供 ◀ ▶ 逐日切换、原生日期选择器、「今天」按钮
- **计划项格式**：`{ start, end, text }` — 开始/结束时间（原生时间选择器）+ 内容
- 编辑模式每个日期独立草稿：切换日期不丢草稿；「保存」仅写入当前日期，「取消」放弃全部草稿
- 跨零点自动滚动日期窗口并钳制所选日期

## 数据结构（磁盘文件）

保存在 `<workspaceRoot>/.dsh-schedule.json`：

```json
{
  "version": 2,
  "plans": {
    "2026-08-21": [
      { "start": "09:00", "end": "10:00", "text": "写周报" },
      { "start": "14:00", "end": "15:00", "text": "团队会议" }
    ]
  }
}
```

## 安装（动态插件方式）

1. 在 DSH 界面创建动态 Cordis 插件（`cordis_define`），Host 半部粘贴 `host.js` 的完整内容，Client 半部粘贴 `client.js` 的完整内容。
2. `cordis_run` 激活并批准（Client 包需要用户授权）。
3. 侧边栏底部出现「📋 计划表」按钮即安装成功。

## 依赖的运行时能力

| 平台 | 依赖 |
| --- | --- |
| Host | `fs`（可选，缺省时降级为内存模式）、`sandboxPolicy`（可选，用于解析 workspace 根与写策略）、`harness`（RPC） |
| Client | `slots`（`sidebar.footer.action`、`shell.overlay`）、`host`（RPC）、`styles`、`timer`（可选，跨零点刷新）、React |

## 文件

- `host.js` — Host 半部：`plan.get` / `plan.save` RPC + JSON 文件持久化（串行写队列）
- `client.js` — Client 半部：侧边栏按钮 + 浮动面板/圆球 + Pointer Events 拖动 + 编辑 UI
