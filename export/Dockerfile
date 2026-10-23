# The model export's pinned environment. R comes from the image digest and
# every CRAN package from Posit Package Manager's dated snapshot, so a rebuild
# installs the same versions; export.R refuses to run if any pinned version
# differs.
FROM rocker/r-ver:4.6.1@sha256:e8732fa6afb69b43ec7f22cb801f59e89e2a84c6a6b043537e7a46314770ac16

ENV CRAN_SNAPSHOT=https://packagemanager.posit.co/cran/__linux__/noble/2026-10-15

RUN Rscript -e "options(repos = c(CRAN = Sys.getenv('CRAN_SNAPSHOT'))); \
  install.packages(c('nfl4th', 'nflfastR', 'fastrmodels', 'nflreadr', 'xgboost', 'jsonlite', 'nanoparquet'))"

WORKDIR /export
COPY export.R /export/

ENTRYPOINT ["Rscript", "/export/export.R"]
