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
  
  bioc_packages <- c("xcms", "MSnbase", "faahKO", "BiocParallel", "Biobase")
  cran_packages <- c("tidyverse", "pheatmap", "RColorBrewer", "jsonlite", "ggrepel")
  
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
  library(ggrepel)
})

# --- Initialize the final output list ---
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
is_arg_missing <- function(arg) {
  return(is.na(arg) || arg == "undefined" || arg == "null" || arg == "")
}
args <- commandArgs(trailingOnly = TRUE)

data_path_arg <- args[1]
pheno_file_arg <- args[2]

use_sample_data <- is_arg_missing(data_path_arg) || is_arg_missing(pheno_file_arg)
if (use_sample_data) {
  log_message("No command line arguments provided. Using faahKO sample data.")
  data_path <- system.file("cdf", package = "faahKO")
  file_list <- list.files(data_path, pattern = "CDF", full.names = TRUE, recursive = TRUE)
  
  pheno_data <- data.frame(
    sample_name = gsub("\\.CDF", "", basename(file_list)),
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
    pheno_data$sample_name <- tools::file_path_sans_ext(basename(pheno_data$sample_name))
    
    if (!"polarity" %in% names(pheno_data)) {
      log_message("Warning: 'polarity' column not found in metadata. Defaulting to positive mode (1).")
      pheno_data$polarity <- 1
    }
    
  }, error = function(e) {
    output_data$status <<- "error"
    output_data$error <<- paste("Failed to read input data:", e$message)
    cat(toJSON(output_data, auto_unbox = TRUE))
    quit(status = 0,save="no")
  })
}


# ============================================================================
# 3. XCMS PROCESSING (REVISED WORKFLOW)
# ============================================================================

