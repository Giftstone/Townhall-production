# Townhall – single production image (API + built React SPA)

# ----- 1) Build frontend -----
FROM node:20-alpine AS client-build
WORKDIR /client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ----- 2) API runtime -----
FROM node:20-alpine
WORKDIR /app

COPY server/package*.json ./
# install (not ci) so new deps like multer are picked up even if lock lags
RUN npm install --omit=dev

COPY server/ ./
COPY --from=client-build /client/dist ./public

RUN mkdir -p /app/uploads \
  && addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001 \
  && chown -R nodejs:nodejs /app
USER nodejs

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
