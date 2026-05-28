# ========== Stage 1: Build ==========
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY src ./src
COPY scripts ./scripts

RUN npm run build

# ========== Stage 2: Production ==========
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache ffmpeg

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Tạo user không phải root để chạy ứng dụng
RUN addgroup -S appgroup \
  && adduser -S appuser -G appgroup \
  && mkdir -p /app/logs \
  && chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000

CMD ["node", "-r", "module-alias/register", "dist/server.js"]
