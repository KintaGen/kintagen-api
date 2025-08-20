# xcms_profiling.R
# An R script for untargeted GC-MS profiling, NOT for differential analysis.
# It identifies features but does not compare groups (no WT vs KO).

# --- 1. Load Libraries ---
# Suppress startup messages for cleaner output
suppressPackageStartupMessages({
  # Ensure BiocManager is installed, as it's needed for xcms, MSnbase, etc.
  if (!requireNamespace("BiocManager", quietly = TRUE)) {
    install.packages("BiocManager", repos = "https://cloud.r-project.org")
  }
  
  # Define the required packages
  bioc_packages <- c("xcms", "MSnbase", "faahKO")
  cran_packages <- c("RColorBrewer", "jsonlite", "zip", "base64enc","ggplot2","dplyr","patchwork") # Added zip and base64enc
  
  # Install missing Bioconductor packages
  for (pkg in bioc_packages) {
    if (!requireNamespace(pkg, quietly = TRUE)) {
      BiocManager::install(pkg, update = FALSE)
    }
  }
  
  # Install missing CRAN packages
  for (pkg in cran_packages) {
    # Using require() inside the loop is a common pattern for this
    if (!require(pkg, character.only = TRUE, quietly = TRUE)) {
      install.packages(pkg, repos = "https://cloud.r-project.org")
    }
  }
  
  # Load all the libraries now that we know they are installed
  library(xcms)
  library(MSnbase)
  library(RColorBrewer)
  library(jsonlite)
  library(base64enc)
  library(dplyr)
  library(patchwork)
})
setwd("~/projects/kintagen/server/")
is_arg_missing <- function(arg) {
  return(is.na(arg) || arg == "undefined" || arg == "null" || arg == "")
}

# --- 2. Get Command Line Arguments ---
args <- commandArgs(trailingOnly = TRUE)
zip_file_arg <- args[1]
use_sample_data <- is_arg_missing(zip_file_arg)

