# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
#
#        LD50/ED50 Dose-Response Analysis - API Version
#
#   This script is designed for non-interactive execution by an API.
#   It takes a data URL as input, performs dose-response analysis,
#   generates a plot as a Base64 encoded string, and outputs all results
#   as a single JSON string to standard output.
#
# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

# ============================================================================
# 1. SETUP & INITIALIZATION
# ============================================================================
setwd("~/projects/kintagen/server/")
# Suppress startup messages for a cleaner API output
suppressPackageStartupMessages({
  if (!requireNamespace("drc", quietly = TRUE)) install.packages("drc", repos = "https://cloud.r-project.org")
  if (!requireNamespace("jsonlite", quietly = TRUE)) install.packages("jsonlite", repos = "https://cloud.r-project.org")
  if (!requireNamespace("ggplot2", quietly = TRUE)) install.packages("ggplot2", repos = "https://cloud.r-project.org")
  if (!requireNamespace("base64enc", quietly = TRUE)) install.packages("base64enc", repos = "https://cloud.r-project.org") # For Base64 encoding
  
  library(drc)
  library(jsonlite)
  library(ggplot2)
  library(base64enc)
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

# --- Helper function to check for missing/null/undefined arguments ---
is_arg_missing <- function(arg) {
  return(is.na(arg) || arg == "undefined" || arg == "null" || nchar(arg) == 0)
}

args <- commandArgs(trailingOnly = TRUE)
inputFileUrl <- args[1]

# --- Read and Prepare Data ---
tryCatch({
  if (is_arg_missing(inputFileUrl)) {
    log_message("No input URL provided. Using internal sample data.")
    # Generate sample data if no URL is given
    data <- data.frame(
      dose = c(0.1, 0.5, 1, 5, 10, 20),
      total = rep(50, 6),
      response = c(1, 5, 10, 25, 40, 48)
    )
  } else {
    log_message(paste("Reading data from URL:", inputFileUrl))
    data <- read.csv(inputFileUrl)
  }
  
  required_cols <- c("dose", "response", "total")
  if (!all(required_cols %in% colnames(data))) {
    stop(paste("Input CSV must contain the columns:", paste(required_cols, collapse = ", ")))
  }
  log_message("Data successfully loaded and validated.")
}, error = function(e) {
  output_data$status <<- "error"
  output_data$error <<- paste("Failed to read or validate input data:", e$message)
  cat(toJSON(output_data, auto_unbox = TRUE))
  quit(status=0,save="no")
})


# ============================================================================
# 3. DOSE-RESPONSE ANALYSIS
# ============================================================================
tryCatch({
  log_message("Performing dose-response modeling...")
  model <- drm(response / total ~ dose, weights = total, data = data, fct = LL.2(), type = "binomial")
  
  # --- Calculate ED50 (LD50) ---
  ed_results <- ED(model, 50, interval = "delta", level = 0.95, display = FALSE)
  
  # --- Prepare results for JSON output ---
  model_summary_obj <- summary(model)
  
  output_data$results$ld50_estimate <- ed_results[1]
  output_data$results$standard_error <- ed_results[2]
  output_data$results$confidence_interval_lower <- ed_results[3]
  output_data$results$confidence_interval_upper <- ed_results[4]
  output_data$results$model_coefficients <- coef(model_summary_obj)
  
  log_message("Dose-response analysis complete.")
}, error = function(e) {
  output_data$status <<- "error"
  output_data$error <<- paste("Error during DRC modeling:", e$message)
  cat(toJSON(output_data, auto_unbox = TRUE))
  quit(status = 0,save="no")
})


# ============================================================================
# 4. GENERATE PLOT AS BASE64 STRING
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
  log_message("Generating plot...")
  
  # Prepare data for ggplot
  plot_data <- data.frame(
    dose = data$dose,
    proportion = data$response / data$total
  )
  
  min_dose_nonzero <- min(plot_data$dose[plot_data$dose > 0], na.rm = TRUE)
  max_dose <- max(plot_data$dose, na.rm = TRUE)
  curve_data <- data.frame(dose = exp(seq(log(min_dose_nonzero), log(max_dose), length.out = 100)))
  curve_data$p <- predict(model, newdata = curve_data)
  
  ld50_val <- output_data$results$ld50_estimate
  
  # Build the ggplot object
  p_ld50 <- ggplot(plot_data, aes(x = dose, y = proportion)) +
    geom_line(data = curve_data, aes(x = dose, y = p), color = "blue", size = 1) +
    geom_point(size = 3, shape = 16) +
    geom_point(aes(x = ld50_val, y = 0.5), color = "red", size = 4, shape = 18) +
    geom_segment(aes(x = ld50_val, y = 0, xend = ld50_val, yend = 0.5), linetype = "dashed", color = "darkgrey") +
    geom_segment(aes(x = 0, y = 0.5, xend = ld50_val, yend = 0.5), linetype = "dashed", color = "darkgrey") +
    geom_label(aes(x = ld50_val, y = 0.1, label = sprintf("LD50 = %.3f", ld50_val)), hjust = 0, nudge_x = 0.05, fontface = "bold") +
    scale_x_log10(
      name = "Dose (log scale)",
      breaks = scales::trans_breaks("log10", function(x) 10^x),
      labels = scales::trans_format("log10", scales::math_format(10^.x))
    ) +
    labs(title = "Dose-Response Curve with LD50 Estimate", y = "Response Proportion") +
    annotation_logticks(sides = "b") +
    theme_bw() +
    theme(plot.title = element_text(hjust = 0.5, face = "bold"))
  
  # Convert plot to Base64 and add to results
  output_data$results$plot_b64 <- gg_to_base64(p_ld50)
  
  log_message("Plot generation complete.")
}, error = function(e) {
  output_data$status <<- "error"
  output_data$error <<- paste("Error during plot generation:", e$message)
  # Don't quit, just report the error and return what we have
})


# ============================================================================
# 5. FINALIZE AND OUTPUT JSON
# ============================================================================
output_data$status <- ifelse(is.null(output_data$error), "success", "error")
cat(toJSON(output_data, auto_unbox = TRUE, pretty = TRUE))
