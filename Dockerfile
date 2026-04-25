FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY bin ./bin

RUN chmod +x bin/houan-mcp.mjs

ENTRYPOINT ["node", "bin/houan-mcp.mjs"]