tryCatch({
  log_message("Reading MS data files...")
  pd_files <- tools::file_path_sans_ext(basename(file_list))
  pheno_data_ordered <- pheno_data[match(pd_files, pheno_data$sample_name),]
  
  raw_data <- readMSData(files = file_list, 
                         pdata = new("AnnotatedDataFrame", pheno_data_ordered), 
                         mode = "onDisk")
  

  # --- Step 1: Find Chromatographic Peaks in each file ---
  log_message("Step 1: Finding chromatographic peaks...")
  cwp <- CentWaveParam(ppm = 25, peakwidth = c(5, 20), snthresh = 10, prefilter = c(3, 1000))
  xdata <- findChromPeaks(raw_data, param = cwp, BPPARAM = SerialParam())
  
  # --- Step 2: Align Retention Times using Obiwarp (more robust method) ---
  log_message("Step 2: Performing retention time correction with Obiwarp...")
  owp <- ObiwarpParam(binSize = 0.1)
  xdata <- adjustRtime(xdata, param = owp)
  
  # --- Step 3: Group Peaks AFTER RT correction ---
  log_message("Step 3: Grouping peaks across samples...")
  pdp <- PeakDensityParam(sampleGroups = xdata$sample_group, minFraction = 0.5, bw = 5)
  xdata <- groupChromPeaks(xdata, param = pdp)
  
  # --- Step 4: Fill in Missing Peaks ---
  log_message("Step 4: Filling missing peaks...")
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
# 4. STATISTICAL ANALYSIS (REVISED)
# ============================================================================

tryCatch({
  log_message("Starting statistical analysis...")
  stats_matrix <- feature_matrix
  stats_matrix[is.na(stats_matrix)] <- 0
  stats_matrix[stats_matrix == 0] <- 1
  log_matrix <- log2(stats_matrix)
  
  # --- PCA ---
  # <<< FIX: REMOVE FEATURES WITH ZERO VARIANCE BEFORE RUNNING PCA >>>
  # This prevents prcomp from generating NA/NaN values when scaling.
  feature_variances <- apply(log_matrix, 1, var)
  log_matrix_filtered_for_pca <- log_matrix[feature_variances > 1e-6, ]
  
  log_message(paste("Removed", nrow(log_matrix) - nrow(log_matrix_filtered_for_pca), "zero-variance features for PCA."))
  
  # Now run prcomp on the filtered matrix
  pca_res <- prcomp(t(log_matrix_filtered_for_pca), center = TRUE, scale. = TRUE)
  
  pca_df <- data.frame(
    sample_name = row.names(pca_res$x),
    PC1 = pca_res$x[, 1],
    PC2 = pca_res$x[, 2]
  )
  pca_df$sample_name <- tools::file_path_sans_ext(pca_df$sample_name)
  
  pca_df <- left_join(pca_df, pheno_data_ordered, by = "sample_name")
  percent_var <- round(100 * pca_res$sdev^2 / sum(pca_res$sdev^2), 1)
  
  # --- Differential Abundance Analysis (uses original unfiltered log_matrix) ---
  groups <- unique(pheno_data_ordered$sample_group)
  if (length(groups) != 2) stop("Metadata must contain exactly two unique groups for differential analysis.")
  
  stats_results <- apply(log_matrix, 1, function(row) {
    group1_vals <- row[pheno_data_ordered$sample_group == groups[1]]
    group2_vals <- row[pheno_data_ordered$sample_group == groups[2]]
    
    if (var(group1_vals, na.rm=TRUE) == 0 && var(group2_vals, na.rm=TRUE) == 0) return(c(log2FC = 0, p_value = 1))
    
    t_test <- t.test(group1_vals, group2_vals)
    log2FC <- mean(group1_vals, na.rm = TRUE) - mean(group2_vals, na.rm = TRUE)
    return(c(log2FC = log2FC, p_value = t_test$p.value))
  })
  stats_results <- as.data.frame(t(stats_results))
  stats_results$feature <- rownames(feature_matrix)
  stats_results$p_adj <- p.adjust(stats_results$p_value, method = "fdr")
  
  final_stats_table <- as.data.frame(feature_definitions) %>%
    rownames_to_column("feature") %>%
    select(feature, mzmed, rtmed) %>%
    inner_join(stats_results, by = "feature")
  
  output_data$results$stats_table <- final_stats_table
  
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
# (No changes in this section)
gg_to_base64 <- function(gg, width = 8, height = 6) {
  temp_file <- tempfile(fileext = ".png")
  ggsave(temp_file, plot = gg, width = width, height = height, dpi = 150)
  base64_string <- base64enc::base64encode(temp_file)
  unlink(temp_file)
  return(paste0("data:image/png;base64,", base64_string))
}

tryCatch({
  log_message("Generating plots...")
  
  # --- PCA Plot, Volcano Plot, Metabolite Map ---
  p_pca <- ggplot(pca_df, aes(x = PC1, y = PC2, color = sample_group, label = sample_name)) +
    geom_point(size = 5, alpha = 0.8) + ggrepel::geom_text_repel(size = 3) +
    labs(title = "Principal Component Analysis (PCA)", x = paste0("PC1 (", percent_var[1], "%)"), y = paste0("PC2 (", percent_var[2], "%)"), color = "Group") +
    theme_bw() + scale_color_brewer(palette = "Set1")
  output_data$results$pca_plot_b64 <- gg_to_base64(p_pca)
  
  volcano_df <- final_stats_table %>% mutate(significant = ifelse(p_adj < 0.05 & abs(log2FC) > 1, "Significant", "Not Significant"))
  p_volcano <- ggplot(volcano_df, aes(x = log2FC, y = -log10(p_adj))) +
    geom_point(aes(color = significant), alpha = 0.6) + scale_color_manual(values = c("Significant" = "red", "Not Significant" = "grey")) +
    labs(title = "Volcano Plot", x = "log2(Fold Change)", y = "-log10(Adjusted p-value)") +
    theme_bw() + theme(legend.position = "none")
  output_data$results$volcano_plot_b64 <- gg_to_base64(p_volcano)
  
  log_message("Generating Metabolite Map (RT vs m/z)...")
  plot_data <- final_stats_table %>% mutate(log2FC_clamped = pmax(-4, pmin(4, log2FC)), neg_log10_padj = -log10(p_adj))
  p_metmap <- ggplot(plot_data, aes(x = rtmed / 60, y = mzmed, color = log2FC_clamped, size = neg_log10_padj)) +
    geom_point(alpha = 0.7) + scale_color_gradient2(low = "blue", mid = "white", high = "red", midpoint = 0, name = "log2(Fold Change)") +
    scale_size_continuous(range = c(1, 10), name = "-log10(Adj. p-value)") +
    labs(title = "Metabolite Map", x = "Retention Time (minutes)", y = "m/z") + theme_bw()
  output_data$results$metabolite_map_b64 <- gg_to_base64(p_metmap, width = 10, height = 7)
  
  # ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  # >>> MODIFIED: GENERATE GRID PLOTS FOR BOTH EIC AND SPECTRA FOR EACH FEATURE <<<
  # ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  log_message("Generating EIC and Spectra grids for top 5 significant features...")
  
  top_features <- final_stats_table %>%
    filter(p_adj < 0.05) %>%
    arrange(p_adj) %>%
    head(5)
  
  if (nrow(top_features) > 0) {
    output_data$results$top_feature_plots <- list()
    
    for(i in 1:nrow(top_features)) {
      feature_id <- top_features$feature[i]
      feat_info <- top_features[i, ]
      log_message(paste0("... Plotting feature ", i, "/", nrow(top_features), ": ", feature_id))
      
      # --- 1. Generate the EIC Grid Plot (as before) ---
      eic_b64 <- NULL
      rt_range <- c(feat_info$rtmed - 15, feat_info$rtmed + 15)
      eic_data <- chromatogram(xdata, rt = rt_range, mz = feat_info$mzmed, BPPARAM = SerialParam())
      
      eic_df_list <- lapply(seq_along(eic_data), function(j) {
        df <- data.frame(rt = rtime(eic_data[[j]]), intensity = intensity(eic_data[[j]]))
        df$sample_name <- pData(eic_data)$sample_name[j]
        df$sample_group <- pData(eic_data)$sample_group[j]
        return(df)
      })
      eic_df <- dplyr::bind_rows(eic_df_list)
      
      if (nrow(eic_df) > 0) {
        p_eic <- ggplot(eic_df, aes(x = rt, y = intensity, color = sample_group)) +
          geom_line(linewidth = 1, na.rm = TRUE) + 
          facet_wrap(~ sample_name, ncol = 4, scales = "free_y") + 
          scale_color_brewer(palette = "Set1", name = "Group") +
          labs(title = paste("EIC for Feature:", feature_id), subtitle = paste("m/z ~", round(feat_info$mzmed, 4)), x = "Retention Time (seconds)", y = "Intensity") +
          theme_bw() + theme(legend.position = "bottom", strip.text = element_text(size = 8))
        eic_b64 <- gg_to_base64(p_eic, width = 10, height = 8)
      }
      
      # --- 2. Generate the Mass Spectrum Grid Plot ---
      spectrum_b64 <- NULL
      
      # Loop through every file to get its spectrum
      spectrum_df_list <- lapply(seq_along(fileNames(xdata)), function(j) {
        ms_file <- mzR::openMSfile(fileNames(xdata)[j])
        scan_headers <- mzR::header(ms_file)
        
        # Find the scan closest to the feature's retention time
        closest_scan_idx <- which.min(abs(scan_headers$retentionTime - feat_info$rtmed))
        peak_data <- mzR::peaks(ms_file, closest_scan_idx)
        mzR::close(ms_file)
        
        if (nrow(peak_data) > 0) {
          df <- as.data.frame(peak_data)
          colnames(df) <- c("mz", "intensity")
          # Add the sample metadata
          df$sample_name <- pData(xdata)$sample_name[j]
          df$sample_group <- pData(xdata)$sample_group[j]
          return(df)
        } else {
          return(NULL) # Return NULL if no peaks found
        }
      })
      # Combine the list of data.frames into a single one, removing any NULLs
      spectrum_df <- dplyr::bind_rows(spectrum_df_list)
      
      if (!is.null(spectrum_df) && nrow(spectrum_df) > 0) {
        p_spectrum <- ggplot(spectrum_df, aes(x = mz, y = intensity, color = sample_group)) +
          geom_segment(aes(xend = mz, yend = 0)) +
          # Use facets to create a grid of plots
          facet_wrap(~ sample_name, ncol = 4, scales = "free_y") +
          geom_vline(xintercept = feat_info$mzmed, color = "red", linetype = "dashed", linewidth=0.5) +
          scale_color_brewer(palette = "Set1", guide = "none") + # Hide legend, color is intuitive
          labs(
            title = paste("Mass Spectra for Feature:", feature_id),
            subtitle = paste("Spectra taken near RT", round(feat_info$rtmed, 1), "s"),
            x = "m/z",
            y = "Intensity"
          ) +
          theme_bw() + theme(strip.text = element_text(size = 8))
        
        spectrum_b64 <- gg_to_base64(p_spectrum, width = 10, height = 8)
      }
      
      output_data$results$top_feature_plots[[feature_id]] <- list(
        eic_plot_b64 = eic_b64,
        spectrum_plot_b64 = spectrum_b64
      )
    }
  } else {
    log_message("No significant features (p_adj < 0.05) found to generate detailed plots.")
  }
  
  log_message("Plot generation complete.")
}, error = function(e) {
  output_data$status <<- "error"
  output_data$error <<- paste("Error during plot generation:", e$message)
})


# ============================================================================
# 6. FINALIZE AND OUTPUT JSON
# ============================================================================
output_data$status <- ifelse(is.null(output_data$error), "success", "error")
cat(toJSON(output_data, auto_unbox = TRUE, pretty = TRUE))

