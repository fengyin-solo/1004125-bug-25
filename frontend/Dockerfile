# 构建阶段：按 lockfile 严格安装依赖，产出生产构建。
# 依赖版本以 package-lock.json 为准，本地与部署构建解析出同一份依赖。
FROM node:20-alpine AS build
WORKDIR /srv/web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 运行阶段：伺服生产构建产物，与本地 `npm run preview` 行为一致。
FROM node:20-alpine
WORKDIR /srv/web
ENV NODE_ENV=production
COPY --from=build /srv/web/package.json /srv/web/package-lock.json ./
COPY --from=build /srv/web/node_modules ./node_modules
COPY --from=build /srv/web/dist ./dist
EXPOSE 5173
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
