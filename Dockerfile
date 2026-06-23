FROM node:22-alpine

RUN apk upgrade --no-cache && apk add --no-cache python3 make g++

WORKDIR /usr/src/app

ARG GITHUB_TOKEN
COPY package*.json ./
RUN echo "@octopus-security:registry=https://npm.pkg.github.com" > .npmrc \
 && echo "//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}" >> .npmrc \
 && npm install --build-from-source=sqlite3 \
 && rm -f .npmrc

COPY . .

RUN mkdir -p /usr/src/app/data && chown -R node:node /usr/src/app

USER node

EXPOSE 3000

CMD [ "node", "index.js" ]
