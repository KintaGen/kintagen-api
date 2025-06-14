# Title: LD50/ED50 Dose-Response Analysis with ggplot2
# Description: This script performs dose-response analysis and generates a
#              publication-quality plot using the ggplot2 package.

# --- 1. Load Required Libraries ---
# Added ggplot2 to the list of required packages.
if (!requireNamespace("drc", quietly = TRUE)) install.packages("drc")
if (!requireNamespace("jsonlite", quietly = TRUE)) install.packages("jsonlite")
if (!requireNamespace("ggplot2", quietly = TRUE)) install.packages("ggplot2")
if (!requireNamespace("svglite", quietly = TRUE)) install.packages("svglite")
if (!requireNamespace("httr", quietly = TRUE)) install.packages("httr")
setwd("~/projects/kintagen/server/")
library(drc)
library(jsonlite)
library(ggplot2)
library(svglite)
library(httr)


# --- 2. Get Command Line Arguments (No Change) ---
args <- commandArgs(trailingOnly = TRUE)
if (length(args) == 0) {
  stop("Error: No input URL provided. Usage: Rscript <script_name>.R <url_to_csv>", call. = FALSE)
}
inputFile <- args[1]


# --- 3. Read and Prepare Data (No Change) ---
data <- tryCatch({
  read.csv(inputFile)
}, error = function(e) {
  stop(paste("Error reading CSV file:", e$message), call. = FALSE)
})
required_cols <- c("dose", "response", "total")
if (!all(required_cols %in% colnames(data))) {
  stop(paste("Error: Input CSV must contain the columns:", paste(required_cols, collapse = ", ")), call. = FALSE)
}

# --- 4. Perform Dose-Response Modeling (No Change) ---
model <- drm(response / total ~ dose, weights = total, data = data, fct = LL.2(), type = "binomial")

# --- 5. Calculate the ED50 (LD50) (No Change) ---
ed_results <- ED(model, 50, interval = "delta", level = 0.95,display = FALSE)
ld50_val <- ed_results[1]

# --- 6. Generate a Plot using ggplot2 (REPLACED SECTION) ---

# STEP 1: Prepare data for ggplot
# Create a data frame from the original data with a calculated proportion column
plot_data <- model$data
names(plot_data) = c("dose","proportion")
plot_data$dose = as.numeric(plot_data$dose)
plot_data$proportion = as.numeric(plot_data$proportion)

# Create a new data frame for the smooth fitted curve.
# We generate a sequence of 100 doses from the min to the max observed dose.
# We exclude dose 0 from the sequence for the log scale, but will plot the point itself.
min_dose_nonzero <- min(plot_data$dose[plot_data$dose > 0])
max_dose <- max(plot_data$dose)
curve_data <- data.frame(dose = exp(seq(log(min_dose_nonzero), log(max_dose), length.out = 100)))

# Use the model to predict the response proportion for our new sequence of doses.
curve_data$p <- predict(model, newdata = curve_data)

# STEP 2: Build the ggplot object layer by layer
p <- ggplot(plot_data, aes(x = dose, y = proportion)) +
  
  # Layer 1: The fitted curve from our generated `curve_data`
  # -- CORRECTIONS APPLIED HERE --
  geom_line(data = curve_data, aes(x = dose, y = p), color = "blue", size = 1) +
  
  # Layer 2: The original data points
  geom_point(size = 3, shape = 16) +
  
  # Layer 3: The LD50 annotations
  geom_point(aes(x = ld50_val, y = 0.5), color = "red", size = 4, shape = 18) + 
  geom_segment(aes(x = ld50_val, y = 0, xend = ld50_val, yend = 0.5), linetype = "dashed", color = "darkgrey") +
  geom_segment(aes(x = 0, y = 0.5, xend = ld50_val, yend = 0.5), linetype = "dashed", color = "darkgrey") +
  
  # Use geom_label for a nice box around the text
  geom_label(aes(x = ld50_val, y = 0.1, label = sprintf("LD50 = %.3f", ld50_val)), 
             hjust = 0, # Left-aligns the label, pushing it to the right
             nudge_x = 0.05, 
             fontface = "bold") +
  
  # Layer 4: Scales and Labels
  scale_x_log10(
    name = "Dose (log scale)",
    breaks = scales::trans_breaks("log10", function(x) 10^x),
    labels = scales::trans_format("log10", scales::math_format(10^.x))
  ) +
  labs(
    title = "Dose-Response Curve with LD50 Estimate",
    y = "Response Proportion"
  ) +
  annotation_logticks(sides = "b") + # Add log tick marks on the bottom axis
  
  # Layer 5: A clean theme
  theme_bw() +
  theme(plot.title = element_text(hjust = 0.5, face = "bold")) # Center the title

# --- 6. Generate a Plot using ggplot2 (No Change) ---
# ... (The entire ggplot2 block remains the same, ending with ggsave)
plot_filename <- "./results/ld50_plot.jpeg"
ggsave(plot_filename, plot = p, device = "jpeg", width = 8, height = 6)


# --- 6.5. NEW: Upload Plot to FilCDN ---
# This new section handles the upload process.
upload_result_cid <- NULL
upload_error <- NULL

tryCatch({
  # Construct the POST request using httr, which mirrors the curl command.
  # httr automatically handles multipart encoding when you use upload_file().
  response <- POST(
    url = "https://salty-eyes-visit.loca.lt/api/proofset/upload-and-add-root",
    body = list(
      serviceUrl = "https://caliberation-pdp.infrafolio.com",
      serviceName = "pdpricardo",
      proofSetID = "318",
      file = upload_file(plot_filename) # This attaches the file to the request
    )
    # No need for encode = "multipart", httr is smart enough.
  )
  
  # Check for HTTP errors (e.g., 404, 500)
  stop_for_status(response, task = "upload plot to FilCDN")
  
  # Parse the JSON response from the upload API
  upload_content <- content(response, "text", encoding = "UTF-8")
  upload_json <- fromJSON(upload_content)
  
  # Extract the CID. We assume the response key is 'cid'.
  if (!is.null(upload_json$rootCID)) {
    upload_result_cid <- strsplit(upload_json$rootCID,":")[[1]][1]
  } else {
    stop("Upload successful, but 'cid' not found in response.")
  }
  
}, error = function(e) {
  # If any part of the upload fails, store the error message.
  upload_error <- e$message
})


# --- 7. Prepare and Output JSON (Modified) ---
# This section is now updated to include the upload result.
model_summary_obj <- summary(model)
model_details <- list(coefficients = coef(model_summary_obj))

output <- list(
  success = TRUE,
  ld50_estimate = ed_results[1],
  standard_error = ed_results[2],
  confidence_interval_lower = ed_results[3],
  confidence_interval_upper = ed_results[4],
  model_details = model_details,
  
  # Add the upload information to the final output
  plotCid = upload_result_cid,
  plotUploadError = upload_error # This will be NULL if the upload succeeded
)

cat(toJSON(output, auto_unbox = TRUE, null = "null"))
