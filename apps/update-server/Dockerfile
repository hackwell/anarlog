FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json tsconfig.build.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npx tsc --project tsconfig.build.json

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
