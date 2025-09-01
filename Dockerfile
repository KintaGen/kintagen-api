# Use an official, modern R base image from the Rocker project (R version 4.3.3)
# This solves all the package version compatibility issues.
FROM rocker/r-ver:4.3.3

# The Rocker image is based on Debian, so we can still use apt-get.
# Install system dependencies required by your R packages.
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    libcurl4-openssl-dev \
    libxml2-dev \
    libssl-dev \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Pre-install all required R packages into this modern environment.
# This is done ONLY ONCE during the build process.
RUN R -e " \
    install.packages(c( \
        'drc', 'jsonlite', 'ggplot2', 'base64enc', 'Rnmr1D', 'tidyverse', \
        'argparse', 'RColorBrewer', 'ggrepel', 'pheatmap', 'zip', 'patchwork', \
        'nloptr', 'lme4', 'pbkrtest', 'quantreg', 'MatrixModels', 'car', 'scales' \
    ), Ncpus = 4); \
"

# Set a working directory inside the container.
WORKDIR /server