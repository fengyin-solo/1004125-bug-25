# 部署构建：先按 .env.production 打出生产包，再用 vite preview 提供服务，
# 与本地开发共用同一份示例数据与初始化逻辑。
FROM node:20-alpine AS build
WORKDIR /srv/web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /srv/web
ENV NODE_ENV=production
COPY --from=build /srv/web/package.json ./
COPY --from=build /srv/web/node_modules ./node_modules
COPY --from=build /srv/web/dist ./dist
EXPOSE 5173
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]
