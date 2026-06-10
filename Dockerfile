FROM node:22-alpine

RUN apk upgrade --no-cache && apk add --no-cache python3 make g++

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --build-from-source=sqlite3

COPY . .

RUN mkdir -p /usr/src/app/data && chown -R node:node /usr/src/app

USER node

EXPOSE 3000

CMD [ "node", "index.js" ]
