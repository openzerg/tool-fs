FROM oven/bun:alpine AS builder
RUN apk add --no-cache git
WORKDIR /app
COPY tool-fs/package.json tool-fs/bun.lock* ./
RUN bun install
COPY tool-fs/src/ src/
COPY tool-fs/tsconfig.json ./
RUN bun build --compile src/main.ts --outfile tool-fs

FROM docker.io/library/alpine:latest
RUN apk add --no-cache ca-certificates libstdc++
WORKDIR /app
COPY --from=builder /app/tool-fs /app/tool-fs
RUN chmod +x /app/tool-fs
EXPOSE 25010
ENTRYPOINT ["/app/tool-fs"]
