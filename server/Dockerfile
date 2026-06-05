FROM node:18-alpine

WORKDIR /usr/src/app

# install production deps only
COPY server/package*.json ./
RUN npm install --production

COPY server/ ./

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD [ "node", "index.js" ]
