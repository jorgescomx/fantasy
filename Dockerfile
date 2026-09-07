# Lightweight Alpine Node.js runtime
FROM node:20-alpine

WORKDIR /app

# Install production dependencies first (optimized layer caching)
COPY app/package*.json ./
RUN npm ci --only=production

# Copy application code
COPY app/ ./

# Create data directory for runtime caches
RUN mkdir -p /app/data

# Expose Fantasy Projection Lab port
EXPOSE 4477

ENV PORT=4477 \
    NODE_ENV=production

# Built-in health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4477/health || exit 1

CMD ["node", "server.js"]
