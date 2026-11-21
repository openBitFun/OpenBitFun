# 图标系统规范

## 尺寸层级

| Token | 尺寸 | 用途 | 示例场景 |
|-------|------|------|----------|
| `2xs` | 8px | 极小标记 | Badge 圆点、状态指示器 |
| `xs` | 12px | 紧凑 UI | 列表行内图标、标签图标 |
| `sm` | 14px | 辅助图标 | 按钮内图标、输入框图标 |
| `md` | 16px | 默认尺寸 | 导航图标、操作图标 |
| `lg` | 24px | 强调图标 | 空状态、功能入口 |

## 视觉重心规则

### 1. 光学对齐
- 图标容器使用 `display: grid; place-items: center` 确保视觉居中
- 图标本身尺寸统一，通过容器控制布局位置
- 避免使用 margin 微调图标位置，应通过容器对齐

### 2. 尺寸一致性
- 同一组件内所有图标必须使用同一尺寸层级
- 按钮内图标固定使用 `sm` (14px) 或 `md` (16px)
- 列表行图标固定使用 `md` (16px)
- 标签页图标固定使用 `md` (16px)

### 3. 描边宽度
- 默认描边：`1.6px`（对应 Lucide 图标标准）
- 强调描边：`2px`（用于导航等需要强调的图标）
- 所有图标必须通过 `strokeWidth` prop 或 CSS 变量控制，禁止硬编码

### 4. 移动端特殊规则
- 移动端可点击图标最小尺寸：44×44px（容器）
- 图标本身尺寸仍遵循上述层级
- 通过容器 padding 实现触控区域，而非放大图标

### 5. Lucide 图标的光学尺寸差异
Lucide 图标库的 glyph 在统一 24×24 viewBox 内的实际占位差异较大：
- **偏满**：`puzzle`、`terminal`、`folder`、`settings`、`browser`（占位 ~20-22px）
- **中等**：`plus`、`x`、`check`、`search`、`chevron-*`（占位 ~16-18px）
- **偏小**：`star`、`heart`、`bookmark`、`circle`（占位 ~14-16px）

**后果**：即使所有图标都用同一个 `size` prop，视觉上仍会出现"大小不一"。

**规则**：
1. **同排图标必须放在固定尺寸的容器内**（`inline-size`/`block-size` 固定 + `display: grid; place-items: center`），让差异发生在容器内部而不是外部
2. **容器内 svg 用 100% 填充**（`> svg { inline-size: 100%; block-size: 100%; }`），不要依赖 Lucide 自身的 inline 尺寸
3. **同排图标避免混用"偏满"和"偏小"两类**——若必须混用，给"偏小"类加 12-15% 缩放补偿：
   ```scss
   .nav-item-icon > svg[data-glyph="star"] { transform: scale(1.15); }
   ```
4. **不要在图标上直接用 `margin` 调整视觉居中**——必须改容器
5. **生产代码示例**：`src/web-ui/src/app/components/NavPanel/NavPanel.scss` 的 `&__item-icon`，以及 `sections/workspaces/WorkspaceListSection.scss` 的 `&__workspace-item-icon`

### 6. 同一排图标尺寸跳档
侧边栏、工具栏等**视觉权重相同**的同排图标，**禁止跨档使用尺寸 token**：
- ❌ 错误：同一行混用 `size-sm` (14px) 与 `size-md` (16px)
- ✅ 正确：同排统一 `sm` 或统一 `md`；层级差异通过颜色/透明度表达，不通过尺寸

**例外**：当某一图标是"主要操作"需要强调时（例如工作区图标），允许跨一档，但必须满足：
- 同排最多一个跨档图标
- 跨档仅限相邻一档（sm → md，不能 sm → lg）
- 跨档图标必须处于行的视觉起点（最左）

## 组件映射

### Web 端
| 组件 | 图标尺寸 | 容器尺寸 |
|------|----------|----------|
| Button (默认) | `sm` (14px) | auto |
| Button (xs) | `xs` (12px) | auto |
| Button (lg) | `md` (16px) | auto |
| IconButton | `md` (16px) | 30px |
| Listbox | `sm` (14px) | auto |
| Menu | `sm` (14px) | auto |
| NavigationPanel | `sm` (14px) | auto |
| Tab | `sm` (14px) | auto |

### Mobile 端
| 组件 | 图标尺寸 | 容器尺寸 |
|------|----------|----------|
| MobileButton | `sm` (14px) | 20px |
| MobileIconButton | `md` (16px) | 44px |
| MobileListRow | `md` (16px) | 20px |
| MobileTabBar | `md` (16px) | 64×32px |
| MobileBanner | `md` (16px) | 20px |
| MobileCheckbox | `sm` (14px) | 20px |
| MobileRadioGroup | `md` (16px) | 20px |
| MobileStepper | `md` (16px) | 44px |
| MobileStatus | `lg` (24px) | 28px |
| MobileDisclosure | `md` (16px) | 20px |
| MobileTag | `sm` (14px) | 16px |

## 实施检查清单

- [ ] 所有图标使用 design-tokens 中定义的尺寸变量
- [ ] 禁止在组件中硬编码图标尺寸
- [ ] 图标容器使用 grid 居中
- [ ] 移动端触控区域 ≥ 44px
- [ ] 描边宽度使用 token 控制
- [ ] 同排图标放在固定尺寸容器内，svg 100% 填充容器
- [ ] 同排视觉权重相同的图标不跨档使用尺寸 token
- [ ] 偏小的 glyph（star/heart/bookmark/circle）通过容器而非 margin 对齐
- [ ] Lucide glyph 选择时优先选视觉占位相近的（参考第 5 节分类）
