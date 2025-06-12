# scripts/analyze.R

# Load required library
library(batman)

# Get command line arguments
args <- commandArgs(trailingOnly = TRUE)

# The script now only expects ONE argument: the path to the Bruker data.
if (length(args) != 1) {
  stop("Usage: Rscript analyze.R <path_to_bruker_data>", call. = FALSE)
}

# Assign the single argument to a variable
bruker_data_path <- args[1]
 
# The output directory is now fixed. BATMAN will create a 'batman_run'
# folder inside the current working directory. The Node.js server will
# set this working directory appropriately.
results_output_path <- getwd() 

print(paste("R script started. Input:", bruker_data_path))
print(paste("Working directory and output path:", results_output_path))
# Get data from filCDN first, then adjust batman usage

# Run the BATMAN analysis
tryCatch({
  result <- batman(
    BrukerDataDir = bruker_data_path, # Here we try to use the data from filCDN
    runBATMANDir = results_output_path, # Tell BATMAN to use the current working dir
    createDir = TRUE
  )
  # Should upload result to filCDN
  print("R script finished successfully.")
}, error = function(e) {
  print(paste("R Error:", e$message))
  stop(e)
})