FROM node:22-alpine

RUN apk upgrade --no-cache && apk add --no-cache python3 make g++

WORKDIR /usr/src/app

ARG NPM_TOKEN
COPY package*.json ./
RUN echo "@octopus-security:registry=https://npm.pkg.github.com" > .npmrc \
 && echo "//npm.pkg.github.com/:_authToken=${NPM_TOKEN}" >> .npmrc \
 && npm install --build-from-source=sqlite3 --legacy-peer-deps \
 && rm -f .npmrc

COPY . .

RUN mkdir -p /usr/src/app/data && chown -R node:node /usr/src/app

# Strip npm from the runtime image. Nothing here runs it — the CMD is a bare
# `node` — but Trivy reports what is PRESENT, not what is reachable, and npm
# bundles its own vulnerable tree: tar 7.5.11 (CVE-2026-59873, CRITICAL),
# pacote, sigstore, brace-expansion, picomatch, ip-address. Measured against
# node:22-alpine on 2026-09-21: 1 CRITICAL / 12 HIGH with npm, 0 / 2 without —
# 11 of those 13 findings were npm's, not Alpine's.
#
# Must run as root, so it goes above any USER line. octopus-cortex is the one
# service that keeps npm: its CVE checker shells out to `npm audit`.
# Guarded by octopus-vault/scripts/check-no-npm.mjs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

USER node

EXPOSE 3000

CMD [ "node", "index.js" ]
