# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
#
#        GC-MS Data Analysis API Script for Express.js
#
#   This script is designed for non-interactive execution. It takes file paths
#   as command-line arguments, performs the XCMS analysis, generates plots
#   as Base64 encoded strings, and outputs all results as a single JSON
#   string to standard output.
#
# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

# ============================================================================
# 1. SETUP & INITIALIZATION
# ============================================================================
setwd("~/projects/kintagen/server/")
# Suppress startup messages for a cleaner API output
suppressPackageStartupMessages({
  if (!requireNamespace("BiocManager", quietly = TRUE)) install.packages("BiocManager", repos = "https://cloud.r-project.org")
  
  bioc_packages <- c("xcms", "MSnbase", "faahKO", "BiocParallel")
  cran_packages <- c("tidyverse", "pheatmap", "RColorBrewer", "jsonlite")
  
  for (pkg in bioc_packages) {
    if (!requireNamespace(pkg, quietly = TRUE)) BiocManager::install(pkg, update = FALSE)
  }
  for (pkg in cran_packages) {
    if (!require(pkg, character.only = TRUE)) install.packages(pkg, repos = "https://cloud.r-project.org")
  }
  
  library(xcms)
  library(MSnbase)
  library(faahKO)
  library(mzR)
  library(tidyverse)
  library(pheatmap)
  library(RColorBrewer)
  library(BiocParallel)
  library(jsonlite)
})

# --- Initialize the final output list ---
# This will be converted to JSON at the end.
output_data <- list(
  status = "processing",
  error = NULL,
  log = c(),
  results = list()
)

# --- Function to log messages ---
log_message <- function(msg) {
  message(msg) # sends to stderr
  output_data$log <<- c(output_data$log, msg)
}

# ============================================================================
# 2. HANDLE INPUT ARGUMENTS
# ============================================================================
# --- Helper function to check for missing/null/undefined arguments ---
is_arg_missing <- function(arg) {
  # Returns TRUE if the argument is missing, NA, or the string "undefined" or "null"
  return(is.na(arg) || arg == "undefined" || arg == "null")
}
args <- commandArgs(trailingOnly = TRUE)

# Expects: Rscript run_xcms_api.R /path/to/data /path/to/metadata.csv
data_path_arg <- args[1]
pheno_file_arg <- args[2]

# Use the robust check for both arguments
use_sample_data <- is_arg_missing(data_path_arg) || is_arg_missing(pheno_file_arg)
if (use_sample_data) {
  log_message("No command line arguments provided. Using faahKO sample data.")
  data_path <- system.file("cdf", package = "faahKO")
  file_list <- list.files(data_path, pattern = "CDF", full.names = TRUE, recursive = TRUE)
  pheno_data <- data.frame(
    sample_name = basename(file_list),
    sample_group = c(rep("KO", 6), rep("WT", 6)),
    polarity = 1,
    stringsAsFactors = FALSE
  )
} else {
  log_message(paste("Using data from directory:", data_path_arg))
  log_message(paste("Using metadata from file:", pheno_file_arg))
  tryCatch({
    data_path <- data_path_arg
    file_list <- list.files(data_path, pattern = "\\.mzML$|\\.mzXML$|\\.CDF$", full.names = TRUE, ignore.case = TRUE, recursive = TRUE)
    if (length(file_list) == 0) stop("No data files (.mzML, .mzXML, .CDF) found in the specified directory.")
    
    pheno_data <- read.csv(pheno_file_arg, stringsAsFactors = FALSE)
    # Add required polarity column if it doesn't exist
    if (!"polarity" %in% names(pheno_data)) {
      pheno_data$polarity <- 1 # Assume positive mode
    }
  }, error = function(e) {
    output_data$status <<- "error"
    output_data$error <<- paste("Failed to read input data:", e$message)
    cat(toJSON(output_data, auto_unbox = TRUE))
    quit(status = 0,save="no")
  })
}


# ============================================================================
# 3. XCMS PROCESSING
# ============================================================================

