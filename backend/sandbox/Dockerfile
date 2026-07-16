# Sandbox image for executing Code-Builder-generated pandas cells.
# Real isolation, not a subprocess with limits: run with --network none,
# --cap-drop=ALL, --read-only root fs, a non-root user, and per-container
# CPU/memory/pids limits (all applied by sandbox_runner.py at `docker run`
# time, not baked into this image).
FROM python:3.12-slim

# Only what kernel_runner.py actually imports — keep the image lean and the
# build fast. No flask/anthropic/extraction deps; this image never talks to
# the network at runtime anyway (--network none).
RUN pip install --no-cache-dir \
    pandas>=2.0 \
    numpy>=1.26 \
    scipy>=1.11 \
    statsmodels>=0.14 \
    scikit-learn>=1.4 \
    lifelines>=0.29 \
    seaborn>=0.13 \
    matplotlib>=3.8 \
    pingouin>=0.5 \
    umap-learn>=0.5 \
    biopython>=1.83

# Non-root image default (sandbox_runner.py actually runs the container as
# the HOST user's uid:gid, not this one, so bind-mounted output files come
# out owned by you — this account only matters for files baked into the
# image itself). useradd -m defaults to a 0700 home dir, which would block
# that dynamic host uid from even traversing into it — force it world-
# readable/executable so "docker run --user <host-uid>:<host-gid>" can still
# read kernel_runner.py regardless of which uid that turns out to be.
RUN useradd -m -u 1000 sandbox \
    && chmod 755 /home/sandbox
COPY kernel_runner.py /home/sandbox/kernel_runner.py
RUN chmod 644 /home/sandbox/kernel_runner.py

WORKDIR /home/sandbox
# Both matplotlib and numba (umap-learn's JIT backend) want to write a cache
# next to package source or in $HOME by default — both are on the read-only
# root fs here, so redirect both onto the writable /tmp tmpfs.
ENV MPLCONFIGDIR=/tmp/mplconfig
ENV NUMBA_CACHE_DIR=/tmp/numba_cache
ENTRYPOINT ["python", "-u", "kernel_runner.py"]
