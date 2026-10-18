FROM node:24-alpine
RUN apk add --no-cache unzip
WORKDIR /app
COPY src ./src
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/cloud-clock.mjs"]