tryCatch({
  log_message("Starting XCMS processing...")
  raw_data <- readMSData(files = file_list, pdata = Biobase::AnnotatedDataFrame(pheno_data), mode = "onDisk")
  
  cwp <- CentWaveParam(ppm = 25, peakwidth = c(5, 20), snthresh = 10, prefilter = c(3, 1000))
  xdata <- findChromPeaks(raw_data, param = cwp)
  
  pdp <- PeakDensityParam(sampleGroups = xdata$sample_group, minFraction = 0.5, bw = 5)
  xdata <- groupChromPeaks(xdata, param = pdp)
  
  pgp <- PeakGroupsParam(minFraction = 0.7, span = 0.4)
  xdata <- adjustRtime(xdata, param = pgp)
  
  xdata <- groupChromPeaks(xdata, param = pdp)
  
  fcp <- FillChromPeaksParam(expandMz = 0, expandRt = 0, ppm = 5)
  xdata <- fillChromPeaks(xdata, param = fcp)
  
  feature_matrix <- featureValues(xdata, value = "into")
  feature_definitions <- featureDefinitions(xdata)
  log_message(paste("XCMS processing complete. Found", nrow(feature_matrix), "features."))
}, error = function(e) {
  output_data$status <<- "error"
  output_data$error <<- paste("Error during XCMS processing:", e$message)
  cat(toJSON(output_data, auto_unbox = TRUE))
  quit(status = 0,save="no")
})


# ============================================================================
# 4. STATISTICAL ANALYSIS
# ============================================================================

tryCatch({
  log_message("Starting statistical analysis...")
  stats_matrix <- feature_matrix
  stats_matrix[is.na(stats_matrix)] <- 0
  stats_matrix[stats_matrix == 0] <- 1
  log_matrix <- log2(stats_matrix)
  
  # --- PCA ---
  pca_res <- prcomp(t(log_matrix), center = TRUE, scale. = TRUE)
  pca_df <- data.frame(
    sample_name = rownames(pca_res$x),
    PC1 = pca_res$x[, 1],
    PC2 = pca_res$x[, 2]
  )
  pca_df <- left_join(pca_df, pheno_data, by = "sample_name")
  percent_var <- round(100 * pca_res$sdev^2 / sum(pca_res$sdev^2), 1)
  
  # --- Differential Abundance Analysis ---
  stats_results <- apply(log_matrix, 1, function(row) {
    # Dynamically find groups from pheno_data
    groups <- unique(pheno_data$sample_group)
    group1_vals <- row[pheno_data$sample_group == groups[1]]
    group2_vals <- row[pheno_data$sample_group == groups[2]]
    
    t_test <- t.test(group1_vals, group2_vals)
    log2FC <- mean(group1_vals, na.rm = TRUE) - mean(group2_vals, na.rm = TRUE)
    return(c(log2FC = log2FC, p_value = t_test$p.value))
  })
  stats_results <- as.data.frame(t(stats_results))
  stats_results$feature <- rownames(feature_matrix)
  stats_results$p_adj <- p.adjust(stats_results$p_value, method = "fdr")
  
  # Merge with feature definitions for the final table
  final_stats_table <- as.data.frame(feature_definitions) %>%
    rownames_to_column("feature") %>%
    select(feature, mzmed, rtmed) %>%
    inner_join(stats_results, by = "feature")
  
  output_data$results$stats_table <- final_stats_table
  
  top_features <- final_stats_table %>%
    filter(abs(log2FC) > 1 & p_adj < 0.05) %>%
    arrange(p_adj)
  
  log_message("Statistical analysis complete.")
}, error = function(e) {
  output_data$status <<- "error"
  output_data$error <<- paste("Error during statistical analysis:", e$message)
  cat(toJSON(output_data, auto_unbox = TRUE))
  quit(status = 0,save="no")
})


# ============================================================================
# 5. GENERATE PLOTS AS BASE64 STRINGS
# ============================================================================

# --- Function to save a ggplot and return its Base64 string ---
gg_to_base64 <- function(gg, width = 7, height = 5) {
  temp_file <- tempfile(fileext = ".png")
  ggsave(temp_file, plot = gg, width = width, height = height, dpi = 150)
  base64_string <- base64enc::base64encode(temp_file)
  unlink(temp_file)
  return(paste0("data:image/png;base64,", base64_string))
}

