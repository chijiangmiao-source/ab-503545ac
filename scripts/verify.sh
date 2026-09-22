#!/bin/sh
# Compose verify 一次性服务入口：
#   1) 代码测试（vitest）
#   2) 构建检查（tsc 类型检查 + vite 生产构建）
#   3) HTTP 冒烟（/healthz 与首页）
#   4) 三个规定场景的显式断言：
#      吸收律最小割集 / 共享子门事件归属 / 超限 complexity_limit
# 任一步失败立即以非零退出码退出。
set -eu

WEB_URL="${WEB_URL:-http://web}"
FAIL=0

banner() {
    echo ""
    echo "============================================================"
    echo "  $1"
    echo "============================================================"
}

banner "1/4 代码测试（vitest 全量）"
npm test -- --run

banner "2/4 构建检查（tsc --noEmit + vite build）"
npm run build

banner "3/4 HTTP 冒烟"
# 健康检查端点必须返回 200 且正文为 ok
HEALTH="$(wget -q -O- "${WEB_URL}/healthz" || true)"
echo "GET ${WEB_URL}/healthz -> ${HEALTH}"
if [ "${HEALTH}" != "ok" ]; then
    echo "FAIL: /healthz 未返回 ok"
    FAIL=1
fi
# 首页必须包含应用挂载点
INDEX="$(wget -q -O- "${WEB_URL}/" || true)"
echo "${INDEX}" | grep -q '<div id="root"></div>' || {
    echo "FAIL: 首页缺少 #root 挂载点"
    FAIL=1
}
# 构建产物 JS 必须可访问
JS_PATH="$(echo "${INDEX}" | sed -n 's/.*src="\(\/assets\/[^"]*\.js\)".*/\1/p' | head -n1)"
echo "构建产物路径: ${JS_PATH}"
wget -q -O /dev/null "${WEB_URL}${JS_PATH}" || {
    echo "FAIL: 构建产物 JS 不可访问"
    FAIL=1
}

banner "4/4 规定场景显式断言"
# 通过 vitest 用例名过滤，确保三类场景独立执行并在报告中可见
echo "--- 4a 吸收律场景的最小割集 ---"
npx vitest run -t "吸收律"
echo "--- 4b 共享子门的事件归属 ---"
npx vitest run -t "共享子门"
echo "--- 4c 超限场景 complexity_limit ---"
npx vitest run -t "complexity_limit"

if [ "${FAIL}" -ne 0 ]; then
    echo ""
    echo "VERIFY: FAILED"
    exit 1
fi
echo ""
echo "VERIFY: ALL CHECKS PASSED"
exit 0
