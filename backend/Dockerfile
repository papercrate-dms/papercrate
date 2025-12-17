# ------------------------------------------------------------------------------
# Global Arguments
# ------------------------------------------------------------------------------
ARG RUST_VERSION=1
ARG RUNTIME_DEPS="ocrmypdf tesseract-ocr ghostscript qpdf ffmpeg"

# ------------------------------------------------------------------------------
# Base Stage: Shared Logic (PDFium)
# ------------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM rust:${RUST_VERSION}-slim AS base
ARG RUNTIME_DEPS
WORKDIR /app

# Install PDFium
ARG TARGETARCH
RUN set -eux; \
    case "${TARGETARCH}" in \
        amd64|x86_64) pdfium_package=pdfium-linux-x64.tgz ;; \
        arm64|aarch64) pdfium_package=pdfium-linux-arm64.tgz ;; \
        *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    apt-get update && apt-get install -y --no-install-recommends curl ca-certificates; \
    curl -fsSL "https://github.com/bblanchon/pdfium-binaries/releases/latest/download/${pdfium_package}" -o /tmp/pdfium.tgz; \
    mkdir -p /tmp/pdfium; \
    tar -xzf /tmp/pdfium.tgz -C /tmp/pdfium --strip-components=1; \
    pdfium_so="$(find /tmp/pdfium -name libpdfium.so -type f | head -n1)"; \
    [ -n "${pdfium_so}" ]; \
    mkdir -p /usr/local/lib; \
    cp "${pdfium_so}" /usr/local/lib/libpdfium.so; \
    rm -rf /tmp/pdfium.tgz /tmp/pdfium

# Install common build dependencies AND runtime deps (for dev/testing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    libssl-dev \
    libpq-dev \
    libjpeg-dev \
    libpng-dev \
    zlib1g-dev \
    ca-certificates \
    curl \
    git \
    ${RUNTIME_DEPS} \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------------------------
# Development Stage
# ------------------------------------------------------------------------------
# ------------------------------------------------------------------------------
# Chef Stage: Install cargo-chef (used for caching)
# ------------------------------------------------------------------------------
FROM base AS chef
RUN cargo install cargo-chef

# ------------------------------------------------------------------------------
# Planner Stage: Compute lockfile recipe
# ------------------------------------------------------------------------------
FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

# ------------------------------------------------------------------------------
# Cacher Stage: Build dependencies only
# ------------------------------------------------------------------------------
FROM chef AS cacher
ENV CARGO_TARGET_DIR=/cargo-target
COPY --from=planner /app/recipe.json recipe.json
# Build dependencies (including test deps) based on the recipe
RUN cargo chef cook --tests --recipe-path recipe.json

# ------------------------------------------------------------------------------
# Development Stage
# ------------------------------------------------------------------------------
FROM base AS development
WORKDIR /app

# Install additional development tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    procps \
    postgresql-client \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# Install diesel-cli for migrations
RUN cargo install diesel_cli --no-default-features --features postgres

# Install cargo-watch for hot reloading
RUN cargo install cargo-watch

# Setup Cache
ENV CARGO_TARGET_DIR=/cargo-target
COPY --from=cacher /cargo-target /cargo-target
COPY --from=cacher /usr/local/cargo /usr/local/cargo

# Copy PDFium from base
COPY --from=base /usr/local/lib/libpdfium.so /usr/local/lib/libpdfium.so
ENV LD_LIBRARY_PATH=/usr/local/lib
RUN ldconfig

ENV RUST_LOG=info
CMD ["./run-dev.sh"]

# ------------------------------------------------------------------------------
# Production Builder Stage
# ------------------------------------------------------------------------------
# We restart from base to keep the image clean, but copy PDFium if needed for build/tests
FROM base AS builder
ARG TARGETARCH
ENV TARGETARCH=${TARGETARCH}
WORKDIR /app

# Resolve cross-compilation target script
RUN cat <<'SCRIPT' >/usr/local/bin/resolve-target.sh
#!/bin/sh
set -e
case "$1" in
  amd64) echo x86_64-unknown-linux-gnu ;;
  arm64) echo aarch64-unknown-linux-gnu ;;
  *) echo "Unsupported TARGETARCH: $1" >&2; exit 1 ;;
esac
SCRIPT
RUN chmod +x /usr/local/bin/resolve-target.sh

# Install cross-compilation deps
ARG BUILDPLATFORM
RUN if [ "${TARGETARCH}" = "amd64" ]; then \
        echo "x86_64-linux-gnu" > /tmp/target_deb_arch; \
    elif [ "${TARGETARCH}" = "arm64" ]; then \
        echo "aarch64-linux-gnu" > /tmp/target_deb_arch; \
    else \
        echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1; \
    fi