tryCatch({
  log_message("Generating plots...")
  
  # --- PCA Plot ---
  p_pca <- ggplot(pca_df, aes(x = PC1, y = PC2, color = sample_group)) +
    geom_point(size = 4, alpha = 0.8) +
    labs(title = "Principal Component Analysis (PCA)",
         x = paste0("PC1 (", percent_var[1], "%)"),
         y = paste0("PC2 (", percent_var[2], "%)"),
         color = "Group") +
    theme_bw() + scale_color_brewer(palette = "Set1")
  output_data$results$pca_plot_b64 <- gg_to_base64(p_pca)
  
  # --- Volcano Plot ---
  volcano_df <- final_stats_table %>%
    mutate(significant = ifelse(p_adj < 0.05 & abs(log2FC) > 1, "Yes", "No"))
  
  p_volcano <- ggplot(volcano_df, aes(x = log2FC, y = -log10(p_adj))) +
    geom_point(aes(color = significant), alpha = 0.6) +
    scale_color_manual(values = c("Yes" = "red", "No" = "grey")) +
    labs(title = "Volcano Plot", x = "log2(Fold Change)", y = "-log10(Adjusted p-value)") +
    theme_bw() + theme(legend.position = "none")
  output_data$results$volcano_plot_b64 <- gg_to_base64(p_volcano)
  
  # --- Top Feature Inspection ---
  if (nrow(top_features) > 0) {
    top_feature_id <- top_features$feature[1]
    
    # --- EIC Plot ---
    feat_info <- featureDefinitions(xdata)[top_feature_id, ]
    mz_range <- c(feat_info$mzmed - 0.005, feat_info$mzmed + 0.005)
    rt_range <- c(feat_info$rtmed - 3, feat_info$rtmed + 3)
    eic_data <- chromatogram(xdata, mz = mz_range, rt = rt_range)
    
    # Create a temp file for base R plots
    temp_eic_file <- tempfile(fileext = ".png")
    png(temp_eic_file, width = 7, height = 5, units = "in", res = 150)
    plot(eic_data, col = brewer.pal(n_distinct(eic_data$sample_group), "Set1")[as.factor(eic_data$sample_group)], peakBg = NA)
    title(main = paste("EIC for Top Feature:", top_feature_id))
    dev.off()
    output_data$results$eic_plot_b64 <- paste0("data:image/png;base64,", base64enc::base64encode(temp_eic_file))
    unlink(temp_eic_file)
    
    # --- Spectrum Plot (using mzR) ---
    intensities <- feature_matrix[top_feature_id, ]
    best_sample_idx <- which.max(intensities)
    best_file <- file_list[best_sample_idx]
    target_rt <- feat_info$rtmed
    
    ms_file <- mzR::openMSfile(best_file)
    scan_headers <- mzR::header(ms_file)
    closest_scan_idx <- which.min(abs(scan_headers$retentionTime - target_rt))
    peak_data <- mzR::peaks(ms_file, closest_scan_idx)
    mzR::close(ms_file)
    
    if (nrow(peak_data) > 0) {
      temp_spec_file <- tempfile(fileext = ".png")
      png(temp_spec_file, width = 7, height = 5, units = "in", res = 150)
      plot(peak_data, type = "h", col = "blue", xlab = "m/z", ylab = "Intensity",
           main = paste("Representative Spectrum for", top_feature_id))
      dev.off()
      output_data$results$spectrum_plot_b64 <- paste0("data:image/png;base64,", base64enc::base64encode(temp_spec_file))
      unlink(temp_spec_file)
    }
  }
  log_message("Plot generation complete.")
}, error = function(e) {
  output_data$status <<- "error"
  output_data$error <<- paste("Error during plot generation:", e$message)
  # Don't quit, just report the error and return what we have
})


# ============================================================================
# 6. FINALIZE AND OUTPUT JSON
# ============================================================================
output_data$status <- ifelse(is.null(output_data$error), "success", "error")
# Use auto_unbox to prevent single values from being in arrays, e.g., "status": ["success"]
cat(toJSON(output_data, auto_unbox = TRUE, pretty = TRUE))
