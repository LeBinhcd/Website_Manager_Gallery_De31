FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && mkdir -p /app/uploads /app/logs && chown -R node:node /app/uploads /app/logs
COPY src ./src
COPY views ./views
COPY public ./public
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
