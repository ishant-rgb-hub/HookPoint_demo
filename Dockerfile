# Production Dockerfile for Hookpoint Evaluation Server
FROM node:22-alpine

WORKDIR /app

# Copy package definition and local package tarball
COPY package.json hookpoint-1.0.0.tgz ./
COPY packages/ ./packages/

# Install dependencies using local tarball
RUN npm install --omit=dev

# Copy application code
COPY . .

# Expose default HTTP port
EXPOSE 3000

ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

CMD ["npm", "start"]
