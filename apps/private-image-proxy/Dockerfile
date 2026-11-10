FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./server.mjs

ENV NODE_ENV=production
ENV PORT=3002
USER node
EXPOSE 3002
CMD ["node", "server.mjs"]