if(use_sample_data) {
  message("No data path provided. Using built-in sample data from 'faahKO' package.")
  data_path <- system.file("cdf", package = "faahKO")
} else {
  data_path <- args[1]
  message(paste("Using custom data path:", data_path))
}
gg_to_base64 <- function(gg, width = 8, height = 6) {
  temp_file <- tempfile(fileext = ".png")
  ggsave(temp_file, plot = gg, width = width, height = height, dpi = 150)
  base64_string <- base64enc::base64encode(temp_file)
  unlink(temp_file)
  return(paste0("data:image/png;base64,", base64_string))
}
# --- 3. Main Analysis Function ---
run_profiling <- function(data_path) {
  # --- Data Loading & XCMS Pipeline ---
  all_files <- list.files(data_path, full.names = TRUE, recursive = TRUE)
  files <- all_files[grepl("\\.CDF$", all_files, ignore.case = TRUE)]
  if(length(files) == 0) stop("No valid .CDF files found.", call.=FALSE)
  
  pheno <- data.frame(sample_name = sub(pattern = "(.*)\\..*$", replacement = "\\1", basename(files)), sample_group = "Sample", stringsAsFactors = FALSE)
  rawData <- readMSData(files = files, pdata = new("AnnotatedDataFrame", pheno), mode = "onDisk")
  
  cwp <- CentWaveParam(peakwidth = c(5, 20), ppm = 2500, snthresh = 10, prefilter = c(3, 100))
  xdata <- findChromPeaks(rawData, param = cwp)
  
  pdp <- PeakDensityParam(sampleGroups = xdata$sample_group, bw = 5, minFraction = 0.5, minSamples = 1)
  xdata <- groupChromPeaks(xdata, param = pdp)
  
  pgp <- PeakGroupsParam(minFraction = 0.5, subset = 1:length(files), subsetAdjust = "average", span = 0.4)
  xdata <- adjustRtime(xdata, param = pgp)
  
  pdp_regroup <- PeakDensityParam(sampleGroups = xdata$sample_group, bw = 2.5, minFraction = 0.5, minSamples = 1)
  xdata <- groupChromPeaks(xdata, param = pdp_regroup)
  
  # Fill Missing Peaks - This is the final step of data processing
  fpp <- FillChromPeaksParam(expandMz = 0, expandRt = 0, ppm = 1250)
  xdata <- fillChromPeaks(xdata, param = fpp)
  
  # --- THE FIX IS HERE ---
  # --- Extract Feature Table AFTER the entire pipeline is complete ---
  feature_def <- featureDefinitions(xdata)
  feature_table <- featureValues(xdata, value = "into")
  
  # Check if features were found
  if(nrow(feature_def) == 0) {
    stop("XCMS processing completed, but no chemical features were detected.", call.=FALSE)
  }
  
  final_table <- data.frame(feature_id = rownames(feature_def), mz = round(feature_def$mzmed, 4), rt = round(feature_def$rtmed, 2), as.data.frame(feature_table))
  # --- END FIX ---
  
  # --- Generate Summary Plots ---
  bpc_data <- chromatogram(xdata, type = "bpc")
  bpc_df <- do.call(rbind, lapply(1:length(bpc_data), function(i) {data.frame(sample = pData(bpc_data)$sample_name[i], rt = rtime(bpc_data[[i]]), intensity = intensity(bpc_data[[i]]))}))
  bpc_plot_gg <- ggplot(bpc_df, aes(x = rt, y = intensity, group = sample, color = sample)) + geom_line() + labs(title = "Base Peak Chromatograms", x = "Retention Time (sec)", y = "Intensity", color = "Sample") + theme_bw() + theme(legend.position = "bottom")
  #png("bpc_plot.png", width = 800, height = 600, res = 100); dev.off()
  bpc_plot_b64 <- gg_to_base64(bpc_plot_gg)
  
  map_plot_gg <- ggplot(as.data.frame(feature_def), aes(x = rtmed, y = mzmed)) + geom_point(color = "steelblue", alpha = 0.7) + labs(title = "Metabolite Feature Map", x = "Retention Time (sec)", y = "m/z") + theme_bw()
  #png("metabolite_map.png", width = 800, height = 600, res = 100); dev.off()
  metabolite_map_b64 <- gg_to_base64(map_plot_gg)
  
  # --- Generate Mass Spectrum plots for Top 5 Features ---
  top_features <- final_table %>%
    mutate(total_intensity = rowSums(select(., starts_with("ko") | starts_with("wt")), na.rm = TRUE)) %>%
    arrange(desc(total_intensity)) %>%
    head(1)
  
  spectrum_plots_list <- lapply(1:nrow(top_features), function(i) {
    feature_id <- top_features$feature_id[i]
    feature_mz <- top_features$mz[i]
    feature_rt <- top_features$rt[i]
    
    chrom_peaks <- chromPeaks(xdata, mz = feature_mz, rt = feature_rt)
    if(nrow(chrom_peaks) == 0) return(ggplot() + labs(title=paste("No peaks found for feature:", feature_id)) + theme_void())
    
    best_peak <- chrom_peaks[which.max(chrom_peaks[, "into"]), , drop = FALSE]
    sample_idx <- best_peak[, "sample"]
    apex_rt <- best_peak[, "rt"]
    
    target_sample_name <- xdata$sample_name[sample_idx]
    raw_data_for_sample <- rawData[rawData$sample_name == target_sample_name]
    # --- THE FIX IS HERE ---
    # 1. Get all retention times from the selected sample's raw data.
    rts_in_sample <- rtime(raw_data_for_sample)
    
    # 2. Find the index of the scan that is closest to our apex retention time.
    closest_scan_idx <- which.min(abs(rts_in_sample - apex_rt))
    
    # 3. Extract that single spectrum directly by its index.
    spec <- raw_data_for_sample[[closest_scan_idx]]
    if (length(intensity(spec)) > 0) {
      spec_df <- data.frame(mz = as.numeric(mz(spec)), intensity = as.numeric(intensity(spec)))

      # 1. Normalize the intensity to create a relative abundance.
      spec_df$relative_intensity <- (spec_df$intensity / max(spec_df$intensity)) * 100
      
      # 2. Subset the data for labeling based on the new relative intensity.
      label_data <- spec_df %>% filter(relative_intensity > 15)
      molecular_ion_data <- spec_df[which.max(spec_df$mz), ]
      
      # 3. Build the plot using the new 'relative_intensity' column for the y-axis.
      p <- ggplot(spec_df, aes(x = mz, y = relative_intensity)) +
        geom_segment(aes(xend = mz, yend = 0), linewidth = 0.8, color = "darkcyan") +
        geom_point(color = "darkcyan", size = 1.5) +
        geom_text(data = label_data, aes(label = round(mz, 2)), vjust = -0.7, size = 3, color = "black") +
        # Label specifically for the molecular ion
        geom_text(
          data = molecular_ion_data,
          aes(label = paste(round(mz, 2), "(M+)")), # Add "(M+)" to the label
          vjust = -0.7,
          size = 3.5,
          fontface = "bold",
          color = "orange" # Use a distinct color
        ) +
        labs(
          title = paste("Mass Spectrum for Feature:", feature_id),
          subtitle = paste("Apex at", round(apex_rt, 2), "sec in sample", target_sample_name),
          x = "m/z (Fragment Mass)",
          y = "Relative Abundance (%)" 
        ) +
        theme_bw() +
        coord_cartesian(ylim = c(0, 110)) # Set y-axis from 0 to 110 for better spacing
      return(p)
    } else {
      return(ggplot() + labs(title=paste("No spectrum data for feature:", feature_id)) + theme_void())
    }
  })
  
  top_spectra_plot_b64 <- NULL
  if (length(spectrum_plots_list) > 0) {
    combined_plot <- wrap_plots(spectrum_plots_list, ncol = 1)
    #png("top_features_spectra.png", width = 800, height = 1500, res = 100)
    #dev.off()
    top_spectra_plot_b64 <- gg_to_base64(combined_plot)
  }
  
  return(list(
    feature_table = final_table,
    bpc_plot_b64 = bpc_plot_b64,
    metabolite_map_b64 = metabolite_map_b64,
    top_spectra_plot_b64 = top_spectra_plot_b64
  ))
}
# --- 4. Main Execution Block ---
# This block runs the analysis and prints the final JSON output.
output <- list(status = "processing", error = NULL, log = c(), results = NULL)
tryCatch({
  
  results_data <- run_profiling(data_path)

  output$status <- "success"
  output$results <- results_data
  
}, error = function(e) {
  output$status <<- "error"
  output$error <<- paste("R Error:", e$message)
})

# Convert the final list to JSON and print to stdout
json_output <- toJSON(output, auto_unbox = TRUE, pretty = TRUE)
cat(json_output)