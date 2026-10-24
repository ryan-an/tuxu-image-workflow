# 界面设计规范

本平台采用浅色工作台：冷白背景、白色内容面板、清晰的蓝紫主色。产品图片是视觉主体；颜色集中用于操作、当前选择和状态，避免大面积高饱和背景。

## 唯一来源

- `src/ui/design-system/tokens.css`：颜色、间距、圆角和焦点。
- `Badge.tsx` / `badge.css`：说明标签、计数和状态的共用外观。
- `ProductStatusBadge.tsx`：把现有业务状态映射到 Badge，并处理进行中的转圈。
- `Button.tsx` / `button.css`：按钮的语义变体、焦点和交互；`ActionButton` 继续封装应用命令，通过 Button 渲染。

页面 CSS 负责布局、位置和响应式适配，禁止重新定义共用标签的文字色、背景、边框、字号或透明度。新增颜色先考虑现有语义，确实需要新语义时在 tokens 中增加。演示原型和第三方 Univer 自有主题不属于本规范的组件实现范围。

## 颜色语义

| 语义    | 前景 / 背景 / 边框                | 用途                             |
| ------- | --------------------------------- | -------------------------------- |
| brand   | `#5B4FE8` / `#EEEBFF` / `#CFC7FF` | 品牌、进行中、主要操作、当前选中 |
| info    | `#245EDB` / `#EAF2FF` / `#BED5FF` | 就绪、可继续、实拍及参考素材     |
| success | `#147A42` / `#E8F8EE` / `#AFE3C3` | 完成、选图完成、已配置、结果素材 |
| warning | `#945B06` / `#FFF4D6` / `#F3D48C` | 部分完成、中断、待保存、需注意   |
| danger  | `#C92F46` / `#FFF0F2` / `#F4B8C3` | 失败、配置缺失、危险操作         |
| neutral | `#526178` / `#F0F3F8` / `#D9E0EB` | 等待、排队、取消、普通说明       |

正文 `#25324B`，辅助文字 `#64748B`，画布 `#F7F8FC`，内容面板 `#FFFFFF`，普通边框 `#E1E6F0`。淡底搭配清晰文字；不要为了“亮色”降低文字对比度。小字前景与实际背景的对比度至少为 4.5:1。

绿色表示各自任务范围内的完成：分析完成不代表图片已经选完。文案必须保留具体状态，不能只用颜色传递信息。产品自定义要求使用 info，避免把“自定义”误解为完成。

## 标签

```tsx
<Badge tone="info">实拍图 6</Badge>
<Badge tone="brand" icon={<DocumentIcon />}>默认要求</Badge>
<Badge tone="neutral" unavailable>尚无结果</Badge>
<ProductStatusBadge tone="working" label="生成中" />
```

`Badge` 支持 neutral、brand、info、success、warning、danger。默认 sm：10px 字号、16px 行高、2px × 6px 内边距、无边框、4px 圆角、400常规字重，总高度20px；md：11px 字号、18px 行高、2px × 7px 内边距。图标11px，与文字间距3px。移动端保持相同尺寸。配色调整不得顺带放大标签或增加字重；优先保持原有工作台密度。

缺少资料使用 `unavailable`，显示中性色，保留说明文字，不增加虚线或装饰性描边。Badge 本身没有点击行为；需要触发操作时使用 Button，不把 span 伪装成按钮。不为每个静态标签添加 live region；实时播报由业务容器按需提供。

`ProductStatusBadge` 状态映射：waiting / queued / cancelled → neutral，ready → info，partial / interrupted → warning，working / running → brand，error / failed → danger，done / completed → success。未知状态安全回退 neutral，原始文案保留。进行中自动显示转圈；遵从系统减少动态效果设置。

## 按钮和交互

`Button` 支持 primary、secondary、warning、danger、ghost。primary 使用白字紫底，同一操作区只突出主要动作；secondary 用于普通操作；warning / danger 保留给需要注意或有风险的动作；ghost 用于轻量辅助入口。省略 variant 时保留已有页面布局样式，用于渐进迁移，不新增另一套按钮体系。

业务命令使用 `<ActionButton action="…" variant="primary">…</ActionButton>`；组件本地操作使用 Button。Button 默认 `type="button"`，提交表单时显式传 `type="submit"`。保留原生 disabled 和键盘操作，不把等待状态做成看似可点击的控件。

弹窗的确认操作统一位于右下角，取消放在确认左侧；普通弹窗共用 `DialogActions`，编辑器和素材弹窗保留各自底栏但遵循同样的对齐规则，全屏编辑也将保存放在右下角。原生弹窗共用 `useDialogDismiss`：点击遮罩关闭，点击正文、内边距或从内部拖选到外部不关闭；保存期间已有的禁止关闭状态继续生效。

焦点使用2px主色轮廓、3px间距和淡紫外环；悬停主色加深至 `#4938CF`。颜色过渡150ms，减少动态效果时关闭。危险操作同时使用明确的动词与颜色。

紧凑编辑工具使用 `Button size="sm"`：桌面高度28px，触摸设备最小高度36px；尺寸由共用组件定义，不用页面选择器反复覆盖。保存使用 primary，普通操作 secondary，查找、全屏及恢复使用 ghost，删除使用 danger。

## 文本编辑窗口审查

- 标题与产品信息一行、模板与编辑工具一行、状态与保存一行。次要说明放进状态或无障碍描述，避免占用正文高度。
- 普通模式中正文至少占窗口高度75%（桌面）；工具栏保持单行，窄屏辅助工具改为带无障碍名称的图标。
- 编辑正文使用 `--color-text`，辅助说明使用 `--color-muted`，不以同一种灰色呈现；正文至少14px，移动端16px。
- 弹窗尺寸受视口限制，外壳不滚动；长文在文本域内滚动，隐藏可见滚动条但保留滚轮、触摸、方向键和选区滚动。
- 全屏编辑铺满整个视口，隐藏产品资料、模板管理、恢复入口及普通底栏，顶部保留查找和退出，保存位于精简底栏右侧。正文在窄屏仍至少占视口高度80%。Esc优先关闭查找或退出全屏，保留草稿和选区。
- 模板命名使用就地浮层，不推挤正文。删除需要明确确认，错误就地展示；保存失败保持文本。
- 浏览器回归验证真实尺寸、无外层溢出、按钮层级、文字颜色及全屏覆盖；截图分别覆盖桌面、窄屏与全屏，不能只凭代码判断视觉效果。

## 排版与空间

字体沿用 Inter、Microsoft YaHei、sans-serif。正文12–13px，紧凑标签10px，普通标签11px，标签和操作文字使用400常规字重；保留原有标题层级，不为提亮配色增加字号、加粗或扩大控件。间距以4px为基础，常用4 / 8 / 12 / 16 / 24px；标签圆角4px，小按钮6px，控件或小面板10px，大面板14px。整体以紧凑、平实为准，避免重复描边、投影和装饰。

## 验证与维护

修改后运行 `npm test` 和 `npm run build`。涉及标签、布局或交互时，按 `tests/README.md` 配置并运行 `npm run test:e2e`。`tests/e2e/design-system-browser.test.ts` 检查真实页面的语义色、文字对比度、字号、运行状态图标及移动端溢出；截图使用 `artifactPath` 输出到 `artifacts/tests/`。
