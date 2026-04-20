FROM oven/bun:alpine AS builder
RUN apk add --no-cache git
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install
COPY src/ src/
COPY tsconfig.json ./
RUN bun build --compile src/main.ts --outfile tool-fs

FROM docker.io/library/alpine:latest
RUN apk add --no-cache ca-certificates libstdc++
WORKDIR /app
COPY --from=builder /app/tool-fs /app/tool-fs
RUN chmod +x /app/tool-fs
EXPOSE 25010
ENTRYPOINT ["/app/tool-fs"]
