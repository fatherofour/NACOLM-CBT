FROM golang:1.25 AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/server ./cmd/server
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/gen-cert ./cmd/gen-cert

FROM gcr.io/distroless/static-debian12
COPY --from=builder /out/server /server
COPY --from=builder /out/gen-cert /gen-cert
EXPOSE 8080
ENTRYPOINT ["/server"]
