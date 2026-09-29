FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/knowledge ./knowledge
COPY --from=builder /app/prompts ./prompts
COPY --from=builder /app/config ./config
COPY --from=builder /app/deploy/rds-ap-southeast-1.pem ./deploy/rds-ap-southeast-1.pem
COPY --from=builder /app/next.config.ts ./next.config.ts
RUN mkdir -p /app/data && chown -R nextjs:nextjs /app/data /app/.next
USER nextjs
EXPOSE 8080
CMD ["npm", "run", "start", "--", "-p", "8080"]
