# 航天器供电故障树 · 最小割集审计

纯浏览器运行的故障树（Fault Tree Analysis）审计页：编辑基本事件、AND/OR 门与
顶事件，在本地**精确**计算包含极小割集（Minimal Cut Sets），合并重复集合、消去
全部真超集（吸收律），并把基本事件归为**必现 / 可选 / 无关**。

- 仅 TypeScript + React，构建产物为静态文件，**无业务后端、无任何在线调用**；
  断网可用，输入不离开浏览器。
- 引用关系必须构成**共享有向无环图（DAG）**；共享子门按拓扑序只计算一次，
  不会因逐条路径展开而重复计算或产生伪超集。
- 任一门规范化后超过 **2000** 个割集时显示 `complexity_limit`，并明确标注结论
  不完整——**绝不输出截断割集、不基于截断结果做事件归属**。
- 静态 Web 由 Dockerfile 多阶段构建（node 构建 → nginx 托管），Docker Compose
  发布；宿主机端口可用 `WEB_PORT` 配置；提供 `/healthz` HTTP 健康检查。
- Compose 中的 `verify` 一次性服务执行：代码测试、构建检查、HTTP 冒烟，并显式
  验证吸收律场景、共享子门事件归属与超限场景，完成后自行退出并用退出码报告。

## 本地开发

```bash
npm install
npm test          # vitest 全量测试
npm run build     # tsc --noEmit 类型检查 + vite 生产构建
npm run dev       # 本地开发服务器
npm run preview   # 预览生产构建
```

## Docker 发布

```bash
# 构建并启动（默认宿主机端口 8080）
docker compose up -d --build

# 自定义宿主机端口
WEB_PORT=9090 docker compose up -d --build

# 健康检查
curl -s http://localhost:8080/healthz   # -> ok
```

## 一次性验证服务

```bash
docker compose build verify
docker compose run --rm verify
# 全部通过时输出 "VERIFY: ALL CHECKS PASSED" 并以退出码 0 退出；
# 任一检查失败则退出码非 0，可直接用于 CI。
```

`verify` 依次执行：

1. `vitest` 全量代码测试；
2. `tsc --noEmit` 类型检查与 `vite build` 构建检查；
3. 对运行中的 `web` 服务做 HTTP 冒烟（`/healthz`、首页、构建产物 JS）；
4. 三个规定场景的独立断言：
   - 吸收律场景的最小割集（如 `AND(OR(A,B), A) = {A}`）；
   - 共享子门的事件归属（必现/可选/无关）；
   - 超限场景返回 `complexity_limit` 且不冒充完整结论。

## 输入语法

基本事件（每行一个或多个，唯一 ASCII 标识，2–30 个）：

```
BAT1_CELL_OPEN
DIODE1_OPEN, MAIN_BUS_SHORT
# # 之后为注释
```

门（每行一个，唯一标识，1–80 个；输入可为基本事件或其他门）：

```
G_BAT1_LOST = AND(BAT1_CELL_OPEN, DIODE1_OPEN)
G_BUS_TIE  : OR MAIN_BUS_SHORT RELAY_STUCK_OPEN
```

顶事件：一个门或基本事件标识。

标识规则：字母/数字/下划线/连字符，首字符为字母、数字或下划线。

### 校验与定位

非法输入会被**原样保留**，页面列出问题并可点击定位到行：

- 无法解析的门行、非法标识；
- 重复基本事件 / 重复门、事件与门标识冲突；
- 缺失引用（给出引用门与行号）；
- 自引用（单独报告，不混入环）；
- 任意长度的环（三色迭代 DFS，报告闭环路径，如 `N1 → N2 → … → N1`）；
- 数量越界、顶事件未定义、不可达门（警告）。

## 算法说明

- 基本事件不超过 30 个，单个割集用 32 位整数位掩码表示；
- OR：子门割集族取并；AND：子门割集族按分配律逐项并集；
  每步做极小化（按基数排序后删除被包含项），合并重复、消去真超集；
- 门按子先于父的拓扑序计算并记忆（共享 DAG 每个门只算一次）；
- 超限沿依赖传播：某门超限则其所有祖先门同样标记 `complexity_limit`
  并指向首个超限门，避免部分结果被当作完整结论。

## 目录结构

```
src/core/      解析、校验、割集引擎、分析编排与单元测试（纯逻辑，无 DOM）
src/ui/        React 审计页
Dockerfile     node 构建 → nginx 静态托管（含 /healthz 与容器健康检查）
nginx.conf     静态托管配置
scripts/verify.sh   Compose verify 一次性服务入口
docker-compose.yml  web 发布服务 + verify 一次性服务
```
