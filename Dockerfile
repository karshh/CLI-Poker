FROM node:26.10.0-trixie-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npm test

FROM node:26.10.0-trixie-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json

USER node
ENTRYPOINT ["node", "dist/src/index.js"]