RUN set -eux; \
    # Detect build arch (assuming debian-like names compatible with apt)
    dpkg_arch="$(dpkg --print-architecture)"; \
    target_deb_arch="$(cat /tmp/target_deb_arch)"; \
    \
    # If we are cross-compiling
    if [ "${dpkg_arch}" != "${TARGETARCH}" ]; then \
        # Map target arch to debian package arch suffix if needed, but usually apt handles :arch
        # For cross-compiling, we need to add the architecture
        dpkg --add-architecture "${TARGETARCH}"; \
        apt-get update; \
        \
        case "${TARGETARCH}" in \
            arm64) CROSS_GCC=gcc-aarch64-linux-gnu ;; \
            amd64) CROSS_GCC=gcc-x86-64-linux-gnu ;; \
        esac; \
        \
        apt-get install -y --no-install-recommends \
            "${CROSS_GCC}" \
            "libc6-dev:${TARGETARCH}" \
            "libssl-dev:${TARGETARCH}" \
            "libpq-dev:${TARGETARCH}" \
            "libjpeg-dev:${TARGETARCH}" \
            "libpng-dev:${TARGETARCH}" \
            "zlib1g-dev:${TARGETARCH}"; \
        \
        # Configure PKG_CONFIG and LINKER to find foreign libraries
        case "${TARGETARCH}" in \
            "amd64") \
                GNU_ARCH="x86_64-linux-gnu" \
                RUST_ARCH="x86_64_unknown_linux_gnu" \
                RUST_ARCH_UPPER="X86_64_UNKNOWN_LINUX_GNU" \
                ;; \
            "arm64") \
                GNU_ARCH="aarch64-linux-gnu" \
                RUST_ARCH="aarch64_unknown_linux_gnu" \
                RUST_ARCH_UPPER="AARCH64_UNKNOWN_LINUX_GNU" \
                ;; \
        esac; \
        \
        { \
            echo "export PKG_CONFIG_ALLOW_CROSS=1"; \
            echo "export PKG_CONFIG_PATH=/usr/lib/${GNU_ARCH}/pkgconfig"; \
            echo "export OPENSSL_DIR=/usr/lib/${GNU_ARCH}"; \
            echo "export OPENSSL_LIB_DIR=/usr/lib/${GNU_ARCH}"; \
            echo "export OPENSSL_INCLUDE_DIR=/usr/include/${GNU_ARCH}"; \
            echo "export CARGO_TARGET_${RUST_ARCH_UPPER}_LINKER=${GNU_ARCH}-gcc"; \
            echo "export CC_${RUST_ARCH}=${GNU_ARCH}-gcc"; \
            echo "export CXX_${RUST_ARCH}=${GNU_ARCH}-g++"; \
        } >> /etc/profile; \
    fi; \
    rm -rf /var/lib/apt/lists/*

ENV PKG_CONFIG_ALLOW_CROSS=1

COPY Cargo.toml Cargo.lock build.rs ./
COPY src ./src
COPY migrations ./migrations
COPY tests ./tests
COPY resources ./resources
COPY diesel.toml ./

RUN set -eux; \
    echo "Loading cross-compilation environment..."; \
    . /etc/profile; \
    export PATH="$PATH:/usr/local/cargo/bin"; \
    TARGET="$(/usr/local/bin/resolve-target.sh "${TARGETARCH}")"; \
    rustup target add "${TARGET}"; \
    cargo build --release --target "${TARGET}" --bin backend --bin worker --bin webdav --bin admin; \
    mkdir -p /artifacts; \
    for bin in backend worker webdav admin; do \
        cp "target/${TARGET}/release/${bin}" "/artifacts/${bin}"; \
    done

# ------------------------------------------------------------------------------
# Production Runtime Stage
# ------------------------------------------------------------------------------
FROM debian:trixie-slim AS runtime
ARG TARGETARCH
ARG RUNTIME_DEPS
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl libssl3 libpq5 libjpeg62-turbo libpng16-16 \
        ${RUNTIME_DEPS} \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/local/lib \
    && useradd --system --create-home --uid 10001 appuser

COPY --from=builder /artifacts/backend /usr/local/bin/papercrate-backend
COPY --from=builder /artifacts/worker /usr/local/bin/papercrate-worker
COPY --from=builder /artifacts/webdav /usr/local/bin/papercrate-webdav
COPY --from=builder /artifacts/admin /usr/local/bin/papercrate-admin
COPY --from=base /usr/local/lib/libpdfium.so /usr/local/lib/libpdfium.so

RUN ldconfig
COPY migrations ./migrations

ENV RUST_LOG=info
USER appuser
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/papercrate-backend"]
