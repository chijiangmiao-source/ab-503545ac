# ---- 构建阶段：纯静态前端，仅在构建期使用 node，运行期无 node ----
FROM node:20-alpine AS builder
WORKDIR /app

# 优先复制依赖清单以利用层缓存
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# 类型检查 + 生产构建（产物仅为静态文件）
RUN npm run build

# ---- 运行阶段：nginx 托管静态文件，无任何业务后端 ----
FROM nginx:1.27-alpine AS runtime

# 精简默认配置：SPA 回退 + /healthz 健康检查端点
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# 容器级 HTTP 健康检查
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O- http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
