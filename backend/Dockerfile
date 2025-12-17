# syntax=docker/dockerfile:1.7

ARG RUST_VERSION=1
FROM --platform=$BUILDPLATFORM rust:${RUST_VERSION}-slim AS builder
ARG TARGETARCH
ENV TARGETARCH=${TARGETARCH}
WORKDIR /app

RUN cat <<'SCRIPT' >/usr/local/bin/resolve-target.sh
#!/bin/sh
set -e
case "$1" in
  amd64)
    echo x86_64-unknown-linux-gnu
    ;;
  arm64)
    echo aarch64-unknown-linux-gnu
    ;;
  *)
    echo "Unsupported TARGETARCH: $1" >&2
    exit 1
    ;;
esac
SCRIPT
RUN chmod +x /usr/local/bin/resolve-target.sh

ENV PKG_CONFIG_ALLOW_CROSS=1 \
    CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
    PKG_CONFIG_LIBDIR_aarch64_unknown_linux_gnu=/usr/lib/aarch64-linux-gnu/pkgconfig \
    PKG_CONFIG_PATH_aarch64_unknown_linux_gnu=/usr/lib/aarch64-linux-gnu/pkgconfig \
    PKG_CONFIG_SYSROOT_DIR_aarch64_unknown_linux_gnu=/usr/aarch64-linux-gnu \
    OPENSSL_DIR_aarch64_unknown_linux_gnu=/usr/lib/aarch64-linux-gnu \
    OPENSSL_LIB_DIR_aarch64_unknown_linux_gnu=/usr/lib/aarch64-linux-gnu \
    OPENSSL_INCLUDE_DIR_aarch64_unknown_linux_gnu=/usr/include/aarch64-linux-gnu \
    CC_x86_64_unknown_linux_gnu=x86_64-linux-gnu-gcc \
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-gnu-gcc \
    PKG_CONFIG_LIBDIR_x86_64_unknown_linux_gnu=/usr/lib/x86_64-linux-gnu/pkgconfig \
    PKG_CONFIG_PATH_x86_64_unknown_linux_gnu=/usr/lib/x86_64-linux-gnu/pkgconfig \
    OPENSSL_DIR_x86_64_unknown_linux_gnu=/usr/lib/x86_64-linux-gnu \
    OPENSSL_LIB_DIR_x86_64_unknown_linux_gnu=/usr/lib/x86_64-linux-gnu \
    OPENSSL_INCLUDE_DIR_x86_64_unknown_linux_gnu=/usr/include/x86_64-linux-gnu

RUN set -eux; \
    case "${TARGETARCH}" in \
        amd64) TARGET_DEB_ARCH=amd64 ;; \
        arm64) TARGET_DEB_ARCH=arm64 ;; \
        *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    BUILD_DEB_ARCH="$(dpkg --print-architecture)"; \
    if [ "${TARGET_DEB_ARCH}" != "${BUILD_DEB_ARCH}" ]; then \
        dpkg --add-architecture "${TARGET_DEB_ARCH}"; \
    fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        build-essential \
        pkg-config \
        curl \
        libssl-dev \
        libpq-dev \
        libjpeg-dev \
        libpng-dev \
        zlib1g-dev; \
    if [ "${TARGET_DEB_ARCH}" != "${BUILD_DEB_ARCH}" ]; then \
        case "${TARGETARCH}" in \
            arm64) CROSS_GCC=gcc-aarch64-linux-gnu ;; \
            amd64) CROSS_GCC=gcc-x86-64-linux-gnu ;; \
        esac; \
        apt-get install -y --no-install-recommends \
            "${CROSS_GCC}" \
            "libc6-dev:${TARGET_DEB_ARCH}" \
            "libssl-dev:${TARGET_DEB_ARCH}" \
            "libpq-dev:${TARGET_DEB_ARCH}" \
            "libjpeg-dev:${TARGET_DEB_ARCH}" \
            "libpng-dev:${TARGET_DEB_ARCH}" \
            "zlib1g-dev:${TARGET_DEB_ARCH}"; \
    fi; \
    rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock build.rs ./
COPY src ./src
COPY migrations ./migrations
COPY tests ./tests
COPY resources ./resources
COPY diesel.toml ./

RUN set -eux; \
    TARGET="$(/usr/local/bin/resolve-target.sh "${TARGETARCH}")"; \
    rustup target add "${TARGET}"; \
    cargo build --release --target "${TARGET}" --bin backend --bin worker --bin webdav --bin admin; \
    mkdir -p /artifacts; \
    for bin in backend worker webdav admin; do \
        cp "target/${TARGET}/release/${bin}" "/artifacts/${bin}"; \
    done

RUN set -eux; \
    case "${TARGETARCH}" in \
        amd64) pdfium_package=pdfium-linux-x64.tgz ;; \
        arm64) pdfium_package=pdfium-linux-arm64.tgz ;; \
        *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/bblanchon/pdfium-binaries/releases/latest/download/${pdfium_package}" -o /tmp/pdfium.tgz; \
    mkdir -p /tmp/pdfium; \
    tar -xzf /tmp/pdfium.tgz -C /tmp/pdfium --strip-components=1; \
    pdfium_so="$(find /tmp/pdfium -name libpdfium.so -type f | head -n1)"; \
    [ -n "${pdfium_so}" ]; \
    cp "${pdfium_so}" /artifacts/libpdfium.so; \
    rm -rf /tmp/pdfium.tgz /tmp/pdfium

FROM --platform=$TARGETPLATFORM debian:trixie-slim AS runtime
ARG TARGETARCH
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libssl3 \
        libpq5 \
        libjpeg62-turbo \
        libpng16-16 \
        ocrmypdf \
        tesseract-ocr \
        ghostscript \
        qpdf \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /usr/local/lib \
    && useradd --system --create-home --uid 10001 appuser

COPY --from=builder /artifacts/backend /usr/local/bin/papercrate-backend
COPY --from=builder /artifacts/worker /usr/local/bin/papercrate-worker
COPY --from=builder /artifacts/webdav /usr/local/bin/papercrate-webdav
COPY --from=builder /artifacts/admin /usr/local/bin/papercrate-admin
COPY --from=builder /artifacts/libpdfium.so /usr/local/lib/libpdfium.so
RUN ldconfig
COPY migrations ./migrations

ENV RUST_LOG=info
USER appuser
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/papercrate-backend"]
