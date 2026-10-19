# 预算分配图

预算分配采用环形饼图，深色表示预计可投入，浅色表示该指数的缺口；不能归属指数的未分配预算单列灰色。所有占比均以总预算为分母。图形与列表可悬停、键盘聚焦或点击联动，中心显示当前分块金额。减少动态效果设置关闭入场与缩放。

样式与交互参考 React Bits 官方 [AnimatedContent](https://reactbits.dev/animations/animated-content) 的短距离缩放、透明度入场与 `power3.out` 节奏。参考来源通过官方 `@react-bits/AnimatedContent-JS-CSS` 注册表核查。React Bits 注册表没有现成饼图；此处 SVG 和 CSS 是项目自身实现，没有引入 GSAP，也不把自定义图表标为 React Bits 官方组件。
