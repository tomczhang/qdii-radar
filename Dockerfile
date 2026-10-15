FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4387 DATA_DIR=/app/.data
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p .data && chown node:node .data
COPY --from=build /app/dist ./dist
COPY server ./server
USER node
EXPOSE 4387
VOLUME ["/app/.data"]
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:4387/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
