FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json *.ts ./

RUN npx tsc

CMD ["node", "dist/index.js"]
