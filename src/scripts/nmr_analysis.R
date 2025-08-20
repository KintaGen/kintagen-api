# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
#
#        NMR Data Analysis API Script for Varian (.fid) Data using Rnmr1D
#
#   This script is designed for non-interactive execution. It takes a path
#   to a directory of sample folders and a metadata file as command-line
#   arguments, performs a metabolomics-style analysis, generates plots
#   as Base64 encoded strings, and outputs all results as a single JSON
#   string to standard output.
#
# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

# ============================================================================
# 1. SETUP & INITIALIZATION
# ============================================================================

# --- Suppress startup messages for a cleaner API output ---
suppressPackageStartupMessages({
  # CRAN packages
  cran_packages <- c("Rnmr1D", "tidyverse", "jsonlite", "argparse", "RColorBrewer", "ggrepel")
  for (pkg in cran_packages) {
    if (!require(pkg, character.only = TRUE)) {
      install.packages(pkg, repos = "https://cloud.r-project.org")
      library(pkg, character.only = TRUE)
    }
  }
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

# --- Function to save a ggplot and return its Base64 string ---
gg_to_base64 <- function(gg, width = 7, height = 5) {
  temp_file <- tempfile(fileext = ".png")
  ggsave(temp_file, plot = gg, width = width, height = height, dpi = 150)
  base64_string <- base64enc::base64encode(temp_file)
  unlink(temp_file)
  return(paste0("data:image/png;base64,", base64_string))
}

# ============================================================================
# 2. MAIN SCRIPT LOGIC
# ============================================================================
tryCatch({

  # --- Handle Input Arguments ---
  parser <- ArgumentParser(description="NMR Data Analysis API Script")
  parser$add_argument("data_path", help="Path to the directory containing sample folders (each with a .fid).")
  parser$add_argument("metadata_file", help="Path to the metadata CSV file.")
  args <- parser$parse_args()
  
  log_message(paste("Reading data from:", args$data_path))
  log_message(paste("Reading metadata from:", args$metadata_file))

  # --- Run the Rnmr1D Workflow ---
  # The doc.from argument tells Rnmr1D to read the metadata from a file.
  # The path argument points to the parent directory of the .fid folders.
  nmr_data <- Rnmr1D::do_processing(
    path = args$data_path,
    doc.from = "file",
    path.doc = args$metadata_file,
    n_threads = 2 # Limit threads for stability in a server environment
  )

  log_message("Raw data processing complete (FT, Phasing, Baseline).")

  # --- Perform Binning ---
  # This creates the feature matrix (samples x bins)
  # By default, it uses intelligent adaptive binning, which is very powerful.
  nmr_data <- Rnmr1D::do_bucketing(
    nmr_data,
    n_threads = 2
  )
  feature_matrix <- nmr_data$bucket_data
  # The columns are the bin centers (ppm), rows are sample IDs
  log_message(paste("Binning complete. Created feature matrix with shape:", paste(dim(feature_matrix), collapse = "x")))

  # --- Normalization ---
  # Probabilistic Quotient Normalization (PQN) is a robust method for metabolomics
  nmr_data <- Rnmr1D::do_normalisation(nmr_data, "pqn")
  norm_matrix <- nmr_data$norm_data
  log_message("Normalization (PQN) complete.")
  
  # --- Statistical Analysis ---
  log_message("Starting statistical analysis...")
  metadata_df <- nmr_data$metadata
  groups <- unique(metadata_df$sample_group)
  if (length(groups) != 2) stop("Metadata must contain exactly two unique groups for t-tests.")
  
  # 1. PCA
  pca_res <- prcomp(norm_matrix, center = TRUE, scale. = TRUE)
  pca_df <- data.frame(
    sample_id = rownames(pca_res$x),
    PC1 = pca_res$x[, 1],
    PC2 = pca_res$x[, 2]
  )
  pca_df <- pca_df %>% left_join(metadata_df, by = "sample_id")
  percent_var <- round(100 * pca_res$sdev^2 / sum(pca_res$sdev^2), 1)

  # 2. T-tests per bin
  stats_results <- apply(norm_matrix, 2, function(bin_col) {
    t_test <- t.test(bin_col ~ metadata_df$sample_group)
    log2FC <- log2( (mean(bin_col[metadata_df$sample_group == groups[1]]) + 1e-9) / 
                    (mean(bin_col[metadata_df$sample_group == groups[2]]) + 1e-9) )
    return(c(log2FC = log2FC, p_value = t_test$p.value))
  })
  stats_df <- as.data.frame(t(stats_results))
  stats_df$ppm <- as.numeric(colnames(norm_matrix))
  stats_df$p_adj <- p.adjust(stats_df$p_value, method = "fdr")
  
  output_data$results$stats_table <- stats_df
  log_message("Statistical analysis complete.")

  # --- Generate Plots ---
  log_message("Generating plots...")
  # PCA Plot
  p_pca <- ggplot(pca_df, aes(x = PC1, y = PC2, color = sample_group, label = sample_id)) +
    geom_point(size = 5, alpha = 0.8) +
    ggrepel::geom_text_repel() +
    labs(
      title = "Principal Component Analysis (PCA)",
      x = paste0("PC1 (", percent_var[1], "%)"),
      y = paste0("PC2 (", percent_var[2], "%)"),
      color = "Group"
    ) +
    theme_bw() +
    scale_color_brewer(palette = "Set1")
  output_data$results$pca_plot_b64 <- gg_to_base64(p_pca)

  # Volcano Plot
  volcano_df <- stats_df %>%
    mutate(significant = ifelse(p_adj < 0.05 & abs(log2FC) > 1, "Significant", "Not Significant"))

  p_volcano <- ggplot(volcano_df, aes(x = log2FC, y = -log10(p_adj))) +
    geom_point(aes(color = significant), alpha = 0.6) +
    scale_color_manual(values = c("Significant" = "red", "Not Significant" = "grey")) +
    labs(title = "Volcano Plot of NMR Bins", x = "log2(Fold Change)", y = "-log10(Adjusted p-value)") +
    theme_bw() +
    theme(legend.position = "none")
  output_data$results$volcano_plot_b64 <- gg_to_base64(p_volcano)
  
  log_message("Plot generation complete.")
  output_data$status <- 'success'

}, error = function(e) {
  # Catch any error during the process
  log_message(paste("An error occurred:", e$message))
  output_data$status <<- "error"
  output_data$error <<- e$message
})

# ============================================================================
# 3. FINALIZE AND OUTPUT JSON
# ============================================================================
cat(toJSON(output_data, auto_unbox = TRUE, pretty = TRUE))